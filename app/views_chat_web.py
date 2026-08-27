# ----------------------------------------------------------------------
# views_chat_web.py — Bandeja del CHAT DIRECTO de la página web.
#
# Los visitantes con Cuenta IAMET escriben desde iamet-platform (/chat).
# Esta bandeja lee y responde esos hilos DESDE el CRM, vía la API REST del
# sitio (GET/POST /api/crm/chat/*), autenticada con el MISMO token de la
# integración de leads web (LeadWebConfig). La respuesta sale con el nombre
# del usuario del CRM que atiende.
#
# Config: SITIO_WEB_URL (env) — base del sitio; en pruebas el default apunta
# al sitio de pruebas que corre junto a este CRM.
# ----------------------------------------------------------------------

import json
import logging
import os

import requests
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_POST

from .models import LeadWebConfig

logger = logging.getLogger(__name__)

TIMEOUT = 10


def _sitio_base():
    return os.environ.get('SITIO_WEB_URL', 'http://82.223.44.29').rstrip('/')


def _token_sitio():
    """Token compartido con el sitio: el de la config de leads web activa."""
    cfg = (LeadWebConfig.objects.filter(activo=True).exclude(token='')
           .order_by('id').first())
    return cfg.token if cfg else ''


def _get_sitio(path, params=None):
    token = _token_sitio()
    if not token:
        return None, 'Sin token: configura Leads Web en el Panel de Administración.'
    try:
        r = requests.get(
            f'{_sitio_base()}{path}',
            params=params or {},
            headers={'Authorization': f'Bearer {token}'},
            timeout=TIMEOUT,
        )
        if r.status_code != 200:
            return None, f'El sitio respondió {r.status_code}'
        return r.json(), None
    except requests.RequestException as exc:
        logger.warning('[ChatWeb] Error consultando el sitio: %s', exc)
        return None, 'No se pudo contactar al sitio web.'


@login_required
def chat_web(request):
    """Página de la bandeja (la lista y la conversación cargan por fetch)."""
    return render(request, 'chat_web.html', {
        'agente_nombre': request.user.get_full_name() or request.user.username,
    })


@login_required
def chat_web_threads(request):
    data, err = _get_sitio('/api/crm/chat/threads')
    if err:
        return JsonResponse({'error': err}, status=502)
    return JsonResponse(data)


@login_required
def chat_web_messages(request):
    session_id = request.GET.get('sessionId', '')
    if not session_id.startswith('cuenta-'):
        return JsonResponse({'error': 'sessionId inválido'}, status=400)
    data, err = _get_sitio('/api/crm/chat/messages', {'sessionId': session_id})
    if err:
        return JsonResponse({'error': err}, status=502)
    return JsonResponse(data)


@login_required
@require_POST
def chat_web_reply(request):
    try:
        body = json.loads(request.body.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    session_id = str(body.get('sessionId', ''))
    contenido = str(body.get('content', '')).strip()
    if not session_id.startswith('cuenta-') or not contenido:
        return JsonResponse({'error': 'Datos inválidos'}, status=400)

    token = _token_sitio()
    if not token:
        return JsonResponse({'error': 'Sin token de Leads Web.'}, status=502)

    agente = request.user.get_full_name() or request.user.username
    try:
        r = requests.post(
            f'{_sitio_base()}/api/crm/chat/reply',
            json={'sessionId': session_id, 'content': contenido, 'agentName': agente},
            headers={'Authorization': f'Bearer {token}'},
            timeout=TIMEOUT,
        )
        if r.status_code != 200:
            return JsonResponse({'error': f'El sitio respondió {r.status_code}'}, status=502)
        return JsonResponse({'ok': True})
    except requests.RequestException as exc:
        logger.warning('[ChatWeb] Error respondiendo al sitio: %s', exc)
        return JsonResponse({'error': 'No se pudo contactar al sitio web.'}, status=502)
