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

        return el('div', { className: 'gantt-toolbar' }, [btnAdd, this._btnDel, this._btnToggleFases, this._btnFinancial, spacer, zoomGroup]);
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
                var ctaBtn = el('button', {
                    className: 'gantt-btn gantt-btn-primary',
                    style: { marginTop: '8px', padding: '8px 20px', fontSize: '0.85rem' },
                    onClick: function () { self._showAddModal(); }
                }, ['+ Agregar primera actividad']);
                emptyEl = el('div', { className: 'gantt-empty' }, [
                    el('div', { className: 'gantt-empty-icon' }, [
                        el('svg', { width: '32', height: '32', fill: 'none', stroke: COLOR_TEXT_MUTED, 'stroke-width': '1.5', viewBox: '0 0 24 24' })
                    ]),
                    el('div', { className: 'gantt-empty-text' }, ['Comienza tu programa de obra']),
                    el('div', { className: 'gantt-empty-sub' }, ['Agrega actividades para visualizar el cronograma del proyecto']),
                    ctaBtn
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
            var row = el('div', {
                className: 'gantt-row' + (self.selectedTaskId === t.id ? ' selected' : ''),
                onClick: function (e) {
                    // don't select if clicking toggle
                    if (e.target.classList.contains('gantt-toggle')) return;
                    self.selectedTaskId = t.id;
                    self._render();
                }
            });

            // Name cell — full width
            var nameCell = el('div', { className: 'gantt-row-name' });

            if (t.isPhase) {
                var toggle = el('span', {
                    className: 'gantt-toggle',
                    onClick: function (e) {
                        e.stopPropagation();
                        t.collapsed = !t.collapsed;
                        self._render();
                    }
                }, [t.collapsed ? '\u25B6' : '\u25BC']);
                nameCell.appendChild(toggle);
                var span = el('span', { className: 'gantt-phase-name' }, [t.name]);
                nameCell.appendChild(span);
            } else {
                if (t.parent) {
                    nameCell.appendChild(el('span', { className: 'gantt-indent' }));
                }
                var nameSpan = el('span', {}, [t.name]);
                nameCell.appendChild(nameSpan);

                // Inline edit on double-click
                (function (task, spanEl, cell) {
                    spanEl.addEventListener('dblclick', function (e) {
                        e.stopPropagation();
                        self._startInlineEdit(task, spanEl, cell);
                    });
                })(t, nameSpan, nameCell);

                // Hover badges: duration + progress
                var badges = el('div', { className: 'gantt-row-badges' });
                badges.appendChild(el('span', { className: 'gantt-badge' }, [t.dur + 'd']));
                var progClass = 'gantt-badge gantt-badge-prog';
                badges.appendChild(el('span', { className: progClass }, [t.progress + '%']));
                nameCell.appendChild(badges);
            }
            row.appendChild(nameCell);

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

        if (pos.x >= barX && pos.x <= barX + barW && pos.y >= barY && pos.y <= barY + BAR_H) {
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

        if (hit.zone === 'left') {
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
        var delta = Math.round((mx - this.dragState.startX) / this.colW);
        var t = this._taskById(this.dragState.taskId);
        if (!t) return;

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

    Gantt.prototype._onMouseUp = function (e) {
        if (!this.dragState) return;

        var taskId = this.dragState.taskId;
        var t = this._taskById(taskId);
        this.dragState = null;

        if (t) {
            // Persist to server
            this._persistTask(t);
            // Also cascade on server
            _fetch('/app/api/gantt/actividad/' + taskId + '/cascada/', { method: 'POST', body: {} }).catch(function () {});
        }

        this._render();
    };

    Gantt.prototype._onMouseMove = function (e) {
        if (this.dragState) return; // cursor handled in doc mousemove

        var pos = this._getCanvasPos(e);
        var hit = this._hitTest(pos);

        if (!hit) {
            this.canvas.style.cursor = 'default';
            if (this._hoveredTaskId !== null) {
                this._hoveredTaskId = null;
                this._renderCanvas(); // re-render to remove hover effect
            }
            this._hideTooltip();
            return;
        }

        // Cursor
        if (hit.task.isPhase) {
            this.canvas.style.cursor = 'default';
        } else if (hit.zone === 'left' || hit.zone === 'right') {
            this.canvas.style.cursor = 'ew-resize';
        } else {
            this.canvas.style.cursor = 'grab';
        }

        // Tooltip + hover effect on bar
        if (this._hoveredTaskId !== hit.task.id) {
            this._hoveredTaskId = hit.task.id;
            this._showTooltip(hit.task, e);
            this._renderCanvas(); // re-render to apply hover shadow
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
        var startDate = addDays(this.projectStart, t.start);
        // Normalize recursos to plain IDs
        var resIds = (t.res || []).map(function (r) {
            return typeof r === 'object' ? r.id : r;
        });
        _fetch('/app/api/gantt/actividad/' + t.id + '/', {
            method: 'PUT',
            body: {
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
       INLINE EDIT (double-click on name in table)
       ------------------------------------------- */
    Gantt.prototype._startInlineEdit = function (task, spanEl, cell) {
        var self = this;
        var oldName = task.name;

        // Hide the span
        spanEl.style.display = 'none';

        var input = el('input', {
            type: 'text',
            className: 'gantt-inline-input',
            value: oldName
        });

        // Find the indent span and insert after it
        cell.appendChild(input);

        var done = false;
        var finish = function (save) {
            if (done) return;
            done = true;
            var newName = input.value.trim();
            if (save && newName && newName !== oldName) {
                task.name = newName;
                spanEl.textContent = newName;
                self._persistTask(task);
            }
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

    /* ===========================================
       GLOBAL INIT FUNCTION
       =========================================== */
    window.initGanttProgramaObra = function (containerId, proyectoId) {
        return new Gantt(containerId, proyectoId);
    };

})();
