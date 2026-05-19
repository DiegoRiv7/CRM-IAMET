# ----------------------------------------------------------------------
# views_asistente.py — endpoints del asistente AI.
# ----------------------------------------------------------------------
# Flujo principal (POST /api/asistente/mensaje/):
#   1. Recibimos mensaje del user. Lo guardamos en BD.
#   2. Construimos contexto: últimos N mensajes (cap configurable).
#   3. Llamamos al LLM con tools disponibles.
#   4. Si pide tool_use → ejecutamos tool (con permisos del user),
#      guardamos resultado en BD, volvemos al paso 3 (loop hasta tope).
#   5. Cuando el modelo responde texto final, lo guardamos y devolvemos.
#
# Persistencia: TODOS los mensajes se guardan en BD. El contexto enviado
# al LLM se limita a `AsistenteConfig.contexto_max_mensajes` (default 20).
# ----------------------------------------------------------------------

import json
import logging
from typing import Any

from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .models import (
    AsistenteConfig, ConversacionAsistente, MensajeAsistente,
)
from .asistente_provider import chat, AsistenteError
from .asistente_tools import execute_tool, tools_for_user

log = logging.getLogger(__name__)

# Tope de iteraciones tool-use → respuesta. Evita loops infinitos.
MAX_TOOL_ITERATIONS = 6


def _get_or_create_conv(user):
    conv, _ = ConversacionAsistente.objects.get_or_create(usuario=user)
    return conv


def _msg_to_dict(m: MensajeAsistente) -> dict:
    """Convierte un MensajeAsistente a formato OpenAI-compatible para mandar al LLM."""
    if m.role == 'tool':
        return {
            'role': 'tool',
            'tool_call_id': m.tool_call_id,
            'content': m.contenido or '',
        }
    if m.role == 'assistant' and m.tool_name:
        # Llamada a tool del assistant. Reconstruir el tool_calls array.
        return {
            'role': 'assistant',
            'content': m.contenido or None,
            'tool_calls': [{
                'id': m.tool_call_id,
                'type': 'function',
                'function': {
                    'name': m.tool_name,
                    'arguments': m.tool_args_json or '{}',
                },
            }],
        }
    return {'role': m.role, 'content': m.contenido or ''}


def _build_context(conv: ConversacionAsistente, config: AsistenteConfig) -> list[dict]:
    """Toma los últimos N mensajes y los formatea para el LLM."""
    n = config.contexto_max_mensajes or 20
    qs = conv.mensajes.order_by('-fecha')[:n]
    # Revertir para orden cronológico
    msgs = list(reversed(list(qs)))
    return [_msg_to_dict(m) for m in msgs]


def _user_context_block(user) -> str:
    """Datos relevantes del user que el asistente DEBE saber de entrada.
    No son secretos — son cosas que mejoran las respuestas y dan personalidad
    (saludar por nombre, conocer rol, saber su carga actual).
    """
    from .models import TodoItem, UserProfile
    from django.utils import timezone

    full = user.get_full_name() or user.username
    first = (user.first_name or user.username).strip()
    last = (user.last_name or '').strip()
    # Rol
    rol_display = 'vendedor'
    try:
        prof = UserProfile.objects.filter(user=user).first()
        if prof and prof.rol:
            rol_display = prof.get_rol_display() if hasattr(prof, 'get_rol_display') else str(prof.rol)
    except Exception:
        pass
    # Oportunidades activas del user
    try:
        opp_activas = TodoItem.objects.filter(usuario=user).exclude(
            Q(etapa_completa__icontains='perdido') |
            Q(etapa_completa__icontains='cancelad')
        ).count()
    except Exception:
        opp_activas = '?'
    # Fecha actual
    now = timezone.now()
    meses_es = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
    fecha_str = f'{meses_es[now.month]} {now.year}'

    return (
        f'\n\n## Contexto del usuario actual\n'
        f'- Nombre: **{full}** (puedes llamarle "{first}" en conversación informal)\n'
        f'- Usuario en el sistema: @{user.username}\n'
        f'- Rol: {rol_display}\n'
        f'- Oportunidades activas a su nombre: {opp_activas}\n'
        f'- Fecha de hoy: {fecha_str}\n'
    )


def _system_prompt(user, config: AsistenteConfig) -> dict:
    """System prompt — personalidad + reglas + contexto del user."""
    custom = (config.system_prompt or '').strip()
    if custom:
        # Si el admin definió un prompt custom, lo respetamos pero le agregamos
        # el contexto del user al final.
        return {'role': 'system', 'content': custom + _user_context_block(user)}

    base = (
        f'Eres {config.nombre}, asistente AI del CRM de IAMET — una empresa '
        'mexicana de soluciones de tecnología, automatización industrial y '
        'sistemas de identificación. Hablas español mexicano natural, con '
        'tono cercano y profesional. Tienes humor sutil, agudo — eres como '
        'un colega vendedor experimentado que ya lleva años en la calle, '
        'no payaso ni acartonado. Eres conciso por default; expandes solo '
        'cuando el dato lo amerita.\n\n'

        '## Reglas duras\n'
        '1. **NUNCA inventes datos.** Si necesitas información del CRM, USA '
        'las herramientas disponibles. Si una tool devuelve lista vacía o '
        'error, dilo claro sin disfrazar.\n'
        '2. **No expongas IDs internos** (como #12345) salvo que el usuario '
        'los pida explícitamente.\n'
        '3. **Formatea montos** con $ y separadores de miles (ej. $1,250,000 MXN).\n'
        '4. **Bullets cuando hay listas.** Texto corrido para respuestas de '
        '1-2 oraciones.\n'
        '5. **No te disculpes en exceso** ("disculpa que…", "lamento que…"). '
        'Si te equivocas, corrige y sigue.\n'
        '6. **No abuses de "ofertas" innecesarias.** Si te saludan con un '
        '"hola", responde casual y breve, no le sueltes al user un menú de '
        'todo lo que puedes hacer.\n\n'

        '## Personalidad\n'
        '- Saluda por nombre cuando es apropiado (en el primer mensaje del '
        'día o de la sesión).\n'
        '- Puedes usar mexicanismos suaves ("órale", "va", "andamos", '
        '"a darle"). Sin exagerar.\n'
        '- Cuando los números son buenos, celebra brevemente ("¡buen mes!"). '
        'Cuando son malos, sé empático antes de soltar la cifra ("este mes '
        'fue retador…").\n'
        '- Si el user te tira una broma o algo casual, responde con humor '
        'sutil. No te quedes rígido.\n'
        '- Si el user pregunta algo fuera del CRM (clima, deporte, vida), '
        'aclaras que tu fuerte son los datos del CRM, pero puedes responder '
        'brevemente sin dramatizar.\n'
    )
    return {'role': 'system', 'content': base + _user_context_block(user)}


# ─── Endpoints ────────────────────────────────────────────────────────


@login_required
@require_http_methods(['GET'])
def api_asistente_config(request):
    """Devuelve la config visible (nombre + logo) para que el frontend la pinte."""
    cfg = AsistenteConfig.get_singleton()
    logo_url = cfg.logo.url if cfg.logo else ''
    return JsonResponse({
        'ok': True,
        'nombre': cfg.nombre,
        'logo_url': logo_url,
        'activo': cfg.activo,
    })


@login_required
@require_http_methods(['GET'])
def api_asistente_conversacion(request):
    """Devuelve el historial COMPLETO de la conversación del user (para mostrar en UI)."""
    conv = _get_or_create_conv(request.user)
    # Filtramos: solo mostramos al user los mensajes user + assistant final.
    # Los tool/assistant-con-tool-call quedan ocultos (son ruido para el user).
    msgs = []
    for m in conv.mensajes.all():
        if m.role == 'user':
            msgs.append({
                'id': m.id,
                'role': 'user',
                'contenido': m.contenido,
                'fecha': m.fecha.isoformat(),
            })
        elif m.role == 'assistant' and not m.tool_name and m.contenido:
            msgs.append({
                'id': m.id,
                'role': 'assistant',
                'contenido': m.contenido,
                'fecha': m.fecha.isoformat(),
            })
    return JsonResponse({'ok': True, 'mensajes': msgs})


@login_required
@require_http_methods(['DELETE'])
def api_asistente_conversacion_eliminar(request):
    """Limpia el historial completo del user. Empieza la conversación de cero."""
    conv = _get_or_create_conv(request.user)
    conv.mensajes.all().delete()
    return JsonResponse({'ok': True})


@login_required
@require_http_methods(['POST'])
def api_asistente_mensaje(request):
    """Recibe mensaje del user, llama al LLM (con tool use loop), devuelve respuesta.

    Body: { "texto": "string" }
    """
    try:
        data = json.loads(request.body or b'{}')
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

    texto = (data.get('texto') or '').strip()
    if not texto:
        return JsonResponse({'ok': False, 'error': 'Mensaje vacío'}, status=400)
    if len(texto) > 4000:
        return JsonResponse({'ok': False, 'error': 'Mensaje demasiado largo (>4000 chars)'}, status=400)

    cfg = AsistenteConfig.get_singleton()
    if not cfg.activo:
        return JsonResponse({'ok': False, 'error': 'El asistente está deshabilitado.'}, status=503)

    conv = _get_or_create_conv(request.user)

    # 1) Guardar mensaje del user
    user_msg = MensajeAsistente.objects.create(
        conversacion=conv, role='user', contenido=texto,
    )

    # 2) Loop de tool use
    tools = tools_for_user(request.user)
    sys_msg = _system_prompt(request.user, cfg)
    final_text = None

    try:
        for iteration in range(MAX_TOOL_ITERATIONS):
            # Reconstruir contexto en cada iteración (incluye los tool_results
            # recién agregados).
            context_msgs = _build_context(conv, cfg)
            messages = [sys_msg] + context_msgs

            resp = chat(
                messages=messages,
                tools=tools,
                model=cfg.modelo,
                temperature=0.3,
                max_tokens=1024,
            )

            # Si el modelo regresó texto sin pedir tools, terminamos.
            if not resp.get('tool_calls'):
                final_text = (resp.get('text') or '').strip() or '(sin respuesta)'
                MensajeAsistente.objects.create(
                    conversacion=conv, role='assistant', contenido=final_text,
                )
                break

            # El modelo pidió tools. Guardar mensaje assistant con tool_calls,
            # luego ejecutar cada tool y guardar sus resultados.
            for tc in resp['tool_calls']:
                MensajeAsistente.objects.create(
                    conversacion=conv,
                    role='assistant',
                    contenido=resp.get('text') or '',
                    tool_name=tc['name'],
                    tool_args_json=tc.get('arguments_str') or json.dumps(tc.get('arguments') or {}),
                    tool_call_id=tc['id'],
                )
                tool_result = execute_tool(tc['name'], tc.get('arguments') or {}, request.user)
                MensajeAsistente.objects.create(
                    conversacion=conv,
                    role='tool',
                    contenido=json.dumps(tool_result, ensure_ascii=False, default=str),
                    tool_name=tc['name'],
                    tool_call_id=tc['id'],
                )
            # Siguiente iteración: el modelo verá los resultados y responderá.
        else:
            # Salió del for sin break → llegó al tope sin texto final.
            final_text = (
                'Lo siento, no pude llegar a una respuesta después de varias '
                'consultas. Intenta reformular tu pregunta.'
            )
            MensajeAsistente.objects.create(
                conversacion=conv, role='assistant', contenido=final_text,
            )

    except AsistenteError as e:
        # Borrar el user_msg para que el user pueda reintentar sin duplicar.
        # No: lo dejamos en BD para que vea su intento. Solo devolvemos error.
        log.warning('Asistente error: %s', e)
        return JsonResponse({'ok': False, 'error': str(e)}, status=502)
    except Exception as e:
        log.exception('Error inesperado en asistente: %s', e)
        return JsonResponse({'ok': False, 'error': f'Error inesperado: {e}'}, status=500)

    return JsonResponse({
        'ok': True,
        'mensaje_user_id': user_msg.id,
        'respuesta': final_text or '(sin respuesta)',
    })
