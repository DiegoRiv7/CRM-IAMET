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

    /* Abre el composer del módulo Mail con un correo pre-llenado por
       el AI (tool preparar_correo_seguimiento). El AI ya redactó —
       aquí solo abrimos la UI y llenamos campos. El user revisa y
       envía. Si se envía, el correo queda vinculado a la opp y
       aparece en la conversación (lógica existente del módulo Mail).
       NO gastamos tokens en esto — es puro DOM. */
    window.woAbrirComposerConPrellenado = function (correo) {
        if (!correo) return;
        var oppId = window._woCurrentOppId;
        if (!oppId) return;
        var detail = window._woCurrentOppData || {};

        // Setear el contexto de la opp para que al enviar el correo
        // quede vinculado (igual que woConvAbrirCorreoComposer hace).
        window._mailCorreoContextoOppId = oppId;
        window._mailCorreoContextoOppNombre = (detail.nombre || detail.oportunidad || '');

        // Si es reply, el módulo Mail tiene su propia lógica via
        // mailResponder. Por ahora abrimos el composer nuevo y
        // prefileamos asunto/cuerpo/destinatario — el threading via
        // in_reply_to lo manejará el backend si message_id está en
        // _mailCorreoContextoInReplyTo (header IMAP).
        if (correo.in_reply_to) {
            window._mailCorreoContextoInReplyTo = correo.in_reply_to;
        }

        // Abrir Mail por encima del chat. Replica _abrirMailEncima del
        // widget de opp (que vive en su IIFE, no accesible desde aquí).
        if (typeof window.mailAbrir !== 'function') return;
        window.mailAbrir();
        var mailWidget = document.getElementById('widgetMail');
        if (mailWidget) mailWidget.style.zIndex = '11000';

        setTimeout(function () {
            if (typeof window.mailRedactar === 'function') window.mailRedactar();
            setTimeout(function () {
                // Para (destinatario)
                var paraEl = document.getElementById('mailCompPara');
                if (paraEl && correo.destinatario_email) {
                    paraEl.value = correo.destinatario_email;
                }
                // Asunto
                var asuntoEl = document.getElementById('mailCompAsunto');
                if (asuntoEl) asuntoEl.value = correo.asunto || '';
                // Cuerpo en el editor contenteditable
                var editorEl = document.getElementById('mailCompEditor');
                if (editorEl) {
                    // Sustituimos saltos de línea por <br> para el editor HTML.
                    var html = (correo.cuerpo || '')
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/\n/g, '<br>');
                    editorEl.innerHTML = html;
                    editorEl.focus();
                    // Colocar el cursor al final
                    try {
                        var range = document.createRange();
                        range.selectNodeContents(editorEl);
                        range.collapse(false);
                        var sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                    } catch (e) { /* silent */ }
                }
            }, 150);
        }, 250);
    };

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
