/* ═══════════════════════════════════════════════════════════════════
   Widget Stack Manager — Hardening Fase 1.A (continuación)

   Patrón estándar (Material UI, Ant Design, Radix): el z-index de cada
   widget se asigna DINÁMICAMENTE al momento de abrirlo, según cuántos
   widgets ya estén abiertos. Esto resuelve el caso donde un widget
   "Nivel 1" se abre DESDE otro widget — por ejemplo:

     1. Usuario abre Calendario (stack=[cal] → cal z-index 1000)
     2. Desde calendario abre Actividad (stack=[cal,act] → act 2000)
     3. Desde actividad abre Oportunidad (stack=[cal,act,opp] → opp 3000)
     4. Desde opp abre Tarea (stack=[cal,act,opp,t] → t 4000)
     5. Al cerrar Tarea, sale del stack; los demás no se mueven.

   El observer vigila TODOS los .widget-overlay y detecta cambios de
   display/class sin necesidad de tocar el código que los abre.

   El CSS sigue siendo útil como fallback: si el JS no carga, los tokens
   estáticos (--z-widget, --z-widget-sub, --z-widget-3) cubren los casos
   conocidos.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    var BASE_Z = 1000;
    var STEP = 1000;
    // Tope: 8 widgets anidados llegan a 8000, dejando 9000 para el toast.
    var MAX_STACK = 8;

    var stack = [];           // array de elementos .widget-overlay visibles
    var observers = new WeakMap();

    function isOverlayVisible(el) {
        if (!el || !el.classList || !el.classList.contains('widget-overlay')) return false;
        // Tres formas de "visible" que usa el código del CRM:
        //   1. style.display = 'flex' o '' o no 'none'
        //   2. classList contiene 'active' (varios usan esto)
        // Como `display:none` puede venir del CSS sin estar en style inline,
        // usamos getComputedStyle.
        var cs = window.getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    function applyZIndexes() {
        stack.forEach(function (el, idx) {
            var z = BASE_Z + idx * STEP;
            // setProperty con prioridad para ganarle a los style inline.
            try {
                el.style.setProperty('z-index', String(z), 'important');
            } catch (e) { /* noop */ }
        });
    }

    function pushIfNeeded(el) {
        if (stack.indexOf(el) !== -1) return false;  // ya en el stack
        if (stack.length >= MAX_STACK) {
            // Tope alcanzado — el último se queda en el tope pero se loguea.
            console.warn('[widgetStack] tope de anidamiento alcanzado:', el.id);
        }
        stack.push(el);
        applyZIndexes();
        return true;
    }

    function removeFromStack(el) {
        var idx = stack.indexOf(el);
        if (idx === -1) return false;
        stack.splice(idx, 1);
        applyZIndexes();
        // Limpiar el style inline ahora que no está en el stack para que
        // si se reabre, el observer le aplique uno nuevo desde 0.
        try {
            el.style.removeProperty('z-index');
        } catch (e) { /* noop */ }
        return true;
    }

    function syncOverlay(el) {
        if (isOverlayVisible(el)) {
            pushIfNeeded(el);
        } else {
            removeFromStack(el);
        }
    }

    function attachObserver(el) {
        if (observers.has(el)) return;  // ya tiene observer
        var obs = new MutationObserver(function () { syncOverlay(el); });
        obs.observe(el, {
            attributes: true,
            attributeFilter: ['style', 'class'],
        });
        observers.set(el, obs);
        // Sincronización inicial: si ya está visible al cargar la página.
        syncOverlay(el);
    }

    function scanAll() {
        document.querySelectorAll('.widget-overlay').forEach(attachObserver);
    }

    // ── API pública opcional ──
    // Permite que código externo consulte el stack o lo manipule (raro).
    window.crmWidgetStack = {
        get: function () { return stack.slice(); },
        topId: function () {
            var t = stack[stack.length - 1];
            return t ? t.id : null;
        },
        // Para debug en consola.
        dump: function () {
            console.log('=== Widget Stack ===');
            stack.forEach(function (el, idx) {
                console.log(idx, el.id, 'z-index:', BASE_Z + idx * STEP);
            });
        },
        // Mecanismo de respaldo manual por si MutationObserver no detecta
        // (ej. widget agregado al DOM después de page load).
        push: pushIfNeeded,
        remove: removeFromStack,
    };

    // ── Bootstrap ──
    // Observa también los widgets que se inserten DESPUÉS de DOM ready
    // (algunos se agregan dinámicamente con appendChild).
    var rootObs = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            m.addedNodes.forEach(function (n) {
                if (n.nodeType !== 1) return;
                if (n.classList && n.classList.contains('widget-overlay')) {
                    attachObserver(n);
                }
                // Buscar overlays dentro de subárboles agregados.
                if (n.querySelectorAll) {
                    n.querySelectorAll('.widget-overlay').forEach(attachObserver);
                }
            });
        });
    });

    function init() {
        scanAll();
        if (document.body) {
            rootObs.observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
