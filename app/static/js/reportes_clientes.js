/* ═══════════════════════════════════════════════════════════════════
 * reportes_clientes.js
 * Reporte 3: Por Cliente — 1 fila por cliente con conteos de opps y
 * cobrado total (del Dashboard, NO del CRM).
 *
 * Cambios respecto a la versión anterior (2026-05-28):
 *   - Patrón "limpio" igual a Abiertas/Cerradas: botón Ordenar dropdown,
 *     vista rápida en el drawer, paginación 50, export CSV con metadatos.
 *   - Quitadas las columnas "Cat." (Categoría) y "Próxima" (Próxima
 *     actividad).
 *   - Columna "Cobrado total" en vez de "Ganado total" — viene del CSV
 *     de ingresos (ArchivoCobrado) del Dashboard, NO de oportunidades.
 *   - Click en cliente abre el widget inline (#widgetClienteOportunidades
 *     vía window.openClienteModal). Ya no navega al CRM.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var ENDPOINT = '/app/api/reportes/clientes/';
    var PAGE_SIZE = 50;

    // ── Estado ───────────────────────────────────────────────────────
    var _filtros = { vendedor: '', opps_min: '', q: '' };
    var _plantillaActiva = 'todas';
    var _sortMode = 'abiertas_desc';
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

    // ── Sort modes ───────────────────────────────────────────────────
    // Cada modo retorna su label (para el botón) y la función de orden.
    // Para "sin actividad" usamos un número derivado: días desde última
    // actividad (cuanto más grande, más viejo). Sin actividad → +Infinity.
    function _diasDesdeUltima(c) {
        if (!c.ultima_actividad) return Number.POSITIVE_INFINITY;
        var d = diasDesde(c.ultima_actividad);
        return d == null ? Number.POSITIVE_INFINITY : d;
    }

    var SORT_MODES = {
        abiertas_desc:      { label: 'Más opps abiertas',                cmp: function (a, b) { return (b.opps_abiertas || 0) - (a.opps_abiertas || 0); } },
        ganadas_desc:       { label: 'Más opps ganadas',                 cmp: function (a, b) { return (b.opps_ganadas || 0) - (a.opps_ganadas || 0); } },
        perdidas_desc:      { label: 'Más opps perdidas',                cmp: function (a, b) { return (b.opps_perdidas || 0) - (a.opps_perdidas || 0); } },
        cobrado_desc:       { label: 'Mayor cobrado',                    cmp: function (a, b) { return (b.cobrado_total_mxn || 0) - (a.cobrado_total_mxn || 0); } },
        cobrado_asc:        { label: 'Menor cobrado',                    cmp: function (a, b) { return (a.cobrado_total_mxn || 0) - (b.cobrado_total_mxn || 0); } },
        actividad_vieja:    { label: 'Sin actividad reciente primero',   cmp: function (a, b) { return _diasDesdeUltima(b) - _diasDesdeUltima(a); } },
        actividad_reciente: { label: 'Actividad más reciente',           cmp: function (a, b) { return _diasDesdeUltima(a) - _diasDesdeUltima(b); } },
        nombre_asc:         { label: 'Cliente (A-Z)',                    cmp: function (a, b) { return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'); } },
        vendedor_asc:       { label: 'Vendedor (A-Z)',                   cmp: function (a, b) { return String(a.asignado_a || '').localeCompare(String(b.asignado_a || ''), 'es'); } },
    };

    function ordenar(clientes) {
        var mode = SORT_MODES[_sortMode] || SORT_MODES.abiertas_desc;
        return clientes.slice().sort(mode.cmp);
    }

    // ── KPIs ─────────────────────────────────────────────────────────
    function renderKpis(kpis) {
        var cards = [
            { label: 'Total Clientes',     value: String(kpis.total_clientes),                   sub: 'visibles para ti',     accent: '#0052D4' },
            { label: 'Con Opps Abiertas',  value: String(kpis.con_opps_abiertas),                sub: 'en pipeline activo',    accent: '#4364F7' },
            { label: 'Cobrado Total',      value: fmtShort(kpis.cobrado_total_global_mxn),       sub: 'histórico (Dashboard)', accent: '#15803D' },
            { label: 'Sin Actividad >30d', value: String(kpis.sin_actividad_reciente),           sub: 'requieren follow-up',   accent: '#DC2626' },
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

    function ultimaActividadCell(iso) {
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

    // ── Plantillas (Vista rápida) ───────────────────────────────────
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
    // Columnas (sin Categoría ni Próxima — el usuario las pidió quitar).
    var COLS = [
        { l: 'Cliente',           right: false },
        { l: 'Abiertas',          right: true  },
        { l: 'Ganadas',           right: true  },
        { l: 'Perdidas',          right: true  },
        { l: 'Cobrado total',     right: true  },
        { l: 'Última actividad',  right: false },
    ];

    function renderTabla() {
        if (!_lastData) return;
        var wrap = $('repTableWrap');
        var allFiltradas = ordenar(aplicarPlantilla(_lastData.clientes || []));
        if (!allFiltradas.length) {
            wrap.innerHTML = '<div class="rep-empty">'
                + '<svg width="32" height="32" fill="none" stroke="#CBD5E1" stroke-width="1.6" viewBox="0 0 24 24" style="margin-bottom:8px;"><path d="M3 21h18M3 7v14M21 7v14M9 7V3h6v4M9 21V11h6v10"/></svg>'
                + '<h3>Sin resultados</h3><p>No hay clientes con los filtros actuales.</p>'
                + '</div>';
            return;
        }

        var totalFiltrado = allFiltradas.length;
        var totalCobrado = allFiltradas.reduce(function (s, c) { return s + (c.cobrado_total_mxn || 0); }, 0);

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
        pagina.forEach(function (c) {
            html += '<tr data-cliente-id="' + c.id + '" data-cliente-nombre="' + escapeHTML(c.nombre || '') + '">'
                + '<td><div class="rep-td-title">' + escapeHTML(c.nombre || '(sin nombre)') + '</div>'
                +     '<div class="rep-td-sub">' + escapeHTML(c.asignado_a || 'Sin vendedor') + '</div></td>'
                + '<td class="rep-text-right">' + countBadge(c.opps_abiertas, 'abiertas') + '</td>'
                + '<td class="rep-text-right">' + countBadge(c.opps_ganadas, 'ganadas') + '</td>'
                + '<td class="rep-text-right">' + countBadge(c.opps_perdidas, 'perdidas') + '</td>'
                + '<td class="rep-text-right rep-mono"><strong class="rep-monto">' + fmtFull(c.cobrado_total_mxn) + '</strong></td>'
                + '<td>' + ultimaActividadCell(c.ultima_actividad) + '</td>'
                + '</tr>';
        });
        html += '</tbody></table></div>';

        // Footer: paginación + totales globales del dataset filtrado.
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
            +   totalFiltrado + ' ' + pluralize(totalFiltrado, 'cliente', 'clientes')
            +   (_plantillaActiva !== 'todas' ? ' <span class="rep-table-foot-flt">(filtro: ' + escapeHTML(_plantillaActiva) + ')</span>' : '')
            + '</span>'
            + pagHtml
            + '<span class="rep-table-foot-right">Cobrado total: <strong>' + fmtFull(totalCobrado) + '</strong></span>'
            + '</footer>';
        wrap.innerHTML = html;

        // Click en fila → abre el widget del cliente inline. NO navega.
        // openClienteModal viene de crm_main.js (incluido en esta página).
        wrap.querySelectorAll('tr[data-cliente-id]').forEach(function (tr) {
            tr.addEventListener('click', function () {
                var id = parseInt(tr.getAttribute('data-cliente-id'), 10);
                var nombre = tr.getAttribute('data-cliente-nombre') || '';
                if (!id) return;
                if (typeof window.openClienteModal === 'function') {
                    window.openClienteModal(id, nombre, 'oportunidades');
                } else {
                    // Fallback: si por algún motivo el JS del CRM no cargó,
                    // navegar al CRM filtrado por cliente.
                    window.location.href = '/app/todos/?tab=crm&cliente=' + id;
                }
            });
        });

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
        var mode = SORT_MODES[_sortMode] || SORT_MODES.abiertas_desc;
        if (lbl) lbl.textContent = mode.label;
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

    function exportarCSV() {
        if (!_lastData) return;
        var rows = ordenar(aplicarPlantilla(_lastData.clientes || []));
        if (!rows.length) { alert('No hay datos para exportar.'); return; }

        var sortLabel = (SORT_MODES[_sortMode] || SORT_MODES.abiertas_desc).label;
        var totalCobrado = rows.reduce(function (s, c) { return s + (c.cobrado_total_mxn || 0); }, 0);

        var metaLines = [
            '# Reporte: Por Cliente',
            '# Exportado por: ' + (window._REP_USER || '—'),
            '# Fecha y hora de exportación: ' + nowLocal(),
            '# Filtros aplicados:',
            '#   - Vendedor asignado: ' + (_filtros.vendedor ? vendedorLabel(_filtros.vendedor) : 'Todos los visibles'),
            '#   - Mínimo de opps abiertas: ' + (_filtros.opps_min || '0'),
            '#   - Búsqueda: ' + (_filtros.q || '—'),
            '#   - Vista rápida: ' + _plantillaActiva,
            '#   - Orden: ' + sortLabel,
            '# Total clientes exportados: ' + rows.length,
            '# Cobrado total MXN (histórico, del Dashboard): $' + Math.round(totalCobrado).toLocaleString('en-US'),
            '',
        ];

        var headers = ['Cliente', 'Vendedor', 'Opps Abiertas', 'Opps Ganadas', 'Opps Perdidas', 'Cobrado Total MXN', 'Última actividad'];
        var csvRows = rows.map(function (c) {
            return [
                c.nombre || '', c.asignado_a || '',
                c.opps_abiertas || 0, c.opps_ganadas || 0, c.opps_perdidas || 0,
                c.cobrado_total_mxn || 0,
                c.ultima_actividad || '',
            ];
        });

        var csv = metaLines.join('\n') + '\n'
            + [headers].concat(csvRows).map(function (row) {
                return row.map(csvEscape).join(',');
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
    // Lee filtros iniciales del URL (cuando el reporte se carga dentro
    // del iframe del dashboard SPA, las pills del dashboard se propagan).
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
