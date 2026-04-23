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


#: Version del app-shell cacheado. BUMPEA esta constante al cambiar
#  el template, CSS o JS del PWA para forzar re-descarga. El SW
#  borrará caches viejos y se actualizará en segundo plano.
SW_VERSION = 'lev-v5-cache-api-unversioned'


@require_GET
def levantamientos_service_worker(request):
    """Service Worker real del PWA Levantamientos (Fase B).

    Estrategias:
      • App-shell (HTML, CSS, JS, íconos): cache-first.
      • API /app/api/iamet/proyectos/ (lista de proyectos):
        stale-while-revalidate — serve del cache de inmediato y
        actualiza en background.
      • Otras API (offline-sync, etc.): network-only (sin cache).
      • Navegación a /app/levantamientos/: network-first con
        fallback al HTML cacheado (para que abra offline).

    Scope: '/app/levantamientos/' — completamente aislado del resto
    del CRM. No interfiere con la sesión web normal.
    """
    from django.http import HttpResponse
    from django.templatetags.static import static

    # Assets a precachear. El orden no importa, pero listar explícito
    # evita sorpresas. Si agregas/remueves assets → bump SW_VERSION.
    precache_urls = [
        '/app/levantamientos/',
        '/app/levantamientos/manifest.webmanifest',
        static('css/crm.css'),
        static('css/crm_proyectos.css'),
        static('css/crm_levantamiento.css'),
        static('js/lev_offline.js'),
        static('js/crm_proyectos.js'),
        static('js/crm_levantamiento.js'),
        static('images/iamet-logo.png'),
        static('images/android-chrome-192x192.png'),
        static('images/android-chrome-512x512.png'),
        static('images/apple-touch-icon.png'),
        static('images/favicon-32x32.png'),
        static('images/favicon-16x16.png'),
    ]

    # Importar json acá para serializar la lista al JS
    import json as _json
    precache_json = _json.dumps(precache_urls)

    js = f"""// ══════════════════════════════════════════════════════════════
// CRM IAMET — Levantamientos PWA Service Worker
// Version: {SW_VERSION}
// ══════════════════════════════════════════════════════════════

const SW_VERSION = '{SW_VERSION}';
// SHELL_CACHE sí se versiona: cuando cambias HTML/CSS/JS queremos
// que caches viejos se borren (si no, el usuario seguiría viendo
// código viejo para siempre).
const SHELL_CACHE = 'lev-shell-' + SW_VERSION;
// API_CACHE NO se versiona: son datos (proyectos, etc.) que deben
// sobrevivir upgrades del SW. Si cada upgrade lo borrara, el usuario
// se quedaría sin lista de proyectos offline hasta volver a tener red.
const API_CACHE = 'lev-api';
const SCOPE_PATH = '/app/levantamientos/';

const PRECACHE_URLS = {precache_json};

// ── INSTALL: precachear app-shell ─────────────────────────────
self.addEventListener('install', function (event) {{
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(function (cache) {{
                // addAll es atómico: si falla alguno, no se precachea nada.
                // Por eso usamos Promise.all con catch individual.
                return Promise.all(
                    PRECACHE_URLS.map(function (url) {{
                        return cache.add(url).catch(function (err) {{
                            console.warn('[SW] Precache falló para', url, err);
                        }});
                    }})
                );
            }})
            .then(function () {{ return self.skipWaiting(); }})
    );
}});

// ── ACTIVATE: limpiar shell caches viejos (conservar API cache) ──
self.addEventListener('activate', function (event) {{
    event.waitUntil(
        caches.keys().then(function (names) {{
            return Promise.all(names.map(function (name) {{
                // Solo borrar SHELL caches de versiones previas.
                // El API_CACHE ('lev-api') SE CONSERVA — contiene datos
                // del usuario (lista de proyectos, etc.) que deben
                // sobrevivir upgrades del SW para que offline siga
                // siendo útil después de actualizar la app.
                if (name.startsWith('lev-shell-') && name !== SHELL_CACHE) {{
                    return caches.delete(name);
                }}
                // Borrar cualquier lev-api-* versionado de versiones
                // viejas donde cometimos el error de versionarlo.
                if (/^lev-api-.+/.test(name)) {{
                    return caches.delete(name);
                }}
            }}));
        }}).then(function () {{ return self.clients.claim(); }})
    );
}});

// ── FETCH: router de estrategias ───────────────────────────────
self.addEventListener('fetch', function (event) {{
    const req = event.request;
    const url = new URL(req.url);

    // Solo interesa mismo origen y dentro del scope del PWA o assets estáticos
    if (url.origin !== self.location.origin) return;
    if (req.method !== 'GET') return;

    // Sync offline: network-only (hay que llegar al servidor)
    if (url.pathname.includes('/api/iamet/levantamientos/offline-sync')) {{
        return; // passthrough al navegador
    }}

    // Lista de proyectos: stale-while-revalidate
    if (url.pathname.startsWith('/app/api/iamet/proyectos/')) {{
        event.respondWith(staleWhileRevalidate(req, API_CACHE));
        return;
    }}

    // Navegación a la app: network-first con fallback a cache
    if (req.mode === 'navigate' && url.pathname.startsWith(SCOPE_PATH)) {{
        event.respondWith(networkFirst(req, SHELL_CACHE, SCOPE_PATH));
        return;
    }}

    // Assets estáticos (CSS/JS/imágenes): cache-first
    if (url.pathname.startsWith('/static/') || PRECACHE_URLS.indexOf(url.pathname) !== -1) {{
        event.respondWith(cacheFirst(req, SHELL_CACHE));
        return;
    }}
    // El resto: passthrough
}});

// ── Estrategias ────────────────────────────────────────────────
function cacheFirst(req, cacheName) {{
    return caches.match(req).then(function (cached) {{
        if (cached) return cached;
        return fetch(req).then(function (resp) {{
            if (resp && resp.status === 200) {{
                const copy = resp.clone();
                caches.open(cacheName).then(function (c) {{ c.put(req, copy); }});
            }}
            return resp;
        }});
    }});
}}

function networkFirst(req, cacheName, fallbackPath) {{
    return fetch(req).then(function (resp) {{
        if (resp && resp.status === 200) {{
            const copy = resp.clone();
            caches.open(cacheName).then(function (c) {{ c.put(req, copy); }});
        }}
        return resp;
    }}).catch(function () {{
        return caches.match(req).then(function (cached) {{
            if (cached) return cached;
            // fallback: la ruta raíz del PWA
            return caches.match(fallbackPath).then(function (fb) {{
                return fb || offlineFallbackResponse(req);
            }});
        }});
    }});
}}

function staleWhileRevalidate(req, cacheName) {{
    return caches.open(cacheName).then(function (cache) {{
        return cache.match(req).then(function (cached) {{
            const fetchPromise = fetch(req).then(function (resp) {{
                if (resp && resp.status === 200) {{
                    cache.put(req, resp.clone());
                }}
                return resp;
            }}).catch(function () {{
                // Si hay cache, devuélvela; si no, JSON vacío offline.
                return cached || offlineFallbackResponse(req);
            }});
            // Si no hay cache, espera al fetch (que ya sabe manejar offline)
            return cached || fetchPromise;
        }});
    }});
}}

// Respuesta de último recurso cuando ni cache ni red funcionan.
// Devuelve JSON vacío para rutas de API — así el JS del cliente
// no recibe undefined y puede mostrar un estado vacío limpio.
function offlineFallbackResponse(req) {{
    const url = new URL(req.url);
    if (url.pathname.indexOf('/api/') !== -1) {{
        return new Response(JSON.stringify({{
            success: false, ok: false, offline: true,
            data: [], error: 'Sin conexión y sin caché'
        }}), {{
            status: 503,
            headers: {{ 'Content-Type': 'application/json' }}
        }});
    }}
    return new Response('', {{ status: 503 }});
}}

// ── Mensajes del cliente (Fase C los usará para triggerar sync) ──
self.addEventListener('message', function (event) {{
    if (!event.data) return;
    if (event.data.type === 'SKIP_WAITING') {{
        self.skipWaiting();
    }}
}});
"""
    resp = HttpResponse(js, content_type='application/javascript')
    resp['Service-Worker-Allowed'] = '/app/levantamientos/'
    # El SW en sí NO se cachea (el navegador necesita detectar cambios)
    resp['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp
