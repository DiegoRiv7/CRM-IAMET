/* ═══════════════════════════════════════════════════════════════════════
 * crm_main.js — ARCHIVO LEGACY (congelado desde 2026-06-04)
 *
 * Este archivo tiene ~11,500 líneas y mezcla múltiples responsabilidades
 * (kanban opp, dashboard clientes, tareas, admin, etc.). Está marcado
 * como LEGACY por la política Boy Scout Rule.
 *
 * NO agregar más código aquí. Para nuevas features, ir al *_v2.js que
 * corresponda según dominio:
 *   - Kanban / filtros / pin  → app/static/js/crm_kanban_v2.js
 *   - Tareas / comentarios    → app/static/js/crm_tareas_v2.js
 *   - Dashboard clientes (ck*) → app/static/js/crm_clientes_v2.js
 *   - Features sueltos        → app/static/js/crm_features_misc.js
 *
 * Modificar SOLO para:
 *   - Bug crítico en producción que afecta usuarios
 *   - Cambio mínimo (1-3 líneas) que NO amerita módulo nuevo
 *
 * Ver: app/static/js/README.md y ESTRUCTURA.md
 * ═══════════════════════════════════════════════════════════════════════ */

/* ── Utilidad CSRF global (disponible para todos los scripts) ── */
    if (typeof window.getCsrf === 'undefined') {
        window.getCsrf = function () {
            var v = document.cookie.match('(^|;)\\s*csrftoken\\s*=\\s*([^;]+)');
            return v ? v.pop() : '';
        };
    }

    /* ── Auto-cambio de mes en día 1 ── */
    /* Solo aplica cuando no hay ?mes= en la URL (carga inicial sin filtro manual) */
    (function () {
        var today = new Date();
        if (today.getDate() === 1) {
            var params = new URLSearchParams(window.location.search);
            if (!params.has('mes')) {
                var currentMes = String(today.getMonth() + 1).padStart(2, '0');
                params.set('mes', currentMes);
                window.location.replace(window.location.pathname + '?' + params.toString());
            }
        }
    })();

    /* ── Filtros mes/año/vendedor (script independiente) ──
       Usa window.crmReady (definido en crm_ready.js) para que en el
       futuro con Turbo Drive activo, este wireup también se re-dispare
       en cada turbo:load. Sin Turbo se comporta igual que un
       DOMContentLoaded normal. */
    window.crmReady(function () {
        var mesFilter = document.getElementById('mesFilter');
        var anioFilter = document.getElementById('anioFilter');

        function applyFilter() {
            var params = new URLSearchParams(window.location.search);
            if (mesFilter) params.set('mes', mesFilter.value);
            if (anioFilter) params.set('anio', anioFilter.value);
            // Preservar tab actual — detectar desde URL o desde tab activo visible
            if (!params.get('tab')) {
                var activeTab = document.querySelector('.crm-tab.active');
                if (activeTab && activeTab.href) {
                    var tabMatch = activeTab.href.match(/tab=([^&]+)/);
                    params.set('tab', tabMatch ? tabMatch[1] : 'crm');
                } else {
                    params.set('tab', 'crm');
                }
            }
            // Preserve vendor filter
            var vfChecks = document.querySelectorAll('.vf-user:checked');
            var vfAllCheck = document.getElementById('vfAll');
            if (vfChecks.length > 0 && vfAllCheck && !vfAllCheck.checked) {
                var ids = [];
                vfChecks.forEach(function (c) { ids.push(c.value); });
                params.set('vendedores', ids.join(','));
            } else {
                params.delete('vendedores');
            }
            window.location.href = window.location.pathname + '?' + params.toString();
        }

        if (mesFilter) mesFilter.addEventListener('change', applyFilter);
        if (anioFilter) anioFilter.addEventListener('change', applyFilter);

        // Vendor filter dropdown
        var vfBtn = document.getElementById('vendorFilterBtn');
        var vfDrop = document.getElementById('vendorFilterDropdown');
        var vfAll = document.getElementById('vfAll');

        if (vfBtn && vfDrop) {
            vfBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                vfDrop.classList.toggle('show');
            });
            // Guard: el listener al document NO debe duplicarse en cada
            // turbo:load. Una sola instalación por sesión basta.
            if (!window._crmVfDropdownWired) {
                window._crmVfDropdownWired = true;
                document.addEventListener('click', function (e) {
                    var drop = document.getElementById('vendorFilterDropdown');
                    var btn = document.getElementById('vendorFilterBtn');
                    if (!drop) return;
                    if (!drop.contains(e.target) && e.target !== btn) {
                        drop.classList.remove('show');
                    }
                });
            }
        }

        function updateVendorFilterLabel() {
            if (!vfBtn || !vfAll) return;
            if (vfAll.checked) { vfBtn.textContent = 'Todos \u25BE'; return; }
            var checked = document.querySelectorAll('.vf-user:checked');
            if (checked.length === 0) { vfAll.checked = true; vfBtn.textContent = 'Todos \u25BE'; }
            else if (checked.length === 1) { vfBtn.textContent = checked[0].parentElement.querySelector('span').textContent.trim() + ' \u25BE'; }
            else { vfBtn.textContent = checked.length + ' vendedores \u25BE'; }
        }

        if (vfAll) {
            vfAll.addEventListener('change', function () {
                document.querySelectorAll('.vf-user').forEach(function (c) { c.checked = false; });
                updateVendorFilterLabel();
                applyFilter();
            });
        }
        document.querySelectorAll('.vf-user').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var anyChecked = document.querySelectorAll('.vf-user:checked').length > 0;
                if (vfAll) vfAll.checked = !anyChecked;
                updateVendorFilterLabel();
                applyFilter();
            });
        });

        // Toggle pin oportunidad — delegación en document (capture phase)
        // Funciona en cards, list rows, y cards clonadas dentro del kanban.
        // Guard: el listener al document SE INSTALARÍA OTRA VEZ en cada
        // turbo:load. Como document persiste entre navegaciones, basta
        // con una sola instalación por sesión.
        if (window._crmPinHandlerWired) {
            // Skip — ya registrado en sesión actual
        } else {
            window._crmPinHandlerWired = true;
        document.addEventListener('click', function(e) {
            var pin = e.target.closest && e.target.closest('.crm-pin');
            if (!pin) return;
            // Solo pins de oportunidades (tienen data-pin-id); las de tareas usan otro handler
            var pidAttr = pin.getAttribute('data-pin-id');
            if (!pidAttr) return;
            // Excluir el pin-button de la vista LIST-tarea (class .crm-list-pin es de oportunidades,
            // pero el pin de tareas usa class .tarea-action-btn y llama a crmTareaTogglePin)
            if (pin.classList.contains('tarea-action-btn')) return;

            e.stopPropagation();
            e.preventDefault();
            (function(clickedPin){
                var oppId = (pidAttr || '').replace(/\s/g, '').replace(/\u00A0/g, '');
                // Normalizar: strip espacios + nbsp + commas (USE_THOUSAND_SEPARATOR
                // de Django puede renderizar "1,198" para IDs >= 1000).
                oppId = oppId.replace(/,/g, '');
                if (!oppId) return;
                var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
                fetch('/app/api/oportunidad/' + oppId + '/toggle-pin/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf ? csrf.value : '' },
                }).then(function(r) { return r.json(); }).then(function(data) {
                    if (!data.success) { console.warn('[PIN] API sin success:', data); return; }
                    var anclada = !!data.anclada;

                    var newFill   = anclada ? '#EF4444' : '#B0B8C4';

                    // Comparación robusta: usamos dataset.pinId en lugar de querySelectorAll con
                    // attribute equality — evita problemas si el attr tiene whitespace u otros
                    // caracteres raros que el selector CSS no tolera.
                    var _allPins = document.querySelectorAll('.crm-pin[data-pin-id]');
                    var pinsFound = [];
                    _allPins.forEach(function(p){
                        var raw = (p.dataset.pinId || '').replace(/\s/g, '').replace(/\u00A0/g, '').replace(/,/g, '');
                        if (raw === oppId) pinsFound.push(p);
                    });
                    if (pinsFound.length === 0) {
                        // Fallback: solo el pin clickeado
                        clickedPin.classList.toggle('pinned', anclada);
                        var _svg = clickedPin.querySelector('svg');
                        if (_svg) { _svg.setAttribute('fill', newFill); }
                    }
                    pinsFound.forEach(function(p){
                        if (p.classList.contains('tarea-action-btn')) return;
                        p.classList.toggle('pinned', anclada);
                        var svg = p.querySelector('svg');
                        if (svg) {
                            svg.setAttribute('fill', newFill);
                            svg.setAttribute('stroke', 'none');
                        }
                    });

                    // 2) Actualizar TODAS las cards/rows que matcheen este oppId.
                    //    Match robusto: normalizar dataset.oppId (strip whitespace + comma).
                    var allNodes = [];
                    document.querySelectorAll('.crm-postit[data-opp-id], .crm-list-row[data-opp-id]').forEach(function(n){
                        var raw = (n.dataset.oppId || '').replace(/\s/g, '').replace(/\u00A0/g, '').replace(/,/g, '');
                        if (raw === oppId) allNodes.push(n);
                    });
                    allNodes.forEach(function(node){
                        node.dataset.anclada = anclada ? '1' : '0';
                        node.classList.toggle('pinned-row', anclada);
                        // Gestionar el agujero visual (solo en postit cards)
                        if (node.classList.contains('crm-postit')) {
                            var existingHole = node.querySelector('.crm-pin-hole-dyn');
                            if (anclada && !existingHole) {
                                var h = document.createElement('div');
                                h.className = 'crm-pin-hole-dyn';
                                h.style.cssText = 'position:absolute;top:18px;right:16px;width:7px;height:7px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#A0AAB8 0%,#C8CDD4 60%,#E2E5EA 100%);box-shadow:inset 0 1px 3px rgba(0,0,0,0.3),0 0 0 0.5px rgba(0,0,0,0.08);z-index:4;';
                                node.appendChild(h);
                            } else if (!anclada && existingHole) {
                                existingHole.remove();
                            }
                        }
                    });

                    // 2.b) Belt-and-suspenders: scrub del kanban board — aunque el re-render
                    //      debería replazar los clones, forzamos también aquí el estado visual.
                    //      (Usamos allNodes filtrados por match robusto, subset .crm-postit dentro de #crmKanbanBoard.)
                    var kBoard = document.getElementById('crmKanbanBoard');
                    if (kBoard) {
                        allNodes.forEach(function(k){
                            if (!kBoard.contains(k)) return;
                            var kPin = k.querySelector('.crm-pin');
                            if (kPin) {
                                kPin.classList.toggle('pinned', anclada);
                                var kSvg = kPin.querySelector('svg');
                                if (kSvg) { kSvg.setAttribute('fill', newFill); kSvg.setAttribute('stroke', 'none'); }
                            }
                        });
                    }

                    // 3) Mover originales al spot correcto (los clones del kanban se re-sortean en render).
                    //    Seleccionar de allNodes el que esté dentro de #crmCardsGrid y #crmListBody.
                    var _cgNode = document.getElementById('crmCardsGrid');
                    var _lbNode = document.getElementById('crmListBody');
                    var originalCard = null, originalRow = null;
                    allNodes.forEach(function(n){
                        if (_cgNode && _cgNode.contains(n) && n.classList.contains('crm-postit')) originalCard = n;
                        if (_lbNode && _lbNode.contains(n) && n.classList.contains('crm-list-row')) originalRow = n;
                    });
                    if (anclada) {
                        var cg = _cgNode;
                        if (originalCard && cg) cg.insertBefore(originalCard, cg.firstChild);
                        var lb = _lbNode;
                        if (originalRow  && lb) lb.insertBefore(originalRow, lb.firstChild);
                    } else {
                        function reubicar(container, node){
                            if (!container || !node) return;
                            var insertBefore = null;
                            var children = container.children;
                            for (var i = 0; i < children.length; i++) {
                                var ch = children[i];
                                if (ch === node) continue;
                                var chPinned  = ch.dataset && ch.dataset.anclada === '1';
                                var chOverdue = ch.dataset && ch.dataset.vencida === '1';
                                if (!chPinned && !chOverdue) { insertBefore = ch; break; }
                            }
                            if (insertBefore) container.insertBefore(node, insertBefore);
                            else container.appendChild(node);
                        }
                        reubicar(_cgNode, originalCard);
                        reubicar(_lbNode, originalRow);
                    }

                    // 4) Re-render kanban para que el sort refleje el nuevo estado de anclaje.
                    //    Doble trigger: inmediato + setTimeout 0 (gana contra el MutationObserver
                    //    que también re-renderiza al detectar el cambio de data-anclada).
                    function _kanbanRerender(){
                        if (typeof window._crmRenderKanban !== 'function') return;
                        var kv = document.getElementById('crmViewKanban');
                        if (kv && kv.style.display !== 'none') {
                            window._crmRenderKanban();
                        }
                    }
                    _kanbanRerender();
                    setTimeout(_kanbanRerender, 0);
                }).catch(function(err){
                    console.error('[PIN] error en fetch:', err);
                });
            })(pin);
        }, true);

        // Delegated capture-phase handler: botón de cotizar en la vista lista
        // Capture phase + stopImmediatePropagation para ganar contra el onclick del row.
        // Guard: dentro del mismo bloque _crmPinHandlerWired (este listener
        // tampoco debe duplicarse en cada turbo:load).
        document.addEventListener('click', function(e){
            var qbtn = e.target.closest && e.target.closest('.crm-list-quote');
            if (qbtn) {
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                var oppId = parseInt(qbtn.getAttribute('data-opp-id') || '0', 10);
                if (oppId && typeof window.openCotizador === 'function') window.openCotizador(oppId);
                return false;
            }
        }, true);
        }  // fin guard _crmPinHandlerWired

        // Helpers orden: ancladas → vencidas (más días arriba) → resto
        function isOverdueNode(n) { return n && n.dataset && n.dataset.vencida === '1'; }
        function isAnchoredNode(n) {
            return n && ((n.dataset && n.dataset.anclada === '1') || (n.classList && n.classList.contains('pinned-row')));
        }
        function diasVencidaNode(n) {
            return (n && n.dataset && parseInt(n.dataset.diasVencida || '0', 10)) || 0;
        }
        // El backend ya devuelve ordenado, pero re-aseguro cliente-side por si se mueven nodos.
        setTimeout(function(){
            ['crmCardsGrid', 'crmListBody'].forEach(function(id){
                var container = document.getElementById(id);
                if (!container) return;
                var nodes = Array.prototype.slice.call(container.children).filter(function(n){
                    return n.classList && (n.classList.contains('crm-data-row') || n.classList.contains('crm-list-row') || n.classList.contains('crm-postit'));
                });
                nodes.sort(function(a, b){
                    // 1) Ancladas primero
                    var pa = isAnchoredNode(a) ? 0 : 1;
                    var pb = isAnchoredNode(b) ? 0 : 1;
                    if (pa !== pb) return pa - pb;
                    // 2) Vencidas (no ancladas) después
                    var oa = isOverdueNode(a) ? 0 : 1;
                    var ob = isOverdueNode(b) ? 0 : 1;
                    if (oa !== ob) return oa - ob;
                    // 3) Dentro de vencidas: más días arriba
                    return diasVencidaNode(b) - diasVencidaNode(a);
                });
                nodes.forEach(function(n){ container.appendChild(n); });
            });
        }, 50);

        // CRM View Toggle — solo List y Kanban (cards + table ocultos por ahora)
        var _crmViewOrder = ['list', 'kanban'];
        var _crmViewMode = localStorage.getItem('crmViewMode') || 'list';
        if (_crmViewOrder.indexOf(_crmViewMode) === -1) _crmViewMode = 'list';
        window.toggleCrmView = function() {
            var idx = _crmViewOrder.indexOf(_crmViewMode);
            _crmViewMode = _crmViewOrder[(idx + 1) % _crmViewOrder.length];
            localStorage.setItem('crmViewMode', _crmViewMode);
            _applyCrmView();
        };
        function _applyCrmView() {
            // Remover el <style> temprano que oculta vistas (ahora las controlamos inline)
            var earlyHide = document.getElementById('_crmEarlyViewHide');
            if (earlyHide) earlyHide.remove();

            var listView   = document.getElementById('crmViewList');
            var cardsView  = document.getElementById('crmViewCards');
            var tableView  = document.getElementById('crmViewTable');
            var kanbanView = document.getElementById('crmViewKanban');
            var icon = document.getElementById('crmViewIcon');
            if (!cardsView || !tableView) return;
            if (listView)   listView.style.display   = (_crmViewMode === 'list')   ? '' : 'none';
            cardsView.style.display                   = 'none';  // cards oculta por ahora
            tableView.style.display                   = 'none';  // table oculta por ahora
            if (kanbanView) kanbanView.style.display = (_crmViewMode === 'kanban') ? '' : 'none';
            // En kanban: ocultar el footer legacy (clientes / deals / total) para aprovechar espacio
            var footer = document.querySelector('.crm-footer');
            if (footer) footer.style.display = (_crmViewMode === 'kanban') ? 'none' : '';
            // Clase en .crm-main para que el board llegue edge-to-edge y hasta abajo
            var mainEl = document.querySelector('.crm-main');
            if (mainEl) mainEl.classList.toggle('kanban-active', _crmViewMode === 'kanban');
            // Lock scroll del body para evitar scroll global en vista kanban
            document.body.classList.toggle('kanban-scroll-lock', _crmViewMode === 'kanban');
            if (_crmViewMode === 'kanban' && typeof window._crmRenderKanban === 'function') {
                window._crmRenderKanban();
            }
            // El label del sort depende de la vista (kanban añade sufijo de flujo):
            // re-render al cambiar de vista.
            if (typeof window._crmRenderFacetChips === 'function') window._crmRenderFacetChips();
            if (icon) {
                if (_crmViewMode === 'list') {
                    // 3 filas horizontales
                    icon.innerHTML = '<line x1="3" y1="6" x2="21" y2="6" stroke-width="2"/><line x1="3" y1="12" x2="21" y2="12" stroke-width="2"/><line x1="3" y1="18" x2="21" y2="18" stroke-width="2"/>';
                } else if (_crmViewMode === 'cards') {
                    // 2x2 grid (cards)
                    icon.innerHTML = '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>';
                } else if (_crmViewMode === 'kanban') {
                    // Kanban: 3 columnas verticales
                    icon.innerHTML = '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="14" rx="1"/><rect x="17" y="3" width="4" height="10" rx="1"/>';
                } else {
                    // Tabla clásica
                    icon.innerHTML = '<rect x="3" y="5" width="18" height="14" rx="1"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="5" x2="9" y2="19"/>';
                }
            }
        }
        _applyCrmView();

        // Buscador: filtrar cards en tiempo real
        var _crmSearchEl = document.getElementById('crmSearch');
        if (_crmSearchEl) {
            _crmSearchEl.addEventListener('input', function() {
                // Filtrar cards
                if (typeof _applyFiltersToCards === 'function') _applyFiltersToCards();
                // Filtrar tabla también
                var q = this.value.toLowerCase();
                var tbody = document.getElementById('crmTbody');
                if (tbody) {
                    tbody.querySelectorAll('tr.crm-data-row').forEach(function(row) {
                        row.style.display = (!q || row.textContent.toLowerCase().includes(q)) ? '' : 'none';
                    });
                }
            });
        }

        // Init vendor filter from URL
        var initVendedores = _CRM_CONFIG.vendedoresFilter;
        if (initVendedores) {
            var initIds = initVendedores.split(',');
            if (vfAll) vfAll.checked = false;
            initIds.forEach(function (id) {
                var cb = document.querySelector('.vf-user[value="' + id + '"]');
                if (cb) cb.checked = true;
            });
            updateVendorFilterLabel();
        }

    });

    /* Dynamic Island + botones del topbar.
       Migrado a window.crmReady para compatibilidad futura con Turbo. */
    window.crmReady(function () {
        const island = document.getElementById('mainIsland');
        const expandedContent = document.getElementById('islandExpandedContent');
        const btnUploadTrigger = document.getElementById('btnUploadXlsTrigger');
        const realUploadBtn = document.getElementById('btnUploadXls');
        let isIslandExpanded = false;

        // Island Expansion Logic - DISABLED per user request (no hover expansion)
        /*
        if (island && expandedContent) {
            island.addEventListener('mouseenter', () => {
                island.classList.add('is-expanded');
                expandedContent.style.display = 'block';
                setTimeout(() => { expandedContent.style.opacity = '1'; }, 10);
            });

            island.addEventListener('mouseleave', () => {
                if (!isIslandExpanded) {
                    island.classList.remove('is-expanded');
                    expandedContent.style.display = 'none';
                    expandedContent.style.opacity = '0';
                }
            });
        }
        */

        // Trigger real upload button from island
        if (btnUploadTrigger && realUploadBtn) {
            btnUploadTrigger.addEventListener('click', () => {
                realUploadBtn.click();
            });
        }
        // ── Ocultar dock ──
        function hideDock() {
            ['.macos-dock', '#dock-bottom', '#dock-left', '#dock-right', '#dock-top',
                '.dock-activation-zone', '.dock-zone-left', '.dock-zone-right',
                '.dock-zone-bottom', '.dock-zone-top', '.design-panel', '#design-panel',
                '.edit-mode-exit', '#night-shift-filter'].forEach(function (sel) {
                    document.querySelectorAll(sel).forEach(function (el) {
                        el.style.setProperty('display', 'none', 'important');
                        el.style.setProperty('opacity', '0', 'important');
                        el.style.setProperty('visibility', 'hidden', 'important');
                        el.style.setProperty('pointer-events', 'none', 'important');
                    });
                });
        }
        hideDock();
        setTimeout(hideDock, 60);
        setTimeout(hideDock, 200);
        setTimeout(hideDock, 500);

        // Filtros mes/año movidos a script independiente arriba

        // ── Widget Negociación ──
        try {
            var overlay = document.getElementById('widgetNegociacion');
            var btnOpen = document.getElementById('btnNegociacion');
            var btnClose = document.getElementById('widgetClose');
            var btnCancel = document.getElementById('wfCancel');
            var form = document.getElementById('formNegociacion');
            var toast = document.getElementById('widgetToast');

            function openWidget() {
                if (!overlay) { console.error('[CRM] widgetNegociacion overlay not found!'); return; }
                overlay.classList.add('active');
                overlay.classList.remove('closing');
                var wfCliente = document.getElementById('wfCliente');
                var wfOportunidad = document.getElementById('wfOportunidad');
                // Pre-selección desde tab "Prospectos" → "+ Oportunidad" sobre un ClientePotencial
                if (wfCliente && window._potencialPreseleccion) {
                    var pre = window._potencialPreseleccion;
                    wfCliente.value = pre.nombre || '';
                    wfCliente.dataset.refKey = 'p-' + pre.id;
                    // Mostrar etiqueta visible
                    var lbl = document.getElementById('wnClienteLabel');
                    if (lbl) lbl.textContent = (pre.nombre || '') + ' · Prospecto';
                    var btn = document.getElementById('wnClienteBtn');
                    if (btn) btn.classList.remove('empty');
                    window._potencialPreseleccion = null;
                }
                if (wfOportunidad) wfOportunidad.focus();
                else if (wfCliente) wfCliente.focus();
            }
            function closeWidget() {
                if (!overlay) return;
                overlay.classList.add('closing');
                setTimeout(function () {
                    overlay.classList.remove('active', 'closing');
                    if (form) form.reset();
                    // Close any open autocomplete
                    document.querySelectorAll('.wf-autocomplete').forEach(function (el) { el.classList.remove('open'); });
                }, 200);
            }
            function showToast(msg, type) {
                // Delega al helper global window.toast() (widget_toast.js).
                // Fallback al comportamiento local si el global no cargó.
                if (typeof window.toast === 'function') {
                    window.toast(msg, type);
                    return;
                }
                if (!toast) return;
                toast.textContent = msg;
                toast.className = 'widget-toast ' + type;
                setTimeout(function () { toast.className = 'widget-toast'; }, 3000);
            }

            if (btnOpen) {
                btnOpen.addEventListener('click', function () {
                    if (window._crmTareasMode) {
                        crmTaskAbrirCrear();
                    } else {
                        openWidget();
                    }
                });
            }
            if (btnClose) btnClose.addEventListener('click', closeWidget);
            if (btnCancel) btnCancel.addEventListener('click', closeWidget);

            // Nota: el modal de Nueva Oportunidad solo se cierra con el botón ×
            // (o el "Cancelar" del footer). El click sobre el backdrop y ESC están
            // deshabilitados a propósito para evitar perder un draft por accidente.

            // ── Autocomplete: Cliente ──
            var clienteInput = document.getElementById('wfCliente');
            var clienteAC = document.getElementById('wfClienteAC');
            var selectedClienteId = null;
            window._wfSelectedClienteId = null;  // shared with _widget_negociacion.html inline script
            var acTimeout = null;

            if (clienteInput) {
                clienteInput.addEventListener('input', function () {
                    var q = this.value.trim();
                    selectedClienteId = null;
                    // Al editar a mano, limpiamos el ref previo (se vuelve "legacy: por nombre").
                    clienteInput.dataset.refKey = '';
                    if (q.length < 2) { if (clienteAC) clienteAC.classList.remove('open'); return; }

                    clearTimeout(acTimeout);
                    acTimeout = setTimeout(function () {
                        // Fetch unificado: clientes + clientes potenciales asignados al usuario
                        fetch('/app/api/seleccionables/?q=' + encodeURIComponent(q))
                            .then(function (r) { return r.json(); })
                            .then(function (data) {
                                if (!clienteAC) return;
                                clienteAC.innerHTML = '';
                                var items = (data && data.items) || [];
                                if (items.length > 0) {
                                    items.forEach(function (it) {
                                        var div = document.createElement('div');
                                        div.className = 'wf-ac-item';
                                        var tag = it.tipo === 'potencial'
                                            ? '<span style="background:#FEF3C7;color:#92400E;font-size:0.65rem;font-weight:700;padding:1px 6px;border-radius:8px;margin-right:6px;">PROSPECTO</span>'
                                            : '<span style="background:#DBEAFE;color:#1E40AF;font-size:0.65rem;font-weight:700;padding:1px 6px;border-radius:8px;margin-right:6px;">CLIENTE</span>';
                                        div.innerHTML = tag + it.nombre + (it.subtitulo ? '<div class="wf-ac-sub">' + it.subtitulo + '</div>' : '');
                                        div.addEventListener('click', function () {
                                            clienteInput.value = it.nombre;
                                            clienteInput.dataset.refKey = it.ref_key || '';
                                            selectedClienteId = (it.tipo === 'cliente') ? it.id : null;
                                            window._wfSelectedClienteId = selectedClienteId;
                                            clienteAC.classList.remove('open');
                                        });
                                        clienteAC.appendChild(div);
                                    });
                                    clienteAC.classList.add('open');
                                } else {
                                    clienteAC.classList.remove('open');
                                }
                            })
                            .catch(function (err) {
                                console.error('[AC] seleccionables fetch:', err);
                                if (clienteAC) clienteAC.classList.remove('open');
                            });
                    }, 250);
                });
            }

            // Sync selectedClienteId when cliente is created via "+" button
            if (clienteInput) {
                clienteInput.addEventListener('wn:cliente-set', function(e) {
                    selectedClienteId = e.detail.id;
                    window._wfSelectedClienteId = e.detail.id;
                    if (e.detail.id) clienteInput.dataset.refKey = 'c-' + e.detail.id;
                });
            }

            // ── Autocomplete: Contacto ──
            var contactoInput = document.getElementById('wfContacto');
            var contactoAC = document.getElementById('wfContactoAC');

            if (contactoInput) {
                contactoInput.addEventListener('input', function () {
                    var q = this.value.trim();
                    if (q.length < 2 || !selectedClienteId) { if (contactoAC) contactoAC.classList.remove('open'); return; }

                    clearTimeout(acTimeout);
                    acTimeout = setTimeout(function () {
                        fetch('/app/api/buscar-contactos/?cliente_id=' + selectedClienteId + '&q=' + encodeURIComponent(q))
                            .then(function (r) { return r.json(); })
                            .then(function (data) {
                                if (!contactoAC) return;
                                contactoAC.innerHTML = '';
                                if (data.contactos && data.contactos.length > 0) {
                                    data.contactos.forEach(function (c) {
                                        var div = document.createElement('div');
                                        div.className = 'wf-ac-item';
                                        div.textContent = c.nombre_completo || (c.nombre + ' ' + (c.apellido || ''));
                                        div.addEventListener('click', function () {
                                            contactoInput.value = div.textContent;
                                            contactoAC.classList.remove('open');
                                        });
                                        contactoAC.appendChild(div);
                                    });
                                    contactoAC.classList.add('open');
                                } else {
                                    contactoAC.classList.remove('open');
                                }
                            })
                            .catch(function (err) {
                                console.error('[AC] buscar-contactos fetch:', err);
                                if (contactoAC) contactoAC.classList.remove('open');
                            });
                    }, 250);
                });
            }

            // Close autocompletes on outside click
            document.addEventListener('click', function (e) {
                if (!e.target.closest('.wf-group')) {
                    document.querySelectorAll('.wf-autocomplete').forEach(function (el) { el.classList.remove('open'); });
                }
            });

            // ── Submit form via AJAX ──
            if (form) {
                form.addEventListener('submit', function (e) {
                    e.preventDefault();
                    var submitBtn = document.getElementById('wfSubmit');
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Creando...';

                    var csrfToken = form.querySelector('[name=csrfmiddlewaretoken]').value;
                    var clienteEl = document.getElementById('wfCliente');
                    var clienteNombre = (clienteEl && clienteEl.value || '').trim();
                    // cliente_ref: 'c-<id>' (cliente existente) | 'p-<id>' (potencial → se promueve).
                    // Lo setea el autocompletado/pre-selección guardando dataset.refKey.
                    var clienteRef = clienteEl ? (clienteEl.dataset.refKey || '') : '';
                    var payload = {
                        cliente_ref: clienteRef,
                        cliente_nombre: clienteNombre,
                        contacto_nombre: document.getElementById('wfContacto').value.trim(),
                        oportunidad: document.getElementById('wfOportunidad').value.trim(),
                        monto: document.getElementById('wfMonto').value || '0',
                        probabilidad_cierre: document.getElementById('wfProbabilidad').value || '25',
                        area: document.getElementById('wfArea').value,
                        producto: document.getElementById('wfProducto').value,
                        mes_cierre: document.getElementById('wfMesCierre').value,
                        tipo_negociacion: document.getElementById('wfTipo').value,
                        comentarios: document.getElementById('wfComentarios').value.trim()
                    };

                    fetch('/app/api/crear-oportunidad/', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': csrfToken
                        },
                        body: JSON.stringify(payload)
                    })
                        .then(function (r) { return r.json(); })
                        .then(function (data) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = 'Crear Negociacion';

                            if (data.ok) {
                                closeWidget();
                                showToast(data.message, 'success');
                                // Cambiar a mes=todos para que la nueva oportunidad sea visible
                                currentMes = 'todos';
                                var _p = new URLSearchParams(window.location.search);
                                _p.set('mes', 'todos');
                                history.replaceState(null, '', window.location.pathname + '?' + _p.toString());
                                var mf = document.getElementById('mesFilter');
                                if (mf) mf.value = 'todos';
                                refreshCrmTable();
                                // Abrir el widget de la nueva oportunidad directamente
                                if (data.id) {
                                    setTimeout(function () { openDetalle(data.id); }, 800);
                                }

                                // Si fue abierto desde un correo, vincular automáticamente
                                var correoId = window._mailOppFromCorreoId;
                                if (correoId && data.id) {
                                    window._mailOppFromCorreoId = null;
                                    fetch('/app/api/mail/vincular/' + correoId + '/', {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'X-CSRFToken': csrfToken
                                        },
                                        body: JSON.stringify({ oportunidad_id: data.id })
                                    }).catch(function () { });
                                }
                            } else {
                                showToast(data.error || 'Error al crear', 'error');
                            }
                        })
                        .catch(function (err) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = 'Crear Negociacion';
                            showToast('Error de conexion', 'error');
                        });
                });
            }

            // Set default mes_cierre to current month
            var now = new Date();
            var mesActual = now.getMonth() + 1; // getMonth is 0-indexed
            var mesCierreSelect = document.getElementById('wfMesCierre');
            if (mesCierreSelect) {
                mesCierreSelect.value = mesActual.toString().padStart(2, '0');
            }
        } catch (e) { console.error('Negociacion Init Error', e); }

        // ══════════════════════════════════════════════
        // ── Widget Detalle de Oportunidad ──
        // ══════════════════════════════════════════════
        try {
            var detalleOverlay = document.getElementById('widgetDetalle');
            var detalleClose = document.getElementById('detalleClose');
            var detalleLoading = document.getElementById('detalleLoading');
            var detalleContent = document.getElementById('detalleContent');
            var currentOppId = null;

            // Etapas definitions — dinámicas desde la BD via _CRM_CONFIG
            var _etapasPipeline = _CRM_CONFIG.etapasPipeline || {};
            var ETAPAS_RUNRATE = (_etapasPipeline['runrate'] || []).map(function(e){ return e.nombre; });
            var ETAPAS_PROYECTO = (_etapasPipeline['proyecto'] || []).map(function(e){ return e.nombre; });
            // Fallback si no hay datos en BD
            if (!ETAPAS_RUNRATE.length) ETAPAS_RUNRATE = ['En Solicitud', 'Cotizando', 'Enviada', 'Seguimiento', 'Vendido s/PO', 'Vendido c/PO', 'En Tránsito', 'Facturado', 'Programado', 'Entregado', 'Esperando Pago', 'Sin Respuesta', 'Ganado', 'Perdido'];
            if (!ETAPAS_PROYECTO.length) ETAPAS_PROYECTO = ['Oportunidad', 'Levantamiento', 'Base Cotización', 'Cotizando', 'Enviada', 'Seguimiento', 'Vendido s/PO', 'Vendido c/PO', 'Cotiz. Proveedor', 'Comprando', 'En Tránsito', 'Ejecutando', 'Entregado', 'Facturado', 'Reportes', 'Pagado', 'Perdido'];

            // Helper: obtener etapas por tipo de negociación (soporta pipelines dinámicos)
            function getEtapasForTipo(tipo) {
                var pipelineData = _etapasPipeline[tipo];
                if (pipelineData) return pipelineData.map(function(e){ return e.nombre; });
                if (tipo === 'proyecto') return ETAPAS_PROYECTO;
                return ETAPAS_RUNRATE;
            }

            function openDetalle(oppId) {
                // V2 takeover (oportunidad_widget_v2.js, Refactor Etapa 1): los
                // callers internos (kanban/lista/restore) llaman esta función
                // local por closure; esta guard los enruta al componente
                // instanciable. Rollback: localStorage.setItem('opp_v2_off','1').
                if (window.OppWidgetV2 && window.OppWidgetV2.takeover) { return window.OppWidgetV2.open(oppId); }
                // Sanitize: strip any non-digit characters (e.g. locale thousands separators)
                var cleanId = parseInt(String(oppId).replace(/[^\d]/g, ''), 10);
                if (!cleanId || isNaN(cleanId)) return;
                oppId = cleanId;
                currentOppId = oppId;
                if (typeof woSetCurrentOppId === 'function') woSetCurrentOppId(oppId);
                detalleOverlay.classList.add('active');
                detalleOverlay.classList.remove('closing');
                // URL sync: ?open_opp=<id>. Permite share-links y reopen al recargar.
                if (window.crmWidgetUrl) window.crmWidgetUrl.set('opp', oppId);
                // Elevar z-index si hay otro widget abierto debajo
                var _needsElevation = false;
                ['widgetCalendarioMaster','widgetClienteOportunidades','widgetProyectoDetalle'].forEach(function(wid){
                    var el = document.getElementById(wid);
                    if (el && (el.style.display === 'flex' || el.classList.contains('active'))) _needsElevation = true;
                });
                if (_needsElevation) {
                    detalleOverlay.classList.add('z-elevated');
                }
                document.body.style.overflow = 'hidden';
                detalleLoading.style.display = 'block';
                detalleContent.style.display = 'none';

                // Persistir widget abierto
                try { sessionStorage.setItem('_crm_open_opp_id', oppId); } catch (e) { }

                fetch('/app/api/oportunidad-detalle-crm/' + oppId + '/')
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (data.error) { showToast('Error: ' + data.error, 'error'); return; }
                        renderDetalle(data);
                        detalleLoading.style.display = 'none';
                        detalleContent.style.display = 'flex';
                        // Para proyectos Bitrix24: abrir el Drive automáticamente
                        if (data.tipo_negociacion === 'bitrix_proyecto') {
                            setTimeout(function () {
                                if (typeof woAbrirGestorDrive === 'function') woAbrirGestorDrive();
                            }, 150);
                        }
                    })
                    .catch(function () {
                        showToast('Error cargando detalle', 'error');
                        closeDetalleWidget(true);
                    });
            }
            window.openDetalle = openDetalle;

            // Restaurar widget si estaba abierto antes de recargar
            try {
                var _savedOppId = sessionStorage.getItem('_crm_open_opp_id');
                if (_savedOppId) {
                    var _savedClean = parseInt(String(_savedOppId).replace(/[^\d]/g, ''), 10);
                    if (_savedClean) {
                        setTimeout(function () { openDetalle(_savedClean); }, 300);
                    } else {
                        sessionStorage.removeItem('_crm_open_opp_id');
                    }
                }
            } catch (e) { }

            // Auto-abrir oportunidad/tarea desde parámetro URL (viene del spotlight)
            try {
                var _urlParams = new URLSearchParams(window.location.search);
                var _openOppId = _urlParams.get('open_opp');
                var _openTaskId = _urlParams.get('open_task');
                var _cleanParams = false;
                if (_openOppId) {
                    var _openOppClean = parseInt(_openOppId, 10);
                    if (_openOppClean) {
                        setTimeout(function () { openDetalle(_openOppClean); }, 600);
                        _urlParams.delete('open_opp');
                        _cleanParams = true;
                    }
                }
                if (_openTaskId) {
                    var _openTaskClean = parseInt(_openTaskId, 10);
                    if (_openTaskClean) {
                        // Cuando llegamos via deep-link a una tarea (típicamente
                        // desde el preview de WhatsApp), cambiamos primero a la
                        // sección de Tareas para que al cerrar el widget, el
                        // usuario quede en su lista en lugar de en CRM. También
                        // disparamos recargarTareasCRM() para que el listado
                        // se pinte (si no, queda vacío hasta que el usuario
                        // navega manualmente).
                        setTimeout(function () {
                            if (typeof switchCrmView === 'function') switchCrmView('tareas');
                            if (typeof recargarTareasCRM === 'function') recargarTareasCRM();
                            if (typeof crmTaskVerDetalle === 'function') crmTaskVerDetalle(_openTaskClean);
                        }, 600);
                        _urlParams.delete('open_task');
                        _cleanParams = true;
                    }
                }
                // Deep-link a cliente: abre el widget de cliente en la pestaña Información
                var _openClienteId = _urlParams.get('open_cliente');
                if (_openClienteId) {
                    var _openClienteClean = parseInt(_openClienteId, 10);
                    if (_openClienteClean) {
                        setTimeout(function () {
                            if (typeof window.openClienteModal === 'function') {
                                window.openClienteModal(_openClienteClean, '', 'info');
                            }
                        }, 600);
                        _urlParams.delete('open_cliente');
                        _cleanParams = true;
                    }
                }
                // Deep-link a proyecto: cambia a la vista Proyectos y abre el detalle.
                // Usamos click() del sidebar para que el listener del ingeniero
                // oculte dashIngRoot correctamente. Sin esto, el detalle queda
                // por debajo del dashboard.
                var _openProyId = _urlParams.get('open_proyecto');
                if (_openProyId) {
                    var _openProyClean = parseInt(_openProyId, 10);
                    if (_openProyClean) {
                        setTimeout(function () {
                            var _bp = document.getElementById('btnProyectos');
                            if (_bp) _bp.click();
                            else if (typeof switchCrmView === 'function') switchCrmView('proyectos');
                            setTimeout(function () {
                                if (typeof window.proyectosVerDetalle === 'function') window.proyectosVerDetalle(_openProyClean);
                            }, 80);
                        }, 600);
                        _urlParams.delete('open_proyecto');
                        _cleanParams = true;
                    }
                }
                if (_cleanParams) {
                    var newUrl = window.location.pathname + (_urlParams.toString() ? '?' + _urlParams.toString() : '');
                    window.history.replaceState({}, '', newUrl);
                }
            } catch (e) { }

            var MES_NOMBRES = {
                '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
                '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
                '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
            };

            function getInitials(name) {
                if (!name) return '?';
                var parts = name.trim().split(/\s+/);
                if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
                return parts[0].substring(0, 2).toUpperCase();
            }

            function renderDetalle(d) {
                var tipo = d.tipo_negociacion || 'runrate';

                // Type badge
                var badge = document.getElementById('woTypeBadge');
                badge.className = 'wo-type-badge ' + tipo;
                var badgeIcon, badgeLabel;
                if (tipo === 'bitrix_proyecto') {
                    badgeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
                    badgeLabel = 'PROYECTO BITRIX24';
                    badge.style.cursor = 'default';
                    badge.style.background = '#5856D6';
                    badge.style.borderColor = '#5856D6';
                    badge.style.color = '#fff';
                } else {
                    badge.style.cursor = 'pointer';
                    badge.style.background = '';
                    badge.style.borderColor = '';
                    badge.style.color = '';
                    badgeIcon = tipo === 'proyecto'
                        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>'
                        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>';
                    badgeLabel = tipo === 'proyecto' ? 'VENTA PROYECTO' : 'VENTA RUNRATE';
                }
                badge.innerHTML = badgeIcon + '<span>' + badgeLabel + '</span>';

                // Limpiar event listeners previos
                var newBadge = badge.cloneNode(true);
                badge.parentNode.replaceChild(newBadge, badge);
                badge = newBadge;

                // bitrix_proyecto: badge no cambia de tipo
                if (tipo === 'bitrix_proyecto') {
                    badge.style.cursor = 'default';
                    badge.style.background = '#5856D6';
                    badge.style.borderColor = '#5856D6';
                    badge.style.color = '#fff';
                    // skip click handler
                } else
                    badge.addEventListener('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        var newTipo = tipo === 'proyecto' ? 'runrate' : 'proyecto';
                        var targetName = newTipo === 'proyecto' ? 'Ventas de Proyectos' : 'Ventas Runrate';

                        var txt = document.getElementById('confirmTipoText');
                        if (txt) txt.innerHTML = '¿Estás seguro que deseas cambiar esta oportunidad a <b>' + targetName + '</b>?<br><br>Al confirmar, las etapas del pipeline se reiniciarán a su estado inicial.';

                        var overlay = document.getElementById('widgetConfirmTipo');
                        if (!overlay) {
                            showToast("Error: widgetConfirmTipo no encontrado", "error");
                            return;
                        }
                        var btnCancel = document.getElementById('confirmTipoCancel');
                        var btnAccept = document.getElementById('confirmTipoAccept');

                        overlay.classList.add('active');

                        btnCancel.onclick = function () {
                            overlay.classList.remove('active');
                        };

                        btnAccept.onclick = function () {
                            overlay.classList.remove('active');
                            var csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;
                            var formData = new FormData();
                            formData.append('tipo_negociacion', newTipo);
                            // Also reset etapa to first stage of new type
                            var newEtapas = getEtapasForTipo(newTipo);
                            formData.append('etapa_corta', newEtapas[0]);
                            btnAccept.textContent = 'Cambiando...';
                            fetch('/app/api/editar-oportunidad/' + d.id + '/', {
                                method: 'POST',
                                headers: { 'X-CSRFToken': csrfToken },
                                body: formData
                            }).then(function (r) { return r.json(); }).then(function (resp) {
                                btnAccept.textContent = 'Sí, cambiar';
                                if (resp.success) {
                                    showToast('Tipo cambiado a ' + (newTipo === 'proyecto' ? 'Proyecto' : 'Runrate'), 'success');
                                    openDetalle(d.id);
                                } else {
                                    showToast(resp.error || 'Error', 'error');
                                }
                            });
                        };
                    }); // end badge click

                // Title (editable)
                var titleEl = document.getElementById('woTitle');
                titleEl.textContent = d.oportunidad || '';
                titleEl.style.cursor = 'pointer';
                titleEl.title = 'Clic para editar nombre';
                titleEl.onclick = function () {
                    if (titleEl.querySelector('input')) return;
                    var currentName = titleEl.textContent;
                    var inp = document.createElement('input');
                    inp.type = 'text';
                    inp.value = currentName;
                    inp.style.cssText = 'font-size:1.8rem;font-weight:700;color:#1D1D1F;border:none;border-bottom:2px solid #0052D4;background:transparent;outline:none;width:100%;letter-spacing:-0.02em;font-family:inherit;padding:0;';
                    titleEl.textContent = '';
                    titleEl.appendChild(inp);
                    inp.focus();
                    inp.select();
                    function commitTitle() {
                        var newName = inp.value.trim();
                        if (!newName) newName = currentName;
                        titleEl.textContent = newName;
                        if (newName !== (woOriginalData.oportunidad || '')) {
                            woFieldChanged('oportunidad', newName);
                        }
                    }
                    inp.addEventListener('blur', commitTitle);
                    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { titleEl.textContent = currentName; } });
                };

                // Pipeline
                var stagesContainer = document.getElementById('woPipelineStages');
                stagesContainer.innerHTML = '';
                var pipelineWrap = document.getElementById('woPipelineScroll') && document.getElementById('woPipelineScroll').closest('.wo-pipeline');
                if (tipo === 'bitrix_proyecto') {
                    // Mostrar una sola etiqueta en lugar del pipeline completo
                    if (pipelineWrap) pipelineWrap.style.display = 'none';
                } else {
                    if (pipelineWrap) pipelineWrap.style.display = '';
                }
                var etapas = getEtapasForTipo(tipo);
                var currentEtapa = d.etapa_corta || etapas[0];
                var currentIdx = -1;
                // Fuzzy match
                for (var i = 0; i < etapas.length; i++) {
                    if (etapas[i].toLowerCase() === currentEtapa.toLowerCase() ||
                        currentEtapa.toLowerCase().indexOf(etapas[i].toLowerCase()) !== -1 ||
                        etapas[i].toLowerCase().indexOf(currentEtapa.toLowerCase()) !== -1) {
                        currentIdx = i;
                        break;
                    }
                }
                if (currentIdx === -1) currentIdx = 0;
                var stageColor = d.etapa_color || '#0052D4';

                etapas.forEach(function (et, i) {
                    if (i > 0) {
                        var conn = document.createElement('span');
                        conn.className = 'wo-stage-connector' + (i <= currentIdx ? ' completed' : '');
                        stagesContainer.appendChild(conn);
                    }
                    var btn = document.createElement('button');
                    btn.type = 'button';
                    if (i < currentIdx) {
                        btn.className = 'wo-stage-btn completed';
                        btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> ' + et;
                    } else if (i === currentIdx) {
                        btn.className = 'wo-stage-btn active';
                        btn.textContent = et;
                    } else {
                        btn.className = 'wo-stage-btn';
                        btn.textContent = et;
                    }
                    btn.addEventListener('click', function () { changeStage(d.id, et, tipo); });
                    stagesContainer.appendChild(btn);
                });

                // Auto-scroll to active stage
                setTimeout(function () {
                    var activeBtn = stagesContainer.querySelector('.wo-stage-btn.active');
                    if (activeBtn) {
                        var scroll = document.getElementById('woPipelineScroll');
                        scroll.scrollLeft = activeBtn.offsetLeft - scroll.offsetWidth / 2 + activeBtn.offsetWidth / 2;
                    }
                }, 50);

                // Info card
                var montoNum = Number(d.monto) || 0;
                document.getElementById('woMonto').textContent = '$' + montoNum.toLocaleString('es-MX', { minimumFractionDigits: 0 });
                var mesNombre = MES_NOMBRES[d.mes_cierre] || d.mes_cierre || '-';
                document.getElementById('woFechaCierre').textContent = mesNombre + ' ' + new Date().getFullYear();
                document.getElementById('woProducto').textContent = d.producto || 'N/A';
                document.getElementById('woArea').textContent = d.area || 'N/A';
                document.getElementById('woPoNumber').value = d.po_number || '';
                document.getElementById('woFacturaNumero').value = d.factura_numero || '';

                // Probability
                var prob = d.probabilidad_cierre || 0;
                var probEl = document.getElementById('woProbValue');
                probEl.textContent = prob + '%';
                probEl.style.color = prob >= 70 ? '#16A34A' : prob >= 40 ? '#F59E0B' : '#EF4444';
                var fillEl = document.getElementById('woProbFill');
                fillEl.style.width = prob + '%';
                fillEl.style.background = prob >= 70 ? '#16A34A' : prob >= 40 ? '#F59E0B' : '#EF4444';

                // Vendedor
                var vendedor = d.usuario || 'Sin asignar';
                document.getElementById('woVendedorAvatar').textContent = getInitials(vendedor);
                document.getElementById('woVendedorName').textContent = vendedor;

                // Cliente
                var clienteNombre = d.cliente ? d.cliente.nombre : 'Sin empresa';
                var contactoNombre = d.contacto || 'No asignado';
                document.getElementById('woClienteAvatar').textContent = getInitials(clienteNombre);
                document.getElementById('woContactoName').textContent = contactoNombre;
                document.getElementById('woClienteName').textContent = clienteNombre;

                // Cotizaciones
                var quoteList = document.getElementById('woQuoteList');
                quoteList.innerHTML = '';
                if (d.cotizaciones && d.cotizaciones.length > 0) {
                    d.cotizaciones.forEach(function (cot) {
                        var card = document.createElement('div');
                        card.className = 'wo-quote-card';
                        var cotId = cot.id.toString().padStart(3, '0');
                        var totalStr = Number(cot.total).toLocaleString('es-MX', { minimumFractionDigits: 0 });
                        card.innerHTML =
                            '<div class="wo-quote-left">' +
                            '<div class="wo-quote-badge">#' + cotId + '</div>' +
                            '<div class="wo-quote-info" onclick="window.open(\'/app/cotizacion/view/' + cot.id + '/\',\'_blank\')">' +
                            '<div class="wo-quote-title">COT-' + new Date().getFullYear() + '-' + cotId + '<span class="wo-quote-version">(v1.0)</span></div>' +
                            '<div class="wo-quote-meta">' + cot.fecha + ' &bull; $' + totalStr + '</div>' +
                            '</div>' +
                            '</div>' +
                            '<div class="wo-quote-actions">' +
                            '<a href="#" onclick="openEditCotizacion(' + cot.id + '); return false;" class="wo-action-btn" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></a>' +
                            '<a href="/app/cotizacion/pdf/' + cot.id + '/" class="wo-action-btn" title="Descargar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a>' +
                            '</div>';
                        quoteList.appendChild(card);
                    });
                } else {
                    quoteList.innerHTML = '<div class="wo-empty">Sin cotizaciones aun</div>';
                }

                // Setup inline editing
                woSetupEditableFields(d);

                // Restricciones para rol Ingeniero
                if (window.ES_INGENIERO) {
                    // Título: solo lectura
                    var titleElI = document.getElementById('woTitle');
                    if (titleElI) { titleElI.style.cursor = 'default'; titleElI.title = ''; titleElI.onclick = null; }
                    // Badge: no cambia tipo
                    var badgeI = document.getElementById('woTypeBadge');
                    if (badgeI) { badgeI.style.cursor = 'default'; badgeI.onclick = null; }
                    // Stage buttons: deshabilitados
                    document.querySelectorAll('.wo-stage-btn').forEach(function (b) {
                        b.style.pointerEvents = 'none'; b.style.opacity = '0.7';
                    });
                    // Cotizar button: ocultar
                    var cotizarBtn = document.getElementById('woNuevaCotBtn');
                    if (cotizarBtn) cotizarBtn.style.display = 'none';
                    // Campos editables: solo lectura
                    document.querySelectorAll('.wo-editable').forEach(function (el) {
                        el.style.cursor = 'default'; el.onclick = null;
                    });
                }

                // Fila inferior pipeline Proyecto: bloques Proyecto + Instalaciones.
                // El handler vive en _widget_oportunidad.html y es no-op si tipo=runrate.
                if (typeof window.woRenderProyectoSection === 'function') {
                    try { window.woRenderProyectoSection(d); } catch (e) { console.error('woRenderProyectoSection', e); }
                }
            }

            // ══════════════════════════════════════════════
            // ── Inline Editing Logic ──
            // ══════════════════════════════════════════════
            var WO_PRODUCTOS = [['ZEBRA', 'Zebra'], ['PANDUIT', 'Panduit'], ['APC', 'APC'], ['AVIGILION', 'Avigilon'], ['GENETEC', 'Genetec'], ['AXIS', 'Axis'], ['SOFTWARE', 'Software'], ['RUNRATE', 'Runrate'], ['PÓLIZA', 'Poliza'], ['CISCO', 'Cisco'], ['SERVICIO', 'Servicio']];
            var WO_AREAS = [['SISTEMAS', 'Sistemas'], ['Recursos Humanos', 'Recursos Humanos'], ['Compras', 'Compras'], ['Seguridad', 'Seguridad'], ['Mantenimiento', 'Mantenimiento'], ['Almacén', 'Almacén']];
            var WO_MESES = [['01', 'Enero'], ['02', 'Febrero'], ['03', 'Marzo'], ['04', 'Abril'], ['05', 'Mayo'], ['06', 'Junio'], ['07', 'Julio'], ['08', 'Agosto'], ['09', 'Septiembre'], ['10', 'Octubre'], ['11', 'Noviembre'], ['12', 'Diciembre']];

            var woOriginalData = {};
            var woEditedFields = {};
            var woSaveBar = document.getElementById('woSaveBar');

            function woShowSaveBar() {
                if (Object.keys(woEditedFields).length > 0) {
                    woSaveBar.style.display = 'flex';
                }
            }
            function woHideSaveBar() {
                woSaveBar.style.display = 'none';
            }
            function woFieldChanged(field, value) {
                woEditedFields[field] = value;
                woShowSaveBar();
            }

            // Helper: make a select from options array, pre-selecting current value
            function woMakeSelect(options, currentVal, className) {
                var sel = document.createElement('select');
                sel.className = 'wo-inline-select ' + (className || '');
                options.forEach(function (o) {
                    var opt = document.createElement('option');
                    opt.value = o[0];
                    opt.textContent = o[1];
                    if (o[0] === currentVal || o[1] === currentVal) opt.selected = true;
                    sel.appendChild(opt);
                });
                return sel;
            }

            // Helper: make an autocomplete input
            function woMakeAutocomplete(container, placeholder, searchUrl, onSelect) {
                container.innerHTML = '';
                var wrap = document.createElement('div');
                wrap.className = 'wo-inline-ac';
                var inp = document.createElement('input');
                inp.type = 'text';
                inp.placeholder = placeholder;
                inp.className = 'wo-inline-input';
                var dd = document.createElement('div');
                dd.className = 'wo-ac-dropdown';
                dd.style.display = 'none';
                wrap.appendChild(inp);
                wrap.appendChild(dd);
                container.appendChild(wrap);
                inp.focus();

                function doSearch(q) {
                    var sep = searchUrl.indexOf('?') !== -1 ? '&' : '?';
                    fetch(searchUrl + sep + 'q=' + encodeURIComponent(q))
                        .then(function (r) { return r.json(); })
                        .then(function (data) {
                            dd.innerHTML = '';
                            var items = data.clientes || data.usuarios || data.contactos || [];
                            if (items.length === 0) { dd.style.display = 'none'; return; }
                            items.forEach(function (item) {
                                var div = document.createElement('div');
                                div.className = 'wo-ac-item';
                                var name = item.nombre_completo || item.nombre || item.username || '';
                                var sub = item.contacto_principal || item.email || item.rol || '';
                                div.innerHTML = name + (sub ? '<div class="wo-ac-sub">' + sub + '</div>' : '');
                                div.addEventListener('click', function () {
                                    onSelect(item);
                                    dd.style.display = 'none';
                                });
                                dd.appendChild(div);
                            });
                            dd.style.display = 'block';
                        });
                }

                // Show full list immediately on focus
                doSearch('');

                var acTimer = null;
                inp.addEventListener('input', function () {
                    var q = inp.value.trim();
                    clearTimeout(acTimer);
                    acTimer = setTimeout(function () { doSearch(q); }, 200);
                });
                // Close on outside click
                setTimeout(function () {
                    document.addEventListener('click', function closeAc(e) {
                        if (!wrap.contains(e.target)) {
                            dd.style.display = 'none';
                            document.removeEventListener('click', closeAc);
                        }
                    });
                }, 100);
            }

            function woSetupEditableFields(d) {
                woOriginalData = JSON.parse(JSON.stringify(d));
                woEditedFields = {};
                woHideSaveBar();

                // Title is set up in renderDetalle already

                // ── Monto (solo lectura) ──
                var montoEl = document.getElementById('woMonto');
                montoEl.classList.remove('editable');
                montoEl.onclick = null;
                montoEl.style.cursor = 'default';

                // ── Producto ──
                var prodEl = document.getElementById('woProducto');
                prodEl.classList.add('editable');
                prodEl.onclick = function () {
                    if (prodEl.querySelector('select')) return;
                    var currentVal = woEditedFields.producto || d.producto || '';
                    var sel = woMakeSelect(WO_PRODUCTOS, currentVal);
                    prodEl.textContent = '';
                    prodEl.appendChild(sel);
                    sel.focus();
                    sel.addEventListener('change', function () {
                        var v = sel.value;
                        var label = sel.options[sel.selectedIndex].text;
                        prodEl.textContent = label;
                        if (v !== woOriginalData.producto) woFieldChanged('producto', v);
                    });
                    sel.addEventListener('blur', function () {
                        if (!sel.parentNode) return;
                        var label = sel.options[sel.selectedIndex].text;
                        prodEl.textContent = label;
                    });
                };

                // ── Area ──
                var areaEl = document.getElementById('woArea');
                areaEl.classList.add('editable');
                areaEl.onclick = function () {
                    if (areaEl.querySelector('select')) return;
                    var currentVal = woEditedFields.area || d.area || '';
                    var sel = woMakeSelect(WO_AREAS, currentVal);
                    areaEl.textContent = '';
                    areaEl.appendChild(sel);
                    sel.focus();
                    sel.addEventListener('change', function () {
                        var v = sel.value;
                        var label = sel.options[sel.selectedIndex].text;
                        areaEl.textContent = label;
                        if (v !== woOriginalData.area) woFieldChanged('area', v);
                    });
                    sel.addEventListener('blur', function () {
                        if (!sel.parentNode) return;
                        var label = sel.options[sel.selectedIndex].text;
                        areaEl.textContent = label;
                    });
                };

                // ── Mes de Cierre ──
                var mesEl = document.getElementById('woFechaCierre');
                mesEl.classList.add('editable');
                mesEl.onclick = function () {
                    if (mesEl.querySelector('select')) return;
                    var currentVal = woEditedFields.mes_cierre || d.mes_cierre || '';
                    var sel = woMakeSelect(WO_MESES, currentVal);
                    mesEl.textContent = '';
                    mesEl.appendChild(sel);
                    sel.focus();
                    sel.addEventListener('change', function () {
                        var v = sel.value;
                        var label = sel.options[sel.selectedIndex].text;
                        mesEl.textContent = label + ' ' + new Date().getFullYear();
                        if (v !== woOriginalData.mes_cierre) woFieldChanged('mes_cierre', v);
                    });
                    sel.addEventListener('blur', function () {
                        if (!sel.parentNode) return;
                        var label = sel.options[sel.selectedIndex].text;
                        mesEl.textContent = label + ' ' + new Date().getFullYear();
                    });
                };

                // ── PO Number ──
                window.woGuardarPO = function (input) {
                    input.style.borderBottomColor = 'transparent';
                    var val = input.value.trim();
                    if (val === (woOriginalData.po_number || '')) return;
                    var fd = new FormData();
                    fd.append('po_number', val);
                    fetch('/app/api/oportunidad/' + currentOppId + '/po/', {
                        method: 'POST', body: fd,
                        headers: { 'X-CSRFToken': document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '' }
                    }).then(function (r) { return r.json(); }).then(function (data) {
                        if (data.ok) { woOriginalData.po_number = val; }
                        else { input.value = woOriginalData.po_number || ''; }
                    }).catch(function () { input.value = woOriginalData.po_number || ''; });
                };

                // ── Factura ──
                window.woGuardarFactura = function (input) {
                    input.style.borderBottomColor = 'transparent';
                    var val = input.value.trim();
                    if (val === (woOriginalData.factura_numero || '')) return;
                    var fd = new FormData();
                    fd.append('factura_numero', val);
                    fetch('/app/api/oportunidad/' + currentOppId + '/po/', {
                        method: 'POST', body: fd,
                        headers: { 'X-CSRFToken': document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '' }
                    }).then(function (r) { return r.json(); }).then(function (data) {
                        if (data.ok) { woOriginalData.factura_numero = val; }
                        else { input.value = woOriginalData.factura_numero || ''; }
                    }).catch(function () { input.value = woOriginalData.factura_numero || ''; });
                };

                // ── Probabilidad (click/drag on bar) ──
                var probBar = document.getElementById('woProbFill').parentElement;
                var probValEl = document.getElementById('woProbValue');
                var probFillEl = document.getElementById('woProbFill');
                probValEl.classList.add('editable');

                function updateProbVisual(val) {
                    var color = val >= 70 ? '#16A34A' : val >= 40 ? '#F59E0B' : '#EF4444';
                    probValEl.textContent = val + '%';
                    probValEl.style.color = color;
                    probFillEl.style.width = val + '%';
                    probFillEl.style.background = color;
                }

                function probFromEvent(e) {
                    var rect = probBar.getBoundingClientRect();
                    var x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                    var pct = Math.round((x / rect.width) * 100 / 5) * 5;
                    return Math.max(0, Math.min(100, pct));
                }

                var draggingProb = false;
                probBar.addEventListener('mousedown', function (e) {
                    draggingProb = true;
                    var val = probFromEvent(e);
                    updateProbVisual(val);
                });
                document.addEventListener('mousemove', function (e) {
                    if (!draggingProb) return;
                    var val = probFromEvent(e);
                    updateProbVisual(val);
                });
                document.addEventListener('mouseup', function (e) {
                    if (!draggingProb) return;
                    draggingProb = false;
                    var val = probFromEvent(e);
                    updateProbVisual(val);
                    if (val !== (woOriginalData.probabilidad_cierre || 0)) {
                        woFieldChanged('probabilidad', val);
                    }
                });
                probValEl.onclick = function (e) { e.stopPropagation(); };

                // ── Cliente (autocomplete) ──
                var clienteNameEl = document.getElementById('woClienteName');
                var clienteContactoEl = document.getElementById('woContactoName');
                var clienteAvatarEl = document.getElementById('woClienteAvatar');
                clienteNameEl.classList.add('editable');
                clienteNameEl.onclick = function () {
                    if (clienteNameEl.querySelector('.wo-inline-ac')) return;
                    woMakeAutocomplete(clienteNameEl, 'Buscar cliente...', '/app/api/buscar-clientes/', function (item) {
                        clienteNameEl.textContent = item.nombre;
                        clienteAvatarEl.textContent = getInitials(item.nombre);
                        if (item.contacto_principal) clienteContactoEl.textContent = item.contacto_principal;
                        if (item.id !== (woOriginalData.cliente ? woOriginalData.cliente.id : null)) {
                            woFieldChanged('cliente', item.id);
                        }
                    });
                };

                // ── Contacto (autocomplete, depends on cliente) ──
                var contactoEl = document.getElementById('woContactoName');
                contactoEl.classList.add('editable');
                contactoEl.onclick = function () {
                    if (contactoEl.querySelector('.wo-inline-ac')) return;
                    var cId = woEditedFields.cliente || (d.cliente ? d.cliente.id : '');
                    if (!cId) return;
                    woMakeAutocomplete(contactoEl, 'Buscar contacto...', '/app/api/buscar-contactos/?cliente_id=' + cId, function (item) {
                        var name = item.nombre_completo || (item.nombre + ' ' + (item.apellido || '')).trim();
                        contactoEl.textContent = name;
                        if (item.id !== woOriginalData.contacto_id) {
                            woFieldChanged('contacto', item.id);
                        }
                    });
                };

                // ── Vendedor (autocomplete) ──
                var vendedorNameEl = document.getElementById('woVendedorName');
                var vendedorAvatarEl = document.getElementById('woVendedorAvatar');
                vendedorNameEl.classList.add('editable');
                vendedorNameEl.onclick = function () {
                    if (vendedorNameEl.querySelector('.wo-inline-ac')) return;
                    woMakeAutocomplete(vendedorNameEl, 'Buscar usuario...', '/app/api/buscar-usuarios/', function (item) {
                        var name = item.nombre || item.nombre_completo || item.username;
                        vendedorNameEl.textContent = name;
                        vendedorAvatarEl.textContent = getInitials(name);
                        if (item.id !== woOriginalData.usuario_id) {
                            woFieldChanged('usuario', item.id);
                        }
                    });
                };
            }

            // ── Save / Cancel handlers ──
            document.getElementById('woSaveConfirm').addEventListener('click', function () {
                if (Object.keys(woEditedFields).length === 0) { woHideSaveBar(); return; }
                var csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;
                var formData = new FormData();
                for (var key in woEditedFields) {
                    formData.append(key, woEditedFields[key]);
                }
                var btn = this;
                btn.textContent = 'Guardando...';
                btn.disabled = true;
                fetch('/app/api/editar-oportunidad/' + currentOppId + '/', {
                    method: 'POST',
                    headers: { 'X-CSRFToken': csrfToken },
                    body: formData
                })
                    .then(function (r) { return r.json(); })
                    .then(function (resp) {
                        btn.textContent = 'Guardar';
                        btn.disabled = false;
                        if (resp.success) {
                            showToast('Cambios guardados', 'success');
                            woEditedFields = {};
                            woHideSaveBar();
                            _crmTableDirty = true;
                            // Refresh data
                            openDetalle(currentOppId);
                        } else {
                            showToast(resp.error || 'Error al guardar', 'error');
                        }
                    })
                    .catch(function () {
                        btn.textContent = 'Guardar';
                        btn.disabled = false;
                        showToast('Error de conexión', 'error');
                    });
            });

            document.getElementById('woSaveCancel').addEventListener('click', function () {
                woEditedFields = {};
                woHideSaveBar();
                // Re-render with original data
                renderDetalle(woOriginalData);
            });

            function changeStage(oppId, etapa, tipo) {
                var csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;
                var formData = new FormData();
                formData.append('etapa_corta', etapa);

                fetch('/app/api/editar-oportunidad/' + oppId + '/', {
                    method: 'POST',
                    headers: { 'X-CSRFToken': csrfToken },
                    body: formData
                }).then(function (r) { return r.json(); }).then(function (resp) {
                    if (resp.success) {
                        showToast('Etapa actualizada', 'success');
                        openDetalle(oppId);
                    } else {
                        showToast(resp.error || 'Error', 'error');
                    }
                });
            }

            // (Auto-save removed — widget is now read-only display)

            function closeDetalleWidget(forceClose) {
                // Solo aplica la verificación si el usuario actual es el responsable de la oportunidad
                var esResponsable = woOriginalData && woOriginalData.usuario_id &&
                    String(woOriginalData.usuario_id) === String(_CRM_CONFIG.userId);

                // Etapas que no requieren actividad pendiente (oportunidad ya cerrada)
                var etapaSinActividad = ['Ganado', 'Perdido', 'Pagado'];
                var etapaActual = woOriginalData && woOriginalData.etapa_corta ? woOriginalData.etapa_corta : '';
                var esEtapaCerrada = etapaSinActividad.indexOf(etapaActual) !== -1;

                if (!forceClose && currentOppId && esResponsable && !esEtapaCerrada) {
                    // Verificar si la oportunidad tiene al menos una actividad pendiente
                    fetch('/app/api/oportunidad/' + currentOppId + '/tareas/')
                        .then(function (r) { return r.json(); })
                        .then(function (res) {
                            if (res.success && res.tareas) {
                                var pendientes = res.tareas.filter(function (t) { return t.estado !== 'completada'; });
                                if (pendientes.length === 0) {
                                    // No hay actividades pendientes — bloquear cierre
                                    _showMissingActivityWarning();
                                    return;
                                }
                            }
                            _doCloseDetalle();
                        })
                        .catch(function () {
                            _doCloseDetalle();
                        });
                } else {
                    _doCloseDetalle();
                }
            }

            var _crmTableDirty = false; // Solo refrescar si algo cambió

            function _doCloseDetalle() {
                detalleOverlay.classList.add('closing');
                setTimeout(function () {
                    detalleOverlay.classList.remove('active', 'closing');
                    document.body.style.overflow = '';
                }, 200);
                try { sessionStorage.removeItem('_crm_open_opp_id'); } catch (e) { }
                // URL sync: quitar el ?open_opp= al cerrar.
                if (window.crmWidgetUrl) window.crmWidgetUrl.clear('opp');
                // Restaurar z-index del overlay
                detalleOverlay.classList.remove('z-elevated', 'z-elevated-top');
                _crmTableDirty = false;
                refreshCrmTable();
            }

            function _showMissingActivityWarning() {
                // Crear overlay de advertencia
                var existing = document.getElementById('warnMissingActivity');
                if (existing) existing.remove();

                var warn = document.createElement('div');
                warn.id = 'warnMissingActivity';
                warn.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s;';
                warn.innerHTML = '<div style="background:#fff;border-radius:16px;padding:2rem;max-width:380px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.25);">' +
                    '<div style="width:56px;height:56px;border-radius:50%;background:rgba(255,149,0,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">' +
                    '<svg width="28" height="28" fill="none" stroke="#FF9500" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' +
                    '</div>' +
                    '<h3 style="margin:0 0 0.5rem;font-size:1.15rem;font-weight:700;color:#1D1D1F;">Falta agendar actividad</h3>' +
                    '<p style="margin:0 0 1.5rem;font-size:0.9rem;color:#86868B;line-height:1.5;">Cada oportunidad debe tener al menos una actividad programada para garantizar el seguimiento.</p>' +
                    '<div style="display:flex;gap:0.75rem;justify-content:center;">' +
                    '<button id="warnBtnAgendar" style="background:#0052D4;color:#fff;border:none;padding:0.7rem 1.5rem;border-radius:10px;font-weight:700;font-size:0.9rem;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:transform 0.15s;" onmouseenter="this.style.transform=\'scale(1.03)\'" onmouseleave="this.style.transform=\'none\'">' +
                    '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>' +
                    'Agendar Actividad' +
                    '</button>' +
                    '</div>' +
                    '</div>';
                document.body.appendChild(warn);

                document.getElementById('warnBtnAgendar').addEventListener('click', function () {
                    warn.remove();
                    // Abrir el widget de crear actividad
                    if (typeof woAbrirWidgetCrearActividad === 'function') {
                        woAbrirWidgetCrearActividad();
                    } else {
                        var crearWidget = document.getElementById('widgetOppCrearActividad');
                        if (crearWidget) crearWidget.style.display = 'flex';
                    }
                });
            }

            detalleClose.addEventListener('click', function () { closeDetalleWidget(); });
            detalleOverlay.addEventListener('click', function (e) {
                if (e.target === detalleOverlay) closeDetalleWidget();
            });

            // Click on opportunity name to open detalle widget
            document.querySelectorAll('.opp-name-link').forEach(function (el) {
                el.addEventListener('click', function () {
                    var oppId = this.getAttribute('data-oportunidad-id');
                    if (oppId) openDetalle(oppId);
                });
            });

            // "Nueva cotización" button in detalle widget
            document.getElementById('detNuevaCot').addEventListener('click', function () {
                if (currentOppId) {
                    openCotizador(currentOppId);
                }
            });

            // ══════════════════════════════════════════════
            // ── Widget Cotizador (iframe) ──
            // ══════════════════════════════════════════════
            var cotizadorOverlay = document.getElementById('widgetCotizador');
            var cotizadorCloseBtn = document.getElementById('cotizadorClose');
            var cotizadorIframe = document.getElementById('cotizadorIframe');

            var cotizadorOppId = null;

            function openCotizador(oppId) {
                // V2 takeover: cotizador instanciado (una ventana por opp).
                if (window.OppWidgetV2 && window.OppWidgetV2.takeover) { return window.OppWidgetV2.openCotizador(oppId); }
                cotizadorOppId = oppId;
                cotizadorOverlay.classList.add('active');
                cotizadorOverlay.classList.remove('closing');
                // body.cotizador-open habilita el CSS que oculta breadcrumbs
                // de widgets de oportunidad detrás del cotizador.
                if (document.body) document.body.classList.add('cotizador-open');
                cotizadorIframe.src = '/app/crear-cotizacion/oportunidad/' + oppId + '/?widget_mode=1';
            }
            window.openCotizador = openCotizador;

            window.openEditCotizacion = function (cotId) {
                // Cierra el widget de detalle si está abierto
                if (detalleOverlay.classList.contains('active')) {
                    detalleOverlay.classList.remove('active', 'closing');
                }
                cotizadorOverlay.classList.add('active');
                cotizadorOverlay.classList.remove('closing');
                if (document.body) document.body.classList.add('cotizador-open');
                cotizadorIframe.src = '/app/cotizacion/' + cotId + '/editar/?widget_mode=1';
            };

            function closeCotizador() {
                cotizadorOverlay.classList.add('closing');
                setTimeout(function () {
                    cotizadorOverlay.classList.remove('active', 'closing');
                    if (document.body) document.body.classList.remove('cotizador-open');
                    cotizadorIframe.src = 'about:blank';
                }, 200);
                if (cotizacionCreated) {
                    cotizacionCreated = false;
                    refreshCrmTable();
                }
            }

            // Solo la X cierra el cotizador — click en backdrop y tecla Escape bloqueados.
            cotizadorCloseBtn.addEventListener('click', closeCotizador);
            // Capturar Escape a nivel document y swallow si el overlay está activo
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && cotizadorOverlay.classList.contains('active')) {
                    e.stopPropagation();
                    e.preventDefault();
                }
            }, true);

            // ── Refresh table via API (sin recargar página) ──
            var currentTab = _CRM_CONFIG.tabActivo;
            var _clientesPanelData = {};
            var _clientesExpanded = null;
            var _CLIENTES_VISTAS = ['facturado', 'cobrado', 'oportunidades', 'cotizado', 'prospeccion'];

            var _crmClientesMode = localStorage.getItem('crm_clientes_mode') || 'oportunidades';

            // Immediately hide opp KPIs/charts if saved mode is not 'oportunidades' (prevents flash)
            if (_crmClientesMode === 'prospeccion' || _crmClientesMode === 'proyectos') {
                var _earlyKpi = document.getElementById('ckKpiRow');
                var _earlyCharts = document.getElementById('ckChartsSection');
                if (_earlyKpi) _earlyKpi.style.display = 'none';
                if (_earlyCharts) _earlyCharts.style.display = 'none';
                // Update selector buttons immediately (toggle .active — los tabs dashboard usan .crm-tab)
                var _eOpp = document.getElementById('crmModeOpp');
                var _eProsp = document.getElementById('crmModeProsp');
                var _eProy = document.getElementById('crmModeProyectos');
                if (_eOpp) _eOpp.classList.remove('active');
                if (_eProsp) _eProsp.classList.toggle('active', _crmClientesMode === 'prospeccion');
                if (_eProy) _eProy.classList.toggle('active', _crmClientesMode === 'proyectos');
            }

            window._crmSetMode = function(mode) {
                _crmClientesMode = mode;
                localStorage.setItem('crm_clientes_mode', mode);
                var btnOpp = document.getElementById('crmModeOpp');
                var btnProsp = document.getElementById('crmModeProsp');
                var btnProy = document.getElementById('crmModeProyectos');
                var btnClientes = document.getElementById('crmModeClientes');
                if (btnOpp && btnProsp) {
                    btnOpp.classList.toggle('active', mode === 'oportunidades');
                    btnOpp.classList.remove('active-prospectos');
                    btnProsp.classList.toggle('active', mode === 'prospeccion');
                    btnProsp.classList.toggle('active-prospectos', mode === 'prospeccion');
                    // Limpiar inline styles legados si existen
                    btnOpp.style.background = ''; btnOpp.style.color = '';
                    btnProsp.style.background = ''; btnProsp.style.color = '';
                }
                if (btnProy) {
                    btnProy.classList.toggle('active', mode === 'proyectos');
                    btnProy.classList.toggle('active-proyectos', mode === 'proyectos');
                    btnProy.style.background = ''; btnProy.style.color = '';
                }
                if (btnClientes) {
                    btnClientes.classList.toggle('active', mode === 'clientes_tabla');
                }
                // Sección de tabla de Clientes (4° modo del Dashboard)
                var cliSection = document.getElementById('ckClientesTablaSection');
                var kpiOpp = document.getElementById('ckKpiRow');
                var kpiProsp = document.getElementById('ckKpiRowProsp');
                var kpiProy = document.getElementById('ckKpiRowProy');
                var charts = document.getElementById('ckChartsSection');
                var detalle = document.getElementById('ckDetalleSection');

                var chartsProsp = document.getElementById('ckChartsSectionProsp');
                var chartsProy = document.getElementById('ckChartsSectionProy');

                // Si hay un drill-down activo (detalle visible) NO lo escondas — esto
                // se llama desde refreshes periódicos y borraría la tabla del usuario.
                var detalleOpen = !!(window._ckDetalleOpen) && detalle && detalle.style.display !== 'none';

                // Por default ocultar la tabla de clientes; los modos que la
                // necesiten la prenden abajo.
                if (cliSection) cliSection.style.display = 'none';

                // Filtro "Mostrar" (cli-filter-island) solo visible en modo clientes_tabla.
                var cliFilterIsland = document.getElementById('cliFilterIsland');
                if (cliFilterIsland) {
                    cliFilterIsland.style.display = (mode === 'clientes_tabla') ? '' : 'none';
                }

                if (mode === 'oportunidades') {
                    if (kpiOpp) kpiOpp.style.display = 'grid';
                    if (kpiProsp) kpiProsp.style.display = 'none';
                    if (kpiProy) kpiProy.style.display = 'none';
                    if (!detalleOpen) {
                        if (charts) { charts.style.display = ''; charts.style.opacity = '1'; }
                        if (chartsProsp) chartsProsp.style.display = 'none';
                        if (chartsProy) chartsProy.style.display = 'none';
                        if (detalle) detalle.style.display = 'none';
                    }
                    // Restore footer from facturado data
                    var footerLeft = document.getElementById('footerLeft');
                    var footerRight = document.getElementById('footerRight');
                    if (_clientesPanelData.facturado) {
                        if (footerLeft) footerLeft.textContent = (_clientesPanelData.facturado.footer || {}).left || '';
                        if (footerRight) footerRight.textContent = (_clientesPanelData.facturado.footer || {}).right || '';
                    }
                } else if (mode === 'prospeccion') {
                    if (kpiOpp) kpiOpp.style.display = 'none';
                    if (kpiProsp) kpiProsp.style.display = 'grid';
                    if (kpiProy) kpiProy.style.display = 'none';
                    if (!detalleOpen) {
                        if (charts) charts.style.display = 'none';
                        if (chartsProsp) chartsProsp.style.display = 'block';
                        if (chartsProy) chartsProy.style.display = 'none';
                        if (detalle) detalle.style.display = 'none';
                        _renderProspKPIs();
                        _renderProspCharts();
                    } else {
                        // Detalle abierto: refrescar KPIs (no charts, no detalle).
                        _renderProspKPIs();
                    }
                    // Update footer for prospeccion
                    var footerLeft = document.getElementById('footerLeft');
                    var footerRight = document.getElementById('footerRight');
                    var pData = _clientesPanelData.prospeccion || {};
                    if (footerLeft) footerLeft.textContent = (pData.footer || {}).left || '';
                    if (footerRight) footerRight.textContent = (pData.footer || {}).right || '';
                } else if (mode === 'clientes_tabla') {
                    // Modo "Clientes" (4° del Dashboard): oculta todo lo
                    // demás y muestra la tabla cliente × marca.
                    if (kpiOpp) kpiOpp.style.display = 'none';
                    if (kpiProsp) kpiProsp.style.display = 'none';
                    if (kpiProy) kpiProy.style.display = 'none';
                    if (charts) charts.style.display = 'none';
                    if (chartsProsp) chartsProsp.style.display = 'none';
                    if (chartsProy) chartsProy.style.display = 'none';
                    if (detalle) detalle.style.display = 'none';
                    if (cliSection) cliSection.style.display = '';
                    var footerLeft = document.getElementById('footerLeft');
                    var footerRight = document.getElementById('footerRight');
                    if (footerLeft) footerLeft.textContent = '';
                    if (footerRight) footerRight.textContent = '';
                } else if (mode === 'proyectos') {
                    if (kpiOpp) kpiOpp.style.display = 'none';
                    if (kpiProsp) kpiProsp.style.display = 'none';
                    if (kpiProy) kpiProy.style.display = 'grid';
                    if (!detalleOpen) {
                        if (charts) charts.style.display = 'none';
                        if (chartsProsp) chartsProsp.style.display = 'none';
                        if (chartsProy) chartsProy.style.display = 'block';
                        if (detalle) detalle.style.display = 'none';
                    }
                    // Cargar / re-render dashboard de proyectos
                    if (typeof _loadProyectosDashboard === 'function') {
                        _loadProyectosDashboard();
                    }
                    // Footer custom para proyectos
                    var footerLeft = document.getElementById('footerLeft');
                    var footerRight = document.getElementById('footerRight');
                    var pyData = _proyectosDashState || {};
                    if (footerLeft) {
                        var totP = (pyData.kpis && pyData.kpis.total_proyectos) || 0;
                        var actP = (pyData.kpis && pyData.kpis.proyectos_ejecucion) || 0;
                        footerLeft.textContent = totP + ' proyectos / ' + actP + ' activos';
                    }
                    if (footerRight) {
                        var ven = (pyData.kpis && pyData.kpis.venta_total) || 0;
                        footerRight.textContent = 'Venta total: $' + Number(ven).toLocaleString('en-US', { maximumFractionDigits: 0 });
                    }
                }
            };
            var _CLIENTES_THEAD_MINI =
                '<tr class="text-[9px] text-gray-400 uppercase tracking-widest border-b border-gray-100">' +
                '<th class="px-2 py-2 text-left font-black">Cliente</th>' +
                '<th class="py-2 pr-2 text-right font-black text-gray-700 border-l border-gray-100">Meta</th>' +
                '<th class="py-2 pr-2 text-right font-black text-orange-500">Faltante</th>' +
                '<th class="py-2 pr-2 text-right font-black text-gray-800 border-l border-gray-100">Total</th>' +
                '</tr>';
            var _thStyle = 'text-align:right;padding:12px 8px;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;';
            var _CLIENTES_THEAD_FULL =
                '<tr style="border-bottom:1px solid #F3F4F6;">' +
                '<th style="text-align:left;padding:12px 8px;font-size:9px;font-weight:900;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.1em;">Cliente</th>' +
                '<th style="' + _thStyle + 'color:#3B82F6;">Zebra</th>' +
                '<th style="' + _thStyle + 'color:#3B82F6;">Panduit</th>' +
                '<th style="' + _thStyle + 'color:#3B82F6;">APC</th>' +
                '<th style="' + _thStyle + 'color:#3B82F6;">Avig.</th>' +
                '<th style="' + _thStyle + 'color:#3B82F6;">Genet.</th>' +
                '<th style="' + _thStyle + 'color:#3B82F6;">Axis</th>' +
                '<th style="' + _thStyle + 'color:#3B82F6;">Soft.</th>' +
                '<th style="' + _thStyle + 'color:#3B82F6;">RR</th>' +
                '<th style="' + _thStyle + 'color:#3B82F6;">Pol.</th>' +
                '<th style="' + _thStyle + 'color:#3B82F6;">Otros</th>' +
                '<th style="' + _thStyle + 'color:#374151;border-left:1px solid #F3F4F6;">Meta</th>' +
                '<th style="' + _thStyle + 'color:#F97316;">Faltante</th>' +
                '<th style="' + _thStyle + 'color:#1F2937;border-left:1px solid #F3F4F6;">Total</th>' +
                '</tr>';
            var currentMes = _CRM_CONFIG.mesFiltro;
            var currentAnio = _CRM_CONFIG.anioFiltro;

            var PRODUCT_COLS = ['ZEBRA', 'PANDUIT', 'APC', ['AVIGILON', 'AVIGILION'], 'GENETEC', 'AXIS', ['SOFTWARE', 'Desarrollo'], 'RUNRATE', ['PÓLIZA', 'POLIZA']];

            function fmtMoney(s) { return '$' + s; }

            function fmtShort(val) {
                // Format number without decimals, with comma separators: 50000 -> "50,000"
                // Strip commas first: API returns "1,086" (Python format) which parseFloat reads as 1
                var n = parseFloat(String(val).replace(/,/g, ''));
                if (isNaN(n)) return val;
                return Math.round(n).toLocaleString('en-US');
            }

            function productMatch(prod, col) {
                if (Array.isArray(col)) return col.indexOf(prod) !== -1;
                return prod === col;
            }

            function isOtherProduct(prod) {
                for (var i = 0; i < PRODUCT_COLS.length; i++) {
                    if (productMatch(prod, PRODUCT_COLS[i])) return false;
                }
                return true;
            }

            function buildCrmRow(r) {
                var esBitrix = r.tipo_negociacion === 'bitrix_proyecto';
                var prodCells = '';
                if (esBitrix) {
                    var totalCols = PRODUCT_COLS.length + 1;
                    for (var i = 0; i < totalCols; i++) {
                        prodCells += '<td style="text-align:right;padding:16px 8px;"><span class="money-zero">—</span></td>';
                    }
                } else {
                    for (var i = 0; i < PRODUCT_COLS.length; i++) {
                        var match = productMatch(r.producto, PRODUCT_COLS[i]);
                        prodCells += '<td style="text-align:right;padding:16px 8px;">' + (match ? '<span style="color:#2563EB;font-weight:700;">$' + fmtShort(r.monto) + '</span>' : '<span style="color:#D1D5DB;">$0</span>') + '</td>';
                    }
                    prodCells += '<td style="text-align:right;padding:16px 8px;">' + (isOtherProduct(r.producto) && r.producto ? '<span style="color:#2563EB;font-weight:700;">$' + fmtShort(r.monto) + '</span>' : '<span style="color:#D1D5DB;">$0</span>') + '</td>';
                }
                var nameStyle = '';
                var vencidaIcon = '';
                var rowExtraClass = '';
                if (r.tiene_actividad_vencida) {
                    nameStyle = ' style="color:#EF4444 !important;"';
                    vencidaIcon = '<span title="Actividad vencida" style="color:#EF4444;font-size:0.7rem;margin-left:4px;">&#9888;</span>';
                    rowExtraClass = ' crm-row-vencida';
                }
                var bitrixBadge = esBitrix ? '<span style="display:inline-block;background:#5856D6;color:#fff;font-size:0.55rem;font-weight:700;padding:1px 4px;border-radius:3px;margin-left:4px;vertical-align:middle;">B24</span>' : '';
                var totalCell = esBitrix ? '<td style="text-align:right;padding:16px 8px;font-weight:900;border-left:1px solid #F3F4F6;"><span style="color:#D1D5DB;">$0</span></td>' : '<td class="px-2 py-4 text-right font-black text-gray-900 border-l border-gray-100 bg-gray-50/20">$' + r.monto + '</td>';

                return '<tr class="crm-data-row' + rowExtraClass + '" data-opp-id="' + r.id + '" data-tipo="' + (r.tipo_negociacion || '') + '" data-etapa="' + (r.etapa || '') + '" data-fecha="' + (r.fecha_ts || '0') + '">' +
                    '<td class="px-2 py-4"><span class="opp-name-link" data-oportunidad-id="' + r.id + '"' + nameStyle + '>' + r.oportunidad + vencidaIcon + '</span>' + bitrixBadge +
                    '<span class="client-name-link text-[9px] text-gray-400 font-medium uppercase mt-1 cursor-pointer hover:text-blue-500 transition-colors block" data-cliente-id="' + (r.cliente_id || '') + '" data-tab="crm">' + (r.cliente || '- Sin Cliente -') + '</span></td>' +
                    '<td class="px-2 py-4 text-gray-600">' + r.contacto + '</td>' +
                    '<td class="px-2 py-4 text-gray-400 text-xs italic">' + r.area + '</td>' +
                    prodCells + totalCell + '</tr>';
            }

            function buildFacturadoRow(r) {
                var prodCells = '';
                var cols = ['zebra', 'panduit', 'apc', 'avigilon', 'genetec', 'axis', 'software', 'runrate', 'poliza', 'otros'];
                cols.forEach(function (c) {
                    var val = r[c] || '0';
                    prodCells += '<td style="text-align:right;padding:16px 8px;">' + (val !== '0' ? '<span style="color:#2563EB;font-weight:700;">$' + val + '</span>' : '<span style="color:#D1D5DB;">$0</span>') + '</td>';
                });
                return '<tr class="crm-data-row">' +
                    '<td class="px-2 py-4"><span class="client-name-link font-bold text-gray-900 leading-tight cursor-pointer hover:text-blue-600 transition-colors" data-cliente-id="' + r.cliente_id + '">' + r.cliente + '</span></td>' +
                    '<td class="px-2 py-4 text-gray-600">-</td>' +
                    '<td class="px-2 py-4 text-gray-400 text-xs italic">-</td>' +
                    prodCells +
                    '<td class="px-2 py-4 text-right font-black text-gray-900 border-l border-gray-100 bg-gray-50/20">$' + r.total + '</td>' +
                    '<td class="px-2 py-4 text-right font-bold border-l border-gray-100 bg-gray-50/20">$' + r.meta_cliente + '</td>' +
                    '<td class="px-2 py-4 text-right font-bold bg-gray-50/20">$' + r.meta_restante + '</td>' +
                    '<td class="px-2 py-3 text-center"><a href="/app/admin/crear-oportunidad/' + r.cliente_id + '" class="inline-block px-2 py-1.5 bg-blue-600 text-white rounded-lg text-[9px] font-black uppercase">Nuevo Deal</a></td>' +
                    '</tr>';
            }

            function buildCobradoRow(r) {
                return '<tr class="crm-data-row" data-opp-id="' + r.id + '">' +
                    '<td class="px-2 py-4"><span class="opp-name-link" data-oportunidad-id="' + r.id + '">' + r.oportunidad + '</span>' +
                    '<span class="client-name-link text-[9px] text-gray-400 font-medium uppercase mt-1 cursor-pointer hover:text-blue-500 transition-colors block" data-cliente-id="' + (r.cliente_id || '') + '" data-tab="crm">' + (r.cliente || '- Sin Cliente -') + '</span></td>' +
                    '<td class="px-2 py-4"><span class="text-xs font-medium text-gray-600">' + r.producto + '</span></td>' +
                    '<td class="px-2 py-4 text-gray-500 text-xs">' + r.usuario + '</td>' +
                    '<td class="px-2 py-4 text-center text-gray-400 text-xs">' + r.fecha + '</td>' +
                    '<td class="px-2 py-4 text-right font-black text-emerald-600">$' + r.monto + '</td>' +
                    '</tr>';
            }

            function fmtK(strVal) {
                var n = parseFloat(String(strVal).replace(/,/g, ''));
                if (isNaN(n) || n === 0) return '$0';
                if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
                if (Math.abs(n) >= 1000) return '$' + Math.round(n / 1000) + 'K';
                return '$' + Math.round(n);
            }

            function buildClientesMiniRow(r) {
                var total = parseFloat((r.total || '0').replace(/,/g, ''));
                var meta = parseFloat((r.meta || '0').replace(/,/g, ''));
                var faltante = parseFloat((r.faltante || '0').replace(/,/g, ''));
                var vendedor = r.vendedor ? '<div class="clientes-mini-vendedor">' + r.vendedor + '</div>' : '';
                var faltanteStyle = faltante > 0 ? 'color:#F97316;font-weight:700;' : 'color:#22C55E;font-weight:700;';
                var barHtml = '';
                if (meta > 0) {
                    var pct = Math.min(total / meta * 100, 100);
                    var barColor = pct >= 100 ? '#22C55E' : pct >= 75 ? '#3B82F6' : pct >= 40 ? '#F97316' : '#EF4444';
                    barHtml = '<div class="clientes-mini-bar"><div class="clientes-mini-bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + barColor + ';"></div></div>';
                }
                return '<tr class="crm-data-row">' +
                    '<td class="px-2 py-2"><span class="client-name-link cursor-pointer" style="font-size:0.73rem;font-weight:700;line-height:1.3;display:block;color:#1D1D1F;" data-cliente-id="' + r.cliente_id + '">' + r.cliente + '</span>' + barHtml + vendedor + '</td>' +
                    '<td class="px-2 py-2 text-right" style="font-size:0.72rem;color:#9CA3AF;font-weight:600;">$' + r.meta + '</td>' +
                    '<td class="px-2 py-2 text-right" style="font-size:0.72rem;' + faltanteStyle + '">$' + r.faltante + '</td>' +
                    '<td class="px-2 py-2 text-right font-black" style="font-size:0.72rem;color:#1D1D1F;">$' + r.total + '</td>' +
                    '</tr>';
            }

            function buildClientesFullRow(r) {
                var cols = ['zebra', 'panduit', 'apc', 'avigilon', 'genetec', 'axis', 'software', 'runrate', 'poliza', 'otros'];
                var prodCells = '';
                cols.forEach(function (c) {
                    var val = r[c] || '0';
                    prodCells += '<td style="text-align:right;padding:16px 8px;">' + (val !== '0' ? '<span style="color:#2563EB;font-weight:700;">$' + val + '</span>' : '<span style="color:#D1D5DB;">$0</span>') + '</td>';
                });
                var vendedor = r.vendedor ? '<div class="text-[9px] text-gray-400 font-medium mt-0.5">' + r.vendedor + '</div>' : '';
                var faltanteStyle = (parseFloat((r.faltante || '0').replace(/,/g, '')) > 0) ? 'color:#F97316;font-weight:700;' : 'color:#22C55E;font-weight:700;';
                return '<tr class="crm-data-row">' +
                    '<td class="px-2 py-4"><span class="client-name-link font-bold text-gray-900 leading-tight cursor-pointer hover:text-blue-600 transition-colors" data-cliente-id="' + r.cliente_id + '">' + r.cliente + '</span>' + vendedor + '</td>' +
                    prodCells +
                    '<td class="px-2 py-4 text-right font-bold border-l border-gray-100 bg-gray-50/20">$' + r.meta + '</td>' +
                    '<td class="px-2 py-4 text-right bg-gray-50/20" style="' + faltanteStyle + '">$' + r.faltante + '</td>' +
                    '<td class="px-2 py-4 text-right font-black text-gray-900 border-l border-gray-100 bg-gray-50/20">$' + r.total + '</td>' +
                    '</tr>';
            }

            function buildCotizadoRow(r) {
                var oppCell = r.oportunidad
                    ? '<span class="opp-name-link" data-oportunidad-id="' + r.oportunidad_id + '">' + r.oportunidad + '</span>'
                    : '—';
                return '<tr class="crm-data-row" data-opp-id="' + (r.oportunidad_id || '') + '">' +
                    '<td class="px-2 py-4">' + oppCell +
                    '<span class="client-name-link text-[9px] text-gray-400 font-medium uppercase mt-1 cursor-pointer hover:text-blue-500 transition-colors block" data-cliente-id="' + (r.cliente_id || '') + '" data-tab="crm">' + (r.cliente || '- Sin Cliente -') + '</span></td>' +
                    '<td class="px-2 py-4"><a href="' + r.pdf_url + '" target="_blank" class="px-2 py-1 bg-blue-50 rounded text-xs font-mono font-bold text-blue-600 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-colors cursor-pointer" style="text-decoration:none;">COT-' + r.id + '</a></td>' +
                    '<td class="px-2 py-4 text-gray-500 text-xs">' + (r.usuario || '—') + '</td>' +
                    '<td class="px-2 py-4 text-right text-gray-400 font-medium">$' + r.subtotal + '</td>' +
                    '<td class="px-2 py-4 text-right font-black text-blue-600">$' + r.total + '</td>' +
                    '</tr>';
            }
        } catch (e) { console.error('Detail Error', e); }

        function getVendedoresParam() {
            var checks = document.querySelectorAll('.vf-user:checked');
            var allCheck = document.getElementById('vfAll');
            if (!allCheck || allCheck.checked || checks.length === 0) return '';
            var ids = [];
            checks.forEach(function (c) { ids.push(c.value); });
            return ids.join(',');
        }

        var _desgloseFactTotal = null; // Total real del Excel (del endpoint desglose)
        function updateTopbarFromClientesPanel(data) {
            if (_desgloseFactTotal !== null) {
                // Usar siempre el total del desglose (incluye clientes sin match)
                var fa = document.getElementById('facturadoAmount');
                if (fa) fa.textContent = '$' + Number(_desgloseFactTotal).toLocaleString('en-US', { maximumFractionDigits: 0 });
            } else if (data.total_facturado !== undefined) {
                var fa = document.getElementById('facturadoAmount');
                if (fa) fa.textContent = '$' + data.total_facturado;
            }
            if (data.progreso !== undefined) {
                var pct = document.getElementById('progressPct');
                if (pct) {
                    pct.textContent = data.progreso + '%';
                    if (data.progreso >= 100) pct.classList.add('green');
                    else pct.classList.remove('green');
                }
            }
            if (data.vista_label !== undefined) {
                var lbl = document.getElementById('topbarTotalLabel');
                if (lbl) lbl.textContent = data.vista_label;
            }
        }

        var _clientesCombinedLoading = 0;
        var _ckGlobalMetas = { fact: 0, cob: 0, opp: 0, cot: 0 };

        function mergeClientesData() {
            var map = {};
            var order = [];
            var prefixMap = { facturado: 'fact', cobrado: 'cob', oportunidades: 'opp', cotizado: 'cot' };
            _CLIENTES_VISTAS.forEach(function (v) {
                if (!prefixMap[v]) return;
                var rows = (_clientesPanelData[v] || {}).rows || [];
                rows.forEach(function (r) {
                    if (!map[r.cliente_id]) {
                        map[r.cliente_id] = { cliente_id: r.cliente_id, cliente: r.cliente, vendedor: r.vendedor || '' };
                        order.push(r.cliente_id);
                    }
                });
            });
            _CLIENTES_VISTAS.forEach(function (v) {
                var p = prefixMap[v];
                if (!p) return;
                var rows = (_clientesPanelData[v] || {}).rows || [];
                var byId = {};
                rows.forEach(function (r) { byId[r.cliente_id] = r; });
                order.forEach(function (cid) {
                    var r = byId[cid];
                    map[cid][p + '_meta']     = r ? (r.meta        || '0') : '0';
                    map[cid][p + '_faltante'] = r ? (r.faltante    || '0') : '0';
                    map[cid][p + '_total']    = r ? (r.total       || '0') : '0';
                    if (v === 'oportunidades') {
                        map[cid]['opp_prev'] = r ? (r.prev_total || '0') : '0';
                    }
                    if (v === 'cotizado') {
                        map[cid]['num_cotizaciones'] = r ? (r.num_cotizaciones || 0) : 0;
                    }
                });
            });
            // Compute total pipeline per client
            order.forEach(function (cid) {
                var m = map[cid];
                var fN = function(s) { return parseFloat((s || '0').replace(/,/g, '')) || 0; };
                m._pipeline = fN(m.fact_total) + fN(m.cob_total) + fN(m.opp_total) + fN(m.cot_total);
            });
            return order.map(function (cid) { return map[cid]; });
        }

        var _DASH = '<span class="clientes-dash">—</span>';

        function buildClientesCombinedRow(r, rank) {
            var fN = function(s) { return parseFloat((s || '0').replace(/,/g, '')) || 0; };

            // Rank
            var rankHtml = rank <= 3
                ? '<span class="ck-trophy">' + (rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉') + '</span>'
                : '<span class="ck-rank-num">' + rank + '</span>';

            // Health score (cobrado vs pipeline)
            var pipeline = r._pipeline || 0;
            var cobN = fN(r.cob_total);
            var health = pipeline > 0
                ? (cobN / pipeline >= 0.30 ? 'green' : cobN / pipeline >= 0.10 ? 'yellow' : 'red')
                : 'gray';

            // Trend badge (opp vs prev month)
            var trendHtml = '';
            var oppN = fN(r.opp_total), prevN = fN(r.opp_prev || '0');
            if (prevN > 0 && oppN !== prevN) {
                var pct = Math.round((oppN - prevN) / prevN * 100);
                trendHtml = '<span class="ck-trend-badge ck-trend--' + (pct >= 0 ? 'up' : 'down') + '">' +
                    (pct >= 0 ? '↑' : '↓') + ' ' + Math.abs(pct) + '%</span>';
            }

            // Metric cell — value + progress bar vs meta + meta label
            function metricTd(val, metaVal, metricClass, barClass) {
                var n = fN(val), m = fN(metaVal);
                if (n === 0 && m === 0) return '<td class="ck-td ck-td--metric"><span class="ck-dash">—</span></td>';
                var inner = '<div class="ck-metric-val ' + metricClass + '">$' + (n > 0 ? val : '0') + '</div>';
                if (m > 0) {
                    var pct = Math.min(120, n / m * 100);
                    var over = n >= m;
                    inner += '<div class="ck-bar-track">' +
                        '<div class="ck-bar ' + barClass + (over ? ' ck-bar--over' : '') + '" data-pct="' + Math.min(100, pct).toFixed(1) + '" style="width:0"></div>' +
                        '</div>' +
                        '<div class="ck-metric-meta">Meta: $' + metaVal + '</div>';
                }
                return '<td class="ck-td ck-td--metric">' + inner + '</td>';
            }

            function cotNumTd(nc) {
                if (nc === 0) return '<td class="ck-td ck-td--metric"><span class="ck-dash">—</span></td>';
                return '<td class="ck-td ck-td--metric"><div class="ck-metric-val ck-metric--cot">' + nc + '</div></td>';
            }

            return '<tr class="ck-row">' +
                '<td class="ck-td ck-td--rank">' + rankHtml + '</td>' +
                '<td class="ck-td ck-td--cliente">' +
                    '<div class="ck-client-row">' +
                    '<span class="ck-health-dot ck-health--' + health + '"></span>' +
                    '<div style="min-width:0;flex:1;">' +
                    '<div class="ck-client-name" data-cliente-id="' + r.cliente_id + '" style="cursor:pointer;color:#007AFF;">' + r.cliente + '</div>' +
                    '<div class="ck-client-meta">' + (r.vendedor || '') + (trendHtml ? ' ' + trendHtml : '') + '</div>' +
                    '</div></div></td>' +
                metricTd(r.fact_total, r.fact_meta, 'ck-metric--fact', 'ck-bar--fact') +
                metricTd(r.cob_total,  r.cob_meta,  'ck-metric--cob',  'ck-bar--cob')  +
                metricTd(r.opp_total,  r.opp_meta,  'ck-metric--opp',  'ck-bar--opp')  +
                cotNumTd(r.num_cotizaciones || 0) +
                '</tr>';
        }

        function renderClientesCombinedTable() {
            var merged = mergeClientesData();

            if (merged.length === 0) {
                var kpiRow = document.getElementById('ckKpiRow');
                if (kpiRow) kpiRow.style.display = 'none';
                var chartsSection = document.getElementById('ckChartsSection');
                if (chartsSection) chartsSection.style.display = 'none';
                return;
            }

            // Sort by opp_total descending (cliente con más oportunidades primero)
            var fNs = function(s) { return parseFloat((s || '0').replace(/,/g, '')) || 0; };
            merged.sort(function (a, b) { return fNs(b.opp_total) - fNs(a.opp_total); });

            // KPI totals + metas (sumadas de cada cliente)
            var fN = function(s) { return parseFloat((s || '0').replace(/,/g, '')) || 0; };
            var totFact = 0, totCob = 0, totOpp = 0, totCot = 0, totPrevOpp = 0;
            var metaFact = 0, metaCob = 0, metaOpp = 0, metaCot = 0;
            merged.forEach(function (r) {
                totFact    += fN(r.fact_total);
                totCob     += fN(r.cob_total);
                totOpp     += fN(r.opp_total);
                totCot     += fN(r.cot_total);
                totPrevOpp += fN(r.opp_prev || '0');
                metaFact   += fN(r.fact_meta);
                metaCob    += fN(r.cob_meta);
                metaOpp    += fN(r.opp_meta);
                metaCot    += fN(r.cot_meta);
            });
            var fmtKpi = function(n) { return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' MXN'; };
            var fmtPct = function(val, meta) { return meta > 0 ? Math.round(val / meta * 100) : 0; };

            // Helper: set KPI card content
            var el = function(id) { return document.getElementById(id); };
            // Get prev_sum from each panel API response
            var prevFact = fN((_clientesPanelData.facturado    || {}).prev_sum || '0');
            var prevCob  = fN((_clientesPanelData.cobrado      || {}).prev_sum || '0');
            var prevCot  = fN((_clientesPanelData.cotizado     || {}).prev_sum || '0');
            // For opp, use the sum already computed from per-client data
            var prevOpp  = totPrevOpp;

            // Also get global metas from panel meta fields (for METAS column fallback)
            _ckGlobalMetas.fact = fN((_clientesPanelData.facturado    || {}).meta || '0');
            _ckGlobalMetas.cob  = fN((_clientesPanelData.cobrado      || {}).meta || '0');
            _ckGlobalMetas.opp  = fN((_clientesPanelData.oportunidades|| {}).meta || '0');
            _ckGlobalMetas.cot  = fN((_clientesPanelData.cotizado     || {}).meta || '0');

            function setKpi(valId, val, meta, progId, pctId, metaTextId, trendId, prevVal) {
                if (el(valId))      el(valId).textContent      = fmtKpi(val);
                var pct = fmtPct(val, meta);
                if (el(pctId))      el(pctId).textContent      = pct + '%';
                if (el(metaTextId)) el(metaTextId).textContent = 'de ' + fmtKpi(meta) + ' meta';
                setTimeout(function() {
                    var fill = el(progId);
                    if (fill) fill.style.width = Math.min(100, pct) + '%';
                }, 50);
                // Trend vs prev month
                var trendEl = el(trendId);
                if (trendEl && prevVal > 0 && val !== prevVal) {
                    var tPct = Math.round((val - prevVal) / prevVal * 100);
                    var up = tPct >= 0;
                    trendEl.innerHTML = '<span style="color:' + (up ? '#16A34A' : '#DC2626') + ';font-weight:700;font-size:0.60rem;">' +
                        (up ? '↑' : '↓') + ' ' + Math.abs(tPct) + '% vs mes ant.</span>';
                } else if (trendEl) {
                    trendEl.innerHTML = '';
                }
            }

            // Usar total real del API (incluye clientes sin match en BD)
            var _apiFactTotal = fN((_clientesPanelData.facturado || {}).total_facturado || '0');
            if (_apiFactTotal > 0) totFact = _apiFactTotal;
            setKpi('ckKpiFact', totFact, metaFact || _ckGlobalMetas.fact, 'ckProgFact', 'ckPctFact', 'ckMetaFact', 'ckTrendFact', prevFact);
            // Cobrado: si hay CSV subido, usar ese total
            if (window._desgloseCobTotal !== undefined && window._desgloseCobTotal > 0) totCob = window._desgloseCobTotal;
            setKpi('ckKpiCob',  totCob,  metaCob  || _ckGlobalMetas.cob,  'ckProgCob',  'ckPctCob',  'ckMetaCob',  'ckTrendCob',  prevCob);
            setKpi('ckKpiOpp',  totOpp,  metaOpp  || _ckGlobalMetas.opp,  'ckProgOpp',  'ckPctOpp',  'ckMetaOpp',  'ckTrendOpp',  prevOpp);

            // Cotizado KPI: show NUMBER of cotizaciones instead of money
            var cotData = _clientesPanelData.cotizado || {};
            var numTotalCot = cotData.num_total_cotizaciones || 0;
            var cotMeta = fN(cotData.meta || '0');
            var cotProg = cotData.progreso || 0;
            if (el('ckKpiCot')) el('ckKpiCot').textContent = numTotalCot + ' cotizaciones';
            if (el('ckPctCot')) el('ckPctCot').textContent = cotProg + '%';
            if (el('ckMetaCot')) {
                var montoRef = cotData.total_monto_cotizado || '0';
                el('ckMetaCot').textContent = 'Monto: $' + montoRef;
            }
            setTimeout(function() {
                var fillCot = el('ckProgCot');
                if (fillCot) fillCot.style.width = Math.min(100, cotProg) + '%';
            }, 50);
            // Trend for cotizado
            var trendCotEl = el('ckTrendCot');
            if (trendCotEl && prevCot > 0 && totCot !== prevCot) {
                var tPctCot = Math.round((totCot - prevCot) / prevCot * 100);
                var upCot = tPctCot >= 0;
                trendCotEl.innerHTML = '<span style="color:' + (upCot ? '#16A34A' : '#DC2626') + ';font-weight:700;font-size:0.60rem;">' +
                    (upCot ? '↑' : '↓') + ' ' + Math.abs(tPctCot) + '% vs mes ant.</span>';
            } else if (trendCotEl) {
                trendCotEl.innerHTML = '';
            }

            // Render opp charts (always, they'll be hidden if mode is prospeccion)
            ckRenderCharts(merged, totFact, totCob, totOpp, totCot, prevFact, prevCob, prevOpp, prevCot);

            if (_clientesPanelData.facturado) {
                updateTopbarFromClientesPanel(_clientesPanelData.facturado);
            }

            // Apply saved mode — this controls which KPIs, charts, and footer are visible
            window._crmSetMode(_crmClientesMode);
        }

        function _renderProspKPIs() {
            var data = _clientesPanelData.prospeccion;
            if (!data) return;

            var el = function(id) { return document.getElementById(id); };

            // KPI 1: Prospecciones
            if (el('ckKpiProspGen')) el('ckKpiProspGen').textContent = data.total_prospectos || 0;
            if (el('ckMetaProspGen')) el('ckMetaProspGen').textContent = 'prospecciones creadas';
            if (el('ckSubProspCamp')) el('ckSubProspCamp').textContent = (data.total_campanas || 0) + ' campañas enviadas';

            // KPI 2: Convertidas
            if (el('ckKpiProspOpps')) el('ckKpiProspOpps').textContent = data.total_ganados || 0;
            if (el('ckMetaProspOpps')) el('ckMetaProspOpps').textContent = (data.total_opps_from_prosp || 0) + ' oportunidades activas';

            // KPI 3: Ventas
            if (el('ckKpiProspVentas')) el('ckKpiProspVentas').textContent = '$' + (data.ventas_generadas || '0');
            if (el('ckMetaProspVentas')) el('ckMetaProspVentas').textContent = 'desde prospecciones';

            // KPI 4: Tasa contacto
            if (el('ckKpiProspTasa')) el('ckKpiProspTasa').textContent = (data.tasa_contacto || 0) + '%';
            if (el('ckMetaProspTasa')) el('ckMetaProspTasa').textContent = (data.total_respondidos || 0) + '/' + (data.total_envios || 0) + ' respondidos';
        }

        var _prospChartInstances = {};
        function _destroyProspChart(id) {
            if (_prospChartInstances[id]) { _prospChartInstances[id].destroy(); delete _prospChartInstances[id]; }
        }

        // Render an "empty state" overlay on a canvas card when there's no data.
        // Hides the canvas and shows a centered message inside the .ck-chart-card.
        function _setProspChartEmpty(canvasId, message) {
            var c = document.getElementById(canvasId);
            if (!c) return;
            var card = c.closest ? c.closest('.ck-chart-card') : null;
            if (!card) return;
            // Limpiar empty-state previo
            var prev = card.querySelector('.ck-empty-state');
            if (prev) prev.remove();
            c.style.display = 'none';
            var div = document.createElement('div');
            div.className = 'ck-empty-state';
            div.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#86868B;font-size:0.78rem;font-weight:500;text-align:center;padding:20px;';
            div.textContent = message || 'Sin datos en el periodo';
            card.appendChild(div);
        }
        function _clearProspChartEmpty(canvasId) {
            var c = document.getElementById(canvasId);
            if (!c) return;
            var card = c.closest ? c.closest('.ck-chart-card') : null;
            if (!card) return;
            var prev = card.querySelector('.ck-empty-state');
            if (prev) prev.remove();
            c.style.display = '';
        }

        function _renderProspCharts() {
            if (typeof Chart === 'undefined') return;
            var data = _clientesPanelData.prospeccion;
            if (!data) return;
            // Use the same shared tooltip from ckRenderCharts
            var sharedTooltip = {
                backgroundColor: 'rgba(255,255,255,0.85)',
                titleColor: '#1D1D1F', bodyColor: '#3C3C43',
                titleFont: { size: 12, weight: '700' }, bodyFont: { size: 11, weight: '500' },
                padding: 12, cornerRadius: 14,
                borderColor: 'rgba(255,255,255,0.6)', borderWidth: 1,
                displayColors: true, boxPadding: 4
            };
            var sharedAnimation = { duration: 1200, easing: 'easeOutQuart', delay: function(ctx) { return ctx.dataIndex * 80; } };

            // ── Chart 1: Prospectos por Marca (vertical bar, blue gradient, names below) ──
            _destroyProspChart('ckChartProspMarca');
            var c1 = document.getElementById('ckChartProspMarca');
            if (c1) {
                var marcas = data.chart_marcas || {};
                var mLabels = Object.keys(marcas).sort(function(a,b){ return marcas[b]-marcas[a]; });
                var mValues = mLabels.map(function(l){ return marcas[l]; });
                if (!mLabels.length) {
                    _setProspChartEmpty('ckChartProspMarca', 'Sin prospectos en el periodo');
                } else {
                    _clearProspChartEmpty('ckChartProspMarca');
                    var c1_2d = c1.getContext('2d');
                    var g1 = c1_2d.createLinearGradient(0, 0, 0, 280);
                    g1.addColorStop(0, 'rgba(0,122,255,0.85)');
                    g1.addColorStop(1, 'rgba(88,176,255,0.55)');
                    _prospChartInstances['ckChartProspMarca'] = new Chart(c1_2d, {
                        type: 'bar',
                        data: { labels: mLabels, datasets: [{ label: 'Prospectos', data: mValues, backgroundColor: g1, borderRadius: 10, barPercentage: 0.5 }] },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            animation: sharedAnimation,
                            plugins: { legend: { display: false }, tooltip: sharedTooltip },
                            scales: {
                                y: { beginAtZero: true, ticks: { stepSize: 1, color: '#86868B', font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false } },
                                x: {
                                    grid: { display: false },
                                    ticks: {
                                        font: { size: 10, weight: '600' },
                                        color: '#1D1D1F',
                                        maxRotation: 0,
                                        minRotation: 0,
                                        autoSkip: false
                                    }
                                }
                            },
                            // Padding inferior amplio para que no se corten las labels.
                            layout: { padding: { bottom: 24, top: 4 } }
                        }
                    });
                }
            }

            // ── Chart 2: Tasa de Contacto (enviados vs respondidos, grouped bar) ──
            _destroyProspChart('ckChartProspFunnel');
            var c2 = document.getElementById('ckChartProspFunnel');
            if (c2) {
                var tEnviados = data.total_envios || 0;
                var tRespondidos = data.total_respondidos || 0;
                var tFavorables = data.total_favorables || 0;
                if (!tEnviados && !tRespondidos && !tFavorables) {
                    _setProspChartEmpty('ckChartProspFunnel', 'Sin campañas enviadas en el periodo');
                } else {
                    _clearProspChartEmpty('ckChartProspFunnel');
                    var c2_2d = c2.getContext('2d');
                    var gEnv = c2_2d.createLinearGradient(0, 0, 0, 280);
                    gEnv.addColorStop(0, 'rgba(0,122,255,0.85)'); gEnv.addColorStop(1, 'rgba(88,176,255,0.55)');
                    var gResp = c2_2d.createLinearGradient(0, 0, 0, 280);
                    gResp.addColorStop(0, 'rgba(52,199,89,0.85)'); gResp.addColorStop(1, 'rgba(52,199,89,0.45)');
                    var gFav = c2_2d.createLinearGradient(0, 0, 0, 280);
                    gFav.addColorStop(0, 'rgba(255,149,0,0.85)'); gFav.addColorStop(1, 'rgba(255,149,0,0.45)');
                    _prospChartInstances['ckChartProspFunnel'] = new Chart(c2_2d, {
                        type: 'bar',
                        data: {
                            labels: ['Enviados', 'Respondidos', 'Favorables'],
                            datasets: [{
                                data: [tEnviados, tRespondidos, tFavorables],
                                backgroundColor: [gEnv, gResp, gFav],
                                borderRadius: 10, barPercentage: 0.45
                            }]
                        },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            animation: sharedAnimation,
                            plugins: {
                                legend: { display: false }, tooltip: sharedTooltip,
                                datalabels: false
                            },
                            scales: {
                                y: { beginAtZero: true, ticks: { stepSize: 1, color: '#86868B', font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false } },
                                x: { grid: { display: false }, ticks: { font: { size: 11, weight: '700' }, color: '#1D1D1F' } }
                            },
                            layout: { padding: { bottom: 12, top: 4 } }
                        }
                    });
                }
            }

            // ── Chart 3: Top Clientes (vertical bar with client names on x-axis) ──
            _destroyProspChart('ckChartProspTopClientes');
            var c3 = document.getElementById('ckChartProspTopClientes');
            if (c3) {
                var pRows = (data.rows||[]).filter(function(r){ return r.num_prospectos>0; }).sort(function(a,b){ return b.num_prospectos-a.num_prospectos; }).slice(0,5);
                if (pRows.length) {
                    _clearProspChartEmpty('ckChartProspTopClientes');
                    var c3_2d = c3.getContext('2d');
                    var g3 = c3_2d.createLinearGradient(0, 0, 0, 280);
                    g3.addColorStop(0, 'rgba(0,122,255,0.85)'); g3.addColorStop(1, 'rgba(88,176,255,0.55)');
                    _prospChartInstances['ckChartProspTopClientes'] = new Chart(c3_2d, {
                        type: 'bar',
                        data: {
                            labels: pRows.map(function(r){ return r.cliente.length > 10 ? r.cliente.substring(0,10) + '..' : r.cliente; }),
                            datasets: [{
                                label: 'Prospectos',
                                data: pRows.map(function(r){ return r.num_prospectos; }),
                                backgroundColor: g3, borderRadius: 10, barPercentage: 0.5
                            }]
                        },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            animation: sharedAnimation,
                            plugins: {
                                legend: { display: false }, tooltip: sharedTooltip,
                                datalabels: false
                            },
                            scales: {
                                y: { beginAtZero: true, ticks: { stepSize: 1, color: '#86868B', font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false } },
                                x: { grid: { display: false }, ticks: { font: { size: 10, weight: '600' }, color: '#1D1D1F', maxRotation: 0, minRotation: 0, autoSkip: false } }
                            },
                            layout: { padding: { bottom: 24, top: 4 } }
                        }
                    });
                } else {
                    _setProspChartEmpty('ckChartProspTopClientes', 'Sin clientes con prospectos en el periodo');
                }
            }

            // ── Chart 4: Tasa de Conversión (doughnut centered, multicolor) ──
            _destroyProspChart('ckChartProspConversion');
            var c4 = document.getElementById('ckChartProspConversion');
            if (c4) {
                var totalP = data.total_prospectos||0;
                var ganados = data.total_ganados||0;
                var perdidos = 0;
                var et = data.chart_etapas||{};
                if (et.cerrado_perdido) perdidos = et.cerrado_perdido;
                var activos = Math.max(0, totalP - ganados - perdidos);
                var pct = totalP>0 ? Math.round(ganados/totalP*100) : 0;
                if (totalP === 0) {
                    _setProspChartEmpty('ckChartProspConversion', 'Sin prospectos en el periodo');
                    return; // último chart de la función — early-out OK
                }
                _clearProspChartEmpty('ckChartProspConversion');
                var centerPlugin = {
                    id: 'prospCenter',
                    afterDraw: function(chart) {
                        if (chart.canvas.id !== 'ckChartProspConversion') return;
                        var cx = chart.ctx, w = chart.width, h = chart.chartArea ? (chart.chartArea.top + chart.chartArea.bottom)/2 : h/2;
                        cx.save();
                        cx.font = '700 32px -apple-system, BlinkMacSystemFont, sans-serif';
                        cx.fillStyle = '#1D1D1F'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
                        cx.fillText(pct + '%', w/2, h);
                        cx.font = '500 12px -apple-system, BlinkMacSystemFont, sans-serif';
                        cx.fillStyle = '#86868B';
                        cx.fillText('conversión', w/2, h + 22);
                        cx.restore();
                    }
                };
                _prospChartInstances['ckChartProspConversion'] = new Chart(c4, {
                    type: 'doughnut',
                    plugins: [centerPlugin],
                    data: {
                        labels: ['Convertidos', 'Activos', 'Perdidos'],
                        datasets: [{
                            data: [ganados, activos > 0 ? activos : (totalP === 0 ? 1 : 0), perdidos],
                            backgroundColor: ['rgba(52,199,89,0.85)', 'rgba(0,122,255,0.7)', 'rgba(255,59,48,0.6)'],
                            borderWidth: 0, spacing: 3
                        }]
                    },
                    options: {
                        cutout: '68%', responsive: true, maintainAspectRatio: false,
                        animation: { duration: 1200, easing: 'easeOutQuart', animateRotate: true },
                        plugins: {
                            legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 16, usePointStyle: true, font: { size: 11, weight: '600' }, color: '#3C3C43' } },
                            tooltip: sharedTooltip
                        },
                        layout: { padding: { bottom: 5 } },
                        onClick: function(evt, elements) {
                            // Click en el slice "Convertidos" (idx 0) o en el centro abre detalle.
                            if (elements && elements.length) {
                                var idx = elements[0].index;
                                if (idx !== 0) return; // solo "Convertidos"
                            }
                            if (typeof window.ckAbrirDetalle === 'function') {
                                window.ckAbrirDetalle('prosp_convertidos');
                            }
                        }
                    }
                });
                // Hover cursor pointer encima del chart
                c4.style.cursor = 'pointer';
            }
        } // end _renderProspCharts

        // ═══════════════════════════════════════════════════════════════
        //   DASHBOARD DE PROYECTOS (3ra tab del dashboard)
        //   - Fetch a /app/api/iamet/proyectos/dashboard/ y /app/api/iamet/proyectos/
        //   - Render KPIs, gráfica de distribución por estado y lista de riesgo
        // ═══════════════════════════════════════════════════════════════

        var _proyectosDashState = { kpis: null, lista: null, loading: false, lastKey: null };
        var _proyectosChartInstance = null;

        function _proyFmtMoney(n) {
            n = Number(n) || 0;
            if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
            if (Math.abs(n) >= 1000)    return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
            return '$' + Math.round(n).toLocaleString('en-US');
        }
        function _proyFmtMoneyFull(n) {
            return '$' + (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
        }
        function _proyEsc(s) {
            if (s == null) return '';
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        // Carga datos del dashboard de proyectos (KPIs + lista) y renderiza.
        // Usa cache por (mes, anio) para no refetch si nada cambió.
        function _loadProyectosDashboard() {
            var mes = currentMes || '';
            var anio = currentAnio || '';
            var key = mes + '|' + anio;
            // Si ya tenemos data fresca para este periodo, solo re-render
            if (_proyectosDashState.lastKey === key && _proyectosDashState.kpis && _proyectosDashState.lista) {
                _renderProyectosKPIs();
                _renderProyectosCharts();
                _renderProyectosRiesgo();
                return;
            }
            if (_proyectosDashState.loading) return;
            _proyectosDashState.loading = true;
            _proyectosDashState.lastKey = key;

            var qs = '?mes=' + encodeURIComponent(mes) + '&anio=' + encodeURIComponent(anio);

            // Mostrar estado "Cargando..." en la lista de riesgo
            var listEl = document.getElementById('ckProyRiesgoList');
            if (listEl && !listEl.querySelector('.crm-dash-proyectos-riesgo-row')) {
                listEl.innerHTML = '<div class="crm-dash-proyectos-riesgo-empty">Cargando…</div>';
            }

            var pKpis = fetch('/app/api/iamet/proyectos/dashboard/' + qs, { credentials: 'same-origin' })
                .then(function(r){ return r.json(); })
                .then(function(resp){
                    if (resp && resp.success) _proyectosDashState.kpis = resp.data || {};
                    else _proyectosDashState.kpis = {};
                })
                .catch(function(){ _proyectosDashState.kpis = {}; });

            // La lista no soporta filtro mes/anio nativo en el endpoint;
            // traemos todos y filtramos en cliente si hace falta.
            var pLista = fetch('/app/api/iamet/proyectos/', { credentials: 'same-origin' })
                .then(function(r){ return r.json(); })
                .then(function(resp){
                    var arr = (resp && (resp.ok || resp.success)) ? (resp.data || []) : [];
                    // Filtrar cliente-side por mes/anio sobre created_at si tenemos esos filtros
                    if (anio && anio !== 'todos') {
                        arr = arr.filter(function(p){
                            if (!p.created_at) return false;
                            var d = new Date(p.created_at);
                            if (isNaN(d.getTime())) return false;
                            if (String(d.getFullYear()) !== String(anio)) return false;
                            if (mes && mes !== 'todos') {
                                var mm = String(d.getMonth() + 1).padStart(2, '0');
                                if (mm !== String(mes).padStart(2, '0')) return false;
                            }
                            return true;
                        });
                    }
                    _proyectosDashState.lista = arr;
                })
                .catch(function(){ _proyectosDashState.lista = []; });

            Promise.all([pKpis, pLista]).then(function(){
                _proyectosDashState.loading = false;
                // Solo renderizar si seguimos en modo proyectos
                if (_crmClientesMode !== 'proyectos') return;
                _renderProyectosKPIs();
                _renderProyectosCharts();
                _renderProyectosRiesgo();
                // Refrescar footer
                var footerLeft = document.getElementById('footerLeft');
                var footerRight = document.getElementById('footerRight');
                var k = _proyectosDashState.kpis || {};
                if (footerLeft) footerLeft.textContent = (k.total_proyectos || 0) + ' proyectos / ' + (k.proyectos_ejecucion || 0) + ' activos';
                if (footerRight) footerRight.textContent = 'Venta total: ' + _proyFmtMoneyFull(k.venta_total || 0);
            });
        }
        // Exponer para refrescos externos (ej. cambio de período)
        window._loadProyectosDashboard = _loadProyectosDashboard;

        function _renderProyectosKPIs() {
            var k = _proyectosDashState.kpis || {};
            var lista = _proyectosDashState.lista || [];

            // KPI 1: Activos / Total
            var activos = Number(k.proyectos_ejecucion || 0);
            var total = Number(k.total_proyectos || 0);
            var pctAct = total > 0 ? Math.round(activos / total * 100) : 0;
            var elActiv = document.getElementById('ckKpiProyActivos');
            if (elActiv) elActiv.textContent = activos + ' / ' + total;
            var metaAct = document.getElementById('ckMetaProyActivos');
            if (metaAct) metaAct.textContent = 'en ejecución del portafolio';
            setTimeout(function(){
                var fill = document.getElementById('ckProgProyActivos');
                if (fill) fill.style.width = Math.min(100, pctAct) + '%';
            }, 50);
            var trAct = document.getElementById('ckTrendProyActivos');
            if (trAct) {
                var prog = Number(k.proyectos_programados || 0);
                var compl = Number(k.proyectos_completados || 0);
                trAct.innerHTML = '<span style="color:#9CA3AF;font-weight:600;">' + prog + ' programados · ' + compl + ' completados</span>';
            }

            // KPI 2: Presupuesto (venta_total) y costo ejecutado
            var ventaTot = Number(k.venta_total || 0);
            var costoTot = Number(k.costo_total || 0);
            var pctEjec = ventaTot > 0 ? Math.round(costoTot / ventaTot * 100) : 0;
            var elBud = document.getElementById('ckKpiProyBudget');
            if (elBud) elBud.textContent = _proyFmtMoney(ventaTot);
            var metaBud = document.getElementById('ckMetaProyBudget');
            if (metaBud) metaBud.textContent = 'costo: ' + _proyFmtMoney(costoTot) + ' (' + pctEjec + '%)';
            setTimeout(function(){
                var fill2 = document.getElementById('ckProgProyBudget');
                if (fill2) fill2.style.width = Math.min(100, pctEjec) + '%';
            }, 50);
            var trBud = document.getElementById('ckTrendProyBudget');
            if (trBud) trBud.innerHTML = '';

            // KPI 3: Avance promedio (calculado de la lista usando levantamiento_fase_max/5)
            var avgPct = 0;
            if (lista.length) {
                var sum = 0, n = 0;
                lista.forEach(function(p){
                    if (p.status === 'completed') { sum += 100; n++; return; }
                    var fase = Number(p.levantamiento_fase_max || 0);
                    sum += Math.max(0, Math.min(100, Math.round(fase / 5 * 100)));
                    n++;
                });
                avgPct = n > 0 ? Math.round(sum / n) : 0;
            }
            var elAvg = document.getElementById('ckKpiProyAvance');
            if (elAvg) elAvg.textContent = avgPct + '%';
            var metaAvg = document.getElementById('ckMetaProyAvance');
            if (metaAvg) metaAvg.textContent = 'avance promedio del portafolio';
            setTimeout(function(){
                var fill3 = document.getElementById('ckProgProyAvance');
                if (fill3) fill3.style.width = Math.min(100, avgPct) + '%';
            }, 50);

            // KPI 4: Margen / utilidad esperada
            var util = Number(k.utilidad_total || 0);
            var margenPct = ventaTot > 0 ? Math.round(util / ventaTot * 100) : 0;
            var elMar = document.getElementById('ckKpiProyMargen');
            if (elMar) elMar.textContent = _proyFmtMoney(util);
            var metaMar = document.getElementById('ckMetaProyMargen');
            if (metaMar) metaMar.textContent = (margenPct > 0 ? margenPct + '% margen sobre venta' : 'utilidad presupuestada');
            setTimeout(function(){
                var fill4 = document.getElementById('ckProgProyMargen');
                if (fill4) fill4.style.width = Math.max(0, Math.min(100, margenPct)) + '%';
            }, 50);
        }

        function _renderProyectosCharts() {
            if (typeof Chart === 'undefined') return;
            var lista = _proyectosDashState.lista || [];
            // Contar por status
            var counts = { planning: 0, active: 0, completed: 0, paused: 0 };
            lista.forEach(function(p){
                var s = p.status || 'planning';
                if (counts[s] === undefined) counts.planning++;
                else counts[s]++;
            });
            var labels = ['Planificación', 'En progreso', 'Completados', 'Pausados'];
            var values = [counts.planning, counts.active, counts.completed, counts.paused];
            var colors = ['#A855F7', '#2563EB', '#16A34A', '#9CA3AF'];
            var totalCount = values.reduce(function(a,b){ return a+b; }, 0);

            var canvas = document.getElementById('ckChartProyEstados');
            if (!canvas) return;

            // Destroy previous instance
            if (_proyectosChartInstance) {
                try { _proyectosChartInstance.destroy(); } catch(e) {}
                _proyectosChartInstance = null;
            }

            // Empty state
            var card = canvas.closest ? canvas.closest('.ck-chart-card') : null;
            var emptyDiv = card ? card.querySelector('.ck-empty-state') : null;
            if (totalCount === 0) {
                canvas.style.display = 'none';
                if (card && !emptyDiv) {
                    var div = document.createElement('div');
                    div.className = 'ck-empty-state';
                    div.style.cssText = 'display:flex;align-items:center;justify-content:center;height:200px;color:#86868B;font-size:0.78rem;font-weight:500;text-align:center;padding:20px;';
                    div.textContent = 'Sin proyectos en el periodo';
                    var wrap = card.querySelector('.crm-dash-proyectos-chart-wrap');
                    if (wrap) wrap.appendChild(div); else card.appendChild(div);
                }
                var leg = document.getElementById('ckChartProyEstadosLegend');
                if (leg) leg.innerHTML = '';
                return;
            } else {
                canvas.style.display = '';
                if (emptyDiv) emptyDiv.remove();
            }

            var centerPlugin = {
                id: 'centerTextProy',
                afterDraw: function(chart) {
                    var cx = chart.ctx;
                    var w = chart.width, h = chart.height / 2 + 8;
                    cx.save();
                    cx.font = '700 24px -apple-system, BlinkMacSystemFont, sans-serif';
                    cx.fillStyle = '#1D1D1F'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
                    cx.fillText(String(totalCount), w/2, h - 6);
                    cx.font = '500 10px -apple-system, BlinkMacSystemFont, sans-serif';
                    cx.fillStyle = '#86868B';
                    cx.fillText('proyectos', w/2, h + 14);
                    cx.restore();
                }
            };

            _proyectosChartInstance = new Chart(canvas, {
                type: 'doughnut',
                plugins: [centerPlugin],
                data: {
                    labels: labels,
                    datasets: [{
                        data: values,
                        backgroundColor: colors,
                        borderWidth: 0,
                        spacing: 2
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    cutout: '68%',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(255,255,255,0.95)',
                            titleColor: '#1D1D1F', bodyColor: '#3C3C43',
                            titleFont: { size: 12, weight: '700' }, bodyFont: { size: 11, weight: '500' },
                            padding: 12, cornerRadius: 12,
                            borderColor: 'rgba(0,0,0,0.08)', borderWidth: 1,
                            displayColors: true, boxPadding: 4
                        }
                    },
                    animation: { duration: 900, easing: 'easeOutQuart' }
                }
            });

            // Render legend custom debajo
            var legend = document.getElementById('ckChartProyEstadosLegend');
            if (legend) {
                var html = '';
                for (var i = 0; i < labels.length; i++) {
                    var pct = totalCount > 0 ? Math.round(values[i] / totalCount * 100) : 0;
                    html += '<div class="crm-dash-proyectos-legend-item">' +
                        '<span class="crm-dash-proyectos-legend-dot" style="background:' + colors[i] + ';"></span>' +
                        '<span class="crm-dash-proyectos-legend-label">' + labels[i] + '</span>' +
                        '<span class="crm-dash-proyectos-legend-val">' + values[i] + ' <span style="color:#9CA3AF;font-weight:500;">(' + pct + '%)</span></span>' +
                    '</div>';
                }
                legend.innerHTML = html;
            }
        }

        function _renderProyectosRiesgo() {
            var listEl = document.getElementById('ckProyRiesgoList');
            var countEl = document.getElementById('ckProyRiesgoCount');
            if (!listEl) return;

            var lista = _proyectosDashState.lista || [];
            // Solo proyectos no completados
            var candidatos = lista.filter(function(p){ return p.status !== 'completed'; });

            // Hoy (sin hora)
            var today = new Date(); today.setHours(0,0,0,0);

            // Score de riesgo: combinación de overrun (no tenemos costos por proyecto en lista)
            // y atraso por fecha. Usamos:
            //   - atrasado: fecha_fin < hoy && progreso < 100  → fuerte señal
            //   - cerca de vencer: fecha_fin a 14 días && progreso < 70%
            //   - status pausado
            var scored = candidatos.map(function(p){
                var fase = Number(p.levantamiento_fase_max || 0);
                var prog = Math.max(0, Math.min(100, Math.round(fase / 5 * 100)));
                var endStr = p.fecha_fin || '';
                var endD = endStr ? new Date(endStr) : null;
                if (endD && isNaN(endD.getTime())) endD = null;
                if (endD) endD.setHours(0,0,0,0);

                var diasAlFin = endD ? Math.round((endD - today) / 86400000) : null;
                var atrasado = (endD && diasAlFin < 0 && prog < 100);
                var pausado = (p.status === 'paused');
                var inminente = (endD && diasAlFin !== null && diasAlFin >= 0 && diasAlFin <= 14 && prog < 70);

                // Score: a mayor número, mayor riesgo
                var score = 0;
                if (atrasado) score += 100 + Math.min(60, Math.abs(diasAlFin)) + (100 - prog);
                if (inminente) score += 60 + (70 - prog) + (15 - diasAlFin);
                if (pausado) score += 40;
                // Si el proyecto tiene alertas pendientes, sube prioridad
                if (p.alertas_pendientes) score += Number(p.alertas_pendientes) * 10;

                var motivo = '';
                var motivoClass = 'crm-dash-proyectos-riesgo-tag--info';
                if (atrasado) {
                    motivo = Math.abs(diasAlFin) + 'd atrasado';
                    motivoClass = 'crm-dash-proyectos-riesgo-tag--danger';
                } else if (inminente) {
                    motivo = 'Vence en ' + diasAlFin + 'd';
                    motivoClass = 'crm-dash-proyectos-riesgo-tag--warn';
                } else if (pausado) {
                    motivo = 'Pausado';
                    motivoClass = 'crm-dash-proyectos-riesgo-tag--warn';
                } else if (p.alertas_pendientes) {
                    motivo = p.alertas_pendientes + ' alertas';
                    motivoClass = 'crm-dash-proyectos-riesgo-tag--warn';
                }

                return { p: p, prog: prog, score: score, motivo: motivo, motivoClass: motivoClass };
            }).filter(function(x){ return x.score > 0; });

            scored.sort(function(a, b){ return b.score - a.score; });
            var top = scored.slice(0, 5);
            if (countEl) countEl.textContent = scored.length;

            if (!top.length) {
                listEl.innerHTML = '<div class="crm-dash-proyectos-riesgo-empty">Sin proyectos en riesgo &mdash; el portafolio está al día</div>';
                return;
            }

            var html = '';
            top.forEach(function(item){
                var p = item.p;
                var nombre = _proyEsc(p.nombre || 'Sin nombre');
                var cliente = _proyEsc(p.cliente_nombre || '— sin cliente —');
                var prog = item.prog;
                html += '<div class="crm-dash-proyectos-riesgo-row" data-proyecto-id="' + p.id + '" role="button" tabindex="0">' +
                    '<div class="crm-dash-proyectos-riesgo-main">' +
                        '<div class="crm-dash-proyectos-riesgo-name">' + nombre + '</div>' +
                        '<div class="crm-dash-proyectos-riesgo-client">' + cliente + '</div>' +
                    '</div>' +
                    '<div class="crm-dash-proyectos-riesgo-progress">' +
                        '<div class="crm-dash-proyectos-riesgo-progress-track"><div class="crm-dash-proyectos-riesgo-progress-fill" style="width:' + prog + '%"></div></div>' +
                        '<span class="crm-dash-proyectos-riesgo-progress-pct">' + prog + '%</span>' +
                    '</div>' +
                    '<div class="crm-dash-proyectos-riesgo-tagwrap">' +
                        '<span class="crm-dash-proyectos-riesgo-tag ' + item.motivoClass + '">' + _proyEsc(item.motivo || 'Riesgo') + '</span>' +
                    '</div>' +
                '</div>';
            });
            listEl.innerHTML = html;

            // Click handlers (delegación simple)
            var rows = listEl.querySelectorAll('.crm-dash-proyectos-riesgo-row');
            rows.forEach(function(row){
                var goDetalle = function(){
                    var pid = parseInt(row.getAttribute('data-proyecto-id'), 10);
                    if (!pid) return;
                    // Navegar a vista proyectos primero (para que se monte el módulo)
                    if (typeof switchCrmView === 'function') {
                        switchCrmView('proyectos');
                        if (typeof window.proyectosInit === 'function') {
                            try { window.proyectosInit(); } catch(e){}
                        }
                    }
                    // Luego abrir el detalle del proyecto
                    setTimeout(function(){
                        if (typeof window.proyectosVerDetalle === 'function') {
                            window.proyectosVerDetalle(pid);
                        }
                    }, 50);
                };
                row.addEventListener('click', goDetalle);
                row.addEventListener('keydown', function(e){
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goDetalle(); }
                });
            });
        }

        // Dead code removed — all chart logic is above
        if (false) { // placeholder to keep indentation consistent
            var appleColors = [
                { solid: '#007AFF', light: 'rgba(0,122,255,0.15)' },
                { solid: '#5856D6', light: 'rgba(88,86,214,0.15)' },
                { solid: '#34C759', light: 'rgba(52,199,89,0.15)' },
                { solid: '#FF9500', light: 'rgba(255,149,0,0.15)' },
                { solid: '#FF3B30', light: 'rgba(255,59,48,0.15)' },
                { solid: '#AF52DE', light: 'rgba(175,82,222,0.15)' },
                { solid: '#FF2D55', light: 'rgba(255,45,85,0.15)' },
                { solid: '#5AC8FA', light: 'rgba(90,200,250,0.15)' },
                { solid: '#FFCC00', light: 'rgba(255,204,0,0.15)' },
                { solid: '#8E8E93', light: 'rgba(142,142,147,0.15)' }
            ];

            // Shared config
            var sharedTooltip = {
                backgroundColor: 'rgba(255,255,255,0.95)',
                titleColor: '#1D1D1F',
                bodyColor: '#3C3C43',
                titleFont: { size: 12, weight: '700', family: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif' },
                bodyFont: { size: 11, weight: '500', family: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif' },
                padding: 12,
                cornerRadius: 12,
                borderColor: 'rgba(0,0,0,0.06)',
                borderWidth: 1,
                displayColors: true,
                boxPadding: 4,
                boxWidth: 8,
                boxHeight: 8,
                usePointStyle: true,
                caretSize: 0
            };

            var sharedAnimation = {
                duration: 1000,
                easing: 'easeOutQuart',
                delay: function(ctx) { return ctx.dataIndex * 60; }
            };

            Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
            Chart.defaults.font.size = 11;

            // ── Chart 1: Prospectos por Marca (horizontal bar — same style as Facturado vs Meta) ──
            _destroyProspChart('ckChartProspMarca');
            var ctx1 = document.getElementById('ckChartProspMarca');
            if (ctx1) {
                var marcas = data.chart_marcas || {};
                var labels = Object.keys(marcas).sort(function(a,b) { return marcas[b] - marcas[a]; });
                var values = labels.map(function(l) { return marcas[l]; });
                var ctx1_2d = ctx1.getContext('2d');
                var gradBlue1 = ctx1_2d.createLinearGradient(0, 0, ctx1.width, 0);
                gradBlue1.addColorStop(0, 'rgba(0,122,255,0.9)');
                gradBlue1.addColorStop(1, 'rgba(88,176,255,0.75)');

                _prospChartInstances['ckChartProspMarca'] = new Chart(ctx1_2d, {
                    type: 'bar',
                    data: { labels: labels, datasets: [{ label: 'Prospectos', data: values, backgroundColor: gradBlue1, borderRadius: 8, barPercentage: 0.55 }] },
                    options: {
                        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                        animation: sharedAnimation,
                        plugins: { legend: { display: false }, tooltip: sharedTooltip },
                        scales: {
                            x: { display: false, grid: { display: false } },
                            y: { grid: { display: false }, ticks: { font: { size: 11, weight: '600' }, color: '#3C3C43' } }
                        }
                    }
                });
            }

            // ── Chart 2: Pipeline / Funnel (vertical bar — same style as Top Clientes) ──
            _destroyProspChart('ckChartProspFunnel');
            var ctx2 = document.getElementById('ckChartProspFunnel');
            if (ctx2) {
                var etapas = data.chart_etapas || {};
                var etapaOrder = ['identificado','calificado','reunion','en_progreso','procesado','cerrado_ganado','cerrado_perdido'];
                var etapaLabels = { identificado:'Identificado', calificado:'Calificado', reunion:'Reunión', en_progreso:'En Progreso', procesado:'Procesado', cerrado_ganado:'Ganado', cerrado_perdido:'Perdido' };
                var eLabels = etapaOrder.filter(function(e) { return (etapas[e] || 0) > 0; });
                var eValues = eLabels.map(function(e) { return etapas[e] || 0; });
                var ctx2_2d = ctx2.getContext('2d');
                var gradBar2 = ctx2_2d.createLinearGradient(0, 0, 0, 280);
                gradBar2.addColorStop(0, 'rgba(0,122,255,0.85)');
                gradBar2.addColorStop(1, 'rgba(88,176,255,0.55)');

                _prospChartInstances['ckChartProspFunnel'] = new Chart(ctx2_2d, {
                    type: 'bar',
                    data: { labels: eLabels.map(function(e) { return etapaLabels[e] || e; }), datasets: [{ label: 'Prospectos', data: eValues, backgroundColor: gradBar2, borderRadius: 10, barPercentage: 0.5 }] },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        animation: sharedAnimation,
                        plugins: { legend: { display: false }, tooltip: sharedTooltip },
                        scales: {
                            y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 }, color: '#86868B' }, grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false } },
                            x: { grid: { display: false }, ticks: { font: { size: 10, weight: '600' }, color: '#3C3C43' } }
                        }
                    }
                });
            }

            // ── Chart 3: Top Clientes (vertical bar — matches Top 5 Clientes style) ──
            _destroyProspChart('ckChartProspTopClientes');
            var ctx3 = document.getElementById('ckChartProspTopClientes');
            if (ctx3) {
                var rows = (data.rows || []).filter(function(r) { return r.num_prospectos > 0; }).sort(function(a,b) { return b.num_prospectos - a.num_prospectos; }).slice(0, 8);
                if (rows.length) {
                    var ctx3_2d = ctx3.getContext('2d');
                    var gradBar3 = ctx3_2d.createLinearGradient(0, 0, 0, 280);
                    gradBar3.addColorStop(0, 'rgba(0,122,255,0.85)');
                    gradBar3.addColorStop(1, 'rgba(88,176,255,0.55)');

                    _prospChartInstances['ckChartProspTopClientes'] = new Chart(ctx3, {
                        type: 'bar',
                        data: {
                            labels: rows.map(function(r) { return r.cliente.length > 15 ? r.cliente.substring(0,15) + '...' : r.cliente; }),
                            datasets: [{
                                label: 'Prospectos',
                                data: rows.map(function(r) { return r.num_prospectos; }),
                                backgroundColor: gradBar3,
                                borderRadius: 10,
                                barPercentage: 0.5
                            }]
                        },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            animation: sharedAnimation,
                            plugins: {
                                legend: { display: false },
                                tooltip: sharedTooltip,
                                datalabels: false
                            },
                            scales: {
                                y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 }, color: '#86868B' }, grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false } },
                                x: { grid: { display: false }, ticks: { font: { size: 10, weight: '600' }, color: '#3C3C43' } }
                            }
                        }
                    });
                }
            }

            // ── Chart 4: Tasa de Conversión (doughnut with center text) ──
            _destroyProspChart('ckChartProspConversion');
            var ctx4 = document.getElementById('ckChartProspConversion');
            if (ctx4) {
                var totalP = data.total_prospectos || 0;
                var ganados = data.total_ganados || 0;
                var activos = Math.max(0, totalP - ganados);
                var pct = totalP > 0 ? Math.round(ganados / totalP * 100) : 0;

                var centerTextPlugin = {
                    id: 'prospCenterText',
                    afterDraw: function(chart) {
                        if (chart.canvas.id !== 'ckChartProspConversion') return;
                        var ctx = chart.ctx;
                        var w = chart.width, h = chart.height;
                        ctx.save();
                        ctx.font = '700 28px -apple-system, BlinkMacSystemFont, sans-serif';
                        ctx.fillStyle = '#1D1D1F';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(pct + '%', w / 2, h / 2 - 6);
                        ctx.font = '500 11px -apple-system, BlinkMacSystemFont, sans-serif';
                        ctx.fillStyle = '#86868B';
                        ctx.fillText('conversi\u00f3n', w / 2, h / 2 + 16);
                        ctx.restore();
                    }
                };

                _prospChartInstances['ckChartProspConversion'] = new Chart(ctx4, {
                    type: 'doughnut',
                    plugins: [centerTextPlugin],
                    data: {
                        labels: ['Convertidos', 'En progreso'],
                        datasets: [{
                            data: [ganados, activos > 0 ? activos : (ganados === 0 ? 1 : 0)],
                            backgroundColor: [
                                'rgba(0,122,255,0.85)',
                                'rgba(200,200,210,0.3)'
                            ],
                            borderWidth: 0,
                            spacing: 2
                        }]
                    },
                    options: {
                        cutout: '72%',
                        animation: { duration: 1200, easing: 'easeOutQuart', animateRotate: true },
                        plugins: {
                            legend: {
                                position: 'bottom',
                                labels: {
                                    boxWidth: 8, boxHeight: 8, padding: 14, usePointStyle: true,
                                    font: { size: 11, weight: '600' }, color: '#3C3C43'
                                }
                            },
                            tooltip: sharedTooltip
                        }
                    }
                });
            }
        }

        function loadClientesPanel(vista) {
            var vendedores = getVendedoresParam();
            var url = '/app/api/crm-table-data/?tab=clientes&mes=' + currentMes + '&anio=' + currentAnio + '&vista=' + vista;
            if (vendedores) url += '&vendedores=' + vendedores;
            fetch(url)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    _clientesPanelData[vista] = data;
                    _clientesCombinedLoading--;
                    if (_clientesCombinedLoading <= 0) renderClientesCombinedTable();
                })
                .catch(function (err) {
                    console.error('Error loading clientes ' + vista, err);
                    _clientesCombinedLoading--;
                    if (_clientesCombinedLoading <= 0) renderClientesCombinedTable();
                });
        }

        function loadAllClientesPanels() {
            _clientesCombinedLoading = _CLIENTES_VISTAS.length;
            _CLIENTES_VISTAS.forEach(function (v) { loadClientesPanel(v); });
            // Invalidar cache del dashboard de proyectos para forzar refetch en
            // el próximo render (refreshes periódicos, cambios de período, etc.).
            if (typeof _proyectosDashState !== 'undefined') _proyectosDashState.lastKey = null;
            // Cargar total real de facturación del Excel para el KPI
            var params = new URLSearchParams(window.location.search);
            var _m = params.get('mes') || currentMes;
            var _a = params.get('anio') || currentAnio;
            var _v = params.get('vendedores') || '';
            var _vq = _v ? '&vendedores=' + encodeURIComponent(_v) : '';
            fetch('/app/api/desglose-facturacion/?mes=' + _m + '&anio=' + _a + _vq, { credentials: 'same-origin' })
                .then(function (r) { return r.json(); })
                .then(function (resp) {
                    if (resp.ok && resp.total !== undefined) {
                        _desgloseFactTotal = resp.total;
                        var fa = document.getElementById('facturadoAmount');
                        if (fa) fa.textContent = '$' + Number(resp.total).toLocaleString('en-US', { maximumFractionDigits: 0 });
                    }
                })
                .catch(function () {});
            // También cargar total de cobrado del CSV
            fetch('/app/api/desglose-cobrado/?mes=' + _m + '&anio=' + _a + _vq, { credentials: 'same-origin' })
                .then(function (r) { return r.json(); })
                .then(function (resp) {
                    if (resp.ok && resp.total !== undefined) {
                        window._desgloseCobTotal = resp.total;
                    }
                })
                .catch(function () {});
        }

        window.ckAbrirDesgloseFacturacion = function () {
            // Use inline detail section (same as other KPIs)
            window._ckDetalleOpen = true;
            window._ckDetalleTipo = 'fact_desglose';
            var charts = document.getElementById('ckChartsSection');
            var detalle = document.getElementById('ckDetalleSection');
            if (charts) { charts.style.opacity = '0'; charts.style.transition = 'opacity 0.2s'; setTimeout(function(){ charts.style.display = 'none'; }, 200); }

            var titulo = document.getElementById('ckDetalleTitulo');
            var head = document.getElementById('ckDetalleHead');
            var tbody = document.getElementById('ckDetalleTbody');
            if (titulo) titulo.textContent = 'Desglose de Facturacion';
            if (head) head.innerHTML = '<th>#</th><th>Cliente</th><th>RFC</th><th style="text-align:right">Monto Facturado</th>';
            if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#8e8e93;">Cargando...</td></tr>';
            if (detalle) { detalle.style.display = 'block'; detalle.style.opacity = '0'; detalle.style.transition = 'opacity 0.2s'; setTimeout(function(){ detalle.style.opacity = '1'; }, 50); }

            var params = new URLSearchParams(window.location.search);
            var mes = params.get('mes') || 'todos';
            var anio = params.get('anio') || new Date().getFullYear();
            var vendedores = params.get('vendedores') || '';
            var _vq = vendedores ? '&vendedores=' + encodeURIComponent(vendedores) : '';
            fetch('/app/api/desglose-facturacion/?mes=' + mes + '&anio=' + anio + _vq, { credentials: 'same-origin' })
                .then(function (r) { return r.json(); })
                .then(function (resp) {
                    if (!resp.ok) { if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#FF3B30;">' + (resp.error || 'Error') + '</td></tr>'; return; }
                    if (!resp.rows || resp.rows.length === 0) { if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#8e8e93;">No hay datos</td></tr>'; return; }
                    var html = '';
                    resp.rows.forEach(function (r, i) {
                        html += '<tr><td style="color:#8e8e93;font-size:0.75rem;">' + (i + 1) + '</td>' +
                            '<td style="font-weight:600;">' + (r.nombre || r.cliente || '—') + '</td>' +
                            '<td style="color:#8e8e93;font-size:0.8rem;">' + (r.rfc || '—') + '</td>' +
                            '<td style="text-align:right;font-weight:700;color:#059669;">$' + Number(r.monto || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) + '</td></tr>';
                    });
                    html += '<tr style="background:#F5F5F7;font-weight:700;"><td colspan="3" style="text-align:right;padding:10px 14px;">Total</td><td style="text-align:right;padding:10px 14px;color:#059669;">$' + Number(resp.total || 0).toLocaleString('en-US', {maximumFractionDigits:0}) + '</td></tr>';
                    if (tbody) tbody.innerHTML = html;
                })
                .catch(function () { if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#FF3B30;">Error de conexion</td></tr>'; });
        };

        window.ckSubirExcelFacturacion = function (input) {
            if (!input.files || !input.files[0]) return;
            var file = input.files[0];
            var formData = new FormData();
            formData.append('archivo', file);
            var csrfToken = document.querySelector('[name=csrfmiddlewaretoken]');
            fetch('/app/api/subir-facturacion/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrfToken ? csrfToken.value : '' },
                body: formData,
                credentials: 'same-origin'
            }).then(function (r) { return r.json(); })
            .then(function (resp) {
                if (resp.success) {
                    showToast('Facturacion importada: ' + (resp.num_clientes || 0) + ' clientes, meses: ' + (resp.meses || []).join(', '), 'success');
                    if (typeof refreshCrmTable === 'function') refreshCrmTable();
                } else {
                    showToast(resp.error || 'Error al importar', 'error');
                }
            }).catch(function () { showToast('Error de conexion', 'error'); });
            input.value = '';
        };

        window.ckSubirCsvCobrado = function (input) {
            if (!input.files || !input.files[0]) return;
            var file = input.files[0];
            var formData = new FormData();
            formData.append('archivo', file);
            var csrfToken = document.querySelector('[name=csrfmiddlewaretoken]');
            fetch('/app/api/subir-cobrado/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrfToken ? csrfToken.value : '' },
                body: formData,
                credentials: 'same-origin'
            }).then(function (r) { return r.json(); })
            .then(function (resp) {
                if (resp.success) {
                    showToast('Cobrado importado: ' + (resp.num_clientes || 0) + ' clientes, meses: ' + (resp.meses || []).join(', '), 'success');
                    if (typeof refreshCrmTable === 'function') refreshCrmTable();
                } else {
                    showToast(resp.error || 'Error al importar', 'error');
                }
            }).catch(function () { showToast('Error de conexion', 'error'); });
            input.value = '';
        };

        window.ckAbrirDesgloseCobrado = function () {
            window._ckDetalleOpen = true;
            window._ckDetalleTipo = 'cob_desglose';
            var charts = document.getElementById('ckChartsSection');
            var detalle = document.getElementById('ckDetalleSection');
            if (charts) { charts.style.opacity = '0'; charts.style.transition = 'opacity 0.2s'; setTimeout(function(){ charts.style.display = 'none'; }, 200); }

            var titulo = document.getElementById('ckDetalleTitulo');
            var head = document.getElementById('ckDetalleHead');
            var tbody = document.getElementById('ckDetalleTbody');
            if (titulo) titulo.textContent = 'Desglose de Cobrado';
            if (head) head.innerHTML = '<th>#</th><th>Cliente</th><th>Empleado</th><th style="text-align:right">Cobrado</th><th style="text-align:right">Meta</th><th style="text-align:right">Faltante</th>';
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#8e8e93;">Cargando...</td></tr>';
            if (detalle) { detalle.style.display = 'block'; detalle.style.opacity = '0'; detalle.style.transition = 'opacity 0.2s'; setTimeout(function(){ detalle.style.opacity = '1'; }, 50); }

            var params = new URLSearchParams(window.location.search);
            var mes = params.get('mes') || 'todos';
            var anio = params.get('anio') || new Date().getFullYear();
            var vendedores = params.get('vendedores') || '';
            var _vq = vendedores ? '&vendedores=' + encodeURIComponent(vendedores) : '';
            var _fmtM = function(n) { return '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); };
            fetch('/app/api/desglose-cobrado/?mes=' + mes + '&anio=' + anio + _vq, { credentials: 'same-origin' })
                .then(function (r) { return r.json(); })
                .then(function (resp) {
                    if (!resp.ok) { if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#FF3B30;">' + (resp.error || 'Error') + '</td></tr>'; return; }
                    if (!resp.rows || resp.rows.length === 0) { if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#8e8e93;">No hay datos. Sube un CSV de ingresos.</td></tr>'; return; }
                    var html = '';
                    resp.rows.forEach(function (r, i) {
                        var faltante = r.faltante || 0;
                        var faltColor = faltante <= 0 ? '#059669' : '#DC2626';
                        var rowId = 'cobRow-' + i;
                        html += '<tr style="cursor:pointer;" onclick="(function(){var d=document.getElementById(\'' + rowId + '\');d.style.display=d.style.display===\'none\'?\'table-row\':\'none\';})()">' +
                            '<td style="color:#8e8e93;font-size:0.75rem;">' + (i + 1) + '</td>' +
                            '<td style="font-weight:600;">' + (r.nombre || '—') + ' <span style="color:#8e8e93;font-size:0.7rem;">▼</span></td>' +
                            '<td style="color:#636366;font-size:0.8rem;">' + (r.vendedor || '—') + '</td>' +
                            '<td style="text-align:right;font-weight:700;color:#059669;">' + _fmtM(r.monto) + '</td>' +
                            '<td style="text-align:right;color:#636366;">' + (r.meta ? _fmtM(r.meta) : '—') + '</td>' +
                            '<td style="text-align:right;font-weight:600;color:' + faltColor + ';">' + _fmtM(faltante) + '</td>' +
                            '</tr>';
                        // Facturas expandibles
                        html += '<tr id="' + rowId + '" style="display:none;background:#F9FAFB;"><td></td><td colspan="5">';
                        if (r.facturas && r.facturas.length > 0) {
                            html += '<table style="width:100%;font-size:0.75rem;margin:4px 0;">';
                            html += '<tr style="color:#8e8e93;"><td style="padding:2px 8px;">Factura</td><td style="padding:2px 8px;">Fecha</td><td style="padding:2px 8px;text-align:right;">Monto</td></tr>';
                            r.facturas.forEach(function (f) {
                                html += '<tr><td style="padding:2px 8px;">' + (f.factura || '—') + '</td>' +
                                    '<td style="padding:2px 8px;">' + (f.fecha || '—') + '</td>' +
                                    '<td style="padding:2px 8px;text-align:right;font-weight:600;">' + _fmtM(f.monto) + '</td></tr>';
                            });
                            html += '</table>';
                        } else {
                            html += '<span style="color:#8e8e93;font-size:0.75rem;">Sin detalle de facturas</span>';
                        }
                        html += '</td></tr>';
                    });
                    html += '<tr style="background:#F5F5F7;font-weight:700;"><td colspan="3" style="text-align:right;padding:10px 14px;">Total</td><td style="text-align:right;padding:10px 14px;color:#059669;">' + _fmtM(resp.total) + '</td><td colspan="2"></td></tr>';
                    if (tbody) tbody.innerHTML = html;
                })
                .catch(function () { if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#FF3B30;">Error de conexion</td></tr>'; });
        };

        window.clientesVistaAbrir = function (vista) {
            var data = _clientesPanelData[vista];
            var overlay = document.getElementById('clientesDetalleOverlay');
            if (!overlay) return;
            var labels = { facturado: 'Facturado', cobrado: 'Cobrado', oportunidades: 'Oportunidades', cotizado: 'Cotizado' };
            var titulo = document.getElementById('clientesDetalleTitulo');
            var statsEl = document.getElementById('clientesDetalleStats');
            var thead = document.getElementById('clientesDetalleThead');
            var tbody = document.getElementById('clientesDetalleTbody');
            if (titulo) titulo.textContent = labels[vista] + ' — Desglose por Marcas';
            if (thead) thead.innerHTML = _CLIENTES_THEAD_FULL;
            if (!data || !data.rows || data.rows.length === 0) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="14" class="text-center py-20 text-gray-400 italic">Sin datos.</td></tr>';
            } else {
                var html = '';
                for (var i = 0; i < data.rows.length; i++) { html += buildClientesFullRow(data.rows[i]); }
                if (tbody) tbody.innerHTML = html;
            }
            if (statsEl && data) {
                if (vista === 'cotizado') {
                    statsEl.textContent = 'Total: ' + (data.num_total_cotizaciones || data.total_facturado || '0') + ' cotizaciones  ·  Monto: $' + (data.total_monto_cotizado || '0') + '  ·  ' + (data.progreso || 0) + '% de meta';
                } else {
                    statsEl.textContent = 'Total: $' + (data.total_facturado || '0') + '  ·  ' + (data.progreso || 0) + '% de meta';
                }
            }
            overlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            if (typeof bindTableEvents === 'function') bindTableEvents();
            // Actualizar topbar con esta vista
            if (data) updateTopbarFromClientesPanel(data);
        };

        window.clientesVistaDetalleCerrar = function () {
            var overlay = document.getElementById('clientesDetalleOverlay');
            if (overlay) overlay.style.display = 'none';
            document.body.style.overflow = '';
            // Volver topbar a facturado
            if (_clientesPanelData.facturado) updateTopbarFromClientesPanel(_clientesPanelData.facturado);
        };

        // ═══ CLIENTES CHARTS ═══
        var _ckChartInstances = {};

        function ckDestroyChart(id) {
            // 1) Destruir referencia local si existe
            if (_ckChartInstances[id]) {
                try { _ckChartInstances[id].destroy(); } catch (e) { /* noop */ }
                delete _ckChartInstances[id];
            }
            // 2) Bajo Turbo Drive el body se reemplaza al navegar y el
            //    canvas <canvas id="ckChart..."> es un elemento NUEVO. Chart.js
            //    puede tener registrado un chart "huérfano" asociado al canvas
            //    viejo o al nuevo. Chart.getChart() detecta cualquier chart
            //    asociado al canvas con ese id y lo destruye antes de crear
            //    uno nuevo. Sin esto: "Canvas is already in use. Chart with
            //    ID '0' must be destroyed before the canvas can be reused".
            var canvas = document.getElementById(id);
            if (canvas && typeof Chart !== 'undefined' && Chart.getChart) {
                var existing = Chart.getChart(canvas);
                if (existing) {
                    try { existing.destroy(); } catch (e) { /* noop */ }
                }
            }
        }

        function ckRenderCharts(merged, totFact, totCob, totOpp, totCot, prevFact, prevCob, prevOpp, prevCot) {
            if (typeof Chart === 'undefined') return;
            // (2026-06-10, fix SPA) Destruir las instancias previas ANTES de
            // recrear. Sin esto, la 2ª llamada (cambio de modo, refresh del
            // data bus, navegación Turbo) lanza "Canvas is already in use"
            // y fuga listeners de resize. _renderProspCharts ya lo hacía
            // bien; este era el bloqueador documentado para SPA en Reportes.
            Object.keys(_ckChartInstances).forEach(function (k) {
                try { _ckChartInstances[k].destroy(); } catch (e) { }
                delete _ckChartInstances[k];
            });
            var fN = function(s) { return parseFloat((s || '0').replace(/,/g, '')) || 0; };
            var fmtCurrency = function(v) { return v >= 1000000 ? '$' + (v/1000000).toFixed(1) + 'M' : v >= 1000 ? '$' + Math.round(v/1000) + 'K' : '$' + v; };

            // Sort by facturado descending, top 8
            var sorted = merged.slice().sort(function(a, b) { return fN(b.fact_total) - fN(a.fact_total); });
            var top8 = sorted.slice(0, 8);
            var labels8 = top8.map(function(r) { return r.cliente.length > 15 ? r.cliente.substring(0, 15) + '...' : r.cliente; });

            // Chart defaults
            Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
            Chart.defaults.font.size = 11;
            Chart.defaults.plugins.legend.labels.boxWidth = 10;
            Chart.defaults.plugins.legend.labels.padding = 12;

            // Shared tooltip config — Liquid Glass style
            var sharedTooltip = {
                backgroundColor: 'rgba(255,255,255,0.85)',
                titleColor: '#1D1D1F',
                bodyColor: '#3C3C43',
                titleFont: { size: 12, weight: '700' },
                bodyFont: { size: 11, weight: '500' },
                padding: 12,
                cornerRadius: 14,
                borderColor: 'rgba(255,255,255,0.6)',
                borderWidth: 1,
                displayColors: true,
                boxPadding: 4
            };

            // Shared animation config
            var sharedAnimation = {
                duration: 1200,
                easing: 'easeOutQuart',
                delay: function(ctx) { return ctx.dataIndex * 80; }
            };

            // ── Chart 1: Facturado vs Meta (horizontal bar) ──
            ckDestroyChart('ckChartFactVsMeta');
            var ctx1 = document.getElementById('ckChartFactVsMeta');
            if (ctx1) {
                var ctx1_2d = ctx1.getContext('2d');
                var gradBlue = ctx1_2d.createLinearGradient(0, 0, ctx1.width, 0);
                gradBlue.addColorStop(0, 'rgba(0,122,255,0.9)');
                gradBlue.addColorStop(1, 'rgba(88,176,255,0.75)');
                var gradMeta = ctx1_2d.createLinearGradient(0, 0, ctx1.width, 0);
                gradMeta.addColorStop(0, 'rgba(200,200,210,0.5)');
                gradMeta.addColorStop(1, 'rgba(220,220,230,0.3)');
                _ckChartInstances['ckChartFactVsMeta'] = new Chart(ctx1_2d, {
                    type: 'bar',
                    data: {
                        labels: labels8,
                        datasets: [
                            {
                                label: 'Facturado',
                                data: top8.map(function(r) { return fN(r.fact_total); }),
                                backgroundColor: gradBlue,
                                borderRadius: 8,
                                barPercentage: 0.55
                            },
                            {
                                label: 'Meta',
                                data: top8.map(function(r) { return fN(r.fact_meta); }),
                                backgroundColor: gradMeta,
                                borderRadius: 8,
                                barPercentage: 0.55
                            }
                        ]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: sharedAnimation,
                        plugins: {
                            legend: {
                                position: 'top',
                                labels: {
                                    usePointStyle: true,
                                    pointStyle: 'circle',
                                    font: { size: 10, weight: '600' },
                                    color: '#86868B',
                                    padding: 16
                                }
                            },
                            tooltip: Object.assign({}, sharedTooltip, {
                                callbacks: {
                                    label: function(ctx) {
                                        return ' ' + ctx.dataset.label + ': $' + ctx.parsed.x.toLocaleString('en-US', { maximumFractionDigits: 0 });
                                    }
                                }
                            })
                        },
                        scales: {
                            x: {
                                ticks: { callback: function(v) { return fmtCurrency(v); }, font: { size: 10 }, color: '#86868B' },
                                grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false }
                            },
                            y: {
                                grid: { display: false },
                                ticks: { font: { size: 10, weight: '500' }, color: '#86868B' }
                            }
                        }
                    }
                });
            }

            // ── Chart 2: Tendencia Mensual (line chart via API) ──
            ckDestroyChart('ckChartTendencia');
            var ctx2 = document.getElementById('ckChartTendencia');
            if (ctx2) {
                var urlParams = new URLSearchParams(window.location.search);
                var vendParam = urlParams.get('vendedores') || '';
                fetch('/app/api/tendencia-mensual/?vendedores=' + encodeURIComponent(vendParam))
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        // Re-destruir RIGHT antes de crear: el fetch es async,
                        // entre el ckDestroyChart inicial y este .then() el
                        // usuario pudo haber navegado y vuelto, dejando un
                        // chart huérfano en el canvas nuevo.
                        ckDestroyChart('ckChartTendencia');
                        // Verificar que el canvas SIGA en el DOM (si navegó y
                        // todavía no volvió, no rendear).
                        var liveCtx = document.getElementById('ckChartTendencia');
                        if (!liveCtx) return;
                        var ctx2_2d = liveCtx.getContext('2d');

                        var makeDataset = function(label, values, color) {
                            return {
                                label: label,
                                data: values,
                                borderColor: color,
                                backgroundColor: 'transparent',
                                borderWidth: 2,
                                pointRadius: 4,
                                pointHoverRadius: 7,
                                pointBackgroundColor: '#fff',
                                pointBorderColor: color,
                                pointBorderWidth: 2,
                                pointHoverBackgroundColor: color,
                                pointHoverBorderColor: '#fff',
                                pointHoverBorderWidth: 2,
                                fill: false,
                                tension: 0.3
                            };
                        };

                        _ckChartInstances['ckChartTendencia'] = new Chart(ctx2_2d, {
                            type: 'line',
                            data: {
                                labels: data.labels,
                                datasets: [
                                    makeDataset('Facturado', data.facturado, '#6B7280'),
                                    makeDataset('Cobrado', data.cobrado, '#10B981'),
                                    makeDataset('Oportunidades', data.oportunidades, '#3B82F6'),
                                    makeDataset('Cotizado', data.cotizado, '#F59E0B')
                                ]
                            },
                            options: {
                                responsive: true,
                                maintainAspectRatio: false,
                                animation: { duration: 1200, easing: 'easeOutQuart' },
                                interaction: { mode: 'index', intersect: false },
                                plugins: {
                                    legend: {
                                        position: 'top',
                                        labels: {
                                            usePointStyle: true,
                                            pointStyle: 'circle',
                                            font: { size: 10, weight: '600' },
                                            color: '#86868B',
                                            padding: 12
                                        }
                                    },
                                    tooltip: Object.assign({}, sharedTooltip, {
                                        callbacks: {
                                            label: function(ctx) {
                                                var val = ctx.parsed.y || 0;
                                                var txt = ' ' + ctx.dataset.label + ': $' + val.toLocaleString('en-US', { maximumFractionDigits: 0 });
                                                var idx = ctx.dataIndex;
                                                if (idx > 0) {
                                                    var prev = ctx.dataset.data[idx - 1];
                                                    if (prev > 0) {
                                                        var cambio = Math.round((val - prev) / prev * 100);
                                                        txt += ' (' + (cambio >= 0 ? '+' : '') + cambio + '%)';
                                                    }
                                                }
                                                return txt;
                                            }
                                        }
                                    })
                                },
                                scales: {
                                    y: {
                                        ticks: { callback: function(v) { return fmtCurrency(v); }, font: { size: 10 }, color: '#86868B' },
                                        grid: { color: 'rgba(0,0,0,0.04)' }
                                    },
                                    x: {
                                        grid: { display: false },
                                        ticks: { font: { size: 10, weight: '600' }, color: '#3C3C43' }
                                    }
                                }
                            }
                        });
                    })
                    .catch(function(err) { console.error('Tendencia fetch error:', err); });
            }

            // ── Chart 3: Top 5 by oportunidades (vertical bar) ──
            var sortedOpp = merged.slice().sort(function(a, b) { return fN(b.opp_total) - fN(a.opp_total); });
            var top5opp = sortedOpp.slice(0, 5);
            ckDestroyChart('ckChartTopClientes');
            var ctx3 = document.getElementById('ckChartTopClientes');
            if (ctx3) {
                var ctx3_2d = ctx3.getContext('2d');
                var gradBar = ctx3_2d.createLinearGradient(0, 0, 0, 280);
                gradBar.addColorStop(0, 'rgba(0,122,255,0.85)');
                gradBar.addColorStop(1, 'rgba(88,176,255,0.55)');
                _ckChartInstances['ckChartTopClientes'] = new Chart(ctx3_2d, {
                    type: 'bar',
                    data: {
                        labels: top5opp.map(function(r) { return r.cliente.length > 15 ? r.cliente.substring(0, 15) + '...' : r.cliente; }),
                        datasets: [{
                            label: 'Oportunidades',
                            data: top5opp.map(function(r) { return fN(r.opp_total); }),
                            backgroundColor: gradBar,
                            borderRadius: 10,
                            barPercentage: 0.5
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: sharedAnimation,
                        plugins: {
                            legend: { display: false },
                            tooltip: Object.assign({}, sharedTooltip, {
                                callbacks: {
                                    label: function(ctx) {
                                        return ' $' + ctx.parsed.y.toLocaleString('en-US', { maximumFractionDigits: 0 });
                                    }
                                }
                            })
                        },
                        scales: {
                            y: {
                                ticks: { callback: function(v) { return fmtCurrency(v); }, font: { size: 10 }, color: '#86868B' },
                                grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false }
                            },
                            x: {
                                grid: { display: false },
                                ticks: { font: { size: 10, weight: '500' }, color: '#86868B' }
                            }
                        }
                    },
                    plugins: [{
                        id: 'barValueLabelsTop5',
                        afterDatasetsDraw: function(chart) {
                            var ctx = chart.ctx;
                            chart.data.datasets.forEach(function(dataset, di) {
                                var meta = chart.getDatasetMeta(di);
                                meta.data.forEach(function(bar, index) {
                                    var value = dataset.data[index];
                                    if (value > 0) {
                                        ctx.save();
                                        ctx.font = '700 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
                                        ctx.fillStyle = '#1D1D1F';
                                        ctx.textAlign = 'center';
                                        ctx.textBaseline = 'bottom';
                                        ctx.fillText(fmtCurrency(value), bar.x, bar.y - 6);
                                        ctx.restore();
                                    }
                                });
                            });
                        }
                    }]
                });
            }

            // ── Chart 4: Facturado por Vendedor (horizontal bar) ──
            var vendedorTotals = {};
            merged.forEach(function(c) {
                var v = c.vendedor || 'Sin asignar';
                vendedorTotals[v] = (vendedorTotals[v] || 0) + fN(c.fact_total);
            });
            var vendedorArr = Object.keys(vendedorTotals).map(function(k) { return { name: k, total: vendedorTotals[k] }; });
            vendedorArr.sort(function(a, b) { return b.total - a.total; });
            var topVend = vendedorArr.slice(0, 6);
            ckDestroyChart('ckChartPorVendedor');
            var ctx4 = document.getElementById('ckChartPorVendedor');
            if (ctx4 && topVend.length > 0) {
                var ctx4_2d = ctx4.getContext('2d');
                var gradGreen = ctx4_2d.createLinearGradient(0, 0, ctx4.width, 0);
                gradGreen.addColorStop(0, 'rgba(16,185,129,0.85)');
                gradGreen.addColorStop(1, 'rgba(52,211,153,0.55)');
                _ckChartInstances['ckChartPorVendedor'] = new Chart(ctx4_2d, {
                    type: 'bar',
                    data: {
                        labels: topVend.map(function(v) { return v.name.length > 15 ? v.name.substring(0,15)+'...' : v.name; }),
                        datasets: [{
                            data: topVend.map(function(v) { return v.total; }),
                            backgroundColor: gradGreen,
                            borderRadius: 10,
                            barPercentage: 0.55
                        }]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: sharedAnimation,
                        plugins: {
                            legend: { display: false },
                            tooltip: Object.assign({}, sharedTooltip, {
                                callbacks: {
                                    label: function(c) { return ' $' + c.parsed.x.toLocaleString(); }
                                }
                            })
                        },
                        scales: {
                            x: { grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false }, ticks: { font: { size: 10 }, color: '#86868B', callback: function(v) { return fmtCurrency(v); } } },
                            y: { grid: { display: false }, ticks: { font: { size: 10, weight: '500' }, color: '#3C3C43' } }
                        }
                    }
                });
            }

        }

        // ═══ KPI DETAIL (INLINE, REPLACES CHARTS) ═══
        window.ckAbrirDetalle = function(tipo) {
            var charts = document.getElementById('ckChartsSection');
            var detalle = document.getElementById('ckDetalleSection');
            if (!detalle) return;
            // Marcar drill-down abierto para que el refresh periódico no clobber-ee
            window._ckDetalleOpen = true;
            window._ckDetalleTipo = tipo;

            // Fade out charts (both oportunidades and prospeccion)
            if (charts) {
                charts.style.transition = 'opacity 0.2s';
                charts.style.opacity = '0';
                setTimeout(function(){ charts.style.display = 'none'; }, 200);
            }
            var chartsProsp = document.getElementById('ckChartsSectionProsp');
            if (chartsProsp) {
                chartsProsp.style.transition = 'opacity 0.2s';
                chartsProsp.style.opacity = '0';
                setTimeout(function(){ chartsProsp.style.display = 'none'; }, 200);
            }
            var chartsProy = document.getElementById('ckChartsSectionProy');
            if (chartsProy) {
                chartsProy.style.transition = 'opacity 0.2s';
                chartsProy.style.opacity = '0';
                setTimeout(function(){ chartsProy.style.display = 'none'; }, 200);
            }
            // Fade in detail
            detalle.style.display = 'block';
            detalle.style.opacity = '0';
            detalle.style.transition = 'opacity 0.2s';
            setTimeout(function(){ detalle.style.opacity = '1'; }, 50);

            var titles = { cobrado: 'Detalle de Cobrado', oportunidades: 'Detalle de Oportunidades', cotizado: 'Detalle de Cotizado' };

            var tituloEl = document.getElementById('ckDetalleTitulo');
            if (tituloEl) tituloEl.textContent = titles[tipo] || 'Detalle';

            var head = document.getElementById('ckDetalleHead');
            var tbody = document.getElementById('ckDetalleTbody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#8e8e93;">Cargando...</td></tr>';

            // Use already-loaded data from _clientesPanelData
            var data = _clientesPanelData[tipo];
            var rows = (data && data.rows) ? data.rows : [];

            var fN = function(s) { return parseFloat((s || '0').replace(/,/g, '')) || 0; };

            if (tipo === 'cobrado') {
                if (head) head.innerHTML = '<th>#</th><th>Cliente</th><th>Vendedor</th><th style="text-align:right">Cobrado</th><th style="text-align:right">Meta</th><th style="text-align:right">Faltante</th>';
                if (tbody) tbody.innerHTML = rows.map(function(r, i) {
                    var faltN = fN(r.faltante);
                    return '<tr><td style="color:#8e8e93">' + (i+1) + '</td><td style="font-weight:600">' + r.cliente + '</td><td style="color:#6e6e73">' + (r.vendedor || '') + '</td><td style="text-align:right;font-weight:700;color:#059669">$' + (r.total || '0') + '</td><td style="text-align:right;color:#8e8e93">$' + (r.meta || '0') + '</td><td style="text-align:right;color:' + (faltN > 0 ? '#FF3B30' : '#059669') + '">$' + (r.faltante || '0') + '</td></tr>';
                }).join('');
            } else if (tipo === 'oportunidades') {
                if (head) head.innerHTML = '<th>#</th><th>Cliente</th><th>Vendedor</th><th style="text-align:right">Oportunidades</th><th style="text-align:right">Meta</th><th style="text-align:right">Faltante</th>';
                if (tbody) tbody.innerHTML = rows.map(function(r, i) {
                    var faltN = fN(r.faltante);
                    return '<tr class="ck-detalle-row" data-cliente-id="' + r.cliente_id + '" data-cliente-nombre="' + (r.cliente || '').replace(/"/g, '&quot;') + '" style="cursor:pointer;" onmouseover="this.style.backgroundColor=\'#f0f7ff\'" onmouseout="this.style.backgroundColor=\'\'"><td style="color:#8e8e93">' + (i+1) + '</td><td style="font-weight:600;color:#007AFF">' + r.cliente + '</td><td style="color:#6e6e73">' + (r.vendedor || '') + '</td><td style="text-align:right;font-weight:700;color:#2563EB">$' + (r.total || '0') + '</td><td style="text-align:right;color:#8e8e93">$' + (r.meta || '0') + '</td><td style="text-align:right;color:' + (faltN > 0 ? '#FF3B30' : '#059669') + '">$' + (r.faltante || '0') + '</td></tr>';
                }).join('');
            } else if (tipo === 'cotizado') {
                if (head) head.innerHTML = '<th>#</th><th>Cliente</th><th>Vendedor</th><th style="text-align:right"># Cotizaciones</th>';
                var totalCotNum = 0;
                if (tbody) tbody.innerHTML = rows.map(function(r, i) {
                    var nc = r.num_cotizaciones || 0;
                    totalCotNum += nc;
                    return '<tr><td style="color:#8e8e93">' + (i+1) + '</td><td style="font-weight:600">' + r.cliente + '</td><td style="color:#6e6e73">' + (r.vendedor || '') + '</td><td style="text-align:right;font-weight:700;color:#D97706">' + nc + '</td></tr>';
                }).join('');
                // Append footer row with total
                if (tbody && rows.length > 0) {
                    tbody.innerHTML += '<tr style="border-top:2px solid #e5e7eb;font-weight:700"><td></td><td colspan="2" style="color:#6e6e73">Total</td><td style="text-align:right;color:#D97706">' + totalCotNum + '</td></tr>';
                }
            }

            else if (tipo === 'prosp_generadas') {
                var titulo = document.getElementById('ckDetalleTitulo');
                if (titulo) titulo.textContent = 'Prospecciones Generadas por Cliente';
                if (head) head.innerHTML =
                    '<th class="ck-th--num" style="width:5%;">#</th>' +
                    '<th class="ck-th--text" style="width:30%;">Cliente</th>' +
                    '<th class="ck-th--text" style="width:20%;">Vendedor</th>' +
                    '<th class="ck-th--num" style="width:20%;">Campañas</th>' +
                    '<th class="ck-th--num" style="width:25%;">Prospecciones</th>';
                var pRows = ((_clientesPanelData.prospeccion || {}).rows || []).filter(function(r) { return r.num_prospectos > 0 || r.num_campanas > 0; });
                // Ordenar de mayor a menor por # prospecciones (KPI principal de esta vista).
                // Tiebreaker: # campañas desc, luego nombre A→Z.
                pRows.sort(function(a, b) {
                    var d = (b.num_prospectos || 0) - (a.num_prospectos || 0);
                    if (d) return d;
                    d = (b.num_campanas || 0) - (a.num_campanas || 0);
                    if (d) return d;
                    return (a.cliente || '').localeCompare(b.cliente || '');
                });
                if (tbody) tbody.innerHTML = pRows.length === 0
                    ? '<tr><td colspan="5" style="text-align:center;padding:40px;color:#8e8e93">No hay datos para este periodo</td></tr>'
                    : pRows.map(function(r, i) {
                        return '<tr class="ck-prosp-row" data-prosp-tipo="generadas" data-cliente-id="' + (r.cliente_id || '') + '" data-cliente-nombre="' + (r.cliente || '').replace(/"/g, '&quot;') + '">' +
                            '<td class="ck-td--num ck-td--idx">' + (i+1) + '<span class="ck-chev">›</span></td>' +
                            '<td class="ck-td--text ck-td--cliente">' + r.cliente + '</td>' +
                            '<td class="ck-td--text ck-td--vendedor">' + (r.vendedor || '') + '</td>' +
                            '<td class="ck-td--num" style="color:#FF9500;font-weight:700;">' + r.num_campanas + '</td>' +
                            '<td class="ck-td--num" style="color:#7C3AED;font-weight:800;">' + r.num_prospectos + '</td>' +
                        '</tr>';
                    }).join('');
                rows = pRows;
            }
            else if (tipo === 'prosp_opps') {
                var titulo = document.getElementById('ckDetalleTitulo');
                if (titulo) titulo.textContent = 'Oportunidades desde Prospección';
                if (head) head.innerHTML =
                    '<th class="ck-th--num" style="width:5%;">#</th>' +
                    '<th class="ck-th--text" style="width:35%;">Cliente</th>' +
                    '<th class="ck-th--num" style="width:20%;">Prospectos</th>' +
                    '<th class="ck-th--num" style="width:20%;">Convertidas</th>' +
                    '<th class="ck-th--num" style="width:20%;">% Conversión</th>';
                var pRows = ((_clientesPanelData.prospeccion || {}).rows || []).filter(function(r) { return r.num_prospectos > 0; });
                // Ordenar por # convertidas desc (KPI principal de esta vista).
                // Tiebreaker: % conversión desc, # prospectos desc, nombre.
                pRows.sort(function(a, b) {
                    var d = (b.num_ganados || 0) - (a.num_ganados || 0);
                    if (d) return d;
                    var pa = (a.num_prospectos || 0) ? (a.num_ganados || 0) / a.num_prospectos : 0;
                    var pb = (b.num_prospectos || 0) ? (b.num_ganados || 0) / b.num_prospectos : 0;
                    if (pa !== pb) return pb - pa;
                    d = (b.num_prospectos || 0) - (a.num_prospectos || 0);
                    if (d) return d;
                    return (a.cliente || '').localeCompare(b.cliente || '');
                });
                if (tbody) tbody.innerHTML = pRows.length === 0
                    ? '<tr><td colspan="5" style="text-align:center;padding:40px;color:#8e8e93">No hay datos para este periodo</td></tr>'
                    : pRows.map(function(r, i) {
                        var pct = r.num_prospectos > 0 ? Math.round(r.num_ganados / r.num_prospectos * 100) : 0;
                        return '<tr class="ck-prosp-row" data-prosp-tipo="opps" data-cliente-id="' + (r.cliente_id || '') + '" data-cliente-nombre="' + (r.cliente || '').replace(/"/g, '&quot;') + '">' +
                            '<td class="ck-td--num ck-td--idx">' + (i+1) + '<span class="ck-chev">›</span></td>' +
                            '<td class="ck-td--text ck-td--cliente">' + r.cliente + '</td>' +
                            '<td class="ck-td--num">' + r.num_prospectos + '</td>' +
                            '<td class="ck-td--num" style="color:#16A34A;font-weight:700;">' + r.num_ganados + '</td>' +
                            '<td class="ck-td--num" style="font-weight:700;">' + pct + '%</td>' +
                        '</tr>';
                    }).join('');
                rows = pRows;
            }
            else if (tipo === 'prosp_ventas') {
                var titulo = document.getElementById('ckDetalleTitulo');
                if (titulo) titulo.textContent = 'Ventas Generadas desde Prospección';
                if (head) head.innerHTML =
                    '<th class="ck-th--num" style="width:5%;">#</th>' +
                    '<th class="ck-th--text" style="width:35%;">Oportunidad</th>' +
                    '<th class="ck-th--text" style="width:25%;">Cliente</th>' +
                    '<th class="ck-th--text" style="width:15%;">Vendedor</th>' +
                    '<th class="ck-th--num" style="width:20%;">Monto</th>';
                if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:#8e8e93">Cargando...</td></tr>';
                // Fetch desde nuevo endpoint
                var url = '/app/api/dashboard/prospectos/ventas-detalle/?' + _ckPeriodQS();
                fetch(url, { credentials: 'same-origin' })
                    .then(function(r){ return r.json(); })
                    .then(function(resp) {
                        var vrows = (resp && resp.rows) || [];
                        if (!tbody) return;
                        if (!vrows.length) {
                            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:#8e8e93">No hay ventas desde prospección en el periodo</td></tr>';
                            return;
                        }
                        // Ordenar por monto desc (KPI principal). Tiebreaker: cliente A→Z.
                        vrows.sort(function(a, b) {
                            var ma = parseFloat(a.monto || 0) || 0;
                            var mb = parseFloat(b.monto || 0) || 0;
                            if (ma !== mb) return mb - ma;
                            return (a.cliente || '').localeCompare(b.cliente || '');
                        });
                        tbody.innerHTML = vrows.map(function(r, i) {
                            return '<tr class="ck-prosp-opp-row" data-oportunidad-id="' + r.id + '">' +
                                '<td class="ck-td--num ck-td--idx">' + (i+1) + '</td>' +
                                '<td class="ck-td--text" style="font-weight:600;color:#007AFF;">' + (r.descripcion || '—') + '</td>' +
                                '<td class="ck-td--text">' + (r.cliente || '') + '</td>' +
                                '<td class="ck-td--text" style="color:#6e6e73;">' + (r.vendedor || '') + '</td>' +
                                '<td class="ck-td--num" style="color:#16A34A;font-weight:800;">' + (r.monto_fmt || '$0') + '</td>' +
                            '</tr>';
                        }).join('') + '<tr style="border-top:2px solid #e5e7eb;font-weight:700;background:#FAFAFA;">' +
                            '<td></td><td colspan="3" class="ck-td--text" style="font-weight:700;">Total</td>' +
                            '<td class="ck-td--num" style="color:#16A34A;font-weight:900;">' + (resp.total_fmt || '$0') + '</td>' +
                        '</tr>';
                    })
                    .catch(function() {
                        if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:#FF3B30">Error al cargar.</td></tr>';
                    });
                rows = [1];
            }
            else if (tipo === 'prosp_tasa') {
                var titulo = document.getElementById('ckDetalleTitulo');
                if (titulo) titulo.textContent = 'Tasa de Contacto — Campañas';
                var pData = _clientesPanelData.prospeccion || {};
                if (head) head.innerHTML = '<th class="ck-th--text">Métrica</th><th class="ck-th--num">Valor</th>';
                if (tbody) tbody.innerHTML =
                    '<tr><td class="ck-td--text" style="font-weight:600;">Campañas enviadas</td><td class="ck-td--num" style="color:#2563EB;font-weight:700;font-size:1rem;">' + (pData.total_envios || 0) + '</td></tr>' +
                    '<tr><td class="ck-td--text" style="font-weight:600;">Respondidas</td><td class="ck-td--num" style="color:#16A34A;font-weight:700;font-size:1rem;">' + (pData.total_respondidos || 0) + '</td></tr>' +
                    '<tr><td class="ck-td--text" style="font-weight:600;">Respuestas favorables</td><td class="ck-td--num" style="color:#15803D;font-weight:700;font-size:1rem;">' + (pData.total_favorables || 0) + '</td></tr>' +
                    '<tr><td class="ck-td--text" style="font-weight:700;">Tasa de contacto</td><td class="ck-td--num" style="color:#7C3AED;font-weight:900;font-size:1.15rem;">' + (pData.tasa_contacto || 0) + '%</td></tr>';
                rows = [1];
            }
            else if (tipo === 'prosp_convertidos') {
                var titulo = document.getElementById('ckDetalleTitulo');
                if (titulo) titulo.textContent = 'Clientes Convertidos desde Prospección';
                if (head) head.innerHTML =
                    '<th class="ck-th--num" style="width:5%;">#</th>' +
                    '<th class="ck-th--text" style="width:50%;">Cliente</th>' +
                    '<th class="ck-th--num" style="width:20%;">Prospectos Ganados</th>' +
                    '<th class="ck-th--num" style="width:25%;">Oportunidades</th>';
                if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:40px;color:#8e8e93">Cargando...</td></tr>';
                var url2 = '/app/api/dashboard/prospectos/convertidos-detalle/?' + _ckPeriodQS();
                fetch(url2, { credentials: 'same-origin' })
                    .then(function(r){ return r.json(); })
                    .then(function(resp) {
                        var crows = (resp && resp.rows) || [];
                        if (!tbody) return;
                        if (!crows.length) {
                            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:40px;color:#8e8e93">No hay clientes convertidos en el periodo</td></tr>';
                            return;
                        }
                        // Ordenar por # ganados desc, luego # oportunidades desc, nombre.
                        crows.sort(function(a, b) {
                            var d = (b.num_ganados || 0) - (a.num_ganados || 0);
                            if (d) return d;
                            d = ((b.oportunidades || []).length) - ((a.oportunidades || []).length);
                            if (d) return d;
                            return (a.cliente || '').localeCompare(b.cliente || '');
                        });
                        tbody.innerHTML = crows.map(function(r, i) {
                            return '<tr class="ck-prosp-row" data-prosp-tipo="opps" data-cliente-id="' + (r.cliente_id || '') + '" data-cliente-nombre="' + (r.cliente || '').replace(/"/g, '&quot;') + '">' +
                                '<td class="ck-td--num ck-td--idx">' + (i+1) + '<span class="ck-chev">›</span></td>' +
                                '<td class="ck-td--text ck-td--cliente">' + (r.cliente || '') + '</td>' +
                                '<td class="ck-td--num" style="color:#16A34A;font-weight:800;">' + (r.num_ganados || 0) + '</td>' +
                                '<td class="ck-td--num" style="color:#2563EB;font-weight:700;">' + ((r.oportunidades || []).length) + '</td>' +
                            '</tr>';
                        }).join('');
                    })
                    .catch(function() {
                        if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:40px;color:#FF3B30">Error al cargar.</td></tr>';
                    });
                rows = [1];
            }

            if (rows.length === 0 && tbody) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#8e8e93">No hay datos para este periodo</td></tr>';
            }
        };

        window.ckVolverGraficas = function() {
            // Cerrar drill-down — permitir refrescos periódicos otra vez
            window._ckDetalleOpen = false;
            window._ckDetalleTipo = null;
            var detalle = document.getElementById('ckDetalleSection');
            if (detalle) {
                detalle.style.transition = 'opacity 0.2s';
                detalle.style.opacity = '0';
                setTimeout(function(){ detalle.style.display = 'none'; }, 200);
            }
            // Show correct charts based on current mode
            if (_crmClientesMode === 'prospeccion') {
                var chartsProsp = document.getElementById('ckChartsSectionProsp');
                if (chartsProsp) {
                    chartsProsp.style.display = 'block';
                    chartsProsp.style.opacity = '0';
                    setTimeout(function(){ chartsProsp.style.transition = 'opacity 0.2s'; chartsProsp.style.opacity = '1'; }, 50);
                }
            } else if (_crmClientesMode === 'proyectos') {
                var chartsProy = document.getElementById('ckChartsSectionProy');
                if (chartsProy) {
                    chartsProy.style.display = 'block';
                    chartsProy.style.opacity = '0';
                    setTimeout(function(){ chartsProy.style.transition = 'opacity 0.2s'; chartsProy.style.opacity = '1'; }, 50);
                }
            } else {
                var charts = document.getElementById('ckChartsSection');
                if (charts) {
                    charts.style.display = '';
                    setTimeout(function(){ charts.style.transition = 'opacity 0.2s'; charts.style.opacity = '1'; }, 50);
                }
            }
        };

        // ─── Helpers de drill-down dashboard prospectos ────────────────────────
        function _ckPeriodQS() {
            var params = new URLSearchParams(window.location.search);
            var mes = params.get('mes') || currentMes || '';
            var anio = params.get('anio') || currentAnio || '';
            var vendedores = (typeof getVendedoresParam === 'function') ? getVendedoresParam() : '';
            var qs = 'mes=' + encodeURIComponent(mes) + '&anio=' + encodeURIComponent(anio);
            if (vendedores) qs += '&vendedores=' + encodeURIComponent(vendedores);
            return qs;
        }

        function _escapeHtmlSimple(s) {
            if (s == null) return '';
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        var _PROSP_ETAPA_COLOR = {
            'identificado': '#8E8E93', 'calificado': '#007AFF', 'reunion': '#92400E',
            'en_progreso': '#FF9500', 'procesado': '#34C759', 'cerrado_ganado': '#30D158', 'cerrado_perdido': '#FF3B30'
        };

        function _renderSubProspecciones(items) {
            if (!items || !items.length) {
                return '<div class="ck-sub-empty">Sin prospecciones para este cliente en el periodo</div>';
            }
            var html = '<div class="ck-sub-wrap"><table class="ck-sub-table"><thead><tr>' +
                '<th class="ck-th--text">Prospección</th>' +
                '<th class="ck-th--text">Vendedor</th>' +
                '<th class="ck-th--text">Producto</th>' +
                '<th class="ck-th--text">Etapa</th>' +
                '<th class="ck-th--num">Creado</th>' +
                '<th class="ck-th--num">Actualizado</th>' +
            '</tr></thead><tbody>';
            items.forEach(function(p) {
                var col = _PROSP_ETAPA_COLOR[p.etapa] || '#8E8E93';
                html += '<tr class="ck-sub-row" data-prospecto-id="' + p.id + '" style="cursor:pointer;">' +
                    '<td class="ck-td--text" style="font-weight:600;color:#1D1D1F;">' + _escapeHtmlSimple(p.nombre || '—') + (p.oportunidad_creada_id ? ' <span style="margin-left:4px;font-size:9px;padding:1px 5px;border-radius:4px;background:#34C75922;color:#16A34A;font-weight:700;">OPP</span>' : '') + '</td>' +
                    '<td class="ck-td--text" style="color:#6e6e73;">' + _escapeHtmlSimple(p.vendedor || '') + '</td>' +
                    '<td class="ck-td--text">' + _escapeHtmlSimple(p.producto || '') + '</td>' +
                    '<td class="ck-td--text"><span style="background:' + col + '22;color:' + col + ';padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:700;white-space:nowrap;">' + _escapeHtmlSimple(p.etapa_label || '') + '</span></td>' +
                    '<td class="ck-td--num" style="color:#86868B;">' + _escapeHtmlSimple(p.fecha_creacion || '') + '</td>' +
                    '<td class="ck-td--num" style="color:#86868B;">' + _escapeHtmlSimple(p.fecha_actualizacion || '') + '</td>' +
                '</tr>';
            });
            html += '</tbody></table></div>';
            return html;
        }

        function _renderSubOportunidades(items) {
            if (!items || !items.length) {
                return '<div class="ck-sub-empty">Sin oportunidades convertidas para este cliente en el periodo</div>';
            }
            var html = '<div class="ck-sub-wrap"><table class="ck-sub-table"><thead><tr>' +
                '<th class="ck-th--text">Oportunidad</th>' +
                '<th class="ck-th--text">Vendedor</th>' +
                '<th class="ck-th--text">Producto</th>' +
                '<th class="ck-th--text">Etapa</th>' +
                '<th class="ck-th--num">Creado</th>' +
                '<th class="ck-th--num">Monto</th>' +
            '</tr></thead><tbody>';
            items.forEach(function(o) {
                html += '<tr class="ck-sub-row" data-oportunidad-id="' + o.id + '" style="cursor:pointer;">' +
                    '<td class="ck-td--text" style="font-weight:600;color:#007AFF;">' + _escapeHtmlSimple(o.descripcion || '—') + '</td>' +
                    '<td class="ck-td--text" style="color:#6e6e73;">' + _escapeHtmlSimple(o.vendedor || '') + '</td>' +
                    '<td class="ck-td--text">' + _escapeHtmlSimple(o.producto || '') + '</td>' +
                    '<td class="ck-td--text" style="color:#3C3C43;font-size:10px;">' + _escapeHtmlSimple(o.etapa || '—') + '</td>' +
                    '<td class="ck-td--num" style="color:#86868B;">' + _escapeHtmlSimple(o.fecha_creacion || '') + '</td>' +
                    '<td class="ck-td--num" style="color:#16A34A;font-weight:800;">' + _escapeHtmlSimple(o.monto_fmt || '$0') + '</td>' +
                '</tr>';
            });
            html += '</tbody></table></div>';
            return html;
        }

        function _ckExpandRow(tr) {
            if (!tr) return;
            var tipo = tr.getAttribute('data-prosp-tipo');
            var clienteId = tr.getAttribute('data-cliente-id');
            if (!clienteId) return;

            var tbody = tr.parentNode;
            // Si la fila siguiente ya es la expandida → colapsar
            var next = tr.nextElementSibling;
            if (next && next.classList && next.classList.contains('ck-row-expanded')) {
                next.remove();
                tr.classList.remove('ck-row-active');
                return;
            }
            // Colapsar otra fila expandida (solo una a la vez)
            tbody.querySelectorAll('tr.ck-row-expanded').forEach(function(r){ r.remove(); });
            tbody.querySelectorAll('tr.ck-row-active').forEach(function(r){ r.classList.remove('ck-row-active'); });

            var ncols = tr.cells ? tr.cells.length : 5;
            var detailRow = document.createElement('tr');
            detailRow.className = 'ck-row-expanded';
            detailRow.innerHTML = '<td colspan="' + ncols + '"><div class="ck-row-loading">Cargando…</div></td>';
            tr.parentNode.insertBefore(detailRow, tr.nextSibling);
            tr.classList.add('ck-row-active');

            var url;
            var qs = _ckPeriodQS();
            if (tipo === 'opps') {
                url = '/app/api/dashboard/prospectos/cliente/' + clienteId + '/oportunidades-convertidas/?' + qs;
            } else {
                url = '/app/api/dashboard/prospectos/cliente/' + clienteId + '/prospecciones/?' + qs;
            }

            fetch(url, { credentials: 'same-origin' })
                .then(function(r){ return r.json(); })
                .then(function(resp) {
                    var items = (resp && resp.rows) || [];
                    var cell = detailRow.querySelector('td');
                    if (!cell) return;
                    cell.innerHTML = (tipo === 'opps')
                        ? _renderSubOportunidades(items)
                        : _renderSubProspecciones(items);
                    // Bind clicks on items (prospecto / oportunidad)
                    cell.querySelectorAll('[data-prospecto-id]').forEach(function(el) {
                        el.addEventListener('click', function(ev) {
                            ev.stopPropagation();
                            var pid = parseInt(this.getAttribute('data-prospecto-id'));
                            if (typeof window.abrirWidgetProspecto === 'function') {
                                window.abrirWidgetProspecto(pid);
                            } else {
                                console.warn('[CK] abrirWidgetProspecto no disponible (verificar carga de crm_prospeccion.js)');
                            }
                        });
                    });
                    cell.querySelectorAll('[data-oportunidad-id]').forEach(function(el) {
                        el.addEventListener('click', function(ev) {
                            ev.stopPropagation();
                            var oid = parseInt(this.getAttribute('data-oportunidad-id'));
                            if (typeof window.openDetalle === 'function') {
                                window.openDetalle(oid);
                            } else {
                                console.warn('[CK] openDetalle no disponible');
                            }
                        });
                    });
                })
                .catch(function() {
                    var cell = detailRow.querySelector('td');
                    if (cell) cell.innerHTML = '<div class="ck-sub-empty" style="color:#FF3B30;">Error al cargar.</div>';
                });
        }

        // Delegated click handler para filas drill-down dentro del detalle
        document.addEventListener('click', function(ev) {
            var tr = ev.target.closest && ev.target.closest('tr.ck-prosp-row');
            if (tr && document.getElementById('ckDetalleTbody') && document.getElementById('ckDetalleTbody').contains(tr)) {
                _ckExpandRow(tr);
                return;
            }
            // Click directo en filas de "ventas detalle" (oportunidad simple)
            var oppTr = ev.target.closest && ev.target.closest('tr.ck-prosp-opp-row');
            if (oppTr && document.getElementById('ckDetalleTbody') && document.getElementById('ckDetalleTbody').contains(oppTr)) {
                var oid = parseInt(oppTr.getAttribute('data-oportunidad-id'));
                if (oid && typeof window.openDetalle === 'function') {
                    window.openDetalle(oid);
                }
            }
        });

        function abrirDesgloseCotizaciones() {
            var vendedores = getVendedoresParam();
            var url = '/app/api/desglose-cotizaciones/?mes=' + currentMes + '&anio=' + currentAnio;
            if (vendedores) url += '&vendedores=' + vendedores;

            // Use the clientesDetalleOverlay to show desglose
            var overlay = document.getElementById('clientesDetalleOverlay');
            if (!overlay) return;
            var titulo = document.getElementById('clientesDetalleTitulo');
            var statsEl = document.getElementById('clientesDetalleStats');
            var thead = document.getElementById('clientesDetalleThead');
            var tbody = document.getElementById('clientesDetalleTbody');

            if (titulo) titulo.textContent = 'Cotizaciones Creadas — Desglose por Cliente';
            if (thead) thead.innerHTML =
                '<tr class="text-[9px] text-gray-400 uppercase tracking-widest border-b border-gray-100">' +
                '<th class="px-2 py-3 text-left font-black" style="width:5%">#</th>' +
                '<th class="px-2 py-3 text-left font-black" style="width:45%">Cliente</th>' +
                '<th class="py-3 pr-2 text-right font-black text-blue-600" style="width:25%">Cotizaciones</th>' +
                '<th class="py-3 pr-2 text-right font-black text-gray-700" style="width:25%">Monto Total</th>' +
                '</tr>';
            if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="text-center py-20 text-gray-400 italic">Cargando...</td></tr>';
            if (statsEl) statsEl.textContent = 'Cargando desglose...';
            overlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';

            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data.ok || !data.rows || data.rows.length === 0) {
                        if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="text-center py-20 text-gray-400 italic">Sin datos.</td></tr>';
                        if (statsEl) statsEl.textContent = '0 cotizaciones';
                        return;
                    }
                    var html = '';
                    for (var i = 0; i < data.rows.length; i++) {
                        var r = data.rows[i];
                        var fmtMonto = '$' + Number(r.monto_total).toLocaleString('en-US', { maximumFractionDigits: 0 });
                        html += '<tr class="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">' +
                            '<td class="px-2 py-3 text-gray-400 text-xs">' + (i + 1) + '</td>' +
                            '<td class="px-2 py-3 font-semibold text-gray-800 text-xs">' + (r.cliente || 'Sin Cliente') + '</td>' +
                            '<td class="py-3 pr-2 text-right font-black text-blue-600 text-sm">' + r.num_cotizaciones + '</td>' +
                            '<td class="py-3 pr-2 text-right font-medium text-gray-600 text-xs">' + fmtMonto + '</td>' +
                            '</tr>';
                    }
                    if (tbody) tbody.innerHTML = html;
                    if (statsEl) statsEl.textContent = 'Total: ' + data.total + ' cotizaciones';
                })
                .catch(function(err) {
                    console.error('Error fetching desglose cotizaciones:', err);
                    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="text-center py-20 text-red-400 italic">Error al cargar.</td></tr>';
                });
        }

        // Setter para la navegación in-place (crm_nav_v2.js): el periodo vive
        // en closures de este archivo; sin esto, refreshCrmTable consultaría
        // el periodo viejo tras un cambio de filtros sin recarga.
        window._crmSetPeriodo = function (mes, anio, tab) {
            if (mes != null) currentMes = String(mes);
            if (anio != null) currentAnio = String(anio);
            if (tab != null) currentTab = String(tab);
        };

        function refreshCrmTable() {
            if (currentTab === 'clientes') {
                loadAllClientesPanels();
                return;
            }
            var vendedores = getVendedoresParam();
            var url = '/app/api/crm-table-data/?tab=' + currentTab + '&mes=' + currentMes + '&anio=' + currentAnio;
            if (vendedores) url += '&vendedores=' + vendedores;
            fetch(url)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var tbody = document.getElementById('crmTbody');
                    if (!tbody) return;

                    if (data.rows.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="14" class="text-center py-20 text-gray-400 italic">No hay datos disponibles para este periodo.</td></tr>';
                    } else {
                        var html = '';
                        for (var i = 0; i < data.rows.length; i++) {
                            html += buildCrmRow(data.rows[i]);
                        }
                        tbody.innerHTML = html;
                        if (typeof populateEtapaDatalist === 'function') populateEtapaDatalist();
                    }

                    document.getElementById('footerLeft').textContent = data.footer.left;
                    document.getElementById('footerRight').textContent = data.footer.right;

                    if (data.total_facturado !== undefined) {
                        var fa = document.getElementById('facturadoAmount');
                        if (fa) fa.textContent = '$' + data.total_facturado;
                    }
                    if (data.meta !== undefined) {
                        var md = document.getElementById('metaDisplay');
                        if (md) md.textContent = 'META: $' + data.meta;
                    }
                    if (data.progreso !== undefined) {
                        var pf = document.getElementById('progressFill');
                        if (pf) pf.style.width = data.progreso + '%';
                        var pct = document.getElementById('progressPct');
                        if (pct) {
                            pct.textContent = data.progreso + '%';
                            if (data.progreso >= 100) pct.classList.add('green');
                            else pct.classList.remove('green');
                        }
                    }
                    if (data.vista_label !== undefined) {
                        var lbl = document.getElementById('topbarTotalLabel');
                        if (lbl) lbl.textContent = data.vista_label;
                    }

                    bindTableEvents();
                    populateIslandFilters();

                    // ── Sync reactivo: actualizar cards/rows SSR con datos frescos del API ──
                    // Esto permite que cambios (completar tarea, etc.) se reflejen sin
                    // recargar la página.
                    try {
                    var _apiMap = {};
                    (data.rows || []).forEach(function(r){ _apiMap[String(r.id)] = r; });
                    var _heatCls = ['card-vencida','heat-1','heat-2','heat-3','heat-4','heat-5','heat-max'];
                    var _warmCls = ['warm-1','warm-2','warm-3','warm-4','warm-5'];
                    var _hadHealing = false;
                    // Normalizar lookup: dataset.oppId puede venir como "1,198" (Django
                    // USE_THOUSAND_SEPARATOR) o con whitespace — strip antes de matchear
                    // contra _apiMap cuyas keys son "1198" (JSON int).
                    function _normId(s){
                        return (s || '').replace(/\s/g, '').replace(/\u00A0/g, '').replace(/,/g, '');
                    }
                    // Pickers granulares por minutos (más preciso que días cuando
                    // una actividad vence en la próxima hora).
                    //  heat: tiempo desde que venció
                    //  warm: tiempo hasta que vence
                    function _pickHeat(minsV) {
                        // minsV = minutos transcurridos desde que venció
                        var dias = Math.floor(minsV / 1440);
                        if (dias >= 30) return 'heat-max';
                        if (dias >= 14) return 'heat-5';
                        if (dias >= 7)  return 'heat-4';
                        if (dias >= 3)  return 'heat-3';
                        if (dias >= 1)  return 'heat-2';
                        return 'heat-1';
                    }
                    function _pickWarm(minsH) {
                        // minsH = minutos hasta que vence (positivo si en el futuro)
                        if (minsH === null || minsH === undefined || minsH < 0) return null;
                        if (minsH > 20160) return null;       // > 14 días
                        if (minsH > 10080) return 'warm-1';   // 7-14 días
                        if (minsH > 2880)  return 'warm-2';   // 2-7 días
                        if (minsH > 720)   return 'warm-3';   // 12-48 horas
                        if (minsH > 60)    return 'warm-4';   // 1-12 horas
                        return 'warm-5';                      // <= 1 hora (inminente)
                    }

                    document.querySelectorAll('.crm-data-row[data-opp-id]').forEach(function(el){
                        var apiRow = _apiMap[_normId(el.dataset.oppId)];
                        if (!apiRow) return;
                        var wasVencida = el.dataset.vencida === '1';
                        var nowVencida = !!apiRow.tiene_actividad_vencida;
                        var diasV = apiRow.dias_vencida || 0;
                        var minsV = (apiRow.minutos_vencida === undefined || apiRow.minutos_vencida === null)
                            ? diasV * 1440 : apiRow.minutos_vencida;
                        var diasH = (apiRow.dias_hasta_proxima === null || apiRow.dias_hasta_proxima === undefined) ? null : apiRow.dias_hasta_proxima;
                        var minsH = (apiRow.minutos_hasta_proxima === null || apiRow.minutos_hasta_proxima === undefined)
                            ? (diasH !== null ? diasH * 1440 : null)
                            : apiRow.minutos_hasta_proxima;

                        // Sincronizar data-attributes
                        el.dataset.vencida = nowVencida ? '1' : '0';
                        el.dataset.diasVencida = String(diasV);
                        el.dataset.diasHastaProxima = diasH !== null ? String(diasH) : '-1';

                        // Recalcular clases heat / warm según minutos (granularidad fina:
                        // una actividad que vence en 2 min se ve casi roja; una que vence
                        // en 12 días apenas un tinte. Gradient progresivo sin reload)
                        _heatCls.forEach(function(c){ el.classList.remove(c); });
                        _warmCls.forEach(function(c){ el.classList.remove(c); });
                        if (nowVencida) {
                            el.classList.add('card-vencida');
                            el.classList.add(_pickHeat(minsV));
                        } else {
                            var warmCls = _pickWarm(minsH);
                            if (warmCls) el.classList.add(warmCls);
                        }

                        // El bloque original continúa abajo para heal / strip / circle
                        if (!nowVencida) {
                            var strip = el.querySelector('.crm-list-strip');
                            if (strip) {
                                strip.className = 'crm-list-strip ' +
                                    ((apiRow.tipo_negociacion || 'runrate') === 'proyecto' ? 'proyecto' : 'runrate');
                            }
                            // Restaurar color del círculo de progreso (stroke inline del SSR
                            // se queda rojo; lo volvemos al color de etapa guardado en data-etapa-color).
                            var circle = el.querySelector('.crm-progress-circle');
                            if (circle) {
                                var wrap = circle.closest('[data-etapa-color]');
                                var defStroke = (wrap && wrap.dataset.etapaColor) || '#3B82F6';
                                circle.setAttribute('stroke', defStroke);
                            }
                            // Ícono de alerta crítica: fade-out vía CSS (crmHealAlertFade 0.5s),
                            // luego display:none para que no ocupe layout.
                            var alertIcon = el.querySelector('.crm-alert-critical');
                            if (alertIcon) {
                                setTimeout(function(){ alertIcon.style.display = 'none'; }, 520);
                            }
                        }
                        // Healing animation: de vencida → no vencida.
                        // Limpieza al final busca por oppId para cubrir clones nuevos
                        // del kanban creados por el render inmediato de abajo.
                        if (wasVencida && !nowVencida) {
                            _hadHealing = true;
                            var _oid = el.dataset.oppId;
                            el.classList.add('crm-healing');
                            setTimeout(function(){
                                document.querySelectorAll('.crm-data-row[data-opp-id="' + _oid + '"]').forEach(function(n){
                                    n.classList.remove('crm-healing');
                                });
                            }, 950);
                        }
                    });
                    // Render kanban INMEDIATAMENTE: los clones se regeneran desde los
                    // originales que ya tienen card-vencida/heat-* removidas (+ crm-healing).
                    // Evita el estado "rojo atrapado" durante la animación.
                    if (typeof window._crmRenderKanban === 'function') {
                        var kvImm = document.getElementById('crmViewKanban');
                        if (kvImm && kvImm.style.display !== 'none') window._crmRenderKanban();
                    }
                    // Re-sort/re-filter al finalizar el fade (0.9s) para que el usuario
                    // vea el rojo desvanecer y luego la tarjeta reacomodarse bajo las rojas.
                    setTimeout(function(){
                        if (typeof applySortToViews === 'function') applySortToViews();
                        if (typeof window._applyFiltersToCards === 'function') window._applyFiltersToCards();
                        // Render final del kanban para reflejar el nuevo orden post-sort.
                        if (typeof window._crmRenderKanban === 'function') {
                            var kvFin = document.getElementById('crmViewKanban');
                            if (kvFin && kvFin.style.display !== 'none') window._crmRenderKanban();
                        }
                    }, _hadHealing ? 950 : 50);
                    } catch(syncErr) { console.error('[CRM] sync error:', syncErr); }
                })
                .catch(function (err) { console.error('Error refreshing table:', err); });
        }

        function bindTableEvents() {
            // Re-bind opp-name-link clicks
            document.querySelectorAll('.opp-name-link').forEach(function (el) {
                el.addEventListener('click', function () {
                    var oppId = this.getAttribute('data-oportunidad-id');
                    if (oppId) openDetalle(oppId);
                });
            });
            // Re-bind cotizar buttons
            document.querySelectorAll('.btn-cotizar-widget').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    var oppId = this.getAttribute('data-oportunidad-id');
                    if (oppId) openCotizador(oppId);
                });
            });
        }

        // Refrescar tabla al cargar para aplicar colores (rojo, etc.) via JS
        refreshCrmTable();

        // Track if a cotización was created to refresh on close
        var cotizacionCreated = false;

        window.addEventListener('message', function (e) {
            if (e.data && e.data.type === 'cotizacion-created') {
                cotizacionCreated = true;
                _crmTableDirty = true;
                if (typeof currentOppId !== 'undefined' && currentOppId && typeof openDetalle === 'function') {
                    openDetalle(currentOppId);
                }
            }
            // Una tarea abierta en ventana-iframe (widget_tarea_page) se completó/
            // aplazó/reabrió → el iframe nos pide refrescar las notificaciones del
            // escritorio para que su notif de vencimiento (ya borrada en el server)
            // desaparezca al instante del cajón abierto, sin esperar el poll.
            if (e.data && e.data.type === 'notif-refresh') {
                if (typeof window.notifLoad === 'function') window.notifLoad();
            }
        });

        // "Cotizar" buttons in table (initial bind)
        document.querySelectorAll('.btn-cotizar-widget').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                var oppId = this.getAttribute('data-oportunidad-id');
                if (oppId) openCotizador(oppId);
            });
        });

        // ── Global Escape key ──
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (adminOverlay && adminOverlay.classList.contains('active')) { adminOverlay.classList.add('closing'); setTimeout(function () { adminOverlay.classList.remove('active', 'closing'); }, 250); return; }
                if (cotizadorOverlay.classList.contains('active')) { closeCotizador(); return; }
                if (detalleOverlay.classList.contains('active')) { closeDetalleWidget(); return; }
            }
        });

        // ── Search bar filter (global: busca en todos los años vía API) ──
        var searchInput = document.getElementById('islandSearch');
        var _searchTimer = null;
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                var q = this.value.trim();
                clearTimeout(_searchTimer);
                if (!q) {
                    // Sin query: restaurar tabla normal con filtros de mes/año
                    refreshCrmTable();
                    return;
                }
                // Con query: llamar API sin mes/año
                _searchTimer = setTimeout(function () {
                    var vendedores = getVendedoresParam();
                    var url = '/app/api/crm-table-data/?tab=' + currentTab + '&q=' + encodeURIComponent(q);
                    if (vendedores) url += '&vendedores=' + vendedores;
                    fetch(url).then(function (r) { return r.json(); }).then(function (data) {
                        var tbody = document.getElementById('crmTbody');
                        if (!tbody) return;
                        if (!data.rows || data.rows.length === 0) {
                            tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:2rem;color:#9CA3AF;">Sin resultados para "' + q + '"</td></tr>';
                        } else {
                            tbody.innerHTML = data.rows.map(buildCrmRow).join('');
                        }
                        if (data.footer) {
                            var fl = document.getElementById('footerLeft');
                            var fr = document.getElementById('footerRight');
                            if (fl) fl.textContent = data.footer.left;
                            if (fr) fr.textContent = data.footer.right;
                        }
                    }).catch(function (err) {
                        console.error('[CRM] búsqueda tabla:', err);
                        var tbody = document.getElementById('crmTbody');
                        if (tbody) tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:2rem;color:#DC2626;">Error al buscar. Revisa tu conexión e inténtalo de nuevo.</td></tr>';
                    });
                }, 350);
            });
        }

        // Vendor filter movido a script independiente arriba

        // ── XLS Upload (supervisor only) ──
        try {
            var btnUpload = document.getElementById('btnUploadXls');
            var fileInput = document.getElementById('xlsFileInput');
            if (btnUpload && fileInput) {
                btnUpload.addEventListener('click', function () {
                    fileInput.click();
                });
                fileInput.addEventListener('change', function () {
                    if (!this.files || !this.files[0]) return;
                    var file = this.files[0];
                    var fd = new FormData();
                    fd.append('archivo', file);
                    fd.append('mes', currentMes);
                    fd.append('anio', currentAnio);

                    btnUpload.textContent = 'Subiendo...';
                    btnUpload.disabled = true;

                    fetch('/app/api/subir-facturacion/', {
                        method: 'POST',
                        headers: { 'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]').value },
                        body: fd
                    })
                        .then(function (r) { return r.json(); })
                        .then(function (data) {
                            btnUpload.textContent = 'Subir Facturación';
                            btnUpload.disabled = false;
                            fileInput.value = '';

                            if (data.success) {
                                // Update the facturado amount
                                var fa = document.getElementById('facturadoAmount');
                                if (fa) fa.textContent = '$' + Number(data.total_facturado).toLocaleString('en-US', { maximumFractionDigits: 0 });

                                // Refresh table to update progress bar
                                refreshCrmTable();

                                // Show toast
                                var toast = document.createElement('div');
                                toast.className = 'wo-toast';
                                toast.textContent = 'Facturación actualizada: $' + Number(data.total_facturado).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' (' + data.num_clientes + ' clientes)';
                                document.body.appendChild(toast);
                                setTimeout(function () { toast.classList.add('show'); }, 10);
                                setTimeout(function () { toast.classList.remove('show'); setTimeout(function () { toast.remove(); }, 300); }, 3000);
                            } else {
                                alert('Error: ' + (data.error || 'Error desconocido'));
                            }
                        })
                        .catch(function (err) {
                            btnUpload.textContent = 'Subir Facturación';
                            btnUpload.disabled = false;
                            fileInput.value = '';
                            alert('Error de conexión');
                        });
                });
            }
        } catch (e) { console.error('Widget/Upload Error', e); }

        // ═══════════════════════════════════════════
        // ══  ADMIN PANEL  ═════════════════════════
        // ═══════════════════════════════════════════
        // La navegación y carga de secciones la maneja _widget_admin.html
        // Aquí solo controlamos abrir/cerrar el overlay
        try {
            var adminOverlay = document.getElementById('adminOverlay');
            var btnAdmin = document.getElementById('btnAdminPanel');
            var adminClose = document.getElementById('adminClose');

            if (btnAdmin && adminOverlay) {
                btnAdmin.addEventListener('click', function () {
                    adminOverlay.classList.add('active');
                    adminOverlay.classList.remove('closing');
                    // Load first section via _widget_admin.html's loadAdminSection
                    var firstBtn = adminOverlay.querySelector('.admin-nav-item.active');
                    if (firstBtn && typeof loadAdminSection === 'function') {
                        loadAdminSection(firstBtn.getAttribute('data-section'));
                    }
                });

                adminClose.addEventListener('click', function () {
                    adminOverlay.classList.add('closing');
                    setTimeout(function () { adminOverlay.classList.remove('active', 'closing'); }, 250);
                });
                adminOverlay.addEventListener('click', function (e) {
                    if (e.target === adminOverlay) {
                        adminOverlay.classList.add('closing');
                        setTimeout(function () { adminOverlay.classList.remove('active', 'closing'); }, 250);
                    }
                });
            }

        } catch (e) { console.error('Admin Error', e); }


        // ═══════════════════════════════════════════════════════════
        // WIDGET: OPORTUNIDADES / COTIZACIONES / COBRADO POR CLIENTE
        // ═══════════════════════════════════════════════════════════

        try {
            var widgetClienteOpp = document.getElementById('widgetClienteOportunidades');
            var clienteOppClose = document.getElementById('clienteOppClose');
            var clienteOppTitle = document.getElementById('clienteOppTitle');
            var clienteOppTbody = document.getElementById('clienteOppTbody');
            var clienteOppSearch = document.getElementById('clienteOppSearch');
            var clienteOppFilterArea = document.getElementById('clienteOppFilterArea');
            var clienteOppFilterProducto = document.getElementById('clienteOppFilterProducto');
            // Periodo unificado (pill estilo Dashboard)
            var clienteOppPeriodPill = document.getElementById('clienteOppPeriodPill');
            var clienteOppPeriodPop = document.getElementById('clienteOppPeriodPop');
            var clienteOppPeriodLabel = document.getElementById('clienteOppPeriodLabel');
            var clienteOppPeriodAniosList = document.getElementById('clienteOppPeriodAniosList');
            var clienteOppPeriodMesesList = document.getElementById('clienteOppPeriodMesesList');
            var clienteOppPeriodReset = document.getElementById('clienteOppPeriodReset');
            var clienteOppPeriodApply = document.getElementById('clienteOppPeriodApply');
            var _clienteOppMes = '';   // '' = todos, '01'…'12'
            var _clienteOppAnio = '';  // '' = todos, '2026' etc.
            // Llena los años (3 atrás + actual + 1 adelante)
            if (clienteOppPeriodAniosList && clienteOppPeriodAniosList.querySelectorAll('[data-anio]').length <= 1) {
                var nowY = new Date().getFullYear();
                for (var y = nowY + 1; y >= nowY - 3; y--) {
                    var b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'wco-period-item';
                    b.dataset.anio = String(y);
                    b.textContent = String(y);
                    clienteOppPeriodAniosList.appendChild(b);
                }
            }
            var MES_NAMES = {'01':'Enero','02':'Febrero','03':'Marzo','04':'Abril','05':'Mayo','06':'Junio','07':'Julio','08':'Agosto','09':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre'};
            function _refreshPeriodLabel(){
                var mPart = _clienteOppMes ? MES_NAMES[_clienteOppMes] : 'Todos';
                var aPart = _clienteOppAnio || 'Todos';
                if (clienteOppPeriodLabel) clienteOppPeriodLabel.textContent = mPart + ' · ' + aPart;
                if (clienteOppPeriodPill) clienteOppPeriodPill.classList.toggle('is-default', !_clienteOppMes && !_clienteOppAnio);
            }
            function _markActive(list, attr, val){
                if (!list) return;
                list.querySelectorAll('[data-' + attr + ']').forEach(function(b){
                    b.classList.toggle('is-active', b.dataset[attr] === val);
                });
            }
            function _refreshPeriodActives(){
                _markActive(clienteOppPeriodMesesList, 'mes', _clienteOppMes);
                _markActive(clienteOppPeriodAniosList, 'anio', _clienteOppAnio);
            }
            // Click en pill → abre/cierra popover
            if (clienteOppPeriodPill) {
                clienteOppPeriodPill.addEventListener('click', function(e){
                    e.stopPropagation();
                    var open = clienteOppPeriodPop.style.display !== 'none';
                    clienteOppPeriodPop.style.display = open ? 'none' : 'block';
                });
            }
            // Click fuera cierra el popover (limitado al overlay)
            document.addEventListener('click', function(e){
                if (!clienteOppPeriodPop || clienteOppPeriodPop.style.display === 'none') return;
                if (e.target.closest('.wco-period-wrap')) return;
                clienteOppPeriodPop.style.display = 'none';
            });
            // Click en mes/año (selección simple, no múltiple)
            if (clienteOppPeriodMesesList) clienteOppPeriodMesesList.addEventListener('click', function(e){
                var b = e.target.closest('[data-mes]'); if (!b) return;
                _clienteOppMes = b.dataset.mes || '';
                _refreshPeriodActives();
            });
            if (clienteOppPeriodAniosList) clienteOppPeriodAniosList.addEventListener('click', function(e){
                var b = e.target.closest('[data-anio]'); if (!b) return;
                _clienteOppAnio = b.dataset.anio || '';
                _refreshPeriodActives();
            });
            if (clienteOppPeriodReset) clienteOppPeriodReset.addEventListener('click', function(){
                _clienteOppMes = ''; _clienteOppAnio = '';
                _refreshPeriodActives();
                _refreshPeriodLabel();
                clienteOppPeriodPop.style.display = 'none';
                _cargarTabActivo();
            });
            if (clienteOppPeriodApply) clienteOppPeriodApply.addEventListener('click', function(){
                _refreshPeriodLabel();
                clienteOppPeriodPop.style.display = 'none';
                _cargarTabActivo();
            });
            var clienteOppClearFilters = document.getElementById('clienteOppClearFilters');
            var clienteOppFiltersOpp = document.getElementById('clienteOppFiltersOpp');
            var clienteOppHeadOpp = document.getElementById('clienteOppHeadOpp');
            var clienteOppHeadCot = document.getElementById('clienteOppHeadCot');
            var clienteOppHeadProsp = document.getElementById('clienteOppHeadProsp');
            var clienteOppTabs = document.getElementById('clienteOppTabs');

            var currentClienteId = null;
            var currentMode = 'oportunidades'; // 'oportunidades' | 'cobrado' | 'cotizado' | 'prospecciones'
            var allClienteData = [];

            // ── Click en nombre de cliente ──
            document.addEventListener('click', function (e) {
                if (e.target.classList.contains('client-name-link')) {
                    var clienteId = e.target.getAttribute('data-cliente-id');
                    if (!clienteId) return;
                    var tab = e.target.getAttribute('data-tab') || 'crm';
                    var clienteNombre = e.target.textContent.trim();
                    openClienteModal(clienteId, clienteNombre, tab);
                }
                // Click en nombre de cliente desde tabla KPIs Clientes
                if (e.target.classList.contains('ck-client-name')) {
                    var clienteId = e.target.getAttribute('data-cliente-id');
                    if (!clienteId) return;
                    var clienteNombre = e.target.textContent.trim();
                    openClienteModal(clienteId, clienteNombre, 'crm', true);
                }
                // Click en fila de Detalle de Oportunidades
                var detalleRow = e.target.closest('.ck-detalle-row');
                if (detalleRow) {
                    var clienteId = detalleRow.getAttribute('data-cliente-id');
                    var clienteNombre = detalleRow.getAttribute('data-cliente-nombre');
                    if (clienteId && clienteNombre) {
                        openClienteModal(clienteId, clienteNombre, 'crm', true);
                    }
                }
            });

            // ── Cerrar widget ──
            if (clienteOppClose) {
                clienteOppClose.addEventListener('click', function () { widgetClienteOpp.style.display = 'none'; });
            }
            widgetClienteOpp.addEventListener('click', function (e) {
                if (e.target === widgetClienteOpp) widgetClienteOpp.style.display = 'none';
            });

            // ── Cambiar modo visual del widget ──
            function setWidgetMode(mode) {
                currentMode = mode;
                var isCot = (mode === 'cotizado');
                var isProsp = (mode === 'prospecciones');
                var isInfo = (mode === 'info');
                var isFact = (mode === 'facturacion');
                var hideTable = (isCot || isProsp || isInfo || isFact);
                if (clienteOppHeadOpp) clienteOppHeadOpp.style.display = hideTable ? 'none' : '';
                if (clienteOppHeadCot) clienteOppHeadCot.style.display = isCot ? '' : 'none';
                if (clienteOppHeadProsp) clienteOppHeadProsp.style.display = isProsp ? '' : 'none';
                if (clienteOppFiltersOpp) clienteOppFiltersOpp.style.display = (isCot || isProsp || isInfo || isFact) ? 'none' : '';
                // En modo "info" / "facturacion" ocultamos filters/búsqueda/periodo y la tabla; mostramos el panel correspondiente.
                var infoPanel = document.getElementById('clienteOppInfoPanel');
                var factPanel = document.getElementById('clienteOppFactPanel');
                var listWrap = document.getElementById('clienteOppListWrap');
                var filtersBar = document.querySelector('#widgetClienteOportunidades .wco-filters');
                if (listWrap) listWrap.style.display = (isInfo || isFact) ? 'none' : '';
                if (filtersBar) filtersBar.style.display = (isInfo || isFact) ? 'none' : '';
                if (infoPanel) infoPanel.style.display = isInfo ? 'block' : 'none';
                if (factPanel) factPanel.style.display = isFact ? 'block' : 'none';
                // Marcar tab activo
                if (clienteOppTabs) {
                    var tabKey = mode === 'cobrado' ? 'oportunidades' : mode;
                    clienteOppTabs.querySelectorAll('[data-cli-tab]').forEach(function(t){
                        t.classList.toggle('is-active', t.dataset.cliTab === tabKey);
                    });
                }
            }

            // Listeners de las tabs internas
            if (clienteOppTabs) {
                clienteOppTabs.addEventListener('click', function(e){
                    var t = e.target.closest('[data-cli-tab]');
                    if (!t || !currentClienteId) return;
                    var newMode = t.dataset.cliTab;
                    setWidgetMode(newMode);
                    _cargarTabActivo();
                });
            }
            function _cargarTabActivo(){
                if (!currentClienteId) return;
                // Tab "Información" — no usa la tabla; carga la carátula del cliente.
                if (currentMode === 'info') {
                    _cargarClienteInfo();
                    return;
                }
                // Tab "Facturación" — lista facturas (archivos) de todas las opps del cliente.
                if (currentMode === 'facturacion') {
                    _cargarClienteFacturas();
                    return;
                }
                // Periodo del modal — se aplica a los 3 tabs (op/cot/prosp).
                var mesQ = _clienteOppMes || '';
                var anioQ = _clienteOppAnio || '';
                function _withPeriodo(url){
                    var sep = url.indexOf('?') >= 0 ? '&' : '?';
                    var q = '';
                    if (mesQ) q += 'mes=' + encodeURIComponent(mesQ);
                    if (anioQ) q += (q ? '&' : '') + 'anio=' + encodeURIComponent(anioQ);
                    return q ? url + sep + q : url;
                }
                var url;
                if (currentMode === 'cotizado') {
                    url = _withPeriodo('/app/api/cliente-cotizaciones/' + currentClienteId + '/');
                } else if (currentMode === 'prospecciones') {
                    url = _withPeriodo('/app/api/cliente-prospecciones/' + currentClienteId + '/');
                } else {
                    url = '/app/api/cliente-oportunidades/' + currentClienteId + '/' + (currentMode === 'cobrado' ? '?tipo=cobrado' : '');
                    url = _withPeriodo(url);
                }
                clienteOppTbody.innerHTML = '<tr><td colspan="6" class="wco-empty">Cargando…</td></tr>';
                fetch(url)
                    .then(function(r){ return r.json(); })
                    .then(function(data){
                        allClienteData = (data && data.rows) || [];
                        renderClienteData();
                    }).catch(function(){
                        clienteOppTbody.innerHTML = '<tr><td colspan="6" class="wco-empty" style="color:#FF3B30;">Error al cargar</td></tr>';
                    });
            }

            // ── Tab "Facturación" (facturas de las opps del cliente) ──
            function _escapeFactHtml(s){
                if (s === undefined || s === null) return '';
                return String(s)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
            }
            function _cargarClienteFacturas(){
                var tbody = document.getElementById('clienteOppFactTbody');
                var empty = document.getElementById('clienteOppFactEmpty');
                var table = document.getElementById('clienteOppFactTable');
                var count = document.getElementById('clienteOppFactCount');
                if (!tbody) return;
                if (count) count.textContent = '…';
                if (empty) empty.style.display = 'none';
                if (table) table.style.display = '';
                tbody.innerHTML = '<tr><td colspan="6" class="wco-empty">Cargando…</td></tr>';
                fetch('/app/api/cliente-facturas/' + currentClienteId + '/')
                    .then(function(r){ return r.json(); })
                    .then(function(data){
                        var rows = (data && data.rows) || [];
                        if (count) count.textContent = String(rows.length);
                        if (!rows.length) {
                            tbody.innerHTML = '';
                            if (table) table.style.display = 'none';
                            if (empty) empty.style.display = 'flex';
                            return;
                        }
                        if (table) table.style.display = '';
                        if (empty) empty.style.display = 'none';
                        var html = '';
                        for (var i = 0; i < rows.length; i++) {
                            var r = rows[i];
                            var nombre = _escapeFactHtml(r.nombre || '—');
                            var oppTit = _escapeFactHtml(r.oportunidad_titulo || '—');
                            var oppHtml = oppTit;
                            if (r.oportunidad_id && r.oportunidad_url) {
                                oppHtml = '<a class="wco-fact-opp-link" href="' + _escapeFactHtml(r.oportunidad_url) + '">' + oppTit + '<span class="wco-fact-opp-id"> · #' + r.oportunidad_id + '</span></a>';
                            }
                            var fecha = _escapeFactHtml(r.fecha_subida_legible || '—');
                            var tamano = _escapeFactHtml(r.tamano_legible || '—');
                            var subido = _escapeFactHtml(r.subido_por || '—');
                            var dl = _escapeFactHtml(r.download_url || '#');
                            var pv = _escapeFactHtml(r.preview_url || '#');
                            html += '<tr class="wco-fact-row">' +
                                '<td class="wco-fact-name"><span class="wco-fact-ic">' +
                                    '<svg width="14" height="14" fill="none" stroke="#0052D4" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
                                '</span><span class="wco-fact-name-t" title="' + nombre + '">' + nombre + '</span></td>' +
                                '<td class="wco-fact-opp">' + oppHtml + '</td>' +
                                '<td class="wco-fact-fecha">' + fecha + '</td>' +
                                '<td class="wco-fact-size">' + tamano + '</td>' +
                                '<td class="wco-fact-by">' + subido + '</td>' +
                                '<td class="wco-fact-acts" style="text-align:right;">' +
                                    '<a class="wco-fact-act" href="' + pv + '" target="_blank" rel="noopener" title="Ver">' +
                                        '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
                                    '</a>' +
                                    '<a class="wco-fact-act wco-fact-act--dl" href="' + dl + '" title="Descargar">' +
                                        '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
                                    '</a>' +
                                '</td>' +
                            '</tr>';
                        }
                        tbody.innerHTML = html;
                    }).catch(function(){
                        if (count) count.textContent = '0';
                        tbody.innerHTML = '<tr><td colspan="6" class="wco-empty" style="color:#FF3B30;">Error al cargar</td></tr>';
                    });
            }

            // ── Modal: Subir factura manualmente ──
            var _wcoUploadBound = false;
            var _wcoUploadFileRef = null; // archivo seleccionado actualmente

            function _wcoUploadGetCsrf(){
                var name = 'csrftoken=';
                var parts = (document.cookie || '').split('; ');
                for (var i = 0; i < parts.length; i++) {
                    if (parts[i].indexOf(name) === 0) return parts[i].substring(name.length);
                }
                return '';
            }
            function _wcoUploadFormatSize(bytes){
                if (!bytes && bytes !== 0) return '—';
                var b = Number(bytes);
                if (isNaN(b) || b <= 0) return '—';
                var units = ['B','KB','MB','GB'];
                var i = 0;
                while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
                return b.toFixed(1) + ' ' + units[i];
            }
            function _wcoUploadShowError(msg){
                var el = document.getElementById('wcoUploadError');
                if (!el) return;
                if (!msg) {
                    el.style.display = 'none';
                    el.textContent = '';
                    return;
                }
                el.textContent = msg;
                el.style.display = 'block';
            }
            function _wcoUploadResetFile(){
                _wcoUploadFileRef = null;
                var input = document.getElementById('wcoUploadFile');
                if (input) input.value = '';
                var empty = document.getElementById('wcoUploadDropEmpty');
                var filebox = document.getElementById('wcoUploadDropFile');
                if (empty) empty.style.display = '';
                if (filebox) filebox.style.display = 'none';
            }
            function _wcoUploadSetFile(file){
                _wcoUploadFileRef = file || null;
                var empty = document.getElementById('wcoUploadDropEmpty');
                var filebox = document.getElementById('wcoUploadDropFile');
                var nameEl = document.getElementById('wcoUploadFileName');
                var sizeEl = document.getElementById('wcoUploadFileSize');
                if (!file) {
                    if (empty) empty.style.display = '';
                    if (filebox) filebox.style.display = 'none';
                    return;
                }
                if (empty) empty.style.display = 'none';
                if (filebox) filebox.style.display = 'flex';
                if (nameEl) nameEl.textContent = file.name || '—';
                if (sizeEl) sizeEl.textContent = _wcoUploadFormatSize(file.size);
            }
            function _wcoUploadCloseModal(){
                var overlay = document.getElementById('widgetSubirFactura');
                if (overlay) overlay.classList.remove('active');
                _wcoUploadResetFile();
                _wcoUploadShowError('');
                var btn = document.getElementById('wcoUploadSubmit');
                if (btn) {
                    btn.disabled = false;
                    btn.classList.remove('is-loading');
                    var lbl = btn.querySelector('.wco-upload-btn-label');
                    if (lbl) lbl.textContent = 'Subir';
                }
            }
            function _wcoUploadCargarOpps(){
                var sel = document.getElementById('wcoUploadOppSelect');
                if (!sel || !currentClienteId) return;
                sel.innerHTML = '<option value="">Cargando oportunidades…</option>';
                sel.disabled = true;
                fetch('/app/api/cliente-oportunidades/' + currentClienteId + '/')
                    .then(function(r){ return r.json(); })
                    .then(function(data){
                        var rows = (data && data.rows) || [];
                        if (!rows.length) {
                            sel.innerHTML = '<option value="">— Sin oportunidades —</option>';
                            sel.disabled = true;
                            return;
                        }
                        var html = '<option value="">— Selecciona una oportunidad —</option>';
                        for (var i = 0; i < rows.length; i++) {
                            var r = rows[i];
                            var titulo = (r.oportunidad || '—');
                            var monto = r.monto ? ' · $' + r.monto : '';
                            var fecha = r.fecha ? ' · ' + r.fecha : '';
                            var label = titulo + monto + fecha;
                            // Escape minimal para option text
                            label = label.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            html += '<option value="' + r.id + '">' + label + '</option>';
                        }
                        sel.innerHTML = html;
                        sel.disabled = false;
                    })
                    .catch(function(){
                        sel.innerHTML = '<option value="">Error al cargar oportunidades</option>';
                        sel.disabled = true;
                    });
            }
            function _wcoUploadOpen(){
                if (!currentClienteId) return;
                _wcoUploadShowError('');
                _wcoUploadResetFile();
                var overlay = document.getElementById('widgetSubirFactura');
                if (overlay) overlay.classList.add('active');
                _wcoUploadCargarOpps();
            }
            function _wcoUploadToast(msg){
                var t = document.createElement('div');
                t.className = 'wco-upload-toast';
                t.innerHTML = '<svg width="16" height="16" fill="none" stroke="#34D399" stroke-width="2.4" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span></span>';
                t.querySelector('span').textContent = msg || 'Factura subida';
                document.body.appendChild(t);
                requestAnimationFrame(function(){ t.classList.add('is-visible'); });
                setTimeout(function(){
                    t.classList.remove('is-visible');
                    setTimeout(function(){ if (t.parentNode) t.parentNode.removeChild(t); }, 250);
                }, 2200);
            }
            function _wcoUploadSubmit(){
                var sel = document.getElementById('wcoUploadOppSelect');
                var btn = document.getElementById('wcoUploadSubmit');
                if (!sel || !btn) return;
                var oppId = (sel.value || '').trim();
                if (!oppId) {
                    _wcoUploadShowError('Selecciona una oportunidad para asociar la factura.');
                    return;
                }
                if (!_wcoUploadFileRef) {
                    _wcoUploadShowError('Selecciona un archivo para subir.');
                    return;
                }
                if (!currentClienteId) {
                    _wcoUploadShowError('Cliente no identificado.');
                    return;
                }
                _wcoUploadShowError('');
                btn.disabled = true;
                btn.classList.add('is-loading');
                var lbl = btn.querySelector('.wco-upload-btn-label');
                if (lbl) lbl.textContent = 'Subiendo';

                var fd = new FormData();
                fd.append('oportunidad_id', oppId);
                fd.append('archivo', _wcoUploadFileRef);

                fetch('/app/api/cliente-facturas/' + currentClienteId + '/subir/', {
                    method: 'POST',
                    headers: { 'X-CSRFToken': _wcoUploadGetCsrf() },
                    body: fd,
                    credentials: 'same-origin'
                })
                .then(function(r){ return r.json().then(function(j){ return { status: r.status, body: j }; }); })
                .then(function(res){
                    if (res.status >= 200 && res.status < 300 && res.body && res.body.ok) {
                        _wcoUploadCloseModal();
                        _wcoUploadToast('Factura subida');
                        if (typeof _cargarClienteFacturas === 'function') _cargarClienteFacturas();
                    } else {
                        var err = (res.body && res.body.error) || ('Error ' + res.status);
                        _wcoUploadShowError(err);
                        btn.disabled = false;
                        btn.classList.remove('is-loading');
                        if (lbl) lbl.textContent = 'Subir';
                    }
                })
                .catch(function(){
                    _wcoUploadShowError('Error de red al subir el archivo.');
                    btn.disabled = false;
                    btn.classList.remove('is-loading');
                    if (lbl) lbl.textContent = 'Subir';
                });
            }
            function _wcoUploadBindOnce(){
                if (_wcoUploadBound) return;
                _wcoUploadBound = true;

                var addBtn = document.getElementById('clienteOppFactAddBtn');
                if (addBtn) addBtn.addEventListener('click', _wcoUploadOpen);

                var closeBtn = document.getElementById('wcoUploadClose');
                var cancelBtn = document.getElementById('wcoUploadCancel');
                if (closeBtn) closeBtn.addEventListener('click', _wcoUploadCloseModal);
                if (cancelBtn) cancelBtn.addEventListener('click', _wcoUploadCloseModal);

                var overlay = document.getElementById('widgetSubirFactura');
                if (overlay) {
                    overlay.addEventListener('click', function(e){
                        if (e.target === overlay) _wcoUploadCloseModal();
                    });
                }

                var submitBtn = document.getElementById('wcoUploadSubmit');
                if (submitBtn) submitBtn.addEventListener('click', _wcoUploadSubmit);

                var fileInput = document.getElementById('wcoUploadFile');
                if (fileInput) {
                    fileInput.addEventListener('change', function(e){
                        var f = e.target.files && e.target.files[0];
                        if (f) _wcoUploadSetFile(f);
                    });
                }

                var clearBtn = document.getElementById('wcoUploadFileClear');
                if (clearBtn) {
                    clearBtn.addEventListener('click', function(e){
                        e.stopPropagation();
                        e.preventDefault();
                        _wcoUploadResetFile();
                    });
                }

                // Drag & drop
                var drop = document.getElementById('wcoUploadDrop');
                if (drop) {
                    ['dragenter','dragover'].forEach(function(ev){
                        drop.addEventListener(ev, function(e){
                            e.preventDefault();
                            e.stopPropagation();
                            drop.classList.add('is-dragover');
                        });
                    });
                    ['dragleave','drop'].forEach(function(ev){
                        drop.addEventListener(ev, function(e){
                            e.preventDefault();
                            e.stopPropagation();
                            drop.classList.remove('is-dragover');
                        });
                    });
                    drop.addEventListener('drop', function(e){
                        var dt = e.dataTransfer;
                        if (dt && dt.files && dt.files.length) {
                            _wcoUploadSetFile(dt.files[0]);
                        }
                    });
                }
            }
            _wcoUploadBindOnce();

            // ── Tab "Información" (carátula del cliente) ──
            var _wciSaveBtnBound = false;
            function _wciCsrf(){
                var name = 'csrftoken=';
                var parts = (document.cookie || '').split('; ');
                for (var i = 0; i < parts.length; i++) {
                    if (parts[i].indexOf(name) === 0) return parts[i].substring(name.length);
                }
                return '';
            }
            function _wciSetField(id, val){ var el = document.getElementById(id); if (el) el.value = val || ''; }
            function _wciPaintMapaLink(){
                var inp = document.getElementById('wciMapaUrl');
                var a = document.getElementById('wciMapaLink');
                var empty = document.getElementById('wciMapaLinkEmpty');
                var url = (inp && inp.value || '').trim();
                if (url) {
                    var href = url;
                    if (!/^https?:\/\//i.test(href)) href = 'https://' + href;
                    if (a) {
                        a.href = href;
                        a.textContent = url;
                        a.style.display = 'inline-block';
                    }
                    if (empty) empty.style.display = 'none';
                } else {
                    if (a) { a.style.display = 'none'; a.removeAttribute('href'); a.textContent = ''; }
                    if (empty) empty.style.display = 'inline-block';
                }
            }
            function _wciSetText(id, val, hideIfEmpty){
                var el = document.getElementById(id); if (!el) return;
                el.textContent = val || '';
                var row = id === 'wciRfc' ? document.getElementById('wciRfcRow') :
                          id === 'wciCategoria' ? document.getElementById('wciCatRow') : null;
                if (row) row.style.display = (hideIfEmpty && !val) ? 'none' : 'block';
            }
            function _wciRenderLogo(url){
                var img = document.getElementById('wciLogoImg');
                var empty = document.getElementById('wciLogoEmpty');
                if (url) {
                    if (img) { img.src = url; img.style.display = 'block'; }
                    if (empty) empty.style.display = 'none';
                } else {
                    if (img) { img.src = ''; img.style.display = 'none'; }
                    if (empty) empty.style.display = 'flex';
                }
            }
            // ── Helpers para selectores inteligentes ──
            // Day picker: convierte una serialización JSON {dias:[],desde:'',hasta:''}
            // (o un string plano legacy) a los botones marcados + horas.
            // Día → nombre (capitalizado)
            var _WCI_DAY_ORDER = ['L','M','X','J','V','S','D'];
            var _WCI_DAY_NAMES = { L:'Lunes', M:'Martes', X:'Miércoles', J:'Jueves', V:'Viernes', S:'Sábado', D:'Domingo' };
            function _wciDiasFrase(dias){
                if (!dias || !dias.length) return '';
                // Ordenar según L,M,X,J,V,S,D
                var orden = dias.slice().sort(function(a, b){ return _WCI_DAY_ORDER.indexOf(a) - _WCI_DAY_ORDER.indexOf(b); });
                // Detectar si son consecutivos en _WCI_DAY_ORDER
                var idxs = orden.map(function(d){ return _WCI_DAY_ORDER.indexOf(d); });
                var consecutivos = idxs.length >= 2 && idxs.every(function(v, i){ return i === 0 || v === idxs[i-1] + 1; });
                if (consecutivos) {
                    return 'De ' + _WCI_DAY_NAMES[orden[0]] + ' a ' + _WCI_DAY_NAMES[orden[orden.length-1]];
                }
                if (orden.length === 1) return _WCI_DAY_NAMES[orden[0]];
                var nombres = orden.map(function(d){ return _WCI_DAY_NAMES[d]; });
                return nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length-1];
            }
            function _wciHoraFrase(desde, hasta){
                if (desde && hasta) return ' de ' + desde + ' a ' + hasta;
                if (desde) return ' a partir de ' + desde;
                if (hasta) return ' hasta ' + hasta;
                return '';
            }
            function _wciPaintScheduleRead(scope){
                var readEl = document.getElementById(scope === 'trabajo' ? 'wciTrabajoRead' : 'wciEntregaRead');
                if (!readEl) return;
                var dias = [];
                document.querySelectorAll('.wci-days[data-wci-days="' + scope + '"] .wci-day.is-on').forEach(function(b){
                    dias.push(b.dataset.day);
                });
                var d = (document.getElementById(scope === 'trabajo' ? 'wciTrabajoDesde' : 'wciEntregaDesde') || {}).value || '';
                var h = (document.getElementById(scope === 'trabajo' ? 'wciTrabajoHasta' : 'wciEntregaHasta') || {}).value || '';
                var frase = _wciDiasFrase(dias) + _wciHoraFrase(d, h);
                readEl.textContent = frase.trim();
            }
            function _wciSetSchedule(scope, raw){
                var parsed = null;
                if (raw) { try { parsed = JSON.parse(raw); } catch(e) { parsed = null; } }
                var dias = (parsed && Array.isArray(parsed.dias)) ? parsed.dias : [];
                var desde = (parsed && parsed.desde) || '';
                var hasta = (parsed && parsed.hasta) || '';
                document.querySelectorAll('.wci-days[data-wci-days="' + scope + '"] .wci-day').forEach(function(btn){
                    btn.classList.toggle('is-on', dias.indexOf(btn.dataset.day) >= 0);
                });
                var dEl = document.getElementById(scope === 'trabajo' ? 'wciTrabajoDesde' : 'wciEntregaDesde');
                var hEl = document.getElementById(scope === 'trabajo' ? 'wciTrabajoHasta' : 'wciEntregaHasta');
                if (dEl) dEl.value = desde;
                if (hEl) hEl.value = hasta;
                _wciPaintScheduleRead(scope);
            }
            function _wciGetSchedule(scope){
                var dias = [];
                document.querySelectorAll('.wci-days[data-wci-days="' + scope + '"] .wci-day.is-on').forEach(function(b){
                    dias.push(b.dataset.day);
                });
                var dEl = document.getElementById(scope === 'trabajo' ? 'wciTrabajoDesde' : 'wciEntregaDesde');
                var hEl = document.getElementById(scope === 'trabajo' ? 'wciTrabajoHasta' : 'wciEntregaHasta');
                var payload = { dias: dias, desde: (dEl && dEl.value) || '', hasta: (hEl && hEl.value) || '' };
                if (!dias.length && !payload.desde && !payload.hasta) return '';
                return JSON.stringify(payload);
            }
            // Facturación: rango "del día X al día Y de cada mes"
            function _wciFactPaintRead(desde, hasta){
                var el = document.getElementById('wciFactRead');
                if (!el) return;
                if (desde && hasta) el.textContent = 'Del ' + desde + ' al ' + hasta + ' de cada mes';
                else if (desde) el.textContent = 'Día ' + desde + ' de cada mes';
                else if (hasta) el.textContent = 'Hasta el ' + hasta + ' de cada mes';
                else el.textContent = '';
            }
            function _wciSetFact(raw){
                var parsed = null;
                if (raw) { try { parsed = JSON.parse(raw); } catch(e) { parsed = null; } }
                var desde = '', hasta = '';
                if (parsed) {
                    if (parsed.desde != null) desde = String(parsed.desde);
                    if (parsed.hasta != null) hasta = String(parsed.hasta);
                    // Compat con formato viejo {dias:[5,15,30]}: tomar min/max
                    if (!desde && !hasta && Array.isArray(parsed.dias) && parsed.dias.length) {
                        var nums = parsed.dias.map(function(d){ var n = parseInt(d, 10); return isNaN(n) ? null : n; }).filter(function(n){ return n != null; });
                        if (nums.length) { desde = String(Math.min.apply(null, nums)); hasta = String(Math.max.apply(null, nums)); }
                    }
                }
                var dEl = document.getElementById('wciFactDesde');
                var hEl = document.getElementById('wciFactHasta');
                if (dEl) dEl.value = desde;
                if (hEl) hEl.value = hasta;
                _wciFactPaintRead(desde, hasta);
            }
            function _wciGetFact(){
                var dEl = document.getElementById('wciFactDesde');
                var hEl = document.getElementById('wciFactHasta');
                var desde = (dEl && dEl.value) || '';
                var hasta = (hEl && hEl.value) || '';
                if (!desde && !hasta) return '';
                var payload = {};
                if (desde) payload.desde = parseInt(desde, 10);
                if (hasta) payload.hasta = parseInt(hasta, 10);
                return JSON.stringify(payload);
            }

            function _wciClearEditing(){
                var panel = document.getElementById('clienteOppInfoPanel');
                if (!panel) return;
                panel.classList.remove('has-editing');
                panel.querySelectorAll('.wco-info-card.is-editing, .wco-info-id-field.is-editing, .wco-info-id-photo.is-editing')
                    .forEach(function(el){ el.classList.remove('is-editing'); });
            }
            function _wciActivateField(field){
                if (!field) return;
                var panel = document.getElementById('clienteOppInfoPanel');
                if (panel) panel.classList.add('has-editing');
                field.classList.add('is-editing');
            }

            function _cargarClienteInfo(){
                var saved = document.getElementById('wciSavedHint');
                if (saved) saved.textContent = 'Cargando…';
                // Siempre vuelve a modo lectura al recargar.
                _wciClearEditing();
                fetch('/app/api/cliente-info/' + currentClienteId + '/')
                    .then(function(r){ return r.json(); })
                    .then(function(data){
                        if (!data || !data.ok) { if (saved) saved.textContent = 'Error al cargar'; return; }
                        var c = data.cliente || {};
                        _wciSetText('wciNombre', c.nombre || '—');
                        _wciSetText('wciRfc', c.rfc || '', true);
                        _wciRenderLogo(c.logo_url);
                        _wciSetField('wciUbicacion', c.ubicacion);
                        _wciSetField('wciMapaUrl', c.mapa_url);
                        _wciPaintMapaLink();
                        _wciSetSchedule('trabajo', c.horarios_trabajo);
                        // dias_entrega ahora es texto libre. Si por compatibilidad viejo
                        // venía como JSON, lo limpiamos para que el user lo reescriba.
                        var instrTxt = c.dias_entrega || '';
                        if (instrTxt && instrTxt.charAt(0) === '{') instrTxt = '';
                        _wciSetField('wciInstruccionesEntrega', instrTxt);
                        _wciSetFact(c.dias_facturacion);
                        _wciSetField('wciCobro', c.proceso_cobro);
                        _wciSetField('wciReglas', c.reglas_acceso);
                        _wciSetField('wciInfoExtra', c.info_adicional);
                        if (saved) saved.textContent = 'Estás editando información';
                    }).catch(function(){
                        if (saved) saved.textContent = 'Error de red';
                    });
                _wciCargarContactos();
                _wciBindOnce();
            }
            function _wciBindOnce(){
                if (_wciSaveBtnBound) return;
                _wciSaveBtnBound = true;
                // Toggle pills de días (sólo cuando el field está en edición) + repinte frase
                document.querySelectorAll('#widgetClienteOportunidades .wci-day').forEach(function(btn){
                    btn.addEventListener('click', function(){
                        var field = btn.closest('.wco-info-id-field');
                        if (!field || !field.classList.contains('is-editing')) return;
                        btn.classList.toggle('is-on');
                        var scope = btn.closest('.wci-days').dataset.wciDays;
                        if (scope) _wciPaintScheduleRead(scope);
                    });
                });
                // Repintar el resumen "Del X al Y" cuando cambian los inputs del rango
                ['wciFactDesde','wciFactHasta'].forEach(function(id){
                    var el = document.getElementById(id);
                    if (el) el.addEventListener('input', function(){
                        var d = (document.getElementById('wciFactDesde')||{}).value || '';
                        var h = (document.getElementById('wciFactHasta')||{}).value || '';
                        _wciFactPaintRead(d, h);
                    });
                });
                // Cuando cambia un input de tiempo, repinta el resumen legible
                ['wciTrabajoDesde','wciTrabajoHasta'].forEach(function(id){
                    var el = document.getElementById(id);
                    if (el) el.addEventListener('input', function(){ _wciPaintScheduleRead('trabajo'); });
                });
                // Click-to-edit: cada bloque entra en edición de forma independiente.
                var panel = document.getElementById('clienteOppInfoPanel');
                if (panel) {
                    panel.addEventListener('click', function(e){
                        if (e.target.closest('.wci-contactos')) return;
                        if (e.target.closest('.wco-info-savebar')) return;
                        var field = e.target.closest('.wco-info-card, .wco-info-id-field, .wco-info-id-photo');
                        if (!field) return;
                        if (field.classList.contains('is-editing')) return;
                        // Fields con data-no-edit no entran en edición por click directo.
                        if (field.hasAttribute('data-no-edit')) return;
                        _wciActivateField(field);
                        var input = e.target.closest('input, textarea');
                        if (input) {
                            setTimeout(function(){ input.focus(); }, 0);
                        } else {
                            var first = field.querySelector('textarea, input:not([type=file])');
                            if (first) setTimeout(function(){ first.focus(); }, 0);
                        }
                    });
                }
                // Repinta el link cuando se edita el input
                var mapaInp = document.getElementById('wciMapaUrl');
                if (mapaInp) mapaInp.addEventListener('input', _wciPaintMapaLink);

                // Lápiz "editar link" en el field de Google Maps
                var mapaEditBtn = document.getElementById('wciMapaEditBtn');
                if (mapaEditBtn) {
                    mapaEditBtn.addEventListener('click', function(e){
                        e.stopPropagation();
                        var field = mapaEditBtn.closest('.wco-info-id-field');
                        if (!field || field.classList.contains('is-editing')) return;
                        _wciActivateField(field);
                        var inp = document.getElementById('wciMapaUrl');
                        if (inp) setTimeout(function(){ inp.focus(); inp.select(); }, 0);
                    });
                }
                // Botón Cancelar
                var cancelBtn = document.getElementById('wciCancelBtn');
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', function(){
                        _cargarClienteInfo();
                    });
                }
                var saveBtn = document.getElementById('wciSaveBtn');
                var fileInput = document.getElementById('wciLogoFile');
                if (saveBtn) {
                    saveBtn.addEventListener('click', function(){
                        if (!currentClienteId) return;
                        var fd = new FormData();
                        fd.append('ubicacion', (document.getElementById('wciUbicacion') || {}).value || '');
                        fd.append('mapa_url', (document.getElementById('wciMapaUrl') || {}).value || '');
                        fd.append('horarios_trabajo', _wciGetSchedule('trabajo'));
                        fd.append('dias_entrega', (document.getElementById('wciInstruccionesEntrega') || {}).value || '');
                        fd.append('dias_facturacion', _wciGetFact());
                        fd.append('proceso_cobro', (document.getElementById('wciCobro') || {}).value || '');
                        fd.append('reglas_acceso', (document.getElementById('wciReglas') || {}).value || '');
                        fd.append('info_adicional', (document.getElementById('wciInfoExtra') || {}).value || '');
                        if (fileInput && fileInput.files && fileInput.files[0]) {
                            fd.append('logo', fileInput.files[0]);
                        }
                        var saved = document.getElementById('wciSavedHint');
                        if (saved) saved.textContent = 'Guardando…';
                        saveBtn.disabled = true;
                        fetch('/app/api/cliente-info/' + currentClienteId + '/', {
                            method: 'POST',
                            headers: { 'X-CSRFToken': _wciCsrf() },
                            body: fd,
                        }).then(function(r){ return r.json(); }).then(function(data){
                            saveBtn.disabled = false;
                            if (data && data.ok) {
                                if (saved) saved.textContent = 'Guardado';
                                if (data.cliente && data.cliente.logo_url) _wciRenderLogo(data.cliente.logo_url);
                                if (fileInput) fileInput.value = '';
                                // Vuelve a modo lectura tras guardar
                                _wciClearEditing();
                                setTimeout(function(){ if (saved && saved.textContent === 'Guardado') saved.textContent = ''; }, 2200);
                            } else {
                                if (saved) saved.textContent = 'Error al guardar';
                            }
                        }).catch(function(){
                            saveBtn.disabled = false;
                            if (saved) saved.textContent = 'Error de red';
                        });
                    });
                }
                if (fileInput) {
                    fileInput.addEventListener('change', function(){
                        if (fileInput.files && fileInput.files[0]) {
                            var reader = new FileReader();
                            reader.onload = function(e){ _wciRenderLogo(e.target.result); };
                            reader.readAsDataURL(fileInput.files[0]);
                        }
                    });
                }

                // ── Tablero de contactos ──
                var contactoAddBtn = document.getElementById('wciContactoAdd');
                if (contactoAddBtn) {
                    contactoAddBtn.addEventListener('click', function(e){
                        e.stopPropagation();
                        _wciContactoOpenModal(null);
                    });
                }
                var contClose = document.getElementById('wciContClose');
                var contCancel = document.getElementById('wciContCancel');
                var contSave = document.getElementById('wciContSave');
                var contOverlay = document.getElementById('widgetContacto');
                function _closeContModal(){ if (contOverlay) contOverlay.classList.remove('active'); }
                if (contClose) contClose.addEventListener('click', _closeContModal);
                if (contCancel) contCancel.addEventListener('click', _closeContModal);
                if (contOverlay) contOverlay.addEventListener('click', function(e){
                    if (e.target === contOverlay) _closeContModal();
                });
                if (contSave) {
                    contSave.addEventListener('click', function(){
                        var id = (document.getElementById('wciContId')||{}).value || '';
                        var nombre = (document.getElementById('wciContNombre')||{}).value.trim();
                        if (!nombre) { document.getElementById('wciContNombre').focus(); return; }
                        var fd = new FormData();
                        fd.append('nombre', nombre);
                        fd.append('apellido', (document.getElementById('wciContApellido')||{}).value || '');
                        fd.append('puesto', (document.getElementById('wciContPuesto')||{}).value || '');
                        fd.append('email', (document.getElementById('wciContEmail')||{}).value || '');
                        fd.append('telefono', (document.getElementById('wciContTel')||{}).value || '');
                        var url = id
                            ? '/app/api/cliente-contacto/' + id + '/'
                            : '/app/api/cliente-info/' + currentClienteId + '/contactos/';
                        contSave.disabled = true;
                        fetch(url, { method: 'POST', headers: { 'X-CSRFToken': _wciCsrf() }, body: fd })
                            .then(function(r){ return r.json(); })
                            .then(function(data){
                                contSave.disabled = false;
                                if (data && data.ok) {
                                    _closeContModal();
                                    _wciCargarContactos();
                                }
                            }).catch(function(){ contSave.disabled = false; });
                    });
                }
            }

            function _wciContactoOpenModal(c){
                document.getElementById('wciContTitle').textContent = c ? 'Editar contacto' : 'Nuevo contacto';
                document.getElementById('wciContId').value = c ? c.id : '';
                document.getElementById('wciContNombre').value = c ? (c.nombre || '') : '';
                document.getElementById('wciContApellido').value = c ? (c.apellido || '') : '';
                document.getElementById('wciContPuesto').value = c ? (c.puesto || '') : '';
                document.getElementById('wciContEmail').value = c ? (c.email || '') : '';
                document.getElementById('wciContTel').value = c ? (c.telefono || '') : '';
                document.getElementById('widgetContacto').classList.add('active');
                setTimeout(function(){ document.getElementById('wciContNombre').focus(); }, 50);
            }

            function _escapeHTML(s){
                return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
            }

            function _wciRenderContactos(rows){
                var track = document.getElementById('wciContactosTrack');
                var count = document.getElementById('wciContactosCount');
                if (!track) return;
                rows = rows || [];
                if (count) count.textContent = rows.length;
                track.classList.toggle('is-empty', rows.length === 0);
                if (!rows.length) {
                    track.innerHTML = '<div class="wci-contactos-empty" id="wciContactosEmpty">No hay contactos para este cliente. Agrega el primero.</div>';
                    return;
                }
                var html = '';
                rows.forEach(function(c){
                    var nombre = _escapeHTML((c.nombre || '') + (c.apellido ? ' ' + c.apellido : ''));
                    html += '<div class="wci-contacto-card" data-cid="' + c.id + '">' +
                        (c.puesto ? '<div class="wci-contacto-puesto">' + _escapeHTML(c.puesto) + '</div>' : '') +
                        '<div class="wci-contacto-name">' + (nombre || '—') + '</div>' +
                        (c.email ? '<div class="wci-contacto-meta"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg><a href="mailto:' + _escapeHTML(c.email) + '" style="color:inherit;text-decoration:none;">' + _escapeHTML(c.email) + '</a></div>' : '') +
                        (c.telefono ? '<div class="wci-contacto-meta"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' + _escapeHTML(c.telefono) + '</div>' : '') +
                        '<div class="wci-contacto-actions">' +
                        '  <button type="button" class="wci-contacto-act is-edit" title="Editar"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
                        '  <button type="button" class="wci-contacto-act is-del" title="Eliminar"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>' +
                        '</div>' +
                        '</div>';
                });
                track.innerHTML = html;
                // Bind actions
                track.querySelectorAll('.wci-contacto-card').forEach(function(card){
                    var cid = card.dataset.cid;
                    var c = rows.find(function(x){ return String(x.id) === String(cid); });
                    var editBtn = card.querySelector('.wci-contacto-act.is-edit');
                    var delBtn = card.querySelector('.wci-contacto-act.is-del');
                    if (editBtn) editBtn.addEventListener('click', function(e){ e.stopPropagation(); _wciContactoOpenModal(c); });
                    if (delBtn) delBtn.addEventListener('click', function(e){
                        e.stopPropagation();
                        if (!confirm('¿Eliminar el contacto "' + (c.nombre || '') + '"?')) return;
                        fetch('/app/api/cliente-contacto/' + cid + '/', {
                            method: 'DELETE',
                            headers: { 'X-CSRFToken': _wciCsrf() },
                        }).then(function(r){ return r.json(); }).then(function(d){
                            if (d && d.ok) _wciCargarContactos();
                        });
                    });
                });
            }

            function _wciCargarContactos(){
                if (!currentClienteId) return;
                fetch('/app/api/cliente-info/' + currentClienteId + '/contactos/')
                    .then(function(r){ return r.json(); })
                    .then(function(data){
                        if (data && data.ok) _wciRenderContactos(data.contactos || []);
                    });
            }

            // ── Abrir widget (también expuesta globalmente para que otras
            //    vistas — ej. el tab Clientes del Dashboard — la usen) ──
            window.openClienteModal = openClienteModal;
            function openClienteModal(clienteId, clienteNombre, tab, porCreacion) {
                currentClienteId = clienteId;
                allClienteData = [];
                var modeMap = { crm: 'oportunidades', cobrado: 'cobrado', cotizado: 'cotizado', info: 'info', prospecciones: 'prospecciones', facturacion: 'facturacion' };
                var mode = modeMap[tab] || 'oportunidades';
                var labelMap = { oportunidades: 'Oportunidades', cobrado: 'Cobrado', cotizado: 'Cotizaciones', info: 'Información', prospecciones: 'Prospecciones', facturacion: 'Facturación' };
                clienteOppTitle.textContent = labelMap[mode] + ' — ' + clienteNombre;
                widgetClienteOpp.style.display = 'flex';

                if (clienteOppSearch) clienteOppSearch.value = '';
                if (clienteOppFilterArea) clienteOppFilterArea.value = '';
                if (clienteOppFilterProducto) clienteOppFilterProducto.value = '';
                // Periodo arranca en "Todos · Todos" al abrir el modal
                _clienteOppMes = ''; _clienteOppAnio = '';
                _refreshPeriodActives(); _refreshPeriodLabel();
                setWidgetMode(mode);

                // Si entramos directo al tab Información o Facturación, carga su panel propio
                // (no la tabla de oportunidades).
                if (mode === 'info' || mode === 'facturacion') {
                    if (typeof _cargarTabActivo === 'function') _cargarTabActivo();
                    return;
                }

                var colspan = '6';
                clienteOppTbody.innerHTML = '<tr><td colspan="' + colspan + '" class="wco-empty">Cargando...</td></tr>';

                var url = mode === 'cotizado'
                    ? '/app/api/cliente-cotizaciones/' + clienteId + '/'
                    : '/app/api/cliente-oportunidades/' + clienteId + '/' + (mode === 'cobrado' ? '?tipo=cobrado' : '');

                // Si viene del tab Clientes, filtrar por fecha_creacion y mes/año actual
                if (porCreacion) {
                    var sep = url.indexOf('?') >= 0 ? '&' : '?';
                    var mesEl = document.getElementById('mesFilter');
                    var anioEl = document.getElementById('anioFilter');
                    var mesF = mesEl ? mesEl.value : '';
                    var anioF = anioEl ? anioEl.value : '';
                    url += sep + 'por_creacion=1';
                    if (mesF) url += '&mes=' + mesF;
                    if (anioF) url += '&anio=' + anioF;
                }

                fetch(url)
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        allClienteData = data.rows || [];
                        renderClienteData();
                    })
                    .catch(function (err) {
                        console.error('Error cargando datos cliente:', err);
                        clienteOppTbody.innerHTML = '<tr><td colspan="6" class="wco-empty" style="color:#FF3B30;">Error al cargar los datos</td></tr>';
                    });
            }

            // ── Renderizar filas según modo ──
            function renderClienteData() {
                var filtered = filterClienteData();

                if (filtered.length === 0) {
                    clienteOppTbody.innerHTML = '<tr><td colspan="6" class="wco-empty">No se encontraron registros</td></tr>';
                    return;
                }

                var html = '';
                if (currentMode === 'cotizado') {
                    filtered.forEach(function (cot) {
                        html += '<tr>';
                        html += '<td><a href="' + (cot.pdf_url || '#') + '" target="_blank" style="text-decoration:none;padding:2px 8px;background:rgba(0,122,255,0.08);border-radius:6px;font-family:monospace;font-weight:700;font-size:0.75rem;color:#007AFF;">COT-' + cot.id + '</a></td>';
                        html += '<td>' + truncate(cot.titulo || 'Cotizacion', 35) + '</td>';
                        html += '<td style="color:#8E8E93;font-size:0.75rem;">' + truncate(cot.oportunidad || '—', 30) + '</td>';
                        html += '<td style="color:#8E8E93;font-size:0.75rem;">' + (cot.fecha || '—') + '</td>';
                        html += '<td style="color:#8E8E93;font-size:0.75rem;">' + (cot.usuario || '—') + '</td>';
                        html += '<td style="text-align:right;font-weight:700;color:#007AFF;">$' + (cot.total || '0') + ' <span style="color:#8E8E93;font-weight:400;font-size:0.65rem;">' + (cot.moneda || '') + '</span></td>';
                        html += '</tr>';
                    });
                } else if (currentMode === 'prospecciones') {
                    filtered.forEach(function (p) {
                        var etapaBadge = '<span class="wco-prosp-etapa wco-prosp-etapa--' + (p.etapa || '') + '">' + (p.etapa_display || p.etapa) + '</span>';
                        html += '<tr data-prospecto-id="' + p.id + '">';
                        html += '<td><span class="wco-opp-name" data-prospecto-row-id="' + p.id + '">' + truncate(p.nombre || '—', 50) + '</span></td>';
                        html += '<td style="color:#6E6E73;">' + truncate(p.contacto || '—', 20) + '</td>';
                        html += '<td style="color:#8E8E93;font-size:0.75rem;">' + (p.area || '—') + '</td>';
                        html += '<td style="color:#8E8E93;font-size:0.75rem;">' + (p.producto || '—') + '</td>';
                        html += '<td>' + etapaBadge + '</td>';
                        html += '<td style="color:#8E8E93;font-size:0.75rem;">' + (p.vendedor || '—') + '</td>';
                        html += '</tr>';
                    });
                } else {
                    filtered.forEach(function (opp) {
                        var contactoNombre = opp.contacto ? opp.contacto.nombre : '-';
                        var monto = formatCurrency(opp.monto_raw !== undefined ? opp.monto_raw : parseFloat((opp.monto || '0').toString().replace(/,/g, '')) || 0);
                        var probabilidad = opp.probabilidad_cierre || 0;
                        html += '<tr data-opp-id="' + opp.id + '">';
                        html += '<td><span class="wco-opp-name" data-oportunidad-id="' + opp.id + '">' + truncate(opp.oportunidad, 50) + '</span></td>';
                        html += '<td style="color:#6E6E73;">' + truncate(contactoNombre, 20) + '</td>';
                        html += '<td style="color:#8E8E93;font-size:0.75rem;">' + (opp.area || '-') + '</td>';
                        html += '<td style="color:#8E8E93;font-size:0.75rem;">' + (opp.producto || '-') + '</td>';
                        html += '<td style="text-align:right;font-weight:700;color:#1D1D1F;">$' + monto + '</td>';
                        html += '<td style="text-align:center;"><span class="wco-prob">' + probabilidad + '%</span></td>';
                        html += '</tr>';
                    });
                }
                clienteOppTbody.innerHTML = html;
            }

            // ── Filtrar datos locales ──
            function filterClienteData() {
                var searchTerm = clienteOppSearch ? clienteOppSearch.value.toLowerCase() : '';
                var areaFilter = clienteOppFilterArea ? clienteOppFilterArea.value : '';
                var productoFilter = clienteOppFilterProducto ? clienteOppFilterProducto.value : '';

                return allClienteData.filter(function (item) {
                    if (currentMode === 'cotizado') {
                        return !searchTerm ||
                            (item.titulo && item.titulo.toLowerCase().includes(searchTerm)) ||
                            (item.oportunidad && item.oportunidad.toLowerCase().includes(searchTerm));
                    }
                    if (currentMode === 'prospecciones') {
                        return !searchTerm ||
                            (item.nombre && item.nombre.toLowerCase().includes(searchTerm)) ||
                            (item.contacto && item.contacto.toLowerCase().includes(searchTerm));
                    }
                    var matchSearch = !searchTerm ||
                        item.oportunidad.toLowerCase().includes(searchTerm) ||
                        (item.contacto && item.contacto.nombre.toLowerCase().includes(searchTerm));
                    var matchArea = !areaFilter || item.area === areaFilter;
                    var matchProducto = !productoFilter || item.producto === productoFilter;
                    return matchSearch && matchArea && matchProducto;
                });
            }

            if (clienteOppSearch) clienteOppSearch.addEventListener('input', renderClienteData);
            if (clienteOppFilterArea) clienteOppFilterArea.addEventListener('change', renderClienteData);
            if (clienteOppFilterProducto) clienteOppFilterProducto.addEventListener('change', renderClienteData);

            if (clienteOppClearFilters) {
                clienteOppClearFilters.addEventListener('click', function () {
                    if (clienteOppSearch) clienteOppSearch.value = '';
                    if (clienteOppFilterArea) clienteOppFilterArea.value = '';
                    if (clienteOppFilterProducto) clienteOppFilterProducto.value = '';
                    renderClienteData();
                });
            }

            // ── Click en nombre de oportunidad/prospección dentro del widget ──
            if (widgetClienteOpp) {
                widgetClienteOpp.addEventListener('click', function (e) {
                    var link = e.target.closest('.wco-opp-name');
                    if (!link) return;
                    // Prospección → abre widget de prospección
                    var prospId = link.getAttribute('data-prospecto-row-id');
                    if (prospId && typeof window.abrirWidgetProspecto === 'function') {
                        window.abrirWidgetProspecto(parseInt(prospId));
                        return;
                    }
                    // Oportunidad → abre detalle
                    var oppId = link.getAttribute('data-oportunidad-id');
                    if (oppId && typeof openDetalle === 'function') {
                        openDetalle(oppId);
                    }
                });
            }

            // Compatibilidad con código anterior
            window.openClienteOportunidadesModal = function (clienteId, clienteNombre) {
                openClienteModal(clienteId, clienteNombre, 'crm');
            };

        } catch (e) { console.error('ClientOpp Error', e); }

        // Funciones auxiliares
        function formatCurrency(num) {
            return new Intl.NumberFormat('es-MX').format(num || 0);
        }

        function truncate(str, maxLen) {
            if (!str) return '';
            return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
        }

        // ═══════════════════════════════════════════════════════════
        // PANEL DE FILTROS AVANZADOS
        // ═══════════════════════════════════════════════════════════

        var btnToggleFilters = document.getElementById('btnToggleFilters');
        var btnCloseFilters = document.getElementById('btnCloseFilters');
        var filtersPanel = document.getElementById('filtersPanel');
        var filtersOverlay = document.getElementById('filtersOverlay');
        var btnApplyFilters = document.getElementById('btnApplyFilters');
        var btnClearFilters = document.getElementById('btnClearFilters');
        var btnExportExcel = document.getElementById('btnExportExcel');

        var currentFilters = {
            cliente: '',
            area: '',
            contacto: '',
            monto: '',
            producto: '',
            tipo: '',
            etapa: '',
            fecha: '',
            desde: '',
            hasta: ''
        };

        // Abrir/Toggle filtros en la isla
        try {
            if (btnToggleFilters) {
                btnToggleFilters.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var island = document.getElementById('mainIsland');
                    if (island) {
                        island.classList.toggle('filters-open');
                        // Si se abre la isla de filtros, NO abrimos el panel lateral por defecto
                        // Pero si el usuario REALMENTE quiere el panel lateral, podemos poner un botón dentro de la isla abierta
                    }
                });
            }
        } catch (e) { console.error('Island Toggle Error', e); }

        // ── CRM bar filter panel toggle ──
        var btnToggleFilterPanel = document.getElementById('btnToggleFilterPanel');
        var crmFilterPanel = document.getElementById('crmFilterPanel');
        var crmBar = document.querySelector('.crm-bar');

        function closeFilterPanel() {
            if (crmFilterPanel) crmFilterPanel.classList.remove('open');
            if (btnToggleFilterPanel) btnToggleFilterPanel.classList.remove('active');
            if (crmBar) crmBar.classList.remove('filter-open');
            document.querySelectorAll('.crm-tabs .crm-tab').forEach(function (t) { t.style.display = ''; });
        }

        if (btnToggleFilterPanel && crmFilterPanel) {
            btnToggleFilterPanel.addEventListener('click', function (e) {
                e.stopPropagation();
                var isOpen = crmFilterPanel.classList.toggle('open');
                btnToggleFilterPanel.classList.toggle('active', isOpen);
                if (crmBar) crmBar.classList.toggle('filter-open', isOpen);
                document.querySelectorAll('.crm-tabs .crm-tab:not(.active)').forEach(function (t) {
                    t.style.display = isOpen ? 'none' : '';
                });
            });
            document.addEventListener('click', function (e) {
                if (!crmFilterPanel.contains(e.target) && e.target !== btnToggleFilterPanel) {
                    closeFilterPanel();
                }
            });
        }

        // Cerrar panel de filtros (legacy - filtersPanel removed)
        function closeFiltersPanel() {
            if (filtersPanel) filtersPanel.style.right = '-400px';
            if (filtersOverlay) filtersOverlay.style.display = 'none';
        }

        if (btnCloseFilters) {
            btnCloseFilters.addEventListener('click', closeFiltersPanel);
        }

        if (filtersOverlay) {
            filtersOverlay.addEventListener('click', closeFiltersPanel);
        }


        // ─── POPULATE ISLAND FILTER DROPDOWNS FROM TABLE DATA (Excel-like) ───
        function populateIslandFilters() {
            var activeTab = _CRM_CONFIG.tabActivo;
            var tbody = null;
            if (activeTab === 'crm') tbody = document.getElementById('crmTbody');
            else if (activeTab === 'clientes') return; // clientes tab has no filter dropdowns

            if (!tbody) return;

            var clientes = new Set();
            var contactos = new Set();
            var areas = new Set();
            var productos = new Set();

            var rows = tbody.querySelectorAll('tr');
            rows.forEach(function (row) {
                var cells = row.querySelectorAll('td');
                if (cells.length < 3 || row.querySelector('td[colspan]')) return;

                // Col 0: Oportunidad (has client name in sub-text)
                var cell0 = cells[0];
                var subText = cell0.querySelector('div:last-child, span.text-gray-400, .text-\\[9px\\]');
                if (subText) {
                    var clientName = subText.textContent.trim();
                    if (clientName) clientes.add(clientName);
                } else {
                    // Try getting all text nodes
                    var divs = cell0.querySelectorAll('div');
                    if (divs.length > 1) {
                        var clientName = divs[divs.length - 1].textContent.trim();
                        if (clientName) clientes.add(clientName);
                    }
                }

                // Col 1: Contacto
                if (cells[1]) {
                    var contacto = cells[1].textContent.trim();
                    if (contacto && contacto !== '-') contactos.add(contacto);
                }

                // Col 2: Área
                if (cells[2]) {
                    var area = cells[2].textContent.trim();
                    if (area) areas.add(area);
                }

                // Productos: cols 3+ check for amounts > 0
                var prodNames = ['ZEBRA', 'PANDUIT', 'APC', 'AVIGILON', 'GENETEC', 'AXIS', 'SOFTWARE', 'RUNRATE', 'PÓLIZA', 'OTROS'];
                for (var i = 3; i < cells.length - 2 && i - 3 < prodNames.length; i++) {
                    var val = cells[i].textContent.replace(/[$,\s]/g, '');
                    if (parseFloat(val) > 0) {
                        productos.add(prodNames[i - 3]);
                    }
                }
            });

            function fillSelect(id, values, defaultLabel) {
                var sel = document.getElementById(id);
                if (!sel) return;
                var currentVal = sel.value;
                sel.innerHTML = '<option value="">' + defaultLabel + '</option>';
                var sorted = Array.from(values).sort(function (a, b) { return a.localeCompare(b); });
                sorted.forEach(function (v) {
                    var opt = document.createElement('option');
                    opt.value = v;
                    opt.textContent = v;
                    sel.appendChild(opt);
                });
                sel.value = currentVal;
            }

            fillSelect('filterCliente', clientes, 'Cliente: Todos');
            fillSelect('filterArea', areas, 'Área: Todas');
            fillSelect('filterProducto', productos, 'Producto: Todos');
        }

        // Run on load
        populateIslandFilters();

        // ─── ISLAND FILTER LISTENERS (immediate apply on change) ───
        function setupIslandFilterListener(id, field) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', function () {
                currentFilters[field] = this.value;
                applyFiltersToTable();
            });
        }

        setupIslandFilterListener('filterCliente', 'cliente');
        setupIslandFilterListener('filterArea', 'area');
        setupIslandFilterListener('filterProducto', 'producto');
        setupIslandFilterListener('filterMonto', 'monto');
        setupIslandFilterListener('filterTipo', 'tipo');
        // Text input: filter on every keystroke
        var filterContactoEl = document.getElementById('filterContacto');
        if (filterContactoEl) {
            filterContactoEl.addEventListener('input', function () {
                currentFilters.contacto = this.value;
                applyFiltersToTable();
            });
        }
        var filterEtapaEl = document.getElementById('filterEtapa');
        if (filterEtapaEl) {
            filterEtapaEl.addEventListener('input', function () {
                currentFilters.etapa = this.value;
                applyFiltersToTable();
            });
        }

        // Poblar datalist de etapas con valores únicos de las filas cargadas
        function populateEtapaDatalist() {
            var datalist = document.getElementById('etapaOptionsList');
            if (!datalist) return;
            var tbody = document.getElementById('crmTbody');
            if (!tbody) return;
            var seen = {};
            datalist.innerHTML = '';
            tbody.querySelectorAll('tr[data-etapa]').forEach(function (row) {
                var val = (row.dataset.etapa || '').trim();
                if (val && !seen[val]) {
                    seen[val] = true;
                    var opt = document.createElement('option');
                    opt.value = val;
                    datalist.appendChild(opt);
                }
            });
        }
        populateEtapaDatalist();

        // Filtro orden por fecha
        setupIslandFilterListener('filterFecha', 'fecha');

        // Filtro por rango de fechas: aplicar al cambiar "Hasta"
        var _fDesde = document.getElementById('filterDesde');
        var _fHasta = document.getElementById('filterHasta');
        if (_fHasta) {
            _fHasta.addEventListener('change', function() {
                currentFilters.desde = _fDesde ? _fDesde.value : '';
                currentFilters.hasta = this.value;
                applyFiltersToTable();
            });
        }
        if (_fDesde) {
            _fDesde.addEventListener('change', function() {
                currentFilters.desde = this.value;
                currentFilters.hasta = _fHasta ? _fHasta.value : '';
                if (currentFilters.hasta) applyFiltersToTable();
            });
        }

        // Limpiar filtros (Island button)
        var btnClearIsland = document.getElementById('btnClearIslandFilters');
        if (btnClearIsland) {
            btnClearIsland.addEventListener('click', function () {
                ['filterCliente', 'filterContacto', 'filterArea', 'filterProducto', 'filterMonto', 'filterTipo', 'filterEtapa', 'filterFecha', 'filterDesde', 'filterHasta'].forEach(function (id) {
                    var el = document.getElementById(id);
                    if (el) el.value = '';
                });
                currentFilters = { cliente: '', area: '', contacto: '', monto: '', producto: '', tipo: '', etapa: '', fecha: '', desde: '', hasta: '' };
                applyFiltersToTable();
            });
        }

        // Aplicar filtros
        if (btnApplyFilters) {
            btnApplyFilters.addEventListener('click', function () {
                var fc = document.getElementById('filterCliente');
                var fa = document.getElementById('filterArea');
                var fcont = document.getElementById('filterContacto');
                var fm = document.getElementById('filterMonto');
                var fp = document.getElementById('filterProducto');
                var fe = document.getElementById('filterEtapa');
                var ff = document.getElementById('filterFecha');
                if (fc) currentFilters.cliente = fc.value;
                if (fa) currentFilters.area = fa.value;
                if (fcont) currentFilters.contacto = fcont.value;
                if (fm) currentFilters.monto = fm.value;
                if (fp) currentFilters.producto = fp.value;
                if (fe) currentFilters.etapa = fe.value;
                if (ff) currentFilters.fecha = ff.value;
                var fDesde = document.getElementById('filterDesde');
                var fHasta = document.getElementById('filterHasta');
                if (fDesde) currentFilters.desde = fDesde.value;
                if (fHasta) currentFilters.hasta = fHasta.value;
                applyFiltersToTable();
                closeFilterPanel();
            });
        }

        // Limpiar filtros
        if (btnClearFilters) {
            btnClearFilters.addEventListener('click', function () {
                ['filterCliente', 'filterArea', 'filterContacto', 'filterMonto', 'filterProducto', 'filterTipo', 'filterEtapa', 'filterFecha'].forEach(function (id) {
                    var el = document.getElementById(id);
                    if (el) el.value = '';
                });
                currentFilters = { cliente: '', area: '', contacto: '', monto: '', producto: '', tipo: '', etapa: '', fecha: '', desde: '', hasta: '' };
                applyFiltersToTable();
            });
        }

        // Aplicar filtros a la tabla activa
        function applyFiltersToTable() {
            var activeTab = _CRM_CONFIG.tabActivo;
            var tbody = null;

            if (activeTab === 'crm') {
                tbody = document.getElementById('crmTbody');
            } else if (activeTab === 'clientes') {
                return; // clientes tab no uses inline filters
            }

            if (!tbody) return;

            var rows = Array.from(tbody.querySelectorAll('tr'));
            var filteredRows = rows.filter(function (row) {
                if (row.querySelector('td[colspan]')) return true; // Keep empty message row

                var cells = row.querySelectorAll('td');
                if (cells.length === 0) return false;

                // Filtro por cliente
                if (currentFilters.cliente) {
                    var cellText = cells[0].textContent.toLowerCase();
                    if (!cellText.includes(currentFilters.cliente.toLowerCase())) {
                        return false;
                    }
                }

                // Filtro por área
                if (currentFilters.area) {
                    var areaText = '';
                    // Assuming Area is roughly in column 2 or 3, but searching all for safety or targeting specific index if known
                    // Based on previous code, it searched all cells. Let's stick to searching all cells or specific index 2
                    if (cells[2] && cells[2].textContent.toLowerCase().includes(currentFilters.area.toLowerCase())) {
                        // match
                    } else {
                        // check strict column? Let's search row for now but column 2 is usually Area
                        // Previous logic: loop all cells.
                        var found = false;
                        for (var i = 0; i < cells.length; i++) {
                            if (cells[i].textContent.toLowerCase().includes(currentFilters.area.toLowerCase())) {
                                found = true;
                                break;
                            }
                        }
                        if (!found) return false;
                    }
                }

                // Filtro por contacto
                if (currentFilters.contacto) {
                    var found = false;
                    for (var i = 0; i < cells.length; i++) {
                        if (cells[i].textContent.toLowerCase().includes(currentFilters.contacto.toLowerCase())) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) return false;
                }

                // Filtro por producto
                if (currentFilters.producto) {
                    var found = false;
                    for (var i = 0; i < cells.length; i++) {
                        if (cells[i].textContent.toLowerCase().includes(currentFilters.producto.toLowerCase())) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) return false;
                }

                // Filtro por tipo de negociación (solo tab crm)
                if (currentFilters.tipo && activeTab === 'crm') {
                    var tipoVal = (row.dataset.tipo || '').toLowerCase();
                    if (tipoVal !== currentFilters.tipo) return false;
                }

                // Filtro por etapa (solo tab crm)
                if (currentFilters.etapa && activeTab === 'crm') {
                    var etapaVal = (row.dataset.etapa || '').toLowerCase();
                    if (!etapaVal.includes(currentFilters.etapa.toLowerCase())) return false;
                }

                // Filtro por rango de fechas (usa timestamp de fecha_actualizacion)
                if (currentFilters.desde || currentFilters.hasta) {
                    var ts = parseInt(row.dataset.fecha || '0', 10);
                    if (ts > 0) {
                        if (currentFilters.desde) {
                            var desdeTs = new Date(currentFilters.desde + 'T00:00:00').getTime() / 1000;
                            if (ts < desdeTs) return false;
                        }
                        if (currentFilters.hasta) {
                            var hastaTs = new Date(currentFilters.hasta + 'T23:59:59').getTime() / 1000;
                            if (ts > hastaTs) return false;
                        }
                    }
                }

                return true;
            });

            // Ordenar por monto si se especificó
            if (currentFilters.monto) {
                filteredRows.sort(function (a, b) {
                    var montoA = extractMonto(a);
                    var montoB = extractMonto(b);

                    if (currentFilters.monto === 'desc') {
                        return montoB - montoA;
                    } else {
                        return montoA - montoB;
                    }
                });
            }

            // Ordenar por fecha si se especificó
            if (currentFilters.fecha) {
                filteredRows.sort(function (a, b) {
                    var fa = parseInt(a.dataset.fecha || '0', 10);
                    var fb = parseInt(b.dataset.fecha || '0', 10);
                    return currentFilters.fecha === 'desc' ? fb - fa : fa - fb;
                });
            }

            // Ocultar todas las filas
            rows.forEach(function (row) {
                row.style.display = 'none';
            });

            // Mostrar solo las filas filtradas
            filteredRows.forEach(function (row) {
                row.style.display = '';
            });

            // También filtrar la vista de cards
            _applyFiltersToCards();
        }

        function _applyFiltersToCards() {
            var grid = document.getElementById('crmCardsGrid');
            var listBody = document.getElementById('crmListBody');
            var cards = [];
            if (grid) cards = cards.concat(Array.prototype.slice.call(grid.querySelectorAll('.crm-data-row')));
            if (listBody) cards = cards.concat(Array.prototype.slice.call(listBody.querySelectorAll('.crm-data-row')));
            if (!cards.length) return;
            var searchVal = (document.getElementById('crmSearch') || {}).value || '';
            searchVal = searchVal.toLowerCase();

            // Leer filtros nuevos (monto/probabilidad/mes cierre) directo de hidden inputs
            var montoMinStr = (document.getElementById('filterMontoMin') || {}).value || '';
            var montoMaxStr = (document.getElementById('filterMontoMax') || {}).value || '';
            var probMinStr  = (document.getElementById('filterProbMin')  || {}).value || '';
            var probMaxStr  = (document.getElementById('filterProbMax')  || {}).value || '';
            var mesCierreStr = (document.getElementById('filterMesCierre') || {}).value || '';
            var montoMin = montoMinStr !== '' ? parseFloat(montoMinStr) : null;
            var montoMax = montoMaxStr !== '' ? parseFloat(montoMaxStr) : null;
            var probMin  = probMinStr  !== '' ? parseFloat(probMinStr)  : null;
            var probMax  = probMaxStr  !== '' ? parseFloat(probMaxStr)  : null;
            var mesCierreList = mesCierreStr ? mesCierreStr.split(',').filter(Boolean) : null;
            // Etapa puede ser multi (comma-separated desde el multiselect)
            var etapaFilterRaw = (currentFilters.etapa || '').trim();
            var etapaList = etapaFilterRaw ? etapaFilterRaw.split(',').map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean) : null;

            cards.forEach(function(card) {
                var text = card.textContent.toLowerCase();
                var etapa = (card.dataset.etapa || '').toLowerCase();
                var area = (card.dataset.area || '').toLowerCase();
                var tipo = (card.dataset.tipo || '').toLowerCase();
                var producto = (card.dataset.producto || '').toLowerCase();
                var cliente = (card.dataset.cliente || '').toLowerCase();
                var contacto = (card.dataset.contacto || '').toLowerCase();
                var monto = parseFloat(card.dataset.monto || '0') || 0;
                var prob  = parseFloat(card.dataset.probabilidad || '0') || 0;
                var mesCierre = (card.dataset.mesCierre || '').trim();
                var show = true;

                // Buscador global
                if (searchVal && !text.includes(searchVal)) show = false;
                // Filtros del panel
                if (show && currentFilters.cliente && !cliente.includes(currentFilters.cliente.toLowerCase())) show = false;
                if (show && currentFilters.area && !area.includes(currentFilters.area.toLowerCase())) show = false;
                if (show && etapaList) {
                    // Multi-etapa: match exacto (después de lowercase) contra cualquier elemento de la lista
                    if (etapaList.indexOf(etapa) === -1) show = false;
                }
                if (show && currentFilters.tipo && tipo !== currentFilters.tipo) show = false;
                if (show && currentFilters.producto && !producto.includes(currentFilters.producto.toLowerCase())) show = false;
                if (show && currentFilters.contacto && !contacto.includes(currentFilters.contacto.toLowerCase())) show = false;
                // Rango de monto
                if (show && montoMin !== null && monto < montoMin) show = false;
                if (show && montoMax !== null && monto > montoMax) show = false;
                // Rango de probabilidad
                if (show && probMin !== null && prob < probMin) show = false;
                if (show && probMax !== null && prob > probMax) show = false;
                // Mes de cierre (multi)
                if (show && mesCierreList && mesCierreList.indexOf(mesCierre) === -1) show = false;

                // Solo vencidas (sort = 'vencidas')
                var filterVencida = (document.getElementById('filterVencida') || {}).value || '';
                if (show && filterVencida === 'only' && card.dataset.vencida !== '1') show = false;

                // Rango de fechas (por fecha de creacion)
                if (show && (currentFilters.desde || currentFilters.hasta)) {
                    var fechaCreacion = card.dataset.creacion || '';
                    if (fechaCreacion) {
                        if (currentFilters.desde && fechaCreacion < currentFilters.desde) show = false;
                        if (show && currentFilters.hasta && fechaCreacion > currentFilters.hasta) show = false;
                    }
                }

                card.style.display = show ? '' : 'none';
            });

            // Kanban respeta filtros: re-render si visible
            if (typeof window._crmRenderKanban === 'function') {
                var kv = document.getElementById('crmViewKanban');
                if (kv && kv.style.display !== 'none') window._crmRenderKanban();
            }
        }
        // Exponer para que se pueda llamar desde fuera del scope
        window._applyFiltersToCards = _applyFiltersToCards;

        // Extraer monto de una fila
        function extractMonto(row) {
            var cells = row.querySelectorAll('td');
            var montoText = '';

            // Buscar la celda con el monto total (usualmente la última antes de acciones)
            for (var i = cells.length - 1; i >= 0; i--) {
                var text = cells[i].textContent.trim();
                if (text.startsWith('$')) {
                    montoText = text.replace(/[$,]/g, '');
                    break;
                }
            }

            return parseFloat(montoText) || 0;
        }

        // ═══════════════════════════════════════════════════════════
        // EXPORTAR A EXCEL
        // ═══════════════════════════════════════════════════════════

        if (btnExportExcel) {
            btnExportExcel.addEventListener('click', function () {
                if (typeof XLSX === 'undefined') {
                    alert('La librería de Excel no está disponible. Recarga la página e intenta de nuevo.');
                    return;
                }

                var activeTab = _CRM_CONFIG.tabActivo;
                var tabNames = { crm: 'Oportunidades', clientes: 'Clientes' };
                var tabName = tabNames[activeTab] || activeTab;

                var mes = _CRM_CONFIG.mesFiltro;
                var anio = _CRM_CONFIG.anioFiltro;
                var usuario = _CRM_CONFIG.usuarioNombre;

                var ahora = new Date();
                var fechaStr = ahora.toLocaleDateString('es-MX');
                var horaStr = ahora.toLocaleTimeString('es-MX');

                // Filtros aplicados
                var filtrosAplicados = [];
                if (currentFilters.cliente) filtrosAplicados.push('Cliente: ' + currentFilters.cliente);
                if (currentFilters.area) filtrosAplicados.push('Área: ' + currentFilters.area);
                if (currentFilters.contacto) filtrosAplicados.push('Contacto: ' + currentFilters.contacto);
                if (currentFilters.producto) filtrosAplicados.push('Producto: ' + currentFilters.producto);
                if (currentFilters.tipo) filtrosAplicados.push('Tipo: ' + (currentFilters.tipo === 'runrate' ? 'Runrate' : 'Proyecto'));
                if (currentFilters.monto) filtrosAplicados.push('Orden monto: ' + (currentFilters.monto === 'desc' ? 'Mayor → Menor' : 'Menor → Mayor'));
                var filtrosStr = filtrosAplicados.length > 0 ? filtrosAplicados.join(' | ') : 'Sin filtros';

                // Hoja 1: Información de la exportación
                var infoData = [
                    ['Campo', 'Valor'],
                    ['Usuario', usuario],
                    ['Fecha', fechaStr],
                    ['Hora', horaStr],
                    ['Tab exportado', tabName],
                    ['Mes', mes],
                    ['Año', anio],
                    ['Filtros aplicados', filtrosStr]
                ];

                // Hoja 2: Datos de la tabla
                var tbodyId = activeTab === 'clientes'
                    ? ('clientesTbody-' + (_clientesExpanded || 'facturado'))
                    : 'crmTbody';
                var tbody = document.getElementById(tbodyId);
                var tableData = [];

                if (tbody) {
                    var table = tbody.closest('table');
                    var headers = [];
                    if (table) {
                        table.querySelectorAll('thead th').forEach(function (th) {
                            headers.push(th.textContent.trim());
                        });
                    }
                    // Solo el tab CRM (oportunidades) añade columnas extra:
                    // Cliente, PO, Tipo y Estatus — insertadas justo
                    // después de "Oportunidad" (índice 1). Se leen de los
                    // data-attrs del <tr> (no están en el DOM como <td>).
                    // El Estatus sale del campo etapa_corta, así puedes
                    // filtrar en Excel para excluir perdidas / ver solo
                    // ganadas, etc.
                    var addOppCols = (tbodyId === 'crmTbody');
                    if (headers.length) {
                        if (addOppCols) {
                            headers.splice(1, 0, 'Cliente', 'PO', 'Tipo', 'Estatus');
                        }
                        tableData.push(headers);
                    }

                    Array.from(tbody.querySelectorAll('tr')).forEach(function (row) {
                        if (row.style.display === 'none') return;
                        if (row.querySelector('td[colspan]')) return;
                        var rowData = [];
                        row.querySelectorAll('td').forEach(function (td) {
                            rowData.push(td.textContent.trim().replace(/\s+/g, ' '));
                        });
                        if (addOppCols) {
                            var tipoRaw = (row.getAttribute('data-tipo') || row.dataset.tipo || '').toLowerCase();
                            var tipoLabel = tipoRaw === 'runrate' ? 'Runrate'
                                          : tipoRaw === 'proyecto' ? 'Proyecto'
                                          : tipoRaw === 'bitrix_proyecto' ? 'Proyecto Bitrix24'
                                          : (tipoRaw ? tipoRaw : '');
                            // PO: probamos data-attr + dataset + el span backup
                            // dentro del cell 0 (crm-row-po-backup). Triple
                            // fuente porque empíricamente data-po a veces se
                            // pierde en producción.
                            var poVal = row.getAttribute('data-po') || row.dataset.po || '';
                            if (!poVal) {
                                var poBackup = row.querySelector('.crm-row-po-backup');
                                if (poBackup) {
                                    poVal = (poBackup.getAttribute('data-po-number')
                                        || poBackup.textContent || '').trim();
                                }
                            }
                            // Cliente: si el data-attr viene vacío, leemos del
                            // span .client-name-link que sí tiene el nombre
                            // del cliente en el cell 0.
                            var cliVal = row.getAttribute('data-cliente') || row.dataset.cliente || '';
                            if (!cliVal || cliVal === '- Sin Cliente -') {
                                var cliSpan = row.querySelector('.client-name-link');
                                if (cliSpan) {
                                    var t = (cliSpan.textContent || '').trim();
                                    if (t) cliVal = t;
                                }
                            }
                            var etapaVal = row.getAttribute('data-etapa') || row.dataset.etapa || '';
                            rowData.splice(1, 0, cliVal, poVal, tipoLabel, etapaVal);
                        }
                        if (rowData.length) tableData.push(rowData);
                    });
                }

                var wb = XLSX.utils.book_new();
                var wsInfo = XLSX.utils.aoa_to_sheet(infoData);
                wsInfo['!cols'] = [{ wch: 22 }, { wch: 50 }];
                XLSX.utils.book_append_sheet(wb, wsInfo, 'Info');

                if (tableData.length) {
                    var wsData = XLSX.utils.aoa_to_sheet(tableData);
                    XLSX.utils.book_append_sheet(wb, wsData, tabName);
                }

                var fileName = 'CRM_' + tabName + '_' + anio + '-' + mes + '_' + fechaStr.replace(/\//g, '-') + '.xlsx';
                XLSX.writeFile(wb, fileName);
            });
        }

        // ══════════════════════════════════════════════════════
        // ═══ TAREAS EN CRM - SWITCHING, CARGA Y MODALES ═══
        // ══════════════════════════════════════════════════════

        window._crmTareasMode = false;
        var _crmAllTareas = [];
        var _crmCurrentFilter = 'pendientes';
        var _crmTareasCache = {};  // cache por estado (solo pendientes)
        var _crmTareasFetching = false;  // guard: evita fetches duplicados en vuelo
        var _crmPage = 1;
        var _crmTotalPages = 1;
        var _crmTotalTareas = 0;
        var _crmPaginatedSearch = '';
        var _crmCurrentTaskId = null;
        var _crmTimerInterval = null;

        // ── Switching CRM <-> Tareas <-> Proyectos ──
        var btnTareas = document.getElementById('btnTareas');
        var btnCRM = document.getElementById('btnCRM');
        var btnProyectos = document.getElementById('btnProyectos');
        var crmContent = document.getElementById('crmContentSection');
        var tareasSection = document.getElementById('tareasSection');
        var proyectosSection = document.getElementById('proyectosSection');
        var islandFilters = document.getElementById('islandFiltersSection');
        var islandSep = document.getElementById('islandSepFilters');
        var btnNeg = document.getElementById('btnNegociacion');

        function switchCrmView(view) {
            // Quitar guardia anti-FOUC del admin: una vez que el JS toma
            // control de la vista, las reglas !important de .adm-initial-hide
            // ya no deben ganar sobre las clases .active (si no, navegar a
            // Tareas/Proyectos desde Compras no funciona).
            document.documentElement.classList.remove('adm-initial-hide');
            if (document.body) document.body.classList.remove('adm-initial-hide');
            localStorage.setItem('crmView', view);
            window._crmTareasMode = (view === 'tareas');
            // (2026-06-11 fix) Al salir de Tareas, cerrar el detalle de tarea
            // si quedó ABIERTO — quedaba flotando invisible y dejaba
            // body.overflow bloqueado (no se podía scrollear en el CRM).
            // Solo si está activo: cerrarMo­dal en frío dispara refetches.
            if (view !== 'tareas' && typeof window.crmTaskCerrarModal === 'function') {
                var _tm = document.getElementById('crmTaskDetailModal');
                if (_tm && _tm.classList.contains('active')) {
                    try { window.crmTaskCerrarModal(); } catch (e) { /* noop */ }
                }
            }
            var widgetCompras = document.getElementById('widgetCompras');
            if (crmContent) crmContent.style.display = (view === 'crm') ? '' : 'none';
            if (tareasSection) tareasSection.classList.toggle('active', view === 'tareas');
            if (proyectosSection) proyectosSection.classList.toggle('active', view === 'proyectos');
            if (widgetCompras) widgetCompras.classList.toggle('active', view === 'compras');

            // Detalle de proyecto: vive fuera de #proyectosSection (es un
            // template inline). Si cambias a otro módulo (CRM, Tareas,
            // Compras), el detalle debe ocultarse — si no, queda flotando
            // y se ve debajo del módulo activo. También restauramos
            // #proyectosSection por si quedó con display:none de un
            // proyectosVerDetalle previo.
            var proyDetail = document.getElementById('widgetProyectoDetalle');
            if (proyDetail && view !== 'proyectos') {
                proyDetail.classList.remove('is-open');
                if (proyectosSection) proyectosSection.style.display = '';
                // Limpia la URL si quedó con ?open_proyecto=...
                try {
                    var url = new URL(window.location.href);
                    if (url.searchParams.has('open_proyecto') || url.searchParams.has('tab')) {
                        url.searchParams.delete('open_proyecto');
                        url.searchParams.delete('tab');
                        window.history.replaceState({}, '', url.toString());
                    }
                } catch (e) { /* defensivo */ }
            }
            document.querySelectorAll('.island-nav-btn, .crm-sb-btn').forEach(function (b) { b.classList.remove('active'); });
            var activeBtn = document.getElementById(
                view === 'crm' ? 'btnCRM' :
                view === 'tareas' ? 'btnTareas' :
                view === 'proyectos' ? 'btnProyectos' :
                view === 'compras' ? 'btnCompras' :
                'btnCRM'
            );
            if (activeBtn) activeBtn.classList.add('active');
            // Si el calendario está renderizado como página completa (porque el
            // user llegó desde ?tab=calendario), al cambiar a CRM/Tareas/Proyectos
            // hay que ocultarlo o se queda visible debajo del nuevo contenido.
            var calOv = document.getElementById('widgetCalendarioMaster');
            if (calOv && calOv.classList.contains('is-page-mode')) {
                calOv.style.display = 'none';
                calOv.classList.remove('is-page-mode');
                // Limpia ?tab=calendario de la URL para que un refresh no reabra el calendario
                try {
                    var url = new URL(window.location.href);
                    if (url.searchParams.get('tab') === 'calendario') {
                        url.searchParams.delete('tab');
                        window.history.replaceState({}, '', url.toString());
                    }
                } catch (e) { /* defensivo */ }
            }
            // Al salir del CRM (tareas/proyectos) quitar el scroll-lock que el
            // kanban del CRM pudo haber dejado — si no, el body/main quedan con
            // height:100vh + overflow:hidden y el scroll de la lista de tareas
            // queda trabado.
            var mainEl = document.querySelector('.crm-main');
            if (view !== 'crm') {
                document.body.classList.remove('kanban-scroll-lock');
                if (mainEl) mainEl.classList.remove('kanban-active');
            } else if (localStorage.getItem('crmViewMode') === 'kanban') {
                // Re-aplicar si volvemos a CRM en modo kanban
                document.body.classList.add('kanban-scroll-lock');
                if (mainEl) mainEl.classList.add('kanban-active');
            }
            // NOTA: el boton btnNegociacion ahora es un boton cuadrado con icono +
            // en crm-bar-right. No sobrescribimos su contenido (el SVG debe quedarse).
        }
        // Exportada: crm_nav_v2.js (dashOpenInline) la invoca para normalizar
        // la vista a 'crm' antes de mostrar el dashboard inline — sin esto el
        // guard typeof fallaba en silencio y el dashboard se "abría" dentro
        // del #crmContentSection oculto (Tareas seguía en pantalla).
        window.switchCrmView = switchCrmView;

        try {
            if (btnTareas) {
                btnTareas.addEventListener('click', function () {
                    switchCrmView('tareas');
                    _crmTareasCache = {};
                    _tareasPollHash = null;
                    cargarTareasCRM();
                });
            }

            if (btnCRM) {
                btnCRM.addEventListener('click', function () {
                    switchCrmView('crm');
                });
            }

            if (btnProyectos) {
                btnProyectos.addEventListener('click', function () {
                    switchCrmView('proyectos');
                    if (typeof proyectosInit === 'function') proyectosInit();
                });
            }

            var btnCompras = document.getElementById('btnCompras');
            if (btnCompras) {
                btnCompras.addEventListener('click', function () {
                    switchCrmView('compras');
                    if (typeof window.comprasInit === 'function') window.comprasInit();
                });
            }

            // Default view para administradores: 'compras' (no tienen pestaña CRM).
            // Solo en el home genérico — en destinos explícitos (?tab=clientes,
            // calendario, etc.) el server-render manda; si no, este switch
            // tapaba Reportes/Calendario con la vista persistida.
            try {
                var _isAdmin = !!(window._CRM_CONFIG && window._CRM_CONFIG.esAdministrador);
                var _pageTabAdm = (window._CRM_CONFIG || {}).tabActivo || '';
                if (_pageTabAdm && _pageTabAdm !== 'crm' && _pageTabAdm !== 'todos') _isAdmin = false;
                var _savedView = null;
                try { _savedView = localStorage.getItem('crmView'); } catch (e) {}
                if (_isAdmin) {
                    var _adminView = (_savedView === 'tareas' || _savedView === 'proyectos' || _savedView === 'compras')
                        ? _savedView
                        : 'compras';
                    switchCrmView(_adminView);
                    if (_adminView === 'compras' && typeof window.comprasInit === 'function') window.comprasInit();
                }
            } catch (e) { /* noop */ }
        } catch (e) { console.error('Section Switch Error', e); }

        // ── Cargar tareas desde API ──
        var _crmTareasPrioFilter = 'todas'; // legacy, ya no se usa
        // Set de responsables seleccionados. Vacio = "todos"
        var _crmTareasRespSet = {};


        window.updateGlobalNavBadges = function (counts) {
            // Tareas Vencidas Badge
            const btnTareas = document.getElementById('btnTareas');
            if (btnTareas) {
                let badge = btnTareas.querySelector('.tareas-red-badge');
                if (counts && counts.tareas > 0) {
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'tareas-red-badge';
                        badge.style.cssText = 'position:absolute;top:-4px;right:-8px;background:#EF4444;color:#fff;font-size:0.65rem;font-weight:700;padding:2px 5px;border-radius:10px;line-height:1;pointer-events:none;z-index:10;border:2px solid #fff;';
                        btnTareas.style.position = 'relative';
                        btnTareas.appendChild(badge);
                    }
                    // Specifically count vencidas in notif labels if possible, but requested by category is fine
                    badge.innerText = counts.tareas > 99 ? '99+' : counts.tareas;
                } else if (badge) {
                    badge.remove();
                }
            }

            // Muro Badge
            const btnMuro = document.getElementById('btnMuro');
            if (btnMuro) {
                let badge = btnMuro.querySelector('.muro-red-badge');
                if (counts && counts.muro > 0) {
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'muro-red-badge';
                        badge.style.cssText = 'position:absolute;top:-4px;right:-8px;background:#EF4444;color:#fff;font-size:0.65rem;font-weight:700;padding:2px 5px;border-radius:10px;line-height:1;pointer-events:none;z-index:10;border:2px solid #fff;';
                        btnMuro.style.position = 'relative';
                        btnMuro.appendChild(badge);
                    }
                    badge.innerText = counts.muro > 99 ? '99+' : counts.muro;
                } else if (badge) {
                    badge.remove();
                }
            }
        };

        function recargarTareasCRM() {
            _crmTareasCache = {};  // invalidar caché completo
            cargarTareasCRM(_crmCurrentFilter);
        }

        // ── Refresh periódico del gradient heat/warm del CRM ──
        // Recalcula minutos_hasta_proxima / minutos_vencida cada minuto
        // para que el rojo avance visiblemente a medida que una actividad
        // se acerca a vencer — el usuario ve el color moverse sin recargar.
        // Pausa cuando el tab no es visible (evita polling fantasma que satura
        // browser y servidor cuando el usuario deja la pestaña abierta horas).
        //
        // GUARD GLOBAL: este callback se re-dispara en cada turbo:load (al
        // navegar entre tabs). Sin el guard, cada navegación crearía OTRO
        // setInterval encima de los anteriores → N timers en paralelo
        // golpeando el server cada minuto. El guard se chequea para los
        // DOS intervals (gradient + tareas poll).
        if (!window._crmGlobalIntervalsWired) {
            window._crmGlobalIntervalsWired = true;

        setInterval(function() {
            if (document.hidden) return;
            if (window._crmTareasMode) return; // solo en vista CRM
            // Si hay drill-down (sub-tabla) activo en clientes, no clobber-ear el detalle.
            if (window._ckDetalleOpen) return;
            var tabActivo = document.querySelector('.crm-tab.active');
            if (!tabActivo) return;
            if (typeof refreshCrmTable === 'function') {
                try { refreshCrmTable(); } catch(e) { console.warn('[CRM] gradient refresh:', e); }
            }
        }, 60000); // 1 minuto

        // ── Polling ligero: detectar tareas nuevas/cambiadas de grupo cada 15s ──
        // Pausa con tab oculto. Aborta el fetch previo si el siguiente arranca
        // antes (evita stacking de fetches lentos cuando el server va saturado).
        var _tareasPollHash = null;
        var _tareasPollAbort = null;
        setInterval(function() {
            if (document.hidden) return;
            if (!window._crmTareasMode) return;
            if (_tareasPollAbort) { try { _tareasPollAbort.abort(); } catch(_) {} }
            _tareasPollAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var opts = _tareasPollAbort ? { signal: _tareasPollAbort.signal } : {};
            fetch('/app/api/tareas/?estado=pendientes', opts)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success && Array.isArray(data.tareas)) {
                        var nuevoHash = data.tareas.map(function(t) { return t.id + ':' + t.estado; }).join(',');
                        if (_tareasPollHash !== null && nuevoHash !== _tareasPollHash) {
                            _crmTareasCache = {};
                            _crmAllTareas = data.tareas;
                            _actualizarDropdownResponsables(data.tareas);
                            renderTareasCRM(_crmCurrentFilter);
                        }
                        _tareasPollHash = nuevoHash;
                    }
                }).catch(function(){});
        }, 15000);

        }  // fin guard _crmGlobalIntervalsWired

        // Al volver a la pestaña, refresca de inmediato (sin esperar el próximo
        // tick del interval) para que el usuario no vea datos viejos.
        // Este listener al document NO está dentro del guard porque podría
        // ser útil re-engancharlo si el body fue reemplazado; pero document
        // es el mismo elemento entre navs — listener se duplicaría. Lo
        // movemos al mismo guard para que solo se instale una vez.
        if (!window._crmVisibilityWired) {
            window._crmVisibilityWired = true;
        document.addEventListener('visibilitychange', function() {
            if (document.hidden) return;
            if (window._crmTareasMode && typeof renderTareasCRM === 'function') {
                _tareasPollHash = null; // forzar repintado al siguiente poll
            }
        });
        }  // fin guard _crmVisibilityWired

        function _actualizarDropdownResponsables(tareas) {
            var list = document.getElementById('tareasFilterResponsableList');
            if (!list) return;
            // Guardar seleccion actual antes de reconstruir
            var selected = {};
            Object.keys(_crmTareasRespSet).forEach(function(k){ selected[k] = true; });

            // Recolectar responsables únicos
            var respSet = {};
            tareas.forEach(function (t) { if (t.responsable) respSet[t.responsable] = 1; });

            // Reconstruir la lista (mantiene la opcion "Todos" al tope)
            var allOpt = list.querySelector('.all-opt');
            list.innerHTML = '';
            if (allOpt) list.appendChild(allOpt);

            Object.keys(respSet).sort().forEach(function (nombre) {
                var label = document.createElement('label');
                label.className = 'tareas-filter-resp-opt';
                var cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = nombre;
                cb.checked = !!selected[nombre];
                cb.addEventListener('change', function(){
                    if (cb.checked) _crmTareasRespSet[nombre] = true;
                    else delete _crmTareasRespSet[nombre];
                    _syncRespAllCheckbox();
                    renderTareasCRM();
                });
                label.appendChild(cb);
                var span = document.createElement('span');
                span.textContent = nombre;
                label.appendChild(span);
                list.appendChild(label);
            });

            // Sincronizar el "Todos" checkbox
            _syncRespAllCheckbox();
        }

        function _syncRespAllCheckbox() {
            var allCb = document.getElementById('tareasRespAll');
            if (!allCb) return;
            // "Todos" está checked si no hay ningún individual marcado
            allCb.checked = Object.keys(_crmTareasRespSet).length === 0;
        }

        function cargarTareasCRM(forzarEstado, pagina) {
            // El nuevo diseño siempre trabaja con 'pendientes' (cacheado);
            // las completadas quedan excluidas del módulo Focus
            var estado = 'pendientes';
            _crmCurrentFilter = 'pendientes';

            if (_crmTareasCache[estado]) {
                _crmAllTareas = _crmTareasCache[estado];
                _actualizarDropdownResponsables(_crmAllTareas);
                renderTareasCRM();
                return;
            }

            // Guard anti-duplicado: en una recarga, Turbo emite turbo:load
            // ADEMÁS de DOMContentLoaded → el wireup (y esta función) corren
            // dos veces y disparaban 4 fetches (2 por llamada). Si ya hay un
            // fetch en vuelo, no lanzar otro: el que está corriendo pinta al
            // terminar. Las recargas tras mutación ocurren después (sin fetch
            // en vuelo), así que no se bloquean.
            if (_crmTareasFetching) return;
            _crmTareasFetching = true;

            var grid = document.getElementById('tareasCardsGrid');
            if (grid) grid.innerHTML = '<div class="tareas-empty-card">Cargando tareas...</div>';

            var url = '/app/api/tareas/?estado=pendientes';
            // Fetch paralelo: pendientes + completadas recientes (para que sigan visibles
            // en el calendario después de recargar la página)
            Promise.all([
                fetch(url).then(function(r){ if (!r.ok) return r.json().then(function(d){ throw new Error(d.error || 'Error ' + r.status); }); return r.json(); }),
                fetch('/app/api/tareas/?estado=completadas&page=1&page_size=100').then(function(r){ return r.ok ? r.json() : { success:false, tareas:[] }; }).catch(function(){ return { success:false, tareas:[] }; })
            ])
                .then(function (results) {
                    _crmTareasFetching = false;
                    var data = results[0];
                    var dataCompl = results[1] || { tareas: [] };
                    if (data.success && Array.isArray(data.tareas)) {
                        // Merge: pendientes + completadas (dedup por id)
                        var byId = {};
                        data.tareas.forEach(function(t){ byId[t.id] = t; });
                        if (Array.isArray(dataCompl.tareas)) {
                            dataCompl.tareas.forEach(function(t){ if (!byId[t.id]) byId[t.id] = t; });
                        }
                        var merged = Object.keys(byId).map(function(k){ return byId[k]; });
                        _crmTareasCache[estado] = merged;
                        _crmAllTareas = merged;
                        _actualizarDropdownResponsables(merged);
                        renderTareasCRM();
                        _tareasPollHash = data.tareas.map(function(t){ return t.id+':'+t.estado; }).join(',');
                    } else {
                        if (grid) grid.innerHTML = '<div class="tareas-empty-card">No se pudieron cargar las tareas.</div>';
                    }
                })
                .catch(function (err) {
                    _crmTareasFetching = false;
                    console.error('[Tareas] Error:', err);
                    if (grid) grid.innerHTML = '<div class="tareas-empty-card">Error: ' + err.message + '</div>';
                });
        }

        function _renderPaginacion(activa) {
            var footer = document.getElementById('tareasFooter');
            if (!footer) return;
            if (!activa || _crmTotalPages <= 1) { footer.innerHTML = ''; return; }
            var desde = (_crmPage - 1) * 50 + 1;
            var hasta = Math.min(_crmPage * 50, _crmTotalTareas);
            footer.innerHTML =
                '<div class="tareas-paginacion">' +
                '<button class="tareas-pag-btn" id="tareasPagPrev" ' + (_crmPage <= 1 ? 'disabled' : '') + ' onclick="crmTareasPagAnterior()">&#8592; Anterior</button>' +
                '<span class="tareas-pag-info">Página <strong>' + _crmPage + '</strong> de <strong>' + _crmTotalPages + '</strong> &nbsp;·&nbsp; ' + desde + '–' + hasta + ' de ' + _crmTotalTareas + '</span>' +
                '<button class="tareas-pag-btn" id="tareasPagNext" ' + (_crmPage >= _crmTotalPages ? 'disabled' : '') + ' onclick="crmTareasPagSiguiente()">Siguiente &#8594;</button>' +
                '</div>';
        }

        window.crmTareasPagAnterior = function () {
            if (_crmPage > 1) { _crmPage--; cargarTareasCRM(_crmCurrentFilter, _crmPage); }
        };
        window.crmTareasPagSiguiente = function () {
            if (_crmPage < _crmTotalPages) { _crmPage++; cargarTareasCRM(_crmCurrentFilter, _crmPage); }
        };

        // ── Renderizar tabla de tareas ──

        // Restaurar tab desde localStorage (HTML + topbar ya aplicaron estilos antes del paint).
        // Si la URL trae ?tab=calendario, el server-render marca btnCalendario activo y
        // NO debemos sobrescribir con el crmView persistido (eso causaba doble-active).
        var _urlTab = null;
        try { _urlTab = new URL(window.location.href).searchParams.get('tab'); } catch (e) {}
        var _savedView = localStorage.getItem('crmView');
        // Guard: páginas externas al CRM (como /app/reportes/) también cargan
        // crm_main.js para tener openDetalle, pero NO deben restaurar el sidebar
        // — el server-render ya marcó el botón correcto. Sin este guard se veía
        // doble-active (ej. Reportes + Tareas ambos azules en /app/reportes/).
        // OJO: el CRM home se sirve en /app/home/ (principal) Y /app/todos/
        // (alias histórico). Faltaba /app/home → en una recarga F5 en
        // /app/home/ este guard daba false y se SALTABA toda la restauración
        // de vista (Tareas/Proyectos quedaban vacíos hasta volver a dar clic).
        // Alineado con el mismo check de _sidebar.html.
        var _path = window.location.pathname;
        var _isCrmHome = _path.indexOf('/app/home') === 0
                      || _path.indexOf('/app/todos') === 0
                      || _path === '/app/'
                      || _path === '/app';
        if (!_isCrmHome) {
            // No-op: no restaurar nada del CRM en páginas externas.
        } else if (_urlTab !== 'calendario' && _savedView === 'tareas') {
            window._crmTareasMode = true;
            // ACTIVAR la sección igual que el clic en el botón Tareas
            // (switchCrmView oculta el CRM y marca tareasSection .active). Antes
            // solo se marcaba el botón → en una recarga F5 la sección no quedaba
            // bien activada y se veía vacía hasta volver a dar clic. Solo corre
            // en este branch (reload-en-tareas), NO en cada carga → sin costo.
            if (typeof switchCrmView === 'function') switchCrmView('tareas');
            var btnTareasInit = document.getElementById('btnTareas');
            if (btnTareasInit) btnTareasInit.classList.add('active');
            // Sin reset de caché aquí: en una recarga el caché ya está vacío,
            // y resetearlo en el 2º dispatch (turbo:load) podía descartar el
            // resultado del fetch ya completado → fetch extra. El guard
            // _crmTareasFetching de cargarTareasCRM evita los duplicados.
            cargarTareasCRM();
        } else if (_urlTab !== 'calendario' && _savedView === 'proyectos') {
            if (typeof switchCrmView === 'function') switchCrmView('proyectos');
            var btnProyInit = document.getElementById('btnProyectos');
            if (btnProyInit) btnProyInit.classList.add('active');
            if (typeof proyectosInit === 'function') proyectosInit();
        }


        // ═══ Estado del Focus de tareas ═══
        var _tareasFocusStorageKey = 'tareasFocusState_v1';
        var ORDER_PROYECTO_TAREAS = ['Oportunidad','Levantamiento','Base Cotización','Cotizando','Enviada','Seguimiento','Vendido s/PO','Vendido c/PO','Cotiz. Proveedor','Comprando','En Tránsito','Ejecutando','Entregado','Facturado','Reportes','Pagado','Perdido'];
        var ORDER_RUNRATE_TAREAS = ['En Solicitud','Cotizando','Enviada','Seguimiento','Vendido s/PO','Vendido c/PO','En Tránsito','Facturado','Programado','Entregado','Esperando Pago','Sin Respuesta','Ganado','Perdido'];

        var _tareasFocus = {
            flow: 'proyecto',
            selected: { proyecto: 'ALL', runrate: 'ALL' },
            urgency: 'todas',       // 'todas' | 'atrasadas' | 'hoy'
            wasOpen: false,
            firstLoad: true
        };
        try {
            var _tfSaved = localStorage.getItem(_tareasFocusStorageKey);
            if (_tfSaved) {
                var tfp = JSON.parse(_tfSaved);
                if (tfp && typeof tfp === 'object') {
                    _tareasFocus.firstLoad = false;
                    if (tfp.flow === 'proyecto' || tfp.flow === 'runrate') _tareasFocus.flow = tfp.flow;
                    if (tfp.selected && typeof tfp.selected === 'object') {
                        if ('proyecto' in tfp.selected) _tareasFocus.selected.proyecto = tfp.selected.proyecto;
                        if ('runrate' in tfp.selected) _tareasFocus.selected.runrate = tfp.selected.runrate;
                    }
                    if (tfp.urgency === 'atrasadas' || tfp.urgency === 'hoy' || tfp.urgency === 'todas') _tareasFocus.urgency = tfp.urgency;
                    _tareasFocus.wasOpen = !!tfp.wasOpen;
                }
            }
        } catch(e) {}

        function _tareasFocusPersist() {
            try {
                var sb = document.getElementById('tareasFocusSidebar');
                localStorage.setItem(_tareasFocusStorageKey, JSON.stringify({
                    flow: _tareasFocus.flow,
                    selected: _tareasFocus.selected,
                    urgency: _tareasFocus.urgency,
                    wasOpen: sb ? sb.classList.contains('open') : false
                }));
            } catch(e) {}
        }

        function _tareasGetStagesForFlow(flow) {
            return (flow === 'proyecto' ? ORDER_PROYECTO_TAREAS : ORDER_RUNRATE_TAREAS).slice();
        }

        function _tareasIsOverdue(tarea, now) {
            if (tarea.estado === 'completada') return false;
            if (!tarea.fecha_limite) return false;
            return new Date(tarea.fecha_limite) < now;
        }
        function _tareasIsToday(tarea, now) {
            if (tarea.estado === 'completada') return false;
            if (!tarea.fecha_limite) return false;
            var d = new Date(tarea.fecha_limite);
            return d.getFullYear() === now.getFullYear() &&
                   d.getMonth() === now.getMonth() &&
                   d.getDate() === now.getDate();
        }

        function _tareasCalcStageCounts(flow) {
            var stages = _tareasGetStagesForFlow(flow);
            var counts = {};
            stages.forEach(function(s){ counts[s] = 0; });
            (_crmAllTareas || []).forEach(function(t){
                if (t.estado === 'completada') return;
                if (!t.oportunidad_tipo) return;
                if (t.oportunidad_tipo !== flow) return;
                var et = t.oportunidad_etapa || '';
                if (!et) return;
                if (counts.hasOwnProperty(et)) counts[et] += 1;
                else counts[et] = 1;
            });
            return { stages: stages, counts: counts };
        }

        function _tareasApplySmartDefault() {
            if (!_tareasFocus.firstLoad) return;
            // Intentar primera etapa con cards en 'proyecto'
            var data = _tareasCalcStageCounts('proyecto');
            for (var i = 0; i < data.stages.length; i++) {
                if ((data.counts[data.stages[i]] || 0) > 0) {
                    _tareasFocus.flow = 'proyecto';
                    _tareasFocus.selected.proyecto = i;
                    return;
                }
            }
        }

        function _tareasRenderSidebar() {
            var flowBtns = document.querySelectorAll('#tareasFocusSidebar .tareasFocus-toggle button');
            flowBtns.forEach(function(b){ b.classList.toggle('active', b.dataset.flow === _tareasFocus.flow); });

            var now = new Date();
            var atrasadas = 0, hoy = 0, totalPend = 0;
            (_crmAllTareas || []).forEach(function(t){
                if (t.estado === 'completada') return;
                totalPend++;
                if (_tareasIsOverdue(t, now)) atrasadas++;
                if (_tareasIsToday(t, now)) hoy++;
            });
            var kA = document.getElementById('tareasFocusKpiAtrasadas');
            var kH = document.getElementById('tareasFocusKpiHoy');
            if (kA) kA.textContent = String(atrasadas);
            if (kH) kH.textContent = String(hoy);
            var sub = document.getElementById('tareasFocusAllSub');
            if (sub) sub.textContent = totalPend + ' pendientes';

            var allBtn = document.querySelector('#tareasFocusSidebar .tareasFocus-all');
            var selected = _tareasFocus.selected[_tareasFocus.flow];
            if (allBtn) allBtn.classList.toggle('active', selected === 'ALL');

            var data = _tareasCalcStageCounts(_tareasFocus.flow);
            var cont = document.getElementById('tareasFocusStages');
            if (!cont) return;
            cont.innerHTML = '';
            data.stages.forEach(function(name, idx){
                var count = data.counts[name] || 0;
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'tareasFocus-stage' + (selected === idx ? ' active' : '');
                btn.setAttribute('data-idx', String(idx));
                btn.innerHTML =
                    '<div class="tareasFocus-stage-node"></div>' +
                    '<span class="tareasFocus-stage-name">' + name + '</span>' +
                    '<span class="tareasFocus-stage-count' + (count === 0 ? ' zero' : '') + '">' + count + '</span>';
                btn.addEventListener('click', function(){ _tareasFocusSelectStage(idx); });
                cont.appendChild(btn);
            });

            // Urgency pills
            document.querySelectorAll('#tareasUrgencyPills button').forEach(function(p){
                p.classList.toggle('active', p.dataset.urg === _tareasFocus.urgency);
            });

            // Toolbar title
            var title = document.getElementById('tareasToolbarTitle');
            if (title) {
                if (selected === 'ALL') title.textContent = 'Todas las Tareas';
                else title.textContent = data.stages[selected] || 'Tareas';
            }
        }

        function _tareasFocusSelectStage(idxOrAll) {
            _tareasFocus.selected[_tareasFocus.flow] = idxOrAll;
            _tareasFocus.firstLoad = false;
            _tareasFocusPersist();
            _tareasRenderSidebar();
            renderTareasCRM();
        }
        function _tareasFocusSwitchFlow(flow) {
            _tareasFocus.flow = flow;
            _tareasFocus.firstLoad = false;
            _tareasFocusPersist();
            _tareasRenderSidebar();
            renderTareasCRM();
        }
        function _tareasFocusSetUrgency(urg) {
            _tareasFocus.urgency = urg;
            _tareasFocus.firstLoad = false;
            _tareasFocusPersist();
            _tareasRenderSidebar();
            renderTareasCRM();
        }
        function _tareasFocusOpen() {
            var sb = document.getElementById('tareasFocusSidebar');
            var vc = document.getElementById('tareasViewCards');
            if (sb) sb.classList.add('open');
            if (vc) vc.classList.add('tareasFocus-open');
            _tareasFocusPersist();
        }
        function _tareasFocusClose() {
            var sb = document.getElementById('tareasFocusSidebar');
            var vc = document.getElementById('tareasViewCards');
            if (sb) sb.classList.remove('open');
            if (vc) vc.classList.remove('tareasFocus-open');
            _tareasFocusPersist();
        }

        function _tareasDiasVencida(t, now) {
            if (!t.fecha_limite) return 0;
            var fin = new Date(t.fecha_limite);
            if (fin >= now) return 0;
            return Math.floor((now.getTime() - fin.getTime()) / (1000 * 60 * 60 * 24));
        }

        function _tareasHeatClass(dias) {
            if (dias >= 30) return 'heat-max';
            if (dias >= 14) return 'heat-5';
            if (dias >= 7)  return 'heat-4';
            if (dias >= 3)  return 'heat-3';
            if (dias >= 1)  return 'heat-2';
            return 'heat-1';
        }

        function renderTareasCRM() {
            var grid = document.getElementById('tareasCardsGrid');
            var listBody = document.getElementById('tareasListBody');
            if (!grid && !listBody) return;

            var tareas = (_crmAllTareas || []).slice();

            // NO excluimos completadas — se muestran marcadas (verde) y ordenadas al final

            // Contadores globales (para los tabs) — ANTES de aplicar urgency
            var now = new Date();
            var countTodas = tareas.length;
            var countAtrasadas = tareas.filter(function(t){ return _tareasIsOverdue(t, now); }).length;
            var countHoy = tareas.filter(function(t){ return _tareasIsToday(t, now); }).length;
            var badgeTodas = document.getElementById('tareasCountTodas');
            var badgeAtrasadas = document.getElementById('tareasCountAtrasadas');
            var badgeHoy = document.getElementById('tareasCountHoy');
            if (badgeTodas) badgeTodas.textContent = countTodas;
            if (badgeAtrasadas) badgeAtrasadas.textContent = countAtrasadas;
            if (badgeHoy) badgeHoy.textContent = countHoy;

            // Filtro por urgency (tabs)
            if (_tareasFocus.urgency === 'atrasadas') {
                tareas = tareas.filter(function(t){ return _tareasIsOverdue(t, now); });
            } else if (_tareasFocus.urgency === 'hoy') {
                tareas = tareas.filter(function(t){ return _tareasIsToday(t, now); });
            }

            // Filtros del facet bar (hidden inputs)
            function $tIn(id) { return document.getElementById(id); }
            var fTipo    = ($tIn('tareasFilterTipo')    || {}).value || '';
            var fEtapa   = ($tIn('tareasFilterEtapa')   || {}).value || '';
            var fResp    = ($tIn('tareasFilterResp')    || {}).value || '';
            var fCread   = ($tIn('tareasFilterCreador') || {}).value || '';
            var fDesde   = ($tIn('tareasFilterDesde')   || {}).value || '';
            var fHasta   = ($tIn('tareasFilterHasta')   || {}).value || '';
            if (fTipo)  tareas = tareas.filter(function(t){ return (t.oportunidad_tipo || '') === fTipo; });
            if (fEtapa) tareas = tareas.filter(function(t){ return (t.oportunidad_etapa || '').toLowerCase().indexOf(fEtapa.toLowerCase()) !== -1; });
            if (fResp)  tareas = tareas.filter(function(t){ return String(t.asignado_a_id || '') === String(fResp); });
            if (fCread) tareas = tareas.filter(function(t){ return String(t.creado_por_id || '') === String(fCread); });
            if (fDesde || fHasta) {
                tareas = tareas.filter(function(t){
                    if (!t.fecha_limite) return false;
                    var fl = t.fecha_limite.substring(0, 10);
                    if (fDesde && fl < fDesde) return false;
                    if (fHasta && fl > fHasta) return false;
                    return true;
                });
            }

            // Búsqueda: matchea contra search_blob (campo del API que concatena
            // título + descripción + comentarios + nombres de archivos +
            // proyecto + oportunidad + cliente + responsable + creado_por).
            // Fallback a campos básicos cuando search_blob no viene en la
            // respuesta (ej. vistas anidadas que no lo incluyen).
            var searchVal = ($tIn('tareasSearchInput') || {}).value || '';
            if (searchVal.trim()) {
                var q = searchVal.trim().toLowerCase();
                tareas = tareas.filter(function(t){
                    if (t.search_blob) return t.search_blob.indexOf(q) !== -1;
                    return (t.titulo || '').toLowerCase().indexOf(q) !== -1 ||
                           (t.oportunidad_nombre || '').toLowerCase().indexOf(q) !== -1 ||
                           (t.oportunidad_po || '').toLowerCase().indexOf(q) !== -1 ||
                           (t.oportunidad_cliente || '').toLowerCase().indexOf(q) !== -1 ||
                           (t.responsable || '').toLowerCase().indexOf(q) !== -1;
                });
            }

            // Sort: completadas SIEMPRE al final > ancladas > rojas > próximas por fecha
            var userSort = ($tIn('tareasSort') || {}).value || '';
            tareas.sort(function(a, b){
                var aD = a.estado === 'completada';
                var bD = b.estado === 'completada';
                if (aD !== bD) return aD ? 1 : -1;
                var aP = !!a.esta_anclada;
                var bP = !!b.esta_anclada;
                if (aP !== bP) return aP ? -1 : 1;
                if (userSort === 'fecha:asc' || userSort === 'fecha:desc') {
                    var aT = a.fecha_limite ? new Date(a.fecha_limite).getTime() : Infinity;
                    var bT = b.fecha_limite ? new Date(b.fecha_limite).getTime() : Infinity;
                    return userSort === 'fecha:desc' ? (bT - aT) : (aT - bT);
                }
                // Default: vencidas (más días) → resto ascendente por fecha
                var aV = _tareasIsOverdue(a, now);
                var bV = _tareasIsOverdue(b, now);
                if (aV !== bV) return aV ? -1 : 1;
                if (aV && bV) return _tareasDiasVencida(b, now) - _tareasDiasVencida(a, now);
                var aTd = a.fecha_limite ? new Date(a.fecha_limite).getTime() : Infinity;
                var bTd = b.fecha_limite ? new Date(b.fecha_limite).getTime() : Infinity;
                return aTd - bTd;
            });

            // Render cards (vista legacy, oculta por default)
            if (grid) {
                if (tareas.length === 0) {
                    grid.innerHTML = '<div class="tareas-empty-card">No hay tareas.</div>';
                } else {
                    grid.innerHTML = tareas.map(function(t){ return createTaskCardCRM(t, now); }).join('');
                }
            }
            // Render list (nueva default)
            if (listBody) {
                if (tareas.length === 0) {
                    listBody.innerHTML = '<div style="text-align:center;padding:40px 0;color:#94A3B8;font-size:0.85rem;">No hay tareas.</div>';
                } else {
                    listBody.innerHTML = tareas.map(function(t){ return createTaskListRowCRM(t, now); }).join('');
                }
            }
            // Render calendar si visible
            renderTareasCalendar(tareas, now);
            // Render cockpit si visible
            if (typeof renderTareasCockpit === 'function') renderTareasCockpit(tareas, now);

            // Clear button visibility
            var clrBtn = document.getElementById('btnTareasFacetClear');
            if (clrBtn) {
                var anyFilter = !!(fTipo || fEtapa || fResp || fCread || fDesde || fHasta);
                clrBtn.style.display = anyFilter ? '' : 'none';
            }
        }

        // ── Vista CALENDARIO semanal ──────────────────────────────────
        // Estado: lunes de la semana visible (Date al 00:00 hora local)
        var _tareasCalWeekStart = null;

        function _getMondayOf(d) {
            var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            var dow = x.getDay();  // 0=Dom, 1=Lun, ..., 6=Sáb
            var diff = dow === 0 ? -6 : 1 - dow;  // siempre al lunes
            x.setDate(x.getDate() + diff);
            return x;
        }
        function _fmtDateKey(d) {
            var m = String(d.getMonth() + 1).padStart(2, '0');
            var day = String(d.getDate()).padStart(2, '0');
            return d.getFullYear() + '-' + m + '-' + day;
        }
        function _dateFromIso(iso) {
            if (!iso) return null;
            var d = new Date(iso);
            if (isNaN(d.getTime())) return null;
            return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        }
        if (_tareasCalWeekStart === null) _tareasCalWeekStart = _getMondayOf(new Date());
        window._tareasCalShiftWeek = function(delta) {
            _tareasCalWeekStart.setDate(_tareasCalWeekStart.getDate() + delta * 7);
            renderTareasCRM();
        };
        window._tareasCalGoToday = function() {
            _tareasCalWeekStart = _getMondayOf(new Date());
            renderTareasCRM();
        };

        // ═══ Vista COCKPIT (split: list + detail panel) ═══
        var _tcpSelectedId = null;
        var _tcpCollapsedSections = {};

        function _tcpAvatarColor(nombre) {
            var colors = ['#E11D48','#DC2626','#F59E0B','#CA8A04','#16A34A','#0891B2','#2563EB','#7C3AED','#DB2777','#0EA5E9'];
            var h = 0;
            var s = nombre || '?';
            for (var i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
            return colors[Math.abs(h) % colors.length];
        }
        function _tcpInitials(nombre) {
            if (!nombre) return '?';
            var parts = nombre.trim().split(/\s+/);
            if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
            return parts[0].substring(0, 2).toUpperCase();
        }
        function _tcpFirstName(nombre) {
            if (!nombre) return '';
            return (nombre.trim().split(/\s+/)[0] || '').slice(0, 12);
        }
        function _tcpFmtFecha(iso) {
            if (!iso) return 'Sin fecha';
            var d = new Date(iso);
            if (isNaN(d.getTime())) return '';
            var MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
            var hh = String(d.getHours()).padStart(2, '0');
            var mm = String(d.getMinutes()).padStart(2, '0');
            return d.getDate() + ' ' + MES[d.getMonth()] + ', ' + hh + ':' + mm;
        }
        function _tcpEstadoClass(estado) {
            return (estado || 'pendiente').toLowerCase().replace(/\s+/g, '_');
        }
        function _tcpEstadoLabel(estado) {
            var map = {
                pendiente: 'Pendiente', iniciada: 'Iniciada', en_progreso: 'En progreso',
                completada: 'Completada', cancelada: 'Cancelada'
            };
            return map[estado] || (estado ? estado.charAt(0).toUpperCase() + estado.slice(1) : 'Pendiente');
        }

        function renderTareasCockpit(tareas, now) {
            var list = document.getElementById('tcpList');
            if (!list) return;
            if (!tareas || tareas.length === 0) {
                list.innerHTML = '<div class="tcp-row-empty">No hay tareas con los filtros actuales.</div>';
                return;
            }

            // Agrupar en 4 secciones: ATRASADAS / HOY / MÁS TARDE / COMPLETADAS
            // Las completadas van en su propia sección AL FINAL (antes se mezclaban
            // en "MÁS TARDE"), colapsada por defecto para no estorbar.
            var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            var tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
            var groups = { atrasadas: [], hoy: [], despues: [], completadas: [] };

            tareas.forEach(function(t) {
                if (t.estado === 'completada') { groups.completadas.push(t); return; }
                if (!t.fecha_limite) { groups.despues.push(t); return; }
                var fl = new Date(t.fecha_limite);
                if (fl < today) groups.atrasadas.push(t);
                else if (fl < tomorrow) groups.hoy.push(t);
                else groups.despues.push(t);
            });
            // Completadas: colapsada por defecto (solo la primera vez; respeta el
            // toggle manual del usuario después).
            if (_tcpCollapsedSections.completadas === undefined) {
                _tcpCollapsedSections.completadas = true;
            }

            var MES_HOY = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
            var hoyLabel = MES_HOY[today.getDay()] + ' ' + today.getDate() + ' ' + ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'][today.getMonth()];

            var secciones = [
                { key: 'atrasadas', label: 'ATRASADAS',   extra: '', items: groups.atrasadas, cls: 'atrasadas' },
                { key: 'hoy',       label: 'HOY',         extra: ' · ' + hoyLabel, items: groups.hoy, cls: '' },
                { key: 'despues',   label: 'MÁS TARDE',   extra: '', items: groups.despues,   cls: '' },
                { key: 'completadas', label: 'COMPLETADAS', extra: '', items: groups.completadas, cls: 'completadas' },
            ];

            // Cabecera de columnas sticky (siempre primera)
            var html = '<div class="tcp-col-head">' +
                '<span>TAREA</span>' +
                '<span>ESTADO</span>' +
                '<span>RESPONSABLE</span>' +
                '<span>CREADOR</span>' +
                '<span>FECHA LÍMITE</span>' +
                '<span>OPORTUNIDAD</span>' +
                '</div>';

            secciones.forEach(function(sec) {
                // HOY se muestra siempre (incluso con 0); atrasadas y más tarde solo si tienen items
                if (sec.items.length === 0 && sec.key !== 'hoy') return;
                var collapsed = _tcpCollapsedSections[sec.key] ? ' collapsed' : '';
                html += '<div class="tcp-section-head ' + sec.cls + collapsed + '" data-tcp-sec="' + sec.key + '">' +
                    '<svg class="tcp-sec-chev" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>' +
                    '<span>' + sec.label + sec.extra + '</span>' +
                    '<span class="tcp-sec-count">' + sec.items.length + '</span>' +
                    '</div>';
                html += '<div class="tcp-section-body">';
                if (sec.items.length === 0) {
                    html += '<div style="padding:18px 24px;color:#94A3B8;font-size:12.5px;font-style:italic;">No tienes tareas para hoy.</div>';
                } else {
                    sec.items.forEach(function(t) {
                        html += _tcpRowHtml(t, sec.key === 'atrasadas');
                    });
                }
                html += '</div>';
            });
            list.innerHTML = html;

            // Restaurar selección
            if (_tcpSelectedId) {
                var rowSel = list.querySelector('.tcp-row[data-tid="' + _tcpSelectedId + '"]');
                if (rowSel) rowSel.classList.add('active');
            } else {
                // Sin selección → renderizar dashboard de resumen en el panel derecho
                _tcpRenderSummary(tareas, now);
            }
        }

        function _tcpRenderSummary(tareas, now) {
            var panel = document.getElementById('tcpDetail');
            if (!panel) return;
            var miId = (typeof _CRM_CONFIG !== 'undefined' && _CRM_CONFIG.userId) ? _CRM_CONFIG.userId : null;
            var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            var tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

            // Filtrar tareas del usuario (como responsable)
            var misTareas = (_crmAllTareas || []).filter(function(t) {
                return miId && String(t.asignado_a_id || '') === String(miId);
            });

            var vencidas = 0, hoy = 0, completadasHoy = 0, totalAbiertas = 0;
            var proximasCandidatas = [];  // tareas abiertas ordenables por fecha

            misTareas.forEach(function(t) {
                if (t.estado === 'completada') {
                    var fc = t.fecha_completada || t.fecha_actualizacion || t.updated_at;
                    if (fc) {
                        var d = new Date(fc);
                        if (!isNaN(d.getTime()) && d >= today && d < tomorrow) completadasHoy++;
                    } else {
                        completadasHoy++;
                    }
                    return;
                }
                totalAbiertas++;
                if (t.fecha_limite) {
                    var fl = new Date(t.fecha_limite);
                    if (!isNaN(fl.getTime())) {
                        if (fl < today) vencidas++;
                        else if (fl < tomorrow) hoy++;
                        proximasCandidatas.push({ t: t, fl: fl });
                    }
                }
            });

            // Top 4 próximas por fecha ascendente (incluye vencidas al inicio)
            proximasCandidatas.sort(function(a, b) { return a.fl - b.fl; });
            var proximas = proximasCandidatas.slice(0, 4);

            var nombre = (typeof _CRM_CONFIG !== 'undefined' && _CRM_CONFIG.usuarioNombre)
                ? _CRM_CONFIG.usuarioNombre.split(' ')[0] : '';
            var horaN = now.getHours();
            var saludo = horaN < 12 ? 'Buenos días' : (horaN < 19 ? 'Buenas tardes' : 'Buenas noches');

            var subtexto;
            if (totalAbiertas === 0) subtexto = 'No tienes tareas pendientes asignadas.';
            else if (vencidas > 0) subtexto = 'Tienes <strong>' + vencidas + '</strong> tarea' + (vencidas === 1 ? '' : 's') + ' vencida' + (vencidas === 1 ? '' : 's') + ' que atender.';
            else if (hoy > 0) subtexto = '<strong>' + hoy + '</strong> tarea' + (hoy === 1 ? '' : 's') + ' para hoy.';
            else subtexto = 'Tienes ' + totalAbiertas + ' tarea' + (totalAbiertas === 1 ? '' : 's') + ' abierta' + (totalAbiertas === 1 ? '' : 's') + '. No hay nada urgente.';

            var html = '<div class="tcp-empty">' +
                '<div class="tcp-summary-label">Tu día</div>' +
                '<h2 class="tcp-summary-greeting">' + saludo + (nombre ? ', ' + _tcpEsc(nombre) : '') + '</h2>' +
                '<p class="tcp-summary-sub">' + subtexto + '</p>' +

                // Trío horizontal compacto
                '<div class="tcp-summary-row">' +
                    _tcpSummaryStat('vencidas', vencidas, 'Vencidas') +
                    _tcpSummaryStat('hoy', hoy, 'Hoy') +
                    _tcpSummaryStat('done', completadasHoy, 'Hechas hoy') +
                '</div>' +

                // Próximas tareas
                '<div class="tcp-summary-section">' +
                    '<div class="tcp-summary-sec-label">' +
                        '<span>Próximas</span>' +
                        (proximas.length > 0 ? '<span class="count">' + proximas.length + '</span>' : '') +
                    '</div>' +
                    (proximas.length > 0
                        ? '<div class="tcp-summary-upcoming">' + proximas.map(function(x) { return _tcpUpcomingRow(x.t, x.fl, today, tomorrow); }).join('') + '</div>'
                        : '<div class="tcp-summary-empty">Nada próximo en tu calendario.</div>') +
                '</div>' +

                '<div style="flex:1;"></div>' +
                '<div style="text-align:center;font-size:11.5px;color:#CBD5E1;padding:18px 0 2px;">' +
                    'Haz clic en una tarea para ver el detalle aquí.' +
                '</div>' +
                '</div>';
            panel.innerHTML = html;
        }

        function _tcpSummaryStat(key, num, label) {
            var hasCls = num > 0 ? ' has-items' : '';
            return '<div class="tcp-summary-stat ' + key + hasCls + '">' +
                '<span class="tcp-summary-stat-num">' + num + '</span>' +
                '<span class="tcp-summary-stat-lbl">' + label + '</span>' +
                '</div>';
        }

        function _tcpUpcomingRow(t, fl, today, tomorrow) {
            var overdue = fl < today;
            var urgent = !overdue && fl < tomorrow;
            var cls = overdue ? ' overdue' : (urgent ? ' urgent' : '');
            var when = _tcpRelativeWhen(fl, today, tomorrow);
            return '<div class="tcp-summary-up-row' + cls + '" onclick="tcpSelectTask(' + t.id + ')">' +
                '<span class="tcp-summary-up-dot"></span>' +
                '<span class="tcp-summary-up-title" title="' + _tcpEsc(t.titulo || '') + '">' + _tcpEsc(t.titulo || 'Sin título') + '</span>' +
                '<span class="tcp-summary-up-when">' + when + '</span>' +
                '</div>';
        }

        function _tcpRelativeWhen(fl, today, tomorrow) {
            var ms = fl - new Date();
            var absDays = Math.floor(Math.abs(ms) / 86400000);
            if (fl < today) {
                if (absDays === 0) return 'hoy';
                if (absDays === 1) return 'ayer';
                return 'hace ' + absDays + 'd';
            }
            if (fl < tomorrow) {
                var h = Math.round(ms / 3600000);
                if (h <= 0) return 'hoy';
                if (h === 1) return 'en 1h';
                if (h < 24) return 'en ' + h + 'h';
                return 'hoy';
            }
            var d = Math.ceil(ms / 86400000);
            if (d === 1) return 'mañana';
            if (d <= 7) return 'en ' + d + 'd';
            // Fecha corta
            var MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
            return fl.getDate() + ' ' + MES[fl.getMonth()];
        }

        function _tcpRowHtml(t, esAtrasada) {
            var estadoCls = _tcpEstadoClass(t.estado);
            var estadoLbl = _tcpEstadoLabel(t.estado).toUpperCase();
            var resp = t.responsable || '';
            var creador = t.creado_por || t.creador || '';
            var respTxt = _tcpFirstName(resp);
            var creaTxt = _tcpFirstName(creador);
            var oppNombre = t.oportunidad_nombre || '';
            var oppId = t.oportunidad_id || '';
            var doneCls = t.estado === 'completada' ? ' done' : '';
            var atrCls = esAtrasada ? ' atrasada' : '';
            var modCls = t.tiene_cambios ? ' modificada' : '';

            // TAREA: warning icon (solo atrasadas) + título
            var warnIcon = esAtrasada
                ? '<span class="tcp-row-warn" title="Vencida"><svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" stroke-width="0" fill="#EF4444"/><path d="M12 9v4M12 17h.01" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg></span>'
                : '';

            // OPORTUNIDAD: clickable si hay oppId
            var oppCell = oppId
                ? '<span class="tcp-row-opp linked" title="' + _tcpEsc(oppNombre) + '" onclick="event.stopPropagation();tcpAbrirOportunidad(' + oppId + ')">' + _tcpEsc(oppNombre || '—') + '</span>'
                : '<span class="tcp-row-opp' + (oppNombre ? '' : ' empty') + '">' + _tcpEsc(oppNombre || '—') + '</span>';

            // FECHA: pill con calendar icon
            var calSvg = '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
            var fechaTxt = t.fecha_limite ? _tcpFmtFecha(t.fecha_limite) : '';
            var fechaCell = fechaTxt
                ? '<span class="tcp-row-fecha' + (esAtrasada ? ' atrasada' : '') + '">' + calSvg + ' ' + fechaTxt + '</span>'
                : '<span class="tcp-row-fecha" style="background:transparent;color:#CBD5E1;padding:0;">—</span>';

            return '<div class="tcp-row' + doneCls + atrCls + modCls + '" data-tid="' + t.id + '" onclick="tcpSelectTask(' + t.id + ')">' +
                '<span class="tcp-row-tarea">' +
                    warnIcon +
                    '<span class="tcp-row-title">' + _tcpEsc(t.titulo || 'Sin título') + '</span>' +
                '</span>' +
                '<span class="tcp-row-estado ' + estadoCls + '">' + estadoLbl + '</span>' +
                '<span class="tcp-row-resp' + (respTxt ? '' : ' empty') + '">' + _tcpEsc(respTxt || '—') + '</span>' +
                '<span class="tcp-row-creador' + (creaTxt ? '' : ' empty') + '">' + _tcpEsc(creaTxt || '—') + '</span>' +
                fechaCell +
                oppCell +
                '</div>';
        }

        // Abrir widget de oportunidad desde la celda
        window.tcpAbrirOportunidad = function(oppId) {
            if (!oppId) return;
            if (typeof window.openDetalle === 'function') window.openDetalle(oppId);
        };

        function _tcpEsc(s) {
            if (!s) return '';
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        // Toggle sección collapse/expand
        // (2026-06-11 fix) Remover-y-reagregar: este wireup corre en cada
        // turbo:load y document persiste — sin esto se apilaba un listener
        // por navegación. Se conserva siempre el de la generación vigente
        // (su closure _tcpCollapsedSections es el vivo).
        if (window._tcpSecHeadHandler) {
            document.removeEventListener('click', window._tcpSecHeadHandler);
        }
        window._tcpSecHeadHandler = function(e) {
            var head = e.target.closest && e.target.closest('.tcp-section-head');
            if (!head) return;
            var key = head.dataset.tcpSec;
            if (!key) return;
            var isCol = head.classList.toggle('collapsed');
            _tcpCollapsedSections[key] = isCol;
        };
        document.addEventListener('click', window._tcpSecHeadHandler);

        // Selección de fila → poblar panel derecho
        window.tcpSelectTask = function(tid) {
            _tcpSelectedId = tid;
            document.querySelectorAll('#tcpList .tcp-row').forEach(function(r) { r.classList.remove('active'); });
            var row = document.querySelector('#tcpList .tcp-row[data-tid="' + tid + '"]');
            if (row) row.classList.add('active');

            var t = (_crmAllTareas || []).find(function(x) { return x.id === tid; });
            var panel = document.getElementById('tcpDetail');
            if (!panel || !t) return;

            var estadoCls = _tcpEstadoClass(t.estado);
            var estadoLbl = _tcpEstadoLabel(t.estado).toUpperCase();
            var resp = t.responsable || '';
            var avColor = _tcpAvatarColor(resp);
            var ini = _tcpInitials(resp);
            var cliente = t.cliente_nombre || t.oportunidad_nombre || '';
            var fechaIso = t.fecha_limite || '';
            var vencida = false;
            if (fechaIso) {
                try { vencida = new Date(fechaIso) < new Date() && t.estado !== 'completada'; } catch(_){}
            }
            var fechaTxt = _tcpFmtFecha(fechaIso);
            var prioLabel = t.prioridad === 'alta' ? 'Alta' : 'Normal';
            var tipo = t.oportunidad_tipo || '';
            var categoria = tipo ? (tipo.charAt(0).toUpperCase() + tipo.slice(1)) : '—';

            // Subtareas
            var subtsHtml = '<div class="tcp-subt-empty">Sin subtareas</div>';
            var subtHead = 'SUBTAREAS';
            var subs = t.subtareas || [];
            if (subs.length > 0) {
                var doneN = subs.filter(function(s) { return s.estado === 'completada'; }).length;
                subtHead = 'SUBTAREAS (' + doneN + '/' + subs.length + ')';
                subtsHtml = '<div class="tcp-subt-list">' + subs.map(function(s) {
                    var dn = s.estado === 'completada';
                    return '<div class="tcp-subt-row' + (dn ? ' done' : '') + '" onclick="crmTaskVerDetalle(' + s.id + ')">' +
                        '<span class="tcp-subt-check' + (dn ? ' done' : '') + '">' + (dn ? '<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : '') + '</span>' +
                        '<span class="tcp-subt-title">' + _tcpEsc(s.titulo || '') + '</span>' +
                        '</div>';
                }).join('') + '</div>';
            }

            var descHtml = t.descripcion
                ? '<div class="tcp-detail-desc">' + _tcpEsc(t.descripcion).replace(/\n/g, '<br>') + '</div>'
                : '<div class="tcp-detail-desc empty">Sin descripción.</div>';

            // Clock SVG para fechas (usado en pill vencida, sin icono ⚠)
            var clockIcon = '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

            // Oportunidad con link si existe (reemplaza el renglón "Cliente")
            var oppVal;
            if (t.oportunidad_id && t.oportunidad_nombre) {
                oppVal = '<span class="tcp-opp-link" onclick="tcpAbrirOportunidad(' + t.oportunidad_id + ')" title="Abrir oportunidad">' + _tcpEsc(t.oportunidad_nombre) + '</span>';
            } else if (t.oportunidad_nombre) {
                oppVal = _tcpEsc(t.oportunidad_nombre);
            } else {
                oppVal = '<span class="muted">Sin oportunidad</span>';
            }

            panel.innerHTML =
                '<div class="tcp-detail-head">' +
                    '<span class="tcp-detail-estado ' + estadoCls + '">' + estadoLbl + '</span>' +
                    '<div class="tcp-detail-actions">' +
                        '<button class="tcp-detail-iconbtn tcp-expand-btn" title="Expandir · ver comentarios" onclick="tcpExpandir(' + t.id + ')"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>' +
                        '<button class="tcp-detail-iconbtn" title="Cerrar" onclick="tcpCloseDetail()"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
                    '</div>' +
                '</div>' +
                '<div class="tcp-detail-scroll">' +
                    '<h1 class="tcp-detail-title">' + _tcpEsc(t.titulo || 'Sin título') + '</h1>' +
                    descHtml +
                    '<div class="tcp-detail-meta">' +
                        _tcpMetaRow('Responsable', resp
                            ? '<span class="tcp-mini-avatar" style="background:' + avColor + '">' + ini + '</span>' + _tcpEsc(resp)
                            : '<span class="muted">Sin asignar</span>', 'user') +
                        _tcpMetaRow('Oportunidad', oppVal, 'briefcase') +
                        _tcpMetaRow('Fecha límite', fechaIso
                            ? '<span class="tcp-pill-fecha' + (vencida ? '' : ' normal') + '">' + clockIcon + ' ' + fechaTxt + '</span>'
                            : '<span class="muted">Sin fecha</span>', 'calendar') +
                        _tcpMetaRow('Categoría', categoria, 'tag') +
                        _tcpMetaRow('Prioridad', prioLabel, 'flag') +
                    '</div>' +
                    '<div class="tcp-detail-subt-head">' + subtHead + '</div>' +
                    subtsHtml +
                '</div>';
        };

        function _tcpMetaRow(label, valueHtml, icon) {
            var icons = {
                user:      '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
                briefcase: '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
                calendar:  '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
                tag:       '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/></svg>',
                flag:      '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
            };
            return '<div class="tcp-meta-row"><span class="tcp-meta-label">' + icons[icon] + label + '</span>' +
                   '<span class="tcp-meta-value">' + valueHtml + '</span></div>';
        }

        window.tcpCloseDetail = function() {
            _tcpSelectedId = null;
            document.querySelectorAll('#tcpList .tcp-row').forEach(function(r) { r.classList.remove('active'); });
            // Volver a mostrar el dashboard de resumen
            _tcpRenderSummary(_crmAllTareas || [], new Date());
        };

        window.tcpExpandir = function(tid) {
            // Abre el widget de detalle completo (con comentarios, subtareas editables, etc.)
            if (typeof crmTaskVerDetalle === 'function') crmTaskVerDetalle(tid);
        };

        window.tcpCopiarEnlace = function(tid) {
            var url = window.location.origin + '/app/?tarea=' + tid;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(function() {
                    if (typeof showToast === 'function') showToast('Enlace copiado', 'success', 1800);
                });
            }
        };

        window.tcpToggleCheck = function(tid) {
            // Abre el widget de detalle; desde allí el usuario puede completar con el botón
            if (typeof crmTaskVerDetalle === 'function') crmTaskVerDetalle(tid);
        };

        function renderTareasCalendar(tareas, now) {
            var board = document.getElementById('tareasCalBoard');
            var label = document.getElementById('tareasCalLabel');
            if (!board) return;

            var weekStart = _tareasCalWeekStart;
            var weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);

            // Label de la semana: "15 – 21 Abr 2026"
            var meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
            if (label) {
                var ls = weekStart.getDate();
                var le = weekEnd.getDate();
                var lm = (weekStart.getMonth() === weekEnd.getMonth())
                    ? meses[weekStart.getMonth()]
                    : meses[weekStart.getMonth()] + '/' + meses[weekEnd.getMonth()];
                label.textContent = ls + '–' + le + ' ' + lm + ' ' + weekEnd.getFullYear();
            }

            // Bucket tareas por día + atrasadas
            var buckets = { atrasadas: [] };
            var hasWeekend = { sat: false, sun: false };
            var todayKey = _fmtDateKey(new Date());

            // Preparar keys de los 7 días de la semana
            var dayKeys = [];
            for (var i = 0; i < 7; i++) {
                var d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
                dayKeys.push(_fmtDateKey(d));
                buckets[_fmtDateKey(d)] = [];
            }

            tareas.forEach(function(t) {
                if (!t.fecha_limite) return;
                var d = _dateFromIso(t.fecha_limite);
                if (!d) return;
                var k = _fmtDateKey(d);
                if (d < weekStart) {
                    buckets.atrasadas.push(t);
                } else if (buckets[k] !== undefined) {
                    buckets[k].push(t);
                    var dow = d.getDay();
                    if (dow === 6) hasWeekend.sat = true;
                    if (dow === 0) hasWeekend.sun = true;
                }
                // Tareas de semanas futuras no se muestran — usar navegación
            });

            // Sort buckets: completadas al final, luego rojas, luego el resto por fecha
            Object.keys(buckets).forEach(function(k) {
                buckets[k].sort(function(a, b) {
                    var aD = a.estado === 'completada';
                    var bD = b.estado === 'completada';
                    if (aD !== bD) return aD ? 1 : -1;  // completadas al final de su día
                    var aV = _tareasIsOverdue(a, now);
                    var bV = _tareasIsOverdue(b, now);
                    if (aV !== bV) return aV ? -1 : 1;
                    if (aV && bV) return _tareasDiasVencida(b, now) - _tareasDiasVencida(a, now);
                    var aT = a.fecha_limite ? new Date(a.fecha_limite).getTime() : Infinity;
                    var bT = b.fecha_limite ? new Date(b.fecha_limite).getTime() : Infinity;
                    return aT - bT;
                });
            });

            // Construir columnas
            var dayNames = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
            board.innerHTML = '';

            // Columna Atrasadas — SOLO se muestra si hay atrasadas
            if (buckets.atrasadas.length > 0) {
                var colAtr = document.createElement('div');
                colAtr.className = 'tareas-cal-col col-atrasadas';
                colAtr.innerHTML =
                    '<div class="tareas-cal-col-head">' +
                        '<div class="tareas-cal-col-head-row">' +
                            '<div><div class="tareas-cal-day-name">Atrasadas</div><div class="tareas-cal-day-num">' +
                                '<svg width="14" height="14" viewBox="0 0 24 24" fill="#B91C1C" stroke="none" style="vertical-align:-2px;"><path d="M12 2L1 21h22L12 2zm0 6v6m0 4v-2" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>' +
                            '</div></div>' +
                            '<span class="tareas-cal-count">' + buckets.atrasadas.length + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="tareas-cal-col-body"></div>';
                board.appendChild(colAtr);
                var atrBody = colAtr.querySelector('.tareas-cal-col-body');
                atrBody.innerHTML = buckets.atrasadas.map(function(t){ return createTaskCardCRM(t, now); }).join('');
            }

            // 5 días laborables (Lun-Vie) + Sáb/Dom opcionales
            for (var i = 0; i < 5; i++) {
                var d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
                var key = dayKeys[i];
                _renderCalCol(board, d, dayNames[d.getDay()], buckets[key], key === todayKey, now, false);
            }
            // Sábado: solo si hay tareas
            if (hasWeekend.sat) {
                var dSat = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 5);
                _renderCalCol(board, dSat, 'Sáb', buckets[dayKeys[5]], dayKeys[5] === todayKey, now, true);
            }
            if (hasWeekend.sun) {
                var dSun = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
                _renderCalCol(board, dSun, 'Dom', buckets[dayKeys[6]], dayKeys[6] === todayKey, now, true);
            }
        }

        function _renderCalCol(board, d, dayName, list, isToday, now, isWeekend) {
            var col = document.createElement('div');
            col.className = 'tareas-cal-col' + (isToday ? ' col-hoy' : '') + (isWeekend ? ' col-weekend' : '');
            col.innerHTML =
                '<div class="tareas-cal-col-head">' +
                    '<div class="tareas-cal-col-head-row">' +
                        '<div><div class="tareas-cal-day-name">' + dayName + '</div><div class="tareas-cal-day-num">' + d.getDate() + '</div></div>' +
                        '<span class="tareas-cal-count">' + list.length + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="tareas-cal-col-body"></div>';
            var body = col.querySelector('.tareas-cal-col-body');
            if (list.length === 0) {
                body.innerHTML = '<div class="tareas-cal-empty">Sin tareas</div>';
            } else {
                body.innerHTML = list.map(function(t){ return createTaskCardCRM(t, now); }).join('');
            }
            board.appendChild(col);
        }

        function createTaskListRowCRM(t, now) {
            var tipo = t.oportunidad_tipo || 'runrate';
            var completada = (t.estado === 'completada');
            var vencida = !completada && _tareasIsOverdue(t, now);
            var dias = _tareasDiasVencida(t, now);
            var esc = _tareasEscape;

            var stripClass = completada
                ? 'completada'
                : (vencida ? ('vencida ' + _tareasHeatClass(dias))
                           : (tipo === 'proyecto' ? 'proyecto' : 'runrate'));

            var fechaHtml = '';
            if (t.fecha_limite) {
                var fechaTxt = _tareasFmtFecha(t.fecha_limite);
                var fechaCls = vencida ? 'overdue' : (_tareasIsToday(t, now) ? 'hoy' : '');
                fechaHtml = '<span class="tarea-fecha-chip ' + fechaCls + '">' +
                    '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' +
                    esc(fechaTxt) + '</span>';
            } else {
                fechaHtml = '<span style="color:#CBD5E1;font-size:0.72rem;">Sin fecha</span>';
            }

            var respNom = t.responsable || '—';
            var creadorNom = t.creado_por || '—';
            var respAvatar = '<span class="tarea-avatar">' + _tareasIniciales(t.responsable || '') + '</span>';
            var creadorAvatar = '<span class="tarea-avatar" style="background:#FEF3C7;color:#92400E;">' + _tareasIniciales(t.creado_por || '') + '</span>';

            var oppHtml = '';
            if (t.oportunidad_nombre) {
                oppHtml = '<div class="tarea-oportunidad-link" onclick="event.stopPropagation();if(typeof openDetalle===\'function\')openDetalle(\'' + t.oportunidad_id + '\');">' +
                    '<span class="link-text">' + esc(t.oportunidad_nombre) + '</span>' +
                    (t.oportunidad_etapa ? '<span class="link-etapa">' + esc(t.oportunidad_etapa) + '</span>' : '') +
                    '</div>';
            } else {
                oppHtml = '<span style="color:#CBD5E1;font-size:0.72rem;">—</span>';
            }

            var alertIcon = (vencida && dias >= 30)
                ? '<span class="crm-alert-critical" title="' + dias + ' días sin atender">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="#DC2626" stroke="white" stroke-width="1"><path d="M12 2L1 21h22L12 2zm0 6v6m0 4v-2" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>' +
                  '</span>'
                : '';

            return '<div class="crm-list-row crm-list-row--tarea crm-data-row' +
                (completada ? ' crm-list-row--completada' : '') +
                (t.esta_anclada ? ' pinned-row' : '') + '" ' +
                'data-tarea-id="' + t.id + '" ' +
                'data-vencida="' + (vencida ? '1' : '0') + '" ' +
                'data-dias-vencida="' + dias + '" ' +
                'data-completada="' + (completada ? '1' : '0') + '" ' +
                'data-anclada="' + (t.esta_anclada ? '1' : '0') + '" ' +
                'onclick="if(typeof crmTaskVerDetalle===\'function\')crmTaskVerDetalle(' + t.id + ');">' +
                '<div class="crm-list-strip ' + stripClass + '"></div>' +
                '<div class="crm-list-cell" style="flex:2.2;padding-left:22px;">' +
                    '<div class="tarea-titulo">' + alertIcon + esc(t.titulo || 'Sin título') + '</div>' +
                '</div>' +
                '<div class="crm-list-cell" style="flex:1;">' +
                    '<span class="tarea-resp-nombre">' + respAvatar + esc(respNom) + '</span>' +
                '</div>' +
                '<div class="crm-list-cell" style="flex:1;">' +
                    '<span class="tarea-creador-nombre">' + creadorAvatar + esc(creadorNom) + '</span>' +
                '</div>' +
                '<div class="crm-list-cell" style="flex:1.1;">' + fechaHtml + '</div>' +
                '<div class="crm-list-cell" style="flex:1.6;">' + oppHtml + '</div>' +
                '<div class="crm-list-cell tarea-actions" style="flex:0.6;padding-right:18px;">' +
                    '<button type="button" class="tarea-action-btn subtarea" title="Crear subtarea" onclick="event.stopPropagation();if(typeof crmTaskCrearSubtareaDesdeFila===\'function\')crmTaskCrearSubtareaDesdeFila(' + t.id + ');">' +
                        '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h6"/><circle cx="19" cy="17" r="4"/><line x1="19" y1="15" x2="19" y2="19"/><line x1="17" y1="17" x2="21" y2="17"/></svg>' +
                    '</button>' +
                    '<button type="button" class="tarea-action-btn pin' + (t.esta_anclada ? ' pinned' : '') + '" title="Anclar" onclick="event.stopPropagation();crmTareaTogglePin(this,' + t.id + ');">' +
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="' + (t.esta_anclada ? '#EF4444' : '#9CA3AF') + '" stroke="none"><path d="M12 2C10.9 2 10 2.9 10 4V9.5C10 10.3 9.3 11 8.5 11H7C5.9 11 5 11.9 5 13V14H11V20L12 22L13 20V14H19V13C19 11.9 18.1 11 17 11H15.5C14.7 11 14 10.3 14 9.5V4C14 2.9 13.1 2 12 2Z"/></svg>' +
                    '</button>' +
                '</div>' +
            '</div>';
        }

        function _tareasFmtFecha(isoStr) {
            if (!isoStr) return '';
            var d = new Date(isoStr);
            var meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
            var h = String(d.getHours()).padStart(2,'0');
            var m = String(d.getMinutes()).padStart(2,'0');
            return d.getDate() + ' ' + meses[d.getMonth()] + ', ' + h + ':' + m;
        }

        function _tareasIniciales(nombre) {
            if (!nombre) return '??';
            var parts = String(nombre).trim().split(/\s+/);
            if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
            return parts[0].substring(0, 2).toUpperCase();
        }

        function _tareasEscape(s) {
            if (s == null) return '';
            return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        function createTaskCardCRM(tarea, now) {
            var done = tarea.estado === 'completada';
            var vencida = _tareasIsOverdue(tarea, now);
            var pinned = !!tarea.esta_anclada;
            var tipo = (tarea.oportunidad_tipo || '').toLowerCase();
            var tipoCls = (tipo === 'proyecto' || tipo === 'bitrix_proyecto') ? ' tipo-proyecto'
                        : (tipo === 'runrate') ? ' tipo-runrate'
                        : '';
            // Warm: días hasta fecha límite (solo si no vencida ni completada)
            var warmCls = '';
            if (!vencida && !done && tarea.fecha_limite) {
                var dt = new Date(tarea.fecha_limite);
                if (!isNaN(dt.getTime())) {
                    var diasHasta = Math.ceil((dt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    if (diasHasta <= 1)       warmCls = ' warm-3';
                    else if (diasHasta <= 7)  warmCls = ' warm-2';
                    else if (diasHasta <= 14) warmCls = ' warm-1';
                }
            }
            var modCls2 = tarea.tiene_cambios ? ' modificada' : '';
            var cardClass = 'tareas-card' + (done ? ' done' : '') + (vencida ? ' overdue' : '') + (pinned ? ' pinned' : '') + modCls2 + tipoCls + warmCls;

            // Fecha badge
            var fechaHtml = '';
            if (tarea.fecha_limite) {
                var fechaTxt = _tareasFmtFecha(tarea.fecha_limite);
                var clsF = vencida ? '' : 'future';
                var iconColor = vencida ? '#B91C1C' : '#4B5563';
                fechaHtml = '<span class="tareas-badge-fecha ' + clsF + '">' +
                    '<svg width="11" height="11" fill="none" stroke="' + iconColor + '" stroke-width="2.5" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">' +
                    (vencida
                        ? '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
                        : '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>') +
                    '</svg>' + fechaTxt + '</span>';
            }

            // Estado badge (solo si no es pendiente por default)
            var estadoHtml = '';
            if (tarea.estado === 'en_progreso') {
                estadoHtml = '<span class="tareas-badge-estado" style="background:rgba(0,82,212,0.1);color:#0052D4;">' +
                    '<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>' +
                    'En Progreso</span>';
            } else if (tarea.estado === 'iniciada') {
                estadoHtml = '<span class="tareas-badge-estado" style="background:rgba(255,149,0,0.12);color:#FF9500;">Pausado</span>';
            }

            // Oportunidad — clickeable para abrir el widget de detalle
            var oppHtml = '';
            if (tarea.oportunidad_id) {
                oppHtml = '<div class="tareas-card-opp clickable" data-opp-id="' + tarea.oportunidad_id + '" title="Abrir oportunidad">' +
                    '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>' +
                    '<span class="txt">' + _tareasEscape(tarea.oportunidad_nombre || '') + '</span>' +
                    '</div>';
            } else if (tarea.proyecto_id) {
                oppHtml = '<div class="tareas-card-opp">' +
                    '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
                    '<span class="txt">' + _tareasEscape(tarea.proyecto_nombre || 'Sin proyecto') + '</span>' +
                    '</div>';
            }

            // Responsable avatar + nombre
            var respNombre = tarea.responsable || 'Sin asignar';
            var iniciales = _tareasIniciales(respNombre);
            var respHtml = '<div class="tareas-card-avatar">' + iniciales + '</div>' +
                '<span class="tareas-card-resp">Resp: <b>' + _tareasEscape(respNombre.split(' ')[0]) + '</b></span>';

            // Etapa badge (si es oportunidad)
            var etapaHtml = '';
            if (tarea.oportunidad_etapa) {
                etapaHtml = '<span class="tareas-card-etapa">' + _tareasEscape(tarea.oportunidad_etapa) + '</span>';
            }

            // Pin chincheta
            var pinFill = pinned ? '#EF4444' : '#B0B8C4';
            var pinBtn = '<button type="button" class="tareas-card-pin' + (pinned ? ' pinned' : '') + '" data-pin-id="' + tarea.id + '" onclick="event.stopPropagation();crmTareaTogglePin(this,' + tarea.id + ');" title="Anclar tarea">' +
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="' + pinFill + '" stroke="none"><path d="M12 2C10.9 2 10 2.9 10 4V9.5C10 10.3 9.3 11 8.5 11H7C5.9 11 5 11.9 5 13V14H11V20L12 22L13 20V14H19V13C19 11.9 18.1 11 17 11H15.5C14.7 11 14 10.3 14 9.5V4C14 2.9 13.1 2 12 2Z"/></svg>' +
                '</button>';

            return '<div class="' + cardClass + '" data-tarea-id="' + tarea.id + '" onclick="crmTaskVerDetalle(' + tarea.id + ')">' +
                '<div class="tareas-card-top">' +
                    '<div class="tareas-card-check"></div>' +
                    '<div class="tareas-card-title">' + _tareasEscape(tarea.titulo || 'Sin título') + '</div>' +
                    pinBtn +
                '</div>' +
                (fechaHtml || estadoHtml ? '<div class="tareas-card-badges">' + fechaHtml + estadoHtml + '</div>' : '') +
                '<div class="tareas-card-sep"></div>' +
                oppHtml +
                '<div class="tareas-card-bottom">' +
                    respHtml +
                    etapaHtml +
                '</div>' +
            '</div>';
        }

        // Toggle anclar tarea (similar al de oportunidades)
        window.crmTareaTogglePin = function(btn, tareaId) {
            var csrfEl = document.querySelector('[name=csrfmiddlewaretoken]');
            var csrf = csrfEl ? csrfEl.value : '';
            fetch('/app/api/tarea/' + tareaId + '/toggle-pin/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
                credentials: 'same-origin'
            }).then(function(r){ return r.json(); }).then(function(data){
                if (!data || !data.success) return;
                // Actualizar estado en _crmAllTareas (cache)
                if (Array.isArray(_crmAllTareas)) {
                    for (var i = 0; i < _crmAllTareas.length; i++) {
                        if (_crmAllTareas[i].id === tareaId) {
                            _crmAllTareas[i].esta_anclada = data.anclada;
                            break;
                        }
                    }
                }
                // Actualizar cache de pendientes también
                if (_crmTareasCache && _crmTareasCache.pendientes) {
                    _crmTareasCache.pendientes = _crmAllTareas;
                }
                // Re-render para reordenar
                renderTareasCRM();
            }).catch(console.error);
        };

        // Helper de completar rápido (usa la misma API de tareas)
        window.crmTaskCompletarRapido = function(tareaId) {
            var csrfEl = document.querySelector('[name=csrfmiddlewaretoken]');
            var csrf = csrfEl ? csrfEl.value : '';
            fetch('/app/api/tarea/' + tareaId + '/actualizar/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
                credentials: 'same-origin',
                body: JSON.stringify({ estado: 'completada' })
            }).then(function(r){ return r.json(); }).then(function(res){
                if (res && res.success) {
                    // Actualizar en memoria en vez de recargar — el endpoint ?estado=pendientes
                    // la excluiría y desaparecería. Con esto queda visible como completada.
                    if (Array.isArray(_crmAllTareas)) {
                        for (var i = 0; i < _crmAllTareas.length; i++) {
                            if (_crmAllTareas[i].id === tareaId) {
                                _crmAllTareas[i].estado = 'completada';
                                _crmAllTareas[i].fecha_completada = new Date().toISOString();
                                break;
                            }
                        }
                    }
                    Object.keys(_crmTareasCache || {}).forEach(function(k){
                        var arr = _crmTareasCache[k];
                        if (!Array.isArray(arr)) return;
                        for (var j = 0; j < arr.length; j++) {
                            if (arr[j].id === tareaId) {
                                arr[j].estado = 'completada';
                                arr[j].fecha_completada = new Date().toISOString();
                                break;
                            }
                        }
                    });
                    renderTareasCRM();
                }
            }).catch(console.error);
        };

        // Listeners del sidebar + pills (al cargar el DOM)
        (function initTareasFocusListeners(){
            function bind() {
                var sb = document.getElementById('tareasFocusSidebar');
                if (!sb) return setTimeout(bind, 100);

                // Toggle button de la toolbar (abrir)
                var btnT = document.getElementById('tareasFocusToggleBtn');
                if (btnT) btnT.addEventListener('click', function(e){
                    e.stopPropagation();
                    if (sb.classList.contains('open')) _tareasFocusClose(); else _tareasFocusOpen();
                });
                // Botón hamburguesa embebido en el sidebar (cerrar)
                var btnClose = document.getElementById('tareasFocusCloseBtn');
                if (btnClose) btnClose.addEventListener('click', function(e){
                    e.stopPropagation();
                    _tareasFocusClose();
                });

                // Flow buttons
                sb.querySelectorAll('.tareasFocus-toggle button').forEach(function(b){
                    b.addEventListener('click', function(){ _tareasFocusSwitchFlow(b.dataset.flow); });
                });

                // Ver Todo
                var allBtn = sb.querySelector('.tareasFocus-all');
                if (allBtn) allBtn.addEventListener('click', function(){ _tareasFocusSelectStage('ALL'); });

                // Urgency pills
                document.querySelectorAll('#tareasUrgencyPills button').forEach(function(p){
                    p.addEventListener('click', function(){ _tareasFocusSetUrgency(p.dataset.urg); });
                });
                // (El handler del search input ya vive en bloque existente más abajo)

                // Botón de filtros (abre/cierra panel)
                var filterBtn = document.getElementById('tareasFilterBtn');
                var filterPanel = document.getElementById('tareasFilterPanel');
                if (filterBtn && filterPanel) {
                    filterBtn.addEventListener('click', function(e){
                        e.stopPropagation();
                        var isOpen = filterPanel.classList.toggle('open');
                        filterBtn.classList.toggle('active', isOpen);
                    });
                    // Cerrar al clickear fuera
                    // (2026-06-11 fix) Guard anti-acumulación: este wireup
                    // corre en cada turbo:load y document persiste — sin
                    // guard se apilaba un listener por navegación. Los
                    // elementos se resuelven al momento del click para que
                    // el listener único siempre apunte al DOM vigente.
                    if (!window._tareasFilterDocWired) {
                        window._tareasFilterDocWired = true;
                        document.addEventListener('click', function(e){
                            var fp = document.getElementById('tareasFilterPanel');
                            var fb = document.getElementById('tareasFilterBtn');
                            if (!fp || !fb) return;
                            if (!fp.contains(e.target) && e.target !== fb && !fb.contains(e.target)) {
                                fp.classList.remove('open');
                                fb.classList.remove('active');
                            }
                        });
                    }
                }
                // Checkbox "Todos" — desmarca todos los individuales
                var allCb = document.getElementById('tareasRespAll');
                if (allCb) {
                    allCb.addEventListener('change', function(){
                        if (allCb.checked) {
                            _crmTareasRespSet = {};
                            document.querySelectorAll('#tareasFilterResponsableList input[type=checkbox]').forEach(function(cb){
                                if (cb.id !== 'tareasRespAll') cb.checked = false;
                            });
                        } else {
                            // Si se desmarca "Todos" sin nada seleccionado, lo forzamos de vuelta
                            allCb.checked = true;
                        }
                        renderTareasCRM();
                    });
                }
                // Event delegation: click EN EL TEXTO del nombre de la oportunidad
                // dentro de una card de tarea -> abrir widget de la oportunidad
                // (Click en cualquier otra parte de la card -> abre el widget de la tarea)
                var tareasGrid = document.getElementById('tareasCardsGrid');
                if (tareasGrid && !tareasGrid._oppClickBound) {
                    tareasGrid.addEventListener('click', function(e){
                        // Solo interceptar clicks en el <span class="txt"> dentro de .tareas-card-opp.clickable
                        var txt = e.target.closest('.tareas-card-opp.clickable .txt');
                        if (!txt) return;
                        var oppEl = txt.closest('.tareas-card-opp.clickable');
                        if (!oppEl) return;
                        e.stopPropagation();
                        e.preventDefault();
                        var oppId = parseInt(oppEl.getAttribute('data-opp-id'), 10);
                        if (oppId && typeof window.openDetalle === 'function') {
                            window.openDetalle(oppId);
                        }
                    }, true); // captura para adelantarse al onclick de la card
                    tareasGrid._oppClickBound = true;
                }

                // Botón limpiar filtros
                var clearBtn = document.getElementById('tareasFilterClear');
                if (clearBtn) {
                    clearBtn.addEventListener('click', function(){
                        _crmTareasRespSet = {};
                        document.querySelectorAll('#tareasFilterResponsableList input[type=checkbox]').forEach(function(cb){
                            cb.checked = (cb.id === 'tareasRespAll');
                        });
                        renderTareasCRM();
                    });
                }

                // Restaurar estado abierto (sidebar antiguo — ya no existe pero mantenemos safe)
                if (_tareasFocus.wasOpen) {
                    sb.style.transition = 'none';
                    var vc = document.getElementById('tareasViewCards');
                    if (vc) vc.classList.add('tareasFocus-open');
                    sb.classList.add('open');
                    void sb.offsetWidth;
                    requestAnimationFrame(function(){ sb.style.transition = ''; });
                }
            }
            // Migrado a crmReady: corre en DOMContentLoaded y en cada
            // turbo:load (cuando Turbo se active en Fase 3.C).
            window.crmReady(bind);
        })();

        // ══════════════════════════════════════════════════════════════
        // ── Facet bar de TAREAS (filtros + sort + view toggle) ────────
        // ══════════════════════════════════════════════════════════════
        (function bindTareasFacetBar(){
            function init(){
                var bar = document.getElementById('tareasFacetBar');
                if (!bar) return;

                var btnAdd   = document.getElementById('btnTareasAddFacet');
                var btnSort  = document.getElementById('btnTareasSortMenu');
                var btnView  = document.getElementById('btnTareasViewToggle');
                var btnClear = document.getElementById('btnTareasFacetClear');
                var sortLbl  = document.getElementById('tareasSortLabel');
                var viewIcn  = document.getElementById('tareasViewIcon');
                var chipsEl  = document.getElementById('tareasFacetChips');
                var popField = document.getElementById('popTareasField');
                var popValue = document.getElementById('popTareasValue');
                var popSort  = document.getElementById('popTareasSort');
                var searchEl = document.getElementById('tareasSearchInput');

                if (searchEl && !searchEl._tbound) {
                    searchEl.addEventListener('input', function(){ renderTareasCRM(); });
                    searchEl._tbound = true;
                }

                var FIELDS = [
                    { key:'tipo',    label:'Tipo',    inputId:'tareasFilterTipo',
                      options:[{v:'proyecto',l:'Proyecto'},{v:'runrate',l:'Runrate'},{v:'bitrix_proyecto',l:'Bitrix'}] },
                    { key:'etapa',   label:'Etapa',   inputId:'tareasFilterEtapa',   type:'autocomplete', dataKey:'etapa' },
                    { key:'resp',    label:'Responsable', inputId:'tareasFilterResp', type:'userpicker', source:'resp' },
                    { key:'creador', label:'Creador', inputId:'tareasFilterCreador', type:'userpicker', source:'creador' },
                    { key:'fechas',  label:'Rango fechas', type:'daterange' }
                ];
                // "Ordenar" ahora es urgency: Todas / Atrasadas / Hoy
                var SORTS = [
                    { k:'todas',     lbl:'Todas' },
                    { k:'atrasadas', lbl:'Atrasadas' },
                    { k:'hoy',       lbl:'Hoy' }
                ];

                var _tAnchor = null;

                function $in(id){ return document.getElementById(id); }
                function setHidden(id, v){
                    var el = $in(id);
                    if (!el) return;
                    el.value = v;
                }
                function getHidden(id){ return (($in(id) || {}).value || ''); }
                function closeAll(except){
                    [popField, popValue, popSort].forEach(function(p){
                        if (p && p !== except) p.classList.remove('open');
                    });
                }
                function position(pop, anchor){
                    var r = anchor.getBoundingClientRect();
                    pop.style.top = (r.bottom + 6) + 'px';
                    pop.style.left = r.left + 'px';
                    pop.style.right = 'auto';
                    setTimeout(function(){
                        var pr = pop.getBoundingClientRect();
                        if (pr.right > window.innerWidth - 8) {
                            pop.style.left = 'auto';
                            pop.style.right = (window.innerWidth - r.right) + 'px';
                        }
                    }, 0);
                }

                // Valores únicos de etapas y usuarios desde el cache de tareas
                function uniqueEtapas(){
                    var s = {}; (_crmAllTareas || []).forEach(function(t){
                        if (t.oportunidad_etapa) s[t.oportunidad_etapa] = true;
                    });
                    return Object.keys(s).sort();
                }
                function uniqueUsers(kind){
                    var seen = {};
                    (_crmAllTareas || []).forEach(function(t){
                        if (kind === 'resp' && t.asignado_a_id) seen[t.asignado_a_id] = t.responsable;
                        if (kind === 'creador' && t.creado_por_id) seen[t.creado_por_id] = t.creado_por;
                    });
                    return Object.keys(seen).map(function(id){ return { id: id, nombre: seen[id] }; })
                        .sort(function(a,b){ return (a.nombre||'').localeCompare(b.nombre||''); });
                }

                function renderChips(){
                    var html = '';
                    FIELDS.forEach(function(fld){
                        if (fld.type === 'daterange') {
                            var d = getHidden('tareasFilterDesde');
                            var h = getHidden('tareasFilterHasta');
                            if (d || h) html += chip('fechas', 'Fechas', (d||'…') + ' → ' + (h||'…'));
                        } else {
                            var v = getHidden(fld.inputId);
                            if (v) {
                                var lbl = v;
                                if (fld.options) {
                                    var o = fld.options.find(function(x){ return x.v === v; });
                                    if (o) lbl = o.l;
                                } else if (fld.type === 'userpicker') {
                                    var users = uniqueUsers(fld.source);
                                    var u = users.find(function(x){ return String(x.id) === String(v); });
                                    if (u) lbl = u.nombre;
                                }
                                html += chip(fld.key, fld.label, lbl);
                            }
                        }
                    });
                    chipsEl.innerHTML = html;
                    var any = !!html;
                    if (btnClear) btnClear.style.display = any ? '' : 'none';

                    // Sort label (ahora refleja la urgency activa)
                    var curUrg = (_tareasFocus && _tareasFocus.urgency) || 'todas';
                    var s = SORTS.find(function(x){ return x.k === curUrg; });
                    sortLbl.textContent = s ? s.lbl : 'Todas';
                    btnSort.classList.toggle('has-sort', curUrg !== 'todas');
                }
                function chip(key, label, value) {
                    var safe = (value||'').toString().replace(/</g,'&lt;');
                    return '<div class="crm-facet-chip" data-fkey="' + key + '">' +
                        '<span class="crm-facet-chip-key">' + label + '</span>' +
                        '<span class="crm-facet-chip-op">=</span>' +
                        '<span class="crm-facet-chip-val">' + safe + '</span>' +
                        '<span class="crm-facet-chip-x" data-fkey="' + key + '" title="Quitar">' +
                            '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>' +
                        '</span></div>';
                }

                function openFieldPicker(){
                    var html = '<div class="crm-pop-section">Filtrar por</div><div class="crm-pop-list">';
                    FIELDS.forEach(function(f){
                        html += '<button type="button" class="crm-pop-item" data-field="' + f.key + '">' + f.label + '</button>';
                    });
                    html += '</div>';
                    popField.innerHTML = html;
                    closeAll(popField);
                    popField.classList.add('open');
                    position(popField, btnAdd);
                }
                function openValuePicker(key){
                    _tAnchor = btnAdd;
                    var fld = FIELDS.find(function(x){ return x.key === key; });
                    if (!fld) return;
                    popValue.dataset.currentField = key;
                    var html = '';
                    if (fld.type === 'daterange') {
                        var d = getHidden('tareasFilterDesde');
                        var h = getHidden('tareasFilterHasta');
                        html = '<div class="crm-pop-section">Rango de fechas (fecha límite)</div>' +
                            '<div class="crm-pop-dates">' +
                                '<div><label>Desde</label><input type="date" id="_tfpDesde" value="' + d + '"></div>' +
                                '<div><label>Hasta</label><input type="date" id="_tfpHasta" value="' + h + '"></div>' +
                            '</div>' +
                            '<div class="crm-pop-footer">' +
                                '<button type="button" data-act="clear-fechas">Quitar</button>' +
                                '<button type="button" class="primary" data-act="apply-fechas">Aplicar</button>' +
                            '</div>';
                        popValue.style.minWidth = '280px';
                    } else if (fld.options) {
                        html = '<div class="crm-pop-section">' + fld.label + '</div><div class="crm-pop-list">';
                        var cur = getHidden(fld.inputId);
                        html += '<button type="button" class="crm-pop-item ' + (!cur ? 'active' : '') + '" data-val="">Todos</button>';
                        fld.options.forEach(function(o){
                            html += '<button type="button" class="crm-pop-item ' + (cur === o.v ? 'active' : '') + '" data-val="' + o.v + '">' + o.l + '</button>';
                        });
                        html += '</div>';
                        popValue.style.minWidth = '200px';
                    } else if (fld.type === 'userpicker') {
                        var cur2 = getHidden(fld.inputId);
                        var users = uniqueUsers(fld.source);
                        html = '<div class="crm-pop-section">' + fld.label + '</div><div class="crm-pop-list">';
                        html += '<button type="button" class="crm-pop-item ' + (!cur2 ? 'active' : '') + '" data-val="">Todos</button>';
                        users.forEach(function(u){
                            html += '<button type="button" class="crm-pop-item ' + (String(cur2) === String(u.id) ? 'active' : '') + '" data-val="' + u.id + '">' + (u.nombre || '—') + '</button>';
                        });
                        html += '</div>';
                        popValue.style.minWidth = '220px';
                    } else if (fld.type === 'autocomplete') {
                        var cur3 = getHidden(fld.inputId);
                        var etapas = uniqueEtapas();
                        html = '<div class="crm-pop-section">' + fld.label + '</div><div class="crm-pop-list">';
                        html += '<button type="button" class="crm-pop-item ' + (!cur3 ? 'active' : '') + '" data-val="">Todas</button>';
                        etapas.forEach(function(e){
                            html += '<button type="button" class="crm-pop-item ' + (cur3 === e ? 'active' : '') + '" data-val="' + e + '">' + e + '</button>';
                        });
                        html += '</div>';
                        popValue.style.minWidth = '220px';
                    }
                    popValue.innerHTML = html;
                    closeAll(popValue);
                    popValue.classList.add('open');
                    position(popValue, _tAnchor);
                }
                function openSortPicker(){
                    var cur = (_tareasFocus && _tareasFocus.urgency) || 'todas';
                    var html = '<div class="crm-pop-section">Mostrar</div><div class="crm-pop-list">';
                    SORTS.forEach(function(s){
                        html += '<button type="button" class="crm-pop-item ' + (cur === s.k ? 'active' : '') + '" data-sort="' + s.k + '">' + s.lbl + '</button>';
                    });
                    html += '</div>';
                    popSort.innerHTML = html;
                    closeAll(popSort);
                    popSort.classList.add('open');
                    position(popSort, btnSort);
                }

                btnAdd.addEventListener('click', function(e){ e.stopPropagation(); if (popField.classList.contains('open')) { popField.classList.remove('open'); } else openFieldPicker(); });
                btnSort.addEventListener('click', function(e){ e.stopPropagation(); if (popSort.classList.contains('open')) { popSort.classList.remove('open'); } else openSortPicker(); });
                btnClear.addEventListener('click', function(){
                    ['tareasFilterTipo','tareasFilterEtapa','tareasFilterResp','tareasFilterCreador','tareasFilterDesde','tareasFilterHasta'].forEach(function(id){ setHidden(id, ''); });
                    renderChips(); renderTareasCRM();
                });

                popField.addEventListener('click', function(e){
                    var it = e.target.closest('.crm-pop-item');
                    if (!it) return;
                    popField.classList.remove('open');
                    openValuePicker(it.dataset.field);
                });

                popValue.addEventListener('click', function(e){
                    e.stopPropagation();
                    var item = e.target.closest('.crm-pop-item');
                    if (item && item.dataset.val !== undefined) {
                        var key = popValue.dataset.currentField;
                        var fld = FIELDS.find(function(x){ return x.key === key; });
                        if (fld && fld.inputId) setHidden(fld.inputId, item.dataset.val);
                        popValue.classList.remove('open');
                        renderChips(); renderTareasCRM();
                        return;
                    }
                    var actBtn = e.target.closest('[data-act]');
                    if (!actBtn) return;
                    var act = actBtn.dataset.act;
                    if (act === 'apply-fechas') {
                        setHidden('tareasFilterDesde', ($in('_tfpDesde')||{}).value || '');
                        setHidden('tareasFilterHasta', ($in('_tfpHasta')||{}).value || '');
                    } else if (act === 'clear-fechas') {
                        setHidden('tareasFilterDesde', '');
                        setHidden('tareasFilterHasta', '');
                    }
                    popValue.classList.remove('open');
                    renderChips(); renderTareasCRM();
                });

                popSort.addEventListener('click', function(e){
                    var it = e.target.closest('.crm-pop-item');
                    if (!it) return;
                    var urg = it.dataset.sort || 'todas';
                    if (typeof _tareasFocusSetUrgency === 'function') {
                        _tareasFocusSetUrgency(urg);
                    } else {
                        _tareasFocus.urgency = urg;
                        renderTareasCRM();
                    }
                    popSort.classList.remove('open');
                    renderChips();
                });

                chipsEl.addEventListener('click', function(e){
                    var x = e.target.closest('.crm-facet-chip-x');
                    if (!x) return;
                    var key = x.dataset.fkey;
                    if (key === 'fechas') {
                        setHidden('tareasFilterDesde', ''); setHidden('tareasFilterHasta', '');
                    } else {
                        var fld = FIELDS.find(function(f){ return f.key === key; });
                        if (fld && fld.inputId) setHidden(fld.inputId, '');
                    }
                    renderChips(); renderTareasCRM();
                });

                // View toggle: list → calendar → cockpit → list
                function applyTareasView(mode){
                    var lv   = document.getElementById('tareasViewList');
                    var cv   = document.getElementById('tareasCardsGrid');
                    var calv = document.getElementById('tareasViewCalendar');
                    var cpv  = document.getElementById('tareasViewCockpit');
                    if (cv) cv.style.display = 'none';  // cards legacy siempre oculto
                    // Reset all
                    if (lv)   lv.style.display   = 'none';
                    if (calv) calv.style.display = 'none';
                    if (cpv)  cpv.style.display  = 'none';
                    if (mode === 'calendar') {
                        if (calv) calv.style.display = 'flex';
                        if (viewIcn) viewIcn.innerHTML = '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>';
                        if (typeof renderTareasCRM === 'function') renderTareasCRM();
                    } else if (mode === 'cockpit') {
                        if (cpv) cpv.style.display = '';
                        // Ícono split-panels
                        if (viewIcn) viewIcn.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/>';
                        if (typeof renderTareasCRM === 'function') renderTareasCRM();
                    } else {
                        if (lv) lv.style.display = '';
                        if (viewIcn) viewIcn.innerHTML = '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';
                    }
                }
                // Cockpit es la vista default en tareas. Migración firme:
                // cualquier valor legacy (cards/list/null) → cockpit y persiste.
                var _tareasViewMode = localStorage.getItem('tareasViewMode');
                if (!_tareasViewMode || ['calendar','cockpit'].indexOf(_tareasViewMode) === -1) {
                    _tareasViewMode = 'cockpit';
                    localStorage.setItem('tareasViewMode', 'cockpit');
                }
                applyTareasView(_tareasViewMode);
                btnView.addEventListener('click', function(){
                    // Ciclo simplificado: cockpit ↔ calendar (list queda fuera del ciclo)
                    _tareasViewMode = _tareasViewMode === 'cockpit' ? 'calendar' : 'cockpit';
                    localStorage.setItem('tareasViewMode', _tareasViewMode);
                    applyTareasView(_tareasViewMode);
                });

                // Wire navegación del calendario
                var btnPrev = document.getElementById('btnTareasWeekPrev');
                var btnNext = document.getElementById('btnTareasWeekNext');
                var btnToday = document.getElementById('btnTareasWeekToday');
                if (btnPrev) btnPrev.addEventListener('click', function(){ if (typeof window._tareasCalShiftWeek === 'function') window._tareasCalShiftWeek(-1); });
                if (btnNext) btnNext.addEventListener('click', function(){ if (typeof window._tareasCalShiftWeek === 'function') window._tareasCalShiftWeek(1); });
                if (btnToday) btnToday.addEventListener('click', function(){ if (typeof window._tareasCalGoToday === 'function') window._tareasCalGoToday(); });

                // Cerrar popovers al click fuera / Escape
                document.addEventListener('click', function(e){
                    if (bar.contains(e.target)) return;
                    if (popField.contains(e.target) || popValue.contains(e.target) || popSort.contains(e.target)) return;
                    closeAll();
                });
                document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeAll(); });

                setTimeout(renderChips, 300);
            }
            // Migrado a crmReady (Turbo-friendly).
            window.crmReady(init);
        })();

        // ── Dropdown para asignar oportunidad a tarea ──
        var _crmOppPickerTaskId = null;
        var _crmOppPickerTimer = null;
        function crmTaskAbrirAsignarOpp(anchor, tareaId) {
            var existing = document.getElementById('crmOppPickerDropdown');
            if (existing) existing.remove();
            if (_crmOppPickerTaskId === tareaId) { _crmOppPickerTaskId = null; return; }
            _crmOppPickerTaskId = tareaId;
            var drop = document.createElement('div');
            drop.id = 'crmOppPickerDropdown';
            drop.style.cssText = 'position:fixed;background:#fff;border:1px solid #E5E5EA;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.12);z-index:99999;width:280px;padding:8px;';
            drop.innerHTML = '<input id="crmOppPickerInput" placeholder="Buscar oportunidad..." style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #E5E5EA;border-radius:8px;font-size:0.82rem;outline:none;margin-bottom:6px;"><div id="crmOppPickerList" style="max-height:200px;overflow-y:auto;"></div>';
            document.body.appendChild(drop);
            var rect = anchor.getBoundingClientRect();
            drop.style.top = (rect.bottom + 4) + 'px';
            drop.style.left = Math.min(rect.left, window.innerWidth - 290) + 'px';
            var inp = document.getElementById('crmOppPickerInput');
            inp.focus();
            crmOppPickerSearch('');
            inp.addEventListener('input', function () {
                clearTimeout(_crmOppPickerTimer);
                _crmOppPickerTimer = setTimeout(function () { crmOppPickerSearch(inp.value); }, 250);
            });
            setTimeout(function () {
                document.addEventListener('click', function _closePicker(e) {
                    if (!drop.contains(e.target)) { drop.remove(); _crmOppPickerTaskId = null; document.removeEventListener('click', _closePicker); }
                });
            }, 50);
        }
        function crmOppPickerSearch(q) {
            var list = document.getElementById('crmOppPickerList');
            if (!list) return;
            list.innerHTML = '<div style="color:#9CA3AF;font-size:0.78rem;padding:6px;">Buscando...</div>';
            fetch('/app/api/buscar-oportunidades-proyecto/?q=' + encodeURIComponent(q))
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (!list) return;
                    var opps = data.oportunidades || [];
                    if (!opps.length) { list.innerHTML = '<div style="color:#9CA3AF;font-size:0.78rem;padding:6px;">Sin resultados</div>'; return; }
                    list.innerHTML = opps.map(function (o) {
                        var lbl = (o.titulo || o.oportunidad || '').substring(0, 40);
                        var cli = (o['cliente__nombre_empresa'] || o.cliente || '').substring(0, 25);
                        return '<div style="padding:7px 8px;border-radius:6px;cursor:pointer;font-size:0.82rem;" onmouseenter="this.style.background=\'#F2F2F7\'" onmouseleave="this.style.background=\'\'" onclick="crmOppPickerSelect(' + o.id + ',\'' + lbl.replace(/'/g, '') + '\')">' +
                            '<div style="font-weight:600;color:#1D1D1F;">' + lbl + '</div>' +
                            (cli ? '<div style="color:#8E8E93;font-size:0.72rem;">' + cli + '</div>' : '') +
                            '</div>';
                    }).join('');
                });
        }
        function crmOppPickerSelect(oppId, oppNombre) {
            var tareaId = _crmOppPickerTaskId;
            var drop = document.getElementById('crmOppPickerDropdown');
            if (drop) drop.remove();
            _crmOppPickerTaskId = null;
            if (!tareaId) return;
            fetch('/app/api/tarea/' + tareaId + '/actualizar/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]').value },
                body: JSON.stringify({ oportunidad_id: oppId })
            }).then(function (r) { return r.json(); }).then(function (res) {
                if (res.success) {
                    showToast('Oportunidad asignada', 'success');
                    recargarTareasCRM();
                } else {
                    showToast(res.error || 'Error al asignar', 'error');
                }
            });
        }

        function getEstadoBadgeCRM(estado) {
            var cfg = {
                'pendiente': { label: 'Pendiente', color: '#8E8E93', bg: 'rgba(142,142,147,0.12)' },
                'iniciada': { label: 'Pausado', color: '#FF9500', bg: 'rgba(255,149,0,0.12)' },
                'en_progreso': { label: 'En Progreso', color: '#0052D4', bg: 'rgba(0,82,212,0.1)' },
                'completada': { label: 'Completada', color: '#34C759', bg: 'rgba(52,199,89,0.12)' },
                'cancelada': { label: 'Cancelada', color: '#FF3B30', bg: 'rgba(255,59,48,0.12)' }
            };
            var c = cfg[estado] || cfg['pendiente'];
            return '<span class="task-estado-badge" style="background:' + c.bg + ';color:' + c.color + ';">' + c.label + '</span>';
        }

        function formatearFechaCRM(fechaStr) {
            if (!fechaStr) return '-';
            var f = new Date(fechaStr);
            return f.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        }

        // ── Tabs internos ──
        var tareasTabs = document.getElementById('tareasTabs');
        if (tareasTabs) {
            tareasTabs.addEventListener('click', function (e) {
                var btn = e.target.closest('.tareas-tab');
                if (!btn) return;
                tareasTabs.querySelectorAll('.tareas-tab').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                _crmCurrentFilter = btn.getAttribute('data-filter');
                _crmPage = 1;
                _crmPaginatedSearch = '';
                cargarTareasCRM(_crmCurrentFilter, 1);
            });
        }

        // ── (Los handlers del panel de filtros de tareas ya viven en
        //     initTareasFocusListeners — no duplicar aqui) ──

        // ── Búsqueda ──
        var tareasSearch = document.getElementById('tareasSearchInput');
        var _tareasSearchTimer = null;
        if (tareasSearch) {
            tareasSearch.addEventListener('input', function () {
                var esPaginado = _crmCurrentFilter === 'completadas' || _crmCurrentFilter === 'todas';
                if (esPaginado) {
                    clearTimeout(_tareasSearchTimer);
                    _tareasSearchTimer = setTimeout(function () {
                        _crmPaginatedSearch = tareasSearch.value.trim();
                        _crmPage = 1;
                        cargarTareasCRM(_crmCurrentFilter, 1);
                    }, 350);
                } else {
                    renderTareasCRM(_crmCurrentFilter);
                }
            });
        }

        // ══════════════════════════════════
        // ═══ MODAL DETALLE TAREA ═══
        // ══════════════════════════════════

        // Store current opp id for drive/oportunidad actions
        var _crmTaskCurrentOppId = null;

        function crmTaskRenderData(tarea) {
            // Restore elements that may have been replaced by edit inputs
            var titleEl = document.getElementById('crm-task-titulo');
            if (titleEl && titleEl.tagName !== 'H1') {
                var h1 = document.createElement('h1');
                h1.id = 'crm-task-titulo';
                h1.className = 'crm-tw-title';
                titleEl.replaceWith(h1);
            }
            var descEl = document.getElementById('crm-task-descripcion');
            if (descEl && descEl.tagName === 'TEXTAREA') {
                var div = document.createElement('div');
                div.id = 'crm-task-descripcion';
                div.className = 'crm-task-desc-content';
                descEl.replaceWith(div);
            }
            var fechaEl = document.getElementById('crm-task-fecha-limite');
            if (fechaEl && fechaEl.tagName === 'INPUT') {
                var sp = document.createElement('span');
                sp.id = 'crm-task-fecha-limite';
                sp.className = 'crm-task-info-value';
                fechaEl.replaceWith(sp);
            }

            crmTaskSetText('crm-task-titulo', tarea.titulo);
            var tieneDesc = !!(tarea.descripcion_html || tarea.descripcion);
            var descHtml = tieneDesc
                ? (tarea.descripcion_html || tarea.descripcion.replace(/\n/g, '<br>'))
                : 'Agrega una descripción — qué hay que hacer, contexto, criterios…';
            crmTaskSetHTML('crm-task-descripcion', descHtml);

            // Collapse long descriptions + marcar "sin descripción" con estilo suave
            var descEl = document.getElementById('crm-task-descripcion');
            var toggleBtn = document.getElementById('crm-task-desc-toggle');
            if (descEl) descEl.classList.toggle('is-empty', !tieneDesc);
            if (descEl && toggleBtn) {
                descEl.classList.remove('collapsed');
                toggleBtn.style.display = 'none';
                requestAnimationFrame(function () {
                    if (descEl.scrollHeight > 240) {
                        descEl.classList.add('collapsed');
                        toggleBtn.style.display = 'inline';
                        toggleBtn.textContent = 'Mostrar más';
                    }
                });
            }

            // Breadcrumb: Proyecto (pill, solo si existe) › Cliente (texto, solo si existe)
            var bcCliente = document.getElementById('crm-task-breadcrumb-cliente');
            var bcProyecto = document.getElementById('crm-task-breadcrumb-proyecto');
            var crumbChev = document.getElementById('crmTaskCrumbChev');
            var crumbProyWrap = document.getElementById('crmTaskCrumbProyecto');
            var hayProyecto = !!(tarea.proyecto_id && tarea.proyecto_nombre && tarea.proyecto_nombre !== 'Sin proyecto');
            if (crumbProyWrap) {
                if (hayProyecto) {
                    crumbProyWrap.style.display = '';
                    if (bcProyecto) bcProyecto.textContent = tarea.proyecto_nombre;
                    crumbProyWrap.onclick = function () {
                        if (typeof window.proyectosVerDetalle === 'function') {
                            window.proyectosVerDetalle(tarea.proyecto_id);
                        } else if (typeof window.ingenieroAbrirProyecto === 'function') {
                            window.ingenieroAbrirProyecto(tarea.proyecto_id);
                        }
                    };
                } else {
                    crumbProyWrap.style.display = 'none';
                    crumbProyWrap.onclick = null;
                }
            }
            if (bcCliente) {
                if (tarea.cliente_nombre) {
                    bcCliente.textContent = tarea.cliente_nombre;
                    bcCliente.style.display = '';
                    if (crumbChev) crumbChev.style.display = hayProyecto ? '' : 'none';
                } else {
                    bcCliente.style.display = 'none';
                    if (crumbChev) crumbChev.style.display = 'none';
                }
            }

            // Status pill: estado
            var estadoBadge = document.getElementById('crm-task-estado-badge');
            if (estadoBadge) {
                var estadoLabels = { pendiente: 'Pendiente', iniciada: 'Iniciada', en_progreso: 'En progreso', completada: 'Completada', cancelada: 'Cancelada' };
                var estadoColors = { pendiente: ['#FEF3C7','#92400E'], iniciada: ['#DBEAFE','#1E40AF'], en_progreso: ['#ECFDF5','#059669'], completada: ['#F3F4F6','#6B7280'], cancelada: ['#FEE2E2','#991B1B'] };
                var ec = estadoColors[tarea.estado] || ['#F3F4F6','#6B7280'];
                estadoBadge.textContent = estadoLabels[tarea.estado] || tarea.estado;
                estadoBadge.style.background = ec[0];
                estadoBadge.style.color = ec[1];
                estadoBadge.className = 'crm-task-status-pill estado' + (tarea.estado === 'completada' ? ' completada' : '');
            }

            // Status pill: prioridad
            var prioBadge = document.getElementById('crm-task-prioridad-badge');
            if (prioBadge) {
                prioBadge.style.display = tarea.prioridad === 'alta' ? 'inline-flex' : 'none';
                crmTaskSetText('crm-task-prioridad-text', 'Alta prioridad');
            }

            // Status pill: vence
            var venceBadge = document.getElementById('crm-task-vence-badge');
            if (venceBadge) {
                if (tarea.fecha_limite) {
                    var fl = new Date(tarea.fecha_limite);
                    var ahora = new Date();
                    var vencida = fl < ahora && tarea.estado !== 'completada';
                    venceBadge.textContent = 'Vence ' + formatearFechaCRM(tarea.fecha_limite);
                    venceBadge.className = 'crm-task-status-pill vence' + (vencida ? ' vencida' : '');
                    venceBadge.style.display = '';
                } else {
                    venceBadge.style.display = 'none';
                }
            }

            // Estado (hidden, for JS compat)
            var estadoEl = document.getElementById('crm-task-estado');
            if (estadoEl) estadoEl.innerHTML = getEstadoBadgeCRM(tarea.estado);

            // Prioridad sidebar (hidden)
            var prioSidebarWrap = document.getElementById('crmTaskPrioridadSidebarWrap');
            if (prioSidebarWrap) prioSidebarWrap.style.display = 'none';

            // Acción principal: Completar / Reabrir / Pill Completada (según estado)
            var btnTerminar = document.getElementById('crmTaskBtnTerminar'); // legacy oculto
            var btnCompletarPrimary = document.getElementById('crmTaskBtnCompletarPrimary');
            var btnReabrir = document.getElementById('crmTaskBtnReabrir');
            var completadaPill = document.getElementById('crmTaskCompletadaPill');
            var isCompletada = (tarea.estado === 'completada');
            if (btnTerminar) {
                btnTerminar.disabled = isCompletada;
                btnTerminar.style.display = 'none';
            }
            if (btnCompletarPrimary) {
                btnCompletarPrimary.disabled = false;
                btnCompletarPrimary.classList.remove('bursting');
                btnCompletarPrimary.innerHTML =
                    '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' +
                    '<span>Completar tarea</span>';
                btnCompletarPrimary.style.display = isCompletada ? 'none' : 'inline-flex';
            }
            if (btnReabrir) btnReabrir.style.display = isCompletada ? 'inline-flex' : 'none';
            if (completadaPill) completadaPill.style.display = isCompletada ? 'inline-flex' : 'none';

            // Sidebar pill de estado (refleja estado del badge principal)
            var estadoSidePill = document.getElementById('crm-task-estado-sidebar-pill');
            var estadoDot = document.getElementById('crm-tw-estado-dot');
            var estadoSbLabels = { pendiente: 'Pendiente', iniciada: 'Iniciada', en_progreso: 'En progreso', completada: 'Completada', cancelada: 'Cancelada' };
            if (estadoSidePill) {
                estadoSidePill.textContent = estadoSbLabels[tarea.estado] || 'Pendiente';
            }
            if (estadoDot) {
                estadoDot.className = 'crm-tw-sb-dot ' + (tarea.estado || 'pendiente');
            }

            // Sidebar valor de prioridad (alta / normal)
            var prioSideVal = document.getElementById('crm-task-prioridad');
            var prioSideWrap = document.getElementById('crmTaskPrioridadSidebarWrap');
            var esAlta = (tarea.prioridad === 'alta');
            if (prioSideVal && prioSideWrap) {
                if (esAlta) {
                    prioSideVal.className = 'crm-tw-sb-prio-alta';
                    prioSideVal.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg><span>Alta</span>';
                } else {
                    prioSideVal.className = 'crm-tw-sb-prio-normal';
                    prioSideVal.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg><span>Normal</span>';
                }
                prioSideWrap.style.display = '';
            }

            // Info sidebar — fecha límite inteligente (relativa + color auto)
            var fechaLimiteEl = document.getElementById('crm-task-fecha-limite');
            var fechaBtn = fechaLimiteEl ? fechaLimiteEl.closest('.crm-tw-sb-btn') : null;
            if (fechaBtn) fechaBtn.classList.remove('fecha-vencida', 'fecha-urgente');
            if (fechaLimiteEl) {
                fechaLimiteEl.style.color = '';
                fechaLimiteEl.style.fontWeight = '';
                if (!tarea.fecha_limite) {
                    fechaLimiteEl.innerHTML = '<span style="color:#94A3B8;font-weight:500;">Sin fecha</span>';
                } else {
                    var smart = crmTaskFechaInteligente(tarea.fecha_limite, tarea.estado);
                    fechaLimiteEl.innerHTML =
                        '<span class="crm-tw-fecha-main">' + smart.main + '</span>' +
                        '<span class="crm-tw-fecha-meta">' + smart.meta + '</span>';
                    if (fechaBtn) {
                        if (smart.tone === 'vencida') fechaBtn.classList.add('fecha-vencida');
                        else if (smart.tone === 'urgente') fechaBtn.classList.add('fecha-urgente');
                    }
                }
            }
            crmTaskSetText('crm-task-creado-por', tarea.creado_por_data ? tarea.creado_por_data.nombre : tarea.creado_por);
            crmTaskSetText('crm-task-fecha-creacion', tarea.fecha_creacion ? formatearFechaCRM(tarea.fecha_creacion) : '--');

            // Cliente: solo en el header breadcrumb; el row del sidebar queda oculto
            // (pero guardamos el nombre en el span por compat con editores legacy)
            var clienteRow = document.getElementById('crmTaskClienteRow');
            crmTaskSetText('crm-task-cliente-nombre', tarea.cliente_nombre || '');
            if (clienteRow) clienteRow.style.display = 'none';

            // Oportunidad card (in sidebar)
            _crmTaskCurrentOppId = tarea.oportunidad_id || null;
            var oppCard = document.getElementById('crmTaskOppCard');
            var driveCard = document.getElementById('crmTaskDriveCard');
            var sidebarLinks = document.getElementById('crmTaskSidebarLinks');
            if (tarea.oportunidad_id) {
                crmTaskSetText('crmTaskOppNombre', tarea.oportunidad_nombre || 'Oportunidad');
                crmTaskSetText('crmTaskOppCliente', tarea.cliente_nombre || '');
                if (oppCard) oppCard.style.display = 'flex';
                if (driveCard) driveCard.style.display = 'flex';
                if (sidebarLinks) sidebarLinks.style.display = '';
            } else {
                if (oppCard) oppCard.style.display = 'none';
                if (driveCard) driveCard.style.display = 'none';
                if (sidebarLinks) sidebarLinks.style.display = 'none';
            }

            // Responsable
            var respContainer = document.getElementById('crm-task-responsable-container');
            if (respContainer) {
                if (tarea.responsable_data) {
                    var rd = tarea.responsable_data;
                    var initials = crmTaskGetInitials(rd.nombre);
                    var avatarInner = rd.avatar_url
                        ? '<img src="' + rd.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                        : initials;
                    respContainer.innerHTML =
                        '<span style="width:22px;height:22px;border-radius:50%;background:#3B82F6;color:#fff;font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">' + avatarInner + '</span>' +
                        '<span style="font-weight:500;font-size:13px;color:#334155;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + rd.nombre + '</span>';
                } else {
                    respContainer.innerHTML = '<span style="color:#94A3B8;font-size:13px;">Sin asignar</span>';
                }
            }

            // Creador (bajo Responsable — read-only)
            var creaContainer = document.getElementById('crm-task-creador-container');
            if (creaContainer) {
                var cd = tarea.creado_por_data;
                if (cd) {
                    var initC = crmTaskGetInitials(cd.nombre);
                    var avatarC = cd.avatar_url
                        ? '<img src="' + cd.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                        : initC;
                    creaContainer.innerHTML =
                        '<span style="width:22px;height:22px;border-radius:50%;background:#8B5CF6;color:#fff;font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">' + avatarC + '</span>' +
                        '<span style="font-weight:500;font-size:13px;color:#334155;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + cd.nombre + '</span>';
                } else {
                    creaContainer.innerHTML = '<span style="color:#94A3B8;font-size:13px;">' + (tarea.creado_por || '—') + '</span>';
                }
            }

            // Menú 3-dots: mostrar "Eliminar" solo al creador o superuser
            var menuEliminar = document.getElementById('crmTaskMenuEliminar');
            if (menuEliminar) {
                var _cur = _CRM_CONFIG.userId;
                var _su = _CRM_CONFIG.isSuperuser;
                var _crId = (tarea.creado_por_data && tarea.creado_por_data.id) ? tarea.creado_por_data.id : null;
                var _puedeEliminar = !!(_su || (_cur && _crId && _cur === _crId));
                menuEliminar.style.display = _puedeEliminar ? 'flex' : 'none';
                // Si "Eliminar" es la única acción del menú y está oculta, el
                // botón de 3-puntos abría una caja vacía → ocultarlo.
                var _menuWrap = document.getElementById('crmTaskMenuBtn');
                if (_menuWrap) _menuWrap.style.display = _puedeEliminar ? '' : 'none';
            }

            // Subtareas O Tarea padre (mutuamente excluyentes)
            var subtareasSection = document.getElementById('crmTaskSubtareasSection');
            if (subtareasSection) {
                if (tarea.tarea_padre_id && tarea.tarea_padre_titulo) {
                    // Es subtarea: mostrar card de tarea padre
                    subtareasSection.innerHTML =
                        '<h3 class="crm-tw-section-title"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l-6-6 6-6"/><path d="M3 12h18"/></svg>Tarea principal</h3>' +
                        '<div class="crm-tw-parent-card" onclick="crmTaskVerDetalle(' + tarea.tarea_padre_id + ')">' +
                            '<svg width="16" height="16" fill="none" stroke="#2563EB" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;"><path d="M9 18l-6-6 6-6"/><path d="M3 12h18"/></svg>' +
                            '<div style="flex:1;min-width:0;">' +
                                '<div style="font-size:13px;font-weight:600;color:#1E40AF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + tarea.tarea_padre_titulo + '</div>' +
                            '</div>' +
                            '<svg width="14" height="14" fill="none" stroke="#93C5FD" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>' +
                        '</div>';
                } else {
                    // Es tarea normal: mostrar subtareas con barra de progreso + badge contador
                    var subs = tarea.subtareas || [];
                    var total = subs.length;
                    var done = subs.filter(function (s) { return s.estado === 'completada'; }).length;
                    var pct = total > 0 ? Math.round((done / total) * 100) : 0;
                    var isFull = total > 0 && done === total;
                    var badge = total > 0
                        ? '<span class="crm-tw-sub-badge' + (isFull ? ' full' : '') + '">' + done + '/' + total + '</span>'
                        : '';
                    var headHtml =
                        '<h3 class="crm-tw-section-title">' +
                            '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
                            'Subtareas' + badge +
                        '</h3>' +
                        (total > 0
                            ? '<div class="crm-tw-subtareas-head">' +
                                '<div class="crm-tw-subtareas-progress"><div class="crm-tw-subtareas-progress-fill' + (isFull ? ' full' : '') + '" style="width:' + pct + '%;"></div></div>' +
                                '<span class="crm-tw-subtareas-count">' + pct + '%</span>' +
                              '</div>'
                            : '');
                    var listHtml = '';
                    if (subs.length > 0) {
                        listHtml = '<div class="crm-tw-subtareas-list">' + subs.map(function (st) {
                            var isComplete = st.estado === 'completada';
                            var checkSvg = isComplete
                                ? '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>'
                                : '';
                            return '<div class="crm-tw-subtarea-row' + (isComplete ? ' done' : '') + '" onclick="crmTaskVerDetalle(' + st.id + ')">' +
                                '<span class="crm-tw-subtarea-check' + (isComplete ? ' done' : '') + '">' + checkSvg + '</span>' +
                                '<span class="crm-tw-subtarea-title">' + (st.titulo || '') + '</span>' +
                            '</div>';
                        }).join('') + '</div>';
                    }
                    if (total === 0) {
                        // Sin subtareas: ocultamos toda la sección (el botón "Añadir
                        // subtarea" se movió al icono junto al @ del comentario, para
                        // ganar espacio). Sólo se muestra cuando ya hay subtareas.
                        subtareasSection.innerHTML = '';
                    } else {
                        // Con subtareas: header + progreso + lista (sin el botón
                        // "Añadir subtarea"; crear va desde la barra de comentarios).
                        subtareasSection.innerHTML = headHtml + listHtml;
                    }
                }
            }

            _crmTaskLastData = tarea;
            var _curId = _CRM_CONFIG.userId;
            var _isSu = _CRM_CONFIG.isSuperuser;
            _crmTaskCanEdit = (
                _curId === (tarea.creado_por_data && tarea.creado_por_data.id ? tarea.creado_por_data.id : -1) || _isSu
            );
            // Ingeniero: aunque no sea creador puede:
            //   • quitarse a sí mismo como participante/observador
            //   • cambiar al responsable cuando él mismo es el asignado_a
            // El backend (api_tarea_detalle PUT y api_actualizar_tarea_real)
            // valida el permiso real; aquí solo gobernamos qué controles
            // mostramos.
            _crmTaskIsIngeniero = !!_CRM_CONFIG.esIngeniero;
            var _crmTaskRespId = tarea.responsable_data ? tarea.responsable_data.id : null;
            _crmTaskCanEditResponsable = (
                _crmTaskCanEdit ||
                (_crmTaskIsIngeniero && _crmTaskRespId === _curId)
            );
            _crmTaskEdits = {};
            _crmTaskOriginal = {
                titulo: tarea.titulo,
                descripcion: tarea.descripcion || '',
                fecha_limite: tarea.fecha_limite || null,
                responsable_id: tarea.responsable_data ? tarea.responsable_data.id : null,
                responsable_nombre: tarea.responsable_data ? tarea.responsable_data.nombre : null,
            };
            crmTaskRenderEditUI(tarea);
        }

        function crmTaskVerDetalle(tareaId) {
            // Política multi-tarea (prospecto_windows.js): si el modal ya está
            // VISIBLE+EN VENTANA mostrando OTRA tarea, abrir la nueva como
            // ventana-iframe propia. Guard al inicio para que TODO punto de
            // entrada (inline onclick + llamadas locales del closure como
            // tcpExpandir/tcpToggleCheck) pase por la política.
            if (typeof window._taskWindowPolicy === 'function' && window._taskWindowPolicy(tareaId)) return;
            _crmCurrentTaskId = tareaId;
            window._crmCurrentTaskId = tareaId;  // expone para el modal de historial
            _crmTaskCurrentOppId = null;
            var modal = document.getElementById('crmTaskDetailModal');
            if (!modal) return;
            // Limpiar contenido stale ANTES de abrir para evitar flash de la tarea previa
            _crmTaskClearForLoading();
            modal.classList.add('active');
            // Si se abre desde una opp que ya está en .z-elevated-top (caso típico:
            // ingeniero → tarea → opp → click en una tarea del historial), el modal
            // de tarea por defecto está en CAPA 4 (10400) y queda por DEBAJO de la
            // opp (10750). Lo elevamos a 10900 para que aparezca encima.
            var _opp = document.getElementById('widgetDetalle');
            if (_opp && (_opp.classList.contains('z-elevated-top') || _opp.classList.contains('z-elevated'))) {
                modal.classList.add('z-elevated-overlay');
            } else {
                modal.classList.remove('z-elevated-overlay');
            }
            document.body.style.overflow = 'hidden';
            fetch('/app/api/tarea/' + tareaId + '/')
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (tarea) {
                    if (tarea.error) { showToast(tarea.error, 'error'); return; }
                    // Solo aplicar si aún estamos en la misma tarea (evita race condition
                    // si el usuario clickea otra tarea mientras la primera fetch no resolvía)
                    if (_crmCurrentTaskId !== tareaId) return;
                    crmTaskRenderData(tarea);
                    crmTaskCargarComentarios(tareaId);
                })
                .catch(function (err) {
                    console.error('Error cargando tarea:', err);
                    showToast('Error al cargar la tarea', 'error');
                });
        }

        // Limpia el DOM del modal de detalle de tarea antes de que resuelva la
        // petición — evita el "flash" de mostrar datos de la tarea anterior.
        function _crmTaskClearForLoading() {
            var set = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val || ''; };
            var setHtml = function(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html || ''; };

            // Título, descripción, breadcrumb
            set('crm-task-titulo', '');
            setHtml('crm-task-descripcion', '');
            set('crm-task-breadcrumb-proyecto', '');
            set('crm-task-breadcrumb-cliente', '');
            set('crm-tw-taskid', '');

            // Pills y estados (resetear a estado neutro)
            set('crm-task-estado-badge', '');
            set('crm-task-prioridad-text', '');
            set('crm-task-vence-badge', '');
            set('crm-task-estado-sidebar-pill', '');
            var estadoDot = document.getElementById('crm-tw-estado-dot');
            if (estadoDot) estadoDot.className = 'crm-tw-sb-dot';

            // Fecha límite
            setHtml('crm-task-fecha-limite', '');

            // Responsable, participantes, observadores
            setHtml('crm-task-responsable-container', '');
            setHtml('crm-task-participantes-container', '');
            setHtml('crm-task-observadores-container', '');

            // Cliente + oportunidad + drive
            set('crm-task-cliente-nombre', '');
            set('crmTaskOppNombre', '');
            var oppCard = document.getElementById('crmTaskOppCard');
            if (oppCard) oppCard.style.display = 'none';
            var driveCard = document.getElementById('crmTaskDriveCard');
            if (driveCard) driveCard.style.display = 'none';
            var sidebarLinks = document.getElementById('crmTaskSidebarLinks');
            if (sidebarLinks) sidebarLinks.style.display = 'none';

            // Subtareas + activity feed
            setHtml('crmTaskSubtareasSection', '');
            setHtml('crm-task-activity-feed', '<div style="padding:20px;text-align:center;color:#94A3B8;font-size:13px;">Cargando…</div>');

            // Fecha creación + creado por
            set('crm-task-fecha-creacion', '');
            set('crm-task-creado-por', '');

            // Botones a estado neutro
            var btnReabrir = document.getElementById('crmTaskBtnReabrir');
            if (btnReabrir) btnReabrir.style.display = 'none';
            var btnComp = document.getElementById('crmTaskBtnCompletarPrimary');
            if (btnComp) btnComp.style.display = 'none';  // se mostrará tras render correcto
            var compPill = document.getElementById('crmTaskCompletadaPill');
            if (compPill) compPill.style.display = 'none';

            // Input del comentario y archivos
            var commInp = document.getElementById('crm-task-comment-input');
            if (commInp) commInp.value = '';
            setHtml('crm-task-files-preview', '');

            _crmTaskLastData = null;
        }

        function crmTaskSetText(id, text) {
            var el = document.getElementById(id);
            if (el) el.textContent = text || '';
        }

        function crmTaskSetHTML(id, html) {
            var el = document.getElementById(id);
            if (el) el.innerHTML = html || '';
        }

        function crmTaskGetInitials(name) {
            if (!name) return '?';
            var parts = name.trim().split(/\s+/);
            return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].substring(0, 2).toUpperCase();
        }

        // Devuelve {main, meta, tone} para un date-time string
        // tone ∈ {'vencida','urgente','normal','completada'}
        function crmTaskFechaInteligente(isoStr, estado) {
            var d = new Date(isoStr);
            if (isNaN(d.getTime())) return { main: 'Sin fecha', meta: '', tone: 'normal' };
            var main = formatearFechaCRM(isoStr);
            if (estado === 'completada') return { main: main, meta: 'Completada', tone: 'completada' };
            var now = new Date();
            var diffMs = d - now;
            var abs = Math.abs(diffMs);
            var mins = Math.round(abs / 60000);
            var hours = Math.round(abs / 3600000);
            var days = Math.floor(abs / 86400000);
            function rel() {
                if (mins < 1) return 'ahora';
                if (mins < 60) return mins + ' min';
                if (hours < 24) return hours + (hours === 1 ? ' hora' : ' horas');
                if (days < 30) return days + (days === 1 ? ' día' : ' días');
                var months = Math.round(days / 30);
                return months + (months === 1 ? ' mes' : ' meses');
            }
            if (diffMs < 0) return { main: main, meta: 'Vencida hace ' + rel(), tone: 'vencida' };
            if (hours < 24) return { main: main, meta: 'Vence en ' + rel(), tone: 'urgente' };
            if (days <= 3) return { main: main, meta: 'Vence en ' + rel(), tone: 'urgente' };
            return { main: main, meta: 'Vence en ' + rel(), tone: 'normal' };
        }

        function crmAvatarHtml(nombre, avatarUrl, size, bg) {
            size = size || 32;
            bg = bg || '#0052D4';
            var initials = crmTaskGetInitials(nombre);
            if (avatarUrl) {
                return '<img src="' + avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
            }
            return initials;
        }

        // ── Inline edit state ──
        var _crmTaskCanEdit = false;
        var _crmTaskIsIngeniero = false;
        var _crmTaskCanEditResponsable = false;
        var _crmTaskEdits = {};
        var _crmTaskOriginal = {};
        var _crmTaskLastData = null;
        // Cambios PENDIENTES de participantes/observadores (no se guardan hasta
        // que el usuario da "Guardar"; "Cancelar" los descarta). add = usuarios
        // por añadir {id,nombre,avatar_url}; remove = ids por quitar.
        var _crmTaskInvPending = { participantes: { add: [], remove: [] }, observadores: { add: [], remove: [] } };
        function _crmTaskResetInvPending() {
            _crmTaskInvPending = { participantes: { add: [], remove: [] }, observadores: { add: [], remove: [] } };
        }
        function _crmTaskHasPendingInv() {
            var p = _crmTaskInvPending;
            return (p.participantes.add.length + p.participantes.remove.length +
                    p.observadores.add.length + p.observadores.remove.length) > 0;
        }

        function crmTaskShowSaveBar() {
            var bar = document.getElementById('crmTaskSaveBar');
            if (bar) bar.style.display = 'flex';
        }
        function crmTaskHideSaveBar() {
            var bar = document.getElementById('crmTaskSaveBar');
            if (bar) bar.style.display = 'none';
            _crmTaskEdits = {};
            _crmTaskResetInvPending();
        }

        function crmTaskRenderEditUI(tarea) {
            _crmTaskLastData = tarea;
            crmTaskHideSaveBar();

            _crmRenderInvList('participantes');
            _crmRenderInvList('observadores');

            // Responsable: clickeable si tiene edición plena O si es ingeniero
            // que actualmente está asignado a la tarea (puede quitarse o cambiar).
            if (_crmTaskCanEditResponsable) {
                var respContainer = document.getElementById('crm-task-responsable-container');
                if (respContainer) {
                    respContainer.style.cursor = 'pointer';
                    respContainer.title = _crmTaskCanEdit
                        ? 'Clic para cambiar responsable'
                        : 'Clic para quitarte o asignar a otro';
                    respContainer.onclick = crmTaskEditarResponsable;
                }
            }
            // Edición de campos generales (título, fecha, cliente, descripción)
            // sigue restringida a creador/superuser.
            if (_crmTaskCanEdit) {
                var titleEl2 = document.getElementById('crm-task-titulo');
                if (titleEl2 && titleEl2.tagName === 'H1') {
                    titleEl2.style.cursor = 'pointer';
                    titleEl2.title = 'Clic para editar';
                    titleEl2.onclick = crmTaskEditarTitulo;
                }
                var fechaEl2 = document.getElementById('crm-task-fecha-limite');
                if (fechaEl2 && fechaEl2.tagName === 'SPAN') {
                    fechaEl2.style.cursor = 'pointer';
                    fechaEl2.title = 'Clic para editar';
                    fechaEl2.onclick = function () { crmTaskEditarFechaLimite(_crmTaskOriginal.fecha_limite); };
                }
                var clienteEl2 = document.getElementById('crm-task-cliente-nombre');
                if (clienteEl2) {
                    clienteEl2.style.cursor = 'pointer';
                    clienteEl2.style.color = '#0052D4';
                    clienteEl2.title = 'Clic para editar cliente';
                    clienteEl2.onclick = function () { crmTaskEditarCliente(clienteEl2.textContent); };
                }
                var descEl2 = document.getElementById('crm-task-descripcion');
                if (descEl2 && descEl2.tagName !== 'TEXTAREA') {
                    descEl2.style.cursor = 'pointer';
                    descEl2.title = 'Clic para editar descripción';
                    descEl2.onclick = crmTaskEditarDescripcion;
                }
            }

            // Permitir al responsable (no creador, no su) cambiar la fecha_limite via su propio modal
            var _curIdFl = _CRM_CONFIG.userId;
            var _isSuFl = _CRM_CONFIG.isSuperuser;
            var _creadorIdFl = tarea.creado_por_data ? tarea.creado_por_data.id : null;
            var _respIdFl = tarea.responsable_data ? tarea.responsable_data.id : null;
            var _esSoloRespFl = !_isSuFl && _curIdFl !== _creadorIdFl && _curIdFl === _respIdFl;
            if (_esSoloRespFl) {
                var fechaElResp = document.getElementById('crm-task-fecha-limite');
                if (fechaElResp && fechaElResp.tagName === 'SPAN') {
                    fechaElResp.style.cursor = 'pointer';
                    fechaElResp.style.textDecoration = 'underline dotted';
                    fechaElResp.title = 'Clic para solicitar cambio de fecha';
                    fechaElResp.onclick = function () { crmTaskResponsableModalFecha(tarea.fecha_limite); };
                }
            }
        }

        function crmTaskEditarDescripcion() {
            var descEl = document.getElementById('crm-task-descripcion');
            if (!descEl || descEl.tagName === 'TEXTAREA') return;
            var current = descEl.textContent === 'Sin descripción' ? '' : descEl.textContent;
            var ta = document.createElement('textarea');
            ta.id = 'crm-task-descripcion';
            ta.rows = 4;
            ta.value = current;
            ta.style.cssText = 'width:100%;border:1px solid #0052D4;border-radius:6px;padding:6px 8px;font-size:0.85rem;outline:none;color:#1D1D1F;resize:vertical;font-family:inherit;background:#FAFAFA;';
            descEl.replaceWith(ta); ta.focus();
            crmTaskShowSaveBar();
            ta.addEventListener('input', function () {
                if (ta.value !== _crmTaskOriginal.descripcion) {
                    _crmTaskEdits.descripcion = ta.value;
                } else { delete _crmTaskEdits.descripcion; }
            });
            ta.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') crmTaskCancelarEdicion();
                if (e.key === 'Enter' && e.ctrlKey) crmTaskGuardar();
            });
            // Soporte invisible para pegar/arrastrar imágenes en la descripción.
            // Sin UI nueva: la imagen se sube como adjunto silenciosamente.
            if (typeof window._crmTaskAttachImageHandlers === 'function') {
                window._crmTaskAttachImageHandlers(ta, { mode: 'edit' });
            }
        }

        function crmTaskEditarTitulo() {
            var titleEl = document.getElementById('crm-task-titulo');
            if (!titleEl || titleEl.tagName !== 'H1') return;
            var current = titleEl.textContent;
            var inp = document.createElement('input');
            inp.type = 'text'; inp.value = current; inp.id = 'crm-task-titulo';
            inp.style.cssText = 'font-size:1.1rem;font-weight:700;width:100%;border:none;border-bottom:2px solid #0052D4;outline:none;background:transparent;color:#1D1D1F;padding:2px 0;';
            titleEl.replaceWith(inp); inp.focus(); inp.select();
            crmTaskShowSaveBar();
            inp.addEventListener('input', function () {
                if (inp.value.trim() && inp.value.trim() !== _crmTaskOriginal.titulo) {
                    _crmTaskEdits.titulo = inp.value.trim();
                } else { delete _crmTaskEdits.titulo; }
            });
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') crmTaskCancelarEdicion();
                if (e.key === 'Enter') { inp.blur(); crmTaskGuardar(); }
            });
        }

        function crmTaskEditarFechaLimite(currentIso) {
            var fechaEl = document.getElementById('crm-task-fecha-limite');
            if (!fechaEl) return;
            var inp = document.createElement('input');
            inp.type = 'datetime-local'; inp.id = 'crm-task-fecha-limite';
            inp.style.cssText = 'font-size:0.82rem;border:1px solid #0052D4;border-radius:6px;padding:2px 6px;outline:none;color:#1D1D1F;';
            if (currentIso) { try { var d = new Date(currentIso); inp.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); } catch (e) { } }
            fechaEl.replaceWith(inp); inp.focus();
            crmTaskShowSaveBar();
            inp.addEventListener('change', function () { _crmTaskEdits.fecha_limite = inp.value || ''; });
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') crmTaskCancelarEdicion();
                if (e.key === 'Enter') { inp.blur(); crmTaskGuardar(); }
            });
        }

        function crmTaskEditarResponsable() {
            var respContainer = document.getElementById('crm-task-responsable-container');
            if (!respContainer) return;
            crmTaskShowSaveBar();
            respContainer.innerHTML = '<div id="crmTaskRespSW" style="position:relative;width:100%;"></div>';
            var wrap = document.getElementById('crmTaskRespSW');
            var inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Buscar usuario...';
            inp.style.cssText = 'width:100%;border:1px solid #0052D4;border-radius:6px;padding:4px 8px;font-size:0.85rem;outline:none;';
            var dd = document.createElement('div');
            dd.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:white;border:1px solid #E5E5EA;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-height:180px;overflow-y:auto;z-index:200;display:none;';
            wrap.appendChild(inp); wrap.appendChild(dd); inp.focus();
            function buscarResp(q) {
                fetch('/app/api/buscar-usuarios/?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (data) {
                    var users = data.usuarios || []; dd.innerHTML = '';
                    if (!users.length) { dd.style.display = 'none'; return; }
                    users.forEach(function (u) {
                        var div = document.createElement('div'); div.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.85rem;';
                        var nombre = u.nombre_completo || u.nombre || u.username || ''; div.textContent = nombre;
                        div.addEventListener('mouseenter', function () { div.style.background = '#F3F4F6'; });
                        div.addEventListener('mouseleave', function () { div.style.background = ''; });
                        div.addEventListener('click', function (e) {
                            // stopPropagation: el item es descendiente de respContainer
                            // y abajo le re-asignamos respContainer.onclick = editar; sin
                            // esto el mismo click burbujea y REABRE el buscador, así que
                            // el nombre nuevo "no se mostraba" (volvía a la lista).
                            if (e) { e.stopPropagation(); e.preventDefault(); }
                            _crmTaskEdits.asignado_a = u.id;
                            _crmTaskEdits.asignado_a_nombre = nombre;
                            _crmTaskEdits.asignado_a_avatar = u.avatar_url || null;
                            crmTaskShowSaveBar();
                            var avInner = u.avatar_url
                                ? '<img src="' + u.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                                : crmTaskGetInitials(nombre);
                            respContainer.innerHTML =
                                '<span style="width:22px;height:22px;border-radius:50%;background:#3B82F6;color:#fff;font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">' + avInner + '</span>' +
                                '<span style="font-weight:500;font-size:13px;color:#334155;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + nombre + '</span>';
                            respContainer.style.cursor = 'pointer';
                            respContainer.onclick = crmTaskEditarResponsable;
                        });
                        dd.appendChild(div);
                    }); dd.style.display = 'block';
                });
            }
            inp.addEventListener('input', function () { buscarResp(this.value); });
            inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') crmTaskRenderEditUI(_crmTaskLastData); });
            buscarResp('');
        }

        // Render de la lista de participantes/observadores fusionando los datos
        // del server (_crmTaskLastData) con los cambios PENDIENTES (_crmTaskInvPending).
        function _crmRenderInvList(tipo) {
            var containerId = tipo === 'participantes' ? 'crm-task-participantes-container' : 'crm-task-observadores-container';
            var bgColor = tipo === 'participantes' ? '#6366F1' : '#8B5CF6';
            var cont = document.getElementById(containerId);
            if (!cont) return;
            var base = (_crmTaskLastData && _crmTaskLastData[tipo]) || [];
            var pend = _crmTaskInvPending[tipo] || { add: [], remove: [] };
            // efectivos = base (sin los marcados para quitar) + pendientes de añadir
            var people = base.filter(function (p) { return pend.remove.indexOf(p.id) === -1; })
                .map(function (p) { return { id: p.id, nombre: p.nombre, avatar_url: p.avatar_url, _pending: false }; });
            pend.add.forEach(function (p) {
                if (people.some(function (x) { return x.id === p.id; })) return;
                people.push({ id: p.id, nombre: p.nombre, avatar_url: p.avatar_url, _pending: true });
            });
            if (!people.length) {
                cont.innerHTML = '<span class="crm-tw-sb-empty">Ninguno</span>';
                return;
            }
            var _curUid = _CRM_CONFIG.userId;
            cont.innerHTML = people.map(function (p) {
                var avInner = p.avatar_url
                    ? '<img src="' + p.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                    : crmTaskGetInitials(p.nombre);
                // Quitar permitido si: permiso pleno, o ingeniero quitándose, o es un pendiente.
                var canRemoveThis = _crmTaskCanEdit || (_crmTaskIsIngeniero && p.id === _curUid) || p._pending;
                var rm = canRemoveThis
                    ? '<button type="button" class="crm-tw-sb-row-remove" onclick="event.stopPropagation();crmTaskRemoverInvolucrado(\'' + tipo + '\',' + p.id + ')" title="Quitar"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>'
                    : '';
                var pendTag = p._pending
                    ? '<span style="font-size:9px;font-weight:700;color:#0052D4;background:#E8F0FE;border-radius:4px;padding:1px 5px;margin-left:6px;flex-shrink:0;">nuevo</span>'
                    : '';
                return '<div class="crm-tw-sb-row" title="' + p.nombre + '"' + (p._pending ? ' style="opacity:0.92;"' : '') + '>' +
                    '<div class="crm-tw-sb-row-left">' +
                        '<span style="width:22px;height:22px;border-radius:50%;background:' + bgColor + ';color:#fff;font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">' + avInner + '</span>' +
                        '<span class="crm-tw-sb-row-name">' + p.nombre + '</span>' + pendTag +
                    '</div>' +
                    rm +
                '</div>';
            }).join('');
        }

        function crmTaskAgregarInvolucrado(tipo) {
            var existing = document.getElementById('crmTaskInvSW'); if (existing) existing.remove();
            var cid = tipo === 'participantes' ? 'crm-task-participantes-container' : 'crm-task-observadores-container';
            var container = document.getElementById(cid); if (!container) return;
            var wrap = document.createElement('div'); wrap.id = 'crmTaskInvSW'; wrap.style.cssText = 'position:relative;width:100%;margin-top:6px;';
            var inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Buscar usuario...';
            inp.style.cssText = 'width:100%;border:1px solid #0052D4;border-radius:6px;padding:4px 8px;font-size:0.82rem;outline:none;';
            var dd = document.createElement('div');
            dd.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:white;border:1px solid #E5E5EA;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-height:160px;overflow-y:auto;z-index:200;display:none;';
            wrap.appendChild(inp); wrap.appendChild(dd); container.parentElement.appendChild(wrap); inp.focus();
            function buscarInv(q) {
                fetch('/app/api/buscar-usuarios/?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (data) {
                    var users = data.usuarios || []; dd.innerHTML = '';
                    if (!users.length) { dd.style.display = 'none'; return; }
                    users.forEach(function (u) {
                        var div = document.createElement('div'); div.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.82rem;';
                        var nombre = u.nombre_completo || u.nombre || u.username || ''; div.textContent = nombre;
                        div.addEventListener('mouseenter', function () { div.style.background = '#F3F4F6'; });
                        div.addEventListener('mouseleave', function () { div.style.background = ''; });
                        div.addEventListener('click', function (e) {
                            if (e) { e.stopPropagation(); e.preventDefault(); }
                            // STAGED: no se guarda hasta "Guardar". Lo metemos a pendientes.
                            var pend = _crmTaskInvPending[tipo];
                            var ri = pend.remove.indexOf(u.id); if (ri !== -1) pend.remove.splice(ri, 1);
                            var base = (_crmTaskLastData && _crmTaskLastData[tipo]) || [];
                            var yaBase = base.some(function (x) { return x.id === u.id; });
                            var yaPend = pend.add.some(function (x) { return x.id === u.id; });
                            if (!yaBase && !yaPend) {
                                pend.add.push({ id: u.id, nombre: nombre, avatar_url: u.avatar_url || null });
                            }
                            wrap.remove();
                            crmTaskShowSaveBar();
                            _crmRenderInvList(tipo);
                        });
                        dd.appendChild(div);
                    }); dd.style.display = 'block';
                });
            }
            inp.addEventListener('input', function () { buscarInv(this.value); });
            inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') wrap.remove(); });
            buscarInv('');
        }

        function crmTaskRemoverInvolucrado(tipo, userId) {
            // STAGED: si era un pendiente de añadir lo quitamos de add; si es uno
            // existente lo marcamos para quitar. Nada se guarda hasta "Guardar".
            var pend = _crmTaskInvPending[tipo]; if (!pend) return;
            var idx = -1;
            for (var i = 0; i < pend.add.length; i++) { if (pend.add[i].id === userId) { idx = i; break; } }
            if (idx !== -1) { pend.add.splice(idx, 1); }
            else if (pend.remove.indexOf(userId) === -1) { pend.remove.push(userId); }
            crmTaskShowSaveBar();
            _crmRenderInvList(tipo);
        }

        // Confirma en el server los cambios pendientes de participantes/observadores.
        function _crmCommitInvolucrados(csrf) {
            var calls = [];
            ['participantes', 'observadores'].forEach(function (tipo) {
                var pend = _crmTaskInvPending[tipo];
                pend.add.forEach(function (p) {
                    calls.push(fetch('/app/api/tarea/' + _crmCurrentTaskId + '/', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf }, body: JSON.stringify({ user_id: p.id, action: 'add', tipo: tipo }) }));
                });
                pend.remove.forEach(function (id) {
                    calls.push(fetch('/app/api/tarea/' + _crmCurrentTaskId + '/', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf }, body: JSON.stringify({ user_id: id, action: 'remove', tipo: tipo }) }));
                });
            });
            return Promise.all(calls);
        }

        // Guardado cuando hay cambios de involucrados: confirma involucrados +
        // (opcional) campos, y re-carga el detalle para reflejar todo consistente.
        function _crmTaskDoGuardarConInvolucrados(razon) {
            var csrfEl = document.querySelector('[name=csrfmiddlewaretoken]');
            var csrf = csrfEl ? csrfEl.value : '';
            var fieldKeys = ['titulo', 'descripcion', 'fecha_limite', 'asignado_a', 'cliente_id'];
            var hasFields = fieldKeys.some(function (k) { return k in _crmTaskEdits; });
            _crmCommitInvolucrados(csrf).then(function () {
                if (!hasFields) return { success: true };
                var payload = {};
                if (_crmTaskEdits.titulo) payload.titulo = _crmTaskEdits.titulo;
                if ('descripcion' in _crmTaskEdits) payload.descripcion = _crmTaskEdits.descripcion;
                if ('fecha_limite' in _crmTaskEdits) payload.fecha_limite = _crmTaskEdits.fecha_limite;
                if ('asignado_a' in _crmTaskEdits) payload.asignado_a = _crmTaskEdits.asignado_a;
                if ('cliente_id' in _crmTaskEdits) payload.cliente_id = _crmTaskEdits.cliente_id;
                if (razon) payload.razon_reprogramacion = razon;
                return fetch('/app/api/tarea/' + _crmCurrentTaskId + '/actualizar/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf }, body: JSON.stringify(payload) }).then(function (r) { return r.json(); });
            }).then(function (d) {
                if (d && d.success) {
                    crmTaskHideSaveBar();
                    showToast('Tarea actualizada', 'success');
                    crmTaskVerDetalle(_crmCurrentTaskId);  // re-fetch: refleja involucrados + campos
                    if (window._crmTareasMode) recargarTareasCRM();
                    if (typeof notifLoad === 'function') notifLoad();
                } else {
                    showToast((d && d.error) || 'Error al guardar', 'error');
                }
            }).catch(function () { showToast('Error de conexion', 'error'); });
        }

        function _crmTaskDoGuardar(razon) {
            // Si hay cambios pendientes de participantes/observadores, usamos el
            // flujo que los confirma y re-carga el detalle (consistente).
            if (_crmTaskHasPendingInv()) { _crmTaskDoGuardarConInvolucrados(razon); return; }
            var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
            var payload = {};
            if (_crmTaskEdits.titulo) payload.titulo = _crmTaskEdits.titulo;
            if ('descripcion' in _crmTaskEdits) payload.descripcion = _crmTaskEdits.descripcion;
            if ('fecha_limite' in _crmTaskEdits) payload.fecha_limite = _crmTaskEdits.fecha_limite;
            if ('asignado_a' in _crmTaskEdits) payload.asignado_a = _crmTaskEdits.asignado_a;
            if ('cliente_id' in _crmTaskEdits) payload.cliente_id = _crmTaskEdits.cliente_id;
            if (razon) payload.razon_reprogramacion = razon;
            fetch('/app/api/tarea/' + _crmCurrentTaskId + '/actualizar/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf ? csrf.value : '' }, body: JSON.stringify(payload) })
                .then(function (r) { return r.json(); }).then(function (d) {
                    if (d.success) {
                        // Merge edits into _crmTaskLastData and re-render sin fetch
                        if (_crmTaskEdits.titulo) _crmTaskLastData.titulo = _crmTaskEdits.titulo;
                        if ('descripcion' in _crmTaskEdits) _crmTaskLastData.descripcion = _crmTaskEdits.descripcion;
                        if ('fecha_limite' in _crmTaskEdits) _crmTaskLastData.fecha_limite = _crmTaskEdits.fecha_limite;
                        if ('asignado_a' in _crmTaskEdits) {
                            _crmTaskLastData.responsable_data = {
                                id: _crmTaskEdits.asignado_a,
                                nombre: _crmTaskEdits.asignado_a_nombre || '',
                                avatar_url: _crmTaskEdits.asignado_a_avatar || null
                            };
                        }
                        if ('cliente_id' in _crmTaskEdits) {
                            _crmTaskLastData.cliente_id = _crmTaskEdits.cliente_id;
                            _crmTaskLastData.cliente_nombre = _crmTaskEdits.cliente_nombre || '';
                        }
                        crmTaskRenderData(_crmTaskLastData);
                        showToast('Tarea actualizada', 'success');
                        if (window._crmTareasMode) recargarTareasCRM();
                        // Si se aplazó la fecha, su notif de vencimiento ya no
                        // aplica (el server la borró) → refrescar notificaciones.
                        if (typeof notifLoad === 'function') notifLoad();
                    } else { showToast(d.error || 'Error al guardar', 'error'); }
                }).catch(function () { showToast('Error de conexion', 'error'); });
        }

        function crmTaskGuardar() {
            if (!_crmCurrentTaskId) return;
            // Nada que guardar si no hay ni ediciones de campos ni cambios de
            // participantes/observadores pendientes.
            if (Object.keys(_crmTaskEdits).length === 0 && !_crmTaskHasPendingInv()) return;

            // Si el responsable (no creador, no superuser) cambia la fecha_limite, pedir razón
            var curId = _CRM_CONFIG.userId;
            var isSu = _CRM_CONFIG.isSuperuser;
            var creadorId = _crmTaskLastData && _crmTaskLastData.creado_por_data ? _crmTaskLastData.creado_por_data.id : null;
            var responsableId = _crmTaskLastData && _crmTaskLastData.responsable_data ? _crmTaskLastData.responsable_data.id : null;
            var esSoloResponsable = !isSu && curId !== creadorId && curId === responsableId;

            if ('fecha_limite' in _crmTaskEdits && esSoloResponsable) {
                // Mostrar dialog de razón
                var dlgId = 'crmReprogramDialog';
                var existing = document.getElementById(dlgId);
                if (existing) existing.remove();

                var dlg = document.createElement('div');
                dlg.id = dlgId;
                dlg.style.cssText = 'position:fixed;inset:0;z-index:10500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';
                dlg.innerHTML = [
                    '<div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,0.22);">',
                    '<h3 style="margin:0 0 8px;font-size:1rem;font-weight:700;color:#1a1a2e;">¿Por qué cambias la fecha límite?</h3>',
                    '<p style="margin:0 0 20px;font-size:.85rem;color:#666;">Selecciona la razón del cambio de fecha.</p>',
                    '<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px;">',
                    '<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:12px;border:1.5px solid #e0e0e0;border-radius:8px;transition:border-color .15s;" onmouseover="this.style.borderColor=\'#4f6ef7\'" onmouseout="if(!this.querySelector(\'input\').checked)this.style.borderColor=\'#e0e0e0\'">',
                    '<input type="radio" name="crmReprogramRazon" value="responsable" style="margin-top:2px;accent-color:#4f6ef7;">',
                    '<span style="font-size:.88rem;color:#333;"><strong>No logré terminar a tiempo</strong><br><span style="color:#888;font-size:.82rem;">El responsable no pudo completar la tarea dentro del plazo.</span></span></label>',
                    '<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:12px;border:1.5px solid #e0e0e0;border-radius:8px;transition:border-color .15s;" onmouseover="this.style.borderColor=\'#4f6ef7\'" onmouseout="if(!this.querySelector(\'input\').checked)this.style.borderColor=\'#e0e0e0\'">',
                    '<input type="radio" name="crmReprogramRazon" value="creador" style="margin-top:2px;accent-color:#4f6ef7;">',
                    '<span style="font-size:.88rem;color:#333;"><strong>El creador dio poco tiempo</strong><br><span style="color:#888;font-size:.82rem;">No se consideró la carga de trabajo o se asignó un plazo muy corto.</span></span></label>',
                    '<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:12px;border:1.5px solid #e0e0e0;border-radius:8px;transition:border-color .15s;" onmouseover="this.style.borderColor=\'#4f6ef7\'" onmouseout="if(!this.querySelector(\'input\').checked)this.style.borderColor=\'#e0e0e0\'">',
                    '<input type="radio" name="crmReprogramRazon" value="externo" style="margin-top:2px;accent-color:#4f6ef7;">',
                    '<span style="font-size:.88rem;color:#333;"><strong>Factor externo</strong><br><span style="color:#888;font-size:.82rem;">El cliente, proveedor u otro factor ajeno causó el retraso.</span></span></label>',
                    '</div>',
                    '<div style="display:flex;gap:10px;justify-content:flex-end;">',
                    '<button id="crmReprogramCancel" style="padding:8px 18px;border:1.5px solid #ddd;border-radius:7px;background:#fff;cursor:pointer;font-size:.88rem;color:#555;">Cancelar</button>',
                    '<button id="crmReprogramConfirm" style="padding:8px 20px;border:none;border-radius:7px;background:#4f6ef7;color:#fff;cursor:pointer;font-size:.88rem;font-weight:600;">Confirmar cambio</button>',
                    '</div></div>'
                ].join('');

                document.body.appendChild(dlg);

                document.getElementById('crmReprogramCancel').onclick = function () { dlg.remove(); };
                dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.remove(); });

                document.getElementById('crmReprogramConfirm').onclick = function () {
                    var sel = dlg.querySelector('input[name="crmReprogramRazon"]:checked');
                    if (!sel) { showToast('Selecciona una razón para continuar', 'error'); return; }
                    dlg.remove();
                    _crmTaskDoGuardar(sel.value);
                };

                // Highlight selected radio label
                dlg.querySelectorAll('input[name="crmReprogramRazon"]').forEach(function (inp) {
                    inp.addEventListener('change', function () {
                        dlg.querySelectorAll('label').forEach(function (l) { l.style.borderColor = '#e0e0e0'; });
                        if (inp.checked) inp.closest('label').style.borderColor = '#4f6ef7';
                    });
                });
            } else {
                _crmTaskDoGuardar(null);
            }
        }

        function crmTaskResponsableModalFecha(currentIso) {
            var dlgId = 'crmRespFechaDialog';
            var existing = document.getElementById(dlgId);
            if (existing) existing.remove();

            // Pre-fill with current date
            var currentLocal = '';
            if (currentIso) {
                try {
                    var d = new Date(currentIso);
                    currentLocal = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                } catch (e) {}
            }

            var dlg = document.createElement('div');
            dlg.id = dlgId;
            dlg.style.cssText = 'position:fixed;inset:0;z-index:10500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';
            dlg.innerHTML = [
                '<div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:440px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.22);">',
                '<h3 style="margin:0 0 16px;font-size:1rem;font-weight:700;color:#1a1a2e;">Cambiar fecha límite</h3>',
                '<label style="display:block;font-size:0.82rem;font-weight:600;color:#555;margin-bottom:6px;">Nueva fecha y hora</label>',
                '<input type="datetime-local" id="crmRespFechaInput" style="width:100%;border:1.5px solid #E0E0E0;border-radius:8px;padding:8px 10px;font-size:0.9rem;outline:none;box-sizing:border-box;margin-bottom:18px;" value="' + currentLocal + '">',
                '<p style="margin:0 0 10px;font-size:.85rem;font-weight:600;color:#333;">¿Por qué cambias la fecha límite?</p>',
                '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:22px;">',
                '<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;" class="crm-razon-label">',
                '<input type="radio" name="crmRespRazon" value="responsable" style="margin-top:2px;accent-color:#4f6ef7;">',
                '<span style="font-size:.85rem;color:#333;"><strong>No logré terminar a tiempo</strong><br><span style="color:#888;font-size:.8rem;">El responsable no pudo completar la tarea dentro del plazo.</span></span></label>',
                '<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;" class="crm-razon-label">',
                '<input type="radio" name="crmRespRazon" value="creador" style="margin-top:2px;accent-color:#4f6ef7;">',
                '<span style="font-size:.85rem;color:#333;"><strong>El creador dio poco tiempo</strong><br><span style="color:#888;font-size:.8rem;">No se consideró la carga de trabajo o se asignó un plazo muy corto.</span></span></label>',
                '<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;" class="crm-razon-label">',
                '<input type="radio" name="crmRespRazon" value="externo" style="margin-top:2px;accent-color:#4f6ef7;">',
                '<span style="font-size:.85rem;color:#333;"><strong>Factor externo</strong><br><span style="color:#888;font-size:.8rem;">El cliente, proveedor u otro factor ajeno causó el retraso.</span></span></label>',
                '</div>',
                '<div style="display:flex;gap:10px;justify-content:flex-end;">',
                '<button id="crmRespFechaCancel" style="padding:8px 18px;border:1.5px solid #ddd;border-radius:7px;background:#fff;cursor:pointer;font-size:.88rem;color:#555;">Cancelar</button>',
                '<button id="crmRespFechaConfirm" style="padding:8px 20px;border:none;border-radius:7px;background:#4f6ef7;color:#fff;cursor:pointer;font-size:.88rem;font-weight:600;">Guardar cambio</button>',
                '</div></div>'
            ].join('');

            document.body.appendChild(dlg);

            // Highlight selected radio
            dlg.querySelectorAll('input[name="crmRespRazon"]').forEach(function (inp) {
                inp.addEventListener('change', function () {
                    dlg.querySelectorAll('.crm-razon-label').forEach(function (l) { l.style.borderColor = '#e0e0e0'; });
                    if (inp.checked) inp.closest('.crm-razon-label').style.borderColor = '#4f6ef7';
                });
            });

            // Date input focus style
            var fechaInp = document.getElementById('crmRespFechaInput');
            if (fechaInp) {
                fechaInp.addEventListener('focus', function () { this.style.borderColor = '#4f6ef7'; });
                fechaInp.addEventListener('blur', function () { this.style.borderColor = '#E0E0E0'; });
            }

            document.getElementById('crmRespFechaCancel').onclick = function () { dlg.remove(); };
            dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.remove(); });

            document.getElementById('crmRespFechaConfirm').onclick = function () {
                var fechaInp2 = document.getElementById('crmRespFechaInput');
                var sel = dlg.querySelector('input[name="crmRespRazon"]:checked');
                if (!fechaInp2 || !fechaInp2.value) { showToast('Selecciona la nueva fecha y hora', 'error'); return; }
                if (!sel) { showToast('Selecciona una razón para continuar', 'error'); return; }
                dlg.remove();
                // Set edits and call save directly
                _crmTaskEdits.fecha_limite = fechaInp2.value;
                _crmTaskDoGuardar(sel.value);
            };
        }

        function crmTaskCancelarEdicion() {
            crmTaskHideSaveBar();
            // Restaurar desde los datos en memoria sin fetch
            if (_crmTaskLastData) crmTaskRenderData(_crmTaskLastData);
        }

        function crmTaskCerrarModal() {
            var modal = document.getElementById('crmTaskDetailModal');
            if (modal) {
                modal.classList.remove('active');
                modal.classList.remove('z-elevated');
                modal.classList.remove('z-elevated-overlay');
            }
            document.body.style.overflow = '';
            // Refrescar widget oportunidad al cerrar si la tarea tenia oportunidad
            if (_crmTaskLastData && _crmTaskLastData.oportunidad_id) {
                var oppId = _crmTaskLastData.oportunidad_id;
                if (typeof window.woCargarTareasInline === 'function') {
                    window.woCargarTareasInline(oppId);
                }
                if (typeof window.woCargarTareasOpp === 'function') {
                    window.woCargarTareasOpp(oppId);
                }
            }
            _crmCurrentTaskId = null;
            if (_crmTimerInterval) { clearInterval(_crmTimerInterval); _crmTimerInterval = null; }
            // Limpiar archivos pendientes del comentario
            _crmCommentFiles = [];
            _crmFilesRender();
            _crmMentionClose();
        }

        // Copiar enlace directo a la tarea
        function crmTaskCopyToClipboard(url, okMsg) {
            okMsg = okMsg || 'Enlace copiado';
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(function () {
                    showToast(okMsg, 'success', 2200);
                }, function () { showToast('No se pudo copiar', 'error'); });
            } else {
                try {
                    var ta = document.createElement('textarea');
                    ta.value = url; ta.style.position = 'fixed'; ta.style.left = '-9999px';
                    document.body.appendChild(ta); ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    showToast(okMsg, 'success', 2200);
                } catch (e) { showToast('No se pudo copiar', 'error'); }
            }
        }
        window.crmTaskCopiarEnlace = function () {
            if (!_crmCurrentTaskId) return;
            crmTaskCopyToClipboard(window.location.origin + '/app/?tarea=' + _crmCurrentTaskId);
        };

        // Dropdown 3-dots en el header
        window.crmTaskToggleMenu = function (e) {
            if (e) { e.stopPropagation(); }
            var menu = document.getElementById('crmTaskMenu');
            var btn = document.getElementById('crmTaskMenuBtn');
            if (!menu || !btn) return;
            var isOpen = menu.style.display !== 'none';
            menu.style.display = isOpen ? 'none' : 'block';
            btn.classList.toggle('is-open', !isOpen);
            btn.setAttribute('aria-expanded', String(!isOpen));
        };
        document.addEventListener('click', function (e) {
            var menu = document.getElementById('crmTaskMenu');
            var btn = document.getElementById('crmTaskMenuBtn');
            if (!menu || !btn) return;
            if (menu.style.display === 'none') return;
            if (btn.contains(e.target) || menu.contains(e.target)) return;
            menu.style.display = 'none';
            btn.classList.remove('is-open');
            btn.setAttribute('aria-expanded', 'false');
        });

        // Compartir vista previa (link sin login)
        window.crmTaskCompartirPreview = function () {
            if (!_crmCurrentTaskId) return;
            var menu = document.getElementById('crmTaskMenu');
            if (menu) menu.style.display = 'none';
            // Mini-toast verde de confirmación debajo del botón share
            function showShareToast() {
                var t = document.getElementById('crmTaskShareToast');
                if (!t) return;
                t.classList.add('is-on');
                setTimeout(function () { t.classList.remove('is-on'); }, 1800);
            }
            fetch('/app/api/tarea/' + _crmCurrentTaskId + '/share-link/')
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data && data.url) {
                        var full = data.url.indexOf('http') === 0 ? data.url : (window.location.origin + data.url);
                        // Copia silenciosa al portapapeles (sin global toast) y
                        // muestra el chip verde debajo del botón.
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(full).then(showShareToast, function () {
                                // fallback al método legacy si clipboard API falla
                                crmTaskCopyToClipboard(full, '');
                                showShareToast();
                            });
                        } else {
                            crmTaskCopyToClipboard(full, '');
                            showShareToast();
                        }
                    } else {
                        showToast(data.error || 'No se pudo generar el enlace', 'error');
                    }
                })
                .catch(function () { showToast('Error de conexión', 'error'); });
        };

        // Eliminar tarea (solo creador / superuser — se valida en backend)
        // Abre un overlay de confirmación en vez de window.confirm()
        window.crmTaskEliminarTarea = function () {
            if (!_crmCurrentTaskId) return;
            var menu = document.getElementById('crmTaskMenu');
            if (menu) menu.style.display = 'none';
            var overlay = document.getElementById('crmTaskDeleteOverlay');
            var subtitle = document.getElementById('crmTaskDeleteSubtitle');
            if (subtitle) {
                var titulo = _crmTaskLastData && _crmTaskLastData.titulo ? _crmTaskLastData.titulo : '';
                subtitle.textContent = titulo ? '"' + titulo + '"' : '';
            }
            if (overlay) overlay.style.display = 'flex';
        };
        window.crmTaskDeleteCancel = function () {
            var overlay = document.getElementById('crmTaskDeleteOverlay');
            if (overlay) overlay.style.display = 'none';
            var btn = document.getElementById('crmTaskDeleteConfirmBtn');
            if (btn) { btn.disabled = false; btn.textContent = 'Eliminar tarea'; }
        };
        window.crmTaskDeleteConfirm = function () {
            if (!_crmCurrentTaskId) return;
            var btn = document.getElementById('crmTaskDeleteConfirmBtn');
            if (btn) { btn.disabled = true; btn.textContent = 'Eliminando…'; btn.style.opacity = '0.75'; }
            var csrfEl = document.querySelector('[name=csrfmiddlewaretoken]');
            fetch('/app/api/tarea/' + _crmCurrentTaskId + '/eliminar/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrfEl ? csrfEl.value : '' }
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data && data.success) {
                        showToast('Tarea eliminada', 'success');
                        crmTaskDeleteCancel();
                        crmTaskCerrarModal();
                        _tareasPollHash = null;
                        if (typeof recargarTareasCRM === 'function') recargarTareasCRM();
                    } else {
                        if (btn) { btn.disabled = false; btn.textContent = 'Eliminar tarea'; btn.style.opacity = ''; }
                        showToast(data.error || 'No se pudo eliminar', 'error');
                    }
                })
                .catch(function () {
                    if (btn) { btn.disabled = false; btn.textContent = 'Eliminar tarea'; btn.style.opacity = ''; }
                    showToast('Error de conexión', 'error');
                });
        };
        // Click fuera del card o ESC para cancelar
        (function () {
            var overlay = document.getElementById('crmTaskDeleteOverlay');
            if (overlay) {
                overlay.addEventListener('click', function (e) {
                    if (e.target === overlay) crmTaskDeleteCancel();
                });
            }
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    var ov = document.getElementById('crmTaskDeleteOverlay');
                    if (ov && ov.style.display === 'flex') crmTaskDeleteCancel();
                }
            });
        })();

        // Click outside to close
        var taskModal = document.getElementById('crmTaskDetailModal');
        if (taskModal) {
            taskModal.addEventListener('click', function (e) {
                if (e.target === taskModal) crmTaskCerrarModal();
            });
        }

        // Toggle desde el botón principal "Completar tarea" (burst animation al completar)
        window.crmTaskToggleCompletar = function () {
            if (!_crmTaskLastData) return;
            if (_crmTaskLastData.estado === 'completada') {
                crmTaskReabrir();
            } else {
                var btn = document.getElementById('crmTaskBtnCompletarPrimary');
                if (btn) {
                    btn.classList.remove('bursting');
                    void btn.offsetWidth;
                    btn.classList.add('bursting');
                    setTimeout(function () { btn.classList.remove('bursting'); }, 620);
                }
                crmTaskCompletar();
            }
        };

        // ── Terminar tarea ──
        function crmTaskCompletar() {
            if (!_crmCurrentTaskId) return;
            var btn = document.getElementById('crmTaskBtnTerminar');
            if (btn) { btn.disabled = true; btn.innerHTML = '<span>Guardando...</span>'; }
            var csrfEl = document.querySelector('[name=csrfmiddlewaretoken]');
            fetch('/app/api/tarea/' + _crmCurrentTaskId + '/completar/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrfEl ? csrfEl.value : '' }
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.success !== false) {
                        if (btn) {
                            btn.classList.add('completada');
                            btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg><span>Completada</span>';
                            btn.disabled = true;
                        }
                        // Swap botón Completar → pill Completada + mostrar Reabrir
                        var btnCompPrim = document.getElementById('crmTaskBtnCompletarPrimary');
                        if (btnCompPrim) btnCompPrim.style.display = 'none';
                        var compPill = document.getElementById('crmTaskCompletadaPill');
                        if (compPill) compPill.style.display = 'inline-flex';
                        var btnReab = document.getElementById('crmTaskBtnReabrir');
                        if (btnReab) btnReab.style.display = 'inline-flex';

                        var estadoEl = document.getElementById('crm-task-estado');
                        if (estadoEl) estadoEl.innerHTML = getEstadoBadgeCRM('completada');

                        // Avance de etapa con descripcion requerida (modal bloqueante)
                        if (data.requiere_descripcion && window.crmAvanceEtapa) {
                            window.crmAvanceEtapa.handleCompletarResponse(data);
                        }

                        if (data.cadena_reactiva && data.cadena_reactiva.mensaje) {
                            showToast('Tarea completada — ' + data.cadena_reactiva.mensaje, 'success', 5000);
                        } else {
                            showToast('Tarea completada', 'success');
                        }

                        // Marcar notificaciones de esta tarea como leidas
                        try {
                            fetch('/app/api/marcar-todas-notificaciones-leidas/', {
                                method: 'POST',
                                headers: { 'X-CSRFToken': csrfEl ? csrfEl.value : '', 'Content-Type': 'application/json' },
                                body: JSON.stringify({ 'tarea_id': _crmCurrentTaskId })
                            }).then(function () { if (typeof notifLoad === 'function') notifLoad(); });
                        } catch (ex) { }

                        // Actualizar tabla de tareas y polling hash
                        if (_crmTaskLastData) _crmTaskLastData.estado = 'completada';
                        _tareasPollHash = null;
                        recargarTareasCRM();
                        // Refrescar widget oportunidad si está abierto
                        if (_crmTaskLastData && _crmTaskLastData.oportunidad_id) {
                            var oppId = _crmTaskLastData.oportunidad_id;
                            // Si hubo cadena reactiva (avance de etapa), recargar widget completo
                            if (data.cadena_reactiva && data.cadena_reactiva.avances && data.cadena_reactiva.avances.length > 0) {
                                if (typeof window.openDetalle === 'function') {
                                    window.openDetalle(oppId);
                                }
                                // Refrescar tabla CRM tambien (etapa cambio)
                                if (typeof window.refreshCrmTable === 'function') window.refreshCrmTable();
                            } else {
                                if (typeof window.woCargarTareasInline === 'function') {
                                    window.woCargarTareasInline(oppId);
                                }
                                if (typeof window.woCargarTareasOpp === 'function') {
                                    window.woCargarTareasOpp(oppId);
                                }
                            }
                        }
                    } else {
                        if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg><span>Completar</span>'; }
                        showToast(data.error || 'Error al completar', 'error');
                    }
                })
                .catch(function () {
                    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg><span>Completar</span>'; }
                    showToast('Error de conexión', 'error');
                });
        }

        // ── Reabrir tarea completada ──
        function crmTaskReabrir() {
            var overlay = document.getElementById('crmReabrirOverlay');
            var textarea = document.getElementById('crmReabrirRazon');
            if (overlay) { overlay.style.display = 'flex'; }
            if (textarea) { textarea.value = ''; textarea.focus(); }
        }

        function crmTaskReabrirConfirmar() {
            var razon = (document.getElementById('crmReabrirRazon') || {}).value || '';
            if (!razon.trim()) { showToast('Escribe el motivo para reabrir la tarea', 'error'); return; }
            var btn = document.getElementById('crmReabrirConfirmBtn');
            if (btn) { btn.disabled = true; btn.textContent = 'Reabriendo...'; }
            var csrfEl = document.querySelector('[name=csrfmiddlewaretoken]');
            fetch('/app/api/tarea/' + _crmCurrentTaskId + '/reabrir/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfEl ? csrfEl.value : '' },
                body: JSON.stringify({ razon: razon.trim() })
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (btn) { btn.disabled = false; btn.textContent = 'Reabrir tarea'; }
                    var overlay = document.getElementById('crmReabrirOverlay');
                    if (overlay) overlay.style.display = 'none';
                    if (data.success) {
                        showToast('Tarea reabierta', 'success');
                        if (typeof notifLoad === 'function') notifLoad();
                        // Limpiar caché y recargar tabla para que aparezca en pendientes
                        _crmTareasCache = {};
                        if (window._crmTareasMode) cargarTareasCRM(_crmCurrentFilter);
                        // Refrescar el modal
                        crmTaskVerDetalle(_crmCurrentTaskId);
                        // Refrescar tareas inline y tab completo del widget oportunidad
                        if (_crmTaskLastData && _crmTaskLastData.oportunidad_id) {
                            var oppId = _crmTaskLastData.oportunidad_id;
                            if (typeof window.woCargarTareasInline === 'function') {
                                window.woCargarTareasInline(oppId);
                            }
                            if (typeof window.woCargarTareasOpp === 'function') {
                                window.woCargarTareasOpp(oppId);
                            }
                        }
                    } else {
                        showToast(data.error || 'Error al reabrir la tarea', 'error');
                    }
                })
                .catch(function () {
                    if (btn) { btn.disabled = false; btn.textContent = 'Reabrir tarea'; }
                    showToast('Error de conexión', 'error');
                });
        }

        // ── Abrir oportunidad desde tarea (sin cerrar el modal de tarea) ──
        function crmTaskAbrirOportunidad() {
            if (!_crmTaskCurrentOppId) return;
            // Elevar por encima del modal de tarea (puede ser z-elevated o CAPA 4)
            var dl = document.getElementById('widgetDetalle');
            if (dl) { dl.classList.add('z-elevated'); dl.classList.add('z-elevated-top'); }
            if (typeof openDetalle === 'function') openDetalle(_crmTaskCurrentOppId);
        }

        // ── Abrir drive desde tarea ──
        function crmTaskAbrirDrive() {
            if (!_crmTaskCurrentOppId) return;
            // Si la tarea está en VENTANA (o dentro de un iframe de tarea), el
            // drive abre como VENTANA propia (prospecto_windows / la página
            // iframe lo manejan). Si devuelve true, no abrimos el modal.
            if (typeof window._taskDriveAsWindow === 'function' &&
                window._taskDriveAsWindow(_crmTaskCurrentOppId)) return;
            if (typeof woSetCurrentOppId === 'function') woSetCurrentOppId(_crmTaskCurrentOppId);
            // Elevar por encima del modal de tarea: el drive es CAPA 2 (10200)
            // y el modal CAPA 4 (10400) — sin esto el drive abre DETRÁS.
            // woCerrarGestorDrive limpia la clase y el z inline al cerrar.
            var dw = document.getElementById('widgetOppDrive');
            if (dw) {
                var _tm2 = document.getElementById('crmTaskDetailModal');
                if (_tm2 && _tm2.classList.contains('z-elevated-overlay')) {
                    // Tarea abierta desde una opp elevada (10900) → aún más arriba.
                    dw.style.zIndex = '11000';
                } else {
                    dw.classList.add('z-elevated-top');
                }
            }
            if (typeof woAbrirGestorDrive === 'function') woAbrirGestorDrive();
        }

        // ── Comentarios ──
        var _crmCurrentUserId = _CRM_CONFIG.userId;

        // Set current user avatar in comment form
        (function () {
            var av = document.getElementById('crm-task-comment-avatar');
            if (av) {
                if (_CRM_CONFIG.usuarioAvatar) {
                    av.innerHTML = '<img src="' + _CRM_CONFIG.usuarioAvatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                } else {
                    av.textContent = crmTaskGetInitials(_CRM_CONFIG.usuarioNombre || '');
                }
            }
        })();

        // Hook para el sync entre usuarios (crm_sync.js): recargar los
        // comentarios del detalle de tarea ABIERTO cuando otro usuario
        // comenta. La función y _crmCurrentTaskId viven en este closure.
        window._crmTaskRecargarComentarios = function (tareaId) {
            if (!_crmCurrentTaskId) return;
            if (tareaId && String(tareaId) !== String(_crmCurrentTaskId)) return;
            crmTaskCargarComentarios(_crmCurrentTaskId);
        };

        function crmTaskCargarComentarios(tareaId) {
            var feed = document.getElementById('crm-task-activity-feed');
            if (!feed) return;
            feed.innerHTML = '<div style="text-align:center;padding:1rem;color:#9CA3AF;">Cargando...</div>';

            fetch('/app/api/tarea/' + tareaId + '/comentarios/')
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.comentarios && data.comentarios.length > 0) {
                        feed.innerHTML = data.comentarios.map(function (c) {
                            var nombreUsuario = (c.usuario && c.usuario.nombre) ? c.usuario.nombre : 'Usuario';
                            var userId = c.usuario && c.usuario.id;
                            var initials = crmTaskGetInitials(nombreUsuario);
                            var avatarUrl = c.usuario && c.usuario.avatar_url;
                            var avatarHtml = avatarUrl
                                ? '<img src="' + avatarUrl + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">'
                                : initials;
                            var fecha = c.fecha_creacion || c.fecha || '';
                            var _localIsSu = _CRM_CONFIG.isSuperuser;
                            var canManage = (userId === _crmCurrentUserId || _localIsSu);
                            var menuHtml = canManage
                                ? '<div style="position:relative;display:inline-block;" class="crm-comment-menu-wrap">' +
                                '<button onclick="crmCommentToggleMenu(this)" style="background:none;border:none;cursor:pointer;color:#9CA3AF;padding:2px 6px;border-radius:4px;font-size:1rem;line-height:1;" title="Opciones">&#8943;</button>' +
                                '<div class="crm-comment-dropdown" style="display:none;position:absolute;right:0;top:100%;background:white;border:1px solid #E5E5EA;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.12);min-width:130px;z-index:50;">' +
                                '<button onclick="crmCommentEditar(' + c.id + ',this)" style="display:block;width:100%;text-align:left;padding:8px 14px;background:none;border:none;cursor:pointer;font-size:0.83rem;color:#1D1D1F;">Editar</button>' +
                                '<button onclick="crmCommentEliminar(' + c.id + ')" style="display:block;width:100%;text-align:left;padding:8px 14px;background:none;border:none;cursor:pointer;font-size:0.83rem;color:#EF4444;">Eliminar</button>' +
                                '</div></div>'
                                : '';
                            var archivosHtml = '';
                            if (c.archivos && c.archivos.length) {
                                archivosHtml = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">' +
                                    c.archivos.map(function (a) {
                                        var isImg = a.tipo_contenido && a.tipo_contenido.startsWith('image/');
                                        if (isImg) {
                                            return '<a href="' + a.url + '" target="_blank" style="display:block;border-radius:6px;overflow:hidden;max-width:160px;">' +
                                                '<img src="' + a.url + '" style="max-width:160px;max-height:120px;object-fit:cover;display:block;border-radius:6px;border:1px solid #E5E5EA;"></a>';
                                        }
                                        return '<a href="' + a.url + '" target="_blank" style="display:flex;align-items:center;gap:5px;background:#F3F4F6;border:1px solid #E5E5EA;border-radius:6px;padding:4px 8px;font-size:0.78rem;color:#374151;text-decoration:none;">&#128196; ' + (a.nombre_original || 'archivo') + '</a>';
                                    }).join('') + '</div>';
                            }
                            return '<div data-comment-id="' + c.id + '" style="display:flex;gap:10px;padding:12px 0;border-top:1px solid #F0F0F0;">' +
                                '<div class="crm-task-avatar" style="background:#0052D4;width:30px;height:30px;font-size:0.62rem;flex-shrink:0;margin-top:1px;">' + avatarHtml + '</div>' +
                                '<div style="flex:1;min-width:0;">' +
                                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">' +
                                '<span style="font-weight:600;font-size:0.84rem;color:#1D1D1F;">' + nombreUsuario + '</span>' +
                                '<div style="display:flex;align-items:center;gap:4px;">' +
                                '<span style="font-size:0.7rem;color:#9CA3AF;">' + (fecha ? formatearFechaCRM(fecha) : '') + '</span>' +
                                menuHtml + '</div></div>' +
                                '<div class="crm-comment-content" style="font-size:0.84rem;color:#4B5563;line-height:1.55;">' + (c.contenido_con_menciones || c.contenido || '') + '</div>' +
                                archivosHtml +
                                '</div></div>';
                        }).join('');
                        // Close menus on outside click
                        // (2026-06-11 fix leak) Cada carga de comentarios
                        // registraba OTRO listener en document sin remover el
                        // anterior — tras N tareas abiertas, N listeners
                        // corriendo en cada click de la página. Remover el
                        // previo antes de registrar (feed persiste entre
                        // renders, la referencia sobrevive).
                        if (feed._menuClose) {
                            document.removeEventListener('click', feed._menuClose);
                        }
                        feed._menuClose = function (e) {
                            if (!e.target.closest('.crm-comment-menu-wrap')) {
                                feed.querySelectorAll('.crm-comment-dropdown').forEach(function (d) { d.style.display = 'none'; });
                            }
                        };
                        document.addEventListener('click', feed._menuClose);
                    } else {
                        feed.innerHTML = '<div style="text-align:center;padding:1rem;color:#9CA3AF;font-size:0.85rem;">No hay comentarios aún.</div>';
                    }
                })
                .catch(function (err) {
                    console.error('Error cargando comentarios:', err);
                    feed.innerHTML = '<div style="text-align:center;padding:1rem;color:#9CA3AF;">Error al cargar comentarios.</div>';
                });
        }

        function crmCommentToggleMenu(btn) {
            var dd = btn.nextElementSibling;
            var isOpen = dd.style.display === 'block';
            document.querySelectorAll('.crm-comment-dropdown').forEach(function (d) { d.style.display = 'none'; });
            if (!isOpen) dd.style.display = 'block';
        }

        function crmCommentEditar(commentId, btn) {
            var wrap = btn.closest('[data-comment-id]');
            if (!wrap) return;
            btn.closest('.crm-comment-dropdown').style.display = 'none';
            var contentEl = wrap.querySelector('.crm-comment-content');
            var currentText = contentEl.textContent;
            var ta = document.createElement('textarea');
            ta.value = currentText;
            ta.style.cssText = 'width:100%;border:1px solid #0052D4;border-radius:6px;padding:6px 8px;font-size:0.85rem;outline:none;resize:vertical;min-height:60px;';
            var saveBtn = document.createElement('button');
            saveBtn.textContent = 'Guardar';
            saveBtn.style.cssText = 'margin-top:4px;background:#0052D4;color:white;border:none;padding:4px 14px;border-radius:6px;cursor:pointer;font-size:0.82rem;font-weight:600;';
            var cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancelar';
            cancelBtn.style.cssText = 'margin-top:4px;margin-left:6px;background:none;border:1px solid #D1D5DB;color:#6B7280;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:0.82rem;';
            contentEl.replaceWith(ta);
            ta.after(saveBtn); saveBtn.after(cancelBtn);
            ta.focus();
            cancelBtn.onclick = function () { crmTaskCargarComentarios(_crmCurrentTaskId); };
            saveBtn.onclick = function () {
                var newText = ta.value.trim();
                if (!newText) return;
                var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
                var fd = new FormData(); fd.append('contenido', newText);
                fetch('/app/api/comentario-tarea/' + commentId + '/editar/', { method: 'POST', body: fd, headers: { 'X-CSRFToken': csrf ? csrf.value : '' } })
                    .then(function (r) { return r.json(); })
                    .then(function (d) { if (d.success) crmTaskCargarComentarios(_crmCurrentTaskId); else showToast(d.error || 'Error', 'error'); });
            };
        }

        function crmCommentEliminar(commentId) {
            var overlay = document.getElementById('crmCommentConfirmOverlay');
            var btn = document.getElementById('crmCommentConfirmBtn');
            if (!overlay || !btn) return;
            overlay.style.display = 'flex';
            btn.onclick = function () {
                overlay.style.display = 'none';
                var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
                var fd = new FormData();
                fetch('/app/api/comentario-tarea/' + commentId + '/eliminar/', { method: 'POST', body: fd, headers: { 'X-CSRFToken': csrf ? csrf.value : '' } })
                    .then(function (r) { return r.json(); })
                    .then(function (d) { if (d.success) crmTaskCargarComentarios(_crmCurrentTaskId); else showToast(d.error || 'Error', 'error'); });
            };
        }

        function crmCommentConfirmCancel() {
            var overlay = document.getElementById('crmCommentConfirmOverlay');
            if (overlay) overlay.style.display = 'none';
        }

        function crmTaskEditarCliente(currentClienteNombre) {
            var clienteEl = document.getElementById('crm-task-cliente-nombre');
            if (!clienteEl) return;
            var wrap = document.createElement('div');
            wrap.style.cssText = 'position:relative;width:100%;';
            var inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Buscar cliente (min 2 letras)...';
            inp.style.cssText = 'width:100%;border:1px solid #0052D4;border-radius:6px;padding:3px 8px;font-size:0.82rem;outline:none;';
            inp.value = currentClienteNombre || '';
            var dd = document.createElement('div');
            dd.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:white;border:1px solid #E5E5EA;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-height:180px;overflow-y:auto;z-index:200;display:none;';
            wrap.appendChild(inp); wrap.appendChild(dd);
            clienteEl.replaceWith(wrap); inp.focus();
            crmTaskShowSaveBar();
            function buscarCliente(q) {
                if (q.length < 2) { dd.style.display = 'none'; return; }
                fetch('/app/api/buscar-clientes/?q=' + encodeURIComponent(q))
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        var clientes = data.clientes || []; dd.innerHTML = '';
                        if (!clientes.length) { dd.style.display = 'none'; return; }
                        clientes.forEach(function (cl) {
                            var div = document.createElement('div'); div.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.82rem;';
                            div.textContent = cl.nombre;
                            div.addEventListener('mouseenter', function () { div.style.background = '#F3F4F6'; });
                            div.addEventListener('mouseleave', function () { div.style.background = ''; });
                            div.addEventListener('click', function () {
                                _crmTaskEdits.cliente_id = cl.id;
                                _crmTaskEdits.cliente_nombre = cl.nombre;
                                crmTaskShowSaveBar();
                                var span = document.createElement('span');
                                span.id = 'crm-task-cliente-nombre';
                                span.className = 'crm-task-info-value';
                                span.style.cssText = 'color:#0052D4;font-weight:600;cursor:pointer;';
                                span.textContent = cl.nombre;
                                span.onclick = function () { crmTaskEditarCliente(cl.nombre); };
                                wrap.replaceWith(span);
                                dd.style.display = 'none';
                            });
                            dd.appendChild(div);
                        }); dd.style.display = 'block';
                    });
            }
            inp.addEventListener('input', function () { buscarCliente(this.value); });
            inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') crmTaskVerDetalle(_crmCurrentTaskId); });
        }

        // ── Comment files (drag-drop + select) ──
        var _crmCommentFiles = [];

        function _crmFilesRender() {
            var preview = document.getElementById('crm-task-files-preview');
            if (!preview) return;
            preview.innerHTML = '';
            _crmCommentFiles.forEach(function (f, i) {
                var isImg = f.type.startsWith('image/');
                var chip = document.createElement('div');
                chip.style.cssText = 'display:flex;align-items:center;gap:5px;background:#F3F4F6;border:1px solid #E5E5EA;border-radius:6px;padding:4px 8px;font-size:0.78rem;color:#374151;max-width:200px;';
                var icon = isImg ? '&#128247;' : '&#128196;';
                var name = f.name.length > 20 ? f.name.slice(0, 17) + '...' : f.name;
                chip.innerHTML = icon + ' <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + name + '</span>';
                var rm = document.createElement('button');
                rm.innerHTML = '&times;';
                rm.style.cssText = 'background:none;border:none;cursor:pointer;color:#9CA3AF;font-size:1rem;line-height:1;padding:0 2px;';
                rm.onclick = (function (idx) { return function () { _crmCommentFiles.splice(idx, 1); _crmFilesRender(); }; })(i);
                chip.appendChild(rm);
                preview.appendChild(chip);
            });
        }

        function _crmFilesAdd(files) {
            for (var i = 0; i < files.length; i++) { _crmCommentFiles.push(files[i]); }
            _crmFilesRender();
            // Hide drop zone once files are added
            var dz = document.getElementById('crm-task-drop-zone');
            if (dz) dz.style.display = 'none';
        }

        var dropZone = document.getElementById('crm-task-drop-zone');
        if (dropZone) {
            dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.style.background = '#EEF2FF'; dropZone.style.borderColor = '#4f6ef7'; });
            dropZone.addEventListener('dragleave', function () { dropZone.style.background = ''; dropZone.style.borderColor = '#D1D5DB'; });
            dropZone.addEventListener('drop', function (e) {
                e.preventDefault(); e.stopPropagation();
                dropZone.style.background = ''; dropZone.style.borderColor = '#D1D5DB';
                _crmFilesAdd(e.dataTransfer.files);
            });
        }
        // Selección de archivos ("selecciona"): el change se delega a nivel
        // document UNA sola vez y llama al _crmFilesAdd vigente (expuesto en
        // window cada crmReady). Antes el listener se ataba a la instancia del
        // input y, al re-ejecutarse crmReady (turbo:load) o reabrir el modal,
        // quedaba huérfano/duplicado: el primero en disparar hacía this.value=''
        // y borraba los archivos antes de que el handler vigente los leyera, así
        // que "selecciona" no adjuntaba nada (el drag-drop sí, porque va sobre el
        // form, no sobre el input). La delegación es inmune a esos recreados.
        window._crmTaskFilesAdd = _crmFilesAdd;
        if (!window._crmTaskFileChangeDelegated) {
            window._crmTaskFileChangeDelegated = true;
            document.addEventListener('change', function (e) {
                var t = e.target;
                if (!t || t.id !== 'crm-task-file-input' || !t.files || !t.files.length) return;
                if (typeof window._crmTaskFilesAdd === 'function') window._crmTaskFilesAdd(t.files);
                t.value = '';
            });
        }

        // Allow drop on textarea + comment form — show drop zone hint while dragging
        var commentInput = document.getElementById('crm-task-comment-input');
        var commentForm = document.getElementById('crm-task-comment-form');
        var _dragCounter = 0;
        function _showDropHint() {
            if (dropZone && !_crmCommentFiles.length) dropZone.style.display = 'block';
            if (commentForm) { commentForm.style.borderColor = '#4f6ef7'; commentForm.style.background = '#F8FAFF'; }
        }
        function _hideDropHint() {
            if (dropZone) dropZone.style.display = 'none';
            if (commentForm) { commentForm.style.borderColor = ''; commentForm.style.background = ''; }
        }
        if (commentForm) {
            commentForm.addEventListener('dragenter', function (e) { e.preventDefault(); _dragCounter++; _showDropHint(); });
            commentForm.addEventListener('dragover', function (e) { e.preventDefault(); });
            commentForm.addEventListener('dragleave', function (e) { _dragCounter--; if (_dragCounter <= 0) { _dragCounter = 0; _hideDropHint(); } });
            commentForm.addEventListener('drop', function (e) {
                e.preventDefault(); _dragCounter = 0; _hideDropHint();
                if (e.dataTransfer.files && e.dataTransfer.files.length) { _crmFilesAdd(e.dataTransfer.files); }
            });
        }

        // ── @mention autocomplete ──
        var _mentionQuery = null;
        var _mentionStart = -1;

        function _crmMentionClose() {
            var dd = document.getElementById('crm-mention-dropdown');
            if (dd) dd.style.display = 'none';
            _mentionQuery = null; _mentionStart = -1;
        }

        if (commentInput) {
            commentInput.addEventListener('keydown', function (e) {
                var dd = document.getElementById('crm-mention-dropdown');
                if (dd && dd.style.display !== 'none') {
                    var items = dd.querySelectorAll('[data-mention-item]');
                    var focused = dd.querySelector('[data-mention-item].focused');
                    var idx = Array.prototype.indexOf.call(items, focused);
                    if (e.key === 'ArrowDown') { e.preventDefault(); if (focused) focused.classList.remove('focused'); var next = items[idx + 1] || items[0]; if (next) next.classList.add('focused'); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); if (focused) focused.classList.remove('focused'); var prev = items[idx - 1] || items[items.length - 1]; if (prev) prev.classList.add('focused'); return; }
                    if (e.key === 'Enter' || e.key === 'Tab') { var sel = focused || items[0]; if (sel) { e.preventDefault(); sel.click(); } return; }
                    if (e.key === 'Escape') { _crmMentionClose(); return; }
                }
            });

            commentInput.addEventListener('input', function () {
                var val = this.value;
                var pos = this.selectionStart;
                // Find @ before cursor
                var atIdx = -1;
                for (var i = pos - 1; i >= 0; i--) {
                    if (val[i] === '@') { atIdx = i; break; }
                    if (val[i] === ' ' || val[i] === '\n') break;
                }
                if (atIdx === -1) { _crmMentionClose(); return; }
                var q = val.slice(atIdx + 1, pos);
                if (q === _mentionQuery) return;
                _mentionQuery = q;
                _mentionStart = atIdx;
                var dd = document.getElementById('crm-mention-dropdown');
                if (!dd) return;
                fetch('/app/api/buscar-usuarios/?q=' + encodeURIComponent(q))
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        var usuarios = data.usuarios || data.results || [];
                        if (!usuarios.length) { dd.style.display = 'none'; return; }
                        dd.innerHTML = '';
                        usuarios.slice(0, 8).forEach(function (u) {
                            var nombre = u.nombre || u.full_name || u.username || '';
                            var username = u.username || '';
                            var item = document.createElement('div');
                            item.setAttribute('data-mention-item', '1');
                            item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.85rem;display:flex;align-items:center;gap:8px;';
                            item.innerHTML = '<span style="font-weight:600;color:#1D1D1F;">' + nombre + '</span>';
                            item.addEventListener('mouseenter', function () { dd.querySelectorAll('[data-mention-item]').forEach(function (x) { x.classList.remove('focused'); }); item.classList.add('focused'); item.style.background = '#F3F4F6'; });
                            item.addEventListener('mouseleave', function () { item.style.background = ''; });
                            (function(n) {
                            item.addEventListener('click', function () {
                                var before = commentInput.value.slice(0, _mentionStart);
                                var after = commentInput.value.slice(commentInput.selectionStart);
                                var tag = '@[' + n + '] ';
                                commentInput.value = before + tag + after;
                                var newPos = _mentionStart + tag.length;
                                commentInput.setSelectionRange(newPos, newPos);
                                _crmMentionClose();
                                commentInput.focus();
                            });
                            })(nombre);
                            dd.appendChild(item);
                        });
                        dd.style.display = 'block';
                    }).catch(function () { dd.style.display = 'none'; });
            });

            document.addEventListener('click', function (e) {
                if (!e.target.closest('#crm-mention-dropdown') && e.target !== commentInput) _crmMentionClose();
            });
        }

        // Submit comment
        var commentForm = document.getElementById('crm-task-comment-form');
        if (commentForm) {
            commentForm.addEventListener('submit', function (e) {
                e.preventDefault();
                var input = document.getElementById('crm-task-comment-input');
                var contenido = input ? input.value.trim() : '';
                if (!contenido && _crmCommentFiles.length === 0) return;
                if (!_crmCurrentTaskId) return;

                var formData = new FormData();
                if (contenido) formData.append('contenido', contenido);
                else formData.append('contenido', '(archivo adjunto)');

                _crmCommentFiles.forEach(function (f, i) { formData.append('archivo_' + i, f); });

                var csrfEl = document.querySelector('[name=csrfmiddlewaretoken]');
                if (csrfEl) formData.append('csrfmiddlewaretoken', csrfEl.value);

                var submitBtn = document.getElementById('crm-task-btn-enviar');
                if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Enviando...'; }

                fetch('/app/api/tarea/' + _crmCurrentTaskId + '/comentarios/agregar/', {
                    method: 'POST',
                    body: formData,
                    headers: { 'X-CSRFToken': csrfEl ? csrfEl.value : '' }
                })
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (data.success) {
                            if (input) input.value = '';
                            _crmCommentFiles = [];
                            _crmFilesRender();
                            crmTaskCargarComentarios(_crmCurrentTaskId);
                            if (typeof notifLoad === 'function') notifLoad();
                        } else { showToast(data.error || 'Error al enviar', 'error'); }
                    })
                    .catch(function (err) { console.error('Error enviando comentario:', err); showToast('Error de conexión', 'error'); })
                    .finally(function () { if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg> Enviar'; } });
            });
        }

        // ── Timer ──
        function crmTaskToggleTimer() {
            if (!_crmCurrentTaskId) return;
            var csrfEl = document.querySelector('[name=csrfmiddlewaretoken]');

            fetch('/app/api/tarea/' + _crmCurrentTaskId + '/toggle-timer/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfEl ? csrfEl.value : ''
                }
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var startBtn = document.getElementById('crm-task-btn-start');
                    var timerDisplay = document.getElementById('crm-task-timer-display');
                    if (!startBtn || !timerDisplay) return;

                    if (data.trabajando) {
                        startBtn.classList.add('running');
                        startBtn.querySelector('span').textContent = 'Pausar Tarea';
                        timerDisplay.style.display = 'block';
                        crmTaskStartTimerDisplay(data.tiempo_trabajado, data.fecha_inicio_sesion);
                    } else {
                        startBtn.classList.remove('running');
                        startBtn.querySelector('span').textContent = 'Iniciar Tarea';
                        if (_crmTimerInterval) { clearInterval(_crmTimerInterval); _crmTimerInterval = null; }
                        timerDisplay.textContent = data.tiempo_trabajado || '00:00:00';
                    }
                })
                .catch(function (err) { console.error('Error toggle timer:', err); });
        }

        function crmTaskStartTimerDisplay(baseTime, startISO) {
            if (_crmTimerInterval) clearInterval(_crmTimerInterval);
            var timerDisplay = document.getElementById('crm-task-timer-display');
            if (!timerDisplay) return;

            var baseParts = (baseTime || '00:00:00').split(':');
            var baseSeconds = parseInt(baseParts[0] || 0) * 3600 + parseInt(baseParts[1] || 0) * 60 + parseInt(baseParts[2] || 0);
            var startDate = startISO ? new Date(startISO) : new Date();

            function update() {
                var elapsed = Math.floor((Date.now() - startDate.getTime()) / 1000);
                var total = baseSeconds + elapsed;
                var h = Math.floor(total / 3600);
                var m = Math.floor((total % 3600) / 60);
                var s = total % 60;
                timerDisplay.textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
            }
            update();
            _crmTimerInterval = setInterval(update, 1000);
        }

        // ── Editable fields (placeholder) ──
        function crmTaskMakeEditable(_field) {
            // Placeholder for inline editing - can be expanded
        }

        // ══════════════════════════════════
        // ═══ MODAL CREAR TAREA ═══
        // ══════════════════════════════════

        function crmTaskAbrirCrear(oppId) {
            var modal = document.getElementById('crmCreateTaskModal');
            if (modal) {
                modal.classList.add('active');
                document.body.style.overflow = 'hidden';
                // Set oportunidad silently if provided
                var oppIdEl = document.getElementById('crmTaskOppId');
                if (oppIdEl) oppIdEl.value = oppId || '';
                // Default due date: today + 1 hour
                var dueDateEl = document.getElementById('crmTaskDueDate');
                if (dueDateEl && !dueDateEl.value) {
                    var d = new Date();
                    d.setHours(d.getHours() + 1);
                    var pad = function (n) { return n < 10 ? '0' + n : n; };
                    dueDateEl.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
                }
                // Refrescar labels del composer (fecha default, sin asignaciones, etc.)
                if (typeof crmCreateRefreshLabels === 'function') crmCreateRefreshLabels();
                if (typeof crmCreateUpdateOppLabel === 'function') crmCreateUpdateOppLabel();
                var titleInput = document.getElementById('crmTaskTitleInput');
                if (titleInput) titleInput.focus();
                // Soporte invisible para pegar/arrastrar imágenes en la descripción.
                var descEditor = document.getElementById('crmTaskDescEditor');
                if (descEditor && typeof window._crmTaskAttachImageHandlers === 'function') {
                    window._crmTaskAttachImageHandlers(descEditor, { mode: 'create' });
                }
            }
        }

        function crmTaskCerrarCrear() {
            var modal = document.getElementById('crmCreateTaskModal');
            if (modal) modal.classList.remove('active');
            document.body.style.overflow = '';
            // Reset form
            var ti = document.getElementById('crmTaskTitleInput'); if (ti) ti.value = '';
            var de = document.getElementById('crmTaskDescEditor');
            if (de) { if (de.value !== undefined) de.value = ''; else de.innerHTML = ''; }
            var hp = document.getElementById('crmTaskHighPriority'); if (hp) hp.checked = false;
            var dd2 = document.getElementById('crmTaskDueDate'); if (dd2) dd2.value = '';
            ['crmTaskSelectedResponsible', 'crmTaskSelectedParticipants', 'crmTaskSelectedObservers'].forEach(function (id) {
                var el = document.getElementById(id); if (el) el.innerHTML = '';
            });
            // Reset state
            _crmTaskSelectedResp = null;
            _crmTaskSelectedParts = [];
            _crmTaskSelectedObs = [];
            // Reset oportunidad and tarea padre
            var oid = document.getElementById('crmTaskOppId'); if (oid) oid.value = '';
            var pid = document.getElementById('crmTaskPadreId'); if (pid) pid.value = '';
            // Reset tool labels del composer + cerrar popovers + limpiar archivos
            if (typeof _crmCreateClearFiles === 'function') _crmCreateClearFiles();
            crmCreateRefreshLabels();
            crmCreateCloseAllPops();
            // Remove any open user dropdown
            var dd3 = document.querySelector('.crm-user-dropdown'); if (dd3) dd3.remove();
        }

        // ── Composer: popovers de meta-tools ──
        function crmCreateCloseAllPops() {
            ['crmCreatePopResp', 'crmCreatePopParts', 'crmCreatePopObs', 'crmCreatePopFecha']
                .forEach(function (id) { var p = document.getElementById(id); if (p) p.style.display = 'none'; });
            ['crmCreateRespBtn', 'crmCreatePartsBtn', 'crmCreateObsBtn', 'crmCreateFechaBtn']
                .forEach(function (id) { var b = document.getElementById(id); if (b) b.classList.remove('active'); });
        }
        window.crmCreateOpenPop = function (which, e) {
            if (e) e.stopPropagation();
            var mapPop = { resp: 'crmCreatePopResp', parts: 'crmCreatePopParts', obs: 'crmCreatePopObs', fecha: 'crmCreatePopFecha' };
            var mapBtn = { resp: 'crmCreateRespBtn', parts: 'crmCreatePartsBtn', obs: 'crmCreateObsBtn', fecha: 'crmCreateFechaBtn' };
            var mapInput = { resp: 'crmTaskResponsibleSearch', parts: 'crmTaskParticipantsSearch', obs: 'crmTaskObserversSearch', fecha: 'crmTaskDueDate' };
            var pop = document.getElementById(mapPop[which]);
            var btn = document.getElementById(mapBtn[which]);
            if (!pop || !btn) return;
            var isOpen = pop.style.display !== 'none';
            crmCreateCloseAllPops();
            if (!isOpen) {
                pop.style.display = 'block';
                btn.classList.add('active');
                var inp = document.getElementById(mapInput[which]);
                if (inp && inp.focus) setTimeout(function () { inp.focus(); }, 30);
            }
        };
        // Cerrar popover al hacer click fuera
        document.addEventListener('click', function (e) {
            var modal = document.getElementById('crmCreateTaskModal');
            if (!modal || !modal.classList.contains('active')) return;
            var wraps = modal.querySelectorAll('.crm-ctw-popwrap');
            for (var i = 0; i < wraps.length; i++) {
                if (wraps[i].contains(e.target)) return;
            }
            crmCreateCloseAllPops();
        });

        // Actualiza los labels de las pills según selecciones actuales,
        // marca las pills required como "filled" o "missing" y habilita
        // el botón de crear solo si título + responsable + fecha están OK.
        function crmCreateRefreshLabels() {
            var rl = document.getElementById('crmCreateRespLabel');
            var respBtn = document.getElementById('crmCreateRespBtn');
            if (rl) rl.textContent = _crmTaskSelectedResp ? (_crmTaskSelectedResp.nombre || _crmTaskSelectedResp.username || 'Responsable') : 'Selecciona responsable (requerido)';
            if (respBtn) {
                respBtn.classList.toggle('is-filled', !!_crmTaskSelectedResp);
                respBtn.classList.remove('is-missing');
            }
            var pl = document.getElementById('crmCreatePartsLabel');
            if (pl) pl.textContent = (_crmTaskSelectedParts && _crmTaskSelectedParts.length) ? ('Participantes · ' + _crmTaskSelectedParts.length) : 'Participantes';
            var ol = document.getElementById('crmCreateObsLabel');
            if (ol) ol.textContent = (_crmTaskSelectedObs && _crmTaskSelectedObs.length) ? ('Observadores · ' + _crmTaskSelectedObs.length) : 'Observadores';

            // Prioridad
            var hp = document.getElementById('crmTaskHighPriority');
            var prioBtn = document.getElementById('crmCreatePrioBtn');
            var prioLabel = document.getElementById('crmCreatePrioLabel');
            if (prioBtn && prioLabel) {
                if (hp && hp.checked) { prioBtn.classList.add('prio-alta'); prioLabel.textContent = 'Alta'; }
                else { prioBtn.classList.remove('prio-alta'); prioLabel.textContent = 'Prioridad'; }
            }

            // Fecha
            var dd = document.getElementById('crmTaskDueDate');
            var fBtn = document.getElementById('crmCreateFechaBtn');
            var fLabel = document.getElementById('crmCreateFechaLabel');
            if (fLabel && fBtn) {
                if (dd && dd.value) {
                    fBtn.classList.add('active');
                    fBtn.classList.add('is-filled');
                    fBtn.classList.remove('is-missing');
                    try {
                        var d = new Date(dd.value);
                        var opts = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' };
                        fLabel.textContent = d.toLocaleDateString('es-MX', opts).replace(',', ' ·');
                    } catch (_) { fLabel.textContent = dd.value; }
                } else {
                    fBtn.classList.remove('active');
                    fBtn.classList.remove('is-filled');
                    fLabel.textContent = 'Fecha (requerido)';
                }
            }

            // Habilita/deshabilita el botón Crear según campos requeridos
            crmCreateUpdateSubmitState();
        }

        // Verifica si título, responsable y fecha están llenos para habilitar
        // el botón de Crear tarea.
        function crmCreateUpdateSubmitState() {
            var titleEl = document.getElementById('crmTaskTitleInput');
            var ddEl = document.getElementById('crmTaskDueDate');
            var btn = document.getElementById('crmTaskSubmitBtn');
            if (!btn) return;
            var titleOk = titleEl && titleEl.value.trim().length > 0;
            var respOk = !!_crmTaskSelectedResp;
            var fechaOk = ddEl && ddEl.value;
            var allOk = titleOk && respOk && fechaOk;
            btn.disabled = !allOk;
            btn.classList.toggle('is-disabled', !allOk);
        }
        window.crmCreateUpdateSubmitState = crmCreateUpdateSubmitState;
        window.crmCreateTogglePriority = function () {
            var hp = document.getElementById('crmTaskHighPriority');
            if (!hp) return;
            hp.checked = !hp.checked;
            crmCreateRefreshLabels();
        };
        window.crmCreateClearFecha = function () {
            var dd = document.getElementById('crmTaskDueDate');
            if (dd) dd.value = '';
            crmCreateRefreshLabels();
            crmCreateCloseAllPops();
        };

        // ── Adjuntar archivos al crear tarea ──
        var _crmCreateFiles = [];
        function _crmCreateFormatSize(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / 1024 / 1024).toFixed(1) + ' MB';
        }
        function _crmCreateRenderFiles() {
            var preview = document.getElementById('crmCreateFilesPreview');
            var btn = document.getElementById('crmCreateAttachBtn');
            var count = document.getElementById('crmCreateAttachCount');
            if (!preview) return;
            if (_crmCreateFiles.length === 0) {
                preview.innerHTML = '';
                preview.style.display = 'none';
                if (btn) btn.classList.remove('has-files');
                if (count) { count.style.display = 'none'; count.textContent = ''; }
                return;
            }
            preview.style.display = 'flex';
            preview.innerHTML = _crmCreateFiles.map(function (f, i) {
                var nm = f.name.length > 32 ? f.name.slice(0, 28) + '…' + f.name.split('.').pop() : f.name;
                return '<div class="crm-ctw-file-chip">' +
                    '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>' +
                    '<span class="crm-ctw-file-chip-name" title="' + f.name + '">' + nm + '</span>' +
                    '<span class="crm-ctw-file-chip-size">' + _crmCreateFormatSize(f.size) + '</span>' +
                    '<button type="button" class="crm-ctw-file-chip-rm" onclick="crmCreateRemoveFile(' + i + ')" title="Quitar">' +
                        '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
                    '</button>' +
                '</div>';
            }).join('');
            if (btn) btn.classList.add('has-files');
            if (count) { count.style.display = ''; count.textContent = _crmCreateFiles.length; }
        }
        window.crmCreateOnFilesPicked = function (inp) {
            if (!inp || !inp.files) return;
            for (var i = 0; i < inp.files.length; i++) {
                _crmCreateFiles.push(inp.files[i]);
            }
            inp.value = ''; // permite re-seleccionar el mismo archivo
            _crmCreateRenderFiles();
        };
        window.crmCreateRemoveFile = function (idx) {
            _crmCreateFiles.splice(idx, 1);
            _crmCreateRenderFiles();
        };
        window._crmCreateGetFiles = function () { return _crmCreateFiles.slice(); };
        window._crmCreateClearFiles = function () { _crmCreateFiles = []; _crmCreateRenderFiles(); };
        // Permite empujar archivos al buffer sin pasar por el <input type=file>
        // (lo usan los handlers invisibles de paste/drop en la descripción).
        window._crmCreateAddFile = function (f) {
            if (!f) return;
            _crmCreateFiles.push(f);
            _crmCreateRenderFiles();
        };

        // ── Header: fetch nombre de oportunidad (si oppId presente) ──
        window.crmCreateUpdateOppLabel = function () {
            var oppIdEl = document.getElementById('crmTaskOppId');
            var label = document.getElementById('crmCreateProjectName');
            if (!label) return;
            var oppId = oppIdEl ? (oppIdEl.value || '') : '';
            if (!oppId) {
                label.textContent = 'Sin oportunidad';
                return;
            }
            label.textContent = 'Cargando…';
            fetch('/app/api/oportunidad/' + oppId + '/detalle/')
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (data) {
                    if (data && data.oportunidad) label.textContent = data.oportunidad;
                    else label.textContent = 'Oportunidad #' + oppId;
                })
                .catch(function () { label.textContent = 'Oportunidad #' + oppId; });
        };

        // Close create modal on outside click + ⌘/Ctrl+Enter para enviar
        var createModal = document.getElementById('crmCreateTaskModal');
        if (createModal) {
            createModal.addEventListener('click', function (e) {
                if (e.target === createModal) crmTaskCerrarCrear();
            });
            createModal.addEventListener('keydown', function (e) {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (typeof crmTaskCrear === 'function') crmTaskCrear();
                } else if (e.key === 'Escape') {
                    crmTaskCerrarCrear();
                }
            });
        }

        // Cap fecha límite de tarea a las 18:00 + refrescar label del composer
        var dueDateInp = document.getElementById('crmTaskDueDate');
        if (dueDateInp) {
            dueDateInp.addEventListener('change', function () {
                if (this.value) {
                    var parts = this.value.split('T');
                    if (parts.length === 2 && parts[1] > '18:00') {
                        this.value = parts[0] + 'T18:00';
                    }
                }
                if (typeof crmCreateRefreshLabels === 'function') crmCreateRefreshLabels();
            });
            dueDateInp.addEventListener('input', function () {
                if (typeof crmCreateRefreshLabels === 'function') crmCreateRefreshLabels();
            });
        }

        // Assignment tabs in create modal
        document.querySelectorAll('.crm-create-task-assign-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.crm-create-task-assign-tab').forEach(function (t) { t.classList.remove('active'); });
                document.querySelectorAll('.crm-create-task-assign-panel').forEach(function (p) { p.classList.remove('active'); });
                tab.classList.add('active');
                var panel = document.getElementById(tab.getAttribute('data-panel'));
                if (panel) panel.classList.add('active');
            });
        });

        // User search for assignments
        var _crmTaskUsers = [];
        var _crmTaskSelectedResp = null;
        var _crmTaskSelectedParts = [];
        var _crmTaskSelectedObs = [];

        function crmTaskSearchUsers(query, callback) {
            // No cacheamos para asegurar que siempre traiga los resultados más recientes y no se pierdan usuarios por límites previos.
            fetch('/app/api/buscar-usuarios/?q=' + encodeURIComponent(query))
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    _crmTaskUsers = data.usuarios || data.results || [];
                    callback(_crmTaskUsers);
                })
                .catch(function () { callback([]); });
        }

        function _crmBuildUserDropdown(users, inputEl, onSelect) {
            var existing = document.querySelector('.crm-user-dropdown');
            if (existing) existing.remove();
            if (users.length === 0) return;

            var dropdown = document.createElement('div');
            dropdown.className = 'crm-user-dropdown';
            // Position fixed below input to bypass overflow:hidden parents
            var rect = inputEl.getBoundingClientRect();
            dropdown.style.cssText = 'position:fixed;top:' + (rect.bottom + 3) + 'px;left:' + rect.left + 'px;width:' + Math.max(rect.width, 220) + 'px;z-index:99999;';

            users.forEach(function (u) {
                var item = document.createElement('div');
                item.className = 'crm-user-dropdown-item';
                var initials = u.iniciales || (u.nombre || u.username || '?')[0].toUpperCase();
                item.innerHTML = '<span class="crm-user-avatar-sm">' + initials + '</span><span>' + (u.nombre || u.username) + '</span>';
                item.onmousedown = function (e) {
                    e.preventDefault(); // prevent blur before click fires
                    dropdown.remove();
                    if (inputEl) inputEl.value = '';
                    onSelect(u);
                };
                dropdown.appendChild(item);
            });

            document.body.appendChild(dropdown);

            function closeDropdown(e) {
                if (!dropdown.contains(e.target) && e.target !== inputEl) {
                    dropdown.remove();
                    document.removeEventListener('click', closeDropdown);
                }
            }
            setTimeout(function () { document.addEventListener('click', closeDropdown); }, 0);
        }

        // Responsible search
        var respSearch = document.getElementById('crmTaskResponsibleSearch');
        if (respSearch) {
            respSearch.addEventListener('input', function () {
                var q = this.value.trim();
                if (q.length < 1) { var dd = document.querySelector('.crm-user-dropdown'); if (dd) dd.remove(); return; }
                crmTaskSearchUsers(q, function (users) {
                    var container = document.getElementById('crmTaskSelectedResponsible');
                    if (!container) return;
                    _crmBuildUserDropdown(users, respSearch, function (u) {
                        _crmTaskSelectedResp = u;
                        var chip = document.createElement('div');
                        chip.className = 'crm-user-chip';
                        var initials = u.iniciales || (u.nombre || u.username || '?')[0].toUpperCase();
                        chip.innerHTML = '<span class="crm-user-avatar-sm">' + initials + '</span><span>' + (u.nombre || u.username) + '</span><button type="button" class="crm-chip-remove">&times;</button>';
                        chip.querySelector('.crm-chip-remove').onclick = function () { _crmTaskSelectedResp = null; chip.remove(); crmCreateRefreshLabels(); };
                        var prevChip = container.querySelector('.crm-user-chip'); if (prevChip) prevChip.remove();
                        container.appendChild(chip);
                        crmCreateRefreshLabels();
                    });
                });
            });
        }

        // Participants search
        var partsSearch = document.getElementById('crmTaskParticipantsSearch');
        if (partsSearch) {
            partsSearch.addEventListener('input', function () {
                var q = this.value.trim();
                if (q.length < 1) { var dd = document.querySelector('.crm-user-dropdown'); if (dd) dd.remove(); return; }
                crmTaskSearchUsers(q, function (users) {
                    var container = document.getElementById('crmTaskSelectedParticipants');
                    if (!container) return;
                    var available = users.filter(function (u) { return !_crmTaskSelectedParts.some(function (p) { return p.id === u.id; }); });
                    _crmBuildUserDropdown(available, partsSearch, function (u) {
                        _crmTaskSelectedParts.push(u);
                        var chip = document.createElement('div');
                        chip.className = 'crm-user-chip';
                        var initials = u.iniciales || (u.nombre || u.username || '?')[0].toUpperCase();
                        chip.innerHTML = '<span class="crm-user-avatar-sm">' + initials + '</span><span>' + (u.nombre || u.username) + '</span><button type="button" class="crm-chip-remove">&times;</button>';
                        chip.querySelector('.crm-chip-remove').onclick = function () { _crmTaskSelectedParts = _crmTaskSelectedParts.filter(function (p) { return p.id !== u.id; }); chip.remove(); crmCreateRefreshLabels(); };
                        container.appendChild(chip);
                        crmCreateRefreshLabels();
                    });
                });
            });
        }

        // Observers search
        var obsSearch = document.getElementById('crmTaskObserversSearch');
        if (obsSearch) {
            obsSearch.addEventListener('input', function () {
                var q = this.value.trim();
                if (q.length < 1) { var dd = document.querySelector('.crm-user-dropdown'); if (dd) dd.remove(); return; }
                crmTaskSearchUsers(q, function (users) {
                    var container = document.getElementById('crmTaskSelectedObservers');
                    if (!container) return;
                    var available = users.filter(function (u) { return !_crmTaskSelectedObs.some(function (o) { return o.id === u.id; }); });
                    _crmBuildUserDropdown(available, obsSearch, function (u) {
                        _crmTaskSelectedObs.push(u);
                        var chip = document.createElement('div');
                        chip.className = 'crm-user-chip';
                        var initials = u.iniciales || (u.nombre || u.username || '?')[0].toUpperCase();
                        chip.innerHTML = '<span class="crm-user-avatar-sm">' + initials + '</span><span>' + (u.nombre || u.username) + '</span><button type="button" class="crm-chip-remove">&times;</button>';
                        chip.querySelector('.crm-chip-remove').onclick = function () { _crmTaskSelectedObs = _crmTaskSelectedObs.filter(function (o) { return o.id !== u.id; }); chip.remove(); crmCreateRefreshLabels(); };
                        container.appendChild(chip);
                        crmCreateRefreshLabels();
                    });
                });
            });
        }

        // Listener en el title input: revalida al escribir
        (function attachTitleListener() {
            document.addEventListener('input', function (e) {
                if (e.target && e.target.id === 'crmTaskTitleInput') {
                    if (typeof crmCreateUpdateSubmitState === 'function') crmCreateUpdateSubmitState();
                }
            });
            // El input datetime-local también debe refrescar al cambiar
            document.addEventListener('change', function (e) {
                if (e.target && e.target.id === 'crmTaskDueDate') {
                    if (typeof crmCreateRefreshLabels === 'function') crmCreateRefreshLabels();
                }
            });
        })();

        function crmTaskCrear() {
            var titulo = (document.getElementById('crmTaskTitleInput') || {}).value || '';
            var dueDateEl = document.getElementById('crmTaskDueDate');
            var hasDate = dueDateEl && dueDateEl.value;
            // Validación visible: cualquier required vacío hace shake + error toast
            var missing = [];
            if (!titulo.trim()) missing.push('título');
            if (!_crmTaskSelectedResp) {
                missing.push('responsable');
                var rb = document.getElementById('crmCreateRespBtn');
                if (rb) { rb.classList.add('is-missing'); setTimeout(function(){ rb.classList.remove('is-missing'); }, 600); }
            }
            if (!hasDate) {
                missing.push('fecha');
                var fb = document.getElementById('crmCreateFechaBtn');
                if (fb) { fb.classList.add('is-missing'); setTimeout(function(){ fb.classList.remove('is-missing'); }, 600); }
            }
            if (missing.length) {
                showToast('Falta llenar: ' + missing.join(', '), 'error');
                return;
            }

            var descEditor = document.getElementById('crmTaskDescEditor');
            var descripcion = '';
            if (descEditor) {
                // Soporta tanto textarea (composer nuevo) como contenteditable (legacy)
                descripcion = (descEditor.value !== undefined)
                    ? descEditor.value
                    : (descEditor.innerText || descEditor.textContent || '');
            }
            var highPriority = (document.getElementById('crmTaskHighPriority') || {}).checked;
            var dueDate = (document.getElementById('crmTaskDueDate') || {}).value || '';

            var payload = {
                nombre: titulo.trim(),
                descripcion: descripcion.trim(),
                prioridad: highPriority ? 'alta' : 'media'
            };
            if (dueDate) payload.fecha_limite = dueDate;
            if (_crmTaskSelectedResp) payload.asignado_a = _crmTaskSelectedResp.id;
            if (_crmTaskSelectedParts.length > 0) payload.participantes = _crmTaskSelectedParts.map(function (u) { return u.id; });
            if (_crmTaskSelectedObs.length > 0) payload.observadores = _crmTaskSelectedObs.map(function (u) { return u.id; });
            var oppIdEl = document.getElementById('crmTaskOppId');
            if (oppIdEl && oppIdEl.value) payload.oportunidad_id = oppIdEl.value;
            var padreIdEl = document.getElementById('crmTaskPadreId');
            if (padreIdEl && padreIdEl.value) payload.tarea_padre_id = padreIdEl.value;

            var submitBtn = document.getElementById('crmTaskSubmitBtn');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creando...'; }

            fetch('/app/api/crear-tarea/', {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrf()
                }
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Crear tarea'; }
                    if (data.success) {
                        var oppId = oppIdEl ? oppIdEl.value : '';
                        var padreId = padreIdEl ? padreIdEl.value : '';
                        // Subir archivos adjuntos (si hay) como comentario inicial con files
                        var pendingFiles = (typeof window._crmCreateGetFiles === 'function') ? window._crmCreateGetFiles() : [];
                        if (pendingFiles.length > 0 && data.id) {
                            var fd = new FormData();
                            fd.append('contenido', '📎 Archivos adjuntos al crear la tarea');
                            pendingFiles.forEach(function (f, i) { fd.append('archivo_' + i, f); });
                            fetch('/app/api/tarea/' + data.id + '/comentarios/agregar/', {
                                method: 'POST',
                                headers: { 'X-CSRFToken': getCsrf() },
                                body: fd
                            }).catch(function () {
                                showToast('Tarea creada, pero algunos archivos no se subieron', 'warning');
                            });
                        }
                        crmTaskCerrarCrear();
                        recargarTareasCRM();
                        showToast(padreId ? 'Subtarea creada exitosamente' : 'Tarea creada exitosamente', 'success');
                        // Refresh parent task detail if subtask was created
                        if (padreId && typeof crmTaskVerDetalle === 'function') {
                            crmTaskVerDetalle(parseInt(padreId));
                        }
                        if (typeof dashRefreshData === 'function') { dashRefreshData(); }
                        if (oppId && typeof window.woCargarTareasInline === 'function') {
                            window.woCargarTareasInline(oppId);
                        }
                        if (oppId && typeof refreshCrmTable === 'function') {
                            refreshCrmTable();
                        }
                        // Añadir al calendario como evento naranja si tiene fecha_limite
                        if (dueDate && typeof _globalCalendar !== 'undefined' && _globalCalendar) {
                            _globalCalendar.addEvent({
                                id: 'tarea-' + (data.id || Date.now()),
                                title: titulo.trim(),
                                start: dueDate,
                                color: '#FF9500',
                                extendedProps: { tipo_actividad: 'tarea', tarea_id: data.id }
                            });
                        }
                    } else {
                        showToast(data.error || 'Error al crear la tarea', 'error');
                    }
                })
                .catch(function (err) {
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Crear tarea'; }
                    console.error('Error creando tarea:', err);
                    showToast('Error al crear la tarea. Intenta recargar la página.', 'error');
                });
        }


        window.refreshCrmTable = refreshCrmTable;
        window.recargarTareasCRM = recargarTareasCRM;

        // Expose to global scope for inline onclick handlers
        window.crmTaskVerDetalle = crmTaskVerDetalle;
        window.crmTaskRenderData = crmTaskRenderData;
        window.crmTaskCerrarModal = crmTaskCerrarModal;
        window.crmTaskToggleTimer = crmTaskToggleTimer;
        window.crmTaskMakeEditable = crmTaskMakeEditable;
        function crmTaskToggleDesc() {
            var descEl = document.getElementById('crm-task-descripcion');
            var toggleBtn = document.getElementById('crm-task-desc-toggle');
            if (!descEl || !toggleBtn) return;
            var isCollapsed = descEl.classList.contains('collapsed');
            if (isCollapsed) {
                descEl.classList.remove('collapsed');
                toggleBtn.textContent = 'Mostrar menos';
            } else {
                descEl.classList.add('collapsed');
                toggleBtn.textContent = 'Mostrar más';
            }
        }
        window.crmTaskToggleDesc = crmTaskToggleDesc;

        function crmTaskCrearSubtarea() {
            var padreId = _crmCurrentTaskId;
            if (!padreId) return;
            crmTaskAbrirCrear();
            var padreEl = document.getElementById('crmTaskPadreId');
            if (padreEl) padreEl.value = padreId;
        }

        window.crmTaskCrearSubtarea = crmTaskCrearSubtarea;

        // Variante que acepta el id desde la fila de lista (no requiere tener el detalle abierto)
        window.crmTaskCrearSubtareaDesdeFila = function(padreId) {
            if (!padreId) return;
            crmTaskAbrirCrear();
            // Pequeño delay para asegurar que el modal esté montado y el input exista
            setTimeout(function(){
                var padreEl = document.getElementById('crmTaskPadreId');
                if (padreEl) padreEl.value = padreId;
            }, 50);
        };
        window.crmTaskAbrirCrear = crmTaskAbrirCrear;
        window.crmTaskCerrarCrear = crmTaskCerrarCrear;
        window.crmTaskCrear = crmTaskCrear;
        window.crmTaskCompletar = crmTaskCompletar;
        window.crmTaskReabrir = crmTaskReabrir;
        window.crmTaskReabrirConfirmar = crmTaskReabrirConfirmar;
        window.crmTaskAbrirOportunidad = crmTaskAbrirOportunidad;
        window.crmTaskAbrirDrive = crmTaskAbrirDrive;
        window.crmTaskGuardar = crmTaskGuardar;
        window.crmTaskCancelarEdicion = crmTaskCancelarEdicion;
        window.crmTaskRemoverInvolucrado = crmTaskRemoverInvolucrado;
        window.crmTaskAgregarInvolucrado = crmTaskAgregarInvolucrado;
        window.crmTaskEditarTitulo = crmTaskEditarTitulo;
        window.crmTaskEditarFechaLimite = crmTaskEditarFechaLimite;
        window.crmTaskEditarResponsable = crmTaskEditarResponsable;
        window.crmTaskEditarCliente = crmTaskEditarCliente;
        window.crmTaskEditarDescripcion = crmTaskEditarDescripcion;
        window.crmCommentToggleMenu = crmCommentToggleMenu;
        window.crmCommentEditar = crmCommentEditar;
        window.crmCommentEliminar = crmCommentEliminar;
        window.crmCommentConfirmCancel = crmCommentConfirmCancel;
        window.crmTaskResponsableModalFecha = crmTaskResponsableModalFecha;

    });


    // Migrado a crmReady (Turbo-friendly).
    window.crmReady(initDynamicIslandFilters);

    function initDynamicIslandFilters() {
        // Identify active table body
        var activeTbody = null;
        if (document.getElementById('crmTbody')) activeTbody = document.getElementById('crmTbody');
        else if (document.getElementById('clientesTbody')) activeTbody = document.getElementById('clientesTbody');

        if (!activeTbody) return;

        // Get filter elements (filters panel removed, these return null safely)
        var fCliente = null;
        var fContacto = null;
        var fArea = null;
        var fProducto = null;
        var fMonto = null;
        var btnClear = document.getElementById('btnClearIslandFilters');

        // Store original rows for sorting/resetting
        var originalRows = Array.from(activeTbody.querySelectorAll('tr'));

        // Extract unique values
        var clientes = new Set();
        var contactos = new Set();
        var areas = new Set();
        var productos = new Set();

        originalRows.forEach(function (row) {
            if (row.dataset.cliente && row.dataset.cliente !== '- Sin Cliente -') clientes.add(row.dataset.cliente);
            if (row.dataset.contacto && row.dataset.contacto !== '-') contactos.add(row.dataset.contacto);
            if (row.dataset.area && row.dataset.area !== '-') areas.add(row.dataset.area);
            if (row.dataset.producto) productos.add(row.dataset.producto);
        });

        // Populate Selects
        function populateSelect(select, values, label) {
            if (!select) return;
            // Keep first option (placeholder)
            var first = select.firstElementChild;
            select.innerHTML = '';
            ect.appendChild(first);

            Array.from(values).sort().forEach(function (val) {
                var opt = document.createElement('option');
                opt.value = val;
                opt.textContent = val;
                select.appendChild(opt);
            });
        }

        populateSelect(fCliente, clientes);
        populateSelect(fContacto, contactos);
        populateSelect(fArea, areas);
        populateSelect(fProducto, productos);

        // Filter Function
        function applyFilters() {
            var vCliente = fCliente ? fCliente.value : '';
            var vContacto = fContacto ? fContacto.value : '';
            var vArea = fArea ? fArea.value : '';
            var vProducto = fProducto ? fProducto.value : '';
            var vMonto = fMonto ? fMonto.value : '';

            var visibleRows = [];
            var hiddenRows = [];

            originalRows.forEach(function (row) {
                var show = true;
                if (vCliente && row.dataset.cliente !== vCliente) show = false;
                if (vContacto && row.dataset.contacto !== vContacto) show = false;
                if (vArea && row.dataset.area !== vArea) show = false;
                if (vProducto && row.dataset.producto !== vProducto) show = false;

                row.style.display = show ? '' : 'none';
                if (show) visibleRows.push(row);
                else hiddenRows.push(row);
            });

            // Apply Sorting if Monto is selected
            if (vMonto && (vMonto === 'asc' || vMonto === 'desc')) {
                visibleRows.sort(function (a, b) {
                    var ma = parseFloat(a.dataset.monto || 0);
                    var mb = parseFloat(b.dataset.monto || 0);
                    return vMonto === 'desc' ? mb - ma : ma - mb;
                });

                // Re-append rows in new order
                // Note: This removes them from their current position and appends them
                // We must be careful not to lose the hidden rows
                activeTbody.innerHTML = '';
                visibleRows.forEach(function (r) { activeTbody.appendChild(r); });
                hiddenRows.forEach(function (r) { activeTbody.appendChild(r); });
            } else {
                // If no sort, restore original order of visible rows? 
                // Currently they are in original order because we iterated originalRows
            }
        }

        // Add Event Listeners
        if (fCliente) fCliente.addEventListener('change', applyFilters);
        if (fContacto) fContacto.addEventListener('change', applyFilters);
        if (fArea) fArea.addEventListener('change', applyFilters);
        if (fProducto) fProducto.addEventListener('change', applyFilters);
        if (fMonto) fMonto.addEventListener('change', applyFilters);

        if (btnClear) {
            btnClear.addEventListener('click', function () {
                if (fCliente) fCliente.value = '';
                if (fContacto) fContacto.value = '';
                if (fArea) fArea.value = '';
                if (fProducto) fProducto.value = '';
                if (fMonto) fMonto.value = '';

                activeTbody.innerHTML = '';
                originalRows.forEach(function (row) {
                    row.style.display = '';
                    activeTbody.appendChild(row);
                });
            });
        }
    }

    // ═══ EMPLEADOS WIDGET — SUPERVISOR ONLY ═══
    var _empCurrentMes = null, _empCurrentAnio = null;
    var _EMP_MES_NOMBRES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    function empleadosAbrir() {
        var overlay = document.getElementById('widgetEmpleados');
        if (!overlay) return;
        var topbarMes = document.getElementById('mesFilter');
        var topbarAnio = document.getElementById('anioFilter');
        if (topbarMes) {
            var mv = parseInt(topbarMes.value, 10);
            if (mv >= 1 && mv <= 12) _empCurrentMes = mv;
        }
        if (topbarAnio) _empCurrentAnio = parseInt(topbarAnio.value, 10) || new Date().getFullYear();
        if (!_empCurrentMes) _empCurrentMes = new Date().getMonth() + 1;
        if (!_empCurrentAnio) _empCurrentAnio = new Date().getFullYear();
        empInitDatePicker();
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        empCargarDatos();
    }
    window.empleadosAbrir = empleadosAbrir;

    function empCerrar() {
        var overlay = document.getElementById('widgetEmpleados');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    window.empCerrar = empCerrar;

    function empInitDatePicker() {
        var mesOpts = document.getElementById('empMesOpts');
        var anioOpts = document.getElementById('empAnioOpts');
        var label = document.getElementById('empDatePickerLabel');
        if (!mesOpts || !anioOpts) return;
        var mHtml = '';
        for (var m = 1; m <= 12; m++) {
            var mActive = m === _empCurrentMes ? 'background:#F0F4FF;color:#007AFF;font-weight:700;' : 'color:#1D1D1F;';
            mHtml += '<div style="padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.72rem;' + mActive + '"'
                + ' onclick="empSelectMes(' + m + ')">' + _EMP_MES_NOMBRES[m] + '</div>';
        }
        mesOpts.innerHTML = mHtml;
        var now = new Date();
        var aHtml = '';
        for (var y = now.getFullYear(); y >= now.getFullYear() - 3; y--) {
            var yActive = y === _empCurrentAnio ? 'background:#F0F4FF;color:#007AFF;font-weight:700;' : 'color:#1D1D1F;';
            aHtml += '<div style="padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.72rem;' + yActive + '"'
                + ' onclick="empSelectAnio(' + y + ')">' + y + '</div>';
        }
        anioOpts.innerHTML = aHtml;
        if (label) label.textContent = (_empCurrentMes ? _EMP_MES_NOMBRES[_empCurrentMes] : '—') + ' ' + (_empCurrentAnio || '—');
        var mesInp = document.getElementById('empMesFilter');
        var anioInp = document.getElementById('empAnioFilter');
        if (mesInp) mesInp.value = _empCurrentMes || '';
        if (anioInp) anioInp.value = _empCurrentAnio || '';
    }
    window.empInitDatePicker = empInitDatePicker;

    function empToggleDatePicker(ev) {
        if (ev) ev.stopPropagation();
        var dd = document.getElementById('empDatePickerDropdown');
        if (!dd) return;
        dd.style.display = dd.style.display === 'none' ? '' : 'none';
    }
    window.empToggleDatePicker = empToggleDatePicker;

    function empSelectMes(m) {
        _empCurrentMes = m;
        var dd = document.getElementById('empDatePickerDropdown');
        if (dd) dd.style.display = 'none';
        empInitDatePicker();
        empCargarDatos();
    }
    window.empSelectMes = empSelectMes;

    function empSelectAnio(y) {
        _empCurrentAnio = y;
        var dd = document.getElementById('empDatePickerDropdown');
        if (dd) dd.style.display = 'none';
        empInitDatePicker();
        empCargarDatos();
    }
    window.empSelectAnio = empSelectAnio;

    function empCargarDatos() {
        var mes = document.getElementById('empMesFilter');
        var anio = document.getElementById('empAnioFilter');
        var content = document.getElementById('empContent');
        if (!mes || !anio || !content) return;
        content.innerHTML = '<div style="text-align:center;padding:3rem;color:#8E8E93;font-size:0.85rem;">Cargando...</div>';
        fetch('/app/api/empleados/jornadas/?mes=' + mes.value + '&anio=' + anio.value)
            .then(function (r) { return r.json(); })
            .then(function (data) { empRenderDatos(data); })
            .catch(function () {
                content.innerHTML = '<div style="color:#FF3B30;padding:2rem;text-align:center;">Error cargando datos</div>';
            });
    }
    window.empCargarDatos = empCargarDatos;

    function empRenderDatos(data) {
        var content = document.getElementById('empContent');
        if (!content) return;
        var mesNom = _EMP_MES_NOMBRES[data.mes] || data.mes;
        var now = new Date();
        var isCurrentMonth = (data.mes === (now.getMonth() + 1) && data.anio === now.getFullYear());
        if (!data.empleados || data.empleados.length === 0) {
            content.innerHTML = '<div style="text-align:center;padding:3rem;color:#8E8E93;">Sin empleados activos</div>';
            return;
        }
        var colSpan = isCurrentMonth ? 6 : 5;
        var h = '<div style="font-size:0.72rem;font-weight:700;color:#8E8E93;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.06em;">'
            + mesNom + ' ' + data.anio + '</div>';
        h += '<table class="adm-table"><thead><tr>'
            + '<th style="text-align:left;">Empleado</th>'
            + '<th style="text-align:center;">Días</th>'
            + '<th style="text-align:center;">Horas Tot.</th>'
            + '<th style="text-align:center;">Efic. Prom.</th>';
        if (isCurrentMonth) h += '<th style="text-align:center;">Estado Hoy</th>';
        h += '<th></th></tr></thead><tbody>';

        data.empleados.forEach(function (emp) {
            var diasEntries = Object.entries(emp.dias).sort(function (a, b) { return parseInt(a[0]) - parseInt(b[0]); });
            var numDias = diasEntries.length;
            var totalHoras = 0, totalEfic = 0;
            diasEntries.forEach(function (e) { totalHoras += e[1].horas; totalEfic += e[1].eficiencia; });
            var avgEfic = numDias > 0 ? totalEfic / numDias : 0;
            var efColor = avgEfic >= 80 ? '#34C759' : avgEfic >= 50 ? '#FF9500' : avgEfic > 0 ? '#FF3B30' : '#8E8E93';
            var efText = numDias > 0 ? Math.round(avgEfic) + '%' : '&mdash;';
            var estadoTd = '';
            if (isCurrentMonth) {
                var est = emp.estado_hoy;
                if (est === 'activo') {
                    estadoTd = '<td style="text-align:center;"><span style="background:#E8F8ED;color:#34C759;font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:20px;">Activo</span></td>';
                } else if (est === 'pausa') {
                    estadoTd = '<td style="text-align:center;"><span style="background:#FFF5E6;color:#FF9500;font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:20px;">Pausa</span></td>';
                } else if (est === 'inactivo') {
                    estadoTd = '<td style="text-align:center;"><span style="background:#FFF0F0;color:#FF3B30;font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:20px;">Inactivo</span></td>';
                } else {
                    estadoTd = '<td style="text-align:center;color:#C7C7CC;font-size:0.8rem;">&mdash;</td>';
                }
            }
            h += '<tr style="cursor:pointer;" onclick="empToggleDetalle(' + emp.id + ')">'
                + '<td><strong>' + emp.nombre + '</strong></td>'
                + '<td style="text-align:center;">' + numDias + '</td>'
                + '<td style="text-align:center;">' + totalHoras.toFixed(1) + 'h</td>'
                + '<td style="text-align:center;color:' + efColor + ';font-weight:700;">' + efText + '</td>'
                + estadoTd
                + '<td style="text-align:center;font-size:0.7rem;color:#8E8E93;">&#9660;</td>'
                + '</tr>';

            h += '<tr id="empDetalle_' + emp.id + '" style="display:none;"><td colspan="' + colSpan + '" style="padding:0;">'
                + '<div style="padding:6px 12px 10px;background:#F9FAFB;border-top:1px solid #F2F2F7;">';
            if (diasEntries.length === 0) {
                h += '<span style="color:#8E8E93;font-size:0.72rem;">Sin registros este mes</span>';
            } else {
                h += '<table style="width:100%;font-size:0.68rem;border-collapse:collapse;">'
                    + '<thead><tr style="color:#8E8E93;"><th style="text-align:left;padding:2px 8px;">Fecha</th>'
                    + '<th style="text-align:right;padding:2px 8px;">Horas</th>'
                    + '<th style="text-align:right;padding:2px 8px;">Eficiencia</th></tr></thead><tbody>';
                diasEntries.forEach(function (entry) {
                    var d = entry[1];
                    var ef = Math.round(d.eficiencia);
                    var efc = ef >= 80 ? '#34C759' : ef >= 50 ? '#FF9500' : '#FF3B30';
                    var dStr = String(entry[0]).padStart(2, '0') + '/' + String(data.mes).padStart(2, '0') + '/' + data.anio;
                    h += '<tr style="border-bottom:1px solid #F2F2F7;">'
                        + '<td style="padding:3px 8px;">' + dStr + '</td>'
                        + '<td style="text-align:right;padding:3px 8px;">' + d.horas.toFixed(1) + 'h</td>'
                        + '<td style="text-align:right;padding:3px 8px;color:' + efc + ';font-weight:700;">' + ef + '%</td>'
                        + '</tr>';
                });
                h += '</tbody></table>';
            }
            h += '</div></td></tr>';
        });

        h += '</tbody></table>';
        content.innerHTML = h;
    }
    window.empRenderDatos = empRenderDatos;

    function empToggleDetalle(uid) {
        var row = document.getElementById('empDetalle_' + uid);
        if (!row) return;
        row.style.display = row.style.display === 'none' ? '' : 'none';
    }
    window.empToggleDetalle = empToggleDetalle;

    document.addEventListener('click', function (e) {
        var wrap = document.getElementById('empPickerWrap');
        if (wrap && !wrap.contains(e.target)) {
            var dd = document.getElementById('empDatePickerDropdown');
            if (dd) dd.style.display = 'none';
        }
    });

    // ═══ COTIZAR RÁPIDO (legacy — el widget composer lo define ahora en _widget_cotizar_rapido.html) ═══
    var _crClientes = [];

    function cotizarRapidoAbrir() {
        var overlay = document.getElementById('widgetCotizarRapido');
        if (!overlay) return;
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        crCargarClientes();
    }
    // No sobrescribir si el widget composer ya definió su propia versión
    if (!window.cotizarRapidoAbrir) window.cotizarRapidoAbrir = cotizarRapidoAbrir;

    function cotizarRapidoCerrar() {
        var overlay = document.getElementById('widgetCotizarRapido');
        if (overlay) {
            overlay.classList.add('closing');
            setTimeout(function () { overlay.classList.remove('active', 'closing'); }, 220);
        }
        document.body.style.overflow = '';
        var inp = document.getElementById('crClienteInput');
        if (inp) inp.value = '';
        var cid = document.getElementById('crClienteId');
        if (cid) cid.value = '';
        var dd = document.getElementById('crClienteDropdown');
        if (dd) { dd.innerHTML = ''; dd.classList.remove('open'); }
        var secCl = document.getElementById('crNuevoClienteSection');
        if (secCl) secCl.style.display = 'none';
        var oppSel = document.getElementById('crOppSelect');
        if (oppSel) { oppSel.innerHTML = '<option value="">— seleccionar oportunidad —</option>'; oppSel.disabled = true; }
        var sec = document.getElementById('crNuevaOppSection');
        if (sec) sec.style.display = 'none';
        var goBtn = document.getElementById('crGoBtn');
        if (goBtn) { goBtn.disabled = true; goBtn.style.opacity = '0.5'; goBtn.style.cursor = 'not-allowed'; }
    }
    if (!window.cotizarRapidoCerrar) window.cotizarRapidoCerrar = cotizarRapidoCerrar;

    function crCargarClientes() {
        fetch('/app/api/cotizar-rapido/clientes/')
            .then(function (r) { return r.json(); })
            .then(function (data) { _crClientes = data.clientes || []; });
    }
    window.crCargarClientes = crCargarClientes;

    function crFiltrarClientes() {
        var inp = document.getElementById('crClienteInput');
        var dd = document.getElementById('crClienteDropdown');
        var cid = document.getElementById('crClienteId');
        var q = inp ? inp.value.trim().toLowerCase() : '';
        if (cid) cid.value = '';
        // Reset opps when client changes
        var oppSel = document.getElementById('crOppSelect');
        if (oppSel) { oppSel.innerHTML = '<option value="">— seleccionar —</option>'; oppSel.disabled = true; }
        var goBtn = document.getElementById('crGoBtn');
        if (goBtn) { goBtn.disabled = true; goBtn.style.opacity = '0.5'; goBtn.style.cursor = 'not-allowed'; }
        if (!dd) return;
        if (!q) { dd.innerHTML = ''; dd.classList.remove('open'); return; }
        var filtered = _crClientes.filter(function (c) { return c.nombre.toLowerCase().indexOf(q) >= 0; }).slice(0, 12);
        if (filtered.length === 0) {
            dd.innerHTML = '<div class="wf-ac-item" style="color:#8E8E93;cursor:default;">Sin resultados</div>';
        } else {
            dd.innerHTML = filtered.map(function (c) {
                return '<div class="wf-ac-item" onmousedown="crSelectCliente(' + c.id + ',\'' + c.nombre.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">'
                    + c.nombre + '</div>';
            }).join('');
        }
        dd.classList.add('open');
    }
    window.crFiltrarClientes = crFiltrarClientes;

    function crSelectCliente(id, nombre) {
        var inp = document.getElementById('crClienteInput');
        var cid = document.getElementById('crClienteId');
        var dd = document.getElementById('crClienteDropdown');
        if (inp) inp.value = nombre;
        if (cid) cid.value = id;
        if (dd) { dd.innerHTML = ''; dd.classList.remove('open'); }
        var oppSel = document.getElementById('crOppSelect');
        if (oppSel) {
            oppSel.disabled = false;
            oppSel.innerHTML = '<option value="">Cargando...</option>';
            fetch('/app/api/cotizar-rapido/oportunidades/?cliente_id=' + id)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    oppSel.innerHTML = '<option value="">— seleccionar oportunidad —</option>';
                    (data.opps || []).forEach(function (o) {
                        oppSel.innerHTML += '<option value="' + o.id + '">' + o.nombre + '</option>';
                    });
                });
        }
    }
    window.crSelectCliente = crSelectCliente;

    function crOppChanged() {
        var oppSel = document.getElementById('crOppSelect');
        var goBtn = document.getElementById('crGoBtn');
        if (goBtn) {
            var hasVal = oppSel && oppSel.value;
            goBtn.disabled = !hasVal;
            goBtn.style.opacity = hasVal ? '1' : '0.5';
            goBtn.style.cursor = hasVal ? 'pointer' : 'not-allowed';
        }
    }
    window.crOppChanged = crOppChanged;

    function crToggleNuevoCliente() {
        var sec = document.getElementById('crNuevoClienteSection');
        if (!sec) return;
        var isOpen = sec.style.display !== 'none';
        sec.style.display = isOpen ? 'none' : '';
        if (isOpen) {
            var inp = document.getElementById('crNuevoClienteNombre');
            if (inp) inp.value = '';
        } else {
            var inp = document.getElementById('crNuevoClienteNombre');
            if (inp) setTimeout(function () { inp.focus(); }, 50);
        }
    }
    window.crToggleNuevoCliente = crToggleNuevoCliente;

    function crCrearCliente() {
        var nombreInp = document.getElementById('crNuevoClienteNombre');
        var nombre = (nombreInp ? nombreInp.value : '').trim();
        if (!nombre) { alert('Escribe el nombre del cliente'); return; }
        var csrfMatch = document.cookie.match(/csrftoken=([^;]+)/);
        var csrf = csrfMatch ? csrfMatch[1] : '';
        fetch('/app/api/cotizar-rapido/clientes/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
            body: JSON.stringify({ nombre: nombre })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.id) {
                    _crClientes.push({ id: data.id, nombre: data.nombre });
                    crSelectCliente(data.id, data.nombre);
                    var sec = document.getElementById('crNuevoClienteSection');
                    if (sec) sec.style.display = 'none';
                    if (nombreInp) nombreInp.value = '';
                } else {
                    alert(data.error || 'Error al crear cliente');
                }
            })
            .catch(function () { alert('Error de conexión'); });
    }
    window.crCrearCliente = crCrearCliente;

    function crToggleNuevaOpp() {
        var sec = document.getElementById('crNuevaOppSection');
        if (!sec) return;
        var isOpen = sec.style.display !== 'none';
        sec.style.display = isOpen ? 'none' : '';
        if (isOpen) {
            var inp = document.getElementById('crNuevaOppNombre');
            if (inp) inp.value = '';
        } else {
            var inp = document.getElementById('crNuevaOppNombre');
            if (inp) setTimeout(function () { inp.focus(); }, 50);
        }
    }
    window.crToggleNuevaOpp = crToggleNuevaOpp;

    function crCrearOpp() {
        var cid = document.getElementById('crClienteId');
        var nombreInp = document.getElementById('crNuevaOppNombre');
        var nombre = (nombreInp ? nombreInp.value : '').trim();
        if (!cid || !cid.value) { alert('Selecciona un cliente primero'); return; }
        if (!nombre) { alert('Escribe un nombre para la oportunidad'); return; }
        var csrfMatch = document.cookie.match(/csrftoken=([^;]+)/);
        var csrf = csrfMatch ? csrfMatch[1] : '';
        fetch('/app/api/cotizar-rapido/oportunidades/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
            body: JSON.stringify({ cliente_id: cid.value, nombre: nombre })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.id) {
                    var oppSel = document.getElementById('crOppSelect');
                    if (oppSel) {
                        var opt = document.createElement('option');
                        opt.value = data.id;
                        opt.textContent = data.nombre;
                        oppSel.insertBefore(opt, oppSel.options[1] || null);
                        oppSel.value = data.id;
                        oppSel.disabled = false;
                    }
                    var sec = document.getElementById('crNuevaOppSection');
                    if (sec) sec.style.display = 'none';
                    if (nombreInp) nombreInp.value = '';
                    crOppChanged();
                } else {
                    alert(data.error || 'Error al crear oportunidad');
                }
            })
            .catch(function () { alert('Error de conexión'); });
    }
    window.crCrearOpp = crCrearOpp;

    function cotizarRapidoIr() {
        var oppSel = document.getElementById('crOppSelect');
        if (!oppSel || !oppSel.value) return;
        var oppId = parseInt(oppSel.value, 10);
        cotizarRapidoCerrar();
        openCotizador(oppId);
    }
    window.cotizarRapidoIr = cotizarRapidoIr;

    // Close client dropdown on outside click
    document.addEventListener('click', function (e) {
        var dd = document.getElementById('crClienteDropdown');
        var inp = document.getElementById('crClienteInput');
        if (dd && inp && !inp.contains(e.target) && !dd.contains(e.target)) {
            dd.innerHTML = ''; dd.classList.remove('active');
        }
    });
/* ──────────────────────────────────────────────────────────────────
 * Paste/Drop invisible de imágenes en la descripción de tareas
 * ──────────────────────────────────────────────────────────────────
 * Reglas:
 *  - NO se muestra UI nueva (sin tooltips, sin badges, sin dropzones)
 *  - Solo se intercepta paste cuando hay un blob de imagen
 *  - En modo 'create': se acumula en _crmCreateFiles (subida diferida)
 *  - En modo 'edit':   sube al endpoint de comentarios como adjunto
 *  - Inserta una marca textual discreta en el cursor para que el usuario
 *    sepa que su captura quedó vinculada a ese punto del texto
 *  - Si falla: console.error, nada visible al usuario
 * ──────────────────────────────────────────────────────────────────*/
(function () {
    function _pad(n) { return n < 10 ? '0' + n : '' + n; }

    function _genFilename(file) {
        var d = new Date();
        var ext = 'png';
        if (file && file.type) {
            var m = file.type.match(/^image\/([a-z0-9+.\-]+)/i);
            if (m) {
                ext = m[1].toLowerCase();
                if (ext === 'jpeg') ext = 'jpg';
                if (ext === 'svg+xml') ext = 'svg';
            }
        } else if (file && file.name && file.name.indexOf('.') !== -1) {
            ext = file.name.split('.').pop().toLowerCase();
        }
        return 'captura-' + d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' +
            _pad(d.getDate()) + '-' + _pad(d.getHours()) + _pad(d.getMinutes()) +
            _pad(d.getSeconds()) + '.' + ext;
    }

    function _insertAtCursor(ta, text) {
        try {
            var start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
            var end = ta.selectionEnd != null ? ta.selectionEnd : start;
            var v = ta.value || '';
            var prefix = (start > 0 && v.charAt(start - 1) && !/\s/.test(v.charAt(start - 1))) ? ' ' : '';
            var inserted = prefix + text;
            ta.value = v.slice(0, start) + inserted + v.slice(end);
            var cursor = start + inserted.length;
            ta.selectionStart = ta.selectionEnd = cursor;
            var ev;
            try { ev = new Event('input', { bubbles: true }); }
            catch (e) { ev = document.createEvent('Event'); ev.initEvent('input', true, true); }
            ta.dispatchEvent(ev);
        } catch (e) {
            console.error('paste-img insertAtCursor:', e);
        }
    }

    function _uploadInEditMode(file, niceName) {
        try {
            if (typeof _crmCurrentTaskId === 'undefined' || !_crmCurrentTaskId) {
                console.error('paste-img: sin _crmCurrentTaskId');
                return;
            }
            var fd = new FormData();
            fd.append('contenido', '📎 Captura pegada en la descripción: ' + niceName);
            var toSend = file;
            try {
                if (!file.name || file.name === 'image.png') {
                    toSend = new File([file], niceName, { type: file.type || 'image/png' });
                }
            } catch (e) { /* navegadores antiguos */ }
            fd.append('archivo_0', toSend, niceName);
            var csrf = (typeof getCsrf === 'function') ? getCsrf() : '';
            fetch('/app/api/tarea/' + _crmCurrentTaskId + '/comentarios/agregar/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf },
                body: fd,
                credentials: 'same-origin'
            }).then(function (r) {
                if (!r.ok) { console.error('paste-img upload status', r.status); }
            }).catch(function (err) {
                console.error('paste-img upload error', err);
            });
        } catch (e) {
            console.error('paste-img upload exception', e);
        }
    }

    function _handleImageFile(ta, file, mode) {
        if (!file) return;
        var niceName = _genFilename(file);
        _insertAtCursor(ta, '[📎 ' + niceName + ']');
        if (mode === 'create') {
            var toBuffer = file;
            try {
                if (!file.name || file.name === 'image.png') {
                    toBuffer = new File([file], niceName, { type: file.type || 'image/png' });
                }
            } catch (e) { /* fallback */ }
            if (typeof window._crmCreateAddFile === 'function') {
                window._crmCreateAddFile(toBuffer);
            } else {
                console.error('paste-img: _crmCreateAddFile no disponible');
            }
        } else {
            _uploadInEditMode(file, niceName);
        }
    }

    function _onPaste(ev) {
        try {
            var cd = ev.clipboardData || window.clipboardData;
            if (!cd) return;
            var items = cd.items;
            if (!items || !items.length) return;
            var imageFile = null;
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                if (it && it.kind === 'file' && it.type && it.type.indexOf('image/') === 0) {
                    var f = it.getAsFile();
                    if (f) { imageFile = f; break; }
                }
            }
            if (!imageFile) return;
            ev.preventDefault();
            var ta = ev.currentTarget;
            var mode = ta._crmPasteMode || 'create';
            _handleImageFile(ta, imageFile, mode);
        } catch (e) {
            console.error('paste-img onPaste:', e);
        }
    }

    function _onDragOver(ev) {
        try {
            var dt = ev.dataTransfer;
            if (!dt) return;
            var hasImg = false;
            if (dt.items && dt.items.length) {
                for (var i = 0; i < dt.items.length; i++) {
                    var it = dt.items[i];
                    if (it && it.kind === 'file' && it.type && it.type.indexOf('image/') === 0) { hasImg = true; break; }
                }
            } else if (dt.types) {
                for (var j = 0; j < dt.types.length; j++) {
                    if (String(dt.types[j]).toLowerCase() === 'files') { hasImg = true; break; }
                }
            }
            if (hasImg) { ev.preventDefault(); }
        } catch (e) { /* silencioso */ }
    }

    function _onDrop(ev) {
        try {
            var dt = ev.dataTransfer;
            if (!dt || !dt.files || !dt.files.length) return;
            var imageFile = null;
            for (var i = 0; i < dt.files.length; i++) {
                var f = dt.files[i];
                if (f && f.type && f.type.indexOf('image/') === 0) { imageFile = f; break; }
            }
            if (!imageFile) return;
            ev.preventDefault();
            var ta = ev.currentTarget;
            var mode = ta._crmPasteMode || 'create';
            _handleImageFile(ta, imageFile, mode);
        } catch (e) {
            console.error('paste-img onDrop:', e);
        }
    }

    window._crmTaskAttachImageHandlers = function (ta, opts) {
        if (!ta) return;
        var mode = (opts && opts.mode) || 'create';
        ta._crmPasteMode = mode;
        if (ta._crmPasteWired) return;
        ta._crmPasteWired = true;
        ta.addEventListener('paste', _onPaste);
        ta.addEventListener('dragover', _onDragOver);
        ta.addEventListener('drop', _onDrop);
    };
})();
