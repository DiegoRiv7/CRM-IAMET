/* ═══════════════════════════════════════════════════════════════════
   Ventanas para el widget de PROSPECCIÓN — Misión 2 del pulido.

   Duplica el comportamiento logrado en Oportunidades, sin tocar la
   lógica del legacy (crm_prospeccion.js):

     · #widgetProspecto y #widgetClienteProspectos son windowables
       (data-windowable en el template → widget_window les pone chrome).
     · Sus satélites (Agendar Actividad, Crear Oportunidad, y el visor
       de actividad naranja) abren como VENTANA en cascada cuando el
       prospecto está windowizado; como overlay clásico cuando es modal.
     · El visor naranja (wpActInfoOverlay) se crea dinámico en el
       legacy: un hook de 1 línea ahí nos lo entrega para windowizarlo
       (window._wpWindowizeActInfo).

   Patrón takeover: este script carga después del legacy y envuelve los
   openers globales con un marcador anti-doble-wrap (lección del
   calendario: re-verificar en cada crmReady).
   ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function prospectoWindowed() {
        var w = document.getElementById('widgetProspecto');
        return !!(w && w.classList.contains('ww-windowed'));
    }

    // Rect en cascada junto a la ventana del prospecto.
    function cascadeRect(pref) {
        var vw = window.innerWidth, vh = window.innerHeight;
        var w = Math.min(pref.w, vw - 24);
        var h = Math.min(pref.h, vh - 24);
        var x = Math.round((vw - w) / 2), y = Math.round((vh - h) / 2);
        try {
            var pw = document.getElementById('widgetProspecto');
            var card = pw && (pw.querySelector('.ww-card') || pw.firstElementChild);
            var b = card ? card.getBoundingClientRect() : null;
            if (b) {
                x = Math.max(8, Math.round(Math.min(b.left + 56, vw - w - 12)));
                y = Math.max(8, Math.round(Math.min(b.top + 56, vh - h - 12)));
            }
        } catch (e) { }
        return { x: x, y: y, w: w, h: h };
    }

    function windowizeSub(ov, pref) {
        var ww = window.crmWidgetWindow;
        if (!ww || typeof ww.windowize !== 'function') return;
        if (!ov) return;
        if (ov.classList.contains('ww-windowed')) {
            if (window.crmWidgetStack) {
                window.crmWidgetStack.remove(ov);
                window.crmWidgetStack.push(ov);
            }
            return;
        }
        try { ww.enhance(ov); } catch (e) { }
        ww.windowize(ov, cascadeRect(pref));
    }

    // Envuelve un opener global: tras abrir, si el prospecto está en
    // ventana, el satélite también. Marcador anti-doble-wrap.
    function wrapOpener(fnName, overlayId, pref) {
        var orig = window[fnName];
        if (typeof orig !== 'function' || orig._pwWrapped) return;
        var wrapped = function () {
            var r = orig.apply(this, arguments);
            if (prospectoWindowed()) {
                windowizeSub(document.getElementById(overlayId), pref);
            }
            return r;
        };
        wrapped._pwWrapped = true;
        window[fnName] = wrapped;
    }

    // Hook para el visor de actividad naranja (creado dinámico en
    // crm_prospeccion._mostrarInfoActividad — 1 línea de hook allá).
    window._wpWindowizeActInfo = function (overlay) {
        if (!overlay) return;
        // La clase widget-overlay lo mete al stack (z dinámico) y habilita
        // el layout de ventana; su cssText inline ya trae el resto.
        overlay.classList.add('widget-overlay');
        if (prospectoWindowed()) {
            windowizeSub(overlay, { w: 580, h: 620 });
        }
    };

    // ── Multi-prospecto (mismo truco que el drive/cotizador) ────────
    // El widget legacy es singleton: si ya hay un prospecto abierto EN
    // VENTANA y se pide OTRO, el nuevo abre como ventana-iframe propia
    // (/app/widget/prospecto/<id>/ — N iframes = N prospectos editables).
    // Si el singleton está libre (o en modo modal), flujo clásico.
    function wrapAbrirProspecto() {
        var orig = window.abrirWidgetProspecto;
        if (typeof orig !== 'function' || orig._pwWrapped) return;
        var wrapped = function (id) {
            var w = document.getElementById('widgetProspecto');
            var visible = w && window.getComputedStyle(w).display !== 'none';
            var enVentana = w && w.classList.contains('ww-windowed');
            var otroId = window._currentProspectoId &&
                String(window._currentProspectoId) !== String(id);
            if (visible && enVentana && otroId &&
                window.crmIframeWindow && typeof window.crmIframeWindow.open === 'function') {
                window.crmIframeWindow.open(
                    'prospecto:' + id,
                    '/app/widget/prospecto/' + id + '/',
                    'Prospecto',
                    null,
                    { forceWindow: true, wf: 0.6, maxw: 1100, hf: 0.84 }
                );
                return;
            }
            return orig.apply(this, arguments);
        };
        wrapped._pwWrapped = true;
        window.abrirWidgetProspecto = wrapped;
    }

    function wireAll() {
        wrapOpener('wpAbrirPanelActividades', 'widgetProspectoActividades', { w: 640, h: 580 });
        wrapOpener('wpAbrirModalCrearOpp', 'widgetCrearOppDesdeProspecto', { w: 820, h: 700 });
        wrapAbrirProspecto();
    }

    if (typeof window.crmReady === 'function') {
        window.crmReady(wireAll);
    } else if (document.readyState !== 'loading') {
        wireAll();
    } else {
        document.addEventListener('DOMContentLoaded', wireAll);
    }
})();
