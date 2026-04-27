/* ═══════════════════════════════════════════════════════════════════════
   compras_proveedores.js — UI completa de Proveedores (módulo Compras)
   - Lista, filtros, búsqueda, paginación
   - Modal Notion-style (4 secciones: Identificación, Condiciones, Bancarios, Dirección)
   - Detalle full-page con tabs
   - Hover preview, toasts, confirm delete, import/export
   - Validación RFC SAT y CLABE en vivo
   Define: window.comprasProveedoresInit
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    /* ────────── Constantes ────────── */
    var API_BASE = '/app/api/compras/proveedores/';

    var BANCOS_COMUNES = [
        'BBVA', 'Banamex (Citibanamex)', 'Santander', 'Banorte', 'HSBC',
        'Scotiabank', 'Inbursa', 'Banregio', 'Azteca', 'BanCoppel',
        'Mifel', 'Bajío', 'Afirme', 'Multiva'
    ];

    var ESTADOS_MX = [
        'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche',
        'Chiapas', 'Chihuahua', 'CDMX', 'Coahuila', 'Colima', 'Durango',
        'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco', 'México', 'Michoacán',
        'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro',
        'Quintana Roo', 'SLP', 'Sinaloa', 'Sonora', 'Tabasco', 'Tamaulipas',
        'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas'
    ];

    /* ────────── Iconos SVG inline ────────── */
    var I = {
        search: 'M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z',
        plus: 'M12 5v14M5 12h14',
        filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
        edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z',
        trash: ['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
        x: 'M18 6L6 18M6 6l12 12',
        check: 'M20 6L9 17l-5-5',
        chevDown: 'M6 9l6 6 6-6',
        chevLeft: 'M15 18l-6-6 6-6',
        chevRight: 'M9 18l6-6-6-6',
        building: ['M3 21h18', 'M5 21V7l8-4v18', 'M19 21V11l-6-4', 'M9 9v.01', 'M9 12v.01', 'M9 15v.01', 'M9 18v.01'],
        user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
        alert: ['M12 9v4', 'M12 17h.01', 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'],
        upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
        download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
        calendar: ['M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
        dollar: ['M12 1v22', 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'],
        bank: ['M3 21h18', 'M3 10h18', 'M5 6l7-3 7 3', 'M4 10v11', 'M20 10v11', 'M8 14v3', 'M12 14v3', 'M16 14v3'],
        mapPin: ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
        idCard: ['M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z', 'M9 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M5 16c.63-1.69 2.4-3 4-3s3.37 1.31 4 3', 'M14 10h5', 'M14 14h3'],
        list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
        moreV: ['M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M12 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M12 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
        clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
        arrUp: 'M18 15l-6-6-6 6',
        arrDown: 'M6 9l6 6 6-6'
    };

    function svgIcon(d, size) {
        size = size || 16;
        var paths = Array.isArray(d) ? d : [d];
        var html = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
        for (var i = 0; i < paths.length; i++) html += '<path d="' + paths[i] + '"/>';
        html += '</svg>';
        return html;
    }

    /* ────────── Estado ────────── */
    var state = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 1,
        q: '',
        tipoPersona: 'todos',
        estatus: 'todos',
        sort: '-created_at',
        loading: false,
        view: 'list', // 'list' | 'detail'
        detailItem: null,
        detailTab: 'info',
        showFilter: false,
        showActions: false,
        modalOpen: false,
        modalEdit: null,
        modalForm: null,
        modalErrors: {},
        modalDireccionOpen: false,
        deleteTarget: null,
        importOpen: false,
        importBusy: false,
        importResult: null,
        toast: null,
        preview: null,
        previewTimer: null,
        rfcDebounce: null,
        searchDebounce: null,
        initialized: false
    };

    /* ────────── Helpers ────────── */
    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function fmtMoney(n) {
        n = Number(n) || 0;
        return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function fmtMoneyShort(n) {
        n = Number(n) || 0;
        if (n === 0) return '';
        if (n >= 1000000) return '$' + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
        return '$' + Math.round(n);
    }

    function debounce(fn, ms) {
        var t;
        return function () {
            var args = arguments, ctx = this;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(ctx, args); }, ms);
        };
    }

    /* ────────── Validación ────────── */
    function validateRFC(rfc) {
        if (!rfc) return { valid: true, tipo: '', empty: true };
        rfc = String(rfc).toUpperCase().trim();
        var re = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;
        if (!re.test(rfc)) {
            return { valid: false, tipo: '', msg: 'Formato SAT inválido', rfc: rfc };
        }
        var tipo = rfc.length === 12 ? 'MORAL' : 'FISICA';
        return { valid: true, tipo: tipo, rfc: rfc };
    }

    function validateCLABE(clabe) {
        if (!clabe) return { valid: true, empty: true };
        clabe = String(clabe).trim();
        if (!/^\d{18}$/.test(clabe)) {
            return { valid: false, msg: '18 dígitos exactos' };
        }
        return { valid: true };
    }

    /* ────────── Toast ────────── */
    function showToast(msg, kind) {
        kind = kind || 'success';
        if (state.toast && state.toast.timer) clearTimeout(state.toast.timer);
        state.toast = { msg: msg, kind: kind };
        renderToast();
        state.toast.timer = setTimeout(function () {
            state.toast = null;
            renderToast();
        }, 2800);
    }

    function renderToast() {
        var el = document.getElementById('cv-toast-host');
        if (!el) {
            el = document.createElement('div');
            el.id = 'cv-toast-host';
            document.body.appendChild(el);
        }
        if (!state.toast) {
            el.innerHTML = '';
            return;
        }
        var ic = state.toast.kind === 'error' ? I.alert : (state.toast.kind === 'info' ? I.alert : I.check);
        el.innerHTML = '<div class="cv-toast cv-' + state.toast.kind + '">' +
            '<span class="cv-toast-icon">' + svgIcon(ic, 15) + '</span>' +
            escapeHtml(state.toast.msg) +
            '</div>';
    }

    /* ────────── API calls ────────── */
    function apiList() {
        var params = new URLSearchParams();
        if (state.q) params.set('q', state.q);
        if (state.tipoPersona && state.tipoPersona !== 'todos') params.set('tipo_persona', state.tipoPersona);
        if (state.estatus && state.estatus !== 'todos') params.set('estatus', state.estatus);
        if (state.sort) params.set('sort', state.sort);
        params.set('page', state.page);
        params.set('page_size', state.pageSize);
        return window.comprasFetch(API_BASE + '?' + params.toString());
    }

    function apiGet(id) {
        return window.comprasFetch(API_BASE + id + '/');
    }

    function apiCreate(payload) {
        return window.comprasFetch(API_BASE, { method: 'POST', body: payload });
    }

    function apiUpdate(id, payload) {
        return window.comprasFetch(API_BASE + id + '/', { method: 'PUT', body: payload });
    }

    function apiDelete(id) {
        return window.comprasFetch(API_BASE + id + '/', { method: 'DELETE' });
    }

    function apiImport(file) {
        var fd = new FormData();
        fd.append('archivo', file);
        return window.comprasFetch(API_BASE + 'import/', { method: 'POST', body: fd });
    }

    /* ────────── Fetch list & render ────────── */
    function fetchProveedores() {
        state.loading = true;
        renderShell();
        apiList()
            .then(function (data) {
                state.items = data.items || [];
                state.total = data.total || 0;
                state.page = data.page || 1;
                state.pageSize = data.page_size || state.pageSize;
                state.totalPages = data.total_pages || 1;
                state.loading = false;
                renderShell();
            })
            .catch(function (err) {
                state.loading = false;
                state.items = [];
                renderShell();
                showToast((err && err.error) || 'Error al cargar proveedores', 'error');
            });
    }

    /* ────────── Render: shell raíz ────────── */
    function renderShell() {
        var root = document.getElementById('comprasProveedoresSection');
        if (!root) return;
        if (state.view === 'detail' && state.detailItem) {
            root.innerHTML = renderDetailHTML();
            attachDetailEvents(root);
        } else {
            root.innerHTML = renderListHTML();
            attachListEvents(root);
        }
        renderModalIfOpen();
        renderImportIfOpen();
        renderConfirmIfOpen();
    }

    /* ────────── Lista HTML ────────── */
    function renderListHTML() {
        var html = '<div class="cv-root">';

        // toolbar
        html += '<div class="cv-toolbar">' +
            '<div class="cv-toolbar-left">' +
                '<div class="cv-dropdown-anchor" id="cv-filter-anchor">' +
                    '<button class="cv-btn-ghost" id="cv-btn-filter">' +
                        svgIcon(I.filter, 13) + 'Filtrar' +
                        ((state.tipoPersona !== 'todos' || state.estatus !== 'todos') ?
                            '<span style="margin-left:4px;background:#3478f6;color:#fff;border-radius:50%;width:14px;height:14px;font-size:9px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;">' +
                            ((state.tipoPersona !== 'todos' ? 1 : 0) + (state.estatus !== 'todos' ? 1 : 0)) +
                            '</span>' : '') +
                    '</button>' +
                    (state.showFilter ? renderFilterDropdown() : '') +
                '</div>' +
                '<div class="cv-search-wrap">' +
                    svgIcon(I.search, 13) +
                    '<input class="cv-search-input" id="cv-search" placeholder="Buscar razón social, RFC..." value="' + escapeHtml(state.q) + '">' +
                '</div>' +
            '</div>' +
            '<div class="cv-toolbar-right">' +
                '<div class="cv-dropdown-anchor" id="cv-actions-anchor">' +
                    '<button class="cv-btn-ghost" id="cv-btn-actions">Acciones' + svgIcon(I.chevDown, 12) + '</button>' +
                    (state.showActions ? renderActionsDropdown() : '') +
                '</div>' +
                '<button class="cv-btn-primary" id="cv-btn-add">' + svgIcon(I.plus, 14) + 'Agregar' + '</button>' +
            '</div>' +
        '</div>';

        // chips de filtros activos
        var chips = [];
        if (state.tipoPersona !== 'todos') {
            chips.push({ key: 'tipoPersona', label: state.tipoPersona === 'MORAL' ? 'Persona Moral' : 'Persona Física' });
        }
        if (state.estatus !== 'todos') {
            chips.push({ key: 'estatus', label: state.estatus === 'activo' ? 'Activo' : 'Inactivo' });
        }
        if (state.q) {
            chips.push({ key: 'q', label: '"' + state.q + '"' });
        }
        if (chips.length) {
            html += '<div class="cv-filter-chips-row">';
            chips.forEach(function (c) {
                html += '<span class="cv-filter-chip">' +
                    escapeHtml(c.label) +
                    '<button class="cv-filter-chip-x" data-clear-chip="' + c.key + '" aria-label="Quitar">' + svgIcon(I.x, 10) + '</button>' +
                    '</span>';
            });
            html += '<button class="cv-filter-chip-clear" id="cv-clear-all-chips">Limpiar</button>';
            html += '</div>';
        }

        // tabla
        html += '<div class="cv-table-card">';
        html += renderTableHeader();
        html += '<div class="cv-tbl-body" id="cv-tbody">';
        if (state.loading) {
            html += '<div class="cv-loading"><span class="cv-spinner"></span>Cargando proveedores...</div>';
        } else if (!state.items.length) {
            html += renderEmptyState();
        } else {
            state.items.forEach(function (p) { html += renderRow(p); });
        }
        html += '</div>';
        if (!state.loading && state.items.length) {
            html += renderPagination();
        }
        html += '</div>'; // /table-card

        html += '</div>'; // /root
        return html;
    }

    function renderFilterDropdown() {
        var rows = [];
        rows.push('<div class="cv-dropdown-label">Tipo</div>');
        var tipos = [['todos', 'Todos'], ['MORAL', 'Persona Moral'], ['FISICA', 'Persona Física']];
        tipos.forEach(function (t) {
            var sel = state.tipoPersona === t[0];
            rows.push('<div class="cv-dropdown-item" data-set-tipo="' + t[0] + '">' +
                '<span class="cv-check-slot">' + (sel ? svgIcon(I.check, 13) : '') + '</span>' +
                escapeHtml(t[1]) + '</div>');
        });
        rows.push('<div class="cv-dropdown-sep"></div>');
        rows.push('<div class="cv-dropdown-label">Estatus</div>');
        var ests = [['todos', 'Todos'], ['activo', 'Activo'], ['inactivo', 'Inactivo']];
        ests.forEach(function (e) {
            var sel = state.estatus === e[0];
            rows.push('<div class="cv-dropdown-item" data-set-estatus="' + e[0] + '">' +
                '<span class="cv-check-slot">' + (sel ? svgIcon(I.check, 13) : '') + '</span>' +
                escapeHtml(e[1]) + '</div>');
        });
        return '<div class="cv-dropdown-menu" id="cv-filter-menu">' + rows.join('') + '</div>';
    }

    function renderActionsDropdown() {
        return '<div class="cv-dropdown-menu cv-right" id="cv-actions-menu">' +
            '<div class="cv-dropdown-item" id="cv-act-import">' +
                '<span class="cv-check-slot">' + svgIcon(I.upload, 13) + '</span>Importar CSV' +
            '</div>' +
            '<div class="cv-dropdown-item" id="cv-act-export">' +
                '<span class="cv-check-slot">' + svgIcon(I.download, 13) + '</span>Exportar CSV' +
            '</div>' +
        '</div>';
    }

    function sortIcon(col) {
        if (!state.sort) return '';
        var dir, field;
        if (state.sort.charAt(0) === '-') { dir = 'desc'; field = state.sort.slice(1); }
        else { dir = 'asc'; field = state.sort; }
        if (field !== col) return '';
        return svgIcon(dir === 'asc' ? I.arrUp : I.arrDown, 10);
    }

    function isSorted(col) {
        var f = state.sort.charAt(0) === '-' ? state.sort.slice(1) : state.sort;
        return f === col;
    }

    function renderTableHeader() {
        return '<div class="cv-tbl-header">' +
            '<div class="cv-tbl-header-cell ' + (isSorted('razon_social') ? 'sorted' : '') + '" data-sort="razon_social">Razón social ' + sortIcon('razon_social') + '</div>' +
            '<div class="cv-tbl-header-cell ' + (isSorted('rfc') ? 'sorted' : '') + '" data-sort="rfc">RFC ' + sortIcon('rfc') + '</div>' +
            '<div class="cv-tbl-header-cell cv-no-sort">Persona</div>' +
            '<div class="cv-tbl-header-cell ' + (isSorted('dias_credito') ? 'sorted' : '') + '" data-sort="dias_credito">Crédito ' + sortIcon('dias_credito') + '</div>' +
            '<div class="cv-tbl-header-cell ' + (isSorted('estatus') ? 'sorted' : '') + '" data-sort="estatus">Estatus ' + sortIcon('estatus') + '</div>' +
            '<div class="cv-tbl-header-cell cv-no-sort" style="justify-content:flex-end;">Acciones</div>' +
        '</div>';
    }

    function deriveTipo(p) {
        if (p.tipo_persona) return p.tipo_persona;
        if (p.rfc) return p.rfc.length === 12 ? 'MORAL' : 'FISICA';
        return '';
    }

    function renderRow(p) {
        var tipo = deriveTipo(p);
        var estatus = p.estatus || 'activo';
        var loc = [p.ciudad, p.estado].filter(Boolean).join(', ');
        var subParts = [];
        if (loc) subParts.push(loc);
        else if (!p.banco) subParts.push('Sin dirección registrada');
        if (p.banco) subParts.push(p.banco);

        var rfcVal = validateRFC(p.rfc);
        var rfcCls = !p.rfc ? 'cv-rfc-empty' : (rfcVal.valid ? 'cv-rfc cv-rfc-valid' : 'cv-rfc cv-rfc-invalid');
        var rfcText = p.rfc || 'Sin RFC';

        var dias = p.dias_credito != null ? p.dias_credito : 0;
        var monto = Number(p.monto_credito || 0);
        var creditoHtml;
        if (dias === 0 && monto === 0) {
            creditoHtml = '<span class="cv-credito-empty">—</span>';
        } else {
            creditoHtml = '<div class="cv-credito">' +
                '<span class="cv-credito-dias">' + dias + 'd</span>' +
                (monto > 0 ? '<span class="cv-credito-monto">' + fmtMoneyShort(monto) + '</span>' : '') +
                '</div>';
        }

        return '<div class="cv-tbl-row" data-id="' + p.id + '">' +
            '<div>' +
                '<div class="cv-name">' + escapeHtml(p.razon_social || '(sin nombre)') + '</div>' +
                '<div class="cv-name-sub">' + escapeHtml(subParts.join(' · ')) + '</div>' +
            '</div>' +
            '<div>' +
                '<span class="' + rfcCls + '">' + escapeHtml(rfcText) + '</span>' +
            '</div>' +
            '<div>' +
                (tipo ? '<span class="cv-badge ' + (tipo === 'MORAL' ? 'cv-badge-moral' : 'cv-badge-fisica') + '">' + (tipo === 'MORAL' ? 'Moral' : 'Física') + '</span>' : '<span class="cv-rfc-empty">—</span>') +
            '</div>' +
            '<div>' + creditoHtml + '</div>' +
            '<div>' +
                '<span class="cv-badge ' + (estatus === 'activo' ? 'cv-badge-active' : 'cv-badge-inactive') + '">' + (estatus === 'activo' ? 'Activo' : 'Inactivo') + '</span>' +
            '</div>' +
            '<div class="cv-row-actions">' +
                '<button class="cv-icon-btn" data-edit="' + p.id + '" title="Editar">' + svgIcon(I.edit, 14) + '</button>' +
                '<button class="cv-icon-btn cv-danger" data-delete="' + p.id + '" title="Eliminar">' + svgIcon(I.trash, 14) + '</button>' +
            '</div>' +
        '</div>';
    }

    function renderEmptyState() {
        var hasFilter = state.q || state.tipoPersona !== 'todos' || state.estatus !== 'todos';
        if (hasFilter) {
            return '<div class="cv-empty">' +
                '<svg class="cv-empty-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<circle cx="28" cy="28" r="14"/>' +
                    '<line x1="38" y1="38" x2="52" y2="52"/>' +
                    '<line x1="20" y1="20" x2="36" y2="36"/>' +
                '</svg>' +
                '<div class="cv-empty-title">Sin resultados</div>' +
                '<div class="cv-empty-desc">No encontramos proveedores con los filtros aplicados. Intenta otros criterios.</div>' +
                '<button class="cv-btn-ghost" id="cv-empty-clear">Limpiar filtros</button>' +
            '</div>';
        }
        return '<div class="cv-empty">' +
            '<svg class="cv-empty-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
                '<rect x="6" y="20" width="22" height="36" rx="2"/>' +
                '<line x1="11" y1="28" x2="14" y2="28"/>' +
                '<line x1="20" y1="28" x2="23" y2="28"/>' +
                '<line x1="11" y1="36" x2="14" y2="36"/>' +
                '<line x1="20" y1="36" x2="23" y2="36"/>' +
                '<line x1="11" y1="44" x2="14" y2="44"/>' +
                '<line x1="20" y1="44" x2="23" y2="44"/>' +
                '<path d="M28 38l8-3 4 3 8-3 8 3v18H28z"/>' +
                '<path d="M36 50c2 0 3 1 5 1s4-1 5 0"/>' +
                '<circle cx="44" cy="30" r="3"/>' +
            '</svg>' +
            '<div class="cv-empty-title">Aún no tienes proveedores</div>' +
            '<div class="cv-empty-desc">Comienza a registrar a tus proveedores para gestionar compras, crédito y datos bancarios.</div>' +
            '<button class="cv-btn-primary" id="cv-empty-add">' + svgIcon(I.plus, 13) + 'Registrar primer proveedor</button>' +
        '</div>';
    }

    function renderPagination() {
        var from = (state.page - 1) * state.pageSize + 1;
        var to = Math.min(state.page * state.pageSize, state.total);
        return '<div class="cv-pag-bar">' +
            '<div class="cv-pag-info">Mostrando ' + from + '–' + to + ' de ' + state.total + '</div>' +
            '<div class="cv-pag-controls">' +
                '<button class="cv-pag-btn" id="cv-pag-prev" ' + (state.page <= 1 ? 'disabled' : '') + '>' + svgIcon(I.chevLeft, 12) + '</button>' +
                '<span class="cv-pag-num"><strong>' + state.page + '</strong> / ' + state.totalPages + '</span>' +
                '<button class="cv-pag-btn" id="cv-pag-next" ' + (state.page >= state.totalPages ? 'disabled' : '') + '>' + svgIcon(I.chevRight, 12) + '</button>' +
            '</div>' +
        '</div>';
    }

    /* ────────── Eventos lista ────────── */
    function attachListEvents(root) {
        var btnAdd = $('#cv-btn-add', root);
        if (btnAdd) btnAdd.addEventListener('click', function () { openModal(null); });
        var emptyAdd = $('#cv-empty-add', root);
        if (emptyAdd) emptyAdd.addEventListener('click', function () { openModal(null); });
        var emptyClear = $('#cv-empty-clear', root);
        if (emptyClear) emptyClear.addEventListener('click', function () {
            state.q = ''; state.tipoPersona = 'todos'; state.estatus = 'todos'; state.page = 1;
            fetchProveedores();
        });

        var btnFilter = $('#cv-btn-filter', root);
        if (btnFilter) btnFilter.addEventListener('click', function (e) {
            e.stopPropagation();
            state.showActions = false;
            state.showFilter = !state.showFilter;
            renderShell();
        });
        var btnActions = $('#cv-btn-actions', root);
        if (btnActions) btnActions.addEventListener('click', function (e) {
            e.stopPropagation();
            state.showFilter = false;
            state.showActions = !state.showActions;
            renderShell();
        });

        // search debounced
        var search = $('#cv-search', root);
        if (search) {
            search.addEventListener('input', function (ev) {
                var v = ev.target.value;
                if (state.searchDebounce) clearTimeout(state.searchDebounce);
                state.searchDebounce = setTimeout(function () {
                    state.q = v;
                    state.page = 1;
                    fetchProveedores();
                }, 280);
            });
            search.addEventListener('keydown', function (ev) {
                if (ev.key === 'Escape') { ev.target.value = ''; state.q = ''; state.page = 1; fetchProveedores(); }
            });
        }

        // dropdown items
        $$('[data-set-tipo]', root).forEach(function (it) {
            it.addEventListener('click', function () {
                state.tipoPersona = it.getAttribute('data-set-tipo');
                state.page = 1;
                state.showFilter = false;
                fetchProveedores();
            });
        });
        $$('[data-set-estatus]', root).forEach(function (it) {
            it.addEventListener('click', function () {
                state.estatus = it.getAttribute('data-set-estatus');
                state.page = 1;
                state.showFilter = false;
                fetchProveedores();
            });
        });

        // chip remove
        $$('[data-clear-chip]', root).forEach(function (b) {
            b.addEventListener('click', function () {
                var key = b.getAttribute('data-clear-chip');
                if (key === 'tipoPersona') state.tipoPersona = 'todos';
                else if (key === 'estatus') state.estatus = 'todos';
                else if (key === 'q') state.q = '';
                state.page = 1;
                fetchProveedores();
            });
        });
        var clearAll = $('#cv-clear-all-chips', root);
        if (clearAll) clearAll.addEventListener('click', function () {
            state.q = ''; state.tipoPersona = 'todos'; state.estatus = 'todos'; state.page = 1;
            fetchProveedores();
        });

        // sort
        $$('.cv-tbl-header-cell[data-sort]', root).forEach(function (h) {
            h.addEventListener('click', function () {
                var col = h.getAttribute('data-sort');
                if (!col) return;
                var cur = state.sort;
                if (cur === col) state.sort = '-' + col;
                else if (cur === '-' + col) state.sort = col;
                else state.sort = col;
                fetchProveedores();
            });
        });

        // rows
        $$('.cv-tbl-row', root).forEach(function (r) {
            var id = parseInt(r.getAttribute('data-id'), 10);
            r.addEventListener('click', function (e) {
                if (e.target.closest('[data-edit], [data-delete]')) return;
                openDetail(id);
            });
            r.addEventListener('mouseenter', function (e) {
                if (state.previewTimer) clearTimeout(state.previewTimer);
                var rect = r.getBoundingClientRect();
                state.previewTimer = setTimeout(function () {
                    var item = state.items.find(function (x) { return x.id === id; });
                    if (item) {
                        showPreview(item, { x: rect.right - 20, y: rect.top });
                    }
                }, 420);
            });
            r.addEventListener('mouseleave', function () {
                if (state.previewTimer) clearTimeout(state.previewTimer);
                hidePreview();
            });
        });

        $$('[data-edit]', root).forEach(function (b) {
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = parseInt(b.getAttribute('data-edit'), 10);
                var item = state.items.find(function (x) { return x.id === id; });
                if (item) openModal(item);
            });
        });
        $$('[data-delete]', root).forEach(function (b) {
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = parseInt(b.getAttribute('data-delete'), 10);
                var item = state.items.find(function (x) { return x.id === id; });
                if (item) openConfirm(item);
            });
        });

        // pagination
        var prev = $('#cv-pag-prev', root);
        var next = $('#cv-pag-next', root);
        if (prev) prev.addEventListener('click', function () { if (state.page > 1) { state.page--; fetchProveedores(); } });
        if (next) next.addEventListener('click', function () { if (state.page < state.totalPages) { state.page++; fetchProveedores(); } });

        // actions: import / export
        var actImport = $('#cv-act-import', root);
        if (actImport) actImport.addEventListener('click', function () {
            state.showActions = false;
            openImport();
        });
        var actExport = $('#cv-act-export', root);
        if (actExport) actExport.addEventListener('click', function () {
            state.showActions = false;
            renderShell();
            window.location.href = API_BASE + 'export/';
            showToast('Exportando proveedores...', 'info');
        });

        // close dropdowns on outside click
        if (state.showFilter || state.showActions) {
            setTimeout(function () {
                document.addEventListener('click', closeDropdownsOnce);
            }, 0);
        }
    }

    function closeDropdownsOnce(ev) {
        var inFilter = ev.target.closest('#cv-filter-menu, #cv-btn-filter');
        var inActions = ev.target.closest('#cv-actions-menu, #cv-btn-actions');
        if (!inFilter && !inActions) {
            state.showFilter = false;
            state.showActions = false;
            document.removeEventListener('click', closeDropdownsOnce);
            renderShell();
        }
    }

    /* ────────── Hover preview ────────── */
    function showPreview(item, pos) {
        state.preview = { item: item, pos: pos };
        renderPreview();
    }
    function hidePreview() {
        state.preview = null;
        renderPreview();
    }
    function renderPreview() {
        var el = document.getElementById('cv-preview-host');
        if (!el) {
            el = document.createElement('div');
            el.id = 'cv-preview-host';
            document.body.appendChild(el);
        }
        if (!state.preview) { el.innerHTML = ''; return; }
        var p = state.preview.item;
        var pos = state.preview.pos;
        var left = Math.min(pos.x + 12, window.innerWidth - 296);
        var top = Math.min(Math.max(pos.y - 10, 12), window.innerHeight - 240);
        var rfc = p.rfc || 'Sin RFC';
        var loc = [p.ciudad, p.estado].filter(Boolean).join(', ') || '—';
        var dias = p.dias_credito || 0;
        var monto = Number(p.monto_credito || 0);
        var html = '<div class="cv-preview-card" style="left:' + left + 'px;top:' + top + 'px;">' +
            '<div class="cv-preview-name">' + escapeHtml(p.razon_social || '') + '</div>' +
            '<div class="cv-preview-sub">' + escapeHtml(rfc) + '</div>' +
            '<div class="cv-preview-stat"><span class="cv-preview-stat-label">Banco</span><span class="cv-preview-stat-val">' + escapeHtml(p.banco || '—') + '</span></div>' +
            '<div class="cv-preview-stat"><span class="cv-preview-stat-label">Ciudad</span><span class="cv-preview-stat-val">' + escapeHtml(loc) + '</span></div>' +
            '<div class="cv-preview-stat"><span class="cv-preview-stat-label">Días crédito</span><span class="cv-preview-stat-val">' + dias + 'd</span></div>' +
            (monto > 0 ? '<div class="cv-preview-stat"><span class="cv-preview-stat-label">Monto crédito</span><span class="cv-preview-stat-val">$' + fmtMoney(monto) + '</span></div>' : '') +
        '</div>';
        el.innerHTML = html;
    }

    /* ────────── Detail page ────────── */
    function openDetail(id) {
        var item = state.items.find(function (x) { return x.id === id; });
        if (item) {
            state.detailItem = item;
            state.view = 'detail';
            state.detailTab = 'info';
            renderShell();
            // refresh from server in bg
            apiGet(id).then(function (full) {
                state.detailItem = full;
                if (state.view === 'detail') renderShell();
            }).catch(function () {});
        } else {
            apiGet(id).then(function (full) {
                state.detailItem = full;
                state.view = 'detail';
                state.detailTab = 'info';
                renderShell();
            }).catch(function (err) {
                showToast((err && err.error) || 'No se pudo cargar el proveedor', 'error');
            });
        }
    }

    function closeDetail() {
        state.view = 'list';
        state.detailItem = null;
        renderShell();
    }

    function renderDetailHTML() {
        var p = state.detailItem;
        var tipo = deriveTipo(p);
        var loc = [p.calle, p.numero, p.colonia, p.ciudad, p.estado, p.cp].filter(Boolean).join(', ') || '—';
        var dias = p.dias_credito != null ? p.dias_credito : 0;
        var monto = Number(p.monto_credito || 0);
        var estatus = p.estatus || 'activo';

        return '<div class="cv-detail-root">' +
            '<div class="cv-detail-header">' +
                '<button class="cv-back-btn" id="cv-detail-back">' + svgIcon(I.chevLeft, 14) + 'Proveedores</button>' +
                '<span style="font-size:12px;color:#aeaeb2;">·</span>' +
                '<span class="cv-detail-title">' + escapeHtml(p.razon_social || '') + '</span>' +
                (p.rfc ? '<span class="cv-detail-rfc">' + escapeHtml(p.rfc) + '</span>' : '') +
                '<span class="cv-badge ' + (estatus === 'activo' ? 'cv-badge-active' : 'cv-badge-inactive') + '" style="margin-left:6px;">' + (estatus === 'activo' ? 'Activo' : 'Inactivo') + '</span>' +
                '<div class="cv-detail-actions">' +
                    '<button class="cv-btn-ghost cv-danger" id="cv-detail-del">' + svgIcon(I.trash, 13) + 'Eliminar</button>' +
                    '<button class="cv-btn-primary" id="cv-detail-edit">' + svgIcon(I.edit, 13) + 'Editar</button>' +
                '</div>' +
            '</div>' +

            '<div class="cv-detail-grid">' +
                // left col
                '<div style="display:flex;flex-direction:column;gap:16px;">' +
                    '<div class="cv-detail-card">' +
                        '<div class="cv-detail-tabs">' +
                            '<button class="cv-detail-tab ' + (state.detailTab === 'info' ? 'cv-active' : '') + '" data-detail-tab="info">Información</button>' +
                            '<button class="cv-detail-tab ' + (state.detailTab === 'docs' ? 'cv-active' : '') + '" data-detail-tab="docs">Documentos</button>' +
                            '<button class="cv-detail-tab ' + (state.detailTab === 'historial' ? 'cv-active' : '') + '" data-detail-tab="historial">Historial</button>' +
                        '</div>' +
                        '<div class="cv-tab-pane">' + renderDetailTabContent(p, tipo, loc) + '</div>' +
                    '</div>' +
                '</div>' +
                // right col
                '<div style="display:flex;flex-direction:column;gap:16px;">' +
                    '<div class="cv-credit-card">' +
                        '<div class="cv-credit-label">Crédito otorgado</div>' +
                        '<div><span class="cv-credit-big">' + dias + '</span><span class="cv-credit-suf">días</span></div>' +
                        '<div class="cv-credit-divider"></div>' +
                        '<div class="cv-credit-label" style="margin-bottom:4px;">Monto autorizado</div>' +
                        '<div class="cv-credit-monto-val">' + (monto > 0 ? '$' + fmtMoney(monto) : '<span style="color:#c7c7cc;">Sin límite</span>') + '</div>' +
                    '</div>' +
                    '<div class="cv-detail-card">' +
                        '<div class="cv-detail-card-head">' + svgIcon(I.clock, 14) + '<h4>Actividad reciente</h4></div>' +
                        '<div class="cv-detail-card-body">' +
                            '<div class="cv-activity">' +
                                '<div class="cv-activity-item">' +
                                    '<div class="cv-activity-dot"></div>' +
                                    '<div>' +
                                        '<div class="cv-activity-text">Proveedor registrado</div>' +
                                        '<div class="cv-activity-time">' + escapeHtml(p.created_at_human || (p.created_at ? new Date(p.created_at).toLocaleString('es-MX') : '—')) + '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    function renderDetailTabContent(p, tipo, loc) {
        if (state.detailTab === 'info') {
            return '<div class="cv-detail-card-head" style="padding:0 0 8px;border:none;background:transparent;">' + svgIcon(I.idCard, 14) + '<h4>Datos fiscales</h4></div>' +
                '<div class="cv-detail-prop"><div class="cv-detail-prop-label">Razón social</div><div class="cv-detail-prop-val">' + escapeHtml(p.razon_social || '—') + '</div></div>' +
                '<div class="cv-detail-prop"><div class="cv-detail-prop-label">RFC</div><div class="cv-detail-prop-val cv-mono ' + (p.rfc ? '' : 'cv-empty') + '">' + escapeHtml(p.rfc || 'Sin RFC') + '</div></div>' +
                '<div class="cv-detail-prop"><div class="cv-detail-prop-label">Tipo persona</div><div class="cv-detail-prop-val">' + (tipo ? (tipo === 'MORAL' ? 'Persona Moral' : 'Persona Física') : '—') + '</div></div>' +
                '<div class="cv-detail-prop"><div class="cv-detail-prop-label">Dirección</div><div class="cv-detail-prop-val ' + (loc === '—' ? 'cv-empty' : '') + '">' + escapeHtml(loc) + '</div></div>' +
                '<div class="cv-detail-card-head" style="padding:14px 0 8px;border:none;background:transparent;margin-top:8px;border-top:1px solid rgba(0,0,0,.05);">' + svgIcon(I.bank, 14) + '<h4>Datos bancarios</h4></div>' +
                '<div class="cv-detail-prop"><div class="cv-detail-prop-label">Banco</div><div class="cv-detail-prop-val ' + (p.banco ? '' : 'cv-empty') + '">' + escapeHtml(p.banco || 'No registrado') + '</div></div>' +
                '<div class="cv-detail-prop"><div class="cv-detail-prop-label">Cuenta</div><div class="cv-detail-prop-val cv-mono ' + (p.cuenta_bancaria ? '' : 'cv-empty') + '">' + escapeHtml(p.cuenta_bancaria || '—') + '</div></div>' +
                '<div class="cv-detail-prop"><div class="cv-detail-prop-label">CLABE</div><div class="cv-detail-prop-val cv-mono ' + (p.clabe ? '' : 'cv-empty') + '">' + escapeHtml(p.clabe || '—') + '</div></div>' +
                '<div class="cv-detail-prop"><div class="cv-detail-prop-label">Cta. contable</div><div class="cv-detail-prop-val cv-mono ' + (p.cuenta_contable ? '' : 'cv-empty') + '">' + escapeHtml(p.cuenta_contable || '—') + '</div></div>';
        }
        if (state.detailTab === 'docs') {
            return '<div class="cv-tab-empty">Próximamente: gestión de documentos del proveedor (constancia fiscal, contrato, opinión SAT...).</div>';
        }
        return '<div class="cv-tab-empty">Próximamente: historial de órdenes de compra y movimientos relacionados.</div>';
    }

    function attachDetailEvents(root) {
        var back = $('#cv-detail-back', root);
        if (back) back.addEventListener('click', closeDetail);
        var edit = $('#cv-detail-edit', root);
        if (edit) edit.addEventListener('click', function () { openModal(state.detailItem); });
        var del = $('#cv-detail-del', root);
        if (del) del.addEventListener('click', function () { openConfirm(state.detailItem); });
        $$('[data-detail-tab]', root).forEach(function (t) {
            t.addEventListener('click', function () {
                state.detailTab = t.getAttribute('data-detail-tab');
                renderShell();
            });
        });
    }

    /* ════════════════════ Modal Add/Edit ════════════════════ */
    function defaultForm() {
        return {
            razon_social: '',
            rfc: '',
            tipo_persona: 'FISICA',
            dias_credito: 0,
            monto_credito: 0,
            banco: '',
            cuenta_bancaria: '',
            clabe: '',
            cuenta_contable: '',
            calle: '',
            numero: '',
            colonia: '',
            ciudad: '',
            estado: '',
            cp: ''
        };
    }

    function openModal(item) {
        state.modalEdit = item || null;
        state.modalErrors = {};
        state.modalDireccionOpen = false;
        if (item) {
            state.modalForm = {
                razon_social: item.razon_social || '',
                rfc: item.rfc || '',
                tipo_persona: deriveTipo(item) || 'MORAL',
                dias_credito: item.dias_credito || 0,
                monto_credito: item.monto_credito || 0,
                banco: item.banco || '',
                cuenta_bancaria: item.cuenta_bancaria || '',
                clabe: item.clabe || '',
                cuenta_contable: item.cuenta_contable || '',
                calle: item.calle || '',
                numero: item.numero || '',
                colonia: item.colonia || '',
                ciudad: item.ciudad || '',
                estado: item.estado || '',
                cp: item.cp || '',
                _rfc_locked: !!item.rfc
            };
        } else {
            state.modalForm = defaultForm();
            state.modalForm._rfc_locked = false;
        }
        state.modalOpen = true;
        renderModalIfOpen();
        setTimeout(function () {
            var el = document.getElementById('cv-modal-title');
            if (el) el.focus();
        }, 60);
    }

    function closeModal() {
        state.modalOpen = false;
        state.modalEdit = null;
        state.modalForm = null;
        state.modalErrors = {};
        renderModalIfOpen();
    }

    function renderModalIfOpen() {
        var host = document.getElementById('cv-modal-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'cv-modal-host';
            document.body.appendChild(host);
        }
        if (!state.modalOpen) { host.innerHTML = ''; return; }

        // Si el modal ya estaba renderizado, no replayamos la animación de
        // entrada (evita el "flash" al hacer clic en chips/RFC/CLABE).
        var alreadyOpen = !!host.querySelector('#cv-modal-overlay');
        var animCls = alreadyOpen ? ' cv-no-anim' : '';

        var f = state.modalForm;
        var isEdit = !!state.modalEdit;
        var rfcVal = validateRFC(f.rfc);
        var clabeVal = validateCLABE(f.clabe);
        var rfcLocked = !!f._rfc_locked;
        var detectedTipo = rfcVal.valid && rfcVal.tipo ? rfcVal.tipo : f.tipo_persona;

        var html = '<div class="cv-modal-overlay' + animCls + '" id="cv-modal-overlay">' +
            '<div class="cv-notion-modal' + animCls + '" id="cv-notion-modal">' +
                // header
                '<div class="cv-nm-header">' +
                    '<div class="cv-nm-breadcrumb">' +
                        svgIcon(I.building, 13) + '<span>Compras</span>' + svgIcon(I.chevRight, 12) +
                        '<span class="cv-bc-current">' + (isEdit ? 'Editar proveedor' : 'Nuevo proveedor') + '</span>' +
                    '</div>' +
                    '<button class="cv-nm-close" id="cv-modal-close">' + svgIcon(I.x, 14) + '</button>' +
                '</div>' +
                // body
                '<div class="cv-nm-body">' +
                    '<input id="cv-modal-title" class="cv-nm-title-input ' + (state.modalErrors.razon_social ? 'cv-error' : '') + '" placeholder="Razón social..." value="' + escapeHtml(f.razon_social) + '">' +

                    // ── IDENTIFICACIÓN
                    '<div class="cv-section-header cv-first">' + svgIcon(I.idCard, 13) + 'Identificación</div>' +
                    '<div class="cv-prop-row" style="align-items:flex-start;">' +
                        '<div class="cv-prop-label">' + svgIcon(I.user, 14) + 'Tipo</div>' +
                        '<div class="cv-prop-value" style="flex-direction:column;align-items:stretch;">' +
                            '<div class="cv-tipo-toggle">' +
                                '<button class="cv-tipo-btn ' + (detectedTipo === 'MORAL' ? 'cv-active' : '') + '" data-tipo="MORAL"' + (rfcLocked ? ' disabled' : '') + '>Persona Moral</button>' +
                                '<button class="cv-tipo-btn ' + (detectedTipo === 'FISICA' ? 'cv-active' : '') + '" data-tipo="FISICA"' + (rfcLocked ? ' disabled' : '') + '>Persona Física</button>' +
                            '</div>' +
                            (rfcLocked ? '<div class="cv-helper-text">Tipo derivado del RFC y bloqueado tras crear el proveedor.</div>' : '') +
                        '</div>' +
                    '</div>' +
                    '<div class="cv-prop-row" style="align-items:flex-start;">' +
                        '<div class="cv-prop-label">' + svgIcon(I.idCard, 14) + 'RFC</div>' +
                        '<div class="cv-prop-value" style="flex-direction:column;align-items:stretch;">' +
                            '<div style="display:flex;align-items:center;gap:8px;">' +
                                '<input id="cv-modal-rfc" class="cv-nm-input cv-mono ' + (rfcVal.valid ? '' : 'cv-error') + ' ' + (rfcLocked ? 'cv-disabled' : '') + '" placeholder="Opcional — formato SAT" value="' + escapeHtml(f.rfc) + '" maxlength="13" ' + (rfcLocked ? 'disabled' : '') + ' style="max-width:260px;">' +
                                renderRfcValidationBadge(f.rfc, rfcVal) +
                            '</div>' +
                            '<div class="cv-helper-text ' + (!rfcVal.valid && f.rfc ? 'cv-bad' : '') + '">' +
                                (f.rfc ? (rfcVal.valid ? '12 caracteres = Persona Moral · 13 = Física' : (rfcVal.msg || '')) : 'Opcional. Si lo capturas, derivamos el tipo de persona automáticamente.') +
                            '</div>' +
                        '</div>' +
                    '</div>' +

                    // ── CONDICIONES COMERCIALES
                    '<div class="cv-section-header">' + svgIcon(I.calendar, 13) + 'Condiciones Comerciales</div>' +
                    '<div class="cv-prop-row">' +
                        '<div class="cv-prop-label">' + svgIcon(I.calendar, 14) + 'Días crédito</div>' +
                        '<div class="cv-prop-value">' +
                            '<input id="cv-modal-dias" class="cv-nm-input" type="number" min="0" max="365" value="' + (f.dias_credito || 0) + '" style="max-width:140px;">' +
                            '<span class="cv-helper-text" style="margin-top:0;width:auto;">días para pago</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="cv-prop-row">' +
                        '<div class="cv-prop-label">' + svgIcon(I.dollar, 14) + 'Monto crédito</div>' +
                        '<div class="cv-prop-value">' +
                            '<div class="cv-nm-prefix-wrap" style="max-width:240px;">' +
                                '<span class="cv-nm-prefix">$</span>' +
                                '<input id="cv-modal-monto" class="cv-nm-input" type="number" min="0" step="0.01" value="' + (f.monto_credito || 0) + '" placeholder="0">' +
                            '</div>' +
                            '<span class="cv-helper-text" style="margin-top:0;width:auto;">informativo</span>' +
                        '</div>' +
                    '</div>' +

                    // ── DATOS BANCARIOS
                    '<div class="cv-section-header">' + svgIcon(I.bank, 13) + 'Datos Bancarios</div>' +
                    '<div class="cv-prop-row">' +
                        '<div class="cv-prop-label">' + svgIcon(I.bank, 14) + 'Banco</div>' +
                        '<div class="cv-prop-value">' +
                            '<input id="cv-modal-banco" class="cv-nm-input" list="cv-bancos-list" placeholder="Banco — escribe o elige" value="' + escapeHtml(f.banco) + '" style="max-width:260px;" autocomplete="off">' +
                            '<datalist id="cv-bancos-list">' +
                                BANCOS_COMUNES.map(function (b) { return '<option value="' + escapeHtml(b) + '">'; }).join('') +
                            '</datalist>' +
                        '</div>' +
                    '</div>' +
                    '<div class="cv-prop-row">' +
                        '<div class="cv-prop-label">' + svgIcon(I.idCard, 14) + 'Cuenta</div>' +
                        '<div class="cv-prop-value">' +
                            '<input id="cv-modal-cuenta" class="cv-nm-input cv-mono" placeholder="Cuenta bancaria" value="' + escapeHtml(f.cuenta_bancaria) + '" style="max-width:260px;">' +
                        '</div>' +
                    '</div>' +
                    '<div class="cv-prop-row" style="align-items:flex-start;">' +
                        '<div class="cv-prop-label">' + svgIcon(I.idCard, 14) + 'CLABE</div>' +
                        '<div class="cv-prop-value" style="flex-direction:column;align-items:stretch;">' +
                            '<div style="display:flex;align-items:center;gap:8px;">' +
                                '<input id="cv-modal-clabe" class="cv-nm-input cv-mono ' + (clabeVal.valid ? '' : 'cv-error') + '" placeholder="18 dígitos" value="' + escapeHtml(f.clabe) + '" maxlength="18" inputmode="numeric" style="max-width:260px;">' +
                                renderClabeBadge(f.clabe, clabeVal) +
                            '</div>' +
                            (f.clabe && !clabeVal.valid ? '<div class="cv-helper-text cv-bad">' + escapeHtml(clabeVal.msg) + '</div>' : '') +
                        '</div>' +
                    '</div>' +
                    '<div class="cv-prop-row">' +
                        '<div class="cv-prop-label cv-required">' + svgIcon(I.list, 14) + 'Cta. contable</div>' +
                        '<div class="cv-prop-value">' +
                            '<input id="cv-modal-cta" class="cv-nm-input cv-mono ' + (state.modalErrors.cuenta_contable ? 'cv-error' : '') + '" placeholder="2030-001-001" value="' + escapeHtml(f.cuenta_contable) + '" style="max-width:260px;">' +
                        '</div>' +
                    '</div>' +

                    // ── DIRECCIÓN (collapsible)
                    '<div class="cv-section-header">' + svgIcon(I.mapPin, 13) + 'Dirección' +
                        '<button class="cv-section-toggle ' + (state.modalDireccionOpen ? 'cv-open' : '') + '" id="cv-toggle-dir" title="' + (state.modalDireccionOpen ? 'Ocultar' : 'Mostrar') + '">' +
                            svgIcon(I.chevRight, 12) +
                        '</button>' +
                    '</div>' +
                    '<div class="cv-collapsible-body ' + (state.modalDireccionOpen ? '' : 'cv-collapsed') + '">' +
                        '<div class="cv-section-grid">' +
                            renderTextProp('cv-modal-calle', I.mapPin, 'Calle', f.calle, 'Av. / Calle') +
                            renderTextProp('cv-modal-numero', I.mapPin, 'Número', f.numero, 'Ext / Int') +
                            renderTextProp('cv-modal-colonia', I.mapPin, 'Colonia', f.colonia, 'Colonia') +
                            renderTextProp('cv-modal-cp', I.mapPin, 'CP', f.cp, '00000', 'maxlength="5" inputmode="numeric"') +
                            renderTextProp('cv-modal-ciudad', I.mapPin, 'Ciudad', f.ciudad, 'Ciudad') +
                            renderEstadoProp(f.estado) +
                        '</div>' +
                    '</div>' +

                '</div>' + // /nm-body

                // footer
                '<div class="cv-nm-footer">' +
                    '<div class="cv-nm-footer-chips">' +
                        '<span class="cv-nm-footer-chip">' + svgIcon(I.user, 12) + (detectedTipo === 'MORAL' ? 'Persona Moral' : 'Persona Física') + '</span>' +
                        ((f.dias_credito && Number(f.dias_credito) > 0) ? '<span class="cv-nm-footer-chip">' + svgIcon(I.calendar, 12) + f.dias_credito + 'd crédito</span>' : '') +
                        (f.banco ? '<span class="cv-nm-footer-chip">' + svgIcon(I.bank, 12) + escapeHtml(f.banco) + '</span>' : '') +
                        (Number(f.monto_credito) > 0 ? '<span class="cv-nm-footer-chip">' + svgIcon(I.dollar, 12) + fmtMoneyShort(Number(f.monto_credito)) + '</span>' : '') +
                    '</div>' +
                    '<div class="cv-nm-footer-actions">' +
                        '<button class="cv-btn-cancel-nm" id="cv-modal-cancel">Cancelar</button>' +
                        '<button class="cv-btn-save-nm" id="cv-modal-save"' + (canSave(f, rfcVal, clabeVal) ? '' : ' disabled') + '>' + svgIcon(I.check, 13) + (isEdit ? 'Guardar cambios' : 'Crear proveedor') + '</button>' +
                    '</div>' +
                '</div>' +

            '</div>' + // /notion-modal
        '</div>'; // /overlay

        host.innerHTML = html;
        attachModalEvents(host);
    }

    function renderTextProp(id, icon, label, val, ph, extraAttr) {
        return '<div class="cv-prop-row">' +
            '<div class="cv-prop-label">' + svgIcon(icon, 14) + escapeHtml(label) + '</div>' +
            '<div class="cv-prop-value">' +
                '<input id="' + id + '" class="cv-nm-input" placeholder="' + escapeHtml(ph) + '" value="' + escapeHtml(val || '') + '" ' + (extraAttr || '') + '>' +
            '</div>' +
        '</div>';
    }

    function renderEstadoProp(val) {
        var opts = '<option value="">—</option>';
        ESTADOS_MX.forEach(function (e) {
            opts += '<option value="' + escapeHtml(e) + '"' + (val === e ? ' selected' : '') + '>' + escapeHtml(e) + '</option>';
        });
        return '<div class="cv-prop-row">' +
            '<div class="cv-prop-label">' + svgIcon(I.mapPin, 14) + 'Estado</div>' +
            '<div class="cv-prop-value">' +
                '<select id="cv-modal-estado" class="cv-state-select">' + opts + '</select>' +
            '</div>' +
        '</div>';
    }

    function renderRfcValidationBadge(rfc, val) {
        if (!rfc) return '';
        if (val.valid) {
            return '<span class="cv-validation cv-ok">' + svgIcon(I.check, 12) + 'Válido · ' + (val.tipo === 'MORAL' ? 'Moral' : 'Física') + '</span>';
        }
        return '<span class="cv-validation cv-bad">' + svgIcon(I.x, 12) + (rfc.length) + '/' + (rfc.length <= 12 ? '12' : '13') + '</span>';
    }

    function renderClabeBadge(clabe, val) {
        if (!clabe) return '<span class="cv-validation cv-muted">0/18</span>';
        var len = String(clabe).length;
        if (val.valid) {
            return '<span class="cv-validation cv-ok">' + svgIcon(I.check, 12) + len + '/18</span>';
        }
        var cls = (len === 18) ? 'cv-bad' : 'cv-muted';
        return '<span class="cv-validation ' + cls + '">' + (len === 18 ? svgIcon(I.x, 12) : '') + len + '/18</span>';
    }

    function canSave(f, rfcVal, clabeVal) {
        if (!f.razon_social || !f.razon_social.trim()) return false;
        if (!f.cuenta_contable || !f.cuenta_contable.trim()) return false;
        if (f.rfc && !rfcVal.valid) return false;
        if (f.clabe && !clabeVal.valid) return false;
        return true;
    }

    function attachModalEvents(host) {
        var overlay = $('#cv-modal-overlay', host);
        if (overlay) {
            overlay.addEventListener('mousedown', function (e) {
                if (e.target === overlay) closeModal();
            });
        }
        var closeBtn = $('#cv-modal-close', host);
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        var cancelBtn = $('#cv-modal-cancel', host);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

        var title = $('#cv-modal-title', host);
        if (title) title.addEventListener('input', function (e) {
            state.modalForm.razon_social = e.target.value;
            state.modalErrors.razon_social = null;
            updateFooterAndSave();
        });

        // tipo toggle
        $$('[data-tipo]', host).forEach(function (b) {
            b.addEventListener('click', function () {
                if (state.modalForm._rfc_locked) return;
                state.modalForm.tipo_persona = b.getAttribute('data-tipo');
                renderModalIfOpen();
            });
        });

        // RFC live
        var rfcEl = $('#cv-modal-rfc', host);
        if (rfcEl) {
            rfcEl.addEventListener('input', function (e) {
                var v = e.target.value.toUpperCase();
                e.target.value = v;
                state.modalForm.rfc = v;
                if (state.rfcDebounce) clearTimeout(state.rfcDebounce);
                state.rfcDebounce = setTimeout(function () {
                    var val = validateRFC(v);
                    if (val.valid && val.tipo) state.modalForm.tipo_persona = val.tipo;
                    renderModalIfOpen();
                    var el = document.getElementById('cv-modal-rfc');
                    if (el) {
                        el.focus();
                        var len = el.value.length;
                        try { el.setSelectionRange(len, len); } catch (_) {}
                    }
                }, 200);
            });
        }

        // dias / monto
        bindNumber(host, 'cv-modal-dias', 'dias_credito', true);
        bindNumber(host, 'cv-modal-monto', 'monto_credito', false);

        // banco (input + datalist)
        bindText(host, 'cv-modal-banco', 'banco');

        // cuenta, clabe, cuenta contable
        bindText(host, 'cv-modal-cuenta', 'cuenta_bancaria');

        var clabeEl = $('#cv-modal-clabe', host);
        if (clabeEl) {
            clabeEl.addEventListener('input', function (e) {
                var v = e.target.value.replace(/\D/g, '').slice(0, 18);
                e.target.value = v;
                state.modalForm.clabe = v;
                // update only badge — minimal update via re-render is fine
                renderModalIfOpen();
                var el = document.getElementById('cv-modal-clabe');
                if (el) {
                    el.focus();
                    var len = el.value.length;
                    try { el.setSelectionRange(len, len); } catch (_) {}
                }
            });
        }

        bindText(host, 'cv-modal-cta', 'cuenta_contable', function () {
            state.modalErrors.cuenta_contable = null;
        });

        // dirección toggle
        var tg = $('#cv-toggle-dir', host);
        if (tg) tg.addEventListener('click', function () {
            state.modalDireccionOpen = !state.modalDireccionOpen;
            renderModalIfOpen();
        });

        // dirección fields
        ['cv-modal-calle', 'cv-modal-numero', 'cv-modal-colonia', 'cv-modal-ciudad', 'cv-modal-cp'].forEach(function (id) {
            var key = id.replace('cv-modal-', '');
            bindText(host, id, key);
        });
        var cpEl = $('#cv-modal-cp', host);
        if (cpEl) {
            cpEl.addEventListener('input', function (e) {
                var v = e.target.value.replace(/\D/g, '').slice(0, 5);
                e.target.value = v;
                state.modalForm.cp = v;
            });
        }
        var estadoEl = $('#cv-modal-estado', host);
        if (estadoEl) {
            estadoEl.addEventListener('change', function (e) {
                state.modalForm.estado = e.target.value;
                updateFooterAndSave();
            });
        }

        // save
        var save = $('#cv-modal-save', host);
        if (save) save.addEventListener('click', handleSave);
    }

    function bindText(host, id, key, after) {
        var el = $('#' + id, host);
        if (!el) return;
        el.addEventListener('input', function (e) {
            state.modalForm[key] = e.target.value;
            if (after) after();
            updateFooterAndSave();
        });
    }

    function bindNumber(host, id, key, asInt) {
        var el = $('#' + id, host);
        if (!el) return;
        el.addEventListener('input', function (e) {
            var v = e.target.value;
            state.modalForm[key] = asInt ? (parseInt(v, 10) || 0) : (parseFloat(v) || 0);
            updateFooterAndSave();
        });
    }

    function updateFooterAndSave() {
        // light-weight: re-render footer chips + save button enable state
        var f = state.modalForm;
        if (!f) return;
        var rfcVal = validateRFC(f.rfc);
        var clabeVal = validateCLABE(f.clabe);
        var btn = document.getElementById('cv-modal-save');
        if (btn) {
            if (canSave(f, rfcVal, clabeVal)) btn.removeAttribute('disabled');
            else btn.setAttribute('disabled', 'disabled');
        }
        // update footer chips
        var foot = document.querySelector('#cv-modal-host .cv-nm-footer-chips');
        if (foot) {
            var detectedTipo = (rfcVal.valid && rfcVal.tipo) ? rfcVal.tipo : f.tipo_persona;
            var html = '<span class="cv-nm-footer-chip">' + svgIcon(I.user, 12) + (detectedTipo === 'MORAL' ? 'Persona Moral' : 'Persona Física') + '</span>';
            if (Number(f.dias_credito) > 0) html += '<span class="cv-nm-footer-chip">' + svgIcon(I.calendar, 12) + f.dias_credito + 'd crédito</span>';
            if (f.banco) html += '<span class="cv-nm-footer-chip">' + svgIcon(I.bank, 12) + escapeHtml(f.banco) + '</span>';
            if (Number(f.monto_credito) > 0) html += '<span class="cv-nm-footer-chip">' + svgIcon(I.dollar, 12) + fmtMoneyShort(Number(f.monto_credito)) + '</span>';
            foot.innerHTML = html;
        }
    }

    function handleSave() {
        var f = state.modalForm;
        if (!f) return;
        state.modalErrors = {};
        if (!f.razon_social || !f.razon_social.trim()) {
            state.modalErrors.razon_social = true;
            renderModalIfOpen();
            showToast('La razón social es obligatoria', 'error');
            return;
        }
        if (!f.cuenta_contable || !f.cuenta_contable.trim()) {
            state.modalErrors.cuenta_contable = true;
            renderModalIfOpen();
            showToast('La cuenta contable es obligatoria', 'error');
            return;
        }
        var rfcVal = validateRFC(f.rfc);
        if (f.rfc && !rfcVal.valid) {
            showToast('RFC con formato inválido', 'error');
            return;
        }
        var clabeVal = validateCLABE(f.clabe);
        if (f.clabe && !clabeVal.valid) {
            showToast('CLABE debe tener 18 dígitos', 'error');
            return;
        }

        var payload = {
            razon_social: f.razon_social.trim(),
            dias_credito: parseInt(f.dias_credito, 10) || 0,
            monto_credito: parseFloat(f.monto_credito) || 0,
            cuenta_contable: f.cuenta_contable.trim()
        };
        if (f.rfc) payload.rfc = String(f.rfc).toUpperCase().trim();
        if (f.banco) payload.banco = f.banco;
        if (f.cuenta_bancaria) payload.cuenta_bancaria = f.cuenta_bancaria;
        if (f.clabe) payload.clabe = f.clabe;
        if (f.calle) payload.calle = f.calle;
        if (f.numero) payload.numero = f.numero;
        if (f.colonia) payload.colonia = f.colonia;
        if (f.ciudad) payload.ciudad = f.ciudad;
        if (f.estado) payload.estado = f.estado;
        if (f.cp) payload.cp = f.cp;

        var saveBtn = document.getElementById('cv-modal-save');
        if (saveBtn) saveBtn.setAttribute('disabled', 'disabled');

        var promise = state.modalEdit ? apiUpdate(state.modalEdit.id, payload) : apiCreate(payload);
        promise.then(function (resp) {
            showToast(state.modalEdit ? 'Proveedor actualizado' : 'Proveedor creado');
            closeModal();
            // si estamos en detalle y editamos, refrescar; si no, refetch lista
            if (state.view === 'detail' && resp && resp.id) {
                state.detailItem = resp;
                renderShell();
            }
            fetchProveedores();
        }).catch(function (err) {
            if (saveBtn) saveBtn.removeAttribute('disabled');
            var msg = (err && (err.error || err.detail)) || 'Error al guardar';
            showToast(msg, 'error');
        });
    }

    /* ════════════════════ Confirm delete ════════════════════ */
    function openConfirm(item) {
        state.deleteTarget = item;
        renderConfirmIfOpen();
    }
    function closeConfirm() {
        state.deleteTarget = null;
        renderConfirmIfOpen();
    }
    function renderConfirmIfOpen() {
        var host = document.getElementById('cv-confirm-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'cv-confirm-host';
            document.body.appendChild(host);
        }
        if (!state.deleteTarget) { host.innerHTML = ''; return; }
        var p = state.deleteTarget;
        var isActive = (p.estatus || 'activo') === 'activo';
        host.innerHTML = '<div class="cv-confirm-overlay" id="cv-confirm-overlay">' +
            '<div class="cv-confirm-box" id="cv-confirm-box">' +
                '<div class="cv-confirm-icon">' + svgIcon(I.trash, 22) + '</div>' +
                '<h3>' + (isActive ? 'Eliminar proveedor' : 'Eliminar definitivamente') + '</h3>' +
                '<p><strong>' + escapeHtml(p.razon_social || '') + '</strong>' + (p.rfc ? ' (' + escapeHtml(p.rfc) + ')' : '') + '. Si tiene movimientos históricos será desactivado, de lo contrario eliminado permanentemente.</p>' +
                '<div class="cv-confirm-actions">' +
                    '<button class="cv-btn-cancel-confirm" id="cv-confirm-cancel">Cancelar</button>' +
                    '<button class="cv-btn-danger" id="cv-confirm-ok">Eliminar</button>' +
                '</div>' +
            '</div>' +
        '</div>';
        var ov = $('#cv-confirm-overlay', host);
        if (ov) ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeConfirm(); });
        $('#cv-confirm-cancel', host).addEventListener('click', closeConfirm);
        $('#cv-confirm-ok', host).addEventListener('click', function () {
            var id = state.deleteTarget.id;
            apiDelete(id).then(function (resp) {
                showToast((resp && resp.message) || 'Proveedor eliminado');
                closeConfirm();
                if (state.view === 'detail' && state.detailItem && state.detailItem.id === id) {
                    closeDetail();
                }
                fetchProveedores();
            }).catch(function (err) {
                showToast((err && err.error) || 'Error al eliminar', 'error');
            });
        });
    }

    /* ════════════════════ Importar ════════════════════ */
    function openImport() {
        state.importOpen = true;
        state.importBusy = false;
        state.importResult = null;
        renderImportIfOpen();
    }
    function closeImport() {
        state.importOpen = false;
        state.importBusy = false;
        state.importResult = null;
        renderImportIfOpen();
    }
    function renderImportIfOpen() {
        var host = document.getElementById('cv-import-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'cv-import-host';
            document.body.appendChild(host);
        }
        if (!state.importOpen) { host.innerHTML = ''; return; }

        var resultHtml = '';
        if (state.importResult) {
            var r = state.importResult;
            if (r.errors && r.errors.length) {
                resultHtml = '<div class="cv-import-errors">' +
                    r.errors.map(function (e) {
                        return '<div class="cv-import-error-row"><strong>Fila ' + (e.row || '?') + '</strong> · ' + escapeHtml(e.error || e.msg || '') + '</div>';
                    }).join('') +
                '</div>';
            }
            if (r.created || r.updated) {
                resultHtml = '<div class="cv-import-success">Importación lista — Creados: ' + (r.created || 0) + ' · Actualizados: ' + (r.updated || 0) + '</div>' + resultHtml;
            }
        }

        host.innerHTML = '<div class="cv-modal-overlay" id="cv-import-overlay">' +
            '<div class="cv-notion-modal" style="width:560px;">' +
                '<div class="cv-nm-header">' +
                    '<div class="cv-nm-breadcrumb">' + svgIcon(I.upload, 13) + '<span>Compras</span>' + svgIcon(I.chevRight, 12) + '<span class="cv-bc-current">Importar proveedores</span></div>' +
                    '<button class="cv-nm-close" id="cv-import-close">' + svgIcon(I.x, 14) + '</button>' +
                '</div>' +
                '<div class="cv-nm-body">' +
                    '<p style="font-size:13px;color:#6e6e73;margin:8px 0 14px;line-height:1.5;">' +
                        'Sube un CSV con columnas: <code>razon_social, rfc, dias_credito, monto_credito, banco, cuenta_bancaria, clabe, cuenta_contable, calle, numero, colonia, ciudad, estado, cp</code>.' +
                    '</p>' +
                    '<div class="cv-import-drop" id="cv-import-drop">' +
                        svgIcon(I.upload, 36) +
                        '<div>' + (state.importBusy ? 'Procesando...' : 'Arrastra el CSV aquí o haz clic para seleccionar') + '</div>' +
                        '<input type="file" accept=".csv,text/csv" id="cv-import-file" style="display:none;">' +
                    '</div>' +
                    resultHtml +
                '</div>' +
                '<div class="cv-nm-footer">' +
                    '<div class="cv-nm-footer-chips"></div>' +
                    '<div class="cv-nm-footer-actions">' +
                        '<button class="cv-btn-cancel-nm" id="cv-import-cancel">Cerrar</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';

        var ov = $('#cv-import-overlay', host);
        if (ov) ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeImport(); });
        $('#cv-import-close', host).addEventListener('click', closeImport);
        $('#cv-import-cancel', host).addEventListener('click', closeImport);

        var drop = $('#cv-import-drop', host);
        var input = $('#cv-import-file', host);
        if (drop && input) {
            drop.addEventListener('click', function () { if (!state.importBusy) input.click(); });
            drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('cv-dragover'); });
            drop.addEventListener('dragleave', function () { drop.classList.remove('cv-dragover'); });
            drop.addEventListener('drop', function (e) {
                e.preventDefault();
                drop.classList.remove('cv-dragover');
                if (state.importBusy) return;
                var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                if (f) doImport(f);
            });
            input.addEventListener('change', function (e) {
                var f = e.target.files && e.target.files[0];
                if (f) doImport(f);
            });
        }
    }

    function doImport(file) {
        state.importBusy = true;
        state.importResult = null;
        renderImportIfOpen();
        apiImport(file).then(function (resp) {
            state.importBusy = false;
            state.importResult = resp || {};
            renderImportIfOpen();
            showToast('Importación completada');
            fetchProveedores();
        }).catch(function (err) {
            state.importBusy = false;
            state.importResult = err || { errors: [{ row: '?', error: 'Error general' }] };
            renderImportIfOpen();
            showToast((err && err.error) || 'Error al importar', 'error');
        });
    }

    /* ════════════════════ Global keyboard ════════════════════ */
    function handleEsc(e) {
        if (e.key !== 'Escape') return;
        if (state.deleteTarget) { closeConfirm(); return; }
        if (state.importOpen) { closeImport(); return; }
        if (state.modalOpen) { closeModal(); return; }
        if (state.view === 'detail') { closeDetail(); return; }
    }

    /* ════════════════════ Init ════════════════════ */
    function init() {
        var root = document.getElementById('comprasProveedoresSection');
        if (!root) return;
        if (state.initialized) {
            // re-fetch silently when re-entering tab
            fetchProveedores();
            return;
        }
        state.initialized = true;
        document.addEventListener('keydown', handleEsc);
        renderShell();
        fetchProveedores();
    }

    window.comprasProveedoresInit = init;
})();
