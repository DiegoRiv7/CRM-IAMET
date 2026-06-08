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
    var _filtersOpen = false;
    var _sortDesc = true;
    var _filters = { quarter: 'all', prob: 'all', mes: 'all' };

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
        setT('mkKpiMeta', '—'); setT('mkKpiAvancePct', '—'); setT('mkKpiGap', '');
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
        actualizarFilterCount();
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
            t.meta += Number(base[i].meta || 0);
        }
        var gap = t.facturado - t.meta;
        var avance = t.meta ? (t.facturado / t.meta) : 0;

        var setT = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
        setT('mkKpiFact', fmtMoney(t.facturado, true));
        setT('mkKpiOpps', fmtMoney(t.pipeline, true));
        setT('mkKpiCot',  String(t.cotizaciones));
        setT('mkKpiCam',  String(t.campanias));
        setT('mkKpiMeta', t.meta ? fmtMoney(t.meta, true) : 'Sin meta');
        setT('mkKpiAvancePct', t.meta ? (Math.round(avance * 100) + '%') : '—');

        var gapEl = document.getElementById('mkKpiGap');
        if (gapEl) {
            if (!t.meta) {
                gapEl.textContent = '';
                gapEl.className = 'marcas-kpi-meta-gap neutral';
            } else {
                gapEl.textContent = (gap >= 0 ? '+' : '−') + fmtMoney(Math.abs(gap), true);
                gapEl.className = 'marcas-kpi-meta-gap ' + (gap >= 0 ? 'pos' : 'neg');
            }
        }

        // Ring: dashoffset según avance (circunferencia ≈ 163.36)
        var ring = document.querySelector('#mkKpiRing .marcas-ring-fg');
        if (ring) {
            var c = 2 * Math.PI * 26;
            var off = c * (1 - Math.min(avance, 1));
            ring.style.strokeDasharray = c;
            ring.style.strokeDashoffset = off;
        }
    }

    function renderTabla() {
        var tb = document.getElementById('mkTableBody');
        if (!tb) return;
        var rows = visiblesFiltradas().slice().sort(function (a, b) {
            return _sortDesc ? (b.facturado - a.facturado) : (a.facturado - b.facturado);
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

            html +=
                '<tr class="marcas-drow" data-marca-key="' + escHtml(m.key) + '">' +
                    '<td class="marcas-c-name">' +
                        '<div class="marcas-namecell">' +
                            '<div class="marcas-logo" style="width:38px;height:38px;font-size:13.7px;--mk-h:' + hueOf(m.label) + ';">' + escHtml(initials(m.label)) + '</div>' +
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
                for (var k = 0; k < (mm._ops || []).length; k++) {
                    var op = mm._ops[k];
                    if (!opPasaFiltros(op)) continue;
                    if (!opPasaBusqueda(op, mm)) continue;
                    flat.push({ op: op, marca: mm });
                }
            }
            flat.sort(function (a, b) {
                return _sortDesc ? (b.op.monto - a.op.monto) : (a.op.monto - b.op.monto);
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
        return '' +
            '<div class="marcas-tl-row" data-marca-key="' + escHtml(marca.key) + '">' +
                '<div class="marcas-tl-left">' +
                    '<div class="marcas-tl-op">' +
                        '<div class="marcas-logo" style="width:30px;height:30px;font-size:11px;--mk-h:' + hueOf(marca.label) + ';">' + escHtml(initials(marca.label)) + '</div>' +
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
        } else {
            overlay.classList.remove('is-open');
            overlay.setAttribute('aria-hidden', 'true');
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

        var opsHtml = '';
        if (!ops.length) {
            opsHtml = '<div style="padding:20px 0;text-align:center;color:#86868B;font-size:13px;font-style:italic;">Sin oportunidades para este año.</div>';
        } else {
            for (var i = 0; i < ops.length; i++) {
                var o = ops[i];
                opsHtml +=
                    '<div class="marca-widget-op">' +
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
                '<button class="marca-widget-iconbtn" type="button" aria-label="Más acciones">' +
                    '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>' +
                '</button>' +
            '</div>' +
            '<div class="marca-widget-hero">' +
                '<div class="marcas-logo" style="width:56px;height:56px;font-size:20px;--mk-h:' + hueOf(m.label) + ';">' + escHtml(initials(m.label)) + '</div>' +
                '<div>' +
                    '<h2 class="marca-widget-name">' + escHtml(m.label) + '</h2>' +
                    '<div class="marca-widget-cat">' + escHtml(m.cat) + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="marca-widget-meta">' +
                '<div class="marca-widget-meta-row">' +
                    '<span>Avance a meta</span>' +
                    '<span class="strong">' + (m.meta ? (Math.round(avancePct * 100) + '% · ' + fmtMoney(m.meta, true)) : '—') + '</span>' +
                '</div>' +
                '<div class="marcas-avance-bar lg"><span style="width:' + (avancePct * 100) + '%;"></span></div>' +
                gapHtml +
            '</div>' +
            statsHtml +
            '<div class="marca-widget-sec-h">' +
                '<span>Oportunidades</span>' +
                '<span class="marca-widget-sec-count">' + ops.length + '</span>' +
            '</div>' +
            '<div class="marca-widget-ops">' + opsHtml + '</div>' +
            '<div class="marca-widget-actions">' +
                '<button class="marca-widget-btn marca-widget-btn--primary" type="button" data-mk-action="cotizar">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h7l5 5V20a1 1 0 01-1 1H6a1 1 0 01-1-1V4.5a1 1 0 011-1z"/><path d="M13 3.5V9h5M8.5 13h7M8.5 16.5h7"/></svg>' +
                    'Nueva cotización' +
                '</button>' +
                '<button class="marca-widget-btn marca-widget-btn--ghost" type="button" data-mk-action="campana">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4a1 1 0 001 1h2l6 4V5L7 9H5a1 1 0 00-1 1z"/><path d="M17 8.5a5 5 0 010 7"/></svg>' +
                    'Campaña' +
                '</button>' +
            '</div>';

        wireWidgetClose();
        wireWidgetActions(m);
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
                if (typeof window.toast === 'function') {
                    window.toast('Próximamente: ' + action + ' para ' + (marca.label || 'la marca') + '.', 'info');
                }
            });
        }
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
                    actualizarFilterCount();
                });
            }
        }

        var btnFilter = document.getElementById('mkBtnFilter');
        var fb = document.getElementById('mkFilterbar');
        if (btnFilter && fb) {
            btnFilter.addEventListener('click', function () {
                _filtersOpen = !_filtersOpen;
                fb.hidden = !_filtersOpen;
                btnFilter.classList.toggle('is-on', _filtersOpen);
            });
        }

        var btnSort = document.getElementById('mkBtnSort');
        if (btnSort) {
            btnSort.addEventListener('click', function () {
                _sortDesc = !_sortDesc;
                renderAll();
                if (_view === 'timeline') renderTimeline();
            });
        }

        var btnRefresh = document.getElementById('mkBtnRefresh');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', function () {
                // Invalidar cache de ops para forzar refresh completo.
                for (var i = 0; i < _marcasCache.length; i++) delete _marcasCache[i]._ops;
                fetchMarcas();
            });
        }

        // Chips de filtro (trimestre + prob)
        var chipGroups = document.querySelectorAll('#mkFilterbar [data-filter]');
        for (var k = 0; k < chipGroups.length; k++) {
            (function (group) {
                var name = group.getAttribute('data-filter');
                var btns = group.querySelectorAll('.marcas-chip');
                for (var i = 0; i < btns.length; i++) {
                    btns[i].addEventListener('click', function () {
                        var val = this.getAttribute('data-val');
                        _filters[name] = val;
                        for (var j = 0; j < btns.length; j++) {
                            btns[j].classList.toggle('is-on', btns[j].getAttribute('data-val') === val);
                        }
                        if (_view === 'timeline') renderTimeline();
                        actualizarFilterCount();
                    });
                }
            })(chipGroups[k]);
        }

        var mesSel = document.getElementById('mkFilterMes');
        if (mesSel) {
            mesSel.addEventListener('change', function () {
                _filters.mes = this.value;
                if (_view === 'timeline') renderTimeline();
                actualizarFilterCount();
            });
        }

        var btnClear = document.getElementById('mkBtnClearFilters');
        if (btnClear) {
            btnClear.addEventListener('click', function () {
                _filters = { quarter: 'all', prob: 'all', mes: 'all' };
                var allChips = document.querySelectorAll('#mkFilterbar .marcas-chip');
                for (var i = 0; i < allChips.length; i++) {
                    allChips[i].classList.toggle('is-on', allChips[i].getAttribute('data-val') === 'all');
                }
                if (mesSel) mesSel.value = 'all';
                if (_view === 'timeline') renderTimeline();
                actualizarFilterCount();
            });
        }

        var btnReset = document.getElementById('mkBtnReset');
        if (btnReset) {
            btnReset.addEventListener('click', function () {
                _query = ''; if (search) search.value = '';
                _filters = { quarter: 'all', prob: 'all', mes: 'all' };
                renderAll();
                if (_view === 'timeline') renderTimeline();
            });
        }

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
