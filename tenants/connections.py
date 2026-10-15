"""
Alias de BD por tenant, registrados en caliente.

Django construye `connections` a partir de settings.DATABASES al arrancar, pero
el diccionario `connections.databases` se puede ampliar en tiempo de ejecución
(es lo que hacen django-tenants y similares). Aquí cada empresa recibe el alias
`t_<slug>` la primera vez que se la resuelve; las conexiones reales siguen
siendo por hilo (ConnectionHandler es thread-local), solo la configuración es
compartida, por eso basta un candado al registrar.
"""
import threading

from django.db import connections

_lock = threading.Lock()


def ensure_alias(tenant):
    """Garantiza que connections.databases tenga el alias del tenant y lo devuelve."""
    alias = tenant.db_alias
    if alias not in connections.databases:
        with _lock:
            if alias not in connections.databases:
                connections.databases[alias] = tenant.db_config()
    return alias


def cerrar_alias(alias):
    """Cierra la conexión de este hilo para ese alias (comandos largos, workers)."""
    try:
        connections[alias].close()
    except Exception:
        pass


def olvidar_alias(alias):
    """Quita el alias del proceso (baja de una empresa, pruebas): cierra la
    conexión de este hilo y borra su configuración. Idempotente."""
    cerrar_alias(alias)
    try:
        del connections[alias]  # descarta el objeto de conexión de este hilo
    except Exception:
        pass
    with _lock:
        connections.databases.pop(alias, None)
