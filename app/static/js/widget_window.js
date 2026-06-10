/* ═══════════════════════════════════════════════════════════════════
   Widget Window Manager — Sistema de ventanas para widgets (Fase piloto)

   Convierte widgets-overlay (modales fullscreen) en ventanas flotantes
   estilo escritorio, SIN tocar el código legacy que los abre/cierra:

     · Resize desde las 4 esquinas (agarrar esquina de un widget
       maximizado lo convierte en ventana y lo encoge desde ahí).
     · Drag para mover desde la franja superior de la card (64px).
     · Botones inyectados junto a la X: minimizar (—) y
       ventana/maximizar (□).
     · Minimizados van a un dock inferior; click en el chip restaura.
     · Máximo 4 ventanas visibles a la vez (toast al exceder).
     · Clases de tamaño ww-md / ww-sm / ww-xs en la card según su ancho
       real (ResizeObserver) → widget_window.css adapta el layout
       interno (responsive por contenedor, no por viewport).

   Integración con el resto del Hardening:
     · widget_stack.js sigue manejando z-index: las ventanas siguen
       siendo .widget-overlay visibles; click en una ventana la trae
       al frente re-push-eándola en el stack.
     · Cerrar un widget en modo ventana lo regresa a modal para la
       próxima apertura (estado ventana NO persiste entre aperturas).

   Piloto (2026-06-09): solo widgets de la sección Oportunidad del CRM
   (ver WINDOWABLE_IDS). Para expandir: agregar el id a la lista o
   poner data-windowable="1" en el .widget-overlay del template.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    /* ── Modo embebido (dentro de una ventana-iframe) ─────────────────
       Las ventanas secundarias de oportunidad son iframes que cargan el
       CRM completo con ?ww=1&open_opp=<id> — así crm_main.js corre en un
       documento propio con su propio estado y la edición funciona igual
       que en la ventana principal. Dentro del iframe este módulo NO
       inicializa ventanas; solo:
         · marca el body (CSS oculta el CRM de fondo, deja los widgets)
         · avisa al padre cuando el widget raíz se cierra (X/Esc)
         · puentea el data bus al padre (refresh de kanban/listas)      */
    var IS_EMBED = (function () {
        try { return window.top !== window && /[?&]ww=1(&|$)/.test(window.location.search); }
        catch (e) { return true; }  // top inaccesible = seguro estamos embebidos
    })();

    if (IS_EMBED) {
        window.crmReady(function () {
            if (document.body.classList.contains('ww-embed')) return;
            document.body.classList.add('ww-embed');

            var overlay = document.getElementById('widgetDetalle');
            if (overlay) {
                var seen = false;
                new MutationObserver(function () {
                    var cs = window.getComputedStyle(overlay);
                    var vis = cs.display !== 'none' && cs.visibility !== 'hidden';
                    if (vis) { seen = true; return; }
                    if (seen) {
                        try { window.parent.postMessage({ type: 'ww:close-opp' }, window.location.origin); } catch (e) { }
                    }
                }).observe(overlay, { attributes: true, attributeFilter: ['style', 'class'] });
            }

            document.addEventListener('crm:data-changed', function (e) {
                if (!e.detail) return;
                try {
                    window.parent.postMessage({
                        type: 'ww:data-changed',
                        detail: { entidad: e.detail.entidad, accion: e.detail.accion, id: e.detail.id, extra: e.detail.extra },
                    }, window.location.origin);
                } catch (err) { }
            });
        });
        return;  // nada más del módulo aplica dentro del iframe
    }

    var MAX_WINDOWS = 4;
    var MIN_W = 380;
    var MIN_H = 260;
    var SNAP = 14;          // px de tolerancia para "imantar" a los bordes
    var EDGE_MARGIN = 8;    // margen al imantar
    var DRAG_STRIP = 64;    // franja superior de la card que actúa como barra de título

    // Piloto: widgets de la sección Oportunidad. Expandir aquí o con
    // data-windowable="1" en el template.
    var WINDOWABLE_IDS = [
        'widgetDetalle',              // detalle de oportunidad
        'widgetCotizador',            // cotizaciones de la oportunidad (iframe)
        'widgetClienteOportunidades', // oportunidades del cliente
    ];

    // Breakpoints por ancho de CARD (no viewport). Acumulativos.
    var SIZE_CLASSES = [
        [1100, 'ww-md'],
        [820, 'ww-sm'],
        [560, 'ww-xs'],
    ];

    var states = new WeakMap();  // overlay -> { windowed, minimized, rect }

    function st(overlay) {
        var s = states.get(overlay);
        if (!s) {
            s = { windowed: false, minimized: false, rect: null };
            states.set(overlay, s);
        }
        return s;
    }

    function getCard(overlay) {
        return overlay.querySelector('.ww-card') ||
               overlay.querySelector('.widget-card') ||
               overlay.firstElementChild;
    }

    function isVisible(overlay) {
        var cs = window.getComputedStyle(overlay);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    function notify(msg) {
        if (typeof window.toast === 'function') window.toast(msg, 'warning');
        else console.warn('[widgetWindow]', msg);
    }

    function widgetTitle(overlay) {
        var t = overlay.getAttribute('data-widget-title');
        if (t) return t.trim();
        var h = overlay.querySelector('h1, h2, h3');
        if (h && h.textContent.trim()) return h.textContent.trim().substring(0, 40);
        return (overlay.id || 'Widget').replace(/^widget/i, '').replace(/([A-Z])/g, ' $1').trim();
    }

    function countWindows() {
        var n = 0;
        document.querySelectorAll('.widget-overlay.ww-windowed').forEach(function (el) {
            if (isVisible(el)) n++;
        });
        return n;
    }

    /* ── Geometría ────────────────────────────────────────────────── */

    function clampRect(r) {
        var vw = window.innerWidth, vh = window.innerHeight;
        r.w = Math.max(MIN_W, Math.min(r.w, vw));
        r.h = Math.max(MIN_H, Math.min(r.h, vh));
        // Dejar siempre al menos 120px de la ventana dentro del viewport
        // y nunca la barra de título por arriba del borde superior.
        r.x = Math.max(-(r.w - 120), Math.min(r.x, vw - 120));
        r.y = Math.max(0, Math.min(r.y, vh - 60));
        return r;
    }

    function applyRect(overlay, r) {
        clampRect(r);
        overlay.style.setProperty('--ww-x', r.x + 'px');
        overlay.style.setProperty('--ww-y', r.y + 'px');
        overlay.style.setProperty('--ww-w', r.w + 'px');
        overlay.style.setProperty('--ww-h', r.h + 'px');
        st(overlay).rect = r;
    }

    function snapToEdges(r) {
        var vw = window.innerWidth, vh = window.innerHeight;
        if (r.x < SNAP) r.x = EDGE_MARGIN;
        if (r.y < SNAP) r.y = EDGE_MARGIN;
        if (vw - (r.x + r.w) < SNAP) r.x = vw - r.w - EDGE_MARGIN;
        if (vh - (r.y + r.h) < SNAP) r.y = vh - r.h - EDGE_MARGIN;
        return r;
    }

    function defaultRect() {
        var vw = window.innerWidth, vh = window.innerHeight;
        var w = Math.min(Math.round(vw * 0.72), 1180);
        var h = Math.round(vh * 0.78);
        return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w: w, h: h };
    }

    /* ── Modo ventana ─────────────────────────────────────────────── */

    function windowize(overlay, rect) {
        if (overlay.classList.contains('ww-windowed')) return true;
        if (countWindows() >= MAX_WINDOWS) {
            notify('Máximo ' + MAX_WINDOWS + ' ventanas abiertas a la vez');
            return false;
        }
        var card = getCard(overlay);
        if (!card) return false;
        var r = rect;
        if (!r) {
            var b = card.getBoundingClientRect();
            r = { x: b.left, y: b.top, w: b.width, h: b.height };
        }
        overlay.classList.add('ww-windowed');
        applyRect(overlay, r);
        st(overlay).windowed = true;
        updateWinBtn(overlay);
        bringToFront(overlay);
        return true;
    }

    function unwindowize(overlay) {
        overlay.classList.remove('ww-windowed');
        ['--ww-x', '--ww-y', '--ww-w', '--ww-h'].forEach(function (p) {
            overlay.style.removeProperty(p);
        });
        var s = st(overlay);
        s.windowed = false;
        s.rect = null;
        updateWinBtn(overlay);
    }

    function bringToFront(overlay) {
        var ws = window.crmWidgetStack;
        if (!ws) return;
        var top = ws.get();
        if (top.length && top[top.length - 1] === overlay) return;  // ya está al frente
        ws.remove(overlay);
        ws.push(overlay);
    }

    /* ── Minimizar / dock ─────────────────────────────────────────── */

    function ensureDock() {
        var dock = document.getElementById('wwDock');
        if (dock) return dock;
        dock = document.createElement('div');
        dock.id = 'wwDock';
        document.body.appendChild(dock);
        return dock;
    }

    function minimize(overlay) {
        var s = st(overlay);
        if (s.minimized) return;
        s.minimized = true;

        var dock = ensureDock();
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ww-dock-chip';
        chip.innerHTML =
            '<span class="ww-dock-title"></span>' +
            '<span class="ww-dock-close" title="Cerrar">&times;</span>';
        chip.querySelector('.ww-dock-title').textContent = widgetTitle(overlay);
        chip.addEventListener('click', function (ev) {
            if (ev.target.closest('.ww-dock-close')) {
                // Cerrar de verdad: desminimizar y simular click en la X para
                // que corran los handlers propios del widget.
                removeChip(overlay);
                s.minimized = false;
                overlay.classList.remove('ww-minimized');
                var btn = overlay.querySelector(CLOSE_SEL);
                if (btn) btn.click();
                else overlay.style.display = 'none';
                return;
            }
            restoreFromDock(overlay);
        });
        chip._wwOverlay = overlay;
        overlay._wwChip = chip;
        dock.appendChild(chip);

        // Ocultar SOLO con clase propia (display:none !important en CSS).
        // NUNCA tocar style.display inline: widgets como widgetDetalle se
        // abren/cierran con classList 'active' y un display inline pegado
        // le ganaría al CSS dejando el widget imposible de cerrar con la X.
        overlay.classList.add('ww-minimized');
    }

    function removeChip(overlay) {
        if (overlay._wwChip) {
            overlay._wwChip.remove();
            overlay._wwChip = null;
        }
        var dock = document.getElementById('wwDock');
        if (dock && !dock.children.length) dock.remove();
    }

    function restoreFromDock(overlay) {
        var s = st(overlay);
        if (s.windowed && countWindows() >= MAX_WINDOWS) {
            notify('Máximo ' + MAX_WINDOWS + ' ventanas abiertas a la vez');
            return;
        }
        s.minimized = false;
        removeChip(overlay);
        overlay.classList.remove('ww-minimized');
        bringToFront(overlay);
    }

    /* ── Controles inyectados (— y □) ─────────────────────────────── */

    function injectControls(overlay) {
        var card = getCard(overlay);
        var closeBtn = card && card.querySelector(CLOSE_SEL);
        if (!closeBtn || card.querySelector('.ww-btn')) return;

        var btnMin = document.createElement('button');
        btnMin.type = 'button';
        btnMin.className = 'ww-btn ww-btn-min';
        btnMin.title = 'Minimizar';
        btnMin.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><line x1="1.5" y1="6" x2="10.5" y2="6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
        btnMin.addEventListener('click', function (ev) {
            ev.stopPropagation();
            minimize(overlay);
        });

        var btnWin = document.createElement('button');
        btnWin.type = 'button';
        btnWin.className = 'ww-btn ww-btn-win';
        btnWin.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (overlay.classList.contains('ww-windowed')) {
                unwindowize(overlay);
            } else {
                windowize(overlay, st(overlay).rect || defaultRect());
            }
        });

        // Agrupar [— □ ×] en un contenedor para no alterar el layout del
        // header (varios usan justify-content:space-between). Mover la X
        // al wrapper conserva sus listeners e id.
        var wrap = document.createElement('div');
        wrap.className = 'ww-ctrls';
        closeBtn.parentNode.insertBefore(wrap, closeBtn);
        wrap.appendChild(btnMin);
        wrap.appendChild(btnWin);
        wrap.appendChild(closeBtn);
        overlay._wwBtnWin = btnWin;
        updateWinBtn(overlay);
    }

    function updateWinBtn(overlay) {
        var btn = overlay._wwBtnWin;
        if (!btn) return;
        var windowed = overlay.classList.contains('ww-windowed');
        btn.title = windowed ? 'Maximizar' : 'Modo ventana';
        btn.innerHTML = windowed
            // Maximizar: cuadro grande
            ? '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
            // Modo ventana: cuadro chico desplazado
            : '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2.5 8.5 v-5 a1.5 1.5 0 0 1 1.5-1.5 h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    }

    /* ── Drag + resize ────────────────────────────────────────────── */

    var dragState = null;  // { overlay, mode:'move'|dir, startX, startY, startRect }
    var shield = null;     // capa que evita que iframes/selecciones se coman el pointermove

    function addShield(cursor) {
        if (shield) return;
        shield = document.createElement('div');
        shield.className = 'ww-drag-shield';
        shield.style.cursor = cursor || 'default';
        document.body.appendChild(shield);
        document.body.classList.add('ww-dragging');
    }

    function removeShield() {
        if (shield) { shield.remove(); shield = null; }
        document.body.classList.remove('ww-dragging');
    }

    function startInteraction(overlay, mode, ev, cursor) {
        var s = st(overlay);
        dragState = {
            overlay: overlay,
            mode: mode,
            startX: ev.clientX,
            startY: ev.clientY,
            startRect: {
                x: s.rect.x, y: s.rect.y, w: s.rect.w, h: s.rect.h,
            },
        };
        addShield(cursor);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp, { once: true });
        ev.preventDefault();
    }

    function onPointerMove(ev) {
        if (!dragState) return;
        var dx = ev.clientX - dragState.startX;
        var dy = ev.clientY - dragState.startY;
        var s0 = dragState.startRect;
        var r = { x: s0.x, y: s0.y, w: s0.w, h: s0.h };

        if (dragState.mode === 'move') {
            r.x = s0.x + dx;
            r.y = s0.y + dy;
        } else {
            // Resize por esquina: 'nw' | 'ne' | 'sw' | 'se'
            var dir = dragState.mode;
            if (dir.indexOf('e') !== -1) r.w = s0.w + dx;
            if (dir.indexOf('s') !== -1) r.h = s0.h + dy;
            if (dir.indexOf('w') !== -1) { r.w = s0.w - dx; r.x = s0.x + dx; }
            if (dir.indexOf('n') !== -1) { r.h = s0.h - dy; r.y = s0.y + dy; }
            // No dejar que el lado opuesto se mueva al llegar al mínimo.
            if (r.w < MIN_W) {
                if (dir.indexOf('w') !== -1) r.x = s0.x + (s0.w - MIN_W);
                r.w = MIN_W;
            }
            if (r.h < MIN_H) {
                if (dir.indexOf('n') !== -1) r.y = s0.y + (s0.h - MIN_H);
                r.h = MIN_H;
            }
        }
        applyRect(dragState.overlay, r);
    }

    function onPointerUp() {
        window.removeEventListener('pointermove', onPointerMove);
        if (dragState) {
            var s = st(dragState.overlay);
            if (dragState.mode === 'move' && s.rect) {
                applyRect(dragState.overlay, snapToEdges(s.rect));
            }
        }
        dragState = null;
        removeShield();
    }

    var HANDLE_CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };

    function injectHandles(overlay) {
        var card = getCard(overlay);
        if (!card || card.querySelector('.ww-handle')) return;
        ['nw', 'ne', 'sw', 'se'].forEach(function (dir) {
            var h = document.createElement('div');
            h.className = 'ww-handle ww-handle-' + dir;
            h.setAttribute('data-ww-dir', dir);
            card.appendChild(h);
        });
    }

    var INTERACTIVE = 'button, a, input, select, textarea, label, [contenteditable], [onclick]';
    var CLOSE_SEL = '.widget-close, .wco-close, [data-widget-close]';

    function onPointerDown(ev) {
        if (ev.button !== 0) return;
        var card = ev.target.closest('.ww-card');
        if (!card) return;
        var overlay = card.closest('.widget-overlay');
        if (!overlay) return;

        if (overlay.classList.contains('ww-windowed')) bringToFront(overlay);

        // 1) Esquinas → resize (windowiza primero si está maximizado)
        var handle = ev.target.closest('.ww-handle');
        if (handle) {
            if (!overlay.classList.contains('ww-windowed') && !windowize(overlay)) return;
            startInteraction(overlay, handle.getAttribute('data-ww-dir'), ev,
                HANDLE_CURSORS[handle.getAttribute('data-ww-dir')]);
            return;
        }

        // 2) Franja superior → mover (solo en modo ventana)
        if (!overlay.classList.contains('ww-windowed')) return;
        if (ev.target.closest(INTERACTIVE)) return;
        var top = card.getBoundingClientRect().top;
        if (ev.clientY - top > DRAG_STRIP) return;
        startInteraction(overlay, 'move', ev, 'grabbing');
    }

    // Doble click en la barra de título: alternar ventana/maximizado.
    function onDblClick(ev) {
        var card = ev.target.closest('.ww-card');
        if (!card) return;
        var overlay = card.closest('.widget-overlay');
        if (!overlay || !overlay.classList.contains('ww-windowed')) return;
        if (overlay.classList.contains('ww-iframe')) return;  // las ventanas-iframe no se maximizan
        if (ev.target.closest(INTERACTIVE)) return;
        if (ev.clientY - card.getBoundingClientRect().top > DRAG_STRIP) return;
        unwindowize(overlay);
    }

    /* ── Clases de tamaño (responsive por contenedor) ─────────────── */

    function watchSize(overlay) {
        var card = getCard(overlay);
        if (!card || !('ResizeObserver' in window)) return;
        var ro = new ResizeObserver(function (entries) {
            var w = entries[0].contentRect.width;
            if (!w) return;  // oculto
            SIZE_CLASSES.forEach(function (sc) {
                card.classList.toggle(sc[1], w < sc[0]);
            });
        });
        ro.observe(card);
    }

    /* ── Sincronía con aperturas/cierres externos ─────────────────── */

    function watchVisibility(overlay) {
        var obs = new MutationObserver(function () {
            var s = st(overlay);
            var visible = isVisible(overlay);
            if (visible && s.minimized) {
                // Alguien lo reabrió desde fuera: ya no está minimizado.
                s.minimized = false;
                removeChip(overlay);
            } else if (!visible && !s.minimized && s.windowed) {
                // Cerrado en modo ventana → la próxima apertura regresa como modal.
                unwindowize(overlay);
            }
        });
        obs.observe(overlay, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    /* ── Multi-oportunidad: ventanas-iframe (edición completa) ────────
       El widget de Oportunidad es un singleton (#widgetDetalle, ids
       únicos que el legacy llena por getElementById), así que no puede
       haber dos instancias vivas EN EL MISMO DOCUMENTO. Solución: cuando
       está en modo ventana y se abre OTRA oportunidad, la actual se muda
       a una ventana-iframe que carga el CRM con ?ww=1&open_opp=<id> —
       documento independiente = estado independiente = edición real en
       cada ventana. Los cambios hechos dentro se puentean al data bus
       del padre vía postMessage (ver IS_EMBED arriba). */

    var lastOppId = null;
    var winSeq = 0;

    // NO se puede envolver window.openDetalle: los callers internos de
    // crm_main.js (kanban, lista — el camino más común) llaman a la
    // función LOCAL por closure y brincarían el wrapper. En cambio,
    // TODAS las aperturas disparan el fetch al endpoint de detalle, y en
    // ese momento el DOM todavía muestra la oportunidad anterior (el
    // render espera la respuesta) — el punto perfecto para mudar la
    // oportunidad anterior a su propia ventana.
    function wrapDetalleFetch() {
        if (window._wwFetchWrapped) return;
        window._wwFetchWrapped = true;
        var origFetch = window.fetch;
        window.fetch = function (input) {
            try {
                var url = typeof input === 'string' ? input : (input && input.url) || '';
                var m = url.match(/oportunidad-detalle-crm\/(\d+)/);
                if (m) {
                    var newId = parseInt(m[1], 10);
                    maybeSpawnWindow(newId);
                    lastOppId = newId;
                    // Si el widget vivo estaba minimizado, regresarlo del dock.
                    var overlay = document.getElementById('widgetDetalle');
                    if (overlay && st(overlay).minimized) restoreFromDock(overlay);
                }
            } catch (e) { console.error('[widgetWindow] detalle-fetch hook:', e); }
            return origFetch.apply(this, arguments);
        };
    }

    function readStoredOppId() {
        // openDetalle (crm_main.js:799) guarda el id en sessionStorage en
        // CADA apertura. Sirve para inicializar lastOppId tras un reload
        // con ?open_opp= en la URL (el valor sobrevive del page load
        // anterior porque el widget seguía abierto al recargar).
        try {
            return parseInt(sessionStorage.getItem('_crm_open_opp_id'), 10) || null;
        } catch (e) { return null; }
    }

    function maybeSpawnWindow(newId) {
        // Con el widget v2 instanciable activo, el multi-ventana es nativo
        // (cada oportunidad es su propia instancia) — los iframes ya no aplican.
        if (window.OppWidgetV2 && window.OppWidgetV2.takeover) return;
        var overlay = document.getElementById('widgetDetalle');
        if (!overlay || !newId) return;
        var liveId = lastOppId || readStoredOppId();
        if (!liveId || newId === liveId) return;
        var s = st(overlay);
        // Minimizado: la oportunidad sigue "abierta" en el dock — debe
        // sobrevivir como ventana minimizada, no ser reemplazada en silencio.
        if (!s.minimized) {
            if (!overlay.classList.contains('ww-windowed')) return;  // modal → reemplaza, como siempre
            if (!isVisible(overlay)) return;
        }
        if (countWindows() >= MAX_WINDOWS) {
            notify('Máximo ' + MAX_WINDOWS + ' ventanas: la oportunidad abierta se reemplazará');
            return;
        }
        var rect = s.rect || defaultRect();
        var titleEl = overlay.querySelector('#woTitle');
        var title = (titleEl && titleEl.textContent.trim()) || ('Oportunidad ' + liveId);
        var win = createOppWindow(liveId, title, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
        if (s.minimized) minimize(win);  // hereda el lugar en el dock
        // La ventana viva se corre en cascada para no tapar a la nueva.
        if (overlay.classList.contains('ww-windowed')) {
            applyRect(overlay, snapToEdges({ x: rect.x + 36, y: rect.y + 36, w: rect.w, h: rect.h }));
        }
    }

    var ICON_MIN = '<svg width="12" height="12" viewBox="0 0 12 12"><line x1="1.5" y1="6" x2="10.5" y2="6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

    function createOppWindow(oppId, title, rect) {
        var ov = document.createElement('div');
        ov.className = 'widget-overlay ww-iframe';
        ov.id = 'wwOpp' + (++winSeq);
        ov.setAttribute('data-widget-title', title);
        ov.setAttribute('data-ww-enhanced', '1');  // no pasar por enhance()
        ov.innerHTML =
            '<div class="ww-card ww-iframe-card">' +
                '<div class="ww-titlebar">' +
                    '<span class="ww-titlebar-text"></span>' +
                    '<div class="ww-ctrls">' +
                        '<button type="button" class="ww-btn ww-ifr-min" title="Minimizar">' + ICON_MIN + '</button>' +
                        '<button type="button" class="ww-btn ww-ifr-close" data-widget-close title="Cerrar">&times;</button>' +
                    '</div>' +
                '</div>' +
                '<iframe class="ww-opp-frame" src="/app/home/?tab=crm&ww=1&open_opp=' + encodeURIComponent(oppId) + '"></iframe>' +
            '</div>';
        ov.querySelector('.ww-titlebar-text').textContent = title;
        ov.querySelector('.ww-ifr-min').addEventListener('click', function (ev) {
            ev.stopPropagation();
            minimize(ov);
        });
        ov.querySelector('.ww-ifr-close').addEventListener('click', function (ev) {
            ev.stopPropagation();
            destroyOppWindow(ov);
        });

        document.body.appendChild(ov);
        ov.style.display = 'flex';  // visible: widget_stack lo registra solo
        ov.classList.add('ww-windowed');
        st(ov).windowed = true;
        applyRect(ov, rect);
        injectHandles(ov);
        return ov;
    }

    function destroyOppWindow(ov) {
        removeChip(ov);
        if (window.crmWidgetStack) window.crmWidgetStack.remove(ov);
        ov.remove();
    }

    // Mensajes desde los iframes: cierre del widget raíz y data bus.
    function onFrameMessage(ev) {
        if (ev.origin !== window.location.origin) return;
        var d = ev.data || {};
        if (d.type === 'ww:close-opp') {
            var frames = document.querySelectorAll('.ww-opp-frame');
            for (var i = 0; i < frames.length; i++) {
                if (frames[i].contentWindow === ev.source) {
                    destroyOppWindow(frames[i].closest('.widget-overlay'));
                    return;
                }
            }
        } else if (d.type === 'ww:data-changed' && d.detail && window.crmDataBus) {
            window.crmDataBus.emit(d.detail.entidad, d.detail.accion, d.detail.id, d.detail.extra);
        }
    }

    /* ── Bootstrap ────────────────────────────────────────────────── */

    function enhance(overlay) {
        if (overlay.hasAttribute('data-ww-enhanced')) return;
        overlay.setAttribute('data-ww-enhanced', '1');
        var card = getCard(overlay);
        if (!card) return;
        card.classList.add('ww-card');
        injectHandles(overlay);
        injectControls(overlay);
        watchSize(overlay);
        watchVisibility(overlay);
    }

    function scan() {
        WINDOWABLE_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el && el.classList.contains('widget-overlay')) enhance(el);
        });
        document.querySelectorAll('.widget-overlay[data-windowable]').forEach(enhance);
        if (lastOppId === null) lastOppId = readStoredOppId();
    }

    if (!window._widgetWindowWired) {
        window._widgetWindowWired = true;
        wrapDetalleFetch();
        window.addEventListener('message', onFrameMessage);
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('dblclick', onDblClick, true);
        // Click DENTRO de una ventana-iframe: no burbujea al padre, pero el
        // focus sí se mueve — al perder el foco la ventana del padre, si lo
        // ganó un iframe de oportunidad, traerlo al frente.
        window.addEventListener('blur', function () {
            setTimeout(function () {
                var ae = document.activeElement;
                if (ae && ae.classList && ae.classList.contains('ww-opp-frame')) {
                    var ov = ae.closest('.widget-overlay');
                    if (ov) bringToFront(ov);
                }
            }, 0);
        });
        // Reajustar ventanas al cambiar el tamaño del viewport.
        window.addEventListener('resize', function () {
            document.querySelectorAll('.widget-overlay.ww-windowed').forEach(function (el) {
                var s = st(el);
                if (s.rect) applyRect(el, s.rect);
            });
        });
    }
    window.crmReady(scan);

    // API pública mínima (debug + futuros módulos).
    window.crmWidgetWindow = {
        windowize: windowize,
        unwindowize: unwindowize,
        minimize: minimize,
        enhance: enhance,
    };
})();
