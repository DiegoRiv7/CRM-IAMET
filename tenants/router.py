"""
Router de BD del modo bridge.

  - Los modelos de `tenants` (el registro de empresas) SIEMPRE van a `control`.
  - Todo lo demás va a la BD del tenant actual (`t_<slug>`).
  - Sin tenant actual y con TENANT_MODE encendido: se RECHAZA el acceso. Nunca
    se cae a `default` ni a otra empresa: un fallo de resolución debe ser un
    error visible, no una pantalla con los datos de la empresa equivocada.
  - `default` no recibe migraciones en modo tenant: las tablas de la app solo
    existen en las bases `t_*`; `control` solo tiene las tablas de `tenants`.
"""
from django.conf import settings

from .context import get_current_tenant

CONTROL_ALIAS = 'control'
CONTROL_APPS = frozenset({'tenants'})


class TenantNotResolved(RuntimeError):
    """Se intentó tocar la BD sin tenant resuelto (falta el middleware o un tenant_context)."""


def _modo_tenant():
    return bool(getattr(settings, 'TENANT_MODE', False))


class TenantRouter:
    def _alias_tenant(self):
        tenant = get_current_tenant()
        if tenant is None:
            if _modo_tenant():
                raise TenantNotResolved(
                    'Acceso a la base de datos sin empresa resuelta '
                    '(¿falta TenantMiddleware o un tenant_context en el comando/hilo?)'
                )
            return None  # modo clásico: `default`
        from .connections import ensure_alias
        return ensure_alias(tenant)

    def db_for_read(self, model, **hints):
        if model._meta.app_label in CONTROL_APPS:
            return CONTROL_ALIAS
        return self._alias_tenant()

    def db_for_write(self, model, **hints):
        if model._meta.app_label in CONTROL_APPS:
            return CONTROL_ALIAS
        return self._alias_tenant()

    def allow_relation(self, obj1, obj2, **hints):
        # Solo relaciones dentro de la misma base (objetos sin guardar: None == None).
        return obj1._state.db == obj2._state.db

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if app_label in CONTROL_APPS:
            return db == CONTROL_ALIAS
        if db == CONTROL_ALIAS:
            return False
        if _modo_tenant():
            return db.startswith('t_')
        return True
