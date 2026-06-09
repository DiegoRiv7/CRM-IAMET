/*
  crm_marcas_v2.js — Handler de la tab "Marcas" del dashboard.

  Layout SECTION → TOPBAR + KPIs + (TABLA | TIMELINE) + WIDGET DETALLE.
  Vanilla JS (sin React) portado del diseño de Claude Design.

  V2 (Boy Scout): NO modifica crm_main.js legacy. Monkey-patch a _crmSetMode
  bloquea refreshes mientras estamos en Marcas (mismo patrón de Control).

  Fetch:
    GET /app/api/marcas/resumen/?anio=YYYY&vendedores=CSV → todas las marcas
    GET /app/api/marcas/<key>/?anio=YYYY                  → detalle + ops
*/
(function () {
    'use strict';

    var _activo = false;
    var _initialMode = null;
    var _marcasCache = [];
    var _totalsCache = null;
    var _view = 'tabla';
    var _query = '';
    var _filters = { quarter: 'all', prob: 'all', mes: 'all', marca: 'all' };
    // Sort key: 'default' | 'monto-desc' | 'monto-asc' | 'prob-desc' | 'prob-asc' | 'nombre-asc' | 'fact-desc' | 'fact-asc'
    var _sortKey = 'default';

    // Definición de filtros disponibles. Cada uno tiene un picker propio
    // (el value popover decide cómo renderiza sus opciones según `type`).
    var MK_FILTER_FIELDS = [
        { key: 'marca',   label: 'Marca',        type: 'marca' },
        { key: 'quarter', label: 'Trimestre',    type: 'enum',
            options: [{v:'1',l:'Q1'},{v:'2',l:'Q2'},{v:'3',l:'Q3'},{v:'4',l:'Q4'}] },
        { key: 'prob',    label: 'Probabilidad', type: 'enum',
            options: [{v:'high',l:'Alta (≥60%)'},{v:'mid',l:'Media (40-59%)'},{v:'low',l:'Baja (<40%)'}] },
        { key: 'mes',     label: 'Mes',          type: 'enum',
            options: [
                {v:'1',l:'Enero'},{v:'2',l:'Febrero'},{v:'3',l:'Marzo'},{v:'4',l:'Abril'},
                {v:'5',l:'Mayo'},{v:'6',l:'Junio'},{v:'7',l:'Julio'},{v:'8',l:'Agosto'},
                {v:'9',l:'Septiembre'},{v:'10',l:'Octubre'},{v:'11',l:'Noviembre'},{v:'12',l:'Diciembre'}
            ] }
    ];

    // Opciones del popover Ordenar.
    var MK_SORT_OPTIONS = [
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
        'ckControlSection', 'ckProveedoresSection'
    ];
    var IDS_OTROS_BTNS = [
        'crmModeOpp', 'crmModeProsp', 'crmModeProyectos', 'crmModeClientes',
        'crmModeControl', 'crmModeProveedores'
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

    /* Comparator unificado para los dos sorts (marca-level y opp-level).
       `kind` es 'marca' (recibe a, b = objetos marca con .facturado, .label)
       o 'op' (recibe a, b = {op, marca} con op.monto/op.prob, marca.label).
       Las claves que no aplican a `kind` caen a 0 para no cambiar el orden. */
    function sortComparator(kind, a, b) {
        switch (_sortKey) {
            case 'fact-desc':
                return (kind === 'marca') ? (b.facturado - a.facturado) : 0;
            case 'fact-asc':
                return (kind === 'marca') ? (a.facturado - b.facturado) : 0;
            case 'monto-desc':
                return (kind === 'marca')
                    ? ((b.pipeline || 0) - (a.pipeline || 0))
                    : (b.op.monto - a.op.monto);
            case 'monto-asc':
                return (kind === 'marca')
                    ? ((a.pipeline || 0) - (b.pipeline || 0))
                    : (a.op.monto - b.op.monto);
            case 'prob-desc':
                return (kind === 'op') ? (b.op.prob - a.op.prob) : 0;
            case 'prob-asc':
                return (kind === 'op') ? (a.op.prob - b.op.prob) : 0;
            case 'nombre-asc':
                if (kind === 'marca') return (a.label || '').localeCompare(b.label || '');
                return (a.marca.label || '').localeCompare(b.marca.label || '');
            case 'default':
            default:
                return (kind === 'marca')
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
    function fetchMarcas() {
        var f = getFiltrosFetch();
        var qs = '?anio=' + encodeURIComponent(f.anio);
        if (f.vendedores) qs += '&vendedores=' + encodeURIComponent(f.vendedores);

        if (_inflightAbort && typeof _inflightAbort.abort === 'function') {
            try { _inflightAbort.abort(); } catch (e) {}
        }
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        _inflightAbort = ctrl;

        renderLoading();

        return fetch('/app/api/marcas/resumen/' + qs, {
            credentials: 'same-origin',
            signal: ctrl ? ctrl.signal : undefined
        })
            .then(function (r) { return r.json(); })
            .then(function (resp) {
                if (resp && resp.ok) {
                    _marcasCache = resp.marcas || [];
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
        var tb = document.getElementById('mkTableBody');
        var tl = document.getElementById('mkTimelineBody');
        if (tb) tb.innerHTML = '<tr><td colspan="7" class="marcas-empty-cell">Cargando…</td></tr>';
        if (tl) tl.innerHTML = '<div class="marcas-empty-state"><p>Cargando…</p></div>';
        var setT = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
        setT('mkKpiFact', '—'); setT('mkKpiOpps', '—');
        setT('mkKpiCot', '—');  setT('mkKpiCam', '—');
    }

    function renderError(msg) {
        var tb = document.getElementById('mkTableBody');
        var tl = document.getElementById('mkTimelineBody');
        var html = '<tr><td colspan="7" class="marcas-empty-cell" style="color:#B91C1C;">Error: ' + escHtml(msg) + '</td></tr>';
        var htmlTl = '<div class="marcas-empty-state" style="color:#B91C1C;"><p>Error: ' + escHtml(msg) + '</p></div>';
        if (tb) tb.innerHTML = html;
        if (tl) tl.innerHTML = htmlTl;
    }

    function visiblesFiltradas() {
        var q = (_query || '').trim().toLowerCase();
        var matchText = function (m) {
            if (!q) return true;
            return (m.label || '').toLowerCase().indexOf(q) !== -1 ||
                   (m.cat   || '').toLowerCase().indexOf(q) !== -1;
        };
        return _marcasCache.filter(matchText);
    }

    function renderAll() {
        renderKpis();
        renderTabla();
        renderTimeline();
        renderFacetChips();
        actualizarVisibilidadFiltro();
        actualizarFilterCount();
    }

    /* El botón "Filtro" solo aplica a vista Timeline (sus campos —
       trimestre, probabilidad, mes, marca — son por oportunidad, no por
       marca). En Tabla cada fila ya es una marca, así que el filtro es
       redundante con el buscador. Lo ocultamos en Tabla; el botón
       Ordenar queda visible en ambas vistas. */
    function actualizarVisibilidadFiltro() {
        var btn = document.getElementById('mkBtnFilter');
        var chips = document.getElementById('mkFacetChips');
        if (!btn) return;
        var show = (_view === 'timeline');
        btn.style.display = show ? '' : 'none';
        if (chips) chips.style.display = show ? '' : 'none';
        // Si oculto el botón, cerrar el popover si quedó abierto.
        if (!show) closeAllMkPopovers();
    }

    /* ─────────── POPOVERS estilo CRM (filtros + ordenar) ─────────── */

    function closeAllMkPopovers(except) {
        ['mkPopFilter', 'mkPopFilterValue', 'mkPopSort'].forEach(function (id) {
            if (id === except) return;
            var el = document.getElementById(id);
            if (el) el.classList.remove('open');
        });
    }

    function positionPopoverFromRect(pop, r) {
        pop.style.top  = (r.bottom + 6) + 'px';
        pop.style.left = r.left + 'px';
        pop.style.right = 'auto';
        // Ajustar si sale por la derecha
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
        // IMPORTANTE: capturar el rect del anchor ANTES de cerrar los demás
        // popovers — si el anchor es un item de un popover hermano (caso del
        // sub-popover de valores), al cerrarlo el anchor queda display:none y
        // su getBoundingClientRect() devuelve 0/0 → el sub-popover salía
        // posicionado arriba a la izquierda.
        var anchorRect = anchor.getBoundingClientRect();
        closeAllMkPopovers(popId);
        if (typeof renderer === 'function') renderer(pop);
        pop.classList.add('open');
        positionPopoverFromRect(pop, anchorRect);
    }

    function renderFilterFieldsPopover(pop) {
        var html = '<div class="crm-pop-section">Filtrar por</div><div class="crm-pop-list">';
        MK_FILTER_FIELDS.forEach(function (fld) {
            var active = (_filters[fld.key] && _filters[fld.key] !== 'all');
            html += '<button type="button" class="crm-pop-item ' + (active ? 'active' : '') + '" data-mk-field="' + fld.key + '">' +
                        '<span>' + escHtml(fld.label) + '</span>' +
                    '</button>';
        });
        html += '</div>';
        pop.innerHTML = html;
        // Wire items
        pop.querySelectorAll('[data-mk-field]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var key = btn.getAttribute('data-mk-field');
                var fld = MK_FILTER_FIELDS.find(function (f) { return f.key === key; });
                if (!fld) return;
                togglePopover('mkPopFilterValue', btn, function (vpop) {
                    renderFilterValuePopover(vpop, fld);
                });
            });
        });
    }

    function renderFilterValuePopover(pop, field) {
        var current = _filters[field.key] || 'all';
        var options = [];
        if (field.type === 'marca') {
            options.push({ v: 'all', l: 'Todas' });
            _marcasCache.forEach(function (m) {
                options.push({ v: m.key, l: m.label });
            });
        } else if (field.type === 'enum') {
            options.push({ v: 'all', l: 'Todas' });
            (field.options || []).forEach(function (o) { options.push(o); });
        }
        var html = '<div class="crm-pop-section">' + escHtml(field.label) + '</div><div class="crm-pop-list">';
        options.forEach(function (o) {
            var act = String(o.v) === String(current) ? 'active' : '';
            html += '<button type="button" class="crm-pop-item ' + act + '" data-mk-val="' + escHtml(o.v) + '">' +
                        '<span>' + escHtml(o.l) + '</span>' +
                    '</button>';
        });
        html += '</div>';
        pop.innerHTML = html;
        pop.querySelectorAll('[data-mk-val]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                _filters[field.key] = btn.getAttribute('data-mk-val');
                closeAllMkPopovers();
                renderAll();
            });
        });
    }

    function renderSortPopover(pop) {
        var html = '<div class="crm-pop-section">Ordenar por</div><div class="crm-pop-list">';
        MK_SORT_OPTIONS.forEach(function (s) {
            var act = s.k === _sortKey ? 'active' : '';
            html += '<button type="button" class="crm-pop-item ' + act + '" data-mk-sort="' + escHtml(s.k) + '">' +
                        '<span>' + escHtml(s.lbl) + '</span>' +
                    '</button>';
        });
        html += '</div>';
        pop.innerHTML = html;
        pop.querySelectorAll('[data-mk-sort]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                _sortKey = btn.getAttribute('data-mk-sort');
                closeAllMkPopovers();
                actualizarSortLabel();
                renderAll();
            });
        });
    }

    function actualizarSortLabel() {
        var label = document.getElementById('mkSortLabel');
        var btn = document.getElementById('mkBtnSort');
        if (!label || !btn) return;
        if (_sortKey && _sortKey !== 'default') {
            var s = MK_SORT_OPTIONS.find(function (x) { return x.k === _sortKey; });
            label.textContent = s ? s.lbl : 'Ordenar';
            btn.classList.add('has-sort');
        } else {
            label.textContent = 'Ordenar';
            btn.classList.remove('has-sort');
        }
    }

    function renderFacetChips() {
        var cont = document.getElementById('mkFacetChips');
        if (!cont) return;
        var chips = '';
        MK_FILTER_FIELDS.forEach(function (fld) {
            var v = _filters[fld.key];
            if (!v || v === 'all') return;
            var label = fld.label + ': ';
            if (fld.type === 'marca') {
                var mm = _marcasCache.find(function (m) { return String(m.key) === String(v); });
                label += mm ? mm.label : v;
            } else if (fld.type === 'enum') {
                var op = (fld.options || []).find(function (o) { return String(o.v) === String(v); });
                label += op ? op.l : v;
            }
            chips += '<span class="mk-facet-chip" data-mk-chip-field="' + fld.key + '">' +
                        escHtml(label) +
                        '<button type="button" class="mk-facet-chip-x" title="Quitar filtro">' +
                            '<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
                        '</button>' +
                     '</span>';
        });
        // Botón "Limpiar todo" si hay al menos un filtro activo.
        var activos = MK_FILTER_FIELDS.some(function (f) {
            return _filters[f.key] && _filters[f.key] !== 'all';
        });
        if (activos) {
            chips += '<button type="button" class="mk-facet-clear-all" id="mkBtnClearAll" title="Limpiar todos los filtros">Limpiar</button>';
        }
        cont.innerHTML = chips;
        // Wire chips
        cont.querySelectorAll('.mk-facet-chip-x').forEach(function (x) {
            x.addEventListener('click', function (e) {
                e.stopPropagation();
                var key = x.closest('[data-mk-chip-field]').getAttribute('data-mk-chip-field');
                _filters[key] = 'all';
                renderAll();
            });
        });
        var btnAll = document.getElementById('mkBtnClearAll');
        if (btnAll) {
            btnAll.addEventListener('click', function () {
                _filters = { quarter: 'all', prob: 'all', mes: 'all', marca: 'all' };
                renderAll();
            });
        }
    }

    function renderKpis() {
        var visibles = visiblesFiltradas();
        var base = visibles.length ? visibles : _marcasCache;
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
        setT('mkKpiFact', fmtMoney(t.facturado, true));
        setT('mkKpiOpps', fmtMoney(t.pipeline, true));
        setT('mkKpiCot',  String(t.cotizaciones));
        setT('mkKpiCam',  String(t.campanias));
        // Meta global se removió: la meta es por marca individual y vive en
        // el widget detalle. Sin más cálculo aquí.
    }

    function renderTabla() {
        var tb = document.getElementById('mkTableBody');
        if (!tb) return;
        var rows = visiblesFiltradas().slice().sort(function (a, b) {
            return sortComparator('marca', a, b);
        });
        if (!rows.length) {
            tb.innerHTML = '<tr><td colspan="7" class="marcas-empty-cell">Sin marcas para la búsqueda actual.</td></tr>';
            return;
        }
        var html = '';
        for (var i = 0; i < rows.length; i++) {
            var m = rows[i];
            var avancePct = m.meta ? Math.min(1, m.facturado / m.meta) : 0;
            var avanceCellHtml = m.meta
                ? '<div class="marcas-avance">' +
                      '<div class="marcas-avance-bar"><span style="width:' + (avancePct * 100) + '%;"></span></div>' +
                      '<span class="marcas-avance-pct">' + Math.round(avancePct * 100) + '%</span>' +
                  '</div>'
                : '<span class="marcas-avance-na">Sin meta</span>';

            var logoT = m.logo_url
                ? '<div class="marcas-logo has-img" style="width:38px;height:38px;font-size:13.7px;--mk-h:' + hueOf(m.label) + ';"><img src="' + escHtml(m.logo_url) + '" alt="' + escHtml(m.label) + '"></div>'
                : '<div class="marcas-logo" style="width:38px;height:38px;font-size:13.7px;--mk-h:' + hueOf(m.label) + ';">' + escHtml(initials(m.label)) + '</div>';
            html +=
                '<tr class="marcas-drow" data-marca-key="' + escHtml(m.key) + '">' +
                    '<td class="marcas-c-name">' +
                        '<div class="marcas-namecell">' +
                            logoT +
                            '<div>' +
                                '<div class="marcas-namecell-t">' + escHtml(m.label) + '</div>' +
                                '<div class="marcas-namecell-s">' + escHtml(m.cat) + '</div>' +
                            '</div>' +
                        '</div>' +
                    '</td>' +
                    '<td class="marcas-num strong">' + fmtMoney(m.facturado, true) + '</td>' +
                    '<td class="marcas-num">' +
                        '<span>' + fmtMoney(m.pipeline, true) + '</span>' +
                        '<span class="marcas-cell-sub">' + m.ops_count + ' ops</span>' +
                    '</td>' +
                    '<td class="marcas-num">' + m.cotizaciones + '</td>' +
                    '<td class="marcas-num">' + m.campanias + '</td>' +
                    '<td class="marcas-c-avance">' + avanceCellHtml + '</td>' +
                    '<td class="marcas-c-chev"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></td>' +
                '</tr>';
        }
        tb.innerHTML = html;

        var rowsEl = tb.querySelectorAll('.marcas-drow');
        for (var j = 0; j < rowsEl.length; j++) {
            rowsEl[j].addEventListener('click', function () {
                var key = this.getAttribute('data-marca-key');
                openMarcaDetalle(key);
            });
        }
    }

    function renderTimeline() {
        // Timeline: aplanar oportunidades visibles (después de fetch de detalles
        // por marca). Como el resumen NO trae ops, hacemos fetch en background
        // por cada marca visible la primera vez que se entra a timeline.
        var tlBody = document.getElementById('mkTimelineBody');
        if (!tlBody) return;
        var visibles = visiblesFiltradas();
        if (!visibles.length) {
            tlBody.innerHTML = '<div class="marcas-empty-state"><p>Sin marcas.</p></div>';
            return;
        }
        // Render skeleton + fetch detalles asíncrono.
        tlBody.innerHTML = '<div class="marcas-empty-state"><p>Cargando oportunidades…</p></div>';
        Promise.all(visibles.map(function (m) {
            if (m._ops) return Promise.resolve(m);  // ya cacheado
            var f = getFiltrosFetch();
            return fetch('/app/api/marcas/' + encodeURIComponent(m.key) + '/?anio=' + encodeURIComponent(f.anio), { credentials: 'same-origin' })
                .then(function (r) { return r.json(); })
                .then(function (resp) {
                    if (resp && resp.ok) m._ops = resp.ops || [];
                    else m._ops = [];
                    return m;
                })
                .catch(function () { m._ops = []; return m; });
        })).then(function (marcasConOps) {
            var flat = [];
            for (var i = 0; i < marcasConOps.length; i++) {
                var mm = marcasConOps[i];
                // Filtro por marca aplicado primero (skip antes del loop interno).
                if (_filters.marca !== 'all' && String(mm.key) !== String(_filters.marca)) continue;
                for (var k = 0; k < (mm._ops || []).length; k++) {
                    var op = mm._ops[k];
                    if (!opPasaFiltros(op)) continue;
                    if (!opPasaBusqueda(op, mm)) continue;
                    flat.push({ op: op, marca: mm });
                }
            }
            flat.sort(function (a, b) {
                return sortComparator('op', a, b);
            });
            if (!flat.length) {
                tlBody.innerHTML = '<div class="marcas-empty-state"><p>Sin oportunidades para los filtros actuales.</p></div>';
                actualizarFilterCount(0);
                return;
            }
            var html = '';
            for (var z = 0; z < flat.length; z++) {
                var row = flat[z];
                html += renderTimelineRow(row.op, row.marca);
            }
            tlBody.innerHTML = html;
            actualizarFilterCount(flat.length);

            var rowEls = tlBody.querySelectorAll('.marcas-tl-row');
            for (var q = 0; q < rowEls.length; q++) {
                rowEls[q].addEventListener('click', function () {
                    var key = this.getAttribute('data-marca-key');
                    openMarcaDetalle(key);
                });
            }
        });
    }

    function opPasaFiltros(op) {
        if (_filters.quarter !== 'all' && String(quarterOf(op.mes)) !== String(_filters.quarter)) return false;
        if (_filters.prob !== 'all' && probBand(op.prob) !== _filters.prob) return false;
        if (_filters.mes !== 'all' && String(op.mes) !== String(_filters.mes)) return false;
        return true;
    }
    function opPasaBusqueda(op, marca) {
        if (!_query) return true;
        var q = _query.toLowerCase();
        if ((marca.label || '').toLowerCase().indexOf(q) !== -1) return true;
        if ((op.cliente || '').toLowerCase().indexOf(q) !== -1) return true;
        if ((op.oportunidad || '').toLowerCase().indexOf(q) !== -1) return true;
        return false;
    }

    function renderTimelineRow(op, marca) {
        var cells = '';
        for (var i = 0; i < 12; i++) {
            var qtone = i < 3 ? 't-q1' : i < 6 ? 't-q2' : i < 9 ? 't-q3' : 't-q4';
            var chip = '';
            if (op.mes === i + 1) {
                chip = '<span class="marcas-tl-chip ' + probClass(op.prob) + '">' + op.prob + '%</span>';
            }
            cells += '<div class="marcas-tl-cell marcas-' + qtone + '">' + chip + '</div>';
        }
        var logoTl = marca.logo_url
            ? '<div class="marcas-logo has-img" style="width:30px;height:30px;font-size:11px;--mk-h:' + hueOf(marca.label) + ';"><img src="' + escHtml(marca.logo_url) + '" alt="' + escHtml(marca.label) + '"></div>'
            : '<div class="marcas-logo" style="width:30px;height:30px;font-size:11px;--mk-h:' + hueOf(marca.label) + ';">' + escHtml(initials(marca.label)) + '</div>';
        return '' +
            '<div class="marcas-tl-row" data-marca-key="' + escHtml(marca.key) + '">' +
                '<div class="marcas-tl-left">' +
                    '<div class="marcas-tl-op">' +
                        logoTl +
                        '<div class="marcas-tl-op-txt">' +
                            '<div class="marcas-tl-op-cli">' + escHtml(op.oportunidad || '—') + '</div>' +
                            '<div class="marcas-tl-op-sub">' + escHtml(marca.label) + ' · ' + escHtml(op.cliente || '—') + '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="marcas-tl-monto">' + fmtMoney(op.monto, true) + '</div>' +
                '</div>' +
                '<div class="marcas-tl-grid">' + cells + '</div>' +
            '</div>';
    }

    function actualizarFilterCount(forcedCount) {
        var el = document.getElementById('mkFilterCount');
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

    function openMarcaDetalle(key) {
        var f = getFiltrosFetch();
        renderMarcaWidget(null);  // placeholder loading
        toggleMarcaWidget(true);
        fetch('/app/api/marcas/' + encodeURIComponent(key) + '/?anio=' + encodeURIComponent(f.anio), {
            credentials: 'same-origin'
        })
            .then(function (r) { return r.json(); })
            .then(function (resp) {
                if (resp && resp.ok) renderMarcaWidget({ marca: resp.marca, ops: resp.ops || [] });
                else renderMarcaWidget({ error: resp && resp.error ? resp.error : 'Error desconocido.' });
            })
            .catch(function (err) {
                if (err && err.name === 'AbortError') return;
                renderMarcaWidget({ error: err && err.message ? err.message : '' });
            });
    }

    function toggleMarcaWidget(open) {
        var overlay = document.getElementById('marcaWidgetOverlay');
        if (!overlay) return;
        if (open) {
            overlay.classList.add('is-open');
            overlay.setAttribute('aria-hidden', 'false');
            if (document.body) document.body.classList.add('marca-modal-open');
        } else {
            overlay.classList.remove('is-open');
            overlay.setAttribute('aria-hidden', 'true');
            // Solo quitar el lock si tampoco está abierto el editor.
            var ed = document.getElementById('meOverlay');
            var edOpen = ed && ed.classList.contains('is-open');
            if (!edOpen && document.body) document.body.classList.remove('marca-modal-open');
        }
    }

    function renderMarcaWidget(state) {
        var box = document.getElementById('marcaWidgetInner');
        if (!box) return;
        if (!state) {
            box.innerHTML =
                '<div class="marca-widget-top">' +
                    '<button class="marca-widget-iconbtn" type="button" data-mk-close><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
                '</div>' +
                '<div style="padding:80px 0;text-align:center;color:#86868B;font-size:14px;">Cargando…</div>';
            wireWidgetClose();
            return;
        }
        if (state.error) {
            box.innerHTML =
                '<div class="marca-widget-top">' +
                    '<button class="marca-widget-iconbtn" type="button" data-mk-close><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
                '</div>' +
                '<div style="padding:80px 0;text-align:center;color:#B91C1C;font-size:14px;">Error: ' + escHtml(state.error) + '</div>';
            wireWidgetClose();
            return;
        }

        var m = state.marca;
        var ops = state.ops;
        var avancePct = m.meta ? Math.min(1, m.facturado / m.meta) : 0;
        var gapHtml = !m.meta
            ? '<div class="marca-widget-gap neutral">Sin meta definida para esta marca.</div>'
            : (m.gap >= 0
                ? '<div class="marca-widget-gap pos">Meta superada por ' + fmtMoney(Math.abs(m.gap), true) + '</div>'
                : '<div class="marca-widget-gap neg">Faltan ' + fmtMoney(Math.abs(m.gap), true) + '</div>');

        var statsHtml =
            '<div class="marca-widget-stats">' +
                '<div class="marca-widget-stat"><div class="marca-widget-stat-v">' + fmtMoney(m.facturado, true) + '</div><div class="marca-widget-stat-l">Facturado</div></div>' +
                '<div class="marca-widget-stat"><div class="marca-widget-stat-v">' + fmtMoney(m.pipeline, true) + '</div><div class="marca-widget-stat-l">Oportunidades</div></div>' +
                '<div class="marca-widget-stat"><div class="marca-widget-stat-v">' + m.cotizaciones + '</div><div class="marca-widget-stat-l">Cotizaciones</div></div>' +
                '<div class="marca-widget-stat"><div class="marca-widget-stat-v">' + m.campanias + '</div><div class="marca-widget-stat-l">Campañas</div></div>' +
            '</div>';

        // ── Bloque descripción (si existe) ──
        var descHtml = m.descripcion
            ? '<p class="marca-widget-desc">' + escHtml(m.descripcion) + '</p>'
            : '';

        // ── Logo hero: imagen si hay logo_url; iniciales si no ──
        var logoCls = 'marcas-logo' + (m.logo_url ? ' has-img' : '');
        var logoInner = m.logo_url
            ? '<img src="' + escHtml(m.logo_url) + '" alt="' + escHtml(m.label) + '">'
            : escHtml(initials(m.label));
        var logoHtml = '<div class="' + logoCls + '" style="width:56px;height:56px;font-size:20px;--mk-h:' + hueOf(m.label) + ';">' + logoInner + '</div>';

        // ── Contactos (solo los grupos con datos) ──
        var contactos = m.contactos || {};
        var contactosLabels = { marca: 'Marca', ingenieria: 'Ingeniería', mayorista: 'Mayorista' };
        var contactosHtml = '';
        ['marca', 'ingenieria', 'mayorista'].forEach(function (grp) {
            var c = contactos[grp] || {};
            if (!c.nombre && !c.email && !c.telefono) return;
            var lines = '';
            if (c.email) lines += '<div class="marca-widget-contacto-line">' + escHtml(c.email) + '</div>';
            if (c.telefono) lines += '<div class="marca-widget-contacto-line">' + escHtml(c.telefono) + '</div>';
            contactosHtml +=
                '<div class="marca-widget-contacto">' +
                    '<div class="marca-widget-contacto-rol">' + escHtml(contactosLabels[grp]) + '</div>' +
                    (c.nombre ? '<div class="marca-widget-contacto-nombre">' + escHtml(c.nombre) + '</div>' : '') +
                    lines +
                '</div>';
        });
        var contactosSecHtml = contactosHtml
            ? '<div class="marca-widget-section">' +
                  '<h3 class="marca-widget-section-title">Contactos</h3>' +
                  '<div class="marca-widget-contactos">' + contactosHtml + '</div>' +
              '</div>'
            : '';

        // ── Estrategia ──
        var estrategiaHtml = m.estrategia
            ? '<div class="marca-widget-section">' +
                  '<h3 class="marca-widget-section-title">Estrategia</h3>' +
                  '<div class="marca-widget-estrategia">' + escHtml(m.estrategia) + '</div>' +
              '</div>'
            : '';

        var opsHtml = '';
        if (!ops.length) {
            opsHtml = '<div style="grid-column:1/-1;padding:20px 0;text-align:center;color:#86868B;font-size:13px;font-style:italic;">Sin oportunidades para este año.</div>';
        } else {
            for (var i = 0; i < ops.length; i++) {
                var o = ops[i];
                opsHtml +=
                    '<div class="marca-widget-op" data-opp-id="' + o.id + '" role="button" title="Abrir oportunidad">' +
                        '<div>' +
                            '<div class="marca-widget-op-cli">' + escHtml(o.cliente || '—') + '</div>' +
                            '<div class="marca-widget-op-desc">' + escHtml(o.oportunidad || '') + '</div>' +
                        '</div>' +
                        '<div class="marca-widget-op-right">' +
                            '<div class="marca-widget-op-monto">' + fmtMoney(o.monto, true) + '</div>' +
                            '<div class="marca-widget-op-tags">' +
                                '<span class="marca-widget-op-mes">' + (MESES_SHORT[(o.mes || 1) - 1] || '') + '</span>' +
                                '<span class="marcas-tl-chip ' + probClass(o.prob) + '">' + o.prob + '%</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>';
            }
        }

        box.innerHTML =
            '<div class="marca-widget-top">' +
                '<button class="marca-widget-iconbtn" type="button" data-mk-close>' +
                    '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
                '</button>' +
                '<div style="position:relative;">' +
                    '<button class="marca-widget-iconbtn" type="button" id="mkWidgetMenuBtn" aria-label="Más acciones">' +
                        '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>' +
                    '</button>' +
                    '<div class="marca-widget-menu" id="mkWidgetMenu" role="menu" style="top:34px;right:0;">' +
                        '<button type="button" data-mk-menu="editar">' +
                            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                            'Editar marca' +
                        '</button>' +
                        '<button type="button" class="danger" data-mk-menu="eliminar">' +
                            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>' +
                            'Eliminar marca' +
                        '</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="marca-widget-hero">' +
                logoHtml +
                '<div>' +
                    '<h2 class="marca-widget-name">' + escHtml(m.label) + '</h2>' +
                    '<div class="marca-widget-cat">' + escHtml(m.cat) + '</div>' +
                '</div>' +
            '</div>' +
            descHtml +
            '<div class="marca-widget-meta">' +
                '<div class="marca-widget-meta-row">' +
                    '<span>Avance a meta</span>' +
                    '<span class="strong">' + (m.meta ? (Math.round(avancePct * 100) + '% · ' + fmtMoney(m.meta, true)) : '—') + '</span>' +
                '</div>' +
                '<div class="marcas-avance-bar lg"><span style="width:' + (avancePct * 100) + '%;"></span></div>' +
                gapHtml +
            '</div>' +
            statsHtml +
            contactosSecHtml +
            estrategiaHtml +
            '<div class="marca-widget-sec-h">' +
                '<span>Oportunidades</span>' +
                '<span class="marca-widget-sec-count">' + ops.length + '</span>' +
            '</div>' +
            '<div class="marca-widget-ops">' + opsHtml + '</div>' +
            '<div class="marca-widget-actions">' +
                '<button class="marca-widget-btn marca-widget-btn--primary" type="button" data-mk-action="nueva-opp">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
                    'Nueva oportunidad' +
                '</button>' +
            '</div>';

        wireWidgetClose();
        wireWidgetActions(m);
        wireWidgetMenu(m);
        wireOppClicks();
    }

    function wireWidgetMenu(m) {
        var btn = document.getElementById('mkWidgetMenuBtn');
        var menu = document.getElementById('mkWidgetMenu');
        if (!btn || !menu) return;
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            menu.classList.toggle('is-open');
        });
        // Click fuera cierra
        document.addEventListener('click', function (e) {
            if (!menu.contains(e.target) && e.target !== btn) {
                menu.classList.remove('is-open');
            }
        }, { once: false });
        menu.querySelectorAll('[data-mk-menu]').forEach(function (b) {
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                menu.classList.remove('is-open');
                var action = b.getAttribute('data-mk-menu');
                if (action === 'editar') {
                    if (window._crmMarcaEditor && window._crmMarcaEditor.open) {
                        // Cierra primero el widget detalle (z-index conflict).
                        toggleMarcaWidget(false);
                        setTimeout(function () {
                            window._crmMarcaEditor.open({ mode: 'edit', key: m.key });
                        }, 100);
                    }
                } else if (action === 'eliminar') {
                    if (!window.confirm('¿Eliminar la marca "' + (m.label || m.key) + '"? Se ocultará del catálogo.')) return;
                    fetch('/app/api/marcas/' + encodeURIComponent(m.key) + '/eliminar/', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'X-CSRFToken': (document.querySelector('[name=csrfmiddlewaretoken]') || {}).value || '' }
                    }).then(function (r) { return r.json(); }).then(function (res) {
                        if (res && res.ok) {
                            if (typeof window.toast === 'function') window.toast('Marca eliminada', 'success');
                            toggleMarcaWidget(false);
                            fetchMarcas();
                        } else if (typeof window.toast === 'function') {
                            window.toast((res && res.error) || 'No se pudo eliminar.', 'error');
                        }
                    });
                }
            });
        });
    }

    function wireOppClicks() {
        var ops = document.querySelectorAll('#marcaWidgetInner .marca-widget-op[data-opp-id]');
        for (var i = 0; i < ops.length; i++) {
            ops[i].addEventListener('click', function () {
                var oppId = parseInt(this.getAttribute('data-opp-id'), 10);
                if (!oppId) return;
                // Cerramos el widget de marca antes de abrir el de oportunidad
                // — si no, el detalle queda detrás del overlay con z-index
                // mayor y no se ve.
                toggleMarcaWidget(false);
                if (typeof window.openDetalle === 'function') {
                    setTimeout(function () { window.openDetalle(oppId); }, 60);
                } else if (typeof window.toast === 'function') {
                    window.toast('No se pudo abrir la oportunidad.', 'error');
                }
            });
        }
    }

    function wireWidgetClose() {
        var btns = document.querySelectorAll('#marcaWidgetInner [data-mk-close]');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function () { toggleMarcaWidget(false); });
        }
    }
    function wireWidgetActions(marca) {
        var btns = document.querySelectorAll('#marcaWidgetInner [data-mk-action]');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function () {
                var action = this.getAttribute('data-mk-action');
                if (action === 'nueva-opp') {
                    abrirCrearOportunidad(marca);
                    return;
                }
                if (typeof window.toast === 'function') {
                    window.toast('Próximamente: ' + action + ' para ' + (marca.label || 'la marca') + '.', 'info');
                }
            });
        }
    }

    function abrirCrearOportunidad(marca) {
        // Cerramos el widget de marca para evitar layering raro con el
        // overlay de negociación.
        toggleMarcaWidget(false);
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
            // Pre-seleccionar la marca en el select de producto si existe.
            // El select se llama wfProducto en _widget_negociacion.html.
            var selProducto = document.getElementById('wfProducto');
            if (selProducto && marca && marca.key) {
                // marca.key viene como 'ZEBRA' / 'POLIZA' / etc. Probamos
                // tal cual primero, y como fallback con casing original
                // de PRODUCTO_CHOICES (PÓLIZA con tilde).
                var key = marca.key;
                var match = Array.prototype.find.call(selProducto.options, function (opt) {
                    return opt.value === key || opt.value.toUpperCase() === key;
                });
                if (match) selProducto.value = match.value;
            }
            // Focus en el primer campo libre.
            var firstFocus = document.getElementById('wfOportunidad');
            if (firstFocus && typeof firstFocus.focus === 'function') firstFocus.focus();
        }, 60);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ACTIVAR / DESACTIVAR + WIRING
    // ─────────────────────────────────────────────────────────────────────

    function activar() {
        _activo = true;
        try { if (typeof window._crmSetMode === 'function') window._crmSetMode('__marcas__'); } catch (e) {}
        IDS_OTROS_KPI.forEach(hide);

        var btn = document.getElementById('crmModeMarcas');
        if (btn) btn.classList.add('active');
        var section = document.getElementById('ckMarcasSection');
        if (section) section.style.display = 'block';

        if (document.body) document.body.classList.add('crm-marcas-active');

        try { localStorage.setItem('crm_clientes_mode', 'marcas'); } catch (e) {}
        fetchMarcas();
    }

    function desactivar() {
        _activo = false;
        var btn = document.getElementById('crmModeMarcas');
        if (btn) btn.classList.remove('active');
        var section = document.getElementById('ckMarcasSection');
        if (section) section.style.display = 'none';
        if (document.body) document.body.classList.remove('crm-marcas-active');
        toggleMarcaWidget(false);
    }

    function instalarGuard() {
        var orig = window._crmSetMode;
        if (typeof orig !== 'function') return false;
        if (orig._marcasPatched) return true;
        // Si ya está patcheado por control, vamos a wrappear el actual.
        var patched = function (mode) {
            if (_activo && mode !== '__marcas__' && mode !== 'marcas') return;
            return orig.apply(this, arguments);
        };
        patched._marcasPatched = true;
        patched._original = orig;
        window._crmSetMode = patched;
        return true;
    }

    function wireControls() {
        var search = document.getElementById('mkSearch');
        if (search) {
            search.addEventListener('input', function (e) {
                _query = e.target.value || '';
                var clear = document.getElementById('mkSearchClear');
                if (clear) clear.hidden = !_query;
                renderAll();
            });
        }
        var clear = document.getElementById('mkSearchClear');
        if (clear) clear.addEventListener('click', function () {
            _query = '';
            if (search) { search.value = ''; }
            clear.hidden = true;
            renderAll();
        });

        var seg = document.getElementById('mkSegView');
        if (seg) {
            var segBtns = seg.querySelectorAll('.marcas-seg');
            for (var i = 0; i < segBtns.length; i++) {
                segBtns[i].addEventListener('click', function () {
                    var v = this.getAttribute('data-view');
                    _view = v;
                    for (var j = 0; j < segBtns.length; j++) {
                        segBtns[j].classList.toggle('is-on', segBtns[j].getAttribute('data-view') === v);
                    }
                    var vt = document.getElementById('mkViewTabla');
                    var vl = document.getElementById('mkViewTimeline');
                    if (vt) vt.hidden = v !== 'tabla';
                    if (vl) vl.hidden = v !== 'timeline';
                    if (v === 'timeline') renderTimeline();
                    actualizarVisibilidadFiltro();
                    actualizarFilterCount();
                });
            }
        }

        // Botones Filtro y Ordenar — usan popovers estilo CRM
        var btnFilter = document.getElementById('mkBtnFilter');
        if (btnFilter) {
            btnFilter.addEventListener('click', function (e) {
                e.stopPropagation();
                togglePopover('mkPopFilter', btnFilter, renderFilterFieldsPopover);
            });
        }
        var btnSort = document.getElementById('mkBtnSort');
        if (btnSort) {
            btnSort.addEventListener('click', function (e) {
                e.stopPropagation();
                togglePopover('mkPopSort', btnSort, renderSortPopover);
            });
        }

        // "+ Nueva marca" — abre el editor en modo create. El backend
        // valida que solo supervisores puedan crear (devuelve 403 si no).
        var btnAdd = document.getElementById('mkBtnAddMarca');
        if (btnAdd) {
            btnAdd.addEventListener('click', function (e) {
                e.preventDefault();
                if (window._crmMarcaEditor && window._crmMarcaEditor.open) {
                    window._crmMarcaEditor.open({ mode: 'create' });
                } else if (typeof window.toast === 'function') {
                    window.toast('Editor de marcas no disponible.', 'error');
                }
            });
        }

        var btnReset = document.getElementById('mkBtnReset');
        if (btnReset) {
            btnReset.addEventListener('click', function () {
                _query = ''; if (search) search.value = '';
                _filters = { quarter: 'all', prob: 'all', mes: 'all', marca: 'all' };
                _sortKey = 'default';
                renderAll();
            });
        }

        // Cerrar popovers al click fuera o ESC.
        document.addEventListener('click', function (e) {
            if (e.target.closest('.crm-popover')) return;
            if (e.target.closest('#mkBtnFilter') || e.target.closest('#mkBtnSort')) return;
            closeAllMkPopovers();
        });

        // Overlay click cierra widget
        var overlay = document.getElementById('marcaWidgetOverlay');
        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) toggleMarcaWidget(false);
            });
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var ov = document.getElementById('marcaWidgetOverlay');
                if (ov && ov.classList.contains('is-open')) toggleMarcaWidget(false);
            }
        });
    }

    function init() {
        var btn = document.getElementById('crmModeMarcas');
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

        if (_initialMode === 'marcas') {
            setTimeout(activar, 50);
            setTimeout(function () { if (!_activo) activar(); }, 800);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window._crmMarcas = {
        open: activar,
        close: desactivar,
        refresh: fetchMarcas,
        openDetalle: openMarcaDetalle
    };
})();
