"""
MULTIEMPRESA — helpers de la empresa dueña de esta instancia.

Cada empresa corre en su propia base de datos (ver PLAN_MULTIEMPRESA.md), así
que aquí no hay "tenant" por request: solo un singleton `EmpresaConfig` y los
catálogos `OpcionCatalogo`, cacheados en memoria del proceso por unos segundos
para no pegarle a la BD en cada request (gunicorn gthread → cache por worker;
por eso el TTL es corto y además se invalida al guardar desde este proceso).

API pública (importar desde aquí, no tocar los modelos directo):
    empresa_config()            → EmpresaConfig (singleton)
    modulos()                   → dict {'chat_web': bool, ...}
    modulo_habilitado('x')      → bool
    modulo_activo('x')          → decorador para vistas (404 si está apagado)
    catalogo('producto')        → lista de OpcionCatalogo activas (ordenadas)
    choices_catalogo('producto')→ [(valor, etiqueta), ...]
    etiqueta_catalogo(tipo, v)  → etiqueta visible de un valor guardado
    valores_validos(tipo)       → set de valores aceptados (con alias)
    valor_default_catalogo(tipo)→ valor por defecto ('' si no hay)
    columnas_producto()         → columnas de la tabla del CRM
    invalidar_cache()
"""
import logging
import time
from functools import wraps

from django.db.utils import OperationalError, ProgrammingError
from django.http import Http404, JsonResponse

logger = logging.getLogger(__name__)

_TTL = 30  # segundos
_cache = {}  # clave → (expira, valor)


def _get(clave, loader):
    ahora = time.monotonic()
    hit = _cache.get(clave)
    if hit and hit[0] > ahora:
        return hit[1]
    valor = loader()
    _cache[clave] = (ahora + _TTL, valor)
    return valor


def invalidar_cache():
    _cache.clear()


# ── Empresa ─────────────────────────────────────────────────────────────
def _config_fallback():
    """Config en memoria cuando la tabla aún no existe (migraciones pendientes)."""
    from .models import EmpresaConfig
    cfg = EmpresaConfig(pk=1, slug='iamet', nombre='IAMET', nombre_corto='IAMET')
    cfg._fallback = True
    return cfg


def empresa_config():
    from .models import EmpresaConfig

    def loader():
        try:
            return EmpresaConfig.get_singleton()
        except (OperationalError, ProgrammingError):
            logger.warning('EmpresaConfig no disponible (¿migración 0224 pendiente?)')
            return _config_fallback()
    return _get('empresa', loader)


def modulos():
    cfg = empresa_config()
    m = cfg.modulos()
    if getattr(cfg, '_fallback', False):
        # Sin tabla todavía (migración pendiente): comportamiento de siempre.
        m = {k: True for k in m}
    return m


def modulo_habilitado(nombre):
    return bool(modulos().get(nombre, False))


def modulo_activo(nombre):
    """Decorador: si el módulo está apagado para esta empresa, la vista no
    existe (404). Para rutas /api/ responde JSON para que el front no truene."""
    def deco(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            if not modulo_habilitado(nombre):
                if request.path.startswith('/app/api/') or request.headers.get('x-requested-with') == 'XMLHttpRequest':
                    return JsonResponse(
                        {'ok': False, 'success': False, 'error': f'Módulo "{nombre}" desactivado para esta empresa'},
                        status=404,
                    )
                raise Http404('Módulo desactivado para esta empresa')
            return view(request, *args, **kwargs)
        return wrapper
    return deco


# ── Catálogos ────────────────────────────────────────────────────────────
# Semillas de respaldo (las listas fijas históricas de IAMET) — solo se usan
# para etiquetar valores viejos si el catálogo está vacío.
def _legacy(tipo):
    from .models import DetalleCotizacion, TodoItem
    return {
        'producto': TodoItem.PRODUCTO_CHOICES,
        'area': TodoItem.AREA_CHOICES,
        'marca': DetalleCotizacion.MARCA_CHOICES,
    }.get(tipo, [])


def catalogo(tipo, solo_activos=True):
    from .models import OpcionCatalogo

    def loader():
        try:
            return list(OpcionCatalogo.objects.filter(tipo=tipo).order_by('orden', 'etiqueta'))
        except (OperationalError, ProgrammingError):
            return []
    todos = _get(f'cat:{tipo}', loader)
    return [o for o in todos if o.activo] if solo_activos else todos


def choices_catalogo(tipo, incluir_vacio=None):
    """[(valor, etiqueta)] para <select>/ChoiceField. Si el catálogo está vacío
    cae a la lista fija histórica para no dejar formularios sin opciones."""
    ops = [(o.valor, o.etiqueta) for o in catalogo(tipo)]
    if not ops:
        ops = list(_legacy(tipo))
    if incluir_vacio is not None:
        ops = [('', incluir_vacio)] + ops
    return ops


def _indice(tipo):
    """{valor_o_alias (upper) → etiqueta} incluyendo inactivos (para registros viejos)."""
    def loader():
        idx = {}
        for o in catalogo(tipo, solo_activos=False):
            for v in o.valores:
                idx.setdefault(v.upper(), o.etiqueta)
        for v, e in _legacy(tipo):
            idx.setdefault(str(v).upper(), e)
        return idx
    return _get(f'idx:{tipo}', loader)


def etiqueta_catalogo(tipo, valor):
    if not valor:
        return ''
    return _indice(tipo).get(str(valor).upper(), valor)


def valores_validos(tipo):
    """Valores aceptados al guardar (clave + alias de opciones ACTIVAS)."""
    vals = set()
    for o in catalogo(tipo):
        vals.update(v.upper() for v in o.valores)
    if not vals:
        vals = {str(v).upper() for v, _ in _legacy(tipo)}
    return vals


def normalizar_valor(tipo, valor):
    """Devuelve la clave canónica del catálogo para un valor/alias (o el valor
    tal cual si no se reconoce). Útil al importar/validar."""
    if not valor:
        return valor
    v = str(valor).strip()
    vu = v.upper()
    for o in catalogo(tipo, solo_activos=False):
        if vu in {x.upper() for x in o.valores}:
            return o.valor
    return v


def valor_default_catalogo(tipo):
    for o in catalogo(tipo):
        if o.es_default:
            return o.valor
    return ''


def columnas_producto():
    """Columnas de producto de la tabla principal del CRM: productos activos
    marcados `es_columna`. Cada una trae los valores (clave + alias) que caen
    en esa columna; lo que no cae en ninguna va a "Otros"."""
    cols = []
    for o in catalogo('producto'):
        if o.es_columna:
            cols.append({
                'valor': o.valor,
                'etiqueta': o.etiqueta,
                'corta': o.etiqueta_corta or o.etiqueta[:6],
                'valores': [v.upper() for v in o.valores],
                'color': o.color,
            })
    return cols


def valores_en_columnas():
    vals = set()
    for c in columnas_producto():
        vals.update(c['valores'])
    return vals
