# ----------------------------------------------------------------------
# views_asistente_prospeccion.py — Asistente AI específico para Prospectos.
# ----------------------------------------------------------------------
# Hilo independiente del consultor general y del asistente de ideas.
# Cada Prospecto tiene su propia conversación persistida en
# ProspectoAsistenteMensaje. El asistente actúa como **coach táctico
# de ventas** — su rol es ayudar al vendedor a destrabar deals, dar
# próximos pasos concretos, redactar mensajes y responder objeciones.
# NO piensa por el vendedor — aclara opciones y sugiere estrategias.
#
# Permisos: el vendedor dueño del prospecto, miembros de su grupo,
# supervisores y administradores pueden chatear.
#
# Endpoints:
#   GET  /app/api/prospectos/<id>/asistente/mensajes/  → historial
#   POST /app/api/prospectos/<id>/asistente/mensaje/   → enviar + LLM
#   POST /app/api/prospectos/<id>/asistente/resumen/   → resumen → comentario
#   POST /app/api/prospectos/<id>/asistente/reset/     → vaciar hilo
# ----------------------------------------------------------------------

import json
import logging
from datetime import datetime, timedelta

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import (
    AsistenteConfig, Prospecto, ProspectoActividad, ProspectoComentario,
    ProspectoAsistenteMensaje, TodoItem, Cotizacion,
)
from .asistente_provider import chat, AsistenteError
from .views_grupos import comparten_grupo
from .views_utils import is_supervisor

log = logging.getLogger(__name__)


# Ventana de contexto que enviamos al LLM por turno.
MAX_HISTORY_MSGS = 20

# Tope de turnos del USUARIO antes de disparar auto-save (igual que Ideas).
MAX_USER_TURNS = 8

# Prefijo del resumen AI — para identificarlo entre comentarios.
RESUMEN_AI_PREFIX = 'Resumen de IAMET AI'


# ─── Permisos ──────────────────────────────────────────────────────────


def _can_access_prospecto(prospecto: Prospecto, user) -> bool:
    """El vendedor dueño, sus compañeros de grupo, supervisores y admins
    pueden chatear sobre el prospecto. Los demás no.
    """
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or is_supervisor(user):
        return True
    if prospecto.usuario_id == user.id:
        return True
    # asignado_por también puede ver (típicamente supervisor que lo asignó)
    if prospecto.asignado_por_id == user.id:
        return True
    # Compañero de grupo del vendedor dueño
    try:
        if comparten_grupo(user, prospecto.usuario):
            return True
    except Exception:
        pass
    return False


def _get_prospecto_with_access(prospecto_id: int, user):
    """Devuelve (prospecto, access) donde access es:
      - 'not_found': no existe.
      - 'no_access': existe pero el user no tiene permisos.
      - 'ok': puede chatear.
    """
    try:
        p = (Prospecto.objects
             .select_related('cliente', 'contacto', 'usuario', 'asignado_por',
                             'oportunidad_creada')
             .get(pk=prospecto_id))
    except Prospecto.DoesNotExist:
        return (None, 'not_found')
    if not _can_access_prospecto(p, user):
        return (p, 'no_access')
    return (p, 'ok')


# ─── Helpers de datos del prospecto (lo que el AI necesita saber) ──────


def _dias_desde(dt) -> int | None:
    if not dt:
        return None
    try:
        return max(0, (timezone.now() - dt).days)
    except Exception:
        return None


def _humanize_dias(dias) -> str:
    if dias is None:
        return 'desconocido'
    if dias == 0:
        return 'hoy'
    if dias == 1:
        return 'hace 1 día'
    if dias < 30:
        return f'hace {dias} días'
    meses = dias // 30
    if meses == 1:
        return 'hace ~1 mes'
    return f'hace ~{meses} meses'


def _ultimo_resumen_ai(prospecto: Prospecto) -> str:
    """Último ProspectoComentario que parece resumen AI."""
    c = (ProspectoComentario.objects
         .filter(prospecto=prospecto, texto__startswith=RESUMEN_AI_PREFIX)
         .order_by('-fecha_creacion')
         .first())
    return c.texto if c else ''


def _count_user_turns(prospecto: Prospecto) -> int:
    return ProspectoAsistenteMensaje.objects.filter(
        prospecto=prospecto, role='user'
    ).count()


def _prospecto_context_block(prospecto: Prospecto) -> str:
    """Bloque markdown con todo lo que el AI debe saber del prospecto:
    perfil, etapa, tiempo en etapa, actividad agendada o falta de ella,
    historia de comentarios, oportunidad vinculada si existe.
    """
    p = prospecto
    cliente_nombre = p.cliente.nombre_empresa if p.cliente_id else '—'
    contacto = p.contacto.nombre if p.contacto_id else '—'
    vendedor = p.usuario.get_full_name() or p.usuario.username if p.usuario_id else '—'
    asignado_por = (
        p.asignado_por.get_full_name() or p.asignado_por.username
    ) if p.asignado_por_id else None

    dias_desde_creacion = _dias_desde(p.fecha_creacion)
    dias_desde_act = _dias_desde(p.fecha_actualizacion)

    # Actividades agendadas (pendientes y vencidas)
    ahora = timezone.now()
    pendientes = list(ProspectoActividad.objects
                      .filter(prospecto=p, completada=False)
                      .order_by('fecha_programada')[:3])
    actividad_lines = []
    if pendientes:
        for a in pendientes:
            estado = 'vencida' if a.fecha_programada < ahora else 'pendiente'
            fecha = a.fecha_programada.strftime('%Y-%m-%d %H:%M') if a.fecha_programada else '—'
            actividad_lines.append(
                f'  - [{estado}] {a.get_tipo_display()} · {fecha} · {a.descripcion[:100]}'
            )
    else:
        actividad_lines.append('  - **Sin actividad agendada** (red flag — no hay próximo touchpoint).')

    # Comentarios / bitácora — los últimos 10
    coms = list(ProspectoComentario.objects
                .filter(prospecto=p)
                .order_by('-fecha_creacion')[:10])
    coms.reverse()
    com_lines = []
    if p.comentarios:
        com_lines.append(f'  - **(Comentario inicial)** {p.comentarios[:300]}')
    for c in coms:
        autor = c.usuario.get_full_name() or c.usuario.username if c.usuario_id else 'desconocido'
        fecha = c.fecha_creacion.strftime('%Y-%m-%d') if c.fecha_creacion else ''
        com_lines.append(f'  - **{autor}** ({fecha}): {c.texto[:300]}')
    if not com_lines:
        com_lines.append('  - (sin comentarios todavía)')

    # Oportunidad vinculada
    opp_block = ''
    if p.oportunidad_creada_id:
        opp = p.oportunidad_creada
        opp_block = (
            f'\n## Oportunidad vinculada (ya convertida)\n'
            f'- **Título:** {opp.oportunidad}\n'
            f'- **Etapa:** {opp.etapa_corta or opp.etapa_completa or "—"}\n'
            f'- **Monto:** ${opp.monto:,.0f} MXN\n'
            f'- **Producto:** {opp.producto}\n'
            f'- **Tipo:** {opp.tipo_negociacion}\n'
        )
    # Histórico del cliente (cuántas opps cerradas tiene, ticket promedio)
    cliente_hist = ''
    if p.cliente_id:
        cerradas = TodoItem.objects.filter(
            cliente=p.cliente, etapa_corta__in=['Ganado', 'Pagado']
        )
        total_cerradas = cerradas.count()
        if total_cerradas > 0:
            from django.db.models import Sum
            ganado = cerradas.aggregate(t=Sum('monto')).get('t') or 0
            cliente_hist = (
                f'\n## Histórico del cliente (data del CRM)\n'
                f'- **Opps cerradas (ganado/pagado):** {total_cerradas}\n'
                f'- **Monto ganado histórico:** ${ganado:,.0f} MXN\n'
            )
        else:
            cliente_hist = (
                '\n## Histórico del cliente (data del CRM)\n'
                '- **El cliente NO tiene opps cerradas con IAMET** — '
                'sería el primer cierre. Esto es relevante para tu '
                'estrategia (mayor fricción de confianza).\n'
            )

    return (
        '\n## El prospecto sobre el que estamos hablando\n'
        f'- **Nombre:** {p.nombre}\n'
        f'- **Cliente:** {cliente_nombre}\n'
        f'- **Contacto principal:** {contacto}\n'
        f'- **Vendedor responsable:** {vendedor}'
        + (f' (asignado por {asignado_por})' if asignado_por else '')
        + '\n'
        f'- **Producto/Marca:** {p.producto}\n'
        f'- **Área:** {p.area}\n'
        f'- **Pipeline:** {p.get_tipo_pipeline_display()}\n'
        f'- **Etapa actual:** {p.get_etapa_display()}\n'
        f'- **Creado:** {_humanize_dias(dias_desde_creacion)}\n'
        f'- **Última actualización:** {_humanize_dias(dias_desde_act)}'
        + (' — el prospecto lleva tiempo sin movimiento' if dias_desde_act and dias_desde_act >= 14 else '')
        + '\n\n'
        '## Actividad agendada\n'
        + '\n'.join(actividad_lines) + '\n\n'
        '## Bitácora / comentarios (últimos)\n'
        + '\n'.join(com_lines) + '\n'
        + cliente_hist + opp_block
    )


# ─── System prompt ─────────────────────────────────────────────────────


def _closure_guidance(turn_number: int) -> str:
    """Igual al de Ideas — empuja al AI a cerrar antes del tope para no
    eternizar el chat."""
    if turn_number <= 2:
        return (
            'ETAPA TEMPRANA. Puedes hacer 1 pregunta clave al final si '
            'genuinamente la necesitas para destrabar el deal.'
        )
    if turn_number <= 4:
        return (
            'ETAPA INTERMEDIA. Reduce preguntas; proponé acciones '
            'concretas. Si vas a preguntar, que sea LA pregunta clave '
            'para avanzar.'
        )
    if turn_number <= 6:
        return (
            'ETAPA DE CIERRE. NO termines con pregunta nueva. Resume '
            'el siguiente paso concreto y sugiere "Guardar resumen" '
            'para tener el plan en la bitácora. '
            f'Turno {turn_number} de {MAX_USER_TURNS}.'
        )
    return (
        'ÚLTIMOS TURNOS. NO hagas preguntas. Tu respuesta debe ser un '
        'plan de acción claro: 1-2 líneas con el contexto + UN próximo '
        'paso concreto. Termina con: "Guarda el resumen para tenerlo '
        f'en la bitácora del prospecto." Turno {turn_number} de '
        f'{MAX_USER_TURNS} (próximo se auto-guardará el resumen).'
    )


def _system_prompt(prospecto: Prospecto, config: AsistenteConfig, user,
                   turn_number: int = 1, previous_resumen: str = '') -> dict:
    """System prompt del asistente de prospección. Personalidad de coach
    táctico de ventas — pragmático, no piensa por el vendedor, ofrece
    opciones y sugerencias para destrabar."""
    first = (user.first_name or user.username).strip()
    nombre_asist = config.nombre or 'el asistente'
    base = (
        f'Eres {nombre_asist}, asistente AI de IAMET en su rol de '
        f'**coach táctico de ventas**. Estás hablando con {first} sobre '
        'un prospecto específico de su pipeline. Tu trabajo NO es '
        'pensar por el vendedor ni decidir cosas en su lugar — es '
        'ayudarle a aclarar sus ideas, darle opciones y sugerencias '
        'cuando se sienta atascado, y empujar a que el deal se mueva.\n\n'

        '## Filosofía de coach (LÉELA bien)\n'
        '- **Aclaras, no decides.** El vendedor manda; tú le das '
        'panorama y opciones.\n'
        '- **Ofreces alternativas, no veredictos.** "Hay dos rutas: A '
        'es más segura pero más lenta; B es agresiva. Depende de qué '
        'tan caliente está la cuenta para ti".\n'
        '- **Concretas, escrappy.** "Mándale este correo hoy", "agenda '
        'llamada esta semana", NO "implementa un proceso de '
        'nurturing multi-touch".\n'
        '- **Lees el contexto del prospecto** (etapa, tiempo sin '
        'movimiento, comentarios, actividad agendada o ausencia de '
        'ella, histórico del cliente) y construyes SOBRE eso. NO '
        'inventes datos que no están en el contexto.\n'
        '- **Concisa por default**: 4-7 líneas por turno. Expandes '
        'solo si el vendedor pide profundidad.\n'
        '- NO uses emojis decorativos. Para énfasis usa **negritas**.\n'
        '- Español mexicano natural, tono colega senior. '
        'Mexicanismos suaves OK con moderación.\n\n'

        '## Empresa: contexto IAMET\n'
        'IAMET es una empresa pequeña B2B mexicana de tecnología, '
        'automatización industrial y sistemas de identificación. '
        'Marcas que manejamos: Zebra, Panduit, APC, Avigilon, Genetec, '
        'Axis, etc. Equipo de ventas chico, sin SDRs ni equipo de '
        'marketing automation. Las recomendaciones útiles son '
        'manuales: una llamada, una visita, un correo bien escrito, '
        'una propuesta clara.\n\n'

        '## Detectores en el contexto del prospecto\n'
        'Antes de responder, identifica señales que importan:\n'
        '- **Etapa estancada**: si la "última actualización" es ≥14 '
        'días, el deal está enfriándose.\n'
        '- **Sin actividad agendada**: red flag — significa que nadie '
        'está empujando.\n'
        '- **Actividad vencida**: el vendedor tiene un compromiso '
        'no cumplido — abórdalo primero.\n'
        '- **Cliente sin histórico**: primer cierre con IAMET → más '
        'fricción de confianza, sugiere prueba/demo.\n'
        '- **Cliente con histórico fuerte**: ya confía → puedes pedir '
        'cierre más directo.\n'
        '- **Comentario inicial vs. silencio**: si solo hay el '
        'comentario inicial y nada después, el vendedor no ha hecho '
        'follow-up. Empieza por ahí.\n\n'

        '## Las 2 funciones principales (sugerencias del welcome)\n'
        '**A) "Próximo paso recomendado"** — la pregunta más útil. '
        'Estructura tu respuesta así:\n'
        '   - 1-2 líneas: dónde está el prospecto AHORA (etapa, '
        'tiempo, ¿agendado?).\n'
        '   - **El próximo paso (UNO solo):** acción concreta + '
        'cuándo. Ejemplo: "Llamar a [contacto] esta semana para '
        'confirmar si recibió la cotización; si no responde, escalar '
        'con [otro contacto]".\n'
        '   - **Por qué este paso ahora:** 1 línea de justificación '
        'basada en lo que ves en el contexto.\n'
        '   - **Alternativa B:** otra acción que también podrías '
        'tomar si la primera no aplica.\n'
        '   No hagas un plan de 10 pasos — UNO bien argumentado vale '
        'más.\n\n'
        '**B) "Coach de objeciones / cómo cierro"** — modo más libre. '
        'El vendedor te dice qué objeción está enfrentando o qué '
        'duda tiene de cómo avanzar. Estructura:\n'
        '   - **Lo que está pasando** (1 línea, lee la objeción).\n'
        '   - **2-3 ángulos para responder** (opciones, no un solo '
        'guion). Cada uno con su trade-off ("éste te protege el '
        'margen", "éste cierra rápido pero descuento").\n'
        '   - **Recomendación corta** de cuál ángulo escogerías '
        'según el contexto del prospecto (etapa, histórico, etc.).\n\n'

        '## Cuándo redactar mensajes\n'
        'Si el vendedor pide "redáctame un correo / mensaje / '
        'whatsapp", entrégaselo listo para copiar — texto plano, '
        'corto, profesional, con asunto si es correo. Tono cordial '
        'mexicano B2B. NO inventes nombres ni datos que no estén en '
        'el contexto.\n\n'

        '## Reglas duras\n'
        '- NO inventes información del cliente, del prospecto, ni de '
        'la competencia. Si no está en el contexto, dilo y pídelo.\n'
        '- NO digas "te recomiendo despedir/contratar/invertir mucho '
        'dinero" — esas decisiones no son tuyas.\n'
        '- NO uses frases sycophantic ("gran prospecto", '
        '"excelente cliente"). Sé pragmático.\n'
        '- Si el vendedor pide tu opinión sobre si dropear el '
        'prospecto, NO decidas tú — listale los criterios para '
        'decidir y recomiéndale que lo evalúe con su supervisor si '
        'lleva mucho tiempo enfriado.\n'

        '## Formato visual (cuando aplique)\n'
        '- `### Título` para secciones (máximo `###`).\n'
        '- **Tablas markdown** para comparar opciones.\n'
        '- `::: kpis :::` cuando tengas 3+ números (monto, días sin '
        'movimiento, # cotizaciones). Formato: `Label | Valor | Sub`.\n'
        '- Bullets `-` para enumerar.\n'
    )

    # Bloque dinámico de cierre por turno
    closure_block = (
        '\n\n## Etapa de cierre del chat (turno actual)\n'
        + _closure_guidance(turn_number) + '\n'
    )
    # Resumen previo si lo hay (continuidad después de auto-save)
    resumen_block = ''
    if previous_resumen:
        resumen_block = (
            '\n\n## Resumen de la conversación anterior (continuidad)\n'
            'Anteriormente conversaste con el vendedor sobre este '
            'prospecto. Cuando se llenó el chat, guardaste este '
            'resumen en la bitácora. Úsalo como base — NO repitas '
            'preguntas que ya respondió arriba:\n\n'
            + previous_resumen.strip() + '\n'
        )
    return {
        'role': 'system',
        'content': (
            base + _prospecto_context_block(prospecto)
            + resumen_block + closure_block
        ),
    }


# ─── Helpers internos ──────────────────────────────────────────────────


def _build_context(prospecto: Prospecto) -> list[dict]:
    msgs = list(
        ProspectoAsistenteMensaje.objects
        .filter(prospecto=prospecto)
        .order_by('-fecha')[:MAX_HISTORY_MSGS]
    )
    msgs.reverse()
    return [{'role': m.role, 'content': m.contenido} for m in msgs]


def _msg_to_dict(m: ProspectoAsistenteMensaje) -> dict:
    return {
        'id': m.id,
        'role': m.role,
        'contenido': m.contenido,
        'fecha': m.fecha.isoformat() if m.fecha else None,
    }


def _generar_resumen_llm(prospecto: Prospecto, msgs, cfg: AsistenteConfig) -> tuple[str, str]:
    """Genera un resumen plain-text del hilo del AI. Devuelve (texto, error)."""
    if not msgs:
        return ('', 'No hay conversación que resumir todavía.')
    transcript = '\n\n'.join(
        f'[{m.role.upper()}] {m.contenido}' for m in msgs if m.contenido
    )
    sys_msg = {
        'role': 'system',
        'content': (
            'Eres un asistente que SINTETIZA conversaciones de coaching '
            'de ventas — no las copia. Te paso la transcripción de un '
            'chat entre un vendedor y un AI sobre cómo destrabar un '
            'prospecto. Devuelve un resumen MUY corto que el vendedor '
            'o un colega pueda leer en 20 segundos: dónde estamos con '
            'el prospecto y qué sigue.\n\n'
            'Reglas duras:\n'
            '- NO copies frases textuales del chat.\n'
            '- NO transcribas el ida-y-vuelta.\n'
            '- NO incluyas tu opinión ni preguntas abiertas — solo lo '
            'que quedó CLARO como plan.\n'
            '- Tono ejecutivo, accionable.\n\n'
            'Formato OBLIGATORIO — PLAIN TEXT, sin markdown (nada de '
            '**, ##, backticks, ni guiones bajos):\n\n'
            '  Resumen de IAMET AI\n'
            '\n'
            '  Estado del prospecto:\n'
            '  · 1 a 2 bullets describiendo dónde está ahora y qué '
            'señales detectamos (estancado, sin actividad, objeción '
            'pendiente, etc).\n'
            '\n'
            '  Próximo paso:\n'
            '  · 1 a 3 bullets con acciones concretas a ejecutar.\n\n'
            'Reglas de formato:\n'
            '- Usa · (middot) para bullets, no - ni *.\n'
            '- Máximo 8 líneas totales.\n'
            '- NO inventes contenido que no se discutió.\n'
            '- NO uses emojis.\n'
        ),
    }
    user_msg = {
        'role': 'user',
        'content': (
            f'Prospecto: {prospecto.nombre}\n'
            f'Cliente: {prospecto.cliente.nombre_empresa if prospecto.cliente_id else "—"}\n'
            f'Etapa: {prospecto.get_etapa_display()}\n\n'
            f'Transcripción:\n\n{transcript}'
        ),
    }
    try:
        resp = chat(
            messages=[sys_msg, user_msg],
            tools=None,
            model=cfg.modelo,
            temperature=0.3,
            max_tokens=500,
        )
        resumen = (resp.get('text') or '').strip()
    except AsistenteError as e:
        log.warning('Prospecto resumen error: %s', e)
        return ('', str(e))
    except Exception as e:
        log.exception('Error inesperado en prospecto resumen: %s', e)
        return ('', f'Error inesperado: {e}')
    if not resumen:
        return ('', 'El asistente no generó resumen.')
    # Limpieza defensiva (igual que Ideas)
    import re as _re
    resumen = _re.sub(r'\*\*', '', resumen)
    resumen = _re.sub(r'^#+\s*', '', resumen, flags=_re.MULTILINE)
    resumen = _re.sub(r'^[-*]\s+', '· ', resumen, flags=_re.MULTILINE)
    return (resumen, '')


def _msg_no_access(prospecto: Prospecto) -> str:
    autor = (
        prospecto.usuario.first_name or prospecto.usuario.username
    ) if prospecto.usuario_id else 'el vendedor responsable'
    return (
        f'Este prospecto es de **{autor}**. No puedo opinar aquí — '
        'solo le contesto al vendedor responsable, a su equipo o a '
        'supervisores. Si quieres ayudar a este prospecto, pídele '
        f'a {autor} que te incluya en su grupo de trabajo.'
    )


# ─── Endpoints ─────────────────────────────────────────────────────────


@login_required
@require_http_methods(['GET'])
def api_prospecto_asistente_mensajes(request, prospecto_id: int):
    """Historial del chat AI sobre un prospecto."""
    p, access = _get_prospecto_with_access(prospecto_id, request.user)
    if access == 'not_found':
        return JsonResponse({'ok': False, 'error': 'Prospecto no encontrado.'}, status=404)
    if access == 'no_access':
        return JsonResponse({'ok': True, 'mensajes': []})
    msgs = ProspectoAsistenteMensaje.objects.filter(prospecto=p).order_by('fecha')
    return JsonResponse({'ok': True, 'mensajes': [_msg_to_dict(m) for m in msgs]})


@login_required
@require_http_methods(['POST'])
def api_prospecto_asistente_mensaje(request, prospecto_id: int):
    """Mensaje del usuario → respuesta del AI. Maneja auto-save al
    tope de turnos."""
    p, access = _get_prospecto_with_access(prospecto_id, request.user)
    if access == 'not_found':
        return JsonResponse({'ok': False, 'error': 'Prospecto no encontrado.'}, status=404)
    if access == 'no_access':
        return JsonResponse({
            'ok': True,
            'mensaje': {
                'id': None, 'role': 'assistant',
                'contenido': _msg_no_access(p), 'fecha': None,
            },
        })
    try:
        payload = json.loads(request.body or '{}')
    except Exception:
        payload = {}
    texto = (payload.get('texto') or '').strip()
    if not texto:
        return JsonResponse({'ok': False, 'error': 'Texto vacío.'}, status=400)
    cfg = AsistenteConfig.get_singleton()
    if not cfg.activo:
        return JsonResponse({'ok': False, 'error': 'Asistente desactivado.'}, status=403)

    # Auto-save al pasar de MAX_USER_TURNS — mismo patrón que Ideas.
    auto_saved_resumen = None
    if _count_user_turns(p) >= MAX_USER_TURNS:
        msgs_existentes = list(ProspectoAsistenteMensaje.objects
                               .filter(prospecto=p).order_by('fecha'))
        resumen_auto, err_auto = _generar_resumen_llm(p, msgs_existentes, cfg)
        if err_auto:
            return JsonResponse({
                'ok': False,
                'error': (
                    'Llegamos al límite del chat pero no pude generar '
                    'el resumen automático. Intenta de nuevo o usa el '
                    f'botón "Guardar resumen" manualmente. Detalle: {err_auto}'
                ),
            }, status=502)
        auto_saved_comentario = ProspectoComentario.objects.create(
            prospecto=p, usuario=request.user, texto=resumen_auto,
        )
        ProspectoAsistenteMensaje.objects.filter(prospecto=p).delete()
        auto_saved_resumen = {
            'id': auto_saved_comentario.id,
            'texto': auto_saved_comentario.texto,
            'fecha': (auto_saved_comentario.fecha_creacion.isoformat()
                      if auto_saved_comentario.fecha_creacion else None),
        }

    # Persistir mensaje del usuario
    ProspectoAsistenteMensaje.objects.create(
        prospecto=p, role='user', contenido=texto,
    )
    turn_actual = _count_user_turns(p)
    previous_resumen = _ultimo_resumen_ai(p) if turn_actual == 1 else ''

    sys_msg = _system_prompt(
        p, cfg, request.user,
        turn_number=turn_actual,
        previous_resumen=previous_resumen,
    )
    messages = [sys_msg] + _build_context(p)
    try:
        resp = chat(
            messages=messages,
            tools=None,
            model=cfg.modelo,
            temperature=0.5,
            max_tokens=900,
        )
        final_text = (resp.get('text') or '').strip() or '(sin respuesta)'
    except AsistenteError as e:
        log.warning('Prospecto asistente error: %s', e)
        return JsonResponse({'ok': False, 'error': str(e)}, status=502)
    except Exception as e:
        log.exception('Error inesperado prospecto asistente: %s', e)
        return JsonResponse({'ok': False, 'error': f'Error inesperado: {e}'}, status=500)

    if auto_saved_resumen:
        final_text = (
            'Llegamos al tope de este chat. Guardé un resumen en la '
            'bitácora del prospecto y arranqué un chat nuevo con ese '
            'resumen como contexto. Aquí va mi respuesta:\n\n'
            + final_text
        )

    assistant_msg = ProspectoAsistenteMensaje.objects.create(
        prospecto=p, role='assistant', contenido=final_text,
    )
    payload_resp = {'ok': True, 'mensaje': _msg_to_dict(assistant_msg)}
    if auto_saved_resumen:
        payload_resp['auto_saved_resumen'] = auto_saved_resumen
    return JsonResponse(payload_resp)


@login_required
@require_http_methods(['POST'])
def api_prospecto_asistente_resumen(request, prospecto_id: int):
    """Genera resumen y lo inserta como ProspectoComentario."""
    p, access = _get_prospecto_with_access(prospecto_id, request.user)
    if access == 'not_found':
        return JsonResponse({'ok': False, 'error': 'Prospecto no encontrado.'}, status=404)
    if access == 'no_access':
        return JsonResponse({'ok': False, 'error': 'Sin permisos.'}, status=403)
    msgs = list(ProspectoAsistenteMensaje.objects.filter(prospecto=p).order_by('fecha'))
    if not msgs:
        return JsonResponse({'ok': False, 'error': 'No hay conversación que resumir todavía.'}, status=400)
    cfg = AsistenteConfig.get_singleton()
    if not cfg.activo:
        return JsonResponse({'ok': False, 'error': 'Asistente desactivado.'}, status=403)
    resumen, err = _generar_resumen_llm(p, msgs, cfg)
    if err:
        return JsonResponse({'ok': False, 'error': err}, status=502)
    com = ProspectoComentario.objects.create(
        prospecto=p, usuario=request.user, texto=resumen,
    )
    return JsonResponse({
        'ok': True,
        'comentario': {
            'id': com.id,
            'usuario_nombre': request.user.get_full_name() or request.user.username,
            'texto': com.texto,
            'fecha': com.fecha_creacion.isoformat() if com.fecha_creacion else None,
        },
    })


@login_required
@require_http_methods(['POST'])
def api_prospecto_asistente_reset(request, prospecto_id: int):
    """Borra el hilo del AI (botón Nuevo chat)."""
    p, access = _get_prospecto_with_access(prospecto_id, request.user)
    if access == 'not_found':
        return JsonResponse({'ok': False, 'error': 'Prospecto no encontrado.'}, status=404)
    if access == 'no_access':
        return JsonResponse({'ok': False, 'error': 'Sin permisos.'}, status=403)
    deleted, _ = ProspectoAsistenteMensaje.objects.filter(prospecto=p).delete()
    return JsonResponse({'ok': True, 'borrados': deleted})


@login_required
@require_http_methods(['POST'])
def api_prospecto_actividad_rapida(request, prospecto_id: int):
    """Agenda rápida disparada desde el asistente AI después de pedir
    "próximo paso". Crea una ProspectoActividad en el calendario del
    vendedor dueño del prospecto (NO del user que clickea, ya que la
    AI sugiere al equipo entero).

    Fecha: ahora + 2 días naturales. Si cae en sábado se empuja a
    lunes (+2), si cae en domingo se empuja a lunes (+1). Hora: la
    misma del momento del click.

    Body: { descripcion: str, tipo?: str }
    Default tipo: 'tarea'.
    """
    p, access = _get_prospecto_with_access(prospecto_id, request.user)
    if access == 'not_found':
        return JsonResponse({'ok': False, 'error': 'Prospecto no encontrado.'}, status=404)
    if access == 'no_access':
        return JsonResponse({'ok': False, 'error': 'Sin permisos.'}, status=403)
    try:
        payload = json.loads(request.body or '{}')
    except Exception:
        payload = {}
    descripcion = (payload.get('descripcion') or '').strip()
    if not descripcion:
        return JsonResponse({'ok': False, 'error': 'Falta descripción del próximo paso.'}, status=400)
    # Limpiamos: si viene markdown del response del AI lo aplanamos.
    import re as _re
    descripcion = _re.sub(r'\*\*', '', descripcion)
    descripcion = _re.sub(r'^#+\s*', '', descripcion, flags=_re.MULTILINE)
    descripcion = _re.sub(r'`+', '', descripcion)
    descripcion = descripcion.strip()
    # Cap a 500 chars para no llenar el campo con un essay
    if len(descripcion) > 500:
        descripcion = descripcion[:497] + '...'

    tipo = (payload.get('tipo') or 'tarea').strip().lower()
    valid_tipos = {t[0] for t in ProspectoActividad.TIPO_CHOICES}
    if tipo not in valid_tipos:
        tipo = 'tarea'

    # Calculamos la fecha: hoy + 2 días naturales, empujando fin de
    # semana al lunes siguiente.
    ahora = timezone.now()
    fecha = ahora + timedelta(days=2)
    if fecha.weekday() == 5:  # sábado
        fecha = fecha + timedelta(days=2)
    elif fecha.weekday() == 6:  # domingo
        fecha = fecha + timedelta(days=1)

    act = ProspectoActividad.objects.create(
        prospecto=p,
        usuario=p.usuario,  # cae en el calendario del vendedor dueño
        tipo=tipo,
        descripcion=descripcion,
        fecha_programada=fecha,
    )
    return JsonResponse({
        'ok': True,
        'actividad': {
            'id': act.id,
            'tipo': act.tipo,
            'tipo_display': act.get_tipo_display(),
            'descripcion': act.descripcion,
            'fecha_programada': act.fecha_programada.isoformat() if act.fecha_programada else None,
            'vendedor_id': p.usuario_id,
        },
    })
