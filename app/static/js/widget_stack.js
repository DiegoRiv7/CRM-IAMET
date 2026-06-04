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

    // Callback que se dispara después de cada cambio del stack. El
    // breadcrumb (más abajo) lo sobreescribe para actualizar la UI.
    var _onStackChange = function () { /* no-op por default */ };

    function applyZIndexes() {
        stack.forEach(function (el, idx) {
            var z = BASE_Z + idx * STEP;
            // setProperty con prioridad para ganarle a los style inline.
            try {
                el.style.setProperty('z-index', String(z), 'important');
            } catch (e) { /* noop */ }
        });
        try { _onStackChange(); } catch (e) { /* noop */ }
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
        // Limpia el stack de referencias a widgets que ya no están en el
        // DOM (ej. body reemplazado por Turbo Drive). El observer rootObs
        // detecta inserciones pero NO sabe limpiar el stack — esta API se
        // llama desde turbo:before-cache para evitar que widgets viejos
        // queden "fantasma" en el stack y aparezcan en el breadcrumb.
        cleanup: function () {
            stack = stack.filter(function (el) { return document.body.contains(el); });
            applyZIndexes();
        },
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

    // Migrado a crmReady (Turbo-friendly).
    // Guard idempotente: el MutationObserver `rootObs` observa document.body
    // (que es el mismo nodo entre navegaciones Turbo). Sin guard, cada
    // turbo:load agregaría OTRO observer encima del existente → memory leak
    // progresivo + handlers de mutación disparándose N veces. Una sola vez
    // basta porque body persiste.
    if (!window._widgetStackInited) {
        window._widgetStackInited = true;
        window.crmReady(init);
    } else {
        // En turbo:load posteriores solo re-escanear nuevos overlays del body
        // reemplazado (rootObs YA los detecta vía mutación pero por si acaso).
        window.crmReady(scanAll);
    }

    // ── Escape consistente: cierra el widget de top del stack ──
    // Antes era errático — algunos widgets cerraban con Esc, otros no.
    // Ahora SIEMPRE cierra el más reciente abierto. Si hay 3 anidados,
    // 3 Esc cierran capa por capa hasta llegar al fondo.

    function isEditableFocus() {
        var a = document.activeElement;
        if (!a) return false;
        var tag = a.tagName;
        if (tag === 'INPUT') {
            // Inputs tipo checkbox/radio/button NO bloquean Esc.
            var t = (a.type || 'text').toLowerCase();
            if (t === 'checkbox' || t === 'radio' || t === 'button' || t === 'submit') return false;
            return true;
        }
        if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (a.isContentEditable) return true;
        return false;
    }

    function closeWidget(el) {
        if (!el) return false;
        // Estrategia 1 (preferida): simular click en el botón X del widget.
        // Eso ejecuta los handlers propios del widget (limpieza de formularios,
        // navegación, etc.). Buscamos botones con cierres comunes.
        var btn = el.querySelector(
            '.widget-close, [data-widget-close], ' +
            'button[onclick*="display=\'none\'"], ' +
            'button[onclick*="display=\\"none\\""], ' +
            'button[onclick*="classList.remove(\'active\'"], ' +
            'button[onclick*="closing"], ' +
            'button[aria-label="Cerrar"], button[title="Cerrar"], ' +
            'button[onclick*="Cerrar()"], button[onclick*="Close()"]'
        );
        if (btn) {
            btn.click();
            return true;
        }
        // Estrategia 2: si tiene .active, quitarla (la mayoría de los
        // overlays con clase combinada wn-overlay funcionan así).
        if (el.classList.contains('active')) {
            el.classList.add('closing');
            setTimeout(function () {
                el.classList.remove('active', 'closing');
            }, 220);
            return true;
        }
        // Estrategia 3: forzar display:none directamente.
        if (el.style.display && el.style.display !== 'none') {
            el.style.display = 'none';
            return true;
        }
        return false;
    }

    document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Escape') return;
        // Si el usuario está en un campo editable, dejar que el input
        // maneje Esc primero (algunos browsers limpian el input). El
        // siguiente Esc sí cerrará el widget.
        if (isEditableFocus()) return;
        if (!stack.length) return;
        var top = stack[stack.length - 1];
        if (closeWidget(top)) {
            ev.stopPropagation();
            ev.preventDefault();
        }
    }, true);  // capture: true para correr antes que listeners locales

    // ── Breadcrumb de widgets anidados ──
    // Cuando hay >= 2 widgets en el stack, muestra arriba un breadcrumb
    // tipo "Padre › Hijo" para que el usuario sepa en qué nivel está.
    // Click en cualquier parte del padre cierra el hijo (top del stack).

    function ensureBreadcrumb() {
        var bc = document.getElementById('crmWidgetBreadcrumb');
        if (bc) return bc;
        bc = document.createElement('div');
        bc.id = 'crmWidgetBreadcrumb';
        bc.setAttribute('aria-hidden', 'true');
        bc.style.cssText = [
            'position:fixed',
            'top:14px',
            'left:50%',
            'transform:translateX(-50%) translateY(-8px)',
            'z-index:9500',  // entre toast (9000) y nada (los widgets están en <=8000)
            'background:rgba(15,23,42,0.92)',
            'backdrop-filter:blur(8px)',
            '-webkit-backdrop-filter:blur(8px)',
            'color:#fff',
            'padding:8px 14px',
            'border-radius:999px',
            'font-size:12.5px',
            'font-weight:500',
            'font-family:-apple-system,"Segoe UI",Roboto,sans-serif',
            'letter-spacing:0.01em',
            'box-shadow:0 4px 16px rgba(0,0,0,0.25),0 0 0 1px rgba(255,255,255,0.08)',
            'opacity:0',
            'pointer-events:none',
            'transition:opacity 0.18s ease,transform 0.22s cubic-bezier(0.16,1,0.3,1)',
            'max-width:90vw',
            'white-space:nowrap',
            'overflow:hidden',
            'text-overflow:ellipsis',
            'display:flex',
            'align-items:center',
            'gap:6px',
        ].join(';');
        document.body.appendChild(bc);
        return bc;
    }

    function widgetTitle(el) {
        if (!el) return '';
        // 1) data-widget-title (opt-in para widgets que quieran control)
        var t = el.getAttribute('data-widget-title');
        if (t) return t.trim();
        // 2) primer h1/h2/h3 visible
        var h = el.querySelector('h1, h2, h3');
        if (h && h.textContent && h.textContent.trim()) {
            return h.textContent.trim().substring(0, 60);
        }
        // 3) ID humanizado como fallback
        var id = el.id || '';
        return id.replace(/^widget/i, '').replace(/([A-Z])/g, ' $1').trim() || 'Widget';
    }

    var lastBreadcrumbHTML = '';
    function updateBreadcrumb() {
        if (stack.length < 2) {
            var bc = document.getElementById('crmWidgetBreadcrumb');
            if (bc) {
                bc.style.opacity = '0';
                bc.style.transform = 'translateX(-50%) translateY(-8px)';
                bc.style.pointerEvents = 'none';
            }
            lastBreadcrumbHTML = '';
            return;
        }
        var bc = ensureBreadcrumb();
        // Construir trail. Truncamos a 3 niveles para no inundar.
        var visible = stack.slice(-3);
        var skipped = stack.length - visible.length;
        var html = '';
        if (skipped > 0) {
            html += '<span style="opacity:0.55;">…</span>';
            html += '<span style="opacity:0.45;margin:0 4px;">›</span>';
        }
        visible.forEach(function (el, idx) {
            var isLast = idx === visible.length - 1;
            var label = _escapeHtml(widgetTitle(el));
            if (isLast) {
                // Hijo actual — sin acción.
                html += '<span style="font-weight:600;">' + label + '</span>';
            } else {
                // Padre — click cierra todo lo que está encima de él.
                var deltaFromTop = visible.length - 1 - idx + skipped;
                html += '<span data-bc-target="' + (stack.length - 1 - (visible.length - 1 - idx)) + '" '
                      + 'style="cursor:pointer;opacity:0.85;text-decoration:none;border-bottom:1px dashed rgba(255,255,255,0.4);" '
                      + 'onmouseover="this.style.opacity=\'1\'" '
                      + 'onmouseout="this.style.opacity=\'0.85\'">' + label + '</span>';
                html += '<span style="opacity:0.45;margin:0 4px;">›</span>';
            }
        });
        if (html !== lastBreadcrumbHTML) {
            bc.innerHTML = html;
            lastBreadcrumbHTML = html;
        }
        bc.style.opacity = '1';
        bc.style.transform = 'translateX(-50%) translateY(0)';
        bc.style.pointerEvents = 'auto';
    }

    function _escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Click en un padre del breadcrumb: cerrar todos los widgets que están
    // encima de él en el stack.
    document.addEventListener('click', function (ev) {
        var target = ev.target.closest && ev.target.closest('[data-bc-target]');
        if (!target) return;
        ev.preventDefault();
        ev.stopPropagation();
        var keepIdx = parseInt(target.getAttribute('data-bc-target'), 10);
        if (isNaN(keepIdx)) return;
        // Cerrar desde el top hasta dejar solo hasta keepIdx (inclusive).
        // Como cerrar dispara el observer que saca del stack, iteramos
        // mientras stack.length > keepIdx + 1.
        var guard = 0;
        while (stack.length > keepIdx + 1 && guard++ < 10) {
            var top = stack[stack.length - 1];
            closeWidget(top);
        }
    });

    // Hookear el callback de cambio de stack para refrescar el breadcrumb.
    _onStackChange = updateBreadcrumb;
})();
