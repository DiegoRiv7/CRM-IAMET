"""
Fase 6.3b — API de control (/control/…): el portal pregunta por el catálogo y
valida contra UNA empresa, en vez de probar la contraseña en todas.
"""
import json
from unittest import mock

from django.db import connections
from django.http import HttpResponse
from django.test import RequestFactory, TestCase, override_settings

from tenants.connections import olvidar_alias
from tenants.context import get_current_tenant
from tenants.control_api import empresas, reset, validar
from tenants.middleware import TenantMiddleware
from tenants.models import Tenant, TenantHost
from tenants.resolver import invalidar_resolver

TOKEN = 'token-de-control'


def _t(slug, nombre, host, activo=True, sso='sso-' ):
    t = Tenant.objects.create(slug=slug, nombre=nombre, db_name=f'crm_{slug}', db_user=f'u_{slug}',
                              db_password='x', activo=activo, portal_sso_secret=f'{sso}{slug}')
    TenantHost.objects.create(tenant=t, hostname=host)
    return t


class _Limpia:
    @classmethod
    def tearDownClass(cls):
        for a in [a for a in list(connections.databases) if a.startswith('t_')]:
            olvidar_alias(a)
        super().tearDownClass()


@override_settings(CONTROL_API_TOKEN=TOKEN)
class ControlApiTests(_Limpia, TestCase):
    databases = {'default', 'control'}

    def setUp(self):
        invalidar_resolver()
        self.rf = RequestFactory()
        _t('acme', 'Acme SA', 'acme.test')
        _t('beta', 'Beta SA', 'beta.test')
        _t('vieja', 'Vieja SA', 'vieja.test', activo=False)

    def _get(self, token=TOKEN):
        return empresas(self.rf.get('/control/empresas/', **({'HTTP_X_CONTROL_TOKEN': token} if token else {})))

    def test_catalogo_solo_activas_y_sin_secretos(self):
        resp = self._get()
        self.assertEqual(resp.status_code, 200)
        datos = json.loads(resp.content)
        self.assertEqual([e['slug'] for e in datos['empresas']], ['acme', 'beta'], 'la inactiva no aparece')
        self.assertEqual(datos['empresas'][0]['hosts'], ['acme.test'])
        self.assertNotIn('sso', resp.content.decode().lower(), 'nunca se exponen secretos')
        self.assertNotIn('db_password', resp.content.decode())

    def test_token_obligatorio(self):
        self.assertEqual(self._get(token='malo').status_code, 403)
        with override_settings(CONTROL_API_TOKEN=''):
            with self.assertRaises(Exception):  # Http404: sin token configurado no existe
                self._get()

    def _validar(self, cuerpo, token=TOKEN):
        req = self.rf.post('/control/validar/', data=json.dumps(cuerpo),
                           content_type='application/json', HTTP_X_CONTROL_TOKEN=token)
        return validar(req)

    def test_empresa_desconocida_o_inactiva(self):
        self.assertEqual(self._validar({'slug': 'nadie', 'usuario': 'u', 'password': 'p'}).status_code, 404)
        self.assertEqual(self._validar({'slug': 'vieja', 'usuario': 'u', 'password': 'p'}).status_code, 404)

    def test_valida_dentro_del_contexto_de_esa_empresa(self):
        """La autenticación corre en la BD de la empresa pedida, y el token sale
        firmado con SU secreto y con su slug dentro."""
        visto = {}

        class U:
            username, is_active = 'ana', True
            def get_full_name(self):
                return 'Ana P'

        def fake_auth(request, username=None, password=None):
            visto['tenant'] = get_current_tenant().slug
            visto['username'] = username
            return U()

        with mock.patch('tenants.control_api.authenticate', side_effect=fake_auth):
            resp = self._validar({'slug': 'beta', 'usuario': 'ana', 'password': 'p', 'remember': 1})
        self.assertEqual(visto['tenant'], 'beta', 'autenticó en la empresa pedida')
        datos = json.loads(resp.content)
        self.assertTrue(datos['ok'])
        from django.core import signing
        payload = signing.TimestampSigner(key='sso-beta', salt='crm-portal-sso').unsign_object(datos['token'])
        self.assertEqual(payload['t'], 'beta', 'el token lleva la empresa')
        self.assertEqual(payload['r'], 1)
        # Firmado con el secreto de beta: el de acme no lo valida.
        with self.assertRaises(signing.BadSignature):
            signing.TimestampSigner(key='sso-acme', salt='crm-portal-sso').unsign_object(datos['token'])
        self.assertIsNone(get_current_tenant(), 'el contexto se limpia')

    def test_credenciales_malas_no_dan_token(self):
        with mock.patch('tenants.control_api.authenticate', return_value=None):
            datos = json.loads(self._validar({'slug': 'acme', 'usuario': 'x', 'password': 'y'}).content)
        self.assertFalse(datos['ok'])
        self.assertNotIn('token', datos)

    def test_reset_exige_empresa(self):
        self.assertEqual(self._validar({'usuario': 'u', 'password': 'p'}).status_code, 404)
        req = self.rf.post('/control/reset/', data=json.dumps({'slug': 'nadie', 'usuario': 'u'}),
                           content_type='application/json', HTTP_X_CONTROL_TOKEN=TOKEN)
        self.assertEqual(reset(req).status_code, 404)


class MiddlewareControlTests(_Limpia, TestCase):
    databases = {'default', 'control'}

    def test_control_pasa_sin_resolver_empresa(self):
        """/control/ no pertenece a ninguna empresa: el middleware lo deja pasar
        aunque el Host sea desconocido (si no, el portal nunca podría llamarlo)."""
        visto = []
        mw = TenantMiddleware(lambda r: (visto.append(get_current_tenant()), HttpResponse('ok'))[1])
        resp = mw(RequestFactory().get('/control/empresas/', HTTP_HOST='portal.desconocido'))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(visto, [None], 'pasa sin tenant actual')
