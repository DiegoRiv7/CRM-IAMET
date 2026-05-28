/* ═══════════════════════════════════════════════════════════════════
 * reportes_dashboard_anim.js
 * Bridge entre el Dashboard del CRM y el módulo de Reportes.
 *
 * Cuando el usuario entra al módulo de Reportes desde el tab "Reportes"
 * de la dynamic island del Dashboard, esa navegación trae un query
 * param `?from=dashboard`. Este script:
 *
 *   1) Detecta la flag.
 *   2) Aplica una animación de "barrido hacia la izquierda" al header
 *      del reporte (.rep-header) — entra desde la derecha.
 *   3) Inyecta un botón "← Dashboard" al inicio del bloque izquierdo
 *      del header (.rep-plantillas), antes del Ordenar / Volver.
 *   4) Al hacer click en el botón Dashboard: anima slide-out-to-right
 *      y navega a /app/home/?tab=clientes&from=reportes. El dashboard
 *      detecta `from=reportes` y reproduce la animación inversa al
 *      cargar — sensación de "barrido de regreso" sin que sea SPA real.
 *
 * Para incluir en cualquier template de reporte basta con cargar este
 * archivo después del JS específico del reporte y del reportes.css.
 * Los 4 templates de reportes lo incluyen.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var DASHBOARD_URL = '/app/home/?tab=clientes&from=reportes';

    function getFlag() {
        try {
            return new URL(window.location.href).searchParams.get('from') === 'dashboard';
        } catch (e) {
            return false;
        }
    }

    // Botón "← Dashboard" inyectado al inicio de .rep-plantillas. Imita el
    // estilo del botón Ordenar (.rep-sort-btn) para no romper el header,
    // pero con un acento más sutil porque es "navegación", no acción.
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

    function navigateBack() {
        var header = document.querySelector('.rep-header');
        if (header) header.classList.add('rep-header-sliding-out-right');
        // Esperar a que termine la animación antes de navegar.
        setTimeout(function () {
            window.location.href = DASHBOARD_URL;
        }, 240);
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!getFlag()) return;
        var header = document.querySelector('.rep-header');
        if (!header) return;

        // Activar animación de entrada (slide desde la derecha).
        header.classList.add('rep-header-sliding-in-from-right');
        setTimeout(function () {
            header.classList.remove('rep-header-sliding-in-from-right');
        }, 350);

        // Inyectar botón "← Dashboard" al inicio del bloque izquierdo.
        // Si .rep-plantillas no existe (algún template viejo), usamos el
        // propio header como host.
        var izq = header.querySelector('.rep-plantillas') || header;

        // El Personalizado YA tiene su propio botón "← Volver a Reportes"
        // como primer hijo. Cuando venimos del Dashboard, ese botón pierde
        // sentido (porque el "/app/reportes/" index ahora es el Dashboard
        // del CRM). Lo ocultamos para no duplicar acción de "back".
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
            navigateBack();
        });

        // Propagar la flag ?from=dashboard a los tabs del dynamic island
        // del header (Abiertas / Cerradas / Por Cliente / Personalizado).
        // Sin esto, al cambiar entre reportes la flag se pierde y el
        // botón "← Dashboard" desaparece a partir del segundo reporte.
        document.querySelectorAll('.rep-tabs .rep-tab').forEach(function (t) {
            if (t.tagName !== 'A' || !t.href) return;
            try {
                var u = new URL(t.href, window.location.origin);
                u.searchParams.set('from', 'dashboard');
                t.setAttribute('href', u.pathname + u.search);
            } catch (_) { /* defensivo */ }
        });

        // ESC también vuelve al dashboard (atajo natural).
        document.addEventListener('keydown', function (e) {
            // No interceptar si hay un drawer / modal abierto: los
            // reportes usan ESC para cerrar drawer/menu.
            var drawerOpen = document.querySelector('.rep-drawer.open, .repp-popover.open');
            if (drawerOpen) return;
            if (e.key === 'Escape') navigateBack();
        });
    });
})();
