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

    // Curva tipo "ease-out-expo" estilo Apple para las transiciones de
    // entrada/salida del modo ventana y del minimize/restore.
    var EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
    var DUR_MODE = 280;     // ms — windowize / unwindowize
    var DUR_DOCK = 320;     // ms — minimize / restore (a/desde el chip del dock)

    var states = new WeakMap();  // overlay -> { windowed, minimized, rect }

    function st(overlay) {
        var s = states.get(overlay);
        if (!s) {
            s = { windowed: false, minimized: false, rect: null };
            states.set(overlay, s);
        }
        return s;
    }

    /* ── FLIP (First-Last-Invert-Play) ────────────────────────────────
       Anima la card entre dos layouts CSS sin importar que cambien las
       reglas de posicionamiento (modal centrado ↔ position:fixed). Se
       llama DESPUÉS del cambio de clase/style:
         1) capturar el rect del usuario ANTES (parámetro fromRect)
         2) capturar el rect nuevo (toRect — getBoundingClientRect aquí)
         3) aplicar un transform que devuelve VISUALMENTE al fromRect
         4) en el siguiente frame, transition + transform:'' → anima al
            toRect real con suavidad
       Si los dos rects son prácticamente iguales, no hace nada. */
    function flipAnimate(card, fromRect, duration) {
        if (!card || !fromRect) return;
        duration = duration || DUR_MODE;
        var toRect = card.getBoundingClientRect();
        var dx = fromRect.left - toRect.left;
        var dy = fromRect.top - toRect.top;
        var sx = toRect.width  ? (fromRect.width  / toRect.width)  : 1;
        var sy = toRect.height ? (fromRect.height / toRect.height) : 1;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 &&
            Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;

        card.style.transformOrigin = '0 0';
        card.style.transition = 'none';
        card.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')';
        // Forzar reflow para que el browser registre el estado inicial.
        void card.offsetHeight;
        requestAnimationFrame(function () {
            card.style.transition = 'transform ' + duration + 'ms ' + EASE;
            card.style.transform = '';
            var done = function () {
                card.style.transition = '';
                card.style.transform = '';
                card.style.transformOrigin = '';
                card.removeEventListener('transitionend', done);
            };
            card.addEventListener('transitionend', done);
            // Safety net por si transitionend no dispara (interrupción).
            setTimeout(done, duration + 60);
        });
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
        // Si esta opp tiene satélites abiertos, re-encuadrarlos al
        // nuevo rect (debounced via RAF para no saturar durante drag).
        scheduleSatelliteRefresh();
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
            // En lugar de un toast huérfano, abrir el selector visual
            // estilo Mission Control: el usuario elige cuál cerrar
            // para que la nueva tome su lugar. Si cancela, la ventana
            // pendiente queda como modal (no se windowiza).
            showWindowPicker(overlay, rect);
            return false;
        }
        var card = getCard(overlay);
        if (!card) return false;
        var fromRect = card.getBoundingClientRect();
        var r = rect;
        if (!r) {
            r = { x: fromRect.left, y: fromRect.top, w: fromRect.width, h: fromRect.height };
        }
        overlay.classList.add('ww-windowed');
        applyRect(overlay, r);
        st(overlay).windowed = true;
        updateWinBtn(overlay);
        bringToFront(overlay);
        // Garantiza .ww-focused en este overlay aunque bringToFront
        // haya hecho early-return (caso: la ventana ya era top del
        // stack). Sin esto, el CSS aplica brightness(0.88) por 1+
        // frames y la ventana se ve oscura al abrirse.
        _doRefreshFocus();
        // FLIP: cuando se windowiza desde un drag de esquina, fromRect ≈
        // toRect y la animación se auto-cancela. Cuando se windowiza con
        // un rect distinto (botón □ → defaultRect centrado), anima suave.
        flipAnimate(card, fromRect);
        return true;
    }

    function unwindowize(overlay) {
        var card = getCard(overlay);
        var fromRect = card ? card.getBoundingClientRect() : null;
        overlay.classList.remove('ww-windowed');
        overlay.classList.remove('ww-focused');
        ['--ww-x', '--ww-y', '--ww-w', '--ww-h'].forEach(function (p) {
            overlay.style.removeProperty(p);
        });
        var s = st(overlay);
        s.windowed = false;
        s.rect = null;
        updateWinBtn(overlay);
        flipAnimate(card, fromRect);
        _doRefreshFocus();  // síncrono: evita flash de 1 frame
    }

    function bringToFront(overlay) {
        var ws = window.crmWidgetStack;
        if (!ws) return;
        var top = ws.get();
        if (top.length && top[top.length - 1] === overlay) return;  // ya está al frente
        ws.remove(overlay);
        ws.push(overlay);
        // SÍNCRONO aquí: si esperamos al RAF, hay 1 frame donde la
        // ventana nueva está visible sin .ww-focused y se ve oscura.
        _doRefreshFocus();
    }

    /* ── Foco visual minimal: solo clase .ww-focused, CSS hace el resto.
       El velo oscuro del fondo se aplica automáticamente vía CSS
       :has() — no necesitamos mantener body.ww-has-windows en JS. */

    var _focusScheduled = false;

    // Versión DEBOUNCED — para callbacks que pueden disparar muchas
    // veces (como el MutationObserver de watchVisibility con el
    // widget v2 de Oportunidad). RAF colapsa múltiples invocaciones
    // del mismo tick en una sola.
    function refreshFocusState() {
        if (_focusScheduled) return;
        _focusScheduled = true;
        requestAnimationFrame(function () {
            _focusScheduled = false;
            _doRefreshFocus();
        });
    }

    function _doRefreshFocus() {
        // Buscamos directo en el DOM por z-index, NO en el stack
        // interno de widget_stack: cuando una ventana se cierra, hay
        // una breve race entre los dos observers (widget_stack quita
        // del stack vía MutationObserver, igual que nosotros). Usar
        // el DOM + z-index garantiza que vemos el estado real ahora.
        var candidates = Array.prototype.slice.call(
            document.querySelectorAll('.widget-overlay.ww-windowed:not(.ww-minimized)')
        ).filter(isVisible);
        candidates.sort(function (a, b) {
            var za = parseInt(window.getComputedStyle(a).zIndex, 10) || 0;
            var zb = parseInt(window.getComputedStyle(b).zIndex, 10) || 0;
            return zb - za;
        });
        var focused = candidates[0] || null;
        document.querySelectorAll('.widget-overlay.ww-focused').forEach(function (el) {
            if (el !== focused) el.classList.remove('ww-focused');
        });
        if (focused && !focused.classList.contains('ww-focused')) {
            focused.classList.add('ww-focused');
        }
        // Mantener body.ww-has-windows sincronizado — el CSS :has() no
        // se evalúa reactivamente en todos los browsers/timings, así
        // que el tracking JS es la garantía de que el velo oscuro del
        // fondo aparece/desaparece correctamente.
        document.body.classList.toggle('ww-has-windows', candidates.length > 0);
        // Si la opp focused cambió, los satélites abiertos se mueven
        // con ella (o se desembebter si ya no hay ninguna opp activa).
        scheduleSatelliteRefresh();
    }

    /* ── Widgets satélite "embebidos" en la opp activa ────────────
       Drive, Conversación, Crear/Ver Actividad, Todas las Tareas y
       otros sub-modales abiertos DESDE el widget de oportunidad se
       posicionan dentro del rect de la opp focused windowed — así no
       invaden el viewport global ni tapan otras ventanas.

       Si NO hay opp en modo ventana, conservan su comportamiento
       modal original (cubren todo el viewport). El cotizador NO está
       en esta lista a propósito: ya es ventana propia instanciada. */

    var OPP_SATELLITE_IDS = [
        'widgetOppDrive',
        'widgetOppConversacion',
        'widgetOppCrearActividad',
        'widgetOppVerActividad',
        'widgetTodasTareas',
        'widgetOppDialog',
        'widgetConfirmTipo',
        'crmCreateTaskModal',
        'widgetSubirFactura',
        'widgetContacto',
    ];
    var OPP_SATELLITE_SET = {};
    OPP_SATELLITE_IDS.forEach(function (id) { OPP_SATELLITE_SET[id] = true; });

    function getActiveOppOverlay() {
        // 1) Opp v2 focused windowed
        var f = document.querySelector(
            '.widget-overlay.opp-v2.ww-windowed.ww-focused:not(.ww-minimized)'
        );
        if (f && isVisible(f)) return f;
        // 2) Cualquier opp v2 windowed visible (la más reciente del stack)
        var ws = window.crmWidgetStack;
        if (ws) {
            var stack = ws.get();
            for (var i = stack.length - 1; i >= 0; i--) {
                var el = stack[i];
                if (el && el.classList && el.classList.contains('opp-v2') &&
                    el.classList.contains('ww-windowed') &&
                    !el.classList.contains('ww-minimized') && isVisible(el)) {
                    return el;
                }
            }
        }
        // 3) Legacy widgetDetalle windowed (por si vuelve a usarse)
        var legacy = document.getElementById('widgetDetalle');
        if (legacy && legacy.classList.contains('ww-windowed') &&
            !legacy.classList.contains('ww-minimized') && isVisible(legacy)) {
            return legacy;
        }
        return null;
    }

    function getSatelliteCard(satellite) {
        return satellite.querySelector('.widget-card, .ww-card, .wco-card');
    }

    function embedSatelliteToOpp(satellite, opp) {
        var oppCard = getCard(opp);
        if (!oppCard) return;
        var satCard = getSatelliteCard(satellite);
        if (!satCard) return;
        var rect = oppCard.getBoundingClientRect();
        satellite.classList.add('ww-embedded-opp');
        // Asociar al satélite la opp host para que onPointerDown sepa
        // que drag/resize en el satélite deben aplicarse a la opp.
        satellite._wwOppHost = opp;
        satCard.style.position = 'fixed';
        satCard.style.left = rect.left + 'px';
        satCard.style.top = rect.top + 'px';
        satCard.style.width = rect.width + 'px';
        satCard.style.height = rect.height + 'px';
        satCard.style.maxWidth = 'none';
        satCard.style.maxHeight = 'none';
        satCard.style.margin = '0';
        satCard.style.borderRadius = '16px';
        // La card del satélite necesita .ww-card para que onPointerDown
        // la reconozca como zona de drag/handles, y position:relative
        // (que ww-card ya define) para anclar los handles. Como en este
        // caso seteamos position:fixed inline, los handles absolutos se
        // posicionan respecto al satCard mismo.
        satCard.classList.add('ww-card');
        injectHandles(satellite);
        // z-index del satélite = z-index de la opp + 5 (queda por encima
        // de la opp pero por debajo del shield de drag y del picker).
        var oppZ = parseInt(window.getComputedStyle(opp).zIndex, 10) || 1000;
        satellite.style.zIndex = (oppZ + 5);
    }

    function unembedSatellite(satellite) {
        if (!satellite.classList.contains('ww-embedded-opp')) return;
        satellite.classList.remove('ww-embedded-opp');
        satellite._wwOppHost = null;
        var satCard = getSatelliteCard(satellite);
        if (satCard) {
            ['position', 'left', 'top', 'width', 'height', 'maxWidth',
             'maxHeight', 'margin', 'borderRadius'].forEach(function (p) {
                satCard.style.removeProperty(p);
            });
        }
        satellite.style.removeProperty('z-index');
    }

    var _embedRefreshScheduled = false;
    function scheduleSatelliteRefresh() {
        if (_embedRefreshScheduled) return;
        _embedRefreshScheduled = true;
        requestAnimationFrame(function () {
            _embedRefreshScheduled = false;
            refreshEmbeddedSatellites();
        });
    }

    function refreshEmbeddedSatellites() {
        var opp = getActiveOppOverlay();
        OPP_SATELLITE_IDS.forEach(function (id) {
            var sat = document.getElementById(id);
            if (!sat) return;
            if (!isVisible(sat)) {
                if (sat.classList.contains('ww-embedded-opp')) unembedSatellite(sat);
                return;
            }
            if (opp) embedSatelliteToOpp(sat, opp);
            else if (sat.classList.contains('ww-embedded-opp')) unembedSatellite(sat);
        });
    }

    // MutationObserver por satélite: cuando se vuelve visible, embeber
    // si hay opp activa. Solo se setea una vez por elemento.
    function watchSatellite(id) {
        var el = document.getElementById(id);
        if (!el || el._wwSatWatched) return;
        el._wwSatWatched = true;
        var lastVisible = isVisible(el);
        var obs = new MutationObserver(function () {
            var visible = isVisible(el);
            if (visible === lastVisible) return;
            lastVisible = visible;
            if (visible) {
                var opp = getActiveOppOverlay();
                if (opp) embedSatelliteToOpp(el, opp);
            } else {
                unembedSatellite(el);
            }
        });
        obs.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    function setupAllSatelliteWatchers() {
        OPP_SATELLITE_IDS.forEach(watchSatellite);
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
        // Pre-renderizar el chip pero invisible para poder medir su rect
        // y animar la card hacia él. El chip se hace visible al final con
        // su propio fade-in (CSS keyframe ww-dock-chip-in).
        chip.style.opacity = '0';
        chip.style.pointerEvents = 'none';
        dock.appendChild(chip);

        var card = getCard(overlay);
        var cardRect = card ? card.getBoundingClientRect() : null;
        var chipRect = chip.getBoundingClientRect();

        var finalize = function () {
            s.minimized = true;
            // Ocultar SOLO con clase propia (display:none !important en CSS).
            // NUNCA tocar style.display inline: widgets como widgetDetalle se
            // abren/cierran con classList 'active' y un display inline pegado
            // le ganaría al CSS dejando el widget imposible de cerrar con la X.
            overlay.classList.add('ww-minimized');
            overlay.classList.remove('ww-focused');
            if (card) {
                card.style.transition = '';
                card.style.transform = '';
                card.style.opacity = '';
                card.style.transformOrigin = '';
            }
            // Mostrar el chip ya posicionado (fade-in vía CSS keyframe).
            chip.style.opacity = '';
            chip.style.pointerEvents = '';
            chip.classList.add('ww-dock-chip-enter');
            _doRefreshFocus();
        };

        if (!card || !cardRect || !chipRect.width) {
            finalize();
            return;
        }

        // Calcular transform que lleva el centro de la card al centro
        // del chip (con scale para que "encoja" hacia el dock).
        var dx = (chipRect.left + chipRect.width  / 2) - (cardRect.left + cardRect.width  / 2);
        var dy = (chipRect.top  + chipRect.height / 2) - (cardRect.top  + cardRect.height / 2);
        var scale = Math.max(0.05, Math.min(
            chipRect.width  / cardRect.width,
            chipRect.height / cardRect.height
        ));

        card.style.transformOrigin = '50% 50%';
        card.style.transition = 'transform ' + DUR_DOCK + 'ms ' + EASE +
                                ', opacity ' + (DUR_DOCK - 40) + 'ms ease-out';
        void card.offsetHeight;
        card.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';
        card.style.opacity = '0';

        var done = function () {
            card.removeEventListener('transitionend', done);
            finalize();
        };
        card.addEventListener('transitionend', done);
        setTimeout(done, DUR_DOCK + 60);
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
        // Capturar rect del chip ANTES de removerlo — el destino visual
        // desde el cual la card va a "salir".
        var chip = overlay._wwChip;
        var chipRect = chip ? chip.getBoundingClientRect() : null;

        s.minimized = false;
        removeChip(overlay);
        overlay.classList.remove('ww-minimized');
        bringToFront(overlay);

        var card = getCard(overlay);
        if (!card || !chipRect || !chipRect.width) return;
        var cardRect = card.getBoundingClientRect();
        if (!cardRect.width) return;

        // Posicionar visualmente la card sobre el chip (escala pequeña +
        // opacidad 0) y luego dejarla expandirse a su tamaño real.
        var dx = (chipRect.left + chipRect.width  / 2) - (cardRect.left + cardRect.width  / 2);
        var dy = (chipRect.top  + chipRect.height / 2) - (cardRect.top  + cardRect.height / 2);
        var scale = Math.max(0.05, Math.min(
            chipRect.width  / cardRect.width,
            chipRect.height / cardRect.height
        ));

        card.style.transformOrigin = '50% 50%';
        card.style.transition = 'none';
        card.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';
        card.style.opacity = '0';
        void card.offsetHeight;
        requestAnimationFrame(function () {
            card.style.transition = 'transform ' + DUR_DOCK + 'ms ' + EASE +
                                    ', opacity ' + (DUR_DOCK - 40) + 'ms ease-out';
            card.style.transform = '';
            card.style.opacity = '';
            var done = function () {
                card.style.transition = '';
                card.style.transform = '';
                card.style.opacity = '';
                card.style.transformOrigin = '';
                card.removeEventListener('transitionend', done);
            };
            card.addEventListener('transitionend', done);
            setTimeout(done, DUR_DOCK + 60);
        });
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

    /* ── Snap a bordes/mitades/cuartos (durante drag de mover) ──────
       Estilo macOS/Windows: arrastrar al tope → maximizar, a los lados
       izq/der → mitad de pantalla, a las esquinas → un cuarto. Un
       "ghost rectangle" semitransparente muestra dónde caerá la
       ventana mientras se sostiene en la zona.

       Las zonas se evalúan POR POSICIÓN DEL PUNTERO, no del rect de
       la card — así el usuario apunta a la zona deseada sin importar
       qué tan grande sea la ventana. Esquinas (60×60 px) tienen
       prioridad sobre los lados (6 px desde el borde).                */

    var SNAP_CORNER = 60;     // px de esquina para activar cuarto
    var SNAP_EDGE = 6;        // px de borde para activar lado/maximize

    function snapZoneFor(x, y) {
        var vw = window.innerWidth, vh = window.innerHeight;
        // Esquinas (cuartos)
        if (x < SNAP_CORNER && y < SNAP_CORNER)
            return { x: 0, y: 0, w: Math.round(vw / 2), h: Math.round(vh / 2), kind: 'tl' };
        if (x > vw - SNAP_CORNER && y < SNAP_CORNER)
            return { x: Math.round(vw / 2), y: 0, w: Math.round(vw / 2), h: Math.round(vh / 2), kind: 'tr' };
        if (x < SNAP_CORNER && y > vh - SNAP_CORNER)
            return { x: 0, y: Math.round(vh / 2), w: Math.round(vw / 2), h: Math.round(vh / 2), kind: 'bl' };
        if (x > vw - SNAP_CORNER && y > vh - SNAP_CORNER)
            return { x: Math.round(vw / 2), y: Math.round(vh / 2), w: Math.round(vw / 2), h: Math.round(vh / 2), kind: 'br' };
        // Lados
        if (y < SNAP_EDGE) return { x: 0, y: 0, w: vw, h: vh, kind: 'max' };
        if (x < SNAP_EDGE) return { x: 0, y: 0, w: Math.round(vw / 2), h: vh, kind: 'left' };
        if (x > vw - SNAP_EDGE) return { x: Math.round(vw / 2), y: 0, w: Math.round(vw / 2), h: vh, kind: 'right' };
        return null;
    }

    var snapGhost = null;
    var snapTarget = null;

    function showSnapGhost(rect) {
        if (!snapGhost) {
            snapGhost = document.createElement('div');
            snapGhost.className = 'ww-snap-ghost';
            document.body.appendChild(snapGhost);
            void snapGhost.offsetHeight;  // forzar reflow para que el .visible anime
        }
        snapGhost.style.left = rect.x + 'px';
        snapGhost.style.top = rect.y + 'px';
        snapGhost.style.width = rect.w + 'px';
        snapGhost.style.height = rect.h + 'px';
        snapGhost.classList.add('ww-snap-ghost-visible');
    }

    function hideSnapGhost() {
        if (snapGhost) snapGhost.classList.remove('ww-snap-ghost-visible');
        snapTarget = null;
    }

    function removeSnapGhost() {
        if (snapGhost) { snapGhost.remove(); snapGhost = null; }
        snapTarget = null;
    }

    /* ── Mission Control / Show Desktop (estilo macOS) ──────────────
       Click en zona vacía del fondo (fuera de ventanas, dock y
       elementos interactivos) → las ventanas flotantes "vuelan" hacia
       el borde más cercano, revelando el CRM debajo. Otro click en
       zona vacía las restaura idénticas (posición, tamaño, z-order).
       NO es minimize: las ventanas no van al dock, su estado se
       preserva por completo — solo se ocultan visualmente.            */

    var missionControlActive = false;
    var missionHint = null;

    function activeWindows() {
        return Array.prototype.slice.call(
            document.querySelectorAll('.widget-overlay.ww-windowed:not(.ww-minimized)')
        ).filter(isVisible);
    }

    function activateMissionControl() {
        if (missionControlActive) return;
        var wins = activeWindows();
        if (!wins.length) return;
        var vw = window.innerWidth, vh = window.innerHeight;
        wins.forEach(function (overlay) {
            var card = getCard(overlay);
            if (!card) return;
            var rect = card.getBoundingClientRect();
            // Borde más cercano → empujamos la card por ahí
            var dT = rect.top, dB = vh - rect.bottom, dL = rect.left, dR = vw - rect.right;
            var minD = Math.min(dT, dB, dL, dR);
            var tx = 0, ty = 0;
            if (minD === dT)       ty = -(rect.bottom + 40);
            else if (minD === dB)  ty = (vh - rect.top) + 40;
            else if (minD === dL)  tx = -(rect.right + 40);
            else                   tx = (vw - rect.left) + 40;
            card.style.transition = 'transform 0.36s ' + EASE;
            card.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
            // Los satélites embebidos viajan junto con su opp host —
            // sin esto, el satélite se quedaba flotando aunque la opp
            // se había escondido. Aplicamos el mismo transform.
            OPP_SATELLITE_IDS.forEach(function (id) {
                var sat = document.getElementById(id);
                if (!sat || !sat.classList.contains('ww-embedded-opp')) return;
                if (sat._wwOppHost !== overlay) return;
                if (!isVisible(sat)) return;
                var satCard = getSatelliteCard(sat);
                if (satCard) {
                    satCard.style.transition = 'transform 0.36s ' + EASE;
                    satCard.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
                }
            });
        });
        var dock = document.getElementById('wwDock');
        if (dock) {
            dock.style.transition = 'transform 0.36s ' + EASE + ', opacity 0.28s ease-out';
            dock.style.transform = 'translateX(-50%) translateY(120%)';
            dock.style.opacity = '0';
        }
        // Pista discreta de cómo restaurar.
        missionHint = document.createElement('div');
        missionHint.className = 'ww-mc-hint';
        missionHint.textContent = 'Toca cualquier área vacía para restaurar las ventanas';
        document.body.appendChild(missionHint);
        document.body.classList.add('ww-mission-control');
        missionControlActive = true;
    }

    function deactivateMissionControl() {
        if (!missionControlActive) return;
        var wins = activeWindows();
        wins.forEach(function (overlay) {
            var card = getCard(overlay);
            if (!card) return;
            card.style.transition = 'transform 0.4s ' + EASE;
            card.style.transform = '';
            var done = function () {
                card.style.transition = '';
                card.style.transform = '';
                card.removeEventListener('transitionend', done);
            };
            card.addEventListener('transitionend', done);
            setTimeout(done, 440);
        });
        // Restaurar satélites embebidos junto con sus opps
        OPP_SATELLITE_IDS.forEach(function (id) {
            var sat = document.getElementById(id);
            if (!sat || !sat.classList.contains('ww-embedded-opp')) return;
            var satCard = getSatelliteCard(sat);
            if (!satCard) return;
            satCard.style.transition = 'transform 0.4s ' + EASE;
            satCard.style.transform = '';
            var doneSat = function () {
                satCard.style.transition = '';
                satCard.style.transform = '';
                satCard.removeEventListener('transitionend', doneSat);
            };
            satCard.addEventListener('transitionend', doneSat);
            setTimeout(doneSat, 440);
        });
        var dock = document.getElementById('wwDock');
        if (dock) {
            dock.style.transition = 'transform 0.4s ' + EASE + ', opacity 0.3s ease-out';
            dock.style.transform = '';
            dock.style.opacity = '';
            setTimeout(function () {
                if (dock) {
                    dock.style.transition = '';
                    dock.style.transform = '';
                    dock.style.opacity = '';
                }
            }, 440);
        }
        if (missionHint) { missionHint.remove(); missionHint = null; }
        document.body.classList.remove('ww-mission-control');
        missionControlActive = false;
    }

    /* ── Window Picker: cuál cerrar al exceder MAX_WINDOWS ──────────
       Estilo Mission Control en miniatura. Cuando se intenta abrir
       una 5ª ventana, mostramos un overlay con las 4 actuales como
       tarjetas grandes clickables. Click en una → se cierra (con su
       handler propio para no bypassar lógica del widget) y la pendiente
       se windowiza en el siguiente tick. Cancelar/Esc → no se abre. */

    var pickerEl = null;            // overlay del picker
    var pickerPending = null;       // { overlay, rect } a abrir al elegir

    // Íconos por tipo de widget conocido (svg inline, 24×24).
    function pickerIconFor(overlay) {
        var id = (overlay.id || '').toLowerCase();
        // Opp/detalle (legacy + v2)
        if (id.indexOf('detalle') !== -1 || id.indexOf('opp') !== -1) {
            return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 L2 7 L12 12 L22 7 L12 2 Z"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';
        }
        if (id.indexOf('cotizad') !== -1 || id.indexOf('cot') !== -1) {
            return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
        }
        if (id.indexOf('cliente') !== -1) {
            return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
        }
        // Genérico: ventana
        return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>';
    }

    function pickerSubtitleFor(overlay) {
        // Si el card tiene un .wo-cliente o similar, úsalo; sino, el id "limpio".
        var sub = overlay.querySelector('[data-widget-subtitle]');
        if (sub) return sub.textContent.trim().substring(0, 60);
        var cliente = overlay.querySelector('.wo-cliente, .wo-subtitle, .wco-subtitle');
        if (cliente && cliente.textContent.trim()) return cliente.textContent.trim().substring(0, 60);
        return '';
    }

    function showWindowPicker(pendingOverlay, pendingRect) {
        if (pickerEl) return;  // ya hay uno abierto
        pickerPending = { overlay: pendingOverlay, rect: pendingRect };
        var wins = activeWindows();

        pickerEl = document.createElement('div');
        pickerEl.className = 'ww-picker';
        pickerEl.innerHTML =
            '<div class="ww-picker-card" role="dialog" aria-modal="true">' +
            '  <div class="ww-picker-head">' +
            '    <h2 class="ww-picker-title">Tienes ' + wins.length + ' ventanas abiertas</h2>' +
            '    <p class="ww-picker-sub">Cierra una para abrir esta nueva</p>' +
            '  </div>' +
            '  <div class="ww-picker-grid"></div>' +
            '  <div class="ww-picker-foot">' +
            '    <button type="button" class="ww-picker-cancel">Cancelar</button>' +
            '  </div>' +
            '</div>';
        var grid = pickerEl.querySelector('.ww-picker-grid');
        wins.forEach(function (overlay) {
            var item = document.createElement('button');
            item.type = 'button';
            item.className = 'ww-picker-item';
            item.innerHTML =
                '<div class="ww-picker-item-icon">' + pickerIconFor(overlay) + '</div>' +
                '<div class="ww-picker-item-body">' +
                '  <div class="ww-picker-item-title">' +
                     esc(widgetTitle(overlay)) +
                '  </div>' +
                '  <div class="ww-picker-item-sub">' + esc(pickerSubtitleFor(overlay)) + '</div>' +
                '</div>' +
                '<div class="ww-picker-item-x" aria-hidden="true">×</div>';
            item.addEventListener('click', function () {
                onPickerSelect(overlay);
            });
            grid.appendChild(item);
        });
        pickerEl.querySelector('.ww-picker-cancel').addEventListener('click', closeWindowPicker);
        // Click en backdrop (fuera del card) = cancelar
        pickerEl.addEventListener('click', function (ev) {
            if (ev.target === pickerEl) closeWindowPicker();
        });
        document.body.appendChild(pickerEl);
        // Forzar reflow para que la transition entrante funcione.
        void pickerEl.offsetHeight;
        pickerEl.classList.add('ww-picker-visible');
    }

    // Mini esc() para escapar texto que viene de widgetTitle/subtitle.
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function closeWindowPicker() {
        if (!pickerEl) return;
        pickerEl.classList.remove('ww-picker-visible');
        var el = pickerEl;
        pickerEl = null;
        pickerPending = null;
        setTimeout(function () { if (el && el.parentNode) el.remove(); }, 220);
    }

    function onPickerSelect(overlayToClose) {
        var pending = pickerPending;
        // Cerrar la elegida usando su propio handler (preserva lógica
        // del widget: limpiar estado, emitir eventos, etc.).
        var btn = overlayToClose.querySelector(CLOSE_SEL);
        if (btn) btn.click();
        else {
            // Sin botón close: fallback razonable.
            overlayToClose.classList.remove('active');
            overlayToClose.style.display = 'none';
        }
        closeWindowPicker();
        // Reintentar la apertura pendiente en el siguiente tick para
        // que el cierre alcance a propagarse (animaciones + observers).
        if (pending) {
            setTimeout(function () {
                if (pending.overlay) windowize(pending.overlay, pending.rect);
            }, 300);
        }
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
        // Si una animación FLIP/minimize está corriendo, cortarla en seco:
        // el drag debe responder 1:1 al puntero, sin "perseguir" suavemente.
        var card = getCard(overlay);
        if (card) {
            card.style.transition = '';
            card.style.transform = '';
            card.style.opacity = '';
            card.style.transformOrigin = '';
        }
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
        ev.stopPropagation();
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
            // Snap visual: si el puntero entra en una zona, mostrar
            // el ghost. La aplicación real ocurre en onPointerUp.
            var zone = snapZoneFor(ev.clientX, ev.clientY);
            if (zone) {
                snapTarget = zone;
                showSnapGhost(zone);
            } else {
                hideSnapGhost();
            }
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

    // Marca de tiempo del último pointerup que terminó un drag/resize.
    // Sirve para SUPRIMIR el click sintético que el browser dispara
    // después — sin esto, un click suelto encima del header (que ya
    // inició un drag) se dispararía como click "en zona vacía" y
    // activaría Mission Control. 220ms cubre clicks normales sin
    // bloquear interacción rápida después.
    var lastDragEnd = 0;

    function onPointerUp() {
        window.removeEventListener('pointermove', onPointerMove);
        if (dragState) {
            var s = st(dragState.overlay);
            if (dragState.mode === 'move') {
                if (snapTarget) {
                    // Aplicar snap rect con animación FLIP suave.
                    var card = getCard(dragState.overlay);
                    var fromRect = card ? card.getBoundingClientRect() : null;
                    applyRect(dragState.overlay, {
                        x: snapTarget.x, y: snapTarget.y,
                        w: snapTarget.w, h: snapTarget.h,
                    });
                    if (fromRect) flipAnimate(card, fromRect, 240);
                } else if (s.rect) {
                    applyRect(dragState.overlay, snapToEdges(s.rect));
                }
            }
            lastDragEnd = Date.now();
        }
        dragState = null;
        removeShield();
        removeSnapGhost();
    }

    // 8 puntos de resize: 4 esquinas + 4 lados. La lógica de
    // onPointerMove ya soporta los 8 modos (usa indexOf en 'n/s/e/w'),
    // sólo había que activar los handles de lado en el DOM.
    var HANDLE_CURSORS = {
        nw: 'nwse-resize', se: 'nwse-resize',
        ne: 'nesw-resize', sw: 'nesw-resize',
        n:  'ns-resize',   s:  'ns-resize',
        e:  'ew-resize',   w:  'ew-resize',
    };

    function injectHandles(overlay) {
        var card = getCard(overlay);
        if (!card || card.querySelector('.ww-handle')) return;
        ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].forEach(function (dir) {
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

        // Si el card pertenece a un satélite embebido, redirigir drag
        // y resize a la OPP HOST — visualmente el usuario interactúa
        // con "la ventana" (no sabe que la opp está debajo del satélite).
        var dragTarget = overlay;
        if (overlay.classList.contains('ww-embedded-opp') && overlay._wwOppHost) {
            dragTarget = overlay._wwOppHost;
        }

        if (dragTarget.classList.contains('ww-windowed')) bringToFront(dragTarget);

        // 1) Esquinas/lados → resize (windowiza primero si está maximizado)
        var handle = ev.target.closest('.ww-handle');
        if (handle) {
            if (!dragTarget.classList.contains('ww-windowed') && !windowize(dragTarget)) return;
            startInteraction(dragTarget, handle.getAttribute('data-ww-dir'), ev,
                HANDLE_CURSORS[handle.getAttribute('data-ww-dir')]);
            return;
        }

        // 2) Franja superior → mover (solo en modo ventana)
        if (!dragTarget.classList.contains('ww-windowed')) return;
        if (ev.target.closest(INTERACTIVE)) return;
        var top = card.getBoundingClientRect().top;
        if (ev.clientY - top > DRAG_STRIP) return;
        startInteraction(dragTarget, 'move', ev, 'grabbing');
    }

    // Doble click en la barra de título: alternar ventana/maximizado.
    function onDblClick(ev) {
        var card = ev.target.closest('.ww-card');
        if (!card) return;
        var overlay = card.closest('.widget-overlay');
        if (!overlay || !overlay.classList.contains('ww-windowed')) return;
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
        // Snapshot del estado de visibilidad — si la nueva mutación no
        // cambia visibility, el callback termina sin trabajo. Sin este
        // gate, el widget v2 de Oportunidad (que muta class/style
        // muchas veces al hidratarse) disparaba refreshFocusState
        // cientos de veces por apertura → congelamiento de la UI.
        var lastVisible = isVisible(overlay);
        var obs = new MutationObserver(function () {
            var s = st(overlay);
            var visible = isVisible(overlay);
            if (visible === lastVisible) return;  // sin cambio relevante
            lastVisible = visible;
            if (visible && s.minimized) {
                s.minimized = false;
                removeChip(overlay);
                refreshFocusState();
            } else if (!visible && !s.minimized && s.windowed) {
                // Cerrado en modo ventana → cerrar también satélites
                // embebidos a esta opp (sino quedaban huérfanos en el
                // viewport sin host). unwindowize ya llama refreshFocusState.
                closeSatellitesOfOpp(overlay);
                unwindowize(overlay);
            } else if (!visible) {
                // Se cerró por otra ruta (sin haber estado en ventana).
                closeSatellitesOfOpp(overlay);
                refreshFocusState();
            } else {
                refreshFocusState();
            }
        });
        obs.observe(overlay, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    function closeSatellitesOfOpp(opp) {
        OPP_SATELLITE_IDS.forEach(function (id) {
            var sat = document.getElementById(id);
            if (!sat) return;
            if (sat._wwOppHost !== opp) return;
            if (!isVisible(sat)) return;
            // Usar el handler propio del satélite para no bypassar su
            // lógica de cleanup.
            var closeBtn = sat.querySelector(CLOSE_SEL);
            if (closeBtn) closeBtn.click();
            else {
                sat.classList.remove('active');
                sat.style.display = 'none';
            }
        });
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
        setupAllSatelliteWatchers();
    }

    /* ── Mission Control: click en zona vacía ─────────────────────── */

    // Selectores de elementos del CRM que NO deben disparar Mission
    // Control aunque el target sea "vacío visualmente": cards del
    // kanban, filas de lista, etc. (el click ahí tiene su propio
    // handler que abre detalle/edita).
    var MC_CRM_CARDS = '.kanban-card, .crm-row, .crm-card, tr[data-opp-id], ' +
        '[data-opp-id], [data-card-id], [data-action]';

    function onGlobalClickForMC(ev) {
        if (ev.button !== 0) return;
        // Suprimir clicks sintéticos justo después de un drag/resize
        // que terminó sin moverse (el browser sigue disparando click
        // aunque el pointerdown haya hecho preventDefault).
        if (Date.now() - lastDragEnd < 220) return;
        // Si hay un drag activo aún (raro: pointerup no llegó), ignorar.
        if (dragState) return;
        // Click dentro de una ventana, otro widget, el dock o el
        // shield invisible del drag → no MC (esos clicks tienen su
        // propio comportamiento). El shield se incluye por defensa:
        // en algunos browsers el target del click se determina al
        // pointerdown, cuando el shield aún cubría el viewport.
        if (ev.target.closest(
            '.widget-overlay, #wwDock, .ww-snap-ghost, .ww-mc-hint, .ww-drag-shield'
        )) {
            return;
        }
        // Si el target es interactivo (botón, link, input, card del
        // CRM, etc.) → dejamos pasar al handler normal.
        if (ev.target.closest(INTERACTIVE)) return;
        if (ev.target.closest(MC_CRM_CARDS)) return;

        if (missionControlActive) {
            deactivateMissionControl();
            ev.preventDefault();
            ev.stopPropagation();
        } else if (activeWindows().length > 0) {
            activateMissionControl();
            ev.preventDefault();
            ev.stopPropagation();
        }
    }

    if (!window._widgetWindowWired) {
        window._widgetWindowWired = true;
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('dblclick', onDblClick, true);
        document.addEventListener('click', onGlobalClickForMC);
        // Click DENTRO de un iframe en ventana (ej. cotizador instanciado):
        // no burbujea al padre, pero el focus sí se mueve — si lo ganó un
        // iframe dentro de una ventana, traerla al frente.
        window.addEventListener('blur', function () {
            setTimeout(function () {
                var ae = document.activeElement;
                if (ae && ae.tagName === 'IFRAME') {
                    var ov = ae.closest('.widget-overlay.ww-windowed');
                    if (ov) bringToFront(ov);
                }
            }, 0);
        });
        // Reajustar ventanas al cambiar el tamaño del viewport. Si MC
        // está activo, recalcular las posiciones de salida para que
        // sigan ocultas correctamente tras el resize.
        window.addEventListener('resize', function () {
            document.querySelectorAll('.widget-overlay.ww-windowed').forEach(function (el) {
                var s = st(el);
                if (s.rect) applyRect(el, s.rect);
            });
            if (missionControlActive) {
                // Re-aplicar el "esconder" con los nuevos cálculos.
                missionControlActive = false;
                activateMissionControl();
            }
        });
        // Esc cierra Mission Control o el window picker si están abiertos.
        document.addEventListener('keydown', function (ev) {
            if (ev.key !== 'Escape') return;
            if (pickerEl) {
                closeWindowPicker();
                ev.preventDefault();
                return;
            }
            if (missionControlActive) {
                deactivateMissionControl();
                ev.preventDefault();
            }
        });
    }
    window.crmReady(scan);

    // API pública mínima (debug + futuros módulos).
    window.crmWidgetWindow = {
        windowize: windowize,
        unwindowize: unwindowize,
        minimize: minimize,
        enhance: enhance,
        missionControl: {
            activate: activateMissionControl,
            deactivate: deactivateMissionControl,
            isActive: function () { return missionControlActive; },
        },
    };
})();
