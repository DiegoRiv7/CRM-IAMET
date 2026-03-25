/* ============================================================
   crm_proyectos.js  --  Modulo Proyectos (inline section + detail overlay)
   ============================================================ */
(function() {
    'use strict';

    // --- State ---
    var currentProjectId = null;
    var currentFilter = 'todos';
    var currentTab = 'partidas';
    var _cachedProjectDetail = null;
    var searchQuery = '';

    // --- Cached data from API ---
    var _cachedProjects = [];


    // =========================================
    //  API HELPERS
    // =========================================

    function _csrf() {
        var elem = document.querySelector('[name=csrfmiddlewaretoken]');
        return elem ? elem.value : '';
    }

    function _fetch(url, opts) {
        opts = opts || {};
        opts.headers = opts.headers || {};
        opts.headers['X-CSRFToken'] = _csrf();
        if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(opts.body);
        }
        opts.credentials = 'same-origin';
        return fetch(url, opts).then(function(r) { return r.json(); });
    }


    // =========================================
    //  HELPERS
    // =========================================

    function fmtMoney(val) {
        return '$' + Number(val || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
    }

    function fmtDate(dateStr) {
        if (!dateStr) return '\u2014';
        var months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        var parts = dateStr.split('T')[0].split('-');
        return parseInt(parts[2]) + ' ' + months[parseInt(parts[1]) - 1] + ' ' + parts[0];
    }

    function statusLabel(status) {
        var map = {
            planning:'Planificacion', active:'Activo', paused:'Pausado', completed:'Completado', archived:'Archivado',
            pending:'Pendiente', ordered:'Ordenado', in_transit:'En Transito', received:'Recibido', closed:'Cerrado',
            draft:'Borrador', emitted:'Emitida', cancelled:'Cancelada', paid:'Pagada', disputed:'Disputada',
            in_progress:'En Progreso', approved:'Aprobado', rejected:'Rechazado', overdue:'Vencida'
        };
        return map[status] || status;
    }

    function statusClass(status) {
        var map = {
            planning:'planning', active:'active', paused:'paused', completed:'completed', archived:'archived',
            pending:'planning', ordered:'active', in_transit:'paused', received:'completed', closed:'archived',
            draft:'planning', emitted:'active', cancelled:'archived', paid:'completed', disputed:'paused',
            in_progress:'active', approved:'completed', rejected:'paused'
        };
        return 'proy-status-' + (map[status] || 'planning');
    }

    function priorityClass(priority) {
        return 'proy-priority-' + (priority || 'low');
    }

    function priorityLabel(priority) {
        var map = { low:'Baja', medium:'Media', high:'Alta', critical:'Critica' };
        return map[priority] || priority;
    }

    function truncate(str, len) {
        if (!str) return '\u2014';
        return str.length > len ? str.substring(0, len) + '...' : str;
    }

    function severityIcon(severity) {
        var icons = {
            critical: '<svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
            warning: '<svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
            info: '<svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>'
        };
        return icons[severity] || icons.info;
    }

    function categoryDot(category) {
        var colors = {
            'Equipamiento': '#3b82f6',
            'Accesorios': '#8b5cf6',
            'Mano de Obra': '#f59e0b',
            'Materiales': '#10b981',
            'Servicios': '#ec4899',
            'Software': '#06b6d4'
        };
        var color = colors[category] || '#6b7280';
        return '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';margin-right:6px;flex-shrink:0"></span>';
    }

    function el(id) {
        return document.getElementById(id);
    }


    // =========================================
    //  INIT (called when section becomes active)
    // =========================================

    window.proyectosInit = function() {
        currentProjectId = null;
        currentFilter = 'todos';
        searchQuery = '';
        var searchInput = el('proySearch');
        if (searchInput) searchInput.value = '';
        proyectosCargarLista();
    };
    window.proyectosAbrir = window.proyectosInit;


    // =========================================
    //  LIST VIEW
    // =========================================

    function proyectosCargarLista() {
        // Update filter pill active state
        var pills = document.querySelectorAll('.proy-filter-pill');
        pills.forEach(function(pill) {
            pill.classList.toggle('active', pill.getAttribute('data-filter') === currentFilter);
        });

        var url = '/app/api/iamet/proyectos/';
        if (currentFilter !== 'todos') {
            url += '?status=' + currentFilter;
        }

        _fetch(url).then(function(resp) {
            if (resp.ok || resp.success) {
                _cachedProjects = resp.data || [];
                var filtered = getFilteredProjects();
                renderProjectCards(filtered);
            } else {
                console.error('Error cargando proyectos:', resp.error);
            }
        }).catch(function(err) {
            console.error('Error de red cargando proyectos:', err);
        });
    }

    function getFilteredProjects() {
        var filtered = _cachedProjects.slice();

        // Search filter (client-side on cached data)
        if (searchQuery) {
            var q = searchQuery.toLowerCase();
            filtered = filtered.filter(function(p) {
                return (p.nombre && p.nombre.toLowerCase().indexOf(q) !== -1) ||
                       (p.cliente_nombre && p.cliente_nombre.toLowerCase().indexOf(q) !== -1) ||
                       (p.descripcion && p.descripcion.toLowerCase().indexOf(q) !== -1);
            });
        }

        return filtered;
    }

    window.proyectosFilterStatus = function(status) {
        currentFilter = status;
        proyectosCargarLista();
    };

    window.proyectosBuscar = function() {
        var searchInput = el('proySearch');
        searchQuery = searchInput ? searchInput.value.trim() : '';
        var filtered = getFilteredProjects();
        renderProjectCards(filtered);
    };


    // =========================================
    //  RENDER: PROJECT CARDS
    // =========================================

    function renderProjectCards(projects) {
        var grid = el('proyGrid');
        var emptyEl = el('proyEmpty');
        if (!grid) return;

        if (projects.length === 0) {
            grid.innerHTML = '';
            if (emptyEl) emptyEl.style.display = '';
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';

        var html = '';
        projects.forEach(function(p) {
            var budgeted = p.utilidad_presupuestada || 0;
            var actual = p.utilidad_real || 0;
            var pct = budgeted > 0 ? Math.min(Math.round(actual / budgeted * 100), 100) : 0;
            var profitOk = actual >= budgeted;
            var barColor = profitOk ? '#10b981' : (pct >= 60 ? '#f59e0b' : '#ef4444');
            var amountColor = profitOk ? '#10b981' : '#636366';

            var unresolved = p.alertas_count || 0;

            html += '<div class="proy-card" onclick="proyectosVerDetalle(' + p.id + ')">' +
                '<div class="proy-card-header">' +
                    '<div style="flex:1;min-width:0">' +
                        '<div class="proy-card-title">' + truncate(p.nombre, 45) + '</div>' +
                        '<div class="proy-card-client">' + (p.cliente_nombre || '\u2014') + '</div>' +
                    '</div>' +
                    '<span class="proy-badge ' + statusClass(p.status) + '">' + statusLabel(p.status) + '</span>' +
                '</div>' +
                '<div class="proy-card-desc">' + truncate(p.descripcion, 90) + '</div>' +
                '<div class="proy-card-profit">' +
                    '<div class="proy-card-profit-row">' +
                        '<span class="proy-card-profit-label">Utilidad</span>' +
                        '<span class="proy-card-profit-amounts" style="color:' + amountColor + '">' + fmtMoney(actual) + ' / ' + fmtMoney(budgeted) + '</span>' +
                    '</div>' +
                    '<div class="proy-progress-track">' +
                        '<div class="proy-progress-fill" style="width:' + pct + '%;background:' + barColor + '"></div>' +
                    '</div>' +
                    '<div class="proy-card-profit-pct">' + pct + '%</div>' +
                '</div>' +
                '<div class="proy-card-footer">' +
                    '<span class="proy-card-dates">' + fmtDate(p.fecha_inicio) + ' \u2014 ' + fmtDate(p.fecha_fin) + '</span>' +
                    (unresolved > 0 ? '<span class="proy-alert-count" title="' + unresolved + ' alertas">' + unresolved + '</span>' : '') +
                '</div>' +
            '</div>';
        });

        grid.innerHTML = html;
    }


    // =========================================
    //  DETAIL VIEW (opens overlay)
    // =========================================

    window.proyectosVerDetalle = function(projectId) {
        currentProjectId = projectId;
        currentTab = 'info';

        // Open the detail overlay
        var overlay = el('widgetProyectoDetalle');
        if (overlay) overlay.style.display = 'flex';

        // Fetch project detail + financials
        _fetch('/app/api/iamet/proyectos/' + projectId + '/').then(function(resp) {
            if (resp.ok || resp.success) {
                var project = resp.data;
                _cachedProjectDetail = project;

                // Header
                var hName = el('proyDetailName');
                var hStatus = el('proyDetailStatus');
                var hClient = el('proyDetailClient');
                var hDates = el('proyDetailDates');
                var hDesc = el('proyDetailDesc');

                if (hName) hName.textContent = project.nombre || '';
                if (hStatus) {
                    hStatus.textContent = statusLabel(project.status);
                    hStatus.className = 'proy-badge ' + statusClass(project.status);
                }
                if (hClient) hClient.textContent = project.cliente_nombre || '\u2014';
                if (hDates) hDates.textContent = fmtDate(project.fecha_inicio) + '  \u2192  ' + fmtDate(project.fecha_fin);
                if (hDesc) hDesc.textContent = project.descripcion || '';

                renderKPIsFromAPI(projectId);

                // Render info tab if it's the current tab
                if (currentTab === 'info') {
                    renderInfo();
                }
            } else {
                console.error('Error cargando proyecto:', resp.error);
            }
        }).catch(function(err) {
            console.error('Error de red cargando proyecto:', err);
        });

        proyectosSetTab('partidas');
    };

    window.proyectosVolverLista = function() {
        currentProjectId = null;
        // Close the detail overlay
        var overlay = el('widgetProyectoDetalle');
        if (overlay) overlay.style.display = 'none';
    };


    // =========================================
    //  KPIs
    // =========================================

    function renderKPIsFromAPI(projectId) {
        var kpiContainer = el('proyKPIs');
        if (!kpiContainer) return;

        _fetch('/app/api/iamet/proyectos/' + projectId + '/financieros/').then(function(resp) {
            console.log('[KPI FINANCIEROS]', JSON.stringify(resp.data));
            if (resp.ok || resp.success) {
                var fin = resp.data;
                var budgeted = fin.utilidad_presupuestada || 0;
                var actual = fin.utilidad_real || 0;
                var margin = fin.margen || 0;
                var coverage = fin.cobertura || 0;
                var profitOk = actual >= budgeted;

                kpiContainer.innerHTML =
                    '<div class="proy-kpi-card">' +
                        '<div class="proy-kpi-label">Utilidad Presupuestada</div>' +
                        '<div class="proy-kpi-value">' + fmtMoney(budgeted) + '</div>' +
                    '</div>' +
                    '<div class="proy-kpi-card">' +
                        '<div class="proy-kpi-label">Utilidad Real</div>' +
                        '<div class="proy-kpi-value" style="color:' + (profitOk ? '#10b981' : '#ef4444') + '">' + fmtMoney(actual) + '</div>' +
                    '</div>' +
                    '<div class="proy-kpi-card">' +
                        '<div class="proy-kpi-label">Margen</div>' +
                        '<div class="proy-kpi-value" style="color:' + (margin >= 100 ? '#10b981' : margin >= 70 ? '#f59e0b' : '#ef4444') + '">' + margin + '%</div>' +
                    '</div>' +
                    '<div class="proy-kpi-card">' +
                        '<div class="proy-kpi-label">Cobertura de Costos</div>' +
                        '<div class="proy-kpi-value">' + coverage + '%</div>' +
                    '</div>';
            } else {
                console.error('Error cargando financieros:', resp.error);
            }
        }).catch(function(err) {
            console.error('Error de red cargando financieros:', err);
        });
    }


    // =========================================
    //  TABS
    // =========================================

    window.proyectosSetTab = function(tabName) {
        currentTab = tabName;

        // Toggle tab buttons
        var tabs = document.querySelectorAll('.proy-tab-btn');
        tabs.forEach(function(t) {
            t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
        });

        // Hide all panes
        var panes = document.querySelectorAll('.proy-tab-pane');
        panes.forEach(function(pane) {
            pane.style.display = 'none';
        });

        // Show the selected pane
        var activePane = el('proyPane_' + tabName);
        if (activePane) activePane.style.display = '';

        // Render data
        if (!currentProjectId) return;
        switch (tabName) {
            case 'info':       renderInfo(); break;
            case 'partidas':   renderPartidas(currentProjectId); break;
            case 'oc':         renderOC(currentProjectId); break;
            case 'financiero': renderFinanciero(currentProjectId); break;
            case 'tareas':     renderTareas(currentProjectId); break;
            case 'alertas':    renderAlertas(currentProjectId); break;
        }
    };


    // =========================================
    //  RENDER: PARTIDAS (Line Items)
    // =========================================

    function renderPartidas(projectId) {
        var container = el('proyPartidasBody');
        if (!container) return;

        container.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:40px;color:#8e8e93">Cargando...</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/partidas/').then(function(resp) {
            console.log('[PARTIDAS API] Full response:', JSON.stringify(resp).substring(0, 500));
            if (resp.ok || resp.success) {
                // API returns {data: {partidas: [...], totales: {...}}}
                var respData = resp.data || {};
                var items = Array.isArray(respData) ? respData : (respData.partidas || []);
                var apiTotales = Array.isArray(respData) ? null : (respData.totales || null);
                console.log('[PARTIDAS API] apiTotales:', JSON.stringify(apiTotales));

                if (items.length === 0) {
                    container.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:40px;color:#8e8e93">No hay partidas registradas</td></tr>';
                    var foot = el('proyPartidasFoot');
                    if (foot) foot.innerHTML = '';
                    return;
                }

                var html = '';
                items.forEach(function(item) {
                    var totalCost = (item.costo_unitario || 0) * (item.cantidad || 0);
                    var totalSale = (item.precio_venta_unitario || 0) * (item.cantidad || 0);
                    var totalProfit = (item.ganancia || ((item.precio_venta_unitario || 0) - (item.costo_unitario || 0))) * (item.cantidad || 0);

                    html += '<tr>' +
                        '<td>' + categoryDot(item.categoria) + (item.categoria || '\u2014') + '</td>' +
                        '<td title="' + (item.descripcion || '') + '">' + truncate(item.descripcion, 28) + '</td>' +
                        '<td>' + (item.marca || '\u2014') + '</td>' +
                        '<td style="font-size:0.72rem;color:#aeaeb2">' + (item.numero_parte || '\u2014') + '</td>' +
                        '<td style="text-align:center">' + (item.cantidad || 0) + '</td>' +
                        '<td style="text-align:center;color:' + ((item.cantidad_pendiente || 0) > 0 ? '#f59e0b' : '#10b981') + '">' + (item.cantidad_pendiente || 0) + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(item.precio_lista) + '</td>' +
                        '<td style="text-align:center">' + (item.descuento || 0) + '%</td>' +
                        '<td style="text-align:right">' + fmtMoney(item.costo_unitario) + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(item.precio_venta_unitario) + '</td>' +
                        '<td style="text-align:right;color:#10b981">' + fmtMoney(totalProfit) + '</td>' +
                        '<td>' + truncate(item.proveedor, 16) + '</td>' +
                        '<td><span class="proy-badge ' + statusClass(item.status) + '">' + statusLabel(item.status) + '</span></td>' +
                    '</tr>';
                });

                container.innerHTML = html;

                // Totals — use API totals if available, otherwise calculate
                var totals = apiTotales || {};
                var totalsCost = totals.costo_total || totals.total_costo || 0;
                var totalsSale = totals.precio_venta_total || totals.total_venta || 0;
                var totalsProfit = totals.ganancia || totals.total_ganancia || 0;

                if (!apiTotales) {
                    totalsCost = 0; totalsSale = 0; totalsProfit = 0;
                    items.forEach(function(item) {
                        totalsCost += (item.costo_unitario || 0) * (item.cantidad || 0);
                        totalsSale += (item.precio_venta_unitario || 0) * (item.cantidad || 0);
                        totalsProfit += (item.ganancia || ((item.precio_venta_unitario || 0) - (item.costo_unitario || 0))) * (item.cantidad || 0);
                    });
                }

                // Update KPIs from partidas data (more reliable than /financieros/)
                var kpiC = el('proyKPIs');
                if (kpiC) {
                    kpiC.innerHTML =
                        '<div class="proy-kpi-card"><div class="proy-kpi-label">Utilidad Presupuestada</div><div class="proy-kpi-value">' + fmtMoney(totalsProfit) + '</div></div>' +
                        '<div class="proy-kpi-card"><div class="proy-kpi-label">Costo Total</div><div class="proy-kpi-value" style="color:#ef4444">' + fmtMoney(totalsCost) + '</div></div>' +
                        '<div class="proy-kpi-card"><div class="proy-kpi-label">Venta Total</div><div class="proy-kpi-value" style="color:#10b981">' + fmtMoney(totalsSale) + '</div></div>' +
                        '<div class="proy-kpi-card"><div class="proy-kpi-label">Margen</div><div class="proy-kpi-value">' + (totalsSale > 0 ? Math.round(totalsProfit / totalsSale * 100) : 0) + '%</div></div>';
                }
                var foot = el('proyPartidasFoot');
                if (foot) {
                    foot.innerHTML = '<tr style="font-weight:600;border-top:2px solid rgba(0,0,0,0.1)">' +
                        '<td colspan="8" style="text-align:right;color:#8e8e93">Totales</td>' +
                        '<td style="text-align:right">' + fmtMoney(totalsCost) + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(totalsSale) + '</td>' +
                        '<td style="text-align:right;color:#10b981">' + fmtMoney(totalsProfit) + '</td>' +
                        '<td colspan="2"></td>' +
                    '</tr>';
                }
            } else {
                container.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:40px;color:#ef4444">Error al cargar partidas</td></tr>';
                console.error('Error cargando partidas:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:40px;color:#ef4444">Error de conexion</td></tr>';
            console.error('Error de red cargando partidas:', err);
        });
    }


    // =========================================
    //  RENDER: ORDENES DE COMPRA
    // =========================================

    function renderOC(projectId) {
        var container = el('proyOCBody');
        if (!container) return;

        container.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#8e8e93">Cargando...</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/oc/').then(function(resp) {
            if (resp.ok || resp.success) {
                var orders = resp.data || [];
                if (orders.length === 0) {
                    container.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#8e8e93">No hay ordenes de compra</td></tr>';
                    var foot = el('proyOCFoot');
                    if (foot) foot.innerHTML = '';
                    return;
                }

                var html = '';
                var total = 0;
                orders.forEach(function(oc) {
                    var amount = oc.monto_total || ((oc.cantidad || 0) * (oc.precio_unitario || 0));
                    total += amount;
                    html += '<tr>' +
                        '<td style="font-weight:600;color:#007aff">' + (oc.numero_oc || '\u2014') + '</td>' +
                        '<td>' + (oc.proveedor || '\u2014') + '</td>' +
                        '<td>' + (oc.descripcion || oc.partida_descripcion || '\u2014') + '</td>' +
                        '<td style="text-align:center">' + (oc.cantidad || 0) + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(amount) + '</td>' +
                        '<td><span class="proy-badge ' + statusClass(oc.status) + '">' + statusLabel(oc.status) + '</span></td>' +
                        '<td>' + fmtDate(oc.fecha_emision) + '</td>' +
                    '</tr>';
                });

                container.innerHTML = html;

                var foot = el('proyOCFoot');
                if (foot) {
                    foot.innerHTML = '<tr style="font-weight:600;border-top:2px solid rgba(0,0,0,0.1)">' +
                        '<td colspan="4" style="text-align:right;color:#8e8e93">Total OC</td>' +
                        '<td style="text-align:right">' + fmtMoney(total) + '</td>' +
                        '<td colspan="2"></td>' +
                    '</tr>';
                }
            } else {
                container.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#ef4444">Error al cargar OC</td></tr>';
                console.error('Error cargando OC:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#ef4444">Error de conexion</td></tr>';
            console.error('Error de red cargando OC:', err);
        });
    }


    // =========================================
    //  RENDER: FINANCIERO
    // =========================================

    function renderFinanciero(projectId) {
        renderSupplierInvoices(projectId);
        renderRevenueInvoices(projectId);
        renderExpenses(projectId);
    }

    function renderSupplierInvoices(projectId) {
        var container = el('proyFacProvBody');
        if (!container) return;

        container.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#8e8e93">Cargando...</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/facturas-proveedor/').then(function(resp) {
            if (resp.ok || resp.success) {
                var invoices = resp.data || [];
                if (invoices.length === 0) {
                    container.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#8e8e93">No hay facturas de proveedores</td></tr>';
                    return;
                }

                var html = '';
                invoices.forEach(function(inv) {
                    var amount = inv.monto || 0;
                    var budgeted = inv.monto_presupuestado || 0;
                    var variance = amount - budgeted;
                    var variancePct = budgeted > 0 ? Math.round(variance / budgeted * 1000) / 10 : 0;
                    var varianceColor = variance > 0 ? '#ef4444' : (variance < 0 ? '#10b981' : '#8e8e93');

                    html += '<tr>' +
                        '<td style="font-weight:600;color:#007aff">' + (inv.numero_factura || '\u2014') + '</td>' +
                        '<td>' + (inv.proveedor || '\u2014') + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(amount) + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(budgeted) + '</td>' +
                        '<td style="text-align:right;color:' + varianceColor + '">' + (variance > 0 ? '+' : '') + fmtMoney(variance) + '</td>' +
                        '<td style="text-align:right;color:' + varianceColor + '">' + (variancePct > 0 ? '+' : '') + variancePct + '%</td>' +
                        '<td><span class="proy-badge ' + statusClass(inv.status) + '">' + statusLabel(inv.status) + '</span></td>' +
                        '<td>' + fmtDate(inv.fecha_factura) + '</td>' +
                    '</tr>';
                });

                container.innerHTML = html;
            } else {
                container.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#ef4444">Error al cargar facturas</td></tr>';
                console.error('Error cargando facturas proveedor:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#ef4444">Error de conexion</td></tr>';
            console.error('Error de red cargando facturas proveedor:', err);
        });
    }

    function renderRevenueInvoices(projectId) {
        var container = el('proyFacIngBody');
        if (!container) return;

        container.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#8e8e93">Cargando...</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/facturas-ingreso/').then(function(resp) {
            if (resp.ok || resp.success) {
                var invoices = resp.data || [];
                if (invoices.length === 0) {
                    container.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#8e8e93">No hay facturas de ingreso</td></tr>';
                    var foot = el('proyFacIngFoot');
                    if (foot) foot.innerHTML = '';
                    return;
                }

                var html = '';
                var total = 0;
                invoices.forEach(function(inv) {
                    var amount = inv.monto || 0;
                    total += amount;
                    html += '<tr>' +
                        '<td style="font-weight:600;color:#007aff">' + (inv.numero_factura || '\u2014') + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(amount) + '</td>' +
                        '<td><span class="proy-badge ' + statusClass(inv.status || inv.metodo_pago || 'emitted') + '">' + statusLabel(inv.status || inv.metodo_pago || 'emitted') + '</span></td>' +
                        '<td>' + fmtDate(inv.fecha_factura) + '</td>' +
                    '</tr>';
                });

                container.innerHTML = html;

                var foot = el('proyFacIngFoot');
                if (foot) {
                    foot.innerHTML = '<tr style="font-weight:600;border-top:2px solid rgba(0,0,0,0.1)">' +
                        '<td style="text-align:right;color:#8e8e93">Total</td>' +
                        '<td style="text-align:right">' + fmtMoney(total) + '</td>' +
                        '<td colspan="2"></td>' +
                    '</tr>';
                }
            } else {
                container.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#ef4444">Error al cargar facturas</td></tr>';
                console.error('Error cargando facturas ingreso:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#ef4444">Error de conexion</td></tr>';
            console.error('Error de red cargando facturas ingreso:', err);
        });
    }

    function renderExpenses(projectId) {
        var container = el('proyGastosBody');
        if (!container) return;

        container.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#8e8e93">Cargando...</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/gastos/').then(function(resp) {
            if (resp.ok || resp.success) {
                var expenses = resp.data || [];
                if (expenses.length === 0) {
                    container.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#8e8e93">No hay gastos registrados</td></tr>';
                    var foot = el('proyGastosFoot');
                    if (foot) foot.innerHTML = '';
                    return;
                }

                var html = '';
                var total = 0;
                expenses.forEach(function(exp) {
                    var amount = exp.monto || 0;
                    total += amount;
                    html += '<tr>' +
                        '<td>' + (exp.categoria || '\u2014') + '</td>' +
                        '<td>' + (exp.descripcion || '\u2014') + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(amount) + '</td>' +
                        '<td><span class="proy-badge ' + statusClass(exp.status || exp.aprobacion || 'pending') + '">' + statusLabel(exp.status || exp.aprobacion || 'pending') + '</span></td>' +
                    '</tr>';
                });

                container.innerHTML = html;

                var foot = el('proyGastosFoot');
                if (foot) {
                    foot.innerHTML = '<tr style="font-weight:600;border-top:2px solid rgba(0,0,0,0.1)">' +
                        '<td colspan="2" style="text-align:right;color:#8e8e93">Total Gastos</td>' +
                        '<td style="text-align:right">' + fmtMoney(total) + '</td>' +
                        '<td></td>' +
                    '</tr>';
                }
            } else {
                container.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#ef4444">Error al cargar gastos</td></tr>';
                console.error('Error cargando gastos:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#ef4444">Error de conexion</td></tr>';
            console.error('Error de red cargando gastos:', err);
        });
    }


    // =========================================
    //  RENDER: TAREAS
    // =========================================

    function renderTareas(projectId) {
        var container = el('proyTareasBody');
        if (!container) return;

        container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#8e8e93">Cargando...</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/tareas/').then(function(resp) {
            if (resp.ok || resp.success) {
                var tasks = resp.data || [];
                if (tasks.length === 0) {
                    container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#8e8e93">No hay tareas registradas</td></tr>';
                    return;
                }

                var html = '';
                tasks.forEach(function(t) {
                    var titleCell;
                    var sourceBadge;
                    if (t.source === 'oportunidad') {
                        titleCell = '<span style="color:#007aff;cursor:pointer;font-weight:600;" onclick="var m=document.getElementById(\'crmTaskDetailModal\');if(m){m.classList.add(\'z-elevated\');m.style.zIndex=\'10800\';}if(typeof crmTaskVerDetalle===\'function\')crmTaskVerDetalle(' + t.id + ');">' + truncate(t.titulo, 40) + '</span>';
                        sourceBadge = '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:0.68rem;font-weight:600;background:#dbeafe;color:#2563eb;">CRM</span>';
                    } else {
                        titleCell = '<span style="font-weight:600;color:#1d1d1f;">' + truncate(t.titulo, 40) + '</span>';
                        sourceBadge = '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:0.68rem;font-weight:600;background:#f3e8ff;color:#7c3aed;">Proyecto</span>';
                    }
                    html += '<tr>' +
                        '<td>' + titleCell + '</td>' +
                        '<td>' + sourceBadge + '</td>' +
                        '<td><span class="proy-badge ' + priorityClass(t.prioridad) + '">' + priorityLabel(t.prioridad) + '</span></td>' +
                        '<td>' + (t.asignado_a || t.asignado_a_nombre || t.asignado_nombre || 'Sin asignar') + '</td>' +
                        '<td>' + fmtDate(t.fecha_limite) + '</td>' +
                        '<td><span class="proy-badge ' + statusClass(t.status) + '">' + statusLabel(t.status) + '</span></td>' +
                    '</tr>';
                });

                container.innerHTML = html;
            } else {
                container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#ef4444">Error al cargar tareas</td></tr>';
                console.error('Error cargando tareas:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#ef4444">Error de conexion</td></tr>';
            console.error('Error de red cargando tareas:', err);
        });
    }


    // =========================================
    //  RENDER: ALERTAS
    // =========================================

    function renderAlertas(projectId) {
        var container = el('proyAlertasContainer');
        if (!container) return;

        container.innerHTML = '<div style="text-align:center;padding:40px;color:#8e8e93">Cargando...</div>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/alertas/').then(function(resp) {
            if (resp.ok || resp.success) {
                var alerts = resp.data || [];
                if (alerts.length === 0) {
                    container.innerHTML = '<div style="text-align:center;padding:40px;color:#8e8e93">No hay alertas</div>';
                    return;
                }

                var html = '';
                alerts.forEach(function(a) {
                    var severity = a.severity || a.severidad || 'info';
                    var resolved = a.resolved || a.resuelta || false;
                    var severityColors = { critical:'#ef4444', warning:'#f59e0b', info:'#3b82f6' };
                    var bgColors = { critical:'rgba(239,68,68,0.06)', warning:'rgba(245,158,11,0.06)', info:'rgba(59,130,246,0.06)' };
                    var borderColor = severityColors[severity] || '#3b82f6';
                    var bgColor = bgColors[severity] || bgColors.info;

                    html += '<div class="proy-alert-item' + (resolved ? ' resolved' : '') + '" style="border-left-color:' + borderColor + ';background:' + bgColor + '">' +
                        '<div style="color:' + borderColor + ';flex-shrink:0;margin-top:1px">' + severityIcon(severity) + '</div>' +
                        '<div style="flex:1;min-width:0">' +
                            '<div style="font-weight:600;font-size:0.82rem;color:#1c1c1e;margin-bottom:3px">' + (a.title || a.titulo || '') + '</div>' +
                            '<div style="font-size:0.75rem;color:#636366">' + (a.message || a.mensaje || '') + '</div>' +
                        '</div>' +
                        (!resolved ? '<button class="proy-btn-sm" onclick="event.stopPropagation();proyectosResolverAlerta(' + projectId + ',' + a.id + ')" title="Marcar resuelta">Resolver</button>' : '<span style="font-size:0.7rem;color:#8e8e93;white-space:nowrap">Resuelta</span>') +
                    '</div>';
                });

                container.innerHTML = html;
            } else {
                container.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444">Error al cargar alertas</div>';
                console.error('Error cargando alertas:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444">Error de conexion</div>';
            console.error('Error de red cargando alertas:', err);
        });
    }

    window.proyectosResolverAlerta = function(projectId, alertId) {
        _fetch('/app/api/iamet/alertas/' + alertId + '/resolver/', { method: 'POST' }).then(function(resp) {
            if (resp.ok || resp.success) {
                renderAlertas(projectId);
                renderKPIsFromAPI(projectId);
            } else {
                console.error('Error resolviendo alerta:', resp.error);
            }
        }).catch(function(err) {
            console.error('Error de red resolviendo alerta:', err);
        });
    };


    // =========================================
    //  RENDER: INFORMACION
    // =========================================

    function renderInfo() {
        var container = el('proyPane_info_body');
        if (!container) return;

        var p = _cachedProjectDetail;
        if (!p) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#8e8e93">Cargando informacion...</div>';
            return;
        }

        var oppLink = '';
        if (p.oportunidad_id && p.oportunidad_nombre) {
            oppLink = '<a href="javascript:void(0)" onclick="var d=document.getElementById(\'widgetDetalle\');if(d){d.classList.add(\'z-elevated\');d.style.zIndex=\'10800\';}if(typeof openDetalle===\'function\')openDetalle(' + p.oportunidad_id + ')" style="color:#007aff;text-decoration:none;font-weight:500">' + (p.oportunidad_nombre || '') + '</a>';
        } else {
            oppLink = '<span style="color:#8e8e93">Sin oportunidad vinculada</span>';
        }

        var startVal = p.fecha_inicio ? p.fecha_inicio.split('T')[0] : '';
        var endVal = p.fecha_fin ? p.fecha_fin.split('T')[0] : '';

        container.innerHTML =
            '<div class="proy-info-form">' +
                '<div class="proy-info-row">' +
                    '<label class="proy-info-label">Nombre del proyecto</label>' +
                    '<input type="text" id="proyInfoNombre" class="proy-info-input" value="' + (p.nombre || '').replace(/"/g, '&quot;') + '">' +
                '</div>' +
                '<div class="proy-info-row">' +
                    '<label class="proy-info-label">Cliente</label>' +
                    '<input type="text" id="proyInfoCliente" class="proy-info-input" value="' + (p.cliente_nombre || '').replace(/"/g, '&quot;') + '">' +
                '</div>' +
                '<div class="proy-info-row">' +
                    '<label class="proy-info-label">Descripcion</label>' +
                    '<textarea id="proyInfoDescripcion" class="proy-info-input" rows="3">' + (p.descripcion || '') + '</textarea>' +
                '</div>' +
                '<div class="proy-info-grid">' +
                    '<div class="proy-info-row">' +
                        '<label class="proy-info-label">Status</label>' +
                        '<select id="proyInfoStatus" class="proy-info-input">' +
                            '<option value="planning"' + (p.status === 'planning' ? ' selected' : '') + '>Planificacion</option>' +
                            '<option value="active"' + (p.status === 'active' ? ' selected' : '') + '>Activo</option>' +
                            '<option value="paused"' + (p.status === 'paused' ? ' selected' : '') + '>Pausado</option>' +
                            '<option value="completed"' + (p.status === 'completed' ? ' selected' : '') + '>Completado</option>' +
                            '<option value="archived"' + (p.status === 'archived' ? ' selected' : '') + '>Archivado</option>' +
                        '</select>' +
                    '</div>' +
                    '<div class="proy-info-row">' +
                        '<label class="proy-info-label">Utilidad presupuestada</label>' +
                        '<input type="number" id="proyInfoUtilidad" class="proy-info-input" value="' + (p.utilidad_presupuestada || 0) + '" step="0.01">' +
                    '</div>' +
                '</div>' +
                '<div class="proy-info-grid">' +
                    '<div class="proy-info-row">' +
                        '<label class="proy-info-label">Fecha inicio</label>' +
                        '<input type="date" id="proyInfoInicio" class="proy-info-input" value="' + startVal + '">' +
                    '</div>' +
                    '<div class="proy-info-row">' +
                        '<label class="proy-info-label">Fecha fin</label>' +
                        '<input type="date" id="proyInfoFin" class="proy-info-input" value="' + endVal + '">' +
                    '</div>' +
                '</div>' +
                '<div class="proy-info-row">' +
                    '<label class="proy-info-label">Oportunidad vinculada</label>' +
                    '<div style="padding:8px 0">' + oppLink + '</div>' +
                '</div>' +
                '<div class="proy-info-row">' +
                    '<label class="proy-info-label">Creado</label>' +
                    '<div style="padding:8px 0;color:#8e8e93;font-size:0.82rem">' + fmtDate(p.created_at) + '</div>' +
                '</div>' +
                '<div style="margin-top:24px;display:flex;justify-content:space-between;align-items:center;">' +
                    '<button style="padding:8px 18px;border-radius:10px;border:1.5px solid #FF3B30;background:none;color:#FF3B30;font-size:0.82rem;font-weight:600;cursor:pointer;" onclick="proyectosMostrarEliminar()">Eliminar proyecto</button>' +
                    '<button class="proy-btn proy-btn-primary" onclick="proyectosGuardarInfo()">Guardar cambios</button>' +
                '</div>' +
            '</div>';
    }

    window.proyectosMostrarEliminar = function() {
        var d = document.getElementById('proyDialogoEliminar');
        if (d) {
            d.style.display = 'flex';
            var ta = document.getElementById('proyEliminarMotivo');
            if (ta) ta.value = '';
        }
    };

    window.proyectosConfirmarEliminar = function() {
        if (!currentProjectId) return;
        var motivo = (document.getElementById('proyEliminarMotivo') || {}).value || '';
        if (!motivo.trim()) {
            _showToast('Debes documentar el motivo de eliminacion', 'error');
            return;
        }
        _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/eliminar/', {
            method: 'POST',
            body: { motivo: motivo.trim() }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoEliminar');
                proyectosVolverLista();
                proyectosCargarLista();
                _showToast('Proyecto eliminado', 'success');
            } else {
                _showToast(resp.error || 'Error al eliminar', 'error');
            }
        });
    };

    window.proyectosGuardarInfo = function() {
        if (!currentProjectId) return;

        var nombre = el('proyInfoNombre') ? el('proyInfoNombre').value.trim() : '';
        var cliente = el('proyInfoCliente') ? el('proyInfoCliente').value.trim() : '';
        var desc = el('proyInfoDescripcion') ? el('proyInfoDescripcion').value.trim() : '';
        var status = el('proyInfoStatus') ? el('proyInfoStatus').value : '';
        var utilidad = el('proyInfoUtilidad') ? parseFloat(el('proyInfoUtilidad').value) || 0 : 0;
        var inicio = el('proyInfoInicio') ? el('proyInfoInicio').value : '';
        var fin = el('proyInfoFin') ? el('proyInfoFin').value : '';

        if (!nombre) {
            alert('El nombre del proyecto es obligatorio');
            return;
        }

        _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/actualizar/', {
            method: 'POST',
            body: {
                nombre: nombre,
                cliente_nombre: cliente,
                descripcion: desc,
                status: status,
                utilidad_presupuestada: utilidad,
                fecha_inicio: inicio,
                fecha_fin: fin
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                var project = resp.data;
                _cachedProjectDetail = project;

                // Refresh header
                var hName = el('proyDetailName');
                var hStatus = el('proyDetailStatus');
                var hClient = el('proyDetailClient');
                var hDates = el('proyDetailDates');
                var hDesc = el('proyDetailDesc');

                if (hName) hName.textContent = project.nombre || '';
                if (hStatus) {
                    hStatus.textContent = statusLabel(project.status);
                    hStatus.className = 'proy-badge ' + statusClass(project.status);
                }
                if (hClient) hClient.textContent = project.cliente_nombre || '\u2014';
                if (hDates) hDates.textContent = fmtDate(project.fecha_inicio) + '  \u2192  ' + fmtDate(project.fecha_fin);
                if (hDesc) hDesc.textContent = project.descripcion || '';

                renderKPIsFromAPI(currentProjectId);

                // Show toast
                _showToast('Proyecto actualizado correctamente');
            } else {
                alert('Error al guardar: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al guardar proyecto');
            console.error('Error guardando proyecto:', err);
        });
    };

    window.proyectosTareaToast = function() {
        _showToast('Detalle de tarea \u2014 proximamente');
    };

    function _showToast(message) {
        var existing = document.getElementById('proyToast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.id = 'proyToast';
        toast.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);background:#1c1c1e;color:#fff;padding:10px 24px;border-radius:10px;font-size:0.82rem;z-index:99999;opacity:0;transition:opacity 0.3s;box-shadow:0 4px 16px rgba(0,0,0,0.2)';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(function() { toast.style.opacity = '1'; }, 10);
        setTimeout(function() {
            toast.style.opacity = '0';
            setTimeout(function() { toast.remove(); }, 300);
        }, 2500);
    }


    // =========================================
    //  DIALOGS
    // =========================================

    window.proyectosCrearDialogo = function() {
        var d = el('proyDialogoCrear');
        if (d) d.style.display = 'flex';
    };

    window.proyectosCerrarDialogo = function(dialogId) {
        var d = el(dialogId);
        if (d) d.style.display = 'none';
    };

    window.proyectosCrearPartidaDialogo = function() {
        var d = el('proyDialogoPartida');
        if (d) d.style.display = 'flex';
    };

    window.proyectosCrearOCDialogo = function() {
        var d = el('proyDialogoOC');
        if (d) d.style.display = 'flex';
    };

    window.proyectosCrearTareaDialogo = function() {
        var d = el('proyDialogoTarea');
        if (d) d.style.display = 'flex';
    };

    window.proyectosCrearFacturaProveedorDialogo = function() {
        var d = el('proyDialogoFacProv');
        if (d) d.style.display = 'flex';
    };

    window.proyectosCrearFacturaIngresoDialogo = function() {
        var d = el('proyDialogoFacIng');
        if (d) d.style.display = 'flex';
    };

    window.proyectosCrearGastoDialogo = function() {
        var d = el('proyDialogoGasto');
        if (d) d.style.display = 'flex';
    };

    window.proyectosImportarExcel = function() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls,.csv';
        input.onchange = function(e) {
            var file = e.target.files[0];
            if (!file) return;

            var formData = new FormData();
            formData.append('archivo', file);
            formData.append('proyecto_id', currentProjectId);

            _fetch('/app/api/iamet/partidas/importar-excel/', {
                method: 'POST',
                body: formData
            }).then(function(resp) {
                if (resp.ok || resp.success) {
                    renderPartidas(currentProjectId);
                    alert('Partidas importadas correctamente');
                } else {
                    alert('Error al importar: ' + (resp.error || 'Error desconocido'));
                }
            }).catch(function(err) {
                alert('Error de conexion al importar');
                console.error('Error importando Excel:', err);
            });
        };
        input.click();
    };

    // --- Dialog form submissions ---

    window.proyectosGuardarProyecto = function() {
        var name = el('proyFormNombre') ? el('proyFormNombre').value.trim() : '';
        var client = el('proyFormCliente') ? el('proyFormCliente').value.trim() : '';
        var desc = el('proyFormDescripcion') ? el('proyFormDescripcion').value.trim() : '';
        var budget = el('proyFormPresupuesto') ? parseFloat(el('proyFormPresupuesto').value) || 0 : 0;
        var startDate = el('proyFormInicio') ? el('proyFormInicio').value : '';
        var endDate = el('proyFormFin') ? el('proyFormFin').value : '';

        if (!name || !client) return;

        _fetch('/app/api/iamet/proyectos/crear/', {
            method: 'POST',
            body: {
                nombre: name,
                descripcion: desc,
                cliente_nombre: client,
                utilidad_presupuestada: budget,
                fecha_inicio: startDate,
                fecha_fin: endDate
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoCrear');
                // Clear form
                if (el('proyFormNombre')) el('proyFormNombre').value = '';
                if (el('proyFormCliente')) el('proyFormCliente').value = '';
                if (el('proyFormDescripcion')) el('proyFormDescripcion').value = '';
                if (el('proyFormPresupuesto')) el('proyFormPresupuesto').value = '';
                if (el('proyFormInicio')) el('proyFormInicio').value = '';
                if (el('proyFormFin')) el('proyFormFin').value = '';
                proyectosCargarLista();
            } else {
                alert('Error al crear proyecto: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al crear proyecto');
            console.error('Error creando proyecto:', err);
        });
    };

    window.proyectosGuardarPartida = function() {
        if (!currentProjectId) return;

        var category = el('proyPartCategoria') ? el('proyPartCategoria').value : '';
        var desc = el('proyPartDescripcion') ? el('proyPartDescripcion').value.trim() : '';
        var brand = el('proyPartMarca') ? el('proyPartMarca').value.trim() : '';
        var partNumber = el('proyPartNumParte') ? el('proyPartNumParte').value.trim() : '';
        var quantity = el('proyPartCantidad') ? parseInt(el('proyPartCantidad').value) || 0 : 0;
        var listPrice = el('proyPartPrecioLista') ? parseFloat(el('proyPartPrecioLista').value) || 0 : 0;
        var discount = el('proyPartDescuento') ? parseFloat(el('proyPartDescuento').value) || 0 : 0;
        var unitCost = el('proyPartCostoUnit') ? parseFloat(el('proyPartCostoUnit').value) || 0 : 0;
        var unitSale = el('proyPartVentaUnit') ? parseFloat(el('proyPartVentaUnit').value) || 0 : 0;
        var supplier = el('proyPartProveedor') ? el('proyPartProveedor').value.trim() : '';

        if (!desc || quantity <= 0) return;

        _fetch('/app/api/iamet/partidas/crear/', {
            method: 'POST',
            body: {
                proyecto_id: currentProjectId,
                categoria: category || 'Equipamiento',
                descripcion: desc,
                marca: brand,
                numero_parte: partNumber,
                cantidad: quantity,
                precio_lista: listPrice,
                descuento: discount,
                costo_unitario: unitCost,
                precio_venta_unitario: unitSale,
                proveedor: supplier
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoPartida');
                // Clear form
                if (el('proyPartCategoria')) el('proyPartCategoria').value = '';
                if (el('proyPartDescripcion')) el('proyPartDescripcion').value = '';
                if (el('proyPartMarca')) el('proyPartMarca').value = '';
                if (el('proyPartNumParte')) el('proyPartNumParte').value = '';
                if (el('proyPartCantidad')) el('proyPartCantidad').value = '';
                if (el('proyPartPrecioLista')) el('proyPartPrecioLista').value = '';
                if (el('proyPartDescuento')) el('proyPartDescuento').value = '';
                if (el('proyPartCostoUnit')) el('proyPartCostoUnit').value = '';
                if (el('proyPartVentaUnit')) el('proyPartVentaUnit').value = '';
                if (el('proyPartProveedor')) el('proyPartProveedor').value = '';
                renderPartidas(currentProjectId);
            } else {
                alert('Error al crear partida: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al crear partida');
            console.error('Error creando partida:', err);
        });
    };

    window.proyectosGuardarOC = function() {
        if (!currentProjectId) return;

        var partidaId = el('proyOCPartida') ? el('proyOCPartida').value : '';
        var supplier = el('proyOCProveedor') ? el('proyOCProveedor').value.trim() : '';
        var quantity = el('proyOCCantidad') ? parseInt(el('proyOCCantidad').value) || 0 : 0;
        var unitPrice = el('proyOCPrecioUnit') ? parseFloat(el('proyOCPrecioUnit').value) || 0 : 0;
        var deliveryDate = el('proyOCFechaEntrega') ? el('proyOCFechaEntrega').value : '';
        var notes = el('proyOCNotas') ? el('proyOCNotas').value.trim() : '';

        if (!supplier) return;

        _fetch('/app/api/iamet/oc/crear/', {
            method: 'POST',
            body: {
                proyecto_id: currentProjectId,
                partida_id: partidaId || null,
                proveedor: supplier,
                cantidad: quantity,
                precio_unitario: unitPrice,
                fecha_entrega_esperada: deliveryDate,
                notas: notes
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoOC');
                // Clear form
                if (el('proyOCPartida')) el('proyOCPartida').value = '';
                if (el('proyOCProveedor')) el('proyOCProveedor').value = '';
                if (el('proyOCCantidad')) el('proyOCCantidad').value = '';
                if (el('proyOCPrecioUnit')) el('proyOCPrecioUnit').value = '';
                if (el('proyOCFechaEntrega')) el('proyOCFechaEntrega').value = '';
                if (el('proyOCNotas')) el('proyOCNotas').value = '';
                renderOC(currentProjectId);
            } else {
                alert('Error al crear OC: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al crear OC');
            console.error('Error creando OC:', err);
        });
    };

    window.proyectosGuardarTarea = function() {
        if (!currentProjectId) return;

        var title = el('proyTareaTitulo') ? el('proyTareaTitulo').value.trim() : '';
        var desc = el('proyTareaDescripcion') ? el('proyTareaDescripcion').value.trim() : '';
        var priority = el('proyTareaPrioridad') ? el('proyTareaPrioridad').value : 'medium';
        var assignedTo = el('proyTareaAsignado') ? el('proyTareaAsignado').value.trim() : '';
        var dueDate = el('proyTareaFecha') ? el('proyTareaFecha').value : '';

        if (!title) return;

        _fetch('/app/api/iamet/tareas/crear/', {
            method: 'POST',
            body: {
                proyecto_id: currentProjectId,
                titulo: title,
                descripcion: desc,
                prioridad: priority,
                asignado_a: assignedTo,
                fecha_limite: dueDate
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoTarea');
                // Clear form
                if (el('proyTareaTitulo')) el('proyTareaTitulo').value = '';
                if (el('proyTareaDescripcion')) el('proyTareaDescripcion').value = '';
                if (el('proyTareaPrioridad')) el('proyTareaPrioridad').value = 'medium';
                if (el('proyTareaAsignado')) el('proyTareaAsignado').value = '';
                if (el('proyTareaFecha')) el('proyTareaFecha').value = '';
                renderTareas(currentProjectId);
            } else {
                alert('Error al crear tarea: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al crear tarea');
            console.error('Error creando tarea:', err);
        });
    };

    window.proyectosGuardarFacturaProveedor = function() {
        if (!currentProjectId) return;

        var invoiceNumber = el('proyFacProvNumero') ? el('proyFacProvNumero').value.trim() : '';
        var supplier = el('proyFacProvProveedor') ? el('proyFacProvProveedor').value.trim() : '';
        var amount = el('proyFacProvMonto') ? parseFloat(el('proyFacProvMonto').value) || 0 : 0;
        var budgeted = el('proyFacProvPresupuestado') ? parseFloat(el('proyFacProvPresupuestado').value) || 0 : 0;
        var invoiceDate = el('proyFacProvFecha') ? el('proyFacProvFecha').value : '';
        var notes = el('proyFacProvNotas') ? el('proyFacProvNotas').value.trim() : '';

        if (!invoiceNumber || !supplier) return;

        _fetch('/app/api/iamet/facturas-proveedor/crear/', {
            method: 'POST',
            body: {
                proyecto_id: currentProjectId,
                numero_factura: invoiceNumber,
                proveedor: supplier,
                monto: amount,
                monto_presupuestado: budgeted,
                fecha_factura: invoiceDate,
                notas: notes
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoFacProv');
                // Clear form
                if (el('proyFacProvNumero')) el('proyFacProvNumero').value = '';
                if (el('proyFacProvProveedor')) el('proyFacProvProveedor').value = '';
                if (el('proyFacProvMonto')) el('proyFacProvMonto').value = '';
                if (el('proyFacProvPresupuestado')) el('proyFacProvPresupuestado').value = '';
                if (el('proyFacProvFecha')) el('proyFacProvFecha').value = '';
                if (el('proyFacProvNotas')) el('proyFacProvNotas').value = '';
                renderSupplierInvoices(currentProjectId);
            } else {
                alert('Error al crear factura: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al crear factura proveedor');
            console.error('Error creando factura proveedor:', err);
        });
    };

    window.proyectosGuardarFacturaIngreso = function() {
        if (!currentProjectId) return;

        var invoiceNumber = el('proyFacIngNumero') ? el('proyFacIngNumero').value.trim() : '';
        var amount = el('proyFacIngMonto') ? parseFloat(el('proyFacIngMonto').value) || 0 : 0;
        var invoiceDate = el('proyFacIngFecha') ? el('proyFacIngFecha').value : '';
        var paymentMethod = el('proyFacIngMetodo') ? el('proyFacIngMetodo').value.trim() : '';
        var notes = el('proyFacIngNotas') ? el('proyFacIngNotas').value.trim() : '';

        if (!invoiceNumber) return;

        _fetch('/app/api/iamet/facturas-ingreso/crear/', {
            method: 'POST',
            body: {
                proyecto_id: currentProjectId,
                numero_factura: invoiceNumber,
                monto: amount,
                fecha_factura: invoiceDate,
                metodo_pago: paymentMethod,
                notas: notes
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoFacIng');
                // Clear form
                if (el('proyFacIngNumero')) el('proyFacIngNumero').value = '';
                if (el('proyFacIngMonto')) el('proyFacIngMonto').value = '';
                if (el('proyFacIngFecha')) el('proyFacIngFecha').value = '';
                if (el('proyFacIngMetodo')) el('proyFacIngMetodo').value = '';
                if (el('proyFacIngNotas')) el('proyFacIngNotas').value = '';
                renderRevenueInvoices(currentProjectId);
            } else {
                alert('Error al crear factura: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al crear factura ingreso');
            console.error('Error creando factura ingreso:', err);
        });
    };

    window.proyectosGuardarGasto = function() {
        if (!currentProjectId) return;

        var category = el('proyGastoCategoria') ? el('proyGastoCategoria').value.trim() : '';
        var desc = el('proyGastoDescripcion') ? el('proyGastoDescripcion').value.trim() : '';
        var amount = el('proyGastoMonto') ? parseFloat(el('proyGastoMonto').value) || 0 : 0;
        var expenseDate = el('proyGastoFecha') ? el('proyGastoFecha').value : '';
        var notes = el('proyGastoNotas') ? el('proyGastoNotas').value.trim() : '';

        if (!desc || amount <= 0) return;

        _fetch('/app/api/iamet/gastos/crear/', {
            method: 'POST',
            body: {
                proyecto_id: currentProjectId,
                categoria: category,
                descripcion: desc,
                monto: amount,
                fecha_gasto: expenseDate,
                notas: notes
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoGasto');
                // Clear form
                if (el('proyGastoCategoria')) el('proyGastoCategoria').value = '';
                if (el('proyGastoDescripcion')) el('proyGastoDescripcion').value = '';
                if (el('proyGastoMonto')) el('proyGastoMonto').value = '';
                if (el('proyGastoFecha')) el('proyGastoFecha').value = '';
                if (el('proyGastoNotas')) el('proyGastoNotas').value = '';
                renderExpenses(currentProjectId);
            } else {
                alert('Error al crear gasto: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al crear gasto');
            console.error('Error creando gasto:', err);
        });
    };

    window.proyectosAprobarGasto = function(gastoId, accion) {
        _fetch('/app/api/iamet/gastos/' + gastoId + '/aprobar/', {
            method: 'POST',
            body: { accion: accion }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                if (currentProjectId) renderExpenses(currentProjectId);
            } else {
                alert('Error: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion');
            console.error('Error aprobando gasto:', err);
        });
    };

    window.proyectosEliminarProyecto = function(projectId) {
        if (!confirm('Estas seguro de eliminar este proyecto?')) return;

        _fetch('/app/api/iamet/proyectos/' + projectId + '/eliminar/', {
            method: 'POST'
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosVolverLista();
                proyectosCargarLista();
            } else {
                alert('Error al eliminar: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al eliminar proyecto');
            console.error('Error eliminando proyecto:', err);
        });
    };

    window.proyectosEliminarPartida = function(partidaId) {
        if (!confirm('Estas seguro de eliminar esta partida?')) return;

        _fetch('/app/api/iamet/partidas/' + partidaId + '/eliminar/', {
            method: 'POST'
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                if (currentProjectId) renderPartidas(currentProjectId);
            } else {
                alert('Error al eliminar: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al eliminar partida');
            console.error('Error eliminando partida:', err);
        });
    };


    // =========================================
    //  BACKDROP CLICK TO CLOSE (overlays only)
    // =========================================

    document.addEventListener('click', function(e) {
        // Close detail overlay when clicking on its backdrop
        if (e.target && e.target.id === 'widgetProyectoDetalle') {
            proyectosVolverLista();
        }
        // Close sub-dialogs when clicking on their backdrop
        if (e.target && e.target.classList.contains('proy-dialog-overlay')) {
            e.target.style.display = 'none';
        }
    });

})();
