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


# 3. Resumen de empresa
def _tool_resumen_empresa(args: dict, user: User) -> dict:
    """KPIs del periodo: nuevas oportunidades, pipeline, ganadas/perdidas."""
    ahora = timezone.now()
    mes = int(args.get('mes') or ahora.month)
    anio = int(args.get('anio') or ahora.year)
    mes = max(1, min(mes, 12))

    base = TodoItem.objects.filter(fecha_creacion__year=anio, fecha_creacion__month=mes)
    visible_ids = _visible_user_ids(user)
    if visible_ids is not None:
        base = base.filter(usuario_id__in=visible_ids)

    nuevas_opp = base.count()

    # Pipeline activo (no perdidas) del periodo
    activas = base.exclude(_q_perdidas())
    pipeline_periodo = activas.aggregate(total=Sum('monto')).get('total') or 0

    # Ganadas (etapa contiene "ganado", "pagado", "facturado", "cobrado")
    ganadas_qs = base.filter(_q_ganadas())
    ganadas_count = ganadas_qs.count()
    ganadas_monto = ganadas_qs.aggregate(total=Sum('monto')).get('total') or 0

    # Perdidas / canceladas
    perdidas_count = base.filter(_q_perdidas()).count()

    return {
        'mes': mes,
        'anio': anio,
        'oportunidades_nuevas': nuevas_opp,
        'pipeline_activo_mxn': _to_money(pipeline_periodo),
        'oportunidades_ganadas': ganadas_count,
        'monto_ganado_mxn': _to_money(ganadas_monto),
        'oportunidades_perdidas': perdidas_count,
    }


# 4. Top oportunidades prometedoras
def _tool_top_oportunidades_prometedoras(args: dict, user: User) -> dict:
    """Oportunidades activas que más prometen (monto × probabilidad × recencia)."""
    limite = int(args.get('limite') or 10)
    limite = max(1, min(limite, 30))

    qs = TodoItem.objects.exclude(_q_perdidas())
    visible_ids = _visible_user_ids(user)
    if visible_ids is not None:
        qs = qs.filter(usuario_id__in=visible_ids)

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
    return {'oportunidades': items[:limite]}


# 5. Forecast de cierre
def _tool_forecast_cierre(args: dict, user: User) -> dict:
    """Proyección de cierre basada en pipeline × probabilidad_cierre del CRM."""
    qs = TodoItem.objects.exclude(_q_perdidas())
    visible_ids = _visible_user_ids(user)
    if visible_ids is not None:
        qs = qs.filter(usuario_id__in=visible_ids)

    pipeline_total = 0.0
    forecast = 0.0
    por_etapa: dict[str, dict] = {}
    for opp in qs.only('monto', 'probabilidad_cierre', 'etapa_corta', 'etapa_completa'):
        m = _to_money(opp.monto)
        p = (opp.probabilidad_cierre or 20) / 100.0
        pipeline_total += m
        forecast += m * p
        etapa_key = opp.etapa_corta or opp.etapa_completa or 'sin_etapa'
        por_etapa.setdefault(etapa_key, {'monto': 0.0, 'count': 0})
        por_etapa[etapa_key]['monto'] += m
        por_etapa[etapa_key]['count'] += 1

    top_etapas = sorted(por_etapa.items(), key=lambda kv: kv[1]['monto'], reverse=True)[:5]

    return {
        'pipeline_total_mxn': round(pipeline_total, 2),
        'forecast_ponderado_mxn': round(forecast, 2),
        'top_etapas': [
            {'etapa': k, 'monto_mxn': round(v['monto'], 2), 'count': v['count']}
            for k, v in top_etapas
        ],
        'nota': (
            'forecast_ponderado = suma(monto × probabilidad_cierre del CRM). '
            'pipeline_total = suma sin descontar perdidas.'
        ),
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
                'considerando monto + recencia de actividad. Útil para '
                '"cuál es la oportunidad que más promete" o "dónde debería '
                'poner mi foco".'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'limite': {
                        'type': 'integer', 'minimum': 1, 'maximum': 30,
                        'description': 'Cuántas oportunidades devolver. Default 10.',
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
                'Proyección del cierre del mes/trimestre basado en el '
                'pipeline activo, ponderando cada oportunidad por la '
                'probabilidad típica de su etapa. Útil para "cómo voy a '
                'cerrar el mes" o "qué tan probable es alcanzar la meta".'
            ),
            'parameters': {
                'type': 'object',
                'properties': {},
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
