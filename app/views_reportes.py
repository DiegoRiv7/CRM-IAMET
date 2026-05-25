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
from django.shortcuts import render
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
    """Landing del módulo Reportes — grilla de reportes disponibles."""
    ctx = _sidebar_context(request)
    ctx.update({
        'reportes': REPORTES_CATALOGO,
        'tab_activo': 'reportes',
    })
    return render(request, 'reportes/index.html', ctx)


@login_required
def reporte_detalle(request, slug):
    """Vista de un reporte individual. Despacha por slug."""
    reporte = REPORTES_BY_SLUG.get(slug)
    ctx = _sidebar_context(request)
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


@login_required
def api_reporte_oportunidades_abiertas(request):
    """GET /app/api/reportes/oportunidades-abiertas/

    Query params (filtros opcionales):
        pipeline=runrate|proyecto    (sin valor → ambos)
        vendedor=<user_id>           (sin valor → todos los visibles)
        etapa=<nombre>               (sin valor → todas las "Vendido en adelante")
        q=<texto>                    (busca en título y nombre de cliente)

    Devuelve JSON agrupado por pipeline → etapa.
    """
    user = request.user
    qp = request.GET

    etapas_map = _etapas_vendido_en_adelante()
    if not etapas_map:
        return JsonResponse({
            'ok': True,
            'total_global': 0,
            'monto_total_global': 0.0,
            'pipelines': [],
            'filtros_disponibles': {'vendedores': [], 'etapas_por_pipeline': {}},
            'nota': 'No se encontraron etapas "Vendido en adelante" configuradas.',
        })

    # ── Filtros ─────────────────────────────────────────────────────
    pipeline_arg = (qp.get('pipeline') or '').strip().lower()
    if pipeline_arg in ('runrate', 'proyecto'):
        pipelines_objetivo = [pipeline_arg]
    else:
        pipelines_objetivo = list(etapas_map.keys())

    etapa_filter = (qp.get('etapa') or '').strip()
    q_text = (qp.get('q') or '').strip()

    vendedor_id = None
    if qp.get('vendedor'):
        try:
            vendedor_id = int(qp.get('vendedor'))
        except (TypeError, ValueError):
            vendedor_id = None

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
            'total_global': 0,
            'monto_total_global': 0.0,
            'pipelines': [],
            'filtros_disponibles': _filtros_disponibles(user, etapas_map),
        })

    qs = TodoItem.objects.filter(pipeline_filter).select_related('cliente', 'usuario')

    # Visibilidad (mismo criterio que el resto del CRM)
    visible_ids = get_usuarios_visibles_ids(user)
    if visible_ids:
        qs = qs.filter(usuario_id__in=visible_ids)

    if vendedor_id:
        qs = qs.filter(usuario_id=vendedor_id)

    if q_text:
        qs = qs.filter(
            Q(oportunidad__icontains=q_text) |
            Q(cliente__nombre_empresa__icontains=q_text)
        )

    qs = qs.order_by('tipo_negociacion', 'etapa_corta', '-monto')
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

    # ── Armar resultado agrupado ────────────────────────────────────
    pipelines_out = []
    total_global = 0
    monto_total_global = 0.0
    for pl in pipelines_objetivo:
        if pl not in etapas_map:
            continue
        opps_pl = [o for o in opps if (o.tipo_negociacion or '') == pl]
        if not opps_pl:
            continue
        orden_etapas = etapas_map[pl]
        etapas_out = []
        monto_pl = 0.0
        count_pl = 0
        for etapa_nombre in orden_etapas:
            ops_etapa = [o for o in opps_pl if (o.etapa_corta or '') == etapa_nombre]
            if not ops_etapa:
                continue
            opps_list = []
            monto_et = 0.0
            for o in ops_etapa:
                m = _money(o.monto)
                monto_et += m
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
                opps_list.append({
                    'id': o.id,
                    'titulo': o.oportunidad,
                    'cliente': o.cliente.nombre_empresa if o.cliente_id else None,
                    'vendedor': (o.usuario.get_full_name() or o.usuario.username) if o.usuario_id else None,
                    'monto_mxn': m,
                    'po_number': o.po_number or '',
                    'archivos_occ': archivos_por_opp.get(o.id, []),
                    'proximo_paso': proximo,
                })
            etapas_out.append({
                'etapa': etapa_nombre,
                'count': len(ops_etapa),
                'monto_mxn': monto_et,
                'oportunidades': opps_list,
            })
            monto_pl += monto_et
            count_pl += len(ops_etapa)
        if etapas_out:
            pipelines_out.append({
                'pipeline': pl,
                'pipeline_label': pl.capitalize(),
                'count': count_pl,
                'monto_mxn': monto_pl,
                'etapas': etapas_out,
            })
            total_global += count_pl
            monto_total_global += monto_pl

    return JsonResponse({
        'ok': True,
        'total_global': total_global,
        'monto_total_global': monto_total_global,
        'pipelines': pipelines_out,
        'filtros_disponibles': _filtros_disponibles(user, etapas_map),
    })


def _filtros_disponibles(user, etapas_map):
    """Lista de vendedores y etapas que el user puede elegir como filtros."""
    visible_ids = get_usuarios_visibles_ids(user)
    qs = User.objects.filter(is_active=True).order_by('first_name', 'last_name')
    if visible_ids:
        qs = qs.filter(id__in=visible_ids)
    vendedores = [
        {'id': u.id, 'nombre': u.get_full_name() or u.username}
        for u in qs
    ]
    return {
        'vendedores': vendedores,
        'etapas_por_pipeline': etapas_map,
    }
