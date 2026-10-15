"""
Fase 6.1 — helpers de runtime, media por empresa y vista /media/.
Sin tocar `app` (settings mínimos): los tenants se construyen sin guardar.
"""
import os
import tempfile
from types import SimpleNamespace
from unittest import mock

from django.db import connections
from django.test import RequestFactory, SimpleTestCase, override_settings

from tenants.connections import olvidar_alias
from tenants.context import tenant_context
from tenants.models import Tenant
from tenants.runtime import alias_bd, mail_key, prefijo_cache, sso_secret
from tenants.storage import TenantMediaStorage
from tenants.views import media


def _t(slug, **extra):
    return Tenant(slug=slug, nombre=slug, db_name=f'crm_{slug}', db_user=f'u_{slug}', db_password='x', **extra)


class _Limpia:
    @classmethod
    def tearDownClass(cls):
        for a in [a for a in list(connections.databases) if a.startswith('t_')]:
            olvidar_alias(a)
        super().tearDownClass()


class RuntimeTests(_Limpia, SimpleTestCase):
    databases = {'default', 'control'}

    def test_prefijo_cache_y_alias(self):
        self.assertEqual(prefijo_cache('k'), 'k')
        self.assertEqual(alias_bd(), 'default')
        with tenant_context(_t('acme')):
            self.assertEqual(prefijo_cache('k'), 't_acme|k')
            self.assertEqual(alias_bd(), 't_acme')
        self.assertEqual(prefijo_cache('k'), 'k')

    @override_settings(MAIL_ENCRYPTION_KEY='llave-clasica')
    def test_secretos_por_tenant_y_fallback_clasico(self):
        with mock.patch.dict(os.environ, {'PORTAL_SSO_SECRET': 'sso-clasico'}):
            self.assertEqual(mail_key(), 'llave-clasica')
            self.assertEqual(sso_secret(), 'sso-clasico')
            with tenant_context(_t('acme', mail_encryption_key=' llave-acme ', portal_sso_secret='sso-acme')):
                self.assertEqual(mail_key(), 'llave-acme')
                self.assertEqual(sso_secret(), 'sso-acme')
            # Tenant SIN secretos → vacío (nunca hereda el de otra empresa ni el clásico).
            with tenant_context(_t('vacia')):
                self.assertEqual(mail_key(), '')
                self.assertEqual(sso_secret(), '')


class MediaTests(_Limpia, SimpleTestCase):
    databases = {'default', 'control'}

    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_storage_carpeta_por_tenant_url_igual(self):
        with override_settings(MEDIA_ROOT=self.tmp, MEDIA_URL='/media/'):
            st = TenantMediaStorage()
            self.assertEqual(st.location, os.path.abspath(self.tmp))  # clásico
            with tenant_context(_t('acme')):
                self.assertEqual(st.location, os.path.abspath(os.path.join(self.tmp, 'acme')))
                self.assertEqual(st.url('f.txt'), '/media/f.txt')  # la URL no delata la carpeta
                nombre = st.save('f.txt', __import__('django.core.files.base', fromlist=['ContentFile']).ContentFile(b'hola'))
                self.assertTrue(os.path.exists(os.path.join(self.tmp, 'acme', nombre)))
            with tenant_context(_t('otra')):
                self.assertFalse(st.exists('f.txt'), 'otra empresa no ve el archivo de acme')

    def test_vista_media_solo_login_y_solo_su_carpeta(self):
        rf = RequestFactory()
        os.makedirs(os.path.join(self.tmp, 'acme'), exist_ok=True)
        os.makedirs(os.path.join(self.tmp, 'otra'), exist_ok=True)
        with open(os.path.join(self.tmp, 'otra', 'secreto.txt'), 'wb') as f:
            f.write(b'de otra')
        with open(os.path.join(self.tmp, 'acme', 'mio.txt'), 'wb') as f:
            f.write(b'mio')
        with override_settings(MEDIA_ROOT=self.tmp, LOGIN_URL='/app/login/'):
            with tenant_context(_t('acme')):
                anon = rf.get('/media/mio.txt')
                anon.user = SimpleNamespace(is_authenticated=False)
                self.assertEqual(media(anon, 'mio.txt').status_code, 302, 'sin login → redirige')
                req = rf.get('/media/mio.txt')
                req.user = SimpleNamespace(is_authenticated=True)
                resp = media(req, 'mio.txt')
                self.assertEqual(resp.status_code, 200)
                self.assertEqual(b''.join(resp.streaming_content), b'mio')
                # El archivo de la otra empresa no existe "para" acme, ni con ../
                from django.http import Http404
                for p in ('secreto.txt', '../otra/secreto.txt'):
                    r2 = rf.get('/media/' + p)
                    r2.user = SimpleNamespace(is_authenticated=True)
                    with self.assertRaises(Http404, msg=p):
                        media(r2, p)
