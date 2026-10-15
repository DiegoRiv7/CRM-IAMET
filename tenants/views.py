"""
/media/<path> en modo bridge: SOLO usuarios autenticados y SOLO desde la
subcarpeta de la empresa del host (MEDIA_ROOT/<slug>). `serve` hace el
safe_join: una ruta que intente salir de ahí es 404.

(En modo clásico, cartera_clientes/urls.py sigue usando django.views.static.serve
tal cual, sin cambios de comportamiento para IAMET.)
"""
import os

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.core.exceptions import SuspiciousFileOperation
from django.http import Http404
from django.views.static import serve

from .storage import subcarpeta_tenant


@login_required
def media(request, path):
    sub = subcarpeta_tenant()
    if not sub:
        raise Http404()
    root = os.path.join(settings.MEDIA_ROOT, sub)
    try:
        return serve(request, path, document_root=root)
    except SuspiciousFileOperation:
        # Intento de salir de la carpeta de la empresa (../): mismo 404 que un
        # archivo inexistente, sin revelar que la ruta era "sospechosa".
        raise Http404()
