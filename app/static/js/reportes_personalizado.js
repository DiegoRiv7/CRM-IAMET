/* ═══════════════════════════════════════════════════════════════════
 * reportes_personalizado.js
 * Reporte 4: Constructor Personalizado.
 *
 * UX:
 * - Panel izquierdo: punto de partida (templates pre-armados + mis
 *   reportes en localStorage), entidad, filtros como chips, columnas
 *   reordenables con drag, agrupación, orden, acciones.
 * - Panel derecho: hero con nombre + descripción natural, KPIs en vivo
 *   y tabla paginada. Todo se actualiza con debounce 300ms.
 * - Filtros: cada chip representa una condición ("Vendedor = Diego",
 *   "Monto > $100K"). Click → popover de edición. Reglas dependientes
 *   del tipo de campo.
 * - Persistencia: la configuración + reportes guardados viven en
 *   localStorage por usuario.
 *
 * Backend:
 * - POST/GET /app/api/reportes/personalizado/ con la configuración.
 * - El backend valida con whitelist y devuelve KPIs + columnas + filas.
 *
 * Click en fila:
 * - Si entidad = oportunidades → openDetalle(id) en widget inline.
 * - Si entidad = clientes/actividades → noop (no se navega).
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var API = (typeof window._REP_PERSONALIZADO_API === 'string')
        ? window._REP_PERSONALIZADO_API
        : '/app/api/reportes/personalizado/';

    var STORAGE_KEY = 'reppMisReportes_v1';
    var DRAFT_KEY = 'reppDraftConfig_v1';

    // ── Catálogos por entidad (mismo schema que valida el backend) ────
    // Los nombres / labels que mostramos al usuario. El backend tiene
    // un mirror equivalente que valida cada {entidad, campo, op}.
    var SCHEMA = {
        oportunidades: {
            label: 'Oportunidades',
            campos: [
                { key: 'titulo', label: 'Oportunidad', tipo: 'texto' },
                { key: 'cliente', label: 'Cliente', tipo: 'texto' },
                { key: 'vendedor', label: 'Vendedor', tipo: 'opciones', opciones_key: 'vendedores' },
                { key: 'pipeline', label: 'Pipeline', tipo: 'opciones', opciones_inline: [
                    { value: 'runrate', label: 'Runrate' },
                    { value: 'proyecto', label: 'Proyecto' },
                ]},
                { key: 'etapa', label: 'Etapa', tipo: 'opciones', opciones_key: 'etapas' },
                { key: 'producto', label: 'Producto / Marca', tipo: 'opciones', opciones_key: 'productos' },
                { key: 'area', label: 'Área', tipo: 'opciones', opciones_key: 'areas' },
                { key: 'monto_mxn', label: 'Monto MXN', tipo: 'numero', formato: 'money', alineacion: 'right' },
                { key: 'probabilidad', label: 'Probabilidad %', tipo: 'numero', alineacion: 'right' },
                { key: 'mes_cierre', label: 'Mes cierre', tipo: 'opciones', opciones_inline: [
                    {value:'01',label:'Enero'},{value:'02',label:'Febrero'},{value:'03',label:'Marzo'},
                    {value:'04',label:'Abril'},{value:'05',label:'Mayo'},{value:'06',label:'Junio'},
                    {value:'07',label:'Julio'},{value:'08',label:'Agosto'},{value:'09',label:'Septiembre'},
                    {value:'10',label:'Octubre'},{value:'11',label:'Noviembre'},{value:'12',label:'Diciembre'},
                ]},
                { key: 'anio_cierre', label: 'Año cierre', tipo: 'numero', alineacion: 'right' },
                { key: 'fecha_creacion', label: 'Creada el', tipo: 'fecha' },
                { key: 'fecha_actualizacion', label: 'Actualizada el', tipo: 'fecha' },
                { key: 'po_number', label: 'PO', tipo: 'texto' },
                { key: 'categoria_cliente', label: 'Categoría cliente', tipo: 'opciones', opciones_inline: [
                    {value:'A',label:'A'},{value:'B',label:'B'},{value:'C',label:'C'},
                ]},
            ],
            agrupables: ['vendedor', 'etapa', 'pipeline', 'cliente', 'producto', 'mes_cierre', 'anio_cierre', 'area', 'categoria_cliente'],
            row_id_key: 'id', // si está, click abre opp inline
            puede_abrir_inline: true,
        },
        clientes: {
            label: 'Clientes',
            campos: [
                { key: 'nombre', label: 'Cliente', tipo: 'texto' },
                { key: 'rfc', label: 'RFC', tipo: 'texto' },
                { key: 'categoria', label: 'Categoría', tipo: 'opciones', opciones_inline: [
                    {value:'A',label:'A'},{value:'B',label:'B'},{value:'C',label:'C'},
                ]},
                { key: 'asignado_a', label: 'Asignado a', tipo: 'opciones', opciones_key: 'vendedores' },
                { key: 'opps_abiertas', label: 'Opps abiertas', tipo: 'numero', alineacion: 'right' },
                { key: 'opps_ganadas', label: 'Opps ganadas', tipo: 'numero', alineacion: 'right' },
                { key: 'opps_perdidas', label: 'Opps perdidas', tipo: 'numero', alineacion: 'right' },
                { key: 'monto_ganado_mxn', label: 'Monto ganado MXN', tipo: 'numero', formato: 'money', alineacion: 'right' },
                { key: 'monto_abierto_mxn', label: 'Monto abierto MXN', tipo: 'numero', formato: 'money', alineacion: 'right' },
                { key: 'fecha_creacion', label: 'Cliente desde', tipo: 'fecha' },
                { key: 'meta_mensual', label: 'Meta facturado', tipo: 'numero', formato: 'money', alineacion: 'right' },
            ],
            agrupables: ['categoria', 'asignado_a'],
            row_id_key: null,
            puede_abrir_inline: false,
        },
        actividades: {
            label: 'Actividades',
            campos: [
                { key: 'titulo', label: 'Actividad', tipo: 'texto' },
                { key: 'tipo_actividad', label: 'Tipo', tipo: 'opciones', opciones_inline: [
                    {value:'llamada',label:'Llamada'},{value:'reunion',label:'Reunión'},
                    {value:'tarea',label:'Tarea'},{value:'email',label:'Email'},{value:'otro',label:'Otro'},
                ]},
                { key: 'creado_por', label: 'Creado por', tipo: 'opciones', opciones_key: 'vendedores' },
                { key: 'oportunidad', label: 'Oportunidad', tipo: 'texto' },
                { key: 'cliente', label: 'Cliente', tipo: 'texto' },
                { key: 'completada', label: 'Completada', tipo: 'opciones', opciones_inline: [
                    {value:'true',label:'Sí'},{value:'false',label:'No'},
                ]},
                { key: 'fecha_inicio', label: 'Inicio', tipo: 'fecha' },
                { key: 'fecha_fin', label: 'Fin', tipo: 'fecha' },
            ],
            agrupables: ['tipo_actividad', 'creado_por', 'completada'],
            row_id_key: null,
            puede_abrir_inline: false,
        },
    };

    // Operadores por tipo
    var OPS_BY_TIPO = {
        texto:    [{value:'contains',label:'contiene'},{value:'eq',label:'es exactamente'},{value:'neq',label:'no es'}],
        numero:   [{value:'gt',label:'mayor que'},{value:'gte',label:'mayor o igual a'},{value:'lt',label:'menor que'},{value:'lte',label:'menor o igual a'},{value:'eq',label:'igual a'},{value:'between',label:'entre'}],
        fecha:    [{value:'gte',label:'desde'},{value:'lte',label:'hasta'},{value:'between',label:'entre'},{value:'this_month',label:'este mes'},{value:'this_year',label:'este año'},{value:'last_30d',label:'últimos 30 días'}],
        opciones: [{value:'in',label:'es alguno de'},{value:'not_in',label:'no es ninguno de'}],
    };

    // Plantillas pre-armadas (puntos de partida)
    var TEMPLATES = [
        {
            id: 'pipeline-vendedor',
            label: 'Pipeline por vendedor',
            icon: 'users',
            config: {
                entidad: 'oportunidades',
                filtros: [],
                columnas: ['vendedor', 'etapa', 'titulo', 'cliente', 'monto_mxn', 'probabilidad'],
                agrupar_por: 'vendedor',
                ordenar_por: 'monto_mxn',
                orden_dir: 'desc',
                nombre: 'Pipeline por vendedor',
            },
        },
        {
            id: 'cierres-mes',
            label: 'Cierres del mes',
            icon: 'calendar',
            config: {
                entidad: 'oportunidades',
                filtros: [
                    { campo: 'mes_cierre', op: 'in', valor: [String(new Date().getMonth()+1).padStart(2,'0')] },
                    { campo: 'anio_cierre', op: 'eq', valor: new Date().getFullYear() },
                ],
                columnas: ['titulo', 'cliente', 'vendedor', 'etapa', 'monto_mxn', 'probabilidad'],
                agrupar_por: '',
                ordenar_por: 'monto_mxn',
                orden_dir: 'desc',
                nombre: 'Cierres del mes',
            },
        },
        {
            id: 'top-clientes',
            label: 'Clientes top 10',
            icon: 'building',
            config: {
                entidad: 'clientes',
                filtros: [],
                columnas: ['nombre', 'asignado_a', 'categoria', 'opps_ganadas', 'opps_abiertas', 'monto_ganado_mxn'],
                agrupar_por: '',
                ordenar_por: 'monto_ganado_mxn',
                orden_dir: 'desc',
                nombre: 'Clientes top 10',
                page_size: 10,
            },
        },
        {
            id: 'actividades-mes',
            label: 'Actividad por tipo',
            icon: 'activity',
            config: {
                entidad: 'actividades',
                filtros: [
                    { campo: 'fecha_inicio', op: 'this_month' },
                ],
                columnas: ['titulo', 'tipo_actividad', 'creado_por', 'oportunidad', 'cliente', 'fecha_inicio', 'completada'],
                agrupar_por: 'tipo_actividad',
                ordenar_por: 'fecha_inicio',
                orden_dir: 'desc',
                nombre: 'Actividad por tipo (este mes)',
            },
        },
        {
            id: 'alta-prob',
            label: 'Alta probabilidad (≥70%)',
            icon: 'star',
            config: {
                entidad: 'oportunidades',
                filtros: [
                    { campo: 'probabilidad', op: 'gte', valor: 70 },
                ],
                columnas: ['titulo', 'cliente', 'vendedor', 'etapa', 'monto_mxn', 'probabilidad', 'mes_cierre'],
                agrupar_por: '',
                ordenar_por: 'monto_mxn',
                orden_dir: 'desc',
                nombre: 'Alta probabilidad (≥70%)',
            },
        },
    ];

    // ── Estado de la app ─────────────────────────────────────────────
    var state = {
        config: defaultConfig(),
        opciones: { vendedores: [], etapas: [], productos: [], areas: [] },
        ultima: null,           // último resultado de la API
        loading: false,
        debounceTimer: null,
        page: 1,
        page_size: 50,
    };

    function defaultConfig() {
        // Default = el primer template (pipeline por vendedor) — mejor
        // que "hoja en blanco" porque el usuario ve algo de inmediato.
        return JSON.parse(JSON.stringify(TEMPLATES[0].config));
    }

    // ── Helpers ──────────────────────────────────────────────────────
    function $(id) { return document.getElementById(id); }
    function elt(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }
    function escapeHTML(s) {
        return String(s == null ? '' : s)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function fmtMoney(n) {
        if (n == null || isNaN(n)) return '$0';
        return '$' + Math.round(n).toLocaleString('en-US');
    }
    function fmtMoneyAbrev(n) {
        if (!n) return '$0';
        var abs = Math.abs(n);
        if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
        if (abs >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
        return '$' + Math.round(n);
    }
    function fmtNum(n) {
        if (n == null || isNaN(n)) return '0';
        return Number(n).toLocaleString('en-US');
    }
    function fmtFecha(iso) {
        if (!iso) return '—';
        try {
            var d = new Date(iso);
            if (isNaN(d.getTime())) return '—';
            var meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
            return d.getDate() + ' ' + meses[d.getMonth()] + ' ' + (d.getFullYear() % 100).toString().padStart(2,'0');
        } catch (e) { return '—'; }
    }
    function getCsrfToken() {
        var i = document.querySelector('input[name=csrfmiddlewaretoken]');
        return i ? i.value : '';
    }
    function getCampoByKey(entidad, key) {
        var schema = SCHEMA[entidad];
        if (!schema) return null;
        for (var i=0; i<schema.campos.length; i++) {
            if (schema.campos[i].key === key) return schema.campos[i];
        }
        return null;
    }
    function getOpcionesPara(campo) {
        if (campo.opciones_inline) return campo.opciones_inline;
        if (campo.opciones_key) {
            var arr = state.opciones[campo.opciones_key] || [];
            return arr.map(function(o){
                return { value: o.id != null ? o.id : o.value, label: o.nombre || o.label };
            });
        }
        return [];
    }
    function getLabelOpcion(campo, value) {
        var ops = getOpcionesPara(campo);
        for (var i=0; i<ops.length; i++) {
            if (String(ops[i].value) === String(value)) return ops[i].label;
        }
        return String(value);
    }
    function labelOp(tipo, op) {
        var arr = OPS_BY_TIPO[tipo] || [];
        for (var i=0; i<arr.length; i++) if (arr[i].value === op) return arr[i].label;
        return op;
    }

    // ── Renderizado del panel izquierdo ──────────────────────────────
    function renderStarters() {
        var host = $('reppStarters');
        host.innerHTML = '';

        TEMPLATES.forEach(function (t) {
            var b = elt('button', 'repp-starter');
            b.type = 'button';
            b.title = 'Cargar plantilla: ' + t.label;
            b.innerHTML = svgIcon(t.icon) + '<span>' + escapeHTML(t.label) + '</span>';
            b.addEventListener('click', function () { applyStarter(t.config); });
            host.appendChild(b);
        });

        // Mis reportes guardados
        var mios = loadMisReportes();
        mios.forEach(function (m, idx) {
            var b = elt('button', 'repp-starter repp-starter-mine');
            b.type = 'button';
            b.title = 'Mi reporte guardado: ' + m.nombre;
            b.innerHTML = svgIcon('bookmark') + '<span>' + escapeHTML(m.nombre) + '</span>';
            var x = elt('span', 'repp-starter-x');
            x.innerHTML = '&times;';
            x.title = 'Eliminar';
            x.addEventListener('click', function (e) {
                e.stopPropagation();
                if (confirm('¿Eliminar "' + m.nombre + '" de mis reportes?')) {
                    deleteMiReporte(idx);
                }
            });
            b.appendChild(x);
            b.addEventListener('click', function () { applyStarter(m.config); });
            host.appendChild(b);
        });
    }

    function svgIcon(name) {
        var icons = {
            users:    '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
            calendar: '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
            building: '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
            activity: '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
            star:     '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
            bookmark: '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
        };
        return '<span class="repp-starter-icon">' + (icons[name] || '') + '</span>';
    }

    function applyStarter(cfg) {
        // Hacemos deep copy + completamos defaults
        var nuevo = JSON.parse(JSON.stringify(cfg));
        nuevo.filtros = nuevo.filtros || [];
        nuevo.columnas = nuevo.columnas || [];
        nuevo.agrupar_por = nuevo.agrupar_por || '';
        nuevo.ordenar_por = nuevo.ordenar_por || (nuevo.columnas[0] || '');
        nuevo.orden_dir = nuevo.orden_dir || 'desc';
        state.config = nuevo;
        state.page = 1;
        state.page_size = cfg.page_size || 50;
        $('reppHeroNombre').value = nuevo.nombre || 'Mi reporte';
        renderConfigPanel();
        scheduleLoad(0);
    }

    function renderEntidad() {
        var host = $('reppEntidad');
        var btns = host.querySelectorAll('.repp-seg-btn');
        btns.forEach(function (b) {
            if (b.dataset.entidad === state.config.entidad) b.classList.add('repp-seg-btn-active');
            else b.classList.remove('repp-seg-btn-active');
        });
    }

    function renderFiltrosList() {
        var host = $('reppFiltrosList');
        host.innerHTML = '';
        var filtros = state.config.filtros || [];
        if (!filtros.length) {
            host.appendChild(elt('div', 'repp-empty-hint', 'Sin filtros — mostrando todo.'));
            return;
        }
        filtros.forEach(function (f, idx) {
            var chip = elt('span', 'repp-chip');
            chip.title = 'Click para editar';
            chip.innerHTML = '<span class="repp-chip-text">' + escapeHTML(humanizeFiltro(f)) + '</span>'
                + '<span class="repp-chip-x" title="Quitar">&times;</span>';
            chip.addEventListener('click', function (e) {
                if (e.target.classList.contains('repp-chip-x')) {
                    state.config.filtros.splice(idx, 1);
                    state.page = 1;
                    renderFiltrosList();
                    updateNatural();
                    scheduleLoad();
                } else {
                    openFiltroPopover(idx);
                }
            });
            host.appendChild(chip);
        });
    }

    function humanizeFiltro(f) {
        var campo = getCampoByKey(state.config.entidad, f.campo);
        if (!campo) return f.campo + ' ' + f.op;
        var opLabel = labelOp(campo.tipo, f.op);
        var valor = f.valor;
        if (campo.tipo === 'opciones' && Array.isArray(valor)) {
            valor = valor.map(function(v){ return getLabelOpcion(campo, v); }).join(', ');
        } else if (campo.tipo === 'fecha') {
            if (['this_month','this_year','last_30d'].indexOf(f.op) >= 0) {
                return campo.label + ' · ' + opLabel;
            }
            if (Array.isArray(valor)) valor = valor.join(' → ');
        } else if (campo.tipo === 'numero') {
            if (Array.isArray(valor)) valor = valor.join(' a ');
            else if (campo.formato === 'money') valor = fmtMoneyAbrev(valor);
        }
        if (valor == null || valor === '') return campo.label + ' ' + opLabel;
        return campo.label + ' ' + opLabel + ' ' + valor;
    }

    function renderColsList() {
        var host = $('reppColsList');
        host.innerHTML = '';
        var cols = state.config.columnas || [];
        if (!cols.length) {
            host.appendChild(elt('div', 'repp-empty-hint', 'Sin columnas — agrega alguna.'));
            return;
        }
        cols.forEach(function (k, idx) {
            var campo = getCampoByKey(state.config.entidad, k);
            var label = campo ? campo.label : k;
            var row = elt('div', 'repp-col-row');
            row.draggable = true;
            row.dataset.idx = idx;
            row.innerHTML =
                '<span class="repp-col-handle">'
                + '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="15" cy="18" r="1.2"/></svg>'
                + '</span>'
                + '<span class="repp-col-label">' + escapeHTML(label) + '</span>'
                + '<button type="button" class="repp-col-x" aria-label="Quitar">&times;</button>';
            // Quitar columna
            row.querySelector('.repp-col-x').addEventListener('click', function (e) {
                e.stopPropagation();
                state.config.columnas.splice(idx, 1);
                renderColsList();
                renderAgruparOrden();
                scheduleLoad();
            });
            attachDnD(row);
            host.appendChild(row);
        });
    }

    // Drag & drop nativo HTML5 sobre las rows de columnas
    var _dragSrcIdx = null;
    function attachDnD(row) {
        row.addEventListener('dragstart', function (e) {
            _dragSrcIdx = Number(row.dataset.idx);
            row.classList.add('dragging');
            try {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(_dragSrcIdx));
            } catch (_) {}
        });
        row.addEventListener('dragend', function () {
            row.classList.remove('dragging');
            document.querySelectorAll('.repp-col-row.drop-target').forEach(function (r) {
                r.classList.remove('drop-target');
            });
            _dragSrcIdx = null;
        });
        row.addEventListener('dragover', function (e) {
            e.preventDefault();
            row.classList.add('drop-target');
        });
        row.addEventListener('dragleave', function () {
            row.classList.remove('drop-target');
        });
        row.addEventListener('drop', function (e) {
            e.preventDefault();
            var srcIdx = _dragSrcIdx;
            var dstIdx = Number(row.dataset.idx);
            if (srcIdx == null || isNaN(srcIdx) || srcIdx === dstIdx) {
                row.classList.remove('drop-target');
                return;
            }
            var cols = state.config.columnas;
            var moved = cols.splice(srcIdx, 1)[0];
            cols.splice(dstIdx, 0, moved);
            renderColsList();
            renderAgruparOrden();
            scheduleLoad();
        });
    }

    function renderAgruparOrden() {
        var schema = SCHEMA[state.config.entidad];
        var $a = $('reppAgruparPor');
        $a.innerHTML = '<option value="">Sin agrupar</option>';
        if (schema && schema.agrupables) {
            schema.agrupables.forEach(function (k) {
                var c = getCampoByKey(state.config.entidad, k);
                if (!c) return;
                var o = document.createElement('option');
                o.value = k; o.textContent = c.label;
                if (state.config.agrupar_por === k) o.selected = true;
                $a.appendChild(o);
            });
        }

        // Ordenar por: del set actual de columnas. Si no hay, primer campo del schema.
        var $o = $('reppOrdenarPor');
        $o.innerHTML = '';
        var cols = (state.config.columnas || []).slice();
        if (!cols.length && schema) cols = schema.campos.map(function(c){ return c.key; });
        cols.forEach(function (k) {
            var c = getCampoByKey(state.config.entidad, k);
            if (!c) return;
            var o = document.createElement('option');
            o.value = k; o.textContent = c.label;
            if (state.config.ordenar_por === k) o.selected = true;
            $o.appendChild(o);
        });
        if (!$o.value && cols.length) {
            state.config.ordenar_por = cols[0];
            $o.value = cols[0];
        }
        $('reppOrdenDir').value = state.config.orden_dir || 'desc';
    }

    function renderConfigPanel() {
        renderEntidad();
        renderFiltrosList();
        renderColsList();
        renderAgruparOrden();
        renderStarters();
        updateNatural();
    }

    function updateNatural() {
        var schema = SCHEMA[state.config.entidad];
        var parts = ['Mostrando ', '<em>' + escapeHTML(schema.label.toLowerCase()) + '</em>'];
        var filtros = state.config.filtros || [];
        if (filtros.length) {
            parts.push(' con ');
            var humanos = filtros.map(humanizeFiltro);
            parts.push(humanos.map(function(h){ return '<em>' + escapeHTML(h) + '</em>'; }).join(' y '));
        }
        if (state.config.agrupar_por) {
            var c = getCampoByKey(state.config.entidad, state.config.agrupar_por);
            if (c) parts.push(', agrupado por <em>' + escapeHTML(c.label.toLowerCase()) + '</em>');
        }
        if (state.config.ordenar_por) {
            var co = getCampoByKey(state.config.entidad, state.config.ordenar_por);
            if (co) {
                var dir = state.config.orden_dir === 'asc' ? '↑' : '↓';
                parts.push(', ordenado por <em>' + escapeHTML(co.label.toLowerCase()) + ' ' + dir + '</em>');
            }
        }
        parts.push('.');
        $('reppHeroNatural').innerHTML = parts.join('');
    }

    // ── Popover (filtros + agregar columna) ──────────────────────────
    var POPOVER_STATE = { mode: null, idx: null, draft: null };

    function openPopover(title) {
        $('reppPopoverTitle').textContent = title;
        $('reppPopover').classList.add('open');
        $('reppPopoverOverlay').classList.add('open');
    }
    function closePopover() {
        $('reppPopover').classList.remove('open');
        $('reppPopoverOverlay').classList.remove('open');
        POPOVER_STATE = { mode: null, idx: null, draft: null };
    }

    function openAddColPopover() {
        POPOVER_STATE = { mode: 'addcol', idx: null, draft: null };
        var schema = SCHEMA[state.config.entidad];
        var actuales = new Set(state.config.columnas || []);
        var body = $('reppPopoverBody');
        body.innerHTML = '<div class="repp-form-row"><div class="repp-form-label">Elige campos a agregar</div>'
            + '<div class="repp-options-list" id="reppAddColList"></div></div>';
        var list = $('reppAddColList');
        var disponibles = schema.campos.filter(function (c) { return !actuales.has(c.key); });
        if (!disponibles.length) {
            list.innerHTML = '<div class="repp-options-empty">Ya están todas las columnas disponibles.</div>';
        } else {
            disponibles.forEach(function (c) {
                var row = elt('label', 'repp-option-row');
                row.innerHTML = '<input type="checkbox" value="' + escapeHTML(c.key) + '">'
                    + '<span>' + escapeHTML(c.label) + '</span>';
                list.appendChild(row);
            });
        }
        openPopover('Agregar columnas');
    }

    function openFiltroPopover(idx) {
        var schema = SCHEMA[state.config.entidad];
        var actual = idx != null ? state.config.filtros[idx] : { campo: schema.campos[0].key, op: '', valor: null };
        POPOVER_STATE = {
            mode: 'filtro',
            idx: idx,
            draft: JSON.parse(JSON.stringify(actual)),
        };
        var body = $('reppPopoverBody');
        body.innerHTML = '';

        // Selector de campo
        var campoSel = elt('select', 'repp-form-select');
        schema.campos.forEach(function (c) {
            var o = document.createElement('option');
            o.value = c.key; o.textContent = c.label;
            if (c.key === POPOVER_STATE.draft.campo) o.selected = true;
            campoSel.appendChild(o);
        });
        var fr1 = elt('div', 'repp-form-row');
        fr1.appendChild(elt('div', 'repp-form-label', 'Campo'));
        fr1.appendChild(campoSel);
        body.appendChild(fr1);

        var opRow = elt('div', 'repp-form-row repp-form-row-2');
        opRow.innerHTML = '<div><div class="repp-form-label">Operador</div><select class="repp-form-select" id="reppPopOp"></select></div>'
            + '<div><div class="repp-form-label">Valor</div><div id="reppPopValor"></div></div>';
        body.appendChild(opRow);

        campoSel.addEventListener('change', function () {
            POPOVER_STATE.draft.campo = campoSel.value;
            POPOVER_STATE.draft.op = '';
            POPOVER_STATE.draft.valor = null;
            renderPopoverOp();
        });
        renderPopoverOp();
        openPopover(idx != null ? 'Editar filtro' : 'Nuevo filtro');

        function renderPopoverOp() {
            var campo = getCampoByKey(state.config.entidad, POPOVER_STATE.draft.campo);
            var $op = $('reppPopOp');
            var $val = $('reppPopValor');
            $op.innerHTML = '';
            var ops = OPS_BY_TIPO[campo.tipo] || [];
            ops.forEach(function (o) {
                var oe = document.createElement('option');
                oe.value = o.value; oe.textContent = o.label;
                if (POPOVER_STATE.draft.op === o.value) oe.selected = true;
                $op.appendChild(oe);
            });
            if (!POPOVER_STATE.draft.op && ops.length) {
                POPOVER_STATE.draft.op = ops[0].value;
                $op.value = ops[0].value;
            }
            $op.addEventListener('change', function () {
                POPOVER_STATE.draft.op = $op.value;
                POPOVER_STATE.draft.valor = null;
                renderValor();
            });
            renderValor();

            function renderValor() {
                $val.innerHTML = '';
                var op = POPOVER_STATE.draft.op;
                var v = POPOVER_STATE.draft.valor;

                if (campo.tipo === 'fecha' && ['this_month','this_year','last_30d'].indexOf(op) >= 0) {
                    $val.innerHTML = '<div style="color:#9CA3AF;font-size:0.78rem;padding:8px 0;">(automático)</div>';
                    POPOVER_STATE.draft.valor = null;
                    return;
                }

                if (campo.tipo === 'opciones') {
                    var ops2 = getOpcionesPara(campo);
                    var sel = new Set((Array.isArray(v) ? v : (v != null ? [v] : [])).map(String));
                    if (!ops2.length) {
                        $val.innerHTML = '<div class="repp-options-empty" style="margin:4px 0;">No hay opciones disponibles.</div>';
                        return;
                    }
                    var list = elt('div', 'repp-options-list');
                    ops2.forEach(function (o) {
                        var row = elt('label', 'repp-option-row');
                        var checked = sel.has(String(o.value)) ? 'checked' : '';
                        row.innerHTML = '<input type="checkbox" value="' + escapeHTML(o.value) + '" ' + checked + '><span>' + escapeHTML(o.label) + '</span>';
                        list.appendChild(row);
                    });
                    list.addEventListener('change', function () {
                        var checks = list.querySelectorAll('input[type=checkbox]:checked');
                        var vals = Array.from(checks).map(function(c){ return c.value; });
                        POPOVER_STATE.draft.valor = vals;
                    });
                    $val.appendChild(list);
                    return;
                }

                if (campo.tipo === 'numero') {
                    if (op === 'between') {
                        var arr = Array.isArray(v) ? v : [];
                        $val.innerHTML = '<div style="display:flex;gap:6px;">'
                            + '<input type="number" class="repp-form-input" placeholder="Desde" id="reppPopValA" value="' + (arr[0] != null ? arr[0] : '') + '">'
                            + '<input type="number" class="repp-form-input" placeholder="Hasta" id="reppPopValB" value="' + (arr[1] != null ? arr[1] : '') + '">'
                            + '</div>';
                        $val.querySelectorAll('input').forEach(function (i) {
                            i.addEventListener('input', function () {
                                var a = $('reppPopValA').value;
                                var b = $('reppPopValB').value;
                                POPOVER_STATE.draft.valor = [a !== '' ? Number(a) : null, b !== '' ? Number(b) : null];
                            });
                        });
                    } else {
                        var input = elt('input', 'repp-form-input');
                        input.type = 'number';
                        input.placeholder = 'Ej: 100000';
                        input.value = v != null && !Array.isArray(v) ? v : '';
                        input.addEventListener('input', function () {
                            POPOVER_STATE.draft.valor = input.value !== '' ? Number(input.value) : null;
                        });
                        $val.appendChild(input);
                    }
                    return;
                }

                if (campo.tipo === 'fecha') {
                    if (op === 'between') {
                        var arrd = Array.isArray(v) ? v : [];
                        $val.innerHTML = '<div style="display:flex;gap:6px;">'
                            + '<input type="date" class="repp-form-input" id="reppPopValA" value="' + (arrd[0] || '') + '">'
                            + '<input type="date" class="repp-form-input" id="reppPopValB" value="' + (arrd[1] || '') + '">'
                            + '</div>';
                        $val.querySelectorAll('input').forEach(function (i) {
                            i.addEventListener('input', function () {
                                POPOVER_STATE.draft.valor = [$('reppPopValA').value, $('reppPopValB').value];
                            });
                        });
                    } else {
                        var inputd = elt('input', 'repp-form-input');
                        inputd.type = 'date';
                        inputd.value = (v != null && !Array.isArray(v)) ? v : '';
                        inputd.addEventListener('input', function () {
                            POPOVER_STATE.draft.valor = inputd.value;
                        });
                        $val.appendChild(inputd);
                    }
                    return;
                }

                // texto
                var inputt = elt('input', 'repp-form-input');
                inputt.type = 'text';
                inputt.placeholder = 'Texto';
                inputt.value = v != null && !Array.isArray(v) ? v : '';
                inputt.addEventListener('input', function () {
                    POPOVER_STATE.draft.valor = inputt.value;
                });
                $val.appendChild(inputt);
            }
        }
    }

    function savePopover() {
        if (POPOVER_STATE.mode === 'addcol') {
            var checks = document.querySelectorAll('#reppAddColList input[type=checkbox]:checked');
            var nuevos = Array.from(checks).map(function(c){ return c.value; });
            if (nuevos.length) {
                state.config.columnas = (state.config.columnas || []).concat(nuevos);
                renderColsList();
                renderAgruparOrden();
                scheduleLoad();
            }
            closePopover();
            return;
        }
        if (POPOVER_STATE.mode === 'filtro') {
            var d = POPOVER_STATE.draft;
            // Validación mínima: campo + op requeridos; valor según tipo
            if (!d.campo || !d.op) { closePopover(); return; }
            var campo = getCampoByKey(state.config.entidad, d.campo);
            if (campo.tipo === 'fecha' && ['this_month','this_year','last_30d'].indexOf(d.op) >= 0) {
                // ok, no valor
            } else if (d.valor == null || d.valor === '' || (Array.isArray(d.valor) && d.valor.length === 0)) {
                // valor vacío → no agregamos
                closePopover();
                return;
            }
            if (POPOVER_STATE.idx != null) {
                state.config.filtros[POPOVER_STATE.idx] = d;
            } else {
                state.config.filtros.push(d);
            }
            state.page = 1;
            renderFiltrosList();
            updateNatural();
            scheduleLoad();
            closePopover();
            return;
        }
        closePopover();
    }

    // ── Carga de datos ──────────────────────────────────────────────
    function scheduleLoad(ms) {
        if (ms == null) ms = 300;
        clearTimeout(state.debounceTimer);
        setPulseLoading(true);
        state.debounceTimer = setTimeout(loadData, ms);
    }

    function setPulseLoading(b) {
        var dot = $('reppPulseDot');
        var label = $('reppPulseLabel');
        if (b) {
            dot.classList.add('loading');
            label.textContent = 'Cargando…';
        } else {
            dot.classList.remove('loading');
            label.textContent = 'En vivo';
        }
    }

    function buildRequestBody() {
        return {
            entidad: state.config.entidad,
            filtros: state.config.filtros || [],
            columnas: state.config.columnas || [],
            agrupar_por: state.config.agrupar_por || null,
            ordenar_por: state.config.ordenar_por || null,
            orden_dir: state.config.orden_dir || 'desc',
            page: state.page,
            page_size: state.page_size,
        };
    }

    function loadData() {
        state.loading = true;
        var body = buildRequestBody();
        fetch(API, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
            },
            body: JSON.stringify(body),
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                state.loading = false;
                setPulseLoading(false);
                if (!data.ok) {
                    renderError(data.error || 'Error desconocido');
                    return;
                }
                state.ultima = data;
                if (data.opciones) {
                    state.opciones = Object.assign({}, state.opciones, data.opciones);
                }
                renderKpis(data);
                renderTabla(data);
                persistDraft();
            })
            .catch(function (err) {
                state.loading = false;
                setPulseLoading(false);
                renderError(String(err));
            });
    }

    function renderError(msg) {
        $('reppKpis').innerHTML = '';
        $('reppTableHost').innerHTML =
            '<div class="repp-empty"><h3>No se pudo cargar</h3><p>' + escapeHTML(msg) + '</p></div>';
        $('reppTableFoot').style.display = 'none';
    }

    // ── KPIs ────────────────────────────────────────────────────────
    function renderKpis(data) {
        var host = $('reppKpis');
        var kpis = data.kpis || [];
        if (!kpis.length) {
            host.innerHTML = '';
            return;
        }
        host.innerHTML = kpis.map(function (k) {
            return '<div class="repp-kpi">'
                + '<div class="repp-kpi-label">' + escapeHTML(k.label) + '</div>'
                + '<div class="repp-kpi-value">' + escapeHTML(k.value_display || String(k.value)) + '</div>'
                + (k.sub ? '<div class="repp-kpi-sub">' + escapeHTML(k.sub) + '</div>' : '')
                + '</div>';
        }).join('');
    }

    // ── Tabla ───────────────────────────────────────────────────────
    function renderTabla(data) {
        var host = $('reppTableHost');
        var filas = data.filas || [];
        var columnas = data.columnas || [];

        if (!columnas.length) {
            host.innerHTML = '<div class="repp-empty"><h3>Sin columnas</h3><p>Agrega al menos una columna.</p></div>';
            $('reppTableFoot').style.display = 'none';
            return;
        }
        if (!filas.length) {
            host.innerHTML = '<div class="repp-empty"><svg width="32" height="32" fill="none" stroke="#CBD5E1" stroke-width="1.6" viewBox="0 0 24 24" style="margin-bottom:8px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><h3>Sin resultados</h3><p>Ningún registro coincide con los filtros.</p></div>';
            $('reppTableFoot').style.display = 'none';
            return;
        }

        var schema = SCHEMA[state.config.entidad];
        var canOpenInline = schema && schema.puede_abrir_inline && schema.row_id_key;

        var html = '<table class="repp-table"><thead><tr>';
        columnas.forEach(function (c) {
            html += '<th class="' + (c.align === 'right' ? 'repp-right' : '') + '">' + escapeHTML(c.label) + '</th>';
        });
        html += '</tr></thead><tbody>';

        var lastGroup = null;
        filas.forEach(function (f) {
            // Si hay agrupación, insertamos un row separador cada vez que cambie
            if (data.agrupar_por && f.__grupo_label != null && f.__grupo_label !== lastGroup) {
                html += '<tr class="repp-group-row"><td colspan="' + columnas.length + '">' + escapeHTML(f.__grupo_label) + '</td></tr>';
                lastGroup = f.__grupo_label;
            }
            var rid = (canOpenInline && f[schema.row_id_key] != null) ? f[schema.row_id_key] : null;
            html += '<tr' + (rid != null ? ' data-opp-id="' + rid + '"' : '') + '>';
            columnas.forEach(function (c) {
                var raw = f[c.key];
                var display = '';
                if (raw == null || raw === '') {
                    display = '<span class="repp-muted">—</span>';
                } else if (c.formato === 'money') {
                    display = '<span class="repp-mono">' + fmtMoney(Number(raw)) + '</span>';
                } else if (c.formato === 'number') {
                    display = '<span class="repp-mono">' + fmtNum(raw) + '</span>';
                } else if (c.formato === 'fecha') {
                    display = '<span class="repp-mono">' + escapeHTML(fmtFecha(raw)) + '</span>';
                } else if (c.formato === 'bool') {
                    display = raw ? 'Sí' : 'No';
                } else {
                    display = escapeHTML(String(raw));
                }
                html += '<td class="' + (c.align === 'right' ? 'repp-right' : '') + '">' + display + '</td>';
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        host.innerHTML = html;

        // Click → openDetalle inline (solo si entidad lo permite)
        if (canOpenInline && typeof window.openDetalle === 'function') {
            host.querySelectorAll('tr[data-opp-id]').forEach(function (tr) {
                tr.addEventListener('click', function () {
                    var id = Number(tr.getAttribute('data-opp-id'));
                    if (id) window.openDetalle(id);
                });
            });
        } else if (canOpenInline) {
            // openDetalle aún no cargó — fallback con navegación
            host.querySelectorAll('tr[data-opp-id]').forEach(function (tr) {
                tr.addEventListener('click', function () {
                    var id = tr.getAttribute('data-opp-id');
                    if (id) window.location.href = '/app/todos/?tab=crm&open_opp=' + id;
                });
            });
        }

        renderFoot(data);
    }

    function renderFoot(data) {
        var foot = $('reppTableFoot');
        foot.style.display = '';
        var total = data.total_filas != null ? data.total_filas : (data.filas || []).length;
        var totalPag = data.total_paginas != null ? data.total_paginas : 1;
        $('reppFootLeft').textContent = total + ' registro' + (total === 1 ? '' : 's');
        if (data.total_monto != null) {
            $('reppFootRight').innerHTML = 'Suma: <strong>' + escapeHTML(fmtMoney(data.total_monto)) + '</strong>';
        } else {
            $('reppFootRight').textContent = '';
        }

        // Pager
        var pager = $('reppPager');
        pager.innerHTML = '';
        if (totalPag > 1) {
            var prev = elt('button', 'repp-pager-btn');
            prev.type = 'button';
            prev.textContent = '‹';
            prev.disabled = (state.page <= 1);
            prev.addEventListener('click', function () {
                if (state.page > 1) { state.page--; scheduleLoad(0); }
            });
            var lbl = elt('span', 'repp-pager-label', 'Página ' + state.page + ' de ' + totalPag);
            var next = elt('button', 'repp-pager-btn');
            next.type = 'button';
            next.textContent = '›';
            next.disabled = (state.page >= totalPag);
            next.addEventListener('click', function () {
                if (state.page < totalPag) { state.page++; scheduleLoad(0); }
            });
            pager.appendChild(prev);
            pager.appendChild(lbl);
            pager.appendChild(next);
        }
    }

    // ── Mis reportes (localStorage) ──────────────────────────────────
    function loadMisReportes() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            var arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }
    function saveMisReportes(arr) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch (e) {}
    }
    function guardarReporte() {
        var nombre = ($('reppHeroNombre').value || '').trim() || 'Mi reporte sin nombre';
        var mios = loadMisReportes();
        // Si ya existe uno con el mismo nombre, reemplazamos (UX simple)
        var encontrado = mios.findIndex(function (m) { return m.nombre === nombre; });
        var entry = {
            nombre: nombre,
            config: Object.assign({}, state.config, { nombre: nombre }),
            ts: Date.now(),
        };
        if (encontrado >= 0) mios[encontrado] = entry;
        else mios.unshift(entry);
        // Cap: 20 reportes guardados
        mios = mios.slice(0, 20);
        saveMisReportes(mios);
        renderStarters();
        toast('Guardado en "Mis reportes"', 'ok');
    }
    function deleteMiReporte(idx) {
        var mios = loadMisReportes();
        mios.splice(idx, 1);
        saveMisReportes(mios);
        renderStarters();
    }

    // Draft (recuperar última config al recargar la página)
    function persistDraft() {
        try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify({
                config: state.config,
                page_size: state.page_size,
                hero: ($('reppHeroNombre') ? $('reppHeroNombre').value : ''),
            }));
        } catch (e) {}
    }
    function restoreDraft() {
        try {
            var raw = localStorage.getItem(DRAFT_KEY);
            if (!raw) return false;
            var d = JSON.parse(raw);
            if (!d || !d.config || !d.config.entidad) return false;
            state.config = d.config;
            state.page_size = d.page_size || 50;
            if (d.hero) {
                setTimeout(function () { $('reppHeroNombre').value = d.hero; }, 0);
            }
            return true;
        } catch (e) { return false; }
    }

    // ── Exportar CSV ────────────────────────────────────────────────
    function exportCSV() {
        if (state.loading) {
            toast('Espera a que termine de cargar…', 'err');
            return;
        }
        var body = buildRequestBody();
        // pedimos un export grande (sin paginar) — el backend respeta page_size=0
        body.page_size = 0;
        body.export = true;

        fetch(API, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
            },
            body: JSON.stringify(body),
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.ok) {
                    toast('Error al exportar: ' + (data.error || ''), 'err');
                    return;
                }
                var csv = buildCSV(data);
                downloadCSV(csv, ($('reppHeroNombre').value || 'reporte') + '.csv');
                toast('CSV descargado', 'ok');
            })
            .catch(function (err) {
                toast('Error de red: ' + err, 'err');
            });
    }

    function csvEscape(s) {
        if (s == null) return '';
        var str = String(s);
        if (/[",\n\r]/.test(str)) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    function buildCSV(data) {
        var schema = SCHEMA[state.config.entidad];
        var nombre = ($('reppHeroNombre').value || 'Mi reporte').trim();
        var usuario = window._REP_USER || 'Usuario';
        var ahora = new Date();
        var fecha = ahora.getFullYear() + '-' + String(ahora.getMonth()+1).padStart(2,'0') + '-' + String(ahora.getDate()).padStart(2,'0');
        var hora = String(ahora.getHours()).padStart(2,'0') + ':' + String(ahora.getMinutes()).padStart(2,'0');

        var filtrosTxt = (state.config.filtros || []).map(humanizeFiltro).join('; ') || 'ninguno';
        var columnasTxt = (data.columnas || []).map(function(c){return c.label;}).join(', ');
        var ordenTxt = '';
        if (state.config.ordenar_por) {
            var co = getCampoByKey(state.config.entidad, state.config.ordenar_por);
            ordenTxt = (co ? co.label : state.config.ordenar_por) + ' ' + (state.config.orden_dir || 'desc');
        }

        var lines = [];
        lines.push('# Reporte: ' + nombre);
        lines.push('# Tipo: Personalizado');
        lines.push('# Exportado por: ' + usuario);
        lines.push('# Fecha: ' + fecha + ' ' + hora);
        lines.push('# Entidad: ' + (schema ? schema.label : state.config.entidad));
        lines.push('# Filtros aplicados: ' + filtrosTxt);
        lines.push('# Columnas: ' + columnasTxt);
        if (state.config.agrupar_por) {
            var ca = getCampoByKey(state.config.entidad, state.config.agrupar_por);
            lines.push('# Agrupado por: ' + (ca ? ca.label : state.config.agrupar_por));
        }
        if (ordenTxt) lines.push('# Ordenado por: ' + ordenTxt);
        lines.push('# Total registros: ' + (data.total_filas != null ? data.total_filas : (data.filas || []).length));
        if (data.total_monto != null) {
            lines.push('# Total monto MXN: ' + fmtMoney(data.total_monto));
        }
        lines.push('');

        // Header
        lines.push((data.columnas || []).map(function (c) { return csvEscape(c.label); }).join(','));

        // Filas
        (data.filas || []).forEach(function (f) {
            var row = (data.columnas || []).map(function (c) {
                var raw = f[c.key];
                if (raw == null) return '';
                if (c.formato === 'money') return Number(raw).toFixed(2);
                if (c.formato === 'fecha') return fmtFecha(raw);
                return csvEscape(raw);
            });
            lines.push(row.join(','));
        });

        // BOM para Excel
        return '﻿' + lines.join('\n');
    }

    function downloadCSV(content, filename) {
        var blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    // ── Toast ───────────────────────────────────────────────────────
    function toast(msg, kind) {
        var t = $('reppToast');
        t.className = 'repp-toast' + (kind === 'ok' ? ' repp-toast-ok' : '') + (kind === 'err' ? ' repp-toast-err' : '');
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(function () { t.classList.remove('show'); }, 2200);
    }

    // ── Init / event wiring ─────────────────────────────────────────
    function init() {
        // Restaurar última configuración (draft) o aplicar plantilla default
        if (!restoreDraft()) {
            state.config = defaultConfig();
        }

        renderConfigPanel();

        // Entidad
        $('reppEntidad').addEventListener('click', function (e) {
            var b = e.target.closest('.repp-seg-btn');
            if (!b) return;
            var nuevaEntidad = b.dataset.entidad;
            if (nuevaEntidad === state.config.entidad) return;
            // Cambio de entidad → resetear filtros/columnas a defaults razonables
            var schema = SCHEMA[nuevaEntidad];
            state.config = {
                entidad: nuevaEntidad,
                filtros: [],
                columnas: schema.campos.slice(0, 5).map(function(c){return c.key;}),
                agrupar_por: '',
                ordenar_por: schema.campos[0].key,
                orden_dir: 'desc',
                nombre: 'Reporte de ' + schema.label.toLowerCase(),
            };
            state.page = 1;
            $('reppHeroNombre').value = state.config.nombre;
            renderConfigPanel();
            scheduleLoad(0);
        });

        // Filtros
        $('reppAddFiltro').addEventListener('click', function () { openFiltroPopover(null); });

        // Columnas
        $('reppAddCol').addEventListener('click', openAddColPopover);

        // Agrupar / ordenar
        $('reppAgruparPor').addEventListener('change', function () {
            state.config.agrupar_por = $('reppAgruparPor').value;
            updateNatural();
            scheduleLoad();
        });
        $('reppOrdenarPor').addEventListener('change', function () {
            state.config.ordenar_por = $('reppOrdenarPor').value;
            updateNatural();
            scheduleLoad();
        });
        $('reppOrdenDir').addEventListener('change', function () {
            state.config.orden_dir = $('reppOrdenDir').value;
            updateNatural();
            scheduleLoad();
        });

        // Acciones
        $('reppGuardar').addEventListener('click', guardarReporte);
        $('reppExportar').addEventListener('click', exportCSV);
        $('reppResetear').addEventListener('click', function () {
            if (!confirm('¿Resetear el constructor? Se descartará la configuración actual (los reportes guardados se conservan).')) return;
            state.config = defaultConfig();
            state.page = 1;
            state.page_size = 50;
            $('reppHeroNombre').value = state.config.nombre || 'Mi reporte';
            renderConfigPanel();
            scheduleLoad(0);
        });

        // Popover
        $('reppPopoverClose').addEventListener('click', closePopover);
        $('reppPopoverOverlay').addEventListener('click', closePopover);
        $('reppPopoverCancel').addEventListener('click', closePopover);
        $('reppPopoverSave').addEventListener('click', savePopover);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && $('reppPopover').classList.contains('open')) {
                closePopover();
            }
        });

        // Hero nombre (solo persistencia, no recarga)
        $('reppHeroNombre').addEventListener('input', function () {
            state.config.nombre = $('reppHeroNombre').value;
            persistDraft();
        });

        // Primer load
        scheduleLoad(0);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
