/* ═══════════════════════════════════════════════════════════════════════
   compras_productos.js — UI de Productos (módulo Compras)
   - Vanilla JS (sin frameworks). IIFE.
   - Entry point: window.comprasProductosInit
   - Usa window.comprasFetch para todas las llamadas API
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // ════════════════════════════════════════════════════════════════════
    // ICONOS (SVG inline, estilo Lucide)
    // ════════════════════════════════════════════════════════════════════
    function svg(paths, size) {
        size = size || 16;
        var s = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
        if (Array.isArray(paths)) {
            for (var i = 0; i < paths.length; i++) s += '<path d="' + paths[i] + '"/>';
        } else {
            s += paths;
        }
        s += '</svg>';
        return s;
    }
    var I = {
        package: 'M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12',
        search: 'M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z',
        plus: 'M12 5v14M5 12h14',
        x: 'M18 6L6 18M6 6l12 12',
        check: 'M20 6L9 17l-5-5',
        edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z',
        trash: 'M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
        chevDown: 'M6 9l6 6 6-6',
        chevUp: 'M18 15l-6-6-6 6',
        chevLeft: 'M15 18l-6-6 6-6',
        chevRight: 'M9 18l6-6-6-6',
        chevDoubleLeft: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
        chevDoubleRight: 'M13 17l5-5-5-5M6 17l5-5-5-5',
        sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
        moreHorizontal: 'M12 12h.01M19 12h.01M5 12h.01',
        upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
        download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
        warning: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
        refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
        hash: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
        dollar: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
        percent: 'M19 5L5 19M6.5 9a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM17.5 20a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
        layers: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
        warehouse: 'M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35a2 2 0 0 1 1.26-1.86l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35zM6 18h12M6 14h12M6 10h12',
        info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
        fileText: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
        type: 'M4 7V4h16v3M9 20h6M12 4v16',
        coins: 'M8 14a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM15.5 2.5a7 7 0 1 1 5 13M16 14h-4',
        x9: 'M18 6L6 18M6 6l12 12',
        clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
        plusCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v8M8 12h8',
    };
    // Sentinel arrays for icons that need explicit multi-path arrays
    I.trashArr = ['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'];
    I.slidersArr = ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'];
    I.sortLinesArr = ['M3 6h18', 'M6 12h12', 'M10 18h4'];

    var SORT_OPTIONS = [
        { value: '-created_at', label: 'Más reciente' },
        { value: 'created_at',  label: 'Más antiguo' },
        { value: 'nombre',      label: 'Nombre (A→Z)' },
        { value: '-nombre',     label: 'Nombre (Z→A)' },
        { value: '-costo',      label: 'Costo (mayor)' },
        { value: 'costo',       label: 'Costo (menor)' },
        { value: 'codigo',      label: 'Código (A→Z)' },
        { value: '-codigo',     label: 'Código (Z→A)' }
    ];

    function ic(name, size) {
        var d = I[name];
        if (!d) return '';
        return svg(d, size || 14);
    }
    function icArr(arr, size) {
        return svg(arr, size || 14);
    }

    // ════════════════════════════════════════════════════════════════════
    // STATE
    // ════════════════════════════════════════════════════════════════════
    var state = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 14,
        totalPages: 1,
        q: '',
        tipo: 'todos',          // todos | PRODUCTO | SERVICIO
        estatus: 'todos',       // todos | activo | inactivo
        sort: '-created_at',
        loading: false,
        // CRUD
        detailItem: null,       // null = list view, object = detail view
        modalOpen: false,
        modalMode: null,        // 'create' | 'edit'
        modalDraft: null,
        modalErrors: {},
        confirmTarget: null,
        // Catálogos cache
        cfdiCache: [],
        unidadesCache: [],
        almacenesCache: [],
        catLoaded: false,
        catLoading: false,
        // UI flags
        filterOpen: false,
        sortOpen: false,
        accionesOpen: false,
        openPicker: null,       // 'cfdi' | 'unidad' | 'almacenes' | 'moneda' | 'iva' | null
        pickerSearch: '',
        importOpen: false,
        importResult: null,
    };

    // DOM cache
    var $section, $listView, $detailView, $modalContainer, $toastContainer;
    var searchTimer = null;
    var previewTimer = null;
    var $previewCard = null;
    var rowHoverEl = null;

    // ════════════════════════════════════════════════════════════════════
    // ENTRY POINT
    // ════════════════════════════════════════════════════════════════════
    function init() {
        $section = document.getElementById('comprasProductosSection');
        if (!$section) return;
        if ($section.dataset.initialized === '1') {
            // Already initialized: only refresh data
            fetchProductos();
            return;
        }
        $section.dataset.initialized = '1';
        renderShell();
        bindGlobalEvents();
        loadCatalogos();
        fetchProductos();
    }

    function renderShell() {
        $section.innerHTML =
            '<div class="cp-list-view" id="cpListView"></div>' +
            '<div class="cp-detail-view" id="cpDetailView" hidden></div>' +
            '<div class="cp-modal-container" id="cpModalContainer"></div>' +
            '<div class="cp-toast-container" id="cpToastContainer"></div>';
        $listView = document.getElementById('cpListView');
        $detailView = document.getElementById('cpDetailView');
        $modalContainer = document.getElementById('cpModalContainer');
        $toastContainer = document.getElementById('cpToastContainer');
    }

    function bindGlobalEvents() {
        // Esc closes modals/dropdowns/preview
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') {
                if (state.confirmTarget) { state.confirmTarget = null; renderModals(); return; }
                if (state.modalOpen) { closeModal(); return; }
                if (state.importOpen) { state.importOpen = false; state.importResult = null; renderModals(); return; }
                if (state.detailItem) { closeDetail(); return; }
                if (state.openPicker) { state.openPicker = null; renderModals(); return; }
                if (state.filterOpen || state.accionesOpen || state.sortOpen) {
                    state.filterOpen = false; state.accionesOpen = false; state.sortOpen = false; renderList();
                }
            }
        });
        // click outside dropdowns
        document.addEventListener('click', function (ev) {
            var t = ev.target;
            if (state.filterOpen && !t.closest('[data-cp-filter-wrap]')) {
                state.filterOpen = false; renderList();
            }
            if (state.sortOpen && !t.closest('[data-cp-sort-wrap]')) {
                state.sortOpen = false; renderList();
            }
            if (state.accionesOpen && !t.closest('[data-cp-acciones-wrap]')) {
                state.accionesOpen = false; renderList();
            }
            if (state.openPicker && !t.closest('[data-cp-picker]') && !t.closest('[data-cp-picker-trigger]')) {
                state.openPicker = null; renderModals();
            }
        }, true);
    }

    // ════════════════════════════════════════════════════════════════════
    // API
    // ════════════════════════════════════════════════════════════════════
    function fetchProductos() {
        state.loading = true;
        renderList();
        var params = new URLSearchParams();
        if (state.q) params.set('q', state.q);
        if (state.tipo && state.tipo !== 'todos') params.set('tipo', state.tipo);
        if (state.estatus && state.estatus !== 'todos') params.set('estatus', state.estatus);
        if (state.sort) params.set('sort', state.sort);
        params.set('page', state.page);
        params.set('page_size', state.pageSize);
        return window.comprasFetch('/app/api/compras/productos/?' + params.toString())
            .then(function (data) {
                state.items = data.items || [];
                state.total = data.total || 0;
                state.totalPages = data.total_pages || 1;
                state.loading = false;
                renderList();
            })
            .catch(function (e) {
                state.loading = false;
                state.items = [];
                renderList();
                toast('error', (e && e.error) || 'Error al cargar productos');
            });
    }

    function loadCatalogos(force) {
        if (state.catLoaded && !force) return Promise.resolve();
        if (state.catLoading) return state._catLoadingPromise || Promise.resolve();
        state.catLoading = true;
        var p1 = window.comprasFetch('/app/api/compras/claves-cfdi/').then(function (d) {
            state.cfdiCache = Array.isArray(d) ? d : (d.items || []);
        }).catch(function () { state.cfdiCache = []; });
        var p2 = window.comprasFetch('/app/api/compras/unidades-cfdi/').then(function (d) {
            state.unidadesCache = Array.isArray(d) ? d : (d.items || []);
        }).catch(function () { state.unidadesCache = []; });
        var p3 = window.comprasFetch('/app/api/compras/almacenes/').then(function (d) {
            state.almacenesCache = Array.isArray(d) ? d : (d.items || []);
        }).catch(function () { state.almacenesCache = []; });
        state._catLoadingPromise = Promise.all([p1, p2, p3]).then(function () {
            state.catLoaded = true;
            state.catLoading = false;
            // Re-render si hay un picker abierto que estaba mostrando "cargando"
            if (state.openPicker && state.modalOpen) renderModals();
        });
        return state._catLoadingPromise;
    }

    function searchClavesCfdi(q) {
        var url = '/app/api/compras/claves-cfdi/?q=' + encodeURIComponent(q || '');
        return window.comprasFetch(url).then(function (d) {
            return Array.isArray(d) ? d : (d.items || []);
        }).catch(function () { return []; });
    }

    // ════════════════════════════════════════════════════════════════════
    // FORMATTERS
    // ════════════════════════════════════════════════════════════════════
    function fmtMoney(n, frac) {
        if (n === null || n === undefined || isNaN(parseFloat(n))) return '0.00';
        var f = (frac === undefined) ? 2 : frac;
        return parseFloat(n).toLocaleString('es-MX', { minimumFractionDigits: f, maximumFractionDigits: f });
    }
    function escHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function getTipoFromCfdi(cfdiCode) {
        if (!cfdiCode) return null;
        var hit = (state.cfdiCache || []).find(function (c) { return c.clave === cfdiCode || c.id === cfdiCode; });
        return hit ? (hit.tipo || hit.type || null) : null;
    }

    // ════════════════════════════════════════════════════════════════════
    // LIST VIEW
    // ════════════════════════════════════════════════════════════════════
    function renderList() {
        if (state.detailItem) {
            $listView.hidden = true;
            $detailView.hidden = false;
            return;
        }
        $detailView.hidden = true;
        $listView.hidden = false;

        // Suprimir animación staggered cuando los datos no cambiaron desde el
        // render anterior (al abrir Filtro/Sort/Excel se re-renderiza sin
        // querer "recargar" visualmente la tabla).
        var sameItems = state._lastRenderItems === state.items;
        var suppressStagger = sameItems && state._tableEverRendered;

        var html = '';
        html += renderToolbar();
        html += renderFilterChips();
        html += renderTable(suppressStagger);
        $listView.innerHTML = html;

        state._lastRenderItems = state.items;
        state._tableEverRendered = true;

        // Bind toolbar events
        bindListEvents();
    }

    function renderToolbar() {
        var filterActive = (state.tipo !== 'todos') || (state.estatus !== 'todos');
        var sortActive = state.sort && state.sort !== '-created_at';
        var sortMatch = SORT_OPTIONS.filter(function (o) { return o.value === state.sort; })[0];
        var sortLabel = sortMatch ? sortMatch.label : 'Ordenar';

        var html = '<div class="cp-toolbar">';

        // Izquierda: Filtro / Ordenar / Excel — estilo CRM facet bar
        html += '<div class="cp-toolbar-left">';

        // Filtro
        html += '<div class="cp-dropdown-wrap" data-cp-filter-wrap>';
        html += '<button type="button" class="crm-facet-btn crm-facet-add' + (filterActive ? ' active' : '') + '" data-cp-action="toggle-filter">';
        html += ic('plus', 14) + '<span>' + (filterActive ? 'Filtro' : 'Filtro') + '</span>';
        html += '</button>';
        if (state.filterOpen) {
            html += '<div class="cp-dropdown-menu">';
            html += '<div class="cp-dropdown-label">Tipo</div>';
            [['todos', 'Todos'], ['PRODUCTO', 'Producto'], ['SERVICIO', 'Servicio']].forEach(function (pair) {
                html += '<div class="cp-dropdown-item" data-cp-action="filter-tipo" data-val="' + pair[0] + '">';
                html += '<span style="width:14px;display:inline-flex;align-items:center;">' + (state.tipo === pair[0] ? ic('check', 13) : '') + '</span>';
                html += escHtml(pair[1]) + '</div>';
            });
            html += '<div class="cp-dropdown-sep"></div>';
            html += '<div class="cp-dropdown-label">Estatus</div>';
            [['todos', 'Todos'], ['activo', 'Activo'], ['inactivo', 'Inactivo']].forEach(function (pair) {
                html += '<div class="cp-dropdown-item" data-cp-action="filter-estatus" data-val="' + pair[0] + '">';
                html += '<span style="width:14px;display:inline-flex;align-items:center;">' + (state.estatus === pair[0] ? ic('check', 13) : '') + '</span>';
                html += escHtml(pair[1]) + '</div>';
            });
            html += '</div>';
        }
        html += '</div>';

        // Ordenar
        html += '<div class="cp-dropdown-wrap" data-cp-sort-wrap>';
        html += '<button type="button" class="crm-facet-btn crm-facet-sort' + (sortActive ? ' has-sort' : '') + '" data-cp-action="toggle-sort">';
        html += icArr(I.sortLinesArr, 14) + '<span>' + escHtml(sortLabel) + '</span>';
        html += '</button>';
        if (state.sortOpen) {
            html += '<div class="cp-dropdown-menu">';
            html += '<div class="cp-dropdown-label">Ordenar por</div>';
            SORT_OPTIONS.forEach(function (opt) {
                html += '<div class="cp-dropdown-item" data-cp-action="set-sort" data-val="' + opt.value + '">';
                html += '<span style="width:14px;display:inline-flex;align-items:center;">' + (state.sort === opt.value ? ic('check', 13) : '') + '</span>';
                html += escHtml(opt.label) + '</div>';
            });
            html += '</div>';
        }
        html += '</div>';

        // Excel (Importar / Exportar)
        html += '<div class="cp-dropdown-wrap" data-cp-acciones-wrap>';
        html += '<button type="button" class="crm-facet-btn crm-facet-export" data-cp-action="toggle-acciones">';
        html += ic('fileText', 14) + '<span>Excel</span>';
        html += '</button>';
        if (state.accionesOpen) {
            html += '<div class="cp-dropdown-menu">';
            html += '<div class="cp-dropdown-item" data-cp-action="open-import">' + ic('upload', 13) + 'Importar</div>';
            html += '<div class="cp-dropdown-item" data-cp-action="export">' + ic('download', 13) + 'Exportar</div>';
            html += '<div class="cp-dropdown-sep"></div>';
            html += '<div class="cp-dropdown-item" data-cp-action="refresh">' + ic('refresh', 13) + 'Recargar</div>';
            html += '</div>';
        }
        html += '</div>';

        // Limpiar (sólo cuando hay filtros activos)
        if (filterActive || state.q || sortActive) {
            html += '<button type="button" class="crm-facet-btn crm-facet-clear" data-cp-action="clear-all-filters">Limpiar</button>';
        }

        html += '</div>';

        // Derecha: search + Agregar
        html += '<div class="cp-toolbar-right">';
        html += '<div class="cp-search-wrap">';
        html += ic('search', 13);
        html += '<input type="text" class="cp-search-input" id="cpSearchInput" placeholder="Buscar código o nombre..." value="' + escHtml(state.q) + '">';
        if (state.q) {
            html += '<button type="button" class="cp-search-clear" data-cp-action="clear-search" aria-label="Limpiar">' + ic('x', 10) + '</button>';
        }
        html += '</div>';

        html += '<button type="button" class="cp-btn-primary" data-cp-action="open-create">' + ic('plus', 13) + 'Agregar</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderFilterChips() {
        var chips = [];
        if (state.tipo !== 'todos') {
            chips.push({ key: 'tipo', label: 'Tipo: ' + (state.tipo === 'PRODUCTO' ? 'Producto' : 'Servicio') });
        }
        if (state.estatus !== 'todos') {
            chips.push({ key: 'estatus', label: 'Estatus: ' + (state.estatus === 'activo' ? 'Activo' : 'Inactivo') });
        }
        if (state.q) {
            chips.push({ key: 'q', label: 'Buscar: "' + state.q + '"' });
        }
        if (chips.length === 0) return '';
        var html = '<div class="cp-filter-chips-row">';
        chips.forEach(function (c) {
            html += '<span class="cp-filter-chip">' + escHtml(c.label);
            html += '<button type="button" class="cp-filter-chip-x" data-cp-action="clear-chip" data-key="' + c.key + '" aria-label="Quitar">' + ic('x', 9) + '</button>';
            html += '</span>';
        });
        if (chips.length > 1) {
            html += '<button type="button" class="cp-btn-ghost cp-btn-ghost-sm" data-cp-action="clear-all-filters">Limpiar todo</button>';
        }
        html += '</div>';
        return html;
    }

    function renderTable(suppressStagger) {
        var html = '<div class="cp-table-card">';
        // Header
        html += '<div class="cp-tbl-header">';
        html += sortHeader('nombre', 'Producto');
        html += sortHeader('costo', 'Costo');
        html += sortHeader('tipo', 'Tipo');
        html += '<div class="cp-tbl-header-cell cp-not-sortable">IVA</div>';
        html += sortHeader('estatus', 'Estatus');
        html += '<div class="cp-tbl-header-cell cp-not-sortable" style="justify-content:flex-end;">Acciones</div>';
        html += '</div>';

        // Body
        html += '<div class="cp-tbl-body' + (suppressStagger ? ' cp-no-stagger' : '') + '">';
        if (state.loading) {
            for (var i = 0; i < state.pageSize; i++) {
                html += '<div class="cp-skeleton-row">';
                html += '<div><div class="cp-skeleton-bar cp-w-60" style="margin-bottom:6px;"></div><div class="cp-skeleton-bar cp-w-40" style="height:9px;"></div></div>';
                html += '<div class="cp-skeleton-bar cp-w-60"></div>';
                html += '<div class="cp-skeleton-bar cp-w-60" style="height:18px;"></div>';
                html += '<div class="cp-skeleton-bar cp-w-60"></div>';
                html += '<div class="cp-skeleton-bar cp-w-60" style="height:18px;"></div>';
                html += '<div></div>';
                html += '</div>';
            }
        } else if (state.items.length === 0) {
            html += renderEmpty();
        } else {
            state.items.forEach(function (p, idx) {
                html += renderRow(p, idx);
            });
        }
        html += '</div>';

        // Pagination
        if (!state.loading && state.items.length > 0) {
            html += renderPagination();
        }
        html += '</div>';
        return html;
    }

    function sortHeader(field, label) {
        var current = state.sort.replace(/^-/, '');
        var sorted = current === field;
        var dir = state.sort.charAt(0) === '-' ? 'desc' : 'asc';
        var arrow = sorted ? (dir === 'asc' ? ic('chevUp', 10) : ic('chevDown', 10)) : ic('chevDown', 10);
        return '<div class="cp-tbl-header-cell' + (sorted ? ' cp-sorted' : '') + '" data-cp-sort="' + field + '">' +
            escHtml(label) + arrow + '</div>';
    }

    function renderRow(p, idx) {
        var nombre = p.nombre || p.name || '';
        var codigo = p.codigo || p.code || '';
        var costo = p.costo !== undefined ? p.costo : (p.cost || 0);
        var moneda = p.moneda || 'MXN';
        var iva = p.iva !== undefined ? p.iva : 16;
        var estatus = p.estatus || (p.activo === false ? 'inactivo' : 'activo');
        var tipo = (p.tipo || p.type || 'PRODUCTO').toUpperCase();
        var cfdiDesc = p.clave_cfdi_descripcion || p.cfdi_descripcion || p.cfdiDesc || '';
        var unidadCfdi = p.unidad_cfdi_descripcion || p.unidad_cfdi || p.unitCfdi || '';
        var sub = '';
        if (cfdiDesc) sub = cfdiDesc;
        if (unidadCfdi) sub += (sub ? ' · ' : '') + unidadCfdi;

        var html = '<div class="cp-tbl-row" data-cp-row-id="' + escHtml(p.id) + '" data-cp-row-idx="' + idx + '">';
        // Cell 1: nombre + código + sub
        html += '<div class="cp-row-cell">';
        html += '<div class="cp-name-row"><span class="cp-name">' + escHtml(nombre) + '</span><span class="cp-code">' + escHtml(codigo) + '</span></div>';
        if (sub) html += '<div class="cp-sub">' + escHtml(sub) + '</div>';
        html += '</div>';
        // Cell 2: costo
        html += '<div class="cp-row-cell">';
        html += '<span class="cp-cost">$' + fmtMoney(costo) + '</span>';
        html += '<span class="cp-cost-currency">' + escHtml(moneda) + '</span>';
        html += '</div>';
        // Cell 3: tipo badge
        html += '<div class="cp-row-cell">';
        html += '<span class="cp-badge ' + (tipo === 'PRODUCTO' ? 'cp-badge-product' : 'cp-badge-service') + '">' + escHtml(tipo) + '</span>';
        html += '</div>';
        // Cell 4: IVA
        html += '<div class="cp-row-cell">';
        html += '<div class="cp-meta-label">IVA</div>';
        html += '<div class="cp-meta-val">' + escHtml(iva) + '%</div>';
        html += '</div>';
        // Cell 5: estatus
        html += '<div class="cp-row-cell">';
        html += '<div class="cp-meta-label">Estatus</div>';
        html += '<span class="cp-badge ' + (estatus === 'activo' ? 'cp-badge-active' : 'cp-badge-inactive') + '">' + (estatus === 'activo' ? 'Activo' : 'Inactivo') + '</span>';
        html += '</div>';
        // Cell 6: actions
        html += '<div class="cp-row-cell-actions">';
        html += '<div class="cp-row-actions">';
        html += '<button type="button" class="cp-icon-btn" data-cp-action="row-edit" title="Editar">' + ic('edit', 14) + '</button>';
        html += '<button type="button" class="cp-icon-btn cp-danger" data-cp-action="row-delete" title="Eliminar">' + icArr(I.trashArr, 14) + '</button>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderEmpty() {
        // No-results vs zero state
        var hasFilters = state.q || state.tipo !== 'todos' || state.estatus !== 'todos';
        if (hasFilters) {
            return '<div class="cp-empty">' +
                noResultsSvg() +
                '<h3 class="cp-empty-title">No se encontraron coincidencias</h3>' +
                '<p class="cp-empty-text">Prueba con otros términos o limpia los filtros activos.</p>' +
                '<button type="button" class="cp-btn-ghost" data-cp-action="clear-all-filters">Limpiar búsqueda</button>' +
                '</div>';
        }
        return '<div class="cp-empty">' +
            zeroStateSvg() +
            '<h3 class="cp-empty-title">Aún no hay productos</h3>' +
            '<p class="cp-empty-text">Crea tu primer producto o servicio para comenzar a usarlo en órdenes de compra y cotizaciones.</p>' +
            '<button type="button" class="cp-btn-primary" data-cp-action="open-create">' + ic('plus', 13) + 'Crear primer producto</button>' +
            '</div>';
    }

    function zeroStateSvg() {
        return '<svg class="cp-empty-svg" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<rect x="18" y="30" width="60" height="44" rx="7" fill="#f0f4ff"/>' +
            '<rect x="33" y="20" width="30" height="14" rx="5" fill="#dde8ff" stroke="#3478f6" stroke-width="1.5"/>' +
            '<circle cx="48" cy="56" r="11" fill="#fff" stroke="#3478f6" stroke-width="2"/>' +
            '<line x1="48" y1="50" x2="48" y2="62" stroke="#3478f6" stroke-width="2" stroke-linecap="round"/>' +
            '<line x1="42" y1="56" x2="54" y2="56" stroke="#3478f6" stroke-width="2" stroke-linecap="round"/>' +
            '</svg>';
    }
    function noResultsSvg() {
        return '<svg class="cp-empty-svg" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<circle cx="42" cy="42" r="22" fill="#f5f5f7" stroke="#d1d1d6" stroke-width="2"/>' +
            '<line x1="58" y1="58" x2="78" y2="78" stroke="#d1d1d6" stroke-width="3" stroke-linecap="round"/>' +
            '<line x1="32" y1="32" x2="52" y2="52" stroke="#aeaeb2" stroke-width="2" stroke-linecap="round"/>' +
            '<line x1="52" y1="32" x2="32" y2="52" stroke="#aeaeb2" stroke-width="2" stroke-linecap="round"/>' +
            '</svg>';
    }

    function renderPagination() {
        var from = (state.page - 1) * state.pageSize + 1;
        var to = Math.min(state.page * state.pageSize, state.total);
        var html = '<div class="cp-pagination">';
        html += '<span class="cp-pag-info">Mostrando ' + from + '-' + to + ' de ' + state.total + ' producto' + (state.total === 1 ? '' : 's') + '</span>';
        html += '<div class="cp-pag-controls">';
        html += '<button class="cp-pag-btn" data-cp-action="page-first" ' + (state.page === 1 ? 'disabled' : '') + '>' + ic('chevDoubleLeft', 12) + '</button>';
        html += '<button class="cp-pag-btn" data-cp-action="page-prev" ' + (state.page === 1 ? 'disabled' : '') + '>' + ic('chevLeft', 12) + '</button>';
        // Render page numbers within ±2
        var pages = [];
        for (var n = 1; n <= state.totalPages; n++) {
            if (Math.abs(n - state.page) <= 2 || n === 1 || n === state.totalPages) pages.push(n);
        }
        var lastShown = 0;
        pages.forEach(function (n) {
            if (lastShown && n - lastShown > 1) {
                html += '<span style="font-size:11px;color:#aeaeb2;padding:0 4px;">…</span>';
            }
            html += '<button class="cp-pag-btn ' + (n === state.page ? 'cp-active' : '') + '" data-cp-action="page-go" data-page="' + n + '">' + n + '</button>';
            lastShown = n;
        });
        html += '<button class="cp-pag-btn" data-cp-action="page-next" ' + (state.page >= state.totalPages ? 'disabled' : '') + '>' + ic('chevRight', 12) + '</button>';
        html += '<button class="cp-pag-btn" data-cp-action="page-last" ' + (state.page >= state.totalPages ? 'disabled' : '') + '>' + ic('chevDoubleRight', 12) + '</button>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    // ════════════════════════════════════════════════════════════════════
    // LIST VIEW EVENTS
    // ════════════════════════════════════════════════════════════════════
    function bindListEvents() {
        // Toolbar / table click delegation
        $listView.onclick = function (ev) {
            var t = ev.target.closest('[data-cp-action]');
            var sortEl = ev.target.closest('[data-cp-sort]');
            if (sortEl && !t) {
                var f = sortEl.dataset.cpSort;
                var current = state.sort.replace(/^-/, '');
                if (current === f) {
                    state.sort = state.sort.charAt(0) === '-' ? f : '-' + f;
                } else {
                    state.sort = f;
                }
                fetchProductos();
                return;
            }
            if (!t) {
                // Row click → open detail
                var row = ev.target.closest('[data-cp-row-id]');
                if (row) {
                    var id = row.dataset.cpRowId;
                    var item = state.items.find(function (x) { return String(x.id) === String(id); });
                    if (item) openDetail(item);
                }
                return;
            }
            ev.stopPropagation();
            var action = t.dataset.cpAction;
            switch (action) {
                case 'toggle-filter':
                    state.filterOpen = !state.filterOpen;
                    state.accionesOpen = false;
                    state.sortOpen = false;
                    renderList();
                    break;
                case 'toggle-sort':
                    state.sortOpen = !state.sortOpen;
                    state.filterOpen = false;
                    state.accionesOpen = false;
                    renderList();
                    break;
                case 'set-sort':
                    state.sort = t.dataset.val || '-created_at';
                    state.sortOpen = false;
                    state.page = 1;
                    fetchProductos();
                    break;
                case 'toggle-acciones':
                    state.accionesOpen = !state.accionesOpen;
                    state.filterOpen = false;
                    state.sortOpen = false;
                    renderList();
                    break;
                case 'filter-tipo':
                    state.tipo = t.dataset.val;
                    state.page = 1;
                    state.filterOpen = false;
                    fetchProductos();
                    break;
                case 'filter-estatus':
                    state.estatus = t.dataset.val;
                    state.page = 1;
                    state.filterOpen = false;
                    fetchProductos();
                    break;
                case 'clear-chip':
                    var k = t.dataset.key;
                    if (k === 'tipo') state.tipo = 'todos';
                    if (k === 'estatus') state.estatus = 'todos';
                    if (k === 'q') {
                        state.q = '';
                        var inp = document.getElementById('cpSearchInput');
                        if (inp) inp.value = '';
                    }
                    state.page = 1;
                    fetchProductos();
                    break;
                case 'clear-all-filters':
                    state.q = '';
                    state.tipo = 'todos';
                    state.estatus = 'todos';
                    state.sort = '-created_at';
                    state.page = 1;
                    fetchProductos();
                    break;
                case 'clear-search':
                    state.q = '';
                    state.page = 1;
                    fetchProductos();
                    break;
                case 'open-create':
                    openCreate();
                    break;
                case 'open-import':
                    state.accionesOpen = false;
                    state.importOpen = true;
                    state.importResult = null;
                    renderList();
                    renderModals();
                    break;
                case 'export':
                    state.accionesOpen = false;
                    renderList();
                    window.location = '/app/api/compras/productos/export/';
                    break;
                case 'refresh':
                    state.accionesOpen = false;
                    fetchProductos();
                    break;
                case 'row-edit':
                    var rEdit = t.closest('[data-cp-row-id]');
                    var idE = rEdit && rEdit.dataset.cpRowId;
                    var itE = state.items.find(function (x) { return String(x.id) === String(idE); });
                    if (itE) openEdit(itE);
                    break;
                case 'row-delete':
                    var rDel = t.closest('[data-cp-row-id]');
                    var idD = rDel && rDel.dataset.cpRowId;
                    var itD = state.items.find(function (x) { return String(x.id) === String(idD); });
                    if (itD) openConfirm(itD);
                    break;
                case 'page-first': if (state.page > 1) { state.page = 1; fetchProductos(); } break;
                case 'page-prev': if (state.page > 1) { state.page--; fetchProductos(); } break;
                case 'page-next': if (state.page < state.totalPages) { state.page++; fetchProductos(); } break;
                case 'page-last': if (state.page < state.totalPages) { state.page = state.totalPages; fetchProductos(); } break;
                case 'page-go':
                    var pn = parseInt(t.dataset.page, 10);
                    if (!isNaN(pn) && pn !== state.page) { state.page = pn; fetchProductos(); }
                    break;
            }
        };

        // Search input (debounced)
        var $search = document.getElementById('cpSearchInput');
        if ($search) {
            $search.oninput = function () {
                var v = this.value;
                clearTimeout(searchTimer);
                searchTimer = setTimeout(function () {
                    state.q = v;
                    state.page = 1;
                    fetchProductos();
                }, 250);
            };
        }

        // Hover preview on rows
        var rows = $listView.querySelectorAll('[data-cp-row-id]');
        rows.forEach(function (row) {
            row.addEventListener('mouseenter', function (ev) {
                clearTimeout(previewTimer);
                rowHoverEl = row;
                var rect = row.getBoundingClientRect();
                var startX = ev.clientX, startY = ev.clientY;
                previewTimer = setTimeout(function () {
                    if (rowHoverEl !== row) return;
                    var id = row.dataset.cpRowId;
                    var item = state.items.find(function (x) { return String(x.id) === String(id); });
                    if (!item) return;
                    showPreview(item, startX, startY);
                }, 420);
            });
            row.addEventListener('mousemove', function (ev) {
                if ($previewCard) repositionPreview(ev.clientX, ev.clientY);
            });
            row.addEventListener('mouseleave', function () {
                clearTimeout(previewTimer);
                rowHoverEl = null;
                hidePreview();
            });
        });
    }

    // Preview card
    function showPreview(item, x, y) {
        hidePreview();
        var nombre = item.nombre || item.name || '';
        var codigo = item.codigo || item.code || '';
        var costo = item.costo !== undefined ? item.costo : (item.cost || 0);
        var moneda = item.moneda || 'MXN';
        var iva = item.iva !== undefined ? item.iva : 16;
        var unidadCfdi = item.unidad_cfdi_descripcion || item.unidad_cfdi || '';
        var almacenes = item.almacenes_nombres || item.almacenes || [];
        var almacenStr = Array.isArray(almacenes)
            ? almacenes.map(function (a) { return typeof a === 'string' ? a : (a.nombre || ''); }).filter(Boolean).join(', ')
            : (almacenes || '');
        var clave = item.clave_cfdi || item.cfdi || '';

        var card = document.createElement('div');
        card.className = 'cp-preview-card';
        card.innerHTML =
            '<div class="cp-preview-name">' + escHtml(nombre) + '</div>' +
            '<div class="cp-preview-sub">' + escHtml(codigo) + (clave ? ' · ' + escHtml(clave) : '') + '</div>' +
            '<div class="cp-preview-stat"><span class="cp-preview-stat-label">Costo</span><span class="cp-preview-stat-val">$' + fmtMoney(costo) + ' ' + escHtml(moneda) + '</span></div>' +
            '<div class="cp-preview-stat"><span class="cp-preview-stat-label">IVA</span><span class="cp-preview-stat-val">' + escHtml(iva) + '%</span></div>' +
            (unidadCfdi ? '<div class="cp-preview-stat"><span class="cp-preview-stat-label">Unidad CFDI</span><span class="cp-preview-stat-val">' + escHtml(unidadCfdi) + '</span></div>' : '') +
            (almacenStr ? '<div class="cp-preview-stat"><span class="cp-preview-stat-label">Almacén</span><span class="cp-preview-stat-val" style="font-size:12px;text-align:right;">' + escHtml(almacenStr) + '</span></div>' : '');
        document.body.appendChild(card);
        $previewCard = card;
        repositionPreview(x, y);
    }
    function repositionPreview(x, y) {
        if (!$previewCard) return;
        var w = $previewCard.offsetWidth || 320;
        var h = $previewCard.offsetHeight || 180;
        var left = x + 18;
        var top = y - 10;
        if (left + w + 12 > window.innerWidth) left = x - w - 18;
        if (left < 8) left = 8;
        if (top + h + 12 > window.innerHeight) top = window.innerHeight - h - 12;
        if (top < 8) top = 8;
        $previewCard.style.left = left + 'px';
        $previewCard.style.top = top + 'px';
    }
    function hidePreview() {
        if ($previewCard) {
            $previewCard.parentNode && $previewCard.parentNode.removeChild($previewCard);
            $previewCard = null;
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // DETAIL VIEW
    // ════════════════════════════════════════════════════════════════════
    function openDetail(item) {
        // Cerrar preview/timer antes de navegar al detalle (si no, queda
        // flotando sobre la vista de detalle).
        clearTimeout(previewTimer);
        rowHoverEl = null;
        hidePreview();
        // Fetch full record so we have all fields
        window.comprasFetch('/app/api/compras/productos/' + item.id + '/')
            .then(function (data) {
                state.detailItem = data || item;
                renderDetail();
                renderList();
            })
            .catch(function () {
                state.detailItem = item;
                renderDetail();
                renderList();
            });
    }
    function closeDetail() {
        state.detailItem = null;
        renderList();
        renderDetail();
    }

    function renderDetail() {
        if (!state.detailItem) {
            $detailView.innerHTML = '';
            return;
        }
        var p = state.detailItem;
        var nombre = p.nombre || p.name || '';
        var codigo = p.codigo || p.code || '';
        var costo = p.costo !== undefined ? p.costo : (p.cost || 0);
        var moneda = p.moneda || 'MXN';
        var iva = p.iva !== undefined ? p.iva : 16;
        var tipo = (p.tipo || p.type || 'PRODUCTO').toUpperCase();
        var estatus = p.estatus || (p.activo === false ? 'inactivo' : 'activo');
        var clave = p.clave_cfdi || p.cfdi || '';
        var claveDesc = p.clave_cfdi_descripcion || p.cfdi_descripcion || '';
        var unidad = p.unidad_cfdi || '';
        var unidadDesc = p.unidad_cfdi_descripcion || '';
        var almacenes = p.almacenes_nombres || p.almacenes || [];
        var descripcion = p.descripcion || p.description || '';
        var totalCIva = parseFloat(costo || 0) * (1 + parseFloat(iva || 0) / 100);
        var createdAt = p.created_at || p.createdAt;
        var updatedAt = p.updated_at || p.updatedAt;

        var html = '<div class="cp-detail">';
        // Header
        html += '<div class="cp-detail-header">';
        html += '<button type="button" class="cp-back-btn" data-cp-action="back">' + ic('chevLeft', 14) + 'Catálogo</button>';
        if (codigo) {
            html += '<span class="cp-detail-bullet">·</span>';
            html += '<span class="cp-code" style="font-size:12px;">' + escHtml(codigo) + '</span>';
        }
        html += '<span class="cp-badge ' + (tipo === 'PRODUCTO' ? 'cp-badge-product' : 'cp-badge-service') + '" style="margin-left:4px;">' + escHtml(tipo) + '</span>';
        html += '<span class="cp-badge ' + (estatus === 'activo' ? 'cp-badge-active' : 'cp-badge-inactive') + '">' + (estatus === 'activo' ? 'Activo' : 'Inactivo') + '</span>';
        html += '<div class="cp-detail-actions">';
        html += '<button type="button" class="cp-btn-ghost" data-cp-action="detail-delete">' + icArr(I.trashArr, 13) + 'Eliminar</button>';
        html += '<button type="button" class="cp-btn-primary" data-cp-action="detail-edit">' + ic('edit', 13) + 'Editar</button>';
        html += '</div>';
        html += '</div>';

        // Title
        html += '<div class="cp-detail-title" style="margin-bottom:18px;">' + escHtml(nombre) + '</div>';

        // Grid
        html += '<div class="cp-detail-grid">';

        // Left
        html += '<div>';
        // Información general
        html += '<div class="cp-detail-card">';
        html += '<div class="cp-detail-card-header">Información general</div>';
        html += '<div class="cp-detail-card-body">';
        html += detailProp('hash', 'Código', '<span class="cp-mono">' + escHtml(codigo) + '</span>');
        html += detailProp('type', 'Tipo', escHtml(tipo === 'PRODUCTO' ? 'Producto' : 'Servicio'));
        html += detailProp('fileText', 'Clave CFDI', clave ? ('<span class="cp-mono">' + escHtml(clave) + '</span>' + (claveDesc ? ' <span style="color:#6e6e73;">— ' + escHtml(claveDesc) + '</span>' : '')) : '<span style="color:#c7c7cc;">Sin asignar</span>');
        html += detailProp('info', 'Unidad CFDI', unidad ? ('<span class="cp-mono">' + escHtml(unidad) + '</span>' + (unidadDesc ? ' <span style="color:#6e6e73;">— ' + escHtml(unidadDesc) + '</span>' : '')) : '<span style="color:#c7c7cc;">—</span>');
        var almHtml = '';
        if (Array.isArray(almacenes) && almacenes.length) {
            almacenes.forEach(function (a) {
                var n = typeof a === 'string' ? a : (a.nombre || '');
                if (n) almHtml += '<span class="cp-multi-chip">' + escHtml(n) + '</span>';
            });
        } else {
            almHtml = '<span style="color:#c7c7cc;">Sin almacenes</span>';
        }
        html += detailProp('warehouse', 'Almacenes', almHtml);
        html += '</div>';
        html += '</div>';

        // Descripción
        if (descripcion) {
            html += '<div class="cp-detail-card">';
            html += '<div class="cp-detail-card-header">Descripción</div>';
            html += '<div style="padding:14px 20px 18px;font-size:13.5px;color:#3c3c43;line-height:1.6;white-space:pre-wrap;">' + escHtml(descripcion) + '</div>';
            html += '</div>';
        }

        html += '</div>';

        // Right
        html += '<div>';
        // Precio
        html += '<div class="cp-detail-side-card">';
        html += '<div class="cp-detail-side-header">Precio</div>';
        html += '<div class="cp-detail-cost-big">$' + fmtMoney(costo) + '</div>';
        html += '<div class="cp-detail-cost-sub">Sin IVA · ' + escHtml(moneda) + '</div>';
        html += '<div class="cp-detail-card-body">';
        html += detailProp('percent', 'IVA', escHtml(iva) + '%');
        html += detailProp('dollar', 'Total c/IVA', '<strong style="color:#1c1c1e;font-weight:700;">$' + fmtMoney(totalCIva) + '</strong>');
        html += '</div>';
        html += '</div>';

        // Actividad
        html += '<div class="cp-detail-side-card">';
        html += '<div class="cp-detail-side-header">Actividad reciente</div>';
        html += '<div class="cp-activity-feed">';
        if (updatedAt && updatedAt !== createdAt) {
            html += activityItem('info', 'Producto actualizado', formatDate(updatedAt));
        }
        html += activityItem('success', 'Producto creado', formatDate(createdAt));
        html += '</div>';
        html += '</div>';

        html += '</div>';

        html += '</div>';
        html += '</div>';

        $detailView.innerHTML = html;
        bindDetailEvents();
    }

    function detailProp(iconName, label, valHtml) {
        return '<div class="cp-detail-prop">' +
            '<div class="cp-detail-prop-label">' + ic(iconName, 13) + escHtml(label) + '</div>' +
            '<div class="cp-detail-prop-value">' + valHtml + '</div>' +
            '</div>';
    }

    function activityItem(dotClass, text, time) {
        return '<div class="cp-activity-item">' +
            '<div class="cp-activity-dot cp-' + dotClass + '"></div>' +
            '<div><div class="cp-activity-text">' + escHtml(text) + '</div>' +
            '<div class="cp-activity-time">' + escHtml(time) + '</div></div>' +
            '</div>';
    }

    function formatDate(d) {
        if (!d) return '—';
        try {
            var dt = new Date(d);
            if (isNaN(dt.getTime())) return String(d);
            return dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) +
                ' · ' + dt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        } catch (e) { return String(d); }
    }

    function bindDetailEvents() {
        $detailView.onclick = function (ev) {
            var t = ev.target.closest('[data-cp-action]');
            if (!t) return;
            switch (t.dataset.cpAction) {
                case 'back': closeDetail(); break;
                case 'detail-edit': openEdit(state.detailItem); break;
                case 'detail-delete': openConfirm(state.detailItem); break;
            }
        };
    }

    // ════════════════════════════════════════════════════════════════════
    // MODAL: CREATE / EDIT
    // ════════════════════════════════════════════════════════════════════
    function openCreate() {
        state.modalMode = 'create';
        state.modalDraft = {
            codigo: '',
            nombre: '',
            descripcion: '',
            costo: '',
            moneda: 'MXN',
            iva: 16,
            clave_cfdi: '',
            clave_cfdi_descripcion: '',
            unidad_cfdi: '',
            unidad_cfdi_descripcion: '',
            tipo: '',
            almacenes: [],
        };
        state.modalErrors = {};
        state.modalOpen = true;
        state.openPicker = null;
        renderModals();
        focusModalTitle();
    }
    function openEdit(item) {
        state.modalMode = 'edit';
        // Fetch fresh data for edit (server may have more detail than list payload)
        window.comprasFetch('/app/api/compras/productos/' + item.id + '/')
            .then(function (data) {
                var src = data || item;
                state.modalDraft = {
                    id: src.id,
                    codigo: src.codigo || src.code || '',
                    nombre: src.nombre || src.name || '',
                    descripcion: src.descripcion || src.description || '',
                    costo: src.costo !== undefined ? src.costo : (src.cost || ''),
                    moneda: src.moneda || 'MXN',
                    iva: src.iva !== undefined ? src.iva : 16,
                    clave_cfdi: src.clave_cfdi || src.cfdi || '',
                    clave_cfdi_descripcion: src.clave_cfdi_descripcion || '',
                    unidad_cfdi: src.unidad_cfdi || '',
                    unidad_cfdi_descripcion: src.unidad_cfdi_descripcion || '',
                    tipo: (src.tipo || src.type || '').toUpperCase(),
                    almacenes: normalizeAlmacenes(src.almacenes || src.almacenes_ids || []),
                };
                state.modalErrors = {};
                state.modalOpen = true;
                state.openPicker = null;
                renderModals();
            })
            .catch(function (e) { toast('error', 'No se pudo cargar el producto'); });
    }
    function normalizeAlmacenes(arr) {
        if (!Array.isArray(arr)) return [];
        return arr.map(function (a) { return typeof a === 'object' ? (a.id || a) : a; }).filter(function (x) { return x !== null && x !== undefined; });
    }
    function closeModal() {
        state.modalOpen = false;
        state.modalDraft = null;
        state.modalMode = null;
        state.modalErrors = {};
        state.openPicker = null;
        renderModals();
    }
    function focusModalTitle() {
        setTimeout(function () {
            var inp = document.getElementById('cpNmTitle');
            if (inp) { inp.focus(); inp.select && inp.select(); }
        }, 60);
    }

    function renderModals() {
        // Detectar qué modales YA estaban en el DOM para suprimir la animación
        // de entrada en re-renders (evita el flash al hacer clic en chips/IVA/moneda).
        var hadProduct = !!$modalContainer.querySelector('[data-cp-overlay="product"]');
        var hadConfirm = !!$modalContainer.querySelector('[data-cp-overlay="confirm"]');
        var hadImport  = !!$modalContainer.querySelector('[data-cp-overlay="import"]');

        var html = '';
        if (state.modalOpen && state.modalDraft) {
            html += renderProductModal(hadProduct);
        }
        if (state.confirmTarget) {
            html += renderConfirmModal(hadConfirm);
        }
        if (state.importOpen) {
            html += renderImportModal(hadImport);
        }
        $modalContainer.innerHTML = html;
        bindModalEvents();
    }

    function renderProductModal(noAnim) {
        var animCls = noAnim ? ' cp-no-anim' : '';
        var d = state.modalDraft;
        var isEdit = state.modalMode === 'edit';
        var detectedTipo = d.tipo || getTipoFromCfdi(d.clave_cfdi) || '';
        var isServicio = detectedTipo === 'SERVICIO';

        var canSave = !!(d.codigo && d.nombre && d.descripcion && d.costo !== '' && parseFloat(d.costo) >= 0 && d.clave_cfdi && d.unidad_cfdi);

        var html = '<div class="cp-modal-overlay' + animCls + '" data-cp-overlay="product">';
        html += '<div class="cp-notion-modal' + animCls + '" role="dialog" aria-modal="true">';

        // Header
        html += '<div class="cp-nm-header">';
        html += '<div class="cp-nm-breadcrumb">' + ic('package', 13) + '<span>Compras</span>' + ic('chevRight', 12) +
            '<span class="cp-current">' + (isEdit ? 'Editar producto' : 'Nuevo producto') + '</span></div>';
        html += '<button type="button" class="cp-nm-close" data-cp-action="modal-close" aria-label="Cerrar">' + ic('x', 14) + '</button>';
        html += '</div>';

        // Body
        html += '<div class="cp-nm-body">';
        // Title
        html += '<input type="text" class="cp-nm-title-input ' + (state.modalErrors.nombre ? 'cp-error' : '') + '" id="cpNmTitle" placeholder="Nombre del producto..." value="' + escHtml(d.nombre) + '" data-cp-field="nombre" maxlength="200">';
        if (state.modalErrors.nombre) html += '<div class="cp-nm-prop-help">' + escHtml(state.modalErrors.nombre) + '</div>';
        html += '<div class="cp-nm-divider"></div>';

        // Properties
        html += '<div class="cp-nm-props">';

        // Código
        html += propRow('hash', 'Código', true,
            isEdit
                ? '<button type="button" class="cp-nm-chip cp-disabled" tabindex="-1"><span class="cp-mono" style="font-family:\'SF Mono\',ui-monospace,monospace;">' + escHtml(d.codigo) + '</span></button>'
                : '<input type="text" class="cp-nm-inline-input ' + (state.modalErrors.codigo ? 'cp-error' : '') + '" data-cp-field="codigo" value="' + escHtml(d.codigo) + '" placeholder="Ej. PROD-001" maxlength="40" autocomplete="off">' +
                  (state.modalErrors.codigo ? '<div class="cp-nm-prop-help">' + escHtml(state.modalErrors.codigo) + '</div>' : '')
        );

        // Costo
        var costoChipHtml = '<input type="number" step="0.01" min="0" class="cp-nm-inline-input ' + (state.modalErrors.costo ? 'cp-error' : '') + '" data-cp-field="costo" value="' + escHtml(d.costo) + '" placeholder="0.00" style="max-width:160px;">';
        if (state.modalErrors.costo) costoChipHtml += '<div class="cp-nm-prop-help">' + escHtml(state.modalErrors.costo) + '</div>';
        html += propRow('dollar', 'Costo', true, costoChipHtml);

        // Moneda
        var monedaHtml = '<div class="cp-toggle-group">';
        ['MXN', 'USD'].forEach(function (m) {
            monedaHtml += '<button type="button" class="cp-toggle-btn ' + (d.moneda === m ? 'cp-active' : '') + '" data-cp-action="set-moneda" data-val="' + m + '">' + m + '</button>';
        });
        monedaHtml += '</div>';
        html += propRow('coins', 'Moneda', false, monedaHtml);

        // IVA
        var ivaHtml = '<div class="cp-toggle-group">';
        [8, 16].forEach(function (v) {
            ivaHtml += '<button type="button" class="cp-toggle-btn ' + (parseInt(d.iva, 10) === v ? 'cp-active' : '') + '" data-cp-action="set-iva" data-val="' + v + '">' + v + '%</button>';
        });
        ivaHtml += '</div>';
        html += propRow('percent', 'IVA', false, ivaHtml);

        // Clave CFDI
        var cfdiTrigger;
        if (d.clave_cfdi) {
            cfdiTrigger = '<button type="button" class="cp-nm-chip" data-cp-picker-trigger="cfdi"><span class="cp-mono" style="font-family:\'SF Mono\',ui-monospace,monospace;">' + escHtml(d.clave_cfdi) + '</span>' +
                (d.clave_cfdi_descripcion ? ' <span style="color:#6e6e73;">— ' + escHtml(d.clave_cfdi_descripcion) + '</span>' : '') + '</button>';
        } else {
            cfdiTrigger = '<button type="button" class="cp-nm-chip cp-empty cp-required" data-cp-picker-trigger="cfdi">Selecciona una clave SAT</button>';
        }
        if (state.openPicker === 'cfdi') {
            cfdiTrigger += renderCfdiPicker();
        }
        html += propRow('layers', 'Clave CFDI', true, cfdiTrigger +
            (state.modalErrors.clave_cfdi ? '<div class="cp-nm-prop-help">' + escHtml(state.modalErrors.clave_cfdi) + '</div>' : ''));

        // Unidad CFDI
        var unidadTrigger;
        var unidadDisabled = isServicio;
        if (unidadDisabled) {
            // For SERVICIO auto-set E48 if not set
            if (!d.unidad_cfdi || d.unidad_cfdi !== 'E48') {
                d.unidad_cfdi = 'E48';
                d.unidad_cfdi_descripcion = 'Unidad de servicio';
            }
            unidadTrigger = '<button type="button" class="cp-nm-chip cp-disabled" tabindex="-1"><span class="cp-mono" style="font-family:\'SF Mono\',ui-monospace,monospace;">E48</span> <span style="color:#6e6e73;">— Unidad de servicio</span></button>' +
                '<div class="cp-nm-prop-help" style="color:#aeaeb2;">Auto-asignada para servicios</div>';
        } else if (d.unidad_cfdi) {
            unidadTrigger = '<button type="button" class="cp-nm-chip" data-cp-picker-trigger="unidad"><span class="cp-mono" style="font-family:\'SF Mono\',ui-monospace,monospace;">' + escHtml(d.unidad_cfdi) + '</span>' +
                (d.unidad_cfdi_descripcion ? ' <span style="color:#6e6e73;">— ' + escHtml(d.unidad_cfdi_descripcion) + '</span>' : '') + '</button>';
        } else {
            unidadTrigger = '<button type="button" class="cp-nm-chip cp-empty cp-required" data-cp-picker-trigger="unidad">Selecciona unidad</button>';
        }
        if (state.openPicker === 'unidad' && !unidadDisabled) {
            unidadTrigger += renderUnidadPicker();
        }
        html += propRow('info', 'Unidad CFDI', true, unidadTrigger +
            (state.modalErrors.unidad_cfdi && !unidadDisabled ? '<div class="cp-nm-prop-help">' + escHtml(state.modalErrors.unidad_cfdi) + '</div>' : ''));

        // Almacenes
        var almTrigger;
        if (d.almacenes && d.almacenes.length) {
            var almLabels = d.almacenes.map(function (id) {
                var a = (state.almacenesCache || []).find(function (x) { return String(x.id) === String(id); });
                return a ? a.nombre : null;
            }).filter(Boolean);
            almTrigger = '<div class="cp-nm-chip-group">';
            almLabels.forEach(function (n, i) {
                almTrigger += '<span class="cp-almacen-chip">' + escHtml(n) +
                    '<button type="button" class="cp-almacen-chip-x" data-cp-action="remove-almacen" data-idx="' + i + '">' + ic('x', 9) + '</button></span>';
            });
            almTrigger += '<button type="button" class="cp-nm-chip" data-cp-picker-trigger="almacenes" style="height:22px;font-size:11.5px;padding:0 8px;">' + ic('plus', 10) + ' Más</button>';
            almTrigger += '</div>';
        } else {
            almTrigger = '<button type="button" class="cp-nm-chip cp-empty" data-cp-picker-trigger="almacenes">Selecciona almacenes</button>';
        }
        if (state.openPicker === 'almacenes') {
            almTrigger += renderAlmacenesPicker();
        }
        html += propRow('warehouse', 'Almacenes', false, almTrigger);

        html += '</div>'; // /props

        // Descripción
        html += '<div class="cp-nm-divider"></div>';
        html += '<div style="padding:0 0 8px;font-size:12px;font-weight:600;color:#aeaeb2;text-transform:uppercase;letter-spacing:.7px;">Descripción <span style="color:#ff3b30;">*</span></div>';
        html += '<textarea class="cp-nm-desc ' + (state.modalErrors.descripcion ? 'cp-error' : '') + '" data-cp-field="descripcion" placeholder="Describe el producto o servicio (esta descripción aparecerá en cotizaciones y órdenes de compra)..." rows="4">' + escHtml(d.descripcion) + '</textarea>';
        if (state.modalErrors.descripcion) html += '<div class="cp-nm-prop-help" style="padding:0;">' + escHtml(state.modalErrors.descripcion) + '</div>';

        html += '</div>'; // /body

        // Footer
        html += '<div class="cp-nm-footer">';
        html += '<div class="cp-nm-footer-props">';
        if (detectedTipo) {
            html += '<span class="cp-nm-footer-chip">' + ic('layers', 12) + (detectedTipo === 'PRODUCTO' ? 'Producto' : 'Servicio') + '</span>';
        }
        if (d.iva !== '' && d.iva !== null && d.iva !== undefined) {
            html += '<span class="cp-nm-footer-chip">' + ic('percent', 12) + 'IVA ' + escHtml(d.iva) + '%</span>';
        }
        if (d.almacenes && d.almacenes.length) {
            html += '<span class="cp-nm-footer-chip">' + ic('warehouse', 12) + d.almacenes.length + ' almacé' + (d.almacenes.length === 1 ? 'n' : 'nes') + '</span>';
        }
        html += '</div>';
        html += '<div class="cp-nm-footer-actions">';
        html += '<button type="button" class="cp-btn-cancel-nm" data-cp-action="modal-close">Cancelar</button>';
        html += '<button type="button" class="cp-btn-primary" data-cp-action="modal-save"' + (canSave ? '' : ' disabled') + '>' + ic('check', 13) + (isEdit ? 'Guardar cambios' : 'Crear producto') + '</button>';
        html += '</div>';
        html += '</div>';

        html += '</div></div>';
        return html;
    }

    function propRow(iconName, label, required, valueHtml) {
        var labelHtml = ic(iconName, 14) + escHtml(label);
        if (required) labelHtml += '<span class="cp-required-dot" title="Obligatorio"></span>';
        return '<div class="cp-nm-prop-row">' +
            '<div class="cp-nm-prop-label">' + labelHtml + '</div>' +
            '<div class="cp-nm-prop-value">' + valueHtml + '</div>' +
            '</div>';
    }

    function renderCfdiPicker() {
        var q = (state.pickerSearch || '').toLowerCase();
        var list = state.cfdiCache || [];
        var filtered = list.filter(function (c) {
            if (!q) return true;
            return ((c.clave || '').toLowerCase().indexOf(q) >= 0) ||
                   ((c.descripcion || '').toLowerCase().indexOf(q) >= 0);
        }).slice(0, 80);

        var html = '<div class="cp-nm-picker" data-cp-picker="cfdi">';
        html += '<input type="text" class="cp-nm-picker-search" id="cpPickerSearch" placeholder="Buscar clave o descripción..." value="' + escHtml(state.pickerSearch) + '">';
        if (list.length === 0) {
            html += '<div class="cp-nm-picker-empty">' + (state.catLoading ? 'Cargando catálogo SAT…' : 'Catálogo CFDI vacío. Corre <code>seed_compras</code> en el servidor.') + '</div>';
        } else if (filtered.length === 0) {
            html += '<div class="cp-nm-picker-empty">Sin coincidencias para “' + escHtml(state.pickerSearch) + '”. Borra la búsqueda para ver el catálogo.</div>';
        } else {
            // Agrupado por tipo (case-insensitive: el modelo usa lowercase 'producto'/'servicio').
            [['producto', 'PRODUCTOS'], ['servicio', 'SERVICIOS']].forEach(function (pair) {
                var grpKey = pair[0], grpLabel = pair[1];
                var subset = filtered.filter(function (c) {
                    return ((c.tipo || c.type || '') + '').toLowerCase() === grpKey;
                });
                if (!subset.length) return;
                html += '<div class="cp-dropdown-label">' + grpLabel + ' · ' + subset.length + '</div>';
                subset.forEach(function (c) {
                    var sel = c.clave === state.modalDraft.clave_cfdi;
                    html += '<div class="cp-nm-picker-item ' + (sel ? 'cp-selected' : '') + '" data-cp-action="pick-cfdi" data-clave="' + escHtml(c.clave) + '">';
                    html += '<div class="cp-pi-main">';
                    html += '<span class="cp-pi-code">' + escHtml(c.clave) + '</span>';
                    html += '<span class="cp-pi-desc">' + escHtml(c.descripcion) + '</span>';
                    html += '</div>';
                    html += '<span class="cp-pi-check">' + ic('check', 13) + '</span>';
                    html += '</div>';
                });
            });
        }
        html += '</div>';
        return html;
    }

    function renderUnidadPicker() {
        var q = (state.pickerSearch || '').toLowerCase();
        var list = state.unidadesCache || [];
        var filtered = list.filter(function (c) {
            if (!q) return true;
            return ((c.clave || '').toLowerCase().indexOf(q) >= 0) ||
                   ((c.descripcion || '').toLowerCase().indexOf(q) >= 0);
        }).slice(0, 80);

        var html = '<div class="cp-nm-picker" data-cp-picker="unidad">';
        html += '<input type="text" class="cp-nm-picker-search" id="cpPickerSearch" placeholder="Buscar unidad..." value="' + escHtml(state.pickerSearch) + '">';
        if (list.length === 0) {
            html += '<div class="cp-nm-picker-empty">' + (state.catLoading ? 'Cargando unidades SAT…' : 'Catálogo de unidades vacío. Corre <code>seed_compras</code> en el servidor.') + '</div>';
        } else if (filtered.length === 0) {
            html += '<div class="cp-nm-picker-empty">Sin coincidencias para “' + escHtml(state.pickerSearch) + '”.</div>';
        } else {
            html += '<div class="cp-dropdown-label">UNIDADES · ' + filtered.length + '</div>';
            filtered.forEach(function (c) {
                var sel = c.clave === state.modalDraft.unidad_cfdi;
                html += '<div class="cp-nm-picker-item ' + (sel ? 'cp-selected' : '') + '" data-cp-action="pick-unidad" data-clave="' + escHtml(c.clave) + '">';
                html += '<div class="cp-pi-main">';
                html += '<span class="cp-pi-code">' + escHtml(c.clave) + '</span>';
                html += '<span class="cp-pi-desc">' + escHtml(c.descripcion) + '</span>';
                html += '</div>';
                html += '<span class="cp-pi-check">' + ic('check', 13) + '</span>';
                html += '</div>';
            });
        }
        html += '</div>';
        return html;
    }

    function renderAlmacenesPicker() {
        var q = (state.pickerSearch || '').toLowerCase();
        var list = state.almacenesCache || [];
        var filtered = list.filter(function (a) {
            if (!q) return true;
            return ((a.nombre || '').toLowerCase().indexOf(q) >= 0);
        });
        var selected = state.modalDraft.almacenes || [];

        var html = '<div class="cp-nm-picker" data-cp-picker="almacenes">';
        html += '<input type="text" class="cp-nm-picker-search" id="cpPickerSearch" placeholder="Buscar almacén..." value="' + escHtml(state.pickerSearch) + '">';
        if (filtered.length === 0) {
            html += '<div class="cp-nm-picker-empty">No hay almacenes disponibles</div>';
        } else {
            filtered.forEach(function (a) {
                var sel = selected.indexOf(a.id) >= 0 || selected.map(String).indexOf(String(a.id)) >= 0;
                html += '<div class="cp-nm-picker-item ' + (sel ? 'cp-selected' : '') + '" data-cp-action="toggle-almacen" data-id="' + escHtml(a.id) + '">';
                html += '<div class="cp-pi-main">';
                html += '<span class="cp-pi-desc" style="font-size:13px;color:#1c1c1e;font-weight:500;">' + escHtml(a.nombre) + '</span>';
                html += '</div>';
                html += '<span class="cp-pi-check">' + ic('check', 13) + '</span>';
                html += '</div>';
            });
        }
        html += '</div>';
        return html;
    }

    // Confirm modal
    function openConfirm(item) {
        state.confirmTarget = item;
        renderModals();
    }

    function renderConfirmModal(noAnim) {
        var animCls = noAnim ? ' cp-no-anim' : '';
        var p = state.confirmTarget;
        var nombre = p.nombre || p.name || '';
        var codigo = p.codigo || p.code || '';
        var estatus = p.estatus || (p.activo === false ? 'inactivo' : 'activo');
        var willDeactivate = estatus === 'activo';
        var titulo = willDeactivate ? 'Eliminar producto' : 'Eliminar producto definitivamente';
        var desc = willDeactivate
            ? ' será desactivado o eliminado según las reglas del sistema. Si tiene movimientos vinculados quedará inactivo; si no, será eliminado permanentemente.'
            : ' será eliminado permanentemente. Esta acción no se puede deshacer.';

        var html = '<div class="cp-confirm-overlay' + animCls + '" data-cp-overlay="confirm">';
        html += '<div class="cp-confirm-box' + animCls + '" role="alertdialog" aria-modal="true">';
        html += '<div class="cp-confirm-icon">' + ic('warning', 24) + '</div>';
        html += '<h3>' + escHtml(titulo) + '</h3>';
        html += '<p><strong>' + escHtml(nombre) + '</strong>' + (codigo ? ' (<span style="font-family:monospace;">' + escHtml(codigo) + '</span>)' : '') + escHtml(desc) + '</p>';
        html += '<div class="cp-confirm-actions">';
        html += '<button type="button" class="cp-btn-cancel-confirm" data-cp-action="confirm-cancel">Cancelar</button>';
        html += '<button type="button" class="cp-btn-danger" data-cp-action="confirm-yes">Eliminar</button>';
        html += '</div>';
        html += '</div></div>';
        return html;
    }

    // Import modal
    function renderImportModal(noAnim) {
        var animCls = noAnim ? ' cp-no-anim' : '';
        var html = '<div class="cp-modal-overlay' + animCls + '" data-cp-overlay="import">';
        html += '<div class="cp-notion-modal' + animCls + '" style="width:560px;" role="dialog" aria-modal="true">';

        html += '<div class="cp-nm-header">';
        html += '<div class="cp-nm-breadcrumb">' + ic('package', 13) + '<span>Compras</span>' + ic('chevRight', 12) + '<span class="cp-current">Importar productos</span></div>';
        html += '<button type="button" class="cp-nm-close" data-cp-action="import-close" aria-label="Cerrar">' + ic('x', 14) + '</button>';
        html += '</div>';

        html += '<div class="cp-nm-body">';
        html += '<h2 style="font-size:20px;font-weight:700;margin:8px 0 6px;color:#1c1c1e;">Importar desde CSV</h2>';
        html += '<p style="font-size:13px;color:#6e6e73;line-height:1.55;margin:0 0 16px;">Sube un archivo CSV con las columnas: <code style="font-family:monospace;font-size:12px;background:#f5f5f7;padding:1px 5px;border-radius:4px;">codigo, nombre, descripcion, costo, moneda, iva, clave_cfdi, unidad_cfdi</code>.</p>';

        if (!state.importResult) {
            html += '<div class="cp-import-drop" id="cpImportDrop" data-cp-action="import-pick">';
            html += ic('upload', 36);
            html += '<div class="cp-import-drop-title">Arrastra un archivo CSV aquí</div>';
            html += '<div class="cp-import-drop-text">o haz clic para seleccionar</div>';
            html += '<input type="file" id="cpImportFile" accept=".csv,text/csv" style="display:none;">';
            html += '</div>';
            html += '<div class="cp-import-progress" id="cpImportProgress" style="display:none;"><div class="cp-import-progress-bar" id="cpImportProgressBar"></div></div>';
        } else {
            var r = state.importResult;
            var created = r.created || 0;
            var updated = r.updated || 0;
            var failed = (r.errors && r.errors.length) || r.failed || 0;
            html += '<div class="cp-import-summary">';
            html += '<div class="cp-import-stat cp-success"><div class="cp-import-stat-label">Creados</div><div class="cp-import-stat-val">' + created + '</div></div>';
            html += '<div class="cp-import-stat"><div class="cp-import-stat-label">Actualizados</div><div class="cp-import-stat-val">' + updated + '</div></div>';
            html += '<div class="cp-import-stat ' + (failed ? 'cp-error' : '') + '"><div class="cp-import-stat-label">Errores</div><div class="cp-import-stat-val">' + failed + '</div></div>';
            html += '</div>';
            if (r.errors && r.errors.length) {
                html += '<div class="cp-import-errors">';
                r.errors.forEach(function (e) {
                    var row = e.row || e.line || '?';
                    var msg = e.error || e.message || JSON.stringify(e);
                    html += '<div class="cp-import-error-row"><span class="cp-row-num">Fila ' + escHtml(row) + '</span><span class="cp-row-msg">' + escHtml(msg) + '</span></div>';
                });
                html += '</div>';
            }
        }
        html += '</div>';

        html += '<div class="cp-nm-footer">';
        html += '<div class="cp-nm-footer-props"></div>';
        html += '<div class="cp-nm-footer-actions">';
        html += '<button type="button" class="cp-btn-cancel-nm" data-cp-action="import-close">' + (state.importResult ? 'Cerrar' : 'Cancelar') + '</button>';
        if (state.importResult) {
            html += '<button type="button" class="cp-btn-primary" data-cp-action="import-reset">Importar otro</button>';
        }
        html += '</div>';
        html += '</div>';

        html += '</div></div>';
        return html;
    }

    // ════════════════════════════════════════════════════════════════════
    // MODAL EVENTS
    // ════════════════════════════════════════════════════════════════════
    function bindModalEvents() {
        // Click delegation
        $modalContainer.onclick = function (ev) {
            var t = ev.target;
            // overlay click → close
            var overlay = t.dataset && t.dataset.cpOverlay;
            if (overlay && t.classList.contains('cp-modal-overlay')) {
                if (overlay === 'product') closeModal();
                else if (overlay === 'import') { state.importOpen = false; state.importResult = null; renderModals(); }
                return;
            }
            if (t.classList && t.classList.contains('cp-confirm-overlay')) {
                state.confirmTarget = null; renderModals(); return;
            }

            var trig = ev.target.closest('[data-cp-picker-trigger]');
            if (trig) {
                ev.stopPropagation();
                var pname = trig.dataset.cpPickerTrigger;
                state.openPicker = (state.openPicker === pname) ? null : pname;
                state.pickerSearch = '';
                // Si el catálogo está vacío al abrir, dispara la carga (red de
                // seguridad por si la carga inicial falló o aún no terminó).
                if (state.openPicker) {
                    var needsLoad = (
                        (pname === 'cfdi' && (!state.cfdiCache || !state.cfdiCache.length)) ||
                        (pname === 'unidad' && (!state.unidadesCache || !state.unidadesCache.length)) ||
                        (pname === 'almacenes' && (!state.almacenesCache || !state.almacenesCache.length))
                    );
                    if (needsLoad) loadCatalogos(true);
                }
                renderModals();
                if (state.openPicker) focusPickerSearch();
                return;
            }

            var act = ev.target.closest('[data-cp-action]');
            if (!act) return;
            ev.stopPropagation();
            var action = act.dataset.cpAction;

            switch (action) {
                case 'modal-close': closeModal(); break;
                case 'modal-save': saveProduct(); break;
                case 'set-moneda': state.modalDraft.moneda = act.dataset.val; renderModals(); break;
                case 'set-iva': state.modalDraft.iva = parseInt(act.dataset.val, 10); renderModals(); break;
                case 'pick-cfdi':
                    var clave = act.dataset.clave;
                    var hit = (state.cfdiCache || []).find(function (c) { return c.clave === clave; });
                    if (hit) {
                        var prevTipo = state.modalDraft.tipo || getTipoFromCfdi(state.modalDraft.clave_cfdi);
                        var newTipo = hit.tipo || hit.type;
                        if (state.modalMode === 'edit' && prevTipo && newTipo && prevTipo !== newTipo) {
                            state.modalErrors.clave_cfdi = 'No puedes cambiar de ' + prevTipo + ' a ' + newTipo + ' en edición';
                            renderModals();
                            return;
                        }
                        state.modalDraft.clave_cfdi = hit.clave;
                        state.modalDraft.clave_cfdi_descripcion = hit.descripcion;
                        state.modalDraft.tipo = newTipo;
                        delete state.modalErrors.clave_cfdi;
                        if (newTipo === 'SERVICIO') {
                            state.modalDraft.unidad_cfdi = 'E48';
                            state.modalDraft.unidad_cfdi_descripcion = 'Unidad de servicio';
                            delete state.modalErrors.unidad_cfdi;
                        }
                    }
                    state.openPicker = null;
                    state.pickerSearch = '';
                    renderModals();
                    break;
                case 'pick-unidad':
                    var uClave = act.dataset.clave;
                    var uHit = (state.unidadesCache || []).find(function (u) { return u.clave === uClave; });
                    if (uHit) {
                        state.modalDraft.unidad_cfdi = uHit.clave;
                        state.modalDraft.unidad_cfdi_descripcion = uHit.descripcion;
                        delete state.modalErrors.unidad_cfdi;
                    }
                    state.openPicker = null;
                    state.pickerSearch = '';
                    renderModals();
                    break;
                case 'toggle-almacen':
                    var aId = act.dataset.id;
                    var arr = state.modalDraft.almacenes.slice();
                    var idx = arr.map(String).indexOf(String(aId));
                    if (idx >= 0) arr.splice(idx, 1);
                    else {
                        // Try to keep numeric IDs as numbers if API uses them
                        var aIdNum = parseInt(aId, 10);
                        arr.push(isNaN(aIdNum) ? aId : aIdNum);
                    }
                    state.modalDraft.almacenes = arr;
                    renderModals();
                    focusPickerSearch();
                    break;
                case 'remove-almacen':
                    var rIdx = parseInt(act.dataset.idx, 10);
                    state.modalDraft.almacenes.splice(rIdx, 1);
                    renderModals();
                    break;
                case 'confirm-cancel': state.confirmTarget = null; renderModals(); break;
                case 'confirm-yes': doDelete(); break;
                case 'import-close': state.importOpen = false; state.importResult = null; renderModals(); break;
                case 'import-pick':
                    var f = document.getElementById('cpImportFile');
                    if (f) f.click();
                    break;
                case 'import-reset': state.importResult = null; renderModals(); break;
            }
        };

        // Field bindings (inputs / textarea)
        var inputs = $modalContainer.querySelectorAll('[data-cp-field]');
        inputs.forEach(function (el) {
            el.oninput = function () {
                var f = this.dataset.cpField;
                state.modalDraft[f] = this.value;
                if (state.modalErrors[f]) {
                    delete state.modalErrors[f];
                    var help = this.parentNode.querySelector('.cp-nm-prop-help');
                    if (help) help.style.display = 'none';
                    this.classList.remove('cp-error');
                }
            };
        });

        // Picker search
        var ps = document.getElementById('cpPickerSearch');
        if (ps) {
            ps.oninput = function () {
                state.pickerSearch = this.value;
                renderModals();
                focusPickerSearch();
            };
            ps.onclick = function (e) { e.stopPropagation(); };
        }

        // Import file input
        var fInput = document.getElementById('cpImportFile');
        if (fInput) {
            fInput.onchange = function () {
                if (this.files && this.files[0]) doImport(this.files[0]);
            };
        }
        var dropZone = document.getElementById('cpImportDrop');
        if (dropZone) {
            dropZone.ondragover = function (ev) { ev.preventDefault(); this.classList.add('cp-dragover'); };
            dropZone.ondragleave = function () { this.classList.remove('cp-dragover'); };
            dropZone.ondrop = function (ev) {
                ev.preventDefault();
                this.classList.remove('cp-dragover');
                if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]) {
                    doImport(ev.dataTransfer.files[0]);
                }
            };
        }
    }

    function focusPickerSearch() {
        setTimeout(function () {
            var el = document.getElementById('cpPickerSearch');
            if (el) {
                el.focus();
                var v = el.value; el.value = ''; el.value = v; // move cursor to end
            }
        }, 30);
    }

    // ════════════════════════════════════════════════════════════════════
    // SAVE / DELETE / IMPORT
    // ════════════════════════════════════════════════════════════════════
    function validateDraft() {
        var d = state.modalDraft;
        var errs = {};
        if (!d.codigo || !String(d.codigo).trim()) errs.codigo = 'Código obligatorio';
        if (!d.nombre || !String(d.nombre).trim()) errs.nombre = 'Nombre obligatorio';
        if (d.costo === '' || d.costo === null || d.costo === undefined) errs.costo = 'Costo obligatorio';
        else if (isNaN(parseFloat(d.costo)) || parseFloat(d.costo) < 0) errs.costo = 'Costo debe ser ≥ 0';
        if (!d.descripcion || !String(d.descripcion).trim()) errs.descripcion = 'Descripción obligatoria';
        if (!d.clave_cfdi) errs.clave_cfdi = 'Clave CFDI obligatoria';
        if (!d.unidad_cfdi) errs.unidad_cfdi = 'Unidad CFDI obligatoria';
        return errs;
    }

    function saveProduct() {
        var errs = validateDraft();
        if (Object.keys(errs).length > 0) {
            state.modalErrors = errs;
            renderModals();
            return;
        }
        var d = state.modalDraft;
        var payload = {
            codigo: d.codigo,
            nombre: d.nombre,
            descripcion: d.descripcion,
            costo: parseFloat(d.costo),
            moneda: d.moneda,
            iva: parseFloat(d.iva),
            clave_cfdi: d.clave_cfdi,
            unidad_cfdi: d.unidad_cfdi,
            almacenes: d.almacenes || [],
        };
        var isEdit = state.modalMode === 'edit';
        if (isEdit) delete payload.codigo;

        var url = '/app/api/compras/productos/' + (isEdit ? d.id + '/' : '');
        var opts = { method: isEdit ? 'PUT' : 'POST', body: payload };

        // Disable save UI feedback could be added here
        window.comprasFetch(url, opts)
            .then(function (data) {
                toast('success', isEdit ? 'Producto actualizado' : 'Producto creado');
                closeModal();
                if (state.detailItem && isEdit) state.detailItem = data || state.detailItem;
                fetchProductos();
                if (state.detailItem) renderDetail();
            })
            .catch(function (err) {
                if (err && err.errors && typeof err.errors === 'object') {
                    state.modalErrors = err.errors;
                    renderModals();
                } else if (err && err.error) {
                    // Map common code/duplicate errors
                    var msg = err.error || 'Error al guardar';
                    if (/codigo|c[oó]digo/i.test(msg) && /(unique|duplicad|existe|ya)/i.test(msg)) {
                        state.modalErrors.codigo = 'Código ya existe';
                        renderModals();
                    } else {
                        toast('error', msg);
                    }
                } else {
                    toast('error', 'Error al guardar');
                }
            });
    }

    function doDelete() {
        var p = state.confirmTarget;
        if (!p) return;
        var url = '/app/api/compras/productos/' + p.id + '/';
        window.comprasFetch(url, { method: 'DELETE' })
            .then(function (data) {
                var action = data && data.action;
                var msg = (action === 'soft_delete') ? 'Producto desactivado' : 'Producto eliminado';
                toast('success', msg);
                state.confirmTarget = null;
                if (state.detailItem && String(state.detailItem.id) === String(p.id)) {
                    closeDetail();
                }
                renderModals();
                fetchProductos();
            })
            .catch(function (err) {
                toast('error', (err && err.error) || 'Error al eliminar');
                state.confirmTarget = null;
                renderModals();
            });
    }

    function doImport(file) {
        var fd = new FormData();
        fd.append('file', file);
        var prog = document.getElementById('cpImportProgress');
        var bar = document.getElementById('cpImportProgressBar');
        if (prog) prog.style.display = 'block';
        if (bar) bar.style.width = '20%';

        // Use XHR for upload progress
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/app/api/compras/productos/import/');
        xhr.setRequestHeader('X-CSRFToken', getCsrf());
        xhr.upload.onprogress = function (e) {
            if (bar && e.lengthComputable) {
                var pct = Math.min(95, (e.loaded / e.total) * 100);
                bar.style.width = pct + '%';
            }
        };
        xhr.onload = function () {
            if (bar) bar.style.width = '100%';
            try {
                var data = JSON.parse(xhr.responseText);
                if (xhr.status >= 200 && xhr.status < 300) {
                    state.importResult = data || { created: 0, updated: 0, errors: [] };
                    var ok = (state.importResult.created || 0) + (state.importResult.updated || 0);
                    toast('success', 'Importación completada · ' + ok + ' producto' + (ok === 1 ? '' : 's'));
                    fetchProductos();
                } else {
                    state.importResult = { created: 0, updated: 0, errors: (data && data.errors) || [{ row: '?', error: (data && data.error) || ('HTTP ' + xhr.status) }] };
                    toast('error', 'Error en la importación');
                }
            } catch (e) {
                state.importResult = { created: 0, updated: 0, errors: [{ row: '?', error: 'Respuesta inválida del servidor' }] };
                toast('error', 'Error en la importación');
            }
            renderModals();
        };
        xhr.onerror = function () {
            state.importResult = { created: 0, updated: 0, errors: [{ row: '?', error: 'Error de red' }] };
            renderModals();
            toast('error', 'Error de red');
        };
        xhr.send(fd);
    }

    function getCsrf() {
        var v = '; ' + document.cookie;
        var parts = v.split('; csrftoken=');
        if (parts.length === 2) return parts.pop().split(';').shift();
        return '';
    }

    // ════════════════════════════════════════════════════════════════════
    // TOASTS
    // ════════════════════════════════════════════════════════════════════
    function toast(variant, msg) {
        if (!$toastContainer) return;
        var v = (variant === 'success' || variant === 'error' || variant === 'info') ? variant : 'info';
        var iconKey = (v === 'success') ? 'check' : (v === 'error') ? 'warning' : 'info';
        var node = document.createElement('div');
        node.className = 'cp-toast cp-toast-' + v;
        node.innerHTML =
            '<span class="cp-toast-icon">' + ic(iconKey, 16) + '</span>' +
            '<span class="cp-toast-msg">' + escHtml(msg) + '</span>' +
            '<button type="button" class="cp-toast-close" aria-label="Cerrar">' + ic('x', 12) + '</button>';
        // Limit to 4
        var toasts = $toastContainer.querySelectorAll('.cp-toast');
        if (toasts.length >= 4) {
            toasts[0].parentNode.removeChild(toasts[0]);
        }
        $toastContainer.appendChild(node);
        var timer = setTimeout(function () {
            dismiss();
        }, 3000);
        function dismiss() {
            clearTimeout(timer);
            if (!node.parentNode) return;
            node.style.transition = 'opacity .2s ease, transform .2s ease';
            node.style.opacity = '0';
            node.style.transform = 'translateX(20px)';
            setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 220);
        }
        node.querySelector('.cp-toast-close').onclick = dismiss;
    }

    // ════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ════════════════════════════════════════════════════════════════════
    window.comprasProductosInit = init;
})();
