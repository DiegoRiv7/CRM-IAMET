"""PWA dedicada: Levantamientos IAMET.

App mínima, instalable en home screen (Android/iOS), pensada para
que los ingenieros capturen levantamientos en planta — incluso sin
señal. Fase A (este archivo): login + lista de proyectos + wizard
embebido, sin offline todavía.

Fases B-C agregarán Service Worker con cache + IndexedDB + cola de
sync. Para eso se irán añadiendo vistas (sw_lev.js, endpoint de
upload offline) y lógica en JS — este archivo queda como el
entrypoint oficial del PWA.
"""
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import render
from django.templatetags.static import static
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET


@never_cache
@login_required(login_url='/app/login/')
def levantamientos_app(request):
    """Shell principal del PWA. Si el usuario no está autenticado,
    Django lo manda a /app/login/?next=/app/levantamientos/ y
    regresa aquí tras loguearse."""
    return render(request, 'levantamientos_app.html')


@require_GET
def levantamientos_manifest(request):
    """Web App Manifest — habilita 'Agregar a pantalla de inicio'.

    Se sirve dinámicamente (en vez de como archivo estático) para
    poder resolver las rutas de íconos con {% static %} correctas
    en cualquier entorno (dev/prod, con o sin WhiteNoise/CDN).
    """
    manifest = {
        'name': 'Levantamientos IAMET',
        'short_name': 'IAMET Lev',
        'description': 'Captura de levantamientos en planta para proyectos IAMET. Funciona sin conexión y sincroniza al recuperar red.',
        'start_url': '/app/levantamientos/',
        'scope': '/app/levantamientos/',
        'display': 'standalone',
        'orientation': 'portrait',
        'background_color': '#F4F6FA',
        'theme_color': '#0052D4',
        'lang': 'es-MX',
        'icons': [
            {
                'src': static('images/android-chrome-192x192.png'),
                'sizes': '192x192',
                'type': 'image/png',
                'purpose': 'any',
            },
            {
                'src': static('images/android-chrome-512x512.png'),
                'sizes': '512x512',
                'type': 'image/png',
                'purpose': 'any maskable',
            },
        ],
    }
    resp = JsonResponse(manifest)
    resp['Content-Type'] = 'application/manifest+json'
    return resp


@require_GET
def levantamientos_service_worker(request):
    """Service Worker stub — habilita la instalación del PWA
    (Chrome/Edge requieren un SW registrado para el prompt de
    instalación). Fase B agregará la lógica real de cache offline.

    Se sirve con scope '/app/levantamientos/' (propio, no interfiere
    con el resto del CRM) y SIN cache (no-store) para que al
    actualizar el archivo el navegador lo recoja de inmediato."""
    from django.http import HttpResponse
    js = (
        "// CRM IAMET — Levantamientos PWA Service Worker (Fase A stub)\n"
        "// Fase B añadirá cache de app-shell y estrategia offline.\n"
        "self.addEventListener('install', function (e) { self.skipWaiting(); });\n"
        "self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });\n"
        "// Fetch passthrough por ahora\n"
        "self.addEventListener('fetch', function (e) { /* Fase B */ });\n"
    )
    resp = HttpResponse(js, content_type='application/javascript')
    resp['Service-Worker-Allowed'] = '/app/levantamientos/'
    resp['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp
