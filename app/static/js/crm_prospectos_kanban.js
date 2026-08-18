// crm_prospectos_kanban.js — Kanban de Prospectos (tab=prospectos)
// Las cards se renderizan server-side (ver _content_prospectos_kanban.html).
// Este JS solo maneja Filtro/Ordenar actuando sobre el DOM existente.
(function() {
    'use strict';

    // ── Abrir "Nuevo prospecto" desde el "+" de una columna (etapa) ──
    // Se delega a nivel `document` y UNA sola vez: el <script> tiene
    // data-turbo-eval="false" (corre una vez en la carga inicial) y el listener
    // de document sobrevive a la navegación Turbo. Antes esto vivía atado a
    // #pkKanbanBoard dentro del init de abajo, que retorna temprano cuando el
    // board no existe al cargar (p.ej. la carga inicial fue en otra pestaña) →
    // el "+" no abría el formulario tras navegar a Prospección.
    if (!window._pkAddDelegated) {
        window._pkAddDelegated = true;
        document.addEventListener('click', function(ev) {
            var btnAdd = ev.target.closest && ev.target.closest('[data-act="pk-add"]');
            if (!btnAdd || !btnAdd.closest('#pkKanbanBoard')) return;
            ev.preventDefault();
            ev.stopPropagation();
            // Etapa de la columna → el form la usa como etapa inicial (payload.etapa).
            window._pkStageForNew = btnAdd.getAttribute('data-stage') || null;
            if (typeof window._setNuevoProspectoMode === 'function') {
                window._setNuevoProspectoMode('prospecto');
            }
            var w = document.getElementById('widgetNuevoProspecto');
            if (w) w.classList.add('active');
        });
    }

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
        if (_filters.solo_ganados === '1' && (card.dataset.etapa || '') !== 'cerrado_ganado') return false;
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
        var hasFilters = _flow !== 'both' || _filters.producto || _filters.vendedor || _filters.vencida === 'only' || _filters.solo_ganados === '1';
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
            html += '<button type="button" class="pk-pop-item' + (_filters.solo_ganados === '1' ? ' active' : '') + '" data-solo-ganados="' + (_filters.solo_ganados === '1' ? '' : '1') + '">Solo Ganados</button>';

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
            popFilter.querySelectorAll('[data-solo-ganados]').forEach(function(btn){
                btn.addEventListener('click', function(){
                    var v = btn.dataset.soloGanados;
                    if (v === '1') _filters.solo_ganados = '1'; else delete _filters.solo_ganados;
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
        // El "+" (pk-add) se maneja con delegación a nivel document arriba, para
        // que funcione aunque este init haya retornado temprano (board ausente
        // al cargar). No se maneja aquí para no duplicar la apertura del form.

        // Click en columna colapsada → expandir
        var colClick = ev.target.closest('.crm-kanban-col.collapsed');
        if (colClick) {
            var st = colClick.dataset.stage;
            _collapsed[st] = false;
            persistCollapsed();
            applyCollapsed();
        }
    });

    // Cuando el usuario usa el botón "+Nuevo" global del toolbar (no desde
    // una columna específica) resetear la etapa pre-asignada
    var globalAddBtn = document.getElementById('btnNuevoProspectoKanban');
    if (globalAddBtn) {
        globalAddBtn.addEventListener('click', function() {
            window._pkStageForNew = null;
        });
    }

    // Re-hidratar tras un swap in-place del board (cambio de periodo sin
    // recarga — crm_nav_v2.js): re-aplica filtros/orden/colapsadas
    // guardados sobre las cards nuevas. El nodo #pkKanbanBoard es el
    // mismo (solo se trasplanta su innerHTML), así que las referencias
    // de este módulo siguen vivas.
    window.pkKanbanRehydrate = function () {
        applyFilters();
        applyCollapsed();
        updateClearVisibility();
    };

    // Recarga externa (ej. después de crear un prospecto): in-place si el
    // SPA está disponible (trae el board fresco del server y lo trasplanta
    // sin recargar la página); fallback al reload clásico.
    window.recargarProspectosKanban = function() {
        // Refresh DIRECTO del board (fetch de la página actual + trasplante
        // de #pkKanbanBoard + rehidratar filtros/binds). Antes se delegaba a
        // crmApplyPeriod, que tiene precondiciones (busy, _crmSetPeriodo,
        // config del tab) y podía devolver true SIN refrescar — la tarjeta
        // recién creada no aparecía hasta recargar la página a mano.
        var board = document.getElementById('pkKanbanBoard');
        if (!board) return;  // no estamos en la vista de prospección
        var url = window.location.pathname + window.location.search;
        fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'pk-refresh' } })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            })
            .then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');
                var nue = doc.getElementById('pkKanbanBoard');
                if (!nue) throw new Error('fragmento sin board');
                board.innerHTML = nue.innerHTML;
                if (typeof window.pkKanbanRehydrate === 'function') {
                    try { window.pkKanbanRehydrate(); } catch (e) { }
                }
            })
            .catch(function () { window.location.reload(); });
    };

    // ── Live update: mover card sin reload ────────────────────────────
    // Usado tras cambiar etapa desde el widget (crm_prospeccion.js).
    // Mueve el card DOM a la columna nueva, actualiza data-etapa,
    // refresca el label y los contadores de ambas columnas.
    var ETAPA_LABEL_KANBAN = {
        'identificado':    'Identificado',
        'calificado':      'Calificado',
        'reunion':         'Reunión',
        'en_progreso':     'En Progreso',
        'procesado':       'Procesado',
        'cerrado_ganado':  'Cerrado Ganado',
        'cerrado_perdido': 'Cerrado Perdido',
    };

    function _pkUpdateColCounters(col) {
        if (!col) return;
        var n = col.querySelectorAll('.crm-kanban-col-body .crm-postit').length;
        col.querySelectorAll('.crm-kanban-count').forEach(function (el) { el.textContent = n; });
        var totalEl = col.querySelector('[data-col-total]');
        if (totalEl) totalEl.textContent = n + ' prospecto' + (n === 1 ? '' : 's');
        var collapsed = col.querySelector('[data-col-count-collapsed]');
        if (collapsed) collapsed.textContent = n;
        var dot = col.querySelector('.crm-kanban-dot');
        if (dot) dot.classList.toggle('active', n > 0);
    }

    window.pkMoveCardToStage = function (prospectoId, newEtapa) {
        var card = document.querySelector('.crm-kanban-card[data-prospecto-id="' + prospectoId + '"]');
        if (!card) return false;
        var oldCol = card.closest('.crm-kanban-col');
        var newCol = document.querySelector('.crm-kanban-col[data-stage="' + newEtapa + '"]');

        // cerrado_perdido no tiene columna — el card se elimina del kanban.
        if (!newCol) {
            card.remove();
            _pkUpdateColCounters(oldCol);
            return true;
        }
        var newColBody = newCol.querySelector('.crm-kanban-col-body');
        if (!newColBody) return false;
        // Inserta al inicio para que quede visible.
        newColBody.insertBefore(card, newColBody.firstChild);
        card.dataset.etapa = newEtapa;
        var lblEl = card.querySelector('[data-etapa-label]');
        if (lblEl) {
            var lbl = ETAPA_LABEL_KANBAN[newEtapa] || newEtapa;
            lblEl.textContent = lbl;
        }
        _pkUpdateColCounters(oldCol);
        _pkUpdateColCounters(newCol);
        return true;
    };

    // ── Arrastrar la tarjeta para cambiar de etapa ──
    // Es el unico camino: la tarjeta se agarra y se suelta en otra columna. Un
    // clic sigue abriendo el prospecto, asi que hay que distinguir el gesto —
    // por eso se marca la tarjeta con .pk-dragging y se anula el clic que el
    // navegador dispara al terminar un arrastre corto.
    var arrastrando = null;

    function marcarZonas(activo) {
        Array.prototype.forEach.call(
            document.querySelectorAll('.crm-kanban-col--prospecto'),
            function (col) { col.classList.toggle('pk-drop-listo', activo); });
    }

    function wireArrastre() {
        var board = document.getElementById('pkKanbanBoard');
        if (!board || board._pkDnDWired) return;
        board._pkDnDWired = true;

        board.addEventListener('dragstart', function (ev) {
            var card = ev.target.closest && ev.target.closest('.crm-kanban-card');
            if (!card) return;
            arrastrando = card;
            card.classList.add('pk-dragging');
            marcarZonas(true);
            try {
                // Sin datos en el dataTransfer, Firefox cancela el arrastre.
                ev.dataTransfer.setData('text/plain', card.dataset.prospectoId || '');
                ev.dataTransfer.effectAllowed = 'move';
            } catch (e) { }
        });

        board.addEventListener('dragend', function () {
            if (arrastrando) arrastrando.classList.remove('pk-dragging');
            marcarZonas(false);
            Array.prototype.forEach.call(
                document.querySelectorAll('.pk-drop-encima'),
                function (c) { c.classList.remove('pk-drop-encima'); });
            // El clic sintetico llega despues del dragend: se ignora una vez
            // para que soltar la tarjeta no abra el prospecto.
            var recien = arrastrando;
            arrastrando = null;
            if (recien) {
                recien._pkIgnorarClic = true;
                setTimeout(function () { recien._pkIgnorarClic = false; }, 250);
            }
        });

        board.addEventListener('dragover', function (ev) {
            var col = ev.target.closest && ev.target.closest('.crm-kanban-col--prospecto');
            if (!col || !arrastrando) return;
            ev.preventDefault();   // sin esto el navegador no permite soltar
            ev.dataTransfer.dropEffect = 'move';
            if (col.dataset.stage !== arrastrando.dataset.etapa) {
                col.classList.add('pk-drop-encima');
            }
        });

        board.addEventListener('dragleave', function (ev) {
            var col = ev.target.closest && ev.target.closest('.crm-kanban-col--prospecto');
            if (col && !col.contains(ev.relatedTarget)) col.classList.remove('pk-drop-encima');
        });

        board.addEventListener('drop', function (ev) {
            var col = ev.target.closest && ev.target.closest('.crm-kanban-col--prospecto');
            if (!col || !arrastrando) return;
            ev.preventDefault();
            col.classList.remove('pk-drop-encima');
            var card = arrastrando;
            var nueva = col.dataset.stage;
            var previa = card.dataset.etapa;
            if (!nueva || nueva === previa) return;

            // Dos etapas piden algo antes de poder guardarse; se pregunta ANTES
            // de mover la tarjeta, para que cancelar no la deje dando saltos.
            if (nueva === 'reunion') {
                // El servidor rechaza 'reunion' sin tipo: devolvia 400 y la
                // tarjeta regresaba sin que se supiera por que.
                pedirTipoReunion(function (tipo) {
                    if (tipo) aplicarEtapa(card, previa, nueva, { reunion_tipo: tipo });
                });
                return;
            }
            if (nueva === 'cerrado_ganado') {
                // Cerrar como ganado CREA una oportunidad: no es un movimiento
                // cualquiera y conviene confirmarlo.
                pkConfirmar('Cerrar como ganado', 'Se creara la oportunidad de este prospecto.',
                    function (ok) { if (ok) aplicarEtapa(card, previa, nueva, {}); });
                return;
            }
            aplicarEtapa(card, previa, nueva, {});
        });

        // Un arrastre termina en un clic sintetico sobre la tarjeta: se atrapa
        // en captura para que no llegue al onclick que abre el prospecto.
        board.addEventListener('click', function (ev) {
            var card = ev.target.closest && ev.target.closest('.crm-kanban-card');
            if (card && card._pkIgnorarClic) {
                ev.stopPropagation();
                ev.preventDefault();
            }
        }, true);
    }

    // Mueve la tarjeta y guarda. Se mueve antes de la respuesta para que el
    // gesto se sienta; si el servidor la rechaza, regresa a su columna.
    function aplicarEtapa(card, previa, nueva, extra) {
        var id = card.dataset.prospectoId;
        var body = { etapa: nueva };
        for (var k in extra) body[k] = extra[k];
        if (typeof window.pkMoveCardToStage === 'function') window.pkMoveCardToStage(id, nueva);

        fetch('/app/api/prospecto/' + id + '/etapa/', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': pkCsrf() },
            body: JSON.stringify(body),
        }).then(function (r) { return r.json(); }).then(function (data) {
            if (data && data.success) {
                if (nueva === 'cerrado_ganado' && data.oportunidad_id) {
                    pkAviso('Prospecto ganado. Oportunidad #' + data.oportunidad_id + ' creada.');
                }
                return;
            }
            if (typeof window.pkMoveCardToStage === 'function') window.pkMoveCardToStage(id, previa);
            pkAviso((data && data.error) || 'No se pudo cambiar la etapa');
        }).catch(function () {
            if (typeof window.pkMoveCardToStage === 'function') window.pkMoveCardToStage(id, previa);
            pkAviso('No se pudo cambiar la etapa');
        });
    }

    // Cuadro chico reutilizable: titulo, texto y los botones que se le pasen.
    function pkDialogo(titulo, texto, botones, alCerrar) {
        var ov = document.createElement('div');
        ov.className = 'pk-dlg-ov';
        var html = '<div class="pk-dlg"><h3>' + escapeHtml(titulo) + '</h3>';
        if (texto) html += '<p>' + escapeHtml(texto) + '</p>';
        html += '<div class="pk-dlg-btns">';
        botones.forEach(function (b, i) {
            html += '<button type="button" data-i="' + i + '" class="pk-dlg-b' +
                (b.tono ? ' pk-dlg-b--' + b.tono : '') + '">' + escapeHtml(b.texto) + '</button>';
        });
        html += '</div><button type="button" class="pk-dlg-x" data-cancel>Cancelar</button></div>';
        ov.innerHTML = html;
        document.body.appendChild(ov);

        var cerrar = function (valor) {
            ov.remove();
            document.removeEventListener('keydown', esc);
            alCerrar(valor);
        };
        var esc = function (e) { if (e.key === 'Escape') cerrar(null); };
        document.addEventListener('keydown', esc);
        ov.addEventListener('click', function (e) {
            if (e.target === ov || e.target.closest('[data-cancel]')) { cerrar(null); return; }
            var b = e.target.closest('[data-i]');
            if (b) cerrar(botones[parseInt(b.getAttribute('data-i'), 10)].valor);
        });
    }

    function pedirTipoReunion(cb) {
        pkDialogo('Tipo de reunión', 'La etapa Reunión necesita saber de qué tipo es.',
            [{ texto: 'Virtual', valor: 'virtual' }, { texto: 'Presencial', valor: 'presencial' }], cb);
    }

    function pkConfirmar(titulo, texto, cb) {
        pkDialogo(titulo, texto, [{ texto: 'Sí, continuar', valor: true, tono: 'ok' }],
            function (v) { cb(!!v); });
    }

    function pkCsrf() {
        var m = document.cookie.match(/csrftoken=([^;]+)/);
        return m ? m[1] : '';
    }

    function pkAviso(msg) {
        var toast = document.getElementById('widgetToast');
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(function () { toast.classList.remove('show'); }, 3000);
    }

    // Las tarjetas nacen en la plantilla y tambien al recargar el kanban, asi
    // que el atributo se pone aqui en lugar de repetirlo en el HTML.
    function marcarArrastrables() {
        Array.prototype.forEach.call(
            document.querySelectorAll('.crm-kanban-card[data-prospecto-id]'),
            function (c) {
                c.setAttribute('draggable', 'true');
                c.style.cursor = 'grab';
            });
    }

    var _pkRehidratar = window.pkKanbanRehydrate;
    window.pkKanbanRehydrate = function () {
        if (typeof _pkRehidratar === 'function') _pkRehidratar();
        wireArrastre();
        marcarArrastrables();
    };

    wireArrastre();
    marcarArrastrables();

    setupToolbar();
    applyFilters();   // aplicar filtros guardados al cargar
    applyCollapsed(); // restaurar columnas colapsadas
    updateClearVisibility();
})();
