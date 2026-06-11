/*
  crm_proveedores_v2.js — Handler de la tab "Proveedores" del dashboard.

  Espejo estructural de crm_marcas_v2.js. Mismos comportamientos
  (monkey-patch _crmSetMode, scroll lock global, multi-select filtros,
  click en row → openDetalle). Prefijos cambiados:
    _marcasCache → _proveedoresCache
    mk-* IDs    → pv-* IDs
    marca       → proveedor
    /api/marcas → /api/proveedores
    crmModeMarcas → crmModeProveedores
    ckMarcasSection → ckProveedoresSection
    marcaWidgetOverlay → proveedorWidgetOverlay
    meOverlay   → peOverlay
    window._crmMarcas → window._crmProveedores
    window._crmMarcaEditor → window._crmProveedorEditor

  Notas:
    - El backend devuelve `proveedores: [...]` (no `marcas`).
    - Sin endpoint de "campañas" — el resumen siempre trae campanias=0.
    - Mientras TodoItem.proveedor no exista, ops viene vacío y la
      timeline muestra empty state.

  Fetch:
    GET /app/api/proveedores/resumen/?anio=YYYY&vendedores=CSV → todos
    GET /app/api/proveedores/<key>/?anio=YYYY                  → detalle + ops
*/
(function () {
    'use strict';

    var _activo = false;
    var _initialMode = null;
    var _proveedoresCache = [];
    var _totalsCache = null;
    var _view = 'tabla';
    var _query = '';
    // Filtros multi-select: array vacío = "todos", array con valores =
    // solo esos. Click en una opción la togglea.
    var _filters = { quarter: [], prob: [], mes: [], proveedor: [] };

    function passesMulti(filtroArr, val) {
        return !filtroArr.length || filtroArr.indexOf(String(val)) !== -1;
    }
    var _sortKey = 'default';

    var PV_FILTER_FIELDS = [
        { key: 'proveedor', label: 'Proveedor', type: 'proveedor' },
        { key: 'quarter',   label: 'Trimestre',    type: 'enum',
            options: [{v:'1',l:'Q1'},{v:'2',l:'Q2'},{v:'3',l:'Q3'},{v:'4',l:'Q4'}] },
        { key: 'prob',      label: 'Probabilidad', type: 'enum',
            options: [{v:'high',l:'Alta (≥60%)'},{v:'mid',l:'Media (40-59%)'},{v:'low',l:'Baja (<40%)'}] },
        { key: 'mes',       label: 'Mes',          type: 'enum',
            options: [
                {v:'1',l:'Enero'},{v:'2',l:'Febrero'},{v:'3',l:'Marzo'},{v:'4',l:'Abril'},
                {v:'5',l:'Mayo'},{v:'6',l:'Junio'},{v:'7',l:'Julio'},{v:'8',l:'Agosto'},
                {v:'9',l:'Septiembre'},{v:'10',l:'Octubre'},{v:'11',l:'Noviembre'},{v:'12',l:'Diciembre'}
            ] }
    ];

    var PV_SORT_OPTIONS = [
        { k: 'default',    lbl: 'Por defecto' },
        { k: 'fact-desc',  lbl: 'Facturado: mayor a menor' },
        { k: 'fact-asc',   lbl: 'Facturado: menor a mayor' },
        { k: 'monto-desc', lbl: 'Monto opp: mayor a menor' },
        { k: 'monto-asc',  lbl: 'Monto opp: menor a mayor' },
        { k: 'prob-desc',  lbl: 'Probabilidad: mayor a menor' },
        { k: 'prob-asc',   lbl: 'Probabilidad: menor a mayor' },
        { k: 'nombre-asc', lbl: 'Nombre A-Z' }
    ];

    try { _initialMode = localStorage.getItem('crm_clientes_mode'); } catch (e) {}

    var IDS_OTROS_KPI = [
        'ckKpiRow', 'ckKpiRowProsp', 'ckKpiRowProy',
        'ckChartsSection', 'ckChartsSectionProsp', 'ckChartsSectionProy',
        'ckDetalleSection', 'ckClientesTablaSection',
        'ckControlSection', 'ckMarcasSection'
    ];
    var IDS_TABLA_OPPS = ['crmListBody', 'crmCardsGrid'];
    var IDS_OTROS_BTNS = [
        'crmModeOpp', 'crmModeProsp', 'crmModeProyectos', 'crmModeClientes',
        'crmModeControl', 'crmModeMarcas'
    ];

    var MESES_SHORT = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

    function hide(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }
    function escHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function fmtMoney(n, compact) {
        var v = Number(n || 0);
        if (compact) {
            if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1).replace(/\.0$/, '') + 'M';
            if (Math.abs(v) >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
        }
        return '$' + Math.round(v).toLocaleString('en-US');
    }
    function quarterOf(mes) { return Math.ceil((mes || 1) / 3); }
    function probBand(p) { return p >= 60 ? 'high' : p >= 40 ? 'mid' : 'low'; }
    function probClass(p) { return p >= 60 ? 'p-high' : p >= 40 ? 'p-mid' : 'p-low'; }
    function hueOf(name) {
        var h = 0;
        for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
        return h;
    }
    function initials(name) {
        var clean = String(name || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
        if (!clean[0]) return '?';
        return (clean[0][0] + (clean[1] ? clean[1][0] : '')).toUpperCase();
    }

    function sortComparator(kind, a, b) {
        switch (_sortKey) {
            case 'fact-desc':
                return (kind === 'proveedor') ? (b.facturado - a.facturado) : 0;
            case 'fact-asc':
                return (kind === 'proveedor') ? (a.facturado - b.facturado) : 0;
            case 'monto-desc':
                return (kind === 'proveedor')
                    ? ((b.pipeline || 0) - (a.pipeline || 0))
                    : (b.op.monto - a.op.monto);
            case 'monto-asc':
                return (kind === 'proveedor')
                    ? ((a.pipeline || 0) - (b.pipeline || 0))
                    : (a.op.monto - b.op.monto);
            case 'prob-desc':
                return (kind === 'op') ? (b.op.prob - a.op.prob) : 0;
            case 'prob-asc':
                return (kind === 'op') ? (a.op.prob - b.op.prob) : 0;
            case 'nombre-asc':
                if (kind === 'proveedor') return (a.label || '').localeCompare(b.label || '');
                return (a.proveedor.label || '').localeCompare(b.proveedor.label || '');
            case 'default':
            default:
                return (kind === 'proveedor')
                    ? (b.facturado - a.facturado)
                    : (b.op.monto - a.op.monto);
        }
    }

    function getFiltrosFetch() {
        var cfg = window._CRM_CONFIG || {};
        return {
            anio: cfg.anioFiltro || new Date().getFullYear(),
            vendedores: cfg.vendedoresFilter || ''
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // FETCH
    // ─────────────────────────────────────────────────────────────────────

    var _inflightAbort = null;
    function fetchProveedores() {
        var f = getFiltrosFetch();
        var qs = '?anio=' + encodeURIComponent(f.anio);
        if (f.vendedores) qs += '&vendedores=' + encodeURIComponent(f.vendedores);

        if (_inflightAbort && typeof _inflightAbort.abort === 'function') {
            try { _inflightAbort.abort(); } catch (e) {}
        }
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        _inflightAbort = ctrl;

        renderLoading();

        return fetch('/app/api/proveedores/resumen/' + qs, {
            credentials: 'same-origin',
            signal: ctrl ? ctrl.signal : undefined
        })
            .then(function (r) { return r.json(); })
            .then(function (resp) {
                if (resp && resp.ok) {
                    _proveedoresCache = resp.proveedores || [];
                    _totalsCache = resp.totals || null;
                    renderAll();
                } else {
                    renderError(resp && resp.error ? resp.error : 'Error desconocido.');
                }
            })
            .catch(function (err) {
                if (err && err.name === 'AbortError') return;
                renderError(err && err.message ? err.message : '');
            });
    }

    // ─────────────────────────────────────────────────────────────────────
    // RENDER (KPIs + tabla + timeline + filtros)
    // ─────────────────────────────────────────────────────────────────────

    function renderLoading() {
        var tb = document.getElementById('pvTableBody');
        var tl = document.getElementById('pvTimelineBody');
        if (tb) tb.innerHTML = '<tr><td colspan="7" class="proveedores-empty-cell">Cargando…</td></tr>';
        if (tl) tl.innerHTML = '<div class="proveedores-empty-state"><p>Cargando…</p></div>';
        var setT = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
        setT('pvKpiFact', '—'); setT('pvKpiOpps', '—');
        setT('pvKpiCot', '—');  setT('pvKpiCam', '—');
    }

    function renderError(msg) {
        var tb = document.getElementById('pvTableBody');
        var tl = document.getElementById('pvTimelineBody');
        var html = '<tr><td colspan="7" class="proveedores-empty-cell" style="color:#B91C1C;">Error: ' + escHtml(msg) + '</td></tr>';
        var htmlTl = '<div class="proveedores-empty-state" style="color:#B91C1C;"><p>Error: ' + escHtml(msg) + '</p></div>';
        if (tb) tb.innerHTML = html;
        if (tl) tl.innerHTML = htmlTl;
    }

    function visiblesFiltradas() {
        var q = (_query || '').trim().toLowerCase();
        var matchText = function (p) {
            if (!q) return true;
            return (p.label || '').toLowerCase().indexOf(q) !== -1 ||
                   (p.cat   || '').toLowerCase().indexOf(q) !== -1;
        };
        return _proveedoresCache.filter(matchText);
    }

    function renderAll() {
        renderKpis();
        renderTabla();
        renderTimeline();
        renderFacetChips();
        actualizarVisibilidadFiltro();
        actualizarFilterCount();
    }

    function actualizarVisibilidadFiltro() {
        var btn = document.getElementById('pvBtnFilter');
        var chips = document.getElementById('pvFacetChips');
        if (!btn) return;
        var show = (_view === 'timeline');
        btn.style.display = show ? '' : 'none';
        if (chips) chips.style.display = show ? '' : 'none';
        if (!show) closeAllPvPopovers();
    }

    /* ─────────── POPOVERS estilo CRM (filtros + ordenar) ─────────── */

    function closeAllPvPopovers(except) {
        ['pvPopFilter', 'pvPopFilterValue', 'pvPopSort'].forEach(function (id) {
            if (id === except) return;
            var el = document.getElementById(id);
            if (el) el.classList.remove('open');
        });
    }

    function positionPopoverFromRect(pop, r) {
        pop.style.top  = (r.bottom + 6) + 'px';
        pop.style.left = r.left + 'px';
        pop.style.right = 'auto';
        setTimeout(function () {
            var pr = pop.getBoundingClientRect();
            if (pr.right > window.innerWidth - 8) {
                pop.style.left = 'auto';
                pop.style.right = (window.innerWidth - r.right) + 'px';
            }
        }, 0);
    }

    function togglePopover(popId, anchor, renderer) {
        var pop = document.getElementById(popId);
        if (!pop) return;
        if (pop.classList.contains('open')) {
            pop.classList.remove('open');
            return;
        }
        var anchorRect = anchor.getBoundingClientRect();
        closeAllPvPopovers(popId);
        if (typeof renderer === 'function') renderer(pop);
        pop.classList.add('open');
        positionPopoverFromRect(pop, anchorRect);
    }

    function renderFilterFieldsPopover(pop) {
        var html = '<div class="crm-pop-section">Filtrar por</div><div class="crm-pop-list">';
        PV_FILTER_FIELDS.forEach(function (fld) {
            var arr = _filters[fld.key] || [];
            var active = arr.length > 0;
            var badge = active ? ' <span style="margin-left:auto;font-size:10px;font-weight:800;color:#2563EB;">' + arr.length + '</span>' : '';
            html += '<button type="button" class="crm-pop-item ' + (active ? 'active' : '') + '" data-pv-field="' + fld.key + '" style="display:flex;justify-content:space-between;align-items:center;width:100%;">' +
                        '<span>' + escHtml(fld.label) + '</span>' + badge +
                    '</button>';
        });
        html += '</div>';
        pop.innerHTML = html;
        pop.querySelectorAll('[data-pv-field]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var key = btn.getAttribute('data-pv-field');
                var fld = PV_FILTER_FIELDS.find(function (f) { return f.key === key; });
                if (!fld) return;
                togglePopover('pvPopFilterValue', btn, function (vpop) {
                    renderFilterValuePopover(vpop, fld);
                });
            });
        });
    }

    function renderFilterValuePopover(pop, field) {
        var currentArr = _filters[field.key] || [];
        var options = [];
        if (field.type === 'proveedor') {
            _proveedoresCache.forEach(function (p) {
                options.push({ v: p.key, l: p.label });
            });
        } else if (field.type === 'enum') {
            (field.options || []).forEach(function (o) { options.push(o); });
        }
        var html =
            '<div class="crm-pop-section" style="display:flex;justify-content:space-between;align-items:center;">' +
                '<span>' + escHtml(field.label) + ' (multi)</span>' +
                (currentArr.length ? '<button type="button" data-pv-clear="1" style="background:none;border:none;color:#FF3B30;font-size:10px;font-weight:700;cursor:pointer;padding:2px 6px;">Limpiar</button>' : '') +
            '</div>' +
            '<div class="crm-pop-list">';
        options.forEach(function (o) {
            var act = currentArr.indexOf(String(o.v)) !== -1 ? 'active' : '';
            html += '<button type="button" class="crm-pop-item ' + act + '" data-pv-val="' + escHtml(o.v) + '">' +
                        '<span>' + escHtml(o.l) + '</span>' +
                    '</button>';
        });
        html += '</div>';
        pop.innerHTML = html;

        function rerender() {
            renderFilterValuePopover(pop, field);
        }

        pop.querySelectorAll('[data-pv-val]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var val = String(btn.getAttribute('data-pv-val'));
                var arr = _filters[field.key] || [];
                var idx = arr.indexOf(val);
                if (idx === -1) arr.push(val);
                else arr.splice(idx, 1);
                _filters[field.key] = arr;
                renderAll();
                rerender();
            });
        });
        var btnClr = pop.querySelector('[data-pv-clear]');
        if (btnClr) {
            btnClr.addEventListener('click', function (e) {
                e.stopPropagation();
                _filters[field.key] = [];
                renderAll();
                rerender();
            });
        }
    }

    function renderSortPopover(pop) {
        var html = '<div class="crm-pop-section">Ordenar por</div><div class="crm-pop-list">';
        PV_SORT_OPTIONS.forEach(function (s) {
            var act = s.k === _sortKey ? 'active' : '';
            html += '<button type="button" class="crm-pop-item ' + act + '" data-pv-sort="' + escHtml(s.k) + '">' +
                        '<span>' + escHtml(s.lbl) + '</span>' +
                    '</button>';
        });
        html += '</div>';
        pop.innerHTML = html;
        pop.querySelectorAll('[data-pv-sort]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                _sortKey = btn.getAttribute('data-pv-sort');
                closeAllPvPopovers();
                actualizarSortLabel();
                renderAll();
            });
        });
    }

    function actualizarSortLabel() {
        var label = document.getElementById('pvSortLabel');
        var btn = document.getElementById('pvBtnSort');
        if (!label || !btn) return;
        if (_sortKey && _sortKey !== 'default') {
            var s = PV_SORT_OPTIONS.find(function (x) { return x.k === _sortKey; });
            label.textContent = s ? s.lbl : 'Ordenar';
            btn.classList.add('has-sort');
        } else {
            label.textContent = 'Ordenar';
            btn.classList.remove('has-sort');
        }
    }

    function renderFacetChips() {
        var cont = document.getElementById('pvFacetChips');
        if (!cont) return;
        var chips = '';
        PV_FILTER_FIELDS.forEach(function (fld) {
            var arr = _filters[fld.key] || [];
            if (!arr.length) return;
            var label = fld.label + ': ';
            if (arr.length === 1) {
                if (fld.type === 'proveedor') {
                    var pp = _proveedoresCache.find(function (p) { return String(p.key) === String(arr[0]); });
                    label += pp ? pp.label : arr[0];
                } else if (fld.type === 'enum') {
                    var op = (fld.options || []).find(function (o) { return String(o.v) === String(arr[0]); });
                    label += op ? op.l : arr[0];
                }
            } else {
                label += arr.length + ' seleccionados';
            }
            chips += '<span class="pv-facet-chip" data-pv-chip-field="' + fld.key + '">' +
                        escHtml(label) +
                        '<button type="button" class="pv-facet-chip-x" title="Quitar filtro">' +
                            '<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
                        '</button>' +
                     '</span>';
        });
        var activos = PV_FILTER_FIELDS.some(function (f) {
            return (_filters[f.key] || []).length > 0;
        });
        if (activos) {
            chips += '<button type="button" class="pv-facet-clear-all" id="pvBtnClearAll" title="Limpiar todos los filtros">Limpiar</button>';
        }
        cont.innerHTML = chips;
        cont.querySelectorAll('.pv-facet-chip-x').forEach(function (x) {
            x.addEventListener('click', function (e) {
                e.stopPropagation();
                var key = x.closest('[data-pv-chip-field]').getAttribute('data-pv-chip-field');
                _filters[key] = [];
                renderAll();
            });
        });
        var btnAll = document.getElementById('pvBtnClearAll');
        if (btnAll) {
            btnAll.addEventListener('click', function () {
                _filters = { quarter: [], prob: [], mes: [], proveedor: [] };
                renderAll();
            });
        }
    }

    function renderKpis() {
        var visibles = visiblesFiltradas();
        var base = visibles.length ? visibles : _proveedoresCache;
        var t = {
            facturado: 0, pipeline: 0, cotizaciones: 0, campanias: 0, meta: 0
        };
        for (var i = 0; i < base.length; i++) {
            t.facturado += Number(base[i].facturado || 0);
            t.pipeline  += Number(base[i].pipeline || 0);
            t.cotizaciones += Number(base[i].cotizaciones || 0);
            t.campanias    += Number(base[i].campanias || 0);
        }
        var setT = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
        setT('pvKpiFact', fmtMoney(t.facturado, true));
        setT('pvKpiOpps', fmtMoney(t.pipeline, true));
        setT('pvKpiCot',  String(t.cotizaciones));
        setT('pvKpiCam',  String(t.campanias));
    }

    function renderTabla() {
        var tb = document.getElementById('pvTableBody');
        if (!tb) return;
        var rows = visiblesFiltradas().slice().sort(function (a, b) {
            return sortComparator('proveedor', a, b);
        });
        if (!rows.length) {
            tb.innerHTML = '<tr><td colspan="7" class="proveedores-empty-cell">Sin proveedores para la búsqueda actual.</td></tr>';
            return;
        }
        var html = '';
        for (var i = 0; i < rows.length; i++) {
            var p = rows[i];
            var avancePct = p.meta ? Math.min(1, p.facturado / p.meta) : 0;
            var avanceCellHtml = p.meta
                ? '<div class="proveedores-avance">' +
                      '<div class="proveedores-avance-bar"><span style="width:' + (avancePct * 100) + '%;"></span></div>' +
                      '<span class="proveedores-avance-pct">' + Math.round(avancePct * 100) + '%</span>' +
                  '</div>'
                : '<span class="proveedores-avance-na">Sin meta</span>';

            var logoT = p.logo_url
                ? '<div class="proveedores-logo has-img" style="width:38px;height:38px;font-size:13.7px;--pv-h:' + hueOf(p.label) + ';"><img src="' + escHtml(p.logo_url) + '" alt="' + escHtml(p.label) + '"></div>'
                : '<div class="proveedores-logo" style="width:38px;height:38px;font-size:13.7px;--pv-h:' + hueOf(p.label) + ';">' + escHtml(initials(p.label)) + '</div>';
            html +=
                '<tr class="proveedores-drow" data-proveedor-key="' + escHtml(p.key) + '">' +
                    '<td class="proveedores-c-name">' +
                        '<div class="proveedores-namecell">' +
                            logoT +
                            '<div>' +
                                '<div class="proveedores-namecell-t">' + escHtml(p.label) + '</div>' +
                                '<div class="proveedores-namecell-s">' + escHtml(p.cat) + '</div>' +
                            '</div>' +
                        '</div>' +
                    '</td>' +
                    '<td class="proveedores-num strong">' + fmtMoney(p.facturado, true) + '</td>' +
                    '<td class="proveedores-num">' +
                        '<span>' + fmtMoney(p.pipeline, true) + '</span>' +
                        '<span class="proveedores-cell-sub">' + p.ops_count + ' ops</span>' +
                    '</td>' +
                    '<td class="proveedores-num">' + p.cotizaciones + '</td>' +
                    '<td class="proveedores-num">' + p.campanias + '</td>' +
                    '<td class="proveedores-c-avance">' + avanceCellHtml + '</td>' +
                    '<td class="proveedores-c-chev"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></td>' +
                '</tr>';
        }
        tb.innerHTML = html;

        var rowsEl = tb.querySelectorAll('.proveedores-drow');
        for (var j = 0; j < rowsEl.length; j++) {
            rowsEl[j].addEventListener('click', function () {
                var key = this.getAttribute('data-proveedor-key');
                openProveedorDetalle(key);
            });
        }
    }

    function renderTimeline() {
        var tlBody = document.getElementById('pvTimelineBody');
        if (!tlBody) return;
        var visibles = visiblesFiltradas();
        if (!visibles.length) {
            tlBody.innerHTML = '<div class="proveedores-empty-state"><p>Sin proveedores.</p></div>';
            return;
        }
        tlBody.innerHTML = '<div class="proveedores-empty-state"><p>Cargando oportunidades…</p></div>';
        Promise.all(visibles.map(function (p) {
            if (p._ops) return Promise.resolve(p);
            var f = getFiltrosFetch();
            return fetch('/app/api/proveedores/' + encodeURIComponent(p.key) + '/?anio=' + encodeURIComponent(f.anio), { credentials: 'same-origin' })
                .then(function (r) { return r.json(); })
                .then(function (resp) {
                    if (resp && resp.ok) p._ops = resp.ops || [];
                    else p._ops = [];
                    return p;
                })
                .catch(function () { p._ops = []; return p; });
        })).then(function (proveedoresConOps) {
            var flat = [];
            for (var i = 0; i < proveedoresConOps.length; i++) {
                var pp = proveedoresConOps[i];
                if (!passesMulti(_filters.proveedor, pp.key)) continue;
                for (var k = 0; k < (pp._ops || []).length; k++) {
                    var op = pp._ops[k];
                    if (!opPasaFiltros(op)) continue;
                    if (!opPasaBusqueda(op, pp)) continue;
                    flat.push({ op: op, proveedor: pp });
                }
            }
            flat.sort(function (a, b) {
                return sortComparator('op', a, b);
            });
            if (!flat.length) {
                tlBody.innerHTML = '<div class="proveedores-empty-state"><p>Sin oportunidades para los filtros actuales.</p></div>';
                actualizarFilterCount(0);
                return;
            }
            var html = '';
            for (var z = 0; z < flat.length; z++) {
                var row = flat[z];
                html += renderTimelineRow(row.op, row.proveedor);
            }
            tlBody.innerHTML = html;
            actualizarFilterCount(flat.length);

            var rowEls = tlBody.querySelectorAll('.proveedores-tl-row');
            for (var q = 0; q < rowEls.length; q++) {
                rowEls[q].addEventListener('click', function () {
                    var oppId = parseInt(this.getAttribute('data-opp-id'), 10);
                    if (oppId && typeof window.openDetalle === 'function') {
                        window.openDetalle(oppId);
                    }
                });
            }
        });
    }

    function opPasaFiltros(op) {
        if (!passesMulti(_filters.quarter, quarterOf(op.mes))) return false;
        if (!passesMulti(_filters.prob,    probBand(op.prob))) return false;
        if (!passesMulti(_filters.mes,     op.mes)) return false;
        return true;
    }
    function opPasaBusqueda(op, proveedor) {
        if (!_query) return true;
        var q = _query.toLowerCase();
        if ((proveedor.label || '').toLowerCase().indexOf(q) !== -1) return true;
        if ((op.cliente || '').toLowerCase().indexOf(q) !== -1) return true;
        if ((op.oportunidad || '').toLowerCase().indexOf(q) !== -1) return true;
        return false;
    }

    function renderTimelineRow(op, proveedor) {
        var cells = '';
        for (var i = 0; i < 12; i++) {
            var qtone = i < 3 ? 't-q1' : i < 6 ? 't-q2' : i < 9 ? 't-q3' : 't-q4';
            var chip = '';
            if (op.mes === i + 1) {
                chip = '<span class="proveedores-tl-chip ' + probClass(op.prob) + '">' + op.prob + '%</span>';
            }
            cells += '<div class="proveedores-tl-cell proveedores-' + qtone + '">' + chip + '</div>';
        }
        var logoTl = proveedor.logo_url
            ? '<div class="proveedores-logo has-img" style="width:30px;height:30px;font-size:11px;--pv-h:' + hueOf(proveedor.label) + ';"><img src="' + escHtml(proveedor.logo_url) + '" alt="' + escHtml(proveedor.label) + '"></div>'
            : '<div class="proveedores-logo" style="width:30px;height:30px;font-size:11px;--pv-h:' + hueOf(proveedor.label) + ';">' + escHtml(initials(proveedor.label)) + '</div>';
        return '' +
            '<div class="proveedores-tl-row" data-proveedor-key="' + escHtml(proveedor.key) + '" data-opp-id="' + op.id + '" title="Abrir oportunidad">' +
                '<div class="proveedores-tl-left">' +
                    '<div class="proveedores-tl-op">' +
                        logoTl +
                        '<div class="proveedores-tl-op-txt">' +
                            '<div class="proveedores-tl-op-cli">' + escHtml(op.oportunidad || '—') + '</div>' +
                            '<div class="proveedores-tl-op-sub">' + escHtml(proveedor.label) + ' · ' + escHtml(op.cliente || '—') + '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="proveedores-tl-monto">' + fmtMoney(op.monto, true) + '</div>' +
                '</div>' +
                '<div class="proveedores-tl-grid">' + cells + '</div>' +
            '</div>';
    }

    function actualizarFilterCount(forcedCount) {
        var el = document.getElementById('pvFilterCount');
        if (!el) return;
        var n;
        if (typeof forcedCount === 'number') n = forcedCount;
        else if (_view === 'tabla') n = visiblesFiltradas().length;
        else n = 0;
        el.textContent = n + ' resultado' + (n === 1 ? '' : 's');
    }

    // ─────────────────────────────────────────────────────────────────────
    // WIDGET DETALLE
    // ─────────────────────────────────────────────────────────────────────

    function openProveedorDetalle(key) {
        var f = getFiltrosFetch();
        renderProveedorWidget(null);
        toggleProveedorWidget(true);
        fetch('/app/api/proveedores/' + encodeURIComponent(key) + '/?anio=' + encodeURIComponent(f.anio), {
            credentials: 'same-origin'
        })
            .then(function (r) { return r.json(); })
            .then(function (resp) {
                if (resp && resp.ok) renderProveedorWidget({ proveedor: resp.proveedor, ops: resp.ops || [] });
                else renderProveedorWidget({ error: resp && resp.error ? resp.error : 'Error desconocido.' });
            })
            .catch(function (err) {
                if (err && err.name === 'AbortError') return;
                renderProveedorWidget({ error: err && err.message ? err.message : '' });
            });
    }

    function toggleProveedorWidget(open) {
        var overlay = document.getElementById('proveedorWidgetOverlay');
        if (!overlay) return;
        if (open) {
            overlay.classList.add('is-open');
            overlay.setAttribute('aria-hidden', 'false');
            if (document.body) document.body.classList.add('proveedor-modal-open');
        } else {
            overlay.classList.remove('is-open');
            overlay.setAttribute('aria-hidden', 'true');
            var ed = document.getElementById('peOverlay');
            var edOpen = ed && ed.classList.contains('is-open');
            if (!edOpen && document.body) document.body.classList.remove('proveedor-modal-open');
        }
    }

    function renderProveedorWidget(state) {
        var box = document.getElementById('proveedorWidgetInner');
        if (!box) return;
        if (!state) {
            box.innerHTML =
                '<div class="proveedor-widget-top">' +
                    '<button class="proveedor-widget-iconbtn" type="button" data-pv-close><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
                '</div>' +
                '<div style="padding:80px 0;text-align:center;color:#86868B;font-size:14px;">Cargando…</div>';
            wireWidgetClose();
            return;
        }
        if (state.error) {
            box.innerHTML =
                '<div class="proveedor-widget-top">' +
                    '<button class="proveedor-widget-iconbtn" type="button" data-pv-close><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
                '</div>' +
                '<div style="padding:80px 0;text-align:center;color:#B91C1C;font-size:14px;">Error: ' + escHtml(state.error) + '</div>';
            wireWidgetClose();
            return;
        }

        var p = state.proveedor;
        var ops = state.ops;
        var avancePct = p.meta ? Math.min(1, p.facturado / p.meta) : 0;
        var gapHtml = !p.meta
            ? '<div class="proveedor-widget-gap neutral">Sin meta definida para este proveedor.</div>'
            : (p.gap >= 0
                ? '<div class="proveedor-widget-gap pos">Meta superada por ' + fmtMoney(Math.abs(p.gap), true) + '</div>'
                : '<div class="proveedor-widget-gap neg">Faltan ' + fmtMoney(Math.abs(p.gap), true) + '</div>');

        var statsHtml =
            '<div class="proveedor-widget-stats">' +
                '<div class="proveedor-widget-stat"><div class="proveedor-widget-stat-v">' + fmtMoney(p.facturado, true) + '</div><div class="proveedor-widget-stat-l">Facturado</div></div>' +
                '<div class="proveedor-widget-stat"><div class="proveedor-widget-stat-v">' + fmtMoney(p.pipeline, true) + '</div><div class="proveedor-widget-stat-l">Oportunidades</div></div>' +
                '<div class="proveedor-widget-stat"><div class="proveedor-widget-stat-v">' + p.cotizaciones + '</div><div class="proveedor-widget-stat-l">Cotizaciones</div></div>' +
                '<div class="proveedor-widget-stat"><div class="proveedor-widget-stat-v">' + p.campanias + '</div><div class="proveedor-widget-stat-l">Campañas</div></div>' +
            '</div>';

        var descHtml = p.descripcion
            ? '<p class="proveedor-widget-desc">' + escHtml(p.descripcion) + '</p>'
            : '';

        var logoCls = 'proveedores-logo' + (p.logo_url ? ' has-img' : '');
        var logoInner = p.logo_url
            ? '<img src="' + escHtml(p.logo_url) + '" alt="' + escHtml(p.label) + '">'
            : escHtml(initials(p.label));
        var logoHtml = '<div class="' + logoCls + '" style="width:56px;height:56px;font-size:20px;--pv-h:' + hueOf(p.label) + ';">' + logoInner + '</div>';

        var contactos = p.contactos || {};
        var contactosLabels = { principal: 'Principal', ventas: 'Ventas', soporte: 'Soporte' };
        var contactosHtml = '';
        ['principal', 'ventas', 'soporte'].forEach(function (grp) {
            var c = contactos[grp] || {};
            if (!c.nombre && !c.email && !c.telefono) return;
            var lines = '';
            if (c.email) lines += '<div class="proveedor-widget-contacto-line">' + escHtml(c.email) + '</div>';
            if (c.telefono) lines += '<div class="proveedor-widget-contacto-line">' + escHtml(c.telefono) + '</div>';
            contactosHtml +=
                '<div class="proveedor-widget-contacto">' +
                    '<div class="proveedor-widget-contacto-rol">' + escHtml(contactosLabels[grp]) + '</div>' +
                    (c.nombre ? '<div class="proveedor-widget-contacto-nombre">' + escHtml(c.nombre) + '</div>' : '') +
                    lines +
                '</div>';
        });
        var contactosSecHtml = contactosHtml
            ? '<div class="proveedor-widget-section">' +
                  '<h3 class="proveedor-widget-section-title">Contactos</h3>' +
                  '<div class="proveedor-widget-contactos">' + contactosHtml + '</div>' +
              '</div>'
            : '';

        var estrategiaHtml = p.estrategia
            ? '<div class="proveedor-widget-section">' +
                  '<h3 class="proveedor-widget-section-title">Estrategia</h3>' +
                  '<div class="proveedor-widget-estrategia">' + escHtml(p.estrategia) + '</div>' +
              '</div>'
            : '';

        var opsHtml = '';
        if (!ops.length) {
            opsHtml = '<div style="grid-column:1/-1;padding:20px 0;text-align:center;color:#86868B;font-size:13px;font-style:italic;">Sin oportunidades para este año.</div>';
        } else {
            for (var i = 0; i < ops.length; i++) {
                var o = ops[i];
                opsHtml +=
                    '<div class="proveedor-widget-op" data-opp-id="' + o.id + '" role="button" title="Abrir oportunidad">' +
                        '<div>' +
                            '<div class="proveedor-widget-op-cli">' + escHtml(o.cliente || '—') + '</div>' +
                            '<div class="proveedor-widget-op-desc">' + escHtml(o.oportunidad || '') + '</div>' +
                        '</div>' +
                        '<div class="proveedor-widget-op-right">' +
                            '<div class="proveedor-widget-op-monto">' + fmtMoney(o.monto, true) + '</div>' +
                            '<div class="proveedor-widget-op-tags">' +
                                '<span class="proveedor-widget-op-mes">' + (MESES_SHORT[(o.mes || 1) - 1] || '') + '</span>' +
                                '<span class="proveedores-tl-chip ' + probClass(o.prob) + '">' + o.prob + '%</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>';
            }
        }

        box.innerHTML =
            '<div class="proveedor-widget-top">' +
                '<button class="proveedor-widget-iconbtn" type="button" data-pv-close>' +
                    '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
                '</button>' +
                '<div style="position:relative;">' +
                    '<button class="proveedor-widget-iconbtn" type="button" id="pvWidgetMenuBtn" aria-label="Más acciones">' +
                        '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>' +
                    '</button>' +
                    '<div class="proveedor-widget-menu" id="pvWidgetMenu" role="menu" style="top:34px;right:0;">' +
                        '<button type="button" data-pv-menu="editar">' +
                            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                            'Editar proveedor' +
                        '</button>' +
                        '<button type="button" class="danger" data-pv-menu="eliminar">' +
                            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>' +
                            'Eliminar proveedor' +
                        '</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="proveedor-widget-hero">' +
                logoHtml +
                '<div>' +
                    '<h2 class="proveedor-widget-name">' + escHtml(p.label) + '</h2>' +
                    '<div class="proveedor-widget-cat">' + escHtml(p.cat) + '</div>' +
                '</div>' +
            '</div>' +
            descHtml +
            '<div class="proveedor-widget-meta">' +
                '<div class="proveedor-widget-meta-row">' +
                    '<span>Avance a meta</span>' +
                    '<span class="strong">' + (p.meta ? (Math.round(avancePct * 100) + '% · ' + fmtMoney(p.meta, true)) : '—') + '</span>' +
                '</div>' +
                '<div class="proveedores-avance-bar lg"><span style="width:' + (avancePct * 100) + '%;"></span></div>' +
                gapHtml +
            '</div>' +
            statsHtml +
            contactosSecHtml +
            estrategiaHtml +
            '<div class="proveedor-widget-sec-h">' +
                '<span>Oportunidades</span>' +
                '<span class="proveedor-widget-sec-count">' + ops.length + '</span>' +
            '</div>' +
            '<div class="proveedor-widget-ops">' + opsHtml + '</div>' +
            '<div class="proveedor-widget-actions">' +
                '<button class="proveedor-widget-btn proveedor-widget-btn--primary" type="button" data-pv-action="nueva-opp">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
                    'Nueva oportunidad' +
                '</button>' +
            '</div>';

        wireWidgetClose();
        wireWidgetActions(p);
        wireWidgetMenu(p);
        wireOppClicks();
    }

    function wireWidgetMenu(p) {
        var btn = document.getElementById('pvWidgetMenuBtn');
        var menu = document.getElementById('pvWidgetMenu');
        if (!btn || !menu) return;
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            menu.classList.toggle('is-open');
        });
        document.addEventListener('click', function (e) {
            if (!menu.contains(e.target) && e.target !== btn) {
                menu.classList.remove('is-open');
            }
        }, { once: false });
        menu.querySelectorAll('[data-pv-menu]').forEach(function (b) {
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                menu.classList.remove('is-open');
                var action = b.getAttribute('data-pv-menu');
                if (action === 'editar') {
                    if (window._crmProveedorEditor && window._crmProveedorEditor.open) {
                        toggleProveedorWidget(false);
                        setTimeout(function () {
                            window._crmProveedorEditor.open({ mode: 'edit', key: p.key });
                        }, 100);
                    }
                } else if (action === 'eliminar') {
                    if (!window.confirm('¿Eliminar el proveedor "' + (p.label || p.key) + '"? Se ocultará del catálogo.')) return;
                    fetch('/app/api/proveedores/' + encodeURIComponent(p.key) + '/eliminar/', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'X-CSRFToken': (document.querySelector('[name=csrfmiddlewaretoken]') || {}).value || '' }
                    }).then(function (r) { return r.json(); }).then(function (res) {
                        if (res && res.ok) {
                            if (typeof window.toast === 'function') window.toast('Proveedor eliminado', 'success');
                            toggleProveedorWidget(false);
                            fetchProveedores();
                        } else if (typeof window.toast === 'function') {
                            window.toast((res && res.error) || 'No se pudo eliminar.', 'error');
                        }
                    });
                }
            });
        });
    }

    function wireOppClicks() {
        var ops = document.querySelectorAll('#proveedorWidgetInner .proveedor-widget-op[data-opp-id]');
        for (var i = 0; i < ops.length; i++) {
            ops[i].addEventListener('click', function () {
                var oppId = parseInt(this.getAttribute('data-opp-id'), 10);
                if (!oppId) return;
                toggleProveedorWidget(false);
                if (typeof window.openDetalle === 'function') {
                    setTimeout(function () { window.openDetalle(oppId); }, 60);
                } else if (typeof window.toast === 'function') {
                    window.toast('No se pudo abrir la oportunidad.', 'error');
                }
            });
        }
    }

    function wireWidgetClose() {
        var btns = document.querySelectorAll('#proveedorWidgetInner [data-pv-close]');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function () { toggleProveedorWidget(false); });
        }
    }
    function wireWidgetActions(proveedor) {
        var btns = document.querySelectorAll('#proveedorWidgetInner [data-pv-action]');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function () {
                var action = this.getAttribute('data-pv-action');
                if (action === 'nueva-opp') {
                    abrirCrearOportunidad(proveedor);
                    return;
                }
                if (typeof window.toast === 'function') {
                    window.toast('Próximamente: ' + action + ' para ' + (proveedor.label || 'el proveedor') + '.', 'info');
                }
            });
        }
    }

    function abrirCrearOportunidad(proveedor) {
        toggleProveedorWidget(false);
        setTimeout(function () {
            var overlay = document.getElementById('widgetNegociacion');
            if (!overlay) {
                if (typeof window.toast === 'function') {
                    window.toast('Widget de oportunidad no disponible.', 'error');
                }
                return;
            }
            overlay.classList.remove('closing');
            overlay.classList.add('active');
            // Nota: no hay select de proveedor en _widget_negociacion.html
            // todavía. Cuando exista TodoItem.proveedor + el select, se
            // puede preseleccionar igual que hace marcas con wfProducto.
            var firstFocus = document.getElementById('wfOportunidad');
            if (firstFocus && typeof firstFocus.focus === 'function') firstFocus.focus();
        }, 60);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ACTIVAR / DESACTIVAR + WIRING
    // ─────────────────────────────────────────────────────────────────────

    function activar() {
        try {
            if (typeof window._crmSetMode === 'function') {
                window._crmSetMode('clientes_tabla');
            }
        } catch (e) {}
        _activo = true;
        IDS_OTROS_KPI.forEach(hide);
        IDS_TABLA_OPPS.forEach(hide);

        // _crmSetMode('clientes_tabla') deja el botón Clientes con .active
        // y los demás tabs en su estado anterior. Limpiamos TODOS los .active
        // de los otros tabs antes de marcar el nuestro.
        IDS_OTROS_BTNS.forEach(function (id) {
            var b = document.getElementById(id);
            if (b) b.classList.remove('active');
        });
        var btnRep2 = document.getElementById('crmModeReportes');
        if (btnRep2) btnRep2.classList.remove('active');

        var btn = document.getElementById('crmModeProveedores');
        if (btn) btn.classList.add('active');
        var section = document.getElementById('ckProveedoresSection');
        if (section) section.style.display = 'block';

        if (document.body) document.body.classList.add('crm-proveedores-active');

        try { localStorage.setItem('crm_clientes_mode', 'proveedores'); } catch (e) {}
        ajustarAlturaSeccion();
        window.addEventListener('resize', ajustarAlturaSeccion);
        fetchProveedores();
    }

    function desactivar() {
        _activo = false;
        var btn = document.getElementById('crmModeProveedores');
        if (btn) btn.classList.remove('active');
        liberarAlturaSeccion();
        var section = document.getElementById('ckProveedoresSection');
        if (section) section.style.display = 'none';
        if (document.body) document.body.classList.remove('crm-proveedores-active');
        toggleProveedorWidget(false);
        window.removeEventListener('resize', ajustarAlturaSeccion);
    }

    /* Mide y APLICA alturas exactas a la sección Y a las cards de
       tabla/timeline. Mismo patrón de Marcas. */
    function ajustarAlturaSeccion() {
        var section = document.getElementById('ckProveedoresSection');
        if (!section || section.style.display === 'none') return;
        requestAnimationFrame(function () {
            var sRect = section.getBoundingClientRect();
            var sectionH = Math.max(440, window.innerHeight - sRect.top - 12);
            section.style.height = sectionH + 'px';

            requestAnimationFrame(function () {
                var topbar = section.querySelector('.proveedores-topbar');
                var kpis = section.querySelector('.proveedores-kpis');
                var topbarH = topbar ? topbar.offsetHeight : 0;
                var kpisH = kpis ? kpis.offsetHeight : 0;
                var cardH = Math.max(200, sectionH - topbarH - kpisH - 18);

                var cardTabla = document.getElementById('pvViewTabla');
                var cardTl = document.getElementById('pvViewTimeline');
                if (cardTabla) cardTabla.style.height = cardH + 'px';
                if (cardTl)    cardTl.style.height = cardH + 'px';
            });
        });
    }

    function liberarAlturaSeccion() {
        var section = document.getElementById('ckProveedoresSection');
        if (!section) return;
        section.style.height = '';
        ['pvViewTabla', 'pvViewTimeline'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.style.height = '';
        });
    }

    function instalarGuard() {
        var orig = window._crmSetMode;
        if (typeof orig !== 'function') return false;
        if (orig._proveedoresPatched) return true;
        var patched = function (mode) {
            if (_activo && mode !== '__proveedores__' && mode !== 'proveedores') return;
            return orig.apply(this, arguments);
        };
        patched._proveedoresPatched = true;
        patched._original = orig;
        window._crmSetMode = patched;
        return true;
    }

    function wireControls() {
        var search = document.getElementById('pvSearch');
        if (search) {
            search.addEventListener('input', function (e) {
                _query = e.target.value || '';
                var clear = document.getElementById('pvSearchClear');
                if (clear) clear.hidden = !_query;
                renderAll();
            });
        }
        var clear = document.getElementById('pvSearchClear');
        if (clear) clear.addEventListener('click', function () {
            _query = '';
            if (search) { search.value = ''; }
            clear.hidden = true;
            renderAll();
        });

        var seg = document.getElementById('pvSegView');
        if (seg) {
            var segBtns = seg.querySelectorAll('.proveedores-seg');
            for (var i = 0; i < segBtns.length; i++) {
                segBtns[i].addEventListener('click', function () {
                    var v = this.getAttribute('data-view');
                    _view = v;
                    for (var j = 0; j < segBtns.length; j++) {
                        segBtns[j].classList.toggle('is-on', segBtns[j].getAttribute('data-view') === v);
                    }
                    var vt = document.getElementById('pvViewTabla');
                    var vl = document.getElementById('pvViewTimeline');
                    if (vt) vt.hidden = v !== 'tabla';
                    if (vl) vl.hidden = v !== 'timeline';
                    if (v === 'timeline') renderTimeline();
                    actualizarVisibilidadFiltro();
                    actualizarFilterCount();
                });
            }
        }

        var btnFilter = document.getElementById('pvBtnFilter');
        if (btnFilter) {
            btnFilter.addEventListener('click', function (e) {
                e.stopPropagation();
                togglePopover('pvPopFilter', btnFilter, renderFilterFieldsPopover);
            });
        }
        var btnSort = document.getElementById('pvBtnSort');
        if (btnSort) {
            btnSort.addEventListener('click', function (e) {
                e.stopPropagation();
                togglePopover('pvPopSort', btnSort, renderSortPopover);
            });
        }

        var btnAdd = document.getElementById('pvBtnAddProveedor');
        if (btnAdd) {
            btnAdd.addEventListener('click', function (e) {
                e.preventDefault();
                if (window._crmProveedorEditor && window._crmProveedorEditor.open) {
                    window._crmProveedorEditor.open({ mode: 'create' });
                } else if (typeof window.toast === 'function') {
                    window.toast('Editor de proveedores no disponible.', 'error');
                }
            });
        }

        var btnReset = document.getElementById('pvBtnReset');
        if (btnReset) {
            btnReset.addEventListener('click', function () {
                _query = ''; if (search) search.value = '';
                _filters = { quarter: [], prob: [], mes: [], proveedor: [] };
                _sortKey = 'default';
                renderAll();
            });
        }

        document.addEventListener('click', function (e) {
            if (e.target.closest('.crm-popover')) return;
            if (e.target.closest('#pvBtnFilter') || e.target.closest('#pvBtnSort')) return;
            closeAllPvPopovers();
        });

        var overlay = document.getElementById('proveedorWidgetOverlay');
        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) toggleProveedorWidget(false);
            });
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var ov = document.getElementById('proveedorWidgetOverlay');
                if (ov && ov.classList.contains('is-open')) toggleProveedorWidget(false);
            }
        });
    }

    function init() {
        var btn = document.getElementById('crmModeProveedores');
        if (!btn) return;

        if (!instalarGuard()) setTimeout(instalarGuard, 0);

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            activar();
        });

        IDS_OTROS_BTNS.forEach(function (id) {
            var b = document.getElementById(id);
            if (b) b.addEventListener('click', desactivar, true);
        });
        var btnRep = document.getElementById('crmModeReportes');
        if (btnRep) btnRep.addEventListener('click', desactivar, true);

        wireControls();

        if (_initialMode === 'proveedores') {
            setTimeout(activar, 50);
            setTimeout(function () { if (!_activo) activar(); }, 800);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window._crmProveedores = {
        open: activar,
        close: desactivar,
        refresh: fetchProveedores,
        openDetalle: openProveedorDetalle
    };
})();
