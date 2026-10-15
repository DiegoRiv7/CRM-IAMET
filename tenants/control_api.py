"""
API de CONTROL — endpoints que NO pertenecen a ninguna empresa.

Viven bajo /control/ y el middleware los deja pasar sin resolver tenant (igual
que /healthz/): sirven para que el portal maestro pregunte por el catálogo de
empresas y valide un inicio de sesión contra UNA empresa concreta.

Antes el portal leía `empresas.yml` y el `.env.<slug>` de cada empresa, y para
entrar le mandaba usuario+contraseña a TODAS las instancias a ver cuál la
aceptaba. Con una sola app eso ya no tiene sentido y además hacía que la
contraseña de un usuario viajara a empresas ajenas. Ahora el portal manda el
slug y la validación ocurre solo ahí.

Autenticación: cabecera `X-Control-Token` contra settings.CONTROL_API_TOKEN
(variable CONTROL_API_TOKEN). Sin token configurado, todo responde 404.
"""
import hmac
import json
import secrets

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.core import signing
from django.http import Http404, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .context import tenant_context
from .models import Tenant

TOKEN_MAX_AGE = 90  # segundos (igual que el SSO del lado de la empresa)
_SALT = 'crm-portal-sso'


def _token_control():
    return (getattr(settings, 'CONTROL_API_TOKEN', '') or '').strip()


def _exige_control(request):
    """Solo el portal (con el token de control) puede llamar a estos endpoints."""
    esperado = _token_control()
    if not esperado:
        raise Http404()
    dado = request.headers.get('X-Control-Token', '')
    if not hmac.compare_digest(dado, esperado):
        return JsonResponse({'ok': False, 'error': 'No autorizado'}, status=403)
    return None


@require_GET
def empresas(request):
    """GET /control/empresas/ → catálogo de empresas activas (sin secretos)."""
    err = _exige_control(request)
    if err:
        return err
    datos = [
        {
            'slug': t.slug,
            'nombre': t.nombre,
            'hosts': [h.hostname for h in t.hosts.all()],
        }
        for t in Tenant.objects.filter(activo=True).prefetch_related('hosts').order_by('nombre')
    ]
    return JsonResponse({'ok': True, 'empresas': datos})


@csrf_exempt
@require_POST
def validar(request):
    """POST /control/validar/ {slug, usuario, password, remember}
    → {ok, token, nombre} si las credenciales son de ESA empresa.

    El token va firmado con el secreto de la empresa y lleva su slug dentro,
    así que solo sirve en su propio host (lo verifica login_portal)."""
    err = _exige_control(request)
    if err:
        return err
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

    slug = (data.get('slug') or '').strip().lower()
    tenant = Tenant.objects.filter(slug=slug, activo=True).first()
    if not tenant:
        return JsonResponse({'ok': False, 'error': 'Empresa desconocida'}, status=404)
    password = data.get('password') or ''
    texto = (data.get('usuario') or '').strip()
    if not texto or not password:
        return JsonResponse({'ok': False})

    with tenant_context(tenant):
        username = texto
        if '@' in texto:
            u = User.objects.filter(email__iexact=texto).first()
            if u:
                username = u.username
        user = authenticate(request, username=username, password=password)
        if not user or not user.is_active:
            return JsonResponse({'ok': False})
        firmante = signing.TimestampSigner(key=tenant.portal_sso_secret, salt=_SALT)
        token = firmante.sign_object({
            'u': user.username, 'r': 1 if data.get('remember') else 0,
            'n': secrets.token_hex(8), 't': tenant.slug,
        })
        nombre = user.get_full_name() or user.username
    return JsonResponse({'ok': True, 'token': token, 'username': user.username, 'nombre': nombre})


@csrf_exempt
@require_POST
def reset(request):
    """POST /control/reset/ {slug, usuario} → avisa a los supervisores de ESA empresa."""
    err = _exige_control(request)
    if err:
        return err
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)
    slug = (data.get('slug') or '').strip().lower()
    tenant = Tenant.objects.filter(slug=slug, activo=True).first()
    if not tenant:
        return JsonResponse({'ok': False, 'error': 'Empresa desconocida'}, status=404)
    texto = (data.get('usuario') or '').strip()
    if not texto:
        return JsonResponse({'ok': False})
    with tenant_context(tenant):
        usuario = User.objects.filter(username=texto).first()
        if not usuario and '@' in texto:
            usuario = User.objects.filter(email__iexact=texto).first()
        if not usuario:
            return JsonResponse({'ok': True, 'existe': False})
        from app.models import Notificacion
        supervisores = User.objects.filter(is_superuser=True)
        for supervisor in supervisores:
            Notificacion.objects.create(
                usuario_destinatario=supervisor, usuario_remitente=None, tipo='sistema',
                titulo='Solicitud de restablecimiento de contraseña',
                mensaje=(f"El usuario '{usuario.username}' solicitó restablecer su contraseña desde el portal. "
                         f"Por favor, autorice y gestione el cambio."),
            )
        n = supervisores.count()
    return JsonResponse({'ok': True, 'existe': True, 'avisados': n})
