"""
Tenant (empresa) actual del request/comando — en un contextvar, así funciona
igual con gunicorn gthread, asyncio y comandos de manage.py.

Regla: NUNCA hay un valor por defecto. Si no hay tenant, get_current_tenant()
devuelve None y es el router quien decide (en TENANT_MODE, rechaza el acceso a
la BD en vez de caer a otra empresa).

Ojo con los hilos: threading.Thread NO hereda contextvars. Todo trabajo en
background (hilos de correo, OCR, etc.) debe envolverse con bind_tenant().
"""
import contextvars
import functools

_tenant = contextvars.ContextVar('crm_tenant', default=None)


def get_current_tenant():
    return _tenant.get()


def set_current_tenant(tenant):
    """Fija el tenant y devuelve el token para reset_current_tenant()."""
    return _tenant.set(tenant)


def reset_current_tenant(token):
    _tenant.reset(token)


def current_alias():
    t = _tenant.get()
    return t.db_alias if t is not None else None


class tenant_context:
    """`with tenant_context(tenant): ...` — registra el alias de BD del tenant
    y lo deja como actual mientras dura el bloque (comandos, hilos, pruebas)."""

    def __init__(self, tenant):
        self.tenant = tenant
        self._token = None

    def __enter__(self):
        from .connections import ensure_alias
        ensure_alias(self.tenant)
        self._token = _tenant.set(self.tenant)
        return self.tenant

    def __exit__(self, *exc):
        _tenant.reset(self._token)
        return False


def bind_tenant(fn, tenant=None):
    """Envuelve `fn` para que corra con el tenant dado (o el actual) aunque se
    ejecute en OTRO hilo. Úsalo al crear threading.Thread(target=...)."""
    t = tenant if tenant is not None else _tenant.get()

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        if t is None:
            return fn(*args, **kwargs)
        with tenant_context(t):
            return fn(*args, **kwargs)
    return wrapper
