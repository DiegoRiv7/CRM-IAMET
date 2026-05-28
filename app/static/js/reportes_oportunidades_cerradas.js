/* ═══════════════════════════════════════════════════════════════════
 * reportes_oportunidades_cerradas.js
 * Reporte 2: Oportunidades Cerradas (Ganadas / Perdidas).
 *
 * Estructura igual al reporte de Abiertas — comparte CSS y patrón de
 * drawer/plantillas/CSV. Difiere en:
 *   - KPIs: Total ganado · Total perdido · % cierre · Ticket promedio
 *   - Tabla: Resultado (pill verde/rojo) en vez de Probabilidad
 *   - Filtros: año / mes / resultado en vez de etapa
 *   - Plantillas: Todas · Solo ganadas · Solo perdidas
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var ENDPOINT = '/app/api/reportes/oportunidades-cerradas/';

    var _filtros = {
        pipeline: '', vendedor: '', resultado: '', producto: '',
        anio: '', mes: '', monto_min: '', q: '',
    };
    var _plantillaActiva = 'todas';
    var _sortKey = 'monto_mxn';
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

    // ── KPIs ─────────────────────────────────────────────────────────
    function renderKpis(kpis) {
        var cards = [
            { label: 'Total Ganado',     value: fmtShort(kpis.monto_ganado_mxn),  sub: kpis.ganadas + ' ganadas',  accent: '#15803D' },
            { label: 'Total Perdido',    value: fmtShort(kpis.monto_perdido_mxn), sub: kpis.perdidas + ' perdidas', accent: '#DC2626' },
            { label: '% de Cierre',      value: kpis.pct_cierre + '%',            sub: 'ganadas / cerradas',        accent: '#0052D4' },
            { label: 'Ticket Promedio',  value: fmtShort(kpis.ticket_promedio_mxn), sub: 'monto promedio ganada',   accent: '#6FB1FC' },
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

    function ordenar(opps) {
        var k = _sortKey, dir = _sortDir === 'desc' ? -1 : 1;
        return opps.slice().sort(function (a, b) {
            var av = a[k], bv = b[k];
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
            return String(av || '').localeCompare(String(bv || ''), 'es') * dir;
        });
    }

    // ── Tabla ───────────────────────────────────────────────────────
    var COLS = [
        { k: 'titulo',       l: 'Oportunidad',     right: false },
        { k: 'resultado',    l: 'Resultado',       right: false },
        { k: 'monto_mxn',    l: 'Monto',           right: true  },
        { k: 'fecha_cierre', l: 'Cierre',          right: false },
        { k: 'producto',     l: 'Proveedor',       right: false },
        { k: 'vendedor',     l: 'Vendedor',        right: false },
    ];

    function renderTabla(opps) {
        var wrap = $('repTableWrap');
        if (!opps.length) {
            wrap.innerHTML = '<div class="rep-empty">'
                + '<svg width="32" height="32" fill="none" stroke="#CBD5E1" stroke-width="1.6" viewBox="0 0 24 24" style="margin-bottom:8px;"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>'
                + '<h3>Sin resultados</h3><p>No hay oportunidades cerradas con los filtros actuales.</p>'
                + '</div>';
            return;
        }
        var totalMonto = opps.reduce(function (s, o) { return s + (o.monto_mxn || 0); }, 0);
        var html = '<div class="rep-table-scroll"><table class="rep-table"><thead><tr>';
        COLS.forEach(function (c) {
            var arrow = '';
            if (c.k === _sortKey) arrow = _sortDir === 'desc' ? ' ↓' : ' ↑';
            html += '<th class="' + (c.right ? 'rep-text-right' : '') + '" data-sort-key="' + c.k + '">'
                + escapeHTML(c.l) + '<span class="rep-sort-arrow">' + arrow + '</span></th>';
        });
        html += '</tr></thead><tbody>';
        opps.forEach(function (o) {
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
        html += '<footer class="rep-table-foot">'
            + '<span class="rep-table-foot-left">' + opps.length + ' ' + (opps.length === 1 ? 'registro' : 'registros') + '</span>'
            + '<span class="rep-table-foot-right">Total: <strong>' + fmtFull(totalMonto) + '</strong></span>'
            + '</footer>';
        wrap.innerHTML = html;

        // Click → abre widget inline (mismo patrón que Abiertas)
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
        wrap.querySelectorAll('th[data-sort-key]').forEach(function (th) {
            th.addEventListener('click', function () {
                var k = th.getAttribute('data-sort-key');
                if (_sortKey === k) _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
                else { _sortKey = k; _sortDir = 'desc'; }
                if (_lastData) renderTabla(ordenar(aplicarPlantilla(_lastData.oportunidades)));
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
        (filtrosDisp.productos || []).forEach(function (m) {
            var o = document.createElement('option');
            o.value = m; o.textContent = m;
            $('repFltMarca').appendChild(o);
        });
        // Años con datos — el server los ordena desc.
        (filtrosDisp.anios_con_datos || []).forEach(function (a) {
            var o = document.createElement('option');
            o.value = a; o.textContent = a;
            $('repFltAnio').appendChild(o);
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
                var ops = aplicarPlantilla(data.oportunidades || []);
                ops = ordenar(ops);
                renderKpis(data.kpis);
                renderTabla(ops);
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
    }

    // ── Export CSV ──────────────────────────────────────────────────
    function exportarCSV() {
        if (!_lastData) return;
        var ops = ordenar(aplicarPlantilla(_lastData.oportunidades || []));
        if (!ops.length) { alert('No hay datos para exportar.'); return; }
        var headers = ['Oportunidad', 'Cliente', 'Pipeline', 'Resultado', 'Etapa', 'Monto MXN', 'Cierre', 'Proveedor', 'Vendedor', 'PO'];
        var rows = ops.map(function (o) {
            return [
                o.titulo || '', o.cliente || '', o.pipeline_label || '',
                o.resultado || '', o.etapa || '', o.monto_mxn || 0,
                o.fecha_cierre || '', o.producto || '', o.vendedor || '',
                o.po_number || '',
            ];
        });
        var csv = [headers, ...rows].map(function (row) {
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
        a.download = 'Reporte_Oportunidades_Cerradas_' + new Date().toISOString().slice(0, 10) + '.csv';
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
                if (_lastData) renderTabla(ordenar(aplicarPlantilla(_lastData.oportunidades || [])));
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
