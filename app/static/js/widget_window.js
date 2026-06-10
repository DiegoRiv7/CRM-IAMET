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
        if (overlay.classList.contains('ww-snapshot')) return;  // las vistas no se maximizan
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

    /* ── Multi-oportunidad: ventanas-vista (snapshots) ────────────────
       El widget de Oportunidad es un singleton (#widgetDetalle, ids
       únicos que el legacy llena por getElementById), así que no puede
       haber dos instancias "vivas". En su lugar: si está en modo ventana
       y se abre OTRA oportunidad, la actual se congela como una ventana
       de solo lectura (clon del DOM sin ids). El botón ⤢ la "activa":
       intercambia su contenido con el del widget vivo. */

    var lastOppId = null;
    var snapSeq = 0;

    function wrapOpenDetalle() {
        if (window._wwOpenDetalleWrapped) return;
        if (typeof window.openDetalle !== 'function') return;
        var orig = window.openDetalle;
        window._wwOpenDetalleWrapped = true;
        window.openDetalle = function (oppId) {
            var clean = parseInt(String(oppId).replace(/[^\d]/g, ''), 10) || null;
            try { maybeSnapshot(clean); } catch (e) { console.error('[widgetWindow] snapshot:', e); }
            var out = orig.apply(this, arguments);
            if (clean) lastOppId = clean;
            // Si el widget vivo estaba minimizado, regresarlo del dock.
            var overlay = document.getElementById('widgetDetalle');
            if (overlay && st(overlay).minimized) restoreFromDock(overlay);
            return out;
        };
    }

    function maybeSnapshot(newId) {
        var overlay = document.getElementById('widgetDetalle');
        if (!overlay || !newId || !lastOppId || newId === lastOppId) return;
        if (!overlay.classList.contains('ww-windowed')) return;  // modal → reemplaza, como siempre
        if (st(overlay).minimized || !isVisible(overlay)) return;
        if (countWindows() >= MAX_WINDOWS) {
            notify('Máximo ' + MAX_WINDOWS + ' ventanas: la oportunidad abierta se reemplazará');
            return;
        }
        createSnapshot(overlay, lastOppId);
    }

    var ICON_MIN = '<svg width="12" height="12" viewBox="0 0 12 12"><line x1="1.5" y1="6" x2="10.5" y2="6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    var ICON_ACT = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M4.5 1.5h6v6M10.5 1.5 5 7M5.5 2.5h-4v8h8v-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function createSnapshot(overlay, oppId) {
        var card = getCard(overlay);
        var rect = st(overlay).rect || defaultRect();
        var titleEl = overlay.querySelector('#woTitle');
        var title = (titleEl && titleEl.textContent.trim()) || ('Oportunidad ' + oppId);

        var snap = document.createElement('div');
        snap.className = 'widget-overlay ww-snapshot';
        snap.id = 'wwSnap' + (++snapSeq);
        snap.setAttribute('data-widget-title', title);
        snap.setAttribute('data-ww-enhanced', '1');  // no pasar por enhance()

        var clone = card.cloneNode(true);
        clone.removeAttribute('id');
        // Sin ids duplicados: el legacy renderiza por getElementById y debe
        // seguir encontrando SOLO el widget vivo.
        clone.querySelectorAll('[id]').forEach(function (n) { n.removeAttribute('id'); });
        clone.querySelectorAll('.ww-handle, .ww-ctrls, script').forEach(function (n) { n.remove(); });
        snap.appendChild(clone);

        // Controles propios: activar / minimizar / cerrar
        var headerTop = clone.querySelector('.wo-header-top') || clone;
        var ctr = document.createElement('div');
        ctr.className = 'ww-ctrls';
        ctr.innerHTML =
            '<span class="ww-snap-badge">Solo lectura</span>' +
            '<button type="button" class="ww-btn ww-snap-activate" title="Activar para editar">' + ICON_ACT + '</button>' +
            '<button type="button" class="ww-btn ww-snap-min" title="Minimizar">' + ICON_MIN + '</button>' +
            '<button type="button" class="ww-btn ww-snap-close" data-widget-close title="Cerrar vista">&times;</button>';
        headerTop.appendChild(ctr);

        ctr.querySelector('.ww-snap-min').addEventListener('click', function (ev) {
            ev.stopPropagation();
            minimize(snap);
        });
        ctr.querySelector('.ww-snap-close').addEventListener('click', function (ev) {
            ev.stopPropagation();
            destroySnapshot(snap);
        });
        ctr.querySelector('.ww-snap-activate').addEventListener('click', function (ev) {
            ev.stopPropagation();
            activateSnapshot(snap, oppId);
        });

        // Solo lectura: bloquear interacción con el contenido clonado
        // (los controles propios y las esquinas sí funcionan; el scroll
        // no pasa por aquí). Capture: corre antes que onclick inline.
        ['click', 'pointerdown'].forEach(function (evName) {
            snap.addEventListener(evName, function (ev) {
                if (ev.target.closest('.ww-ctrls, .ww-handle')) return;
                if (ev.target.closest(INTERACTIVE)) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (evName === 'click') notify('Vista de solo lectura — usa ⤢ para activarla');
                }
            }, true);
        });

        document.body.appendChild(snap);
        snap.style.display = 'flex';  // visible: widget_stack lo registra solo
        snap.classList.add('ww-windowed');
        st(snap).windowed = true;
        applyRect(snap, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
        injectHandles(snap);
        watchSize(snap);

        // La ventana viva se corre en cascada para no tapar la vista.
        applyRect(overlay, snapToEdges({ x: rect.x + 36, y: rect.y + 36, w: rect.w, h: rect.h }));
    }

    function destroySnapshot(snap) {
        removeChip(snap);
        if (window.crmWidgetStack) window.crmWidgetStack.remove(snap);
        snap.remove();
    }

    function activateSnapshot(snap, oppId) {
        var live = document.getElementById('widgetDetalle');
        var targetRect = st(snap).rect;
        destroySnapshot(snap);  // liberar el slot antes del snapshot recíproco
        if (typeof window.openDetalle === 'function') window.openDetalle(oppId);
        // Colocar la ventana viva donde estaba la vista (continuidad espacial).
        if (live && targetRect) {
            if (live.classList.contains('ww-windowed')) applyRect(live, targetRect);
            else windowize(live, targetRect);
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
        wrapOpenDetalle();
    }

    if (!window._widgetWindowWired) {
        window._widgetWindowWired = true;
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('dblclick', onDblClick, true);
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
