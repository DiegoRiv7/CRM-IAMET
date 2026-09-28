"""
MULTIEMPRESA — Inicio de sesión desde el portal maestro (SSO por token).

El portal (deploy/portal) muestra UN solo login para todas las empresas. Cuando
un usuario escribe su usuario/correo y contraseña, el portal se los manda a
esta instancia por la red interna (127.0.0.1:<puerto>) con el secreto
compartido `PORTAL_SSO_SECRET` (variable del .env de la empresa, generada en el
alta). Si son correctos, la instancia emite un token firmado de un solo uso y
90 s de vida; el portal redirige al navegador a /app/login/portal/?t=<token>
y aquí se abre la sesión.

Sin `PORTAL_SSO_SECRET` (IAMET producción/pruebas) todo esto responde 404.
"""
import hmac
import json
import os
import secrets

from django.conf import settings
from django.contrib.auth import authenticate, login
from django.contrib.auth.models import User
from django.core import signing
from django.http import Http404, JsonResponse
from django.shortcuts import redirect
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

TOKEN_MAX_AGE = 90  # segundos
_SALT = 'crm-portal-sso'


def _secreto():
    return (os.environ.get('PORTAL_SSO_SECRET') or '').strip()


def _signer():
    return signing.TimestampSigner(key=_secreto(), salt=_SALT)


def _exige_portal(request):
    """Solo el portal (con el secreto) puede llamar a las APIs internas."""
    s = _secreto()
    if not s:
        raise Http404()
    dado = request.headers.get('X-Portal-Secret', '')
    if not hmac.compare_digest(dado, s):
        return JsonResponse({'ok': False, 'error': 'No autorizado'}, status=403)
    return None


def _resolver_username(texto):
    texto = (texto or '').strip()
    if '@' in texto:
        u = User.objects.filter(email__iexact=texto).first()
        if u:
            return u.username
    return texto


@csrf_exempt
@require_POST
def api_portal_validar(request):
    """POST {usuario, password, remember} → {ok, token, username, nombre} si son correctos."""
    err = _exige_portal(request)
    if err:
        return err
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)
    username = _resolver_username(data.get('usuario'))
    password = data.get('password') or ''
    if not username or not password:
        return JsonResponse({'ok': False})
    user = authenticate(request, username=username, password=password)
    if not user or not user.is_active:
        return JsonResponse({'ok': False})
    token = _signer().sign_object({
        'u': user.username, 'r': 1 if data.get('remember') else 0, 'n': secrets.token_hex(8),
    })
    return JsonResponse({'ok': True, 'token': token, 'username': user.username,
                         'nombre': (user.get_full_name() or user.username)})


@csrf_exempt
@require_POST
def api_portal_reset(request):
    """POST {usuario} → avisa a los supervisores de ESTA empresa (misma lógica que el
    modal "Olvidé mi contraseña" del login). Devuelve si el usuario existía."""
    err = _exige_portal(request)
    if err:
        return err
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)
    username = _resolver_username(data.get('usuario'))
    usuario = User.objects.filter(username=username).first() if username else None
    if not usuario:
        return JsonResponse({'ok': True, 'existe': False})
    from .models import Notificacion
    supervisores = User.objects.filter(is_superuser=True)
    for supervisor in supervisores:
        Notificacion.objects.create(
            usuario_destinatario=supervisor, usuario_remitente=None, tipo='sistema',
            titulo='Solicitud de restablecimiento de contraseña',
            mensaje=(f"El usuario '{usuario.username}' solicitó restablecer su contraseña desde el portal. "
                     f"Por favor, autorice y gestione el cambio."),
        )
    return JsonResponse({'ok': True, 'existe': True, 'avisados': supervisores.count()})


@require_GET
def login_portal(request):
    """GET /app/login/portal/?t=<token>[&next=/app/...] → abre la sesión y redirige."""
    if not _secreto():
        raise Http404()
    from .models import PortalTokenUsado
    token = request.GET.get('t', '')
    try:
        datos = _signer().unsign_object(token, max_age=TOKEN_MAX_AGE)
    except (signing.BadSignature, signing.SignatureExpired):
        return redirect('/app/login/?portal=expirado')
    nonce = datos.get('n', '')
    # Un solo uso: si ya se usó, no vale (protege contra reenvío del enlace).
    if not nonce or PortalTokenUsado.objects.filter(nonce=nonce).exists():
        return redirect('/app/login/?portal=usado')
    PortalTokenUsado.objects.create(nonce=nonce)
    PortalTokenUsado.objects.filter(creado__lt=timezone.now() - timezone.timedelta(days=1)).delete()
    user = User.objects.filter(username=datos.get('u', ''), is_active=True).first()
    if not user:
        return redirect('/app/login/')
    login(request, user, backend='django.contrib.auth.backends.ModelBackend')
    request.session.set_expiry(1209600 if datos.get('r') else 0)
    next_url = request.GET.get('next') or ''
    if next_url.startswith('/') and not next_url.startswith('//'):
        return redirect(next_url)
    return redirect(settings.LOGIN_REDIRECT_URL)
