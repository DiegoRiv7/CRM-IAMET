"""
Fase 6.4 — Suite de AISLAMIENTO: la prueba que de verdad importa.

Verifica que, con un mismo proceso atendiendo a dos empresas, nada de una se
filtre a la otra por ninguno de los caminos que el mapeo del código identificó
como riesgosos:

  caché de configuración · conexión de BD (ORM y SQL crudo) · archivos de media
  · secretos (correo y SSO) · hilos de trabajo · caché compartida

Son pruebas de MECANISMO (no cargan `app`): cada una ataca el punto exacto por
donde se filtraría.
"""
import os
import tempfile
import threading
from unittest import mock

from django.core.cache import cache
from django.db import connections
from django.test import SimpleTestCase, override_settings

from tenants.connections import olvidar_alias
from tenants.context import bind_tenant, get_current_tenant, tenant_context
from tenants.models import Tenant
from tenants.runtime import alias_bd, mail_key, prefijo_cache, sso_secret
from tenants.storage import TenantMediaStorage


def _t(slug, **extra):
    """Tenant sin guardar: estas pruebas miran el mecanismo, no el registro."""
    return Tenant(slug=slug, nombre=slug.title(), db_name=f'crm_{slug}',
                  db_user=f'u_{slug}', db_password=f'pw-{slug}', **extra)


class AislamientoTests(SimpleTestCase):
    databases = {'default', 'control'}

    @classmethod
    def tearDownClass(cls):
        for a in [a for a in list(connections.databases) if a.startswith('t_')]:
            olvidar_alias(a)
        super().tearDownClass()

    def setUp(self):
        self.a = _t('empresa-a', mail_encryption_key='llave-A', portal_sso_secret='sso-A')
        self.b = _t('empresa-b', mail_encryption_key='llave-B', portal_sso_secret='sso-B')
        cache.clear()

    # ── 1. Base de datos ────────────────────────────────────────────────
    def test_cada_empresa_apunta_a_su_base(self):
        with tenant_context(self.a):
            self.assertEqual(alias_bd(), 't_empresa-a')
        with tenant_context(self.b):
            self.assertEqual(alias_bd(), 't_empresa-b')
        # Credenciales distintas por alias: el GRANT de MySQL solo cubre SU base,
        # así que aunque el proceso sea el mismo, A no puede leer la de B.
        self.assertEqual(connections.databases['t_empresa-a']['USER'], 'u_empresa-a')
        self.assertEqual(connections.databases['t_empresa-b']['USER'], 'u_empresa-b')
        self.assertNotEqual(connections.databases['t_empresa-a']['PASSWORD'],
                            connections.databases['t_empresa-b']['PASSWORD'])
        # Con el motor real (MySQL en el servidor) cada alias lleva SU base.
        # (En estas pruebas el motor es SQLite y db_config fuerza NAME=':memory:'.)
        with override_settings(TENANT_DB_ENGINE='django.db.backends.mysql'):
            self.assertEqual(self.a.db_config()['NAME'], 'crm_empresa-a')
            self.assertEqual(self.b.db_config()['NAME'], 'crm_empresa-b')

    def test_sql_crudo_usa_la_conexion_de_la_empresa(self):
        """El SQL crudo del CRM usaba `django.db.connection` (= default = control
        en modo bridge). `conexion()` lo manda a la base de la empresa."""
        from tenants.runtime import conexion
        with tenant_context(self.a):
            self.assertEqual(conexion().alias, 't_empresa-a')
        with tenant_context(self.b):
            self.assertEqual(conexion().alias, 't_empresa-b')

    # ── 2. Caché de configuración (la fuga #1 del mapeo) ────────────────
    def test_cache_de_configuracion_no_se_comparte(self):
        """app/empresa.py cachea EmpresaConfig en memoria del proceso. Sin
        prefijo, la primera empresa que entra siembra el worker y las demás ven
        su nombre, logo y MÓDULOS durante el TTL."""
        import app.empresa as emp
        emp._cache.clear()
        llamadas = []
        try:
            with tenant_context(self.a):
                self.assertEqual(emp._get('empresa', lambda: (llamadas.append('a'), 'CONFIG-A')[1]), 'CONFIG-A')
            with tenant_context(self.b):
                # Si la llave no llevara el tenant, aquí volvería 'CONFIG-A' sin llamar al loader.
                self.assertEqual(emp._get('empresa', lambda: (llamadas.append('b'), 'CONFIG-B')[1]), 'CONFIG-B')
            with tenant_context(self.a):
                self.assertEqual(emp._get('empresa', lambda: 'NO-DEBE-RECARGAR'), 'CONFIG-A', 'A sigue cacheada')
            self.assertEqual(llamadas, ['a', 'b'], 'cada empresa cargó la suya')
        finally:
            emp._cache.clear()

    def test_invalidar_cache_solo_afecta_a_su_empresa(self):
        """Guardar la config de A no debe tirar la caché de B (correcto ya con
        el prefijo; antes `_cache.clear()` borraba la de todas)."""
        import app.empresa as emp
        emp._cache.clear()
        try:
            with tenant_context(self.a):
                emp._get('empresa', lambda: 'A1')
            with tenant_context(self.b):
                emp._get('empresa', lambda: 'B1')
            with tenant_context(self.a):
                emp.invalidar_cache()
                self.assertEqual(emp._get('empresa', lambda: 'A2'), 'A2', 'A se recargó')
            with tenant_context(self.b):
                self.assertEqual(emp._get('empresa', lambda: 'NO'), 'B1', 'B conservó la suya')
        finally:
            emp._cache.clear()

    # ── 3. Caché compartida (Redis/locmem) ──────────────────────────────
    def test_llaves_de_cache_compartida_no_colisionan(self):
        """El asistente guarda resultados de consultas con un token. Con una
        caché compartida, sin prefijo dos empresas leerían la misma llave."""
        with tenant_context(self.a):
            cache.set(prefijo_cache('asist_xlsx_TOKEN'), {'de': 'A'}, 60)
        with tenant_context(self.b):
            self.assertIsNone(cache.get(prefijo_cache('asist_xlsx_TOKEN')), 'B no ve el payload de A')
            cache.set(prefijo_cache('asist_xlsx_TOKEN'), {'de': 'B'}, 60)
        with tenant_context(self.a):
            self.assertEqual(cache.get(prefijo_cache('asist_xlsx_TOKEN')), {'de': 'A'}, 'A conserva el suyo')

    # ── 4. Secretos ─────────────────────────────────────────────────────
    @override_settings(MAIL_ENCRYPTION_KEY='llave-de-iamet')
    def test_secretos_por_empresa(self):
        """Llave de cifrado del correo y secreto del SSO son de cada empresa:
        con una sola llave compartida, A podría descifrar los buzones de B."""
        with mock.patch.dict(os.environ, {'PORTAL_SSO_SECRET': 'sso-de-iamet'}):
            with tenant_context(self.a):
                self.assertEqual((mail_key(), sso_secret()), ('llave-A', 'sso-A'))
            with tenant_context(self.b):
                self.assertEqual((mail_key(), sso_secret()), ('llave-B', 'sso-B'))
            # Sin empresa (modo clásico, IAMET) se usan las de la instancia.
            self.assertEqual((mail_key(), sso_secret()), ('llave-de-iamet', 'sso-de-iamet'))

    # ── 5. Archivos ─────────────────────────────────────────────────────
    def test_media_separada_por_empresa(self):
        from django.core.files.base import ContentFile
        tmp = tempfile.mkdtemp()
        with override_settings(MEDIA_ROOT=tmp):
            st = TenantMediaStorage()
            with tenant_context(self.a):
                st.save('contrato.pdf', ContentFile(b'datos de A'))
            with tenant_context(self.b):
                # Mismo nombre de archivo, otra empresa: no lo ve ni lo pisa.
                self.assertFalse(st.exists('contrato.pdf'))
                st.save('contrato.pdf', ContentFile(b'datos de B'))
                self.assertEqual(st.open('contrato.pdf').read(), b'datos de B')
            with tenant_context(self.a):
                self.assertEqual(st.open('contrato.pdf').read(), b'datos de A', 'el de A quedó intacto')

    # ── 6. Hilos ────────────────────────────────────────────────────────
    def test_hilos_de_trabajo_llevan_su_empresa(self):
        """Los hilos del correo y de la volumetría resuelven IDs numéricos que
        se repiten entre empresas: sin el tenant correcto, actuarían sobre la
        base equivocada."""
        visto = {}

        def trabajo(nombre):
            visto[nombre] = (get_current_tenant().slug, alias_bd())

        with tenant_context(self.a):
            fa = bind_tenant(trabajo)
        with tenant_context(self.b):
            fb = bind_tenant(trabajo)
        hilos = [threading.Thread(target=fa, args=('a',)), threading.Thread(target=fb, args=('b',))]
        for h in hilos:
            h.start()
        for h in hilos:
            h.join()
        self.assertEqual(visto['a'], ('empresa-a', 't_empresa-a'))
        self.assertEqual(visto['b'], ('empresa-b', 't_empresa-b'))

    def test_dos_empresas_en_paralelo_no_se_pisan(self):
        """Dos requests simultáneos de empresas distintas en el mismo proceso:
        el contextvar es por hilo, así que cada uno ve el suyo."""
        import time
        visto = {}

        def request_de(tenant, nombre):
            def _():
                with tenant_context(tenant):
                    time.sleep(0.02)          # se solapan a propósito
                    visto[nombre] = alias_bd()
            return _

        hilos = [threading.Thread(target=request_de(self.a, 'a')),
                 threading.Thread(target=request_de(self.b, 'b'))]
        for h in hilos:
            h.start()
        for h in hilos:
            h.join()
        self.assertEqual(visto, {'a': 't_empresa-a', 'b': 't_empresa-b'})
        self.assertIsNone(get_current_tenant())
