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
    de brainstorming, anclado a una metodología explícita para evitar
    fantasías de "primer nivel"."""
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

        '## Contexto de la empresa (IMPORTANTE)\n'
        'IAMET es una **empresa pequeña** mexicana de tecnología, '
        'automatización industrial y sistemas de identificación. Vende '
        'B2B con un equipo reducido, marcas establecidas (Zebra, Panduit, '
        'APC, Avigilon, Genetec, Axis, etc.) y clientes industriales. '
        'NO es Apple, no es Google, no es un unicorn. Cualquier idea que '
        'evalúes debe pasar el filtro de "esto lo podemos ejecutar con '
        'el equipo, capital y red de clientes actuales en 3-6 meses". '
        'Evita propuestas grandilocuentes (focus groups masivos, '
        'campañas multinacionales, MVPs millonarios). Las recomendaciones '
        'útiles son **escrappy**: una llamada, un piloto con un cliente, '
        'una landing simple, una hipótesis testable en 1 semana.\n\n'

        '## Metodología obligatoria (Lean Startup + Customer Development)\n'
        'Cualquier evaluación que hagas sobre la idea debe pasar por '
        'estas 5 preguntas. No las recites mecánicamente — úsalas como '
        'lente para razonar. Si alguna no tiene respuesta clara en la '
        'descripción, PREGÚNTALA al user.\n\n'
        '1. **Cliente real, no abstracción.** ¿Hay UN cliente actual o '
        'concreto que pagaría por esto? "El mercado mexicano" no cuenta; '
        '"Carl Zeiss en su planta de Tijuana" sí.\n'
        '2. **Riesgo principal.** ¿Cuál es la asunción que mata la idea '
        'si resulta falsa? (Ejemplos: "asume que les importa pagar por '
        'soporte"; "asume que pueden integrar con su SCADA actual").\n'
        '3. **Validación barata, 1 semana.** ¿Qué experimento de costo '
        'casi cero puede correr ya para validar la asunción? (Llamada, '
        'demo, encuesta, cotización fake).\n'
        '4. **Encaje con IAMET.** ¿Conecta con las marcas, expertise o '
        'clientes que ya tenemos? Si requiere capabilities nuevas, '
        '¿cuánto cuesta entrar?\n'
        '5. **ICE implícito** (no muestres puntajes a menos que el user '
        'lo pida): mentalmente evalúa Impacto, Confianza, Esfuerzo del '
        '1 al 5. Si Confianza ≤ 2 o Esfuerzo ≥ 4 → la idea necesita '
        'aterrizarse más antes de moverla.\n\n'

        '## Cómo conversas\n'
        '- Conversacional, español mexicano natural, tono cercano de '
        'colega senior. Mexicanismos suaves OK ("va", "órale") con '
        'moderación.\n'
        '- Conciso por default: 3-6 líneas. Expande SOLO si el user pide '
        'profundidad o si la pregunta lo amerita.\n'
        '- **Termina casi todas tus respuestas con UNA pregunta clave** '
        'que ayude al user a aterrizar el siguiente punto difuso. Una '
        'pregunta por turno, no interrogatorio.\n'
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
        '"opinión de mi idea", "qué piensas", "evalúala"), responde con '
        'esta estructura corta (8-12 líneas TOTALES, sin headings):\n\n'
        '   **Premisa.** 1 línea: qué resuelve y a quién — usando lo que '
        'ya está en el contexto.\n'
        '   **Lo que asumo (basado en lo que escribiste).** 1-3 bullets '
        'con tus interpretaciones explícitas de las 3 preguntas críticas: '
        'qué problema resuelve, quién es el cliente, cómo se cobraría. '
        'Marca cada asunción claramente — "Asumo que…" — para que el '
        'user pueda corregir si te equivocas.\n'
        '   **A favor.** 1-2 bullets concretos derivados del contexto '
        '(título, tipo, mercado, etiquetas, etc.).\n'
        '   **Riesgos / asunciones a validar.** 1-2 bullets, refiriendo '
        'al **riesgo principal** del framework.\n'
        '   **Cosas por hacer (siguientes pasos).** 2-3 bullets con '
        'acciones escrappy concretas (llamada a X, piloto con Y, '
        'verificar Z). NO recomiendes "hacer estudio de mercado" sin '
        'antes haber hablado con UN cliente.\n'
        '   **Una pregunta para ti.** UNA sola pregunta — la más '
        'crítica que falte resolver. No interrogues con 3 preguntas; '
        'ya hiciste el trabajo de hipótesis arriba.\n\n'
        'Reglas duras para la opinión:\n'
        '- **NUNCA bloquees con "necesito más contexto"** si hay '
        'CUALQUIER información en el bloque de la idea (título, tipo, '
        'potencial, valor, mercado, cliente, etiquetas, inspiración o '
        'descripción). Tu trabajo es opinar con lo que hay, marcando '
        'asunciones donde te falte data.\n'
        '- **Trabaja con TODOS los campos del contexto**, no solo la '
        'descripción. Si la descripción dice "prueba" pero el título es '
        '"app móvil", tipo "Tecnología" y valor estimado $150, deduce '
        'razonablemente: cliente concreto puede ser la base actual de '
        'IAMET (industriales), modelo de cobro puede ser '
        'licencia/suscripción dado el valor bajo, etc. Marca cada '
        'inferencia como "Asumo…".\n'
        '- SOLO si REALMENTE no hay nada (todos los campos vacíos o '
        'genéricos al extremo), entonces sí pide los 3 puntos mínimos '
        '— pero ese caso es raro porque el formulario obliga al menos '
        'un título.\n'
        '- NO digas frases tipo "la idea tiene gran potencial en el '
        'mercado mexicano" sin un dato que lo respalde.\n'
        '- NO inventes tamaños de mercado, competidores específicos, '
        'porcentajes ni cifras económicas.\n'
        '- Si la idea es similar a algo que ya existe en grande (Uber, '
        'Rappi, Salesforce), señálalo con cortesía y propón el ángulo '
        'diferenciador que IAMET podría tomar realísticamente.\n\n'

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
        f'[{m.role.upper()}] {m.contenido}' for m in msgs if m.contenido
    )
    sys_msg = {
        'role': 'system',
        'content': (
            'Eres un asistente que arma resúmenes de bitácora cortos y '
            'útiles. Te paso la transcripción de una conversación entre '
            'un vendedor y un AI sobre una idea de negocio. Devuelve '
            'SOLO el texto del resumen (sin meta-comentarios tipo "Aquí '
            'tienes" o "He resumido…").\n\n'
            'Formato OBLIGATORIO — PLAIN TEXT, sin markdown:\n'
            '- NO uses asteriscos (**), guion bajo, backticks, hashtags '
            '  ni ningún símbolo de markdown. El comentario se renderea '
            '  en texto plano y los símbolos se verían literales.\n'
            '- Estructura exacta:\n\n'
            '  Resumen de IAMET AI\n'
            '\n'
            '  Puntos clave:\n'
            '  · 3 a 6 bullets con los puntos que se aterrizaron en la '
            '    conversación (definición, segmento, valor, riesgos).\n'
            '\n'
            '  Próximos pasos:\n'
            '  · 1 a 3 bullets con acciones concretas escrappy.\n'
            '\n'
            '  Preguntas abiertas:\n'
            '  · 1 a 2 preguntas que el user todavía no resolvió '
            '    (solo si las hay; si no existen, omite esta sección).\n\n'
            'Reglas:\n'
            '- Usa el carácter · (middot) para bullets, no - ni *.\n'
            '- Máximo 14 líneas totales. Conciso, escaneable.\n'
            '- NO inventes contenido que no se discutió.\n'
            '- NO uses emojis.\n'
        ),
    }
    user_msg = {
        'role': 'user',
        'content': (
            f'Idea: {idea.titulo}\n'
            f'Tipo: {idea.get_tipo_display()} · Potencial: {idea.get_potencial_comercial_display()}\n\n'
            f'Transcripción de la conversación:\n\n{transcript}'
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

    # Defensa extra: si el modelo se rebeló y metió ** o ##, los limpiamos
    # para garantizar plain text en la bitácora.
    import re as _re
    resumen = _re.sub(r'\*\*', '', resumen)
    resumen = _re.sub(r'^#+\s*', '', resumen, flags=_re.MULTILINE)
    resumen = _re.sub(r'^[-*]\s+', '· ', resumen, flags=_re.MULTILINE)

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
