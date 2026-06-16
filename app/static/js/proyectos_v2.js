/* ═══════════════════════════════════════════════════════════════════════
 * proyectos_v2.js — CÓDIGO NUEVO (desde 2026-06-04)
 *
 * Aquí va TODA modificación o nueva feature del módulo Proyectos
 * (lista, detalle, levantamientos, drive, programa de obra). NO
 * modificar crm_proyectos.js (7,400+ líneas) — está marcado como
 * LEGACY por Boy Scout Rule.
 *
 * Cuándo escribir aquí:
 *   - Nuevos campos o secciones en el detalle de proyecto
 *   - Cambios al kanban / lista de proyectos
 *   - Nuevas integraciones (PDFs, exportar, importar)
 *   - Mejoras al programa de obra (programa_obra.js también es legacy)
 *
 * Cuándo escribir en crm_proyectos.js / programa_obra.js (legacy):
 *   - Solo bug crítico de producción
 *
 * IMPORTANTE: el módulo Proyectos tiene dos modelos paralelos en backend
 * (Proyecto legacy vs ProyectoIAMET moderno). Para nuevas features,
 * usar SIEMPRE ProyectoIAMET y sus endpoints en `views_iamet.py`. Ver
 * DECISIONES.md cuando se cree.
 *
 * Convenciones obligatorias:
 *   - IIFE con 'use strict'
 *   - Idempotente, listeners delegation
 *   - Reusar CRMHelpers / widget_data_bus / widget_toast
 *
 * Para activar: agregar `<script src=".../proyectos_v2.js">` en
 * `crm_home.html` después de crm_proyectos.js.
 * ═══════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    /* ════════════════════════════════════════════════════════════════════
       KANBAN DE PROYECTOS (reemplaza la tabla)
       Mismo formato/colores que el kanban de Oportunidades (.crm-kanban-*,
       .crm-postit). Columnas = etapas del pipeline 'proyecto' (la etapa de
       cada proyecto = la de su oportunidad ligada) + una columna final
       "Sin oportunidad". Solo lectura: la etapa la manda la oportunidad.
       Se re-renderiza con los mismos datos filtrados/ordenados de la lista
       (hook window.proyKanbanRender llamado desde crm_proyectos.js).
       Reusa el CSS existente → Modo Ligero ya cubierto (perf_lite.css).
       ════════════════════════════════════════════════════════════════════ */

    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }
    function _money(n) {
        n = parseFloat(n) || 0;
        return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function _moneyShort(n) {
        n = parseFloat(n) || 0;
        return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' MXN';
    }
    function _statusLabel(s) {
        return ({ planning: 'Planificación', active: 'Activo', paused: 'Pausado', completed: 'Completado', archived: 'Archivado' })[s] || 'Activo';
    }
    function _stages() {
        var cfg = (window._CRM_CONFIG && window._CRM_CONFIG.etapasPipeline) || {};
        return (cfg.proyecto || []).map(function (e) { return { nombre: e.nombre, color: e.color || '#3B82F6' }; });
    }
    var SIN_OPP = '__sin_opp__';
    function _columnKey(p) {
        if (!p.oportunidad_id) return SIN_OPP;
        var e = String(p.oportunidad_etapa || '').trim().toUpperCase();
        return e || 'SIN ETAPA';
    }

    function _card(p) {
        var avance = Math.max(0, Math.min(100, parseInt(p.oportunidad_probabilidad || 0, 10) || 0));
        // Todas las tarjetas de PROYECTO en morado (identidad visual de
        // proyecto), sin importar la etapa de la oportunidad ligada.
        var color = '#7C3AED';
        var etapa = p.oportunidad_etapa || (p.oportunidad_id ? 'Sin etapa' : 'Sin oportunidad');
        var marca = p.oportunidad_producto || '—';
        var monto = p.oportunidad_monto || 0;
        var cliente = p.cliente_nombre || 'Sin cliente';
        var oppId = parseInt(p.oportunidad_id || 0, 10) || 0;
        var oppNombre = p.oportunidad_nombre || '';
        var hasOpp = !!(oppId && oppNombre);
        return '<div class="crm-kanban-card crm-postit" data-proy-id="' + p.id + '" onclick="if(window.proyectosVerDetalle)proyectosVerDetalle(' + p.id + ')" style="cursor:pointer;">' +
            '<div class="crm-postit-strip" style="background:linear-gradient(180deg,#A78BFA 0%,#7C3AED 100%);"></div>' +
            '<div style="margin-bottom:12px;padding-right:8px;position:relative;z-index:1;">' +
                '<h3 style="font-size:0.95rem;font-weight:700;color:#2563EB;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + _esc(p.nombre || 'Proyecto') + '</h3>' +
                '<div style="font-size:0.8rem;font-weight:500;color:#6B7280;margin-top:2px;">' + _esc(cliente) + '</div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;position:relative;z-index:1;">' +
                '<div style="background:#F8FAFC;border-radius:12px;padding:10px 12px;border:1px solid #E2E8F0;">' +
                    '<div style="font-size:0.58rem;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Valor Total</div>' +
                    '<div style="font-size:0.95rem;font-weight:700;color:#0F172A;">' + _money(monto) + '</div>' +
                '</div>' +
                '<div style="background:#F8FAFC;border-radius:12px;padding:10px 12px;border:1px solid #E2E8F0;">' +
                    '<div style="font-size:0.58rem;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Marca</div>' +
                    '<div style="font-size:0.85rem;font-weight:700;color:#0F172A;text-transform:uppercase;">' + _esc(marca) + '</div>' +
                '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;position:relative;z-index:1;">' +
                '<div style="display:flex;align-items:center;gap:10px;">' +
                    '<div style="position:relative;width:40px;height:40px;flex-shrink:0;">' +
                        '<svg viewBox="0 0 36 36" style="width:40px;height:40px;transform:rotate(-90deg);">' +
                            '<circle cx="18" cy="18" r="15.5" fill="none" stroke="#E5E7EB" stroke-width="2.5" pathLength="100"/>' +
                            '<circle cx="18" cy="18" r="15.5" fill="none" stroke="' + color + '" stroke-width="2.5" pathLength="100" stroke-dasharray="' + avance + ' 100" stroke-linecap="round"/>' +
                        '</svg>' +
                        '<span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:0.55rem;font-weight:800;color:#0F172A;">' + avance + '%</span>' +
                    '</div>' +
                    '<div>' +
                        '<div style="font-size:0.58rem;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.04em;">Etapa</div>' +
                        '<div style="font-size:0.85rem;font-weight:700;color:#0F172A;">' + _esc(etapa) + '</div>' +
                    '</div>' +
                '</div>' +
                '<div style="font-size:0.68rem;font-weight:700;padding:4px 10px;border-radius:8px;border:1px solid;background:#F5F3FF;color:#7C3AED;border-color:#DDD6FE;">Proyecto</div>' +
            '</div>' +
            // Footer = la OPORTUNIDAD ligada. Clic aquí abre la VENTANA de la
            // oportunidad (no el proyecto): stopPropagation corta el onclick del
            // card. Si el proyecto no tiene opp, queda informativo (no clickable).
            '<div style="margin-top:auto;position:relative;z-index:1;">' +
                '<div' + (hasOpp ? ' onclick="event.stopPropagation(); if(window.openDetalle)window.openDetalle(' + oppId + ',{asWindow:true});"' : '') +
                    ' style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:#fff;border:1px solid #E5E7EB;border-radius:12px;cursor:' + (hasOpp ? 'pointer' : 'default') + ';">' +
                    '<div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;">' +
                        '<svg width="14" height="14" fill="none" stroke="' + (hasOpp ? '#2563EB' : '#9CA3AF') + '" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
                        '<span style="font-size:0.78rem;font-weight:500;color:' + (hasOpp ? '#2563EB' : '#9CA3AF') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(hasOpp ? oppNombre : 'Sin oportunidad ligada') + '</span>' +
                    '</div>' +
                    (hasOpp ? '<svg width="14" height="14" fill="none" stroke="#93B4F5" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>' : '') +
                '</div>' +
            '</div>' +
        '</div>';
    }

    // ── Estado de filtros (cliente, etapa, monto, fechas) ──────────────
    var _proyFilters = { etapa: [], cliente: [], montoMin: null, montoMax: null, fDesde: '', fHasta: '' };
    var _lastProjects = [];

    // ── Periodo (Mes/Año), como Oportunidades ──────────────────────────
    // Default: mes y año ACTUALES (se recalcula en cada carga → al entrar un
    // mes nuevo, arranca en ese mes). Arrays vacíos = "todos". Filtra por
    // created_at del proyecto.
    var _MESES_NOM = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    var _pNow = new Date();
    // Default: TODO el año actual (todos los meses). meses:[] = todos. Así el
    // tablero no se ve casi vacío; al entrar un año nuevo arranca en ese año.
    var _proyPeriod = { meses: [], anios: [_pNow.getFullYear()] };
    var _proyPeriodTemp = { meses: [], anios: [] };

    function _applyFilters(projects) {
        var f = _proyFilters;
        return projects.filter(function (p) {
            if (f.etapa.length && f.etapa.indexOf(_columnKey(p)) === -1) return false;
            if (f.cliente.length && f.cliente.indexOf((p.cliente_nombre || '').trim()) === -1) return false;
            var monto = parseFloat(p.oportunidad_monto || 0) || 0;
            if (f.montoMin != null && monto < f.montoMin) return false;
            if (f.montoMax != null && monto > f.montoMax) return false;
            if (f.fDesde || f.fHasta) {
                var d = String(p.created_at || '').slice(0, 10);
                if (f.fDesde && d < f.fDesde) return false;
                if (f.fHasta && d > f.fHasta) return false;
            }
            // Periodo Mes/Año por created_at. Proyectos sin fecha no se ocultan.
            if (_proyPeriod.meses.length || _proyPeriod.anios.length) {
                var pd = String(p.created_at || '').slice(0, 10);
                if (pd) {
                    var yr = parseInt(pd.slice(0, 4), 10);
                    var mo = parseInt(pd.slice(5, 7), 10);
                    if (_proyPeriod.meses.length && _proyPeriod.meses.indexOf(mo) === -1) return false;
                    if (_proyPeriod.anios.length && _proyPeriod.anios.indexOf(yr) === -1) return false;
                }
            }
            return true;
        });
    }
    function _filtersActive() {
        var f = _proyFilters;
        return !!(f.etapa.length || f.cliente.length || f.montoMin != null || f.montoMax != null || f.fDesde || f.fHasta);
    }

    window.proyKanbanRender = function (projects) {
        var board = document.getElementById('proyKanbanBoard');
        if (!board) return;
        _lastProjects = projects || [];
        // Kanban = ÚNICA vista: ocultar siempre la lista vieja y su vacío.
        var listView = document.getElementById('proyListView');
        if (listView) listView.style.display = 'none';
        var emptyEl = document.getElementById('proyEmpty');
        if (emptyEl) emptyEl.style.display = 'none';
        board.style.display = 'flex';

        var filtered = _applyFilters(_lastProjects);
        _updateFilterPill();

        var byCol = {};
        filtered.forEach(function (p) {
            var k = _columnKey(p);
            (byCol[k] = byCol[k] || []).push(p);
        });

        // Columnas: etapas del pipeline 'proyecto' (en orden) + etapas extra +
        // "Sin oportunidad". Se OCULTAN las columnas vacías para que las
        // tarjetas se vean de inmediato (no quedan escondidas a la derecha).
        var cols = [], seen = {};
        _stages().forEach(function (s) {
            var key = s.nombre.trim().toUpperCase();
            cols.push({ key: key, label: s.nombre, color: s.color }); seen[key] = true;
        });
        Object.keys(byCol).forEach(function (k) {
            if (k === SIN_OPP || seen[k]) return;
            cols.push({ key: k, label: k, color: (byCol[k][0].oportunidad_etapa_color || '#64748B') }); seen[k] = true;
        });
        if (byCol[SIN_OPP] && byCol[SIN_OPP].length) {
            cols.push({ key: SIN_OPP, label: 'Sin oportunidad', color: '#94A3B8' });
        }
        cols = cols.filter(function (c) { return (byCol[c.key] || []).length > 0; });

        if (!cols.length) {
            board.innerHTML = '<div style="padding:80px 20px;text-align:center;color:#9CA3AF;width:100%;font-size:0.9rem;">' +
                (_filtersActive() ? 'Ningún proyecto coincide con los filtros.' : 'No hay proyectos.') + '</div>';
            return;
        }

        var html = '';
        cols.forEach(function (col) {
            var cards = byCol[col.key] || [];
            var total = 0;
            cards.forEach(function (p) { total += parseFloat(p.oportunidad_monto || 0) || 0; });
            html += '<div class="crm-kanban-col" data-stage="' + _esc(col.key) + '">' +
                '<div class="crm-kanban-head">' +
                    '<div class="crm-kanban-head-top">' +
                        '<div class="crm-kanban-head-title">' +
                            '<span class="crm-kanban-dot active" style="background:' + col.color + ';"></span>' +
                            '<span class="crm-kanban-stage-name">' + _esc(col.label) + '</span>' +
                            '<span class="crm-kanban-count">' + cards.length + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="crm-kanban-head-bottom">' +
                        '<span class="crm-kanban-total-label">Total:</span> ' +
                        '<span class="crm-kanban-total-value">' + _moneyShort(total) + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="crm-kanban-col-body">' + cards.map(_card).join('') + '</div>' +
            '</div>';
        });
        board.innerHTML = html;
    };

    /* ════════════════════════════════════════════════════════════════════
       FILTRO estilo Oportunidades — popover de 2 niveles:
       1) "FILTRAR POR" → lista de dimensiones (Cliente · Etapa · Monto · Fecha)
       2) al elegir una → buscador + checklist MULTI-SELECCIÓN + Quitar/Aplicar
       Filtra del lado cliente sobre los proyectos ya cargados.
       ════════════════════════════════════════════════════════════════════ */
    var _facetView = 'dims';          // 'dims' | 'cliente' | 'etapa' | 'monto' | 'fecha'
    var _facetTemp = { cliente: {}, etapa: {} };   // selección temporal (multi) por dim
    var _facetMonto = { min: '', max: '' };
    var _facetFecha = { desde: '', hasta: '' };
    var DIMS = [
        { k: 'cliente', label: 'Cliente' },
        { k: 'etapa', label: 'Etapa' },
        { k: 'monto', label: 'Monto' },
        { k: 'fecha', label: 'Fecha de creación' }
    ];

    function _uniqueClientes() {
        var set = {}, out = [];
        _lastProjects.forEach(function (p) {
            var c = (p.cliente_nombre || '').trim();
            if (c && !set[c]) { set[c] = 1; out.push(c); }
        });
        return out.sort();
    }
    function _facetValues(dim) {
        if (dim === 'etapa') {
            var st = _stages().map(function (s) { return { v: s.nombre.trim().toUpperCase(), label: s.nombre, color: s.color }; });
            st.push({ v: SIN_OPP, label: 'Sin oportunidad', color: '#94A3B8' });
            return st;
        }
        return _uniqueClientes().map(function (c) { return { v: c, label: c }; });
    }
    function _fm() { return document.getElementById('proyFilterMenu'); }

    window.proyFilterOpen = function (e) {
        if (e) e.stopPropagation();
        var m = _fm(); if (!m) return;
        var sm = document.getElementById('proySortMenu'); if (sm) sm.style.display = 'none';
        if (m.style.display === 'block') { m.style.display = 'none'; return; }
        _facetView = 'dims';
        _facetRender();
        m.style.display = 'block';
    };

    function _facetOpenDim(dim) {
        _facetView = dim;
        if (dim === 'cliente' || dim === 'etapa') {
            _facetTemp[dim] = {};
            (_proyFilters[dim] || []).forEach(function (v) { _facetTemp[dim][v] = 1; });
        } else if (dim === 'monto') {
            _facetMonto = { min: _proyFilters.montoMin != null ? _proyFilters.montoMin : '', max: _proyFilters.montoMax != null ? _proyFilters.montoMax : '' };
        } else if (dim === 'fecha') {
            _facetFecha = { desde: _proyFilters.fDesde || '', hasta: _proyFilters.fHasta || '' };
        }
        _facetRender();
    }
    function _facetCloseApply() { var m = _fm(); if (m) m.style.display = 'none'; _updateFilterPill(); window.proyKanbanRender(_lastProjects); }

    function _facetRender() {
        var m = _fm(); if (!m) return;
        if (!m._proyfBound) { m.addEventListener('click', function (e) { e.stopPropagation(); }); m._proyfBound = true; }
        m.style.minWidth = '290px';
        if (_facetView === 'dims') { m.innerHTML = _facetDimsHtml(); _wireDims(m); }
        else if (_facetView === 'monto') { m.innerHTML = _facetRangeHtml('monto'); _wireRange(m, 'monto'); }
        else if (_facetView === 'fecha') { m.innerHTML = _facetRangeHtml('fecha'); _wireRange(m, 'fecha'); }
        else { m.innerHTML = _facetListHtml(_facetView); _wireList(m, _facetView); }
    }
    function _facetDimsHtml() {
        var f = _proyFilters;
        function badge(n) { return n ? '<span class="pf-dim-badge">' + n + '</span>' : ''; }
        return '<div class="pf-head">Filtrar por</div>' + DIMS.map(function (d) {
            var n = d.k === 'cliente' ? f.cliente.length : d.k === 'etapa' ? f.etapa.length :
                d.k === 'monto' ? ((f.montoMin != null || f.montoMax != null) ? 1 : 0) : ((f.fDesde || f.fHasta) ? 1 : 0);
            return '<button type="button" class="pf-dim" data-dim="' + d.k + '">' + d.label + badge(n) +
                '<svg width="15" height="15" fill="none" stroke="#CBD5E1" stroke-width="2" viewBox="0 0 24 24" style="margin-left:auto;"><path d="M9 18l6-6-6-6"/></svg></button>';
        }).join('') + (_filtersActive() ? '<button type="button" class="pf-clear-all" data-act="clear-all">Limpiar todo</button>' : '');
    }
    function _facetListHtml(dim) {
        var vals = _facetValues(dim), temp = _facetTemp[dim] || {};
        var cnt = Object.keys(temp).filter(function (k) { return temp[k]; }).length;
        var rows = vals.map(function (o) {
            var on = !!temp[o.v];
            return '<button type="button" class="pf-opt' + (on ? ' on' : '') + '" data-val="' + _esc(o.v) + '">' +
                (o.color ? '<span class="pf-dot" style="background:' + o.color + '"></span>' : '') +
                '<span class="pf-opt-label">' + _esc(o.label) + '</span>' +
                '<svg class="pf-check" width="16" height="16" fill="none" stroke="#2563EB" stroke-width="2.6" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></button>';
        }).join('') || '<div class="pf-empty">Sin opciones</div>';
        var title = dim === 'cliente' ? 'Cliente' : 'Etapa';
        return '<button type="button" class="pf-back" data-act="back">‹ ' + title + '</button>' +
            '<div class="pf-search"><svg width="14" height="14" fill="none" stroke="#8e8e93" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M16 16l4 4"/></svg><input type="text" placeholder="Buscar ' + (dim === 'cliente' ? 'cliente' : 'etapa') + '..."></div>' +
            '<div class="pf-list">' + rows + '</div>' +
            '<div class="pf-actions"><button type="button" class="pf-clear" data-act="clear">Quitar</button><button type="button" class="pf-apply" data-act="apply">Aplicar (' + cnt + ')</button></div>';
    }
    function _facetRangeHtml(dim) {
        var isMonto = dim === 'monto';
        var a = isMonto ? _facetMonto.min : _facetFecha.desde;
        var b = isMonto ? _facetMonto.max : _facetFecha.hasta;
        var t = isMonto ? 'number' : 'date';
        var ph1 = isMonto ? 'Mín' : '', ph2 = isMonto ? 'Máx' : '';
        return '<button type="button" class="pf-back" data-act="back">‹ ' + (isMonto ? 'Monto' : 'Fecha de creación') + '</button>' +
            '<div class="pf-range"><input class="proyf-input" id="pfA" type="' + t + '" inputmode="numeric" placeholder="' + ph1 + '" value="' + _esc(a) + '"><span class="proyf-dash">–</span><input class="proyf-input" id="pfB" type="' + t + '" inputmode="numeric" placeholder="' + ph2 + '" value="' + _esc(b) + '"></div>' +
            '<div class="pf-actions"><button type="button" class="pf-clear" data-act="clear">Quitar</button><button type="button" class="pf-apply" data-act="apply">Aplicar</button></div>';
    }
    function _wireDims(m) {
        m.querySelectorAll('.pf-dim').forEach(function (b) { b.addEventListener('click', function () { _facetOpenDim(b.getAttribute('data-dim')); }); });
        var ca = m.querySelector('[data-act="clear-all"]');
        if (ca) ca.addEventListener('click', function () {
            _proyFilters = { etapa: [], cliente: [], montoMin: null, montoMax: null, fDesde: '', fHasta: '' };
            _facetCloseApply();
        });
    }
    function _wireList(m, dim) {
        m.querySelector('[data-act="back"]').addEventListener('click', function () { _facetView = 'dims'; _facetRender(); });
        var inp = m.querySelector('.pf-search input');
        if (inp) {
            inp.addEventListener('input', function () {
                var q = this.value.toLowerCase();
                m.querySelectorAll('.pf-opt').forEach(function (o) {
                    var lbl = (o.querySelector('.pf-opt-label').textContent || '').toLowerCase();
                    o.style.display = (!q || lbl.indexOf(q) !== -1) ? '' : 'none';
                });
            });
            setTimeout(function () { try { inp.focus(); } catch (e) { } }, 30);
        }
        m.querySelectorAll('.pf-opt').forEach(function (o) {
            o.addEventListener('click', function () {
                var v = o.getAttribute('data-val');
                if (_facetTemp[dim][v]) delete _facetTemp[dim][v]; else _facetTemp[dim][v] = 1;
                o.classList.toggle('on');
                var ap = m.querySelector('.pf-apply');
                if (ap) ap.textContent = 'Aplicar (' + Object.keys(_facetTemp[dim]).length + ')';
            });
        });
        m.querySelector('[data-act="clear"]').addEventListener('click', function () { _proyFilters[dim] = []; _facetCloseApply(); });
        m.querySelector('[data-act="apply"]').addEventListener('click', function () { _proyFilters[dim] = Object.keys(_facetTemp[dim]); _facetCloseApply(); });
    }
    function _wireRange(m, dim) {
        m.querySelector('[data-act="back"]').addEventListener('click', function () { _facetView = 'dims'; _facetRender(); });
        m.querySelector('[data-act="clear"]').addEventListener('click', function () {
            if (dim === 'monto') { _proyFilters.montoMin = null; _proyFilters.montoMax = null; }
            else { _proyFilters.fDesde = ''; _proyFilters.fHasta = ''; }
            _facetCloseApply();
        });
        m.querySelector('[data-act="apply"]').addEventListener('click', function () {
            var a = (m.querySelector('#pfA') || {}).value, b = (m.querySelector('#pfB') || {}).value;
            if (dim === 'monto') { _proyFilters.montoMin = a !== '' ? parseFloat(a) : null; _proyFilters.montoMax = b !== '' ? parseFloat(b) : null; }
            else { _proyFilters.fDesde = a || ''; _proyFilters.fHasta = b || ''; }
            _facetCloseApply();
        });
    }

    function _updateFilterPill() {
        var btn = document.getElementById('proyFilterBtn');
        var lbl = document.getElementById('proyFilterLabel');
        var n = (_proyFilters.etapa.length ? 1 : 0) + (_proyFilters.cliente.length ? 1 : 0) +
            ((_proyFilters.montoMin != null || _proyFilters.montoMax != null) ? 1 : 0) +
            ((_proyFilters.fDesde || _proyFilters.fHasta) ? 1 : 0);
        if (lbl) lbl.textContent = n ? ('Filtro · ' + n) : 'Filtro';
        if (btn) btn.classList.toggle('active', n > 0);
    }

    // ── Periodo (Mes/Año): pill + popover multi-select estilo Oportunidades ──
    function _periodLabel() {
        var m = _proyPeriod.meses, a = _proyPeriod.anios;
        var ml = !m.length ? 'Todos' : (m.length === 1 ? _MESES_NOM[m[0] - 1] : (m.length + ' meses'));
        var al = !a.length ? 'Todos' : (a.length === 1 ? String(a[0]) : (a.length + ' años'));
        return ml + ' · ' + al;
    }
    function _updatePeriodPill() {
        var lbl = document.getElementById('proyPeriodLabel');
        if (lbl) lbl.textContent = _periodLabel();
        var btn = document.getElementById('proyPeriodBtn');
        if (btn) btn.classList.toggle('active', !!(_proyPeriod.meses.length || _proyPeriod.anios.length));
    }
    function _periodYears() {
        var cur = _pNow.getFullYear(), ys = [];
        for (var y = 2024; y <= cur + 1; y++) ys.push(y);
        return ys;
    }
    function _periodClose() { var m = document.getElementById('proyPeriodMenu'); if (m) m.style.display = 'none'; }
    function _periodRender() {
        var m = document.getElementById('proyPeriodMenu'); if (!m) return;
        if (!m._pBound) { m.addEventListener('click', function (e) { e.stopPropagation(); }); m._pBound = true; }
        var t = _proyPeriodTemp;
        function ck(on) { return on ? '<svg class="pp-ck" width="15" height="15" fill="none" stroke="#2563EB" stroke-width="2.6" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>' : ''; }
        var mesesHtml = '<button type="button" class="pp-opt' + (!t.meses.length ? ' on' : '') + '" data-pm="0">Todos los meses' + ck(!t.meses.length) + '</button>';
        _MESES_NOM.forEach(function (nom, i) {
            var on = t.meses.indexOf(i + 1) !== -1;
            mesesHtml += '<button type="button" class="pp-opt' + (on ? ' on' : '') + '" data-pm="' + (i + 1) + '">' + nom + ck(on) + '</button>';
        });
        var aniosHtml = '<button type="button" class="pp-opt' + (!t.anios.length ? ' on' : '') + '" data-pa="0">Todos los años' + ck(!t.anios.length) + '</button>';
        _periodYears().forEach(function (y) {
            var on = t.anios.indexOf(y) !== -1;
            aniosHtml += '<button type="button" class="pp-opt' + (on ? ' on' : '') + '" data-pa="' + y + '">' + y + ck(on) + '</button>';
        });
        m.innerHTML =
            '<div class="pp-cols">' +
                '<div class="pp-col"><div class="pp-col-head">Meses</div><div class="pp-list">' + mesesHtml + '</div></div>' +
                '<div class="pp-col"><div class="pp-col-head">Años</div><div class="pp-list">' + aniosHtml + '</div></div>' +
            '</div>' +
            '<div class="pp-actions"><button type="button" class="pp-reset" data-pact="reset">Restablecer</button><button type="button" class="pp-apply" data-pact="apply">Aplicar</button></div>';
        m.querySelectorAll('[data-pm]').forEach(function (b) {
            b.addEventListener('click', function () {
                var v = parseInt(b.getAttribute('data-pm'), 10);
                if (v === 0) { t.meses = []; }
                else { var ix = t.meses.indexOf(v); if (ix === -1) t.meses.push(v); else t.meses.splice(ix, 1); }
                _periodRender();
            });
        });
        m.querySelectorAll('[data-pa]').forEach(function (b) {
            b.addEventListener('click', function () {
                var v = parseInt(b.getAttribute('data-pa'), 10);
                if (v === 0) { t.anios = []; }
                else { var ix = t.anios.indexOf(v); if (ix === -1) t.anios.push(v); else t.anios.splice(ix, 1); }
                _periodRender();
            });
        });
        m.querySelector('[data-pact="reset"]').addEventListener('click', function () {
            // Restablecer = default: todos los meses del año actual.
            t.meses = []; t.anios = [_pNow.getFullYear()];
            _proyPeriod = { meses: t.meses.slice(), anios: t.anios.slice() };
            _updatePeriodPill(); _periodClose(); window.proyKanbanRender(_lastProjects);
        });
        m.querySelector('[data-pact="apply"]').addEventListener('click', function () {
            _proyPeriod = { meses: t.meses.slice(), anios: t.anios.slice() };
            _updatePeriodPill(); _periodClose(); window.proyKanbanRender(_lastProjects);
        });
    }
    window.proyPeriodToggle = function (e) {
        if (e) e.stopPropagation();
        var m = document.getElementById('proyPeriodMenu'); if (!m) return;
        var fm = document.getElementById('proyFilterMenu'); if (fm) fm.style.display = 'none';
        var sm = document.getElementById('proySortMenu'); if (sm) sm.style.display = 'none';
        if (m.style.display === 'block') { m.style.display = 'none'; return; }
        _proyPeriodTemp = { meses: _proyPeriod.meses.slice(), anios: _proyPeriod.anios.slice() };
        _periodRender();
        m.style.display = 'block';
    };
    // Cerrar el popover al hacer click afuera.
    document.addEventListener('click', function (e) {
        var m = document.getElementById('proyPeriodMenu');
        if (!m || m.style.display !== 'block') return;
        var btn = document.getElementById('proyPeriodBtn');
        if (!m.contains(e.target) && !(btn && btn.contains(e.target))) m.style.display = 'none';
    });
    // Pintar el label inicial (mes·año actual).
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _updatePeriodPill);
    else _updatePeriodPill();
})();
