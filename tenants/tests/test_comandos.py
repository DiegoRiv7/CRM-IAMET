"""
Fase 6.3 — comandos de registro: tenant_alta / tenant_baja (BD de control).
Los secretos entran por entorno y nunca salen por stdout.
"""
import io
import os
from unittest import mock

from django.core.management import CommandError, call_command
from django.test import TestCase

from tenants.models import Tenant, TenantHost
from tenants.resolver import invalidar_resolver, por_host


class TenantAltaTests(TestCase):
    databases = {'default', 'control'}

    def setUp(self):
        invalidar_resolver()

    def _alta(self, *args, env=None, **kw):
        out = io.StringIO()
        with mock.patch.dict(os.environ, env or {}, clear=False):
            call_command('tenant_alta', *args, stdout=out, **kw)
        return out.getvalue()

    def test_crea_con_password_por_entorno_y_genera_secretos(self):
        salida = self._alta('acme', '--nombre', 'Acme SA', '--host', 'Acme.Test', '--host', 'acme.ejemplo.mx',
                            env={'TENANT_DB_PASSWORD': 'pw-secreta'})
        t = Tenant.objects.get(slug='acme')
        self.assertEqual((t.db_name, t.db_user, t.db_password), ('crm_acme', 'u_acme', 'pw-secreta'))
        self.assertTrue(t.portal_sso_secret and t.mail_encryption_key, 'secretos generados')
        self.assertEqual(sorted(h.hostname for h in t.hosts.all()), ['acme.ejemplo.mx', 'acme.test'])
        self.assertNotIn('pw-secreta', salida)
        self.assertNotIn(t.portal_sso_secret, salida)
        self.assertEqual(por_host('ACME.test').slug, 'acme')

    def test_nueva_sin_password_ni_nombre_falla(self):
        with self.assertRaises(CommandError):
            self._alta('nueva', '--nombre', 'X')
        with self.assertRaises(CommandError):
            self._alta('nueva', env={'TENANT_DB_PASSWORD': 'x'})
        self.assertFalse(Tenant.objects.filter(slug='nueva').exists())

    def test_existe_codigos(self):
        self._alta('acme', '--nombre', 'Acme', env={'TENANT_DB_PASSWORD': 'x'})
        out = io.StringIO()
        call_command('tenant_alta', 'acme', '--existe', stdout=out)
        self.assertEqual(out.getvalue().strip(), 'existe')
        with self.assertRaises(SystemExit):
            call_command('tenant_alta', 'nadie', '--existe', stdout=io.StringIO())

    def test_rerun_conserva_secretos_y_suma_hosts(self):
        self._alta('acme', '--nombre', 'Acme', '--host', 'a.test', env={'TENANT_DB_PASSWORD': 'pw1', 'TENANT_SSO_SECRET': 'sso1'})
        self._alta('acme', '--host', 'b.test')  # sin entorno: nada de secretos cambia
        t = Tenant.objects.get(slug='acme')
        self.assertEqual((t.db_password, t.portal_sso_secret, t.nombre), ('pw1', 'sso1', 'Acme'))
        self.assertEqual(sorted(h.hostname for h in t.hosts.all()), ['a.test', 'b.test'])

    def test_host_de_otra_empresa_no_se_roba(self):
        self._alta('aa', '--nombre', 'A', '--host', 'x.test', env={'TENANT_DB_PASSWORD': 'x'})
        with self.assertRaises(CommandError):
            self._alta('bb', '--nombre', 'B', '--host', 'x.test', env={'TENANT_DB_PASSWORD': 'y'})

    def test_slug_invalido(self):
        with self.assertRaises(CommandError):
            self._alta('Mal Slug', '--nombre', 'X', env={'TENANT_DB_PASSWORD': 'x'})


class TenantPlantillaTests(TestCase):
    databases = {'default', 'control'}

    @classmethod
    def tearDownClass(cls):
        # tenant_context registra el alias de la plantilla; quitarlo para no
        # romper el desmontaje de Django (recorre todos los alias).
        from tenants.connections import olvidar_alias
        olvidar_alias('t_plantilla')
        super().tearDownClass()

    def test_no_se_registra_como_empresa(self):
        """La plantilla usa un Tenant en memoria: no entra al registro de
        control, así que ningún hostname la resuelve y el worker la ignora."""
        # El repunte de `default` ya se prueba en TenantRunTests; aquí estorba
        # porque TestCase envuelve cada prueba en un atomic sobre `default`.
        with mock.patch.dict(os.environ, {'TENANT_DB_PASSWORD': 'pw'}), \
                mock.patch('tenants.management.commands.tenant_plantilla.apuntar_default_al_tenant'), \
                mock.patch('tenants.management.commands.tenant_plantilla.call_command') as migrate:
            call_command('tenant_plantilla', '--db-name', 'crm_plantilla', stdout=io.StringIO())
        self.assertEqual(Tenant.objects.count(), 0, 'la plantilla no entra al registro')
        # migró apuntando al alias de la plantilla, no a default ni a control
        self.assertEqual(migrate.call_args.args[0], 'migrate')
        self.assertIn('t_plantilla', migrate.call_args.args)

    def test_exige_password_por_entorno(self):
        with mock.patch.dict(os.environ, {'TENANT_DB_PASSWORD': ''}):
            with self.assertRaises(CommandError):
                call_command('tenant_plantilla', stdout=io.StringIO())


class TenantBajaTests(TestCase):
    databases = {'default', 'control'}

    def setUp(self):
        invalidar_resolver()
        with mock.patch.dict(os.environ, {'TENANT_DB_PASSWORD': 'x'}):
            call_command('tenant_alta', 'acme', '--nombre', 'Acme', '--host', 'acme.test', stdout=io.StringIO())

    def test_desactivar_deja_de_resolver_y_conserva_registro(self):
        self.assertIsNotNone(por_host('acme.test'))
        call_command('tenant_baja', 'acme', stdout=io.StringIO())
        self.assertIsNone(por_host('acme.test'))
        self.assertFalse(Tenant.objects.get(slug='acme').activo)

    def test_borrar_elimina_registro_y_hosts(self):
        call_command('tenant_baja', 'acme', '--borrar', stdout=io.StringIO())
        self.assertFalse(Tenant.objects.filter(slug='acme').exists())
        self.assertFalse(TenantHost.objects.filter(hostname='acme.test').exists())

    def test_inexistente(self):
        with self.assertRaises(CommandError):
            call_command('tenant_baja', 'nadie', stdout=io.StringIO())
