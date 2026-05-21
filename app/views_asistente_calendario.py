# ----------------------------------------------------------------------
# views_asistente_calendario.py — Asistente AI del Calendario.
# ----------------------------------------------------------------------
# A diferencia de los otros asistentes (Ideas, Prospección, Oportunidades),
# este NO es un chat libre. Es **action-driven**: el usuario hace click en
# "Reagendar vencidas" o "Rellenar calendario", el AI prepara un plan, y
# luego el usuario lo acepta o rechaza con un solo click.
#
# No hay historial de mensajes, no hay turnos infinitos. El AI corre una
# sola vez por acción, devuelve un plan estructurado, y termina.
#
# Endpoints:
#   POST /app/api/calendario/asistente/preview/    → genera plan (LLM)
#   POST /app/api/calendario/asistente/aplicar/    → aplica plan (sin LLM)
#
# Acciones soportadas:
#   - reagendar_vencidas   : reasigna fechas a actividades/tareas vencidas
#                            del usuario actual, ajustadas a su horario
#                            laboral y huecos del calendario.
#   - rellenar_calendario  : crea actividades nuevas en huecos del
#                            calendario para opps/prospectos del usuario
#                            que llevan sin actividad >7 días.
#
# Reglas duras del AI (horario laboral, buffers, duraciones heurísticas,
# priorización) están en los system prompts de cada acción.
# ----------------------------------------------------------------------

import json
import logging
from datetime import datetime, timedelta, time as dtime

from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from .models import (
    Actividad, Tarea, TodoItem, Prospecto, AsistenteConfig,
)
from .asistente_provider import chat, AsistenteError

log = logging.getLogger(__name__)


# ─── Constantes de negocio ─────────────────────────────────────────────

# Modelo default para esta función — barato (gpt-4o-mini vía OpenRouter).
# AsistenteConfig.modelo manda si está configurado.
MODEL_DEFAULT = 'openrouter/openai/gpt-4o-mini'

# Horario laboral del vendedor IAMET (TIME_ZONE = America/Tijuana).
WORKDAY_START = dtime(9, 0)      # 9:00 am
WORKDAY_END = dtime(18, 0)       # 6:00 pm
LUNCH_START = dtime(13, 0)       # 1:00 pm
LUNCH_END = dtime(14, 0)         # 2:00 pm

# Días hábiles a futuro que mostramos al AI como ventana disponible.
DIAS_HABILES_VENTANA = 5

# Topes para no inflar tokens.
MAX_VENCIDAS_AL_AI = 30          # Las más urgentes (cap por seguridad).
MAX_CANDIDATOS_RELLENAR = 30     # Top candidatos sin actividad pendiente.
MAX_PLAN_REAGENDAR = 15          # El plan final que el AI devuelve.
MAX_PLAN_RELLENAR = 20           # Máximo de sugerencias nuevas por corrida.
MAX_RELLENAR_POR_DIA = 4         # Tope de actividades nuevas por día (anti-saturación).

# Buffer entre eventos (lo aplica el AI; backend valida en aplicar).
BUFFER_ENTRE_EVENTOS_MIN = 5

# Trunc de descripciones que se mandan al LLM.
DESC_TRUNCATE = 150

# Tipos de fuente válidos para "rellenar_calendario".
FUENTES_VALIDAS = {'oportunidad', 'prospecto'}


# ─── Helpers de fechas / días hábiles ──────────────────────────────────


def _es_dia_habil(d) -> bool:
    """Lunes (0) a viernes (4) son días hábiles."""
    return d.weekday() < 5


def _siguiente_dia_habil(d):
    """Devuelve el siguiente día hábil >= d (date)."""
    while not _es_dia_habil(d):
        d = d + timedelta(days=1)
    return d


def _dias_habiles_siguientes(n: int) -> list:
    """Lista de `n` fechas (date) hábiles desde hoy en TZ del proyecto."""
    hoy = timezone.localdate()
    base = _siguiente_dia_habil(hoy)
    res = []
    cursor = base
    while len(res) < n:
        if _es_dia_habil(cursor):
            res.append(cursor)
        cursor = cursor + timedelta(days=1)
    return res


def _to_iso_local(dt) -> str:
    """ISO en TZ local — usado para mandar al AI fechas humanas."""
    if not dt:
        return ''
    try:
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt)
        return timezone.localtime(dt).strftime('%Y-%m-%dT%H:%M:%S')
    except Exception:
        return str(dt)


def _parse_iso_aware(s: str):
    """Parsea ISO y devuelve datetime aware (TZ local del proyecto si era
    naive). Devuelve None si no se puede parsear."""
    if not s or not isinstance(s, str):
        return None
    try:
        clean = s.strip().replace('Z', '+00:00')
        dt = datetime.fromisoformat(clean)
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt)
        return dt
    except Exception:
        return None


def _dias_desde(dt) -> int:
    """Días desde dt hasta ahora (>=0). Si dt es None devuelve 0."""
    if not dt:
        return 0
    try:
        return max(0, (timezone.now() - dt).days)
    except Exception:
        return 0


# ─── Helpers de carga de datos del usuario ─────────────────────────────


def _actividades_vencidas_del_user(user, ahora) -> list:
    """Actividades del calendario del usuario que ya vencieron y no se
    completaron. Excluye instancias hijas de recurrencias salvo la primera
    (heurística: agrupamos por recurrence_group_id si existe y traemos la
    más reciente vencida). Para simplificar: cap a 30 ordenadas por fecha
    desc (más reciente primero) — ya el AI ve las más relevantes.
    """
    qs = (Actividad.objects
          .filter(
              creado_por=user,
              completada=False,
              fecha_inicio__lt=ahora,
          )
          .select_related('oportunidad', 'oportunidad__cliente')
          .order_by('-fecha_inicio'))

    # Deduplicar por grupo de recurrencia — solo nos quedamos con la más
    # reciente vencida de cada grupo. Las series ya generaron N instancias
    # individuales; no queremos saturar al AI con duplicados de la misma
    # idea.
    vistos_grupos = set()
    resultado = []
    for a in qs:
        gid = a.recurrence_group_id
        if gid is not None:
            if gid in vistos_grupos:
                continue
            vistos_grupos.add(gid)
        resultado.append(a)
        if len(resultado) >= MAX_VENCIDAS_AL_AI:
            break
    return resultado


def _tareas_vencidas_del_user(user, ahora) -> list:
    """Tareas (del módulo Proyectos) vencidas del usuario, no completadas
    ni canceladas. Incluye las que él creó y las que tiene asignadas.
    """
    qs = (Tarea.objects
          .filter(
              fecha_limite__isnull=False,
              fecha_limite__lt=ahora,
          )
          .exclude(estado__in=['completada', 'cancelada'])
          .filter(Q(creado_por=user) | Q(asignado_a=user))
          .select_related('proyecto')
          .order_by('-fecha_limite')
          .distinct())
    return list(qs[:MAX_VENCIDAS_AL_AI])


def _slots_ocupados(user, desde, hasta) -> list:
    """Lista de (fecha_inicio_iso, fecha_fin_iso, titulo_corto) ordenada
    por fecha_inicio, para mostrarle al AI qué huecos ya están ocupados
    en la ventana [desde, hasta]. Combina:
      - Actividades del calendario del usuario (no completadas, futuras
        o que cruzan la ventana).
      - Tareas con fecha_limite (tomamos el fecha_limite como slot,
        duración 30 min asumida — solo para que el AI sepa que hay un
        compromiso).
    """
    slots = []

    actos = (Actividad.objects
             .filter(creado_por=user, completada=False)
             .filter(fecha_inicio__lt=hasta, fecha_fin__gt=desde)
             .order_by('fecha_inicio')
             .values('id', 'titulo', 'fecha_inicio', 'fecha_fin'))
    for a in actos:
        slots.append({
            'inicio': _to_iso_local(a['fecha_inicio']),
            'fin': _to_iso_local(a['fecha_fin']),
            'titulo': (a['titulo'] or '')[:60],
        })

    # Tareas: ponemos un slot de 30 min alrededor de fecha_limite, como
    # señal informativa para que el AI no encime con un compromiso de
    # entrega.
    tareas = (Tarea.objects
              .filter(fecha_limite__isnull=False)
              .filter(fecha_limite__gte=desde, fecha_limite__lt=hasta)
              .exclude(estado__in=['completada', 'cancelada'])
              .filter(Q(creado_por=user) | Q(asignado_a=user))
              .order_by('fecha_limite')
              .values('id', 'titulo', 'fecha_limite')
              .distinct())
    for t in tareas:
        fi = t['fecha_limite']
        ff = fi + timedelta(minutes=30) if fi else None
        slots.append({
            'inicio': _to_iso_local(fi),
            'fin': _to_iso_local(ff) if ff else '',
            'titulo': '[tarea] ' + (t['titulo'] or '')[:55],
        })

    slots.sort(key=lambda s: s['inicio'])
    return slots


def _ultima_actividad_relacionada(user, oportunidad_id=None,
                                  prospecto_id=None):
    """Devuelve la última fecha_inicio de cualquier actividad del usuario
    vinculada a esta opp/prospecto. Usado para detectar "sin actividad
    próxima"."""
    qs = Actividad.objects.filter(creado_por=user)
    if oportunidad_id:
        qs = qs.filter(oportunidad_id=oportunidad_id)
    elif prospecto_id:
        # Actividad no tiene FK a Prospecto en el modelo actual; usamos
        # ProspectoActividad como heurística separada en su query.
        return None
    else:
        return None
    last = qs.order_by('-fecha_inicio').values_list('fecha_inicio', flat=True).first()
    return last


def _candidatos_rellenar(user, ahora) -> dict:
    """Devuelve dict con 'oportunidades' y 'prospectos' del usuario que
    NO tienen ninguna actividad pendiente (completada=False), ni futura
    ni vencida. La lógica: si una opp ya tiene una vencida, eso es trabajo
    de "reagendar"; si tiene una futura sin completar, ya está cubierta.
    Solo entran las que están "limpias" (sin pendientes) — es ahí donde
    hay que rellenar el calendario. Cap a MAX_CANDIDATOS_RELLENAR combinado.
    """
    # OPORTUNIDADES activas del usuario sin NINGUNA actividad pendiente
    etapas_cerradas = ['Ganado', 'Pagado', 'Perdido', 'Cancelado']
    opps_activas = (TodoItem.objects
                    .filter(usuario=user)
                    .exclude(etapa_corta__in=etapas_cerradas)
                    .exclude(etapa_completa__icontains='perdido')
                    .exclude(etapa_completa__icontains='cancelad')
                    .select_related('cliente')
                    .order_by('-fecha_actualizacion'))

    opps_sin_actividad = []
    for opp in opps_activas[:80]:  # safety cap antes del filtro fino
        tiene_pendientes = (Actividad.objects
                            .filter(creado_por=user, oportunidad=opp,
                                    completada=False)
                            .exists())
        if not tiene_pendientes:
            opps_sin_actividad.append(opp)
        if len(opps_sin_actividad) >= MAX_CANDIDATOS_RELLENAR:
            break

    # PROSPECTOS activos del usuario sin NINGUNA actividad pendiente
    prospectos_activos = (Prospecto.objects
                          .filter(usuario=user)
                          .exclude(etapa__in=['cerrado_ganado', 'cerrado_perdido'])
                          .select_related('cliente')
                          .order_by('-fecha_actualizacion'))
    prospectos_sin = []
    for p in prospectos_activos[:80]:
        try:
            tiene_pendientes_p = (p.actividades
                                  .filter(completada=False)
                                  .exists())
        except Exception:
            tiene_pendientes_p = False
        if not tiene_pendientes_p:
            prospectos_sin.append(p)
        if len(prospectos_sin) >= MAX_CANDIDATOS_RELLENAR:
            break

    # Combinar y truncar al cap general; dejamos espacio balanceado pero
    # sin desperdiciar slots si una lista está vacía.
    cap_opps = min(len(opps_sin_actividad),
                   MAX_CANDIDATOS_RELLENAR // 2 + 4)
    combinados_opps = opps_sin_actividad[:cap_opps]
    espacio_pros = MAX_CANDIDATOS_RELLENAR - len(combinados_opps)
    combinados_pros = prospectos_sin[:max(espacio_pros, 0)]
    return {
        'oportunidades': combinados_opps,
        'prospectos': combinados_pros,
    }


# ─── Formateo de input para el LLM ─────────────────────────────────────


def _trunc(text, n=DESC_TRUNCATE) -> str:
    s = (text or '').strip()
    if len(s) <= n:
        return s
    return s[:n - 3].rstrip() + '...'


def _money_short(value) -> str:
    if value is None:
        return '—'
    try:
        return f'${float(value):,.0f} MXN'
    except Exception:
        return str(value)


def _formato_vencidas_para_ai(actividades, tareas) -> tuple[str, dict]:
    """Devuelve (bloque_md, map_id_to_obj). map_id_to_obj indexa por id
    string (ej. "actividad-123") para validar luego el plan del AI.
    """
    lines = []
    id_map = {}

    if not actividades and not tareas:
        return ('(no hay actividades ni tareas vencidas)', id_map)

    if actividades:
        lines.append('### Actividades del calendario vencidas')
        for a in actividades:
            key = f'actividad-{a.id}'
            id_map[key] = a
            cliente_nombre = '—'
            opp_titulo = '—'
            if a.oportunidad_id:
                try:
                    opp_titulo = (a.oportunidad.oportunidad or '')[:60]
                    if a.oportunidad.cliente_id:
                        cliente_nombre = (a.oportunidad.cliente.nombre_empresa or '')[:60]
                except Exception:
                    pass
            fi_iso = _to_iso_local(a.fecha_inicio)
            tipo = a.tipo_actividad or 'otro'
            lines.append(
                f'- id="{key}" | tipo={tipo} | venció={fi_iso} | '
                f'título="{_trunc(a.titulo, 80)}" | cliente="{cliente_nombre}" | '
                f'opp="{opp_titulo}" | desc="{_trunc(a.descripcion or "")}"'
            )

    if tareas:
        lines.append('\n### Tareas (módulo Proyectos) vencidas')
        for t in tareas:
            key = f'tarea-{t.id}'
            id_map[key] = t
            fl_iso = _to_iso_local(t.fecha_limite)
            proyecto = ''
            if t.proyecto_id:
                try:
                    proyecto = (t.proyecto.nombre or '')[:60]
                except Exception:
                    proyecto = ''
            lines.append(
                f'- id="{key}" | venció={fl_iso} | '
                f'título="{_trunc(t.titulo, 80)}" | proyecto="{proyecto}" | '
                f'prioridad={t.prioridad} | estado={t.estado} | '
                f'desc="{_trunc(t.descripcion or "")}"'
            )

    return ('\n'.join(lines), id_map)


def _formato_slots_para_ai(slots: list) -> str:
    if not slots:
        return '(sin compromisos previos en los próximos días — todo libre)'
    lines = ['### Slots ya OCUPADOS (no encimes nada aquí)']
    for s in slots[:50]:  # safety cap
        lines.append(
            f'- {s["inicio"]} → {s["fin"]} | {s["titulo"]}'
        )
    if len(slots) > 50:
        lines.append(f'- (+ {len(slots) - 50} compromisos más, no listados)')
    return '\n'.join(lines)


def _formato_candidatos_para_ai(candidatos: dict) -> tuple[str, dict]:
    """Devuelve (bloque_md, map_fuente_to_obj). map_fuente_to_obj indexa
    por "oportunidad-123" o "prospecto-45" para validar el plan."""
    lines = []
    id_map = {}
    opps = candidatos.get('oportunidades') or []
    pros = candidatos.get('prospectos') or []

    if not opps and not pros:
        return ('(no hay candidatos para rellenar — bien jugado)', id_map)

    if opps:
        lines.append('### Oportunidades activas SIN actividad próxima')
        for opp in opps:
            key = f'oportunidad-{opp.id}'
            id_map[key] = opp
            cliente_nombre = '—'
            try:
                if opp.cliente_id:
                    cliente_nombre = (opp.cliente.nombre_empresa or '')[:60]
            except Exception:
                pass
            dias_sin_act = _dias_desde(opp.fecha_actualizacion)
            etapa = opp.etapa_corta or opp.etapa_completa or '—'
            lines.append(
                f'- fuente_tipo="oportunidad" | fuente_id={opp.id} | '
                f'título="{_trunc(opp.oportunidad, 80)}" | '
                f'cliente="{cliente_nombre}" | etapa="{etapa}" | '
                f'monto={_money_short(opp.monto)} | '
                f'prob={getattr(opp, "probabilidad_cierre", "—")}% | '
                f'dias_sin_movimiento={dias_sin_act} | '
                f'comentarios="{_trunc(opp.comentarios or "")}"'
            )

    if pros:
        lines.append('\n### Prospectos activos SIN actividad próxima')
        for p in pros:
            key = f'prospecto-{p.id}'
            id_map[key] = p
            cliente_nombre = '—'
            try:
                if p.cliente_id:
                    cliente_nombre = (p.cliente.nombre_empresa or '')[:60]
            except Exception:
                pass
            dias_sin_act = _dias_desde(p.fecha_actualizacion)
            lines.append(
                f'- fuente_tipo="prospecto" | fuente_id={p.id} | '
                f'nombre="{_trunc(p.nombre, 80)}" | '
                f'cliente="{cliente_nombre}" | etapa="{p.get_etapa_display()}" | '
                f'producto={p.producto} | '
                f'dias_sin_movimiento={dias_sin_act} | '
                f'comentarios="{_trunc(p.comentarios or "")}"'
            )

    return ('\n'.join(lines), id_map)


# ─── System prompts ────────────────────────────────────────────────────


_REGLAS_HORARIO = (
    '## Reglas duras de agenda (NO se negocian)\n'
    f'- **Horario laboral**: lunes a viernes, '
    f'{WORKDAY_START.strftime("%H:%M")} - {WORKDAY_END.strftime("%H:%M")} (TZ local).\n'
    '- **NO** agendes en sábado ni domingo. Si no cabe en lun-vie, '
    'el plan tiene menos items — no fuerces.\n'
    f'- **NO** agendes entre {LUNCH_START.strftime("%H:%M")} y '
    f'{LUNCH_END.strftime("%H:%M")} (almuerzo).\n'
    f'- **Buffer**: {BUFFER_ENTRE_EVENTOS_MIN} minutos entre eventos.\n'
    '- **No encimes** eventos ya ocupados (te paso la lista de '
    'slots ocupados). Si un slot dice 10:00→10:30 ocupado, tu '
    'siguiente evento empieza mínimo 10:35.\n'
    '\n'
    '## Duraciones heurísticas\n'
    '- Correo, llamada corta, seguimiento por correo: **10 min**.\n'
    '- Reunión interna / planning: **30 min**.\n'
    '- Reunión con cliente / presentación: **60 min**.\n'
    '- Revisión técnica (volumetría, cotización detallada, '
    'levantamiento): **45 min**.\n'
    '- Si no sabes, default 30 min.\n'
)


SYS_REAGENDAR = (
    'Eres el asistente de calendario de IAMET en su rol de '
    '**organizador táctico**. El vendedor tiene actividades y tareas '
    'VENCIDAS — ya pasó su fecha y no las completó. Tu trabajo es '
    'preparar un **plan de reagendamiento realista** que él podrá '
    'aceptar o rechazar con un click.\n\n'

    '## Filosofía\n'
    '- **Tú no decides — propones.** El vendedor manda; tú das un plan '
    'razonado para que sea trivial decirle "sí".\n'
    '- **Realista, no ambicioso.** Si tiene 30 vencidas, no las metas '
    'todas en el mismo día. Distribuye sensatamente.\n'
    '- **Prioriza** lo que más mueve la aguja del negocio.\n'
    '- **Conciso en `razon`**: 1 frase corta por item (máximo ~15 palabras).\n'
    '- **Sé honesto en `resumen`**: 2-3 líneas describiendo qué hace el '
    'plan, cuántos items, por qué.\n'
    '- Español mexicano profesional, tono colega.\n'
    '- NO uses emojis. NO uses sycophancy ("excelente lista").\n'
    '- NO inventes datos: si una opp no tiene monto, no asumas que es '
    'importante por defecto.\n\n'

    + _REGLAS_HORARIO +
    '\n'

    '## Priorización\n'
    '**Más prioridad** (poner antes, en horario más temprano):\n'
    '- Opp con monto alto + etapa avanzada (cierre, negociación, '
    'cotizado).\n'
    '- Reuniones con cliente / visitas que ya estaban agendadas.\n'
    '- Actividades vencidas hace muchos días (>7) — se enfrió mucho.\n'
    '- Tareas marcadas con prioridad="alta".\n'
    '\n'
    '**Menos prioridad** (puedes mandar a los próximos días):\n'
    '- Correos de seguimiento simples.\n'
    '- Tareas administrativas.\n'
    '- Prospectos en etapas iniciales (identificado, calificado).\n'
    '- Items con descripción genérica o vaga.\n'
    '\n'
    'Las **críticas** → hoy mismo si caben en el horario; si no, mañana '
    'temprano. Las **menos críticas** → próximos 2-5 días hábiles.\n\n'

    f'## Tope del plan: MÁXIMO {MAX_PLAN_REAGENDAR} items.\n'
    'Si recibes más vencidas que ese tope, **elige las más prioritarias '
    'y deja las demás fuera**. NO intentes meter todas — un plan honesto '
    'es mejor que uno saturado.\n\n'

    '## Tool obligatoria\n'
    'DEBES llamar la función `proponer_plan_reagendamiento` con la lista '
    'de items. NO respondas en texto plano: tu única salida útil es la '
    'tool call.\n\n'

    '## Formato exacto de cada item\n'
    '```\n'
    '{\n'
    '  "id": "actividad-123" | "tarea-45",   // EXACTO como te lo paso\n'
    '  "tipo": "actividad" | "tarea",\n'
    '  "nueva_fecha": "YYYY-MM-DDTHH:MM:SS",  // sin TZ; se asume local\n'
    '  "duracion_min": 10 | 30 | 45 | 60,\n'
    '  "razon": "Frase corta justificando esta decisión."\n'
    '}\n'
    '```\n'
    'Y también un `resumen` global (2-3 líneas) describiendo el plan.\n'
)


SYS_RELLENAR = (
    'Eres el asistente de calendario de IAMET en su rol de '
    '**proactivo del pipeline**. El vendedor tiene oportunidades y '
    'prospectos activos que **no tienen ninguna actividad pendiente** '
    '(ya cumplieron todas las anteriores o nunca tuvieron). Tu trabajo: '
    f'proponer entre 1 y {MAX_PLAN_RELLENAR} actividades nuevas, bien '
    'pensadas y distribuidas en varios días, para mover esos pendientes.\n\n'

    '## Filosofía\n'
    '- **Calidad sobre cantidad.** Mejor 8 sugerencias justificadas '
    f'que {MAX_PLAN_RELLENAR} genéricas, pero si tienes muchos '
    'candidatos buenos no te quedes corto.\n'
    '- **Usa la señal del contexto**: monto, etapa, días sin '
    'movimiento, descripción. Una opp con $500k en negociación que '
    'lleva 21 días sin movimiento es PRIORIDAD ALTA. Un prospecto en '
    '"identificado" sin movimiento es prioridad baja.\n'
    '- Español mexicano profesional, sin emojis, sin sycophancy.\n'
    '- NO inventes datos no presentes en el contexto.\n'
    '- `razon`: 1 frase corta por item.\n'
    '- `resumen`: 2-3 líneas sobre por qué propones este plan.\n\n'

    + _REGLAS_HORARIO +
    '\n'

    '## Reglas de distribución (CRÍTICAS)\n'
    '- **DISTRIBUYE las actividades entre los próximos 5 días hábiles.** '
    'NO agrupes todas en el mismo día — eso satura al vendedor.\n'
    f'- **MÁXIMO {MAX_RELLENAR_POR_DIA} actividades nuevas por día.** '
    'Si excedes este tope el backend descartará las extras.\n'
    '- Si tienes <5 candidatos, está bien crear 1-2 items; pero si '
    'tienes 15+ candidatos, **distribuye al menos 3 por día** para usar '
    'bien la ventana de la semana.\n'
    '- Deja **espacio entre actividades** (mínimo 30 minutos de buffer '
    'cuando son del mismo día, además del buffer base de 5 min).\n'
    '- Comienza por los días más cercanos pero balanceando: día 1 con '
    'los más prioritarios, día 2 los siguientes, etc.\n\n'

    f'## Tope del plan: MÁXIMO {MAX_PLAN_RELLENAR} items.\n'
    'Si tienes más candidatos, **elige los más prioritarios**. El usuario '
    'puede correr esta función de nuevo cuando quiera más sugerencias.\n\n'

    '## Cómo elegir el tipo y duración\n'
    '- Si la opp/prospecto está caliente (monto alto, etapa avanzada, '
    'cliente conocido) → sugiere "reunion" o "llamada" (30-60 min).\n'
    '- Si está fría o en etapa inicial → "email" o seguimiento corto '
    '(10 min).\n'
    '- Si lleva semanas sin movimiento y nunca hubo reunión → propón '
    '"llamada" para reactivar (15-30 min).\n\n'

    '## Tool obligatoria\n'
    'DEBES llamar la función `proponer_plan_rellenar` con la lista de '
    'items. NO respondas en texto plano.\n\n'

    '## Formato exacto de cada item\n'
    '```\n'
    '{\n'
    '  "fuente_tipo": "oportunidad" | "prospecto",\n'
    '  "fuente_id": 123,                           // EXACTO\n'
    '  "tipo_actividad": "llamada" | "reunion" | "email" | "tarea" | "otro",\n'
    '  "fecha": "YYYY-MM-DDTHH:MM:SS",             // sin TZ\n'
    '  "duracion_min": 10 | 30 | 45 | 60,\n'
    '  "titulo": "Verbo + objeto corto. Ej: \'Seguimiento opp ACME\'",\n'
    '  "descripcion": "2-4 líneas: qué vas a hacer y por qué.",\n'
    '  "razon": "Frase corta justificando esta sugerencia."\n'
    '}\n'
    '```\n'
)


# ─── Tools schemas ─────────────────────────────────────────────────────


def _tool_proponer_reagendar() -> dict:
    """Schema OpenAI-compatible para reagendar vencidas."""
    return {
        'type': 'function',
        'function': {
            'name': 'proponer_plan_reagendamiento',
            'description': (
                'Devuelve el plan de reagendamiento como una lista de '
                'items + resumen global. NO ejecuta nada — solo prepara '
                'el plan para que el usuario lo apruebe.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'resumen': {
                        'type': 'string',
                        'description': (
                            '2-3 líneas describiendo el plan: cuántos '
                            'items, distribución y razón general. '
                            'Ejemplo: "Reagendo 8 actividades vencidas. '
                            '3 críticas hoy (cliente importante), 5 '
                            'menos urgentes a los próximos 3 días."'
                        ),
                    },
                    'items': {
                        'type': 'array',
                        'items': {
                            'type': 'object',
                            'properties': {
                                'id': {
                                    'type': 'string',
                                    'description': (
                                        'ID EXACTO que te pasé (ej. '
                                        '"actividad-123" o "tarea-45").'
                                    ),
                                },
                                'tipo': {
                                    'type': 'string',
                                    'enum': ['actividad', 'tarea'],
                                },
                                'nueva_fecha': {
                                    'type': 'string',
                                    'description': (
                                        'Fecha nueva en ISO local sin '
                                        'TZ: "YYYY-MM-DDTHH:MM:SS". '
                                        'Lun-Vie, horario laboral.'
                                    ),
                                },
                                'duracion_min': {
                                    'type': 'integer',
                                    'description': (
                                        'Duración en minutos (10, 30, '
                                        '45 o 60 según heurísticas).'
                                    ),
                                },
                                'razon': {
                                    'type': 'string',
                                    'description': (
                                        'Frase corta (≤15 palabras) '
                                        'justificando la decisión.'
                                    ),
                                },
                            },
                            'required': ['id', 'tipo', 'nueva_fecha',
                                         'duracion_min', 'razon'],
                        },
                    },
                },
                'required': ['resumen', 'items'],
            },
        },
    }


def _tool_proponer_rellenar() -> dict:
    """Schema OpenAI-compatible para rellenar calendario."""
    return {
        'type': 'function',
        'function': {
            'name': 'proponer_plan_rellenar',
            'description': (
                'Devuelve sugerencias de actividades nuevas para '
                'oportunidades/prospectos sin actividad próxima. NO crea '
                'nada — solo prepara el plan para aprobación del usuario.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'resumen': {
                        'type': 'string',
                        'description': (
                            '2-3 líneas resumiendo el plan: cuántas '
                            'sugerencias, por qué fueron priorizadas.'
                        ),
                    },
                    'items': {
                        'type': 'array',
                        'items': {
                            'type': 'object',
                            'properties': {
                                'fuente_tipo': {
                                    'type': 'string',
                                    'enum': ['oportunidad', 'prospecto'],
                                },
                                'fuente_id': {
                                    'type': 'integer',
                                    'description': (
                                        'ID numérico EXACTO de la '
                                        'opp/prospecto fuente.'
                                    ),
                                },
                                'tipo_actividad': {
                                    'type': 'string',
                                    'enum': ['llamada', 'reunion',
                                             'email', 'tarea', 'otro'],
                                },
                                'fecha': {
                                    'type': 'string',
                                    'description': (
                                        'Fecha en ISO local sin TZ: '
                                        '"YYYY-MM-DDTHH:MM:SS". Lun-Vie, '
                                        'horario laboral.'
                                    ),
                                },
                                'duracion_min': {
                                    'type': 'integer',
                                },
                                'titulo': {
                                    'type': 'string',
                                    'description': (
                                        'Verbo + objeto corto. Máx 120 '
                                        'chars.'
                                    ),
                                },
                                'descripcion': {
                                    'type': 'string',
                                    'description': (
                                        '2-4 líneas: qué hacer y por qué.'
                                    ),
                                },
                                'razon': {
                                    'type': 'string',
                                    'description': (
                                        'Frase corta justificando.'
                                    ),
                                },
                            },
                            'required': ['fuente_tipo', 'fuente_id',
                                         'tipo_actividad', 'fecha',
                                         'duracion_min', 'titulo',
                                         'descripcion', 'razon'],
                        },
                    },
                },
                'required': ['resumen', 'items'],
            },
        },
    }


# ─── Preview: reagendar_vencidas ───────────────────────────────────────


def _preview_reagendar_vencidas(request) -> JsonResponse:
    """Construye contexto, llama al AI, devuelve plan listo para mostrar.
    NO toca DB."""
    user = request.user
    ahora = timezone.now()

    actividades = _actividades_vencidas_del_user(user, ahora)
    tareas = _tareas_vencidas_del_user(user, ahora)
    log.info(
        'Reagendar: user=%s vencidas detectadas: %d actividades + %d tareas',
        user.username, len(actividades), len(tareas),
    )

    if not actividades and not tareas:
        return JsonResponse({
            'ok': True,
            'accion': 'reagendar_vencidas',
            'resumen': 'No tienes actividades ni tareas vencidas. Buen trabajo.',
            'plan': [],
        })

    # Ventana de huecos: ~5 días hábiles desde hoy
    desde = ahora
    hasta = ahora + timedelta(days=10)  # 10 naturales ~ 5-7 hábiles
    slots = _slots_ocupados(user, desde, hasta)

    vencidas_md, id_map = _formato_vencidas_para_ai(actividades, tareas)
    slots_md = _formato_slots_para_ai(slots)
    dias_habiles = _dias_habiles_siguientes(DIAS_HABILES_VENTANA)
    dias_str = ', '.join(d.strftime('%a %Y-%m-%d') for d in dias_habiles)

    user_block = (
        f'## Contexto\n'
        f'- **Fecha/hora actual (local)**: {timezone.localtime(ahora).strftime("%Y-%m-%d %H:%M (%a)")}\n'
        f'- **Días hábiles a tu disposición**: {dias_str}\n'
        f'- **Total vencidas**: {len(actividades)} actividades + {len(tareas)} tareas\n'
        f'\n'
        f'## Items vencidos a reagendar\n'
        f'{vencidas_md}\n\n'
        f'{slots_md}\n\n'
        f'## Tu tarea\n'
        f'Genera el plan de reagendamiento llamando '
        f'`proponer_plan_reagendamiento`. Respeta las reglas duras de '
        f'horario y prioriza por impacto del negocio.'
    )

    cfg = AsistenteConfig.get_singleton()
    if not cfg.activo:
        return JsonResponse({'ok': False, 'error': 'Asistente desactivado.'}, status=403)

    messages = [
        {'role': 'system', 'content': SYS_REAGENDAR},
        {'role': 'user', 'content': user_block},
    ]
    tools = [_tool_proponer_reagendar()]

    try:
        resp = chat(
            messages=messages,
            tools=tools,
            model=cfg.modelo or MODEL_DEFAULT,
            temperature=0.3,
            max_tokens=2000,
        )
    except AsistenteError as e:
        log.warning('Calendario asistente (reagendar) error: %s', e)
        return JsonResponse({'ok': False, 'error': str(e)}, status=502)
    except Exception as e:
        log.exception('Error inesperado calendario asistente (reagendar): %s', e)
        return JsonResponse({'ok': False, 'error': f'Error inesperado: {e}'}, status=500)

    # Extraer tool call
    tc_list = resp.get('tool_calls') or []
    tool_args = None
    for tc in tc_list:
        if tc.get('name') == 'proponer_plan_reagendamiento':
            tool_args = tc.get('arguments') or {}
            break
    if not tool_args:
        log.warning('El AI no llamó la tool reagendar. text=%r', (resp.get('text') or '')[:200])
        return JsonResponse({
            'ok': False,
            'error': (
                'El asistente no devolvió un plan estructurado. '
                'Intenta de nuevo en unos segundos.'
            ),
        }, status=502)

    resumen = (tool_args.get('resumen') or '').strip()
    items_raw = tool_args.get('items') or []

    # Validar / enriquecer items contra id_map
    plan_validado = []
    for it in items_raw[:MAX_PLAN_REAGENDAR]:
        item_id = (it.get('id') or '').strip()
        if item_id not in id_map:
            continue  # ignora ids inventados o mal escritos
        obj = id_map[item_id]
        # El tipo REAL lo determina el prefijo del id (id_map lo garantiza),
        # NO lo que diga el AI en el campo `tipo`. El AI a veces miente y eso
        # generaba AttributeError al leer obj.fecha_limite en una Actividad.
        if item_id.startswith('actividad-'):
            tipo = 'actividad'
        elif item_id.startswith('tarea-'):
            tipo = 'tarea'
        else:
            continue  # id con prefijo desconocido — saltar
        nueva_fecha = (it.get('nueva_fecha') or '').strip()
        dur = int(it.get('duracion_min') or 30)
        if dur < 5:
            dur = 30
        if dur > 240:
            dur = 240
        razon = (it.get('razon') or '').strip()[:200]

        # Datos del item original para mostrar en el frontend
        if tipo == 'actividad':
            titulo = (obj.titulo or '')[:200]
            fecha_anterior = _to_iso_local(obj.fecha_inicio)
        else:
            titulo = (obj.titulo or '')[:200]
            fecha_anterior = _to_iso_local(obj.fecha_limite)

        plan_validado.append({
            'id': item_id,
            'tipo': tipo,
            'titulo': titulo,
            'fecha_anterior': fecha_anterior,
            'fecha_nueva': nueva_fecha,
            'duracion_min': dur,
            'razon': razon,
        })

    return JsonResponse({
        'ok': True,
        'accion': 'reagendar_vencidas',
        'resumen': resumen or f'Plan de reagendamiento con {len(plan_validado)} items.',
        'plan': plan_validado,
    })


# ─── Preview: rellenar_calendario ──────────────────────────────────────


def _preview_rellenar_calendario(request) -> JsonResponse:
    user = request.user
    ahora = timezone.now()

    candidatos = _candidatos_rellenar(user, ahora)
    n_opps = len(candidatos['oportunidades'])
    n_pros = len(candidatos['prospectos'])
    total_cand = n_opps + n_pros
    log.info(
        'Rellenar: user=%s candidatos detectados=%d (opps=%d, prospectos=%d)',
        user.username, total_cand, n_opps, n_pros,
    )
    if total_cand == 0:
        return JsonResponse({
            'ok': True,
            'accion': 'rellenar_calendario',
            'resumen': (
                'No hay oportunidades ni prospectos sin actividad pendiente. '
                'Todo tu pipeline ya está cubierto.'
            ),
            'plan': [],
        })

    desde = ahora
    hasta = ahora + timedelta(days=10)
    slots = _slots_ocupados(user, desde, hasta)

    candidatos_md, src_map = _formato_candidatos_para_ai(candidatos)
    slots_md = _formato_slots_para_ai(slots)
    dias_habiles = _dias_habiles_siguientes(DIAS_HABILES_VENTANA)
    dias_str = ', '.join(d.strftime('%a %Y-%m-%d') for d in dias_habiles)

    user_block = (
        f'## Contexto\n'
        f'- **Fecha/hora actual (local)**: {timezone.localtime(ahora).strftime("%Y-%m-%d %H:%M (%a)")}\n'
        f'- **Días hábiles a tu disposición**: {dias_str}\n'
        f'- **Total candidatos sin actividad pendiente**: {total_cand}\n'
        f'\n'
        f'## Candidatos\n'
        f'{candidatos_md}\n\n'
        f'{slots_md}\n\n'
        f'## Tu tarea\n'
        f'Sugiere entre 1 y {MAX_PLAN_RELLENAR} actividades nuevas '
        f'llamando `proponer_plan_rellenar`. **DISTRIBUYE entre los '
        f'{DIAS_HABILES_VENTANA} días hábiles listados arriba**: máximo '
        f'{MAX_RELLENAR_POR_DIA} por día. Prioriza por impacto y no '
        f'satures un solo día.'
    )

    cfg = AsistenteConfig.get_singleton()
    if not cfg.activo:
        return JsonResponse({'ok': False, 'error': 'Asistente desactivado.'}, status=403)

    messages = [
        {'role': 'system', 'content': SYS_RELLENAR},
        {'role': 'user', 'content': user_block},
    ]
    tools = [_tool_proponer_rellenar()]

    try:
        resp = chat(
            messages=messages,
            tools=tools,
            model=cfg.modelo or MODEL_DEFAULT,
            temperature=0.4,
            # Subimos max_tokens porque ahora el plan puede tener hasta
            # MAX_PLAN_RELLENAR=20 items con titulo/descripcion/razon.
            max_tokens=3500,
        )
    except AsistenteError as e:
        log.warning('Calendario asistente (rellenar) error: %s', e)
        return JsonResponse({'ok': False, 'error': str(e)}, status=502)
    except Exception as e:
        log.exception('Error inesperado calendario asistente (rellenar): %s', e)
        return JsonResponse({'ok': False, 'error': f'Error inesperado: {e}'}, status=500)

    tc_list = resp.get('tool_calls') or []
    tool_args = None
    for tc in tc_list:
        if tc.get('name') == 'proponer_plan_rellenar':
            tool_args = tc.get('arguments') or {}
            break
    if not tool_args:
        log.warning('El AI no llamó la tool rellenar. text=%r', (resp.get('text') or '')[:200])
        return JsonResponse({
            'ok': False,
            'error': (
                'El asistente no devolvió un plan estructurado. '
                'Intenta de nuevo en unos segundos.'
            ),
        }, status=502)

    resumen = (tool_args.get('resumen') or '').strip()
    items_raw = tool_args.get('items') or []

    plan_validado = []
    for it in items_raw[:MAX_PLAN_RELLENAR]:
        fuente_tipo = (it.get('fuente_tipo') or '').strip()
        if fuente_tipo not in FUENTES_VALIDAS:
            continue
        try:
            fuente_id = int(it.get('fuente_id'))
        except (TypeError, ValueError):
            continue
        key = f'{fuente_tipo}-{fuente_id}'
        if key not in src_map:
            continue
        obj = src_map[key]

        tipo_act = (it.get('tipo_actividad') or 'tarea').strip().lower()
        if tipo_act not in {'llamada', 'reunion', 'email', 'tarea', 'otro'}:
            tipo_act = 'tarea'

        fecha = (it.get('fecha') or '').strip()
        try:
            dur = int(it.get('duracion_min') or 30)
        except (TypeError, ValueError):
            dur = 30
        if dur < 5:
            dur = 30
        if dur > 240:
            dur = 240

        titulo = _trunc(it.get('titulo') or '', 120)
        descripcion = _trunc(it.get('descripcion') or '', 500)
        razon = _trunc(it.get('razon') or '', 200)

        # Contexto humano del item (para que el frontend lo muestre)
        fuente_label = ''
        cliente_label = ''
        try:
            if fuente_tipo == 'oportunidad':
                fuente_label = (obj.oportunidad or '')[:80]
                if obj.cliente_id:
                    cliente_label = (obj.cliente.nombre_empresa or '')[:80]
            else:
                fuente_label = (obj.nombre or '')[:80]
                if obj.cliente_id:
                    cliente_label = (obj.cliente.nombre_empresa or '')[:80]
        except Exception:
            pass

        plan_validado.append({
            'tipo': 'actividad_nueva',
            'fuente_tipo': fuente_tipo,
            'fuente_id': fuente_id,
            'fuente_label': fuente_label,
            'cliente_label': cliente_label,
            'tipo_actividad': tipo_act,
            'fecha': fecha,
            'duracion_min': dur,
            'titulo': titulo,
            'descripcion': descripcion,
            'razon': razon,
        })

    # Chequeo de distribución: rechazar items que excedan el cap diario.
    # El AI tiene la regla en su prompt pero el backend valida por las
    # dudas — si concentra todo en un día, descartamos los extras.
    por_dia = {}
    plan_final = []
    for it in plan_validado:
        fecha_obj = _parse_iso_aware(it.get('fecha') or '')
        if not fecha_obj:
            # Fecha inválida: la dejamos pasar (el endpoint de aplicar
            # también valida) pero sin contar para el cap diario.
            plan_final.append(it)
            continue
        dia_key = fecha_obj.date().isoformat()
        por_dia.setdefault(dia_key, 0)
        if por_dia[dia_key] >= MAX_RELLENAR_POR_DIA:
            log.info(
                'Rellenar: rechazo item %r del %s (cap día %d alcanzado)',
                it.get('titulo'), dia_key, MAX_RELLENAR_POR_DIA,
            )
            continue
        por_dia[dia_key] += 1
        plan_final.append(it)

    return JsonResponse({
        'ok': True,
        'accion': 'rellenar_calendario',
        'resumen': resumen or f'Sugerencias para rellenar: {len(plan_final)} items.',
        'plan': plan_final,
    })


# ─── Aplicar: reagendar_vencidas ───────────────────────────────────────


def _aplicar_reagendar(user, plan: list) -> JsonResponse:
    """Aplica cambios de fecha. Cada item debe pertenecer al usuario."""
    aplicados = 0
    fallidos = 0
    errores = []

    for it in plan or []:
        item_id = (it.get('id') or '').strip()
        tipo = it.get('tipo')
        nueva_fecha_str = it.get('fecha_nueva') or it.get('nueva_fecha') or ''
        dur = int(it.get('duracion_min') or 30)
        if dur < 5:
            dur = 30
        if dur > 240:
            dur = 240
        nueva_fecha = _parse_iso_aware(nueva_fecha_str)
        if not nueva_fecha:
            fallidos += 1
            errores.append(f'{item_id}: fecha inválida "{nueva_fecha_str}"')
            continue

        # Parseo del id "actividad-XX" o "tarea-XX"
        if '-' in item_id:
            kind, _, raw_id = item_id.partition('-')
        else:
            kind = tipo or ''
            raw_id = item_id
        try:
            obj_id = int(raw_id)
        except (TypeError, ValueError):
            fallidos += 1
            errores.append(f'{item_id}: id mal formado')
            continue

        if kind == 'actividad' or tipo == 'actividad':
            try:
                act = Actividad.objects.get(pk=obj_id)
            except Actividad.DoesNotExist:
                fallidos += 1
                errores.append(f'Actividad #{obj_id} no encontrada')
                continue
            # Seguridad: solo si pertenece al user
            if act.creado_por_id != user.id:
                # Permitimos también si es participante
                if not act.participantes.filter(pk=user.id).exists():
                    fallidos += 1
                    errores.append(f'Actividad #{obj_id} no encontrada o sin permiso')
                    continue
            try:
                act.fecha_inicio = nueva_fecha
                act.fecha_fin = nueva_fecha + timedelta(minutes=dur)
                act.save(update_fields=['fecha_inicio', 'fecha_fin'])
                aplicados += 1
            except Exception as e:
                log.exception('No se pudo reagendar actividad %s: %s', obj_id, e)
                fallidos += 1
                errores.append(f'Actividad #{obj_id}: {e}')

        elif kind == 'tarea' or tipo == 'tarea':
            try:
                tar = Tarea.objects.get(pk=obj_id)
            except Tarea.DoesNotExist:
                fallidos += 1
                errores.append(f'Tarea #{obj_id} no encontrada')
                continue
            if tar.creado_por_id != user.id and tar.asignado_a_id != user.id:
                # Aceptamos también si es participante
                if not tar.participantes.filter(pk=user.id).exists():
                    fallidos += 1
                    errores.append(f'Tarea #{obj_id} no encontrada o sin permiso')
                    continue
            try:
                tar.fecha_limite = nueva_fecha
                tar.save(update_fields=['fecha_limite'])
                aplicados += 1
            except Exception as e:
                log.exception('No se pudo reagendar tarea %s: %s', obj_id, e)
                fallidos += 1
                errores.append(f'Tarea #{obj_id}: {e}')
        else:
            fallidos += 1
            errores.append(f'{item_id}: tipo desconocido')

    return JsonResponse({
        'ok': True,
        'aplicados': aplicados,
        'fallidos': fallidos,
        'errores': errores,
    })


# ─── Aplicar: rellenar_calendario ──────────────────────────────────────


def _aplicar_rellenar(user, plan: list) -> JsonResponse:
    """Crea actividades nuevas según el plan. Cada item debe apuntar a
    una opp/prospecto del usuario."""
    aplicados = 0
    fallidos = 0
    errores = []
    creadas_ids = []

    for it in plan or []:
        fuente_tipo = (it.get('fuente_tipo') or '').strip()
        if fuente_tipo not in FUENTES_VALIDAS:
            fallidos += 1
            errores.append(f'fuente_tipo inválido: {fuente_tipo!r}')
            continue
        try:
            fuente_id = int(it.get('fuente_id'))
        except (TypeError, ValueError):
            fallidos += 1
            errores.append(f'fuente_id inválido en item')
            continue

        # Seguridad: validar pertenencia
        if fuente_tipo == 'oportunidad':
            try:
                opp = TodoItem.objects.get(pk=fuente_id)
            except TodoItem.DoesNotExist:
                fallidos += 1
                errores.append(f'Oportunidad #{fuente_id} no encontrada')
                continue
            if opp.usuario_id != user.id:
                fallidos += 1
                errores.append(f'Oportunidad #{fuente_id} sin permiso')
                continue
            prospecto = None
        else:
            try:
                prospecto = Prospecto.objects.get(pk=fuente_id)
            except Prospecto.DoesNotExist:
                fallidos += 1
                errores.append(f'Prospecto #{fuente_id} no encontrado')
                continue
            if prospecto.usuario_id != user.id:
                fallidos += 1
                errores.append(f'Prospecto #{fuente_id} sin permiso')
                continue
            opp = None

        fecha_str = it.get('fecha') or ''
        fecha = _parse_iso_aware(fecha_str)
        if not fecha:
            fallidos += 1
            errores.append(f'{fuente_tipo}-{fuente_id}: fecha inválida "{fecha_str}"')
            continue

        try:
            dur = int(it.get('duracion_min') or 30)
        except (TypeError, ValueError):
            dur = 30
        if dur < 5:
            dur = 30
        if dur > 240:
            dur = 240

        tipo_act = (it.get('tipo_actividad') or 'tarea').strip().lower()
        valid_tipos = {'llamada', 'reunion', 'tarea', 'email', 'otro'}
        if tipo_act not in valid_tipos:
            tipo_act = 'tarea'

        titulo = _trunc(it.get('titulo') or '', 200)
        if not titulo:
            # Fallback: derivar del nombre de la fuente
            if opp:
                titulo = (opp.oportunidad or 'Seguimiento')[:200]
            else:
                titulo = (prospecto.nombre or 'Seguimiento')[:200]
        descripcion = _trunc(it.get('descripcion') or '', 1000)

        try:
            act = Actividad.objects.create(
                titulo=titulo,
                tipo_actividad=tipo_act,
                descripcion=descripcion,
                fecha_inicio=fecha,
                fecha_fin=fecha + timedelta(minutes=dur),
                creado_por=user,
                # Solo seteamos oportunidad si la fuente es opp.
                # Para prospectos no hay FK directo en Actividad; la opp
                # asociada (si existe en prospecto.oportunidad_creada) la
                # ignoramos a propósito: el prospecto aún no es opp y
                # vincular podría ensuciar reportes.
                oportunidad=opp if fuente_tipo == 'oportunidad' else None,
                color='#34C759',  # verde — actividad sugerida por AI
            )
            creadas_ids.append(act.id)
            aplicados += 1
        except Exception as e:
            log.exception('No se pudo crear actividad sugerida: %s', e)
            fallidos += 1
            errores.append(f'{fuente_tipo}-{fuente_id}: {e}')

    return JsonResponse({
        'ok': True,
        'aplicados': aplicados,
        'fallidos': fallidos,
        'errores': errores,
        'actividades_creadas_ids': creadas_ids,
    })


# ─── Chat libre del Calendario ─────────────────────────────────────────
# El asistente del calendario ahora soporta CHAT LIBRE además de las dos
# acciones rápidas. El usuario puede preguntar "qué tengo el viernes",
# "ayúdame a reagendar mis vencidas", "qué clientes llevan sin actividad",
# etc. El LLM tiene tools de lectura (server-side, devuelven datos al
# modelo en otro turno) y tools de plan (no se ejecutan, vuelven al
# frontend para que el usuario apruebe).
#
# Loop de tool calling estándar: hasta MAX_TOOL_ROUNDS rondas para evitar
# loops infinitos. Si en alguna ronda el modelo llama una tool de plan
# devolvemos el plan al frontend y terminamos el loop.

# Cap de rondas del loop de tool calling — anti-loop infinito.
MAX_TOOL_ROUNDS = 4

# Cap blando de turnos del usuario antes de que el frontend reset (no se
# valida en backend, solo es la cifra que mostramos en logs/heurísticas).
MAX_USER_TURNS_CHAT = 8


SYS_CHAT = (
    'Eres el **asistente del Calendario de IAMET**. Tu rol es ayudar al '
    'vendedor a organizar y entender su agenda: lo que tiene pendiente, '
    'lo vencido, qué oportunidades llevan sin movimiento, y proponer '
    'planes para reagendar o rellenar huecos.\n\n'

    '## Filosofía\n'
    '- **Directo, conciso, accionable.** No saludes en cada turno, no '
    'des rodeos. Mexicano profesional, tono colega.\n'
    '- **NO sycophancy** ("excelente pregunta", "claro que sí"). '
    'Respuestas útiles, no halagos.\n'
    '- **NO emojis.**\n'
    '- **NO inventes datos.** Si no tienes el dato llama una tool de '
    'lectura. Si no hay tool aplicable, dilo: "no tengo ese dato".\n'
    '- Mantén las respuestas **cortas** (1-4 párrafos como mucho) salvo '
    'que el user pida detalle explícito. Usa listas markdown cuando '
    'mencionas varios items.\n\n'

    '## Qué puedes hacer\n'
    '1. **Responder preguntas con datos reales** usando las tools de '
    'lectura: `consultar_vencidas`, `consultar_agenda(desde, hasta)`, '
    '`consultar_opps_sin_actividad`. Llamas la tool, recibes el JSON, '
    'respondes en lenguaje natural usando esos datos.\n'
    '2. **Proponer planes** con las tools `proponer_plan_reagendamiento` '
    '(para reagendar vencidas) o `proponer_plan_rellenar` (para llenar '
    'huecos con seguimientos nuevos). Cuando llamas una de estas el '
    'usuario verá una card con el plan y botones Aplicar/Cancelar — '
    'NO ejecuta nada hasta que él aprueba.\n\n'

    '## Cuándo usar cada tool\n'
    '- Si el user dice "reagenda mis vencidas", "ayúdame con lo vencido" '
    '→ primero `consultar_vencidas`, luego `proponer_plan_reagendamiento` '
    'con los items reales.\n'
    '- Si dice "llena mi calendario", "qué opps tengo paradas y agéndame '
    'algo" → primero `consultar_opps_sin_actividad`, luego '
    '`proponer_plan_rellenar`.\n'
    '- Si pregunta "qué tengo el viernes", "agenda de la semana" → '
    '`consultar_agenda(desde, hasta)` y responde con texto.\n'
    '- Si el user solo conversa o pregunta cosas fuera del scope del '
    'calendario, responde brevemente y, si aplica, ofrece redirigir al '
    'scope ("¿quieres que revise tu calendario?").\n\n'

    + _REGLAS_HORARIO +
    '\n'

    '## Duraciones heurísticas\n'
    '- Correo, llamada corta, seguimiento por correo: **10 min**.\n'
    '- Reunión interna / planning: **30 min**.\n'
    '- Reunión con cliente / presentación: **60 min**.\n'
    '- Revisión técnica: **45 min**.\n'
    '- Default 30 min.\n\n'

    '## Formato de fechas\n'
    'Cuando llames tools que requieren fecha (`consultar_agenda`), usa '
    'ISO local sin TZ: "YYYY-MM-DDTHH:MM:SS". Si no sabes la fecha '
    'exacta (p.ej. "el viernes"), calcúlala desde la fecha actual que '
    'te paso en el contexto del user.'
)


def _tool_consultar_vencidas() -> dict:
    """Read-only: devuelve actividades + tareas vencidas del user."""
    return {
        'type': 'function',
        'function': {
            'name': 'consultar_vencidas',
            'description': (
                'Devuelve la lista de actividades del calendario y tareas '
                'vencidas (fecha pasada, no completadas) del usuario '
                'actual. Úsala cuando el user pregunte qué tiene vencido '
                'o antes de proponer un plan de reagendamiento.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {},
            },
        },
    }


def _tool_consultar_agenda() -> dict:
    """Read-only: devuelve eventos del user en un rango de fechas."""
    return {
        'type': 'function',
        'function': {
            'name': 'consultar_agenda',
            'description': (
                'Devuelve los eventos (actividades y tareas con fecha '
                'límite) del usuario en un rango de fechas. Úsala para '
                'preguntas tipo "qué tengo el viernes", "agenda de la '
                'semana", "qué tengo del lunes al miércoles".'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'desde_iso': {
                        'type': 'string',
                        'description': (
                            'Fecha/hora de inicio del rango en ISO '
                            'local sin TZ: "YYYY-MM-DDTHH:MM:SS". '
                            'Si quieres "todo el día X", usa 00:00:00.'
                        ),
                    },
                    'hasta_iso': {
                        'type': 'string',
                        'description': (
                            'Fecha/hora de fin del rango (exclusive) en '
                            'ISO local sin TZ. Si quieres "todo el día '
                            'X", usa el día siguiente 00:00:00.'
                        ),
                    },
                },
                'required': ['desde_iso', 'hasta_iso'],
            },
        },
    }


def _tool_consultar_opps_sin_actividad() -> dict:
    """Read-only: devuelve opps + prospectos del user sin actividad pendiente."""
    return {
        'type': 'function',
        'function': {
            'name': 'consultar_opps_sin_actividad',
            'description': (
                'Devuelve las oportunidades activas y prospectos del '
                'usuario que NO tienen ninguna actividad pendiente '
                '(ni futura ni vencida). Úsala antes de proponer un '
                'plan de rellenar calendario o cuando el user pregunte '
                'por opps "olvidadas" / sin movimiento.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {},
            },
        },
    }


def _run_consultar_vencidas(user) -> dict:
    """Ejecuta server-side la tool read-only de vencidas. Devuelve dict
    JSON-serializable que se manda al LLM como tool_result."""
    ahora = timezone.now()
    actividades = _actividades_vencidas_del_user(user, ahora)
    tareas = _tareas_vencidas_del_user(user, ahora)
    out_actividades = []
    for a in actividades:
        cliente_nombre = ''
        opp_titulo = ''
        try:
            if a.oportunidad_id:
                opp_titulo = (a.oportunidad.oportunidad or '')[:80]
                if a.oportunidad.cliente_id:
                    cliente_nombre = (a.oportunidad.cliente.nombre_empresa or '')[:80]
        except Exception:
            pass
        out_actividades.append({
            'id': f'actividad-{a.id}',
            'tipo': 'actividad',
            'titulo': (a.titulo or '')[:160],
            'tipo_actividad': a.tipo_actividad or 'otro',
            'venció': _to_iso_local(a.fecha_inicio),
            'dias_vencida': _dias_desde(a.fecha_inicio),
            'cliente': cliente_nombre,
            'oportunidad': opp_titulo,
            'descripcion': _trunc(a.descripcion or '', DESC_TRUNCATE),
        })
    out_tareas = []
    for t in tareas:
        proyecto = ''
        try:
            if t.proyecto_id:
                proyecto = (t.proyecto.nombre or '')[:80]
        except Exception:
            pass
        out_tareas.append({
            'id': f'tarea-{t.id}',
            'tipo': 'tarea',
            'titulo': (t.titulo or '')[:160],
            'venció': _to_iso_local(t.fecha_limite),
            'dias_vencida': _dias_desde(t.fecha_limite),
            'prioridad': t.prioridad,
            'estado': t.estado,
            'proyecto': proyecto,
            'descripcion': _trunc(t.descripcion or '', DESC_TRUNCATE),
        })
    return {
        'total': len(out_actividades) + len(out_tareas),
        'actividades_vencidas': out_actividades,
        'tareas_vencidas': out_tareas,
        'ahora_local': timezone.localtime(ahora).strftime('%Y-%m-%dT%H:%M:%S'),
    }


def _run_consultar_agenda(user, desde_iso: str, hasta_iso: str) -> dict:
    """Ejecuta server-side la tool read-only de agenda. Devuelve eventos
    del usuario (actividades + tareas) entre [desde, hasta]."""
    desde = _parse_iso_aware(desde_iso)
    hasta = _parse_iso_aware(hasta_iso)
    if not desde or not hasta:
        return {
            'error': 'Fechas inválidas. Usa ISO sin TZ: YYYY-MM-DDTHH:MM:SS',
            'desde_iso_recibido': desde_iso,
            'hasta_iso_recibido': hasta_iso,
        }
    if hasta <= desde:
        return {
            'error': 'hasta_iso debe ser posterior a desde_iso',
        }
    # Tope de rango — máximo 60 días para no explotar tokens.
    if (hasta - desde).days > 60:
        hasta = desde + timedelta(days=60)

    actos = (Actividad.objects
             .filter(creado_por=user, completada=False)
             .filter(fecha_inicio__lt=hasta, fecha_fin__gt=desde)
             .select_related('oportunidad', 'oportunidad__cliente')
             .order_by('fecha_inicio'))
    out_actividades = []
    for a in actos[:80]:
        cliente_nombre = ''
        opp_titulo = ''
        try:
            if a.oportunidad_id:
                opp_titulo = (a.oportunidad.oportunidad or '')[:80]
                if a.oportunidad.cliente_id:
                    cliente_nombre = (a.oportunidad.cliente.nombre_empresa or '')[:80]
        except Exception:
            pass
        out_actividades.append({
            'id': f'actividad-{a.id}',
            'tipo_actividad': a.tipo_actividad or 'otro',
            'titulo': (a.titulo or '')[:160],
            'inicio': _to_iso_local(a.fecha_inicio),
            'fin': _to_iso_local(a.fecha_fin),
            'cliente': cliente_nombre,
            'oportunidad': opp_titulo,
        })

    tareas = (Tarea.objects
              .filter(fecha_limite__isnull=False)
              .filter(fecha_limite__gte=desde, fecha_limite__lt=hasta)
              .exclude(estado__in=['completada', 'cancelada'])
              .filter(Q(creado_por=user) | Q(asignado_a=user))
              .select_related('proyecto')
              .order_by('fecha_limite')
              .distinct())
    out_tareas = []
    for t in tareas[:50]:
        proyecto = ''
        try:
            if t.proyecto_id:
                proyecto = (t.proyecto.nombre or '')[:80]
        except Exception:
            pass
        out_tareas.append({
            'id': f'tarea-{t.id}',
            'titulo': (t.titulo or '')[:160],
            'fecha_limite': _to_iso_local(t.fecha_limite),
            'prioridad': t.prioridad,
            'estado': t.estado,
            'proyecto': proyecto,
        })

    return {
        'rango_desde': _to_iso_local(desde),
        'rango_hasta': _to_iso_local(hasta),
        'total_actividades': len(out_actividades),
        'total_tareas': len(out_tareas),
        'actividades': out_actividades,
        'tareas': out_tareas,
    }


def _run_consultar_opps_sin_actividad(user) -> dict:
    """Ejecuta server-side la tool read-only de opps sin actividad."""
    ahora = timezone.now()
    candidatos = _candidatos_rellenar(user, ahora)
    out_opps = []
    for opp in candidatos['oportunidades']:
        cliente_nombre = ''
        try:
            if opp.cliente_id:
                cliente_nombre = (opp.cliente.nombre_empresa or '')[:80]
        except Exception:
            pass
        out_opps.append({
            'fuente_tipo': 'oportunidad',
            'fuente_id': opp.id,
            'titulo': (opp.oportunidad or '')[:160],
            'cliente': cliente_nombre,
            'etapa': opp.etapa_corta or opp.etapa_completa or '',
            'monto': float(opp.monto) if opp.monto is not None else None,
            'probabilidad': getattr(opp, 'probabilidad_cierre', None),
            'dias_sin_movimiento': _dias_desde(opp.fecha_actualizacion),
            'comentarios': _trunc(opp.comentarios or '', DESC_TRUNCATE),
        })
    out_pros = []
    for p in candidatos['prospectos']:
        cliente_nombre = ''
        try:
            if p.cliente_id:
                cliente_nombre = (p.cliente.nombre_empresa or '')[:80]
        except Exception:
            pass
        out_pros.append({
            'fuente_tipo': 'prospecto',
            'fuente_id': p.id,
            'nombre': (p.nombre or '')[:160],
            'cliente': cliente_nombre,
            'etapa': p.get_etapa_display() if hasattr(p, 'get_etapa_display') else '',
            'producto': p.producto,
            'dias_sin_movimiento': _dias_desde(p.fecha_actualizacion),
            'comentarios': _trunc(p.comentarios or '', DESC_TRUNCATE),
        })
    return {
        'total': len(out_opps) + len(out_pros),
        'oportunidades_sin_actividad': out_opps,
        'prospectos_sin_actividad': out_pros,
    }


def _validar_plan_reagendar(user, tool_args: dict) -> dict | None:
    """Toma los args de proponer_plan_reagendamiento y los valida contra
    las vencidas reales del user. Devuelve dict {accion, resumen, plan}
    listo para el frontend, o None si no se pudo validar nada."""
    ahora = timezone.now()
    actividades = _actividades_vencidas_del_user(user, ahora)
    tareas = _tareas_vencidas_del_user(user, ahora)
    id_map = {}
    for a in actividades:
        id_map[f'actividad-{a.id}'] = a
    for t in tareas:
        id_map[f'tarea-{t.id}'] = t

    resumen = (tool_args.get('resumen') or '').strip()
    items_raw = tool_args.get('items') or []
    plan_validado = []
    for it in items_raw[:MAX_PLAN_REAGENDAR]:
        item_id = (it.get('id') or '').strip()
        if item_id not in id_map:
            continue
        obj = id_map[item_id]
        if item_id.startswith('actividad-'):
            tipo = 'actividad'
            titulo = (obj.titulo or '')[:200]
            fecha_anterior = _to_iso_local(obj.fecha_inicio)
        elif item_id.startswith('tarea-'):
            tipo = 'tarea'
            titulo = (obj.titulo or '')[:200]
            fecha_anterior = _to_iso_local(obj.fecha_limite)
        else:
            continue
        nueva_fecha = (it.get('nueva_fecha') or '').strip()
        dur = int(it.get('duracion_min') or 30)
        if dur < 5:
            dur = 30
        if dur > 240:
            dur = 240
        razon = (it.get('razon') or '').strip()[:200]
        plan_validado.append({
            'id': item_id,
            'tipo': tipo,
            'titulo': titulo,
            'fecha_anterior': fecha_anterior,
            'fecha_nueva': nueva_fecha,
            'duracion_min': dur,
            'razon': razon,
        })
    if not plan_validado:
        return None
    return {
        'accion': 'reagendar_vencidas',
        'resumen': resumen or f'Plan de reagendamiento con {len(plan_validado)} items.',
        'plan': plan_validado,
    }


def _validar_plan_rellenar(user, tool_args: dict) -> dict | None:
    """Toma los args de proponer_plan_rellenar y los valida contra los
    candidatos reales del user. Mismo cap diario que el flujo de preview."""
    ahora = timezone.now()
    candidatos = _candidatos_rellenar(user, ahora)
    src_map = {}
    for opp in candidatos['oportunidades']:
        src_map[f'oportunidad-{opp.id}'] = opp
    for p in candidatos['prospectos']:
        src_map[f'prospecto-{p.id}'] = p

    resumen = (tool_args.get('resumen') or '').strip()
    items_raw = tool_args.get('items') or []
    plan_validado = []
    for it in items_raw[:MAX_PLAN_RELLENAR]:
        fuente_tipo = (it.get('fuente_tipo') or '').strip()
        if fuente_tipo not in FUENTES_VALIDAS:
            continue
        try:
            fuente_id = int(it.get('fuente_id'))
        except (TypeError, ValueError):
            continue
        key = f'{fuente_tipo}-{fuente_id}'
        if key not in src_map:
            continue
        obj = src_map[key]
        tipo_act = (it.get('tipo_actividad') or 'tarea').strip().lower()
        if tipo_act not in {'llamada', 'reunion', 'email', 'tarea', 'otro'}:
            tipo_act = 'tarea'
        fecha = (it.get('fecha') or '').strip()
        try:
            dur = int(it.get('duracion_min') or 30)
        except (TypeError, ValueError):
            dur = 30
        if dur < 5:
            dur = 30
        if dur > 240:
            dur = 240
        titulo = _trunc(it.get('titulo') or '', 120)
        descripcion = _trunc(it.get('descripcion') or '', 500)
        razon = _trunc(it.get('razon') or '', 200)
        fuente_label = ''
        cliente_label = ''
        try:
            if fuente_tipo == 'oportunidad':
                fuente_label = (obj.oportunidad or '')[:80]
                if obj.cliente_id:
                    cliente_label = (obj.cliente.nombre_empresa or '')[:80]
            else:
                fuente_label = (obj.nombre or '')[:80]
                if obj.cliente_id:
                    cliente_label = (obj.cliente.nombre_empresa or '')[:80]
        except Exception:
            pass
        plan_validado.append({
            'tipo': 'actividad_nueva',
            'fuente_tipo': fuente_tipo,
            'fuente_id': fuente_id,
            'fuente_label': fuente_label,
            'cliente_label': cliente_label,
            'tipo_actividad': tipo_act,
            'fecha': fecha,
            'duracion_min': dur,
            'titulo': titulo,
            'descripcion': descripcion,
            'razon': razon,
        })

    # Mismo cap diario que el preview tradicional.
    por_dia = {}
    plan_final = []
    for it in plan_validado:
        fecha_obj = _parse_iso_aware(it.get('fecha') or '')
        if not fecha_obj:
            plan_final.append(it)
            continue
        dia_key = fecha_obj.date().isoformat()
        por_dia.setdefault(dia_key, 0)
        if por_dia[dia_key] >= MAX_RELLENAR_POR_DIA:
            continue
        por_dia[dia_key] += 1
        plan_final.append(it)

    if not plan_final:
        return None
    return {
        'accion': 'rellenar_calendario',
        'resumen': resumen or f'Sugerencias para rellenar: {len(plan_final)} items.',
        'plan': plan_final,
    }


def _chat_libre(request) -> JsonResponse:
    """Endpoint del chat libre del calendario. Loop de tool calling:
    el LLM puede llamar tools de lectura (se ejecutan server-side y se
    devuelven al modelo en el siguiente turno) o tools de plan (devuelven
    el plan al frontend para que el user lo apruebe).
    """
    user = request.user
    try:
        body = json.loads(request.body or '{}')
    except Exception:
        body = {}
    message = (body.get('message') or '').strip()
    history_in = body.get('history') or []
    if not message:
        return JsonResponse({'ok': False, 'error': 'mensaje vacío'}, status=400)

    cfg = AsistenteConfig.get_singleton()
    if not cfg.activo:
        return JsonResponse({'ok': False, 'error': 'Asistente desactivado.'}, status=403)

    # Contexto inicial — fecha actual + ventana de días hábiles. Lo
    # inyectamos como mensaje 'system' adicional para no inflar el SYS_CHAT.
    ahora = timezone.now()
    dias_habiles = _dias_habiles_siguientes(DIAS_HABILES_VENTANA)
    dias_str = ', '.join(d.strftime('%a %Y-%m-%d') for d in dias_habiles)
    ctx_block = (
        f'Contexto de tiempo:\n'
        f'- Fecha/hora actual local: '
        f'{timezone.localtime(ahora).strftime("%Y-%m-%d %H:%M (%a)")}\n'
        f'- Días hábiles próximos: {dias_str}\n'
    )

    # Sanitizar historial: solo aceptamos roles 'user' y 'assistant', y
    # contenidos string. Cap blando por seguridad (no debería pasar de 16
    # mensajes en práctica).
    messages = [
        {'role': 'system', 'content': SYS_CHAT},
        {'role': 'system', 'content': ctx_block},
    ]
    for m in (history_in or [])[-30:]:
        role = (m.get('role') or '').strip()
        content = m.get('content') or ''
        if role not in ('user', 'assistant'):
            continue
        if not isinstance(content, str):
            continue
        messages.append({'role': role, 'content': content[:4000]})
    messages.append({'role': 'user', 'content': message[:4000]})

    tools = [
        _tool_consultar_vencidas(),
        _tool_consultar_agenda(),
        _tool_consultar_opps_sin_actividad(),
        _tool_proponer_reagendar(),
        _tool_proponer_rellenar(),
    ]

    model = cfg.modelo or MODEL_DEFAULT
    reply_text = ''
    plan_payload = None

    try:
        for ronda in range(MAX_TOOL_ROUNDS):
            resp = chat(
                messages=messages,
                tools=tools,
                model=model,
                temperature=0.4,
                max_tokens=2500,
            )
            tc_list = resp.get('tool_calls') or []
            text_out = (resp.get('text') or '').strip()

            if not tc_list:
                # Respuesta final en texto, terminamos.
                reply_text = text_out
                break

            # Detectar si llamó alguna tool de PLAN — si sí, sacamos plan
            # y terminamos (la tool de plan no se ejecuta, regresa al
            # frontend).
            plan_tc = None
            for tc in tc_list:
                if tc.get('name') in ('proponer_plan_reagendamiento',
                                      'proponer_plan_rellenar'):
                    plan_tc = tc
                    break
            if plan_tc:
                args = plan_tc.get('arguments') or {}
                if plan_tc.get('name') == 'proponer_plan_reagendamiento':
                    plan_payload = _validar_plan_reagendar(user, args)
                else:
                    plan_payload = _validar_plan_rellenar(user, args)
                # Acompañar el plan con texto preliminar si el modelo
                # dejó algo en `text_out`; muchas veces viene vacío.
                reply_text = text_out
                break

            # Procesar tools de lectura: ejecutar server-side y agregar
            # tool_result al stream de mensajes para que el modelo
            # continúe.
            # Primero agregamos el mensaje 'assistant' con los tool_calls
            # tal cual los pidió el modelo, en formato OpenAI.
            assistant_msg = {
                'role': 'assistant',
                'content': text_out or None,
                'tool_calls': [
                    {
                        'id': tc.get('id') or f'call_{ronda}_{i}',
                        'type': 'function',
                        'function': {
                            'name': tc.get('name') or '',
                            'arguments': tc.get('arguments_str') or json.dumps(tc.get('arguments') or {}),
                        },
                    } for i, tc in enumerate(tc_list)
                ],
            }
            messages.append(assistant_msg)

            # Ejecutar cada tool de lectura y agregar el tool_result.
            for i, tc in enumerate(tc_list):
                name = tc.get('name') or ''
                args = tc.get('arguments') or {}
                call_id = tc.get('id') or f'call_{ronda}_{i}'
                try:
                    if name == 'consultar_vencidas':
                        result = _run_consultar_vencidas(user)
                    elif name == 'consultar_agenda':
                        result = _run_consultar_agenda(
                            user,
                            args.get('desde_iso') or '',
                            args.get('hasta_iso') or '',
                        )
                    elif name == 'consultar_opps_sin_actividad':
                        result = _run_consultar_opps_sin_actividad(user)
                    else:
                        result = {'error': f'tool desconocida: {name}'}
                except Exception as e:
                    log.exception('Error ejecutando tool %s: %s', name, e)
                    result = {'error': f'fallo ejecutando {name}: {e}'}
                messages.append({
                    'role': 'tool',
                    'tool_call_id': call_id,
                    'name': name,
                    'content': json.dumps(result, ensure_ascii=False, default=str)[:14000],
                })

            # Loop sigue: el modelo verá los tool_results y responderá
            # otra vez (puede llamar más tools o ya responder en texto).
            continue
        else:
            # Salimos del for sin break — alcanzamos el cap. Devolvemos
            # un mensaje honesto.
            if not reply_text and not plan_payload:
                reply_text = (
                    'Estoy dando muchas vueltas con tus datos. Intenta '
                    'reformular la pregunta o pídeme algo más concreto.'
                )
    except AsistenteError as e:
        log.warning('Calendario asistente chat error: %s', e)
        return JsonResponse({'ok': False, 'error': str(e)}, status=502)
    except Exception as e:
        log.exception('Error inesperado en chat calendario: %s', e)
        return JsonResponse(
            {'ok': False, 'error': f'Error inesperado: {str(e)[:200]}'},
            status=500,
        )

    return JsonResponse({
        'ok': True,
        'reply': reply_text or '',
        'plan': plan_payload,  # None o {accion, resumen, plan: [...]}
    })


# ─── Endpoints públicos ────────────────────────────────────────────────


@login_required
@require_POST
def api_calendario_asistente_chat(request):
    """Chat libre del asistente del calendario. Loop de tool calling
    server-side. SIEMPRE devuelve JSON aunque algo explote internamente.
    Body: {"message": str, "history": [{role, content}, ...]}.
    Response: {ok, reply, plan: {accion, resumen, plan: [...]} | null}.
    """
    try:
        return _chat_libre(request)
    except Exception as e:
        log.exception('Error en api_calendario_asistente_chat')
        return JsonResponse(
            {'ok': False, 'error': f'Error interno: {str(e)[:200]}'},
            status=500,
        )


@login_required
@require_POST
def api_calendario_asistente_preview(request):
    """Genera el plan llamando al AI. NO toca la DB. El frontend muestra
    el plan al usuario para que acepte o rechace.

    SIEMPRE devuelve JSON, nunca HTML 500. El frontend hace
    `response.json()` y si el body es HTML revienta con "Respuesta
    inválida"; por eso atrapamos toda Exception aquí.
    """
    try:
        try:
            body = json.loads(request.body or '{}')
        except Exception:
            body = {}
        accion = (body.get('accion') or '').strip()
        log.info(
            'Preview asistente calendario: accion=%r user=%s',
            accion, getattr(request.user, 'username', '?'),
        )
        if accion == 'reagendar_vencidas':
            return _preview_reagendar_vencidas(request)
        if accion == 'rellenar_calendario':
            return _preview_rellenar_calendario(request)
        return JsonResponse(
            {'ok': False, 'error': f'acción inválida: {accion!r}'},
            status=400,
        )
    except Exception as e:
        log.exception('Error en api_calendario_asistente_preview')
        return JsonResponse(
            {'ok': False, 'error': f'Error interno: {str(e)[:200]}'},
            status=500,
        )


@login_required
@require_POST
def api_calendario_asistente_aplicar(request):
    """Aplica el plan aceptado por el user. NO llama al AI — solo escribe
    en DB. Valida pertenencia de cada item. Garantiza respuesta JSON
    (nunca HTML 500) por la misma razón que el preview."""
    try:
        try:
            body = json.loads(request.body or '{}')
        except Exception:
            body = {}
        accion = (body.get('accion') or '').strip()
        plan = body.get('plan') or []
        log.info(
            'Aplicar asistente calendario: accion=%r items=%d user=%s',
            accion, len(plan) if isinstance(plan, list) else -1,
            getattr(request.user, 'username', '?'),
        )
        if not isinstance(plan, list):
            return JsonResponse(
                {'ok': False, 'error': 'plan debe ser lista'},
                status=400,
            )
        if accion == 'reagendar_vencidas':
            return _aplicar_reagendar(request.user, plan)
        if accion == 'rellenar_calendario':
            return _aplicar_rellenar(request.user, plan)
        return JsonResponse(
            {'ok': False, 'error': f'acción inválida: {accion!r}'},
            status=400,
        )
    except Exception as e:
        log.exception('Error en api_calendario_asistente_aplicar')
        return JsonResponse(
            {'ok': False, 'error': f'Error interno: {str(e)[:200]}'},
            status=500,
        )
