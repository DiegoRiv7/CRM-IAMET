/*
  crm_control_material_v2.js — Feature "Material esperado" de la sección
  Control del dashboard.

  Expone dos APIs globales:
    window.crmMaterialForm     → { open(proyectoId?), close() }
    window.crmMaterialDetalle  → { open(materialId), close() }

  Convención:
    - Toda mutación pasa por endpoints /app/api/control/materiales/...
    - Tras crear/editar/eliminar emitimos `crmDataBus.emit('material', ...)`
      para que crm_control_v2.js refresque la lista (el bus tiene auto-emit
      por URL pero usamos la entidad explícita 'material').
    - Edición inline en el detalle: cada campo clickable se convierte en
      input y al perder foco/Enter guarda en memoria local; el botón
      "Guardar cambios" hace UN PATCH con todos los campos cambiados.

  El widget no depende de crm_main.js — se monta solo.
*/
(function () {
    'use strict';

    var ESTADO_LABEL = {
        pendiente_compra: 'Pendiente de compra',
        en_transito: 'En tránsito',
        material_listo: 'Material listo',
        en_espera_cliente: 'En espera del cliente',
        recibido: 'Recibido',
    };
    var ESTADO_COLOR = {
        pendiente_compra: '#FB923C',
        en_transito:      '#7DD3FC',
        material_listo:   '#22C55E',
        en_espera_cliente:'#F9A8D4',
        recibido:         '#16A34A',
    };
    var ESTADOS_ORDEN = [
        'pendiente_compra', 'en_transito', 'material_listo',
        'en_espera_cliente', 'recibido',
    ];

    // ────────────────────────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────────────────────────
    function $(id) { return document.getElementById(id); }
    function esc(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function csrf() {
        var el = document.querySelector('[name=csrfmiddlewaretoken]');
        return el ? el.value : '';
    }
    function fmtFecha(iso) {
        if (!iso) return '—';
        try {
            var d = new Date(iso + 'T00:00:00');
            return d.toLocaleDateString('es-MX', { day:'numeric', month:'short', year:'numeric' });
        } catch (e) { return iso; }
    }
    function toast(msg, type) {
        if (typeof window.toast === 'function') window.toast(msg, type || 'info');
    }
    function emitBus(accion, id) {
        try {
            if (window.crmDataBus && typeof window.crmDataBus.emit === 'function') {
                window.crmDataBus.emit('material', accion, id);
            }
        } catch (e) {}
    }
    function jfetch(url, opts) {
        opts = opts || {};
        var headers = opts.headers || {};
        if (opts.method && /^(POST|PUT|PATCH|DELETE)$/i.test(opts.method)) {
            if (!headers['Content-Type'] && opts.body && typeof opts.body === 'string') {
                headers['Content-Type'] = 'application/json';
            }
            headers['X-CSRFToken'] = csrf();
        }
        opts.headers = headers;
        opts.credentials = 'same-origin';
        return fetch(url, opts).then(function (r) { return r.json(); });
    }

    // ────────────────────────────────────────────────────────────────
    // ── FORM (crear material) ─────────────────────────────────────
    // ────────────────────────────────────────────────────────────────
    var formOverlay, fTitulo, fProyectoQ, fProyectoId, fProyectoAC, fProyectoChange,
        fFechaIni, fFechaFin, fEstado, fError, fSave, fCancel, fClose;
    var _proyectosCache = []; // cache local de la lista de proyectos visibles
    var _proyectoLocked = false; // true cuando se preseleccionó desde timeline

    function initForm() {
        formOverlay = $('widgetMaterialForm');
        if (!formOverlay) return false;
        fTitulo       = $('cmFormTitulo');
        fProyectoQ    = $('cmFormProyectoQ');
        fProyectoId   = $('cmFormProyectoId');
        fProyectoAC   = $('cmFormProyectoAC');
        fProyectoChange = $('cmFormProyectoChange');
        fFechaIni     = $('cmFormFechaIni');
        fFechaFin     = $('cmFormFechaFin');
        fEstado       = $('cmFormEstado');
        fError        = $('cmFormError');
        fSave         = $('cmFormSave');
        fCancel       = $('cmFormCancel');
        fClose        = $('cmFormClose');

        fClose.addEventListener('click', closeForm);
        fCancel.addEventListener('click', closeForm);
        fSave.addEventListener('click', submitForm);

        [fTitulo, fFechaIni, fFechaFin, fProyectoQ].forEach(function (el) {
            if (el) el.addEventListener('input', refreshFormState);
            if (el) el.addEventListener('change', refreshFormState);
        });
        if (fEstado) fEstado.addEventListener('change', refreshFormState);

        fProyectoQ.addEventListener('input', onProyectoInput);
        fProyectoAC.addEventListener('click', onProyectoACClick);
        fProyectoChange.addEventListener('click', unlockProyecto);

        document.addEventListener('keydown', function (e) {
            if (formOverlay.style.display === 'none') return;
            if (e.key === 'Escape') closeForm();
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                if (!fSave.disabled) submitForm();
            }
        });
        return true;
    }

    function resetForm() {
        fTitulo.value = '';
        fProyectoQ.value = '';
        fProyectoQ.disabled = false;
        fProyectoId.value = '';
        fProyectoAC.style.display = 'none';
        fProyectoChange.style.display = 'none';
        fFechaIni.value = '';
        fFechaFin.value = '';
        fEstado.value = 'pendiente_compra';
        fError.style.display = 'none';
        fError.textContent = '';
        _proyectoLocked = false;
        refreshFormState();
    }

    function refreshFormState() {
        var ok = !!fTitulo.value.trim()
              && !!fProyectoId.value
              && !!fFechaIni.value
              && !!fFechaFin.value;
        // Validar consistencia de fechas
        if (ok && fFechaIni.value && fFechaFin.value && fFechaFin.value < fFechaIni.value) {
            ok = false;
            showFormError('La fecha fin no puede ser anterior a la de inicio.');
        } else {
            fError.style.display = 'none';
        }
        fSave.disabled = !ok;
    }
    function showFormError(msg) {
        fError.textContent = msg || '';
        fError.style.display = msg ? 'block' : 'none';
    }

    // ── Búsqueda de proyectos (client-side, cache de /api/control/proyectos/) ──
    function loadProyectosCache(force) {
        if (_proyectosCache.length && !force) return Promise.resolve(_proyectosCache);
        return jfetch('/app/api/control/proyectos/?mes=todos&anio=todos').then(function (resp) {
            if (resp && resp.ok) _proyectosCache = resp.data || [];
            return _proyectosCache;
        }).catch(function () { return _proyectosCache; });
    }
    function filterProyectos(q) {
        q = (q || '').trim().toLowerCase();
        if (!q) return _proyectosCache.slice(0, 8);
        return _proyectosCache.filter(function (p) {
            var hay = ((p.cliente || '') + ' ' +
                       (p.oportunidad_nombre || '') + ' ' +
                       (p.po || '') + ' ' +
                       (p.nombre || '')).toLowerCase();
            return hay.indexOf(q) >= 0;
        }).slice(0, 12);
    }
    function renderProyectosAC(items) {
        if (!items.length) {
            fProyectoAC.innerHTML = '<div class="crm-cm-ac-empty">Sin coincidencias.</div>';
            fProyectoAC.style.display = 'block';
            return;
        }
        fProyectoAC.innerHTML = items.map(function (p) {
            return '<div class="crm-cm-ac-item" data-id="' + p.proyecto_id + '"' +
                       ' data-cliente="' + esc(p.cliente) + '"' +
                       ' data-opp="' + esc(p.oportunidad_nombre || p.nombre) + '">' +
                       '<span class="crm-cm-ac-cliente">' + esc(p.cliente || 'Sin cliente') + '</span>' +
                       '<span class="crm-cm-ac-opp">' + esc(p.oportunidad_nombre || p.nombre || '—') + '</span>' +
                   '</div>';
        }).join('');
        fProyectoAC.style.display = 'block';
    }
    var _proyectoDeb = null;
    function onProyectoInput() {
        clearTimeout(_proyectoDeb);
        var v = fProyectoQ.value;
        if (fProyectoId.value && !_proyectoLocked) {
            // El usuario editó el texto tras elegir → invalidar selección
            fProyectoId.value = '';
            refreshFormState();
        }
        _proyectoDeb = setTimeout(function () {
            loadProyectosCache().then(function () {
                renderProyectosAC(filterProyectos(v));
            });
        }, 120);
    }
    function onProyectoACClick(ev) {
        var it = ev.target.closest('[data-id]');
        if (!it) return;
        var id = it.getAttribute('data-id');
        var cliente = it.getAttribute('data-cliente');
        var opp = it.getAttribute('data-opp');
        selectProyecto(id, cliente, opp, false);
    }
    function selectProyecto(id, cliente, opp, lock) {
        fProyectoId.value = id;
        fProyectoQ.value = (cliente || '') + ' — ' + (opp || '');
        fProyectoAC.style.display = 'none';
        if (lock) {
            fProyectoQ.disabled = true;
            fProyectoChange.style.display = '';
            _proyectoLocked = true;
        }
        refreshFormState();
    }
    function unlockProyecto() {
        fProyectoQ.disabled = false;
        fProyectoChange.style.display = 'none';
        _proyectoLocked = false;
        fProyectoQ.value = '';
        fProyectoId.value = '';
        fProyectoQ.focus();
        refreshFormState();
    }

    function openForm(proyectoId) {
        if (!formOverlay && !initForm()) return;
        resetForm();
        formOverlay.style.display = 'flex';
        // Hoy por default en fecha inicio
        try {
            var hoy = new Date();
            var y = hoy.getFullYear();
            var m = (hoy.getMonth() + 1).toString().padStart(2, '0');
            var d = hoy.getDate().toString().padStart(2, '0');
            fFechaIni.value = y + '-' + m + '-' + d;
            // fin = inicio + 7 días por default
            var fin = new Date(hoy.getTime() + 7 * 86400000);
            fFechaFin.value = fin.getFullYear() + '-' +
                              (fin.getMonth() + 1).toString().padStart(2, '0') + '-' +
                              fin.getDate().toString().padStart(2, '0');
        } catch (e) {}
        loadProyectosCache().then(function () {
            if (proyectoId) {
                var p = _proyectosCache.find(function (x) {
                    return String(x.proyecto_id) === String(proyectoId);
                });
                if (p) {
                    selectProyecto(p.proyecto_id, p.cliente, p.oportunidad_nombre || p.nombre, true);
                } else {
                    // El proyecto preseleccionado no es visible → liberar
                    fProyectoQ.focus();
                }
            } else {
                setTimeout(function () { fProyectoQ.focus(); }, 60);
            }
            refreshFormState();
        });
    }
    function closeForm() {
        if (!formOverlay) return;
        formOverlay.style.display = 'none';
    }

    function submitForm() {
        showFormError('');
        var payload = {
            proyecto_id: parseInt(fProyectoId.value, 10),
            titulo: (fTitulo.value || '').trim(),
            fecha_inicio: fFechaIni.value,
            fecha_fin: fFechaFin.value,
            estado: fEstado.value || 'pendiente_compra',
        };
        if (!payload.proyecto_id) return showFormError('Selecciona un proyecto.');
        if (!payload.titulo) return showFormError('Pon el título del material.');
        if (!payload.fecha_inicio || !payload.fecha_fin) return showFormError('Pon ambas fechas.');

        fSave.disabled = true;
        var orig = fSave.textContent;
        fSave.textContent = 'Guardando…';
        jfetch('/app/api/control/materiales/crear/', {
            method: 'POST',
            body: JSON.stringify(payload),
        }).then(function (resp) {
            if (!resp || !resp.ok) {
                showFormError((resp && resp.error) || 'Error al guardar.');
                fSave.disabled = false;
                fSave.textContent = orig;
                return;
            }
            toast('Material agregado al timeline.', 'success');
            emitBus('create', resp.material && resp.material.id);
            closeForm();
        }).catch(function () {
            showFormError('Error de red. Intenta de nuevo.');
            fSave.disabled = false;
            fSave.textContent = orig;
        });
    }

    // ────────────────────────────────────────────────────────────────
    // ── DETALLE / EDICIÓN INLINE ───────────────────────────────────
    // ────────────────────────────────────────────────────────────────
    var detOverlay, detLoading, detContent, detTitulo, detEstadoChip, detClose,
        detCliente, detOpp, detFechaIni, detFechaFin,
        detConfirmadoPanel, detConfFecha, detConfPor, detConfirmarBtn,
        detComList, detComCount, detComTexto, detComEnviar,
        detCreadoPor, detCreadoEl, detEliminarBtn, detError,
        detDirtyBar, detDirtyCancel, detDirtySave;

    var _detMaterial = null;     // último material cargado
    var _detDirty = {};          // { campo: nuevoValor }
    var _detComEditing = null;   // referencia al editor inline activo

    function initDetalle() {
        detOverlay = $('widgetMaterialDetalle');
        if (!detOverlay) return false;
        detLoading = $('cmDetLoading');
        detContent = $('cmDetContent');
        detTitulo = $('cmDetTitulo');
        detEstadoChip = $('cmDetEstadoChip');
        detClose = $('cmDetClose');
        detCliente = $('cmDetCliente');
        detOpp = $('cmDetOpp');
        detFechaIni = $('cmDetFechaIni');
        detFechaFin = $('cmDetFechaFin');
        detConfirmadoPanel = $('cmDetConfirmadoPanel');
        detConfFecha = $('cmDetConfFecha');
        detConfPor = $('cmDetConfPor');
        detConfirmarBtn = $('cmDetConfirmarBtn');
        detComList = $('cmDetComList');
        detComCount = $('cmDetComCount');
        detComTexto = $('cmDetComTexto');
        detComEnviar = $('cmDetComEnviar');
        detCreadoPor = $('cmDetCreadoPor');
        detCreadoEl = $('cmDetCreadoEl');
        detEliminarBtn = $('cmDetEliminarBtn');
        detError = $('cmDetError');
        detDirtyBar = $('cmDetDirtyBar');
        detDirtyCancel = $('cmDetDirtyCancel');
        detDirtySave = $('cmDetDirtySave');

        detClose.addEventListener('click', closeDetalle);
        detConfirmarBtn.addEventListener('click', confirmarRecepcion);
        detEliminarBtn.addEventListener('click', eliminarMaterial);
        detComTexto.addEventListener('input', function () {
            detComEnviar.disabled = !(detComTexto.value || '').trim();
        });
        detComEnviar.addEventListener('click', agregarComentario);
        detDirtyCancel.addEventListener('click', descartarCambios);
        detDirtySave.addEventListener('click', guardarCambios);

        // Click en campos editables (delegado en contenido)
        detContent.addEventListener('click', function (e) {
            var el = e.target.closest('[data-field]');
            if (!el) return;
            if (el.classList.contains('is-editing')) return;
            iniciarEdicion(el);
        });

        document.addEventListener('keydown', function (e) {
            if (detOverlay.style.display === 'none') return;
            if (e.key === 'Escape') closeDetalle();
        });
        return true;
    }

    function openDetalle(materialId) {
        if (!detOverlay && !initDetalle()) return;
        _detDirty = {};
        detError.style.display = 'none';
        detContent.style.display = 'none';
        detLoading.style.display = '';
        detDirtyBar.style.display = 'none';
        detOverlay.style.display = 'flex';

        jfetch('/app/api/control/materiales/' + materialId + '/').then(function (resp) {
            detLoading.style.display = 'none';
            if (!resp || !resp.ok) {
                detContent.style.display = '';
                detError.textContent = (resp && resp.error) || 'No se pudo cargar el material.';
                detError.style.display = 'block';
                return;
            }
            _detMaterial = resp.material;
            renderDetalle(_detMaterial);
            detContent.style.display = '';
        }).catch(function () {
            detLoading.style.display = 'none';
            detContent.style.display = '';
            detError.textContent = 'Error de red.';
            detError.style.display = 'block';
        });
    }
    function closeDetalle() {
        if (!detOverlay) return;
        if (Object.keys(_detDirty).length) {
            var ok = window.confirm('Tienes cambios sin guardar. ¿Descartar?');
            if (!ok) return;
        }
        detOverlay.style.display = 'none';
        _detMaterial = null;
        _detDirty = {};
    }

    function renderDetalle(m) {
        if (!m) return;
        detTitulo.textContent = m.titulo || '—';
        detEstadoChip.textContent = ESTADO_LABEL[m.estado] || m.estado || '—';
        detEstadoChip.style.background = (ESTADO_COLOR[m.estado] || '#F2F2F7') + '22';
        detEstadoChip.style.color = ESTADO_COLOR[m.estado] || '#1D1D1F';

        detCliente.textContent = m.proyecto_cliente || 'Sin cliente';
        detOpp.textContent = m.proyecto_nombre || '—';

        detFechaIni.textContent = fmtFecha(m.fecha_inicio);
        detFechaIni.setAttribute('data-value', m.fecha_inicio || '');
        detFechaFin.textContent = fmtFecha(m.fecha_fin);
        detFechaFin.setAttribute('data-value', m.fecha_fin || '');

        detTitulo.setAttribute('data-value', m.titulo || '');
        detEstadoChip.setAttribute('data-value', m.estado || '');

        // Confirmación
        if (m.confirmado_recepcion) {
            detConfirmadoPanel.style.display = '';
            detConfFecha.textContent = m.fecha_confirmacion || '—';
            detConfPor.textContent = m.confirmado_por_nombre || '—';
            detConfirmarBtn.style.display = 'none';
        } else {
            detConfirmadoPanel.style.display = 'none';
            detConfirmarBtn.style.display = '';
        }

        // Comentarios
        var coms = m.comentarios || [];
        detComCount.textContent = coms.length ? coms.length : '';
        if (!coms.length) {
            detComList.innerHTML = '<div class="crm-cm-com-empty">Aún no hay comentarios.</div>';
        } else {
            detComList.innerHTML = coms.map(function (c) {
                var head = '';
                if (c.autor || c.fecha) {
                    head = '<div class="crm-cm-com-head">' +
                           (c.autor ? '<span class="crm-cm-com-autor">' + esc(c.autor) + '</span>' : '') +
                           (c.fecha ? '<span class="crm-cm-com-fecha">' + esc(c.fecha) + '</span>' : '') +
                           '</div>';
                }
                return '<div class="crm-cm-com-item">' + head +
                       '<div class="crm-cm-com-texto">' + esc(c.texto) + '</div>' +
                       '</div>';
            }).join('');
        }

        // Meta
        detCreadoPor.textContent = m.creado_por_nombre || '—';
        detCreadoEl.textContent = m.created_at || '';

        // Reset dirty UI
        _detDirty = {};
        renderDirty();
    }

    // ── Edición inline ─────────────────────────────────────────────
    function iniciarEdicion(el) {
        // Si hay otro editor activo, ciérralo primero (commit suave)
        if (_detComEditing && _detComEditing !== el) {
            terminarEdicion(_detComEditing, true);
        }
        var field = el.getAttribute('data-field');
        var actual = el.getAttribute('data-value') || '';
        el.classList.add('is-editing');
        _detComEditing = el;

        var input;
        if (field === 'titulo') {
            input = document.createElement('input');
            input.type = 'text';
            input.value = actual;
            input.maxLength = 200;
        } else if (field === 'fecha_inicio' || field === 'fecha_fin') {
            input = document.createElement('input');
            input.type = 'date';
            input.value = actual;
        } else if (field === 'estado') {
            input = document.createElement('select');
            ESTADOS_ORDEN.forEach(function (e) {
                var opt = document.createElement('option');
                opt.value = e;
                opt.textContent = ESTADO_LABEL[e];
                if (e === actual) opt.selected = true;
                input.appendChild(opt);
            });
        } else {
            return;
        }
        input.className = 'crm-cm-input';
        input.style.padding = '6px 10px';
        input.style.fontSize = '0.86rem';

        el.innerHTML = '';
        el.appendChild(input);
        try { input.focus(); if (input.select) input.select(); } catch (e) {}

        function commit() {
            terminarEdicion(el, true, input.value);
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') {
                e.preventDefault();
                terminarEdicion(el, false);
            }
        });
        // Select cambia con un click → commit inmediato
        if (input.tagName === 'SELECT') {
            input.addEventListener('change', function () { input.blur(); });
        }
    }
    function terminarEdicion(el, commit, value) {
        if (!el) return;
        if (_detComEditing === el) _detComEditing = null;
        el.classList.remove('is-editing');
        var field = el.getAttribute('data-field');
        var actual = el.getAttribute('data-value') || '';

        if (!commit) {
            restaurarVista(el, field, actual);
            return;
        }
        var nuevo = (typeof value === 'undefined') ? actual : value;
        if (field === 'titulo') nuevo = (nuevo || '').trim().substring(0, 200);
        if (!nuevo && field === 'titulo') {
            // Título no puede quedar vacío
            restaurarVista(el, field, actual);
            return;
        }
        if (nuevo === actual) {
            restaurarVista(el, field, actual);
            return;
        }
        // Validación cruzada de fechas
        if (field === 'fecha_inicio') {
            var fin = detFechaFin.getAttribute('data-value');
            if (fin && nuevo > fin) {
                toast('La fecha inicio no puede ser posterior al fin.', 'error');
                restaurarVista(el, field, actual);
                return;
            }
        }
        if (field === 'fecha_fin') {
            var ini = detFechaIni.getAttribute('data-value');
            if (ini && nuevo < ini) {
                toast('La fecha fin no puede ser anterior al inicio.', 'error');
                restaurarVista(el, field, actual);
                return;
            }
        }

        el.setAttribute('data-value', nuevo);
        _detDirty[field] = nuevo;
        restaurarVista(el, field, nuevo);
        renderDirty();
    }
    function restaurarVista(el, field, value) {
        if (field === 'titulo') {
            el.textContent = value || '—';
        } else if (field === 'fecha_inicio' || field === 'fecha_fin') {
            el.textContent = fmtFecha(value);
        } else if (field === 'estado') {
            el.textContent = ESTADO_LABEL[value] || value || '—';
            el.style.background = (ESTADO_COLOR[value] || '#F2F2F7') + '22';
            el.style.color = ESTADO_COLOR[value] || '#1D1D1F';
        }
    }
    function renderDirty() {
        var n = Object.keys(_detDirty).length;
        detDirtyBar.style.display = n ? 'flex' : 'none';
    }
    function descartarCambios() {
        if (!_detMaterial) { _detDirty = {}; renderDirty(); return; }
        renderDetalle(_detMaterial); // re-render limpia los inputs y dirty
    }
    function guardarCambios() {
        if (!_detMaterial) return;
        var n = Object.keys(_detDirty).length;
        if (!n) { renderDirty(); return; }
        detDirtySave.disabled = true;
        detDirtySave.textContent = 'Guardando…';
        jfetch('/app/api/control/materiales/' + _detMaterial.id + '/actualizar/', {
            method: 'POST', // backend acepta POST y PATCH
            body: JSON.stringify(_detDirty),
        }).then(function (resp) {
            if (!resp || !resp.ok) {
                detError.textContent = (resp && resp.error) || 'Error al guardar.';
                detError.style.display = 'block';
                detDirtySave.disabled = false;
                detDirtySave.textContent = 'Guardar cambios';
                return;
            }
            _detMaterial = resp.material;
            _detDirty = {};
            renderDetalle(_detMaterial);
            detDirtySave.disabled = false;
            detDirtySave.textContent = 'Guardar cambios';
            toast('Cambios guardados.', 'success');
            emitBus('update', _detMaterial.id);
        }).catch(function () {
            detError.textContent = 'Error de red.';
            detError.style.display = 'block';
            detDirtySave.disabled = false;
            detDirtySave.textContent = 'Guardar cambios';
        });
    }

    function confirmarRecepcion() {
        if (!_detMaterial) return;
        if (Object.keys(_detDirty).length) {
            if (!window.confirm('Tienes cambios sin guardar. ¿Confirmar recepción de todos modos? (los cambios se perderán)')) return;
        }
        detConfirmarBtn.disabled = true;
        var origLbl = detConfirmarBtn.textContent;
        detConfirmarBtn.textContent = 'Confirmando…';
        jfetch('/app/api/control/materiales/' + _detMaterial.id + '/confirmar-recepcion/', {
            method: 'POST',
            body: '{}',
        }).then(function (resp) {
            detConfirmarBtn.disabled = false;
            detConfirmarBtn.textContent = origLbl;
            if (!resp || !resp.ok) {
                toast((resp && resp.error) || 'No se pudo confirmar.', 'error');
                return;
            }
            _detMaterial = resp.material;
            _detDirty = {};
            renderDetalle(_detMaterial);
            toast('Recepción confirmada.', 'success');
            emitBus('update', _detMaterial.id);
        }).catch(function () {
            detConfirmarBtn.disabled = false;
            detConfirmarBtn.textContent = origLbl;
            toast('Error de red.', 'error');
        });
    }

    function agregarComentario() {
        if (!_detMaterial) return;
        var txt = (detComTexto.value || '').trim();
        if (!txt) return;
        detComEnviar.disabled = true;
        var orig = detComEnviar.textContent;
        detComEnviar.textContent = 'Enviando…';
        jfetch('/app/api/control/materiales/' + _detMaterial.id + '/actualizar/', {
            method: 'POST',
            body: JSON.stringify({ comentario_nuevo: txt }),
        }).then(function (resp) {
            detComEnviar.textContent = orig;
            if (!resp || !resp.ok) {
                toast((resp && resp.error) || 'No se pudo agregar el comentario.', 'error');
                detComEnviar.disabled = false;
                return;
            }
            _detMaterial = resp.material;
            renderDetalle(_detMaterial);
            detComTexto.value = '';
            detComEnviar.disabled = true;
            emitBus('update', _detMaterial.id);
        }).catch(function () {
            detComEnviar.textContent = orig;
            detComEnviar.disabled = false;
            toast('Error de red.', 'error');
        });
    }

    function eliminarMaterial() {
        if (!_detMaterial) return;
        if (!window.confirm('¿Eliminar este material? No se puede deshacer.')) return;
        detEliminarBtn.disabled = true;
        var orig = detEliminarBtn.textContent;
        detEliminarBtn.textContent = 'Eliminando…';
        jfetch('/app/api/control/materiales/' + _detMaterial.id + '/eliminar/', {
            method: 'POST',
        }).then(function (resp) {
            detEliminarBtn.disabled = false;
            detEliminarBtn.textContent = orig;
            if (!resp || !resp.ok) {
                toast((resp && resp.error) || 'No se pudo eliminar.', 'error');
                return;
            }
            var id = _detMaterial.id;
            toast('Material eliminado.', 'success');
            _detMaterial = null;
            _detDirty = {};
            detOverlay.style.display = 'none';
            emitBus('delete', id);
        }).catch(function () {
            detEliminarBtn.disabled = false;
            detEliminarBtn.textContent = orig;
            toast('Error de red.', 'error');
        });
    }

    // ────────────────────────────────────────────────────────────────
    // Boot
    // ────────────────────────────────────────────────────────────────
    function init() {
        initForm();
        initDetalle();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // APIs públicas
    window.crmMaterialForm = {
        open: openForm,
        close: closeForm,
        // refresca el cache de proyectos visibles (útil tras agregar proyectos)
        refreshProyectos: function () { return loadProyectosCache(true); },
    };
    window.crmMaterialDetalle = {
        open: openDetalle,
        close: closeDetalle,
    };
})();
