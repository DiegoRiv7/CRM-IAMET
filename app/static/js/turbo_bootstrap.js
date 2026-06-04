/* ═══════════════════════════════════════════════════════════════════════
 * turbo_bootstrap.js — Configuración de Turbo Drive para el CRM IAMET.
 *
 * Turbo Drive convierte las navegaciones internas en AJAX (sin full
 * reload). El resultado para usuarios: clickear "Calendario" desde
 * "CRM" se siente instantáneo en lugar de pantalla en blanco + reload.
 *
 * ESTRATEGIA: modo "opt-in"
 *   Turbo Drive está DESACTIVADO globalmente (Turbo.session.drive = false).
 *   Solo los <a> que llevan explícitamente `data-turbo="true"` son
 *   interceptados. Esto limita el blast-radius — si rompe algo, rompe
 *   sólo en links activados, no en toda la app.
 *
 *   Los links activados se definen en _sidebar.html y otros templates
 *   de navegación principal.
 *
 * LO QUE NO toca:
 *   - Formularios con submit normal (siguen funcionando full reload)
 *   - Downloads (PDF, Excel, CSV) — irrelevante con drive=false
 *   - Iframes (mail, cfdi convertidor) — Turbo no toca iframes
 *   - Links externos
 *   - Login / Logout
 *
 * EVENTOS QUE MANEJAMOS:
 *   - turbo:before-cache: limpia widgets/modales/toasts antes de cachear
 *     la página (si no, al volver con back-button aparecen abiertos).
 *   - turbo:load: ya lo maneja crm_ready.js (re-dispara crmReady callbacks).
 *   - turbo:fetch-request-error: log de errores de fetch para debugging.
 *
 * CONVENCIÓN DE CARGA:
 *   Este archivo se carga DESPUÉS de Turbo Drive (turbo.es2017-umd.js)
 *   y DESPUÉS de crm_ready.js. Ambos están en <head> de base.html.
 * ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    if (!window.Turbo) {
        console.warn('[turbo_bootstrap] Turbo no está cargado — el bootstrap no aplica.');
        return;
    }

    // ── Modo opt-in: Turbo NO intercepta links por defecto ──
    // Solo los <a data-turbo="true"> activan navegación Turbo. Esto es
    // crítico para no romper downloads, iframes, forms, etc.
    window.Turbo.session.drive = false;

    window.crmTurboEnabled = true;

    // ── turbo:before-cache: limpiar antes de cachear ──
    // Cuando Turbo va a cachear la página actual (para back-button),
    // cerramos widgets/modales/toasts. Si no, al regresar con back
    // aparecen abiertos en estado raro.
    document.addEventListener('turbo:before-cache', function () {
        try {
            // Cerrar cualquier widget activo
            document.querySelectorAll('.widget-overlay.active').forEach(function (ov) {
                ov.classList.remove('active');
                ov.classList.remove('closing');
            });
            // Cerrar spotlight y ayuda modales
            var sp = document.getElementById('spotlight-modal');
            if (sp) sp.classList.remove('active');
            var ay = document.getElementById('ayuda-modal');
            if (ay) ay.classList.remove('active');
            // Limpiar toasts visibles
            document.querySelectorAll('.crm-toast, .widget-toast.show').forEach(function (t) {
                t.classList.remove('show');
            });
        } catch (e) {
            console.error('[turbo_bootstrap] error en before-cache:', e);
        }
    });

    // ── turbo:fetch-request-error: logging de errores ──
    // Si Turbo no puede hacer fetch (servidor caído, timeout, etc.),
    // logueamos para diagnóstico en vez de fallar en silencio.
    document.addEventListener('turbo:fetch-request-error', function (event) {
        console.error('[turbo_bootstrap] fetch error:', event.detail);
    });

    // ── turbo:load: ya lo maneja crm_ready.js ──
    // No agregar otro listener aquí — crm_ready.js re-dispara los
    // callbacks de crmReady() en cada turbo:load.

    // ── Prefetch on hover ──
    // Cuando el cursor pasa sobre un link Turbo, fetcheamos su HTML en
    // background. Cuando el usuario hace click, la página ya está cargada
    // = navegación SIENTE instantánea (no hay que esperar al server).
    // Aplica solo a links con data-turbo="true" (los del sidebar).
    // Costo: 1 fetch extra por hover (mitigado por el cache del navegador).
    try {
        window.Turbo.session.preloadOnHover = true;
    } catch (e) {
        // Algunas versiones de Turbo no exponen esta opción; intentar la
        // forma alternativa via setAttribute en el documento.
        try { document.documentElement.setAttribute('data-turbo-preload', 'true'); }
        catch (e2) { /* noop */ }
    }

    // ── Helper window.crmNav(url) ──
    // Navegación programática desde JS. Usa Turbo.visit() si Turbo está
    // cargado (navegación SPA, sin reload), si no cae a window.location.href.
    //
    // Útil en lugar de `window.location.href = 'X'` directamente. Ej:
    //   onclick="crmNav('/app/home/?tab=crm')"
    //
    // El sidebar/topbar la usan para los botones con onclick (cuando no
    // son <a> puros). Los <a> con data-turbo="true" no necesitan esto —
    // Turbo los intercepta automáticamente.
    window.crmNav = function (url) {
        if (window.Turbo && typeof window.Turbo.visit === 'function') {
            window.Turbo.visit(url);
        } else {
            window.location.href = url;
        }
    };

})();
