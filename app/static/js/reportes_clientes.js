/* ═══════════════════════════════════════════════════════════════════
 * reportes_clientes.js
 * Reporte 3: Por Cliente — 1 fila por cliente con conteos de opps y
 * actividad. Útil para que un jefe vea "¿con qué clientes estamos
 * descuidando?" y "¿quién es nuestro cliente más rentable?".
 *
 * KPIs: Total clientes · Con opps abiertas · Ganado total · Sin actividad
 *       reciente (>30 días).
 * Tabla: Cliente · Categoría · Abiertas · Ganadas · Perdidas · Ganado
 *        total · Última actividad · Próxima.
 * Plantillas: Todas · Con opps abiertas · Sin actividad >30d.
 * Click en fila → abre /app/todos/?tab=crm&cliente=ID (vista cliente).
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var ENDPOINT = '/app/api/reportes/clientes/';

    var _filtros = { vendedor: '', opps_min: '', q: '' };
    var _plantillaActiva = 'todas';
    var _sortKey = 'opps_abiertas';
    var _sortDir = 'desc';
    var _lastData = null;
    var _filtrosUICargados = false;
    var _searchDebounce = null;

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
    function fmtFecha(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d)) return '';
        var meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        return d.getDate() + ' ' + meses[d.getMonth()] + ' ' + d.getFullYear();
    }
    function diasDesde(iso) {
        if (!iso) return null;
        var d = new Date(iso);
        if (isNaN(d)) return null;
        return Math.floor((new Date() - d) / (1000 * 60 * 60 * 24));
    }

    // ── KPIs ─────────────────────────────────────────────────────────
    function renderKpis(kpis) {
        var cards = [
            { label: 'Total Clientes',     value: String(kpis.total_clientes),         sub: 'visibles para ti',                                                       accent: '#0052D4' },
            { label: 'Con Opps Abiertas',  value: String(kpis.con_opps_abiertas),      sub: 'en pipeline activo',                                                     accent: '#4364F7' },
            { label: 'Ganado Total',       value: fmtShort(kpis.monto_ganado_total_mxn), sub: 'histórico acumulado',                                                  accent: '#15803D' },
            { label: 'Sin Actividad >30d', value: String(kpis.sin_actividad_reciente), sub: 'requieren follow-up',                                                    accent: '#DC2626' },
        ];
        $('repKpis').innerHTML = cards.map(function (c) {
            return '<div class="rep-kpi" style="border-left-color:' + c.accent + ';">'
                + '<div class="rep-kpi-label">' + escapeHTML(c.label) + '</div>'
                + '<div class="rep-kpi-value">' + escapeHTML(c.value) + '</div>'
                + '<div class="rep-kpi-sub">' + escapeHTML(c.sub) + '</div>'
                + '</div>';
        }).join('');
    }

    // ── Badges para conteos ─────────────────────────────────────────
    function countBadge(v, kind) {
        if (!v) return '<span class="rep-muted">0</span>';
        var palette = {
            'abiertas': ['#EBF5FF', '#1D4ED8'],
            'ganadas':  ['#DCFCE7', '#15803D'],
            'perdidas': ['#FEE2E2', '#991B1B'],
        };
        var pair = palette[kind] || ['#F1F5F9', '#475569'];
        return '<span class="rep-days-badge" style="background:' + pair[0] + ';color:' + pair[1] + ';">'
            + v + '</span>';
    }

    function categoriaPill(cat) {
        var palette = {
            'A': ['#FEF3C7', '#92400E'],
            'B': ['#DBEAFE', '#1D4ED8'],
            'C': ['#F1F5F9', '#475569'],
        };
        var pair = palette[cat] || palette['C'];
        return '<span class="rep-etapa-pill" style="background:' + pair[0] + ';color:' + pair[1] + ';font-weight:700;">'
            + escapeHTML(cat) + '</span>';
    }

    function ultimaActividad(iso) {
        if (!iso) return '<span class="rep-muted">Sin actividad</span>';
        var dias = diasDesde(iso);
        var col, bg;
        if (dias > 30) { col = '#991B1B'; bg = '#FEE2E2'; }
        else if (dias > 14) { col = '#92400E'; bg = '#FEF3C7'; }
        else { col = '#15803D'; bg = '#DCFCE7'; }
        var txt = dias === 0 ? 'hoy' : (dias === 1 ? 'ayer' : 'hace ' + dias + 'd');
        return '<span class="rep-days-badge" style="background:' + bg + ';color:' + col + ';">' + txt + '</span>'
            + '<div class="rep-td-sub" style="margin-top:3px;">' + fmtFecha(iso) + '</div>';
    }

    function proximaActividad(p) {
        if (!p) return '<span class="rep-muted">—</span>';
        var dias = diasDesde(p.fecha);
        // dias negativo = futura (porque diasDesde da días pasados)
        var txt = '';
        if (dias === 0) txt = 'hoy';
        else if (dias === -1) txt = 'mañana';
        else if (dias < 0) txt = 'en ' + Math.abs(dias) + 'd';
        else txt = fmtFecha(p.fecha);
        return '<span class="rep-next-step">'
            + '<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> '
            + escapeHTML(p.titulo) + '<span class="rep-next-date"> · ' + txt + '</span></span>';
    }

    // ── Plantillas client-side ──────────────────────────────────────
    function aplicarPlantilla(clientes) {
        switch (_plantillaActiva) {
            case 'con-abiertas':  return clientes.filter(function (c) { return c.opps_abiertas > 0; });
            case 'sin-actividad': return clientes.filter(function (c) {
                if (!c.ultima_actividad) return true;
                var d = diasDesde(c.ultima_actividad);
                return d != null && d > 30;
            });
            default: return clientes;
        }
    }

    function ordenar(clientes) {
        var k = _sortKey, dir = _sortDir === 'desc' ? -1 : 1;
        return clientes.slice().sort(function (a, b) {
            var av = a[k], bv = b[k];
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
            return String(av || '').localeCompare(String(bv || ''), 'es') * dir;
        });
    }

    // ── Tabla ───────────────────────────────────────────────────────
    var COLS = [
        { k: 'nombre',           l: 'Cliente',          right: false },
        { k: 'categoria',        l: 'Cat.',             right: false },
        { k: 'opps_abiertas',    l: 'Abiertas',         right: true  },
        { k: 'opps_ganadas',     l: 'Ganadas',          right: true  },
        { k: 'opps_perdidas',    l: 'Perdidas',         right: true  },
        { k: 'monto_ganado_mxn', l: 'Ganado total',     right: true  },
        { k: 'ultima_actividad', l: 'Última actividad', right: false },
        { k: 'proxima_actividad',l: 'Próxima',          right: false },
    ];

    function renderTabla(clientes) {
        var wrap = $('repTableWrap');
        if (!clientes.length) {
            wrap.innerHTML = '<div class="rep-empty">'
                + '<svg width="32" height="32" fill="none" stroke="#CBD5E1" stroke-width="1.6" viewBox="0 0 24 24" style="margin-bottom:8px;"><path d="M3 21h18M3 7v14M21 7v14M9 7V3h6v4M9 21V11h6v10"/></svg>'
                + '<h3>Sin resultados</h3><p>No hay clientes con los filtros actuales.</p>'
                + '</div>';
            return;
        }
        var totalGanado = clientes.reduce(function (s, c) { return s + (c.monto_ganado_mxn || 0); }, 0);
        var html = '<div class="rep-table-scroll"><table class="rep-table"><thead><tr>';
        COLS.forEach(function (c) {
            var arrow = '';
            if (c.k === _sortKey) arrow = _sortDir === 'desc' ? ' ↓' : ' ↑';
            html += '<th class="' + (c.right ? 'rep-text-right' : '') + '" data-sort-key="' + c.k + '">'
                + escapeHTML(c.l) + '<span class="rep-sort-arrow">' + arrow + '</span></th>';
        });
        html += '</tr></thead><tbody>';
        clientes.forEach(function (c) {
            html += '<tr data-cliente-id="' + c.id + '">'
                + '<td><div class="rep-td-title">' + escapeHTML(c.nombre || '(sin nombre)') + '</div>'
                +     '<div class="rep-td-sub">' + escapeHTML(c.asignado_a || 'Sin vendedor') + '</div></td>'
                + '<td>' + categoriaPill(c.categoria) + '</td>'
                + '<td class="rep-text-right">' + countBadge(c.opps_abiertas, 'abiertas') + '</td>'
                + '<td class="rep-text-right">' + countBadge(c.opps_ganadas, 'ganadas') + '</td>'
                + '<td class="rep-text-right">' + countBadge(c.opps_perdidas, 'perdidas') + '</td>'
                + '<td class="rep-text-right rep-mono"><strong class="rep-monto">' + fmtFull(c.monto_ganado_mxn) + '</strong></td>'
                + '<td>' + ultimaActividad(c.ultima_actividad) + '</td>'
                + '<td>' + proximaActividad(c.proxima_actividad) + '</td>'
                + '</tr>';
        });
        html += '</tbody></table></div>';
        html += '<footer class="rep-table-foot">'
            + '<span class="rep-table-foot-left">' + clientes.length + ' ' + (clientes.length === 1 ? 'cliente' : 'clientes') + '</span>'
            + '<span class="rep-table-foot-right">Ganado total: <strong>' + fmtFull(totalGanado) + '</strong></span>'
            + '</footer>';
        wrap.innerHTML = html;

        // Click en fila → vista CRM filtrada por cliente
        wrap.querySelectorAll('tr[data-cliente-id]').forEach(function (tr) {
            tr.addEventListener('click', function () {
                var id = tr.getAttribute('data-cliente-id');
                if (id) window.location.href = '/app/todos/?tab=crm&cliente=' + id;
            });
        });
        wrap.querySelectorAll('th[data-sort-key]').forEach(function (th) {
            th.addEventListener('click', function () {
                var k = th.getAttribute('data-sort-key');
                if (_sortKey === k) _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
                else { _sortKey = k; _sortDir = 'desc'; }
                if (_lastData) renderTabla(ordenar(aplicarPlantilla(_lastData.clientes)));
            });
        });
    }

    // ── Endpoint ────────────────────────────────────────────────────
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
    }

    function actualizarFilterDot() {
        var hasFilter = Object.keys(_filtros).some(function (k) { return _filtros[k]; });
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
                cargarFiltrosUI(data.filtros_disponibles || {});
                actualizarFilterDot();
                var rows = aplicarPlantilla(data.clientes || []);
                rows = ordenar(rows);
                renderKpis(data.kpis);
                renderTabla(rows);
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
        $('repFltVendedor').value = _filtros.vendedor || '';
        $('repFltOppsMin').value = _filtros.opps_min || '';
    }
    function closeDrawer() {
        $('repDrawer').classList.remove('open');
        $('repDrawer').setAttribute('aria-hidden', 'true');
        $('repDrawerOverlay').classList.remove('open');
    }
    function applyDrawer() {
        _filtros.vendedor = $('repFltVendedor').value || '';
        _filtros.opps_min = $('repFltOppsMin').value || '';
        closeDrawer();
        load();
    }
    function clearDrawer() {
        $('repFltVendedor').value = '';
        $('repFltOppsMin').value = '';
    }

    // ── Export CSV ──────────────────────────────────────────────────
    function exportarCSV() {
        if (!_lastData) return;
        var rows = ordenar(aplicarPlantilla(_lastData.clientes || []));
        if (!rows.length) { alert('No hay datos para exportar.'); return; }
        var headers = ['Cliente', 'Categoría', 'Vendedor', 'Opps Abiertas', 'Opps Ganadas', 'Opps Perdidas', 'Ganado Total MXN', 'Última actividad', 'Próxima actividad'];
        var csvRows = rows.map(function (c) {
            var prox = c.proxima_actividad ? (c.proxima_actividad.titulo + ' (' + (c.proxima_actividad.fecha || '') + ')') : '';
            return [
                c.nombre || '', c.categoria || '', c.asignado_a || '',
                c.opps_abiertas || 0, c.opps_ganadas || 0, c.opps_perdidas || 0,
                c.monto_ganado_mxn || 0, c.ultima_actividad || '', prox,
            ];
        });
        var csv = [headers].concat(csvRows).map(function (row) {
            return row.map(function (cell) {
                var s = String(cell == null ? '' : cell);
                if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
                    s = '"' + s.replace(/"/g, '""') + '"';
                }
                return s;
            }).join(',');
        }).join('\n');
        var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'Reporte_Por_Cliente_' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    // ── Wire up ─────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        if (!$('repKpis')) return;

        $('repSearch').addEventListener('input', function (e) {
            clearTimeout(_searchDebounce);
            _searchDebounce = setTimeout(function () {
                _filtros.q = e.target.value.trim();
                load();
            }, 280);
        });

        document.querySelectorAll('.rep-chip[data-plantilla]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.rep-chip[data-plantilla]').forEach(function (b) { b.classList.remove('rep-chip-active'); });
                btn.classList.add('rep-chip-active');
                _plantillaActiva = btn.getAttribute('data-plantilla') || 'todas';
                if (_lastData) renderTabla(ordenar(aplicarPlantilla(_lastData.clientes || [])));
            });
        });

        $('repBtnFilter').addEventListener('click', openDrawer);
        $('repBtnExport').addEventListener('click', exportarCSV);

        var btnConfig = $('repChipConfig');
        if (btnConfig) btnConfig.addEventListener('click', openDrawer);

        $('repDrawerClose').addEventListener('click', closeDrawer);
        $('repDrawerOverlay').addEventListener('click', closeDrawer);
        $('repFltApply').addEventListener('click', applyDrawer);
        $('repFltClear').addEventListener('click', clearDrawer);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && $('repDrawer').classList.contains('open')) closeDrawer();
        });

        load();
    });
})();
