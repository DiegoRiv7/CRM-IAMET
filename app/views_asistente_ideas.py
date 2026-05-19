# ----------------------------------------------------------------------
# views_asistente_ideas.py — Asistente AI específico para Ideas.
# ----------------------------------------------------------------------
# Hilo independiente del consultor general. Cada Idea tiene su propia
# conversación persistida en IdeaAsistenteMensaje. El asistente actúa
# como sparring de brainstorming: ayuda a aterrizar la idea, estructurarla
# y evaluarla.
#
# Endpoints:
#   GET  /app/api/ideas/<id>/asistente/mensajes/   → historial
#   POST /app/api/ideas/<id>/asistente/mensaje/    → mandar mensaje + LLM
#   POST /app/api/ideas/<id>/asistente/resumen/    → genera resumen y lo
#                                                    inserta como comentario
#   POST /app/api/ideas/<id>/asistente/reset/      → borra el hilo
# ----------------------------------------------------------------------

import json
import logging

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods

from .models import (
    AsistenteConfig, Idea, IdeaAsistenteMensaje, IdeaComentario,
)
from .asistente_provider import chat, AsistenteError

log = logging.getLogger(__name__)


# Máximo de mensajes que mandamos al LLM por turno (ventana de contexto).
# La conversación completa se persiste; solo limitamos lo que reenviamos.
MAX_HISTORY_MSGS = 20


# ─── Helpers ───────────────────────────────────────────────────────────


def _get_idea_for_user(idea_id: int, user) -> Idea | None:
    """Devuelve la idea si existe Y el user es su autor.
    En la versión actual del módulo, las ideas son privadas al autor —
    si en el futuro cambiamos a visibilidad compartida, este check se
    afloja."""
    try:
        idea = Idea.objects.select_related('cliente').get(pk=idea_id)
    except Idea.DoesNotExist:
        return None
    if idea.autor_id != user.id and not user.is_superuser:
        return None
    return idea


def _idea_context_block(idea: Idea) -> str:
    """Bloque markdown con los datos de la idea. Va dentro del system
    prompt para que el modelo sepa de qué está hablando."""
    cliente_txt = idea.cliente.nombre_empresa if idea.cliente_id else (idea.mercado_objetivo or '—')
    valor_txt = f'${idea.valor_estimado:,.0f} MXN' if idea.valor_estimado else '—'
    desc = (idea.descripcion or '').strip() or '(sin descripción)'
    insp = (idea.inspiracion or '').strip() or '—'
    etiquetas = (idea.etiquetas or '').strip() or '—'
    return (
        '\n## La idea sobre la que estamos hablando\n'
        f'- **Título:** {idea.titulo}\n'
        f'- **Tipo:** {idea.get_tipo_display()}\n'
        f'- **Potencial comercial:** {idea.get_potencial_comercial_display()}\n'
        f'- **Valor estimado:** {valor_txt}\n'
        f'- **Mercado / cliente:** {cliente_txt}\n'
        f'- **Etapa actual:** {idea.get_etapa_display()}\n'
        f'- **Etiquetas:** {etiquetas}\n'
        f'- **Inspiración:** {insp}\n'
        f'- **Descripción completa:**\n  {desc}\n'
    )


def _system_prompt(idea: Idea, config: AsistenteConfig, user) -> dict:
    """System prompt del asistente de ideas. Hereda el formateo del
    consultor (KPI cards, headings, tablas) pero el rol cambia a sparring
    de brainstorming."""
    first = (user.first_name or user.username).strip()
    nombre = config.nombre or 'el asistente'
    base = (
        f'Eres {nombre}, el asistente AI de IAMET dedicado a ayudar a '
        f'{first} a **aterrizar y ordenar ideas de negocio**. Esta '
        'conversación está atada a UNA idea específica (descrita abajo); '
        'NO eres un consultor de pipeline aquí — eres un sparring de '
        'brainstorming que ayuda al user a clarificar la idea, '
        'estructurarla, evaluarla con criterio comercial y proponer '
        'siguientes pasos concretos.\n\n'

        '## Cómo conversas\n'
        '- Conversacional, español mexicano natural, tono cercano de '
        'colega senior. Mexicanismos suaves OK ("va", "órale") con '
        'moderación.\n'
        '- Conciso por default: 3-6 líneas. Expande SOLO si el user pide '
        'profundidad o si la pregunta lo amerita.\n'
        '- Haz preguntas concretas cuando algo esté difuso (1 pregunta '
        'a la vez, no interrogatorio).\n'
        '- NO inventes datos del CRM ni del cliente. Si te falta info, '
        'dilo y pídela al user.\n'
        '- NO repitas la descripción de la idea — el user ya la '
        'escribió. Construye SOBRE ella.\n'
        '- NO uses emojis decorativos. Para énfasis usa **negritas**.\n\n'

        '## Formato visual (cuando aplique)\n'
        '- `### Título` para secciones de respuestas largas (máximo `###`, '
        'no `####`).\n'
        '- **Tablas markdown** cuando compares opciones, segmentos, '
        'competidores, etc.\n'
        '- `::: kpis :::` cuando tengas 3+ números clave (valor, plazo, '
        'ticket, # clientes potenciales). Formato: `Label | Valor | Sub`.\n'
        '- Bullets `-` para enumerar opciones, riesgos, próximos pasos.\n\n'

        '## Prompt especial: "Opinión de mi idea"\n'
        'Cuando el user pida tu opinión sobre la idea (frases como '
        '"opinión de mi idea", "qué piensas", "evalúala"), responde en '
        'una estructura corta y bien fundamentada — entre 5 y 8 líneas '
        'totales, sin headings:\n'
        '- **Premisa**: 1 línea — qué resuelve / cuál es la apuesta.\n'
        '- **A favor**: 1-2 puntos concretos basados en la descripción.\n'
        '- **Riesgos / preguntas pendientes**: 1-2 puntos accionables.\n'
        '- **Siguiente paso sugerido**: 1 línea con una acción concreta '
        '(no abstracta).\n'
        'NO inventes datos del mercado ni números si la descripción no '
        'los menciona. Si la descripción está vacía o demasiado vaga, '
        'dilo y pide los 3 puntos mínimos para evaluarla.\n\n'

        '## Cuándo sugerir secciones del CRM\n'
        'Si la idea conecta naturalmente con un módulo, menciónalo:\n'
        '- Si la idea es reactivar clientes → "Considera Marketing → '
        'Campañas para llegar a tu cartera dormida."\n'
        '- Si requiere expertise técnica → "Cursos / Certificaciones '
        'del Marketing Hub abren la conversación técnica."\n'
        '- Si la idea se materializa → "Cuando esté lista, conviértela '
        'desde el botón ‘Convertir a prospección’ aquí mismo."\n'
        'NO inventes nombres de eventos/cursos específicos.\n'
    )
    return {'role': 'system', 'content': base + _idea_context_block(idea)}


def _build_context(idea: Idea) -> list[dict]:
    """Reconstruye el historial de la conversación para mandarla al LLM."""
    msgs = list(
        IdeaAsistenteMensaje.objects
        .filter(idea=idea)
        .order_by('-fecha')[:MAX_HISTORY_MSGS]
    )
    msgs.reverse()
    return [{'role': m.role, 'content': m.contenido} for m in msgs]


def _msg_to_dict(m: IdeaAsistenteMensaje) -> dict:
    return {
        'id': m.id,
        'role': m.role,
        'contenido': m.contenido,
        'fecha': m.fecha.isoformat() if m.fecha else None,
    }


# ─── Endpoints ─────────────────────────────────────────────────────────


@login_required
@require_http_methods(['GET'])
def api_idea_asistente_mensajes(request, idea_id: int):
    """Devuelve el historial de la conversación AI de una idea."""
    idea = _get_idea_for_user(idea_id, request.user)
    if not idea:
        return JsonResponse({'ok': False, 'error': 'Idea no encontrada o sin acceso.'}, status=404)
    msgs = IdeaAsistenteMensaje.objects.filter(idea=idea).order_by('fecha')
    return JsonResponse({'ok': True, 'mensajes': [_msg_to_dict(m) for m in msgs]})


@login_required
@require_http_methods(['POST'])
def api_idea_asistente_mensaje(request, idea_id: int):
    """Recibe un mensaje del user, lo persiste, llama al LLM y devuelve
    la respuesta del asistente."""
    idea = _get_idea_for_user(idea_id, request.user)
    if not idea:
        return JsonResponse({'ok': False, 'error': 'Idea no encontrada o sin acceso.'}, status=404)
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

    # 1) Guarda el mensaje del user.
    IdeaAsistenteMensaje.objects.create(
        idea=idea, role='user', contenido=texto,
    )

    # 2) Llama al LLM con el contexto de la idea.
    sys_msg = _system_prompt(idea, cfg, request.user)
    history = _build_context(idea)
    messages = [sys_msg] + history

    try:
        resp = chat(
            messages=messages,
            tools=None,  # El asistente de ideas no usa tools — es puro chat.
            model=cfg.modelo,
            temperature=0.55,  # Más alta que el consultor: queremos creatividad.
            max_tokens=900,
        )
        final_text = (resp.get('text') or '').strip() or '(sin respuesta)'
    except AsistenteError as e:
        log.warning('Idea asistente error: %s', e)
        return JsonResponse({'ok': False, 'error': str(e)}, status=502)
    except Exception as e:
        log.exception('Error inesperado en idea asistente: %s', e)
        return JsonResponse({'ok': False, 'error': f'Error inesperado: {e}'}, status=500)

    assistant_msg = IdeaAsistenteMensaje.objects.create(
        idea=idea, role='assistant', contenido=final_text,
    )
    return JsonResponse({'ok': True, 'mensaje': _msg_to_dict(assistant_msg)})


@login_required
@require_http_methods(['POST'])
def api_idea_asistente_resumen(request, idea_id: int):
    """Genera un resumen de la conversación AI y lo guarda como
    IdeaComentario en la bitácora de la idea."""
    idea = _get_idea_for_user(idea_id, request.user)
    if not idea:
        return JsonResponse({'ok': False, 'error': 'Idea no encontrada o sin acceso.'}, status=404)

    msgs = list(IdeaAsistenteMensaje.objects.filter(idea=idea).order_by('fecha'))
    if not msgs:
        return JsonResponse({'ok': False, 'error': 'No hay conversación que resumir todavía.'}, status=400)

    cfg = AsistenteConfig.get_singleton()
    if not cfg.activo:
        return JsonResponse({'ok': False, 'error': 'Asistente desactivado.'}, status=403)

    transcript = '\n\n'.join(
        f'**{m.role.upper()}:** {m.contenido}' for m in msgs if m.contenido
    )
    sys_msg = {
        'role': 'system',
        'content': (
            'Eres un asistente que arma resúmenes de bitácora cortos y '
            'útiles. Te paso la transcripción de una conversación entre '
            'un vendedor y un AI sobre una idea de negocio. Devuelve '
            'SOLO el texto del resumen (sin meta-comentarios tipo "Aquí '
            'tienes" o "He resumido…").\n\n'
            'Formato del resumen (markdown):\n'
            '**Resumen AI** — fecha implícita (la pone el sistema).\n\n'
            '- 3 a 6 bullets con los puntos clave que se aterrizaron en '
            'la conversación: definición, segmento, valor, riesgos, '
            'siguientes pasos.\n'
            '- Si la conversación dejó **acciones concretas**, agrégalas '
            'al final como `**Próximos pasos:**` con bullets.\n'
            '- NO inventes contenido que no se discutió.\n'
            '- Máximo 12 líneas totales. Conciso, escaneable.\n'
            '- NO uses emojis.\n'
        ),
    }
    user_msg = {
        'role': 'user',
        'content': (
            f'Idea: **{idea.titulo}**\n'
            f'Tipo: {idea.get_tipo_display()} · Potencial: {idea.get_potencial_comercial_display()}\n\n'
            f'### Transcripción de la conversación\n\n{transcript}'
        ),
    }

    try:
        resp = chat(
            messages=[sys_msg, user_msg],
            tools=None,
            model=cfg.modelo,
            temperature=0.3,
            max_tokens=600,
        )
        resumen = (resp.get('text') or '').strip()
    except AsistenteError as e:
        log.warning('Idea resumen error: %s', e)
        return JsonResponse({'ok': False, 'error': str(e)}, status=502)
    except Exception as e:
        log.exception('Error inesperado en idea resumen: %s', e)
        return JsonResponse({'ok': False, 'error': f'Error inesperado: {e}'}, status=500)

    if not resumen:
        return JsonResponse({'ok': False, 'error': 'El asistente no generó resumen.'}, status=502)

    # Inserta como IdeaComentario. usuario = quien aprieta el botón.
    comentario = IdeaComentario.objects.create(
        idea=idea, usuario=request.user, texto=resumen,
    )
    return JsonResponse({
        'ok': True,
        'comentario': {
            'id': comentario.id,
            'usuario_nombre': request.user.get_full_name() or request.user.username,
            'texto': comentario.texto,
            'fecha': comentario.fecha.isoformat() if comentario.fecha else None,
        },
    })


@login_required
@require_http_methods(['POST'])
def api_idea_asistente_reset(request, idea_id: int):
    """Borra todos los mensajes de la conversación AI de una idea
    (el botón ‘Nuevo chat’ del widget)."""
    idea = _get_idea_for_user(idea_id, request.user)
    if not idea:
        return JsonResponse({'ok': False, 'error': 'Idea no encontrada o sin acceso.'}, status=404)
    deleted, _ = IdeaAsistenteMensaje.objects.filter(idea=idea).delete()
    return JsonResponse({'ok': True, 'borrados': deleted})
