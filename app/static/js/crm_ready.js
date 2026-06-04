/* ═══════════════════════════════════════════════════════════════════════
 * crm_ready.js — Helper window.crmReady() compatible con Turbo Drive.
 *
 * Sustituye a `document.addEventListener('DOMContentLoaded', fn)` en todo
 * el proyecto. Funciona igual SIN Turbo (se dispara una sola vez al cargar
 * la página) y con Turbo (se re-dispara en cada `turbo:load`, permitiendo
 * que las inicializaciones se ejecuten también en navegaciones SPA).
 *
 * Uso:
 *   window.crmReady(function () {
 *       // tu código de inicialización aquí
 *   });
 *
 * Importante: la función pasada puede ejecutarse MÁS DE UNA VEZ si Turbo
 * está activo. Hacer el callback IDEMPOTENTE:
 *   - Listeners a elementos del body: pueden re-wirearse porque los
 *     elementos son nuevos en cada navegación Turbo.
 *   - Listeners a `document` o `window`: SE DUPLICAN si se ejecutan
 *     varias veces. Usar guard:
 *       if (window._miFeatureWired) return;
 *       window._miFeatureWired = true;
 *       document.addEventListener('click', ...);
 *
 * Este archivo SE CARGA SIEMPRE (con o sin Turbo). Si Turbo no está
 * cargado en la página, crmReady() solo dispara en DOMContentLoaded.
 *
 * Convención de carga: este script DEBE cargarse antes que cualquier
 * otro script que use crmReady() (es decir, antes de crm_main.js y los
 * demás módulos).
 * ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    if (window.crmReady) {
        // Ya está definido (este archivo se cargó dos veces) → no redefinir.
        return;
    }

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

        // Si DOM ya está listo Y ya disparamos los callbacks una vez,
        // ejecutar este nuevo individualmente. Si el DOM aún no carga,
        // el listener global de DOMContentLoaded (abajo) los disparará
        // todos juntos.
        if (document.readyState !== 'loading' && !_firstLoadDispatched) {
            try { fn(); }
            catch (e) { console.error('[crmReady] callback error:', e); }
        }
        // Si _firstLoadDispatched ya pasó, NO ejecutamos individualmente.
        // El próximo turbo:load (si Turbo está activo) ejecutará TODOS
        // los callbacks vía _runCallbacks. Sin Turbo, solo se dispara una
        // vez (en DOMContentLoaded) y los registros posteriores se
        // ejecutan inmediatamente al llegar acá.
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            _firstLoadDispatched = true;
            _runCallbacks();
        });
    } else {
        // DOM ya está listo. Marcamos flag para que los próximos registros
        // se ejecuten directamente en su crmReady() (lógica del wrapper).
        _firstLoadDispatched = true;
    }

    // Si Turbo Drive está cargado, re-disparar callbacks en cada navegación
    // SPA. Este listener es no-op cuando Turbo no existe.
    document.addEventListener('turbo:load', function () {
        _firstLoadDispatched = true;
        _runCallbacks();
    });

})();
