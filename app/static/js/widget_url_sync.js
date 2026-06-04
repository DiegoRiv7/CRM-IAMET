/* ═══════════════════════════════════════════════════════════════════
   Widget URL Sync — Hardening Fase 1.J

   Mantiene la URL del browser sincronizada con el widget de nivel 1
   abierto. Al copiar la URL y abrirla en otra pestaña, el mismo
   widget se vuelve a abrir con el mismo ID.

   Patrón usado por Notion, Linear, Front, Asana — convierte el
   sistema de widgets en "app real" (no solo "sitio que navegas con
   botones").

   ── API pública ──────────────────────────────────────────────────

   crmWidgetUrl.set(key, id)    Cambia la URL agregando ?open_<key>=<id>.
                                 No genera entrada de history (replaceState).
   crmWidgetUrl.clear(key)      Quita el ?open_<key>=… de la URL.
   crmWidgetUrl.read(key)       Lee el valor del param ?open_<key>=…
                                 (útil al cargar la página para reabrir).

   Convención de keys (no obligatoria — el helper es agnóstico):
     opp, prospecto, idea, cert, curso, evento, proyecto, tarea,
     mail, muro, calendario, notificaciones, perfil, asistente.

   ── Uso típico en un widget ──────────────────────────────────────

   function abrirOpp(oppId) {
       // ... carga datos y muestra el widget
       crmWidgetUrl.set('opp', oppId);
   }
   function cerrarOpp() {
       // ... oculta el widget
       crmWidgetUrl.clear('opp');
   }

   // En el bootstrap de la página:
   document.addEventListener('DOMContentLoaded', function() {
       var oppId = crmWidgetUrl.read('opp');
       if (oppId) abrirOpp(oppId);
   });
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    var PARAM_PREFIX = 'open_';

    function _updateUrl(url) {
        try {
            window.history.replaceState(
                {},
                '',
                url.pathname + (url.search || '') + (url.hash || '')
            );
        } catch (e) {
            console.warn('[crmWidgetUrl] no se pudo actualizar URL:', e);
        }
    }

    window.crmWidgetUrl = {
        set: function (key, id) {
            if (!key) return;
            try {
                var url = new URL(window.location.href);
                if (id == null || id === '') {
                    url.searchParams.delete(PARAM_PREFIX + key);
                } else {
                    url.searchParams.set(PARAM_PREFIX + key, String(id));
                }
                _updateUrl(url);
            } catch (e) { /* noop */ }
        },
        clear: function (key) {
            this.set(key, null);
        },
        read: function (key) {
            try {
                var url = new URL(window.location.href);
                return url.searchParams.get(PARAM_PREFIX + key);
            } catch (e) {
                return null;
            }
        },
        // Lee TODOS los params open_* — útil para el bootstrap de la página
        // que quiera abrir múltiples widgets a la vez.
        readAll: function () {
            var out = {};
            try {
                var url = new URL(window.location.href);
                url.searchParams.forEach(function (v, k) {
                    if (k.indexOf(PARAM_PREFIX) === 0) {
                        out[k.substring(PARAM_PREFIX.length)] = v;
                    }
                });
            } catch (e) { /* noop */ }
            return out;
        },
    };

    // ── Bootstrap automático para widgets conocidos ──
    //
    // Al cargar la página, si la URL contiene ?open_opp=123 (por ejemplo),
    // intenta llamar a la función de apertura conocida (window.openDetalle
    // para opp, window.proyectosVerDetalle para proyecto, etc.) con el ID.
    //
    // Esto permite que un share-link funcione sin que cada bootstrap del
    // widget tenga que leer la URL manualmente.

    var KNOWN_OPENERS = {
        'opp': function (id) { return typeof window.openDetalle === 'function' && window.openDetalle(parseInt(id, 10)); },
        'proyecto': function (id) { return typeof window.proyectosVerDetalle === 'function' && window.proyectosVerDetalle(parseInt(id, 10)); },
        // El resto (prospecto, idea, cert, curso, evento, tarea) se agregan
        // conforme cada widget exponga su función abrir(id) globalmente.
    };

    function bootstrap() {
        var params = window.crmWidgetUrl.readAll();
        // Pequeño defer para que las funciones globales ya estén definidas.
        setTimeout(function () {
            Object.keys(params).forEach(function (key) {
                var opener = KNOWN_OPENERS[key];
                if (typeof opener === 'function') {
                    try { opener(params[key]); }
                    catch (e) { console.warn('[crmWidgetUrl] error al abrir', key, e); }
                }
            });
        }, 600);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }
})();
