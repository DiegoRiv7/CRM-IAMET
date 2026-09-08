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

from .empresa import modulo_activo
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
# Máximo de mensajes en la ventana de contexto que mandamos al LLM.
MAX_HISTORY_MSGS = 20

# Cuántos turnos del USUARIO permitimos antes de forzar auto-save (estilo
# Claude: cuando llega al tope, guardamos resumen, vaciamos el hilo, y
# la siguiente respuesta arranca con el resumen previo inyectado como
# contexto). Mantiene el costo en tokens acotado y obliga al user a
# avanzar en lugar de chatear infinito.
MAX_USER_TURNS = 8

# Prefijo que usamos para reconocer un IdeaComentario como "resumen
# generado por el AI" (vs. un comentario manual del user). Se usa para
# inyectar el último resumen como contexto en hilos nuevos.
RESUMEN_AI_PREFIX = 'Resumen de IAMET AI'


# ─── Helpers ───────────────────────────────────────────────────────────


def _count_user_turns(idea: Idea) -> int:
    """Cuenta cuántos mensajes role=user hay en la conversación actual."""
    return IdeaAsistenteMensaje.objects.filter(idea=idea, role='user').count()


def _ultimo_resumen_ai(idea: Idea) -> str:
    """Devuelve el texto del último IdeaComentario que parezca un resumen
    generado por el AI (empieza con el prefijo conocido), o '' si no hay."""
    c = (IdeaComentario.objects
         .filter(idea=idea, texto__startswith=RESUMEN_AI_PREFIX)
         .order_by('-fecha')
         .first())
    return c.texto if c else ''


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


def _get_idea_with_access(idea_id: int, user):
    """Como _get_idea_for_user pero distingue entre 'no existe' y
    'existe pero no eres el autor'. Devuelve (idea, access) donde
    access es:
      - 'not_found': la idea no existe.
      - 'not_owner': existe pero el user no es su autor (y no es admin).
      - 'ok': existe y el user puede usar el AI sobre ella.
    Usado por los endpoints del asistente para devolver un mensaje
    amigable en lugar de 404 cuando un user visita la idea de otro.
    """
    try:
        idea = Idea.objects.select_related('cliente').get(pk=idea_id)
    except Idea.DoesNotExist:
        return (None, 'not_found')
    if idea.autor_id != user.id and not user.is_superuser:
        return (idea, 'not_owner')
    return (idea, 'ok')


def _msg_not_owner(idea: Idea) -> str:
    """Mensaje amigable que el AI 'manda' cuando un user que no es el
    autor intenta usarlo. Se entrega como respuesta normal del bot, no
    como error, así no rompe la UX del chat."""
    autor = idea.autor.first_name or idea.autor.username if idea.autor_id else 'su autor'
    return (
        f'Esta idea es de **{autor}**, así que no puedo darte mi '
        f'opinión aquí — solo le contesto al autor de la idea. '
        f'Si quieres que la AI evalúe una idea tuya, captúrala desde '
        f'el kanban de Ideas y ahí sí podemos aterrizarla juntos.'
    )


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


def _closure_guidance(turn_number: int) -> str:
    """Guía dinámica al AI para que vaya cerrando la conversación antes
    de tocar el límite duro (MAX_USER_TURNS). Evita que se enganche en
    un loop de preguntas y al user le den ganas de seguir indefinidamente.
    `turn_number` es el número del turno del user que estamos por
    procesar (1 = primer mensaje del user en este hilo)."""
    if turn_number <= 2:
        return (
            'ETAPA TEMPRANA del chat. Puedes hacer 1 pregunta clave al '
            'final si genuinamente la necesitas para aterrizar la idea.'
        )
    if turn_number <= 4:
        return (
            'ETAPA INTERMEDIA. Ya tienes contexto suficiente — reduce '
            'preguntas. Si vas a hacer una, asegúrate que sea la ÚNICA '
            'clave para avanzar; de otro modo termina con una propuesta '
            'concreta en lugar de pregunta.'
        )
    if turn_number <= 6:
        return (
            'ETAPA DE CIERRE. NO termines con pregunta nueva. Resume el '
            'avance en 2-3 líneas y propone explícitamente: "Con esto '
            'creo que tenemos un primer aterrizaje claro. Te recomiendo '
            'darle a Guardar resumen para tenerlo en la bitácora y '
            'continuar otro día con lo que decidas explorar." Solo '
            'hazle al user UNA pregunta si pidió expresamente otro '
            f'tema. Estás en el turno {turn_number} de {MAX_USER_TURNS}.'
        )
    return (
        'ÚLTIMOS TURNOS DISPONIBLES. NO hagas preguntas. Tu respuesta '
        'debe ser un wrap-up: 2-3 líneas con lo aterrizado + UN '
        'próximo paso concreto. Termina con: "Ya cubrimos lo '
        'principal — guarda el resumen para empezar otro chat con '
        f'lo aterrizado." Estás en el turno {turn_number} de '
        f'{MAX_USER_TURNS} (próximo turno se auto-guardará el resumen).'
    )


def _system_prompt(idea: Idea, config: AsistenteConfig, user,
                   turn_number: int = 1, previous_resumen: str = '') -> dict:
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

        '## Matriz de prudencia (lo PRIMERO que evalúas)\n'
        'Antes de redactar cualquier opinión, evalúa MENTALMENTE estos '
        'tres ejes. El veredicto que pongas en la respuesta depende de '
        'cómo cae la idea aquí:\n\n'
        '**1. Conteo de red flags.** Cuenta cuántas señales de riesgo '
        'concretas detectas en la idea. Ejemplos de red flag:\n'
        '- Cliente real ausente o vago ("el mercado mexicano").\n'
        '- Modelo de cobro poco claro o demasiado bajo para sostener '
        'el esfuerzo.\n'
        '- Requiere capabilities que IAMET no tiene (desarrollo nuevo, '
        'integración con sistemas ajenos, soporte 24/7, etc).\n'
        '- Compite contra algo grande sin un ángulo diferenciador '
        'claro.\n'
        '- Asume comportamiento del cliente sin evidencia (que sí '
        'va a pagar, sí va a adoptar, sí lo necesita).\n'
        '- Plazo o esfuerzo > 6 meses con incertidumbre alta.\n'
        '- Inversión inicial significativa antes de validar.\n'
        '- Riesgo legal / regulatorio.\n\n'
        '**2. Magnitud del red flag (uno poderoso ≠ tres menores).** '
        'Un red flag es "poderoso" si por sí solo puede hundir la '
        'idea: por ejemplo, cliente totalmente inexistente, '
        'inversión enorme sin validación, dependencia de algo que no '
        'controlamos, problema legal claro.\n\n'
        '**3. Nivel de riesgo de la DECISIÓN que el user quiere '
        'tomar.** Marca la decisión como ALTO RIESGO si involucra:\n'
        '- Invertir capital significativo (compra de equipo grande, '
        'desarrollo costoso, contratación masiva).\n'
        '- Despedir, recortar o reestructurar personal.\n'
        '- Cambiar de modelo de negocio / línea de producto core.\n'
        '- Asumir deuda o compromisos largos.\n'
        '- Cualquier decisión irreversible o difícil de revertir.\n\n'
        'Si la decisión es de **bajo riesgo** (un piloto, una llamada, '
        'una demo, una landing, una conversación con un cliente, '
        'agregar un servicio menor), entonces sí puedes opinar.\n\n'

        '## Veredicto según la matriz\n'
        'Tu primera línea de la opinión SIEMPRE refleja esta matriz, '
        'usando uno de estos cuatro veredictos textuales (escógelo, no '
        'inventes otro):\n\n'
        '**A) Si la DECISIÓN es de alto riesgo (sin importar las red '
        'flags):** primera línea = "Esta decisión es muy delicada para '
        'que la tome solo basándose en una conversación conmigo. '
        'Analízala con tu equipo en persona antes de avanzar." NO digas '
        'si estás de acuerdo ni en desacuerdo. Sí puedes listar los '
        '**puntos a debatir con el equipo** en lugar de "Cosas por '
        'hacer" — ayuda a estructurar la junta, no a decidir por '
        'ellos.\n\n'
        '**B) Si hay 3+ red flags O 1 red flag poderoso (y la decisión '
        'NO es de alto riesgo):** primera línea = "Hoy no la '
        'recomendaría avanzar tal cual está." Continúa con los '
        '**Riesgos que la frenan** ANTES que cualquier otra cosa. No '
        'suavices ni metas "pero tiene potencial" gratis — solo '
        'menciona potencial si HAY algo real que lo respalde, después '
        'de los riesgos.\n\n'
        '**C) Si hay 1-2 red flags menores y la decisión es de bajo '
        'riesgo:** primera línea = "Vale la pena explorarla, con '
        'estas condiciones." Continúa con el porqué (real, basado en '
        'el contexto) y las condiciones.\n\n'
        '**D) Si no detectas red flags significativos y la decisión es '
        'de bajo riesgo:** primera línea = "Tiene fundamento. Aquí '
        'cómo aterrizarla." Continúa con la opinión normal.\n\n'
        'NUNCA empieces con "excelente idea", "gran propuesta", '
        '"interesante propuesta", "me parece muy buena", "felicidades". '
        'Tu trabajo es ser un sparring honesto, no un coach motivacional. '
        'NUNCA des por validada una asunción que el user dio sin '
        'evidencia — siempre marca que es asunción.\n\n'

        '## Prompt especial: "Opinión de mi idea"\n'
        'Cuando el user pida tu opinión sobre la idea (frases como '
        '"opinión de mi idea", "qué piensas", "evalúala"), aplica la '
        'matriz de arriba PRIMERO y luego responde con esta estructura '
        '(8-12 líneas TOTALES, sin headings):\n\n'
        '   **Veredicto.** 1 línea con uno de los 4 textos A/B/C/D de '
        'arriba — exactamente como están escritos.\n'
        '   **Premisa.** 1 línea: qué resuelve y a quién — usando lo que '
        'ya está en el contexto.\n'
        '   **Lo que asumo (basado en lo que escribiste).** 1-3 bullets '
        'con tus interpretaciones explícitas de las 3 preguntas críticas: '
        'qué problema resuelve, quién es el cliente, cómo se cobraría. '
        'Marca cada asunción claramente — "Asumo que…" — para que el '
        'user pueda corregir si te equivocas.\n'
        '   **Riesgos / red flags.** 1-3 bullets con los riesgos '
        'concretos detectados. SI estás en el caso B (no recomendado), '
        'esta sección va ANTES de "A favor" y es más detallada.\n'
        '   **A favor.** Solo si hay algo real que respalde — 1-2 '
        'bullets concretos derivados del contexto. SI estás en el caso '
        'B y no encuentras nada sólido, omite esta sección en lugar '
        'de rellenar.\n'
        '   **Cosas por hacer (o Puntos para debatir con el equipo en '
        'caso A).** 2-3 bullets con acciones escrappy concretas (llamada '
        'a X, piloto con Y, verificar Z). En caso A, son temas para la '
        'junta, no acciones que el user pueda tomar solo.\n'
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
    # Bloque dinámico de cierre (depende del turno) — empuja al AI a no
    # quedarse haciendo preguntas para siempre.
    closure_block = (
        '\n\n## Etapa de cierre (turno actual)\n'
        + _closure_guidance(turn_number) + '\n'
    )
    # Si hubo un auto-save previo, inyectamos el resumen guardado para
    # que el AI tenga continuidad sin tener que ver toda la transcripción
    # original.
    resumen_block = ''
    if previous_resumen:
        resumen_block = (
            '\n\n## Resumen de la conversación anterior (continuidad)\n'
            'Anteriormente conversaste con el user sobre esta misma '
            'idea. Cuando se llenó el chat, guardaste este resumen en '
            'la bitácora. Úsalo como base — NO le hagas al user las '
            'mismas preguntas que ya respondió arriba:\n\n'
            + previous_resumen.strip() + '\n'
        )
    return {
        'role': 'system',
        'content': base + _idea_context_block(idea) + resumen_block + closure_block,
    }


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


@modulo_activo('ideas')
@login_required
@require_http_methods(['GET'])
def api_idea_asistente_mensajes(request, idea_id: int):
    """Devuelve el historial de la conversación AI de una idea.
    Si el user no es el autor, devolvemos historial vacío (sin error)
    para que el modal abra y el primer mensaje que mande dispare el
    aviso amigable de "no puedo opinar sobre la idea de otro"."""
    idea_obj, access = _get_idea_with_access(idea_id, request.user)
    if access == 'not_found':
        return JsonResponse({'ok': False, 'error': 'Idea no encontrada.'}, status=404)
    if access == 'not_owner':
        return JsonResponse({'ok': True, 'mensajes': []})
    msgs = IdeaAsistenteMensaje.objects.filter(idea=idea_obj).order_by('fecha')
    return JsonResponse({'ok': True, 'mensajes': [_msg_to_dict(m) for m in msgs]})


@modulo_activo('ideas')
@login_required
@require_http_methods(['POST'])
def api_idea_asistente_mensaje(request, idea_id: int):
    """Recibe un mensaje del user, lo persiste, llama al LLM y devuelve
    la respuesta del asistente."""
    idea_obj, access = _get_idea_with_access(idea_id, request.user)
    if access == 'not_found':
        return JsonResponse({'ok': False, 'error': 'Idea no encontrada.'}, status=404)
    if access == 'not_owner':
        # Mensaje amigable del bot — no es un error técnico.
        return JsonResponse({
            'ok': True,
            'mensaje': {
                'id': None,
                'role': 'assistant',
                'contenido': _msg_not_owner(idea_obj),
                'fecha': None,
            },
        })
    idea = idea_obj
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

    # Auto-save: si el user ya gastó MAX_USER_TURNS turnos, antes de
    # procesar el mensaje nuevo generamos resumen, lo guardamos en
    # bitácora, vaciamos el hilo, y continuamos en un chat fresco que
    # tiene el resumen previo inyectado como contexto. Esto mantiene el
    # uso de tokens acotado y simula el "manejo automático" de Claude.
    auto_saved_resumen = None
    turnos_previos = _count_user_turns(idea)
    if turnos_previos >= MAX_USER_TURNS:
        msgs_existentes = list(IdeaAsistenteMensaje.objects.filter(idea=idea).order_by('fecha'))
        resumen_auto, err_auto = _generar_resumen_llm(idea, msgs_existentes, cfg)
        if err_auto:
            # Si el resumen falla, NO borramos los mensajes — devolvemos
            # error para que el user reintente o llame a Guardar resumen
            # manualmente. Mejor avisar que perder el hilo.
            return JsonResponse({
                'ok': False,
                'error': (
                    'Llegamos al límite del chat pero no pude generar '
                    'el resumen automático. Intenta de nuevo o usa el '
                    'botón "Guardar resumen" manualmente. '
                    f'Detalle: {err_auto}'
                ),
            }, status=502)
        # Guardamos el resumen en bitácora.
        auto_saved_comentario = IdeaComentario.objects.create(
            idea=idea, usuario=request.user, texto=resumen_auto,
        )
        # Borramos los mensajes del hilo para que el siguiente turno
        # arranque fresco (el resumen vive en bitácora y se inyecta como
        # contexto via _ultimo_resumen_ai).
        IdeaAsistenteMensaje.objects.filter(idea=idea).delete()
        auto_saved_resumen = {
            'id': auto_saved_comentario.id,
            'texto': auto_saved_comentario.texto,
            'fecha': auto_saved_comentario.fecha.isoformat() if auto_saved_comentario.fecha else None,
        }

    # 1) Guarda el mensaje del user (después del posible auto-save).
    IdeaAsistenteMensaje.objects.create(
        idea=idea, role='user', contenido=texto,
    )

    # Turno actual = mensajes de user incluyendo este nuevo.
    turn_actual = _count_user_turns(idea)
    previous_resumen = _ultimo_resumen_ai(idea) if (turn_actual == 1) else ''

    # 2) Llama al LLM con el contexto de la idea + guidance dinámico.
    sys_msg = _system_prompt(
        idea, cfg, request.user,
        turn_number=turn_actual,
        previous_resumen=previous_resumen,
    )
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

    # Si fue auto-save, prepend al final_text una nota explícita al user
    # para que sepa que su conversación se reinició con resumen guardado.
    if auto_saved_resumen:
        final_text = (
            'Llegamos al tope de este chat. Guardé un resumen en la '
            'bitácora de la idea y arranqué un chat nuevo con ese '
            'resumen como contexto — así seguimos sin perder lo '
            'aterrizado. Aquí va mi respuesta a tu pregunta:\n\n'
            + final_text
        )

    assistant_msg = IdeaAsistenteMensaje.objects.create(
        idea=idea, role='assistant', contenido=final_text,
    )
    payload = {'ok': True, 'mensaje': _msg_to_dict(assistant_msg)}
    if auto_saved_resumen:
        payload['auto_saved_resumen'] = auto_saved_resumen
    return JsonResponse(payload)


def _generar_resumen_llm(idea: Idea, msgs, cfg: AsistenteConfig) -> tuple[str, str]:
    """Llama al LLM con la transcripción de `msgs` y devuelve
    (resumen_texto, error_msg). Si error_msg != '' significa que algo
    falló y resumen_texto debe ignorarse.

    Factorizado del endpoint público para poder llamarlo también desde
    el auto-save cuando el chat llega al límite de turnos.
    """
    if not msgs:
        return ('', 'No hay conversación que resumir todavía.')
    transcript = '\n\n'.join(
        f'[{m.role.upper()}] {m.contenido}' for m in msgs if m.contenido
    )
    sys_msg = {
        'role': 'system',
        'content': (
            'Eres un asistente que SINTETIZA conversaciones — no las '
            'copia. Te paso la transcripción de un chat entre un '
            'vendedor y un AI sobre una idea de negocio. Tu trabajo es '
            'devolver un resumen MUY corto que cualquiera pueda leer '
            'en 20 segundos: qué es la idea ahora (después de la '
            'conversación) y qué sigue. NADA más.\n\n'

            'Reglas duras:\n'
            '- **NO copies frases textuales del chat.** Re-escribe en '
            'tus propias palabras de forma compacta.\n'
            '- **NO transcribas el ida-y-vuelta** ("el user preguntó X, '
            'la AI respondió Y"). Solo extrae conclusiones.\n'
            '- **NO incluyas tu opinión del AI** ni preguntas abiertas '
            '— el resumen es lo que quedó CLARO, no lo que falta.\n'
            '- Tono ejecutivo: una persona externa debe entender la '
            'idea solo leyendo el resumen, sin haber visto el chat.\n\n'

            'Formato OBLIGATORIO — PLAIN TEXT, sin markdown (nada de '
            '**, ##, backticks, ni guiones bajos — el comentario se '
            'renderea literal):\n\n'
            '  Resumen de IAMET AI\n'
            '\n'
            '  Idea:\n'
            '  · 1 a 3 bullets describiendo QUÉ es la idea ahora, a '
            'quién va dirigida y cómo se monetiza (con lo que se '
            'aclaró en el chat). Re-escrito, no copiado.\n'
            '\n'
            '  Próximos pasos:\n'
            '  · 1 a 3 bullets con acciones concretas a ejecutar '
            '(la AI las arma según lo discutido).\n\n'

            'Reglas de formato:\n'
            '- Usa · (middot) para bullets, no - ni *.\n'
            '- Máximo 8 líneas totales (sin contar encabezados y '
            'líneas en blanco).\n'
            '- NO inventes contenido que no se discutió.\n'
            '- NO uses emojis.\n'
            '- Si la conversación fue muy corta o sin contenido útil, '
            'devuelve un resumen mínimo con lo poco que haya y un '
            'solo próximo paso obvio.\n'
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
        return ('', str(e))
    except Exception as e:
        log.exception('Error inesperado en idea resumen: %s', e)
        return ('', f'Error inesperado: {e}')

    if not resumen:
        return ('', 'El asistente no generó resumen.')

    # Defensa extra: si el modelo se rebeló y metió ** o ##, los limpiamos
    # para garantizar plain text en la bitácora.
    import re as _re
    resumen = _re.sub(r'\*\*', '', resumen)
    resumen = _re.sub(r'^#+\s*', '', resumen, flags=_re.MULTILINE)
    resumen = _re.sub(r'^[-*]\s+', '· ', resumen, flags=_re.MULTILINE)
    return (resumen, '')


@modulo_activo('ideas')
@login_required
@require_http_methods(['POST'])
def api_idea_asistente_resumen(request, idea_id: int):
    """Genera un resumen de la conversación AI y lo guarda como
    IdeaComentario en la bitácora de la idea."""
    idea, access = _get_idea_with_access(idea_id, request.user)
    if access == 'not_found':
        return JsonResponse({'ok': False, 'error': 'Idea no encontrada.'}, status=404)
    if access == 'not_owner':
        return JsonResponse({
            'ok': False,
            'error': 'Solo el autor de la idea puede guardar resúmenes del AI.',
        }, status=403)

    msgs = list(IdeaAsistenteMensaje.objects.filter(idea=idea).order_by('fecha'))
    if not msgs:
        return JsonResponse({'ok': False, 'error': 'No hay conversación que resumir todavía.'}, status=400)

    cfg = AsistenteConfig.get_singleton()
    if not cfg.activo:
        return JsonResponse({'ok': False, 'error': 'Asistente desactivado.'}, status=403)

    resumen, err = _generar_resumen_llm(idea, msgs, cfg)
    if err:
        return JsonResponse({'ok': False, 'error': err}, status=502)

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


@modulo_activo('ideas')
@login_required
@require_http_methods(['POST'])
def api_idea_asistente_reset(request, idea_id: int):
    """Borra todos los mensajes de la conversación AI de una idea
    (el botón ‘Nuevo chat’ del widget)."""
    idea, access = _get_idea_with_access(idea_id, request.user)
    if access == 'not_found':
        return JsonResponse({'ok': False, 'error': 'Idea no encontrada.'}, status=404)
    if access == 'not_owner':
        return JsonResponse({
            'ok': False,
            'error': 'Solo el autor de la idea puede resetear el chat.',
        }, status=403)
    deleted, _ = IdeaAsistenteMensaje.objects.filter(idea=idea).delete()
    return JsonResponse({'ok': True, 'borrados': deleted})
