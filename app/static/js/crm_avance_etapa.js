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
    var _usuariosCache = null;          // lista de usuarios cargada una sola vez
    var _usuariosLoading = false;

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

    function _buildUsuariosOptions(selectedId) {
        var opts = '<option value="">— sin asignar —</option>';
        (_usuariosCache || []).forEach(function (u) {
            if (!u.is_active) return;
            var name = (u.first_name + ' ' + u.last_name).trim() || u.username;
            var sel = String(selectedId) === String(u.id) ? ' selected' : '';
            opts += '<option value="' + u.id + '"' + sel + '>' + escapeHTML(name) + '</option>';
        });
        return opts;
    }

    function _populateResponsableSelects() {
        var cont = $('waeListContainer');
        if (!cont) return;
        cont.querySelectorAll('select.wae-responsable').forEach(function (sel) {
            var current = sel.getAttribute('data-current') || '';
            sel.innerHTML = _buildUsuariosOptions(current);
        });
    }

    function ensureUsuariosLoaded() {
        if (_usuariosCache || _usuariosLoading) return;
        _usuariosLoading = true;
        fetch('/app/api/admin/usuarios/', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                _usuariosLoading = false;
                _usuariosCache = (data && data.usuarios) || [];
                _populateResponsableSelects();
            })
            .catch(function () { _usuariosLoading = false; });
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
            var respId = r.responsable_id || '';
            var respNombre = escapeHTML(r.responsable_nombre || 'Sin asignar');
            // El select se rellena cuando _usuariosCache esté listo. Mientras
            // tanto mostramos solo la opción actual para que se vea el nombre.
            var initialOption = respId
                ? '<option value="' + respId + '" selected>' + respNombre + '</option>'
                : '<option value="">— sin asignar —</option>';
            html += '' +
                '<div class="wae-item" data-regla-id="' + rid + '" style="margin-bottom:18px;padding:14px 16px;border:1.5px solid #E5E7EB;border-radius:12px;background:#fff;transition:border-color 0.15s;">' +
                '  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
                '    <span style="font-weight:700;color:#94A3B8;font-size:0.78rem;flex-shrink:0;">' + (idx + 1) + '.</span>' +
                '    <input class="wae-titulo" data-regla-id="' + rid + '" type="text" value="' + titulo + '" placeholder="Título de la tarea" style="flex:1;border:none;border-bottom:1.5px dashed transparent;background:transparent;font-weight:600;color:#0F172A;font-size:0.92rem;padding:2px 4px;outline:none;font-family:inherit;transition:border-color 0.15s,background 0.15s;">' +
                '    <span class="wae-status" data-regla-id="' + rid + '" style="font-size:0.7rem;color:#DC2626;font-weight:600;flex-shrink:0;">Falta descripción</span>' +
                '  </div>' +
                '  <textarea class="wae-desc" data-regla-id="' + rid + '" rows="3" placeholder="Describe esta tarea (requerido)…" style="width:100%;box-sizing:border-box;border:1.5px solid #E5E7EB;border-radius:9px;padding:10px 12px;font-size:0.85rem;font-family:inherit;resize:vertical;outline:none;color:#1D1D1F;background:#FAFBFC;">' + sugerida + '</textarea>' +
                '  <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">' +
                '    <svg width="13" height="13" fill="none" stroke="#64748B" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>' +
                '    <label style="font-size:0.74rem;font-weight:600;color:#64748B;letter-spacing:0.02em;flex-shrink:0;">Responsable:</label>' +
                '    <select class="wae-responsable" data-regla-id="' + rid + '" data-current="' + respId + '" style="flex:1;border:1px solid #E5E7EB;border-radius:7px;padding:6px 8px;font-size:0.82rem;font-family:inherit;background:#fff;color:#1D1D1F;outline:none;">' +
                       initialOption +
                '    </select>' +
                '  </div>' +
                '</div>';
        });
        cont.innerHTML = html;

        // Si ya hay usuarios cargados, poblamos los selects de una. Si no,
        // disparamos el fetch y se poblan cuando llegue.
        if (_usuariosCache) {
            _populateResponsableSelects();
        } else {
            ensureUsuariosLoaded();
        }

        // Listeners para validar y para feedback visual del input título
        cont.querySelectorAll('textarea.wae-desc').forEach(function (ta) {
            ta.addEventListener('input', validar);
            ta.addEventListener('blur', validar);
        });
        cont.querySelectorAll('input.wae-titulo').forEach(function (inp) {
            inp.addEventListener('focus', function () {
                inp.style.borderBottomColor = '#3b82f6';
                inp.style.background = '#f8fafc';
            });
            inp.addEventListener('blur', function () {
                inp.style.borderBottomColor = 'transparent';
                inp.style.background = 'transparent';
            });
            inp.addEventListener('input', validar);
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
            var tituloEl = cont.querySelector('input.wae-titulo[data-regla-id="' + rid + '"]');
            var descOk = (ta.value || '').trim().length > 0;
            var titOk = tituloEl ? (tituloEl.value || '').trim().length > 0 : true;
            var ok = descOk && titOk;
            var status = cont.querySelector('span.wae-status[data-regla-id="' + rid + '"]');
            if (status) {
                if (ok) {
                    status.textContent = 'Listo';
                    status.style.color = '#15803d';
                } else if (!titOk) {
                    status.textContent = 'Falta título';
                    status.style.color = '#DC2626';
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
        var elOppText = $('waeOppNombreText');
        var elOppBtn = $('waeOppNombre');
        if (elActual) elActual.textContent = pendiente.etapa_actual || '—';
        if (elSig) elSig.textContent = pendiente.etapa_siguiente || '—';
        if (elOppText) elOppText.textContent = pendiente.oportunidad_nombre || 'Sin oportunidad';
        if (elOppBtn) elOppBtn.style.display = pendiente.oportunidad_id ? 'inline-flex' : 'none';
        renderProximas(pendiente);
        setOverlayVisible(true);
        // Foco al primer textarea
        setTimeout(function () {
            var first = document.querySelector('#waeListContainer textarea.wae-desc');
            if (first) first.focus();
        }, 60);
    }

    // Abre el widget de oportunidad encima del avance (z-index .z-above-avance
    // = 12000). El widget de avance queda atrás pero VISIBLE (no se cierra)
    // para que el usuario pueda regresar a llenar las descripciones.
    function abrirOportunidad() {
        var oppId = (_currentPendiente && _currentPendiente.oportunidad_id) || window.__waeLastOppId;
        if (!oppId) return;
        // Marcar widgetDetalle para que se renderice por encima del avance.
        var dl = document.getElementById('widgetDetalle');
        if (dl) dl.classList.add('z-above-avance');
        // Hook al close del widgetDetalle: cuando el usuario lo cierre, limpiar
        // la clase. La función oficial de cierre es `cerrarDetalle` (crm_main.js).
        if (typeof window.openDetalle === 'function') {
            window.openDetalle(oppId);
            // Limpiar la clase cuando el widget se cierre. Como no hay un evento
            // global, parchamos cerrarDetalle una vez para que también remueva
            // la clase. Es idempotente.
            if (!window.__waeCerrarDetallePatched && typeof window.cerrarDetalle === 'function') {
                var origCerrar = window.cerrarDetalle;
                window.cerrarDetalle = function () {
                    try {
                        var d = document.getElementById('widgetDetalle');
                        if (d) d.classList.remove('z-above-avance');
                    } catch (_) {}
                    return origCerrar.apply(this, arguments);
                };
                window.__waeCerrarDetallePatched = true;
            }
        }
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

    function recolectarTitulos() {
        var out = {};
        var cont = $('waeListContainer');
        if (!cont) return out;
        cont.querySelectorAll('input.wae-titulo').forEach(function (inp) {
            var rid = inp.getAttribute('data-regla-id');
            if (!rid) return;
            out[rid] = (inp.value || '').trim();
        });
        return out;
    }

    function recolectarResponsables() {
        var out = {};
        var cont = $('waeListContainer');
        if (!cont) return out;
        cont.querySelectorAll('select.wae-responsable').forEach(function (sel) {
            var rid = sel.getAttribute('data-regla-id');
            if (!rid) return;
            var v = sel.value;
            if (v) out[rid] = parseInt(v, 10);
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
            body: JSON.stringify({
                descripciones: recolectarDescripciones(),
                titulos: recolectarTitulos(),
                responsables: recolectarResponsables(),
            }),
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

    // ══════════════════════════════════════════════════════════════════
    // KILL SWITCH (urgent fix): el widget de avance de etapa quedó
    // trabado en un usuario y le bloqueó el trabajo. Hasta resolver el
    // diseño bien, deshabilitamos por completo: ni se abre, ni hace
    // polling, ni responde a respuestas de completar tarea.
    // El backend sigue creando AvanceEtapaPendiente; eso lo limpiamos
    // en otro paso. Lo importante es que nadie más vea el modal.
    // ══════════════════════════════════════════════════════════════════
    window.crmAvanceEtapa = {
        abrirOportunidad: function () { /* no-op */ },
        handleCompletarResponse: function () { return false; },
        open: function () { /* no-op */ },
        checkMio: function () { /* no-op */ },
    };

    document.addEventListener('DOMContentLoaded', function () {
        // Si el overlay quedó montado en el DOM, lo escondemos de todas
        // formas por si algún script viejo cacheado intenta abrirlo.
        var ov = $(OVERLAY_ID);
        if (ov) {
            ov.style.display = 'none';
            ov.style.visibility = 'hidden';
            ov.style.pointerEvents = 'none';
        }
        return; // corta el resto del init (botones, listeners, polling)
        // Código original deshabilitado.
        /*
        var btn = $('waeConfirmBtn');
        if (btn) btn.addEventListener('click', confirmar);

        var ovBlock = $(OVERLAY_ID);
        if (ovBlock) {
            ovBlock.addEventListener('click', function (e) {
                if (e.target === ovBlock) {
                    e.stopPropagation();
                    e.preventDefault();
                }
            });
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var ov2 = $(OVERLAY_ID);
                if (ov2 && ov2.style.display !== 'none') {
                    e.stopPropagation();
                    e.preventDefault();
                }
            }
        }, true);

        if (document.querySelector('[name=csrfmiddlewaretoken]')) {
            setTimeout(checkMio, 1500);
        }
        */
    });
})();
