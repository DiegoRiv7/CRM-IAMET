    # cartera_clientes/cartera_clientes/urls.py

from django.contrib import admin
from django.urls import path, include
from django.contrib.auth import views as auth_views
from django.views.generic.base import RedirectView
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    # Ruta para el panel de administración de Django
    path('admin/', admin.site.urls),

    # Incluye las URLs de autenticación de Django
    path('app/accounts/', include('django.contrib.auth.urls')),
    
    # Incluye todas las URLs de la aplicación 'app' bajo el prefijo /app/
    # Esto hace que las rutas sean consistentes con la configuración (LOGIN_URL, etc.)
    path("app/", include("app.urls")),

    # Redirige la raíz del sitio (/) a la página de login de la aplicación.
    path('', RedirectView.as_view(url='/app/login/', permanent=False)),
]

# ESTAS LÍNEAS DEBEN ESTAR DESPUÉS DE LA DEFINICIÓN COMPLETA DE urlpatterns
from django.views.static import serve
from django.urls import re_path

urlpatterns += [
    re_path(r'^media/(?P<path>.*)$', serve, {
        'document_root': settings.MEDIA_ROOT,
    }),
]
if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)