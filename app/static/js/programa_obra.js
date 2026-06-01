/* ═══════════════════════════════════════════════════════════════════
   Programa de Obra — Instalaciones del Proyecto

   Componente del tab "Programa de Obra" dentro del widget de Proyecto.
   Renderiza la tabla de instalaciones del proyecto y orquesta un modal
   único que sirve para:
     - ver detalle de una instalación
     - editarla inline
     - asignar/quitar técnicos (asignaciones por fecha)

   El mismo modal lo invoca el calendario de Instalaciones al click sobre
   un evento (reemplaza el placeholder que abría /admin/ en pestaña
   nueva). Función pública: window.pobAbrirModal(instalacionId).

   Endpoints:
     GET  /api/proyecto/<pid>/instalaciones/
     POST /api/proyecto/<pid>/instalaciones/
     GET  /api/instalacion/<id>/
     PATCH /api/instalacion/<id>/
     DELETE /api/instalacion/<id>/
     POST /api/instalacion/<id>/asignaciones/
     DELETE /api/instalacion/<id>/asignaciones/<aid>/
     GET  /api/tecnicos/
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // Inyecta estilos del modal y la tabla. Duplican parcialmente los de
    // _widget_oportunidad.html para que este módulo sea autónomo (el modal
    // se abre también desde el tab de proyecto y desde el calendario,
    // donde el widget de opp puede no estar montado).
    (function _injectStyles() {
        if (document.getElementById('pobStyles')) return;
        var s = document.createElement('style');
        s.id = 'pobStyles';
        s.textContent = [
            '.wop-pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:0.68rem; font-weight:700; letter-spacing:0.02em; }',
            '.wop-pill-prog   { background:#E0F2FE; color:#075985; }',
            '.wop-pill-curso  { background:#FEF3C7; color:#92400E; }',
            '.wop-pill-done   { background:#D1FAE5; color:#065F46; }',
            '.wop-pill-cancel { background:#FEE2E2; color:#991B1B; }',
            '.wop-table th { text-align:left; font-size:0.66rem; text-transform:uppercase; letter-spacing:0.04em; color:#86868B; font-weight:700; padding:10px 12px; border-bottom:1px solid #E5E5EA; background:#FAFAFC; }',
            '.wop-table td { padding:10px 12px; border-bottom:1px solid #F2F2F7; vertical-align:middle; }',
            '.wop-table tbody tr:hover { background:#F9FAFB; }',
            '.wop-table tr:last-child td { border-bottom:none; }',
            '.wop-icon-btn { background:transparent; border:none; cursor:pointer; padding:4px; border-radius:6px; color:#86868B; }',
            '.wop-icon-btn:hover { background:#F2F2F7; color:#FF3B30; }',
            '.wop-modal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:11500; display:none; align-items:center; justify-content:center; }',
            '.wop-modal-backdrop.open { display:flex; }',
            '.wop-modal { background:#fff; border-radius:14px; box-shadow:0 25px 60px rgba(0,0,0,0.2); width:min(560px, 92vw); max-height:88vh; display:flex; flex-direction:column; overflow:hidden; }',
            '.wop-modal-head { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid #E5E5EA; }',
            '.wop-modal-head h3 { margin:0; font-size:1rem; font-weight:700; color:#1D1D1F; }',
            '.wop-modal-body { padding:14px 18px; overflow-y:auto; }',
            '.wop-modal-foot { padding:12px 18px; border-top:1px solid #E5E5EA; display:flex; justify-content:flex-end; gap:8px; }',
            '.wop-field { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }',
            '.wop-field label { font-size:0.72rem; font-weight:700; color:#3C3C43; letter-spacing:0.02em; text-transform:uppercase; }',
            '.wop-field input, .wop-field select, .wop-field textarea { font-family:inherit; font-size:0.88rem; padding:7px 10px; border:1px solid #E5E5EA; border-radius:8px; outline:none; transition:border-color 0.15s; }',
            '.wop-field input:focus, .wop-field select:focus, .wop-field textarea:focus { border-color:#0052D4; }',
            '.wop-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }',
            '.wop-btn-primary { background:#0052D4; color:#fff; border:none; padding:8px 14px; border-radius:8px; font-weight:600; cursor:pointer; font-size:0.84rem; }',
            '.wop-btn-primary:hover { background:#0041a8; }',
            '.wop-btn-secondary { background:#F2F2F7; color:#1D1D1F; border:none; padding:8px 14px; border-radius:8px; font-weight:600; cursor:pointer; font-size:0.84rem; }',
            '.wop-btn-secondary:hover { background:#E5E5EA; }',
        ].join('\n');
        (document.head || document.body).appendChild(s);
    })();

    function _csrf() {
        var v = document.cookie.match('(^|;)\\s*csrftoken\\s*=\\s*([^;]+)');
        return v ? v.pop() : '';
    }
    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _fmtMoney(v) {
        var n = Number(v || 0);
        if (!isFinite(n)) return '$0';
        return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    var MESES_CORTO = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    function _fmtFecha(iso, tentativa) {
        if (!iso) return tentativa ? _esc(tentativa) : '<span style="color:#C7C7CC;">—</span>';
        var p = iso.split('-');
        var d = new Date(+p[0], +p[1] - 1, +p[2]);
        return d.getDate() + ' ' + MESES_CORTO[d.getMonth()] + ' ' + d.getFullYear();
    }
    function _estadoPillCls(estado) {
        if (estado === 'completada') return 'wop-pill wop-pill-done';
        if (estado === 'en_curso')   return 'wop-pill wop-pill-curso';
        if (estado === 'cancelada')  return 'wop-pill wop-pill-cancel';
        return 'wop-pill wop-pill-prog';
    }

    // Proyecto activo (lo lee del global window._proyectoActualId que el
    // resto del widget mantiene). Fallback: data attr del root.
    function _proyectoIdActivo() {
        if (window._proyectoActualId) return window._proyectoActualId;
        if (window._currentProjectId) return window._currentProjectId;
        var detRoot = document.getElementById('proyectoDetailSection');
        if (detRoot && detRoot.dataset && detRoot.dataset.projectId) return parseInt(detRoot.dataset.projectId, 10);
        return null;
    }

    // ─── Tabla de instalaciones del proyecto ─────────────────────────
    window.pobCargarLista = function (proyectoId) {
        var pid = proyectoId || _proyectoIdActivo();
        var wrap = document.getElementById('pobContainer');
        if (!wrap) return;
        if (!pid) {
            wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#86868B;font-size:0.85rem;">Selecciona un proyecto.</div>';
            return;
        }
        wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#86868B;font-size:0.85rem;">Cargando…</div>';
        fetch('/app/api/proyecto/' + pid + '/instalaciones/', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success) {
                    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#FF3B30;">No se pudo cargar.</div>';
                    return;
                }
                var inst = data.instalaciones || [];
                if (!inst.length) {
                    wrap.innerHTML = '<div style="padding:48px 24px;text-align:center;color:#86868B;font-size:0.9rem;">'
                        + '<div style="font-size:2.4rem;opacity:0.5;margin-bottom:8px;">'
                        + '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto;display:block;opacity:0.5;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>'
                        + '</div>'
                        + '<div style="font-weight:600;color:#1d1d1f;margin-bottom:4px;">Sin instalaciones aún</div>'
                        + '<div style="font-size:0.8rem;">Da click en <b>+ Nueva instalación</b> para crear la primera.</div>'
                        + '</div>';
                    return;
                }
                var rows = inst.map(function (it) {
                    return '<tr onclick="pobAbrirModal(' + it.id + ')" style="cursor:pointer;">'
                        + '<td style="font-family:ui-monospace,monospace;color:#475569;font-weight:600;">' + (_esc(it.po) || '<span style="color:#C7C7CC;">—</span>') + '</td>'
                        + '<td><div style="font-weight:600;color:#1D1D1F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;" title="' + _esc(it.descripcion) + '">' + _esc(it.descripcion) + '</div>'
                        +   '<div style="font-size:0.7rem;color:#86868B;">' + _esc(it.cliente_nombre || '') + '</div></td>'
                        + '<td style="color:#3C3C43;white-space:nowrap;">' + _fmtFecha(it.fecha, it.fecha_tentativa_texto) + '</td>'
                        + '<td style="color:#3C3C43;">' + it.jornadas_count + ' <span style="color:#86868B;font-size:0.7rem;">' + _esc(it.jornadas_tipo_label) + '</span></td>'
                        + '<td style="color:#3C3C43;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + _esc(it.personal) + '">' + (_esc(it.personal) || '<span style="color:#C7C7CC;">—</span>') + '</td>'
                        + '<td style="font-weight:600;color:#1D1D1F;white-space:nowrap;">' + _fmtMoney(it.monto_po) + '</td>'
                        + '<td><span class="' + _estadoPillCls(it.estado) + '">' + _esc(it.estado_label) + '</span></td>'
                        + '<td style="text-align:right;color:#86868B;font-size:0.78rem;">' + (it.asignaciones_count || 0) + ' técn.</td>'
                        + '</tr>';
                }).join('');
                wrap.innerHTML = '<div style="overflow-x:auto;background:#fff;border:1px solid #E5E5EA;border-radius:12px;">'
                    + '<table class="wop-table" style="width:100%;border-collapse:separate;border-spacing:0;font-size:0.82rem;">'
                    + '<thead><tr>'
                    + '<th>PO</th><th>Descripción</th><th>Fecha</th><th>Jornadas</th><th>Personal</th><th>Monto</th><th>Estado</th><th style="text-align:right;">Técn.</th>'
                    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
            })
            .catch(function () {
                wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#FF3B30;">Error de red.</div>';
            });
    };

    // ─── Modal único: detalle + edit + asignaciones ──────────────────
    function _ensureModal() {
        if (document.getElementById('pobModalBackdrop')) return;
        var html =
            '<div class="wop-modal-backdrop" id="pobModalBackdrop">'
          +   '<div class="wop-modal" style="width:min(820px, 96vw);">'
          +     '<div class="wop-modal-head">'
          +       '<h3 id="pobModalTitle">Instalación</h3>'
          +       '<div style="display:flex;gap:8px;align-items:center;">'
          +         '<button type="button" id="pobBtnEliminar" class="wop-btn-secondary" style="background:#FFE3E3;color:#991B1B;" onclick="pobEliminar()">Eliminar</button>'
          +         '<button type="button" class="widget-close" onclick="pobCerrarModal()" style="font-size:1.4rem;">&times;</button>'
          +       '</div>'
          +     '</div>'
          +     '<div class="wop-modal-body" style="display:grid;grid-template-columns:1.4fr 1fr;gap:18px;">'
          +       '<div id="pobFormCol">'
          +         '<div class="wop-field"><label>Descripción del trabajo</label>'
          +           '<textarea id="pobInstDescripcion" rows="2"></textarea></div>'
          +         '<div class="wop-form-grid">'
          +           '<div class="wop-field"><label>PO</label><input type="text" id="pobInstPo" maxlength="80"></div>'
          +           '<div class="wop-field"><label>Cliente (texto)</label><input type="text" id="pobInstCliente" maxlength="200"></div>'
          +           '<div class="wop-field"><label>Fecha programada</label><input type="date" id="pobInstFecha"></div>'
          +           '<div class="wop-field"><label>Estado</label>'
          +             '<select id="pobInstEstado">'
          +               '<option value="programada">Programada</option>'
          +               '<option value="en_curso">En curso</option>'
          +               '<option value="completada">Completada</option>'
          +               '<option value="cancelada">Cancelada</option>'
          +             '</select></div>'
          +           '<div class="wop-field"><label>Jornadas</label><input type="number" id="pobInstJornadas" min="1"></div>'
          +           '<div class="wop-field"><label>Tipo</label>'
          +             '<select id="pobInstJornadasTipo">'
          +               '<option value="normal">Normal</option>'
          +               '<option value="sabado">Sábado</option>'
          +               '<option value="domingo">Domingo</option>'
          +               '<option value="noche">Noche</option>'
          +               '<option value="extraordinaria">Extraordinaria</option>'
          +             '</select></div>'
          +           '<div class="wop-field" style="grid-column:1 / -1;"><label>Personal (texto libre)</label>'
          +             '<input type="text" id="pobInstPersonal" maxlength="200" placeholder="Ej. 1 SUPERVISOR Y 3 TÉCNICOS"></div>'
          +           '<div class="wop-field"><label>Monto PO</label><input type="number" id="pobInstMonto" step="0.01"></div>'
          +           '<div class="wop-field"><label>Utilidad</label><input type="number" id="pobInstUtilidad" step="0.01"></div>'
          +           '<div class="wop-field" style="grid-column:1 / -1;"><label>Notas / observaciones</label>'
          +             '<textarea id="pobInstNotas" rows="2"></textarea></div>'
          +         '</div>'
          +       '</div>'
          +       '<div id="pobAsignCol" style="border-left:1px solid #E5E5EA;padding-left:18px;">'
          +         '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
          +           '<h4 style="margin:0;font-size:0.92rem;font-weight:700;">Técnicos asignados</h4>'
          +           '<button type="button" id="pobBtnToggleAddAsig" class="wop-btn-secondary" onclick="pobToggleAddAsig()" style="font-size:0.74rem;padding:4px 8px;">+ Agregar</button>'
          +         '</div>'

          // ── Picker en modo CREAR: busca Users del sistema ──
          +         '<div id="pobCreateUsersBox" style="display:none;background:#F9FAFB;padding:10px;border-radius:8px;margin-bottom:12px;">'
          +           '<div style="font-size:0.7rem;color:#86868B;margin-bottom:6px;">'
          +             'Selecciona técnicos del CRM. Se les creará la instalación en su calendario (fecha programada).'
          +           '</div>'
          +           '<input type="text" id="pobUserSearch" placeholder="Buscar usuario..." class="wop-search-input" autocomplete="off" style="font-size:0.84rem;">'
          +           '<div id="pobUserResults" style="margin-top:6px;max-height:160px;overflow-y:auto;"></div>'
          +           '<div style="font-size:0.66rem;color:#86868B;margin-top:8px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">Seleccionados</div>'
          +           '<div id="pobUserChips" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;min-height:24px;"></div>'
          +         '</div>'

          // ── Picker en modo EDITAR: agrega asignaciones puntuales ──
          +         '<div id="pobAddAsigForm" style="display:none;background:#F9FAFB;padding:10px;border-radius:8px;margin-bottom:12px;">'
          +           '<div class="wop-field" style="margin-bottom:6px;"><label style="font-size:0.66rem;">Técnico</label>'
          +             '<select id="pobAddAsigTecnico"></select></div>'
          +           '<div class="wop-field" style="margin-bottom:6px;"><label style="font-size:0.66rem;">Fecha</label>'
          +             '<input type="date" id="pobAddAsigFecha"></div>'
          +           '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">'
          +             '<div class="wop-field" style="margin:0;"><label style="font-size:0.66rem;">Inicio (opc)</label>'
          +               '<input type="time" id="pobAddAsigInicio"></div>'
          +             '<div class="wop-field" style="margin:0;"><label style="font-size:0.66rem;">Fin (opc)</label>'
          +               '<input type="time" id="pobAddAsigFin"></div>'
          +           '</div>'
          +           '<div style="display:flex;justify-content:flex-end;gap:6px;">'
          +             '<button type="button" class="wop-btn-secondary" onclick="pobToggleAddAsig(false)" style="font-size:0.74rem;padding:4px 10px;">Cancelar</button>'
          +             '<button type="button" class="wop-btn-primary" onclick="pobGuardarAsignacion()" style="font-size:0.74rem;padding:4px 10px;">Asignar</button>'
          +           '</div>'
          +         '</div>'
          +         '<div id="pobAsignList"></div>'
          +       '</div>'
          +     '</div>'
          +     '<div class="wop-modal-foot">'
          +       '<button type="button" class="wop-btn-secondary" onclick="pobCerrarModal()">Cerrar</button>'
          +       '<button type="button" class="wop-btn-primary" id="pobBtnGuardar" onclick="pobGuardarCambios()">Guardar cambios</button>'
          +     '</div>'
          +   '</div>'
          + '</div>';
        var div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstChild);
    }

    var _pobActiveInst = null;     // datos de la instalación abierta en el modal
    var _pobCreatingMode = false;   // true cuando es "Nueva instalación" sin id
    var _pobTecnicosCache = null;   // [{id,nombre,rol_label}] activos
    var _pobUserSelectedIds = [];   // Users elegidos en el picker (modo crear)
    var _pobUserSelectedMap = {};   // {userId: {id, text, avatar_url}} para chips
    var _pobUserSearchResults = {}; // {userId: userObj} de la última búsqueda — fuente
                                    // de datos para pobToggleUser sin JSON-en-onclick.
    var _pobUserSearchDebounce = null;

    function _fillForm(inst) {
        var f = function (id, val) { var el = document.getElementById(id); if (el) el.value = val == null ? '' : val; };
        f('pobInstDescripcion', inst.descripcion);
        f('pobInstPo', inst.po);
        f('pobInstCliente', inst.cliente_nombre);
        f('pobInstFecha', inst.fecha);
        f('pobInstEstado', inst.estado || 'programada');
        f('pobInstJornadas', inst.jornadas_count || 1);
        f('pobInstJornadasTipo', inst.jornadas_tipo || 'normal');
        f('pobInstPersonal', inst.personal);
        f('pobInstMonto', inst.monto_po);
        f('pobInstUtilidad', inst.utilidad);
        f('pobInstNotas', inst.notas);
    }

    function _renderAsignaciones(asignaciones) {
        var lst = document.getElementById('pobAsignList');
        if (!lst) return;
        if (!asignaciones || !asignaciones.length) {
            lst.innerHTML = '<div style="font-size:0.78rem;color:#86868B;padding:12px;text-align:center;background:#F9FAFB;border-radius:8px;">Sin asignaciones aún</div>';
            return;
        }
        lst.innerHTML = asignaciones.map(function (a) {
            var hora = '';
            if (a.hora_inicio && a.hora_fin) hora = a.hora_inicio + '–' + a.hora_fin;
            else if (a.hora_inicio) hora = 'desde ' + a.hora_inicio;
            return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:#F9FAFB;margin-bottom:6px;">'
                + '<div style="flex:1;min-width:0;">'
                +   '<div style="font-size:0.84rem;font-weight:700;color:#1D1D1F;">' + _esc(a.tecnico_nombre) + '</div>'
                +   '<div style="font-size:0.7rem;color:#86868B;">' + _fmtFecha(a.fecha) + (hora ? ' · ' + _esc(hora) : '') + '</div>'
                + '</div>'
                + '<button type="button" class="wop-icon-btn" title="Quitar" onclick="pobQuitarAsignacion(' + a.id + ')">'
                + '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
                + '</button>'
                + '</div>';
        }).join('');
    }

    function _cargarTecnicosCache() {
        if (_pobTecnicosCache) {
            _llenarSelectTecnicos();
            return Promise.resolve(_pobTecnicosCache);
        }
        return fetch('/app/api/tecnicos/', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.success) {
                    _pobTecnicosCache = data.tecnicos || [];
                    _llenarSelectTecnicos();
                    return _pobTecnicosCache;
                }
                return [];
            });
    }
    function _llenarSelectTecnicos() {
        var sel = document.getElementById('pobAddAsigTecnico');
        if (!sel || !_pobTecnicosCache) return;
        sel.innerHTML = '<option value="">— Selecciona —</option>'
            + _pobTecnicosCache.map(function (t) {
                return '<option value="' + t.id + '">' + _esc(t.nombre) + ' (' + _esc(t.rol_label) + ')</option>';
            }).join('');
    }

    window.pobAbrirModal = function (instalacionId) {
        _ensureModal();
        _pobCreatingMode = false;
        var titleEl = document.getElementById('pobModalTitle');
        var modal = document.getElementById('pobModalBackdrop');
        var btnDel = document.getElementById('pobBtnEliminar');
        if (titleEl) titleEl.textContent = 'Cargando…';
        if (btnDel) btnDel.style.display = '';
        if (modal) modal.classList.add('open');
        // Modo EDITAR: oculta el picker de Users y muestra el flow normal.
        _pobAplicarUiModoCrear(false);
        fetch('/app/api/instalacion/' + instalacionId + '/', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success) {
                    if (titleEl) titleEl.textContent = 'No se pudo cargar';
                    return;
                }
                _pobActiveInst = data.instalacion;
                if (titleEl) titleEl.textContent = (_pobActiveInst.descripcion || 'Instalación').substring(0, 80);
                _fillForm(_pobActiveInst);
                _renderAsignaciones(_pobActiveInst.asignaciones);
                _cargarTecnicosCache();
            });
    };

    window.pobAbrirNueva = function () {
        var pid = _proyectoIdActivo();
        if (!pid) {
            if (typeof showToast === 'function') showToast('Selecciona un proyecto primero', 'error');
            return;
        }
        _ensureModal();
        _pobCreatingMode = true;
        _pobActiveInst = { proyecto_id: pid, asignaciones: [] };
        _pobUserSelectedIds = [];
        _pobUserSelectedMap = {};
        _pobUserSearchResults = {};
        var titleEl = document.getElementById('pobModalTitle');
        if (titleEl) titleEl.textContent = 'Nueva instalación';
        var btnDel = document.getElementById('pobBtnEliminar');
        if (btnDel) btnDel.style.display = 'none';
        _fillForm({
            descripcion: '', po: '', cliente_nombre: '', fecha: '',
            estado: 'programada', jornadas_count: 1, jornadas_tipo: 'normal',
            personal: '', monto_po: '', utilidad: '', notas: '',
        });
        _renderAsignaciones([]);
        _pobAplicarUiModoCrear(true);
        _pobRenderUserChips();
        _pobRenderUserResults([]);

        var modal = document.getElementById('pobModalBackdrop');
        if (modal) modal.classList.add('open');

        // Pre-llenar cliente / PO desde la oportunidad ligada al proyecto.
        fetch('/app/api/proyecto/' + pid + '/instalacion-defaults/', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success || !data.defaults) return;
                var d = data.defaults;
                var clEl = document.getElementById('pobInstCliente');
                if (clEl && !clEl.value && d.cliente_nombre) clEl.value = d.cliente_nombre;
                var poEl = document.getElementById('pobInstPo');
                if (poEl && !poEl.value && d.po) poEl.value = d.po;
                if (_pobActiveInst) _pobActiveInst.oportunidad_id = d.oportunidad_id || null;
            })
            .catch(function () { /* silencioso */ });

        var desc = document.getElementById('pobInstDescripcion');
        if (desc) desc.focus();

        // Hook del input de búsqueda de Users (live search).
        var input = document.getElementById('pobUserSearch');
        if (input) {
            input.value = '';
            input.oninput = function () {
                clearTimeout(_pobUserSearchDebounce);
                var q = input.value.trim();
                _pobUserSearchDebounce = setTimeout(function () {
                    if (!q) { _pobRenderUserResults([]); return; }
                    fetch('/app/api/users/?q=' + encodeURIComponent(q), { credentials: 'same-origin' })
                        .then(function (r) { return r.json(); })
                        .then(function (results) { _pobRenderUserResults(results || []); })
                        .catch(function () {});
                }, 200);
            };
        }
    };

    function _pobAplicarUiModoCrear(esCrear) {
        // En CREAR: muestra el picker de Users (pobCreateUsersBox) y oculta
        // el botón "+ Agregar" + el form de asignación puntual (esos viven
        // sólo en modo EDITAR).
        var box = document.getElementById('pobCreateUsersBox');
        var btnToggle = document.getElementById('pobBtnToggleAddAsig');
        var addForm = document.getElementById('pobAddAsigForm');
        if (box) box.style.display = esCrear ? '' : 'none';
        if (btnToggle) btnToggle.style.display = esCrear ? 'none' : '';
        if (addForm && esCrear) addForm.style.display = 'none';
    }

    function _pobRenderUserResults(results) {
        var wrap = document.getElementById('pobUserResults');
        if (!wrap) return;
        // Cachear resultados para que pobToggleUser pueda hidratarse sin
        // pasar el objeto entero por el onclick (rompía con JSON-en-HTML).
        _pobUserSearchResults = {};
        (results || []).forEach(function (u) { _pobUserSearchResults[u.id] = u; });

        if (!results || !results.length) {
            wrap.innerHTML = '<div style="color:#86868B;font-size:0.74rem;padding:6px;">Escribe para buscar usuarios.</div>';
            return;
        }
        wrap.innerHTML = results.map(function (u) {
            var seleccionado = !!_pobUserSelectedMap[u.id];
            var avatar = u.avatar_url
                ? '<img src="' + _esc(u.avatar_url) + '" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
                : '<div style="width:24px;height:24px;border-radius:50%;background:#0052D4;color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.66rem;font-weight:700;flex-shrink:0;">'
                  + _esc((u.text || '?').substring(0, 1).toUpperCase()) + '</div>';
            return '<div data-pob-user-id="' + u.id + '" '
                + 'style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;'
                + (seleccionado ? 'background:#E0F2FE;' : '') + '">'
                + avatar
                + '<div style="flex:1;min-width:0;font-size:0.82rem;color:#1D1D1F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(u.text) + '</div>'
                + (seleccionado ? '<svg width="14" height="14" fill="none" stroke="#0052D4" stroke-width="2.4" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : '')
                + '</div>';
        }).join('');

        // Delegate click: un solo listener para todos los results, sin
        // strings JSON en el HTML.
        wrap.onclick = function (ev) {
            var t = ev.target;
            while (t && t !== wrap && !t.hasAttribute('data-pob-user-id')) t = t.parentElement;
            if (!t || t === wrap) return;
            var uid = parseInt(t.getAttribute('data-pob-user-id'), 10);
            if (!isFinite(uid)) return;
            pobToggleUser(uid);
        };
    }

    function _pobRenderUserChips() {
        var wrap = document.getElementById('pobUserChips');
        if (!wrap) return;
        if (!_pobUserSelectedIds.length) {
            wrap.innerHTML = '<div style="font-size:0.72rem;color:#86868B;">Ninguno seleccionado todavía.</div>';
            return;
        }
        wrap.innerHTML = _pobUserSelectedIds.map(function (uid) {
            var u = _pobUserSelectedMap[uid] || { text: 'Usuario ' + uid };
            return '<div style="display:inline-flex;align-items:center;gap:4px;background:#0052D4;color:#fff;padding:3px 4px 3px 10px;border-radius:999px;font-size:0.74rem;font-weight:600;">'
                + _esc(u.text)
                + '<button type="button" data-pob-chip-remove="' + uid + '" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:0.7rem;padding:0;line-height:1;">×</button>'
                + '</div>';
        }).join('');
        // Listener delegado para los X de los chips.
        wrap.onclick = function (ev) {
            var btn = ev.target.closest && ev.target.closest('[data-pob-chip-remove]');
            if (!btn) return;
            var uid = parseInt(btn.getAttribute('data-pob-chip-remove'), 10);
            if (isFinite(uid)) pobToggleUser(uid);
        };
    }

    window.pobToggleUser = function (userId) {
        var uid = parseInt(userId, 10);
        if (!isFinite(uid)) return;
        if (_pobUserSelectedMap[uid]) {
            // Quitar
            _pobUserSelectedIds = _pobUserSelectedIds.filter(function (x) { return x !== uid; });
            delete _pobUserSelectedMap[uid];
        } else {
            // Agregar. Hidratamos el objeto del cache de la última búsqueda.
            _pobUserSelectedIds.push(uid);
            var u = _pobUserSearchResults[uid] || { id: uid, text: 'Usuario ' + uid };
            _pobUserSelectedMap[uid] = u;
        }
        _pobRenderUserChips();
        // Re-render de la lista de resultados con el highlight actualizado,
        // usando el cache local — sin re-fetch.
        var input = document.getElementById('pobUserSearch');
        if (input && input.value.trim()) {
            var resultsArr = Object.keys(_pobUserSearchResults).map(function (k) { return _pobUserSearchResults[k]; });
            _pobRenderUserResults(resultsArr);
        }
    };

    window.pobCerrarModal = function () {
        var modal = document.getElementById('pobModalBackdrop');
        if (modal) modal.classList.remove('open');
        _pobActiveInst = null;
        _pobCreatingMode = false;
        _pobUserSelectedIds = [];
        _pobUserSelectedMap = {};
        _pobUserSearchResults = {};
        var addForm = document.getElementById('pobAddAsigForm');
        if (addForm) addForm.style.display = 'none';
    };

    function _readForm() {
        var v = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
        return {
            descripcion: v('pobInstDescripcion').trim(),
            po: v('pobInstPo').trim(),
            cliente_nombre: v('pobInstCliente').trim(),
            fecha: v('pobInstFecha'),
            estado: v('pobInstEstado'),
            jornadas_count: parseInt(v('pobInstJornadas') || '1', 10),
            jornadas_tipo: v('pobInstJornadasTipo'),
            personal: v('pobInstPersonal').trim(),
            monto_po: v('pobInstMonto') || '0',
            utilidad: v('pobInstUtilidad') || '0',
            notas: v('pobInstNotas').trim(),
        };
    }

    window.pobGuardarCambios = function () {
        var payload = _readForm();
        if (!payload.descripcion) {
            if (typeof showToast === 'function') showToast('La descripción es obligatoria.', 'error');
            var d = document.getElementById('pobInstDescripcion'); if (d) d.focus();
            return;
        }
        var btn = document.getElementById('pobBtnGuardar');
        if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

        var url, method;
        if (_pobCreatingMode) {
            url = '/app/api/proyecto/' + _proyectoIdActivo() + '/instalaciones/';
            method = 'POST';
            // Solo en create: pasar la lista de Users elegidos en el picker.
            // El backend auto-crea Tecnico si no existe y crea la asignación
            // para la fecha programada.
            if (_pobUserSelectedIds.length) payload.tecnico_user_ids = _pobUserSelectedIds;
            // Heredar oportunidad de la opp del proyecto si la hay (vino en
            // los defaults). El backend la usa solo si no hay otra.
            if (_pobActiveInst && _pobActiveInst.oportunidad_id) {
                payload.oportunidad_id = _pobActiveInst.oportunidad_id;
            }
        } else if (_pobActiveInst && _pobActiveInst.id) {
            url = '/app/api/instalacion/' + _pobActiveInst.id + '/';
            method = 'PATCH';
        } else {
            if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
            return;
        }

        fetch(url, {
            method: method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': _csrf() },
            body: JSON.stringify(payload),
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }); })
          .then(function (res) {
              if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
              if (res.ok && res.data && res.data.success) {
                  if (typeof showToast === 'function') showToast(_pobCreatingMode ? 'Instalación creada' : 'Cambios guardados', 'success');
                  pobCerrarModal();
                  pobCargarLista();
                  // Refresca el calendario si está visible.
                  if (typeof window.calGlobalRefetch === 'function' && window._calCurrentSource === 'instalaciones') {
                      try { window.calGlobalRefetch('all'); } catch (e) {}
                  }
              } else {
                  var err = (res.data && res.data.error) || 'No se pudo guardar.';
                  if (typeof showToast === 'function') showToast(err, 'error');
              }
          })
          .catch(function () {
              if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
              if (typeof showToast === 'function') showToast('Error de red', 'error');
          });
    };

    window.pobEliminar = function () {
        if (!_pobActiveInst || !_pobActiveInst.id) return;
        if (!confirm('¿Eliminar esta instalación del Programa de Obra? Se quitan también las asignaciones de técnicos.')) return;
        fetch('/app/api/instalacion/' + _pobActiveInst.id + '/', {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: { 'X-CSRFToken': _csrf() },
        }).then(function (r) { return r.json(); }).then(function (data) {
            if (data && data.success) {
                pobCerrarModal();
                pobCargarLista();
                if (typeof window.calGlobalRefetch === 'function' && window._calCurrentSource === 'instalaciones') {
                    try { window.calGlobalRefetch('all'); } catch (e) {}
                }
            } else if (typeof showToast === 'function') {
                showToast('No se pudo eliminar.', 'error');
            }
        });
    };

    window.pobToggleAddAsig = function (forceVisible) {
        var f = document.getElementById('pobAddAsigForm');
        if (!f) return;
        if (_pobCreatingMode) {
            if (typeof showToast === 'function') showToast('Guarda la instalación antes de asignar técnicos.', 'info');
            return;
        }
        if (forceVisible === false) { f.style.display = 'none'; return; }
        if (f.style.display === 'none') {
            f.style.display = '';
            _cargarTecnicosCache();
            // Pre-llena la fecha con la fecha programada de la instalación.
            var fdate = document.getElementById('pobAddAsigFecha');
            if (fdate && _pobActiveInst && _pobActiveInst.fecha) fdate.value = _pobActiveInst.fecha;
        } else {
            f.style.display = 'none';
        }
    };

    window.pobGuardarAsignacion = function () {
        if (!_pobActiveInst || !_pobActiveInst.id) return;
        var tec = document.getElementById('pobAddAsigTecnico');
        var fch = document.getElementById('pobAddAsigFecha');
        var hi  = document.getElementById('pobAddAsigInicio');
        var hf  = document.getElementById('pobAddAsigFin');
        if (!tec || !tec.value) {
            if (typeof showToast === 'function') showToast('Selecciona un técnico', 'error');
            return;
        }
        if (!fch || !fch.value) {
            if (typeof showToast === 'function') showToast('Selecciona una fecha', 'error');
            return;
        }
        fetch('/app/api/instalacion/' + _pobActiveInst.id + '/asignaciones/', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': _csrf() },
            body: JSON.stringify({
                tecnico_id: parseInt(tec.value, 10),
                fecha: fch.value,
                hora_inicio: hi ? hi.value : '',
                hora_fin: hf ? hf.value : '',
            }),
        }).then(function (r) { return r.json(); }).then(function (data) {
            if (data && data.success) {
                // Refresca el detalle para traer las asignaciones actualizadas.
                fetch('/app/api/instalacion/' + _pobActiveInst.id + '/', { credentials: 'same-origin' })
                    .then(function (r2) { return r2.json(); })
                    .then(function (d2) {
                        if (d2 && d2.success) {
                            _pobActiveInst = d2.instalacion;
                            _renderAsignaciones(_pobActiveInst.asignaciones);
                        }
                    });
                pobToggleAddAsig(false);
                if (typeof window.calGlobalRefetch === 'function' && (window._calCurrentSource === 'instalaciones' || window._calViewMode === 'tecnicos')) {
                    try { window.calGlobalRefetch('all'); } catch (e) {}
                }
                if (typeof showToast === 'function') {
                    showToast(data.created ? 'Técnico asignado' : 'Ya estaba asignado', data.created ? 'success' : 'info');
                }
            } else if (typeof showToast === 'function') {
                showToast((data && data.error) || 'No se pudo asignar', 'error');
            }
        });
    };

    window.pobQuitarAsignacion = function (asignacionId) {
        if (!_pobActiveInst || !_pobActiveInst.id) return;
        fetch('/app/api/instalacion/' + _pobActiveInst.id + '/asignaciones/' + asignacionId + '/', {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: { 'X-CSRFToken': _csrf() },
        }).then(function (r) { return r.json(); }).then(function (data) {
            if (data && data.success) {
                // Quitar localmente sin refetch.
                if (_pobActiveInst && _pobActiveInst.asignaciones) {
                    _pobActiveInst.asignaciones = _pobActiveInst.asignaciones.filter(function (a) { return a.id !== asignacionId; });
                    _renderAsignaciones(_pobActiveInst.asignaciones);
                }
                if (typeof window.calGlobalRefetch === 'function' && (window._calCurrentSource === 'instalaciones' || window._calViewMode === 'tecnicos')) {
                    try { window.calGlobalRefetch('all'); } catch (e) {}
                }
            }
        });
    };

    // ─── Hook al cambio de tab ───────────────────────────────────────
    // El widget de Proyecto usa proyectosSetTab(); cuando active el tab
    // 'programa-obra' cargamos la lista. Si la función no existe aún,
    // dejamos un listener directo al botón.
    function _hookTabChange() {
        var btn = document.querySelector('.proy-tab-btn[data-tab="programa-obra"]');
        if (btn && !btn._pobHooked) {
            btn._pobHooked = true;
            btn.addEventListener('click', function () {
                // Pequeño defer para que proyectosSetTab termine de cambiar el pane.
                setTimeout(function () { pobCargarLista(); }, 30);
            });
        }
    }

    // Cerrar con Escape.
    document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Escape') return;
        var m = document.getElementById('pobModalBackdrop');
        if (m && m.classList.contains('open')) { pobCerrarModal(); ev.stopPropagation(); }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _hookTabChange);
    } else {
        _hookTabChange();
    }
    // Reintentar el hook después de cargas dinámicas.
    setTimeout(_hookTabChange, 1200);
    setTimeout(_hookTabChange, 3000);
})();
