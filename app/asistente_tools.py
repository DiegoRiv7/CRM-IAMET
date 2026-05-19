# ----------------------------------------------------------------------
# asistente_tools.py — registro central de tools que el asistente puede
# llamar para consultar la BD. Patrón: usuario → AI → tool layer (este
# archivo) → BD. El AI NUNCA ejecuta SQL.
# ----------------------------------------------------------------------
# Cada tool tiene 2 partes:
#   1) `schema` (JSON OpenAI-compatible) que el modelo VE para saber
#      cuándo y cómo llamar la función.
#   2) `handler` (función Python) que ejecuta la query, RESPETANDO los
#      permisos del request.user.
#
# Para agregar una tool nueva: pega su schema en TOOL_SCHEMAS y registra
# su handler en TOOL_HANDLERS.
# ----------------------------------------------------------------------

import json
import logging
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.db.models import Count, Sum, Q, F
from django.utils import timezone

from .models import (
    Cliente, TodoItem, Cotizacion, Actividad, TareaOportunidad,
    UserProfile,
)
from .views_utils import is_supervisor

log = logging.getLogger(__name__)


# ─── Helpers de visibilidad ────────────────────────────────────────────

def _visible_user_ids(user: User) -> list[int] | None:
    """Devuelve los user_ids cuyos datos el `user` actual PUEDE ver.
    None = sin restricción (admin / supervisor global).
    """
    if is_supervisor(user) or user.is_superuser:
        return None
    try:
        from .views_grupos import get_usuarios_visibles_ids
        ids = get_usuarios_visibles_ids(user)
        return list(ids) if ids else [user.id]
    except Exception:
        return [user.id]


def _filter_by_visibilidad(qs, user, user_field='usuario'):
    """Aplica el filtro de visibilidad al queryset."""
    ids = _visible_user_ids(user)
    if ids is None:
        return qs
    return qs.filter(**{f'{user_field}_id__in': ids})


def _to_money(value) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


# ─── TOOLS ─────────────────────────────────────────────────────────────


# 1. Clientes sin atender
def _tool_clientes_sin_atender(args: dict, user: User) -> dict:
    """Lista clientes que NO tienen oportunidades creadas en los últimos N meses."""
    meses = int(args.get('meses') or 2)
    meses = max(1, min(meses, 24))
    limite = int(args.get('limite') or 20)
    limite = max(1, min(limite, 100))

    desde = timezone.now() - timedelta(days=meses * 30)

    # Clientes visibles para el user
    clientes_qs = Cliente.objects.all()
    visible_ids = _visible_user_ids(user)
    if visible_ids is not None:
        clientes_qs = clientes_qs.filter(asignado_a_id__in=visible_ids)

    # Clientes con AL MENOS UNA oportunidad creada después de `desde`
    clientes_con_opp_reciente = TodoItem.objects.filter(
        fecha_creacion__gte=desde
    ).values_list('cliente_id', flat=True)

    inactivos = clientes_qs.exclude(
        id__in=clientes_con_opp_reciente
    ).select_related('asignado_a').order_by('nombre_empresa')[:limite]

    return {
        'meses_sin_atender': meses,
        'total': inactivos.count() if hasattr(inactivos, 'count') else len(list(inactivos)),
        'clientes': [
            {
                'id': c.id,
                'nombre': c.nombre_empresa,
                'asignado_a': (c.asignado_a.get_full_name() or c.asignado_a.username) if c.asignado_a_id else '—',
            }
            for c in inactivos
        ],
    }


# Helpers de clasificación por etapa (el CRM no tiene un enum estricto,
# usa substrings en `etapa_completa`).
_PERDIDO_KEYWORDS = ('perdido', 'cancelad')
_GANADO_KEYWORDS = ('ganado', 'pagado', 'cobrado', 'facturado')


def _q_perdidas() -> Q:
    q = Q()
    for kw in _PERDIDO_KEYWORDS:
        q |= Q(etapa_completa__icontains=kw)
    return q


def _q_ganadas() -> Q:
    q = Q()
    for kw in _GANADO_KEYWORDS:
        q |= Q(etapa_completa__icontains=kw)
    return q


# 2. Ranking de vendedores
def _tool_ranking_vendedores(args: dict, user: User) -> dict:
    """Vendedores ordenados por oportunidades creadas o ganadas en un periodo."""
    if not (is_supervisor(user) or user.is_superuser):
        return {'error': 'Solo supervisores y admins pueden ver el ranking del equipo.'}

    metrica = args.get('metrica', 'oportunidades_creadas')
    if metrica not in ('oportunidades_creadas', 'monto_ganado'):
        metrica = 'oportunidades_creadas'

    periodo_meses = int(args.get('periodo_meses') or 1)
    periodo_meses = max(1, min(periodo_meses, 24))
    orden = args.get('orden', 'top')
    if orden not in ('top', 'bottom'):
        orden = 'top'

    desde = timezone.now() - timedelta(days=periodo_meses * 30)

    if metrica == 'oportunidades_creadas':
        qs = (
            TodoItem.objects.filter(fecha_creacion__gte=desde)
            .values('usuario_id', 'usuario__first_name', 'usuario__last_name', 'usuario__username')
            .annotate(total=Count('id'))
            .order_by('-total' if orden == 'top' else 'total')[:10]
        )
        return {
            'metrica': metrica,
            'periodo_meses': periodo_meses,
            'orden': orden,
            'vendedores': [
                {
                    'nombre': (r['usuario__first_name'] + ' ' + r['usuario__last_name']).strip() or r['usuario__username'],
                    'oportunidades_creadas': r['total'],
                }
                for r in qs
            ],
        }

    # monto_ganado: oportunidades creadas en el periodo cuya etapa indica
    # ganado / pagado / facturado / cobrado.
    qs = (
        TodoItem.objects.filter(fecha_creacion__gte=desde).filter(_q_ganadas())
        .values('usuario_id', 'usuario__first_name', 'usuario__last_name', 'usuario__username')
        .annotate(total=Sum('monto'))
        .order_by('-total' if orden == 'top' else 'total')[:10]
    )
    return {
        'metrica': metrica,
        'periodo_meses': periodo_meses,
        'orden': orden,
        'vendedores': [
            {
                'nombre': (r['usuario__first_name'] + ' ' + r['usuario__last_name']).strip() or r['usuario__username'],
                'monto_ganado_mxn': _to_money(r['total']),
            }
            for r in qs
        ],
    }


# 3. Resumen de empresa — mismo KPI que el dashboard del CRM
def _tool_resumen_empresa(args: dict, user: User) -> dict:
    """KPIs del periodo (dashboard del CRM): cotizado, facturado, cobrado,
    pipeline, oportunidades nuevas / ganadas / perdidas."""
    ahora = timezone.now()
    mes = int(args.get('mes') or ahora.month)
    anio = int(args.get('anio') or ahora.year)
    mes = max(1, min(mes, 12))

    base = TodoItem.objects.filter(fecha_creacion__year=anio, fecha_creacion__month=mes)
    visible_ids = _visible_user_ids(user)
    if visible_ids is not None:
        base = base.filter(usuario_id__in=visible_ids)

    nuevas_opp = base.count()

    activas = base.exclude(_q_perdidas())
    pipeline_periodo = activas.aggregate(total=Sum('monto')).get('total') or 0

    # Cotizado: monto total de Cotizacion objects creadas en el periodo.
    cot_qs = Cotizacion.objects.filter(fecha_creacion__year=anio, fecha_creacion__month=mes)
    if visible_ids is not None:
        cot_qs = cot_qs.filter(created_by_id__in=visible_ids)
    total_cotizado = cot_qs.aggregate(total=Sum('total')).get('total') or 0
    num_cotizaciones = cot_qs.count()

    # Facturado: oportunidades con etapa que contiene "facturad" o "factura" en el periodo.
    fact_qs = base.filter(etapa_corta__icontains='factur')
    total_facturado = fact_qs.aggregate(total=Sum('monto')).get('total') or 0
    num_facturadas = fact_qs.count()

    # Cobrado: oportunidades con etapa Ganado o Pagado.
    cob_qs = base.filter(etapa_corta__in=['Ganado', 'Pagado'])
    total_cobrado = cob_qs.aggregate(total=Sum('monto')).get('total') or 0
    num_cobradas = cob_qs.count()

    ganadas_qs = base.filter(_q_ganadas())
    ganadas_count = ganadas_qs.count()
    ganadas_monto = ganadas_qs.aggregate(total=Sum('monto')).get('total') or 0

    perdidas_count = base.filter(_q_perdidas()).count()

    # Clientes únicos del periodo
    num_clientes = base.values('cliente').distinct().count()

    return {
        'mes': mes,
        'anio': anio,
        'oportunidades_nuevas': nuevas_opp,
        'clientes_distintos': num_clientes,
        'pipeline_activo_mxn': _to_money(pipeline_periodo),
        'cotizado_mxn': _to_money(total_cotizado),
        'num_cotizaciones': num_cotizaciones,
        'facturado_mxn': _to_money(total_facturado),
        'num_facturadas': num_facturadas,
        'cobrado_mxn': _to_money(total_cobrado),
        'num_cobradas': num_cobradas,
        'oportunidades_ganadas': ganadas_count,
        'monto_ganado_mxn': _to_money(ganadas_monto),
        'oportunidades_perdidas': perdidas_count,
    }


# 4. Top oportunidades prometedoras
def _tool_top_oportunidades_prometedoras(args: dict, user: User) -> dict:
    """Oportunidades activas que más prometen (monto × probabilidad × recencia).

    Por DEFAULT filtra por mes_cierre = mes actual (las "que cierran este mes").
    Para ver las de otro mes pasa `mes` y `anio`. Para ignorar el filtro de mes
    y ver todo el pipeline activo, pasa `todos_los_meses=true`.
    """
    limite = int(args.get('limite') or 10)
    limite = max(1, min(limite, 30))

    ahora = timezone.now()
    todos = bool(args.get('todos_los_meses'))
    mes = args.get('mes')
    anio = args.get('anio')

    qs = TodoItem.objects.exclude(_q_perdidas())
    visible_ids = _visible_user_ids(user)
    if visible_ids is not None:
        qs = qs.filter(usuario_id__in=visible_ids)

    # Filtro por mes_cierre: default mes actual, override con mes/anio, o
    # ignorar si todos_los_meses=true.
    periodo_label = None
    if not todos:
        try:
            mm = int(mes) if mes else ahora.month
            aa = int(anio) if anio else ahora.year
        except (ValueError, TypeError):
            mm, aa = ahora.month, ahora.year
        mm = max(1, min(mm, 12))
        qs = qs.filter(mes_cierre=str(mm).zfill(2), anio_cierre=aa)
        meses_es = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
        periodo_label = f'{meses_es[mm]} {aa}'

    qs = qs.select_related('cliente', 'usuario').order_by('-monto')[:limite * 3]

    items = []
    ahora = timezone.now()
    for opp in qs:
        ult_act = Actividad.objects.filter(oportunidad=opp).order_by('-fecha_inicio').first()
        dias_desde_ult = None
        if ult_act:
            dias_desde_ult = (ahora - ult_act.fecha_inicio).days
        items.append({
            'id': opp.id,
            'titulo': opp.oportunidad,
            'cliente': opp.cliente.nombre_empresa if opp.cliente_id else '—',
            'monto_mxn': _to_money(opp.monto),
            'probabilidad_pct': opp.probabilidad_cierre or 0,
            'etapa': opp.etapa_corta or opp.etapa_completa or '—',
            'vendedor': (opp.usuario.get_full_name() or opp.usuario.username) if opp.usuario_id else '—',
            'dias_desde_ultima_actividad': dias_desde_ult,
        })

    # Score = monto × probabilidad × penalty por inactividad
    def _score(it):
        monto = it['monto_mxn'] or 0
        prob = (it['probabilidad_pct'] or 0) / 100.0
        if prob <= 0:
            prob = 0.15
        dias = it['dias_desde_ultima_actividad']
        penal = 1.0
        if dias is None:
            penal = 0.6
        elif dias > 30:
            penal = 0.5
        elif dias > 14:
            penal = 0.8
        return monto * prob * penal

    items.sort(key=_score, reverse=True)
    return {
        'periodo': periodo_label,  # None si todos_los_meses=true
        'oportunidades': items[:limite],
    }


# 5. Forecast de cierre
def _tool_forecast_cierre(args: dict, user: User) -> dict:
    """Proyección de cierre del mes/periodo.

    Por default toma SOLO las oportunidades cuyo mes_cierre = mes actual y
    siguiente (filtro real de "cómo cerraremos el mes"). Acepta override
    explícito si el user pide un mes/año diferente.

    Args opcionales:
        - mes (1-12), anio (4d): filtra por ese mes_cierre específico.
        - rango_meses (int): cuántos meses adelante incluir desde el mes
          base (default 2 = mes actual + siguiente).
    """
    ahora = timezone.now()
    rango = int(args.get('rango_meses') or 2)
    rango = max(1, min(rango, 12))

    # Si el user pasa mes/anio, se usa COMO INICIAL y se cuenta hacia
    # adelante `rango` meses (default 2).
    # Si NO pasa nada, default es mes_anterior + mes_actual (las opp
    # cuyo cierre ya pasó pero siguen abiertas + las que cierran ahora).
    if args.get('mes') or args.get('anio'):
        mes_base = int(args.get('mes') or ahora.month)
        anio_base = int(args.get('anio') or ahora.year)
        pares = []
        m, a = mes_base, anio_base
        for _ in range(rango):
            pares.append((m, a))
            m += 1
            if m > 12:
                m = 1; a += 1
    else:
        # Default: mes anterior + mes actual.
        mes_actual = ahora.month
        anio_actual = ahora.year
        mes_ant = mes_actual - 1
        anio_ant = anio_actual
        if mes_ant < 1:
            mes_ant = 12; anio_ant = anio_actual - 1
        pares = [(mes_ant, anio_ant), (mes_actual, anio_actual)]

    # Filtro por mes_cierre (string '01'..'12') y anio_cierre (int).
    q_periodo = Q()
    for (mm, aa) in pares:
        q_periodo |= Q(mes_cierre=str(mm).zfill(2), anio_cierre=aa)

    qs = TodoItem.objects.exclude(_q_perdidas()).filter(q_periodo)
    visible_ids = _visible_user_ids(user)
    if visible_ids is not None:
        qs = qs.filter(usuario_id__in=visible_ids)

    pipeline_total = 0.0
    forecast = 0.0
    por_etapa: dict[str, dict] = {}
    por_mes: dict[str, dict] = {}
    total_opp = 0

    meses_es = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

    for opp in qs.only('monto', 'probabilidad_cierre', 'etapa_corta',
                       'etapa_completa', 'mes_cierre', 'anio_cierre'):
        m = _to_money(opp.monto)
        p = (opp.probabilidad_cierre or 20) / 100.0
        pipeline_total += m
        forecast += m * p
        total_opp += 1

        etapa_key = opp.etapa_corta or opp.etapa_completa or 'sin_etapa'
        por_etapa.setdefault(etapa_key, {'monto': 0.0, 'forecast': 0.0, 'count': 0})
        por_etapa[etapa_key]['monto'] += m
        por_etapa[etapa_key]['forecast'] += m * p
        por_etapa[etapa_key]['count'] += 1

        try:
            mn = int(opp.mes_cierre) if opp.mes_cierre else 0
            label = f'{meses_es[mn]} {opp.anio_cierre}' if 1 <= mn <= 12 else f'{opp.anio_cierre}'
        except (ValueError, TypeError):
            label = 'sin definir'
        por_mes.setdefault(label, {'monto': 0.0, 'forecast': 0.0, 'count': 0})
        por_mes[label]['monto'] += m
        por_mes[label]['forecast'] += m * p
        por_mes[label]['count'] += 1

    top_etapas = sorted(por_etapa.items(), key=lambda kv: kv[1]['monto'], reverse=True)[:5]
    desglose_mes = sorted(por_mes.items(), key=lambda kv: kv[1]['monto'], reverse=True)

    periodo_str = ' / '.join(f'{meses_es[mm]} {aa}' for mm, aa in pares)

    return {
        'periodo': periodo_str,
        'meses_incluidos': pares,
        'oportunidades_consideradas': total_opp,
        'pipeline_total_mxn': round(pipeline_total, 2),
        'forecast_ponderado_mxn': round(forecast, 2),
        'desglose_por_mes': [
            {'mes': k, 'monto_mxn': round(v['monto'], 2), 'forecast_mxn': round(v['forecast'], 2), 'count': v['count']}
            for k, v in desglose_mes
        ],
        'desglose_por_etapa': [
            {'etapa': k, 'monto_mxn': round(v['monto'], 2), 'forecast_mxn': round(v['forecast'], 2), 'count': v['count']}
            for k, v in top_etapas
        ],
        'nota': (
            'forecast_ponderado = suma(monto × probabilidad_cierre del CRM). '
            'Solo se incluyen oportunidades cuyo mes_cierre cae en el periodo.'
        ),
    }


# 6. Oportunidades por vendedor (lista detallada con IDs para click-to-open)
def _tool_oportunidades_por_vendedor(args: dict, user: User) -> dict:
    """Lista las oportunidades de un vendedor en un periodo. Incluye `id` para
    que el chat las renderee como links que abren el widget."""
    vendedor = (args.get('vendedor_username') or args.get('vendedor') or '').strip()
    if not vendedor:
        return {'error': 'Falta el username del vendedor.'}
    try:
        target = User.objects.get(username=vendedor)
    except User.DoesNotExist:
        # Intentar buscar por nombre completo (fuzzy)
        partes = vendedor.split()
        target = None
        if len(partes) >= 1:
            qs = User.objects.filter(
                Q(first_name__icontains=partes[0]) | Q(last_name__icontains=partes[0])
            )
            if len(partes) >= 2:
                qs = qs.filter(
                    Q(first_name__icontains=partes[1]) | Q(last_name__icontains=partes[1])
                )
            target = qs.first()
        if not target:
            return {'error': f'No encuentro al vendedor "{vendedor}".'}

    # Permisos: si el caller no es supervisor, solo puede ver SUS propias opp.
    if not _can_see_all(user) and target.id != user.id:
        return {'error': 'Solo supervisores pueden consultar las oportunidades de otros vendedores.'}

    # Periodo: por default últimos 12 meses
    desde = None; hasta = None
    if args.get('mes_desde') and args.get('anio_desde'):
        try:
            from datetime import datetime as _dt
            desde = timezone.make_aware(_dt(int(args['anio_desde']), int(args['mes_desde']), 1))
        except Exception:
            desde = None
    if args.get('mes_hasta') and args.get('anio_hasta'):
        try:
            from datetime import datetime as _dt
            import calendar
            anio_h = int(args['anio_hasta']); mes_h = int(args['mes_hasta'])
            last_day = calendar.monthrange(anio_h, mes_h)[1]
            hasta = timezone.make_aware(_dt(anio_h, mes_h, last_day, 23, 59, 59))
        except Exception:
            hasta = None
    if not desde:
        desde = timezone.now() - timedelta(days=365)
    if not hasta:
        hasta = timezone.now()

    limite = int(args.get('limite') or 200)
    limite = max(1, min(limite, 500))

    qs = TodoItem.objects.filter(
        usuario=target,
        fecha_creacion__gte=desde,
        fecha_creacion__lte=hasta,
    ).select_related('cliente').order_by('-fecha_creacion')[:limite]

    items = []
    for opp in qs:
        items.append({
            'id': opp.id,
            'titulo': opp.oportunidad,
            'cliente': opp.cliente.nombre_empresa if opp.cliente_id else '—',
            'monto_mxn': _to_money(opp.monto),
            'etapa': opp.etapa_corta or opp.etapa_completa or '—',
            'producto': opp.producto or '—',
            'probabilidad_pct': opp.probabilidad_cierre or 0,
            'fecha_creacion': opp.fecha_creacion.strftime('%Y-%m-%d') if opp.fecha_creacion else '—',
        })

    return {
        'vendedor': target.get_full_name() or target.username,
        'username': target.username,
        'desde': desde.strftime('%Y-%m-%d'),
        'hasta': hasta.strftime('%Y-%m-%d'),
        'total': len(items),
        'oportunidades': items,
    }


# 7. Detalle de una oportunidad específica
def _tool_detalle_oportunidad(args: dict, user: User) -> dict:
    """Info completa de una oportunidad por ID."""
    try:
        opp_id = int(args.get('id') or 0)
    except (ValueError, TypeError):
        opp_id = 0
    if not opp_id:
        return {'error': 'Falta el id de la oportunidad.'}
    try:
        opp = TodoItem.objects.select_related('cliente', 'usuario', 'contacto').get(pk=opp_id)
    except TodoItem.DoesNotExist:
        return {'error': f'Oportunidad #{opp_id} no encontrada.'}

    # Permisos
    visible_ids = _visible_user_ids(user)
    if visible_ids is not None and opp.usuario_id not in visible_ids:
        return {'error': 'No tienes permiso para ver esta oportunidad.'}

    return {
        'id': opp.id,
        'titulo': opp.oportunidad,
        'cliente': opp.cliente.nombre_empresa if opp.cliente_id else '—',
        'contacto': (opp.contacto.nombre + ' ' + (opp.contacto.apellido or '')).strip() if opp.contacto_id else '—',
        'vendedor': (opp.usuario.get_full_name() or opp.usuario.username) if opp.usuario_id else '—',
        'monto_mxn': _to_money(opp.monto),
        'producto': opp.producto or '—',
        'area': opp.area or '—',
        'tipo_negociacion': opp.tipo_negociacion or '—',
        'etapa_corta': opp.etapa_corta or '—',
        'etapa_completa': opp.etapa_completa or '—',
        'probabilidad_pct': opp.probabilidad_cierre or 0,
        'mes_cierre': opp.mes_cierre or '—',
        'anio_cierre': opp.anio_cierre,
        'comentarios': (opp.comentarios or '')[:500],
        'po_number': opp.po_number or '',
        'factura_numero': opp.factura_numero or '',
        'fecha_creacion': opp.fecha_creacion.strftime('%Y-%m-%d') if opp.fecha_creacion else '—',
        'fecha_actualizacion': opp.fecha_actualizacion.strftime('%Y-%m-%d') if opp.fecha_actualizacion else '—',
    }


# 8. Perfil / desempeño de un vendedor
def _tool_detalle_vendedor(args: dict, user: User) -> dict:
    """Perfil de un vendedor: opp activas, ganadas/perdidas del mes y del año,
    clientes asignados, monto generado. Solo supervisores y admins."""
    if not (is_supervisor(user) or user.is_superuser):
        return {'error': 'Solo supervisores y admins pueden ver el perfil completo de un vendedor.'}

    vendedor = (args.get('vendedor_username') or args.get('vendedor') or '').strip()
    if not vendedor:
        return {'error': 'Falta el username del vendedor.'}
    try:
        target = User.objects.get(username=vendedor)
    except User.DoesNotExist:
        partes = vendedor.split()
        target = None
        if partes:
            qs = User.objects.filter(
                Q(first_name__icontains=partes[0]) | Q(last_name__icontains=partes[0])
            )
            target = qs.first()
        if not target:
            return {'error': f'No encuentro al vendedor "{vendedor}".'}

    ahora = timezone.now()
    inicio_mes = timezone.make_aware(
        timezone.datetime(ahora.year, ahora.month, 1)
    ) if hasattr(timezone, 'datetime') else None
    # Fallback safe
    from datetime import datetime as _dt
    inicio_mes = timezone.make_aware(_dt(ahora.year, ahora.month, 1))
    inicio_anio = timezone.make_aware(_dt(ahora.year, 1, 1))

    opp_base = TodoItem.objects.filter(usuario=target)
    activas = opp_base.exclude(_q_perdidas())
    pipeline_total = activas.aggregate(total=Sum('monto')).get('total') or 0
    opp_activas_count = activas.count()

    # Mes actual
    opp_mes = opp_base.filter(fecha_creacion__gte=inicio_mes)
    nuevas_mes = opp_mes.count()
    ganadas_mes = opp_mes.filter(_q_ganadas()).aggregate(total=Sum('monto')).get('total') or 0
    ganadas_mes_count = opp_mes.filter(_q_ganadas()).count()

    # Año actual
    opp_anio = opp_base.filter(fecha_creacion__gte=inicio_anio)
    nuevas_anio = opp_anio.count()
    ganadas_anio = opp_anio.filter(_q_ganadas()).aggregate(total=Sum('monto')).get('total') or 0

    # Clientes asignados
    clientes_count = Cliente.objects.filter(asignado_a=target).count()

    # Rol
    rol = 'vendedor'
    try:
        prof = UserProfile.objects.filter(user=target).first()
        if prof:
            rol = prof.get_rol_display() if hasattr(prof, 'get_rol_display') else str(prof.rol)
    except Exception:
        pass

    return {
        'username': target.username,
        'nombre': target.get_full_name() or target.username,
        'rol': rol,
        'oportunidades_activas': opp_activas_count,
        'pipeline_activo_mxn': _to_money(pipeline_total),
        'clientes_asignados': clientes_count,
        'mes_actual': {
            'nuevas_oportunidades': nuevas_mes,
            'ganadas': ganadas_mes_count,
            'monto_ganado_mxn': _to_money(ganadas_mes),
        },
        'anio_actual': {
            'nuevas_oportunidades': nuevas_anio,
            'monto_ganado_mxn': _to_money(ganadas_anio),
        },
    }


# 9b. Oportunidades por periodo (sin filtrar por vendedor)
def _tool_oportunidades_por_periodo(args: dict, user: User) -> dict:
    """Lista las oportunidades CREADAS en un periodo, opcionalmente filtradas
    por etapa, monto mínimo, o producto. Respeta permisos de visibilidad."""
    ahora = timezone.now()
    mes = int(args.get('mes') or ahora.month)
    anio = int(args.get('anio') or ahora.year)
    mes = max(1, min(mes, 12))

    qs = TodoItem.objects.filter(
        fecha_creacion__year=anio,
        fecha_creacion__month=mes,
    ).select_related('cliente', 'usuario')

    visible_ids = _visible_user_ids(user)
    if visible_ids is not None:
        qs = qs.filter(usuario_id__in=visible_ids)

    # Filtros opcionales
    etapa_kw = (args.get('etapa') or '').strip()
    if etapa_kw:
        qs = qs.filter(Q(etapa_corta__icontains=etapa_kw) | Q(etapa_completa__icontains=etapa_kw))

    monto_min = args.get('monto_minimo')
    if monto_min:
        try:
            qs = qs.filter(monto__gte=float(monto_min))
        except (ValueError, TypeError):
            pass

    limite = int(args.get('limite') or 100)
    limite = max(1, min(limite, 500))

    qs = qs.order_by('-monto')[:limite]

    items = []
    for opp in qs:
        items.append({
            'id': opp.id,
            'titulo': opp.oportunidad,
            'cliente': opp.cliente.nombre_empresa if opp.cliente_id else '—',
            'vendedor': (opp.usuario.get_full_name() or opp.usuario.username) if opp.usuario_id else '—',
            'monto_mxn': _to_money(opp.monto),
            'etapa': opp.etapa_corta or opp.etapa_completa or '—',
            'producto': opp.producto or '—',
            'fecha_creacion': opp.fecha_creacion.strftime('%Y-%m-%d') if opp.fecha_creacion else '—',
        })

    return {
        'mes': mes,
        'anio': anio,
        'etapa_filtro': etapa_kw or None,
        'monto_minimo': monto_min,
        'total': len(items),
        'oportunidades': items,
    }


# 10. Generar reporte Excel descargable
def _tool_generar_reporte_excel(args: dict, user: User) -> dict:
    """Crea un archivo XLSX con las oportunidades del periodo y devuelve
    una URL de descarga válida por 1 hora. El reporte respeta permisos
    de visibilidad del user."""
    import uuid
    from django.core.cache import cache

    ahora = timezone.now()
    mes = args.get('mes')
    anio = args.get('anio')
    if mes:
        try: mes = max(1, min(int(mes), 12))
        except (ValueError, TypeError): mes = ahora.month
    if anio:
        try: anio = int(anio)
        except (ValueError, TypeError): anio = ahora.year

    tipo = (args.get('tipo') or 'oportunidades').lower()
    vendedor_username = (args.get('vendedor_username') or '').strip()

    # Token corto para autorizar la descarga (1 hora de vida).
    token = uuid.uuid4().hex[:16]
    payload = {
        'tipo': tipo,
        'mes': mes,
        'anio': anio,
        'vendedor_username': vendedor_username,
        'user_id': user.id,
    }
    cache.set('asist_xlsx_' + token, payload, timeout=3600)

    url = '/app/api/asistente/reporte/xlsx/?token=' + token

    nombre_periodo = ''
    if mes and anio:
        meses_es = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
        nombre_periodo = f' de {meses_es[mes]} {anio}'

    return {
        'ok': True,
        'tipo': tipo,
        'download_url': url,
        'mensaje': f'Reporte Excel listo: {tipo}{nombre_periodo}. El link es válido por 1 hora.',
    }


# 9. Clientes asignados a un vendedor
def _tool_clientes_de_vendedor(args: dict, user: User) -> dict:
    """Lista los clientes asignados a un vendedor (cartera)."""
    vendedor = (args.get('vendedor_username') or args.get('vendedor') or '').strip()
    if not vendedor:
        return {'error': 'Falta el username del vendedor.'}
    try:
        target = User.objects.get(username=vendedor)
    except User.DoesNotExist:
        partes = vendedor.split()
        target = None
        if partes:
            qs = User.objects.filter(
                Q(first_name__icontains=partes[0]) | Q(last_name__icontains=partes[0])
            )
            target = qs.first()
        if not target:
            return {'error': f'No encuentro al vendedor "{vendedor}".'}

    # Permisos: solo supervisor o el mismo vendedor.
    if not _can_see_all(user) and target.id != user.id:
        return {'error': 'Solo supervisores pueden ver la cartera de otros vendedores.'}

    limite = int(args.get('limite') or 50)
    limite = max(1, min(limite, 300))

    clientes = Cliente.objects.filter(asignado_a=target).order_by('nombre_empresa')[:limite]
    items = []
    for c in clientes:
        # Cuántas opp activas tiene cada cliente con este vendedor
        opp_activas = TodoItem.objects.filter(
            cliente=c, usuario=target
        ).exclude(_q_perdidas()).count()
        items.append({
            'id': c.id,
            'nombre': c.nombre_empresa,
            'oportunidades_activas': opp_activas,
        })

    return {
        'vendedor': target.get_full_name() or target.username,
        'username': target.username,
        'total_clientes': len(items),
        'clientes': items,
    }


# ─── REGISTRO ──────────────────────────────────────────────────────────

TOOL_SCHEMAS: list[dict] = [
    {
        'type': 'function',
        'function': {
            'name': 'clientes_sin_atender',
            'description': (
                'Lista clientes que NO han tenido oportunidades creadas en '
                'los últimos N meses. Útil para "dame los clientes que llevan '
                'X meses sin que nadie les haga seguimiento" o "clientes '
                'olvidados".'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'meses': {
                        'type': 'integer',
                        'description': 'Cuántos meses sin actividad. Default 2.',
                        'minimum': 1, 'maximum': 24,
                    },
                    'limite': {
                        'type': 'integer',
                        'description': 'Máximo de clientes a devolver. Default 20.',
                        'minimum': 1, 'maximum': 100,
                    },
                },
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'ranking_vendedores',
            'description': (
                'Ranking de vendedores por oportunidades creadas o monto '
                'ganado (oportunidades con etapa ganado/pagado/facturado/'
                'cobrado) en un periodo. Solo supervisores y admins. '
                'Útil para "los vendedores que más han trabajado" o "los '
                'que menos producen este mes".'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'metrica': {
                        'type': 'string',
                        'enum': ['oportunidades_creadas', 'monto_ganado'],
                        'description': 'Qué medir. Default oportunidades_creadas.',
                    },
                    'periodo_meses': {
                        'type': 'integer',
                        'description': 'Cuántos meses hacia atrás. Default 1.',
                        'minimum': 1, 'maximum': 24,
                    },
                    'orden': {
                        'type': 'string',
                        'enum': ['top', 'bottom'],
                        'description': 'top (mejores) o bottom (peores). Default top.',
                    },
                },
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'resumen_empresa',
            'description': (
                'KPIs de la empresa (o del equipo visible al usuario) para '
                'un mes específico: nuevas oportunidades, pipeline activo, '
                'ganadas (con monto) y perdidas. Útil para "cómo va el mes" '
                'o "resumen de mayo".'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'mes': {
                        'type': 'integer', 'minimum': 1, 'maximum': 12,
                        'description': 'Mes (1-12). Default: mes actual.',
                    },
                    'anio': {
                        'type': 'integer',
                        'description': 'Año (4 dígitos). Default: año actual.',
                    },
                },
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'top_oportunidades_prometedoras',
            'description': (
                'Lista las oportunidades activas que más prometen, '
                'considerando monto × probabilidad × recencia de actividad. '
                'Por DEFAULT filtra por mes_cierre = mes actual (las que '
                'cierran este mes). Para otro mes pasa mes y anio. Para '
                'ignorar el filtro de mes y ver todo el pipeline activo '
                'pasa todos_los_meses=true.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'limite': {
                        'type': 'integer', 'minimum': 1, 'maximum': 30,
                        'description': 'Cuántas oportunidades devolver. Default 10.',
                    },
                    'mes': {
                        'type': 'integer', 'minimum': 1, 'maximum': 12,
                        'description': 'Mes de cierre (1-12). Default: mes actual.',
                    },
                    'anio': {
                        'type': 'integer',
                        'description': 'Año de cierre. Default: año actual.',
                    },
                    'todos_los_meses': {
                        'type': 'boolean',
                        'description': 'Si true, ignora el filtro de mes y considera todo el pipeline activo.',
                    },
                },
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'forecast_cierre',
            'description': (
                'Proyección del cierre basada en las oportunidades cuyo '
                'mes_cierre cae en el periodo solicitado. Pondera cada '
                'opp por su probabilidad_cierre del CRM. Por DEFAULT toma '
                'mes ANTERIOR + mes actual (las opp que ya debían cerrar '
                'pero siguen abiertas + las que cierran este mes). Útil '
                'para "cómo cerraremos el mes". Para otro rango pasa mes, '
                'anio y rango_meses.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'mes': {
                        'type': 'integer', 'minimum': 1, 'maximum': 12,
                        'description': 'Mes inicial (1-12). Default: mes actual.',
                    },
                    'anio': {
                        'type': 'integer',
                        'description': 'Año del mes inicial. Default: año actual.',
                    },
                    'rango_meses': {
                        'type': 'integer', 'minimum': 1, 'maximum': 12,
                        'description': 'Cuántos meses incluir desde mes/anio. Default 2 (mes actual + siguiente).',
                    },
                },
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'oportunidades_por_vendedor',
            'description': (
                'Lista DETALLADA de oportunidades de un vendedor específico '
                'en un periodo, con id, título, cliente, monto y etapa. '
                'Úsala cuando el usuario pida "muéstrame las oportunidades '
                'que creó X", "lista todas las opp de X en abril-mayo", o '
                'cuando hayas dicho que un vendedor tiene N oportunidades y '
                'el usuario quiera verlas todas.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'vendedor_username': {
                        'type': 'string',
                        'description': 'Username o nombre del vendedor (acepta nombre parcial).',
                    },
                    'mes_desde': {'type': 'integer', 'minimum': 1, 'maximum': 12, 'description': 'Mes inicial del rango.'},
                    'anio_desde': {'type': 'integer', 'description': 'Año inicial del rango.'},
                    'mes_hasta': {'type': 'integer', 'minimum': 1, 'maximum': 12, 'description': 'Mes final del rango.'},
                    'anio_hasta': {'type': 'integer', 'description': 'Año final del rango.'},
                    'limite': {'type': 'integer', 'minimum': 1, 'maximum': 500, 'description': 'Máximo de oportunidades a devolver (default 200).'},
                },
                'required': ['vendedor_username'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'detalle_oportunidad',
            'description': (
                'Información completa de UNA oportunidad por su id: cliente, '
                'contacto, vendedor, monto, etapa, probabilidad, comentarios. '
                'Úsala cuando el usuario pregunte por una oportunidad específica.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'id': {'type': 'integer', 'description': 'ID de la oportunidad.'},
                },
                'required': ['id'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'detalle_vendedor',
            'description': (
                'Perfil completo de un vendedor con KPIs del mes y del año: '
                'pipeline activo, opp ganadas, clientes asignados, etc. '
                'Solo supervisores. Útil para evaluaciones de desempeño.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'vendedor_username': {
                        'type': 'string',
                        'description': 'Username o nombre del vendedor.',
                    },
                },
                'required': ['vendedor_username'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'oportunidades_por_periodo',
            'description': (
                'Lista las oportunidades CREADAS en un mes/año específico, sin '
                'filtrar por vendedor. Soporta filtros opcionales por etapa '
                '(ej. "cotizado", "ganado") o monto mínimo. Úsala cuando el '
                'usuario pregunte "las oportunidades de enero 2026", "todas las '
                'opp del mes pasado", "las opp ganadas en abril", etc.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'mes': {'type': 'integer', 'minimum': 1, 'maximum': 12, 'description': 'Mes 1-12. Default: mes actual.'},
                    'anio': {'type': 'integer', 'description': 'Año (4 dígitos). Default: año actual.'},
                    'etapa': {'type': 'string', 'description': 'Filtro por etapa (substring de etapa_corta/completa).'},
                    'monto_minimo': {'type': 'number', 'description': 'Monto mínimo en MXN.'},
                    'limite': {'type': 'integer', 'minimum': 1, 'maximum': 500, 'description': 'Máximo a devolver (default 100).'},
                },
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'clientes_de_vendedor',
            'description': (
                'Cartera de clientes asignados a un vendedor. Cada cliente '
                'trae cuántas oportunidades activas tiene con ese vendedor. '
                'Útil para "qué clientes tiene X", "cuál es la cartera de Y".'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'vendedor_username': {
                        'type': 'string',
                        'description': 'Username o nombre del vendedor.',
                    },
                    'limite': {'type': 'integer', 'minimum': 1, 'maximum': 300, 'description': 'Máximo de clientes a devolver (default 50).'},
                },
                'required': ['vendedor_username'],
            },
        },
    },
]

TOOL_HANDLERS = {
    'clientes_sin_atender': _tool_clientes_sin_atender,
    'ranking_vendedores': _tool_ranking_vendedores,
    'resumen_empresa': _tool_resumen_empresa,
    'top_oportunidades_prometedoras': _tool_top_oportunidades_prometedoras,
    'forecast_cierre': _tool_forecast_cierre,
    'oportunidades_por_vendedor': _tool_oportunidades_por_vendedor,
    'oportunidades_por_periodo': _tool_oportunidades_por_periodo,
    'detalle_oportunidad': _tool_detalle_oportunidad,
    'detalle_vendedor': _tool_detalle_vendedor,
    'clientes_de_vendedor': _tool_clientes_de_vendedor,
}


def execute_tool(name: str, args: dict, user: User) -> dict:
    """Ejecuta el handler de una tool. Devuelve siempre un dict con keys
    consistentes. Si hay error, devuelve {"error": "..."}."""
    handler = TOOL_HANDLERS.get(name)
    if not handler:
        return {'error': f'Tool "{name}" no existe.'}
    try:
        result = handler(args or {}, user)
        if not isinstance(result, dict):
            result = {'data': result}
        return result
    except Exception as e:
        log.exception('Error ejecutando tool %s: %s', name, e)
        return {'error': f'Error ejecutando {name}: {str(e)[:200]}'}


def tools_for_user(user: User) -> list[dict]:
    """Devuelve solo los schemas de tools que el user PUEDE ejecutar.
    Por ahora todos pueden ejecutar todas (excepto ranking_vendedores que
    se filtra dentro del handler), pero la función queda lista para
    permisos por rol después."""
    return TOOL_SCHEMAS
