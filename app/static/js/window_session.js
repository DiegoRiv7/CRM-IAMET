/* ═══════════════════════════════════════════════════════════════════════
   window_session.js — Restauración perezosa de ventanas tras un reload.

   Objetivo (y restricción): que las ventanas abiertas (tareas, ideas,
   prospectos, drives) sobrevivan a un reload accidental SIN penalizar la
   carga de la página. La técnica:

     · NO se persiste contenido ni se reabre nada al cargar. Solo se
       guarda un descriptor LIGERO por ventana: {key, src, title}.
     · Al recargar, se recrean CHIPS MINIMIZADOS en el dock (#wwDock) —
       puro texto, cero iframes, cero fetches → la página carga igual de
       rápido que sin la feature.
     · El iframe/contenido de una ventana se renderiza HASTA que el
       usuario hace clic en su chip (render diferido, una a la vez).

   Costo en runtime: cero polling, cero MutationObservers permanentes. El
   único trabajo extra es un snapshot al SALIR de la página
   (pagehide / visibilitychange→hidden), que recorre un puñado de
   ventanas y escribe ~unos cientos de bytes en sessionStorage.

   sessionStorage (no localStorage): sobrevive al reload (F5) pero se
   limpia al cerrar la pestaña → nadie acumula ventanas-fantasma viejas.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var STORE_KEY = 'crmWindowSession.v1';
    var MAX = 8;  // tope de descriptores guardados (defensa contra basura)

    // Solo opera en el CRM home (donde vive el sistema de ventanas). En las
    // páginas-iframe (/app/widget/...) este script ni se incluye, pero por
    // si acaso: si estamos dentro de un iframe, no hacer nada.
    if (window.top !== window.self) return;

    // ── Singletons de página principal: descriptor derivado cuando están
    //    en VENTANA. (Los 2º+ de cada tipo ya son ventanas-iframe y los
    //    aporta crmIframeWindow.list().) ──
    var MAIN_SINGLETONS = [
        { sel: '#crmTaskDetailModal', idVar: '_crmCurrentTaskId', titleSel: '#crm-task-titulo', urlBase: '/app/widget/tarea/', keyBase: 'tarea:', label: 'Tarea' },
        { sel: '#widgetIdea', idVar: '_currentIdeaId', titleSel: '#wiTitulo', urlBase: '/app/widget/idea/', keyBase: 'idea:', label: 'Idea' },
        { sel: '#widgetProspecto', idVar: '_currentProspectoId', titleSel: '#wpTitle', urlBase: '/app/widget/prospecto/', keyBase: 'prospecto:', label: 'Prospecto' },
    ];

    // chips perezosos pendientes (no expandidos aún): key → {desc, chip}
    var lazy = {};

    function isVisible(el) {
        if (!el) return false;
        var cs = window.getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    function clean(s) { return String(s == null ? '' : s).trim(); }

    // ── Snapshot: junta los descriptores de TODO lo abierto + los chips
    //    perezosos aún no expandidos. Se llama al salir de la página. ──
    function snapshot() {
        var byKey = {};

        // 1) Ventanas-iframe abiertas (tareas 2º+, ideas, prospectos, drives…)
        try {
            if (window.crmIframeWindow && typeof window.crmIframeWindow.list === 'function') {
                window.crmIframeWindow.list().forEach(function (d) {
                    if (d && d.key && d.src) byKey[d.key] = { key: d.key, src: d.src, title: clean(d.title) };
                });
            }
        } catch (e) { /* defensivo */ }

        // 2) Singletons de página principal EN VENTANA (no minimizados).
        MAIN_SINGLETONS.forEach(function (cfg) {
            try {
                var el = document.querySelector(cfg.sel);
                if (!el) return;
                if (!el.classList.contains('ww-windowed')) return;       // solo si es ventana
                if (el.classList.contains('ww-minimized')) { /* sigue contando */ }
                if (!isVisible(el) && !el.classList.contains('ww-minimized')) return;
                var id = window[cfg.idVar];
                if (!id) return;
                var key = cfg.keyBase + id;
                if (byKey[key]) return;  // ya cubierto por una ventana-iframe
                var tEl = document.querySelector(cfg.titleSel);
                var title = cfg.label + ' — ' + clean(tEl && tEl.textContent);
                byKey[key] = { key: key, src: cfg.urlBase + id + '/', title: title };
            } catch (e) { /* defensivo */ }
        });

        // 3) Chips perezosos aún no expandidos (sobreviven a un 2º reload).
        Object.keys(lazy).forEach(function (key) {
            if (!byKey[key]) byKey[key] = lazy[key].desc;
        });

        var list = Object.keys(byKey).map(function (k) { return byKey[k]; }).slice(0, MAX);
        try {
            if (list.length) sessionStorage.setItem(STORE_KEY, JSON.stringify(list));
            else sessionStorage.removeItem(STORE_KEY);
        } catch (e) { /* sessionStorage lleno/denegado → no pasa nada */ }
    }

    // ── Expandir un chip perezoso: AHÍ se renderiza la ventana real. ──
    function expand(key) {
        var entry = lazy[key];
        if (!entry) return;
        var desc = entry.desc;
        // Quitar el chip perezoso antes de abrir (la ventana real puede
        // crear su propio chip si se minimiza después).
        if (entry.chip && entry.chip.parentNode) entry.chip.parentNode.removeChild(entry.chip);
        delete lazy[key];
        cleanupDockIfEmpty();
        if (window.crmIframeWindow && typeof window.crmIframeWindow.open === 'function') {
            try {
                // Tamaño por tipo (la ventana es redimensionable de todas formas).
                var opts = { forceWindow: true, wf: 0.62, maxw: 1180, hf: 0.84 };
                if (String(desc.key).indexOf('drive:') === 0) opts = { forceWindow: true, w: 980, h: 680 };
                window.crmIframeWindow.open(desc.key, desc.src, desc.title || 'Ventana', null, opts);
            } catch (e) { /* si falla, el chip ya se fue; el usuario puede reabrir manualmente */ }
        }
    }

    function dropLazy(key) {
        var entry = lazy[key];
        if (entry && entry.chip && entry.chip.parentNode) entry.chip.parentNode.removeChild(entry.chip);
        delete lazy[key];
        cleanupDockIfEmpty();
        // Re-persistir para que el chip cerrado no reaparezca en otro reload.
        snapshot();
    }

    function cleanupDockIfEmpty() {
        var dock = document.getElementById('wwDock');
        if (dock && !dock.children.length) dock.remove();
    }

    function makeLazyChip(desc) {
        // Reusa el dock y los estilos de widget_window (.ww-dock-chip).
        var dock = (window.crmWidgetWindow && typeof window.crmWidgetWindow.ensureDock === 'function')
            ? window.crmWidgetWindow.ensureDock()
            : (document.getElementById('wwDock') || (function () {
                var d = document.createElement('div'); d.id = 'wwDock'; document.body.appendChild(d); return d;
            })());

        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ww-dock-chip';
        chip.setAttribute('data-ws-restored', '1');
        chip.innerHTML = '<span class="ww-dock-title"></span><span class="ww-dock-close" title="Cerrar">&times;</span>';
        chip.querySelector('.ww-dock-title').textContent = desc.title || 'Ventana';
        chip.addEventListener('click', function (ev) {
            if (ev.target.closest('.ww-dock-close')) {
                ev.stopPropagation();
                dropLazy(desc.key);
                return;
            }
            expand(desc.key);
        });
        chip.classList.add('ww-dock-chip-enter');
        dock.appendChild(chip);
        lazy[desc.key] = { desc: desc, chip: chip };
    }

    // ── Restaurar: leer descriptores y crear chips perezosos. Barato. ──
    function restore() {
        var raw;
        try { raw = sessionStorage.getItem(STORE_KEY); } catch (e) { return; }
        if (!raw) return;
        var list;
        try { list = JSON.parse(raw); } catch (e) { return; }
        if (!Array.isArray(list) || !list.length) return;

        list.forEach(function (desc) {
            if (!desc || !desc.key || !desc.src) return;
            // Si esa ventana YA está abierta (raro en un reload, pero por
            // si Turbo restauró algo), no duplicar.
            if (window.crmIframeWindow && typeof window.crmIframeWindow.get === 'function' &&
                window.crmIframeWindow.get(desc.key)) return;
            if (lazy[desc.key]) return;
            makeLazyChip(desc);
        });
    }

    // ── Bootstrap ──
    // Restaurar una sola vez por carga REAL de página. crmReady re-dispara
    // sus callbacks en CADA navegación Turbo; el flag `restored` (var de
    // módulo) evita re-crear chips en esas navegaciones. En un reload real
    // el módulo se re-evalúa (window fresco) → restored=false → restaura.
    var restored = false;
    if (!window._crmWindowSessionInited) {
        window._crmWindowSessionInited = true;

        var doRestore = function () {
            if (restored) return;
            restored = true;
            try { restore(); } catch (e) { /* nunca romper la carga */ }
        };
        if (window.crmReady) window.crmReady(doRestore);
        else if (document.readyState !== 'loading') doRestore();
        else document.addEventListener('DOMContentLoaded', doRestore);

        // Snapshot al salir. pagehide es el evento confiable (cubre F5,
        // cierre y bfcache); visibilitychange→hidden como respaldo en
        // móviles donde pagehide a veces no dispara.
        window.addEventListener('pagehide', function () { try { snapshot(); } catch (e) { } });
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') { try { snapshot(); } catch (e) { } }
        });
    }

    // API mínima de depuración / control manual.
    window.crmWindowSession = {
        snapshot: snapshot,
        restore: restore,
        clear: function () { try { sessionStorage.removeItem(STORE_KEY); } catch (e) { } },
        _lazy: function () { return Object.keys(lazy); },
    };
})();
