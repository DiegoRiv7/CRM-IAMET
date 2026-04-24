// crm_prospectos_kanban.js — Kanban de Prospectos (tab=prospectos)
// Las cards se renderizan server-side (ver _content_prospectos_kanban.html).
// Este JS solo maneja Filtro/Ordenar actuando sobre el DOM existente.
(function() {
    'use strict';

    var board = document.getElementById('pkKanbanBoard');
    if (!board) return;

    var LS_KEY_FLOW      = 'prospectosKanbanFlow_v1';
    var LS_KEY_SORT      = 'prospectosKanbanSort_v1';
    var LS_KEY_FILTER    = 'prospectosKanbanFilters_v1';
    var LS_KEY_COLLAPSED = 'prospectosKanbanCollapsed_v1';

    var _flow    = localStorage.getItem(LS_KEY_FLOW)   || 'both';
    var _sort    = localStorage.getItem(LS_KEY_SORT)   || 'default';
    var _filters = {};
    var _collapsed = {};
    try { _filters = JSON.parse(localStorage.getItem(LS_KEY_FILTER) || '{}') || {}; } catch(e) {}
    try { _collapsed = JSON.parse(localStorage.getItem(LS_KEY_COLLAPSED) || '{}') || {}; } catch(e) {}

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(text)));
        return div.innerHTML;
    }

    function allCards() {
        return Array.prototype.slice.call(board.querySelectorAll('.crm-postit--prospecto'));
    }

    function cardMatches(card) {
        var tipo = (card.dataset.tipo || '').toLowerCase();
        if (_flow === 'proyecto' && tipo !== 'proyecto') return false;
        if (_flow === 'runrate'  && tipo !== 'runrate')  return false;
        if (_filters.producto && (card.dataset.producto || '').toUpperCase() !== _filters.producto.toUpperCase()) return false;
        if (_filters.vendedor && String(card.dataset.usuarioId) !== String(_filters.vendedor)) return false;
        if (_filters.vencida === 'only' && card.dataset.vencida !== '1') return false;
        return true;
    }

    function applyFilters() {
        allCards().forEach(function(c){
            c.style.display = cardMatches(c) ? '' : 'none';
        });
        updateColumnCounts();
        applySort();
    }

    function updateColumnCounts() {
        var cols = board.querySelectorAll('.crm-kanban-col');
        cols.forEach(function(col){
            var visible = col.querySelectorAll('.crm-postit--prospecto:not([style*="display: none"])').length;
            var countEl = col.querySelector('.crm-kanban-head-expanded .crm-kanban-count');
            var countCollapsedEl = col.querySelector('[data-col-count-collapsed]');
            var dotEl   = col.querySelector('.crm-kanban-dot');
            var totalEl = col.querySelector('[data-col-total]');
            if (countEl) countEl.textContent = visible;
            if (countCollapsedEl) countCollapsedEl.textContent = visible;
            if (dotEl) dotEl.classList.toggle('active', visible > 0);
            if (totalEl) totalEl.textContent = visible + ' prospecto' + (visible === 1 ? '' : 's');
            // Toggle empty-state si no hay cards visibles
            var body = col.querySelector('.crm-kanban-col-body');
            if (!body) return;
            var emptyState = body.querySelector('.crm-kanban-empty');
            if (visible === 0) {
                if (!emptyState) {
                    var div = document.createElement('div');
                    div.className = 'crm-kanban-empty';
                    div.dataset.act = 'pk-add';
                    div.dataset.stage = col.dataset.stage || '';
                    div.style.cursor = 'pointer';
                    div.innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Sin prospectos</span>';
                    body.appendChild(div);
                }
            } else if (emptyState) {
                emptyState.remove();
            }
        });
    }

    function applyCollapsed() {
        var cols = board.querySelectorAll('.crm-kanban-col');
        cols.forEach(function(col){
            var stage = col.dataset.stage;
            col.classList.toggle('collapsed', !!_collapsed[stage]);
        });
    }

    function persistCollapsed() {
        try { localStorage.setItem(LS_KEY_COLLAPSED, JSON.stringify(_collapsed)); } catch(e) {}
    }

    function applySort() {
        if (_sort === 'default') return; // server-side order (vencidas primero)
        var cols = board.querySelectorAll('.crm-kanban-col-body');
        cols.forEach(function(body){
            var cards = Array.prototype.slice.call(body.querySelectorAll('.crm-postit--prospecto'));
            cards.sort(function(a,b){
                switch(_sort) {
                    case 'fecha_desc':
                        return parseInt(b.dataset.fecha||'0',10) - parseInt(a.dataset.fecha||'0',10);
                    case 'fecha_asc':
                        return parseInt(a.dataset.fecha||'0',10) - parseInt(b.dataset.fecha||'0',10);
                    case 'nombre':
                        var ta = (a.querySelector('.opp-name-link')||{}).textContent || '';
                        var tb = (b.querySelector('.opp-name-link')||{}).textContent || '';
                        return ta.localeCompare(tb);
                    case 'vencidas':
                        var av = a.dataset.vencida === '1' ? 0 : 1;
                        var bv = b.dataset.vencida === '1' ? 0 : 1;
                        if (av !== bv) return av - bv;
                        return parseInt(b.dataset.diasVencida||'0',10) - parseInt(a.dataset.diasVencida||'0',10);
                }
                return 0;
            });
            cards.forEach(function(c){ body.appendChild(c); });
        });
    }

    function updateClearVisibility() {
        var btnClear = document.getElementById('pkBtnClear');
        if (!btnClear) return;
        var hasFilters = _flow !== 'both' || _filters.producto || _filters.vendedor || _filters.vencida === 'only';
        btnClear.style.display = hasFilters ? 'inline-flex' : 'none';
    }

    // ══════════ Setup de popovers Filtro + Ordenar ══════════
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
            btnClear.addEventListener('click', function(){
                _flow = 'both';
                _filters = {};
                localStorage.setItem(LS_KEY_FLOW, _flow);
                localStorage.setItem(LS_KEY_FILTER, '{}');
                applyFilters();
                updateClearVisibility();
            });
        }
        document.addEventListener('click', function(ev){
            if (popFilter && btnFiltro && !popFilter.contains(ev.target) && !btnFiltro.contains(ev.target)) popFilter.style.display = 'none';
            if (popSort && btnOrdenar && !popSort.contains(ev.target) && !btnOrdenar.contains(ev.target)) popSort.style.display = 'none';
        });

        function renderFilterPop() {
            if (!popFilter) return;
            var cards = allCards();
            var productos = {};
            var vendedores = {};
            cards.forEach(function(c){
                var prod = c.dataset.producto;
                if (prod && prod !== '-') productos[prod] = true;
                var vid = c.dataset.usuarioId;
                if (vid) vendedores[vid] = c.dataset.usuario || ('Vendedor ' + vid);
            });
            var prodKeys = Object.keys(productos).sort();
            var vendKeys = Object.keys(vendedores).sort(function(a,b){ return (vendedores[a]||'').localeCompare(vendedores[b]||''); });

            var html = '<div class="pk-pop-title">Filtrar por</div>';
            html += '<div class="pk-pop-section">Tipo</div>';
            [{ v:'both', l:'Todos' }, { v:'proyecto', l:'Proyecto' }, { v:'runrate', l:'Runrate' }].forEach(function(o){
                html += '<button type="button" class="pk-pop-item' + (_flow === o.v ? ' active' : '') + '" data-flow="' + o.v + '">' + o.l + '</button>';
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
                    applyFilters();
                    updateClearVisibility();
                    renderFilterPop();
                });
            });
            popFilter.querySelectorAll('[data-producto]').forEach(function(btn){
                btn.addEventListener('click', function(){
                    _filters.producto = btn.dataset.producto || null;
                    if (!_filters.producto) delete _filters.producto;
                    localStorage.setItem(LS_KEY_FILTER, JSON.stringify(_filters));
                    applyFilters();
                    updateClearVisibility();
                    renderFilterPop();
                });
            });
            popFilter.querySelectorAll('[data-vendedor]').forEach(function(btn){
                btn.addEventListener('click', function(){
                    _filters.vendedor = btn.dataset.vendedor || null;
                    if (!_filters.vendedor) delete _filters.vendedor;
                    localStorage.setItem(LS_KEY_FILTER, JSON.stringify(_filters));
                    applyFilters();
                    updateClearVisibility();
                    renderFilterPop();
                });
            });
            popFilter.querySelectorAll('[data-vencida]').forEach(function(btn){
                btn.addEventListener('click', function(){
                    var v = btn.dataset.vencida;
                    if (v) _filters.vencida = v; else delete _filters.vencida;
                    localStorage.setItem(LS_KEY_FILTER, JSON.stringify(_filters));
                    applyFilters();
                    updateClearVisibility();
                    renderFilterPop();
                });
            });
        }

        function renderSortPop() {
            if (!popSort) return;
            var opts = [
                { k: 'default',    label: 'Por defecto (vencidas primero)' },
                { k: 'fecha_desc', label: 'Más reciente' },
                { k: 'fecha_asc',  label: 'Más antiguo' },
                { k: 'vencidas',   label: 'Vencidas primero' },
                { k: 'nombre',     label: 'Nombre A → Z' }
            ];
            var html = '<div class="pk-pop-title">Ordenar</div>';
            opts.forEach(function(o){
                html += '<button type="button" class="pk-pop-item' + (_sort === o.k ? ' active' : '') + '" data-sort="' + o.k + '">' + o.label + '</button>';
            });
            popSort.innerHTML = html;
            popSort.querySelectorAll('[data-sort]').forEach(function(btn){
                btn.addEventListener('click', function(){
                    _sort = btn.dataset.sort;
                    localStorage.setItem(LS_KEY_SORT, _sort);
                    applyFilters();
                    renderSortPop();
                });
            });
        }
    }

    // Botones del header de cada columna: collapse + add. Además, click en
    // columna colapsada la re-expande.
    board.addEventListener('click', function(ev) {
        var btnCollapse = ev.target.closest('[data-act="pk-collapse"]');
        if (btnCollapse) {
            ev.stopPropagation();
            var col = btnCollapse.closest('.crm-kanban-col');
            if (!col) return;
            var stage = col.dataset.stage;
            _collapsed[stage] = true;
            persistCollapsed();
            applyCollapsed();
            return;
        }
        var btnAdd = ev.target.closest('[data-act="pk-add"]');
        if (btnAdd) {
            ev.stopPropagation();
            var openBtn = document.getElementById('btnNuevoProspectoKanban');
            if (openBtn) openBtn.click();
            return;
        }
        // Click en columna colapsada → expandir
        var colClick = ev.target.closest('.crm-kanban-col.collapsed');
        if (colClick) {
            var st = colClick.dataset.stage;
            _collapsed[st] = false;
            persistCollapsed();
            applyCollapsed();
        }
    });

    // Recarga externa (ej. después de crear un prospecto): reload server-side
    window.recargarProspectosKanban = function() {
        // Forzar reload completo para refrescar el markup server-side
        window.location.reload();
    };

    setupToolbar();
    applyFilters();   // aplicar filtros guardados al cargar
    applyCollapsed(); // restaurar columnas colapsadas
    updateClearVisibility();
})();
