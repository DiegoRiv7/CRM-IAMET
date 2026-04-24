// crm_prospectos_kanban.js — Kanban de Prospectos (tab=prospectos)
// Reusa clases .crm-kanban-*, .crm-postit para compartir diseño con el kanban
// de Oportunidades; variant café vía .crm-postit--prospecto.
(function() {
    'use strict';

    var board = document.getElementById('pkKanbanBoard');
    if (!board) return; // Solo corre en tab=prospectos

    // Etapas en orden (del Prospecto.ETAPA_CHOICES, sin incluir cerrado_perdido)
    var ETAPAS = [
        { key: 'identificado', label: 'Identificado',  color: '#9CA3AF' },
        { key: 'calificado',   label: 'Calificado',    color: '#60A5FA' },
        { key: 'reunion',      label: 'Reunión',       color: '#A78BFA' },
        { key: 'en_progreso',  label: 'En Progreso',   color: '#F59E0B' },
        { key: 'procesado',    label: 'Procesado',     color: '#3B82F6' },
        { key: 'cerrado_ganado', label: 'Cerrar',      color: '#10B981' }
    ];

    // Estado del kanban (persistido)
    var LS_KEY_COLLAPSED = 'prospectosKanbanCollapsed_v1';
    var LS_KEY_FLOW      = 'prospectosKanbanFlow_v1';
    var LS_KEY_SHOWEMPTY = 'prospectosKanbanShowEmpty_v1';
    var LS_KEY_SORT      = 'prospectosKanbanSort_v1';
    var LS_KEY_FILTER    = 'prospectosKanbanFilters_v1';

    var _collapsed = {};
    try { _collapsed = JSON.parse(localStorage.getItem(LS_KEY_COLLAPSED) || '{}') || {}; } catch(e) {}
    var _flow      = localStorage.getItem(LS_KEY_FLOW)      || 'both';    // 'proyecto' | 'runrate' | 'both'
    var _showEmpty = localStorage.getItem(LS_KEY_SHOWEMPTY) !== '0';
    var _sort      = localStorage.getItem(LS_KEY_SORT)      || 'fecha_desc';
    var _filters   = {};
    try { _filters = JSON.parse(localStorage.getItem(LS_KEY_FILTER) || '{}') || {}; } catch(e) {}

    var _allProspectos = [];

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(text)));
        return div.innerHTML;
    }

    // Heat class (rojo) según días vencidos
    function heatClass(dias) {
        if (dias >= 30) return 'heat-max';
        if (dias >= 14) return 'heat-5';
        if (dias >= 7)  return 'heat-4';
        if (dias >= 3)  return 'heat-3';
        if (dias >= 1)  return 'heat-2';
        return 'heat-1';
    }
    // Warm class (naranja/ámbar) según minutos hasta próxima actividad
    function warmClass(mins) {
        if (mins <= 60)    return 'warm-5';
        if (mins <= 720)   return 'warm-4';
        if (mins <= 2880)  return 'warm-3';
        if (mins <= 10080) return 'warm-2';
        return 'warm-1';
    }

    function fmtMoney(n) {
        return '$' + (Number(n)||0).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' MXN';
    }

    function cardHtml(p) {
        var vencida = !!p.tiene_actividad_vencida;
        var mins    = (p.minutos_hasta_proxima === null || p.minutos_hasta_proxima === undefined) ? null : p.minutos_hasta_proxima;
        var clsExtra = '';
        if (vencida) {
            clsExtra = ' card-vencida ' + heatClass(p.dias_vencida || 0);
        } else if (mins !== null && mins <= 20160) { // <= 14 días
            clsExtra = ' ' + warmClass(mins);
        }

        var tipo = p.tipo_pipeline || 'runrate';
        var tipoLabel = tipo === 'proyecto' ? 'Proyecto' : 'Runrate';
        var tipoCls   = tipo === 'proyecto' ? 'pk-chip-proyecto' : 'pk-chip-runrate';

        var etapaColor = '#78350F'; // café default
        var etapaObj = ETAPAS.find(function(e){ return e.key === p.etapa; });
        if (etapaObj) etapaColor = etapaObj.color;

        var progColor = vencida ? '#EF4444' : '#92400E'; // café oscuro para progreso

        var actividadTxt = p.actividad_proxima || 'Sin actividad programada';
        var tieneAct = !!p.actividad_proxima;

        var critico = vencida && (p.dias_vencida || 0) >= 30;

        return '<div class="crm-data-row crm-postit crm-postit--prospecto' + clsExtra + '"' +
            ' data-prospecto-id="' + p.id + '"' +
            ' data-cliente="' + escapeHtml(p.cliente) + '"' +
            ' data-producto="' + escapeHtml(p.producto) + '"' +
            ' data-tipo="' + escapeHtml(tipo) + '"' +
            ' data-etapa="' + escapeHtml(p.etapa) + '"' +
            ' data-usuario="' + (p.usuario_id || '') + '"' +
            ' data-vencida="' + (vencida ? 1 : 0) + '"' +
            ' data-dias-vencida="' + (p.dias_vencida || 0) + '"' +
            ' data-dias-hasta-proxima="' + (p.dias_hasta_proxima !== undefined ? p.dias_hasta_proxima : -1) + '"' +
            ' data-fecha="' + (p.fecha_actualizacion || 0) + '"' +
            ' onclick="if(typeof abrirWidgetProspecto===\'function\')abrirWidgetProspecto(' + p.id + ')">' +

            '<div class="crm-postit-strip"></div>' +
            '<div class="absolute inset-0 pointer-events-none rounded-2xl" style="box-shadow:inset 0 1px 1px rgba(255,255,255,0.8);"></div>' +

            // Header
            '<div style="margin-bottom:12px;position:relative;z-index:1;padding-right:8px;">' +
                '<h3 class="pk-card-title" style="font-size:0.95rem;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' +
                    (critico ? '<span class="crm-alert-critical" title="' + (p.dias_vencida || 0) + ' días sin atender" style="margin-right:4px;vertical-align:middle;display:inline-flex;"><svg width="13" height="13" viewBox="0 0 24 24" fill="#DC2626" stroke="white" stroke-width="1"><path d="M12 2L1 21h22L12 2zm0 6v6m0 4v-2" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg></span>' : '') +
                    escapeHtml(p.nombre || '(sin título)') +
                '</h3>' +
                '<div style="font-size:0.8rem;font-weight:500;color:#6B7280;margin-top:2px;">' +
                    escapeHtml(p.cliente || 'Sin Cliente') +
                '</div>' +
            '</div>' +

            // Vendedor + Marca
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;position:relative;z-index:1;">' +
                '<div style="background:#FAF6F0;border-radius:12px;padding:10px 12px;border:1px solid #E8DDD0;">' +
                    '<div style="font-size:0.58rem;font-weight:700;color:#A78060;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Vendedor</div>' +
                    '<div style="font-size:0.82rem;font-weight:700;color:#3E2E1F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(p.usuario_nombre || '-') + '</div>' +
                '</div>' +
                '<div style="background:#FAF6F0;border-radius:12px;padding:10px 12px;border:1px solid #E8DDD0;">' +
                    '<div style="font-size:0.58rem;font-weight:700;color:#A78060;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Marca</div>' +
                    '<div style="font-size:0.85rem;font-weight:700;color:#3E2E1F;text-transform:uppercase;">' + escapeHtml(p.producto || '-') + '</div>' +
                '</div>' +
            '</div>' +

            // Etapa + Probabilidad + Tipo chip
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;position:relative;z-index:1;">' +
                '<div style="display:flex;align-items:center;gap:10px;">' +
                    '<div style="position:relative;width:40px;height:40px;flex-shrink:0;">' +
                        '<svg viewBox="0 0 36 36" style="width:40px;height:40px;transform:rotate(-90deg);">' +
                            '<circle cx="18" cy="18" r="15.5" fill="none" stroke="#EADDCB" stroke-width="2.5" pathLength="100"/>' +
                            '<circle cx="18" cy="18" r="15.5" fill="none" stroke="' + progColor + '" stroke-width="2.5" pathLength="100" stroke-dasharray="' + (p.probabilidad || 0) + ' 100" stroke-linecap="round"/>' +
                        '</svg>' +
                        '<span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:0.55rem;font-weight:800;color:#3E2E1F;">' + (p.probabilidad || 0) + '%</span>' +
                    '</div>' +
                    '<div>' +
                        '<div style="font-size:0.58rem;font-weight:700;color:#A78060;text-transform:uppercase;letter-spacing:0.04em;">Etapa</div>' +
                        '<div style="font-size:0.85rem;font-weight:700;color:#3E2E1F;">' + escapeHtml(p.etapa_label || '-') + '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="' + tipoCls + '" style="font-size:0.68rem;font-weight:700;padding:4px 10px;border-radius:8px;border:1px solid;">' + tipoLabel + '</div>' +
            '</div>' +

            // Actividad programada
            '<div style="margin-top:auto;position:relative;z-index:1;">' +
                '<div class="card-act-bar" style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:#fff;border:1px solid #E5E7EB;border-radius:12px;transition:all 0.2s;' +
                    (tieneAct ? 'border-color:#E8DDD0;background:#FAF6F0;' : '') + '">' +
                    '<div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;">' +
                        '<svg width="14" height="14" fill="none" stroke="' + (tieneAct ? '#92400E' : '#9CA3AF') + '" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' +
                        '<span class="card-act-text" style="font-size:0.78rem;font-weight:' + (tieneAct ? 700 : 500) + ';color:' + (tieneAct ? '#78350F' : '#9CA3AF') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(actividadTxt) + '</span>' +
                    '</div>' +
                    '<svg width="14" height="14" fill="none" stroke="' + (tieneAct ? '#C2956C' : '#D1D5DB') + '" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    // ── Filtros y orden (client-side) ──
    function applyFilters(list) {
        var out = list.slice();
        // Flow
        if (_flow === 'proyecto') out = out.filter(function(p){ return p.tipo_pipeline === 'proyecto'; });
        else if (_flow === 'runrate') out = out.filter(function(p){ return p.tipo_pipeline === 'runrate'; });
        // Filtros adicionales
        if (_filters.producto) out = out.filter(function(p){ return (p.producto||'').toUpperCase() === _filters.producto.toUpperCase(); });
        if (_filters.vendedor) out = out.filter(function(p){ return String(p.usuario_id) === String(_filters.vendedor); });
        if (_filters.vencida === 'only') out = out.filter(function(p){ return !!p.tiene_actividad_vencida; });
        return out;
    }

    function applySort(list) {
        var out = list.slice();
        switch (_sort) {
            case 'fecha_asc':
                out.sort(function(a,b){ return (a.fecha_actualizacion||0) - (b.fecha_actualizacion||0); }); break;
            case 'fecha_desc':
                out.sort(function(a,b){ return (b.fecha_actualizacion||0) - (a.fecha_actualizacion||0); }); break;
            case 'vencidas':
                out.sort(function(a,b){
                    var av = a.tiene_actividad_vencida ? 0 : 1;
                    var bv = b.tiene_actividad_vencida ? 0 : 1;
                    if (av !== bv) return av - bv;
                    return (b.dias_vencida||0) - (a.dias_vencida||0);
                }); break;
            case 'nombre':
                out.sort(function(a,b){ return (a.nombre||'').localeCompare(b.nombre||''); }); break;
        }
        return out;
    }

    function render() {
        var filtered = applyFilters(_allProspectos);
        var sorted   = applySort(filtered);

        // Agrupar por etapa
        var grupos = {};
        ETAPAS.forEach(function(e){ grupos[e.key] = []; });
        sorted.forEach(function(p){
            if (grupos.hasOwnProperty(p.etapa)) grupos[p.etapa].push(p);
        });

        // Determinar etapas a mostrar
        var etapas = ETAPAS.slice();
        if (!_showEmpty) {
            etapas = etapas.filter(function(e){ return grupos[e.key].length > 0; });
        }

        board.innerHTML = '';
        if (etapas.length === 0) {
            board.innerHTML = '<div class="crm-kanban-empty-global" style="padding:60px 20px;text-align:center;color:#9CA3AF;width:100%;">Sin prospectos en el periodo seleccionado.</div>';
            return;
        }

        etapas.forEach(function(stage) {
            var items = grupos[stage.key];
            var col = document.createElement('div');
            col.className = 'crm-kanban-col crm-kanban-col--prospecto' + (_collapsed[stage.key] ? ' collapsed' : '');
            col.dataset.stage = stage.key;

            var head = document.createElement('div');
            head.className = 'crm-kanban-head';

            if (_collapsed[stage.key]) {
                head.innerHTML = '<div class="crm-kanban-collapsed-body">' +
                    '<span class="crm-kanban-count" title="' + items.length + ' prospectos">' + items.length + '</span>' +
                    '<span class="crm-kanban-vertical-name">' + stage.label + '</span>' +
                    '</div>';
                col.appendChild(head);
                col.addEventListener('click', function(){
                    _collapsed[stage.key] = false;
                    persistCollapsed();
                    render();
                });
            } else {
                head.innerHTML =
                    '<div class="crm-kanban-head-top">' +
                        '<div class="crm-kanban-head-title">' +
                            '<span class="crm-kanban-dot' + (items.length ? ' active' : '') + '" style="' + (items.length ? 'background:' + stage.color + ';' : '') + '"></span>' +
                            '<span class="crm-kanban-stage-name">' + stage.label + '</span>' +
                            '<span class="crm-kanban-count">' + items.length + '</span>' +
                        '</div>' +
                        '<div class="crm-kanban-head-actions">' +
                            '<button type="button" class="crm-kanban-col-btn" data-act="collapse" title="Minimizar etapa"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/></svg></button>' +
                            '<button type="button" class="crm-kanban-col-btn" data-act="add" title="Nuevo prospecto"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>' +
                        '</div>' +
                    '</div>';
                col.appendChild(head);

                head.querySelector('[data-act="collapse"]').addEventListener('click', function(e){
                    e.stopPropagation();
                    _collapsed[stage.key] = true;
                    persistCollapsed();
                    render();
                });
                head.querySelector('[data-act="add"]').addEventListener('click', function(e){
                    e.stopPropagation();
                    var btn = document.getElementById('btnNuevoProspectoKanban');
                    if (btn) btn.click();
                });

                var body = document.createElement('div');
                body.className = 'crm-kanban-col-body';
                if (items.length === 0) {
                    body.innerHTML = '<div class="crm-kanban-empty"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Sin prospectos</span></div>';
                } else {
                    body.innerHTML = items.map(cardHtml).join('');
                }
                col.appendChild(body);
            }

            board.appendChild(col);
        });
    }

    function persistCollapsed() {
        try { localStorage.setItem(LS_KEY_COLLAPSED, JSON.stringify(_collapsed)); } catch(e) {}
    }

    function cargarProspectos() {
        var params = new URLSearchParams(window.location.search);
        var mes = params.get('mes') || '';
        var anio = params.get('anio') || '';
        var vendedores = params.get('vendedores') || '';
        var url = '/app/api/prospectos/?mes=' + encodeURIComponent(mes) +
                  '&anio=' + encodeURIComponent(anio) +
                  '&vendedores=' + encodeURIComponent(vendedores);

        fetch(url, { credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _allProspectos = data.rows || data.prospectos || [];
                render();
            })
            .catch(function(err) {
                console.error('[PROSPECTOS-KANBAN] Error:', err);
                _allProspectos = [];
                render();
            });
    }

    // ══════════ Toolbar: Filtro + Ordenar (minimalista, solo para kanban) ══════════
    function setupToolbar() {
        var btnFiltro  = document.getElementById('pkBtnFiltro');
        var btnOrdenar = document.getElementById('pkBtnOrdenar');
        var btnClear   = document.getElementById('pkBtnClear');
        var popFilter  = document.getElementById('pkPopFilter');
        var popSort    = document.getElementById('pkPopSort');

        function closePops() {
            if (popFilter) popFilter.style.display = 'none';
            if (popSort)   popSort.style.display   = 'none';
        }

        function updateClearVisibility() {
            var hasFilters = _flow !== 'both' || _filters.producto || _filters.vendedor || _filters.vencida === 'only';
            if (btnClear) btnClear.style.display = hasFilters ? 'inline-flex' : 'none';
        }

        if (btnFiltro) {
            btnFiltro.addEventListener('click', function(e){
                e.stopPropagation();
                if (!popFilter) return;
                var isOpen = popFilter.style.display === 'block';
                closePops();
                popFilter.style.display = isOpen ? 'none' : 'block';
                if (!isOpen) renderFilterPop();
            });
        }
        if (btnOrdenar) {
            btnOrdenar.addEventListener('click', function(e){
                e.stopPropagation();
                if (!popSort) return;
                var isOpen = popSort.style.display === 'block';
                closePops();
                popSort.style.display = isOpen ? 'none' : 'block';
                if (!isOpen) renderSortPop();
            });
        }
        if (btnClear) {
            btnClear.addEventListener('click', function(e){
                e.stopPropagation();
                _flow = 'both';
                _filters = {};
                localStorage.setItem(LS_KEY_FLOW, _flow);
                localStorage.setItem(LS_KEY_FILTER, '{}');
                updateClearVisibility();
                render();
            });
        }
        document.addEventListener('click', function(ev){
            if (popFilter && !popFilter.contains(ev.target) && ev.target !== btnFiltro && !btnFiltro.contains(ev.target)) popFilter.style.display = 'none';
            if (popSort   && !popSort.contains(ev.target)   && ev.target !== btnOrdenar && !btnOrdenar.contains(ev.target)) popSort.style.display   = 'none';
        });

        function renderFilterPop() {
            if (!popFilter) return;
            // Listar productos y vendedores únicos presentes en los datos
            var productos = {};
            var vendedores = {};
            _allProspectos.forEach(function(p){
                if (p.producto && p.producto !== '-') productos[p.producto] = true;
                if (p.usuario_id) vendedores[p.usuario_id] = p.usuario_nombre || ('Vendedor ' + p.usuario_id);
            });
            var prodKeys = Object.keys(productos).sort();
            var vendKeys = Object.keys(vendedores).sort(function(a,b){ return (vendedores[a]||'').localeCompare(vendedores[b]||''); });

            var html = '<div class="pk-pop-title">Filtrar por</div>';

            html += '<div class="pk-pop-section">Tipo</div>';
            ['both','proyecto','runrate'].forEach(function(f){
                var label = f === 'both' ? 'Todos' : (f === 'proyecto' ? 'Proyecto' : 'Runrate');
                html += '<button type="button" class="pk-pop-item' + (_flow === f ? ' active' : '') + '" data-flow="' + f + '">' + label + '</button>';
            });

            if (prodKeys.length) {
                html += '<div class="pk-pop-section">Marca</div>';
                html += '<button type="button" class="pk-pop-item' + (!_filters.producto ? ' active' : '') + '" data-producto="">Todas</button>';
                prodKeys.forEach(function(k){
                    html += '<button type="button" class="pk-pop-item' + (_filters.producto === k ? ' active' : '') + '" data-producto="' + escapeHtml(k) + '">' + escapeHtml(k) + '</button>';
                });
            }

            if (vendKeys.length > 1) {
                html += '<div class="pk-pop-section">Vendedor</div>';
                html += '<button type="button" class="pk-pop-item' + (!_filters.vendedor ? ' active' : '') + '" data-vendedor="">Todos</button>';
                vendKeys.forEach(function(vid){
                    html += '<button type="button" class="pk-pop-item' + (String(_filters.vendedor) === String(vid) ? ' active' : '') + '" data-vendedor="' + escapeHtml(vid) + '">' + escapeHtml(vendedores[vid]) + '</button>';
                });
            }

            html += '<div class="pk-pop-section">Estado</div>';
            html += '<button type="button" class="pk-pop-item' + (_filters.vencida === 'only' ? ' active' : '') + '" data-vencida="' + (_filters.vencida === 'only' ? '' : 'only') + '">Solo con actividad vencida</button>';

            popFilter.innerHTML = html;
            popFilter.querySelectorAll('[data-flow]').forEach(function(btn){
                btn.addEventListener('click', function(){
                    _flow = btn.dataset.flow;
                    localStorage.setItem(LS_KEY_FLOW, _flow);
                    render();
                    updateClearVisibility();
                    renderFilterPop();
                });
            });
            popFilter.querySelectorAll('[data-producto]').forEach(function(btn){
                btn.addEventListener('click', function(){
                    _filters.producto = btn.dataset.producto || null;
                    if (!_filters.producto) delete _filters.producto;
                    localStorage.setItem(LS_KEY_FILTER, JSON.stringify(_filters));
                    render();
                    updateClearVisibility();
                    renderFilterPop();
                });
            });
            popFilter.querySelectorAll('[data-vendedor]').forEach(function(btn){
                btn.addEventListener('click', function(){
                    _filters.vendedor = btn.dataset.vendedor || null;
                    if (!_filters.vendedor) delete _filters.vendedor;
                    localStorage.setItem(LS_KEY_FILTER, JSON.stringify(_filters));
                    render();
                    updateClearVisibility();
                    renderFilterPop();
                });
            });
            popFilter.querySelectorAll('[data-vencida]').forEach(function(btn){
                btn.addEventListener('click', function(){
                    var v = btn.dataset.vencida;
                    if (v) _filters.vencida = v; else delete _filters.vencida;
                    localStorage.setItem(LS_KEY_FILTER, JSON.stringify(_filters));
                    render();
                    updateClearVisibility();
                    renderFilterPop();
                });
            });
        }

        function renderSortPop() {
            if (!popSort) return;
            var opts = [
                { k: 'fecha_desc', label: 'Más reciente' },
                { k: 'fecha_asc',  label: 'Más antiguo' },
                { k: 'vencidas',   label: 'Vencidas primero' },
                { k: 'nombre',     label: 'Nombre A → Z' }
            ];
            var html = '<div class="pk-pop-title">Ordenar</div>';
            opts.forEach(function(o){
                html += '<button type="button" class="pk-pop-item' + (_sort === o.k ? ' active' : '') + '" data-sort="' + o.k + '">' + o.label + '</button>';
            });
            html += '<div class="pk-pop-section">Vista</div>';
            html += '<button type="button" class="pk-pop-item' + (_showEmpty ? ' active' : '') + '" data-showempty="1">Mostrar etapas vacías</button>';

            popSort.innerHTML = html;
            popSort.querySelectorAll('[data-sort]').forEach(function(btn){
                btn.addEventListener('click', function(){
                    _sort = btn.dataset.sort;
                    localStorage.setItem(LS_KEY_SORT, _sort);
                    render();
                    renderSortPop();
                });
            });
            var se = popSort.querySelector('[data-showempty]');
            if (se) se.addEventListener('click', function(){
                _showEmpty = !_showEmpty;
                localStorage.setItem(LS_KEY_SHOWEMPTY, _showEmpty ? '1' : '0');
                render();
                renderSortPop();
            });
        }

        updateClearVisibility();
    }

    setupToolbar();

    // Exponer para recarga externa
    window.recargarProspectosKanban = cargarProspectos;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', cargarProspectos);
    } else {
        cargarProspectos();
    }
})();
