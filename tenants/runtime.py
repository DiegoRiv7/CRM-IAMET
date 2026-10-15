"""
Helpers para que el código de la app funcione igual en modo clásico (IAMET,
una sola BD `default`) y en modo bridge (una app, una BD por empresa), sin
saber en cuál está:

  conexion()        → conexión de BD para SQL crudo (reemplaza django.db.connection)
  prefijo_cache(k)  → llave de django.core.cache con prefijo del tenant
  mail_key()        → llave Fernet del correo de ESTA empresa
  sso_secret()      → secreto del SSO del portal de ESTA empresa
  modo_tenant()     → True si TENANT_MODE está encendido

En modo clásico todo cae a settings/env como siempre.
"""
import os

from django.conf import settings
from django.db import connections

from .context import current_alias, get_current_tenant


def modo_tenant():
    return bool(getattr(settings, 'TENANT_MODE', False))


def alias_bd():
    """Alias de BD para SQL crudo: el del tenant actual, o `default` (clásico)."""
    return current_alias() or 'default'


def conexion():
    """Conexión correcta para `with conexion().cursor() as c:`. En bridge,
    `django.db.connection` apunta a control y NO sirve: usar esto."""
    return connections[alias_bd()]


def prefijo_cache(clave):
    """Prefija una llave de caché compartida (Redis/locmem) con el tenant, para
    que dos empresas nunca lean el mismo valor."""
    t = get_current_tenant()
    return f'{t.db_alias}|{clave}' if t is not None else clave


def _secreto(campo, fallback):
    t = get_current_tenant()
    if t is not None:
        return (getattr(t, campo, '') or '').strip()
    return (fallback or '').strip()


def mail_key():
    """Llave Fernet de las contraseñas de buzones: por empresa en bridge
    (Tenant.mail_encryption_key); settings.MAIL_ENCRYPTION_KEY en clásico."""
    return _secreto('mail_encryption_key', getattr(settings, 'MAIL_ENCRYPTION_KEY', ''))


def sso_secret():
    """Secreto del inicio de sesión desde el portal: por empresa en bridge;
    la variable PORTAL_SSO_SECRET en clásico (vacía en IAMET = SSO apagado)."""
    return _secreto('portal_sso_secret', os.environ.get('PORTAL_SSO_SECRET', ''))
