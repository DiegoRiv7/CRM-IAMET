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

    // ── turbo:before-render: limpiar stack del widget manager ──
    // Antes de que Turbo reemplace el body, sacamos del stack las
    // referencias a widgets que están a punto de ser destruidos. Sin
    // esto, el breadcrumb del widget manager muestra widgets fantasma.
    document.addEventListener('turbo:before-render', function () {
        try {
            if (window.crmWidgetStack && typeof window.crmWidgetStack.cleanup === 'function') {
                window.crmWidgetStack.cleanup();
            }
        } catch (e) {
            console.error('[turbo_bootstrap] error en before-render:', e);
        }
    });

    // ── turbo:load: cleanup del stack ──
    document.addEventListener('turbo:load', function () {
        try {
            if (window.crmWidgetStack && typeof window.crmWidgetStack.cleanup === 'function') {
                window.crmWidgetStack.cleanup();
            }
        } catch (e) { /* noop */ }
    });

    // ── turbo:fetch-request-error: logging de errores ──
    // Si Turbo no puede hacer fetch (servidor caído, timeout, etc.),
    // logueamos para diagnóstico en vez de fallar en silencio.
    //
    // AbortError es ESPERADO cuando el usuario navega antes de que el
    // prefetch on hover termine. Lo silenciamos para no ensuciar consola.
    document.addEventListener('turbo:fetch-request-error', function (event) {
        var err = event && event.detail && event.detail.error;
        if (err && err.name === 'AbortError') return;
        console.error('[turbo_bootstrap] fetch error:', event.detail);
    });

    // Silenciar también el unhandled promise rejection de AbortError de
    // fetches sin AbortController (no son críticos — el browser canceló
    // el request porque el usuario navegó).
    window.addEventListener('unhandledrejection', function (event) {
        var err = event && event.reason;
        if (err && err.name === 'AbortError') {
            event.preventDefault();
        }
    });

    // ── turbo:load: ya lo maneja crm_ready.js ──
    // No agregar otro listener aquí — crm_ready.js re-dispara los
    // callbacks de crmReady() en cada turbo:load.

    // ── Prefetch on hover ──
    // Turbo 8+ hace prefetch automáticamente al hacer hover sobre un link
    // <a data-turbo="true"> visible en viewport — el HTML llega antes del
    // click. Cuando el usuario hace click, navegación SIENTE instantánea.
    // No requiere configuración explícita; está activo por default.

    // ── Ocultar Turbo Progress Bar ──
    // Por defecto Turbo muestra una barra azul en la parte superior si
    // el fetch tarda más de 500ms. En este sistema, eso genera "flash"
    // visual después de que el contenido ya se mostró (cached + fresh
    // render). Mejor sin ella — el usuario ya tiene el contenido, no
    // necesita ver progreso de un fetch que termina detrás de escenas.
    try {
        window.Turbo.session.progressBarDelay = 999999;  // efectivamente nunca
    } catch (e) { /* noop si la API cambió */ }

    // Backup CSS por si la API JS no funciona en alguna versión:
    var _styleProgress = document.createElement('style');
    _styleProgress.textContent = '.turbo-progress-bar { display: none !important; visibility: hidden !important; }';
    document.head.appendChild(_styleProgress);

    // ── Reducir flicker del cached → fresh render ──
    // Cuando Turbo muestra una versión cacheada y después llega el fresh
    // del server, hace un re-render que puede sentirse como parpadeo.
    // turbo:before-cache marca el body con `data-turbo-preview` y al
    // recibir el fresh lo quita; podemos ocultar transiciones durante
    // ese momento para que el cambio sea menos visible.
    var _styleNoFlash = document.createElement('style');
    _styleNoFlash.textContent = 'html[data-turbo-preview] * { transition: none !important; animation: none !important; }';
    document.head.appendChild(_styleNoFlash);

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
