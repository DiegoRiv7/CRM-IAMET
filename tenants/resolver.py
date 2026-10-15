"""
hostname → Tenant, leyendo la BD de control (el router manda `tenants` a
`control` SIEMPRE, también cuando todavía no hay tenant resuelto).

Caché corta por proceso para no pegarle a control en cada request. También se
cachea el "no existe" (None): limita el costo de los escaneos de hosts al azar.
"""
import threading
import time

_TTL = 30  # segundos
_cache = {}  # hostname → (expira, Tenant | None)
_lock = threading.Lock()


def normalizar_host(host):
    return (host or '').split(':')[0].strip().lower().rstrip('.')


def por_host(host):
    """Tenant ACTIVO para ese hostname, o None. Nunca cae a otra empresa."""
    from .models import TenantHost

    h = normalizar_host(host)
    if not h:
        return None
    ahora = time.monotonic()
    hit = _cache.get(h)
    if hit and hit[0] > ahora:
        return hit[1]
    try:
        th = TenantHost.objects.select_related('tenant').get(hostname=h)
        tenant = th.tenant if th.tenant.activo else None
    except TenantHost.DoesNotExist:
        tenant = None
    with _lock:
        _cache[h] = (ahora + _TTL, tenant)
    return tenant


def por_slug(slug):
    from .models import Tenant
    return Tenant.objects.get(slug=slug)


def invalidar_resolver():
    with _lock:
        _cache.clear()
