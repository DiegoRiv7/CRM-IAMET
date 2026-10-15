"""
Resuelve la empresa por el Host en CADA request, antes de SessionMiddleware y
AuthenticationMiddleware (los dos pegan a la BD: django_session y auth_user
viven en la base de cada empresa).

  - Host desconocido o empresa inactiva → 404. Nunca se cae a otra empresa.
  - /healthz/ responde "ok" sin tocar ninguna BD (chequeos de deploy/nginx).
  - Se lee HTTP_HOST crudo (no request.get_host()) para que la verificación
    contra el registro de empresas sea la que manda; ALLOWED_HOSTS sigue
    aplicando después, en CommonMiddleware/get_host(), con los sufijos del
    producto (*.crm.iamet.mx, *.nip.io).
"""
from django.http import HttpResponse, HttpResponseNotFound

from .connections import ensure_alias
from .context import reset_current_tenant, set_current_tenant
from .resolver import por_host

HEALTH_PATH = '/healthz/'


class TenantMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path == HEALTH_PATH:
            return HttpResponse('ok', content_type='text/plain')

        tenant = por_host(request.META.get('HTTP_HOST', ''))
        if tenant is None:
            return HttpResponseNotFound('Empresa no encontrada para este dominio.')

        ensure_alias(tenant)
        token = set_current_tenant(tenant)
        request.tenant = tenant
        try:
            return self.get_response(request)
        finally:
            reset_current_tenant(token)
