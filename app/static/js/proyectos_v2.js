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
        return String(p.oportunidad_etapa || '').trim().toUpperCase();
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

    window.proyKanbanRender = function (projects) {
        var board = document.getElementById('proyKanbanBoard');
        if (!board) return;
        projects = projects || [];

        var byCol = {};
        projects.forEach(function (p) {
            var k = _columnKey(p);
            (byCol[k] = byCol[k] || []).push(p);
        });

        // Columnas: etapas del pipeline 'proyecto' (en orden) + etapas extra que
        // aparezcan en los datos (por si una opp tiene una etapa fuera del set) +
        // "Sin oportunidad" al final.
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

        if (!cols.length) {
            board.innerHTML = '<div style="padding:60px;text-align:center;color:#9CA3AF;width:100%;">No hay proyectos</div>';
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
                            '<span class="crm-kanban-dot' + (cards.length ? ' active' : '') + '" style="background:' + col.color + ';"></span>' +
                            '<span class="crm-kanban-stage-name">' + _esc(col.label) + '</span>' +
                            '<span class="crm-kanban-count">' + cards.length + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="crm-kanban-head-bottom">' +
                        '<span class="crm-kanban-total-label">Total:</span> ' +
                        '<span class="crm-kanban-total-value">' + _moneyShort(total) + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="crm-kanban-col-body">' +
                    (cards.length ? cards.map(_card).join('') : '<div style="padding:22px 8px;text-align:center;color:#A0AAB8;font-size:0.78rem;">Sin proyectos</div>') +
                '</div>' +
            '</div>';
        });
        board.innerHTML = html;
    };

    // Toggle Kanban ⇄ Lista (recordado en localStorage).
    window.proyToggleView = function (mode) {
        var kanban = document.getElementById('proyKanbanBoard');
        var list = document.getElementById('proyListView');
        var empty = document.getElementById('proyEmpty');
        var btnK = document.getElementById('proyViewKanbanBtn');
        var btnL = document.getElementById('proyViewListBtn');
        var showList = (mode === 'list');
        if (kanban) kanban.style.display = showList ? 'none' : 'flex';
        if (list) list.style.display = showList ? '' : 'none';
        if (empty && !showList) empty.style.display = 'none';
        if (btnK) btnK.classList.toggle('active', !showList);
        if (btnL) btnL.classList.toggle('active', showList);
        try { localStorage.setItem('proyView', showList ? 'list' : 'kanban'); } catch (e) { }
    };

    // Aplicar la vista guardada al cargar (default: kanban).
    function _applySavedView() {
        var saved = 'kanban';
        try { saved = localStorage.getItem('proyView') || 'kanban'; } catch (e) { }
        if (document.getElementById('proyKanbanBoard')) window.proyToggleView(saved);
    }
    if (window.crmReady) window.crmReady(_applySavedView);
    document.addEventListener('DOMContentLoaded', _applySavedView);
})();
