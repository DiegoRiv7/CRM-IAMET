"""
Pruebas del cimiento multitenant (Fase 0). Lo que garantizan:

  - El registro de empresas SIEMPRE va a `control`.
  - Sin tenant resuelto, el router RECHAZA (no cae a `default` ni a otra empresa).
  - Con tenant, el router usa `t_<slug>` y el alias queda registrado.
  - `default` nunca recibe migraciones en modo tenant; `control` solo las de `tenants`.
  - Middleware: host desconocido/inactivo → 404 sin fijar tenant; host conocido
    → request.tenant y contexto correctos, y el contexto se LIMPIA al terminar.
  - Dos hosts seguidos en el mismo hilo no se cruzan.
  - Los hilos no heredan el tenant salvo con bind_tenant().
"""
import io
import threading

from django.contrib.sessions.models import Session
from django.core.management import call_command
from django.db import connections
from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, TestCase

from tenants.connections import olvidar_alias
from tenants.context import bind_tenant, get_current_tenant, tenant_context
from tenants.middleware import TenantMiddleware
from tenants.models import Tenant, TenantHost
from tenants.resolver import invalidar_resolver
from tenants.router import TenantNotResolved, TenantRouter


def _tenant(slug, activo=True):
    t = Tenant.objects.create(
        slug=slug, nombre=slug.title(), db_name=f'crm_{slug}', db_user=f'u_{slug}',
        db_password='x', activo=activo,
    )
    TenantHost.objects.create(tenant=t, hostname=f'{slug}.test')
    return t


class _LimpiaAlias:
    """Los alias `t_*` se registran a mitad de la prueba; Django los envuelve
    en setUpClass y los desenvuelve en tearDownClass recorriendo TODOS los alias
    (SimpleTestCase._remove_databases_failures), así que hay que quitarlos antes."""

    @classmethod
    def tearDownClass(cls):
        for alias in [a for a in list(connections.databases) if a.startswith('t_')]:
            olvidar_alias(alias)
        super().tearDownClass()


class RouterTests(_LimpiaAlias, TestCase):
    databases = {'default', 'control'}

    def setUp(self):
        invalidar_resolver()
        self.router = TenantRouter()

    def test_registro_siempre_a_control(self):
        self.assertEqual(self.router.db_for_read(Tenant), 'control')
        self.assertEqual(self.router.db_for_write(TenantHost), 'control')
        self.assertEqual(Tenant.objects.db, 'control')

    def test_sin_tenant_rechaza_en_vez_de_caer_a_default(self):
        self.assertIsNone(get_current_tenant())
        with self.assertRaises(TenantNotResolved):
            self.router.db_for_read(Session)
        with self.assertRaises(TenantNotResolved):
            self.router.db_for_write(Session)

    def test_con_tenant_usa_su_alias_y_lo_registra(self):
        t = _tenant('acme')
        with tenant_context(t):
            self.assertEqual(self.router.db_for_read(Session), 't_acme')
            self.assertEqual(self.router.db_for_write(Session), 't_acme')
            self.assertIn('t_acme', connections.databases)
            self.assertEqual(connections.databases['t_acme']['NAME'], ':memory:')
        self.assertIsNone(get_current_tenant(), 'el contexto debe limpiarse al salir')

    def test_migraciones_solo_donde_toca(self):
        r = self.router
        self.assertTrue(r.allow_migrate('control', 'tenants'))
        self.assertFalse(r.allow_migrate('default', 'tenants'))
        self.assertFalse(r.allow_migrate('t_acme', 'tenants'))
        self.assertFalse(r.allow_migrate('control', 'auth'))
        self.assertFalse(r.allow_migrate('default', 'auth'), 'default no recibe la app en modo tenant')
        self.assertTrue(r.allow_migrate('t_acme', 'auth'))
        self.assertTrue(r.allow_migrate('t_acme', 'app'))


class MiddlewareTests(_LimpiaAlias, TestCase):
    databases = {'default', 'control'}

    def setUp(self):
        invalidar_resolver()
        self.rf = RequestFactory()

    def _mw(self, visto):
        def vista(request):
            visto.append((request.tenant.slug, get_current_tenant().slug))
            return HttpResponse('ok')
        return TenantMiddleware(vista)

    def test_host_desconocido_404_y_sin_tenant(self):
        visto = []
        resp = self._mw(visto)(self.rf.get('/app/', HTTP_HOST='nadie.test'))
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(visto, [])
        self.assertIsNone(get_current_tenant())

    def test_host_conocido_fija_tenant_y_limpia(self):
        _tenant('acme')
        visto = []
        resp = self._mw(visto)(self.rf.get('/app/', HTTP_HOST='Acme.test:8000'))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(visto, [('acme', 'acme')])
        self.assertIsNone(get_current_tenant())

    def test_empresa_inactiva_404(self):
        _tenant('zzz', activo=False)
        resp = self._mw([])(self.rf.get('/', HTTP_HOST='zzz.test'))
        self.assertEqual(resp.status_code, 404)

    def test_dos_hosts_seguidos_no_se_cruzan(self):
        _tenant('aa')
        _tenant('bb')
        visto = []
        mw = self._mw(visto)
        mw(self.rf.get('/', HTTP_HOST='aa.test'))
        mw(self.rf.get('/', HTTP_HOST='bb.test'))
        mw(self.rf.get('/', HTTP_HOST='aa.test'))
        self.assertEqual(visto, [('aa', 'aa'), ('bb', 'bb'), ('aa', 'aa')])

    def test_contexto_se_limpia_aunque_la_vista_truene(self):
        _tenant('boom')

        def vista(request):
            raise RuntimeError('x')
        with self.assertRaises(RuntimeError):
            TenantMiddleware(vista)(self.rf.get('/', HTTP_HOST='boom.test'))
        self.assertIsNone(get_current_tenant())

    def test_healthz_no_toca_bd(self):
        resp = TenantMiddleware(lambda r: HttpResponse('no'))(self.rf.get('/healthz/', HTTP_HOST='lo-que-sea'))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, b'ok')


class ContextTests(_LimpiaAlias, TestCase):
    databases = {'default', 'control'}

    def test_hilo_sin_bind_no_hereda_el_tenant(self):
        t = _tenant('solo')
        visto = []
        with tenant_context(t):
            th = threading.Thread(target=lambda: visto.append(get_current_tenant()))
            th.start()
            th.join()
        self.assertEqual(visto, [None])

    def test_bind_tenant_lleva_el_tenant_al_hilo(self):
        t = _tenant('hilo')
        visto = []
        with tenant_context(t):
            fn = bind_tenant(lambda: visto.append(get_current_tenant().slug))
        th = threading.Thread(target=fn)
        th.start()
        th.join()
        self.assertEqual(visto, ['hilo'])
        self.assertIsNone(get_current_tenant())


class TenantRunTests(_LimpiaAlias, SimpleTestCase):
    """SimpleTestCase a propósito: tenant_run repunta `default` del proceso y
    eso no convive con el atomic por clase de TestCase. Django ordena los
    SimpleTestCase al final, así que no afecta a las demás clases."""
    databases = {'default', 'control'}

    def test_reenvia_flags_al_hijo_y_repunta_default_a_la_empresa(self):
        t = _tenant('cli')
        antes = dict(connections.databases['default'])
        out = io.StringIO()
        try:
            # `check --tag models` lleva un --flag: con nargs='*' argparse lo rechazaba.
            call_command('tenant_run', 'cli', 'check', '--tag', 'models', stdout=out)
            self.assertIn('[cli] check --tag models', out.getvalue())
            # Tras el comando, `default` de ESTE proceso es la BD de la empresa
            # (misma config que t_cli): lo que necesitan migraciones/semillas legadas.
            self.assertEqual(connections.databases['default']['NAME'], t.db_config()['NAME'])
            self.assertIsNone(get_current_tenant(), 'el contexto se limpia al salir')
        finally:
            connections.databases['default'] = antes
            try:
                del connections['default']
            except Exception:
                pass
