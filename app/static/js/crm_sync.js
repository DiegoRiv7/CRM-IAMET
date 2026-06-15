/* ═══════════════════════════════════════════════════════════════════════
 * crm_sync.js — CÓDIGO NUEVO (desde 2026-06-10)
 *
 * Sync entre usuarios por polling ligero. Resuelve la queja: "B sube un
 * documento / cambia una etapa y A tiene que recargar para verlo".
 *
 * Cómo: cada ~20s pregunta a /app/api/sync/cambios/?since=<cursor> qué
 * cambió desde la última vez (cursor = PK del último cambio visto; la
 * query del server es un index-scan con LIMIT — microsegundos). Cada
 * cambio se re-emite a window.crmDataBus con el MISMO nombre canónico
 * de entidad — y toda la maquinaria reactiva existente (kanban, ventanas
 * de oportunidad, tareas, calendario, drive) se refresca sola.
 *
 * Salvaguardas para NO saturar ni alentar la página:
 *   · Pestaña oculta → CERO polls (visibilitychange pausa/reanuda; al
 *     volver, poll inmediato para ponerse al día).
 *   · Respuesta vacía típica: ~60 bytes. Solo hay trabajo si HUBO cambios.
 *   · Backoff exponencial en errores (hasta 5 min) — un server caído no
 *     recibe martilleo; se resetea al primer éxito.
 *   · Jitter ±20% — N usuarios no disparan al mismo segundo.
 *   · El server deduplica por (entidad, objeto) y los consumidores del
 *     bus ya están debounced — 50 saves de la misma opp = 1 refresh.
 *   · Cursor en sessionStorage: una navegación no re-procesa lo ya visto.
 * ═══════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    var BASE_INTERVAL = 20000;   // 20s con pestaña visible
    var MAX_INTERVAL = 300000;   // tope de backoff: 5 min
    var CURSOR_KEY = '_crm_sync_cursor';

    // En Modo Ligero el polling de sync baja a 45s: menos CPU/red en
    // equipos viejos (o con carga externa). El sync sigue funcionando,
    // solo refresca un poco menos seguido.
    function baseInterval() {
        return document.body.classList.contains('ww-lite') ? 45000 : BASE_INTERVAL;
    }

    var interval = baseInterval();
    var timer = null;
    var inFlight = false;

    function getCursor() {
        try { return sessionStorage.getItem(CURSOR_KEY); } catch (e) { return null; }
    }

    function setCursor(c) {
        try { sessionStorage.setItem(CURSOR_KEY, String(c)); } catch (e) { }
    }

    function jitter(ms) {
        return Math.round(ms * (0.8 + Math.random() * 0.4));
    }

    function schedule(ms) {
        clearTimeout(timer);
        timer = setTimeout(poll, jitter(ms));
    }

    function emitir(cambios) {
        if (!window.crmDataBus || !cambios || !cambios.length) return;
        cambios.forEach(function (c) {
            try {
                window.crmDataBus.emit(c.entidad, c.accion, c.id, c.extra || null);
            } catch (e) { /* un cambio malformado no debe frenar el resto */ }
        });
    }

    function poll() {
        if (document.visibilityState === 'hidden') return;  // se reanuda en visibilitychange
        if (inFlight) { schedule(interval); return; }
        if (!window.crmDataBus) { schedule(interval); return; }

        var cursor = getCursor();
        var url = '/app/api/sync/cambios/' + (cursor ? '?since=' + encodeURIComponent(cursor) : '');
        inFlight = true;

        fetch(url, { credentials: 'same-origin' })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                inFlight = false;
                if (!data.ok) throw new Error(data.error || 'sync error');
                if (data.cursor !== undefined && data.cursor !== null) setCursor(data.cursor);
                emitir(data.cambios);
                interval = baseInterval();  // éxito → reset del backoff
                schedule(interval);
            })
            .catch(function (err) {
                inFlight = false;
                interval = Math.min(interval * 2, MAX_INTERVAL);
                console.warn('[crmSync] poll falló, reintentando en', Math.round(interval / 1000) + 's:', err.message);
                schedule(interval);
            });
    }

    if (!window._crmSyncWired) {
        window._crmSyncWired = true;

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                // Al volver a la pestaña: ponerse al día de inmediato.
                interval = baseInterval();
                schedule(400);
            } else {
                clearTimeout(timer);  // pestaña oculta: cero tráfico
            }
        });

        // Primer poll a los pocos segundos del load (deja respirar el boot);
        // la primera llamada solo trae el cursor (sin histórico).
        window.crmReady(function () {
            schedule(4000);
        });
    }

    // ── Consumidores propios del sync ──────────────────────────────────
    // La mayoría de las entidades ya tienen consumidores en
    // widget_data_bus.js / los widgets. Aquí solo los que nacieron con
    // el sync y no tienen dueño natural:
    //   · comentario-tarea → recargar el feed del detalle de tarea abierto
    //     (hook _crmTaskRecargarComentarios expuesto por crm_main).
    window.crmReady(function () {
        if (window._crmSyncConsumersWired || !window.crmDataBus) return;
        window._crmSyncConsumersWired = true;
        window.crmDataBus.on('comentario-tarea', function (d) {
            if (typeof window._crmTaskRecargarComentarios === 'function') {
                try { window._crmTaskRecargarComentarios(d.extra && d.extra.tarea_id); } catch (e) { }
            }
        });
        // Prospectos: si otro usuario crea/edita/mueve un prospecto y tengo
        // el kanban de prospección abierto, refrescarlo in-place (la función
        // hace swap del board vía crmApplyPeriod; sin board presente, no-op).
        var prospectoTimer = null;
        window.crmDataBus.on('prospecto', function () {
            if (!document.getElementById('pkKanbanBoard')) return;
            clearTimeout(prospectoTimer);
            prospectoTimer = setTimeout(function () {
                if (typeof window.recargarProspectosKanban === 'function') {
                    try { window.recargarProspectosKanban(); } catch (e) { }
                }
            }, 800);
        });
    });

    // Debug en consola: crmSync.now() fuerza un poll.
    window.crmSync = {
        now: function () { clearTimeout(timer); poll(); },
        cursor: getCursor,
    };
})();
