/*
 * crm_asistente_oportunidades.js
 *
 * Glue del asistente AI de Oportunidades:
 *   - Wire del botón orb (woBtnAsistente) → window.asistenteAbrir({oportunidad}).
 *   - window.refreshOportunidadDetalle(oppId) → recarga el chat de la
 *     opp para que el resumen guardado por el AI (o el auto-save)
 *     aparezca al instante en la conversación.
 *
 * Mantenemos el código de modo-oportunidad separado del modal del
 * consultor (crm_asistente.js) para no saturar ese archivo cuando
 * mejoremos lo específico de Oportunidades.
 */
(function () {
    'use strict';
    if (window._asistenteOpportunidadesLoaded) return;
    window._asistenteOpportunidadesLoaded = true;

    // Botón orb dentro del composer de la conversación de la opp.
    // Delegación porque el widget se crea/destruye dinámicamente.
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('#woBtnAsistente');
        if (!btn) return;
        e.preventDefault();
        var id = window._woCurrentOppId;
        if (!id) return;
        // Buscamos el título de la opp del DOM (lo pinta woAbrirDetalle).
        var titEl = document.getElementById('woTitle');
        var titulo = titEl ? (titEl.textContent || '').trim() : '';
        if (!titulo) titulo = 'Oportunidad';
        if (typeof window.asistenteAbrir === 'function') {
            window.asistenteAbrir({oportunidad: {id: id, titulo: titulo}});
        }
    });

    /* Refresh hook usado por el asistente AI cuando guarda un resumen
       (manual o auto-save) o crea una actividad — para que la
       conversación o el bloque de actividades se actualicen al
       instante sin tener que cerrar y reabrir el deal. */
    window.refreshOportunidadDetalle = function (oppId) {
        if (!oppId || oppId !== window._woCurrentOppId) return;
        // Refrescar conversación (woCargarNotas viene del widget de opp).
        try {
            if (typeof window.woCargarNotas === 'function') {
                window.woCargarNotas(oppId);
            }
        } catch (e) { /* silent */ }
        // Como fallback robusto: si hay un refetch de calendario global
        // (calGlobalRefetch) lo llamamos para que la nueva actividad
        // aparezca en el calendario también.
        try {
            if (typeof window.calGlobalRefetch === 'function') {
                window.calGlobalRefetch();
            }
        } catch (e) { /* silent */ }
    };
})();
