/* ═══════════════════════════════════════════════════════════════════════
 * turbo_bootstrap.js — capa de adaptación entre Turbo Drive y el CRM IAMET.
 *
 * Por qué existe esta capa
 * ─────────────────────────
 * El CRM ya existía sin Turbo. Tiene mucho código que se inicializa en
 * DOMContentLoaded y asume que la página carga UNA vez por navegación.
 * Turbo cambia eso: la página vive (sidebar, topbar, scripts, estado JS)
 * y solo se reemplaza el body al navegar. DOMContentLoaded NO vuelve a
 * dispararse en cada navegación; en su lugar Turbo emite `turbo:load`.
 *
 * Estrategia adoptada: "Drive opt-in"
 * ────────────────────────────────────
 * Turbo Drive está DESACTIVADO por defecto (Turbo.session.drive = false).
 * Las navegaciones SPA-like solo aplican a los `<a>` que explícitamente
 * lleven `data-turbo="true"` — hoy, los links del sidebar y topbar.
 *
 * Todo lo demás (downloads PDF, iframes, login/logout, forms con submit
 * tradicional) sigue funcionando exactamente igual que antes. Eso reduce
 * el blast-radius del experimento al mínimo: si rompe algo, rompe solo
 * las navegaciones entre secciones principales y se desactiva con una
 * sola línea.
 *
 * Lo que esta capa expone
 * ───────────────────────
 *   window.crmReady(fn)
 *     Sustituye a `DOMContentLoaded`. Ejecuta `fn` ahora si la página ya
 *     está cargada, y vuelve a ejecutarlo en cada `turbo:load`. Si el
 *     archivo se evalúa después de la primera carga (porque Turbo lo
 *     conserva entre navegaciones), no se vuelve a llamar dos veces.
 *
 *   window.crmTurboEnabled
 *     Booleano global indicando si Turbo está activo. Útil para que el
 *     código legacy pueda decidir patrones (ej: no usar `window.location.href`
 *     directamente para navegar dentro de la app).
 *
 * Ciclo de vida que manejamos
 * ───────────────────────────
 *   turbo:before-cache  → la página actual va a cachearse. Cerramos
 *                         widgets, modales y limpiamos elementos que no
 *                         deben aparecer en la versión cacheada.
 *
 *   turbo:load          → terminó de cargar/navegar. Re-disparamos las
 *                         inicializaciones registradas con crmReady().
 *
 *   turbo:before-fetch-request → preflight. Aquí podríamos agregar
 *                         headers (CSRF ya viene en cookies, Django lo
 *                         lee automáticamente para fetch).
 * ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // ── Modo "Drive opt-in" ──────────────────────────────────────────────
    // Por defecto Turbo Drive está apagado. Solo los <a data-turbo="true">
    // del sidebar/topbar lo activan. Esta línea es la diferencia entre
    // "Turbo en toda la app" (riesgoso) y "Turbo donde lo quiero" (lo que
    // estamos haciendo aquí).
    if (window.Turbo) {
        window.Turbo.session.drive = false;
    } else {
        console.warn('[turbo_bootstrap] window.Turbo no está disponible — el script de Turbo no cargó antes que éste.');
    }

    window.crmTurboEnabled = !!window.Turbo;

    // ── Helper crmReady() ────────────────────────────────────────────────
    // Patrón clásico: si DOM ya cargó, ejecuta ya; si no, espera. Adicional
    // a eso, se re-ejecuta en cada turbo:load para que las páginas que
    // navegan via Turbo vuelvan a inicializarse correctamente.
    //
    // CUIDADO: cualquier función pasada a crmReady() puede correr más de
    // una vez. Si el código adjunta event listeners, debe ser idempotente
    // (usar IDs estables, comprobar si ya está wireado, o usar delegation).
    var _readyCallbacks = [];
    var _firstLoadDispatched = false;

    function _runCallbacks() {
        _readyCallbacks.forEach(function (fn) {
            try { fn(); }
            catch (e) { console.error('[crmReady] callback error:', e); }
        });
    }

    window.crmReady = function (fn) {
        if (typeof fn !== 'function') return;
        _readyCallbacks.push(fn);

        // Si el DOM ya está listo, ejecuta ya. Pero solo la primera vez
        // que se agrega — los turbo:load subsiguientes corren todos los
        // callbacks juntos vía el listener de abajo.
        if (document.readyState === 'loading') {
            // todavía no llegó DOMContentLoaded, no hacer nada — se va a
            // disparar por el listener global de abajo
        } else if (!_firstLoadDispatched) {
            // primera ejecución después de DOM listo: corre solo este nuevo
            try { fn(); }
            catch (e) { console.error('[crmReady] callback error:', e); }
        }
        // si _firstLoadDispatched ya pasó, no ejecutamos individualmente;
        // el próximo turbo:load (o el actual si Turbo no está activo) lo
        // ejecutará junto con los demás.
    };

    // Primer DOMContentLoaded: dispara todos los callbacks ya registrados
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            _firstLoadDispatched = true;
            _runCallbacks();
        });
    } else {
        _firstLoadDispatched = true;
        // Los callbacks ya registrados antes de que esto se evalúe ya se
        // ejecutaron individualmente. Los que se registren más tarde
        // también se ejecutarán al momento de agregarse.
    }

    // ── Eventos de Turbo (solo si Turbo está cargado) ────────────────────
    if (window.Turbo) {

        // Antes de cachear la página actual (cuando el usuario navega a
        // otra), limpiamos cosas que no deben aparecer al regresar:
        //  - Widgets/modales abiertos: el usuario espera empezar limpio.
        //  - Toasts visibles: ya cumplieron su propósito.
        //  - Spotlight: que vuelva a abrirse fresh.
        document.addEventListener('turbo:before-cache', function () {
            try {
                // Cierra cualquier widget activo (clase .widget-overlay.active)
                document.querySelectorAll('.widget-overlay.active').forEach(function (ov) {
                    ov.classList.remove('active');
                    ov.classList.remove('closing');
                });
                // Cierra spotlight si está abierto
                var sp = document.getElementById('spotlight-modal');
                if (sp) sp.classList.remove('active');
                var ay = document.getElementById('ayuda-modal');
                if (ay) ay.classList.remove('active');
                // Limpia toasts visibles
                document.querySelectorAll('.crm-toast, .widget-toast.show').forEach(function (t) {
                    t.classList.remove('show');
                });
            } catch (e) {
                console.error('[turbo_bootstrap] error en before-cache:', e);
            }
        });

        // En cada turbo:load (incluye la primera carga real), re-corremos
        // los callbacks. Esto hace que cualquier código que use crmReady()
        // se vuelva a inicializar al navegar entre páginas.
        document.addEventListener('turbo:load', function () {
            _firstLoadDispatched = true;
            _runCallbacks();
        });

        // Diagnóstico: si una request de Turbo falla, lo logueamos para
        // que se vea en la consola en vez de fallar en silencio.
        document.addEventListener('turbo:fetch-request-error', function (event) {
            console.error('[turbo_bootstrap] fetch error:', event.detail);
        });
    }

})();
