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
import json
from datetime import datetime, timedelta
from decimal import Decimal

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User

from django.db.models import Q, Sum, Count, Max, Min
from django.http import JsonResponse
from django.shortcuts import render, redirect
from django.utils import timezone

from .models import (
    TodoItem, EtapaPipeline, ArchivoOportunidad, Tarea, Actividad, Cliente,
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
    {
        'slug': 'personalizado',
        'titulo': 'Reporte Personalizado',
        'descripcion': (
            'Constructor visual: arma el reporte que quieras con los datos '
            'que quieras. Elige entidad, filtros, columnas, agrupación y '
            'orden. Guarda tus configuraciones favoritas.'
        ),
        'icono': 'sparkles',
        'color': '#0052D4',
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

_ETAPAS_TERMINALES = {
    'ganada', 'ganado',
    'pagada', 'pagado',
    'perdida', 'perdido',
    'cerrada', 'cerrado',
}


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


def _fecha_cierre_sort_key(mes_cierre, anio_cierre):
    """Devuelve un entero comparable (anio*100 + mes) para sort por fecha
    estimada de cierre. Sin fecha → muy alto (10**9) para que caigan al
    final en sort ascendente y al inicio en descendente — el usuario verá
    los desconocidos donde corresponde sin contaminar los datos válidos.
    """
    try:
        a = int(anio_cierre or 0)
        m = int(mes_cierre or 0)
        if a >= 1900 and 1 <= m <= 12:
            return a * 100 + m
    except (TypeError, ValueError):
        pass
    return 10 ** 9


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
    # KPIs extra del rediseño "hablante" (2026-05-28):
    #   - cerrara_este_mes: opp con mes_cierre == mes actual Y anio_cierre == año actual
    #   - necesita_atencion: próx. paso vencido O (estancada >45d AND prob <40)
    #   - alta_prob: prob >= 70
    # Estos atributos también van por-opp para que el frontend pueda
    # resaltarlas, filtrarlas y mostrar el header narrativo.
    mes_actual = now.month
    anio_actual = now.year

    oportunidades = []
    monto_total = 0.0
    monto_ponderado = 0.0
    prob_acum = 0
    cerrara_este_mes_count = 0
    cerrara_este_mes_monto = 0.0
    necesita_atencion_count = 0
    necesita_atencion_monto = 0.0
    alta_prob_count = 0
    alta_prob_monto = 0.0
    estancadas_count = 0
    vencidas_count = 0
    montos_para_top = []
    for o in opps:
        m = _money(o.monto)
        prob = int(o.probabilidad_cierre or 0)
        monto_total += m
        monto_ponderado += m * (prob / 100.0)
        prob_acum += prob
        montos_para_top.append(m)
        # Días abierto: días desde fecha_creacion
        dias_abierto = 0
        if o.fecha_creacion:
            dias_abierto = max(0, (now - o.fecha_creacion).days)
        # Próximo paso
        proximo = None
        proximo_vencido = False
        proximo_dias = None  # negativo = vencida hace X días, positivo = vence en X días
        if o.id in proxima_tarea:
            t = proxima_tarea[o.id]
            proximo_vencido = bool(t.fecha_limite and t.fecha_limite < now)
            if t.fecha_limite:
                proximo_dias = (t.fecha_limite.date() - now.date()).days
            proximo = {
                'tipo': 'tarea',
                'titulo': t.titulo,
                'fecha': t.fecha_limite.isoformat() if t.fecha_limite else None,
                'vencida': proximo_vencido,
                'dias_rel': proximo_dias,
            }
        elif o.id in proxima_act:
            a = proxima_act[o.id]
            proximo_vencido = bool(a.fecha_inicio and a.fecha_inicio < now)
            if a.fecha_inicio:
                proximo_dias = (a.fecha_inicio.date() - now.date()).days
            proximo = {
                'tipo': 'actividad',
                'titulo': a.titulo,
                'fecha': a.fecha_inicio.isoformat() if a.fecha_inicio else None,
                'vencida': proximo_vencido,
                'dias_rel': proximo_dias,
            }
        # Flags "hablantes"
        cierra_este_mes = False
        try:
            if o.mes_cierre and o.anio_cierre:
                cierra_este_mes = (int(o.mes_cierre) == mes_actual and int(o.anio_cierre) == anio_actual)
        except (TypeError, ValueError):
            cierra_este_mes = False
        estancada = dias_abierto > 45
        alta_prob = prob >= 70
        # "Necesita atención": próx paso vencido O estancada con prob baja.
        necesita_atencion = bool(proximo_vencido or (estancada and prob < 40))

        if cierra_este_mes:
            cerrara_este_mes_count += 1
            cerrara_este_mes_monto += m
        if necesita_atencion:
            necesita_atencion_count += 1
            necesita_atencion_monto += m
        if alta_prob:
            alta_prob_count += 1
            alta_prob_monto += m
        if estancada:
            estancadas_count += 1
        if proximo_vencido:
            vencidas_count += 1

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
            # Numérico para sort por cierre más próximo/lejano:
            'fecha_cierre_sort': _fecha_cierre_sort_key(o.mes_cierre, o.anio_cierre),
            'po_number': o.po_number or '',
            'archivos_occ': archivos_por_opp.get(o.id, []),
            'proximo_paso': proximo,
            # Flags "hablantes" (nuevos 2026-05-28):
            'cierra_este_mes': cierra_este_mes,
            'estancada': estancada,
            'alta_prob': alta_prob,
            'necesita_atencion': necesita_atencion,
            'proximo_vencido': proximo_vencido,
            'proximo_dias_rel': proximo_dias,
        })

    total = len(opps)
    prob_prom = round(prob_acum / total) if total else 0

    # Top-20% por monto (umbral para "caliente")
    top20_threshold = 0.0
    if montos_para_top:
        montos_sorted = sorted(montos_para_top, reverse=True)
        idx = max(0, int(len(montos_sorted) * 0.2) - 1)
        top20_threshold = montos_sorted[idx] if idx < len(montos_sorted) else (montos_sorted[0] if montos_sorted else 0.0)

    # Marca "caliente" en cada opp ahora que ya tenemos el umbral.
    for op in oportunidades:
        op['caliente'] = bool(
            op['alta_prob']
            and op['monto_mxn'] >= top20_threshold
            and op['monto_mxn'] > 0
            and not op['necesita_atencion']
        )

    # Meta agregada del mes (suma de meta_mensual de los vendedores visibles
    # — o solo del vendedor filtrado). Se usa para el progress hacia meta
    # del header. Si nadie tiene meta_mensual, devolvemos 0 y el frontend
    # oculta el bar.
    from .models import UserProfile  # local import — evita circular en cold start
    meta_users_q = User.objects.filter(is_active=True)
    if visible_ids:
        meta_users_q = meta_users_q.filter(id__in=visible_ids)
    if vendedor_id:
        meta_users_q = meta_users_q.filter(id=vendedor_id)
    meta_mes_total = 0.0
    try:
        for prof in UserProfile.objects.filter(user__in=meta_users_q):
            meta_mes_total += float(prof.meta_mensual or 0)
    except Exception:
        meta_mes_total = 0.0

    kpis = {
        'total': total,
        'pipeline_total_mxn': monto_total,
        'monto_ponderado_mxn': round(monto_ponderado, 2),
        'prob_promedio': prob_prom,
        # Nuevos (no rompen contrato — sólo agregan):
        'cerrara_este_mes_count': cerrara_este_mes_count,
        'cerrara_este_mes_monto_mxn': cerrara_este_mes_monto,
        'necesita_atencion_count': necesita_atencion_count,
        'necesita_atencion_monto_mxn': necesita_atencion_monto,
        'alta_prob_count': alta_prob_count,
        'alta_prob_monto_mxn': alta_prob_monto,
        'estancadas_count': estancadas_count,
        'vencidas_count': vencidas_count,
        'top20_threshold_mxn': top20_threshold,
        'meta_mes_mxn': meta_mes_total,
        'mes_actual': mes_actual,
        'anio_actual': anio_actual,
        'mes_actual_label': _MES_NOMBRES[mes_actual] if 1 <= mes_actual <= 12 else '',
    }

    return JsonResponse({
        'ok': True,
        'oportunidades': oportunidades,
        'kpis': kpis,
        'filtros_disponibles': _filtros_disponibles(user, etapas_map),
    })


def _kpis_vacio():
    now = timezone.now()
    return {
        'total': 0,
        'pipeline_total_mxn': 0.0,
        'monto_ponderado_mxn': 0.0,
        'prob_promedio': 0,
        # Nuevos (rediseño 2026-05-28):
        'cerrara_este_mes_count': 0,
        'cerrara_este_mes_monto_mxn': 0.0,
        'necesita_atencion_count': 0,
        'necesita_atencion_monto_mxn': 0.0,
        'alta_prob_count': 0,
        'alta_prob_monto_mxn': 0.0,
        'estancadas_count': 0,
        'vencidas_count': 0,
        'top20_threshold_mxn': 0.0,
        'meta_mes_mxn': 0.0,
        'mes_actual': now.month,
        'anio_actual': now.year,
        'mes_actual_label': _MES_NOMBRES[now.month] if 1 <= now.month <= 12 else '',
    }


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


# ═══════════════════════════════════════════════════════════════════════════
# REPORTE 3: Por Cliente — cómo vamos con cada cliente
# ═══════════════════════════════════════════════════════════════════════════

_ETAPAS_GANADAS = ['ganada', 'ganado', 'pagada', 'pagado']
_ETAPAS_PERDIDAS = ['perdida', 'perdido']


def _kpis_vacio_clientes():
    return {
        'total_clientes': 0,
        'con_opps_abiertas': 0,
        'monto_ganado_total_mxn': 0.0,
        'sin_actividad_reciente': 0,
    }


def _cobrado_total_por_cliente(clientes):
    """Suma todo el cobrado histórico (todos los ArchivoCobrado) y lo
    devuelve indexado por cliente.id.

    Misma lógica de matching por nombre + alias que usa el Dashboard
    (views_crm._extract_cobrado_entries). Centralizar este helper aquí
    evitaría duplicar; por ahora replicamos el patrón básico para no
    crear acoplamiento con views_crm.

    Args:
        clientes: lista de instancias Cliente (las que se mostrarán en el
                  reporte). Solo matcheamos contra estos para evitar
                  cruzar nombres con clientes que el usuario no ve.

    Returns:
        dict {cliente_id: monto_total_float}
    """
    from .models import ArchivoCobrado, AliasCliente

    if not clientes:
        return {}

    # Alias map: palabra_clave (UPPER) → buscar_como (UPPER)
    alias_map = {
        a.palabra_clave.upper().strip(): a.buscar_como.upper().strip()
        for a in AliasCliente.objects.all()
    }

    # Acumulador final por cliente_id
    total_by_id = {}

    # Iterar TODOS los archivos de cobrado (histórico completo).
    for ac in ArchivoCobrado.objects.all().only('datos_json'):
        if not ac.datos_json:
            continue
        for key, val in ac.datos_json.items():
            if not isinstance(val, dict) or 'monto' not in val:
                continue
            nombre = (val.get('nombre') or key or '').upper().strip()
            if not nombre:
                continue
            # Aplicar alias
            if nombre in alias_map:
                nombre = alias_map[nombre]
            try:
                monto = float(val['monto'] or 0)
            except (TypeError, ValueError):
                continue

            # Match contra los clientes del reporte:
            # 1) exacto
            # 2) substring
            # 3) palabras significativas (2+)
            target = None
            for c in clientes:
                if c.nombre_empresa and c.nombre_empresa.upper().strip() == nombre:
                    target = c
                    break
            if not target:
                for c in clientes:
                    if not c.nombre_empresa:
                        continue
                    crm_u = c.nombre_empresa.upper().strip()
                    if crm_u in nombre or nombre in crm_u:
                        target = c
                        break
            if not target:
                pw = [
                    w for w in nombre.split()
                    if len(w) > 2 and w not in (
                        'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'SA', 'CV', 'SAS', 'INC', 'MEXICO'
                    )
                ]
                if len(pw) >= 2:
                    for c in clientes:
                        if not c.nombre_empresa:
                            continue
                        n_up = c.nombre_empresa.upper()
                        if pw[0] in n_up and pw[1] in n_up:
                            target = c
                            break

            if target:
                total_by_id[target.id] = total_by_id.get(target.id, 0.0) + monto

    return total_by_id


@login_required
def api_reporte_clientes(request):
    """GET /app/api/reportes/clientes/

    Una fila por cliente con conteos de opps + actividad. Soporta filtros
    de vendedor asignado (asignado_a), mínimo de opps abiertas y búsqueda
    por nombre de empresa.

    Las opps abiertas se cuentan dinámicamente (etapas "Vendido en adelante"
    leídas de EtapaPipeline, igual que el Reporte 1).

    El "Cobrado total" por cliente NO viene de las oportunidades — viene
    del Dashboard (modelo ArchivoCobrado). Ver _cobrado_total_por_cliente.

    Devuelve KPIs globales + lista flat de clientes.
    """
    user = request.user
    qp = request.GET

    # ── Filtros ─────────────────────────────────────────────────────
    vendedor_id = None
    if qp.get('vendedor'):
        try:
            vendedor_id = int(qp.get('vendedor'))
        except (TypeError, ValueError):
            vendedor_id = None

    opps_min = 0
    if qp.get('opps_min'):
        try:
            opps_min = int(qp.get('opps_min'))
        except (TypeError, ValueError):
            opps_min = 0

    q_text = (qp.get('q') or '').strip()

    # ── Etapas abiertas (dinámicas) ─────────────────────────────────
    etapas_map = _etapas_vendido_en_adelante()
    etapas_abiertas = []
    for pl_etapas in etapas_map.values():
        etapas_abiertas.extend(pl_etapas)

    # ── Visibilidad: clientes asignados a usuarios visibles ─────────
    visible_ids = get_usuarios_visibles_ids(user)
    qs = Cliente.objects.all()
    if visible_ids:
        # Cliente puede tener asignado_a NULL — incluimos también esos al
        # supervisor (los huérfanos son visibles para que no se pierdan).
        qs = qs.filter(Q(asignado_a_id__in=visible_ids) | Q(asignado_a__isnull=True))
    if vendedor_id:
        qs = qs.filter(asignado_a_id=vendedor_id)
    if q_text:
        qs = qs.filter(nombre_empresa__icontains=q_text)

    # ── Annotations agregadas (1 sola query a TodoItem) ─────────────
    qs = qs.annotate(
        opps_abiertas=Count(
            'oportunidades',
            filter=Q(oportunidades__etapa_corta__in=etapas_abiertas),
            distinct=True,
        ),
        opps_ganadas=Count(
            'oportunidades',
            filter=Q(oportunidades__etapa_corta__in=_ETAPAS_GANADAS),
            distinct=True,
        ),
        opps_perdidas=Count(
            'oportunidades',
            filter=Q(oportunidades__etapa_corta__in=_ETAPAS_PERDIDAS),
            distinct=True,
        ),
    )

    if opps_min > 0:
        qs = qs.filter(opps_abiertas__gte=opps_min)

    qs = qs.select_related('asignado_a').order_by('-opps_abiertas', 'nombre_empresa')
    clientes = list(qs)
    cliente_ids = [c.id for c in clientes]

    # ── Actividad última (ya no calculamos próxima, esa columna se quitó) ──
    now = timezone.now()
    ultima_act = dict(
        Actividad.objects
        .filter(oportunidad__cliente_id__in=cliente_ids)
        .values('oportunidad__cliente_id')
        .annotate(ultima=Max('fecha_inicio'))
        .values_list('oportunidad__cliente_id', 'ultima')
    )

    # ── Cobrado total por cliente (desde ArchivoCobrado) ────────────
    # El "Cobrado" del Dashboard NO se calcula desde oportunidades — viene
    # de los CSVs subidos por administración (modelo ArchivoCobrado). Para
    # mostrar el "Cobrado Total" por cliente en este reporte, sumamos todo
    # el histórico (todos los meses/años) y matcheamos por nombre (con
    # alias del modelo AliasCliente, igual que el Dashboard).
    cobrado_por_cliente_id = _cobrado_total_por_cliente(clientes)

    # ── Serializar + KPIs ───────────────────────────────────────────
    treinta_dias_atras = now - timedelta(days=30)
    out = []
    con_opps_abiertas = 0
    cobrado_total_global = 0.0
    sin_act_reciente = 0
    for c in clientes:
        ult = ultima_act.get(c.id)
        cobrado_c = cobrado_por_cliente_id.get(c.id, 0.0)
        cobrado_total_global += cobrado_c
        if c.opps_abiertas > 0:
            con_opps_abiertas += 1
        if not ult or ult < treinta_dias_atras:
            sin_act_reciente += 1
        out.append({
            'id': c.id,
            'nombre': c.nombre_empresa,
            'categoria': c.categoria or 'C',
            'asignado_a': (
                (c.asignado_a.get_full_name() or c.asignado_a.username)
                if c.asignado_a_id else None
            ),
            'asignado_a_id': c.asignado_a_id,
            'opps_abiertas': c.opps_abiertas,
            'opps_ganadas': c.opps_ganadas,
            'opps_perdidas': c.opps_perdidas,
            'cobrado_total_mxn': cobrado_c,
            'ultima_actividad': ult.isoformat() if ult else None,
        })

    kpis = {
        'total_clientes': len(clientes),
        'con_opps_abiertas': con_opps_abiertas,
        'cobrado_total_global_mxn': round(cobrado_total_global, 2),
        'sin_actividad_reciente': sin_act_reciente,
    }

    # Filtros disponibles: solo vendedores con clientes asignados visibles.
    qs_u = User.objects.filter(is_active=True).order_by('first_name', 'last_name')
    if visible_ids:
        qs_u = qs_u.filter(id__in=visible_ids)
    vendedores = [
        {'id': u.id, 'nombre': u.get_full_name() or u.username}
        for u in qs_u
    ]

    return JsonResponse({
        'ok': True,
        'clientes': out,
        'kpis': kpis,
        'filtros_disponibles': {'vendedores': vendedores},
    })


# ═══════════════════════════════════════════════════════════════════════════
# REPORTE 4: Constructor Personalizado
#
# El usuario arma su reporte con: entidad (oportunidades / clientes /
# actividades), filtros, columnas, agrupación y orden. El endpoint
# valida todo con whitelist estricta — NUNCA construye queries con
# campos arbitrarios del request.
# ═══════════════════════════════════════════════════════════════════════════


# ── Schema autoritativo: lo que el backend reconoce y permite. ─────────────
# Para cada entidad: campos válidos (key → mapping ORM + tipo + formato),
# filtros permitidos, columnas, agrupables. El JS tiene un mirror visual,
# pero el backend es la verdad — si no está aquí, no pasa.

_TIPOS_OPERADORES = {
    'texto': {'contains', 'eq', 'neq'},
    'numero': {'gt', 'gte', 'lt', 'lte', 'eq', 'between'},
    'fecha': {'gte', 'lte', 'between', 'this_month', 'this_year', 'last_30d'},
    'opciones': {'in', 'not_in'},
}


# Para oportunidades, los nombres "humanos" de campos se mapean a
# expresiones ORM. Las funciones row_value extraen el valor para la fila
# serializada. Esto evita pasar nombres de campo de Django desde el front.

def _ent_oportunidades_schema():
    """Campos válidos para entidad=oportunidades.

    Cada entry:
      key (str)       — nombre que ve el front
      label (str)     — etiqueta humana
      tipo            — texto / numero / fecha / opciones
      orm_field       — campo Django para filter/order
      align           — 'left' o 'right' (para tabla)
      formato         — 'money' / 'fecha' / 'number' / None (texto)
      row_value       — fn(opp) -> valor serializado
    """
    def f_titulo(o):    return o.oportunidad
    def f_cliente(o):   return o.cliente.nombre_empresa if o.cliente_id else None
    def f_vendedor(o):  return (o.usuario.get_full_name() or o.usuario.username) if o.usuario_id else None
    def f_pipeline(o):  return o.tipo_negociacion
    def f_etapa(o):     return o.etapa_corta
    def f_producto(o):  return o.producto
    def f_area(o):      return o.area
    def f_monto(o):     return float(o.monto or 0)
    def f_prob(o):      return o.probabilidad_cierre
    def f_mes(o):       return o.mes_cierre
    def f_anio(o):      return o.anio_cierre
    def f_fcrea(o):     return o.fecha_creacion.isoformat() if o.fecha_creacion else None
    def f_fact(o):      return o.fecha_actualizacion.isoformat() if o.fecha_actualizacion else None
    def f_po(o):        return o.po_number or ''
    def f_cat(o):       return o.cliente.categoria if o.cliente_id else None

    return {
        'titulo':              {'label': 'Oportunidad', 'tipo': 'texto', 'orm_field': 'oportunidad', 'row_value': f_titulo},
        'cliente':             {'label': 'Cliente', 'tipo': 'texto', 'orm_field': 'cliente__nombre_empresa', 'row_value': f_cliente},
        'vendedor':            {'label': 'Vendedor', 'tipo': 'opciones', 'orm_field': 'usuario_id', 'row_value': f_vendedor, 'opciones_key': 'vendedores'},
        'pipeline':            {'label': 'Pipeline', 'tipo': 'opciones', 'orm_field': 'tipo_negociacion', 'row_value': f_pipeline},
        'etapa':               {'label': 'Etapa', 'tipo': 'opciones', 'orm_field': 'etapa_corta', 'row_value': f_etapa, 'opciones_key': 'etapas'},
        'producto':            {'label': 'Producto / Marca', 'tipo': 'opciones', 'orm_field': 'producto', 'row_value': f_producto, 'opciones_key': 'productos'},
        'area':                {'label': 'Área', 'tipo': 'opciones', 'orm_field': 'area', 'row_value': f_area, 'opciones_key': 'areas'},
        'monto_mxn':           {'label': 'Monto MXN', 'tipo': 'numero', 'orm_field': 'monto', 'row_value': f_monto, 'align': 'right', 'formato': 'money'},
        'probabilidad':        {'label': 'Probabilidad %', 'tipo': 'numero', 'orm_field': 'probabilidad_cierre', 'row_value': f_prob, 'align': 'right', 'formato': 'number'},
        'mes_cierre':          {'label': 'Mes cierre', 'tipo': 'opciones', 'orm_field': 'mes_cierre', 'row_value': f_mes},
        'anio_cierre':         {'label': 'Año cierre', 'tipo': 'numero', 'orm_field': 'anio_cierre', 'row_value': f_anio, 'align': 'right', 'formato': 'number'},
        'fecha_creacion':      {'label': 'Creada el', 'tipo': 'fecha', 'orm_field': 'fecha_creacion', 'row_value': f_fcrea, 'formato': 'fecha'},
        'fecha_actualizacion': {'label': 'Actualizada el', 'tipo': 'fecha', 'orm_field': 'fecha_actualizacion', 'row_value': f_fact, 'formato': 'fecha'},
        'po_number':           {'label': 'PO', 'tipo': 'texto', 'orm_field': 'po_number', 'row_value': f_po},
        'categoria_cliente':   {'label': 'Categoría cliente', 'tipo': 'opciones', 'orm_field': 'cliente__categoria', 'row_value': f_cat},
    }


def _ent_clientes_schema():
    def f_nombre(c):     return c.nombre_empresa
    def f_rfc(c):        return c.rfc or ''
    def f_categoria(c):  return c.categoria or 'C'
    def f_asignado(c):   return (c.asignado_a.get_full_name() or c.asignado_a.username) if c.asignado_a_id else None
    def f_ab(c):         return getattr(c, '_opps_abiertas', 0)
    def f_ga(c):         return getattr(c, '_opps_ganadas', 0)
    def f_pe(c):         return getattr(c, '_opps_perdidas', 0)
    def f_mg(c):         return float(getattr(c, '_monto_ganado', 0) or 0)
    def f_ma(c):         return float(getattr(c, '_monto_abierto', 0) or 0)
    def f_fc(c):         return c.fecha_creacion.isoformat() if c.fecha_creacion else None
    def f_meta(c):       return float(c.meta_mensual or 0)

    return {
        'nombre':            {'label': 'Cliente', 'tipo': 'texto', 'orm_field': 'nombre_empresa', 'row_value': f_nombre},
        'rfc':               {'label': 'RFC', 'tipo': 'texto', 'orm_field': 'rfc', 'row_value': f_rfc},
        'categoria':         {'label': 'Categoría', 'tipo': 'opciones', 'orm_field': 'categoria', 'row_value': f_categoria},
        'asignado_a':        {'label': 'Asignado a', 'tipo': 'opciones', 'orm_field': 'asignado_a_id', 'row_value': f_asignado, 'opciones_key': 'vendedores'},
        'opps_abiertas':     {'label': 'Opps abiertas', 'tipo': 'numero', 'orm_field': '_opps_abiertas', 'row_value': f_ab, 'align': 'right', 'formato': 'number', 'es_annotation': True},
        'opps_ganadas':      {'label': 'Opps ganadas', 'tipo': 'numero', 'orm_field': '_opps_ganadas', 'row_value': f_ga, 'align': 'right', 'formato': 'number', 'es_annotation': True},
        'opps_perdidas':     {'label': 'Opps perdidas', 'tipo': 'numero', 'orm_field': '_opps_perdidas', 'row_value': f_pe, 'align': 'right', 'formato': 'number', 'es_annotation': True},
        'monto_ganado_mxn':  {'label': 'Monto ganado MXN', 'tipo': 'numero', 'orm_field': '_monto_ganado', 'row_value': f_mg, 'align': 'right', 'formato': 'money', 'es_annotation': True},
        'monto_abierto_mxn': {'label': 'Monto abierto MXN', 'tipo': 'numero', 'orm_field': '_monto_abierto', 'row_value': f_ma, 'align': 'right', 'formato': 'money', 'es_annotation': True},
        'fecha_creacion':    {'label': 'Cliente desde', 'tipo': 'fecha', 'orm_field': 'fecha_creacion', 'row_value': f_fc, 'formato': 'fecha'},
        'meta_mensual':      {'label': 'Meta facturado', 'tipo': 'numero', 'orm_field': 'meta_mensual', 'row_value': f_meta, 'align': 'right', 'formato': 'money'},
    }


def _ent_actividades_schema():
    def f_titulo(a):    return a.titulo
    def f_tipo(a):      return a.tipo_actividad
    def f_creado(a):    return (a.creado_por.get_full_name() or a.creado_por.username) if a.creado_por_id else None
    def f_opp(a):       return a.oportunidad.oportunidad if a.oportunidad_id else None
    def f_cli(a):       return a.oportunidad.cliente.nombre_empresa if (a.oportunidad_id and a.oportunidad.cliente_id) else None
    def f_compl(a):     return a.completada
    def f_ini(a):       return a.fecha_inicio.isoformat() if a.fecha_inicio else None
    def f_fin(a):       return a.fecha_fin.isoformat() if a.fecha_fin else None

    return {
        'titulo':          {'label': 'Actividad', 'tipo': 'texto', 'orm_field': 'titulo', 'row_value': f_titulo},
        'tipo_actividad':  {'label': 'Tipo', 'tipo': 'opciones', 'orm_field': 'tipo_actividad', 'row_value': f_tipo},
        'creado_por':      {'label': 'Creado por', 'tipo': 'opciones', 'orm_field': 'creado_por_id', 'row_value': f_creado, 'opciones_key': 'vendedores'},
        'oportunidad':     {'label': 'Oportunidad', 'tipo': 'texto', 'orm_field': 'oportunidad__oportunidad', 'row_value': f_opp},
        'cliente':         {'label': 'Cliente', 'tipo': 'texto', 'orm_field': 'oportunidad__cliente__nombre_empresa', 'row_value': f_cli},
        'completada':      {'label': 'Completada', 'tipo': 'opciones', 'orm_field': 'completada', 'row_value': f_compl, 'formato': 'bool'},
        'fecha_inicio':    {'label': 'Inicio', 'tipo': 'fecha', 'orm_field': 'fecha_inicio', 'row_value': f_ini, 'formato': 'fecha'},
        'fecha_fin':       {'label': 'Fin', 'tipo': 'fecha', 'orm_field': 'fecha_fin', 'row_value': f_fin, 'formato': 'fecha'},
    }


_SCHEMAS_PERSONALIZADO = {
    'oportunidades': {
        'schema_fn': _ent_oportunidades_schema,
        'agrupables': ['vendedor', 'etapa', 'pipeline', 'cliente', 'producto', 'mes_cierre', 'anio_cierre', 'area', 'categoria_cliente'],
    },
    'clientes': {
        'schema_fn': _ent_clientes_schema,
        'agrupables': ['categoria', 'asignado_a'],
    },
    'actividades': {
        'schema_fn': _ent_actividades_schema,
        'agrupables': ['tipo_actividad', 'creado_por', 'completada'],
    },
}


def _construir_q_filtro(campo_meta, op, valor):
    """Construye una Q() para un filtro {campo, op, valor} usando el schema.
    Retorna None si la combinación no es válida.
    """
    tipo = campo_meta['tipo']
    field = campo_meta['orm_field']
    # Annotation flag: en clientes algunos "campos" son annotations Count/Sum
    # — sobre ellas se filtra igual que sobre cualquier campo (Django soporta
    # filter sobre annotations).
    if op not in _TIPOS_OPERADORES.get(tipo, set()):
        return None

    try:
        if tipo == 'texto':
            if op == 'contains':
                return Q(**{f'{field}__icontains': str(valor)})
            if op == 'eq':
                return Q(**{f'{field}__iexact': str(valor)})
            if op == 'neq':
                return ~Q(**{f'{field}__iexact': str(valor)})

        if tipo == 'numero':
            if op == 'gt':  return Q(**{f'{field}__gt':  _to_number(valor)})
            if op == 'gte': return Q(**{f'{field}__gte': _to_number(valor)})
            if op == 'lt':  return Q(**{f'{field}__lt':  _to_number(valor)})
            if op == 'lte': return Q(**{f'{field}__lte': _to_number(valor)})
            if op == 'eq':  return Q(**{f'{field}': _to_number(valor)})
            if op == 'between':
                if not isinstance(valor, list) or len(valor) != 2:
                    return None
                a, b = _to_number(valor[0]), _to_number(valor[1])
                if a is None and b is None:
                    return None
                q = Q()
                if a is not None: q &= Q(**{f'{field}__gte': a})
                if b is not None: q &= Q(**{f'{field}__lte': b})
                return q

        if tipo == 'fecha':
            now = timezone.now()
            if op == 'this_month':
                start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                return Q(**{f'{field}__gte': start})
            if op == 'this_year':
                start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
                return Q(**{f'{field}__gte': start})
            if op == 'last_30d':
                start = now - timedelta(days=30)
                return Q(**{f'{field}__gte': start})
            if op == 'gte':
                d = _to_date(valor)
                if not d: return None
                return Q(**{f'{field}__gte': d})
            if op == 'lte':
                d = _to_date(valor)
                if not d: return None
                return Q(**{f'{field}__lte': d})
            if op == 'between':
                if not isinstance(valor, list) or len(valor) != 2:
                    return None
                da, db = _to_date(valor[0]), _to_date(valor[1])
                if da is None and db is None: return None
                q = Q()
                if da: q &= Q(**{f'{field}__gte': da})
                if db: q &= Q(**{f'{field}__lte': db})
                return q

        if tipo == 'opciones':
            if not isinstance(valor, list):
                valor = [valor]
            valor = [v for v in valor if v not in (None, '')]
            if not valor:
                return None
            # Para campos booleanos / FK: convertimos strings
            if field.endswith('_id') or field == 'usuario_id':
                valor = [int(v) for v in valor]
            elif field == 'completada':
                valor = [str(v).lower() in ('true','1','yes') for v in valor]
            if op == 'in':
                return Q(**{f'{field}__in': valor})
            if op == 'not_in':
                return ~Q(**{f'{field}__in': valor})
    except (TypeError, ValueError):
        return None
    return None


def _to_number(v):
    if v is None or v == '':
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _to_date(v):
    if not v:
        return None
    try:
        if isinstance(v, str):
            # YYYY-MM-DD o ISO
            return datetime.fromisoformat(v.replace('Z', '+00:00'))
        return v
    except (TypeError, ValueError):
        return None


def _parse_config_personalizado(request):
    """Acepta JSON body (POST) o query params (GET) y devuelve un dict
    normalizado. Si algo falla, devuelve dict con defaults seguros."""
    body = {}
    if request.method == 'POST':
        try:
            body = json.loads(request.body.decode('utf-8') or '{}')
        except (ValueError, UnicodeDecodeError):
            body = {}
    else:
        body = {
            'entidad': request.GET.get('entidad', 'oportunidades'),
            'page': request.GET.get('page', 1),
            'page_size': request.GET.get('page_size', 50),
        }

    entidad = body.get('entidad') or 'oportunidades'
    if entidad not in _SCHEMAS_PERSONALIZADO:
        entidad = 'oportunidades'

    filtros = body.get('filtros') or []
    if not isinstance(filtros, list):
        filtros = []

    columnas = body.get('columnas') or []
    if not isinstance(columnas, list):
        columnas = []

    agrupar_por = body.get('agrupar_por') or None
    if agrupar_por == '':
        agrupar_por = None

    ordenar_por = body.get('ordenar_por') or None
    if ordenar_por == '':
        ordenar_por = None

    orden_dir = body.get('orden_dir') or 'desc'
    if orden_dir not in ('asc', 'desc'):
        orden_dir = 'desc'

    try:
        page = max(1, int(body.get('page') or 1))
    except (TypeError, ValueError):
        page = 1

    try:
        page_size = int(body.get('page_size') or 50)
    except (TypeError, ValueError):
        page_size = 50
    # 0 = sin paginar (para export). Cap defensivo a 5000.
    if page_size != 0:
        page_size = max(1, min(page_size, 500))
    else:
        page_size = 5000

    export_mode = bool(body.get('export'))

    return {
        'entidad': entidad,
        'filtros': filtros,
        'columnas': columnas,
        'agrupar_por': agrupar_por,
        'ordenar_por': ordenar_por,
        'orden_dir': orden_dir,
        'page': page,
        'page_size': page_size,
        'export_mode': export_mode,
    }


def _opciones_para_entidad(entidad, user):
    """Para los filtros de tipo "opciones": devuelve listas para los
    campos que dependen de la BD (vendedores, etapas, productos, áreas).
    """
    visible_ids = get_usuarios_visibles_ids(user)
    qs_u = User.objects.filter(is_active=True).order_by('first_name', 'last_name')
    if visible_ids:
        qs_u = qs_u.filter(id__in=visible_ids)
    vendedores = [
        {'id': u.id, 'nombre': u.get_full_name() or u.username}
        for u in qs_u
    ]

    etapas = []
    for nombre in (
        EtapaPipeline.objects
        .filter(activo=True)
        .order_by('pipeline', 'orden')
        .values_list('nombre', flat=True)
        .distinct()
    ):
        if nombre and nombre not in etapas:
            etapas.append(nombre)
    etapas_dict = [{'id': n, 'nombre': n} for n in etapas]

    productos = [{'id': p[0], 'nombre': p[1]} for p in TodoItem.PRODUCTO_CHOICES]
    areas = [{'id': a[0], 'nombre': a[1]} for a in TodoItem.AREA_CHOICES]

    return {
        'vendedores': vendedores,
        'etapas': etapas_dict,
        'productos': productos,
        'areas': areas,
    }


@login_required
def reporte_personalizado(request):
    """Vista del constructor visual de reportes."""
    ctx = _sidebar_context(request)
    reporte = REPORTES_BY_SLUG.get('personalizado', {
        'slug': 'personalizado',
        'titulo': 'Reporte Personalizado',
    })
    # Username humano para los metadatos del CSV
    user = request.user
    nombre_humano = user.get_full_name() or user.username

    # _scripts_main.html (incluido al final para que openDetalle exista)
    # depende de algunas variables del CRM. Las llenamos con valores
    # mínimos para que el partial no truene y la JS quede armada.
    etapas_pipeline_json = json.dumps([
        {'nombre': n, 'color': c, 'pipeline': pl}
        for pl, n, c in EtapaPipeline.objects
            .filter(activo=True)
            .order_by('pipeline', 'orden')
            .values_list('pipeline', 'nombre', 'color')
    ])

    ctx.update({
        'reporte': reporte,
        'tab_activo': 'reportes',
        'usuario_full_name': json.dumps(nombre_humano),
        'etapas_pipeline_json': etapas_pipeline_json,
        'vendedores_filter': '',
    })
    return render(request, 'reportes/personalizado.html', ctx)


@login_required
def api_reporte_personalizado(request):
    """POST /app/api/reportes/personalizado/  (también acepta GET)

    Body JSON:
      {
        "entidad": "oportunidades" | "clientes" | "actividades",
        "filtros": [{"campo":..., "op":..., "valor":...}, ...],
        "columnas": ["campo1", "campo2", ...],
        "agrupar_por": "campo" | null,
        "ordenar_por": "campo" | null,
        "orden_dir": "asc" | "desc",
        "page": 1,
        "page_size": 50,
        "export": false
      }

    Devuelve:
      {
        "ok": true,
        "entidad": ...,
        "agrupar_por": ...,
        "kpis": [{"label":..., "value":..., "value_display":..., "sub":...}],
        "columnas": [{"key":..., "label":..., "tipo":..., "align":..., "formato":...}],
        "filas": [{...}],
        "total_filas": N,
        "total_paginas": M,
        "total_monto": ...,         # cuando aplica
        "opciones": {vendedores, etapas, productos, areas},
      }
    """
    user = request.user
    cfg = _parse_config_personalizado(request)
    entidad = cfg['entidad']
    schema = _SCHEMAS_PERSONALIZADO[entidad]['schema_fn']()

    # Whitelist columnas / orden / agrupar contra el schema
    columnas_validas = [c for c in cfg['columnas'] if c in schema]
    agrupar_por = cfg['agrupar_por'] if cfg['agrupar_por'] in schema else None
    if agrupar_por and agrupar_por not in _SCHEMAS_PERSONALIZADO[entidad]['agrupables']:
        agrupar_por = None
    ordenar_por = cfg['ordenar_por'] if cfg['ordenar_por'] in schema else None

    # Si no nos pasaron columnas, ponemos 5 por defecto del schema
    if not columnas_validas:
        columnas_validas = list(schema.keys())[:5]
    if not ordenar_por:
        ordenar_por = columnas_validas[0]

    # ── Construcción del queryset según entidad ────────────────────
    if entidad == 'oportunidades':
        qs, total_filas, filas_paginadas, total_monto = _query_oportunidades(
            user, schema, cfg['filtros'], columnas_validas, agrupar_por,
            ordenar_por, cfg['orden_dir'], cfg['page'], cfg['page_size'],
        )
    elif entidad == 'clientes':
        qs, total_filas, filas_paginadas, total_monto = _query_clientes(
            user, schema, cfg['filtros'], columnas_validas, agrupar_por,
            ordenar_por, cfg['orden_dir'], cfg['page'], cfg['page_size'],
        )
    else:  # actividades
        qs, total_filas, filas_paginadas, total_monto = _query_actividades(
            user, schema, cfg['filtros'], columnas_validas, agrupar_por,
            ordenar_por, cfg['orden_dir'], cfg['page'], cfg['page_size'],
        )

    # ── Serializar filas ───────────────────────────────────────────
    filas_out = []
    last_group = None
    grupo_meta = schema.get(agrupar_por) if agrupar_por else None
    for obj in filas_paginadas:
        row = {}
        for k in columnas_validas:
            row[k] = schema[k]['row_value'](obj)
        # Si entidad lo permite, exponemos el id para click-to-open
        if entidad == 'oportunidades':
            row['id'] = obj.id
        if grupo_meta:
            grupo_label = grupo_meta['row_value'](obj)
            if grupo_label is None:
                grupo_label = '(sin valor)'
            row['__grupo_label'] = str(grupo_label)
        filas_out.append(row)

    # ── Columnas serializadas (con metadatos para el front) ────────
    columnas_out = []
    for k in columnas_validas:
        m = schema[k]
        columnas_out.append({
            'key': k,
            'label': m['label'],
            'tipo': m['tipo'],
            'align': m.get('align', 'left'),
            'formato': m.get('formato'),
        })

    # ── KPIs dinámicos según entidad ───────────────────────────────
    kpis = _kpis_personalizado(entidad, schema, total_filas, total_monto, cfg, filas_paginadas)

    # ── Paginación ─────────────────────────────────────────────────
    if cfg['page_size'] >= 5000:  # export
        total_paginas = 1
    else:
        total_paginas = max(1, (total_filas + cfg['page_size'] - 1) // cfg['page_size'])

    return JsonResponse({
        'ok': True,
        'entidad': entidad,
        'agrupar_por': agrupar_por,
        'kpis': kpis,
        'columnas': columnas_out,
        'filas': filas_out,
        'total_filas': total_filas,
        'total_paginas': total_paginas,
        'total_monto': total_monto,
        'opciones': _opciones_para_entidad(entidad, user),
    })


def _kpis_personalizado(entidad, schema, total_filas, total_monto, cfg, filas):
    """Genera 3-4 KPIs útiles según la entidad."""
    kpis = [{
        'label': 'Total registros',
        'value': total_filas,
        'value_display': f'{total_filas:,}'.replace(',', ','),
    }]

    if total_monto is not None:
        kpis.append({
            'label': 'Suma monto',
            'value': total_monto,
            'value_display': _money_display(total_monto),
            'sub': 'MXN',
        })
        if total_filas > 0:
            avg = total_monto / total_filas
            kpis.append({
                'label': 'Promedio',
                'value': avg,
                'value_display': _money_display(avg),
                'sub': 'por registro',
            })

    if entidad == 'oportunidades':
        # Si hay filas paginadas, calculamos promedio de probabilidad
        if filas:
            probs = [getattr(o, 'probabilidad_cierre', 0) or 0 for o in filas]
            if probs:
                avg_prob = sum(probs) / len(probs)
                kpis.append({
                    'label': 'Prob. promedio',
                    'value': round(avg_prob, 1),
                    'value_display': f'{round(avg_prob, 1)}%',
                    'sub': 'en la página',
                })

    return kpis


def _money_display(n):
    try:
        n = float(n)
    except (TypeError, ValueError):
        return '$0'
    abs_n = abs(n)
    if abs_n >= 1_000_000:
        return f'${n/1_000_000:.1f}M'.replace('.0M', 'M')
    if abs_n >= 1_000:
        return f'${n/1_000:.0f}K'
    return f'${int(round(n)):,}'


def _aplicar_filtros(qs, schema, filtros):
    """Aplica los filtros del request al queryset con whitelist."""
    for f in filtros:
        if not isinstance(f, dict):
            continue
        campo = f.get('campo')
        op = f.get('op')
        valor = f.get('valor')
        if campo not in schema:
            continue
        q = _construir_q_filtro(schema[campo], op, valor)
        if q is not None:
            qs = qs.filter(q)
    return qs


def _query_oportunidades(user, schema, filtros, columnas, agrupar_por, ordenar_por, orden_dir, page, page_size):
    qs = TodoItem.objects.select_related('cliente', 'usuario')

    # Visibilidad
    visible_ids = get_usuarios_visibles_ids(user)
    if visible_ids is not None:
        qs = qs.filter(usuario_id__in=visible_ids)

    # Filtros
    qs = _aplicar_filtros(qs, schema, filtros)

    # Orden — primero por agrupación, luego por ordenar_por
    orden = []
    if agrupar_por:
        orden.append(schema[agrupar_por]['orm_field'])
    if ordenar_por:
        prefix = '-' if orden_dir == 'desc' else ''
        orden.append(prefix + schema[ordenar_por]['orm_field'])
    if orden:
        qs = qs.order_by(*orden)

    total_filas = qs.count()

    # Total monto (siempre lo calculamos para opps)
    total_monto = qs.aggregate(s=Sum('monto'))['s']
    total_monto = float(total_monto or 0)

    # Paginación
    offset = (page - 1) * page_size
    filas = list(qs[offset:offset + page_size])

    return qs, total_filas, filas, total_monto


def _query_clientes(user, schema, filtros, columnas, agrupar_por, ordenar_por, orden_dir, page, page_size):
    visible_ids = get_usuarios_visibles_ids(user)

    # Reusar la lógica de etapas abiertas / ganadas / perdidas
    etapas_map = _etapas_vendido_en_adelante()
    etapas_abiertas = []
    for arr in etapas_map.values():
        etapas_abiertas.extend(arr)

    # Etapas terminales reconocidas (mismas que los Reportes 2 y 3 de
    # pruebas). Usamos minúsculas: el TodoItem guarda etapa_corta con la
    # capitalización original — pero el catálogo del CRM normaliza a
    # title case, así que ambos sets de prueba cubren el matching.
    etapas_ganadas = ['Ganada', 'Ganado', 'Pagada', 'Pagado', 'ganada', 'pagada']
    etapas_perdidas = ['Perdida', 'Perdido', 'perdida']

    qs = Cliente.objects.select_related('asignado_a')

    if visible_ids is not None:
        qs = qs.filter(Q(asignado_a_id__in=visible_ids) | Q(asignado_a__isnull=True))

    qs = qs.annotate(
        _opps_abiertas=Count('oportunidades', filter=Q(oportunidades__etapa_corta__in=etapas_abiertas), distinct=True),
        _opps_ganadas=Count('oportunidades', filter=Q(oportunidades__etapa_corta__in=etapas_ganadas), distinct=True),
        _opps_perdidas=Count('oportunidades', filter=Q(oportunidades__etapa_corta__in=etapas_perdidas), distinct=True),
        _monto_ganado=Sum('oportunidades__monto', filter=Q(oportunidades__etapa_corta__in=etapas_ganadas)),
        _monto_abierto=Sum('oportunidades__monto', filter=Q(oportunidades__etapa_corta__in=etapas_abiertas)),
    )

    # Filtros (algunos campos son annotations — se filtra igual)
    qs = _aplicar_filtros(qs, schema, filtros)

    # Orden
    orden = []
    if agrupar_por:
        orden.append(schema[agrupar_por]['orm_field'])
    if ordenar_por:
        prefix = '-' if orden_dir == 'desc' else ''
        orden.append(prefix + schema[ordenar_por]['orm_field'])
    if orden:
        qs = qs.order_by(*orden)

    total_filas = qs.count()
    total_monto = qs.aggregate(s=Sum('_monto_ganado'))['s']
    total_monto = float(total_monto or 0)

    offset = (page - 1) * page_size
    filas = list(qs[offset:offset + page_size])

    return qs, total_filas, filas, total_monto


def _query_actividades(user, schema, filtros, columnas, agrupar_por, ordenar_por, orden_dir, page, page_size):
    qs = Actividad.objects.select_related('creado_por', 'oportunidad', 'oportunidad__cliente')

    visible_ids = get_usuarios_visibles_ids(user)
    if visible_ids is not None:
        qs = qs.filter(creado_por_id__in=visible_ids)

    qs = _aplicar_filtros(qs, schema, filtros)

    orden = []
    if agrupar_por:
        orden.append(schema[agrupar_por]['orm_field'])
    if ordenar_por:
        prefix = '-' if orden_dir == 'desc' else ''
        orden.append(prefix + schema[ordenar_por]['orm_field'])
    if orden:
        qs = qs.order_by(*orden)

    total_filas = qs.count()
    offset = (page - 1) * page_size
    filas = list(qs[offset:offset + page_size])

    return qs, total_filas, filas, None

