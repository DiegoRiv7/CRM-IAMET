/*
  crm_control_v2.js — Handler de la tab "Control" del dashboard.

  V2 (Boy Scout). NO modifica crm_main.js legacy. Estrategia:

    1. MONKEY-PATCH a window._crmSetMode (instalado al cargar este script).
       Mientras _controlActivo sea true, las llamadas con cualquier mode que
       NO sea '__control__' o 'control' se ignoran. Esto bloquea los refreshes
       periódicos del legacy (línea ~2291 de crm_main.js) que re-aplican el
       último modo cada vez que se carga el panel de clientes.

    2. CAPTURE-PHASE listeners en los botones de las otras tabs. El onclick
       inline del legacy ("_crmSetMode('oportunidades')") corre en bubbling.
       Si usamos capture, nuestro desactivarControl() corre PRIMERO → apaga
       _controlActivo → el guard ya no bloquea → el onclick legacy ejecuta
       normalmente.

    3. PERSISTENCIA: al cargar, si localStorage tiene 'control' → re-activar.
       Doble retry (50ms y 800ms) para sobrevivir a fetches async del legacy
       que podrían tratar de pintar Oportunidades por encima.

  Fetch:
    GET /app/api/control/proyectos/?mes=06&anio=2026&vendedores=...
    El backend respeta lógica supervisor (ve todo) vs no-supervisor (solo su
    equipo). Mes/anio/vendedores se leen de _CRM_CONFIG (filtros del topbar).

  Lado izquierdo de la tabla = datos REALES (cliente, PO, oportunidad, jornadas).
  Lado derecho (timeline, monto, utilidad, etc.) = placeholders por ahora.
*/
(function () {
    'use strict';

    var _controlActivo = false;
    var _initialMode = null;
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
    // FETCH + RENDER
    // ─────────────────────────────────────────────────────────────────────

    function getFiltrosActuales() {
        var cfg = window._CRM_CONFIG || {};
        return {
            mes: cfg.mesFiltro || '',
            anio: cfg.anioFiltro || '',
            vendedores: cfg.vendedoresFilter || ''
        };
    }

    function setLoading() {
        var tbody = document.getElementById('crmControlTbody');
        if (!tbody) return;
        tbody.innerHTML =
            '<div class="crm-ctrl-state crm-ctrl-state--loading">' +
                '<div class="crm-ctrl-spinner" aria-hidden="true"></div>' +
                '<span>Cargando proyectos…</span>' +
            '</div>';
    }

    function setError(msg) {
        var tbody = document.getElementById('crmControlTbody');
        if (!tbody) return;
        tbody.innerHTML =
            '<div class="crm-ctrl-state crm-ctrl-state--error">' +
                '<span>No se pudieron cargar los proyectos. ' + escHtml(msg || '') + '</span>' +
            '</div>';
    }

    function setEmpty() {
        var tbody = document.getElementById('crmControlTbody');
        if (!tbody) return;
        tbody.innerHTML =
            '<div class="crm-ctrl-state crm-ctrl-state--empty">' +
                '<span>No hay proyectos para el periodo / vendedor seleccionado.</span>' +
            '</div>';
    }

    function renderRow(p) {
        var cliente = escHtml(p.cliente || 'Sin cliente');
        var po = (p.po || '').trim();
        var oppName = escHtml(p.oportunidad_nombre || '—');
        var jornadas = (p.jornadas || '').trim();

        var poHtml = po
            ? escHtml(po)
            : '<span class="crm-ctrl-empty-val">sin PO</span>';
        var jornadasHtml = jornadas
            ? '<span class="crm-ctrl-pill crm-ctrl-pill--normal">' + escHtml(jornadas) + '</span>'
            : '<span class="crm-ctrl-empty-val">sin levantamiento</span>';

        return '' +
            '<div class="crm-ctrl-row" role="row" data-proyecto-id="' + p.proyecto_id + '">' +
                '<div class="crm-ctrl-col crm-ctrl-col--cliente">' +
                    '<span class="crm-ctrl-tag crm-ctrl-tag--accent">' + cliente + '</span>' +
                '</div>' +
                '<div class="crm-ctrl-col crm-ctrl-col--id">' + poHtml + '</div>' +
                '<div class="crm-ctrl-col crm-ctrl-col--desc">' + oppName + '</div>' +
                '<div class="crm-ctrl-col crm-ctrl-col--jornadas">' + jornadasHtml + '</div>' +
                // Columnas placeholder — se conectan después
                '<div class="crm-ctrl-col crm-ctrl-col--timeline">' +
                    '<div class="crm-ctrl-track"></div>' +
                '</div>' +
                '<div class="crm-ctrl-col crm-ctrl-col--po crm-ctrl-cell--placeholder">—</div>' +
                '<div class="crm-ctrl-col crm-ctrl-col--util crm-ctrl-cell--placeholder">—</div>' +
                '<div class="crm-ctrl-col crm-ctrl-col--dias crm-ctrl-cell--placeholder">—</div>' +
                '<div class="crm-ctrl-col crm-ctrl-col--tec crm-ctrl-cell--placeholder">—</div>' +
                '<div class="crm-ctrl-col crm-ctrl-col--coment crm-ctrl-cell--placeholder">—</div>' +
            '</div>';
    }

    function renderRows(proyectos) {
        var tbody = document.getElementById('crmControlTbody');
        if (!tbody) return;
        if (!proyectos || !proyectos.length) {
            setEmpty();
            actualizarStats([], getFiltrosActuales());
            return;
        }
        tbody.innerHTML = proyectos.map(renderRow).join('');
        actualizarStats(proyectos, getFiltrosActuales());
    }

    function actualizarStats(proyectos, filtros) {
        var total = proyectos.length;
        var conPo = 0, conJornadas = 0, sinLev = 0;
        for (var i = 0; i < proyectos.length; i++) {
            var p = proyectos[i];
            if ((p.po || '').trim()) conPo++;
            if ((p.jornadas || '').trim()) conJornadas++;
            if (!p.levantamiento_id) sinLev++;
        }
        var setText = function (id, v) {
            var el = document.getElementById(id);
            if (el) el.textContent = v;
        };
        setText('ctrlStatProyectos', total);
        setText('ctrlStatConPo', conPo);
        setText('ctrlStatConJornadas', conJornadas);
        setText('ctrlStatSinLev', sinLev);

        var periodoTxt = '—';
        if (filtros.mes && filtros.mes !== 'todos') {
            periodoTxt = (MESES_LABEL[filtros.mes] || filtros.mes) + ' ' + (filtros.anio || '');
        } else if (filtros.anio && filtros.anio !== 'todos') {
            periodoTxt = filtros.anio;
        } else {
            periodoTxt = 'Todos';
        }
        setText('ctrlStatPeriodo', periodoTxt);

        // Footer
        var footerLeft = document.getElementById('footerLeft');
        var footerRight = document.getElementById('footerRight');
        if (footerLeft) footerLeft.textContent = total + ' proyectos en logística';
        if (footerRight) {
            footerRight.textContent = conPo + ' con PO · ' + conJornadas + ' con jornadas';
        }
    }

    var _inflightAbort = null;
    function fetchProyectos() {
        var f = getFiltrosActuales();
        var qs = '?mes=' + encodeURIComponent(f.mes) +
                 '&anio=' + encodeURIComponent(f.anio);
        if (f.vendedores) qs += '&vendedores=' + encodeURIComponent(f.vendedores);

        // Cancelar fetch previo si seguía abierto
        if (_inflightAbort && typeof _inflightAbort.abort === 'function') {
            try { _inflightAbort.abort(); } catch (e) {}
        }
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        _inflightAbort = ctrl;

        setLoading();

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

        try {
            if (typeof window._crmSetMode === 'function') {
                window._crmSetMode('__control__');
            }
        } catch (e) { /* no-op */ }

        IDS_OTROS_KPI.forEach(hide);

        var btn = document.getElementById('crmModeControl');
        if (btn) btn.classList.add('active');

        var section = document.getElementById('ckControlSection');
        if (section) section.style.display = 'block';

        try { localStorage.setItem('crm_clientes_mode', 'control'); } catch (e) {}

        // Fetch en cada activación — los filtros del topbar pueden haber cambiado.
        fetchProyectos();
    }

    function desactivarControl() {
        _controlActivo = false;
        var btn = document.getElementById('crmModeControl');
        if (btn) btn.classList.remove('active');
        var section = document.getElementById('ckControlSection');
        if (section) section.style.display = 'none';
    }

    // ─────────────────────────────────────────────────────────────────────
    // MONKEY-PATCH al _crmSetMode legacy
    // ─────────────────────────────────────────────────────────────────────

    function instalarGuard() {
        var orig = window._crmSetMode;
        if (typeof orig !== 'function') return false;
        if (orig._controlPatched) return true;
        var patched = function (mode) {
            if (_controlActivo && mode !== '__control__' && mode !== 'control') {
                return;
            }
            return orig.apply(this, arguments);
        };
        patched._controlPatched = true;
        patched._original = orig;
        window._crmSetMode = patched;
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────────────────────────────

    function init() {
        var btn = document.getElementById('crmModeControl');
        if (!btn) return;

        if (!instalarGuard()) {
            setTimeout(instalarGuard, 0);
        }

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            activarControl();
        });

        // Capture-phase: corremos ANTES del onclick inline del legacy.
        IDS_OTROS_BTNS.forEach(function (id) {
            var b = document.getElementById(id);
            if (b) b.addEventListener('click', desactivarControl, true);
        });
        var btnRep = document.getElementById('crmModeReportes');
        if (btnRep) btnRep.addEventListener('click', desactivarControl, true);

        // Botón Refrescar
        var btnRefresh = document.getElementById('crmControlRefresh');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', function (e) {
                e.preventDefault();
                if (_controlActivo) fetchProyectos();
            });
        }

        // Persistencia: si el storage decía 'control', re-activar.
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
        get activo() { return _controlActivo; }
    };
})();
