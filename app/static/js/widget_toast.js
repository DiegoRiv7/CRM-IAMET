/* ═══════════════════════════════════════════════════════════════════
   Widget Toast — Hardening Fase 1.C

   Helper global window.toast() único para mostrar feedback de éxito,
   error o info. Resuelve dos problemas del estado anterior:

   1) Había 9 funciones toast() / showToast() distintas repartidas en
      varios archivos (compras_productos, reportes_personalizado,
      lev_offline, crm_avance_etapa, compras_proveedores, crm_main,
      _marketing_hub, _widget_marketing). Cada una con API distinta.

   2) Algunas funciones eran LOCALES a IIFEs y no estaban accesibles
      globalmente, así que widgets nuevos no podían reusarlas y crearon
      las suyas — multiplicando el problema.

   Ahora:
     window.toast(msg, type, ttl)         → entrada oficial
     window.showToast(msg, type, ttl)     → alias backward-compat
     window.toast.success(msg) / .error(msg) / .info(msg) → atajos

   Tipos válidos: 'success' (verde), 'error' (rojo), 'info' (azul/gris).
   TTL: milisegundos antes de auto-ocultar (default 3000).

   Z-index: el elemento #widgetToast tiene CSS .widget-toast con
   z-index: var(--z-toast) (9000), arriba de cualquier widget.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    var DEFAULT_TTL = 3000;
    var hideTimer = null;

    function ensureToastElement() {
        var el = document.getElementById('widgetToast');
        if (el) return el;
        // El elemento canónico vive en _content.html. Si no está (ej.
        // página standalone tipo reportes públicos), lo creamos al vuelo.
        el = document.createElement('div');
        el.id = 'widgetToast';
        el.className = 'widget-toast';
        (document.body || document.documentElement).appendChild(el);
        return el;
    }

    function showToast(msg, type, ttl) {
        if (msg == null) return;
        var el = ensureToastElement();
        el.textContent = String(msg);
        // type ∈ {success, error, info}. La clase 'widget-toast' base
        // tiene display:none; los modificadores .success/.error/.info
        // ponen display:block y el color. Si llega un type desconocido,
        // usamos 'info' como neutro visible.
        var t = (type || 'info').toString().toLowerCase();
        if (t !== 'success' && t !== 'error' && t !== 'info') t = 'info';
        el.className = 'widget-toast ' + t;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            el.className = 'widget-toast';
        }, typeof ttl === 'number' ? ttl : DEFAULT_TTL);
    }

    // API oficial
    window.toast = showToast;
    window.toast.success = function (msg, ttl) { showToast(msg, 'success', ttl); };
    window.toast.error   = function (msg, ttl) { showToast(msg, 'error',   ttl); };
    window.toast.info    = function (msg, ttl) { showToast(msg, 'info',    ttl); };

    // Alias backward-compat. Solo se setea si NO existe otro showToast
    // global ya definido (algunos archivos antiguos definen el propio
    // ANTES de que cargue este script — no queremos romperlos).
    if (typeof window.showToast !== 'function') {
        window.showToast = showToast;
    }
})();
