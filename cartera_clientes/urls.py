# cartera_clientes/cartera_clientes/urls.py

from django.contrib import admin
from django.urls import path, include
from django.views.generic.base import RedirectView
from django.contrib.auth import views as auth_views

urlpatterns = [
    # Ruta para el panel de administración de Django
    path('admin/', admin.site.urls),

    # Incluye las URLs de tu aplicación 'app' directamente en la raíz del proyecto.
    # Esto significa que todas las rutas definidas en 'app/urls.py' serán accesibles
    # sin ningún prefijo. Por ejemplo, '/home/', '/todos/', '/reporte-clientes/', etc.
    # Si quieres que la URL raíz (http://127.0.0.1:8000/) redirija a una página específica
    # de tu app (como 'home' o 'index'), puedes añadir una línea como:
    # path('', RedirectView.as_view(url='/home/', permanent=False)),
    # pero asegúrate de que '/home/' esté definido en app/urls.py.
    path("", include("app.urls")),

    # Si aún quieres que la URL raíz (http://127.0.0.1:8000/) redirija a /app/,
    # y que las URLs de tu app sigan siendo accesibles con y sin el prefijo 'app/',
    # entonces necesitarías un enfoque más avanzado con namespaces o un patrón diferente.
    # Por ahora, esta configuración prioriza que 'reporte-clientes/' funcione directamente.

path('app/', include('app.urls')), # Asegúrate de que tu app.urls esté incluida aquí

]
