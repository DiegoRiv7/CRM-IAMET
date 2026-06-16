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
        var color = p.oportunidad_etapa_color || '#7C3AED';
        var etapa = p.oportunidad_etapa || (p.oportunidad_id ? 'Sin etapa' : 'Sin oportunidad');
        var marca = p.oportunidad_producto || '—';
        var monto = p.oportunidad_monto || 0;
        var cliente = p.cliente_nombre || 'Sin cliente';
        return '<div class="crm-kanban-card crm-postit" data-proy-id="' + p.id + '" onclick="if(window.proyectosVerDetalle)proyectosVerDetalle(' + p.id + ')" style="cursor:pointer;">' +
            '<div class="crm-postit-strip" style="background:' + color + ';"></div>' +
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
            '<div style="margin-top:auto;position:relative;z-index:1;">' +
                '<div style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:#fff;border:1px solid #E5E7EB;border-radius:12px;">' +
                    '<div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;">' +
                        '<svg width="14" height="14" fill="none" stroke="#9CA3AF" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>' +
                        '<span style="font-size:0.78rem;font-weight:500;color:#6B7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(_statusLabel(p.status)) + (p.oportunidad_nombre ? ' · ' + _esc(p.oportunidad_nombre) : '') + '</span>' +
                    '</div>' +
                    '<svg width="14" height="14" fill="none" stroke="#D1D5DB" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    // ── Estado de filtros (cliente, etapa, monto, fechas) ──────────────
    var _proyFilters = { etapa: [], cliente: [], montoMin: null, montoMax: null, fDesde: '', fHasta: '' };
    var _lastProjects = [];

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
        _buildFilterMenu();   // refrescar opciones (clientes) según datos

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

    /* ── Filtro estilo Oportunidades (Etapa · Cliente · Monto · Fechas) ──
       Inyecta un formulario compacto en el menú existente #proyFilterMenu y
       filtra del lado cliente sobre los proyectos ya cargados. */
    function _uniqueClientes() {
        var set = {}, out = [];
        _lastProjects.forEach(function (p) {
            var c = (p.cliente_nombre || '').trim();
            if (c && !set[c]) { set[c] = 1; out.push(c); }
        });
        return out.sort();
    }
    function _buildFilterMenu() {
        var menu = document.getElementById('proyFilterMenu');
        if (!menu) return;
        // Si el menú está abierto, no reconstruir (no perder el foco/scroll).
        if (menu.style.display === 'block' && menu.getAttribute('data-built') === '1') return;

        var f = _proyFilters;
        var stages = _stages().map(function (s) { return { k: s.nombre.trim().toUpperCase(), label: s.nombre, color: s.color }; });
        stages.push({ k: SIN_OPP, label: 'Sin oportunidad', color: '#94A3B8' });

        var etapaChips = stages.map(function (s) {
            var on = f.etapa.indexOf(s.k) !== -1;
            return '<button type="button" class="proyf-chip' + (on ? ' on' : '') + '" data-etapa="' + _esc(s.k) + '">' +
                '<span style="width:7px;height:7px;border-radius:50%;background:' + s.color + ';display:inline-block;margin-right:5px;"></span>' + _esc(s.label) + '</button>';
        }).join('');

        var clienteOpts = '<option value="">Todos los clientes</option>' + _uniqueClientes().map(function (c) {
            return '<option value="' + _esc(c) + '"' + (f.cliente.indexOf(c) !== -1 ? ' selected' : '') + '>' + _esc(c) + '</option>';
        }).join('');

        menu.style.minWidth = '300px';
        menu.innerHTML =
            '<div class="proyf-sec-label">Etapa</div>' +
            '<div class="proyf-chips" id="proyfEtapas">' + etapaChips + '</div>' +
            '<div class="proyf-sec-label">Cliente</div>' +
            '<select class="proyf-input" id="proyfCliente">' + clienteOpts + '</select>' +
            '<div class="proyf-sec-label">Monto (MXN)</div>' +
            '<div class="proyf-row"><input class="proyf-input" id="proyfMin" type="number" inputmode="numeric" placeholder="Mín" value="' + (f.montoMin != null ? f.montoMin : '') + '"><span class="proyf-dash">–</span><input class="proyf-input" id="proyfMax" type="number" inputmode="numeric" placeholder="Máx" value="' + (f.montoMax != null ? f.montoMax : '') + '"></div>' +
            '<div class="proyf-sec-label">Fecha de creación</div>' +
            '<div class="proyf-row"><input class="proyf-input" id="proyfDesde" type="date" value="' + _esc(f.fDesde) + '"><span class="proyf-dash">–</span><input class="proyf-input" id="proyfHasta" type="date" value="' + _esc(f.fHasta) + '"></div>' +
            '<div class="proyf-actions"><button type="button" class="proyf-btn-clear" id="proyfClear">Limpiar</button><button type="button" class="proyf-btn-apply" id="proyfApply">Aplicar</button></div>';
        menu.setAttribute('data-built', '1');

        // Toggle de chips de etapa (sin cerrar el menú)
        menu.querySelectorAll('#proyfEtapas .proyf-chip').forEach(function (chip) {
            chip.addEventListener('click', function (e) {
                e.stopPropagation();
                chip.classList.toggle('on');
            });
        });
        // Evitar que clicks dentro del menú lo cierren (una sola vez).
        if (!menu._proyfBound) {
            menu.addEventListener('click', function (e) { e.stopPropagation(); });
            menu._proyfBound = true;
        }

        var apply = menu.querySelector('#proyfApply');
        if (apply) apply.addEventListener('click', function () {
            var etapas = [];
            menu.querySelectorAll('#proyfEtapas .proyf-chip.on').forEach(function (c) { etapas.push(c.getAttribute('data-etapa')); });
            var cli = (menu.querySelector('#proyfCliente') || {}).value || '';
            var mn = (menu.querySelector('#proyfMin') || {}).value;
            var mx = (menu.querySelector('#proyfMax') || {}).value;
            _proyFilters = {
                etapa: etapas,
                cliente: cli ? [cli] : [],
                montoMin: mn !== '' ? parseFloat(mn) : null,
                montoMax: mx !== '' ? parseFloat(mx) : null,
                fDesde: (menu.querySelector('#proyfDesde') || {}).value || '',
                fHasta: (menu.querySelector('#proyfHasta') || {}).value || ''
            };
            menu.style.display = 'none';
            _updateFilterPill();
            window.proyKanbanRender(_lastProjects);
        });
        var clr = menu.querySelector('#proyfClear');
        if (clr) clr.addEventListener('click', function () {
            _proyFilters = { etapa: [], cliente: [], montoMin: null, montoMax: null, fDesde: '', fHasta: '' };
            menu.setAttribute('data-built', '0');
            _buildFilterMenu();
            menu.style.display = 'none';
            _updateFilterPill();
            window.proyKanbanRender(_lastProjects);
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
})();
