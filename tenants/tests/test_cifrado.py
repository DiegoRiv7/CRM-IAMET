"""
#3 — Cifrado EN REPOSO de los secretos de empresa.

Lo que se prueba: que un volcado de la BD de control NO entregue credenciales,
que el código siga leyendo los secretos sin enterarse, que los valores viejos
en claro sigan funcionando, y que una llave equivocada o ausente falle
ruidosamente en vez de devolver basura.
"""
from unittest import mock

from cryptography.fernet import Fernet
from django.core.exceptions import ImproperlyConfigured
from django.db import connections
from django.test import TestCase, override_settings

from tenants.cifrado import PREFIJO, cifrar, descifrar
from tenants.models import Tenant

LLAVE = Fernet.generate_key().decode()
OTRA = Fernet.generate_key().decode()


def _crudo(tid, campo):
    """Lee la columna SIN pasar por el campo (como lo vería un volcado)."""
    alias = Tenant.objects.db
    with connections[alias].cursor() as cur:
        cur.execute(f'SELECT {campo} FROM tenants_tenant WHERE id = %s', [tid])
        return (cur.fetchone() or [None])[0]


@override_settings(TENANT_SECRETS_KEY=LLAVE)
class CifradoTests(TestCase):
    databases = {'default', 'control'}

    def test_un_volcado_no_entrega_credenciales(self):
        t = Tenant.objects.create(slug='acme', nombre='Acme', db_name='crm_acme', db_user='u_acme',
                                  db_password='contrasena-secreta', portal_sso_secret='sso-secreto',
                                  mail_encryption_key='llave-correo')
        for campo, claro in (('db_password', 'contrasena-secreta'),
                             ('portal_sso_secret', 'sso-secreto'),
                             ('mail_encryption_key', 'llave-correo')):
            guardado = _crudo(t.id, campo)
            self.assertTrue(guardado.startswith(PREFIJO), f'{campo} debe guardarse cifrado')
            self.assertNotIn(claro, guardado, f'{campo}: el secreto NO debe verse en la columna')

    def test_el_codigo_los_lee_sin_enterarse(self):
        Tenant.objects.create(slug='acme', nombre='Acme', db_name='crm_acme', db_user='u_acme',
                              db_password='pw-1', portal_sso_secret='sso-1', mail_encryption_key='mk-1')
        t = Tenant.objects.get(slug='acme')
        self.assertEqual((t.db_password, t.portal_sso_secret, t.mail_encryption_key), ('pw-1', 'sso-1', 'mk-1'))
        # …y la conexión que se arma con eso sigue llevando la contraseña real.
        self.assertEqual(t.db_config()['PASSWORD'], 'pw-1')

    def test_valores_viejos_en_claro_siguen_funcionando(self):
        """Las empresas dadas de alta antes del cifrado no se rompen."""
        t = Tenant.objects.create(slug='vieja', nombre='Vieja', db_name='crm_vieja', db_user='u_vieja',
                                  db_password='x')
        alias = Tenant.objects.db
        with connections[alias].cursor() as cur:  # simular fila legado, en claro
            cur.execute('UPDATE tenants_tenant SET db_password = %s WHERE id = %s', ['en-claro', t.id])
        self.assertEqual(Tenant.objects.get(pk=t.id).db_password, 'en-claro')

    def test_cifrar_es_idempotente_y_no_determinista(self):
        a, b = cifrar('mismo'), cifrar('mismo')
        self.assertNotEqual(a, b, 'dos cifrados del mismo valor no deben ser iguales')
        self.assertEqual(descifrar(a), descifrar(b), 'pero ambos abren al mismo secreto')
        self.assertEqual(cifrar(a), a, 'volver a cifrar algo ya cifrado no lo anida')
        self.assertEqual(cifrar(''), '')
        self.assertIsNone(cifrar(None))

    def test_llave_equivocada_falla_ruidosamente(self):
        valor = cifrar('secreto')
        with override_settings(TENANT_SECRETS_KEY=OTRA):
            with self.assertRaises(ImproperlyConfigured):
                descifrar(valor)

    def test_sin_llave_pero_con_datos_cifrados_falla_ruidosamente(self):
        """Devolver basura haría que la empresa 'no conecte' sin decir por qué."""
        valor = cifrar('secreto')
        with override_settings(TENANT_SECRETS_KEY=''):
            with self.assertRaises(ImproperlyConfigured):
                descifrar(valor)

    def test_llave_mal_formada_avisa_como_configurar(self):
        with override_settings(TENANT_SECRETS_KEY='no-soy-una-llave'):
            with self.assertRaises(ImproperlyConfigured):
                cifrar('algo')


class SinLlaveTests(TestCase):
    """Sin llave configurada (desarrollo) todo sigue funcionando en claro."""
    databases = {'default', 'control'}

    @override_settings(TENANT_SECRETS_KEY='')
    def test_sin_llave_guarda_en_claro_y_no_truena(self):
        t = Tenant.objects.create(slug='dev', nombre='Dev', db_name='crm_dev', db_user='u_dev',
                                  db_password='pw-dev')
        self.assertEqual(_crudo(t.id, 'db_password'), 'pw-dev')
        self.assertEqual(Tenant.objects.get(slug='dev').db_password, 'pw-dev')
