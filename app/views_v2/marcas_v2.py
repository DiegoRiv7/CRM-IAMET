"""
marcas_v2.py — Vistas de la sección "Marcas" del dashboard.

Catálogo de marcas (productos del distribuidor) con KPIs agregados:
facturado, pipeline (oportunidades $), # cotizaciones, # campañas, meta.

Sin modelo separado: las "marcas" son los valores de TodoItem.PRODUCTO_CHOICES
(ZEBRA, PANDUIT, APC, AVIGILON, GENETEC, AXIS, SOFTWARE, RUNRATE, PÓLIZA,
CISCO, SERVICIO). Cada marca tiene un display label y una categoría
informativa hardcoded — cuando se materialice un modelo Marca con metas por
marca/año, se reemplaza la lista por una query.

Endpoints:
    GET /app/api/marcas/resumen/   — todas las marcas + totales (para tabla y KPIs)
    GET /app/api/marcas/<key>/     — detalle de una marca + lista de oportunidades

Filtros:
    anio       — YYYY (default año actual)
    vendedores — CSV de user IDs (solo aplica si supervisor)

Visibilidad: misma lógica supervisor/equipo del resto del CRM.
"""
import logging
from collections import defaultdict
from decimal import Decimal

from django.contrib.auth.decorators import login_required
from django.db.models import Count, Q, Sum
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from app.models import Campana, Cotizacion, TodoItem
from app.views_utils import is_supervisor
from app.views_grupos import get_usuarios_visibles_ids

logger = logging.getLogger(__name__)


# Marcas del catálogo. `key` es el valor canónico del CharField producto;
# `match` es la lista de valores que entran (handles AVIGILON/AVIGILION,
# PÓLIZA/POLIZA, etc.); `cat` es solo informativa para el display.
MARCAS_CATALOGO = [
    {'key': 'ZEBRA',     'label': 'Zebra',    'match': ['ZEBRA'],                 'cat': 'Identificación & captura'},
    {'key': 'PANDUIT',   'label': 'Panduit',  'match': ['PANDUIT'],               'cat': 'Cableado estructurado'},
    {'key': 'APC',       'label': 'APC',      'match': ['APC'],                   'cat': 'Energía & UPS'},
    {'key': 'AVIGILON',  'label': 'Avigilon', 'match': ['AVIGILON', 'AVIGILION'], 'cat': 'Cámaras premium'},
    {'key': 'GENETEC',   'label': 'Genetec',  'match': ['GENETEC'],               'cat': 'Plataforma de seguridad'},
    {'key': 'AXIS',      'label': 'Axis',     'match': ['AXIS'],                  'cat': 'Cámaras premium'},
    {'key': 'SOFTWARE',  'label': 'Software', 'match': ['SOFTWARE', 'Desarrollo'], 'cat': 'Desarrollo & licencias'},
    {'key': 'RUNRATE',   'label': 'Runrate',  'match': ['RUNRATE'],               'cat': 'Recurrente'},
    {'key': 'POLIZA',    'label': 'Pólizas',  'match': ['PÓLIZA', 'POLIZA'],      'cat': 'Servicio & soporte'},
    {'key': 'CISCO',     'label': 'Cisco',    'match': ['CISCO'],                 'cat': 'Networking'},
    {'key': 'SERVICIO',  'label': 'Servicio', 'match': ['SERVICIO'],              'cat': 'Servicios profesionales'},
]

MARCA_KEY_BY_VALUE = {}
for _m in MARCAS_CATALOGO:
    for _v in _m['match']:
        MARCA_KEY_BY_VALUE[_v.upper()] = _m['key']


def _normalizar_marca(producto_raw):
    """Mapea un valor crudo del CharField `producto` → key canónica."""
    if not producto_raw:
        return None
    return MARCA_KEY_BY_VALUE.get(str(producto_raw).upper())


def _filtros_visibilidad(user):
    """Retorna un Q() que limita TodoItem por visibilidad del user."""
    if is_supervisor(user):
        return Q()
    visibles = get_usuarios_visibles_ids(user)
    if visibles is None:
        return Q()
    return Q(usuario_id__in=visibles)


def _aplicar_vendedores(qs, request, es_super):
    """Si supervisor y vino `vendedores` CSV, filtra. Si no supervisor, ignora."""
    if not es_super:
        return qs
    vf = (request.GET.get('vendedores') or '').strip()
    if not vf or vf.lower() == 'todos':
        return qs
    ids = [int(x) for x in vf.split(',') if x.strip().isdigit()]
    if ids:
        qs = qs.filter(usuario_id__in=ids)
    return qs


def _parse_anio(request):
    val = (request.GET.get('anio') or '').strip()
    if val and val.lower() != 'todos':
        try:
            return int(val)
        except (ValueError, TypeError):
            pass
    return timezone.localdate().year


@login_required
@require_http_methods(["GET"])
def api_marcas_resumen(request):
    """
    Resumen de TODAS las marcas + totales globales.

    Respuesta:
        {
            ok: true,
            anio: 2026,
            marcas: [
                {
                    key, label, cat,
                    facturado, pipeline, ops_count,
                    cotizaciones, campanias,
                    meta, avance, gap,
                    ops: []     # vacío aquí; el detalle trae las ops completas
                }, ...
            ],
            totals: { facturado, pipeline, cotizaciones, campanias, meta, gap }
        }
    """
    try:
        user = request.user
        anio = _parse_anio(request)
        es_super = is_supervisor(user)

        # --- TodoItem base (oportunidades del año, visibles, filtradas) ----
        opp_qs = TodoItem.objects.filter(_filtros_visibilidad(user)).filter(
            anio_cierre=anio,
        )
        opp_qs = _aplicar_vendedores(opp_qs, request, es_super)

        # Agregado por producto crudo, luego mapeamos a key canónica.
        agg = (
            opp_qs.values('producto')
            .annotate(
                fact_sum=Sum('monto_facturacion'),
                pipe_sum=Sum('monto'),
                ops_count=Count('id'),
            )
        )
        por_marca = defaultdict(lambda: {
            'facturado': Decimal('0'),
            'pipeline': Decimal('0'),
            'ops_count': 0,
        })
        for r in agg:
            key = _normalizar_marca(r['producto'])
            if not key:
                continue
            por_marca[key]['facturado'] += (r['fact_sum'] or Decimal('0'))
            por_marca[key]['pipeline']  += (r['pipe_sum'] or Decimal('0'))
            por_marca[key]['ops_count'] += int(r['ops_count'] or 0)

        # --- Cotizaciones (vía oportunidad.producto) -----------------------
        cot_counts = defaultdict(int)
        cot_qs = (
            Cotizacion.objects
            .select_related('oportunidad')
            .filter(oportunidad__in=opp_qs)
        )
        for c in cot_qs.values('oportunidad__producto').annotate(n=Count('id')):
            key = _normalizar_marca(c['oportunidad__producto'])
            if key:
                cot_counts[key] += int(c['n'] or 0)

        # --- Campañas (por producto en el modelo Campana) ------------------
        cam_counts = defaultdict(int)
        try:
            cam_qs = Campana.objects.filter(
                estado__in=['programada', 'enviando', 'enviada']
            )
            if hasattr(Campana, 'creado_por'):
                # Para no-supervisores, contamos solo las suyas (Campana no tiene
                # FK a Cliente/Opp con quien filtrar visibilidad). Conservador.
                if not es_super:
                    cam_qs = cam_qs.filter(creado_por=user)
            for c in cam_qs.values('producto').annotate(n=Count('id')):
                key = _normalizar_marca(c['producto'])
                if key:
                    cam_counts[key] += int(c['n'] or 0)
        except Exception:
            logger.exception('marcas: error contando campañas')

        # --- Armar respuesta -----------------------------------------------
        marcas_out = []
        for m in MARCAS_CATALOGO:
            d = por_marca.get(m['key'], {})
            facturado = float(d.get('facturado') or 0)
            pipeline  = float(d.get('pipeline') or 0)
            ops_count = int(d.get('ops_count') or 0)
            cotizaciones = int(cot_counts.get(m['key'], 0))
            campanias    = int(cam_counts.get(m['key'], 0))
            # Meta no está modelada por marca todavía → 0 (UI muestra "Sin meta").
            meta = 0.0
            avance = (facturado / meta) if meta else 0
            gap = facturado - meta
            marcas_out.append({
                'key': m['key'],
                'label': m['label'],
                'cat': m['cat'],
                'facturado': facturado,
                'pipeline': pipeline,
                'ops_count': ops_count,
                'cotizaciones': cotizaciones,
                'campanias': campanias,
                'meta': meta,
                'avance': avance,
                'gap': gap,
            })

        totals = {
            'facturado': sum(x['facturado'] for x in marcas_out),
            'pipeline': sum(x['pipeline'] for x in marcas_out),
            'cotizaciones': sum(x['cotizaciones'] for x in marcas_out),
            'campanias': sum(x['campanias'] for x in marcas_out),
            'meta': sum(x['meta'] for x in marcas_out),
        }
        totals['gap'] = totals['facturado'] - totals['meta']

        return JsonResponse({
            'ok': True,
            'anio': anio,
            'marcas': marcas_out,
            'totals': totals,
        })
    except Exception as e:
        logger.exception('api_marcas_resumen failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["GET"])
def api_marca_detalle(request, marca_key):
    """
    Detalle de UNA marca: KPIs + lista completa de oportunidades del año.

    Cada oportunidad trae cliente, descripción, monto, mes_cierre, probabilidad.
    """
    try:
        user = request.user
        anio = _parse_anio(request)
        es_super = is_supervisor(user)
        key_up = (marca_key or '').upper()

        marca = next((m for m in MARCAS_CATALOGO if m['key'] == key_up), None)
        if not marca:
            return JsonResponse({'ok': False, 'error': 'Marca no encontrada'}, status=404)

        opp_qs = TodoItem.objects.filter(_filtros_visibilidad(user)).filter(
            anio_cierre=anio,
            producto__in=marca['match'],
        ).select_related('cliente')
        opp_qs = _aplicar_vendedores(opp_qs, request, es_super)

        ops = []
        facturado = Decimal('0')
        pipeline  = Decimal('0')
        for o in opp_qs:
            mes = int(o.mes_cierre) if o.mes_cierre else 0
            monto = float(o.monto or 0)
            prob = int(o.probabilidad_cierre or 0)
            ops.append({
                'id': o.id,
                # Cliente.nombre_empresa, no .nombre
                'cliente': (o.cliente.nombre_empresa if o.cliente_id else ''),
                'oportunidad': o.oportunidad or '',
                'monto': monto,
                'mes': mes,
                'prob': prob,
                'etapa': o.etapa_corta or '',
                'po': (o.po_number or '').strip(),
            })
            facturado += (o.monto_facturacion or Decimal('0'))
            pipeline += (o.monto or Decimal('0'))

        # Cotizaciones y campañas (mismas funciones que el resumen, en chico)
        cot_count = (
            Cotizacion.objects
            .filter(oportunidad__in=opp_qs)
            .count()
        )
        cam_count = 0
        try:
            cam_qs = Campana.objects.filter(
                estado__in=['programada', 'enviando', 'enviada'],
                producto__in=marca['match'],
            )
            if not es_super and hasattr(Campana, 'creado_por'):
                cam_qs = cam_qs.filter(creado_por=user)
            cam_count = cam_qs.count()
        except Exception:
            logger.exception('marca_detalle: error contando campañas')

        meta = 0.0
        avance = (float(facturado) / meta) if meta else 0
        gap = float(facturado) - meta

        return JsonResponse({
            'ok': True,
            'anio': anio,
            'marca': {
                'key': marca['key'],
                'label': marca['label'],
                'cat': marca['cat'],
                'facturado': float(facturado),
                'pipeline': float(pipeline),
                'ops_count': len(ops),
                'cotizaciones': cot_count,
                'campanias': cam_count,
                'meta': meta,
                'avance': avance,
                'gap': gap,
            },
            'ops': sorted(ops, key=lambda x: -x['monto']),
        })
    except Exception as e:
        logger.exception('api_marca_detalle failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)
