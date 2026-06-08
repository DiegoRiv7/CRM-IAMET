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
        'ckDetalleSection', 'ckClientesTablaSection',
        'ckMarcasSection', 'ckProveedoresSection'
    ];
    var IDS_OTROS_BTNS = [
        'crmModeOpp', 'crmModeProsp', 'crmModeProyectos', 'crmModeClientes',
        'crmModeMarcas', 'crmModeProveedores'
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

    // Offset de meses que el usuario aplicó con las flechas ◀ ▶ del
    // timeline. Se suma al mes filtrado del topbar para mover la ventana
    // visible (ej. de "JUN-JUL" a "JUL-AGO"). El fetch del backend SIGUE
    // usando el mes original — solo la ventana visual cambia.
    var _monthOffset = 0;

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
        // La row puede traer 0..N materiales esperados. Cada material es
        // una barra posicionada en una ventana de 2 meses: el mes filtrado
        // y el siguiente (igual que el header de "JUN — JUL" que ya
        // dibujamos arriba). Si no hay filtro de mes, usamos el mes
        // actual como ancla.
        var materiales = p.materiales || [];
        var win = ventanaFechas(getFiltrosActuales());
        var bars = '';
        for (var i = 0; i < materiales.length; i++) {
            bars += renderBarraMaterial(materiales[i], win);
        }
        var emptyCls = materiales.length ? '' : ' crm-ctrl-timeline-row--empty';
        var hasMaterialesCls = materiales.length ? ' has-materiales' : '';
        return '' +
            '<div class="crm-ctrl-timeline-row' + emptyCls + hasMaterialesCls + '" ' +
                 'data-proyecto-id="' + p.proyecto_id + '" role="button">' +
                bars +
            '</div>';
    }

    function ventanaFechas(filtros) {
        // Devuelve { start: Date, end: Date } cubriendo el mes filtrado +
        // el siguiente (ventana de 2 meses, inclusiva). Si no hay mes
        // específico, ventana = mes actual + siguiente.
        var hoy = new Date();
        var anio = parseInt(filtros.anio, 10);
        if (!anio || isNaN(anio) || String(filtros.anio).toLowerCase() === 'todos') {
            anio = hoy.getFullYear();
        }
        var mes = parseInt(filtros.mes, 10);
        if (!mes || isNaN(mes) || String(filtros.mes).toLowerCase() === 'todos') {
            mes = hoy.getMonth() + 1;
        }
        // Aplicar offset de flechas: cada paso = 1 mes.
        mes += _monthOffset;
        // Normalizar mes >= 1 / <= 12 ajustando año.
        while (mes < 1)  { mes += 12; anio -= 1; }
        while (mes > 12) { mes -= 12; anio += 1; }
        var start = new Date(anio, mes - 1, 1);
        // Fin = último día del mes siguiente
        var end = new Date(anio, mes + 1, 0, 23, 59, 59);
        return { start: start, end: end };
    }

    function renderBarraMaterial(m, win) {
        if (!m || !m.fecha_inicio || !m.fecha_fin) return '';
        var ini = parseISODate(m.fecha_inicio);
        var fin = parseISODate(m.fecha_fin);
        if (!ini || !fin) return '';
        // Recortar al rango visible
        var visIni = ini < win.start ? win.start : ini;
        var visFin = fin > win.end ? win.end : fin;
        if (visFin < win.start || visIni > win.end) {
            // Fuera de ventana → no renderizar
            return '';
        }
        var total = win.end.getTime() - win.start.getTime();
        if (total <= 0) return '';
        var leftPct = ((visIni.getTime() - win.start.getTime()) / total) * 100;
        var widthPct = ((visFin.getTime() - visIni.getTime()) / total) * 100;
        // Respeta el padding 24px del row (left/right) — usamos el rango
        // 24px .. (100% - 24px). Calculamos en CSS calc().
        var leftCalc = 'calc(24px + (100% - 48px) * ' + (leftPct / 100).toFixed(4) + ')';
        var widthCalc = 'calc((100% - 48px) * ' + (widthPct / 100).toFixed(4) + ')';

        var overflowCls = '';
        if (ini < win.start) overflowCls += ' crm-cm-bar--overflow-left';
        if (fin > win.end) overflowCls += ' crm-cm-bar--overflow-right';
        var confirmadoCls = m.confirmado_recepcion ? ' crm-cm-bar--confirmado' : '';

        var color = m.color || '#9CA3AF';
        var titleAttr = (m.titulo || '') + ' · ' + (m.fecha_inicio || '') + ' → ' + (m.fecha_fin || '');

        // Markers + fechas viven DENTRO de la barra (no sobresalen). Las
        // fechas son chips sutiles a los extremos; los markers son puntitos
        // de 8px sin borde. Si la fecha original se recortó por la ventana,
        // ese extremo va sin marker ni chip (no quiero pintar "01 ene" en
        // una barra cortada del año pasado).
        var startStuff = (ini >= win.start)
            ? '<span class="crm-cm-bar-marker crm-cm-bar-marker--start"></span>' +
              '<span class="crm-cm-bar-date crm-cm-bar-date--start">' + fmtDateShort(ini) + '</span>'
            : '';
        var endStuff = (fin <= win.end)
            ? '<span class="crm-cm-bar-date crm-cm-bar-date--end">' + fmtDateShort(fin) + '</span>' +
              '<span class="crm-cm-bar-marker crm-cm-bar-marker--end"></span>'
            : '';

        return '<div class="crm-cm-bar' + overflowCls + confirmadoCls + '" ' +
                   'style="left:' + leftCalc + ';width:' + widthCalc + ';background:' + color + ';" ' +
                   'data-material-id="' + m.id + '" ' +
                   'title="' + escHtml(titleAttr) + '">' +
                   startStuff +
                   '<span class="crm-cm-bar-label">' + escHtml(m.titulo || '') + '</span>' +
                   endStuff +
               '</div>';
    }

    var _MESES_CORTOS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    function fmtDateShort(d) {
        if (!d || !(d instanceof Date)) return '';
        return String(d.getDate()).padStart(2, '0') + ' ' + _MESES_CORTOS[d.getMonth()];
    }

    function parseISODate(iso) {
        if (!iso) return null;
        try {
            // 'YYYY-MM-DD' → Date en hora local (sin TZ shift)
            var parts = String(iso).split('-');
            if (parts.length < 3) return null;
            return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        } catch (e) { return null; }
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
        // Items de la lista: click selecciona/deselecciona (igual que antes).
        var items = document.querySelectorAll('.crm-ctrl-item[data-proyecto-id]');
        for (var i = 0; i < items.length; i++) {
            items[i].addEventListener('click', function () {
                var id = this.getAttribute('data-proyecto-id');
                if (String(_selectedId) === String(id)) {
                    deselectProyecto();
                } else {
                    selectProyecto(id, true);
                }
            });
        }
        // Rows del timeline: click en una BARRA abre el detalle del material.
        // Click en zona vacía → si el proyecto YA está seleccionado, abre
        // el form de creación con ese proyecto preseleccionado. Si no está
        // seleccionado, lo selecciona primero (UX consistente con la lista).
        var rows = document.querySelectorAll('.crm-ctrl-timeline-row[data-proyecto-id]');
        for (var j = 0; j < rows.length; j++) {
            rows[j].addEventListener('click', onTimelineRowClick);
        }
    }

    function onTimelineRowClick(ev) {
        // ¿Click en una barra de material?
        var bar = ev.target.closest('.crm-cm-bar[data-material-id]');
        if (bar) {
            ev.stopPropagation();
            var mid = bar.getAttribute('data-material-id');
            if (window.crmMaterialDetalle && typeof window.crmMaterialDetalle.open === 'function') {
                window.crmMaterialDetalle.open(parseInt(mid, 10));
            }
            return;
        }
        // Click en zona vacía del row
        var row = ev.currentTarget;
        var pid = row.getAttribute('data-proyecto-id');
        if (!pid) return;
        if (String(_selectedId) === String(pid)) {
            // Ya seleccionado → abrir form de creación con proyecto preseleccionado
            if (window.crmMaterialForm && typeof window.crmMaterialForm.open === 'function') {
                window.crmMaterialForm.open(parseInt(pid, 10));
            }
        } else {
            // Primer click sobre el row → seleccionar primero
            selectProyecto(pid, true);
        }
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
        actualizarBotonIrAlProyecto(p);

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
        actualizarBotonIrAlProyecto(null);
    }

    function actualizarBotonIrAlProyecto(proyecto) {
        var btn = document.getElementById('crmControlGoToProject');
        if (!btn) return;
        if (proyecto && proyecto.proyecto_id) {
            btn.hidden = false;
            btn.setAttribute('data-proyecto-id', proyecto.proyecto_id);
        } else {
            btn.hidden = true;
            btn.removeAttribute('data-proyecto-id');
        }
    }

    function irAlProyectoSeleccionado() {
        if (!_selectedId) return;
        // Setear vista a "proyectos" para que el sidebar / SPA del CRM la
        // restaure y, al cargar, abrir el detalle del proyecto vía deeplink.
        try { localStorage.setItem('crmView', 'proyectos'); } catch (e) {}
        // Si la función proyectosVerDetalle ya está cargada en esta página
        // (lo cual debería ser el caso porque crm_proyectos.js está en el
        // mismo template), llamamos directo sin recargar.
        if (typeof window.proyectosVerDetalle === 'function') {
            // Hay que asegurarse de mostrar la sección Proyectos primero.
            // Activamos el botón del sidebar para que el switch sea limpio.
            var sidebarBtn = document.getElementById('btnProyectos');
            if (sidebarBtn && typeof sidebarBtn.click === 'function') {
                sidebarBtn.click();
                // Una vez la sección Proyectos esté visible, abrimos el detalle.
                setTimeout(function () {
                    try { window.proyectosVerDetalle(parseInt(_selectedId, 10)); } catch (e) {}
                }, 60);
            } else {
                try { window.proyectosVerDetalle(parseInt(_selectedId, 10)); } catch (e) {}
            }
            desactivarControl();
            return;
        }
        // Fallback: deeplink con full reload.
        var url = '/app/home/?tab=crm&open_proyecto=' + encodeURIComponent(_selectedId);
        window.location.href = url;
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

    function rePintarTimeline() {
        // Re-renderiza el timeline (rows + header) sin re-fetch, usando
        // _proyectosCache y el _monthOffset actual.
        var tl = document.getElementById('crmControlTimeline');
        if (tl && _proyectosCache.length) {
            tl.innerHTML = _proyectosCache.map(renderTimelineRow).join('');
        }
        actualizarTimelineHeader(getFiltrosActuales());
        // Re-wire selección de rows del timeline.
        var rows = document.querySelectorAll('.crm-ctrl-timeline-row[data-proyecto-id]');
        for (var j = 0; j < rows.length; j++) {
            rows[j].addEventListener('click', onTimelineRowClick);
        }
        // Mantener highlight de selección si la había.
        if (_selectedId) {
            var sel = document.querySelectorAll('[data-proyecto-id="' + _selectedId + '"]');
            for (var k = 0; k < sel.length; k++) sel[k].classList.add('is-selected');
        }
    }

    function actualizarTimelineHeader(filtros) {
        var cont = document.getElementById('ctrlTimelineMonths');
        if (!cont) return;
        // El header refleja la MISMA ventana que pinta las barras (incluye el
        // offset que el usuario aplicó con las flechas).
        var win = ventanaFechas(filtros);
        var m1Num = win.start.getMonth() + 1;
        var m1Key = (m1Num < 10 ? '0' : '') + m1Num;
        var m2Date = new Date(win.start);
        m2Date.setMonth(m2Date.getMonth() + 1);
        var m2Num = m2Date.getMonth() + 1;
        var m2Key = (m2Num < 10 ? '0' : '') + m2Num;
        cont.innerHTML =
            '<span class="crm-ctrl-month-chip">' + (MESES_SHORT[m1Key] || m1Key) + '</span>' +
            '<span class="crm-ctrl-month-line" aria-hidden="true"></span>' +
            '<span class="crm-ctrl-month-chip">' + (MESES_SHORT[m2Key] || m2Key) + '</span>';
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
    // AGREGAR MATERIAL
    // ─────────────────────────────────────────────────────────────────────
    // Botón del header del split. Si hay un proyecto seleccionado lo
    // preseleccionamos; si no, el usuario lo busca en el form.
    function abrirAgregarMaterial() {
        if (window.crmMaterialForm && typeof window.crmMaterialForm.open === 'function') {
            var pid = _selectedId ? parseInt(_selectedId, 10) : null;
            window.crmMaterialForm.open(pid);
        } else if (typeof window.toast === 'function') {
            // Fallback si el JS de materiales aún no cargó (Turbo race)
            window.toast('Cargando…', 'info');
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

        // Flechas para navegar mes en el timeline (solo mueve la ventana
        // visual, no re-fetchea — los proyectos visibles siguen siendo los
        // del mes filtrado del topbar).
        var btnPrev = document.getElementById('ctrlMonthPrev');
        var btnNext = document.getElementById('ctrlMonthNext');
        if (btnPrev) {
            btnPrev.addEventListener('click', function (e) {
                e.preventDefault();
                _monthOffset -= 1;
                rePintarTimeline();
            });
        }
        if (btnNext) {
            btnNext.addEventListener('click', function (e) {
                e.preventDefault();
                _monthOffset += 1;
                rePintarTimeline();
            });
        }

        // Botón "Ir al proyecto" (visible solo cuando hay proyecto seleccionado)
        var btnGoto = document.getElementById('crmControlGoToProject');
        if (btnGoto) {
            btnGoto.addEventListener('click', function (e) {
                e.preventDefault();
                irAlProyectoSeleccionado();
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

        // Refresh automático cuando se crea/edita/elimina un material.
        // Solo refetch si estamos en la tab Control (evita network noise
        // mientras el usuario está en otra vista del CRM).
        try {
            if (window.crmDataBus && typeof window.crmDataBus.on === 'function') {
                window.crmDataBus.on('material', function () {
                    if (_controlActivo) fetchProyectos();
                });
            }
        } catch (e) {}
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
