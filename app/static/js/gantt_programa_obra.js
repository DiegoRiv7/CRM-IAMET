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
    var ROW_H  = 36;
    var BAR_H  = 20;
    var BAR_Y  = 8;
    var EDGE   = 8;      // zona de resize en bordes de barra
    var HEADER_H = 48;   // alto del header de fechas

    var COLOR_PRIMARY  = '#0052D4';
    var COLOR_DARK     = '#1D1D1F';
    var COLOR_LIGHT    = '#F9FAFB';
    var COLOR_BORDER   = '#E5E7EB';
    var COLOR_HEADER   = '#F8FAFC';
    var COLOR_GRAY     = '#94a3b8';
    var COLOR_BLUE     = '#3b82f6';
    var COLOR_GREEN    = '#16a34a';
    var COLOR_BLACK    = '#1D1D1F';
    var COLOR_SEL      = '#dbeafe';

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

        // -- Main wrapper (table + canvas side by side)
        var main = el('div', { className: 'gantt-main' });
        this.root.appendChild(main);

        // -- Left: Table
        var tablePanel = el('div', { className: 'gantt-table-panel' });
        main.appendChild(tablePanel);

        // table header
        var thead = el('div', { className: 'gantt-table-header' }, [
            el('div', { className: 'gantt-th gantt-th-name' }, ['Nombre']),
            el('div', { className: 'gantt-th gantt-th-dur' }, ['Dur.']),
            el('div', { className: 'gantt-th gantt-th-prog' }, ['%']),
            el('div', { className: 'gantt-th gantt-th-res' }, ['Rec.'])
        ]);
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
        this.canvas.addEventListener('mouseleave', function () { self._hideTooltip(); });
        document.addEventListener('mousemove', function (e) { self._onDocMouseMove(e); });
        document.addEventListener('mouseup', function (e) { self._onMouseUp(e); });
    };

    /* -------------------------------------------
       INJECT SCOPED STYLES
       ------------------------------------------- */
    Gantt.prototype._injectStyles = function () {
        if (document.getElementById('gantt-obra-styles')) return;
        var css = [
            '.gantt-root { font-family: inherit; color: ' + COLOR_DARK + '; font-size: 13px; display: flex; flex-direction: column; height: calc(100vh - 320px); min-height: 350px; background: #fff; border: 1px solid ' + COLOR_BORDER + '; border-radius: 10px; overflow: hidden; }',

            /* Toolbar — compacta y limpia */
            '.gantt-toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: #fff; border-bottom: 1px solid ' + COLOR_BORDER + '; }',
            '.gantt-btn { padding: 5px 12px; border: 1px solid ' + COLOR_BORDER + '; border-radius: 6px; background: #fff; cursor: pointer; font-size: 0.75rem; font-weight: 600; color: ' + COLOR_DARK + '; transition: all .15s; white-space: nowrap; font-family: inherit; }',
            '.gantt-btn:hover { background: #f1f5f9; border-color: #cbd5e1; }',
            '.gantt-btn-primary { background: ' + COLOR_PRIMARY + '; color: #fff; border-color: ' + COLOR_PRIMARY + '; font-size: 0.75rem; }',
            '.gantt-btn-primary:hover { background: #003fa3; }',
            '.gantt-btn-danger { color: #dc2626; border-color: #fecaca; font-size: 0.75rem; }',
            '.gantt-btn-danger:hover { background: #fef2f2; }',
            /* Zoom segmented control */
            '.gantt-zoom-group { display: flex; border: 1px solid ' + COLOR_BORDER + '; border-radius: 6px; overflow: hidden; }',
            '.gantt-zoom-btn { padding: 4px 10px; border: none; background: #fff; cursor: pointer; font-size: 0.7rem; font-weight: 700; color: #64748b; transition: all .12s; font-family: inherit; border-right: 1px solid ' + COLOR_BORDER + '; }',
            '.gantt-zoom-btn:last-child { border-right: none; }',
            '.gantt-zoom-btn:hover { background: #f1f5f9; }',
            '.gantt-zoom-btn.active { background: ' + COLOR_PRIMARY + '; color: #fff; }',
            /* Empty state */
            '.gantt-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; color: #94a3b8; gap: 12px; padding: 40px; }',
            '.gantt-empty-icon { width: 48px; height: 48px; border-radius: 12px; background: #f1f5f9; display: flex; align-items: center; justify-content: center; }',
            '.gantt-empty-text { font-size: 0.85rem; font-weight: 500; }',
            '.gantt-empty-sub { font-size: 0.75rem; color: #cbd5e1; }',

            /* Main */
            '.gantt-main { display: flex; flex: 1; overflow: hidden; min-height: 0; }',

            /* Table panel */
            '.gantt-table-panel { width: 30%; min-width: 220px; max-width: 400px; display: flex; flex-direction: column; border-right: 2px solid ' + COLOR_BORDER + '; }',
            '.gantt-table-header { display: flex; height: ' + HEADER_H + 'px; background: ' + COLOR_HEADER + '; border-bottom: 1px solid ' + COLOR_BORDER + '; align-items: flex-end; padding-bottom: 4px; }',
            '.gantt-th { font-weight: 600; font-size: 11px; text-transform: uppercase; color: #64748b; padding: 0 6px; }',
            '.gantt-th-name { flex: 1; }',
            '.gantt-th-dur { width: 40px; text-align: center; }',
            '.gantt-th-prog { width: 40px; text-align: center; }',
            '.gantt-th-res { width: 36px; text-align: center; }',
            '.gantt-table-body-wrap { flex: 1; overflow-y: auto; overflow-x: hidden; }',
            '.gantt-table-body-wrap::-webkit-scrollbar { display: none; }',
            '.gantt-table-body { }',

            /* Table row */
            '.gantt-row { display: flex; align-items: center; height: ' + ROW_H + 'px; border-bottom: 1px solid #f1f5f9; cursor: pointer; padding: 0 4px; transition: background .1s; }',
            '.gantt-row:hover { background: #f8fafc; }',
            '.gantt-row.selected { background: ' + COLOR_SEL + '; }',
            '.gantt-row-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 4px; }',
            '.gantt-row-dur { width: 40px; text-align: center; font-size: 12px; color: #64748b; }',
            '.gantt-row-prog { width: 40px; text-align: center; font-size: 12px; color: #64748b; }',
            '.gantt-row-res { width: 36px; text-align: center; font-size: 12px; }',
            '.gantt-phase-name { font-weight: 600; }',
            '.gantt-toggle { cursor: pointer; width: 16px; font-size: 10px; color: #94a3b8; user-select: none; flex-shrink: 0; }',
            '.gantt-indent { display: inline-block; width: 20px; flex-shrink: 0; }',
            '.gantt-res-badge { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 4px; font-size: 10px; font-weight: 600; color: #94a3b8; background: transparent; cursor: pointer; }',
            '.gantt-res-badge.has-res { color: ' + COLOR_PRIMARY + '; background: #EFF6FF; }',

            /* Canvas panel */
            '.gantt-canvas-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; }',
            '.gantt-canvas-header-wrap { height: ' + HEADER_H + 'px; overflow: hidden; background: ' + COLOR_HEADER + '; border-bottom: 1px solid ' + COLOR_BORDER + '; }',
            '.gantt-header-canvas { display: block; }',
            '.gantt-canvas-wrap { flex: 1; overflow: auto; position: relative; }',
            '.gantt-canvas-wrap::-webkit-scrollbar { height: 8px; width: 8px; }',
            '.gantt-canvas-wrap::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }',
            '.gantt-canvas { display: block; }',

            /* Tooltip */
            '.gantt-tooltip { position: absolute; z-index: 100; background: #fff; border: 1px solid ' + COLOR_BORDER + '; border-radius: 8px; padding: 10px 14px; font-size: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.12); pointer-events: none; max-width: 280px; line-height: 1.5; }',
            '.gantt-tooltip-title { font-weight: 600; margin-bottom: 4px; }',
            '.gantt-tooltip-row { color: #64748b; }',
            '.gantt-tooltip-row span { color: ' + COLOR_DARK + '; font-weight: 500; }',

            /* Modal */
            '.gantt-modal-overlay { position: absolute; inset: 0; background: rgba(0,0,0,.35); z-index: 200; display: flex; align-items: center; justify-content: center; }',
            '.gantt-modal { background: #fff; border-radius: 12px; padding: 24px 28px; width: 420px; max-width: 95%; box-shadow: 0 8px 32px rgba(0,0,0,.18); }',
            '.gantt-modal h3 { margin: 0 0 16px; font-size: 16px; font-weight: 600; }',
            '.gantt-modal-field { margin-bottom: 12px; }',
            '.gantt-modal-field label { display: block; font-size: 12px; font-weight: 500; color: #64748b; margin-bottom: 4px; }',
            '.gantt-modal-field input, .gantt-modal-field select { width: 100%; padding: 7px 10px; border: 1px solid ' + COLOR_BORDER + '; border-radius: 6px; font-size: 13px; box-sizing: border-box; }',
            '.gantt-modal-field input:focus, .gantt-modal-field select:focus { outline: none; border-color: ' + COLOR_PRIMARY + '; box-shadow: 0 0 0 2px rgba(0,82,212,.15); }',
            '.gantt-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }',
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

        return el('div', { className: 'gantt-toolbar' }, [btnAdd, this._btnDel, this._btnToggleFases, spacer, zoomGroup]);
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
            t.children.forEach(function (cid) {
                var c = self._taskById(cid);
                if (!c) return;
                if (c.start < minStart) minStart = c.start;
                if (c.start + c.dur > maxEnd) maxEnd = c.start + c.dur;
                totalProg += c.progress;
                count++;
            });
            if (count > 0) {
                t.start = minStart;
                t.dur = maxEnd - minStart;
                t.progress = Math.round(totalProg / count);
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
        var realTasks = this.tasks.filter(function(t) { return !t.isPhase; });
        var emptyEl = this.root.querySelector('.gantt-empty');
        var mainEl = this.root.querySelector('.gantt-main');
        if (realTasks.length === 0 && this.tasks.length === 0) {
            if (mainEl) mainEl.style.display = 'none';
            if (!emptyEl) {
                emptyEl = el('div', { className: 'gantt-empty' }, [
                    el('div', { className: 'gantt-empty-icon' }, [
                        el('svg', { width: '24', height: '24', fill: 'none', stroke: '#94a3b8', 'stroke-width': '1.5', viewBox: '0 0 24 24' })
                    ]),
                    el('div', { className: 'gantt-empty-text' }, ['Sin actividades en el cronograma']),
                    el('div', { className: 'gantt-empty-sub' }, ['Usa el boton + Actividad para comenzar'])
                ]);
                // Inject a simple icon into the SVG
                emptyEl.querySelector('svg').innerHTML = '<rect x="3" y="4" width="18" height="18" rx="2" stroke-linecap="round"/><path d="M16 2v4M8 2v4M3 10h18" stroke-linecap="round"/>';
                this.root.appendChild(emptyEl);
            } else {
                emptyEl.style.display = 'flex';
            }
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

            // Name cell
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
                nameCell.appendChild(el('span', { className: 'gantt-indent' }));
                nameCell.appendChild(document.createTextNode(t.name));
            }
            row.appendChild(nameCell);

            // Duration
            row.appendChild(el('div', { className: 'gantt-row-dur' }, [t.isPhase ? '' : String(t.dur)]));

            // Progress
            row.appendChild(el('div', { className: 'gantt-row-prog' }, [t.progress + '%']));

            // Resources
            var resCount = t.res ? t.res.length : 0;
            var badge = el('span', {
                className: 'gantt-res-badge' + (resCount > 0 ? ' has-res' : ''),
                onClick: function (e) {
                    e.stopPropagation();
                    self._showResourceModal(t.id);
                }
            }, [resCount > 0 ? String(resCount) : '—']);
            row.appendChild(el('div', { className: 'gantt-row-res' }, [badge]));

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

        ctx.fillStyle = COLOR_HEADER;
        ctx.fillRect(0, 0, w, HEADER_H);

        var colW = this.colW;
        var start = this.projectStart;

        // Row 1: week/month labels
        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';

        if (this.zoom === 'month') {
            // month-level: show month labels
            var prevMonth = -1;
            for (var d = 0; d < this.totalDays; d++) {
                var dt = addDays(start, d);
                var m = dt.getMonth();
                if (m !== prevMonth) {
                    prevMonth = m;
                    ctx.fillText(MONTH_NAMES[m] + ' ' + dt.getFullYear(), d * colW + 4, 16);
                }
            }
        } else {
            // week-level
            var prevWeek = -1;
            for (var d = 0; d < this.totalDays; d++) {
                var dt = addDays(start, d);
                var weekNum = Math.floor(d / 7);
                if (weekNum !== prevWeek) {
                    prevWeek = weekNum;
                    var wEnd = addDays(dt, 6);
                    var label = dt.getDate() + ' ' + MONTH_NAMES[dt.getMonth()] + ' - ' + wEnd.getDate() + ' ' + MONTH_NAMES[wEnd.getMonth()];
                    ctx.fillText(label, d * colW + 4, 16);
                }
            }
        }

        // Row 2: day numbers (only if zoom is day or week)
        if (this.zoom !== 'month') {
            ctx.font = '400 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            for (var d = 0; d < this.totalDays; d++) {
                var dt = addDays(start, d);
                var isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
                ctx.fillStyle = isWeekend ? '#cbd5e1' : '#64748b';
                var x = d * colW + colW / 2;
                ctx.fillText(String(dt.getDate()), x, 36);

                // Show day name letter for day zoom
                if (this.zoom === 'day') {
                    ctx.fillStyle = isWeekend ? '#cbd5e1' : '#94a3b8';
                    ctx.fillText(DAY_NAMES_SHORT[dt.getDay()], x, 46);
                }
            }
        }

        // Vertical gridlines
        ctx.strokeStyle = '#f1f5f9';
        ctx.lineWidth = 1;
        for (var d = 0; d <= this.totalDays; d++) {
            var x = d * colW;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, HEADER_H);
            ctx.stroke();
        }

        // Bottom border
        ctx.strokeStyle = COLOR_BORDER;
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

        // Background
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cw, ch);

        // Weekend columns
        for (var d = 0; d < this.totalDays; d++) {
            var dt = addDays(this.projectStart, d);
            if (dt.getDay() === 0 || dt.getDay() === 6) {
                ctx.fillStyle = '#fafbfc';
                ctx.fillRect(d * colW, 0, colW, ch);
            }
        }

        // Vertical gridlines
        ctx.strokeStyle = '#f1f5f9';
        ctx.lineWidth = 1;
        for (var d = 0; d <= this.totalDays; d++) {
            ctx.beginPath();
            ctx.moveTo(d * colW + 0.5, 0);
            ctx.lineTo(d * colW + 0.5, ch);
            ctx.stroke();
        }

        // Horizontal gridlines
        for (var i = 0; i <= visible.length; i++) {
            ctx.beginPath();
            ctx.moveTo(0, i * ROW_H + 0.5);
            ctx.lineTo(cw, i * ROW_H + 0.5);
            ctx.stroke();
        }

        // Today line
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var todayDay = daysBetween(this.projectStart, today);
        if (todayDay >= 0 && todayDay < this.totalDays) {
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            var tx = todayDay * colW + colW / 2;
            ctx.moveTo(tx, 0);
            ctx.lineTo(tx, ch);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Selected row highlight
        var self = this;
        visible.forEach(function (t, idx) {
            if (self.selectedTaskId === t.id) {
                ctx.fillStyle = COLOR_SEL;
                ctx.fillRect(0, idx * ROW_H, cw, ROW_H);
            }
        });

        // Bars
        visible.forEach(function (t, idx) {
            var y = idx * ROW_H + BAR_Y;
            var x = t.start * colW;
            var w = t.dur * colW;

            if (t.isPhase) {
                self._drawPhaseSummaryBar(ctx, x, y, w, idx);
            } else {
                self._drawActivityBar(ctx, t, x, y, w);
            }
        });
    };

    Gantt.prototype._drawPhaseSummaryBar = function (ctx, x, y, w, rowIdx) {
        var h = 8;
        var yy = y + (BAR_H - h) / 2;

        // Main bar
        ctx.fillStyle = COLOR_BLACK;
        ctx.fillRect(x, yy, w, h);

        // Left bracket
        ctx.fillRect(x, yy, 3, BAR_H);
        // Right bracket
        ctx.fillRect(x + w - 3, yy, 3, BAR_H);

        // Small diamond at each end
        var dSize = 5;
        ctx.beginPath();
        ctx.moveTo(x, yy + h);
        ctx.lineTo(x + dSize, yy + h + dSize);
        ctx.lineTo(x, yy + h + dSize * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(x + w, yy + h);
        ctx.lineTo(x + w - dSize, yy + h + dSize);
        ctx.lineTo(x + w, yy + h + dSize * 2);
        ctx.fill();
    };

    Gantt.prototype._drawActivityBar = function (ctx, t, x, y, w) {
        var prog = t.progress || 0;
        var bgColor, fgColor;

        if (prog >= 100) {
            bgColor = '#dcfce7';
            fgColor = COLOR_GREEN;
        } else if (prog > 0) {
            bgColor = '#e2e8f0';
            fgColor = COLOR_BLUE;
        } else {
            bgColor = '#e2e8f0';
            fgColor = COLOR_GRAY;
        }

        // Background bar
        ctx.fillStyle = bgColor;
        ctx.beginPath();
        this._roundRect(ctx, x + 1, y, w - 2, BAR_H, 4);
        ctx.fill();

        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.06)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        // Progress fill
        if (prog > 0 && prog < 100) {
            var pw = Math.max(4, (w - 2) * prog / 100);
            ctx.fillStyle = fgColor;
            ctx.beginPath();
            // Clip left side with radius, right side squared if partial
            ctx.save();
            ctx.beginPath();
            this._roundRect(ctx, x + 1, y, w - 2, BAR_H, 4);
            ctx.clip();
            ctx.fillRect(x + 1, y, pw, BAR_H);
            ctx.restore();
        }

        // Border
        ctx.strokeStyle = prog === 0 ? '#8596a8' : (prog >= 100 ? '#15803d' : '#3577d4');
        ctx.lineWidth = 1;
        ctx.beginPath();
        this._roundRect(ctx, x + 1, y, w - 2, BAR_H, 4);
        ctx.stroke();

        // Text: percentage
        var text = prog + '%';
        ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        var tm = ctx.measureText(text);
        if (tm.width + 8 < w) {
            ctx.fillStyle = (prog === 0 || prog >= 100) ? '#fff' : COLOR_DARK;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x + w / 2, y + BAR_H / 2 + 1);
        }
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

        // Add arrowhead marker
        var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'gantt-arrowhead');
        marker.setAttribute('markerWidth', '8');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('refX', '8');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', '0 0, 8 3, 0 6');
        poly.setAttribute('fill', '#94a3b8');
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

                // Path: right, down/up, then right to target
                var midX = x1 + 12;
                var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                var d = 'M' + x1 + ',' + y1 +
                    ' L' + midX + ',' + y1 +
                    ' L' + midX + ',' + y2 +
                    ' L' + x2 + ',' + y2;
                path.setAttribute('d', d);
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', '#94a3b8');
                path.setAttribute('stroke-width', '1.5');
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
            this._hideTooltip();
            this._hoveredTaskId = null;
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

        // Tooltip
        if (this._hoveredTaskId !== hit.task.id) {
            this._hoveredTaskId = hit.task.id;
            this._showTooltip(hit.task, e);
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

            var resNames = '';
            if (t.res && t.res.length > 0) {
                var names = [];
                t.res.forEach(function (rid) {
                    var r = self.resources.find(function (x) { return x.id === rid; });
                    names.push(r ? r.name || r.nombre : rid);
                });
                resNames = names.join(', ');
            }

            self.tooltip.innerHTML = '';
            self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-title' }, [t.name]));
            self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-row' }, ['Inicio: ', el('span', {}, [dateStr(startDate)])]));
            self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-row' }, ['Fin: ', el('span', {}, [dateStr(endDate)])]));
            self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-row' }, ['Duracion: ', el('span', {}, [t.dur + ' dias'])]));
            self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-row' }, ['Progreso: ', el('span', {}, [t.progress + '%'])]));
            if (t.cost) self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-row' }, ['Costo: ', el('span', {}, [fmtMoney(t.cost)])]));
            if (t.income) self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-row' }, ['Ingreso: ', el('span', {}, [fmtMoney(t.income)])]));
            if (resNames) self.tooltip.appendChild(el('div', { className: 'gantt-tooltip-row' }, ['Recursos: ', el('span', {}, [resNames])]));

            // Position tooltip near mouse but within root bounds
            var rootRect = self.root.getBoundingClientRect();
            var tx = e.clientX - rootRect.left + 16;
            var ty = e.clientY - rootRect.top + 16;

            // Clamp to root bounds
            self.tooltip.style.display = 'block';
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
        _fetch('/app/api/gantt/actividad/' + t.id + '/', {
            method: 'PUT',
            body: {
                fecha_inicio: dateStr(startDate),
                duracion: t.dur,
                progreso: t.progress,
                costo_estimado: t.cost,
                ingreso_estimado: t.income,
                dependencias: t.deps,
                recursos: t.res
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
            self._zoomBtns[k].className = 'gantt-btn' + (k === z ? ' active' : '');
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
    Gantt.prototype._showResourceModal = function (taskId) {
        var self = this;
        var t = this._taskById(taskId);
        if (!t) return;

        this.modal.style.display = 'flex';

        var checkboxes = [];
        var resList = el('div', { style: { maxHeight: '240px', overflowY: 'auto', margin: '8px 0' } });

        if (this.resources.length === 0) {
            resList.appendChild(el('div', { style: { color: '#94a3b8', padding: '12px 0', textAlign: 'center' } }, ['No hay recursos disponibles']));
        } else {
            this.resources.forEach(function (r) {
                var rid = r.id || r.nombre;
                var checked = t.res && t.res.indexOf(rid) !== -1;
                var cb = el('input', { type: 'checkbox', id: 'gantt-res-' + rid });
                if (checked) cb.checked = true;
                checkboxes.push({ el: cb, id: rid });

                var row = el('label', {
                    style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }
                }, [
                    cb,
                    el('span', { style: { fontWeight: '500' } }, [r.name || r.nombre || rid]),
                    el('span', { style: { color: '#94a3b8', fontSize: '11px', marginLeft: 'auto' } }, [r.role || r.cargo || ''])
                ]);
                resList.appendChild(row);
            });
        }

        var card = el('div', { className: 'gantt-modal' }, [
            el('h3', {}, ['Asignar Recursos: ' + t.name]),
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
                } }, ['Guardar Asignacion'])
            ])
        ]);

        this.modal.innerHTML = '';
        this.modal.appendChild(card);

        this.modal.onclick = function (e) {
            if (e.target === self.modal) self._closeModal();
        };
    };

    /* ===========================================
       GLOBAL INIT FUNCTION
       =========================================== */
    window.initGanttProgramaObra = function (containerId, proyectoId) {
        return new Gantt(containerId, proyectoId);
    };

})();
