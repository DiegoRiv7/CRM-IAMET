/*
  crm_control_v2.js — Handler de la tab "Control" del dashboard.

  Layout SPLIT: lista de proyectos (izq) + timeline maestro (der).
  Cada proyecto se renderiza DOS veces (un item en cada panel) con el mismo
  data-proyecto-id. Click en cualquier lado highlightea ambos.

  KPIs DINÁMICOS arriba:
    - Vista general (sin selección): Proyectos / Con PO / Con levantamiento / Periodo
    - Proyecto seleccionado: Monto PO / Utilidad / Días ejecución / Técnicos
    - Click en mismo proyecto = deseleccionar (vuelve a vista general)
    - Chip flotante "Mostrando: <proyecto>" arriba de los stats con X para cerrar

  Mientras Control está activo: <body> tiene .crm-control-active que oculta el
  .crm-footer global del CRM (para liberar espacio vertical).

  V2 (Boy Scout): NO modifica crm_main.js legacy. Monkey-patch a _crmSetMode
  bloquea refreshes mientras estamos en Control.

  Fetch: GET /app/api/control/proyectos/?mes=06&anio=2026&vendedores=...
*/
(function () {
    'use strict';

    var _controlActivo = false;
    var _initialMode = null;
    var _selectedId = null;
    var _proyectosCache = [];
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
        '01':'Enero','02':'Febrero','03':'Marzo','04':'Abril','05':'Mayo',
        '06':'Junio','07':'Julio','08':'Agosto','09':'Septiembre',
        '10':'Octubre','11':'Noviembre','12':'Diciembre'
    };
    var MESES_SHORT = {
        '01':'ENE','02':'FEB','03':'MAR','04':'ABR','05':'MAY','06':'JUN',
        '07':'JUL','08':'AGO','09':'SEP','10':'OCT','11':'NOV','12':'DIC'
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
    function fmtMoney(n) {
        var v = Number(n || 0);
        if (!v) return '$0';
        if (v >= 1e6) return '$' + (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
        if (v >= 1e3) return '$' + (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
        return '$' + Math.round(v).toLocaleString('en-US');
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
        if (list) list.innerHTML =
            '<div class="crm-ctrl-state crm-ctrl-state--loading">' +
                '<div class="crm-ctrl-spinner" aria-hidden="true"></div>' +
                '<span>Cargando proyectos…</span>' +
            '</div>';
        if (tl) tl.innerHTML =
            '<div class="crm-ctrl-state crm-ctrl-state--placeholder"><span>Esperando datos…</span></div>';
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
    // RENDER LISTA + TIMELINE
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

    function renderTimelineRow(p) {
        // Row vacía. Las barras se agregan manualmente desde el botón
        // "Agregar material". El hint sutil aparece solo cuando el
        // proyecto está seleccionado, para invitar a usar el botón.
        return '' +
            '<div class="crm-ctrl-timeline-row crm-ctrl-timeline-row--empty" ' +
                 'data-proyecto-id="' + p.proyecto_id + '" role="button">' +
            '</div>';
    }

    function renderRows(proyectos) {
        _proyectosCache = proyectos || [];
        var list = document.getElementById('crmControlList');
        var tl = document.getElementById('crmControlTimeline');
        if (!_proyectosCache.length) {
            setEmpty();
            renderKpisGlobales(_proyectosCache, getFiltrosActuales());
            limpiarChipContexto();
            return;
        }
        if (list) list.innerHTML = _proyectosCache.map(renderItemLista).join('');
        if (tl)   tl.innerHTML = _proyectosCache.map(renderTimelineRow).join('');

        wireSelection();
        renderKpisGlobales(_proyectosCache, getFiltrosActuales());

        // Restaurar selección anterior si seguía vigente.
        if (_selectedId) {
            var stillPresent = _proyectosCache.some(function (p) {
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
                    // Click en mismo proyecto = deselect.
                    if (String(_selectedId) === String(id)) {
                        deselectProyecto();
                    } else {
                        selectProyecto(id, true);
                    }
                });
            }
        }
        bindAll('.crm-ctrl-item[data-proyecto-id]');
        bindAll('.crm-ctrl-timeline-row[data-proyecto-id]');
    }

    function selectProyecto(id, scrollIntoView) {
        _selectedId = id;
        var all = document.querySelectorAll('[data-proyecto-id]');
        for (var i = 0; i < all.length; i++) {
            all[i].classList.toggle(
                'is-selected',
                all[i].getAttribute('data-proyecto-id') === String(id)
            );
        }
        var p = null;
        for (var j = 0; j < _proyectosCache.length; j++) {
            if (String(_proyectosCache[j].proyecto_id) === String(id)) {
                p = _proyectosCache[j];
                break;
            }
        }
        if (p) renderKpisProyecto(p);

        if (!scrollIntoView) return;
        var rowTl = document.querySelector('.crm-ctrl-timeline-row[data-proyecto-id="' + id + '"]');
        if (rowTl && typeof rowTl.scrollIntoView === 'function') {
            rowTl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        var item = document.querySelector('.crm-ctrl-item[data-proyecto-id="' + id + '"]');
        if (item && typeof item.scrollIntoView === 'function') {
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function deselectProyecto() {
        _selectedId = null;
        var all = document.querySelectorAll('[data-proyecto-id].is-selected');
        for (var i = 0; i < all.length; i++) all[i].classList.remove('is-selected');
        renderKpisGlobales(_proyectosCache, getFiltrosActuales());
    }

    // ─────────────────────────────────────────────────────────────────────
    // KPIs — vista global vs proyecto seleccionado
    // ─────────────────────────────────────────────────────────────────────

    function setSlot(n, label, value, valueClass) {
        var stat = document.querySelector('.crm-control-stat[data-slot="' + n + '"]');
        if (!stat) return;
        var lbl = stat.querySelector('[data-slot-label]');
        var val = stat.querySelector('[data-slot-value]');
        if (lbl) lbl.textContent = label;
        if (val) {
            val.textContent = value;
            // Reset clases de color y tamaño antes de aplicar la nueva.
            val.className = 'crm-control-stat-value';
            if (valueClass) val.className += ' ' + valueClass;
        }
    }

    function renderKpisGlobales(proyectos, filtros) {
        var total = proyectos.length;
        var conPo = 0, conLev = 0;
        for (var i = 0; i < proyectos.length; i++) {
            if ((proyectos[i].po || '').trim()) conPo++;
            if (proyectos[i].levantamiento_id) conLev++;
        }
        setSlot(1, 'Proyectos', total);
        setSlot(2, 'Con PO', conPo, 'crm-control-stat-value--blue');
        setSlot(3, 'Con levantamiento', conLev, 'crm-control-stat-value--green');

        var periodoTxt = 'Todos';
        if (filtros.mes && filtros.mes !== 'todos') {
            periodoTxt = (MESES_LABEL[filtros.mes] || filtros.mes) + ' ' + (filtros.anio || '');
        } else if (filtros.anio && filtros.anio !== 'todos') {
            periodoTxt = filtros.anio;
        }
        setSlot(4, 'Periodo', periodoTxt, 'crm-control-stat-value--small');

        // Marca contexto general (sin tint).
        var row = document.getElementById('ctrlStatsRow');
        if (row) row.classList.remove('is-context');

        // Sidebar count + header del timeline.
        var lc = document.getElementById('ctrlListCount');
        if (lc) lc.textContent = total;
        actualizarTimelineHeader(filtros);
    }

    function renderKpisProyecto(p) {
        setSlot(1, 'Monto PO', fmtMoney(p.monto_po));
        setSlot(2, 'Utilidad', fmtMoney(p.utilidad), 'crm-control-stat-value--green');
        var dias = p.dias_ejecucion || 0;
        setSlot(3, 'Días ejecución', dias ? (dias + (dias === 1 ? ' día' : ' días')) : '—', 'crm-control-stat-value--blue');
        var tec = p.tecnicos || 0;
        setSlot(4, 'Técnicos', tec);

        var row = document.getElementById('ctrlStatsRow');
        if (row) row.classList.add('is-context');
    }

    function actualizarTimelineHeader(filtros) {
        var cont = document.getElementById('ctrlTimelineMonths');
        if (!cont) return;
        var mes = filtros.mes;
        if (!mes || mes === 'todos') {
            cont.innerHTML =
                '<span class="crm-ctrl-month-chip">' + escHtml(filtros.anio || 'PERIODO') + '</span>' +
                '<span class="crm-ctrl-month-line" aria-hidden="true"></span>' +
                '<span class="crm-ctrl-month-chip">FIN</span>';
            return;
        }
        var m1Num = parseInt(mes, 10);
        var m2Num = m1Num === 12 ? 1 : m1Num + 1;
        var m2 = (m2Num < 10 ? '0' : '') + m2Num;
        cont.innerHTML =
            '<span class="crm-ctrl-month-chip">' + (MESES_SHORT[mes] || mes) + '</span>' +
            '<span class="crm-ctrl-month-line" aria-hidden="true"></span>' +
            '<span class="crm-ctrl-month-chip">' + (MESES_SHORT[m2] || m2) + '</span>';
    }

    // ─────────────────────────────────────────────────────────────────────
    // FETCH
    // ─────────────────────────────────────────────────────────────────────

    var _inflightAbort = null;
    function fetchProyectos() {
        var f = getFiltrosActuales();
        var qs = '?mes=' + encodeURIComponent(f.mes) + '&anio=' + encodeURIComponent(f.anio);
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
                if (resp && resp.ok) renderRows(resp.data || []);
                else setError(resp && resp.error ? resp.error : 'Error desconocido.');
            })
            .catch(function (err) {
                if (err && err.name === 'AbortError') return;
                setError(err && err.message ? err.message : '');
            });
    }

    // ─────────────────────────────────────────────────────────────────────
    // AGREGAR MATERIAL (placeholder por ahora)
    // ─────────────────────────────────────────────────────────────────────

    function abrirAgregarMaterial() {
        // Placeholder — el formulario real (producto, ETA, cantidad, etc.)
        // se construye en la próxima iteración. Por ahora solo avisa.
        if (typeof window.toast === 'function') {
            window.toast('Próximamente: formulario para agregar material esperado a un proyecto.', 'info');
        }
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

        // Liberar espacio ocultando el footer global del CRM.
        if (document.body) document.body.classList.add('crm-control-active');

        try { localStorage.setItem('crm_clientes_mode', 'control'); } catch (e) {}
        fetchProyectos();
    }

    function desactivarControl() {
        _controlActivo = false;
        var btn = document.getElementById('crmModeControl');
        if (btn) btn.classList.remove('active');
        var section = document.getElementById('ckControlSection');
        if (section) section.style.display = 'none';

        // Restaurar footer al salir.
        if (document.body) document.body.classList.remove('crm-control-active');
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
        var btnAdd = document.getElementById('crmControlAddMaterial');
        if (btnAdd) {
            btnAdd.addEventListener('click', function (e) {
                e.preventDefault();
                abrirAgregarMaterial();
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
        deselect: deselectProyecto,
        get activo() { return _controlActivo; }
    };
})();
