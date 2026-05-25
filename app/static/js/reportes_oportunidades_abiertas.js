/* ═══════════════════════════════════════════════════════════════════
 * reportes_oportunidades_abiertas.js
 * Reporte 1: Oportunidades Abiertas — render del cliente.
 *
 *   - Carga el endpoint /app/api/reportes/oportunidades-abiertas/
 *   - Render: KPIs + filtros + tablas agrupadas por pipeline → etapa
 *   - Click en fila → /app/todos/?tab=crm&open_opp=ID
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var ENDPOINT = '/app/api/reportes/oportunidades-abiertas/';

    var $kpis = null, $content = null;
    var $fPipeline = null, $fVendedor = null, $fEtapa = null, $fBuscar = null;
    var $btnClear = null, $btnReload = null, $btnExport = null;
    var _searchTimer = null;
    var _filtrosCargados = false;  // ¿ya pintamos los dropdowns de vendedor/etapa?

    function $(id) { return document.getElementById(id); }

    function fmtMoney(n) {
        if (n == null) return '$0';
        var v = Math.round(n);
        return '$' + v.toLocaleString('en-US');
    }

    function fmtMoneyAbrev(n) {
        if (!n) return '$0';
        var abs = Math.abs(n);
        if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
        if (abs >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
        return '$' + Math.round(n);
    }

    function escapeHTML(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtFecha(iso) {
        if (!iso) return null;
        try {
            var d = new Date(iso);
            if (isNaN(d.getTime())) return null;
            var meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
            return d.getDate() + ' ' + meses[d.getMonth()];
        } catch (e) { return null; }
    }

    function getFiltros() {
        var p = new URLSearchParams();
        if ($fPipeline.value) p.set('pipeline', $fPipeline.value);
        if ($fVendedor.value) p.set('vendedor', $fVendedor.value);
        if ($fEtapa.value) p.set('etapa', $fEtapa.value);
        var q = ($fBuscar.value || '').trim();
        if (q) p.set('q', q);
        return p.toString();
    }

    function renderKpis(data) {
        var html = '';
        html += '<div class="rep-kpi"><div class="rep-kpi-label">Total Abiertas</div>'
            + '<div class="rep-kpi-value">' + data.total_global + '</div>'
            + '<div class="rep-kpi-sub">' + fmtMoney(data.monto_total_global) + ' MXN</div></div>';
        (data.pipelines || []).forEach(function (pl) {
            html += '<div class="rep-kpi"><div class="rep-kpi-label">' + escapeHTML(pl.pipeline_label) + '</div>'
                + '<div class="rep-kpi-value">' + pl.count + '</div>'
                + '<div class="rep-kpi-sub">' + fmtMoney(pl.monto_mxn) + ' MXN</div></div>';
        });
        $kpis.innerHTML = html;
    }

    function renderProximoPaso(p) {
        if (!p) return '<span style="color:#94A3B8;">—</span>';
        var ic = p.tipo === 'tarea'
            ? '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>'
            : '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
        var fecha = fmtFecha(p.fecha);
        var fechaSpan = '';
        if (fecha) {
            fechaSpan = p.vencida
                ? '<span class="rep-overdue" style="font-size:0.72rem;margin-left:6px;">' + fecha + ' · vencida</span>'
                : '<span style="font-size:0.72rem;color:#94A3B8;margin-left:6px;">' + fecha + '</span>';
        }
        return '<span style="display:inline-flex;align-items:center;gap:5px;color:' + (p.vencida ? '#DC2626' : '#475569') + ';">'
            + ic + escapeHTML(p.titulo)
            + '</span>' + fechaSpan;
    }

    function renderOCC(archivos) {
        if (!archivos || !archivos.length) return '<span style="color:#94A3B8;">Sin OC</span>';
        if (archivos.length === 1) return '<span title="' + escapeHTML(archivos[0]) + '">' + escapeHTML(archivos[0]) + '</span>';
        var first = archivos[0];
        var resto = archivos.length - 1;
        return '<span title="' + escapeHTML(archivos.join('\n')) + '">' + escapeHTML(first)
            + ' <em style="font-style:normal;color:#94A3B8;">+ ' + resto + ' más</em></span>';
    }

    function renderContent(data) {
        if (!data.pipelines || !data.pipelines.length) {
            $content.innerHTML = '<div class="rep-empty">'
                + '<svg width="32" height="32" fill="none" stroke="#CBD5E1" stroke-width="1.6" viewBox="0 0 24 24" style="margin-bottom:8px;"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>'
                + '<h3>Sin oportunidades abiertas</h3>'
                + '<p>No hay opp en estado "Vendido en adelante" con los filtros actuales.</p>'
                + '</div>';
            return;
        }

        var html = '';
        data.pipelines.forEach(function (pl) {
            pl.etapas.forEach(function (et) {
                html += '<div class="rep-section">';
                html += '<div class="rep-section-head">'
                    + '<h3 class="rep-section-title">' + escapeHTML(pl.pipeline_label) + ' · ' + escapeHTML(et.etapa) + '</h3>'
                    + '<span class="rep-section-meta">' + et.count + ' opps · ' + fmtMoney(et.monto_mxn) + '</span>'
                    + '</div>';
                html += '<table class="rep-table"><thead><tr>'
                    + '<th style="width:32%;">Oportunidad</th>'
                    + '<th style="width:18%;">Cliente</th>'
                    + '<th style="width:13%;">Vendedor</th>'
                    + '<th class="rep-text-right" style="width:12%;">Monto</th>'
                    + '<th style="width:13%;">OC del Drive</th>'
                    + '<th style="width:12%;">Próximo paso</th>'
                    + '</tr></thead><tbody>';
                et.oportunidades.forEach(function (o) {
                    html += '<tr data-opp-id="' + o.id + '">'
                        + '<td><strong>' + escapeHTML(o.titulo || '(sin título)') + '</strong></td>'
                        + '<td>' + escapeHTML(o.cliente || '—') + '</td>'
                        + '<td>' + escapeHTML(o.vendedor || '—') + '</td>'
                        + '<td class="rep-text-right rep-mono"><strong>' + fmtMoney(o.monto_mxn) + '</strong></td>'
                        + '<td>' + renderOCC(o.archivos_occ) + '</td>'
                        + '<td>' + renderProximoPaso(o.proximo_paso) + '</td>'
                        + '</tr>';
                });
                html += '</tbody></table></div>';
            });
        });
        $content.innerHTML = html;

        // Click en fila → abre la opp en el CRM
        $content.querySelectorAll('tr[data-opp-id]').forEach(function (tr) {
            tr.addEventListener('click', function () {
                var id = tr.getAttribute('data-opp-id');
                if (id) window.location.href = '/app/todos/?tab=crm&open_opp=' + id;
            });
        });
    }

    function populateFiltros(data) {
        if (_filtrosCargados) return;
        var fd = data.filtros_disponibles || {};
        // Vendedores
        (fd.vendedores || []).forEach(function (v) {
            var opt = document.createElement('option');
            opt.value = v.id; opt.textContent = v.nombre;
            $fVendedor.appendChild(opt);
        });
        // Etapas — agrupadas por pipeline para que el usuario sepa de cuál son
        var em = fd.etapas_por_pipeline || {};
        Object.keys(em).forEach(function (pl) {
            var og = document.createElement('optgroup');
            og.label = pl.charAt(0).toUpperCase() + pl.slice(1);
            em[pl].forEach(function (et) {
                var opt = document.createElement('option');
                opt.value = et; opt.textContent = et;
                og.appendChild(opt);
            });
            $fEtapa.appendChild(og);
        });
        _filtrosCargados = true;
    }

    function loadReport() {
        $content.innerHTML = '<div class="rep-loading">Cargando reporte…</div>';
        var qs = getFiltros();
        fetch(ENDPOINT + (qs ? '?' + qs : ''), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.ok) {
                    $content.innerHTML = '<div class="rep-empty"><h3>Error</h3><p>' + escapeHTML(data.error || 'No se pudo cargar el reporte') + '</p></div>';
                    return;
                }
                populateFiltros(data);
                renderKpis(data);
                renderContent(data);
            })
            .catch(function (err) {
                $content.innerHTML = '<div class="rep-empty"><h3>Error de conexión</h3><p>' + escapeHTML(String(err)) + '</p></div>';
            });
    }

    document.addEventListener('DOMContentLoaded', function () {
        $kpis = $('repOAKpis');
        $content = $('repOAContent');
        $fPipeline = $('repOAFiltroPipeline');
        $fVendedor = $('repOAFiltroVendedor');
        $fEtapa = $('repOAFiltroEtapa');
        $fBuscar = $('repOAFiltroBuscar');
        $btnClear = $('repOAFiltroClear');
        $btnReload = $('repOAReload');
        $btnExport = $('repOAExport');

        if (!$kpis || !$content) return;  // template incorrecto

        [$fPipeline, $fVendedor, $fEtapa].forEach(function (el) {
            if (el) el.addEventListener('change', loadReport);
        });
        $fBuscar.addEventListener('input', function () {
            clearTimeout(_searchTimer);
            _searchTimer = setTimeout(loadReport, 280);
        });
        $btnClear.addEventListener('click', function () {
            $fPipeline.value = '';
            $fVendedor.value = '';
            $fEtapa.value = '';
            $fBuscar.value = '';
            loadReport();
        });
        $btnReload.addEventListener('click', loadReport);
        $btnExport.addEventListener('click', function () {
            alert('Exportar a Excel — próximamente.');
        });

        loadReport();
    });
})();
