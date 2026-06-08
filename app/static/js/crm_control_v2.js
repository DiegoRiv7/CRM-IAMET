/*
  crm_control_v2.js — Handler de la tab "Control" del dashboard.

  Layout SPLIT: lista de proyectos (izq) + timeline maestro (der).
  Cada proyecto se renderiza DOS veces (un item en cada panel) con el mismo
  data-proyecto-id. Click en cualquier lado highlightea ambos.

  V2 (Boy Scout): NO modifica crm_main.js legacy.
    - Monkey-patch a window._crmSetMode bloquea refreshes a otros modos
      mientras estamos en Control.
    - Capture-phase listeners en las otras tabs apagan la flag antes de
      que el onclick legacy ejecute.
    - localStorage 'crm_clientes_mode' = 'control' persiste la selección.

  Fetch: GET /app/api/control/proyectos/?mes=06&anio=2026&vendedores=...
*/
(function () {
    'use strict';

    var _controlActivo = false;
    var _initialMode = null;
    var _selectedId = null;
    try { _initialMode = localStorage.getItem('crm_clientes_mode'); } catch (e) {}

    var IDS_OTROS_KPI = [
        'ckKpiRow', 'ckKpiRowProsp', 'ckKpiRowProy',
        'ckChartsSection', 'ckChartsSectionProsp', 'ckChartsSectionProy',
        'ckDetalleSection', 'ckClientesTablaSection'
    ];
    var IDS_OTROS_BTNS = [
        'crmModeOpp', 'crmModeProsp', 'crmModeProyectos', 'crmModeClientes'
    ];

    var MESES_LABEL = {
        '01': 'Enero', '02': 'Febrero', '03': 'Marzo',     '04': 'Abril',
        '05': 'Mayo',  '06': 'Junio',   '07': 'Julio',     '08': 'Agosto',
        '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
    };
    var MESES_SHORT = {
        '01': 'ENE', '02': 'FEB', '03': 'MAR', '04': 'ABR',
        '05': 'MAY', '06': 'JUN', '07': 'JUL', '08': 'AGO',
        '09': 'SEP', '10': 'OCT', '11': 'NOV', '12': 'DIC'
    };

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

    // ─────────────────────────────────────────────────────────────────────
    // FILTROS Y FETCH
    // ─────────────────────────────────────────────────────────────────────

    function getFiltrosActuales() {
        var cfg = window._CRM_CONFIG || {};
        return {
            mes: cfg.mesFiltro || '',
            anio: cfg.anioFiltro || '',
            vendedores: cfg.vendedoresFilter || ''
        };
    }

    function setLoadingPanels() {
        var list = document.getElementById('crmControlList');
        var tl = document.getElementById('crmControlTimeline');
        var html =
            '<div class="crm-ctrl-state crm-ctrl-state--loading">' +
                '<div class="crm-ctrl-spinner" aria-hidden="true"></div>' +
                '<span>Cargando proyectos…</span>' +
            '</div>';
        if (list) list.innerHTML = html;
        if (tl)   tl.innerHTML = '<div class="crm-ctrl-state crm-ctrl-state--placeholder"><span>Esperando datos…</span></div>';
    }

    function setEmpty() {
        var list = document.getElementById('crmControlList');
        var tl = document.getElementById('crmControlTimeline');
        if (list) list.innerHTML = '<div class="crm-ctrl-state crm-ctrl-state--empty"><span>No hay proyectos para el periodo / vendedor.</span></div>';
        if (tl)   tl.innerHTML = '<div class="crm-ctrl-state crm-ctrl-state--placeholder"><span>—</span></div>';
    }

    function setError(msg) {
        var list = document.getElementById('crmControlList');
        var tl = document.getElementById('crmControlTimeline');
        if (list) list.innerHTML = '<div class="crm-ctrl-state crm-ctrl-state--error"><span>Error: ' + escHtml(msg || '') + '</span></div>';
        if (tl)   tl.innerHTML = '<div class="crm-ctrl-state crm-ctrl-state--placeholder"><span>—</span></div>';
    }

    // ─────────────────────────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────────────────────────

    function renderItemLista(p) {
        var cliente = escHtml(p.cliente || 'Sin cliente');
        var po = (p.po || '').trim();
        var oppName = escHtml(p.oportunidad_nombre || '—');
        var jornadas = (p.jornadas || '').trim();

        var poHtml = po
            ? '<span class="crm-ctrl-item-po">PO ' + escHtml(po) + '</span>'
            : '<span class="crm-ctrl-item-po crm-ctrl-item-po--empty">sin PO</span>';

        var jornadasHtml = jornadas
            ? '<span class="crm-ctrl-item-jornadas">' + escHtml(jornadas) + '</span>'
            : '<span class="crm-ctrl-item-jornadas crm-ctrl-item-jornadas--empty">sin levantamiento</span>';

        return '' +
            '<div class="crm-ctrl-item" data-proyecto-id="' + p.proyecto_id + '" role="button">' +
                '<div class="crm-ctrl-item-top">' +
                    '<span class="crm-ctrl-item-cliente" title="' + cliente + '">' + cliente + '</span>' +
                    poHtml +
                '</div>' +
                '<div class="crm-ctrl-item-bottom">' +
                    '<span class="crm-ctrl-item-opp" title="' + oppName + '">' + oppName + '</span>' +
                    jornadasHtml +
                '</div>' +
            '</div>';
    }

    function renderTimelineRow(p, idx) {
        // Por ahora todas las barras son "ghost" — no tenemos fechas reales.
        // Cuando conectemos OCs/fecha_inicio/fecha_fin, calculamos left/width
        // y cambiamos crm-ctrl-bar--ghost por crm-ctrl-bar con color.
        var ghostLeft = 12 + (idx % 5) * 8;  // distribuye visualmente
        var ghostWidth = 30 + (idx % 3) * 10;

        return '' +
            '<div class="crm-ctrl-timeline-row" data-proyecto-id="' + p.proyecto_id + '" role="button">' +
                '<div class="crm-ctrl-bar crm-ctrl-bar--ghost" ' +
                     'style="left:' + ghostLeft + '%;width:' + ghostWidth + '%;">' +
                    '<span class="crm-ctrl-bar-marker crm-ctrl-bar-marker--start"></span>' +
                    '<span class="crm-ctrl-bar-marker crm-ctrl-bar-marker--end"></span>' +
                    '<span class="crm-ctrl-bar-ghost-label">pendiente fechas</span>' +
                '</div>' +
            '</div>';
    }

    function renderRows(proyectos) {
        var list = document.getElementById('crmControlList');
        var tl = document.getElementById('crmControlTimeline');
        if (!proyectos || !proyectos.length) {
            setEmpty();
            actualizarStats([], getFiltrosActuales());
            return;
        }
        if (list) list.innerHTML = proyectos.map(renderItemLista).join('');
        if (tl)   tl.innerHTML = proyectos.map(renderTimelineRow).join('');

        wireSelection();
        actualizarStats(proyectos, getFiltrosActuales());

        // Restaurar selección anterior si seguía vigente.
        if (_selectedId) {
            var stillPresent = proyectos.some(function (p) {
                return String(p.proyecto_id) === String(_selectedId);
            });
            if (stillPresent) selectProyecto(_selectedId, false);
            else _selectedId = null;
        }
    }

    function wireSelection() {
        function bindAll(sel) {
            var els = document.querySelectorAll(sel);
            for (var i = 0; i < els.length; i++) {
                els[i].addEventListener('click', function () {
                    var id = this.getAttribute('data-proyecto-id');
                    selectProyecto(id, true);
                });
            }
        }
        bindAll('.crm-ctrl-item[data-proyecto-id]');
        bindAll('.crm-ctrl-timeline-row[data-proyecto-id]');
    }

    function selectProyecto(id, scrollIntoView) {
        _selectedId = id;
        var allItems = document.querySelectorAll('[data-proyecto-id]');
        for (var i = 0; i < allItems.length; i++) {
            allItems[i].classList.toggle(
                'is-selected',
                allItems[i].getAttribute('data-proyecto-id') === String(id)
            );
        }
        if (!scrollIntoView) return;
        // Scrollea solo el panel opuesto (el otro panel ya está visible donde
        // se hizo el click). Sincronizamos visualmente ambos.
        var rowTimeline = document.querySelector(
            '.crm-ctrl-timeline-row[data-proyecto-id="' + id + '"]'
        );
        if (rowTimeline && typeof rowTimeline.scrollIntoView === 'function') {
            rowTimeline.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        var itemLista = document.querySelector(
            '.crm-ctrl-item[data-proyecto-id="' + id + '"]'
        );
        if (itemLista && typeof itemLista.scrollIntoView === 'function') {
            itemLista.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function actualizarStats(proyectos, filtros) {
        var total = proyectos.length;
        var conPo = 0, conJornadas = 0;
        for (var i = 0; i < proyectos.length; i++) {
            var p = proyectos[i];
            if ((p.po || '').trim()) conPo++;
            if ((p.jornadas || '').trim()) conJornadas++;
        }
        var setText = function (id, v) {
            var el = document.getElementById(id);
            if (el) el.textContent = v;
        };
        setText('ctrlStatProyectos', total);
        setText('ctrlStatConPo', conPo);
        setText('ctrlStatConJornadas', conJornadas);
        setText('ctrlListCount', total);

        var periodoTxt = 'Todos';
        if (filtros.mes && filtros.mes !== 'todos') {
            periodoTxt = (MESES_LABEL[filtros.mes] || filtros.mes) + ' ' + (filtros.anio || '');
        } else if (filtros.anio && filtros.anio !== 'todos') {
            periodoTxt = filtros.anio;
        }
        setText('ctrlStatPeriodo', periodoTxt);

        // Header del timeline: refleja el mes filtrado + el siguiente.
        actualizarTimelineHeader(filtros);

        var footerLeft = document.getElementById('footerLeft');
        var footerRight = document.getElementById('footerRight');
        if (footerLeft) footerLeft.textContent = total + ' proyectos en logística';
        if (footerRight) footerRight.textContent = conPo + ' con PO · ' + conJornadas + ' con levantamiento';
    }

    function actualizarTimelineHeader(filtros) {
        var cont = document.getElementById('ctrlTimelineMonths');
        if (!cont) return;
        var mes = filtros.mes;
        if (!mes || mes === 'todos') {
            // Sin mes específico: mostramos un periodo genérico (el año).
            var anio = filtros.anio || '';
            cont.innerHTML =
                '<span class="crm-ctrl-month-chip">' + escHtml(anio || 'PERIODO') + '</span>' +
                '<span class="crm-ctrl-month-line" aria-hidden="true"></span>' +
                '<span class="crm-ctrl-month-chip">FIN</span>';
            return;
        }
        var m1 = mes;
        var m1Num = parseInt(m1, 10);
        var m2Num = m1Num === 12 ? 1 : m1Num + 1;
        var m2 = (m2Num < 10 ? '0' : '') + m2Num;
        cont.innerHTML =
            '<span class="crm-ctrl-month-chip">' + (MESES_SHORT[m1] || m1) + '</span>' +
            '<span class="crm-ctrl-month-line" aria-hidden="true"></span>' +
            '<span class="crm-ctrl-month-chip">' + (MESES_SHORT[m2] || m2) + '</span>';
    }

    var _inflightAbort = null;
    function fetchProyectos() {
        var f = getFiltrosActuales();
        var qs = '?mes=' + encodeURIComponent(f.mes) +
                 '&anio=' + encodeURIComponent(f.anio);
        if (f.vendedores) qs += '&vendedores=' + encodeURIComponent(f.vendedores);

        if (_inflightAbort && typeof _inflightAbort.abort === 'function') {
            try { _inflightAbort.abort(); } catch (e) {}
        }
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        _inflightAbort = ctrl;

        setLoadingPanels();

        return fetch('/app/api/control/proyectos/' + qs, {
            credentials: 'same-origin',
            signal: ctrl ? ctrl.signal : undefined
        })
            .then(function (r) { return r.json(); })
            .then(function (resp) {
                if (resp && resp.ok) {
                    renderRows(resp.data || []);
                } else {
                    setError(resp && resp.error ? resp.error : 'Error desconocido.');
                }
            })
            .catch(function (err) {
                if (err && err.name === 'AbortError') return;
                setError(err && err.message ? err.message : '');
            });
    }

    // ─────────────────────────────────────────────────────────────────────
    // ACTIVAR / DESACTIVAR CONTROL
    // ─────────────────────────────────────────────────────────────────────

    function activarControl() {
        _controlActivo = true;
        try { if (typeof window._crmSetMode === 'function') window._crmSetMode('__control__'); } catch (e) {}
        IDS_OTROS_KPI.forEach(hide);

        var btn = document.getElementById('crmModeControl');
        if (btn) btn.classList.add('active');
        var section = document.getElementById('ckControlSection');
        if (section) section.style.display = 'block';

        try { localStorage.setItem('crm_clientes_mode', 'control'); } catch (e) {}
        fetchProyectos();
    }

    function desactivarControl() {
        _controlActivo = false;
        var btn = document.getElementById('crmModeControl');
        if (btn) btn.classList.remove('active');
        var section = document.getElementById('ckControlSection');
        if (section) section.style.display = 'none';
    }

    function instalarGuard() {
        var orig = window._crmSetMode;
        if (typeof orig !== 'function') return false;
        if (orig._controlPatched) return true;
        var patched = function (mode) {
            if (_controlActivo && mode !== '__control__' && mode !== 'control') return;
            return orig.apply(this, arguments);
        };
        patched._controlPatched = true;
        patched._original = orig;
        window._crmSetMode = patched;
        return true;
    }

    function init() {
        var btn = document.getElementById('crmModeControl');
        if (!btn) return;

        if (!instalarGuard()) setTimeout(instalarGuard, 0);

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            activarControl();
        });

        IDS_OTROS_BTNS.forEach(function (id) {
            var b = document.getElementById(id);
            if (b) b.addEventListener('click', desactivarControl, true);
        });
        var btnRep = document.getElementById('crmModeReportes');
        if (btnRep) btnRep.addEventListener('click', desactivarControl, true);

        var btnRefresh = document.getElementById('crmControlRefresh');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', function (e) {
                e.preventDefault();
                if (_controlActivo) fetchProyectos();
            });
        }

        if (_initialMode === 'control') {
            setTimeout(activarControl, 50);
            setTimeout(function () { if (!_controlActivo) activarControl(); }, 800);
            setTimeout(function () { if (!_controlActivo) activarControl(); }, 2000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window._crmControl = {
        open: activarControl,
        close: desactivarControl,
        refresh: fetchProyectos,
        select: selectProyecto,
        get activo() { return _controlActivo; }
    };
})();
