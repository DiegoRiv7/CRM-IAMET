/* ═══════════════════════════════════════════════════════════════════
 * reportes_oportunidades_cerradas.js
 * Reporte 2: Oportunidades Cerradas (Ganadas/Pagadas/Perdidas).
 *
 * Estructura alineada al patrón "limpio" del Reporte de Abiertas
 * (2026-05-28):
 *   - Header con SOLO el botón Ordenar (dropdown). Sin chips de
 *     plantilla ni "Configurar reporte" — todo eso vive en el drawer.
 *   - Vista rápida (Todas / Ganadas / Perdidas) dentro del drawer.
 *   - Default sort: Mayor monto.
 *   - Paginación client-side de 50 filas.
 *   - Export CSV con bloque de metadatos (quién, cuándo, filtros, totales).
 *
 * Incluye TODAS las opps cerradas: ganadas, pagadas (mapeadas a "ganada"
 * en el backend), y perdidas — de ambos pipelines (runrate y proyecto).
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var ENDPOINT = '/app/api/reportes/oportunidades-cerradas/';
    var PAGE_SIZE = 50;

    // ── Estado ───────────────────────────────────────────────────────
    // Filtros enviados al endpoint (drawer)
    var _filtros = {
        pipeline: '', vendedor: '', resultado: '', producto: '',
        anio: '', mes: '', monto_min: '', q: '',
    };
    // Plantilla activa = chips de Vista rápida (filtro client-side)
    var _plantillaActiva = 'todas';
    // Modo de orden — clave del SORT_MODES
    var _sortMode = 'monto_desc';
    var _currentPage = 1;
    var _lastData = null;
    var _filtrosUICargados = false;
    var _searchDebounce = null;

    function $(id) { return document.getElementById(id); }

    function escapeHTML(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function pluralize(n, sing, plur) { return n === 1 ? sing : plur; }

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

    // ── Sort modes ───────────────────────────────────────────────────
    // Cada modo tiene una label (para el botón del header) y una función
    // comparator. El frontend pinta las opciones desde el menú estático
    // del HTML (data-sort=KEY); aquí solo definimos las semánticas.
    var SORT_MODES = {
        monto_desc:     { label: 'Mayor monto',          cmp: function (a, b) { return (b.monto_mxn || 0) - (a.monto_mxn || 0); } },
        monto_asc:      { label: 'Menor monto',          cmp: function (a, b) { return (a.monto_mxn || 0) - (b.monto_mxn || 0); } },
        cierre_desc:    { label: 'Cierre más reciente',  cmp: function (a, b) { return _cierreKey(b) - _cierreKey(a); } },
        cierre_asc:     { label: 'Cierre más antiguo',   cmp: function (a, b) { return _cierreKey(a) - _cierreKey(b); } },
        ganadas_first:  { label: 'Ganadas primero',      cmp: function (a, b) {
            var ra = a.resultado === 'ganada' ? 0 : 1;
            var rb = b.resultado === 'ganada' ? 0 : 1;
            if (ra !== rb) return ra - rb;
            return (b.monto_mxn || 0) - (a.monto_mxn || 0);
        } },
        perdidas_first: { label: 'Perdidas primero',     cmp: function (a, b) {
            var ra = a.resultado === 'perdida' ? 0 : 1;
            var rb = b.resultado === 'perdida' ? 0 : 1;
            if (ra !== rb) return ra - rb;
            return (b.monto_mxn || 0) - (a.monto_mxn || 0);
        } },
        cliente_asc:    { label: 'Cliente (A-Z)',        cmp: function (a, b) { return String(a.cliente || '').localeCompare(String(b.cliente || ''), 'es'); } },
        vendedor_asc:   { label: 'Vendedor (A-Z)',       cmp: function (a, b) { return String(a.vendedor || '').localeCompare(String(b.vendedor || ''), 'es'); } },
    };

    // Construye un entero comparable a partir de anio_cierre y mes_cierre.
    // Sin fecha → 0 (queda al final en desc, al inicio en asc).
    function _cierreKey(o) {
        var a = parseInt(o.anio_cierre || 0, 10);
        var m = parseInt(o.mes_cierre || 0, 10);
        if (a >= 1900 && m >= 1 && m <= 12) return a * 100 + m;
        return 0;
    }

    function ordenar(opps) {
        var mode = SORT_MODES[_sortMode] || SORT_MODES.monto_desc;
        return opps.slice().sort(mode.cmp);
    }

    // ── KPIs ─────────────────────────────────────────────────────────
    function renderKpis(kpis) {
        var cards = [
            { label: 'Total Ganado',    value: fmtShort(kpis.monto_ganado_mxn),    sub: kpis.ganadas + ' ' + pluralize(kpis.ganadas, 'ganada', 'ganadas'),    accent: '#15803D' },
            { label: 'Total Perdido',   value: fmtShort(kpis.monto_perdido_mxn),   sub: kpis.perdidas + ' ' + pluralize(kpis.perdidas, 'perdida', 'perdidas'), accent: '#DC2626' },
            { label: '% de Cierre',     value: kpis.pct_cierre + '%',              sub: 'ganadas / cerradas',                                                  accent: '#0052D4' },
            { label: 'Ticket Promedio', value: fmtShort(kpis.ticket_promedio_mxn), sub: 'monto promedio ganada',                                              accent: '#6FB1FC' },
        ];
        $('repKpis').innerHTML = cards.map(function (c) {
            return '<div class="rep-kpi" style="border-left-color:' + c.accent + ';">'
                + '<div class="rep-kpi-label">' + escapeHTML(c.label) + '</div>'
                + '<div class="rep-kpi-value">' + escapeHTML(c.value) + '</div>'
                + '<div class="rep-kpi-sub">' + escapeHTML(c.sub) + '</div>'
                + '</div>';
        }).join('');
    }

    // ── Pills / chips ───────────────────────────────────────────────
    function resultadoPill(r) {
        if (r === 'ganada') {
            return '<span class="rep-etapa-pill" style="background:#DCFCE7;color:#15803D;">✓ Ganada</span>';
        }
        if (r === 'perdida') {
            return '<span class="rep-etapa-pill" style="background:#FEE2E2;color:#991B1B;">✗ Perdida</span>';
        }
        return '<span class="rep-etapa-pill" style="background:#F1F5F9;color:#475569;">' + escapeHTML(r || '—') + '</span>';
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

    // ── Plantillas (client-side, sobre el set devuelto por el API) ──
    function aplicarPlantilla(opps) {
        switch (_plantillaActiva) {
            case 'ganadas':  return opps.filter(function (o) { return o.resultado === 'ganada'; });
            case 'perdidas': return opps.filter(function (o) { return o.resultado === 'perdida'; });
            default: return opps;
        }
    }

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

    // ── Tabla + paginación ──────────────────────────────────────────
    var COLS = [
        { k: 'titulo',       l: 'Oportunidad', right: false },
        { k: 'resultado',    l: 'Resultado',   right: false },
        { k: 'monto_mxn',    l: 'Monto',       right: true  },
        { k: 'fecha_cierre', l: 'Cierre',      right: false },
        { k: 'producto',     l: 'Proveedor',   right: false },
        { k: 'vendedor',     l: 'Vendedor',    right: false },
    ];

    function renderTabla() {
        if (!_lastData) return;
        var wrap = $('repTableWrap');
        var allFiltradas = ordenar(aplicarPlantilla(_lastData.oportunidades || []));
        if (!allFiltradas.length) {
            wrap.innerHTML = '<div class="rep-empty">'
                + '<svg width="32" height="32" fill="none" stroke="#CBD5E1" stroke-width="1.6" viewBox="0 0 24 24" style="margin-bottom:8px;"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>'
                + '<h3>Sin resultados</h3><p>No hay oportunidades cerradas con los filtros actuales.</p>'
                + '</div>';
            return;
        }

        var totalFiltrado = allFiltradas.length;
        var totalMontoFiltrado = allFiltradas.reduce(function (s, o) { return s + (o.monto_mxn || 0); }, 0);

        var totalPages = Math.max(1, Math.ceil(totalFiltrado / PAGE_SIZE));
        if (_currentPage > totalPages) _currentPage = totalPages;
        if (_currentPage < 1) _currentPage = 1;
        var ini = (_currentPage - 1) * PAGE_SIZE;
        var fin = Math.min(ini + PAGE_SIZE, totalFiltrado);
        var pagina = allFiltradas.slice(ini, fin);

        var html = '<div class="rep-table-scroll"><table class="rep-table"><thead><tr>';
        COLS.forEach(function (c) {
            html += '<th class="' + (c.right ? 'rep-text-right' : '') + ' rep-th-nosort">'
                + escapeHTML(c.l) + '</th>';
        });
        html += '</tr></thead><tbody>';
        pagina.forEach(function (o) {
            html += '<tr data-opp-id="' + o.id + '">'
                + '<td><div class="rep-td-title">' + escapeHTML(o.titulo || '(sin título)') + '</div>'
                +     '<div class="rep-td-sub">' + escapeHTML(o.cliente || '—') + '</div></td>'
                + '<td>' + resultadoPill(o.resultado) + '</td>'
                + '<td class="rep-text-right rep-mono"><strong class="rep-monto">' + fmtFull(o.monto_mxn) + '</strong></td>'
                + '<td class="rep-mono rep-fecha">' + escapeHTML(o.fecha_cierre || '—') + '</td>'
                + '<td>' + productoChip(o.producto) + '</td>'
                + '<td class="rep-vendedor">' + escapeHTML(o.vendedor || '—') + '</td>'
                + '</tr>';
        });
        html += '</tbody></table></div>';

        // Footer con paginación + totales globales (no de la página).
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

        // Click en fila → abre la opp inline via widget del CRM.
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

        // Paginación
        var prev = $('repPagPrev');
        if (prev) prev.addEventListener('click', function () {
            if (_currentPage > 1) { _currentPage--; renderTabla(); scrollToTable(); }
        });
        var next = $('repPagNext');
        if (next) next.addEventListener('click', function () {
            if (_currentPage < totalPages) { _currentPage++; renderTabla(); scrollToTable(); }
        });
    }

    function scrollToTable() {
        var t = $('repTableWrap');
        if (t && typeof t.scrollIntoView === 'function') {
            t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // ── Ordenar dropdown ────────────────────────────────────────────
    function toggleSortMenu(forceState) {
        var btn = $('repSortBtn');
        var menu = $('repSortMenu');
        if (!btn || !menu) return;
        var open = forceState !== undefined ? forceState : menu.hidden;
        if (open) {
            menu.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
        } else {
            menu.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
        }
    }

    function actualizarSortLabel() {
        var lbl = $('repSortLabel');
        var mode = SORT_MODES[_sortMode] || SORT_MODES.monto_desc;
        if (lbl) lbl.textContent = mode.label;
        // Marcar el item activo en el menú
        document.querySelectorAll('.rep-sort-item').forEach(function (it) {
            it.classList.toggle('is-active', it.getAttribute('data-sort') === _sortMode);
        });
    }

    function pickSort(key) {
        if (!SORT_MODES[key]) return;
        _sortMode = key;
        actualizarSortLabel();
        toggleSortMenu(false);
        _currentPage = 1;
        renderTabla();
    }

    // ── Endpoint + filtros UI ───────────────────────────────────────
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
        (filtrosDisp.productos || []).forEach(function (m) {
            var o = document.createElement('option');
            o.value = m; o.textContent = m;
            $('repFltMarca').appendChild(o);
        });
        (filtrosDisp.anios_con_datos || []).forEach(function (a) {
            var o = document.createElement('option');
            o.value = a; o.textContent = a;
            $('repFltAnio').appendChild(o);
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

    // ── Drawer ──────────────────────────────────────────────────────
    function openDrawer() {
        $('repDrawer').classList.add('open');
        $('repDrawer').setAttribute('aria-hidden', 'false');
        $('repDrawerOverlay').classList.add('open');
        $('repFltPipeline').value = _filtros.pipeline || '';
        $('repFltVendedor').value = _filtros.vendedor || '';
        $('repFltResultado').value = _filtros.resultado || '';
        $('repFltAnio').value = _filtros.anio || '';
        $('repFltMes').value = _filtros.mes || '';
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
        _filtros.resultado = $('repFltResultado').value || '';
        _filtros.anio = $('repFltAnio').value || '';
        _filtros.mes = $('repFltMes').value || '';
        _filtros.producto = $('repFltMarca').value || '';
        _filtros.monto_min = $('repFltMontoMin').value || '';
        closeDrawer();
        load();
    }
    function clearDrawer() {
        $('repFltPipeline').value = '';
        $('repFltVendedor').value = '';
        $('repFltResultado').value = '';
        $('repFltAnio').value = '';
        $('repFltMes').value = '';
        $('repFltMarca').value = '';
        $('repFltMontoMin').value = '';
        activarPlantilla('todas');
    }

    // ── Export CSV con bloque de metadatos ──────────────────────────
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
    var MESES_NOMBRE = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    function exportarCSV() {
        if (!_lastData) return;
        var ops = ordenar(aplicarPlantilla(_lastData.oportunidades || []));
        if (!ops.length) { alert('No hay datos para exportar.'); return; }

        var sortLabel = (SORT_MODES[_sortMode] || SORT_MODES.monto_desc).label;
        var totalMonto = ops.reduce(function (s, o) { return s + (o.monto_mxn || 0); }, 0);
        var ganadas = ops.filter(function (o) { return o.resultado === 'ganada'; });
        var perdidas = ops.filter(function (o) { return o.resultado === 'perdida'; });
        var montoGanado = ganadas.reduce(function (s, o) { return s + (o.monto_mxn || 0); }, 0);
        var montoPerdido = perdidas.reduce(function (s, o) { return s + (o.monto_mxn || 0); }, 0);

        var mesLabel = '—';
        if (_filtros.mes) {
            var mi = parseInt(_filtros.mes, 10);
            mesLabel = (mi >= 1 && mi <= 12) ? MESES_NOMBRE[mi] : _filtros.mes;
        }

        var metaLines = [
            '# Reporte: Oportunidades Cerradas (Ganadas / Pagadas / Perdidas)',
            '# Exportado por: ' + (window._REP_USER || '—'),
            '# Fecha y hora de exportación: ' + nowLocal(),
            '# Filtros aplicados:',
            '#   - Pipeline: ' + (_filtros.pipeline || 'Ambos (Runrate + Proyecto)'),
            '#   - Vendedor: ' + (_filtros.vendedor ? vendedorLabel(_filtros.vendedor) : 'Todos los visibles'),
            '#   - Resultado: ' + (_filtros.resultado || 'Ambos'),
            '#   - Año: ' + (_filtros.anio || 'Todos'),
            '#   - Mes: ' + mesLabel,
            '#   - Proveedor: ' + (_filtros.producto || 'Todos'),
            '#   - Monto mínimo: ' + (_filtros.monto_min ? '$' + Number(_filtros.monto_min).toLocaleString('en-US') : 'sin mínimo'),
            '#   - Búsqueda: ' + (_filtros.q || '—'),
            '#   - Vista rápida: ' + _plantillaActiva,
            '#   - Orden: ' + sortLabel,
            '# Total registros exportados: ' + ops.length,
            '#   - Ganadas: ' + ganadas.length + '  Monto ganado MXN: $' + Math.round(montoGanado).toLocaleString('en-US'),
            '#   - Perdidas: ' + perdidas.length + '  Monto perdido MXN: $' + Math.round(montoPerdido).toLocaleString('en-US'),
            '# Total monto MXN: $' + Math.round(totalMonto).toLocaleString('en-US'),
            '',
        ];

        var headers = ['Oportunidad', 'Cliente', 'Pipeline', 'Resultado', 'Etapa', 'Monto MXN', 'Cierre', 'Proveedor', 'Vendedor', 'PO'];
        var rows = ops.map(function (o) {
            return [
                o.titulo || '', o.cliente || '', o.pipeline_label || '',
                o.resultado || '', o.etapa || '', o.monto_mxn || 0,
                o.fecha_cierre || '', o.producto || '', o.vendedor || '',
                o.po_number || '',
            ];
        });

        var csv = metaLines.join('\n') + '\n'
            + [headers, ...rows].map(function (row) {
                return row.map(csvEscape).join(',');
            }).join('\n');

        var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'Reporte_Oportunidades_Cerradas_' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    // ── Wire up ─────────────────────────────────────────────────────
    // Lee filtros iniciales del URL (cuando el reporte se carga dentro
    // del iframe del dashboard SPA, las pills de periodo/vendedor del
    // dashboard se propagan al iframe como query params).
    function _aplicarFiltrosUrl() {
        try {
            var u = new URL(window.location.href);
            Object.keys(_filtros).forEach(function (k) {
                var v = u.searchParams.get(k);
                if (v != null && v !== '') _filtros[k] = v;
            });
        } catch (e) { /* defensivo */ }
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!$('repKpis')) return;
        _aplicarFiltrosUrl();

        // Búsqueda con debounce
        $('repSearch').addEventListener('input', function (e) {
            clearTimeout(_searchDebounce);
            _searchDebounce = setTimeout(function () {
                _filtros.q = e.target.value.trim();
                load();
            }, 280);
        });

        // Chips de Vista rápida (dentro del drawer)
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
        document.addEventListener('click', function (e) {
            var menu = $('repSortMenu');
            if (!menu || menu.hidden) return;
            var wrap = menu.closest('.rep-sort-wrap');
            if (wrap && !wrap.contains(e.target)) toggleSortMenu(false);
        });

        // Header
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
