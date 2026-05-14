/* ═══════════════════════════════════════════════════════════════════════════
 * crm_avance_etapa.js
 * Widget modal bloqueante para describir las próximas tareas antes de
 * confirmar el avance de etapa de una oportunidad.
 *
 * Comportamiento:
 *  - Cuando `api_completar_tarea` responde con `requiere_descripcion: true` y
 *    `avance_pendiente.debe_confirmar_actual: true`, este módulo abre el
 *    overlay con un textarea por cada próxima tarea.
 *  - El usuario tiene que llenar TODAS las descripciones para habilitar el
 *    botón "Confirmar y avanzar".
 *  - Al confirmar, POST a `/app/api/automatizacion/avance-pendiente/<id>/confirmar/`
 *    con `{descripciones: {regla_id: "texto", ...}}`.
 *  - Al éxito: cierra el modal y refresca lo que esté visible (tabla CRM,
 *    widget oportunidad, dashboard ingeniero).
 *  - No tiene botón de cerrar, no responde a ESC, no se cierra con click-fuera.
 *  - Al cargar la página, hace polling al endpoint "mio" para detectar si
 *    el usuario ya tiene un avance pendiente sin confirmar (cerró la tarea
 *    en otro dispositivo o se refrescó la página).
 * ═══════════════════════════════════════════════════════════════════════════
 */
(function () {
    'use strict';

    var OVERLAY_ID = 'widgetAvanceEtapa';
    var _currentPendiente = null;       // datos del avance que se está mostrando
    var _checkingMio = false;           // evitar polls simultáneos

    function $(id) { return document.getElementById(id); }

    function getCsrf() {
        var el = document.querySelector('[name=csrfmiddlewaretoken]');
        if (el) return el.value;
        // Fallback: leer de cookie
        var m = document.cookie.match(/csrftoken=([^;]+)/);
        return m ? m[1] : '';
    }

    function showToast(msg, type, ttl) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg, type || 'info', ttl || 3500);
            return;
        }
        // Fallback: usar #widgetToast directamente.
        var t = document.getElementById('widgetToast');
        if (t) {
            t.textContent = msg;
            t.className = 'widget-toast ' + (type || 'info');
            setTimeout(function () { t.className = 'widget-toast'; }, ttl || 3000);
        } else {
            console.log('[avance-etapa]', msg);
        }
    }

    function setOverlayVisible(visible) {
        var ov = $(OVERLAY_ID);
        if (!ov) return;
        ov.style.display = visible ? 'flex' : 'none';
        document.documentElement.style.overflow = visible ? 'hidden' : '';
        document.body.style.overflow = visible ? 'hidden' : '';
    }

    function escapeHTML(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderProximas(pendiente) {
        var cont = $('waeListContainer');
        if (!cont) return;
        var reglas = (pendiente && pendiente.proximas_reglas) || [];
        if (reglas.length === 0) {
            cont.innerHTML = '<div style="padding:24px;text-align:center;color:#64748B;font-size:0.85rem;">No hay tareas que describir. Puedes confirmar el avance.</div>';
            return;
        }
        var html = '';
        reglas.forEach(function (r, idx) {
            var rid = r.regla_id;
            var titulo = escapeHTML(r.titulo || ('Tarea #' + (idx + 1)));
            var sugerida = escapeHTML(r.descripcion_sugerida || '');
            html += '' +
                '<div class="wae-item" data-regla-id="' + rid + '" style="margin-bottom:18px;padding:14px 16px;border:1.5px solid #E5E7EB;border-radius:12px;background:#fff;transition:border-color 0.15s;">' +
                '  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
                '    <div style="font-weight:600;color:#0F172A;font-size:0.92rem;">' + (idx + 1) + '. ' + titulo + '</div>' +
                '    <span class="wae-status" data-regla-id="' + rid + '" style="font-size:0.7rem;color:#DC2626;font-weight:600;">Falta descripción</span>' +
                '  </div>' +
                '  <textarea class="wae-desc" data-regla-id="' + rid + '" rows="3" placeholder="Describe esta tarea (requerido)…" style="width:100%;box-sizing:border-box;border:1.5px solid #E5E7EB;border-radius:9px;padding:10px 12px;font-size:0.85rem;font-family:inherit;resize:vertical;outline:none;color:#1D1D1F;background:#FAFBFC;">' + sugerida + '</textarea>' +
                '</div>';
        });
        cont.innerHTML = html;

        // Listeners para validar
        cont.querySelectorAll('textarea.wae-desc').forEach(function (ta) {
            ta.addEventListener('input', validar);
            ta.addEventListener('blur', validar);
        });
        validar();
    }

    function validar() {
        var cont = $('waeListContainer');
        if (!cont) return false;
        var textareas = cont.querySelectorAll('textarea.wae-desc');
        var todoOk = true;
        textareas.forEach(function (ta) {
            var rid = ta.getAttribute('data-regla-id');
            var ok = (ta.value || '').trim().length > 0;
            var status = cont.querySelector('span.wae-status[data-regla-id="' + rid + '"]');
            if (status) {
                if (ok) {
                    status.textContent = 'Listo';
                    status.style.color = '#15803d';
                } else {
                    status.textContent = 'Falta descripción';
                    status.style.color = '#DC2626';
                }
            }
            // Visual del contenedor
            var card = ta.closest('.wae-item');
            if (card) card.style.borderColor = ok ? '#bbf7d0' : '#E5E7EB';
            if (!ok) todoOk = false;
        });
        var btn = $('waeConfirmBtn');
        if (btn) {
            btn.disabled = !todoOk;
            btn.style.opacity = todoOk ? '1' : '0.55';
            btn.style.cursor = todoOk ? 'pointer' : 'not-allowed';
        }
        var hint = $('waeFooterHint');
        if (hint) {
            hint.textContent = todoOk
                ? 'Listo. Puedes confirmar el avance.'
                : 'Completa todas las descripciones para continuar.';
        }
        return todoOk;
    }

    function open(pendiente) {
        if (!pendiente || !pendiente.id) return;
        _currentPendiente = pendiente;
        window.__waeLastOppId = pendiente.oportunidad_id || window.__waeLastOppId || null;
        var elActual = $('waeEtapaActual');
        var elSig = $('waeEtapaSiguiente');
        var elOpp = $('waeOppNombre');
        if (elActual) elActual.textContent = pendiente.etapa_actual || '—';
        if (elSig) elSig.textContent = pendiente.etapa_siguiente || '—';
        if (elOpp) elOpp.textContent = pendiente.oportunidad_nombre || '';
        renderProximas(pendiente);
        setOverlayVisible(true);
        // Foco al primer textarea
        setTimeout(function () {
            var first = document.querySelector('#waeListContainer textarea.wae-desc');
            if (first) first.focus();
        }, 60);
    }

    function recolectarDescripciones() {
        var out = {};
        var cont = $('waeListContainer');
        if (!cont) return out;
        cont.querySelectorAll('textarea.wae-desc').forEach(function (ta) {
            var rid = ta.getAttribute('data-regla-id');
            if (!rid) return;
            out[rid] = (ta.value || '').trim();
        });
        return out;
    }

    function confirmar() {
        if (!_currentPendiente || !validar()) return;
        var btn = $('waeConfirmBtn');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.textContent = 'Guardando…'; }

        var url = '/app/api/automatizacion/avance-pendiente/' + encodeURIComponent(_currentPendiente.id) + '/confirmar/';
        fetch(url, {
            method: 'POST',
            headers: {
                'X-CSRFToken': getCsrf(),
                'Content-Type': 'application/json',
            },
            credentials: 'same-origin',
            body: JSON.stringify({ descripciones: recolectarDescripciones() }),
        })
            .then(function (r) { return r.json(); })
            .then(function (resp) {
                if (resp && resp.success) {
                    setOverlayVisible(false);
                    var avance = resp.cadena_reactiva && resp.cadena_reactiva.avances && resp.cadena_reactiva.avances[0];
                    if (avance) {
                        showToast('Oportunidad avanzada a "' + avance.a + '"', 'success', 5000);
                    } else {
                        showToast('Avance confirmado', 'success');
                    }
                    _currentPendiente = null;
                    refrescarPostConfirm();
                } else {
                    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'Confirmar y avanzar'; }
                    showToast((resp && resp.error) || 'No se pudo confirmar el avance', 'error');
                }
            })
            .catch(function () {
                if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'Confirmar y avanzar'; }
                showToast('Error de conexión al confirmar el avance', 'error');
            });
    }

    function refrescarPostConfirm() {
        // Refrescar tabla CRM si está la fn global.
        try { if (typeof window.refreshCrmTable === 'function') window.refreshCrmTable(); } catch (e) {}
        try { if (typeof window.recargarTareasCRM === 'function') window.recargarTareasCRM(); } catch (e) {}
        // Si está abierto el widget de oportunidad, recargarlo.
        try {
            var oppId = _currentPendienteOppId();
            if (oppId && typeof window.openDetalle === 'function') {
                window.openDetalle(oppId);
            }
        } catch (e) {}
        // Refrescar dashboard ingeniero si la fn existe.
        try { if (typeof window.dashFetchStats === 'function') window.dashFetchStats(); } catch (e) {}
    }

    function _currentPendienteOppId() {
        // _currentPendiente ya fue limpiado en confirmar(), pero el oppId
        // estuvo en `_currentPendiente.oportunidad_id` justo antes de limpiar.
        // Por simplicidad guardamos el último id antes de limpiar.
        return window.__waeLastOppId || null;
    }

    function checkMio() {
        if (_checkingMio) return;
        _checkingMio = true;
        fetch('/app/api/automatizacion/avance-pendiente/mio/', {
            credentials: 'same-origin',
        })
            .then(function (r) { return r.json(); })
            .then(function (resp) {
                _checkingMio = false;
                if (resp && resp.success && resp.pendiente) {
                    // Solo abrir si no hay otro avance abierto ya.
                    if (!_currentPendiente) {
                        window.__waeLastOppId = resp.pendiente.oportunidad_id || null;
                        open(resp.pendiente);
                    }
                }
            })
            .catch(function () { _checkingMio = false; });
    }

    // ── API pública ──
    window.crmAvanceEtapa = {
        // Llamado por crm_main.js (u otros) cuando la respuesta de completar
        // contiene `requiere_descripcion: true`. Si el usuario actual debe
        // confirmar, abrimos el modal; si no, sólo mostramos un toast informativo.
        handleCompletarResponse: function (data) {
            if (!data || !data.requiere_descripcion || !data.avance_pendiente) return false;
            var p = data.avance_pendiente;
            window.__waeLastOppId = p.oportunidad_id || null;
            if (p.debe_confirmar_actual) {
                open(p);
                return true;
            } else {
                showToast('Tarea cerrada. El responsable debe confirmar el avance de etapa.', 'info', 5000);
                return false;
            }
        },
        // Para abrir manualmente (debug / pruebas).
        open: open,
        checkMio: checkMio,
    };

    // Botón Confirmar
    document.addEventListener('DOMContentLoaded', function () {
        var btn = $('waeConfirmBtn');
        if (btn) btn.addEventListener('click', confirmar);

        // Bloquear ESC y click-fuera sobre el overlay
        var ov = $(OVERLAY_ID);
        if (ov) {
            ov.addEventListener('click', function (e) {
                // No cerrar nunca: tragamos clicks fuera de la card.
                if (e.target === ov) {
                    e.stopPropagation();
                    e.preventDefault();
                }
            });
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var ov = $(OVERLAY_ID);
                if (ov && ov.style.display !== 'none') {
                    e.stopPropagation();
                    e.preventDefault();
                }
            }
        }, true);

        // Polling inicial: ver si tengo un avance pendiente sin confirmar.
        // Solo si el usuario está logueado (presencia del input csrf).
        if (document.querySelector('[name=csrfmiddlewaretoken]')) {
            setTimeout(checkMio, 1500);
        }
    });
})();
