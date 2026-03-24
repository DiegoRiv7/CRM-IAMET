/* ============================================================
   crm_proyectos.js  --  Modulo Proyectos (widget fullscreen)
   ============================================================ */
(function() {
    'use strict';

    // ─── State ───
    var currentProjectId = null;
    var currentFilter = 'todos';
    var currentTab = 'partidas';

    // ─── Sample Data ───

    var PROY_PROJECTS = [
        { id:1, name:'Instalacion CCTV Torre Norte', client:'Telcel', status:'active', description:'Instalacion de 48 camaras IP y NVR centralizado', budgetedProfit:450000, actualProfit:380000, startDate:'2026-01-15', endDate:'2026-06-30' },
        { id:2, name:'Fibra Optica Reforma 222', client:'AT&T Mexico', status:'planning', description:'Tendido de fibra optica en edificio corporativo', budgetedProfit:1200000, actualProfit:0, startDate:'2026-03-01', endDate:'2026-09-15' },
        { id:3, name:'Control de Acceso Planta Monterrey', client:'FEMSA', status:'completed', description:'Sistema de control de acceso biometrico para 12 puntos', budgetedProfit:800000, actualProfit:920000, startDate:'2025-11-01', endDate:'2026-02-28' },
        { id:4, name:'Red WiFi Campus UNAM', client:'UNAM', status:'active', description:'Implementacion de red WiFi 6E en 5 edificios', budgetedProfit:650000, actualProfit:410000, startDate:'2026-02-01', endDate:'2026-07-31' },
        { id:5, name:'Videovigilancia Centro Comercial', client:'Liverpool', status:'paused', description:'Upgrade de sistema analogico a IP - 120 camaras', budgetedProfit:1500000, actualProfit:200000, startDate:'2026-01-20', endDate:'2026-08-30' },
    ];

    var PROY_LINE_ITEMS = {
        1: [
            { id:1, category:'Equipamiento', description:'Camara IP 4MP Bullet', brand:'AXIS', partNumber:'P3245-V', quantity:48, remaining:12, listPrice:8500, discount:15, unitCost:7225, unitSale:12000, profit:4775, supplier:'Ingram Micro', status:'ordered' },
            { id:2, category:'Equipamiento', description:'NVR 64 canales', brand:'GENETEC', partNumber:'GSC-NVR64', quantity:2, remaining:0, listPrice:185000, discount:10, unitCost:166500, unitSale:250000, profit:83500, supplier:'CT Internacional', status:'received' },
            { id:3, category:'Accesorios', description:'Cable UTP Cat6 305m', brand:'PANDUIT', partNumber:'PUP6C04BU-FE', quantity:20, remaining:5, listPrice:3200, discount:20, unitCost:2560, unitSale:4500, profit:1940, supplier:'Panduit Direct', status:'ordered' },
            { id:4, category:'Mano de Obra', description:'Instalacion por camara', brand:'\u2014', partNumber:'\u2014', quantity:48, remaining:48, listPrice:0, discount:0, unitCost:1500, unitSale:3500, profit:2000, supplier:'Interno', status:'pending' },
            { id:5, category:'Accesorios', description:'Montaje para poste', brand:'AXIS', partNumber:'T91B61', quantity:24, remaining:10, listPrice:1800, discount:12, unitCost:1584, unitSale:2800, profit:1216, supplier:'Ingram Micro', status:'in_transit' },
        ],
        2: [], 3: [], 4: [], 5: []
    };

    var PROY_PURCHASE_ORDERS = {
        1: [
            { id:1, poNumber:'OC-2026-001', supplier:'Ingram Micro', item:'Camara IP 4MP Bullet x36', quantity:36, amount:260100, status:'received', date:'2026-02-01' },
            { id:2, poNumber:'OC-2026-002', supplier:'CT Internacional', item:'NVR 64 canales x2', quantity:2, amount:333000, status:'received', date:'2026-01-25' },
            { id:3, poNumber:'OC-2026-003', supplier:'Panduit Direct', item:'Cable UTP Cat6 x15', quantity:15, amount:38400, status:'emitted', date:'2026-03-10' },
        ],
        2: [], 3: [], 4: [], 5: []
    };

    var PROY_TASKS = {
        1: [
            { id:1, title:'Levantamiento de sitio', priority:'high', assignedTo:'Carlos Mendez', dueDate:'2026-02-15', status:'completed' },
            { id:2, title:'Instalacion de cableado estructurado', priority:'critical', assignedTo:'Eduardo Rios', dueDate:'2026-03-20', status:'in_progress' },
            { id:3, title:'Configuracion de NVR', priority:'medium', assignedTo:'Laura Herrera', dueDate:'2026-04-01', status:'pending' },
            { id:4, title:'Pruebas de video y grabacion', priority:'high', assignedTo:'Carlos Mendez', dueDate:'2026-04-15', status:'pending' },
        ],
        2: [], 3: [], 4: [], 5: []
    };

    var PROY_ALERTS = {
        1: [
            { id:1, type:'budget_variance', severity:'warning', title:'Varianza en costo de camaras', message:'El costo real supera el presupuestado en 8.2%', resolved:false },
            { id:2, type:'low_stock', severity:'critical', title:'Stock critico: Cable UTP', message:'Solo quedan 5 bobinas de 20 presupuestadas', resolved:false },
            { id:3, type:'task_overdue', severity:'warning', title:'Tarea vencida: Instalacion cableado', message:'La fecha limite fue el 20 de marzo', resolved:false },
            { id:4, type:'expense_pending', severity:'info', title:'Gasto pendiente de aprobacion', message:'Viaticos por $12,500 pendientes de aprobacion', resolved:false },
        ],
        2: [], 3: [], 4: [], 5: []
    };

    var PROY_SUPPLIER_INVOICES = {
        1: [
            { id:1, invoiceNumber:'FAC-IM-4521', supplier:'Ingram Micro', amount:260100, budgeted:252000, variance:8100, variancePct:3.2, status:'paid', date:'2026-02-15' },
            { id:2, invoiceNumber:'FAC-CT-1893', supplier:'CT Internacional', amount:333000, budgeted:333000, variance:0, variancePct:0, status:'received', date:'2026-02-01' },
        ],
        2: [], 3: [], 4: [], 5: []
    };

    var PROY_REVENUE_INVOICES = {
        1: [
            { id:1, invoiceNumber:'FI-2026-0045', amount:450000, date:'2026-03-01', status:'paid' },
            { id:2, invoiceNumber:'FI-2026-0078', amount:380000, date:'2026-03-15', status:'emitted' },
        ],
        2: [], 3: [], 4: [], 5: []
    };

    var PROY_EXPENSES = {
        1: [
            { id:1, category:'Viaticos', description:'Viaje a sitio Torre Norte', amount:12500, approval:'pending' },
            { id:2, category:'Combustible', description:'Diesel camioneta proyecto', amount:4800, approval:'approved' },
            { id:3, category:'Hospedaje', description:'Hotel 3 noches equipo instalacion', amount:8700, approval:'approved' },
        ],
        2: [], 3: [], 4: [], 5: []
    };


    // ═══════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════

    function fmtMoney(val) {
        return '$' + Number(val || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
    }

    function fmtDate(dateStr) {
        if (!dateStr) return '\u2014';
        var months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        var parts = dateStr.split('-');
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

    function getProject(id) {
        for (var i = 0; i < PROY_PROJECTS.length; i++) {
            if (PROY_PROJECTS[i].id === id) return PROY_PROJECTS[i];
        }
        return null;
    }

    function el(id) {
        return document.getElementById(id);
    }


    // ═══════════════════════════════════════
    //  OPEN / CLOSE
    // ═══════════════════════════════════════

    window.proyectosAbrir = function() {
        var w = el('widgetProyectos');
        if (!w) return;
        w.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        currentProjectId = null;
        currentFilter = 'todos';
        currentTab = 'partidas';
        proyectosCargarLista();
        // Set active state on topbar button
        var btn = el('btnProyectos');
        if (btn) btn.classList.add('active');
    };

    window.proyectosCerrar = function() {
        var w = el('widgetProyectos');
        if (!w) return;
        w.style.display = 'none';
        document.body.style.overflow = '';
        proyectosVolverLista();
        var btn = el('btnProyectos');
        if (btn) btn.classList.remove('active');
    };


    // ═══════════════════════════════════════
    //  LIST VIEW
    // ═══════════════════════════════════════

    function proyectosCargarLista() {
        var listView = el('proyListView');
        var detailView = el('proyDetailView');
        if (listView) listView.style.display = '';
        if (detailView) detailView.style.display = 'none';

        var filtered;
        if (currentFilter === 'todos') {
            filtered = PROY_PROJECTS;
        } else {
            filtered = PROY_PROJECTS.filter(function(p) { return p.status === currentFilter; });
        }

        // Update filter pill active state
        var pills = document.querySelectorAll('.proy-filter-pill');
        pills.forEach(function(pill) {
            pill.classList.toggle('active', pill.getAttribute('data-filter') === currentFilter);
        });

        // Update counts
        updateFilterCounts();

        renderProjectCards(filtered);
    }

    function updateFilterCounts() {
        var countAll = PROY_PROJECTS.length;
        var countActive = PROY_PROJECTS.filter(function(p) { return p.status === 'active'; }).length;
        var countPlanning = PROY_PROJECTS.filter(function(p) { return p.status === 'planning'; }).length;
        var countPaused = PROY_PROJECTS.filter(function(p) { return p.status === 'paused'; }).length;
        var countCompleted = PROY_PROJECTS.filter(function(p) { return p.status === 'completed'; }).length;

        var cAll = el('proyCntAll');
        var cAct = el('proyCntActive');
        var cPlan = el('proyCntPlanning');
        var cPaus = el('proyCntPaused');
        var cComp = el('proyCntCompleted');

        if (cAll) cAll.textContent = countAll;
        if (cAct) cAct.textContent = countActive;
        if (cPlan) cPlan.textContent = countPlanning;
        if (cPaus) cPaus.textContent = countPaused;
        if (cComp) cComp.textContent = countCompleted;
    }

    window.proyectosFilterStatus = function(status) {
        currentFilter = status;
        proyectosCargarLista();
    };


    // ═══════════════════════════════════════
    //  RENDER: PROJECT CARDS
    // ═══════════════════════════════════════

    function renderProjectCards(projects) {
        var grid = el('proyGrid');
        if (!grid) return;

        if (projects.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:#94a3b8">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;margin:0 auto 12px;opacity:.5"><path d="M2 9l10-6 10 6-10 6-10-6z"/><path d="M2 15l10 6 10-6"/></svg>' +
                '<p style="font-size:15px;margin:0">No hay proyectos con este filtro</p></div>';
            return;
        }

        var html = '';
        projects.forEach(function(p) {
            var pct = p.budgetedProfit > 0 ? Math.min(Math.round(p.actualProfit / p.budgetedProfit * 100), 100) : 0;
            var profitOk = p.actualProfit >= p.budgetedProfit;
            var barColor = profitOk ? '#10b981' : (pct >= 60 ? '#f59e0b' : '#ef4444');

            // Unresolved alert count
            var alerts = PROY_ALERTS[p.id] || [];
            var unresolved = alerts.filter(function(a) { return !a.resolved; }).length;

            html += '<div class="proy-card" onclick="proyectosVerDetalle(' + p.id + ')">' +
                '<div class="proy-card-header">' +
                    '<div style="flex:1;min-width:0">' +
                        '<div class="proy-card-title">' + truncate(p.name, 45) + '</div>' +
                        '<div class="proy-card-client">' + p.client + '</div>' +
                    '</div>' +
                    '<span class="proy-badge ' + statusClass(p.status) + '">' + statusLabel(p.status) + '</span>' +
                '</div>' +
                '<div class="proy-card-desc">' + truncate(p.description, 80) + '</div>' +
                '<div class="proy-card-profit">' +
                    '<div style="display:flex;justify-content:space-between;margin-bottom:6px">' +
                        '<span style="font-size:12px;color:#94a3b8">Utilidad</span>' +
                        '<span style="font-size:12px;font-weight:600;color:' + (profitOk ? '#10b981' : '#e2e8f0') + '">' + fmtMoney(p.actualProfit) + ' / ' + fmtMoney(p.budgetedProfit) + '</span>' +
                    '</div>' +
                    '<div class="proy-progress-track">' +
                        '<div class="proy-progress-fill" style="width:' + pct + '%;background:' + barColor + '"></div>' +
                    '</div>' +
                    '<div style="text-align:right;font-size:11px;color:#64748b;margin-top:3px">' + pct + '%</div>' +
                '</div>' +
                '<div class="proy-card-footer">' +
                    '<span style="font-size:12px;color:#64748b">' + fmtDate(p.startDate) + ' \u2014 ' + fmtDate(p.endDate) + '</span>' +
                    (unresolved > 0 ? '<span class="proy-alert-count" title="' + unresolved + ' alertas">' + unresolved + '</span>' : '') +
                '</div>' +
            '</div>';
        });

        grid.innerHTML = html;
    }


    // ═══════════════════════════════════════
    //  DETAIL VIEW
    // ═══════════════════════════════════════

    window.proyectosVerDetalle = function(projectId) {
        var project = getProject(projectId);
        if (!project) return;

        currentProjectId = projectId;
        currentTab = 'partidas';

        var listView = el('proyListView');
        var detailView = el('proyDetailView');
        if (listView) listView.style.display = 'none';
        if (detailView) detailView.style.display = '';

        // Header
        var hName = el('proyDetailName');
        var hStatus = el('proyDetailStatus');
        var hClient = el('proyDetailClient');
        var hDates = el('proyDetailDates');
        var hDesc = el('proyDetailDesc');

        if (hName) hName.textContent = project.name;
        if (hStatus) {
            hStatus.textContent = statusLabel(project.status);
            hStatus.className = 'proy-badge ' + statusClass(project.status);
        }
        if (hClient) hClient.textContent = project.client;
        if (hDates) hDates.textContent = fmtDate(project.startDate) + '  \u2192  ' + fmtDate(project.endDate);
        if (hDesc) hDesc.textContent = project.description;

        renderKPIs(project);
        proyectosSetTab('partidas');
    };

    window.proyectosVolverLista = function() {
        currentProjectId = null;
        var listView = el('proyListView');
        var detailView = el('proyDetailView');
        if (listView) listView.style.display = '';
        if (detailView) detailView.style.display = 'none';
    };


    // ═══════════════════════════════════════
    //  KPIs
    // ═══════════════════════════════════════

    function renderKPIs(project) {
        var kpiContainer = el('proyKPIs');
        if (!kpiContainer) return;

        var margin = project.budgetedProfit > 0 ? Math.round(project.actualProfit / project.budgetedProfit * 100) : 0;
        var profitOk = project.actualProfit >= project.budgetedProfit;

        // Calculate cost coverage from line items
        var items = PROY_LINE_ITEMS[project.id] || [];
        var totalCost = 0;
        var totalSale = 0;
        items.forEach(function(item) {
            totalCost += item.unitCost * item.quantity;
            totalSale += item.unitSale * item.quantity;
        });
        var coverage = totalCost > 0 ? Math.round(totalSale / totalCost * 100) : 0;

        // Unresolved alerts
        var alerts = PROY_ALERTS[project.id] || [];
        var unresolved = alerts.filter(function(a) { return !a.resolved; }).length;

        kpiContainer.innerHTML =
            '<div class="proy-kpi-card">' +
                '<div class="proy-kpi-label">Utilidad Presupuestada</div>' +
                '<div class="proy-kpi-value">' + fmtMoney(project.budgetedProfit) + '</div>' +
            '</div>' +
            '<div class="proy-kpi-card">' +
                '<div class="proy-kpi-label">Utilidad Real</div>' +
                '<div class="proy-kpi-value" style="color:' + (profitOk ? '#10b981' : '#ef4444') + '">' + fmtMoney(project.actualProfit) + '</div>' +
            '</div>' +
            '<div class="proy-kpi-card">' +
                '<div class="proy-kpi-label">Margen</div>' +
                '<div class="proy-kpi-value" style="color:' + (margin >= 100 ? '#10b981' : margin >= 70 ? '#f59e0b' : '#ef4444') + '">' + margin + '%</div>' +
            '</div>' +
            '<div class="proy-kpi-card">' +
                '<div class="proy-kpi-label">Cobertura de Costos</div>' +
                '<div class="proy-kpi-value">' + coverage + '%</div>' +
            '</div>' +
            '<div class="proy-kpi-card">' +
                '<div class="proy-kpi-label">Alertas</div>' +
                '<div class="proy-kpi-value" style="color:' + (unresolved > 0 ? '#ef4444' : '#10b981') + '">' + unresolved + '</div>' +
            '</div>';
    }


    // ═══════════════════════════════════════
    //  TABS
    // ═══════════════════════════════════════

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
            case 'partidas':   renderPartidas(currentProjectId); break;
            case 'oc':         renderOC(currentProjectId); break;
            case 'financiero': renderFinanciero(currentProjectId); break;
            case 'tareas':     renderTareas(currentProjectId); break;
            case 'alertas':    renderAlertas(currentProjectId); break;
        }
    };


    // ═══════════════════════════════════════
    //  RENDER: PARTIDAS (Line Items)
    // ═══════════════════════════════════════

    function renderPartidas(projectId) {
        var container = el('proyPartidasBody');
        if (!container) return;

        var items = PROY_LINE_ITEMS[projectId] || [];
        if (items.length === 0) {
            container.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:40px;color:#64748b">No hay partidas registradas</td></tr>';
            return;
        }

        var html = '';
        items.forEach(function(item) {
            var totalCost = item.unitCost * item.quantity;
            var totalSale = item.unitSale * item.quantity;
            var totalProfit = item.profit * item.quantity;

            html += '<tr>' +
                '<td>' + categoryDot(item.category) + item.category + '</td>' +
                '<td title="' + item.description + '">' + truncate(item.description, 28) + '</td>' +
                '<td>' + item.brand + '</td>' +
                '<td style="font-size:11px;color:#94a3b8">' + item.partNumber + '</td>' +
                '<td style="text-align:center">' + item.quantity + '</td>' +
                '<td style="text-align:center;color:' + (item.remaining > 0 ? '#f59e0b' : '#10b981') + '">' + item.remaining + '</td>' +
                '<td style="text-align:right">' + fmtMoney(item.listPrice) + '</td>' +
                '<td style="text-align:center">' + item.discount + '%</td>' +
                '<td style="text-align:right">' + fmtMoney(item.unitCost) + '</td>' +
                '<td style="text-align:right">' + fmtMoney(item.unitSale) + '</td>' +
                '<td style="text-align:right;color:#10b981">' + fmtMoney(totalProfit) + '</td>' +
                '<td>' + truncate(item.supplier, 16) + '</td>' +
                '<td><span class="proy-badge ' + statusClass(item.status) + '">' + statusLabel(item.status) + '</span></td>' +
            '</tr>';
        });

        container.innerHTML = html;

        // Totals
        var totalsCost = 0, totalsSale = 0, totalsProfit = 0;
        items.forEach(function(item) {
            totalsCost += item.unitCost * item.quantity;
            totalsSale += item.unitSale * item.quantity;
            totalsProfit += item.profit * item.quantity;
        });

        var foot = el('proyPartidasFoot');
        if (foot) {
            foot.innerHTML = '<tr style="font-weight:600;border-top:2px solid #334155">' +
                '<td colspan="8" style="text-align:right;color:#94a3b8">Totales</td>' +
                '<td style="text-align:right">' + fmtMoney(totalsCost) + '</td>' +
                '<td style="text-align:right">' + fmtMoney(totalsSale) + '</td>' +
                '<td style="text-align:right;color:#10b981">' + fmtMoney(totalsProfit) + '</td>' +
                '<td colspan="2"></td>' +
            '</tr>';
        }
    }


    // ═══════════════════════════════════════
    //  RENDER: ORDENES DE COMPRA
    // ═══════════════════════════════════════

    function renderOC(projectId) {
        var container = el('proyOCBody');
        if (!container) return;

        var orders = PROY_PURCHASE_ORDERS[projectId] || [];
        if (orders.length === 0) {
            container.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#64748b">No hay ordenes de compra</td></tr>';
            return;
        }

        var html = '';
        orders.forEach(function(oc) {
            html += '<tr>' +
                '<td style="font-weight:600;color:#93c5fd">' + oc.poNumber + '</td>' +
                '<td>' + oc.supplier + '</td>' +
                '<td>' + oc.item + '</td>' +
                '<td style="text-align:center">' + oc.quantity + '</td>' +
                '<td style="text-align:right">' + fmtMoney(oc.amount) + '</td>' +
                '<td><span class="proy-badge ' + statusClass(oc.status) + '">' + statusLabel(oc.status) + '</span></td>' +
                '<td>' + fmtDate(oc.date) + '</td>' +
            '</tr>';
        });

        container.innerHTML = html;

        // OC total
        var total = 0;
        orders.forEach(function(oc) { total += oc.amount; });
        var foot = el('proyOCFoot');
        if (foot) {
            foot.innerHTML = '<tr style="font-weight:600;border-top:2px solid #334155">' +
                '<td colspan="4" style="text-align:right;color:#94a3b8">Total OC</td>' +
                '<td style="text-align:right">' + fmtMoney(total) + '</td>' +
                '<td colspan="2"></td>' +
            '</tr>';
        }
    }


    // ═══════════════════════════════════════
    //  RENDER: FINANCIERO
    // ═══════════════════════════════════════

    function renderFinanciero(projectId) {
        renderSupplierInvoices(projectId);
        renderRevenueInvoices(projectId);
        renderExpenses(projectId);
    }

    function renderSupplierInvoices(projectId) {
        var container = el('proyFacProvBody');
        if (!container) return;

        var invoices = PROY_SUPPLIER_INVOICES[projectId] || [];
        if (invoices.length === 0) {
            container.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#64748b">No hay facturas de proveedores</td></tr>';
            return;
        }

        var html = '';
        invoices.forEach(function(inv) {
            var varianceColor = inv.variance > 0 ? '#ef4444' : (inv.variance < 0 ? '#10b981' : '#64748b');
            html += '<tr>' +
                '<td style="font-weight:600;color:#93c5fd">' + inv.invoiceNumber + '</td>' +
                '<td>' + inv.supplier + '</td>' +
                '<td style="text-align:right">' + fmtMoney(inv.amount) + '</td>' +
                '<td style="text-align:right">' + fmtMoney(inv.budgeted) + '</td>' +
                '<td style="text-align:right;color:' + varianceColor + '">' + (inv.variance > 0 ? '+' : '') + fmtMoney(inv.variance) + '</td>' +
                '<td style="text-align:right;color:' + varianceColor + '">' + (inv.variancePct > 0 ? '+' : '') + inv.variancePct + '%</td>' +
                '<td><span class="proy-badge ' + statusClass(inv.status) + '">' + statusLabel(inv.status) + '</span></td>' +
                '<td>' + fmtDate(inv.date) + '</td>' +
            '</tr>';
        });

        container.innerHTML = html;
    }

    function renderRevenueInvoices(projectId) {
        var container = el('proyFacIngBody');
        if (!container) return;

        var invoices = PROY_REVENUE_INVOICES[projectId] || [];
        if (invoices.length === 0) {
            container.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#64748b">No hay facturas de ingreso</td></tr>';
            return;
        }

        var html = '';
        var total = 0;
        invoices.forEach(function(inv) {
            total += inv.amount;
            html += '<tr>' +
                '<td style="font-weight:600;color:#93c5fd">' + inv.invoiceNumber + '</td>' +
                '<td style="text-align:right">' + fmtMoney(inv.amount) + '</td>' +
                '<td><span class="proy-badge ' + statusClass(inv.status) + '">' + statusLabel(inv.status) + '</span></td>' +
                '<td>' + fmtDate(inv.date) + '</td>' +
            '</tr>';
        });

        container.innerHTML = html;

        var foot = el('proyFacIngFoot');
        if (foot) {
            foot.innerHTML = '<tr style="font-weight:600;border-top:2px solid #334155">' +
                '<td style="text-align:right;color:#94a3b8">Total</td>' +
                '<td style="text-align:right">' + fmtMoney(total) + '</td>' +
                '<td colspan="2"></td>' +
            '</tr>';
        }
    }

    function renderExpenses(projectId) {
        var container = el('proyGastosBody');
        if (!container) return;

        var expenses = PROY_EXPENSES[projectId] || [];
        if (expenses.length === 0) {
            container.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#64748b">No hay gastos registrados</td></tr>';
            return;
        }

        var html = '';
        var total = 0;
        expenses.forEach(function(exp) {
            total += exp.amount;
            html += '<tr>' +
                '<td>' + exp.category + '</td>' +
                '<td>' + exp.description + '</td>' +
                '<td style="text-align:right">' + fmtMoney(exp.amount) + '</td>' +
                '<td><span class="proy-badge ' + statusClass(exp.approval) + '">' + statusLabel(exp.approval) + '</span></td>' +
            '</tr>';
        });

        container.innerHTML = html;

        var foot = el('proyGastosFoot');
        if (foot) {
            foot.innerHTML = '<tr style="font-weight:600;border-top:2px solid #334155">' +
                '<td colspan="2" style="text-align:right;color:#94a3b8">Total Gastos</td>' +
                '<td style="text-align:right">' + fmtMoney(total) + '</td>' +
                '<td></td>' +
            '</tr>';
        }
    }


    // ═══════════════════════════════════════
    //  RENDER: TAREAS
    // ═══════════════════════════════════════

    function renderTareas(projectId) {
        var container = el('proyTareasBody');
        if (!container) return;

        var tasks = PROY_TASKS[projectId] || [];
        if (tasks.length === 0) {
            container.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:#64748b">No hay tareas registradas</td></tr>';
            return;
        }

        var html = '';
        tasks.forEach(function(t) {
            html += '<tr>' +
                '<td style="font-weight:500">' + t.title + '</td>' +
                '<td><span class="proy-badge ' + priorityClass(t.priority) + '">' + priorityLabel(t.priority) + '</span></td>' +
                '<td>' + t.assignedTo + '</td>' +
                '<td>' + fmtDate(t.dueDate) + '</td>' +
                '<td><span class="proy-badge ' + statusClass(t.status) + '">' + statusLabel(t.status) + '</span></td>' +
            '</tr>';
        });

        container.innerHTML = html;
    }


    // ═══════════════════════════════════════
    //  RENDER: ALERTAS
    // ═══════════════════════════════════════

    function renderAlertas(projectId) {
        var container = el('proyAlertasContainer');
        if (!container) return;

        var alerts = PROY_ALERTS[projectId] || [];
        if (alerts.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b">No hay alertas</div>';
            return;
        }

        var html = '';
        alerts.forEach(function(a) {
            var severityColors = { critical:'#ef4444', warning:'#f59e0b', info:'#3b82f6' };
            var bgColors = { critical:'rgba(239,68,68,0.08)', warning:'rgba(245,158,11,0.08)', info:'rgba(59,130,246,0.08)' };
            var borderColor = severityColors[a.severity] || '#3b82f6';
            var bgColor = bgColors[a.severity] || bgColors.info;

            html += '<div class="proy-alert-item' + (a.resolved ? ' resolved' : '') + '" style="border-left:3px solid ' + borderColor + ';background:' + bgColor + ';border-radius:8px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:flex-start;gap:12px;transition:opacity .2s' + (a.resolved ? ';opacity:.45' : '') + '">' +
                '<div style="color:' + borderColor + ';flex-shrink:0;margin-top:1px">' + severityIcon(a.severity) + '</div>' +
                '<div style="flex:1;min-width:0">' +
                    '<div style="font-weight:600;font-size:13px;color:#e2e8f0;margin-bottom:3px">' + a.title + '</div>' +
                    '<div style="font-size:12px;color:#94a3b8">' + a.message + '</div>' +
                '</div>' +
                (!a.resolved ? '<button class="proy-btn-sm" onclick="event.stopPropagation();proyectosResolverAlerta(' + projectId + ',' + a.id + ')" title="Marcar resuelta" style="flex-shrink:0">Resolver</button>' : '<span style="font-size:11px;color:#64748b;white-space:nowrap">Resuelta</span>') +
            '</div>';
        });

        container.innerHTML = html;
    }

    window.proyectosResolverAlerta = function(projectId, alertId) {
        var alerts = PROY_ALERTS[projectId] || [];
        for (var i = 0; i < alerts.length; i++) {
            if (alerts[i].id === alertId) {
                alerts[i].resolved = true;
                break;
            }
        }
        renderAlertas(projectId);
        // Re-render KPIs to update alert count
        var project = getProject(projectId);
        if (project) renderKPIs(project);
    };


    // ═══════════════════════════════════════
    //  DIALOGS
    // ═══════════════════════════════════════

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

    // ═══ Dialog form submissions (hardcoded, stubs for now) ═══

    window.proyectosGuardarProyecto = function() {
        var name = el('proyFormNombre') ? el('proyFormNombre').value.trim() : '';
        var client = el('proyFormCliente') ? el('proyFormCliente').value.trim() : '';
        var desc = el('proyFormDescripcion') ? el('proyFormDescripcion').value.trim() : '';
        var budget = el('proyFormPresupuesto') ? parseFloat(el('proyFormPresupuesto').value) || 0 : 0;
        var startDate = el('proyFormInicio') ? el('proyFormInicio').value : '';
        var endDate = el('proyFormFin') ? el('proyFormFin').value : '';

        if (!name || !client) return;

        var maxId = 0;
        PROY_PROJECTS.forEach(function(p) { if (p.id > maxId) maxId = p.id; });

        PROY_PROJECTS.push({
            id: maxId + 1,
            name: name,
            client: client,
            status: 'planning',
            description: desc,
            budgetedProfit: budget,
            actualProfit: 0,
            startDate: startDate,
            endDate: endDate
        });

        PROY_LINE_ITEMS[maxId + 1] = [];
        PROY_PURCHASE_ORDERS[maxId + 1] = [];
        PROY_TASKS[maxId + 1] = [];
        PROY_ALERTS[maxId + 1] = [];
        PROY_SUPPLIER_INVOICES[maxId + 1] = [];
        PROY_REVENUE_INVOICES[maxId + 1] = [];
        PROY_EXPENSES[maxId + 1] = [];

        proyectosCerrarDialogo('proyDialogoCrear');
        // Clear form
        if (el('proyFormNombre')) el('proyFormNombre').value = '';
        if (el('proyFormCliente')) el('proyFormCliente').value = '';
        if (el('proyFormDescripcion')) el('proyFormDescripcion').value = '';
        if (el('proyFormPresupuesto')) el('proyFormPresupuesto').value = '';
        if (el('proyFormInicio')) el('proyFormInicio').value = '';
        if (el('proyFormFin')) el('proyFormFin').value = '';

        proyectosCargarLista();
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

        var items = PROY_LINE_ITEMS[currentProjectId] || [];
        var maxId = 0;
        items.forEach(function(it) { if (it.id > maxId) maxId = it.id; });

        items.push({
            id: maxId + 1,
            category: category || 'Equipamiento',
            description: desc,
            brand: brand || '\u2014',
            partNumber: partNumber || '\u2014',
            quantity: quantity,
            remaining: quantity,
            listPrice: listPrice,
            discount: discount,
            unitCost: unitCost,
            unitSale: unitSale,
            profit: unitSale - unitCost,
            supplier: supplier || '\u2014',
            status: 'pending'
        });

        PROY_LINE_ITEMS[currentProjectId] = items;
        proyectosCerrarDialogo('proyDialogoPartida');
        renderPartidas(currentProjectId);
    };

    window.proyectosGuardarOC = function() {
        if (!currentProjectId) return;

        var poNumber = el('proyOCNumero') ? el('proyOCNumero').value.trim() : '';
        var supplier = el('proyOCProveedor') ? el('proyOCProveedor').value.trim() : '';
        var item = el('proyOCItem') ? el('proyOCItem').value.trim() : '';
        var quantity = el('proyOCCantidad') ? parseInt(el('proyOCCantidad').value) || 0 : 0;
        var amount = el('proyOCMonto') ? parseFloat(el('proyOCMonto').value) || 0 : 0;

        if (!poNumber || !supplier) return;

        var orders = PROY_PURCHASE_ORDERS[currentProjectId] || [];
        var maxId = 0;
        orders.forEach(function(o) { if (o.id > maxId) maxId = o.id; });

        orders.push({
            id: maxId + 1,
            poNumber: poNumber,
            supplier: supplier,
            item: item,
            quantity: quantity,
            amount: amount,
            status: 'draft',
            date: new Date().toISOString().split('T')[0]
        });

        PROY_PURCHASE_ORDERS[currentProjectId] = orders;
        proyectosCerrarDialogo('proyDialogoOC');
        renderOC(currentProjectId);
    };

    window.proyectosGuardarTarea = function() {
        if (!currentProjectId) return;

        var title = el('proyTareaTitulo') ? el('proyTareaTitulo').value.trim() : '';
        var priority = el('proyTareaPrioridad') ? el('proyTareaPrioridad').value : 'medium';
        var assignedTo = el('proyTareaAsignado') ? el('proyTareaAsignado').value.trim() : '';
        var dueDate = el('proyTareaFecha') ? el('proyTareaFecha').value : '';

        if (!title) return;

        var tasks = PROY_TASKS[currentProjectId] || [];
        var maxId = 0;
        tasks.forEach(function(t) { if (t.id > maxId) maxId = t.id; });

        tasks.push({
            id: maxId + 1,
            title: title,
            priority: priority,
            assignedTo: assignedTo || 'Sin asignar',
            dueDate: dueDate,
            status: 'pending'
        });

        PROY_TASKS[currentProjectId] = tasks;
        proyectosCerrarDialogo('proyDialogoTarea');
        renderTareas(currentProjectId);
    };


    // ═══════════════════════════════════════
    //  BACKDROP CLICK TO CLOSE
    // ═══════════════════════════════════════

    document.addEventListener('click', function(e) {
        // Close main widget when clicking on backdrop
        if (e.target && e.target.id === 'widgetProyectos') {
            proyectosCerrar();
        }
        // Close dialogs when clicking on backdrop
        if (e.target && e.target.classList.contains('proy-dialog-overlay')) {
            e.target.style.display = 'none';
        }
    });

})();
