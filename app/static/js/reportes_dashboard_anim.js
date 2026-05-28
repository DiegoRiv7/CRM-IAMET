/* ═══════════════════════════════════════════════════════════════════
 * reportes_dashboard_anim.js
 * Bridge SPA Dashboard ↔ Reportes.
 *
 * Cuando un reporte se carga DENTRO del iframe del dashboard
 * (?embedded=1 en la URL), este script:
 *
 *   1) Aplica body.rep-embedded → oculta el sidebar (que ya vive en el
 *      dashboard padre) y maximiza el main.
 *   2) Inyecta un botón "← Dashboard" al inicio del header del reporte.
 *      Su click envía postMessage({type:'rep:close'}) al parent — el
 *      dashboard cierra el iframe con animación inversa.
 *   3) Intercepta clicks en los .rep-tabs del dynamic island del header
 *      del reporte. En lugar de navegar (que recargaría el iframe), envía
 *      postMessage({type:'rep:navigate', slug:'...'}) al parent — el
 *      dashboard cambia el iframe.src sin reload de la página principal.
 *   4) Sobreescribe window.openDetalle y window.openClienteModal para
 *      que envíen postMessage al parent. Así los widgets de oportunidad
 *      / cliente se abren en el contexto del dashboard, no dentro del
 *      iframe (donde quedarían "encajonados").
 *   5) Aplica animación de "barrido" al header del reporte al cargar.
 *
 * Cuando un reporte se abre directo (sin iframe, navegación normal a
 * /app/reportes/<slug>/), este script es no-op — el reporte funciona
 * como página independiente.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var DASHBOARD_FALLBACK_URL = '/app/home/?tab=clientes';

    function isEmbedded() {
        try {
            return new URL(window.location.href).searchParams.get('embedded') === '1';
        } catch (e) {
            return false;
        }
    }

    function inIframe() {
        try { return window.self !== window.top; } catch (e) { return true; }
    }

    function buildBackBtn() {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'repBackToDashboard';
        btn.className = 'rep-back-to-dashboard';
        btn.title = 'Volver al Dashboard';
        btn.innerHTML =
            '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
            + '<span>Dashboard</span>';
        return btn;
    }

    function postToParent(msg) {
        try {
            (window.parent || window.opener || window).postMessage(msg, '*');
        } catch (e) { /* defensivo */ }
    }

    function navigateBack(embedded) {
        var header = document.querySelector('.rep-header');
        if (header) header.classList.add('rep-header-sliding-out-right');
        setTimeout(function () {
            if (embedded) {
                postToParent({ type: 'rep:close' });
            } else {
                window.location.href = DASHBOARD_FALLBACK_URL;
            }
        }, 240);
    }

    function slugFromHref(href) {
        try {
            var u = new URL(href, window.location.origin);
            var m = u.pathname.match(/^\/app\/reportes\/([^\/?#]+)/);
            return m ? m[1] : null;
        } catch (e) { return null; }
    }

    document.addEventListener('DOMContentLoaded', function () {
        var embedded = isEmbedded();

        // Modo embedded: ocultar sidebar via body class + sobreescribir
        // funciones de widgets para que se abran en el padre.
        if (embedded) {
            document.body.classList.add('rep-embedded');

            // Wrappers de openDetalle / openClienteModal → postMessage al
            // parent. crm_main.js (que viene en _scripts_main.html) ya las
            // definió antes; las sobreescribimos para SPA.
            window.openDetalle = function (id) {
                postToParent({ type: 'rep:opendetalle', id: id });
            };
            window.openClienteModal = function (id, nombre, tab) {
                postToParent({ type: 'rep:opencliente', id: id, nombre: nombre || '', tab: tab || 'oportunidades' });
            };
        }

        var header = document.querySelector('.rep-header');
        if (!header) return;

        // Animación de entrada del header (slide desde la derecha).
        header.classList.add('rep-header-sliding-in-from-right');
        setTimeout(function () {
            header.classList.remove('rep-header-sliding-in-from-right');
        }, 350);

        // En modo embedded el dynamic island con tabs vive en el dashboard
        // padre, no aquí — el CSS body.rep-embedded oculta .rep-tabs y
        // .rep-back-to-dashboard. Por eso solo inyectamos el botón "←
        // Dashboard" cuando NO estamos embedded (caso legacy: usuario
        // que llegó directo a la URL /app/reportes/<slug>/, sin pasar
        // por el iframe).
        if (!embedded) {
            var izq = header.querySelector('.rep-plantillas') || header;
            var existingBack = izq.querySelector('a[href="/app/reportes/"], a[href^="/app/reportes/"]:not(.rep-tab)');
            if (existingBack) existingBack.style.display = 'none';

            var btn = buildBackBtn();
            if (izq.firstChild) {
                izq.insertBefore(btn, izq.firstChild);
            } else {
                izq.appendChild(btn);
            }
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                navigateBack(false);
            });
        }

        // ESC vuelve al dashboard (atajo natural). Respeta drawer/popover
        // abierto: ESC ahí los cierra primero.
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            var drawerOpen = document.querySelector('.rep-drawer.open, .repp-popover.open');
            if (drawerOpen) return;
            navigateBack(embedded);
        });
    });
})();
