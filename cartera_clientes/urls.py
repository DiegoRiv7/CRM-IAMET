# cartera_clientes/cartera_clientes/urls.py

from django.contrib import admin
from django.urls import path, include
# No necesitamos RedirectView ni auth_views si no los usas directamente en este archivo
# from django.views.generic.base import RedirectView
# from django.contrib.auth import views as auth_views
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    # Ruta para el panel de administración de Django
    path('admin/', admin.site.urls),

    # Incluye las URLs de tu aplicación 'app' directamente en la raíz del proyecto.
    # Esto significa que todas las rutas definidas en 'app/urls.py' serán accesibles
    # sin ningún prefijo (por ejemplo, /home/, /todos/, /reporte-clientes/).
    path("", include("app.urls")),

    # He eliminado la línea path('app/', include('app.urls')) porque con la línea de arriba
    # tus URLs ya son accesibles desde la raíz. Incluirla de nuevo bajo '/app/' podría
    # generar rutas duplicadas y confusión. Si necesitas URLs bajo /app/, tendrías
    # que ajustar cómo se definen en app/urls.py o manejarlo con namespaces.
]

# ESTAS LÍNEAS DEBEN ESTAR DESPUÉS DE LA DEFINICIÓN COMPLETA DE urlpatterns
# Sirve archivos estáticos y de medios solo en modo de depuración (DEBUG=True).
# EN PRODUCCIÓN REAL, ESTO DEBE SER MANEJADO POR UN SERVIDOR COMO NGINX.
if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)