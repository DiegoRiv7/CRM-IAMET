/* ═══════════════════════════════════════════════════════════════════
 * reportes_oportunidades_abiertas.js
 * Reporte 1: Oportunidades Abiertas — render del cliente.
 *
 * Layout (rediseño 2026-05-26):
 *   - Header con búsqueda + Filtros (drawer) + Exportar CSV
 *   - Plantillas como chips (atajos hardcoded a filtros preconfigurados)
 *   - Tabs de los 3 reportes (solo este está activo)
 *   - 4 KPI cards con accent vertical
 *   - Tabla rica plana: Opp · Etapa · Monto · Prob · Cierre · Proveedor
 *     · Vendedor · Días abto.
 *   - Click en fila → /app/todos/?tab=crm&open_opp=ID
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var ENDPOINT = '/app/api/reportes/oportunidades-abiertas/';

    // Filtros activos (lo que se envía al endpoint)
    var _filtros = {
        pipeline: '',
        vendedor: '',
        etapa: '',
        producto: '',
        monto_min: '',
        q: '',
    };

    // Filtro client-side de plantillas (extra sobre el resultado del API)
    var _plantillaActiva = 'todas';

    // Sort
    var _sortKey = 'monto_mxn';
    var _sortDir = 'desc';

    // Cache de respuesta (para re-render rápido al cambiar plantilla/sort)
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
            { label: 'Pipeline Total',  value: fmtShort(kpis.pipeline_total_mxn), sub: kpis.total + ' ' + (kpis.total === 1 ? 'oportunidad' : 'oportunidades'), accent: '#0052D4' },
            { label: 'Deals Activos',   value: String(kpis.total),               sub: 'en curso',                                                              accent: '#4364F7' },
            { label: 'Monto Ponderado', value: fmtShort(kpis.monto_ponderado_mxn), sub: 'ajustado por probabilidad',                                          accent: '#6FB1FC' },
            { label: 'Prob. Promedio',  value: kpis.prob_promedio + '%',         sub: 'de cierre',                                                            accent: '#34C759' },
        ];
        $('repKpis').innerHTML = cards.map(function (c) {
            return '<div class="rep-kpi" style="border-left-color:' + c.accent + ';">'
                + '<div class="rep-kpi-label">' + escapeHTML(c.label) + '</div>'
                + '<div class="rep-kpi-value">' + escapeHTML(c.value) + '</div>'
                + '<div class="rep-kpi-sub">' + escapeHTML(c.sub) + '</div>'
                + '</div>';
        }).join('');
    }

    // ── Pills / badges ──────────────────────────────────────────────
    var ETAPA_PALETTE = {
        // Para etapas tipo "Vendido c/PO", "En Tránsito", "Facturado", etc.
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

    function proximoPaso(p) {
        if (!p) return '<span class="rep-muted">—</span>';
        var fechaTxt = '';
        if (p.fecha) {
            var d = new Date(p.fecha);
            if (!isNaN(d)) {
                var meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
                fechaTxt = ' · ' + d.getDate() + ' ' + meses[d.getMonth()];
            }
        }
        if (p.vencida) {
            return '<span class="rep-overdue-pill">' + escapeHTML(p.titulo) + fechaTxt + ' · vencida</span>';
        }
        var ic = p.tipo === 'tarea'
            ? '<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h9"/></svg>'
            : '<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
        return '<span class="rep-next-step">' + ic + ' ' + escapeHTML(p.titulo) + '<span class="rep-next-date">' + fechaTxt + '</span></span>';
    }

    // ── Plantillas (filtros client-side adicionales) ────────────────
    function aplicarPlantilla(opps) {
        switch (_plantillaActiva) {
            case 'alta-prob':    return opps.filter(function (o) { return o.probabilidad >= 70; });
            case 'sin-actividad': return opps.filter(function (o) { return !o.proximo_paso; });
            case 'vencidas':     return opps.filter(function (o) { return o.proximo_paso && o.proximo_paso.vencida; });
            case 'estancadas':   return opps.filter(function (o) { return o.dias_abierto > 45; });
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
        { k: 'titulo',         l: 'Oportunidad',  right: false },
        { k: 'etapa',          l: 'Etapa',        right: false },
        { k: 'monto_mxn',      l: 'Monto',        right: true  },
        { k: 'probabilidad',   l: 'Prob.',        right: true  },
        { k: 'fecha_cierre',   l: 'Cierre est.',  right: false },
        { k: 'producto',          l: 'Proveedor',    right: false },
        { k: 'vendedor',       l: 'Vendedor',     right: false },
        { k: 'dias_abierto',   l: 'Días abto.',   right: true  },
    ];

    function renderTabla(opps) {
        var wrap = $('repTableWrap');
        if (!opps.length) {
            wrap.innerHTML = '<div class="rep-empty">'
                + '<svg width="32" height="32" fill="none" stroke="#CBD5E1" stroke-width="1.6" viewBox="0 0 24 24" style="margin-bottom:8px;"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>'
                + '<h3>Sin resultados</h3><p>No hay oportunidades con los filtros actuales.</p>'
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
                + '<td>' + etapaPill(o.etapa) + '</td>'
                + '<td class="rep-text-right rep-mono"><strong class="rep-monto">' + fmtFull(o.monto_mxn) + '</strong></td>'
                + '<td class="rep-text-right">' + probBar(o.probabilidad) + '</td>'
                + '<td class="rep-mono rep-fecha">' + escapeHTML(o.fecha_cierre || '—') + '</td>'
                + '<td>' + productoChip(o.producto) + '</td>'
                + '<td class="rep-vendedor">' + escapeHTML(o.vendedor || '—') + '</td>'
                + '<td class="rep-text-right">' + daysBadge(o.dias_abierto) + '</td>'
                + '</tr>';
        });
        html += '</tbody></table></div>';
        html += '<footer class="rep-table-foot">'
            + '<span class="rep-table-foot-left">' + opps.length + ' ' + (opps.length === 1 ? 'registro' : 'registros') + '</span>'
            + '<span class="rep-table-foot-right">Total: <strong>' + fmtFull(totalMonto) + '</strong></span>'
            + '</footer>';
        wrap.innerHTML = html;

        // Click en fila → abre el widget de la opp inline (sin navegar al CRM).
        // openDetalle viene de crm_main.js, que está cargado en esta página.
        // Fallback: si por alguna razón no está disponible, redirige al CRM.
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
        // Click en header → ordenar
        wrap.querySelectorAll('th[data-sort-key]').forEach(function (th) {
            th.addEventListener('click', function () {
                var k = th.getAttribute('data-sort-key');
                if (_sortKey === k) _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
                else { _sortKey = k; _sortDir = 'desc'; }
                if (_lastData) renderTabla(ordenar(aplicarPlantilla(_lastData.oportunidades)));
            });
        });
    }

    // ── Llamada al endpoint ─────────────────────────────────────────
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
        // Vendedores
        (filtrosDisp.vendedores || []).forEach(function (v) {
            var o = document.createElement('option');
            o.value = v.id; o.textContent = v.nombre;
            $('repFltVendedor').appendChild(o);
        });
        // Etapas (agrupadas por pipeline)
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
        // Marcas
        (filtrosDisp.productos || []).forEach(function (m) {
            var o = document.createElement('option');
            o.value = m; o.textContent = m;
            $('repFltMarca').appendChild(o);
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
                // KPIs reflejan SIEMPRE el resultado del endpoint (no la plantilla
                // client-side), para que el jefe vea el tamaño total del pipeline
                // y la plantilla solo afecte la tabla. Si quieres recalcular KPIs
                // con la plantilla aplicada, se puede pivotar después.
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
        // Sincronizar inputs con _filtros activos
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
    }

    // ── Export CSV (cliente-side a partir de _lastData) ─────────────
    function exportarCSV() {
        if (!_lastData) return;
        var ops = ordenar(aplicarPlantilla(_lastData.oportunidades || []));
        if (!ops.length) { alert('No hay datos para exportar.'); return; }
        var headers = ['Oportunidad', 'Cliente', 'Pipeline', 'Etapa', 'Monto MXN', 'Probabilidad', 'Cierre estimado', 'Proveedor', 'Vendedor', 'Días abiertos', 'PO', 'Archivos OCC', 'Próximo paso'];
        var rows = ops.map(function (o) {
            var prox = o.proximo_paso ? ((o.proximo_paso.tipo || '') + ': ' + (o.proximo_paso.titulo || '') + (o.proximo_paso.vencida ? ' (vencida)' : '')) : '';
            return [
                o.titulo || '', o.cliente || '', o.pipeline_label || '', o.etapa || '',
                o.monto_mxn || 0, o.probabilidad || 0, o.fecha_cierre || '',
                o.producto || '', o.vendedor || '', o.dias_abierto || 0,
                o.po_number || '', (o.archivos_occ || []).join('; '), prox,
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
        a.download = 'Reporte_Oportunidades_Abiertas_' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    // ── Wire up ─────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        if (!$('repKpis')) return;

        // Búsqueda con debounce
        $('repSearch').addEventListener('input', function (e) {
            clearTimeout(_searchDebounce);
            _searchDebounce = setTimeout(function () {
                _filtros.q = e.target.value.trim();
                load();
            }, 280);
        });

        // Plantillas chips
        document.querySelectorAll('.rep-chip[data-plantilla]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.rep-chip[data-plantilla]').forEach(function (b) { b.classList.remove('rep-chip-active'); });
                btn.classList.add('rep-chip-active');
                _plantillaActiva = btn.getAttribute('data-plantilla') || 'todas';
                if (_lastData) renderTabla(ordenar(aplicarPlantilla(_lastData.oportunidades || [])));
            });
        });

        // Botones del header
        $('repBtnFilter').addEventListener('click', openDrawer);
        $('repBtnExport').addEventListener('click', exportarCSV);

        // Chip "Configurar reporte" → mismo comportamiento que botón Filtros.
        var btnConfig = $('repChipConfig');
        if (btnConfig) btnConfig.addEventListener('click', openDrawer);

        // Drawer
        $('repDrawerClose').addEventListener('click', closeDrawer);
        $('repDrawerOverlay').addEventListener('click', closeDrawer);
        $('repFltApply').addEventListener('click', applyDrawer);
        $('repFltClear').addEventListener('click', clearDrawer);

        // ESC para cerrar drawer
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && $('repDrawer').classList.contains('open')) closeDrawer();
        });

        load();
    });
})();
