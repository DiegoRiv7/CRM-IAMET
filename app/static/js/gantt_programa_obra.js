/* ============================================================
   gantt_programa_obra.js  --  Diagrama de Gantt interactivo
   Modulo autocontenido — Canvas 2D + DOM, sin dependencias
   ============================================================ */
(function () {
    'use strict';

    /* ===========================================
       CONSTANTES
       =========================================== */
    var COL_W  = 36;
    var ROW_H  = 38;
    var BAR_H  = 22;
    var BAR_Y  = 8;
    var EDGE   = 8;      // zona de resize en bordes de barra
    var HEADER_H = 52;   // alto del header de fechas

    var COLOR_PRIMARY      = '#3B82F6';
    var COLOR_PRIMARY_DARK = '#1E40AF';
    var COLOR_PRIMARY_FILL = '#1D4ED8';
    var COLOR_DARK         = '#1E293B';
    var COLOR_LIGHT        = '#F9FAFB';
    var COLOR_BORDER       = '#E5E7EB';
    var COLOR_HEADER       = '#FFFFFF';
    var COLOR_GRAY         = '#94A3B8';
    var COLOR_TEXT_SEC      = '#64748B';
    var COLOR_TEXT_MUTED    = '#94A3B8';
    var COLOR_BLUE         = '#3B82F6';
    var COLOR_GREEN        = '#10B981';
    var COLOR_WARNING      = '#F59E0B';
    var COLOR_DANGER       = '#EF4444';
    var COLOR_BLACK        = '#1E293B';
    var COLOR_SEL          = COLOR_PRIMARY;
    var COLOR_HOVER_BG     = '#F8FAFC';
    var COLOR_PHASE_BAR    = '#475569';

    var ZOOM_PRESETS = { day: 50, week: 36, month: 12 };

    /* ===========================================
       TEMPLATES DE PROYECTO
       =========================================== */
    var GANTT_TEMPLATES = [
        {
            id: 'cctv',
            name: 'Instalaci\u00f3n CCTV / Control de Acceso',
            desc: 'Proyecto completo de videovigilancia o control de acceso',
            icon: 'camera',
            phases: [
                { name: 'Levantamiento', activities: [
                    { name: 'Toma de medidas y fotos', dur: 2 },
                    { name: 'Revisi\u00f3n de planos', dur: 1 }
                ]},
                { name: 'Cotizaci\u00f3n', activities: [
                    { name: 'Elaborar cotizaci\u00f3n', dur: 3 },
                    { name: 'Enviar al cliente', dur: 1 },
                    { name: 'Seguimiento', dur: 3 }
                ]},
                { name: 'Compra de Material', activities: [
                    { name: 'Generar orden de compra', dur: 2 },
                    { name: 'Esperar entrega', dur: 8 }
                ]},
                { name: 'Instalaci\u00f3n', activities: [
                    { name: 'Canalizaci\u00f3n', dur: 5 },
                    { name: 'Cableado', dur: 5 },
                    { name: 'Montaje de equipos', dur: 3 },
                    { name: 'Conexiones', dur: 2 }
                ]},
                { name: 'Puesta en Marcha', activities: [
                    { name: 'Configuraci\u00f3n', dur: 3 },
                    { name: 'Pruebas', dur: 2 },
                    { name: 'Capacitaci\u00f3n', dur: 1 },
                    { name: 'Entrega formal', dur: 1 }
                ]}
            ]
        },
        {
            id: 'cableado',
            name: 'Cableado Estructurado',
            desc: 'Red de datos, voz o fibra \u00f3ptica',
            icon: 'network',
            phases: [
                { name: 'Levantamiento', activities: [
                    { name: 'Inspecci\u00f3n de sitio', dur: 2 },
                    { name: 'Dise\u00f1o de red', dur: 3 }
                ]},
                { name: 'Cotizaci\u00f3n y Compra', activities: [
                    { name: 'Cotizaci\u00f3n', dur: 3 },
                    { name: 'Aprobaci\u00f3n cliente', dur: 5 },
                    { name: 'Compra de material', dur: 8 }
                ]},
                { name: 'Ejecuci\u00f3n', activities: [
                    { name: 'Canalizaci\u00f3n', dur: 8 },
                    { name: 'Tendido de cable', dur: 6 },
                    { name: 'Terminaciones', dur: 4 }
                ]},
                { name: 'Cierre', activities: [
                    { name: 'Certificaci\u00f3n', dur: 3 },
                    { name: 'Documentaci\u00f3n', dur: 2 },
                    { name: 'Entrega', dur: 1 }
                ]}
            ]
        },
        {
            id: 'mantenimiento',
            name: 'Mantenimiento / P\u00f3liza',
            desc: 'Servicio correctivo o preventivo',
            icon: 'wrench',
            phases: [
                { name: 'Diagn\u00f3stico', activities: [
                    { name: 'Evaluaci\u00f3n inicial', dur: 1 },
                    { name: 'Reporte de diagn\u00f3stico', dur: 1 }
                ]},
                { name: 'Ejecuci\u00f3n', activities: [
                    { name: 'Cotizaci\u00f3n de refacciones', dur: 2 },
                    { name: 'Aprobaci\u00f3n', dur: 3 },
                    { name: 'Reparaci\u00f3n/Mantenimiento', dur: 5 },
                    { name: 'Pruebas', dur: 2 }
                ]},
                { name: 'Cierre', activities: [
                    { name: 'Reporte de servicio', dur: 1 }
                ]}
            ]
        },
        {
            id: 'custom',
            name: 'Proyecto Personalizado',
            desc: 'Comienza desde cero con una fase vac\u00eda',
            icon: 'plus',
            phases: [
                { name: 'Fase 1', activities: [
                    { name: 'Actividad 1', dur: 5 }
                ]}
            ]
        }
    ];

    var GANTT_TPL_ICONS = {
        camera: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>',
        network: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4m0 0l-7 4m7-4l7 4"/></svg>',
        wrench: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
        plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
    };

    /* ===========================================
       HELPERS
       =========================================== */
    function _csrf() {
        var tok = document.querySelector('[name=csrfmiddlewaretoken]');
        return tok ? tok.value : '';
    }

    function _fetch(url, opts) {
        opts = opts || {};
        opts.headers = opts.headers || {};
        opts.headers['X-CSRFToken'] = _csrf();
        if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(opts.body);
        }
        opts.credentials = 'same-origin';
        return fetch(url, opts).then(function (r) { return r.json(); });
    }

    function el(tag, attrs, children) {
        var e = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            if (k === 'className') e.className = attrs[k];
            else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(e.style, attrs[k]);
            else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
            else e.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(function (c) {
            if (typeof c === 'string') e.appendChild(document.createTextNode(c));
            else if (c) e.appendChild(c);
        });
        return e;
    }

    function fmtMoney(v) {
        var n = Number(v || 0);
        if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return '$' + (n / 1000).toFixed(0) + 'k';
        return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    function dateStr(d) {
        var mm = ('0' + (d.getMonth() + 1)).slice(-2);
        var dd = ('0' + d.getDate()).slice(-2);
        return d.getFullYear() + '-' + mm + '-' + dd;
    }

    function addDays(d, n) {
        var r = new Date(d);
        r.setDate(r.getDate() + n);
        return r;
    }

    function daysBetween(a, b) {
        return Math.round((b - a) / 86400000);
    }

    function parseDate(s) {
        var p = s.split('-');
        return new Date(+p[0], +p[1] - 1, +p[2]);
    }

    var DAY_NAMES_SHORT = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
    var MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    /* ===========================================
       GANTT CLASS
       =========================================== */
    function Gantt(containerId, proyectoId) {
        this.containerId = containerId;
        this.proyectoId = proyectoId;
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.tasks = [];
        this.resources = [];
        this.projectStart = new Date();
        this.totalDays = 90;
        this.nextId = 1;
        this.selectedTaskId = null;
        this.dragState = null;
        this.colW = COL_W;
        this.zoom = 'week';

        // DOM refs
        this.root = null;
        this.toolbar = null;
        this.tableWrap = null;
        this.tableBody = null;
        this.canvasWrap = null;
        this.canvas = null;
        this.ctx = null;
        this.svgOverlay = null;
        this.tooltip = null;
        this.modal = null;
        this.headerCanvas = null;
        this.headerCtx = null;

        this._hoveredTaskId = null;
        this._hoveredConnector = false; // true when mouse is over the connector dot
        this._connectingFrom = null;    // taskId when dragging a connector line
        this._tooltipTimer = null;
        this._dpr = window.devicePixelRatio || 1;
        this.viewMode = 'schedule'; // 'schedule' or 'financial'

        this._build();
        this._loadData();
    }

    /* -------------------------------------------
       BUILD DOM STRUCTURE
       ------------------------------------------- */
    Gantt.prototype._build = function () {
        var self = this;
        this.container.innerHTML = '';
        this.container.style.position = 'relative';

        // -- Inject scoped styles
        this._injectStyles();

        // -- Root
        this.root = el('div', { className: 'gantt-root' });
        this.container.appendChild(this.root);

        // -- Toolbar
        this.toolbar = this._buildToolbar();
        this.root.appendChild(this.toolbar);

        // -- EVM Dashboard Panel
        this.evmPanel = this._buildEVMPanel();
        this.root.appendChild(this.evmPanel);

        // -- Main wrapper (table + canvas side by side)
        var main = el('div', { className: 'gantt-main' });
        this.root.appendChild(main);

        // -- Left: Table
        var tablePanel = el('div', { className: 'gantt-table-panel' });
        main.appendChild(tablePanel);

        // table header — minimal, implicit (no column labels)
        var thead = el('div', { className: 'gantt-table-header' });
        tablePanel.appendChild(thead);

        this.tableWrap = el('div', { className: 'gantt-table-body-wrap' });
        tablePanel.appendChild(this.tableWrap);
        this.tableBody = el('div', { className: 'gantt-table-body' });
        this.tableWrap.appendChild(this.tableBody);

        // -- Right: Canvas
        var canvasPanel = el('div', { className: 'gantt-canvas-panel' });
        main.appendChild(canvasPanel);

        // canvas header (dates)
        var headerWrap = el('div', { className: 'gantt-canvas-header-wrap' });
        canvasPanel.appendChild(headerWrap);
        this.headerCanvas = el('canvas', { className: 'gantt-header-canvas' });
        headerWrap.appendChild(this.headerCanvas);
        this.headerCtx = this.headerCanvas.getContext('2d');

        this.canvasWrap = el('div', { className: 'gantt-canvas-wrap' });
        canvasPanel.appendChild(this.canvasWrap);

        this.canvas = el('canvas', { className: 'gantt-canvas' });
        this.canvasWrap.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        // SVG overlay for dependency arrows
        this.svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svgOverlay.setAttribute('class', 'gantt-svg-overlay');
        this.svgOverlay.style.position = 'absolute';
        this.svgOverlay.style.top = '0';
        this.svgOverlay.style.left = '0';
        this.svgOverlay.style.pointerEvents = 'none';
        this.canvasWrap.appendChild(this.svgOverlay);

        // Tooltip
        this.tooltip = el('div', { className: 'gantt-tooltip' });
        this.tooltip.style.display = 'none';
        this.root.appendChild(this.tooltip);

        // Modal
        this.modal = el('div', { className: 'gantt-modal-overlay' });
        this.modal.style.display = 'none';
        this.root.appendChild(this.modal);

        // -- Sync vertical scroll
        this.tableWrap.addEventListener('scroll', function () {
            self.canvasWrap.scrollTop = self.tableWrap.scrollTop;
        });
        this.canvasWrap.addEventListener('scroll', function () {
            self.tableWrap.scrollTop = self.canvasWrap.scrollTop;
            // sync header horizontal scroll
            headerWrap.scrollLeft = self.canvasWrap.scrollLeft;
        });

        // -- Canvas events
        this.canvas.addEventListener('mousedown', function (e) { self._onMouseDown(e); });
        this.canvas.addEventListener('mousemove', function (e) { self._onMouseMove(e); });
        this.canvas.addEventListener('dblclick', function (e) { self._onDblClick(e); });
        this.canvas.addEventListener('mouseleave', function () { self._hideTooltip(); self._renderCanvas(); });
        this.canvas.addEventListener('contextmenu', function (e) { self._onContextMenu(e); });
        document.addEventListener('mousemove', function (e) { self._onDocMouseMove(e); });
        document.addEventListener('mouseup', function (e) { self._onMouseUp(e); });

        // Close context menu on click outside or ESC
        document.addEventListener('mousedown', function (e) {
            var menu = self.root.querySelector('.gantt-ctx-menu');
            if (menu && !menu.contains(e.target)) {
                menu.remove();
            }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var menu = self.root.querySelector('.gantt-ctx-menu');
                if (menu) menu.remove();
            }
        });
    };

    /* -------------------------------------------
       INJECT SCOPED STYLES
       ------------------------------------------- */
    Gantt.prototype._injectStyles = function () {
        if (document.getElementById('gantt-obra-styles')) return;
        var css = [
            '.gantt-root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: ' + COLOR_DARK + '; font-size: 13px; display: flex; flex-direction: column; height: calc(100vh - 320px); min-height: 350px; background: #fff; border: 1px solid ' + COLOR_BORDER + '; border-radius: 10px; overflow: hidden; }',

            /* Toolbar — sin borde inferior, solo espacio */
            '.gantt-toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 14px; background: #fff; }',
            '.gantt-btn { padding: 5px 14px; border: 1px solid ' + COLOR_BORDER + '; border-radius: 8px; background: #fff; cursor: pointer; font-size: 0.78rem; font-weight: 600; color: ' + COLOR_DARK + '; transition: all .15s; white-space: nowrap; font-family: inherit; }',
            '.gantt-btn:hover { background: #f1f5f9; border-color: #cbd5e1; }',
            '.gantt-btn-primary { background: ' + COLOR_PRIMARY + '; color: #fff; border-color: ' + COLOR_PRIMARY + '; font-size: 0.78rem; }',
            '.gantt-btn-primary:hover { background: ' + COLOR_PRIMARY_DARK + '; }',
            '.gantt-btn-danger { color: #dc2626; border-color: #fecaca; font-size: 0.78rem; }',
            '.gantt-btn-danger:hover { background: #fef2f2; }',
            /* Zoom segmented control — sin borde exterior */
            '.gantt-zoom-group { display: flex; border-radius: 8px; overflow: hidden; }',
            '.gantt-zoom-btn { padding: 5px 12px; border: none; background: #F1F5F9; cursor: pointer; font-size: 0.7rem; font-weight: 700; color: ' + COLOR_TEXT_SEC + '; transition: all .12s; font-family: inherit; border-right: 1px solid ' + COLOR_BORDER + '; }',
            '.gantt-zoom-btn:last-child { border-right: none; }',
            '.gantt-zoom-btn:hover { background: #E2E8F0; }',
            '.gantt-zoom-btn.active { background: ' + COLOR_PRIMARY + '; color: #fff; }',
            /* Empty state — mejorado */
            '.gantt-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; color: ' + COLOR_TEXT_MUTED + '; gap: 14px; padding: 48px; }',
            '.gantt-empty-icon { width: 64px; height: 64px; border-radius: 16px; background: #F1F5F9; display: flex; align-items: center; justify-content: center; }',
            '.gantt-empty-text { font-size: 0.95rem; font-weight: 600; color: ' + COLOR_DARK + '; }',
            '.gantt-empty-sub { font-size: 0.8rem; color: ' + COLOR_TEXT_MUTED + '; text-align: center; line-height: 1.5; }',

            /* Template cards */
            '.gantt-templates { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; max-width: 560px; margin: 0 auto; }',
            '.gantt-tpl-card { background: #fff; border: 1.5px solid #E5E7EB; border-radius: 12px; padding: 18px; cursor: pointer; transition: all 0.15s; text-align: left; }',
            '.gantt-tpl-card:hover { border-color: #3B82F6; box-shadow: 0 4px 12px rgba(59,130,246,0.12); transform: translateY(-1px); }',
            '.gantt-tpl-icon { width: 36px; height: 36px; border-radius: 8px; background: #EFF6FF; display: flex; align-items: center; justify-content: center; margin-bottom: 10px; }',
            '.gantt-tpl-name { font-size: 0.88rem; font-weight: 700; color: #1E293B; margin-bottom: 4px; }',
            '.gantt-tpl-desc { font-size: 0.75rem; color: #64748B; }',
            '.gantt-tpl-loading { text-align: center; padding: 40px; color: #64748B; }',
            '.gantt-tpl-manual { font-size: 0.78rem; color: ' + COLOR_TEXT_MUTED + '; cursor: pointer; text-decoration: none; margin-top: 4px; }',
            '.gantt-tpl-manual:hover { color: ' + COLOR_PRIMARY + '; text-decoration: underline; }',

            /* Main */
            '.gantt-main { display: flex; flex: 1; overflow: hidden; min-height: 0; }',

            /* Table panel — separador sutil */
            '.gantt-table-panel { width: 26%; min-width: 200px; max-width: 340px; display: flex; flex-direction: column; border-right: 1px solid ' + COLOR_BORDER + '; }',
            '.gantt-table-header { display: flex; height: ' + HEADER_H + 'px; background: #fff; border-bottom: 1px solid ' + COLOR_BORDER + '; align-items: flex-end; padding-bottom: 4px; }',
            '.gantt-table-body-wrap { flex: 1; overflow-y: auto; overflow-x: hidden; }',
            '.gantt-table-body-wrap::-webkit-scrollbar { display: none; }',
            '.gantt-table-body { }',

            /* Table row — solo columna nombre */
            '.gantt-row { display: flex; align-items: center; height: ' + ROW_H + 'px; border-bottom: 1px solid #F8FAFC; cursor: pointer; padding: 0 10px; transition: background .1s; position: relative; border-left: 3px solid transparent; }',
            '.gantt-row:hover { background: ' + COLOR_HOVER_BG + '; }',
            '.gantt-row.selected { border-left-color: ' + COLOR_PRIMARY + '; background: #fff; }',
            '.gantt-row-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 6px; font-size: 13px; color: ' + COLOR_DARK + '; }',
            /* Badges inline que aparecen en hover */
            '.gantt-row-badges { display: none; align-items: center; gap: 4px; margin-left: auto; flex-shrink: 0; }',
            '.gantt-row:hover .gantt-row-badges { display: flex; }',
            '.gantt-badge { padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; background: #F1F5F9; color: ' + COLOR_TEXT_SEC + '; white-space: nowrap; }',
            '.gantt-badge-prog { background: #EFF6FF; color: ' + COLOR_PRIMARY + '; }',
            '.gantt-phase-name { font-weight: 700; font-size: 13px; color: ' + COLOR_DARK + '; }',
            '.gantt-toggle { cursor: pointer; width: 16px; font-size: 9px; color: ' + COLOR_TEXT_MUTED + '; user-select: none; flex-shrink: 0; transition: color .1s; }',
            '.gantt-toggle:hover { color: ' + COLOR_TEXT_SEC + '; }',
            '.gantt-indent { display: inline-block; width: 20px; flex-shrink: 0; }',

            /* Canvas panel */
            '.gantt-canvas-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; }',
            '.gantt-canvas-header-wrap { height: ' + HEADER_H + 'px; overflow: hidden; background: #fff; border-bottom: 1px solid ' + COLOR_BORDER + '; }',
            '.gantt-header-canvas { display: block; }',
            '.gantt-canvas-wrap { flex: 1; overflow: auto; position: relative; }',
            '.gantt-canvas-wrap::-webkit-scrollbar { height: 6px; width: 6px; }',
            '.gantt-canvas-wrap::-webkit-scrollbar-track { background: transparent; }',
            '.gantt-canvas-wrap::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }',
            '.gantt-canvas-wrap::-webkit-scrollbar-thumb:hover { background: #94A3B8; }',
            '.gantt-canvas { display: block; }',

            /* Tooltip — mini-card design */
            '.gantt-tooltip { position: absolute; z-index: 100; background: #fff; border: none; border-radius: 12px; padding: 14px; font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); pointer-events: none; max-width: 280px; line-height: 1.6; opacity: 0; transition: opacity 0.15s ease; }',
            '.gantt-tooltip.visible { opacity: 1; }',
            '.gantt-tooltip-title { font-weight: 700; font-size: 13px; margin-bottom: 8px; color: ' + COLOR_DARK + '; }',
            '.gantt-tooltip-dates { color: ' + COLOR_TEXT_SEC + '; font-size: 12px; margin-bottom: 8px; }',
            '.gantt-tooltip-progress-wrap { margin-bottom: 8px; }',
            '.gantt-tooltip-progress-label { font-size: 11px; color: ' + COLOR_TEXT_SEC + '; margin-bottom: 3px; }',
            '.gantt-tooltip-progress-bar { height: 4px; background: #F1F5F9; border-radius: 2px; overflow: hidden; }',
            '.gantt-tooltip-progress-fill { height: 100%; border-radius: 2px; transition: width .2s; }',
            '.gantt-tooltip-row { color: ' + COLOR_TEXT_SEC + '; font-size: 12px; display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }',
            '.gantt-tooltip-row span { color: ' + COLOR_DARK + '; font-weight: 600; }',
            '.gantt-tooltip-avatars { display: flex; gap: 4px; margin-top: 6px; }',
            '.gantt-tooltip-avatar { width: 22px; height: 22px; border-radius: 50%; background: ' + COLOR_PRIMARY + '; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; }',

            /* Modal */
            '.gantt-modal-overlay { position: absolute; inset: 0; background: rgba(0,0,0,.25); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 200; display: flex; align-items: center; justify-content: center; }',
            '.gantt-modal { background: #fff; border-radius: 16px; padding: 20px; width: 420px; max-width: 95%; box-shadow: 0 12px 40px rgba(0,0,0,.2); }',
            '.gantt-modal h3 { margin: 0 0 16px; font-size: 16px; font-weight: 600; }',
            /* Resource modal */
            '.gantt-res-list { max-height: 300px; overflow-y: auto; margin: 12px 0; }',
            '.gantt-res-list::-webkit-scrollbar { width: 4px; }',
            '.gantt-res-list::-webkit-scrollbar-track { background: transparent; }',
            '.gantt-res-list::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 2px; }',
            '.gantt-res-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 8px; cursor: pointer; transition: background .1s; }',
            '.gantt-res-row:hover { background: #F8FAFC; }',
            '.gantt-res-avatar { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 12px; font-weight: 700; flex-shrink: 0; }',
            '.gantt-res-info { flex: 1; min-width: 0; }',
            '.gantt-res-name { font-size: 13px; font-weight: 500; color: ' + COLOR_DARK + '; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
            '.gantt-res-role { font-size: 11px; color: ' + COLOR_TEXT_MUTED + '; }',
            '.gantt-res-cb { width: 18px; height: 18px; border-radius: 4px; border: 2px solid #CBD5E1; appearance: none; -webkit-appearance: none; cursor: pointer; position: relative; flex-shrink: 0; transition: all .15s; }',
            '.gantt-res-cb:checked { background: ' + COLOR_PRIMARY + '; border-color: ' + COLOR_PRIMARY + '; }',
            '.gantt-res-cb:checked::after { content: ""; display: block; width: 5px; height: 9px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); position: absolute; top: 1px; left: 5px; }',
            '.gantt-res-loading { display: flex; align-items: center; justify-content: center; padding: 24px; color: ' + COLOR_TEXT_MUTED + '; font-size: 13px; }',
            '.gantt-modal-field { margin-bottom: 12px; }',
            '.gantt-modal-field label { display: block; font-size: 12px; font-weight: 500; color: ' + COLOR_TEXT_SEC + '; margin-bottom: 4px; }',
            '.gantt-modal-field input, .gantt-modal-field select { width: 100%; padding: 7px 10px; border: 1px solid ' + COLOR_BORDER + '; border-radius: 8px; font-size: 13px; box-sizing: border-box; }',
            '.gantt-modal-field input:focus, .gantt-modal-field select:focus { outline: none; border-color: ' + COLOR_PRIMARY + '; box-shadow: 0 0 0 3px rgba(59,130,246,.12); }',
            '.gantt-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }',
            /* Context menu */
            '.gantt-ctx-menu { position: absolute; z-index: 300; background: #fff; border: 1px solid ' + COLOR_BORDER + '; border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,.16); padding: 4px 0; min-width: 200px; font-size: 13px; }',
            '.gantt-ctx-item { padding: 8px 14px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background .1s; position: relative; color: ' + COLOR_DARK + '; }',
            '.gantt-ctx-item:hover { background: #f1f5f9; }',
            '.gantt-ctx-item.danger { color: #dc2626; }',
            '.gantt-ctx-sep { height: 1px; background: ' + COLOR_BORDER + '; margin: 4px 0; }',
            '.gantt-ctx-sub { position: absolute; left: 100%; top: -4px; background: #fff; border: 1px solid ' + COLOR_BORDER + '; border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,.16); padding: 4px 0; min-width: 200px; max-height: 240px; overflow-y: auto; z-index: 301; display: none; }',
            '.gantt-ctx-item:hover > .gantt-ctx-sub { display: block; }',
            '.gantt-ctx-sub-item { padding: 6px 14px; cursor: pointer; transition: background .1s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
            '.gantt-ctx-sub-item:hover { background: #f1f5f9; }',
            '.gantt-ctx-arrow { margin-left: auto; color: ' + COLOR_TEXT_MUTED + '; font-size: 10px; }',
            '.gantt-ctx-progress-wrap { padding: 8px 14px; display: flex; align-items: center; gap: 8px; }',
            '.gantt-ctx-progress-input { width: 60px; padding: 4px 8px; border: 1px solid ' + COLOR_BORDER + '; border-radius: 6px; font-size: 13px; text-align: center; }',
            '.gantt-ctx-progress-input:focus { outline: none; border-color: ' + COLOR_PRIMARY + '; box-shadow: 0 0 0 3px rgba(59,130,246,.12); }',
            '.gantt-ctx-progress-btn { padding: 4px 10px; background: ' + COLOR_PRIMARY + '; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; }',
            '.gantt-ctx-progress-btn:hover { background: ' + COLOR_PRIMARY_DARK + '; }',

            /* Inline edit */
            '.gantt-inline-input { width: 100%; padding: 2px 6px; border: 1px solid ' + COLOR_PRIMARY + '; border-radius: 6px; font-size: 13px; font-family: inherit; outline: none; box-shadow: 0 0 0 3px rgba(59,130,246,.12); box-sizing: border-box; }',
            '.gantt-inline-input.small { width: 40px; text-align: center; padding: 2px 4px; }',

            /* Editable cell columns */
            '.gantt-row-dur, .gantt-row-prog { width: 44px; flex-shrink: 0; text-align: center; font-size: 11px; color: ' + COLOR_TEXT_SEC + '; font-weight: 600; display: flex; align-items: center; justify-content: center; }',
            '.gantt-row:not(.gantt-row--phase) .gantt-row-dur:hover, .gantt-row:not(.gantt-row--phase) .gantt-row-prog:hover { background: #F8FAFC; cursor: text; border-radius: 4px; }',

            /* EVM Dashboard Panel */
            '.gantt-evm-panel { display: flex; gap: 10px; padding: 6px 14px 8px; background: #fff; border-bottom: 1px solid ' + COLOR_BORDER + '; }',
            '.gantt-evm-card { flex: 1; background: #F8FAFC; border: 1px solid ' + COLOR_BORDER + '; border-radius: 8px; padding: 10px 14px; min-width: 0; }',
            '.gantt-evm-label { font-size: 0.68rem; text-transform: uppercase; color: ' + COLOR_TEXT_SEC + '; font-weight: 600; letter-spacing: 0.03em; margin-bottom: 4px; }',
            '.gantt-evm-value { font-size: 1.1rem; font-weight: 800; color: ' + COLOR_DARK + '; }',
            '.gantt-evm-bar-wrap { height: 4px; background: #E2E8F0; border-radius: 2px; overflow: hidden; margin-top: 6px; }',
            '.gantt-evm-bar-fill { height: 100%; background: ' + COLOR_BLUE + '; border-radius: 2px; transition: width .3s ease; }',
        ].join('\n');

        var style = document.createElement('style');
        style.id = 'gantt-obra-styles';
        style.textContent = css;
        document.head.appendChild(style);
    };

    /* -------------------------------------------
       TOOLBAR
       ------------------------------------------- */
    Gantt.prototype._buildToolbar = function () {
        var self = this;

        // CTA principal
        var btnAdd = el('button', { className: 'gantt-btn gantt-btn-primary', onClick: function () { self._showAddModal(); } }, ['+ Actividad']);

        // Eliminar: solo aparece visible cuando hay selección (se togglea en _renderTable)
        this._btnDel = el('button', {
            className: 'gantt-btn gantt-btn-danger',
            style: { display: 'none' },
            onClick: function () { self._deleteSelected(); }
        }, ['Eliminar']);

        // Expandir/Colapsar en un solo botón toggle
        this._btnToggleFases = el('button', { className: 'gantt-btn', onClick: function () {
            var anyExpanded = self.tasks.some(function(t) { return t.isPhase && !t.collapsed; });
            self._setAllCollapsed(anyExpanded);
        }}, ['Fases']);
        this._btnToggleFases.style.display = 'none'; // se muestra si hay fases

        // Boton vista financiera
        this._btnFinancial = el('button', {
            className: 'gantt-btn',
            onClick: function () { self._toggleViewMode(); }
        }, ['$ Financiero']);

        // Spacer
        var spacer = el('div', { style: { flex: '1' } });

        // Zoom como segmented control compacto
        this._zoomBtns = {};
        var zoomLabels = { day: 'D', week: 'S', month: 'M' };
        var zoomTitles = { day: 'Vista por Dia', week: 'Vista por Semana', month: 'Vista por Mes' };
        var zoomGroup = el('div', { className: 'gantt-zoom-group' });
        ['day', 'week', 'month'].forEach(function (z) {
            var btn = el('button', {
                className: 'gantt-zoom-btn' + (z === self.zoom ? ' active' : ''),
                title: zoomTitles[z],
                onClick: function () { self._setZoom(z); }
            }, [zoomLabels[z]]);
            self._zoomBtns[z] = btn;
            zoomGroup.appendChild(btn);
        });

        // Botón "+ Fase" (secundario)
        var btnAddPhase = el('button', { className: 'gantt-btn', onClick: function () { self._showAddPhaseModal(); } }, ['+ Fase']);

        // Botón Expandir / Pantalla completa (Mejora 1)
        this._btnFullscreen = el('button', {
            className: 'gantt-btn gantt-btn-icon',
            title: 'Pantalla completa',
            onClick: function () { self._toggleFullscreen(); }
        });
        this._btnFullscreen.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg><span>Pantalla completa</span>';

        return el('div', { className: 'gantt-toolbar' }, [btnAdd, btnAddPhase, this._btnDel, this._btnToggleFases, this._btnFinancial, spacer, this._btnFullscreen, zoomGroup]);
    };

    /* -------------------------------------------
       TOGGLE VIEW MODE (schedule / financial)
       ------------------------------------------- */
    Gantt.prototype._toggleViewMode = function () {
        this.viewMode = this.viewMode === 'schedule' ? 'financial' : 'schedule';
        if (this._btnFinancial) {
            if (this.viewMode === 'financial') {
                this._btnFinancial.style.background = COLOR_PRIMARY;
                this._btnFinancial.style.color = '#fff';
                this._btnFinancial.style.borderColor = COLOR_PRIMARY;
            } else {
                this._btnFinancial.style.background = '';
                this._btnFinancial.style.color = '';
                this._btnFinancial.style.borderColor = '';
            }
        }
        this._render();
    };

    /* -------------------------------------------
       EVM DASHBOARD PANEL
       ------------------------------------------- */
    Gantt.prototype._buildEVMPanel = function () {
        var panel = el('div', { className: 'gantt-evm-panel' });

        // Card: Avance Global
        this._evmAvance = el('div', { className: 'gantt-evm-card' });
        this._evmAvance.innerHTML = '<div class="gantt-evm-label">AVANCE GLOBAL</div><div class="gantt-evm-value">0%</div><div class="gantt-evm-bar-wrap"><div class="gantt-evm-bar-fill" style="width:0%"></div></div>';

        // Card: SPI
        this._evmSPI = el('div', { className: 'gantt-evm-card' });
        this._evmSPI.innerHTML = '<div class="gantt-evm-label">SPI</div><div class="gantt-evm-value">--</div>';

        // Card: CPI
        this._evmCPI = el('div', { className: 'gantt-evm-card' });
        this._evmCPI.innerHTML = '<div class="gantt-evm-label">CPI</div><div class="gantt-evm-value">--</div>';

        // Card: Presupuesto
        this._evmBudget = el('div', { className: 'gantt-evm-card' });
        this._evmBudget.innerHTML = '<div class="gantt-evm-label">PRESUPUESTO</div><div class="gantt-evm-value">$0</div>';

        panel.appendChild(this._evmAvance);
        panel.appendChild(this._evmSPI);
        panel.appendChild(this._evmCPI);
        panel.appendChild(this._evmBudget);

        return panel;
    };

    Gantt.prototype._updateEVM = function () {
        var tasks = this.tasks.filter(function (t) { return !t.isPhase; });
        var totalTasks = tasks.length;

        if (totalTasks === 0) {
            // No tasks — show defaults
            if (this._evmAvance) this._evmAvance.innerHTML = '<div class="gantt-evm-label">AVANCE GLOBAL</div><div class="gantt-evm-value">0%</div><div class="gantt-evm-bar-wrap"><div class="gantt-evm-bar-fill" style="width:0%"></div></div>';
            if (this._evmSPI) this._evmSPI.innerHTML = '<div class="gantt-evm-label">SPI</div><div class="gantt-evm-value" style="color:' + COLOR_TEXT_SEC + '">--</div>';
            if (this._evmCPI) this._evmCPI.innerHTML = '<div class="gantt-evm-label">CPI</div><div class="gantt-evm-value" style="color:' + COLOR_TEXT_SEC + '">--</div>';
            if (this._evmBudget) this._evmBudget.innerHTML = '<div class="gantt-evm-label">PRESUPUESTO</div><div class="gantt-evm-value">$0</div>';
            return;
        }

        // Avance Global: average progress of non-phase tasks
        var sumProgress = 0;
        tasks.forEach(function (t) { sumProgress += (t.progress || 0); });
        var avgProgress = Math.round(sumProgress / totalTasks);

        // EV = sum(task.cost * task.progress / 100)
        var ev = 0;
        tasks.forEach(function (t) { ev += (t.cost || 0) * (t.progress || 0) / 100; });

        // PV = sum(task.cost) where task end date <= today
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var todayDay = daysBetween(this.projectStart, today);
        var pv = 0;
        tasks.forEach(function (t) {
            var endDay = t.start + t.dur;
            if (endDay <= todayDay) {
                pv += (t.cost || 0);
            }
        });

        // AC = EV (simplification)
        var ac = ev;

        // SPI = EV / PV
        var spi = pv > 0 ? ev / pv : 0;
        var spiStr = pv > 0 ? spi.toFixed(2) : '--';
        var spiColor = pv > 0 ? (spi >= 1.0 ? COLOR_GREEN : COLOR_DANGER) : COLOR_TEXT_SEC;

        // CPI = EV / AC
        var cpi = ac > 0 ? ev / ac : 0;
        var cpiStr = ac > 0 ? cpi.toFixed(2) : '--';
        var cpiColor = ac > 0 ? (cpi >= 1.0 ? COLOR_GREEN : COLOR_DANGER) : COLOR_TEXT_SEC;

        // Budget = sum of all cost
        var budget = 0;
        tasks.forEach(function (t) { budget += (t.cost || 0); });

        // Update DOM
        if (this._evmAvance) {
            this._evmAvance.innerHTML = '<div class="gantt-evm-label">AVANCE GLOBAL</div><div class="gantt-evm-value">' + avgProgress + '%</div><div class="gantt-evm-bar-wrap"><div class="gantt-evm-bar-fill" style="width:' + Math.min(100, avgProgress) + '%"></div></div>';
        }
        if (this._evmSPI) {
            this._evmSPI.innerHTML = '<div class="gantt-evm-label">SPI</div><div class="gantt-evm-value" style="color:' + spiColor + '">' + spiStr + '</div>';
        }
        if (this._evmCPI) {
            this._evmCPI.innerHTML = '<div class="gantt-evm-label">CPI</div><div class="gantt-evm-value" style="color:' + cpiColor + '">' + cpiStr + '</div>';
        }
        if (this._evmBudget) {
            this._evmBudget.innerHTML = '<div class="gantt-evm-label">PRESUPUESTO</div><div class="gantt-evm-value">' + fmtMoney(budget) + '</div>';
        }
    };

    /* -------------------------------------------
       DATA LOADING
       ------------------------------------------- */
    Gantt.prototype._loadData = function () {
        var self = this;
        _fetch('/app/api/proyecto/' + this.proyectoId + '/gantt/')
            .then(function (data) {
                self._parseData(data);
                self._render();
            })
            .catch(function (err) {
                console.error('Gantt: error loading data', err);
                // load with empty data so UI is still usable
                self._parseData({ fases: [], actividades: [], proyecto_inicio: dateStr(new Date()) });
                self._render();
            });
    };

    Gantt.prototype._parseData = function (data) {
        var self = this;
        this.projectStart = parseDate(data.proyecto_inicio || dateStr(new Date()));
        this.tasks = [];
        this.resources = data.recursos || [];

        var maxId = 0;

        // Parse phases
        (data.fases || []).forEach(function (f) {
            var task = {
                id: f.id,
                name: f.nombre || f.name || '',
                isPhase: true,
                collapsed: false,
                children: [],
                start: 0,
                dur: 0,
                progress: 0,
                deps: [],
                res: [],
                cost: 0,
                income: 0,
                parent: null
            };
            if (task.id > maxId) maxId = task.id;
            self.tasks.push(task);
        });

        // Parse activities
        (data.actividades || []).forEach(function (a) {
            var startDay = 0;
            if (a.fecha_inicio) {
                startDay = Math.max(0, daysBetween(self.projectStart, parseDate(a.fecha_inicio)));
            } else if (typeof a.start === 'number') {
                startDay = a.start;
            }

            var task = {
                id: a.id,
                name: a.nombre || a.name || '',
                isPhase: false,
                collapsed: false,
                children: null,
                start: startDay,
                dur: a.duracion_dias || a.duracion || a.dur || 1,
                progress: a.progreso || a.progress || 0,
                deps: a.dependencias || a.deps || [],
                res: a.recursos || a.res || [],
                cost: parseFloat(a.costo_estimado || a.cost || 0),
                income: parseFloat(a.ingreso_estimado || a.income || 0),
                parent: a.fase_id || a.parent || null
            };
            if (task.id > maxId) maxId = task.id;

            // add to parent children
            if (task.parent) {
                var par = self._taskById(task.parent);
                if (par && par.children) par.children.push(task.id);
            }

            self.tasks.push(task);
        });

        this.nextId = maxId + 1;
        this._recalcPhases();
        this._computeTotalDays();
    };

    Gantt.prototype._taskById = function (id) {
        for (var i = 0; i < this.tasks.length; i++) {
            if (this.tasks[i].id === id) return this.tasks[i];
        }
        return null;
    };

    Gantt.prototype._recalcPhases = function () {
        var self = this;
        this.tasks.forEach(function (t) {
            if (!t.isPhase || !t.children || t.children.length === 0) return;
            var minStart = Infinity, maxEnd = 0, totalProg = 0, count = 0;
            var totalCost = 0, totalIncome = 0;
            t.children.forEach(function (cid) {
                var c = self._taskById(cid);
                if (!c) return;
                if (c.start < minStart) minStart = c.start;
                if (c.start + c.dur > maxEnd) maxEnd = c.start + c.dur;
                totalProg += c.progress;
                totalCost += (c.cost || 0);
                totalIncome += (c.income || 0);
                count++;
            });
            if (count > 0) {
                t.start = minStart;
                t.dur = maxEnd - minStart;
                t.progress = Math.round(totalProg / count);
                t.cost = totalCost;
                t.income = totalIncome;
            }
        });
    };

    Gantt.prototype._computeTotalDays = function () {
        var max = 60;
        this.tasks.forEach(function (t) {
            var end = t.start + t.dur;
            if (end > max) max = end;
        });
        this.totalDays = max + 15; // padding
    };

    /* -------------------------------------------
       VISIBLE ROWS (respecting collapse)
       ------------------------------------------- */
    Gantt.prototype._visibleTasks = function () {
        var result = [];
        var collapsedPhases = {};
        for (var i = 0; i < this.tasks.length; i++) {
            var t = this.tasks[i];
            if (t.isPhase) {
                result.push(t);
                if (t.collapsed) collapsedPhases[t.id] = true;
            } else {
                if (t.parent && collapsedPhases[t.parent]) continue;
                result.push(t);
            }
        }
        return result;
    };

    /* -------------------------------------------
       FULL RENDER
       ------------------------------------------- */
    Gantt.prototype._render = function () {
        this._recalcPhases();
        this._computeTotalDays();

        // Toggle visibilidad de botones contextuales
        var hasFases = this.tasks.some(function(t) { return t.isPhase; });
        if (this._btnToggleFases) this._btnToggleFases.style.display = hasFases ? '' : 'none';
        if (this._btnDel) this._btnDel.style.display = this.selectedTaskId != null ? '' : 'none';

        // Empty state
        var self = this;
        var realTasks = this.tasks.filter(function(t) { return !t.isPhase; });
        var emptyEl = this.root.querySelector('.gantt-empty');
        var mainEl = this.root.querySelector('.gantt-main');
        if (realTasks.length === 0 && this.tasks.length === 0) {
            if (mainEl) mainEl.style.display = 'none';
            if (!emptyEl) {
                // Build template cards grid
                var cardsGrid = el('div', { className: 'gantt-templates' });
                GANTT_TEMPLATES.forEach(function (tpl) {
                    var iconDiv = el('div', { className: 'gantt-tpl-icon' });
                    iconDiv.innerHTML = GANTT_TPL_ICONS[tpl.icon] || GANTT_TPL_ICONS.plus;
                    var card = el('div', { className: 'gantt-tpl-card', onClick: function () { self._applyTemplate(tpl); } }, [
                        iconDiv,
                        el('div', { className: 'gantt-tpl-name' }, [tpl.name]),
                        el('div', { className: 'gantt-tpl-desc' }, [tpl.desc])
                    ]);
                    cardsGrid.appendChild(card);
                });

                var manualLink = el('a', {
                    className: 'gantt-tpl-manual',
                    href: '#',
                    onClick: function (e) { e.preventDefault(); self._showAddModal(); }
                }, ['o crear actividad manualmente']);

                emptyEl = el('div', { className: 'gantt-empty' }, [
                    el('div', { className: 'gantt-empty-icon' }, [
                        el('svg', { width: '32', height: '32', fill: 'none', stroke: COLOR_TEXT_MUTED, 'stroke-width': '1.5', viewBox: '0 0 24 24' })
                    ]),
                    el('div', { className: 'gantt-empty-text' }, ['Comienza tu programa de obra']),
                    el('div', { className: 'gantt-empty-sub' }, ['Elige una plantilla o crea desde cero']),
                    cardsGrid,
                    manualLink
                ]);
                // Inject a refined calendar icon into the SVG
                emptyEl.querySelector('svg').innerHTML = '<rect x="3" y="4" width="18" height="18" rx="2" stroke-linecap="round"/><path d="M16 2v4M8 2v4M3 10h18" stroke-linecap="round"/><path d="M8 14h2v2H8zM14 14h2v2h-2z" fill="' + COLOR_TEXT_MUTED + '" stroke="none"/>';
                this.root.appendChild(emptyEl);
            } else {
                emptyEl.style.display = 'flex';
            }
            this._updateEVM();
            return;
        } else {
            if (emptyEl) emptyEl.style.display = 'none';
            if (mainEl) mainEl.style.display = '';
        }

        this._renderTable();
        this._resizeCanvases();
        this._renderHeader();
        this._renderCanvas();
        this._renderArrows();
        this._updateEVM();
    };

    /* -------------------------------------------
       TABLE RENDER
       ------------------------------------------- */
    Gantt.prototype._renderTable = function () {
        var self = this;
        this.tableBody.innerHTML = '';
        var visible = this._visibleTasks();

        visible.forEach(function (t) {
            var rowClass = 'gantt-row' + (self.selectedTaskId === t.id ? ' selected' : '');
            if (t.isPhase) rowClass += ' gantt-row--phase';
            var row = el('div', {
                className: rowClass,
                onClick: function (e) {
                    // don't select if clicking toggle
                    if (e.target.classList.contains('gantt-toggle')) return;
                    self.selectedTaskId = t.id;
                    self._render();
                }
            });

            // Name cell
            var nameCell = el('div', { className: 'gantt-row-name' });

            if (t.isPhase) {
                var toggle = el('span', {
                    className: 'gantt-toggle',
                    onClick: function (e) {
                        e.stopPropagation();
                        t.collapsed = !t.collapsed;
                        self._persistTask(t);
                        self._render();
                    }
                }, [t.collapsed ? '\u25B6' : '\u25BC']);
                nameCell.appendChild(toggle);
                var phaseSpan = el('span', { className: 'gantt-phase-name' }, [t.name]);
                nameCell.appendChild(phaseSpan);
                // Inline edit de nombre de fase
                (function (task, spanEl, cell) {
                    spanEl.addEventListener('dblclick', function (e) {
                        e.stopPropagation();
                        self._startCellEdit(task, 'name', spanEl, cell, { type: 'text' });
                    });
                })(t, phaseSpan, nameCell);
            } else {
                if (t.parent) {
                    nameCell.appendChild(el('span', { className: 'gantt-indent' }));
                }
                var nameSpan = el('span', {}, [t.name]);
                nameCell.appendChild(nameSpan);

                // Inline edit on double-click (name)
                (function (task, spanEl, cell) {
                    spanEl.addEventListener('dblclick', function (e) {
                        e.stopPropagation();
                        self._startCellEdit(task, 'name', spanEl, cell, { type: 'text' });
                    });
                })(t, nameSpan, nameCell);
            }
            row.appendChild(nameCell);

            // Duration cell
            var durCell = el('div', { className: 'gantt-row-dur' });
            var durSpan = el('span', {}, [String(t.dur) + 'd']);
            durCell.appendChild(durSpan);
            if (!t.isPhase) {
                (function (task, sEl, cEl) {
                    cEl.addEventListener('dblclick', function (e) {
                        e.stopPropagation();
                        self._startCellEdit(task, 'dur', sEl, cEl, { type: 'number', min: 1, suffix: 'd', cssClass: 'small' });
                    });
                })(t, durSpan, durCell);
            }
            row.appendChild(durCell);

            // Progress cell
            var progCell = el('div', { className: 'gantt-row-prog' });
            var progSpan = el('span', {}, [String(t.progress) + '%']);
            progCell.appendChild(progSpan);
            if (!t.isPhase) {
                (function (task, sEl, cEl) {
                    cEl.addEventListener('dblclick', function (e) {
                        e.stopPropagation();
                        self._startCellEdit(task, 'progress', sEl, cEl, { type: 'number', min: 0, max: 100, suffix: '%', cssClass: 'small' });
                    });
                })(t, progSpan, progCell);
            }
            row.appendChild(progCell);

            self.tableBody.appendChild(row);
        });
    };

    /* -------------------------------------------
       CANVAS SIZING
       ------------------------------------------- */
    Gantt.prototype._resizeCanvases = function () {
        var visible = this._visibleTasks();
        var cw = this.totalDays * this.colW;
        var ch = visible.length * ROW_H;
        var dpr = this._dpr;

        // Main canvas
        this.canvas.width = cw * dpr;
        this.canvas.height = ch * dpr;
        this.canvas.style.width = cw + 'px';
        this.canvas.style.height = ch + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // SVG overlay
        this.svgOverlay.setAttribute('width', cw);
        this.svgOverlay.setAttribute('height', ch);
        this.svgOverlay.style.width = cw + 'px';
        this.svgOverlay.style.height = ch + 'px';

        // Header canvas
        this.headerCanvas.width = cw * dpr;
        this.headerCanvas.height = HEADER_H * dpr;
        this.headerCanvas.style.width = cw + 'px';
        this.headerCanvas.style.height = HEADER_H + 'px';
        this.headerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /* -------------------------------------------
       HEADER RENDER (dates)
       ------------------------------------------- */
    Gantt.prototype._renderHeader = function () {
        var ctx = this.headerCtx;
        var w = this.totalDays * this.colW;
        ctx.clearRect(0, 0, w, HEADER_H);

        // White background
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, HEADER_H);

        var colW = this.colW;
        var start = this.projectStart;

        // Detect today for highlighting
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var todayDay = daysBetween(start, today);

        // Row 1: week/month labels (subtle, small)
        ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = COLOR_TEXT_MUTED;
        ctx.textAlign = 'left';

        if (this.zoom === 'month') {
            var prevMonth = -1;
            for (var d = 0; d < this.totalDays; d++) {
                var dt = addDays(start, d);
                var m = dt.getMonth();
                if (m !== prevMonth) {
                    prevMonth = m;
                    ctx.fillText(MONTH_NAMES[m] + ' ' + dt.getFullYear(), d * colW + 4, 18);
                }
            }
        } else {
            var prevWeek = -1;
            for (var d = 0; d < this.totalDays; d++) {
                var dt = addDays(start, d);
                var weekNum = Math.floor(d / 7);
                if (weekNum !== prevWeek) {
                    prevWeek = weekNum;
                    var wEnd = addDays(dt, 6);
                    var label = dt.getDate() + ' ' + MONTH_NAMES[dt.getMonth()] + ' - ' + wEnd.getDate() + ' ' + MONTH_NAMES[wEnd.getMonth()];
                    ctx.fillText(label, d * colW + 4, 18);

                    // Vertical separator between weeks (not between each day)
                    if (d > 0) {
                        ctx.strokeStyle = COLOR_BORDER;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(d * colW + 0.5, 0);
                        ctx.lineTo(d * colW + 0.5, HEADER_H);
                        ctx.stroke();
                    }
                }
            }
        }

        // Row 2: day numbers with today highlight (only if zoom is day or week)
        if (this.zoom !== 'month') {
            ctx.textAlign = 'center';
            for (var d = 0; d < this.totalDays; d++) {
                var dt = addDays(start, d);
                var isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
                var isToday = d === todayDay;
                var x = d * colW + colW / 2;

                // Today: blue circle behind the number (Google Calendar style)
                if (isToday) {
                    ctx.beginPath();
                    ctx.arc(x, 38, 10, 0, Math.PI * 2);
                    ctx.fillStyle = COLOR_PRIMARY;
                    ctx.fill();
                    ctx.font = '700 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillText(String(dt.getDate()), x, 42);
                } else {
                    ctx.font = '500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                    ctx.fillStyle = isWeekend ? '#CBD5E1' : COLOR_TEXT_SEC;
                    ctx.fillText(String(dt.getDate()), x, 42);
                }

                // Show day name letter for day zoom
                if (this.zoom === 'day') {
                    ctx.font = '400 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                    ctx.fillStyle = isToday ? COLOR_PRIMARY : (isWeekend ? '#CBD5E1' : COLOR_TEXT_MUTED);
                    ctx.fillText(DAY_NAMES_SHORT[dt.getDay()], x, HEADER_H - 2);
                }
            }
        }

        // Bottom border
        ctx.strokeStyle = COLOR_BORDER;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, HEADER_H - 0.5);
        ctx.lineTo(w, HEADER_H - 0.5);
        ctx.stroke();
    };

    /* -------------------------------------------
       CANVAS RENDER (bars + grid)
       ------------------------------------------- */
    Gantt.prototype._renderCanvas = function () {
        var ctx = this.ctx;
        var visible = this._visibleTasks();
        var cw = this.totalDays * this.colW;
        var ch = visible.length * ROW_H;
        var colW = this.colW;

        ctx.clearRect(0, 0, cw, ch);

        // White background
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, cw, ch);

        // Weekend columns — barely perceptible tint
        for (var d = 0; d < this.totalDays; d++) {
            var dt = addDays(this.projectStart, d);
            if (dt.getDay() === 0 || dt.getDay() === 6) {
                ctx.fillStyle = '#FAFBFE';
                ctx.fillRect(d * colW, 0, colW, ch);
            }
        }

        // Vertical gridlines — ONLY on Mondays (week start) in week/day mode, subtle
        if (this.zoom !== 'month') {
            ctx.strokeStyle = '#F1F5F9';
            ctx.lineWidth = 1;
            for (var d = 0; d < this.totalDays; d++) {
                var dt2 = addDays(this.projectStart, d);
                if (dt2.getDay() === 1) { // Monday
                    ctx.beginPath();
                    ctx.moveTo(d * colW + 0.5, 0);
                    ctx.lineTo(d * colW + 0.5, ch);
                    ctx.stroke();
                }
            }
        } else {
            // month mode: gridline on 1st of each month
            ctx.strokeStyle = '#F1F5F9';
            ctx.lineWidth = 1;
            for (var d = 0; d < this.totalDays; d++) {
                var dt3 = addDays(this.projectStart, d);
                if (dt3.getDate() === 1) {
                    ctx.beginPath();
                    ctx.moveTo(d * colW + 0.5, 0);
                    ctx.lineTo(d * colW + 0.5, ch);
                    ctx.stroke();
                }
            }
        }

        // Horizontal gridlines — almost invisible
        ctx.strokeStyle = '#F8FAFC';
        ctx.lineWidth = 1;
        for (var i = 1; i < visible.length; i++) {
            ctx.beginPath();
            ctx.moveTo(0, i * ROW_H + 0.5);
            ctx.lineTo(cw, i * ROW_H + 0.5);
            ctx.stroke();
        }

        // Today line — solid red with subtle glow, no dash
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var todayDay = daysBetween(this.projectStart, today);
        if (todayDay >= 0 && todayDay < this.totalDays) {
            var tx = todayDay * colW + colW / 2;
            // Glow
            ctx.save();
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.15)';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(tx, 0);
            ctx.lineTo(tx, ch);
            ctx.stroke();
            ctx.restore();
            // Main line
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(tx, 0);
            ctx.lineTo(tx, ch);
            ctx.stroke();
        }

        // Bars (no selected row fill — selection is shown only via left border in the table)
        var self = this;
        visible.forEach(function (t, idx) {
            var y = idx * ROW_H + BAR_Y;
            var x = t.start * colW;
            var w = t.dur * colW;

            if (t.isPhase) {
                self._drawPhaseSummaryBar(ctx, t, x, y, w, idx);
            } else {
                var isHovered = self._hoveredTaskId === t.id;
                var isSelected = self.selectedTaskId === t.id;
                self._drawActivityBar(ctx, t, x, y, w, isHovered, isSelected);
            }
        });

        // Connector dot — drawn AFTER all bars so it sits on top
        if (this._hoveredTaskId !== null && this.viewMode === 'schedule') {
            for (var ci = 0; ci < visible.length; ci++) {
                var ct = visible[ci];
                if (ct.id !== this._hoveredTaskId || ct.isPhase) continue;

                var dotX = (ct.start + ct.dur) * colW;
                var dotY = ci * ROW_H + BAR_Y + BAR_H / 2;
                var dotR = 4;

                ctx.save();
                // White border ring
                ctx.beginPath();
                ctx.arc(dotX, dotY, dotR + 1.5, 0, Math.PI * 2);
                ctx.fillStyle = '#FFFFFF';
                ctx.fill();
                // Fill — blue if hovered, gray otherwise
                ctx.beginPath();
                ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
                ctx.fillStyle = this._hoveredConnector ? COLOR_PRIMARY : COLOR_GRAY;
                ctx.fill();
                ctx.restore();
                break;
            }
        }
    };

    Gantt.prototype._drawPhaseSummaryBar = function (ctx, t, x, y, w, rowIdx) {
        if (this.viewMode === 'financial') {
            // Financial view for phases: show aggregated cost/income
            var cost = t.cost || 0;
            var income = t.income || 0;
            var barH = 10;
            var yy = y + BAR_H / 2 - barH / 2;
            var isProfit = income >= cost;

            ctx.save();

            // Cost bar (full width, red tint)
            if (cost > 0) {
                ctx.fillStyle = COLOR_DANGER;
                ctx.globalAlpha = 0.5;
                ctx.beginPath();
                this._roundRect(ctx, x, yy + barH / 2, w, barH / 2, 2);
                ctx.fill();
            }

            // Income bar (full width, green tint)
            if (income > 0) {
                ctx.fillStyle = COLOR_GREEN;
                ctx.globalAlpha = 0.5;
                ctx.beginPath();
                this._roundRect(ctx, x, yy, w, barH / 2, 2);
                ctx.fill();
            }

            ctx.globalAlpha = 1;

            // Label to the right of bar if room
            var labelText = fmtMoney(cost) + ' / ' + fmtMoney(income);
            ctx.font = '700 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillStyle = isProfit ? COLOR_GREEN : COLOR_DANGER;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, x + w + 6, y + BAR_H / 2);

            ctx.restore();
            return;
        }

        var barH = 4;
        var yy = y + BAR_H / 2 - barH / 2;

        // Thin horizontal bar with rounded caps
        ctx.fillStyle = COLOR_PHASE_BAR;
        ctx.beginPath();
        var r = barH / 2;
        ctx.moveTo(x + r, yy);
        ctx.arcTo(x + w, yy, x + w, yy + barH, r);
        ctx.arcTo(x + w, yy + barH, x, yy + barH, r);
        ctx.arcTo(x, yy + barH, x, yy, r);
        ctx.arcTo(x, yy, x + w, yy, r);
        ctx.closePath();
        ctx.fill();

        // Small inverted triangles at each end
        var triSize = 5;
        ctx.fillStyle = COLOR_PHASE_BAR;

        // Left triangle
        ctx.beginPath();
        ctx.moveTo(x - 1, yy + barH);
        ctx.lineTo(x + triSize, yy + barH);
        ctx.lineTo(x + triSize / 2 - 0.5, yy + barH + triSize);
        ctx.closePath();
        ctx.fill();

        // Right triangle
        ctx.beginPath();
        ctx.moveTo(x + w + 1, yy + barH);
        ctx.lineTo(x + w - triSize, yy + barH);
        ctx.lineTo(x + w - triSize / 2 + 0.5, yy + barH + triSize);
        ctx.closePath();
        ctx.fill();
    };

    Gantt.prototype._drawActivityBar = function (ctx, t, x, y, w, isHovered, isSelected) {
        if (this.viewMode === 'financial') {
            this._drawActivityBarFinancial(ctx, t, x, y, w, isHovered, isSelected);
            return;
        }

        var prog = t.progress || 0;
        var radius = BAR_H / 2; // full pill shape

        // Determine colors based on state
        var bgColor, progFillColor;
        if (prog >= 100) {
            bgColor = COLOR_GREEN;
            progFillColor = COLOR_GREEN;
        } else if (prog > 0) {
            bgColor = COLOR_BLUE;
            progFillColor = COLOR_PRIMARY_FILL;
        } else {
            bgColor = COLOR_BLUE;
            progFillColor = null;
        }

        // Shadow (subtle normally, stronger on hover)
        ctx.save();
        if (isHovered) {
            ctx.shadowColor = 'rgba(0,0,0,0.18)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 3;
        } else {
            ctx.shadowColor = 'rgba(0,0,0,0.1)';
            ctx.shadowBlur = 3;
            ctx.shadowOffsetY = 1;
        }

        // Background pill — solid color with opacity
        ctx.globalAlpha = prog >= 100 ? 0.9 : 0.85;
        ctx.fillStyle = bgColor;
        ctx.beginPath();
        this._roundRect(ctx, x + 1, y, w - 2, BAR_H, radius);
        ctx.fill();

        // Reset shadow for subsequent draws
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        // Progress fill overlay (darker shade from left)
        if (prog > 0 && prog < 100 && progFillColor) {
            var pw = Math.max(radius, (w - 2) * prog / 100);
            ctx.save();
            ctx.beginPath();
            this._roundRect(ctx, x + 1, y, w - 2, BAR_H, radius);
            ctx.clip();
            ctx.globalAlpha = 1;
            ctx.fillStyle = progFillColor;
            ctx.fillRect(x + 1, y, pw, BAR_H);
            ctx.restore();
        }

        ctx.globalAlpha = 1;

        // Selected state: 2px dark blue border
        if (isSelected) {
            ctx.strokeStyle = COLOR_PRIMARY_DARK;
            ctx.lineWidth = 2;
            ctx.beginPath();
            this._roundRect(ctx, x + 1, y, w - 2, BAR_H, radius);
            ctx.stroke();
        }

        // Text: percentage (only if bar is wide enough, >60px)
        if (w > 60) {
            var text = prog + '%';
            ctx.font = '700 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x + w / 2, y + BAR_H / 2 + 0.5);
        }

        // Progress zone indicator — subtle line at bottom of bar on hover
        if (isHovered) {
            ctx.save();
            ctx.beginPath();
            this._roundRect(ctx, x + 1, y, w - 2, BAR_H, radius);
            ctx.clip();
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 4, y + BAR_H - 3);
            ctx.lineTo(x + w - 4, y + BAR_H - 3);
            ctx.stroke();
            // Small triangles at the ends to hint "draggable"
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.moveTo(x + 4, y + BAR_H - 5);
            ctx.lineTo(x + 8, y + BAR_H - 1);
            ctx.lineTo(x + 4, y + BAR_H - 1);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(x + w - 4, y + BAR_H - 5);
            ctx.lineTo(x + w - 8, y + BAR_H - 1);
            ctx.lineTo(x + w - 4, y + BAR_H - 1);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        ctx.restore();

        // Micro-avatars below bar for assigned resources
        if (t.res && t.res.length > 0) {
            var avR = 6;   // radius (12px diameter)
            var avY = y + BAR_H + 2 + avR;
            var avGap = 14;
            var maxAv = 3;
            var resArr = t.res;
            var shown = resArr.length > maxAv ? resArr.slice(0, maxAv) : resArr;

            for (var ai = 0; ai < shown.length; ai++) {
                var rItem = shown[ai];
                var rName = typeof rItem === 'object' ? (rItem.nombre || String(rItem.id)) : String(rItem);
                var rInitials = this._resInitials(rName);
                var rHue = this._resAvatarColor(rName);
                var avX = x + avR + ai * avGap;

                ctx.save();
                ctx.beginPath();
                ctx.arc(avX, avY, avR, 0, Math.PI * 2);
                ctx.fillStyle = rHue;
                ctx.fill();
                ctx.font = '700 7px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(rInitials, avX, avY + 0.5);
                ctx.restore();
            }

            // "+N" indicator if more than maxAv
            if (resArr.length > maxAv) {
                var extraX = x + avR + shown.length * avGap;
                ctx.save();
                ctx.beginPath();
                ctx.arc(extraX, avY, avR, 0, Math.PI * 2);
                ctx.fillStyle = '#94A3B8';
                ctx.fill();
                ctx.font = '700 7px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('+' + (resArr.length - maxAv), extraX, avY + 0.5);
                ctx.restore();
            }
        }
    };

    Gantt.prototype._drawActivityBarFinancial = function (ctx, t, x, y, w, isHovered, isSelected) {
        var cost = t.cost || 0;
        var income = t.income || 0;
        var maxVal = Math.max(cost, income, 1);
        var radius = 4;
        var halfH = BAR_H / 2;

        // Determine border color based on margin
        var isProfit = income >= cost;
        var borderColor = isProfit ? COLOR_GREEN : COLOR_DANGER;

        ctx.save();

        // Shadow
        if (isHovered) {
            ctx.shadowColor = 'rgba(0,0,0,0.18)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 3;
        } else {
            ctx.shadowColor = 'rgba(0,0,0,0.1)';
            ctx.shadowBlur = 3;
            ctx.shadowOffsetY = 1;
        }

        // Background pill (light gray base)
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#E2E8F0';
        ctx.beginPath();
        this._roundRect(ctx, x + 1, y, w - 2, BAR_H, radius);
        ctx.fill();

        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.globalAlpha = 1;

        // Cost sub-bar (bottom half, red)
        if (cost > 0) {
            var costW = Math.max(6, (w - 2) * (cost / maxVal));
            ctx.fillStyle = COLOR_DANGER;
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            this._roundRect(ctx, x + 1, y + halfH, Math.min(costW, w - 2), halfH, radius > halfH ? halfH / 2 : 3);
            ctx.fill();
        }

        // Income sub-bar (top half, green)
        if (income > 0) {
            var incW = Math.max(6, (w - 2) * (income / maxVal));
            ctx.fillStyle = COLOR_GREEN;
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            this._roundRect(ctx, x + 1, y, Math.min(incW, w - 2), halfH, radius > halfH ? halfH / 2 : 3);
            ctx.fill();
        }

        ctx.globalAlpha = 1;

        // Border indicating profit/loss
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.beginPath();
        this._roundRect(ctx, x + 1, y, w - 2, BAR_H, radius);
        ctx.stroke();

        // Text: formatted money (show cost if bar is wide enough)
        if (w > 50) {
            var label = cost > 0 ? fmtMoney(cost) : '$0';
            ctx.font = '700 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // Draw text with slight shadow for readability
            ctx.fillStyle = COLOR_DARK;
            ctx.fillText(label, x + w / 2, y + BAR_H / 2 + 0.5);
        }

        ctx.restore();
    };

    Gantt.prototype._roundRect = function (ctx, x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    };

    /* -------------------------------------------
       DEPENDENCY ARROWS (SVG)
       ------------------------------------------- */
    Gantt.prototype._renderArrows = function () {
        var self = this;
        // Clear SVG
        while (this.svgOverlay.firstChild) this.svgOverlay.removeChild(this.svgOverlay.firstChild);

        // Add arrowhead marker — refined, smaller
        var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'gantt-arrowhead');
        marker.setAttribute('markerWidth', '6');
        marker.setAttribute('markerHeight', '5');
        marker.setAttribute('refX', '6');
        marker.setAttribute('refY', '2.5');
        marker.setAttribute('orient', 'auto');
        var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', '0 0, 6 2.5, 0 5');
        poly.setAttribute('fill', '#CBD5E1');
        marker.appendChild(poly);
        defs.appendChild(marker);
        this.svgOverlay.appendChild(defs);

        var visible = this._visibleTasks();
        var idxMap = {};
        visible.forEach(function (t, i) { idxMap[t.id] = i; });

        visible.forEach(function (t) {
            if (!t.deps || t.deps.length === 0) return;
            var toIdx = idxMap[t.id];
            if (toIdx === undefined) return;

            t.deps.forEach(function (depId) {
                var fromIdx = idxMap[depId];
                if (fromIdx === undefined) return;
                var from = self._taskById(depId);
                if (!from) return;

                // From: end of predecessor bar
                var x1 = (from.start + from.dur) * self.colW;
                var y1 = fromIdx * ROW_H + BAR_Y + BAR_H / 2;

                // To: start of successor bar
                var x2 = t.start * self.colW;
                var y2 = toIdx * ROW_H + BAR_Y + BAR_H / 2;

                // Path with rounded corners: right, down/up, then right
                var midX = x1 + 14;
                var cornerR = 4;
                var pathD;

                if (Math.abs(y2 - y1) < 2) {
                    // Same row — straight line
                    pathD = 'M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2;
                } else {
                    // Rounded corner path
                    var dir = y2 > y1 ? 1 : -1;
                    pathD = 'M' + x1 + ',' + y1 +
                        ' L' + (midX - cornerR) + ',' + y1 +
                        ' Q' + midX + ',' + y1 + ' ' + midX + ',' + (y1 + dir * cornerR) +
                        ' L' + midX + ',' + (y2 - dir * cornerR) +
                        ' Q' + midX + ',' + y2 + ' ' + (midX + cornerR) + ',' + y2 +
                        ' L' + x2 + ',' + y2;
                }

                var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', pathD);
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', '#CBD5E1');
                path.setAttribute('stroke-width', '1.5');
                path.setAttribute('stroke-linecap', 'round');
                path.setAttribute('stroke-linejoin', 'round');
                path.setAttribute('marker-end', 'url(#gantt-arrowhead)');
                self.svgOverlay.appendChild(path);
            });
        });
    };

    /* -------------------------------------------
       CANVAS MOUSE EVENTS
       ------------------------------------------- */
    Gantt.prototype._getCanvasPos = function (e) {
        var rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left + this.canvasWrap.scrollLeft,
            y: e.clientY - rect.top + this.canvasWrap.scrollTop
        };
    };

    Gantt.prototype._hitTest = function (pos) {
        var visible = this._visibleTasks();
        var rowIdx = Math.floor(pos.y / ROW_H);
        if (rowIdx < 0 || rowIdx >= visible.length) return null;

        var t = visible[rowIdx];
        var barX = t.start * this.colW;
        var barW = t.dur * this.colW;
        var barY = rowIdx * ROW_H + BAR_Y;

        // Check connector dot first (only on hovered non-phase task)
        if (!t.isPhase && this._hoveredTaskId === t.id) {
            var dotCx = barX + barW;
            var dotCy = barY + BAR_H / 2;
            var dotR = 5; // hit radius slightly larger than visual radius (4)
            var dx = pos.x - dotCx;
            var dy = pos.y - dotCy;
            if (dx * dx + dy * dy <= dotR * dotR) {
                return { task: t, rowIdx: rowIdx, zone: 'connector' };
            }
        }

        if (pos.x >= barX && pos.x <= barX + barW && pos.y >= barY && pos.y <= barY + BAR_H) {
            // Progress zone: bottom 6px of bar, only for non-phase tasks in schedule view
            if (!t.isPhase && this.viewMode === 'schedule' && (pos.y >= barY + BAR_H - 6)) {
                return { task: t, rowIdx: rowIdx, zone: 'progress' };
            }
            var leftEdge = pos.x - barX < EDGE;
            var rightEdge = barX + barW - pos.x < EDGE;
            return { task: t, rowIdx: rowIdx, zone: leftEdge ? 'left' : (rightEdge ? 'right' : 'center') };
        }
        return null;
    };

    Gantt.prototype._onMouseDown = function (e) {
        if (e.button !== 0) return; // only left button
        var pos = this._getCanvasPos(e);
        var hit = this._hitTest(pos);
        if (!hit || hit.task.isPhase) return;

        var t = hit.task;
        this.selectedTaskId = t.id;

        // Track mousedown origin to detect "click without drag"
        // (used to open the detail drawer on simple click — Mejora 2).
        this._mouseDownInfo = {
            x: e.clientX,
            y: e.clientY,
            taskId: t.id,
            zone: hit.zone,
            t: Date.now()
        };

        if (hit.zone === 'connector') {
            // Start connecting mode — drag line from this task
            var barX = t.start * this.colW;
            var barW = t.dur * this.colW;
            var barY = hit.rowIdx * ROW_H + BAR_Y;
            this._connectingFrom = t.id;
            this.dragState = {
                taskId: t.id,
                type: 'connect',
                fromX: barX + barW,
                fromY: barY + BAR_H / 2,
                mouseX: pos.x,
                mouseY: pos.y
            };
        } else if (hit.zone === 'progress') {
            // Start progress drag
            var barX2 = t.start * this.colW;
            var barW2 = t.dur * this.colW;
            this.dragState = {
                taskId: t.id,
                type: 'progress',
                barStart: barX2,
                barWidth: barW2,
                origProgress: t.progress
            };
        } else if (hit.zone === 'left') {
            this.dragState = { taskId: t.id, type: 'resizeL', startX: pos.x, origStart: t.start, origDur: t.dur };
        } else if (hit.zone === 'right') {
            this.dragState = { taskId: t.id, type: 'resizeR', startX: pos.x, origStart: t.start, origDur: t.dur };
        } else {
            this.dragState = { taskId: t.id, type: 'move', startX: pos.x, origStart: t.start, origDur: t.dur };
        }

        this._render();
        e.preventDefault();
    };

    Gantt.prototype._onDocMouseMove = function (e) {
        if (!this.dragState) return;

        var rect = this.canvas.getBoundingClientRect();
        var mx = e.clientX - rect.left + this.canvasWrap.scrollLeft;
        var my = e.clientY - rect.top + this.canvasWrap.scrollTop;
        var t = this._taskById(this.dragState.taskId);
        if (!t) return;

        if (this.dragState.type === 'progress') {
            // Calculate progress based on X position relative to bar
            var relX = mx - this.dragState.barStart;
            var pct = Math.round(relX / this.dragState.barWidth * 100);
            pct = Math.max(0, Math.min(100, pct));
            t.progress = pct;
            this._render();
            return;
        }

        if (this.dragState.type === 'connect') {
            // Update mouse position for the connecting line and re-render
            this.dragState.mouseX = mx;
            this.dragState.mouseY = my;
            this._renderCanvas();
            this._renderConnectLine();
            return;
        }

        var delta = Math.round((mx - this.dragState.startX) / this.colW);

        if (this.dragState.type === 'move') {
            t.start = Math.max(0, this.dragState.origStart + delta);
        } else if (this.dragState.type === 'resizeR') {
            t.dur = Math.max(1, this.dragState.origDur + delta);
        } else if (this.dragState.type === 'resizeL') {
            var newStart = Math.max(0, this.dragState.origStart + delta);
            var newDur = Math.max(1, this.dragState.origDur - delta);
            // ensure start doesn't go past original end
            if (newStart + newDur <= this.dragState.origStart + this.dragState.origDur + 1) {
                t.start = newStart;
                t.dur = newDur;
            }
        }

        this._cascadeDeps(t.id);
        this._render();
    };

    /* Draw temporary connecting line in SVG overlay */
    Gantt.prototype._renderConnectLine = function () {
        // Remove any previous temp line
        var old = this.svgOverlay.querySelector('.gantt-connect-temp');
        if (old) old.remove();

        if (!this.dragState || this.dragState.type !== 'connect') return;

        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'gantt-connect-temp');
        line.setAttribute('x1', this.dragState.fromX);
        line.setAttribute('y1', this.dragState.fromY);
        line.setAttribute('x2', this.dragState.mouseX);
        line.setAttribute('y2', this.dragState.mouseY);
        line.setAttribute('stroke', '#3B82F6');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-dasharray', '4,3');
        line.setAttribute('stroke-linecap', 'round');
        this.svgOverlay.appendChild(line);
    };

    Gantt.prototype._onMouseUp = function (e) {
        // Mejora 2 — single-click sobre una barra abre el drawer de detalles.
        // Si dragState está activo pero no hubo movimiento real, también
        // contamos como click (drag cancelado).
        var clickInfo = this._mouseDownInfo;
        this._mouseDownInfo = null;

        if (!this.dragState) {
            if (clickInfo && clickInfo.zone === 'body') {
                var dx = Math.abs(e.clientX - clickInfo.x);
                var dy = Math.abs(e.clientY - clickInfo.y);
                if (dx < 4 && dy < 4) {
                    var taskC = this._taskById(clickInfo.taskId);
                    if (taskC && !taskC.isPhase) {
                        this._openDrawer(taskC.id);
                    }
                }
            }
            return;
        }

        var taskId = this.dragState.taskId;
        var dragType = this.dragState.type;
        var t = this._taskById(taskId);

        if (dragType === 'progress') {
            this.dragState = null;
            this._connectingFrom = null;
            if (t) {
                this._persistTask(t);
            }
            this._render();
            return;
        }

        if (dragType === 'connect') {
            // Remove temp line
            var tempLine = this.svgOverlay.querySelector('.gantt-connect-temp');
            if (tempLine) tempLine.remove();

            // Hit test at drop position to see if we landed on another bar
            var pos = this._getCanvasPos(e);
            // Temporarily clear connecting state for clean hitTest
            var fromId = this.dragState.taskId;
            this.dragState = null;
            this._connectingFrom = null;

            var hit = this._hitTest(pos);
            if (hit && !hit.task.isPhase && hit.task.id !== fromId) {
                // Create dependency: target depends on source (Finish-to-Start)
                var target = hit.task;
                if (!target.deps) target.deps = [];
                if (target.deps.indexOf(fromId) === -1) {
                    target.deps.push(fromId);
                    // Enforce FS constraint
                    var source = this._taskById(fromId);
                    if (source) {
                        var minStart = source.start + source.dur;
                        if (target.start < minStart) {
                            target.start = minStart;
                        }
                    }
                    this._persistTask(target);
                }
            }
            this._render();
            return;
        }

        var wasMove = (dragType === 'move');
        this.dragState = null;
        this._connectingFrom = null;

        // Mejora 2 — si fue un "move" sin desplazamiento real, abrir drawer.
        var dxC = clickInfo ? Math.abs(e.clientX - clickInfo.x) : 99;
        var dyC = clickInfo ? Math.abs(e.clientY - clickInfo.y) : 99;
        var noMove = wasMove && dxC < 4 && dyC < 4;

        if (t && !noMove) {
            // Persist to server
            this._persistTask(t);
            // Also cascade on server
            _fetch('/app/api/gantt/actividad/' + taskId + '/cascada/', { method: 'POST', body: {} }).catch(function () {});
        }

        this._render();

        if (noMove && t && !t.isPhase) {
            this._openDrawer(t.id);
        }
    };

    Gantt.prototype._onMouseMove = function (e) {
        if (this.dragState) return; // cursor handled in doc mousemove

        var pos = this._getCanvasPos(e);
        var hit = this._hitTest(pos);

        if (!hit) {
            this.canvas.style.cursor = 'default';
            var needRedraw = this._hoveredTaskId !== null || this._hoveredConnector;
            this._hoveredConnector = false;
            if (needRedraw) {
                this._hoveredTaskId = null;
                this._renderCanvas(); // re-render to remove hover effect
            }
            this._hideTooltip();
            return;
        }

        // Cursor
        if (hit.task.isPhase) {
            this.canvas.style.cursor = 'default';
        } else if (hit.zone === 'connector') {
            this.canvas.style.cursor = 'crosshair';
        } else if (hit.zone === 'progress') {
            this.canvas.style.cursor = 'col-resize';
        } else if (hit.zone === 'left' || hit.zone === 'right') {
            this.canvas.style.cursor = 'ew-resize';
        } else {
            this.canvas.style.cursor = 'grab';
        }

        // Track connector hover state for visual feedback
        var wasConnector = this._hoveredConnector;
        this._hoveredConnector = (hit.zone === 'connector');

        // Tooltip + hover effect on bar
        if (this._hoveredTaskId !== hit.task.id || wasConnector !== this._hoveredConnector) {
            this._hoveredTaskId = hit.task.id;
            this._showTooltip(hit.task, e);
            this._renderCanvas(); // re-render to apply hover shadow / connector dot
        }
    };

    Gantt.prototype._onDblClick = function (e) {
        var pos = this._getCanvasPos(e);
        var hit = this._hitTest(pos);
        if (hit && !hit.task.isPhase) {
            this._showResourceModal(hit.task.id);
        }
    };

    /* -------------------------------------------
       TOOLTIP
       ------------------------------------------- */
    Gantt.prototype._showTooltip = function (t, e) {
        var self = this;
        clearTimeout(this._tooltipTimer);
        this._tooltipTimer = setTimeout(function () {
            var startDate = addDays(self.projectStart, t.start);
            var endDate = addDays(self.projectStart, t.start + t.dur);

            // Format dates in friendly style: "23 Abr -> 27 Abr (5 dias)"
            var fmtD = function (d) {
                return d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
            };
            var dateLabel = fmtD(startDate) + ' \u2192 ' + fmtD(endDate) + ' (' + t.dur + ' d\u00edas)';

            self.tooltip.innerHTML = '';

            // Title
            self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-title' }, [t.name]));

            // Dates line
            self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-dates' }, [dateLabel]));

            // Progress mini-bar
            var progWrap = el('div', { className: 'gantt-tooltip-progress-wrap' });
            progWrap.appendChild(el('div', { className: 'gantt-tooltip-progress-label' }, ['Progreso: ' + t.progress + '%']));
            var progBar = el('div', { className: 'gantt-tooltip-progress-bar' });
            var progColor = t.progress >= 100 ? COLOR_GREEN : COLOR_PRIMARY;
            var progFill = el('div', {
                className: 'gantt-tooltip-progress-fill',
                style: { width: Math.min(100, t.progress) + '%', background: progColor }
            });
            progBar.appendChild(progFill);
            progWrap.appendChild(progBar);
            self.tooltip.appendChild(progWrap);

            // Cost / Income
            if (self.viewMode === 'financial') {
                // Always show full financial breakdown in financial mode
                var cost = t.cost || 0;
                var income = t.income || 0;
                var margin = income - cost;
                var marginPct = cost > 0 ? ((margin / cost) * 100).toFixed(1) : '0.0';
                var marginColor = margin >= 0 ? COLOR_GREEN : COLOR_DANGER;

                self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-row' }, ['Costo: ', el('span', {}, [fmtMoney(cost)])]));
                self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-row' }, ['Ingreso: ', el('span', {}, [fmtMoney(income)])]));
                var marginStr = margin >= 0 ? '+' + fmtMoney(margin) : '-' + fmtMoney(Math.abs(margin));
                self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-row' }, [
                    'Margen: ',
                    el('span', { style: { color: marginColor } }, [marginStr])
                ]));
                self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-row' }, [
                    'Margen %: ',
                    el('span', { style: { color: marginColor } }, [marginPct + '%'])
                ]));
            } else {
                // Schedule mode: only if > 0
                if (t.cost > 0) {
                    self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-row' }, ['Costo: ', el('span', {}, [fmtMoney(t.cost)])]));
                }
                if (t.income > 0) {
                    self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-row' }, ['Ingreso: ', el('span', {}, [fmtMoney(t.income)])]));
                }
            }

            // Resource avatars (circular initials)
            if (t.res && t.res.length > 0) {
                var avatarWrap = el('div', { className: 'gantt-tooltip-avatars' });
                t.res.forEach(function (rItem) {
                    // rItem may be an ID (number) or an object {id, nombre}
                    var rName;
                    if (typeof rItem === 'object' && rItem !== null) {
                        rName = rItem.nombre || rItem.name || String(rItem.id);
                    } else {
                        var r = self.resources.find(function (x) { return x.id === rItem; });
                        rName = r ? (r.name || r.nombre || String(rItem)) : String(rItem);
                    }
                    var initials = self._resInitials(rName);
                    var avatarColor = self._resAvatarColor(rName);
                    var avatar = el('div', {
                        className: 'gantt-tooltip-avatar',
                        style: { background: avatarColor },
                        title: rName
                    }, [initials]);
                    avatarWrap.appendChild(avatar);
                });
                self.tooltip.appendChild(avatarWrap);
            }

            // Position tooltip near mouse but within root bounds
            var rootRect = self.root.getBoundingClientRect();
            var tx = e.clientX - rootRect.left + 16;
            var ty = e.clientY - rootRect.top + 16;

            // Show with fade-in animation
            self.tooltip.style.display = 'block';
            // Force reflow to trigger transition
            self.tooltip.offsetHeight; // eslint-disable-line no-unused-expressions
            self.tooltip.classList.add('visible');

            var ttW = self.tooltip.offsetWidth;
            var ttH = self.tooltip.offsetHeight;
            if (tx + ttW > rootRect.width) tx = tx - ttW - 32;
            if (ty + ttH > rootRect.height) ty = ty - ttH - 32;
            if (tx < 0) tx = 8;
            if (ty < 0) ty = 8;

            self.tooltip.style.left = tx + 'px';
            self.tooltip.style.top = ty + 'px';
        }, 200);
    };

    Gantt.prototype._hideTooltip = function () {
        clearTimeout(this._tooltipTimer);
        this.tooltip.classList.remove('visible');
        this.tooltip.style.display = 'none';
        this._hoveredTaskId = null;
    };

    /* -------------------------------------------
       CASCADING DEPENDENCIES
       ------------------------------------------- */
    Gantt.prototype._cascadeDeps = function (movedId, depth) {
        if ((depth || 0) > 100) return;
        var self = this;
        var moved = this._taskById(movedId);
        if (!moved) return;

        this.tasks.forEach(function (t) {
            if (!t.deps || t.isPhase) return;
            if (t.deps.indexOf(movedId) === -1) return;
            var minStart = moved.start + moved.dur;
            if (t.start < minStart) {
                t.start = minStart;
                self._cascadeDeps(t.id, (depth || 0) + 1);
            }
        });
    };

    /* -------------------------------------------
       PERSIST TASK TO SERVER
       ------------------------------------------- */
    Gantt.prototype._persistTask = function (t) {
        if (t.isPhase) {
            // Fases usan endpoint diferente
            _fetch('/app/api/gantt/fase/' + t.id + '/', {
                method: 'PUT',
                body: { nombre: t.name, orden: t.orden || 0, collapsed: !!t.collapsed }
            }).catch(function (err) { console.error('Gantt: error persisting phase', err); });
            return;
        }
        var startDate = addDays(this.projectStart, t.start);
        // Normalize recursos to plain IDs
        var resIds = (t.res || []).map(function (r) {
            return typeof r === 'object' ? r.id : r;
        });
        _fetch('/app/api/gantt/actividad/' + t.id + '/', {
            method: 'PUT',
            body: {
                nombre: t.name,
                fecha_inicio: dateStr(startDate),
                duracion_dias: t.dur,
                progreso: t.progress,
                costo_estimado: t.cost,
                ingreso_estimado: t.income,
                dependencias: t.deps,
                recursos: resIds
            }
        }).catch(function (err) { console.error('Gantt: error persisting task', err); });
    };

    /* -------------------------------------------
       ZOOM
       ------------------------------------------- */
    Gantt.prototype._setZoom = function (z) {
        this.zoom = z;
        this.colW = ZOOM_PRESETS[z] || COL_W;

        // Update button states
        var self = this;
        Object.keys(this._zoomBtns).forEach(function (k) {
            self._zoomBtns[k].className = 'gantt-zoom-btn' + (k === z ? ' active' : '');
        });

        this._render();
    };

    /* -------------------------------------------
       COLLAPSE / EXPAND
       ------------------------------------------- */
    Gantt.prototype._setAllCollapsed = function (collapsed) {
        this.tasks.forEach(function (t) {
            if (t.isPhase) t.collapsed = collapsed;
        });
        this._render();
    };

    /* -------------------------------------------
       DELETE SELECTED
       ------------------------------------------- */
    Gantt.prototype._deleteSelected = function () {
        var self = this;
        if (this.selectedTaskId === null) {
            alert('Selecciona una actividad para eliminar.');
            return;
        }

        var t = this._taskById(this.selectedTaskId);
        if (!t) return;

        var idsToRemove = [t.id];
        if (t.isPhase) {
            // Also remove children
            this.tasks.forEach(function (c) {
                if (c.parent === t.id) idsToRemove.push(c.id);
            });
        }

        // Remove from parent children array
        if (t.parent) {
            var parent = this._taskById(t.parent);
            if (parent && parent.children) {
                parent.children = parent.children.filter(function (cid) { return cid !== t.id; });
            }
        }

        // Filter out removed tasks
        this.tasks = this.tasks.filter(function (x) {
            return idsToRemove.indexOf(x.id) === -1;
        });

        // Clean deps
        this.tasks.forEach(function (x) {
            if (x.deps) {
                x.deps = x.deps.filter(function (d) { return idsToRemove.indexOf(d) === -1; });
            }
        });

        this.selectedTaskId = null;

        // Persist deletion on server
        idsToRemove.forEach(function (rid) {
            _fetch('/app/api/gantt/actividad/' + rid + '/', { method: 'DELETE' }).catch(function () {});
        });

        this._render();
    };

    /* -------------------------------------------
       ADD ACTIVITY MODAL (PRO-001)
       ------------------------------------------- */
    /* -------------------------------------------
       MODAL: NUEVA FASE (vacía)
       ------------------------------------------- */
    Gantt.prototype._showAddPhaseModal = function () {
        var self = this;
        this.modal.innerHTML = '';
        this.modal.style.display = 'flex';

        var card = el('div', { className: 'gantt-modal' });

        var title = el('h3', { style: { margin: '0 0 16px', fontSize: '1rem', fontWeight: '700', color: COLOR_DARK } }, ['Nueva Fase']);

        var nameLabel = el('label', { style: { display: 'block', fontSize: '0.72rem', fontWeight: '600', color: '#64748B', textTransform: 'uppercase', marginBottom: '4px' } }, ['Nombre de la fase']);
        var nameInput = el('input', { type: 'text', className: 'gantt-inline-input', style: { width: '100%', padding: '8px 10px', marginBottom: '16px' }, placeholder: 'Ej: Levantamiento, Instalación...' });

        var btnRow = el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } });
        var btnCancel = el('button', { className: 'gantt-btn', onClick: function () { self.modal.style.display = 'none'; } }, ['Cancelar']);
        var btnSave = el('button', { className: 'gantt-btn gantt-btn-primary', onClick: function () {
            var name = nameInput.value.trim();
            if (!name) { nameInput.focus(); return; }
            btnSave.disabled = true;
            btnSave.textContent = 'Creando...';
            _fetch('/app/api/proyecto/' + self.proyectoId + '/gantt/fase/', {
                method: 'POST',
                body: { nombre: name }
            }).then(function () {
                self.modal.style.display = 'none';
                self._loadData();
            }).catch(function (err) {
                console.error('Error creando fase:', err);
                btnSave.disabled = false;
                btnSave.textContent = 'Crear Fase';
            });
        } }, ['Crear Fase']);

        btnRow.appendChild(btnCancel);
        btnRow.appendChild(btnSave);

        card.appendChild(title);
        card.appendChild(nameLabel);
        card.appendChild(nameInput);
        card.appendChild(btnRow);

        this.modal.appendChild(card);
        this.modal.onclick = function (e) { if (e.target === self.modal) self.modal.style.display = 'none'; };
        setTimeout(function () { nameInput.focus(); }, 50);
    };

    Gantt.prototype._showAddModal = function () {
        var self = this;
        this.modal.style.display = 'flex';

        var phases = this.tasks.filter(function (t) { return t.isPhase; });

        // Default start date = project start
        var defDate = dateStr(this.projectStart);

        var card = el('div', { className: 'gantt-modal' }, [
            el('h3', {}, ['Nueva Actividad']),

            el('div', { className: 'gantt-modal-field' }, [
                el('label', {}, ['Nombre de la Actividad *']),
                el('input', { type: 'text', id: 'gantt-add-name', placeholder: 'Ej: Excavacion de cimientos' })
            ]),

            el('div', { className: 'gantt-modal-field' }, [
                el('label', {}, ['Fase / Grupo']),
                (function () {
                    var sel = el('select', { id: 'gantt-add-phase' });
                    sel.appendChild(el('option', { value: '' }, ['Sin fase (nueva fase)']));
                    phases.forEach(function (p) {
                        sel.appendChild(el('option', { value: String(p.id) }, [p.name]));
                    });
                    return sel;
                })()
            ]),

            el('div', { style: { display: 'flex', gap: '12px' } }, [
                el('div', { className: 'gantt-modal-field', style: { flex: '1' } }, [
                    el('label', {}, ['Fecha de Inicio']),
                    el('input', { type: 'date', id: 'gantt-add-start', value: defDate })
                ]),
                el('div', { className: 'gantt-modal-field', style: { flex: '1' } }, [
                    el('label', {}, ['Duracion (dias)']),
                    el('input', { type: 'number', id: 'gantt-add-dur', value: '5', min: '1' })
                ])
            ]),

            el('div', { style: { display: 'flex', gap: '12px' } }, [
                el('div', { className: 'gantt-modal-field', style: { flex: '1' } }, [
                    el('label', {}, ['Costo Estimado ($)']),
                    el('input', { type: 'number', id: 'gantt-add-cost', value: '0', min: '0', step: '0.01' })
                ]),
                el('div', { className: 'gantt-modal-field', style: { flex: '1' } }, [
                    el('label', {}, ['Ingreso Estimado ($)']),
                    el('input', { type: 'number', id: 'gantt-add-income', value: '0', min: '0', step: '0.01' })
                ])
            ]),

            el('div', { className: 'gantt-modal-actions' }, [
                el('button', { className: 'gantt-btn', onClick: function () { self._closeModal(); } }, ['Cancelar']),
                el('button', { className: 'gantt-btn gantt-btn-primary', onClick: function () { self._doAddActivity(); } }, ['Agregar al Cronograma'])
            ])
        ]);

        this.modal.innerHTML = '';
        this.modal.appendChild(card);

        // Close on backdrop click
        this.modal.onclick = function (e) {
            if (e.target === self.modal) self._closeModal();
        };

        // Focus name field
        setTimeout(function () {
            var inp = document.getElementById('gantt-add-name');
            if (inp) inp.focus();
        }, 100);
    };

    Gantt.prototype._closeModal = function () {
        this.modal.style.display = 'none';
        this.modal.innerHTML = '';
    };

    Gantt.prototype._doAddActivity = function () {
        var nameEl = document.getElementById('gantt-add-name');
        var phaseEl = document.getElementById('gantt-add-phase');
        var startEl = document.getElementById('gantt-add-start');
        var durEl = document.getElementById('gantt-add-dur');
        var costEl = document.getElementById('gantt-add-cost');
        var incomeEl = document.getElementById('gantt-add-income');

        var name = (nameEl.value || '').trim();
        if (!name) {
            alert('El nombre de la actividad es obligatorio.');
            nameEl.focus();
            return;
        }

        var phaseId = phaseEl.value ? parseInt(phaseEl.value) : null;
        var startDate = startEl.value ? parseDate(startEl.value) : this.projectStart;
        var startDay = Math.max(0, daysBetween(this.projectStart, startDate));
        var dur = Math.max(1, parseInt(durEl.value) || 1);
        var cost = parseFloat(costEl.value) || 0;
        var income = parseFloat(incomeEl.value) || 0;

        var self = this;

        // If no phase selected, create a new phase
        if (!phaseId) {
            var phaseTask = {
                id: this.nextId++,
                name: name,
                isPhase: true,
                collapsed: false,
                children: [],
                start: startDay,
                dur: dur,
                progress: 0,
                deps: [],
                res: [],
                cost: 0,
                income: 0,
                parent: null
            };
            this.tasks.push(phaseTask);
            phaseId = phaseTask.id;
        }

        // Verify phase still exists
        var phase = this._taskById(phaseId);
        if (!phase) {
            // Phase was deleted, create as independent phase
            var newPhase = {
                id: this.nextId++,
                name: name + ' (Fase)',
                isPhase: true,
                collapsed: false,
                children: [],
                start: startDay,
                dur: dur,
                progress: 0,
                deps: [],
                res: [],
                cost: 0,
                income: 0,
                parent: null
            };
            this.tasks.push(newPhase);
            phaseId = newPhase.id;
            phase = newPhase;
        }

        var newTask = {
            id: this.nextId++,
            name: name,
            isPhase: false,
            collapsed: false,
            children: null,
            start: startDay,
            dur: dur,
            progress: 0,
            deps: [],
            res: [],
            cost: cost,
            income: income,
            parent: phaseId
        };

        // Insert after last child of phase
        phase.children.push(newTask.id);
        var lastChildIdx = -1;
        for (var i = this.tasks.length - 1; i >= 0; i--) {
            if (this.tasks[i].id === phaseId || this.tasks[i].parent === phaseId) {
                lastChildIdx = i;
                break;
            }
        }
        this.tasks.splice(lastChildIdx + 1, 0, newTask);

        this._closeModal();
        this._render();

        // Persist to server
        var startDateStr = dateStr(addDays(this.projectStart, startDay));
        _fetch('/app/api/proyecto/' + this.proyectoId + '/gantt/', {
            method: 'POST',
            body: {
                nombre: name,
                fase_id: phaseId,
                fecha_inicio: startDateStr,
                duracion: dur,
                costo_estimado: cost,
                ingreso_estimado: income
            }
        }).then(function (resp) {
            // Update local ID if server returns one
            if (resp && resp.id) {
                var oldId = newTask.id;
                newTask.id = resp.id;
                // Update parent children
                if (phase.children) {
                    var idx = phase.children.indexOf(oldId);
                    if (idx !== -1) phase.children[idx] = resp.id;
                }
                // Update any deps referencing old ID
                self.tasks.forEach(function (t) {
                    if (t.deps) {
                        var di = t.deps.indexOf(oldId);
                        if (di !== -1) t.deps[di] = resp.id;
                    }
                });
                self.nextId = Math.max(self.nextId, resp.id + 1);
            }
        }).catch(function (err) { console.error('Gantt: error creating activity', err); });
    };

    /* -------------------------------------------
       RESOURCE ASSIGNMENT MODAL (PRO-006)
       ------------------------------------------- */
    Gantt.prototype._resAvatarColor = function (name) {
        var h = 0;
        for (var i = 0; i < name.length; i++) h = name.charCodeAt(i) * 37 + h;
        return 'hsl(' + (Math.abs(h) % 360) + ', 55%, 55%)';
    };

    Gantt.prototype._resInitials = function (name) {
        var parts = (name || '?').split(' ');
        var ini = parts[0].charAt(0).toUpperCase();
        if (parts.length > 1) ini += parts[1].charAt(0).toUpperCase();
        return ini;
    };

    Gantt.prototype._showResourceModal = function (taskId) {
        var self = this;
        var t = this._taskById(taskId);
        if (!t) return;

        this.modal.style.display = 'flex';
        this.modal.innerHTML = '';

        // Build initial card with loading state
        var resList = el('div', { className: 'gantt-res-list' }, [
            el('div', { className: 'gantt-res-loading' }, ['Cargando usuarios...'])
        ]);

        var checkboxes = [];

        var card = el('div', { className: 'gantt-modal' }, [
            el('h3', {}, ['Asignar Recursos']),
            el('div', { style: { fontSize: '12px', color: COLOR_TEXT_SEC, marginBottom: '12px', marginTop: '-8px' } }, [t.name]),
            resList,
            el('div', { className: 'gantt-modal-actions' }, [
                el('button', { className: 'gantt-btn', onClick: function () { self._closeModal(); } }, ['Cancelar']),
                el('button', { className: 'gantt-btn gantt-btn-primary', onClick: function () {
                    var selected = [];
                    checkboxes.forEach(function (c) {
                        if (c.el.checked) selected.push(c.id);
                    });
                    t.res = selected;
                    self._closeModal();
                    self._render();
                    self._persistTask(t);
                } }, ['Guardar'])
            ])
        ]);

        this.modal.appendChild(card);

        this.modal.onclick = function (e) {
            if (e.target === self.modal) self._closeModal();
        };

        // Extract currently assigned IDs from t.res
        // t.res may contain plain IDs (numbers) or objects {id, nombre}
        var assignedIds = (t.res || []).map(function (r) {
            return typeof r === 'object' ? r.id : r;
        });

        // Fetch users from API
        _fetch('/app/api/buscar-usuarios/')
            .then(function (data) {
                var usuarios = (data.usuarios || []);
                resList.innerHTML = '';

                if (usuarios.length === 0) {
                    resList.appendChild(el('div', { className: 'gantt-res-loading' }, ['No hay usuarios disponibles']));
                    return;
                }

                usuarios.forEach(function (u) {
                    var uid = u.id;
                    var nombre = u.nombre || u.username || String(uid);
                    var iniciales = u.iniciales || self._resInitials(nombre);
                    var rol = u.rol || '';
                    var isAssigned = assignedIds.indexOf(uid) !== -1;

                    var cb = el('input', { type: 'checkbox', className: 'gantt-res-cb' });
                    if (isAssigned) cb.checked = true;
                    checkboxes.push({ el: cb, id: uid });

                    var avatarBg = self._resAvatarColor(nombre);

                    var row = el('label', { className: 'gantt-res-row' }, [
                        cb,
                        el('div', { className: 'gantt-res-avatar', style: { background: avatarBg } }, [iniciales]),
                        el('div', { className: 'gantt-res-info' }, [
                            el('div', { className: 'gantt-res-name' }, [nombre]),
                            rol ? el('div', { className: 'gantt-res-role' }, [rol]) : null
                        ].filter(Boolean))
                    ]);
                    resList.appendChild(row);
                });
            })
            .catch(function () {
                resList.innerHTML = '';
                resList.appendChild(el('div', { className: 'gantt-res-loading' }, ['Error cargando usuarios']));
            });
    };

    /* -------------------------------------------
       CONTEXT MENU (Right-click on bar)
       ------------------------------------------- */
    Gantt.prototype._onContextMenu = function (e) {
        e.preventDefault();
        e.stopPropagation();

        // Remove any existing menu
        var existing = this.root.querySelector('.gantt-ctx-menu');
        if (existing) existing.remove();

        var pos = this._getCanvasPos(e);
        var hit = this._hitTest(pos);
        if (!hit || hit.task.isPhase) return;

        var self = this;
        var t = hit.task;
        this.selectedTaskId = t.id;
        this._render();

        var menu = el('div', { className: 'gantt-ctx-menu' });

        // --- Option: Add dependency (submenu)
        var otherTasks = this.tasks.filter(function (x) {
            return !x.isPhase && x.id !== t.id && (!t.deps || t.deps.indexOf(x.id) === -1);
        });

        if (otherTasks.length > 0) {
            var depItem = el('div', { className: 'gantt-ctx-item' }, [
                '\u2192 Agregar dependencia',
                el('span', { className: 'gantt-ctx-arrow' }, ['\u25B6'])
            ]);

            var subMenu = el('div', { className: 'gantt-ctx-sub' });
            otherTasks.forEach(function (ot) {
                var subItem = el('div', { className: 'gantt-ctx-sub-item' }, [ot.name]);
                subItem.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    self._addDependency(t, ot.id);
                    menu.remove();
                });
                subMenu.appendChild(subItem);
            });

            depItem.appendChild(subMenu);
            menu.appendChild(depItem);
        }

        // --- Option: Remove dependencies
        if (t.deps && t.deps.length > 0) {
            var removeDepsItem = el('div', { className: 'gantt-ctx-item danger' }, ['\u2716 Quitar dependencias']);
            removeDepsItem.addEventListener('click', function (ev) {
                ev.stopPropagation();
                self._removeDependencies(t);
                menu.remove();
            });
            menu.appendChild(removeDepsItem);
        }

        // Separator
        menu.appendChild(el('div', { className: 'gantt-ctx-sep' }));

        // --- Option: Edit progress
        var progItem = el('div', { className: 'gantt-ctx-item' }, ['\u270E Editar progreso']);
        progItem.addEventListener('click', function (ev) {
            ev.stopPropagation();
            // Replace menu content with progress editor
            menu.innerHTML = '';
            var progWrap = el('div', { className: 'gantt-ctx-progress-wrap' });
            var progInput = el('input', {
                type: 'number',
                className: 'gantt-ctx-progress-input',
                value: String(t.progress),
                min: '0',
                max: '100'
            });
            var progBtn = el('button', { className: 'gantt-ctx-progress-btn' }, ['OK']);

            var doSave = function () {
                var val = Math.max(0, Math.min(100, parseInt(progInput.value) || 0));
                t.progress = val;
                self._persistTask(t);
                self._render();
                menu.remove();
            };

            progBtn.addEventListener('click', function (ev2) {
                ev2.stopPropagation();
                doSave();
            });

            progInput.addEventListener('keydown', function (ev2) {
                if (ev2.key === 'Enter') {
                    ev2.preventDefault();
                    doSave();
                } else if (ev2.key === 'Escape') {
                    menu.remove();
                }
            });

            progWrap.appendChild(el('span', { style: { fontSize: '12px', color: '#64748b' } }, ['Progreso:']));
            progWrap.appendChild(progInput);
            progWrap.appendChild(el('span', { style: { fontSize: '12px', color: '#64748b' } }, ['%']));
            progWrap.appendChild(progBtn);
            menu.appendChild(progWrap);

            setTimeout(function () { progInput.focus(); progInput.select(); }, 50);
        });
        menu.appendChild(progItem);

        // Separator
        menu.appendChild(el('div', { className: 'gantt-ctx-sep' }));

        // --- Option: View details
        var detailItem = el('div', { className: 'gantt-ctx-item' }, ['\uD83D\uDCCB Ver detalles']);
        detailItem.addEventListener('click', function (ev) {
            ev.stopPropagation();
            self._showResourceModal(t.id);
            menu.remove();
        });
        menu.appendChild(detailItem);

        // Position menu relative to root
        var rootRect = this.root.getBoundingClientRect();
        var mx = e.clientX - rootRect.left;
        var my = e.clientY - rootRect.top;

        menu.style.left = mx + 'px';
        menu.style.top = my + 'px';
        this.root.appendChild(menu);

        // Adjust if overflows right/bottom
        var menuRect = menu.getBoundingClientRect();
        if (mx + menuRect.width > rootRect.width) {
            menu.style.left = (mx - menuRect.width) + 'px';
        }
        if (my + menuRect.height > rootRect.height) {
            menu.style.top = (my - menuRect.height) + 'px';
        }
    };

    Gantt.prototype._addDependency = function (task, depId) {
        if (!task.deps) task.deps = [];
        if (task.deps.indexOf(depId) !== -1) return;

        task.deps.push(depId);

        // Cascade to enforce FS constraint
        var dep = this._taskById(depId);
        if (dep) {
            var minStart = dep.start + dep.dur;
            if (task.start < minStart) {
                task.start = minStart;
            }
        }

        this._persistTask(task);
        this._render();
    };

    Gantt.prototype._removeDependencies = function (task) {
        task.deps = [];
        this._persistTask(task);
        this._render();
    };

    /* -------------------------------------------
       GENERIC INLINE CELL EDIT
       field: 'name' | 'dur' | 'progress'
       opts: { type, min, max, suffix, cssClass }
       ------------------------------------------- */
    Gantt.prototype._startCellEdit = function (task, field, spanEl, cell, opts) {
        var self = this;
        opts = opts || {};
        var oldValue = task[field];
        var inputType = opts.type || 'text';

        // Value shown in the input (strip suffix for display)
        var displayValue = (field === 'name') ? oldValue : String(oldValue);

        // Hide the span
        spanEl.style.display = 'none';

        var inputClass = 'gantt-inline-input';
        if (opts.cssClass) inputClass += ' ' + opts.cssClass;

        var attrs = {
            type: inputType,
            className: inputClass,
            value: displayValue
        };
        if (opts.min !== undefined) attrs.min = String(opts.min);
        if (opts.max !== undefined) attrs.max = String(opts.max);

        var input = el('input', attrs);
        cell.appendChild(input);

        var done = false;
        var finish = function (save) {
            if (done) return;
            done = true;

            if (save) {
                var rawVal = input.value.trim();
                var newValue;
                if (field === 'name') {
                    newValue = rawVal;
                    if (!newValue) { /* empty name — cancel */ input.remove(); spanEl.style.display = ''; return; }
                } else if (field === 'dur') {
                    newValue = Math.max(1, parseInt(rawVal) || 1);
                } else if (field === 'progress') {
                    var parsed = parseInt(rawVal);
                    if (isNaN(parsed)) parsed = 0;
                    newValue = Math.max(0, Math.min(100, parsed));
                } else {
                    newValue = rawVal;
                }

                if (newValue !== oldValue) {
                    task[field] = newValue;
                    // Si cambió la duración, cascadear dependencias
                    if (field === 'dur' && typeof self._cascadeDeps === 'function') {
                        // Guardar starts antes de cascada para detectar cambios
                        var snapshots = {};
                        self.tasks.forEach(function (tt) { if (!tt.isPhase) snapshots[tt.id] = tt.start; });
                        self._cascadeDeps(task.id);
                        // Persistir todas las que cambiaron
                        self.tasks.forEach(function (tt) {
                            if (!tt.isPhase && snapshots[tt.id] !== undefined && snapshots[tt.id] !== tt.start) {
                                self._persistTask(tt);
                            }
                        });
                    }
                    self._persistTask(task);
                    self._render();
                    input.remove();
                    return;
                }
            }

            // No change or cancel — restore display
            input.remove();
            spanEl.style.display = '';
        };

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                finish(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finish(false);
            }
        });

        input.addEventListener('blur', function () {
            finish(true);
        });

        setTimeout(function () { input.focus(); input.select(); }, 30);
    };

    /* Backward-compatible wrapper */
    Gantt.prototype._startInlineEdit = function (task, spanEl, cell) {
        this._startCellEdit(task, 'name', spanEl, cell, { type: 'text' });
    };

    /* -------------------------------------------
       APPLY TEMPLATE
       ------------------------------------------- */
    Gantt.prototype._applyTemplate = function (template) {
        var self = this;
        var proyectoId = this.proyectoId;
        var startDate = new Date(this.projectStart);

        // Show loading state
        var emptyEl = this.root.querySelector('.gantt-empty');
        if (emptyEl) {
            emptyEl.innerHTML = '';
            var loadingDiv = el('div', { className: 'gantt-tpl-loading' }, [
                el('div', { style: { marginBottom: '12px', fontSize: '1.1rem', fontWeight: '600', color: '#1E293B' } }, ['Creando programa de obra...']),
                el('div', {}, ['Aplicando plantilla: ' + template.name])
            ]);
            emptyEl.appendChild(loadingDiv);
        }

        var cursor = new Date(startDate);
        var phaseIndex = 0;

        function createNextPhase() {
            if (phaseIndex >= template.phases.length) {
                // All done — reload data
                self._loadData();
                return;
            }

            var phase = template.phases[phaseIndex];
            phaseIndex++;

            _fetch('/app/api/proyecto/' + proyectoId + '/gantt/fase/', {
                method: 'POST',
                body: { nombre: phase.name }
            }).then(function (resp) {
                if (!resp || !resp.fase) {
                    console.error('Gantt: error creating phase', phase.name, resp);
                    createNextPhase();
                    return;
                }

                var faseId = resp.fase.id;
                var actIndex = 0;

                function createNextActivity() {
                    if (actIndex >= phase.activities.length) {
                        createNextPhase();
                        return;
                    }

                    var act = phase.activities[actIndex];
                    actIndex++;

                    _fetch('/app/api/proyecto/' + proyectoId + '/gantt/', {
                        method: 'POST',
                        body: {
                            nombre: act.name,
                            fase_id: faseId,
                            fecha_inicio: dateStr(cursor),
                            duracion_dias: act.dur
                        }
                    }).then(function () {
                        cursor = addDays(cursor, act.dur);
                        createNextActivity();
                    }).catch(function (err) {
                        console.error('Gantt: error creating activity', act.name, err);
                        cursor = addDays(cursor, act.dur);
                        createNextActivity();
                    });
                }

                createNextActivity();
            }).catch(function (err) {
                console.error('Gantt: error creating phase', phase.name, err);
                createNextPhase();
            });
        }

        createNextPhase();
    };

    /* ============================================================
       MEJORA 1 — PANTALLA COMPLETA DEL GANTT
       ============================================================ */
    Gantt.prototype._toggleFullscreen = function () {
        var container = this.container;
        if (!container) return;
        var alreadyOpen = container.classList.contains('proy-gantt-fullscreen');
        if (alreadyOpen) {
            this._exitFullscreen();
        } else {
            this._enterFullscreen();
        }
    };

    Gantt.prototype._enterFullscreen = function () {
        var self = this;
        this.container.classList.add('proy-gantt-fullscreen');
        document.body.classList.add('proy-gantt-fullscreen-active');

        // Botón salir
        if (!this._fsExitBtn) {
            var btn = document.createElement('button');
            btn.className = 'proy-gantt-fs-exit';
            btn.type = 'button';
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg><span>Salir de pantalla completa</span>';
            btn.addEventListener('click', function () { self._exitFullscreen(); });
            this._fsExitBtn = btn;
        }
        document.body.appendChild(this._fsExitBtn);

        // ESC para salir
        if (!this._fsKeyHandler) {
            this._fsKeyHandler = function (e) {
                if (e.key === 'Escape' && self.container.classList.contains('proy-gantt-fullscreen')) {
                    // Si el drawer está abierto, cerrarlo primero (no salir del FS)
                    var drawer = document.getElementById('ganttActDrawer');
                    if (drawer && drawer.classList.contains('is-open')) return;
                    self._exitFullscreen();
                }
            };
            document.addEventListener('keydown', this._fsKeyHandler);
        }

        // Forzar resize del canvas tras layout
        setTimeout(function () { self._render(); }, 50);
    };

    Gantt.prototype._exitFullscreen = function () {
        this.container.classList.remove('proy-gantt-fullscreen');
        document.body.classList.remove('proy-gantt-fullscreen-active');
        if (this._fsExitBtn && this._fsExitBtn.parentNode) {
            this._fsExitBtn.parentNode.removeChild(this._fsExitBtn);
        }
        var self = this;
        setTimeout(function () { self._render(); }, 50);
    };

    /* ============================================================
       MEJORA 2 — DRAWER LATERAL DE DETALLES
       ============================================================ */
    Gantt.prototype._openDrawer = function (taskId) {
        var t = this._taskById(taskId);
        if (!t || t.isPhase) return;
        var self = this;

        // Inyectar referencia global única para que las funciones del HTML
        // (window.proyGantt*) puedan operar sobre la última instancia.
        window._proyGanttCurrentInstance = this;
        window._proyGanttCurrentTaskId   = taskId;

        var drawer = document.getElementById('ganttActDrawer');
        var overlay = document.getElementById('ganttActDrawerOverlay');
        if (!drawer || !overlay) {
            console.warn('Gantt: drawer markup no presente en el DOM');
            return;
        }

        this._renderDrawer(t);

        drawer.classList.add('is-open');
        drawer.setAttribute('aria-hidden', 'false');
        overlay.classList.add('is-open');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('proy-gantt-drawer-open');

        // ESC cierra drawer
        if (!this._drawerKeyHandler) {
            this._drawerKeyHandler = function (e) {
                if (e.key === 'Escape') {
                    var dr = document.getElementById('ganttActDrawer');
                    if (dr && dr.classList.contains('is-open')) {
                        // No cerrar si fullscreen de actividad está abierto
                        var fs = document.getElementById('ganttActFullscreen');
                        if (fs && fs.classList.contains('is-open')) return;
                        self._closeDrawer();
                    }
                }
            };
            document.addEventListener('keydown', this._drawerKeyHandler);
        }
    };

    Gantt.prototype._closeDrawer = function () {
        var drawer = document.getElementById('ganttActDrawer');
        var overlay = document.getElementById('ganttActDrawerOverlay');
        if (drawer) { drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true'); }
        if (overlay) { overlay.classList.remove('is-open'); overlay.setAttribute('aria-hidden', 'true'); }
        // Mantener bloqueo si el Gantt o el fullscreen de actividad siguen abiertos
        var fs = document.getElementById('ganttActFullscreen');
        var ganttFs = this.container && this.container.classList.contains('proy-gantt-fullscreen');
        var actFs = fs && fs.classList.contains('is-open');
        if (!ganttFs && !actFs) {
            document.body.classList.remove('proy-gantt-drawer-open');
        } else {
            document.body.classList.remove('proy-gantt-drawer-open');
        }
    };

    Gantt.prototype._taskStatus = function (t) {
        // Devuelve {label, cls} entre LISTA, ACTIVA, ATRASADA, COMPLETADA.
        if ((t.progress || 0) >= 100) return { label: 'COMPLETADA', cls: 'gantt-status-completada' };
        var todayDay = daysBetween(this.projectStart, new Date());
        if (todayDay < t.start) return { label: 'LISTA', cls: 'gantt-status-lista' };
        if (todayDay >= t.start + t.dur) return { label: 'ATRASADA', cls: 'gantt-status-atrasada' };
        return { label: 'ACTIVA', cls: 'gantt-status-activa' };
    };

    Gantt.prototype._fmtDateLong = function (d) {
        return d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
    };

    Gantt.prototype._initialsOf = function (name) {
        if (!name) return '?';
        var p = String(name).trim().split(/\s+/);
        var i = (p[0] || '?').charAt(0).toUpperCase();
        if (p.length > 1) i += p[1].charAt(0).toUpperCase();
        return i;
    };

    Gantt.prototype._renderDrawer = function (t) {
        var self = this;
        var $ = function (id) { return document.getElementById(id); };

        // Tags
        var phase = t.parent ? this._taskById(t.parent) : null;
        var faseTag = $('ganttDrawerFaseTag');
        if (faseTag) {
            faseTag.textContent = phase ? phase.name : 'Sin fase';
            faseTag.style.display = phase ? '' : 'none';
        }
        var status = this._taskStatus(t);
        var statusTag = $('ganttDrawerStatusTag');
        if (statusTag) {
            statusTag.textContent = status.label;
            statusTag.className = 'gantt-drawer-tag gantt-drawer-tag--status ' + status.cls;
        }

        // Title
        var title = $('ganttDrawerTitle');
        if (title) title.textContent = t.name || 'Actividad';

        // Resumen — fechas
        var sd = addDays(this.projectStart, t.start);
        var ed = addDays(this.projectStart, t.start + t.dur);
        var fIni = $('ganttDrawerFechaInicio'); if (fIni) fIni.textContent = this._fmtDateLong(sd);
        var fFin = $('ganttDrawerFechaFin');    if (fFin) fFin.textContent = this._fmtDateLong(ed);
        var dur  = $('ganttDrawerDuracion');    if (dur)  dur.textContent  = t.dur + ' días';
        var rest = $('ganttDrawerDiasRestantes');
        if (rest) {
            var todayDay = daysBetween(this.projectStart, new Date());
            var endDay = t.start + t.dur;
            var diff = endDay - todayDay;
            if ((t.progress || 0) >= 100) rest.textContent = 'Completada';
            else if (diff < 0) rest.textContent = Math.abs(diff) + ' días vencida';
            else rest.textContent = diff + ' días';
        }

        // Avance
        var av = $('ganttDrawerAvanceTxt');  if (av) av.textContent = (t.progress || 0) + '%';
        var fill = $('ganttDrawerAvanceFill');
        if (fill) {
            fill.style.width = Math.min(100, t.progress || 0) + '%';
            fill.style.background = (t.progress || 0) >= 100 ? '#10B981' : '#3B82F6';
        }

        // Descripción — la obtenemos del backend (campo `descripcion`)
        var desc = $('ganttDrawerDescripcion');
        if (desc) {
            var d = (t.descripcion || '').trim();
            if (d) {
                desc.textContent = d;
                desc.classList.remove('is-empty');
            } else {
                desc.textContent = 'Sin descripción';
                desc.classList.add('is-empty');
            }
        }

        // Responsables
        var resp = $('ganttDrawerResponsables');
        if (resp) {
            resp.innerHTML = '';
            var rs = (t.res || []);
            if (rs.length === 0) {
                resp.textContent = 'Sin responsables';
                resp.classList.add('gantt-drawer-chips--placeholder');
            } else {
                resp.classList.remove('gantt-drawer-chips--placeholder');
                rs.forEach(function (r) {
                    var nombre = (typeof r === 'object') ? (r.nombre || r.username || ('#' + r.id)) : ('Usuario #' + r);
                    var ini = self._initialsOf(nombre);
                    var chip = el('span', { className: 'gantt-drawer-chip' });
                    var av2 = el('span', {
                        className: 'gantt-drawer-avatar',
                        style: { background: self._resAvatarColor ? self._resAvatarColor(nombre) : '#3B82F6' }
                    }, [ini]);
                    chip.appendChild(av2);
                    chip.appendChild(document.createTextNode(nombre));
                    resp.appendChild(chip);
                });
            }
        }

        // Recursos materiales (placeholder — modelo no existe todavía)
        var mat = $('ganttDrawerMateriales');
        if (mat) {
            mat.innerHTML = 'Próximamente';
            mat.classList.add('gantt-drawer-chips--placeholder');
        }

        // Dependencias
        var depsPrev = $('ganttDrawerDepsPrev');
        var depsNext = $('ganttDrawerDepsNext');
        if (depsPrev) {
            depsPrev.innerHTML = '';
            var prev = (t.deps || []);
            if (prev.length === 0) depsPrev.textContent = '—';
            else {
                prev.forEach(function (id) {
                    var dt = self._taskById(id);
                    var btn = el('button', {
                        className: 'gantt-drawer-deplink',
                        onClick: function () { if (dt) self._openDrawer(dt.id); }
                    }, [dt ? dt.name : ('Actividad #' + id)]);
                    depsPrev.appendChild(btn);
                });
            }
        }
        if (depsNext) {
            depsNext.innerHTML = '';
            var nextList = this.tasks.filter(function (x) {
                return !x.isPhase && (x.deps || []).indexOf(t.id) !== -1;
            });
            if (nextList.length === 0) depsNext.textContent = '—';
            else {
                nextList.forEach(function (dt) {
                    var btn = el('button', {
                        className: 'gantt-drawer-deplink',
                        onClick: function () { self._openDrawer(dt.id); }
                    }, [dt.name]);
                    depsNext.appendChild(btn);
                });
            }
        }

        // Financiero
        var costo = $('ganttDrawerCosto'); if (costo) costo.textContent = fmtMoney(t.cost || 0);
        var ing = $('ganttDrawerIngreso'); if (ing) ing.textContent = fmtMoney(t.income || 0);
        var marg = $('ganttDrawerMargen');
        if (marg) {
            var m = (t.income || 0) - (t.cost || 0);
            marg.textContent = (m >= 0 ? '+' : '-') + fmtMoney(Math.abs(m));
            marg.style.color = m >= 0 ? '#10B981' : '#EF4444';
        }

        // En el calendario
        var calSec = $('ganttDrawerCalSection');
        var calLink = $('ganttDrawerCalLink');
        if (calSec && calLink) {
            if (t.actividad_calendario_id) {
                calSec.style.display = '';
                calLink.dataset.actividadId = t.actividad_calendario_id;
            } else {
                calSec.style.display = 'none';
            }
        }

        // Si nos faltan campos (descripcion no llegó del API en _parseData),
        // pedimos los detalles del backend y refrescamos.
        if (!t._detalleHidratado) {
            this._hydrateTaskDetail(t);
        }
    };

    /* Si el GET inicial /api/proyecto/<id>/gantt/ no incluye descripcion,
       hacemos un GET adicional para hidratar el task. */
    Gantt.prototype._hydrateTaskDetail = function (t) {
        var self = this;
        // Estrategia ligera: refrescamos el árbol completo si falta data
        // y luego repintamos el drawer si sigue abierto.
        if (typeof t.descripcion === 'string') return;
        _fetch('/app/api/proyecto/' + this.proyectoId + '/gantt/').then(function (data) {
            (data.actividades || []).forEach(function (a) {
                var local = self._taskById(a.id);
                if (local) {
                    local.descripcion = a.descripcion || '';
                    local.actividad_calendario_id = a.actividad_calendario_id || null;
                    local._detalleHidratado = true;
                }
            });
            // Repintar drawer si todavía está abierto sobre el mismo task
            var drawer = document.getElementById('ganttActDrawer');
            if (drawer && drawer.classList.contains('is-open') && window._proyGanttCurrentTaskId === t.id) {
                self._renderDrawer(self._taskById(t.id) || t);
            }
        }).catch(function () {});
    };

    /* ============================================================
       MEJORA 3 — VISTA FULLSCREEN DE ACTIVIDAD
       ============================================================ */
    Gantt.prototype._openActivityFullscreen = function (taskId) {
        var self = this;
        var t = this._taskById(taskId);
        if (!t) return;
        window._proyGanttCurrentInstance = this;
        window._proyGanttCurrentTaskId   = taskId;

        var fs = document.getElementById('ganttActFullscreen');
        if (!fs) return;
        document.body.classList.add('proy-gantt-fullscreen-active');

        this._renderActivityFullscreen(t);

        fs.classList.add('is-open');
        fs.setAttribute('aria-hidden', 'false');

        // Default a tab "detalles"
        this._setActivityFullscreenTab('detalles');

        // Cargar comentarios
        this._fetchAndRenderComments(t.id);
        this._fetchAndRenderArchivos(t.id);

        // ESC para cerrar
        if (!this._fsActKeyHandler) {
            this._fsActKeyHandler = function (e) {
                if (e.key === 'Escape') {
                    var f = document.getElementById('ganttActFullscreen');
                    if (f && f.classList.contains('is-open')) {
                        self._closeActivityFullscreen();
                    }
                }
            };
            document.addEventListener('keydown', this._fsActKeyHandler);
        }
    };

    Gantt.prototype._closeActivityFullscreen = function () {
        var fs = document.getElementById('ganttActFullscreen');
        if (fs) {
            fs.classList.remove('is-open');
            fs.setAttribute('aria-hidden', 'true');
        }
        // Si el Gantt estaba en pantalla completa, mantener bloqueo del body.
        if (!this.container.classList.contains('proy-gantt-fullscreen')) {
            document.body.classList.remove('proy-gantt-fullscreen-active');
        }
        // También cerrar drawer si estaba abierto detrás
        this._closeDrawer();
    };

    Gantt.prototype._setActivityFullscreenTab = function (tabName) {
        var fs = document.getElementById('ganttActFullscreen');
        if (!fs) return;
        fs.querySelectorAll('.gantt-act-fs-tab').forEach(function (b) {
            b.classList.toggle('active', b.dataset.fsTab === tabName);
        });
        fs.querySelectorAll('.gantt-act-fs-pane').forEach(function (p) {
            p.classList.toggle('active', p.dataset.fsPane === tabName);
        });
    };

    Gantt.prototype._renderActivityFullscreen = function (t) {
        var self = this;
        var $ = function (id) { return document.getElementById(id); };
        var phase = t.parent ? this._taskById(t.parent) : null;
        var faseNombre = phase ? phase.name : 'Sin fase';

        var faseBC = $('ganttActFsFase'); if (faseBC) faseBC.textContent = faseNombre;
        var titBC  = $('ganttActFsTitulo'); if (titBC) titBC.textContent = t.name || 'Actividad';

        var heroFase = $('ganttActFsHeroFase'); if (heroFase) heroFase.textContent = faseNombre;
        var status = this._taskStatus(t);
        var heroStatus = $('ganttActFsHeroStatus');
        if (heroStatus) {
            heroStatus.textContent = status.label;
            heroStatus.className = 'gantt-drawer-tag gantt-drawer-tag--status ' + status.cls;
        }
        var heroTit = $('ganttActFsHeroTitulo'); if (heroTit) heroTit.textContent = t.name || 'Actividad';

        // Avance
        var avTxt = $('ganttActFsHeroAvanceTxt'); if (avTxt) avTxt.textContent = (t.progress || 0) + '%';
        var avFill = $('ganttActFsHeroAvanceFill');
        if (avFill) {
            avFill.style.width = Math.min(100, t.progress || 0) + '%';
            avFill.style.background = (t.progress || 0) >= 100 ? '#10B981' : '#3B82F6';
        }

        // Fechas
        var sd = addDays(this.projectStart, t.start);
        var ed = addDays(this.projectStart, t.start + t.dur);
        var fIni = $('ganttActFsFechaInicio'); if (fIni) fIni.textContent = this._fmtDateLong(sd);
        var fFin = $('ganttActFsFechaFin');    if (fFin) fFin.textContent = this._fmtDateLong(ed);
        var dur  = $('ganttActFsDuracion');    if (dur)  dur.textContent  = t.dur + ' días';
        var rest = $('ganttActFsDiasRestantes');
        if (rest) {
            var todayDay = daysBetween(this.projectStart, new Date());
            var endDay = t.start + t.dur;
            var diff = endDay - todayDay;
            if ((t.progress || 0) >= 100) rest.textContent = 'Completada';
            else if (diff < 0) rest.textContent = Math.abs(diff) + ' días vencida';
            else rest.textContent = diff + ' días';
        }

        // Equipo
        var team = $('ganttActFsResponsables');
        if (team) {
            team.innerHTML = '';
            var rs = (t.res || []);
            if (rs.length === 0) {
                team.textContent = 'Sin responsables';
            } else {
                rs.forEach(function (r) {
                    var nombre = (typeof r === 'object') ? (r.nombre || r.username || ('#' + r.id)) : ('Usuario #' + r);
                    var rol = (typeof r === 'object' && r.rol) ? r.rol : '';
                    var ini = self._initialsOf(nombre);
                    var bg = self._resAvatarColor ? self._resAvatarColor(nombre) : '#3B82F6';
                    var info = el('div', { className: 'gantt-act-fs-team-info' }, [
                        el('span', { className: 'gantt-act-fs-team-name' }, [nombre]),
                        rol ? el('span', { className: 'gantt-act-fs-team-role' }, [rol]) : null
                    ].filter(Boolean));
                    var member = el('div', { className: 'gantt-act-fs-team-member' }, [
                        el('span', { className: 'gantt-act-fs-team-avatar', style: { background: bg } }, [ini]),
                        info
                    ]);
                    team.appendChild(member);
                });
            }
        }

        // Materiales (placeholder)
        var mat = $('ganttActFsMateriales');
        if (mat) {
            mat.textContent = 'Próximamente';
            mat.classList.add('gantt-drawer-chips--placeholder');
        }

        // Financiero
        var costo = $('ganttActFsCosto'); if (costo) costo.textContent = fmtMoney(t.cost || 0);
        var ing = $('ganttActFsIngreso'); if (ing) ing.textContent = fmtMoney(t.income || 0);
        var marg = $('ganttActFsMargen');
        if (marg) {
            var m = (t.income || 0) - (t.cost || 0);
            marg.textContent = (m >= 0 ? '+' : '-') + fmtMoney(Math.abs(m));
            marg.style.color = m >= 0 ? '#10B981' : '#EF4444';
        }

        // Descripción
        var desc = $('ganttActFsDescripcion');
        if (desc) {
            var d = (t.descripcion || '').trim();
            if (d) {
                desc.textContent = d;
                desc.classList.remove('is-empty');
            } else {
                desc.textContent = 'Sin descripción';
                desc.classList.add('is-empty');
            }
        }
    };

    Gantt.prototype._fetchAndRenderComments = function (taskId) {
        var self = this;
        var thread = document.getElementById('ganttActFsComentariosThread');
        if (!thread) return;
        thread.innerHTML = '<div class="gantt-act-fs-empty">Cargando comentarios…</div>';

        _fetch('/app/api/gantt/actividad/' + taskId + '/comentarios/').then(function (resp) {
            if (!resp || !resp.success) {
                thread.innerHTML = '<div class="gantt-act-fs-empty">Error al cargar comentarios</div>';
                return;
            }
            self._renderComments(resp.items || []);
        }).catch(function () {
            thread.innerHTML = '<div class="gantt-act-fs-empty">Error al cargar comentarios</div>';
        });
    };

    Gantt.prototype._renderComments = function (items) {
        var self = this;
        var thread = document.getElementById('ganttActFsComentariosThread');
        if (!thread) return;
        thread.innerHTML = '';
        if (!items || items.length === 0) {
            thread.innerHTML = '<div class="gantt-act-fs-empty">Aún no hay comentarios. Sé el primero en comentar.</div>';
            return;
        }
        items.forEach(function (c) {
            var ini = self._initialsOf(c.autor_nombre || '?');
            var bg = self._resAvatarColor ? self._resAvatarColor(c.autor_nombre || '?') : '#B45309';
            var fechaTxt = '';
            if (c.created_at) {
                try {
                    var d = new Date(c.created_at);
                    fechaTxt = d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
                } catch (e) { fechaTxt = c.created_at; }
            }
            var meta = el('div', { className: 'gantt-act-fs-comment-meta' }, [
                el('span', { className: 'gantt-act-fs-comment-author' }, [c.autor_nombre || '—']),
                el('span', { className: 'gantt-act-fs-comment-date' }, [fechaTxt])
            ]);
            var body = el('div', { className: 'gantt-act-fs-comment-body' }, [
                meta,
                el('div', { className: 'gantt-act-fs-comment-text' }, [c.texto || ''])
            ]);
            var children = [
                el('span', { className: 'gantt-act-fs-comment-avatar', style: { background: bg } }, [ini]),
                body
            ];
            // Botón borrar (best-effort; backend valida permiso)
            var delBtn = el('button', {
                className: 'gantt-act-fs-comment-delete',
                title: 'Eliminar',
                onClick: function () { self._deleteComment(c.id); }
            });
            delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
            children.push(delBtn);

            var card = el('div', { className: 'gantt-act-fs-comment' }, children);
            thread.appendChild(card);
        });
    };

    Gantt.prototype._postComment = function (texto) {
        var self = this;
        var taskId = window._proyGanttCurrentTaskId;
        if (!taskId || !texto) return;
        _fetch('/app/api/gantt/actividad/' + taskId + '/comentarios/', {
            method: 'POST',
            body: { texto: texto }
        }).then(function (resp) {
            if (resp && resp.success) {
                var input = document.getElementById('ganttActFsComentarioInput');
                if (input) input.value = '';
                self._fetchAndRenderComments(taskId);
            } else {
                alert((resp && resp.error) || 'No se pudo guardar el comentario');
            }
        }).catch(function () { alert('Error de red al guardar el comentario'); });
    };

    Gantt.prototype._deleteComment = function (commentId) {
        var self = this;
        if (!confirm('¿Eliminar este comentario?')) return;
        _fetch('/app/api/gantt/actividad/comentario/' + commentId + '/', { method: 'DELETE' })
            .then(function (resp) {
                if (resp && resp.success) {
                    var taskId = window._proyGanttCurrentTaskId;
                    if (taskId) self._fetchAndRenderComments(taskId);
                } else {
                    alert((resp && resp.error) || 'No se pudo eliminar');
                }
            }).catch(function () { alert('Error de red'); });
    };

    Gantt.prototype._fetchAndRenderArchivos = function (taskId) {
        var self = this;
        var list = document.getElementById('ganttActFsArchivosList');
        if (!list) return;
        list.innerHTML = '<div class="gantt-act-fs-empty">Cargando archivos…</div>';
        _fetch('/app/api/gantt/actividad/' + taskId + '/archivos/').then(function (resp) {
            if (!resp || !resp.success) {
                list.innerHTML = '<div class="gantt-act-fs-empty">Error al cargar archivos</div>';
                return;
            }
            self._renderArchivos(resp.items || []);
        }).catch(function () {
            list.innerHTML = '<div class="gantt-act-fs-empty">Error al cargar archivos</div>';
        });
    };

    Gantt.prototype._renderArchivos = function (items) {
        var self = this;
        var list = document.getElementById('ganttActFsArchivosList');
        if (!list) return;
        list.innerHTML = '';
        if (!items || items.length === 0) {
            list.innerHTML = '<div class="gantt-act-fs-empty">Aún no hay archivos. Súbelos arriba.</div>';
            return;
        }
        items.forEach(function (f) {
            var fechaTxt = '';
            if (f.created_at) {
                try {
                    var d = new Date(f.created_at);
                    fechaTxt = d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
                } catch (e) { fechaTxt = f.created_at; }
            }
            var icon = el('div', { className: 'gantt-act-fs-archivo-icon' });
            icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
            var info = el('div', { className: 'gantt-act-fs-archivo-info' }, [
                el('div', { className: 'gantt-act-fs-archivo-name' }, [f.nombre || '—']),
                el('div', { className: 'gantt-act-fs-archivo-meta' }, [
                    (f.autor_nombre || '—') + ' · ' + fechaTxt
                ])
            ]);
            var del = el('button', {
                className: 'gantt-act-fs-archivo-delete',
                title: 'Eliminar',
                onClick: function (ev) { ev.preventDefault(); ev.stopPropagation(); self._deleteArchivo(f.id); }
            });
            del.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
            var row = el('a', {
                className: 'gantt-act-fs-archivo',
                href: f.url || '#',
                target: '_blank',
                rel: 'noopener'
            }, [icon, info, del]);
            list.appendChild(row);
        });
    };

    Gantt.prototype._uploadArchivo = function (file) {
        var self = this;
        var taskId = window._proyGanttCurrentTaskId;
        if (!taskId || !file) return;
        var fd = new FormData();
        fd.append('archivo', file);
        fd.append('nombre', file.name || 'archivo');
        // Llamada directa con CSRF (el helper _fetch no maneja FormData de la forma que necesitamos sin Content-Type)
        var headers = { 'X-CSRFToken': _csrf() };
        fetch('/app/api/gantt/actividad/' + taskId + '/archivos/', {
            method: 'POST',
            headers: headers,
            credentials: 'same-origin',
            body: fd
        }).then(function (r) { return r.json(); }).then(function (resp) {
            if (resp && resp.success) {
                self._fetchAndRenderArchivos(taskId);
            } else {
                alert((resp && resp.error) || 'No se pudo subir el archivo');
            }
        }).catch(function () { alert('Error de red al subir el archivo'); });
    };

    Gantt.prototype._deleteArchivo = function (archivoId) {
        var self = this;
        if (!confirm('¿Eliminar este archivo?')) return;
        _fetch('/app/api/gantt/actividad/archivo/' + archivoId + '/', { method: 'DELETE' })
            .then(function (resp) {
                if (resp && resp.success) {
                    var taskId = window._proyGanttCurrentTaskId;
                    if (taskId) self._fetchAndRenderArchivos(taskId);
                } else {
                    alert((resp && resp.error) || 'No se pudo eliminar');
                }
            }).catch(function () { alert('Error de red'); });
    };

    /* ============================================================
       Sobre _parseData: hidratamos descripcion para que el drawer la
       muestre sin tener que disparar fetch extra cada vez.
       ============================================================ */
    var _origParseData = Gantt.prototype._parseData;
    Gantt.prototype._parseData = function (data) {
        _origParseData.call(this, data);
        var self = this;
        (data.actividades || []).forEach(function (a) {
            var local = self._taskById(a.id);
            if (local) {
                local.descripcion = a.descripcion || '';
                local.actividad_calendario_id = a.actividad_calendario_id || null;
                local._detalleHidratado = true;
            }
        });
    };

    /* ============================================================
       BRIDGES públicos para el HTML del template
       ============================================================ */
    function _currentInst() { return window._proyGanttCurrentInstance || null; }
    function _currentTaskId() { return window._proyGanttCurrentTaskId || null; }

    window.proyGanttCloseDrawer = function () {
        var inst = _currentInst();
        if (inst) inst._closeDrawer();
    };

    window.proyGanttDrawerToggleSection = function (key) {
        var sec = document.querySelector('.gantt-drawer-section[data-section="' + key + '"]');
        if (sec) sec.classList.toggle('is-collapsed');
    };

    window.proyGanttDrawerEditar = function () {
        var inst = _currentInst();
        var tid = _currentTaskId();
        if (!inst || !tid) return;
        // Si fullscreen de actividad está abierto, lo cerramos (el modal
        // de edición existe dentro del root del Gantt y debe verse encima).
        var fs = document.getElementById('ganttActFullscreen');
        if (fs && fs.classList.contains('is-open')) {
            inst._closeActivityFullscreen();
        }
        // Reusamos el modal existente del Gantt: _showResourceModal —
        // ese es el "modal de edición" actual del flujo dblclick.
        inst._showResourceModal(tid);
    };

    window.proyGanttDrawerFullscreen = function () {
        var inst = _currentInst();
        var tid = _currentTaskId();
        if (!inst || !tid) return;
        inst._openActivityFullscreen(tid);
    };

    window.proyGanttDrawerEliminar = function () {
        var inst = _currentInst();
        var tid = _currentTaskId();
        if (!inst || !tid) return;
        if (!confirm('¿Eliminar esta actividad?')) return;

        // Eliminar tanto local como en servidor. Reusa la lógica existente
        // pero forzando el id objetivo.
        inst.selectedTaskId = tid;
        inst._deleteSelected();
        inst._closeDrawer();
    };

    window.proyGanttDrawerOpenCalendar = function () {
        // Best-effort: si hay un módulo de calendario disponible, abrir
        // el detalle. Si no, simplemente hacer scroll/cerrar.
        var link = document.getElementById('ganttDrawerCalLink');
        var actId = link && link.dataset ? link.dataset.actividadId : null;
        if (actId && typeof window.proyectosVerActividadDetalle === 'function') {
            window.proyectosVerActividadDetalle(parseInt(actId, 10));
        }
    };

    window.proyGanttActFullscreenSetTab = function (name) {
        var inst = _currentInst();
        if (inst) inst._setActivityFullscreenTab(name);
    };

    window.proyGanttActFullscreenClose = function () {
        var inst = _currentInst();
        if (inst) inst._closeActivityFullscreen();
    };

    window.proyGanttActFullscreenEnviarComentario = function () {
        var inst = _currentInst();
        if (!inst) return;
        var input = document.getElementById('ganttActFsComentarioInput');
        var v = input ? (input.value || '').trim() : '';
        if (!v) { if (input) input.focus(); return; }
        inst._postComment(v);
    };

    window.proyGanttActFullscreenSubirArchivo = function (file) {
        var inst = _currentInst();
        if (inst && file) inst._uploadArchivo(file);
    };

    /* Bridges expuestos para uso programático externo (Mejora 2/3) */
    window._proyGanttOpenDrawer = function (taskId) {
        var inst = _currentInst();
        if (inst) inst._openDrawer(taskId);
    };
    window._proyActividadFullscreenOpen = function (taskId) {
        var inst = _currentInst();
        if (inst) inst._openActivityFullscreen(taskId);
    };
    window._proyActividadFullscreenClose = function () {
        var inst = _currentInst();
        if (inst) inst._closeActivityFullscreen();
    };
    window._proyGanttFullscreenToggle = function () {
        var inst = _currentInst();
        if (inst) inst._toggleFullscreen();
    };
    window._proyGanttCloseDrawer = function () {
        var inst = _currentInst();
        if (inst) inst._closeDrawer();
    };

    /* ===========================================
       GLOBAL INIT FUNCTION
       =========================================== */
    window.initGanttProgramaObra = function (containerId, proyectoId) {
        var inst = new Gantt(containerId, proyectoId);
        window._proyGanttCurrentInstance = inst;
        return inst;
    };

})();
