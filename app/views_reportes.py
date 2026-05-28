"""Módulo Reportes — vistas de la sección /app/reportes/.

Catálogo de reportes "canned" (preconstruidos) que los jefes y vendedores
pueden consultar para entender el estado del negocio. Sin AI: queries
directas a la BD + render nativo.

Estructura general:
- /app/reportes/                         → landing con grilla de reportes
- /app/reportes/<slug>/                  → vista del reporte
- /app/api/reportes/<slug>/              → JSON con los datos
- /app/api/reportes/<slug>/export-excel/ → XLSX descargable

Cada reporte tiene su propio handler en este archivo. La biblioteca crece
agregando entradas a REPORTES_CATALOGO + las funciones correspondientes.
"""
from datetime import datetime
from decimal import Decimal

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.db.models import Q, Sum
from django.http import JsonResponse
from django.shortcuts import render, redirect
from django.utils import timezone

from .models import (
    TodoItem, EtapaPipeline, ArchivoOportunidad, Tarea, Actividad,
)
from .views_grupos import get_usuarios_visibles_ids
from .views_utils import is_supervisor, is_administrador


def _sidebar_context(request):
    """Variables que el partial _sidebar.html espera. Se reusan en todas las
    páginas que lo incluyen (crm_home las llena por su cuenta; aquí las
    rellenamos para que el sidebar no truene en /app/reportes/)."""
    user = request.user
    profile = getattr(user, 'userprofile', None)
    now = datetime.now()
    return {
        'usuario': user,
        'es_supervisor': is_supervisor(user),
        'es_administrador': is_administrador(user),
        'es_ingeniero': (getattr(profile, 'rol', 'vendedor') == 'ingeniero') if profile else False,
        'mis_grupos': [],  # no aplica aquí — sidebar lo usa solo para mostrar Grupo
        'mes_filter': str(now.month).zfill(2),
        'anio_filter': str(now.year),
    }


# ─── Catálogo de reportes disponibles ───────────────────────────────────────

REPORTES_CATALOGO = [
    {
        'slug': 'oportunidades-abiertas',
        'titulo': 'Oportunidades Abiertas',
        'descripcion': (
            'Oportunidades en estado "Vendido en adelante" que aún no están '
            'cerradas. Útil para revisar qué falta para facturar o cobrar.'
        ),
        'icono': 'inbox',
        'color': '#0052D4',
    },
    {
        'slug': 'oportunidades-cerradas',
        'titulo': 'Oportunidades Cerradas',
        'descripcion': (
            'Ganadas y perdidas en un periodo. Muestra el % de cierre, '
            'ticket promedio y comparativo por vendedor.'
        ),
        'icono': 'check-circle',
        'color': '#059669',
    },
    {
        'slug': 'clientes',
        'titulo': 'Cómo Vamos por Cliente',
        'descripcion': (
            'Una fila por cliente: # de oportunidades abiertas / ganadas / '
            'perdidas, monto total ganado, último contacto y próxima '
            'actividad. Para ver con quién hay que insistir.'
        ),
        'icono': 'building',
        'color': '#7C3AED',
    },
]

REPORTES_BY_SLUG = {r['slug']: r for r in REPORTES_CATALOGO}


# ─── Vistas ─────────────────────────────────────────────────────────────────

@login_required
def reportes_index(request):
    """Landing del módulo Reportes — redirige al primer reporte (Abiertas).

    El landing como grilla intermedia de cards (versión inicial) se eliminó
    a favor de mostrar directo el reporte principal con sus tabs visibles
    en el header — el usuario alterna entre los 3 reportes sin pasos
    extra. La grilla puede volver más adelante si la biblioteca crece.
    """
    return redirect('/app/reportes/oportunidades-abiertas/')


@login_required
def reporte_detalle(request, slug):
    """Vista de un reporte individual. Despacha por slug.

    Además de las variables del sidebar, pasa las que necesita el widget de
    oportunidad (incluido en la página para abrir opps inline sin navegar al
    CRM): etapas_pipeline_json para _CRM_CONFIG, y campos placeholder para
    los filtros de mes/anio/vendedor que crm_main.js espera.
    """
    from .views_crm import _get_etapas_pipeline_json
    reporte = REPORTES_BY_SLUG.get(slug)
    ctx = _sidebar_context(request)
    ctx.update({
        'etapas_pipeline_json': _get_etapas_pipeline_json(),
        'vendedores_filter': '',
    })
    if not reporte:
        ctx.update({'slug': slug, 'tab_activo': 'reportes'})
        return render(request, 'reportes/no_encontrado.html', ctx, status=404)
    ctx.update({'reporte': reporte, 'tab_activo': 'reportes'})
    template = f'reportes/{slug.replace("-", "_")}.html'
    return render(request, template, ctx)


# ═══════════════════════════════════════════════════════════════════════════
# REPORTE 1: Oportunidades Abiertas (Vendido en adelante, sin cerrar)
# ═══════════════════════════════════════════════════════════════════════════

_ETAPAS_TERMINALES = {'ganada', 'pagada', 'perdida', 'cerrada'}


def _etapas_vendido_en_adelante():
    """Resuelve dinámicamente qué etapas cuentan como 'Vendido en adelante'
    en cada pipeline (runrate + proyecto). Lee EtapaPipeline, ubica la
    etapa cuyo nombre empieza con 'Vendido' y toma todas las posteriores,
    excluyendo las terminales (Ganada/Pagada/Perdida/Cerrada).

    Retorna: { 'runrate': [nombres...], 'proyecto': [nombres...] }
    """
    out = {}
    for pl in ('runrate', 'proyecto'):
        etapas_pl = list(
            EtapaPipeline.objects.filter(pipeline=pl, activo=True)
            .order_by('orden')
            .values('nombre', 'orden')
        )
        if not etapas_pl:
            continue
        vendido_orden = None
        for e in etapas_pl:
            if (e['nombre'] or '').strip().lower().startswith('vendido'):
                vendido_orden = e['orden']
                break
        if vendido_orden is None:
            continue
        incluidas = [
            e['nombre'] for e in etapas_pl
            if e['orden'] >= vendido_orden
            and (e['nombre'] or '').strip().lower() not in _ETAPAS_TERMINALES
        ]
        if incluidas:
            out[pl] = incluidas
    return out


def _money(v):
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


_MES_NOMBRES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']


def _fmt_fecha_cierre(mes_cierre, anio_cierre):
    """'05' + 2026 → '15 May 2026'. Sin día específico — usamos día 15."""
    try:
        m = int(mes_cierre)
        if 1 <= m <= 12:
            return f'15 {_MES_NOMBRES[m]} {anio_cierre}'
    except (TypeError, ValueError):
        pass
    return ''


@login_required
def api_reporte_oportunidades_abiertas(request):
    """GET /app/api/reportes/oportunidades-abiertas/

    Query params (filtros opcionales):
        pipeline=runrate|proyecto    (sin valor → ambos)
        vendedor=<user_id>           (sin valor → todos los visibles)
        etapa=<nombre>               (sin valor → todas las "Vendido en adelante")
        producto=<nombre>               (filtra por proveedor/producto)
        monto_min=<int>              (monto mínimo)
        q=<texto>                    (busca en título y nombre de cliente)

    Devuelve JSON flat (lista de opps + KPIs + filtros disponibles).
    El agrupado por pipeline/etapa lo hace el frontend si quiere.
    """
    user = request.user
    qp = request.GET

    etapas_map = _etapas_vendido_en_adelante()
    if not etapas_map:
        return JsonResponse({
            'ok': True,
            'oportunidades': [],
            'kpis': _kpis_vacio(),
            'filtros_disponibles': {'vendedores': [], 'etapas_por_pipeline': {}, 'productos': []},
            'nota': 'No se encontraron etapas "Vendido en adelante" configuradas.',
        })

    # ── Filtros ─────────────────────────────────────────────────────
    pipeline_arg = (qp.get('pipeline') or '').strip().lower()
    if pipeline_arg in ('runrate', 'proyecto'):
        pipelines_objetivo = [pipeline_arg]
    else:
        pipelines_objetivo = list(etapas_map.keys())

    etapa_filter = (qp.get('etapa') or '').strip()
    producto_filter = (qp.get('producto') or '').strip()
    q_text = (qp.get('q') or '').strip()

    vendedor_id = None
    if qp.get('vendedor'):
        try:
            vendedor_id = int(qp.get('vendedor'))
        except (TypeError, ValueError):
            vendedor_id = None

    monto_min = None
    if qp.get('monto_min'):
        try:
            monto_min = float(qp.get('monto_min'))
        except (TypeError, ValueError):
            monto_min = None

    # ── Query base con filtros de etapa por pipeline ────────────────
    pipeline_filter = Q()
    for pl in pipelines_objetivo:
        etapas = etapas_map.get(pl, [])
        if etapa_filter:
            etapas = [e for e in etapas if e == etapa_filter]
        if etapas:
            pipeline_filter |= Q(tipo_negociacion=pl, etapa_corta__in=etapas)

    if not pipeline_filter:
        return JsonResponse({
            'ok': True,
            'oportunidades': [],
            'kpis': _kpis_vacio(),
            'filtros_disponibles': _filtros_disponibles(user, etapas_map),
        })

    qs = TodoItem.objects.filter(pipeline_filter).select_related('cliente', 'usuario')

    # Visibilidad (mismo criterio que el resto del CRM)
    visible_ids = get_usuarios_visibles_ids(user)
    if visible_ids:
        qs = qs.filter(usuario_id__in=visible_ids)

    if vendedor_id:
        qs = qs.filter(usuario_id=vendedor_id)

    if producto_filter:
        qs = qs.filter(producto=producto_filter)

    if monto_min is not None:
        qs = qs.filter(monto__gte=monto_min)

    if q_text:
        qs = qs.filter(
            Q(oportunidad__icontains=q_text) |
            Q(cliente__nombre_empresa__icontains=q_text)
        )

    qs = qs.order_by('-monto')
    opps = list(qs)

    # ── Prefetch en bulk ────────────────────────────────────────────
    opp_ids = [o.id for o in opps]
    archivos_por_opp = {}
    for a in ArchivoOportunidad.objects.filter(
        oportunidad_id__in=opp_ids,
        nombre_original__istartswith='OCC',
    ).values('oportunidad_id', 'nombre_original'):
        archivos_por_opp.setdefault(a['oportunidad_id'], []).append(a['nombre_original'])

    now = timezone.now()
    proxima_tarea = {}
    for t in Tarea.objects.filter(
        oportunidad_id__in=opp_ids,
    ).exclude(estado__in=['completada', 'cancelada']).select_related('asignado_a').order_by('fecha_limite'):
        if t.oportunidad_id and t.oportunidad_id not in proxima_tarea:
            proxima_tarea[t.oportunidad_id] = t

    proxima_act = {}
    for a in Actividad.objects.filter(
        oportunidad_id__in=opp_ids,
        completada=False,
    ).order_by('fecha_inicio'):
        if a.oportunidad_id and a.oportunidad_id not in proxima_act:
            proxima_act[a.oportunidad_id] = a

    # ── Serializar opps + acumular KPIs ─────────────────────────────
    oportunidades = []
    monto_total = 0.0
    monto_ponderado = 0.0
    prob_acum = 0
    for o in opps:
        m = _money(o.monto)
        prob = int(o.probabilidad_cierre or 0)
        monto_total += m
        monto_ponderado += m * (prob / 100.0)
        prob_acum += prob
        # Días abierto: días desde fecha_creacion
        dias_abierto = 0
        if o.fecha_creacion:
            dias_abierto = max(0, (now - o.fecha_creacion).days)
        # Próximo paso
        proximo = None
        if o.id in proxima_tarea:
            t = proxima_tarea[o.id]
            proximo = {
                'tipo': 'tarea',
                'titulo': t.titulo,
                'fecha': t.fecha_limite.isoformat() if t.fecha_limite else None,
                'vencida': bool(t.fecha_limite and t.fecha_limite < now),
            }
        elif o.id in proxima_act:
            a = proxima_act[o.id]
            proximo = {
                'tipo': 'actividad',
                'titulo': a.titulo,
                'fecha': a.fecha_inicio.isoformat() if a.fecha_inicio else None,
                'vencida': bool(a.fecha_inicio and a.fecha_inicio < now),
            }
        oportunidades.append({
            'id': o.id,
            'titulo': o.oportunidad,
            'cliente': o.cliente.nombre_empresa if o.cliente_id else None,
            'vendedor': (o.usuario.get_full_name() or o.usuario.username) if o.usuario_id else None,
            'vendedor_id': o.usuario_id,
            'pipeline': o.tipo_negociacion or '',
            'pipeline_label': (o.tipo_negociacion or '').capitalize(),
            'etapa': o.etapa_corta or '',
            'producto': o.producto or '',
            'monto_mxn': m,
            'monto_ponderado_mxn': round(m * (prob / 100.0), 2),
            'probabilidad': prob,
            'dias_abierto': dias_abierto,
            'fecha_cierre': _fmt_fecha_cierre(o.mes_cierre, o.anio_cierre),
            'po_number': o.po_number or '',
            'archivos_occ': archivos_por_opp.get(o.id, []),
            'proximo_paso': proximo,
        })

    total = len(opps)
    prob_prom = round(prob_acum / total) if total else 0

    kpis = {
        'total': total,
        'pipeline_total_mxn': monto_total,
        'monto_ponderado_mxn': round(monto_ponderado, 2),
        'prob_promedio': prob_prom,
    }

    return JsonResponse({
        'ok': True,
        'oportunidades': oportunidades,
        'kpis': kpis,
        'filtros_disponibles': _filtros_disponibles(user, etapas_map),
    })


def _kpis_vacio():
    return {'total': 0, 'pipeline_total_mxn': 0.0, 'monto_ponderado_mxn': 0.0, 'prob_promedio': 0}


def _filtros_disponibles(user, etapas_map):
    """Lista de vendedores, etapas y productos que el user puede elegir."""
    visible_ids = get_usuarios_visibles_ids(user)
    qs = User.objects.filter(is_active=True).order_by('first_name', 'last_name')
    if visible_ids:
        qs = qs.filter(id__in=visible_ids)
    vendedores = [
        {'id': u.id, 'nombre': u.get_full_name() or u.username}
        for u in qs
    ]
    # Marcas que existen en opps "vendido en adelante" — usamos distinct().
    pipeline_filter = Q()
    for pl, etapas in etapas_map.items():
        pipeline_filter |= Q(tipo_negociacion=pl, etapa_corta__in=etapas)
    productos_qs = TodoItem.objects.filter(pipeline_filter)
    if visible_ids:
        productos_qs = productos_qs.filter(usuario_id__in=visible_ids)
    productos = sorted({m for m in productos_qs.exclude(producto='').exclude(producto__isnull=True).values_list('producto', flat=True) if m})
    return {
        'vendedores': vendedores,
        'etapas_por_pipeline': etapas_map,
        'productos': productos,
    }


# ═══════════════════════════════════════════════════════════════════════════
# REPORTE 2: Oportunidades Cerradas (Ganadas / Perdidas)
# ═══════════════════════════════════════════════════════════════════════════

# Resultado por etapa_corta. Las etapas terminales se mapean a "ganada" o
# "perdida". El resto (cerrada, etc.) se ignora — son ambiguas y no aportan
# a KPIs de cierre.
_RESULTADO_POR_ETAPA = {
    'ganada': 'ganada', 'ganado': 'ganada',
    'pagada': 'ganada', 'pagado': 'ganada',
    'perdida': 'perdida', 'perdido': 'perdida',
}


def _filtros_disponibles_cerradas(user):
    """Vendedores y productos disponibles para filtrar opps cerradas.
    Diferente de la versión de Abiertas porque acá no hay restricción de
    "Vendido en adelante" — son etapas terminales."""
    visible_ids = get_usuarios_visibles_ids(user)
    qs_u = User.objects.filter(is_active=True).order_by('first_name', 'last_name')
    if visible_ids:
        qs_u = qs_u.filter(id__in=visible_ids)
    vendedores = [
        {'id': u.id, 'nombre': u.get_full_name() or u.username}
        for u in qs_u
    ]
    qs_p = TodoItem.objects.filter(
        etapa_corta__in=list(_RESULTADO_POR_ETAPA.keys())
    )
    if visible_ids:
        qs_p = qs_p.filter(usuario_id__in=visible_ids)
    productos = sorted({
        m for m in qs_p.exclude(producto='').exclude(producto__isnull=True)
        .values_list('producto', flat=True)
        if m
    })
    # Años con datos: mejora el selector de periodo en el frontend.
    anios = sorted({
        a for a in qs_p.exclude(anio_cierre__isnull=True)
        .values_list('anio_cierre', flat=True)
        if a
    }, reverse=True)
    return {
        'vendedores': vendedores,
        'productos': productos,
        'anios_con_datos': anios,
    }


def _kpis_vacio_cerradas():
    return {
        'total': 0, 'ganadas': 0, 'perdidas': 0,
        'monto_ganado_mxn': 0.0, 'monto_perdido_mxn': 0.0,
        'ticket_promedio_mxn': 0.0, 'pct_cierre': 0,
    }


@login_required
def api_reporte_oportunidades_cerradas(request):
    """GET /app/api/reportes/oportunidades-cerradas/

    Query params (filtros opcionales):
        pipeline=runrate|proyecto   (sin valor → ambos)
        vendedor=<user_id>          (sin valor → todos los visibles)
        resultado=ganada|perdida    (sin valor → ambos)
        producto=<nombre>           (filtra por proveedor/producto)
        anio=<int>                  (filtra por año de cierre)
        mes=<01-12>                 (filtra por mes de cierre; requiere anio)
        monto_min=<int>             (monto mínimo)
        q=<texto>                   (busca en título y nombre de cliente)

    Devuelve JSON: lista de opps cerradas + KPIs + filtros disponibles.
    KPIs incluyen monto ganado/perdido, % cierre y ticket promedio.
    """
    user = request.user
    qp = request.GET

    # ── Filtros ─────────────────────────────────────────────────────
    pipeline_arg = (qp.get('pipeline') or '').strip().lower()
    resultado_arg = (qp.get('resultado') or '').strip().lower()
    producto_filter = (qp.get('producto') or '').strip()
    q_text = (qp.get('q') or '').strip()

    vendedor_id = None
    if qp.get('vendedor'):
        try:
            vendedor_id = int(qp.get('vendedor'))
        except (TypeError, ValueError):
            vendedor_id = None

    monto_min = None
    if qp.get('monto_min'):
        try:
            monto_min = float(qp.get('monto_min'))
        except (TypeError, ValueError):
            monto_min = None

    anio_filter = None
    if qp.get('anio'):
        try:
            anio_filter = int(qp.get('anio'))
        except (TypeError, ValueError):
            anio_filter = None

    mes_filter_arg = (qp.get('mes') or '').strip().zfill(2) if qp.get('mes') else ''

    # Etapas a incluir según resultado pedido
    if resultado_arg == 'ganada':
        etapas_incluir = [e for e, r in _RESULTADO_POR_ETAPA.items() if r == 'ganada']
    elif resultado_arg == 'perdida':
        etapas_incluir = [e for e, r in _RESULTADO_POR_ETAPA.items() if r == 'perdida']
    else:
        etapas_incluir = list(_RESULTADO_POR_ETAPA.keys())

    # ── Query base ──────────────────────────────────────────────────
    qs = TodoItem.objects.filter(
        etapa_corta__in=etapas_incluir
    ).select_related('cliente', 'usuario')

    if pipeline_arg in ('runrate', 'proyecto'):
        qs = qs.filter(tipo_negociacion=pipeline_arg)

    visible_ids = get_usuarios_visibles_ids(user)
    if visible_ids:
        qs = qs.filter(usuario_id__in=visible_ids)

    if vendedor_id:
        qs = qs.filter(usuario_id=vendedor_id)

    if producto_filter:
        qs = qs.filter(producto=producto_filter)

    if monto_min is not None:
        qs = qs.filter(monto__gte=monto_min)

    if anio_filter:
        qs = qs.filter(anio_cierre=anio_filter)

    if mes_filter_arg:
        qs = qs.filter(mes_cierre=mes_filter_arg)

    if q_text:
        qs = qs.filter(
            Q(oportunidad__icontains=q_text) |
            Q(cliente__nombre_empresa__icontains=q_text)
        )

    qs = qs.order_by('-anio_cierre', '-mes_cierre', '-monto')
    opps = list(qs)

    # ── Serializar opps + acumular KPIs ─────────────────────────────
    oportunidades = []
    monto_ganado = 0.0
    monto_perdido = 0.0
    ganadas = 0
    perdidas = 0
    for o in opps:
        m = _money(o.monto)
        etapa_norm = (o.etapa_corta or '').strip().lower()
        resultado = _RESULTADO_POR_ETAPA.get(etapa_norm, 'otro')
        if resultado == 'ganada':
            ganadas += 1
            monto_ganado += m
        elif resultado == 'perdida':
            perdidas += 1
            monto_perdido += m
        oportunidades.append({
            'id': o.id,
            'titulo': o.oportunidad,
            'cliente': o.cliente.nombre_empresa if o.cliente_id else None,
            'vendedor': (o.usuario.get_full_name() or o.usuario.username) if o.usuario_id else None,
            'vendedor_id': o.usuario_id,
            'pipeline': o.tipo_negociacion or '',
            'pipeline_label': (o.tipo_negociacion or '').capitalize(),
            'etapa': o.etapa_corta or '',
            'resultado': resultado,  # 'ganada' | 'perdida' | 'otro'
            'producto': o.producto or '',
            'monto_mxn': m,
            'fecha_cierre': _fmt_fecha_cierre(o.mes_cierre, o.anio_cierre),
            'mes_cierre': o.mes_cierre or '',
            'anio_cierre': o.anio_cierre,
            'po_number': o.po_number or '',
        })

    total = ganadas + perdidas
    pct = round((ganadas / total) * 100) if total else 0
    ticket_prom = (monto_ganado / ganadas) if ganadas else 0

    kpis = {
        'total': total,
        'ganadas': ganadas,
        'perdidas': perdidas,
        'monto_ganado_mxn': round(monto_ganado, 2),
        'monto_perdido_mxn': round(monto_perdido, 2),
        'ticket_promedio_mxn': round(ticket_prom, 2),
        'pct_cierre': pct,
    }

    return JsonResponse({
        'ok': True,
        'oportunidades': oportunidades,
        'kpis': kpis,
        'filtros_disponibles': _filtros_disponibles_cerradas(user),
    })
