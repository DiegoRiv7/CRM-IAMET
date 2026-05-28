/* ═══════════════════════════════════════════════════════════════════
 * reportes_oportunidades_abiertas.js
 * Reporte 1: Oportunidades Abiertas — render del cliente.
 *
 * Rediseño "hablante" (2026-05-28):
 *   - Botón Ordenar (dropdown, patrón Proyectos) con 11 opciones.
 *   - Chips quick-filter (alta-prob, estancadas, vencidas, cierre-mes).
 *   - Header narrativo dinámico ("Tienes N opps por $X que cierran este mes…").
 *   - Barra de progreso vs meta del mes (UserProfile.meta_mensual).
 *   - KPIs reorganizados: Pipeline · Cierran este mes · Necesitan atención · Monto ponderado.
 *   - Resaltado por fila (caliente / vencida / estancada).
 *   - Columna "Próximo paso" con días relativos ("vence en 2d" · "vencida hace 5d").
 *   - Paginación client-side de 50.
 *   - Export CSV con bloque de metadatos.
 *
 * Click en fila → openDetalle(id) del CRM (widget inline en la misma página).
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var ENDPOINT = '/app/api/reportes/oportunidades-abiertas/';
    var PAGE_SIZE = 50;

    // Filtros que viajan al endpoint
    var _filtros = {
        pipeline: '',
        vendedor: '',
        etapa: '',
        producto: '',
        monto_min: '',
        q: '',
    };

    // Quick-filter client-side ("plantilla")
    var _plantillaActiva = 'todas';

    // Sort client-side. Default = mayor monto (lo que pidió el dueño).
    // _sortKey reusa las claves de campo; _sortMode permite sorts compuestos
    // que no son simple "campo asc/desc" (ej: vencido_first ordena por flag
    // + monto). Para compatibilidad con el sort de la tabla (click en header)
    // mantenemos _sortKey + _sortDir.
    var _sortKey = 'monto_mxn';
    var _sortDir = 'desc';
    var _sortMode = 'monto_desc';  // clave del dropdown (puede ser compuesto)

    // Paginación
    var _currentPage = 1;

    // Cache
    var _lastData = null;
    var _filtrosUICargados = false;
    var _searchDebounce = null;

    // ─── Util ─────────────────────────────────────────────────────────
    function $(id) { return document.getElementById(id); }

    function escapeHTML(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtShort(n) {
        if (n == null) return '$0';
        if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
        if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
        return '$' + Math.round(n);
    }
    function fmtFull(n) {
        if (n == null) return '$0';
        return '$' + Math.round(n).toLocaleString('en-US');
    }

    function pluralize(n, sing, plur) {
        return n === 1 ? sing : plur;
    }

    // ─── Sort definitions ─────────────────────────────────────────────
    // Cada modo retorna un comparator. Algunos son compuestos (vencido_first
    // pone vencidas arriba, luego ordena por monto).
    var SORT_MODES = {
        monto_desc:    { label: 'Mayor monto',                  cmp: function (a, b) { return (b.monto_mxn || 0) - (a.monto_mxn || 0); } },
        monto_asc:     { label: 'Menor monto',                  cmp: function (a, b) { return (a.monto_mxn || 0) - (b.monto_mxn || 0); } },
        prob_desc:     { label: 'Mayor probabilidad',           cmp: function (a, b) { return (b.probabilidad || 0) - (a.probabilidad || 0) || (b.monto_mxn || 0) - (a.monto_mxn || 0); } },
        prob_asc:      { label: 'Menor probabilidad',           cmp: function (a, b) { return (a.probabilidad || 0) - (b.probabilidad || 0) || (b.monto_mxn || 0) - (a.monto_mxn || 0); } },
        cierre_asc:    { label: 'Cierre más próximo',           cmp: function (a, b) { return (a.fecha_cierre_sort || 1e9) - (b.fecha_cierre_sort || 1e9) || (b.monto_mxn || 0) - (a.monto_mxn || 0); } },
        cierre_desc:   { label: 'Cierre más lejano',            cmp: function (a, b) {
            var av = a.fecha_cierre_sort, bv = b.fecha_cierre_sort;
            // "Sin fecha" (1e9) al FINAL en este orden — son menos útiles.
            var aNo = !av || av === 1e9, bNo = !bv || bv === 1e9;
            if (aNo && !bNo) return 1;
            if (!aNo && bNo) return -1;
            return (bv || 0) - (av || 0) || (b.monto_mxn || 0) - (a.monto_mxn || 0);
        } },
        dias_desc:     { label: 'Más días abierta',             cmp: function (a, b) { return (b.dias_abierto || 0) - (a.dias_abierto || 0); } },
        dias_asc:      { label: 'Menos días abierta',           cmp: function (a, b) { return (a.dias_abierto || 0) - (b.dias_abierto || 0); } },
        vencido_first: { label: 'Próximo paso vencido primero', cmp: function (a, b) {
            var av = a.proximo_vencido ? 1 : 0;
            var bv = b.proximo_vencido ? 1 : 0;
            if (av !== bv) return bv - av;  // vencidas primero
            // luego: las que tienen próximo paso (vs sin próximo paso)
            var apx = a.proximo_paso ? 1 : 0;
            var bpx = b.proximo_paso ? 1 : 0;
            if (apx !== bpx) return bpx - apx;
            return (b.monto_mxn || 0) - (a.monto_mxn || 0);
        } },
        cliente_asc:   { label: 'Cliente (A-Z)',                cmp: function (a, b) { return String(a.cliente || '').localeCompare(String(b.cliente || ''), 'es'); } },
        vendedor_asc:  { label: 'Vendedor (A-Z)',               cmp: function (a, b) { return String(a.vendedor || '').localeCompare(String(b.vendedor || ''), 'es'); } },
    };

    // Click en header de tabla: convierte key + dir → sort mode.
    // Sólo columnas con interpretación binaria asc/desc están aquí; el resto
    // (cliente, vendedor, etapa, próximo paso) se ordena vía dropdown.
    var COL_SORT_MODE = {
        'monto_mxn':    { desc: 'monto_desc',  asc: 'monto_asc'  },
        'probabilidad': { desc: 'prob_desc',   asc: 'prob_asc'   },
        'fecha_cierre': { desc: 'cierre_desc', asc: 'cierre_asc' },
        'dias_abierto': { desc: 'dias_desc',   asc: 'dias_asc'   },
    };

    function ordenar(opps) {
        var mode = SORT_MODES[_sortMode] || SORT_MODES.monto_desc;
        return opps.slice().sort(mode.cmp);
    }

    function aplicarPlantilla(opps) {
        switch (_plantillaActiva) {
            case 'alta-prob':     return opps.filter(function (o) { return o.probabilidad >= 70; });
            case 'sin-actividad': return opps.filter(function (o) { return !o.proximo_paso; });
            case 'vencidas':      return opps.filter(function (o) { return o.proximo_vencido; });
            case 'estancadas':    return opps.filter(function (o) { return o.dias_abierto > 45; });
            case 'cierre-mes':    return opps.filter(function (o) { return o.cierra_este_mes; });
            default: return opps;
        }
    }

    // ─── KPIs ─────────────────────────────────────────────────────────
    // Versión "hablante": 4 cards orientadas a CIERRE DEL MES.
    function renderKpis(kpis) {
        var necesitanAcento = kpis.necesita_atencion_count > 0 ? '#DC2626' : '#0052D4';
        var cards = [
            {
                label: 'Pipeline Total',
                value: fmtShort(kpis.pipeline_total_mxn),
                sub: kpis.total + ' ' + pluralize(kpis.total, 'oportunidad abierta', 'oportunidades abiertas'),
                accent: '#0052D4',
            },
            {
                label: 'Cierran este mes',
                value: String(kpis.cerrara_este_mes_count || 0),
                sub: fmtShort(kpis.cerrara_este_mes_monto_mxn) + ' · ' + (kpis.mes_actual_label || ''),
                accent: '#34C759',
                cta: kpis.cerrara_este_mes_count > 0 ? 'cierre-mes' : null,
            },
            {
                label: 'Necesitan atención',
                value: String(kpis.necesita_atencion_count || 0),
                sub: kpis.vencidas_count + ' ' + pluralize(kpis.vencidas_count, 'vencida', 'vencidas')
                     + ' · ' + kpis.estancadas_count + ' ' + pluralize(kpis.estancadas_count, 'estancada', 'estancadas'),
                accent: necesitanAcento,
                cta: kpis.necesita_atencion_count > 0 ? 'vencidas' : null,
            },
            {
                label: 'Monto Ponderado',
                value: fmtShort(kpis.monto_ponderado_mxn),
                sub: 'ajustado por probabilidad (' + (kpis.prob_promedio || 0) + '% prom.)',
                accent: '#6FB1FC',
            },
        ];
        $('repKpis').innerHTML = cards.map(function (c) {
            var cta = c.cta ? ' data-cta="' + escapeHTML(c.cta) + '" role="button" tabindex="0"' : '';
            var ctaCls = c.cta ? ' rep-kpi-cta' : '';
            return '<div class="rep-kpi' + ctaCls + '" style="border-left-color:' + c.accent + ';"' + cta + '>'
                + '<div class="rep-kpi-label">' + escapeHTML(c.label) + '</div>'
                + '<div class="rep-kpi-value" style="color:' + (c.accent === '#DC2626' ? '#DC2626' : '#1D1D1F') + ';">' + escapeHTML(c.value) + '</div>'
                + '<div class="rep-kpi-sub">' + escapeHTML(c.sub) + '</div>'
                + '</div>';
        }).join('');

        // KPIs clickeables → activan la plantilla correspondiente.
        $('repKpis').querySelectorAll('.rep-kpi-cta').forEach(function (k) {
            k.addEventListener('click', function () {
                var plantilla = k.getAttribute('data-cta');
                if (plantilla) activarPlantilla(plantilla);
            });
            k.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    var plantilla = k.getAttribute('data-cta');
                    if (plantilla) activarPlantilla(plantilla);
                }
            });
        });
    }

    // ─── Renderers de celdas ──────────────────────────────────────────
    var ETAPA_PALETTE = {
        'vendido':    ['#EBF5FF', '#1D4ED8'],
        'tránsito':   ['#FFF3E0', '#B45309'],
        'transito':   ['#FFF3E0', '#B45309'],
        'facturado':  ['#E0F2FE', '#0369A1'],
        'programado': ['#EDE9FE', '#6D28D9'],
        'entregado':  ['#DCFCE7', '#15803D'],
        'esperando':  ['#FEF3C7', '#92400E'],
        'reportes':   ['#F1F5F9', '#475569'],
        'cotiz':      ['#F1F5F9', '#475569'],
        'comprando':  ['#FFE4E6', '#9F1239'],
        'ejecutando': ['#EDE9FE', '#6D28D9'],
    };

    function etapaPill(etapa) {
        var key = (etapa || '').toLowerCase();
        var pair = null;
        for (var k in ETAPA_PALETTE) {
            if (key.indexOf(k) !== -1) { pair = ETAPA_PALETTE[k]; break; }
        }
        if (!pair) pair = ['#F1F5F9', '#475569'];
        return '<span class="rep-etapa-pill" style="background:' + pair[0] + ';color:' + pair[1] + ';">' + escapeHTML(etapa) + '</span>';
    }

    function probBar(v) {
        var col = v >= 70 ? '#15803D' : v >= 40 ? '#B45309' : '#DC2626';
        return '<div class="rep-prob-wrap">'
            + '<div class="rep-prob-track"><div class="rep-prob-fill" style="width:' + Math.max(0, Math.min(100, v)) + '%;background:' + col + ';"></div></div>'
            + '<span class="rep-prob-num" style="color:' + col + ';">' + v + '%</span>'
            + '</div>';
    }

    function daysBadge(v) {
        var col, bg;
        if (v > 45) { col = '#991B1B'; bg = '#FEE2E2'; }
        else if (v > 30) { col = '#92400E'; bg = '#FEF3C7'; }
        else { col = '#15803D'; bg = '#DCFCE7'; }
        return '<span class="rep-days-badge" style="background:' + bg + ';color:' + col + ';">' + v + 'd</span>';
    }

    var MARCA_COLORS = {
        AVIGILON: '#0052D4', PANDUIT: '#4364F7', APC: '#6FB1FC',
        GENETEC: '#34C759', ZEBRA: '#FF9500', AXIS: '#5856D6',
        PALOALTO: '#EC4899', MERAKI: '#10B981',
    };

    function productoChip(producto) {
        if (!producto) return '<span class="rep-muted">—</span>';
        var col = MARCA_COLORS[producto.toUpperCase()] || '#94A3B8';
        return '<span class="rep-producto-chip"><span class="rep-producto-dot" style="background:' + col + ';"></span>' + escapeHTML(producto) + '</span>';
    }

    function fechaRelativaCorta(dias) {
        if (dias === null || dias === undefined) return '';
        if (dias === 0) return 'hoy';
        if (dias === 1) return 'mañana';
        if (dias === -1) return 'ayer';
        if (dias > 0) return 'en ' + dias + 'd';
        return 'hace ' + Math.abs(dias) + 'd';
    }

    function proximoPaso(p) {
        if (!p) return '<span class="rep-muted">—</span>';
        var rel = fechaRelativaCorta(p.dias_rel);
        if (p.vencida) {
            return '<span class="rep-overdue-pill">'
                + escapeHTML(p.titulo)
                + (rel ? '<span class="rep-overdue-rel">· ' + escapeHTML(rel) + '</span>' : '')
                + '</span>';
        }
        var ic = p.tipo === 'tarea'
            ? '<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h9"/></svg>'
            : '<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
        // Si vence en <= 3 días, marca como "urgente" (sutil).
        var urgente = (p.dias_rel !== null && p.dias_rel !== undefined && p.dias_rel <= 3);
        return '<span class="rep-next-step' + (urgente ? ' rep-next-urgent' : '') + '">'
            + ic + ' ' + escapeHTML(p.titulo)
            + (rel ? '<span class="rep-next-date">· ' + escapeHTML(rel) + '</span>' : '')
            + '</span>';
    }

    // Devuelve la "accent class" para la fila (caliente / vencida / estancada).
    // Solo UNA accent por fila — prioridad: vencida > caliente > estancada.
    function rowAccent(o) {
        if (o.proximo_vencido) return 'rep-row-warn';
        if (o.caliente) return 'rep-row-hot';
        if (o.estancada && o.probabilidad < 40) return 'rep-row-cold';
        return '';
    }

    // ─── Tabla + paginación ───────────────────────────────────────────
    var COLS = [
        { k: 'titulo',         l: 'Oportunidad',   right: false, sortable: false },
        { k: 'etapa',          l: 'Etapa',         right: false, sortable: false },
        { k: 'monto_mxn',      l: 'Monto',         right: true,  sortable: true  },
        { k: 'probabilidad',   l: 'Prob.',         right: true,  sortable: true  },
        { k: 'fecha_cierre',   l: 'Cierre est.',   right: false, sortable: true  },
        { k: 'proximo_paso',   l: 'Próximo paso',  right: false, sortable: false },
        { k: 'vendedor',       l: 'Vendedor',      right: false, sortable: false },
        { k: 'dias_abierto',   l: 'Días abto.',    right: true,  sortable: true  },
    ];

    function renderTabla() {
        if (!_lastData) return;
        var wrap = $('repTableWrap');
        var allFiltradas = ordenar(aplicarPlantilla(_lastData.oportunidades || []));
        if (!allFiltradas.length) {
            wrap.innerHTML = '<div class="rep-empty">'
                + '<svg width="32" height="32" fill="none" stroke="#CBD5E1" stroke-width="1.6" viewBox="0 0 24 24" style="margin-bottom:8px;"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>'
                + '<h3>Sin resultados</h3><p>No hay oportunidades con los filtros actuales.</p>'
                + '</div>';
            return;
        }

        var totalFiltrado = allFiltradas.length;
        var totalMontoFiltrado = allFiltradas.reduce(function (s, o) { return s + (o.monto_mxn || 0); }, 0);

        // Paginación
        var totalPages = Math.max(1, Math.ceil(totalFiltrado / PAGE_SIZE));
        if (_currentPage > totalPages) _currentPage = totalPages;
        if (_currentPage < 1) _currentPage = 1;
        var ini = (_currentPage - 1) * PAGE_SIZE;
        var fin = Math.min(ini + PAGE_SIZE, totalFiltrado);
        var pagina = allFiltradas.slice(ini, fin);

        var html = '<div class="rep-table-scroll"><table class="rep-table"><thead><tr>';
        COLS.forEach(function (c) {
            var arrow = '';
            if (c.sortable && c.k === _sortKey) arrow = _sortDir === 'desc' ? ' ↓' : ' ↑';
            var th = '<th class="' + (c.right ? 'rep-text-right' : '') + (c.sortable ? '' : ' rep-th-nosort') + '"';
            if (c.sortable) th += ' data-sort-key="' + c.k + '"';
            th += '>' + escapeHTML(c.l) + '<span class="rep-sort-arrow">' + arrow + '</span></th>';
            html += th;
        });
        html += '</tr></thead><tbody>';
        pagina.forEach(function (o) {
            var accent = rowAccent(o);
            html += '<tr class="' + accent + '" data-opp-id="' + o.id + '">'
                + '<td><div class="rep-td-title">' + escapeHTML(o.titulo || '(sin título)') + '</div>'
                +     '<div class="rep-td-sub">' + escapeHTML(o.cliente || '—') + '</div></td>'
                + '<td>' + etapaPill(o.etapa) + '</td>'
                + '<td class="rep-text-right rep-mono"><strong class="rep-monto">' + fmtFull(o.monto_mxn) + '</strong></td>'
                + '<td class="rep-text-right">' + probBar(o.probabilidad) + '</td>'
                + '<td class="rep-mono rep-fecha">'
                +   escapeHTML(o.fecha_cierre || '—')
                +   (o.cierra_este_mes ? '<span class="rep-cierre-tag" title="Cierra este mes">· este mes</span>' : '')
                + '</td>'
                + '<td>' + proximoPaso(o.proximo_paso) + '</td>'
                + '<td class="rep-vendedor">' + escapeHTML(o.vendedor || '—') + '</td>'
                + '<td class="rep-text-right">' + daysBadge(o.dias_abierto) + '</td>'
                + '</tr>';
        });
        html += '</tbody></table></div>';

        // Footer: paginación + totales globales (no de la página).
        var pagHtml = '';
        if (totalPages > 1) {
            pagHtml = '<div class="rep-pag">'
                + '<button type="button" class="rep-pag-btn" id="repPagPrev" ' + (_currentPage <= 1 ? 'disabled' : '') + '>← Anterior</button>'
                + '<span class="rep-pag-info">'
                +   'Página <strong>' + _currentPage + '</strong> de <strong>' + totalPages + '</strong>'
                +   '<span class="rep-pag-sep"> · </span>'
                +   (ini + 1) + '–' + fin + ' de ' + totalFiltrado
                + '</span>'
                + '<button type="button" class="rep-pag-btn" id="repPagNext" ' + (_currentPage >= totalPages ? 'disabled' : '') + '>Siguiente →</button>'
                + '</div>';
        }
        html += '<footer class="rep-table-foot">'
            + '<span class="rep-table-foot-left">'
            +   totalFiltrado + ' ' + pluralize(totalFiltrado, 'registro', 'registros')
            +   (_plantillaActiva !== 'todas' ? ' <span class="rep-table-foot-flt">(filtro: ' + escapeHTML(_plantillaActiva) + ')</span>' : '')
            + '</span>'
            + pagHtml
            + '<span class="rep-table-foot-right">Total: <strong>' + fmtFull(totalMontoFiltrado) + '</strong></span>'
            + '</footer>';
        wrap.innerHTML = html;

        // Click en fila → abre opp inline (widget del CRM en la misma página).
        wrap.querySelectorAll('tr[data-opp-id]').forEach(function (tr) {
            tr.addEventListener('click', function () {
                var id = tr.getAttribute('data-opp-id');
                if (!id) return;
                if (typeof window.openDetalle === 'function') {
                    window.openDetalle(parseInt(id, 10));
                } else {
                    window.location.href = '/app/todos/?tab=crm&open_opp=' + id;
                }
            });
        });

        // Sort por click en header
        wrap.querySelectorAll('th[data-sort-key]').forEach(function (th) {
            th.addEventListener('click', function () {
                var k = th.getAttribute('data-sort-key');
                if (!COL_SORT_MODE[k]) return;
                // Toggle dir si misma key, sino default desc
                if (_sortKey === k) _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
                else { _sortKey = k; _sortDir = 'desc'; }
                _sortMode = COL_SORT_MODE[k][_sortDir] || COL_SORT_MODE[k].desc;
                actualizarSortLabel();
                _currentPage = 1;
                renderTabla();
            });
        });

        // Paginación
        var pp = $('repPagPrev'), pn = $('repPagNext');
        if (pp) pp.addEventListener('click', function () {
            if (_currentPage > 1) { _currentPage--; renderTabla(); scrollToTable(); }
        });
        if (pn) pn.addEventListener('click', function () {
            if (_currentPage < totalPages) { _currentPage++; renderTabla(); scrollToTable(); }
        });
    }

    function scrollToTable() {
        var w = $('repTableWrap');
        if (w && w.scrollIntoView) w.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ─── Ordenar dropdown ─────────────────────────────────────────────
    function actualizarSortLabel() {
        var mode = SORT_MODES[_sortMode] || SORT_MODES.monto_desc;
        var lbl = $('repSortLabel');
        if (lbl) lbl.textContent = mode.label;
        // Pinta is-active en el ítem del menu
        document.querySelectorAll('.rep-sort-item').forEach(function (it) {
            it.classList.toggle('is-active', it.getAttribute('data-sort') === _sortMode);
        });
        // Botón activo si NO es el default
        var btn = $('repSortBtn');
        if (btn) btn.classList.toggle('is-active', _sortMode !== 'monto_desc');
    }

    function toggleSortMenu(force) {
        var m = $('repSortMenu');
        var btn = $('repSortBtn');
        if (!m || !btn) return;
        var open = (typeof force === 'boolean') ? force : m.hidden;
        m.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function pickSort(mode) {
        if (!SORT_MODES[mode]) return;
        _sortMode = mode;
        // Sincroniza _sortKey/_sortDir para que las flechas del header
        // queden coherentes con el modo elegido.
        var KEY_BY_MODE = {
            monto_desc: ['monto_mxn', 'desc'],
            monto_asc: ['monto_mxn', 'asc'],
            prob_desc: ['probabilidad', 'desc'],
            prob_asc: ['probabilidad', 'asc'],
            cierre_asc: ['fecha_cierre', 'asc'],
            cierre_desc: ['fecha_cierre', 'desc'],
            dias_desc: ['dias_abierto', 'desc'],
            dias_asc: ['dias_abierto', 'asc'],
            vencido_first: ['', ''],
            cliente_asc: ['titulo', 'asc'],
            vendedor_asc: ['vendedor', 'asc'],
        };
        var pair = KEY_BY_MODE[mode] || ['', ''];
        _sortKey = pair[0];
        _sortDir = pair[1];
        actualizarSortLabel();
        toggleSortMenu(false);
        _currentPage = 1;
        renderTabla();
    }

    // Activa plantilla (Vista rápida) y sincroniza:
    //   - los chips del drawer (rep-fg-chip)
    //   - resetea paginación a 1
    //   - re-render tabla
    //   - actualiza el dot del botón Filtros (porque plantilla ≠ 'todas' cuenta como filtro)
    function activarPlantilla(plantilla) {
        _plantillaActiva = plantilla || 'todas';
        document.querySelectorAll('#repFltPlantilla .rep-fg-chip').forEach(function (b) {
            var on = b.getAttribute('data-plantilla') === _plantillaActiva;
            b.classList.toggle('rep-fg-chip-active', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        _currentPage = 1;
        actualizarFilterDot();
        renderTabla();
    }

    // ─── Endpoint + filtros UI ────────────────────────────────────────
    function getQS() {
        var p = new URLSearchParams();
        Object.keys(_filtros).forEach(function (k) {
            if (_filtros[k]) p.set(k, _filtros[k]);
        });
        return p.toString();
    }

    function cargarFiltrosUI(filtrosDisp) {
        if (_filtrosUICargados) return;
        _filtrosUICargados = true;
        (filtrosDisp.vendedores || []).forEach(function (v) {
            var o = document.createElement('option');
            o.value = v.id; o.textContent = v.nombre;
            $('repFltVendedor').appendChild(o);
        });
        var em = filtrosDisp.etapas_por_pipeline || {};
        Object.keys(em).forEach(function (pl) {
            var og = document.createElement('optgroup');
            og.label = pl.charAt(0).toUpperCase() + pl.slice(1);
            em[pl].forEach(function (e) {
                var o = document.createElement('option');
                o.value = e; o.textContent = e;
                og.appendChild(o);
            });
            $('repFltEtapa').appendChild(og);
        });
        (filtrosDisp.productos || []).forEach(function (m) {
            var o = document.createElement('option');
            o.value = m; o.textContent = m;
            $('repFltMarca').appendChild(o);
        });
    }

    function actualizarFilterDot() {
        var hasFilter = Object.keys(_filtros).some(function (k) { return _filtros[k]; })
                     || (_plantillaActiva && _plantillaActiva !== 'todas');
        $('repFilterDot').style.display = hasFilter ? 'inline-block' : 'none';
    }

    function load() {
        var wrap = $('repTableWrap');
        wrap.innerHTML = '<div class="rep-loading">Cargando reporte…</div>';
        var qs = getQS();
        fetch(ENDPOINT + (qs ? '?' + qs : ''), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.ok) {
                    wrap.innerHTML = '<div class="rep-empty"><h3>Error</h3><p>' + escapeHTML(data.error || 'No se pudo cargar') + '</p></div>';
                    return;
                }
                _lastData = data;
                _currentPage = 1;
                cargarFiltrosUI(data.filtros_disponibles || {});
                actualizarFilterDot();
                renderKpis(data.kpis || {});
                renderTabla();
            })
            .catch(function (err) {
                wrap.innerHTML = '<div class="rep-empty"><h3>Error de conexión</h3><p>' + escapeHTML(String(err)) + '</p></div>';
            });
    }

    // ─── Drawer ───────────────────────────────────────────────────────
    function openDrawer() {
        $('repDrawer').classList.add('open');
        $('repDrawer').setAttribute('aria-hidden', 'false');
        $('repDrawerOverlay').classList.add('open');
        $('repFltPipeline').value = _filtros.pipeline || '';
        $('repFltVendedor').value = _filtros.vendedor || '';
        $('repFltEtapa').value = _filtros.etapa || '';
        $('repFltMarca').value = _filtros.producto || '';
        $('repFltMontoMin').value = _filtros.monto_min || '';
    }
    function closeDrawer() {
        $('repDrawer').classList.remove('open');
        $('repDrawer').setAttribute('aria-hidden', 'true');
        $('repDrawerOverlay').classList.remove('open');
    }
    function applyDrawer() {
        _filtros.pipeline = $('repFltPipeline').value || '';
        _filtros.vendedor = $('repFltVendedor').value || '';
        _filtros.etapa = $('repFltEtapa').value || '';
        _filtros.producto = $('repFltMarca').value || '';
        _filtros.monto_min = $('repFltMontoMin').value || '';
        closeDrawer();
        load();
    }
    function clearDrawer() {
        $('repFltPipeline').value = '';
        $('repFltVendedor').value = '';
        $('repFltEtapa').value = '';
        $('repFltMarca').value = '';
        $('repFltMontoMin').value = '';
        activarPlantilla('todas');
    }

    // ─── Export CSV con bloque de metadatos ───────────────────────────
    function nowLocal() {
        var d = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
            + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    function vendedorLabel(id) {
        if (!id || !_lastData || !_lastData.filtros_disponibles) return id;
        var v = (_lastData.filtros_disponibles.vendedores || []).filter(function (x) { return String(x.id) === String(id); })[0];
        return v ? v.nombre : id;
    }

    function csvEscape(cell) {
        var s = String(cell == null ? '' : cell);
        if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
            s = '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    function exportarCSV() {
        if (!_lastData) return;
        var ops = ordenar(aplicarPlantilla(_lastData.oportunidades || []));
        if (!ops.length) { alert('No hay datos para exportar.'); return; }

        // Bloque de metadatos
        var sortLabel = (SORT_MODES[_sortMode] || SORT_MODES.monto_desc).label;
        var totalMonto = ops.reduce(function (s, o) { return s + (o.monto_mxn || 0); }, 0);
        var metaLines = [
            '# Reporte: Oportunidades Abiertas (Vendido en adelante, sin cerrar)',
            '# Exportado por: ' + (window._REP_USER || '—'),
            '# Fecha y hora de exportación: ' + nowLocal(),
            '# Filtros aplicados:',
            '#   - Pipeline: ' + (_filtros.pipeline || 'Ambos'),
            '#   - Vendedor: ' + (_filtros.vendedor ? vendedorLabel(_filtros.vendedor) : 'Todos los visibles'),
            '#   - Etapa: ' + (_filtros.etapa || 'Todas (Vendido en adelante)'),
            '#   - Proveedor: ' + (_filtros.producto || 'Todos'),
            '#   - Monto mínimo: ' + (_filtros.monto_min ? '$' + Number(_filtros.monto_min).toLocaleString('en-US') : 'sin mínimo'),
            '#   - Búsqueda: ' + (_filtros.q || '—'),
            '#   - Plantilla (filtro rápido): ' + _plantillaActiva,
            '#   - Orden: ' + sortLabel,
            '# Total registros exportados: ' + ops.length,
            '# Total monto MXN: $' + Math.round(totalMonto).toLocaleString('en-US'),
            '',
        ];

        var headers = ['Oportunidad', 'Cliente', 'Pipeline', 'Etapa', 'Monto MXN', 'Probabilidad', 'Cierre estimado', 'Cierra este mes', 'Proveedor', 'Vendedor', 'Días abiertos', 'PO', 'Archivos OCC', 'Próximo paso', 'Próximo paso vencido'];
        var rows = ops.map(function (o) {
            var prox = o.proximo_paso ? ((o.proximo_paso.tipo || '') + ': ' + (o.proximo_paso.titulo || '')) : '';
            return [
                o.titulo || '', o.cliente || '', o.pipeline_label || '', o.etapa || '',
                o.monto_mxn || 0, (o.probabilidad || 0) + '%', o.fecha_cierre || '',
                o.cierra_este_mes ? 'sí' : 'no',
                o.producto || '', o.vendedor || '', o.dias_abierto || 0,
                o.po_number || '', (o.archivos_occ || []).join('; '), prox,
                o.proximo_vencido ? 'sí' : 'no',
            ];
        });
        var csv = metaLines.join('\n') + '\n'
            + [headers].concat(rows).map(function (row) {
                return row.map(csvEscape).join(',');
            }).join('\n');

        var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'Reporte_Oportunidades_Abiertas_' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    // ─── Wire up ──────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        if (!$('repKpis')) return;

        // Búsqueda
        $('repSearch').addEventListener('input', function (e) {
            clearTimeout(_searchDebounce);
            _searchDebounce = setTimeout(function () {
                _filtros.q = e.target.value.trim();
                load();
            }, 280);
        });

        // Chips de Vista rápida (dentro del drawer de Filtros)
        document.querySelectorAll('#repFltPlantilla .rep-fg-chip').forEach(function (btn) {
            btn.addEventListener('click', function () {
                activarPlantilla(btn.getAttribute('data-plantilla') || 'todas');
            });
        });

        // Botón Ordenar (dropdown)
        var sortBtn = $('repSortBtn');
        if (sortBtn) sortBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleSortMenu();
        });
        document.querySelectorAll('.rep-sort-item').forEach(function (it) {
            it.addEventListener('click', function (e) {
                e.stopPropagation();
                pickSort(it.getAttribute('data-sort'));
            });
        });
        // Cerrar dropdown al click fuera
        document.addEventListener('click', function (e) {
            var menu = $('repSortMenu');
            if (!menu || menu.hidden) return;
            var wrap = menu.closest('.rep-sort-wrap');
            if (wrap && !wrap.contains(e.target)) toggleSortMenu(false);
        });

        // Botones del header
        $('repBtnFilter').addEventListener('click', openDrawer);
        $('repBtnExport').addEventListener('click', exportarCSV);

        // Drawer
        $('repDrawerClose').addEventListener('click', closeDrawer);
        $('repDrawerOverlay').addEventListener('click', closeDrawer);
        $('repFltApply').addEventListener('click', applyDrawer);
        $('repFltClear').addEventListener('click', clearDrawer);

        // ESC
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if ($('repDrawer').classList.contains('open')) closeDrawer();
                var m = $('repSortMenu');
                if (m && !m.hidden) toggleSortMenu(false);
            }
        });

        actualizarSortLabel();
        load();
    });
})();
