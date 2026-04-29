// ═══════════════════════════════════════════════════════════════
//  WIZARD DE LEVANTAMIENTO — 5 fases con auto-save
//  Expone: window.levantamientoWizardOpen(levData)
//          window.levantamientoWizardClose()
// ═══════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── Estado global del wizard ─────────────────────────────
    var state = {
        lev: null,          // objeto levantamiento completo del backend
        phase: 1,           // fase activa (1-5)
        dirty: false,       // hay cambios sin guardar
        saveTimer: null,    // debounce timer
    };

    var SERVICIOS   = ['CCTV', 'Alarma Intrusión', 'Control de Acceso', 'Cableado Estructurado', 'Voceo', 'Telefonía', 'Otros'];
    // Lista ampliada según el Formato de Levantamiento en Sitio (Bajanet docx)
    var COMPONENTES = [
        'Cámara IP', 'Cámara Analógica', 'NVR', 'DVR', 'Video Balum',
        'Tubería', 'Canalización', 'Escalerilla',
        'Cable Cat5e', 'Cable Cat6', 'Cable Cat6A', 'Fibra Óptica',
        'Gabinete/Rack', 'Serpentines', 'Controladora',
        'PBX', 'Teléfonos', 'Work Station', 'Servidor', 'Switches',
        'Antenas', 'Enlaces', 'Bocinas', 'Cableado',
        'Fuentes de Poder', 'Amplificadores', 'Access Point', 'UPS',
    ];

    // Mapa: qué componentes son relevantes para cada servicio.
    // Si no hay servicios seleccionados, se muestran todos (fallback).
    // Si el usuario marca "Otros", también se muestran todos.
    var SERVICIO_COMPONENTES = {
        'CCTV':                  ['Cámara IP', 'Cámara Analógica', 'NVR', 'DVR', 'Video Balum', 'Tubería', 'Canalización', 'Escalerilla', 'Cable Cat6', 'Cable Cat6A', 'Fibra Óptica', 'Gabinete/Rack', 'Switches', 'UPS', 'Fuentes de Poder'],
        'Alarma Intrusión':      ['Cable Cat5e', 'Cable Cat6', 'Tubería', 'Canalización', 'Controladora', 'Gabinete/Rack', 'Fuentes de Poder', 'UPS'],
        'Control de Acceso':     ['Controladora', 'Cable Cat6', 'Tubería', 'Canalización', 'Gabinete/Rack', 'Switches', 'UPS', 'Fuentes de Poder'],
        'Cableado Estructurado': ['Tubería', 'Canalización', 'Escalerilla', 'Cable Cat5e', 'Cable Cat6', 'Cable Cat6A', 'Fibra Óptica', 'Gabinete/Rack', 'Switches', 'Access Point', 'Work Station', 'Servidor'],
        'Voceo':                 ['Bocinas', 'Amplificadores', 'Cableado', 'Tubería', 'Canalización', 'Gabinete/Rack', 'UPS', 'Fuentes de Poder'],
        'Telefonía':             ['PBX', 'Teléfonos', 'Switches', 'Cable Cat5e', 'Cable Cat6', 'Access Point', 'UPS', 'Fuentes de Poder'],
        'Otros':                 null, // null = todos
    };

    // Demo catalog (fallback si el endpoint real no devuelve nada)
    var DEMO_CATALOG = [
        { id: 'D001', desc: 'Cámara IP Domo 4MP IR 30m',     marca: 'Hikvision', modelo: 'DS-2CD2347G2-LU', unidad: 'PZA', precio: 2850 },
        { id: 'D002', desc: 'NVR 32 canales 4K H.265+',       marca: 'Hikvision', modelo: 'DS-7732NI-I4/16P', unidad: 'PZA', precio: 18500 },
        { id: 'D003', desc: 'Cable UTP Cat6 CCA 305m',        marca: 'Belden',    modelo: '1700A',           unidad: 'BOB', precio: 890 },
        { id: 'D004', desc: 'Switch PoE 24 puertos Gigabit',  marca: 'TP-Link',   modelo: 'TL-SG1224PE',     unidad: 'PZA', precio: 5400 },
        { id: 'D005', desc: 'Gabinete Rack 12U Pared',        marca: 'Linkedpro', modelo: 'LP-GB-12U-W',     unidad: 'PZA', precio: 3200 },
    ];

    var STATUS_CONFIG = {
        borrador:   { label: 'Borrador',    color: '#B45309', dot: '#F59E0B' },
        revision:   { label: 'En Revisión', color: '#1D4ED8', dot: '#3B82F6' },
        aprobado:   { label: 'Aprobado',    color: '#166534', dot: '#10B981' },
        rechazado:  { label: 'Rechazado',   color: '#991B1B', dot: '#EF4444' },
        ejecutando: { label: 'Ejecutando',  color: '#1D4ED8', dot: '#2563EB' },
        completado: { label: 'Completado',  color: '#166534', dot: '#059669' },
    };

    // ── Helpers ──────────────────────────────────────────────
    function $(id) { return document.getElementById(id); }
    function esc(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }
    function fmtMoney(n) {
        return '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
    function getCsrf() {
        var el = document.querySelector('[name=csrfmiddlewaretoken]');
        return el ? el.value : '';
    }
    function apiFetch(url, options) {
        options = options || {};
        options.credentials = 'same-origin';
        options.headers = options.headers || {};
        options.headers['X-CSRFToken'] = getCsrf();
        options.headers['X-Requested-With'] = 'XMLHttpRequest';
        return fetch(url, options).then(function (r) { return r.json(); });
    }

    // ── Open / Close ─────────────────────────────────────────
    // opts.puedeEditar (default true): si false, abrimos en modo SOLO LECTURA
    // (vendedores). En lectura los inputs van disabled, los botones que mutan
    // se ocultan y la fase activa se fuerza a la última fase con datos.
    window.levantamientoWizardOpen = function (levData, opts) {
        if (!levData) return;
        opts = opts || {};
        state.lev = JSON.parse(JSON.stringify(levData)); // deep copy
        state.phase = Math.max(1, Math.min(5, levData.fase_actual || 1));
        state.dirty = false;
        state.readonly = (opts.puedeEditar === false);

        var ov = $('levantamientoWizard');
        if (!ov) return;
        ov.style.display = 'flex';
        ov.classList.toggle('lw-readonly', state.readonly);
        document.body.style.overflow = 'hidden';
        _lwRestoreMode(); // aplica clase lw-mode-simple/full desde localStorage
        _lwRestoreSidebar(); // aplica estado lw-sidebar-hidden desde localStorage
        renderHeader();
        renderPhaseTabs();
        renderPhase(state.phase);
        // En modo lectura, marcar todos los inputs/textareas como readonly
        // tras el render inicial. Cada renderPhase también vuelve a aplicar.
        if (state.readonly) _lwApplyReadonlyToInputs();
    };

    // Aplica readonly/disabled a todos los inputs del wizard. Se llama
    // después de cada renderPhase para que afecte también a los campos
    // creados dinámicamente.
    function _lwApplyReadonlyToInputs() {
        var ov = document.getElementById('levantamientoWizard');
        if (!ov || !ov.classList.contains('lw-readonly')) return;
        var inputs = ov.querySelectorAll('input, textarea, select');
        Array.prototype.forEach.call(inputs, function (i) {
            if (i.type === 'file' || i.type === 'checkbox' || i.type === 'radio') {
                i.disabled = true;
            } else if (i.tagName === 'SELECT') {
                i.disabled = true;
            } else {
                i.readOnly = true;
            }
        });
    }

    function _doCloseWizard() {
        var d = (state.lev && state.lev.fase1_data) || {};
        var haveName = !!(state.lev && (state.lev.nombre || '').trim());
        var haveProducts = ((d.productos || []).length > 0);
        var wasReadonly = !!state.readonly;
        var ov = $('levantamientoWizard');
        if (ov) {
            ov.style.display = 'none';
            ov.classList.remove('lw-readonly');
        }
        document.body.style.overflow = '';
        // El toast "guardado" solo tiene sentido si hubo edición real.
        // En modo lectura el usuario nunca tocó nada, así que lo omitimos.
        if (haveName && haveProducts && !wasReadonly) {
            _globalCheer('✓ Levantamiento guardado', 'Queda en borrador hasta que lo aprueben.');
        }
        state.lev = null;
        state.phase = 1;
        state.dirty = false;
        state.readonly = false;
        if (typeof window.levantamientoRefrescarLista === 'function') {
            window.levantamientoRefrescarLista();
        }
    }

    window.levantamientoWizardClose = function () {
        // Intentar guardar antes de cerrar. Si el save es rápido (red ok),
        // no vemos el modal. Si hay errores / red caída, caemos al modal
        // para que el usuario decida.
        if (!state.dirty && _saveInFlight === 0) {
            _doCloseWizard();
            return;
        }
        _saveStatusSet('saving');
        lwFlushSave().then(function (ok) {
            if (ok && !state.dirty) {
                _doCloseWizard();
            } else {
                lwConfirm({
                    title: 'Cambios sin guardar',
                    message: 'No pudimos guardar los últimos cambios (posible problema de red). ¿Cerrar de todas formas? Perderás lo que no alcanzó a guardar.',
                    confirmLabel: 'Cerrar sin guardar',
                    cancelLabel: 'Cancelar',
                    tone: 'warn',
                }).then(function (yes) {
                    if (yes) _doCloseWizard();
                });
            }
        });
    };

    // Toast global (fuera del overlay) para notificaciones post-cierre
    function _globalCheer(title, sub) {
        var existing = document.getElementById('lwGlobalCheer');
        if (existing) existing.remove();
        var d = document.createElement('div');
        d.id = 'lwGlobalCheer';
        d.className = 'lw-cheer-toast lw-cheer-success lw-cheer-global';
        d.innerHTML = '<div class="lw-cheer-title">' + esc(title) + '</div>' +
                      (sub ? '<div class="lw-cheer-sub">' + esc(sub) + '</div>' : '');
        document.body.appendChild(d);
        setTimeout(function () {
            if (d.parentNode) {
                d.classList.add('lw-cheer-out');
                setTimeout(function () { if (d.parentNode) d.remove(); }, 280);
            }
        }, 3000);
    }

    // ── Header + Status ──────────────────────────────────────
    function renderHeader() {
        var t = $('lwTitle');
        if (t) t.textContent = state.lev.nombre || 'Levantamiento';
        var cfg = STATUS_CONFIG[state.lev.status] || STATUS_CONFIG.borrador;
        var dot = $('lwStatusDot');
        var lbl = $('lwStatusLabel');
        var btn = $('lwStatusBtn');
        if (dot) dot.style.background = cfg.dot;
        if (lbl) { lbl.textContent = cfg.label; lbl.style.color = cfg.color; }
        if (btn) btn.style.color = cfg.color;
        renderSaveStamp();
    }

    // Formatea fecha relativa: hoy, hace 2m, hace 3h, ayer, hace 5d...
    function fmtRelative(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        var now = new Date();
        var diff = Math.max(0, (now.getTime() - d.getTime()) / 1000);
        if (diff < 50) return 'hace unos segundos';
        if (diff < 3600) return 'hace ' + Math.round(diff / 60) + ' min';
        if (diff < 86400) return 'hace ' + Math.round(diff / 3600) + ' h';
        if (diff < 172800) return 'ayer';
        if (diff < 604800) return 'hace ' + Math.round(diff / 86400) + ' d';
        return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
    }

    // Render "Guardado hace X · por Y" en el header (junto al botón Guardar)
    function renderSaveStamp() {
        var el = $('lwSaveStamp');
        if (!el) return;
        var ts = state.lev && state.lev.fecha_actualizacion;
        var by = state.lev && state.lev.creado_por_nombre;
        if (!ts) { el.textContent = ''; return; }
        var rel = fmtRelative(ts);
        el.textContent = 'Guardado ' + rel + (by ? ' · por ' + by : '');
    }

    window.lwToggleStatusMenu = function (e) {
        if (e) e.stopPropagation();
        var m = $('lwStatusMenu');
        if (!m) return;
        m.style.display = m.style.display === 'block' ? 'none' : 'block';
    };
    // Cerrar menú al click fuera
    document.addEventListener('click', function (e) {
        var menu = $('lwStatusMenu');
        var btn = $('lwStatusBtn');
        if (menu && menu.style.display === 'block' && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
            menu.style.display = 'none';
        }
    });

    window.lwSetStatus = function (status) {
        state.lev.status = status;
        state.dirty = true;
        renderHeader();
        $('lwStatusMenu').style.display = 'none';
        // Persistencia inmediata
        apiFetch('/app/api/iamet/levantamientos/' + state.lev.id + '/actualizar/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: status }),
        }).then(function (r) {
            if (r.success) {
                state.dirty = false;
                if (r.data && r.data.fecha_actualizacion) state.lev.fecha_actualizacion = r.data.fecha_actualizacion;
                renderSaveStamp();
                showSaveFlash();
            }
        });
    };

    // ── Phase tabs ───────────────────────────────────────────
    function renderPhaseTabs() {
        // Marcar el wizard con la fase activa (para CSS movil)
        var wiz = document.getElementById('levantamientoWizard');
        if (wiz) {
            for (var pi = 1; pi <= 5; pi++) wiz.classList.remove('lw-phase-is-' + pi);
            wiz.classList.add('lw-phase-is-' + state.phase);
        }
        // Poblar el pill de fase que sale en el header movil
        var phaseLabels = ['', 'Levantamiento', 'Propuesta Técnica', 'Volumetría', 'Programa de Obra', 'Reportes'];
        var pNum = document.getElementById('lwMobilePhaseNum');
        var pLbl = document.getElementById('lwMobilePhaseLabel');
        if (pNum) pNum.textContent = state.phase;
        if (pLbl) pLbl.textContent = phaseLabels[state.phase] || '';
        document.querySelectorAll('#lwTabs .lw-tab').forEach(function (tab) {
            var n = parseInt(tab.getAttribute('data-phase'));
            tab.classList.remove('active', 'done');
            if (n === state.phase) tab.classList.add('active');
            else if (n < state.phase) tab.classList.add('done');
            // numeral: si done, muestra check
            var numEl = tab.querySelector('.lw-tab-num');
            if (!numEl) return;
            if (n < state.phase) {
                numEl.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
            } else {
                numEl.textContent = String(n);
            }
        });
        var completed = Math.max(state.phase - 1, 0);
        var fill = $('lwProgressFill');
        if (fill) fill.style.width = (completed / 5 * 100) + '%';
        var plbl = $('lwProgressLabel');
        if (plbl) plbl.textContent = completed + '/5';
        var fc = $('lwFooterCenter');
        if (fc) {
            var phaseLabels = ['', 'Levantamiento', 'Propuesta Técnica', 'Volumetría', 'Programa de Obra', 'Reportes'];
            fc.textContent = 'Fase ' + state.phase + ' de 5 — ' + phaseLabels[state.phase];
        }
        // prev/next disable
        var prev = $('lwFooterPrev');
        var next = $('lwFooterNext');
        if (prev) { prev.disabled = (state.phase === 1); prev.style.opacity = (state.phase === 1) ? '0.4' : ''; }
        if (next) {
            next.disabled = (state.phase === 5);
            next.style.opacity = (state.phase === 5) ? '0.4' : '';
            next.textContent = state.phase < 5 ? 'Siguiente fase →' : 'Última fase';
        }
        // Ocultar footer en fase 5 (se ve mejor sin él)
        var footer = $('lwFooter');
        if (footer) footer.style.display = state.phase === 5 ? 'none' : 'flex';
    }

    // Gate: no dejar avanzar a fase > 1 hasta que Fase 1 este >= 70% completa.
    // Retorna { canAdvance: bool, pct: number } basado en la checklist.
    function lwFase1Progress() {
        if (!state.lev) return { canAdvance: false, pct: 0 };
        var d = state.lev.fase1_data || {};
        var evidenciaCount = (state.lev.evidencias || []).length;
        var notasTxt = _ckVal('lw_f1_notas_materiales', d.notas_materiales);
        var items = [
            !!_ckVal('lw_f1_titulo', state.lev.nombre),
            !!_ckVal('lw_f1_cliente', d.cliente),
            !!_ckVal('lw_f1_contacto', d.contacto),
            !!_ckVal('lw_f1_descripcion', d.descripcion),
            (d.servicios || []).length > 0,
            (evidenciaCount > 0) || !!notasTxt,
        ];
        var done = items.filter(Boolean).length;
        var pct = Math.round((done / items.length) * 100);
        return { canAdvance: pct >= 70, pct: pct, done: done, total: items.length };
    }

    // ── Expand isla a fullscreen (Fase 2) ──────────────────────
    // Las islas con data-expandable="1" tienen un botón ⤢ que las
    // pone en pantalla completa dentro del wizard sin mover el DOM
    // (preserva handlers, autosave, drop zone de fotos, etc.).
    function _lwIslandCollapseAll() {
        var expanded = document.querySelector('.lw-island.is-expanded');
        if (!expanded) return false;
        expanded.classList.remove('is-expanded');
        var board = expanded.closest('.lw-islands-board');
        if (board) board.classList.remove('has-expanded');
        var bd = document.getElementById('lwIslandBackdrop');
        if (bd && bd.parentNode) bd.parentNode.removeChild(bd);
        // Restaurar el icono ⤢ (expandir) en el botón
        var btn = expanded.querySelector('.lw-island-expand-btn');
        if (btn) {
            btn.title = 'Expandir (Esc para cerrar)';
            btn.setAttribute('aria-label', 'Expandir');
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
        }
        return true;
    }
    window.lwIslandToggleExpand = function (btn) {
        var section = btn && btn.closest('.lw-island');
        if (!section) return;
        // Si esta isla ya está expandida → contraer
        if (section.classList.contains('is-expanded')) {
            _lwIslandCollapseAll();
            return;
        }
        // Si otra isla está expandida, contraerla primero
        _lwIslandCollapseAll();
        var board = section.closest('.lw-islands-board');
        if (board) board.classList.add('has-expanded');
        // Backdrop oscuro detrás
        if (!document.getElementById('lwIslandBackdrop')) {
            var bd = document.createElement('div');
            bd.id = 'lwIslandBackdrop';
            bd.className = 'lw-island-backdrop';
            bd.addEventListener('click', _lwIslandCollapseAll);
            document.body.appendChild(bd);
        }
        section.classList.add('is-expanded');
        // Cambiar icono a ↙ (reducir)
        btn.title = 'Reducir (Esc)';
        btn.setAttribute('aria-label', 'Reducir');
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
    };
    // Exponer el collapse para el handler global de Esc
    window._lwIslandCollapseAll = _lwIslandCollapseAll;

    window.lwGoPhase = function (n) {
        if (n < 1 || n > 5) return;
        // Gate 70% Fase 1 → Fase >=2
        if (state.phase === 1 && n > 1) {
            var prog = lwFase1Progress();
            if (!prog.canAdvance) {
                lwCheer('⚠ Completa al menos el 70% de la Fase 1', 'Llevas ' + prog.pct + '%. Faltan datos obligatorios para continuar.', 'warn');
                // Shake del footer para atraer la atencion
                var footer = document.getElementById('lwIslandsFooter');
                if (footer) {
                    footer.classList.remove('lw-shake');
                    void footer.offsetWidth; // reflow
                    footer.classList.add('lw-shake');
                }
                return;
            }
        }
        // Flushear lo pendiente de la fase actual ANTES de cambiar.
        lwFlushSave();
        state.phase = n;
        state.lev.fase_actual = Math.max(state.lev.fase_actual || 1, n);
        renderPhaseTabs();
        renderPhase(n);
        // Persistir fase_actual
        apiFetch('/app/api/iamet/levantamientos/' + state.lev.id + '/actualizar/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fase_actual: state.lev.fase_actual }),
        });
    };
    window.lwNextPhase = function () { lwGoPhase(Math.min(5, state.phase + 1)); };
    window.lwPrevPhase = function () { lwGoPhase(Math.max(1, state.phase - 1)); };

    function renderPhase(n) {
        for (var i = 1; i <= 5; i++) {
            var el = $('lwPhase' + i);
            // IMPORTANTE: la fase debe usar `display: flex` (NO block) para
            // que el CSS .lw-phase { display:flex; flex-direction:column }
            // funcione correctamente. Si usamos block, el hijo .lw-canvas
            // con `flex: 1` no recibe altura controlada y el scroll interno
            // no se dispara — resultado: contenido cortado por el footer.
            if (el) el.style.display = (i === n) ? 'flex' : 'none';
        }
        // Botón PDF visible en Fases 1-5 (cada una con su documento)
        var pdfWrap = $('lwPdfWrap');
        if (pdfWrap) pdfWrap.style.display = (n >= 1 && n <= 5) ? '' : 'none';
        var pdfMenu = $('lwPdfMenu');
        if (pdfMenu) pdfMenu.style.display = 'none';
        // Label del botón
        var btnLbl = $('lwPdfBtnLbl');
        if (btnLbl) btnLbl.textContent = (n === 3) ? 'Exportar' : 'PDF';
        // Alternar grupos del menú
        var stdItems = document.querySelectorAll('.lw-pdf-menu-item[data-menu-group="std"]');
        var volItems = document.querySelectorAll('.lw-pdf-menu-item[data-menu-group="vol"]');
        var poItems  = document.querySelectorAll('.lw-pdf-menu-item[data-menu-group="po"]');
        var rpItems  = document.querySelectorAll('.lw-pdf-menu-item[data-menu-group="rp"]');
        stdItems.forEach(function (el) { el.style.display = (n === 1 || n === 2) ? '' : 'none'; });
        volItems.forEach(function (el) { el.style.display = (n === 3) ? '' : 'none'; });
        poItems.forEach(function (el)  { el.style.display = (n === 4) ? '' : 'none'; });
        rpItems.forEach(function (el)  { el.style.display = (n === 5) ? '' : 'none'; });
        // Actualizar labels del menú std según la fase
        if (n === 1 || n === 2) {
            var stdTitles = document.querySelectorAll('.lw-pdf-menu-item[data-menu-group="std"] .lw-pdf-menu-item-title');
            if (stdTitles.length >= 2) {
                var docLabel = n === 1 ? 'Levantamiento' : 'Propuesta';
                stdTitles[0].textContent = 'Ver ' + docLabel + ' en pestaña';
                stdTitles[1].textContent = 'Descargar ' + docLabel + ' PDF';
            }
        }

        if (n === 1) renderPhase1();
        else if (n === 2) renderPhase2();
        else if (n === 3) renderPhase3();
        else if (n === 4) renderPhase4();
        else if (n === 5) renderPhase5();

        // Reaplicar readonly tras cada renderPhase: las renderPhaseN crean
        // inputs dinámicamente (productos, evidencias, etc.) y necesitan que
        // el estado readonly se propague a esos elementos recién insertados.
        if (state.readonly) _lwApplyReadonlyToInputs();
    }

    // ═══════════════════════════════════════════════════════════════
    //  AUTOSAVE ROBUSTO
    //  ───────────────
    //  - Debounce 600ms después de cada edición.
    //  - Retry exponencial si la red falla (1s, 2s, 4s; hasta 4 intentos).
    //  - Sequence number: si dos saves se lanzan en paralelo, el segundo
    //    gana (evita que una respuesta vieja sobrescriba state fresco).
    //  - Flush sincrónico vía sendBeacon al cerrar pestaña / pagehide.
    //  - Indicador visual con 3 estados: guardando · guardado · error.
    // ═══════════════════════════════════════════════════════════════

    var _saveInFlight = 0;     // nº de saves en vuelo
    var _saveSeq = 0;          // contador de secuencia
    var _saveLastOk = 0;       // seq del último save exitoso
    var _saveFailedCount = 0;  // fallos consecutivos
    var _saveRetryTimer = null;

    function _saveStatusSet(state_, opts) {
        opts = opts || {};
        var ind = $('lwSaveIndicator');
        if (!ind) return;
        ind.classList.remove('lw-save-saving', 'lw-save-ok', 'lw-save-err');
        if (state_ === 'saving')  { ind.classList.add('lw-save-saving'); ind.textContent = 'Guardando…'; }
        else if (state_ === 'ok') { ind.classList.add('lw-save-ok');     ind.textContent = '✓ Guardado'; }
        else if (state_ === 'err'){ ind.classList.add('lw-save-err');    ind.textContent = opts.msg || '⚠ Error al guardar'; }
        else                       { ind.textContent = ''; }
    }

    window.lwFieldChange = function () {
        state.dirty = true;
        // Refrescar el checklist y resumen en vivo (Fase 1) — si borras
        // un campo, la marca desaparece inmediatamente.
        if (state.phase === 1 && typeof lwRecomputeSummary === 'function') {
            try { lwRecomputeSummary(); } catch (e) { /* silencioso */ }
        }
        // Igual para Fase 2 — progress bar reactivo
        if (state.phase === 2 && typeof _lwF2RecomputeProgress === 'function') {
            try { _lwF2RecomputeProgress(); } catch (e) { /* silencioso */ }
        }
        if (state.saveTimer) clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(function () { lwSave(false); }, 600);
    };

    // Fuerza un save inmediato descartando el debounce (tanto de fase
    // como del nombre del levantamiento).
    // Retorna Promise<boolean> (true si guardó, false si no había lev).
    window.lwFlushSave = function () {
        if (!state.lev) return Promise.resolve(false);
        if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
        var p1 = (typeof _nombreFlush === 'function') ? _nombreFlush() : Promise.resolve();
        var p2 = lwSave(false);
        return Promise.all([p1, p2]).then(function () { return true; }).catch(function () { return false; });
    };

    window.lwSave = function (showFlash) {
        if (!state.lev) return Promise.resolve(null);
        var mySeq = ++_saveSeq;
        var data = collectPhaseData(state.phase);
        state.lev['fase' + state.phase + '_data'] = data;
        _saveInFlight++;
        _saveStatusSet('saving');

        // Caso especial Fase 3: si hay volumetría activa, el save no
        // va al endpoint genérico de fase del levantamiento sino al
        // endpoint específico de la volumetría. Esto evita pisar
        // accidentalmente fase3_data del levantamiento (legacy).
        // Si NO hay volumetría activa estamos en el panel — no hay
        // nada que guardar; retornamos sin tocar la red.
        var url, body;
        if (state.phase === 3) {
            if (!state.volumetriaActiva || !state.volumetriaActiva.id) {
                // Estamos en el panel de volumetrías; no hay editor abierto.
                _saveInFlight--;
                _saveStatusSet('');
                return Promise.resolve({ success: true, data: null });
            }
            url = '/app/api/iamet/volumetrias/' + state.volumetriaActiva.id + '/data/';
            body = JSON.stringify({ data: data });
        } else {
            url = '/app/api/iamet/levantamientos/' + state.lev.id + '/fase/';
            body = JSON.stringify({
                fase: state.phase,
                data: data,
                fase_actual: state.lev.fase_actual,
            });
        }

        function onDone(r) {
            _saveInFlight--;
            // Descartar respuestas viejas (ya hubo un save más nuevo que ganó)
            if (mySeq < _saveLastOk) return r;
            _saveLastOk = mySeq;
            if (r && r.success) {
                state.dirty = false;
                _saveFailedCount = 0;
                if (r.data && r.data.fecha_actualizacion) {
                    state.lev.fecha_actualizacion = r.data.fecha_actualizacion;
                }
                // El backend pudo haber sincronizado fechas del proyecto
                // desde el Programa de Implementación (Fase 2). Refrescar
                // state local para que Fase 4 (Programa de Obra) ya las
                // tenga sin necesidad de recargar.
                if (r.data && (r.data.proyecto_fecha_inicio !== undefined || r.data.proyecto_fecha_fin !== undefined)) {
                    state.lev.proyecto_fecha_inicio = r.data.proyecto_fecha_inicio;
                    state.lev.proyecto_fecha_fin = r.data.proyecto_fecha_fin;
                }
                if (r.data && r.data.proyecto_fechas_aplicadas && typeof lwCheer === 'function') {
                    lwCheer('Fechas del proyecto sincronizadas', 'El Programa de Obra ya tiene el rango listo.', 'ok');
                }
                // Re-evaluar el banner mismatch en la isla 3 con los
                // nuevos valores recién devueltos por el backend.
                if (state.phase === 2 && typeof _lwF2UpdateMismatchBanner === 'function') {
                    _lwF2UpdateMismatchBanner();
                }
                renderSaveStamp();
                _saveStatusSet('ok');
                if (showFlash) showSaveFlash();
                // Limpiar el "Guardado" a los 2s para volver al stamp
                setTimeout(function () {
                    if (_saveInFlight === 0 && !state.dirty) _saveStatusSet('');
                }, 2000);
            } else {
                _scheduleRetry();
            }
            return r;
        }

        function onError() {
            _saveInFlight--;
            if (mySeq < _saveLastOk) return; // ya hubo uno más nuevo que ganó
            _scheduleRetry();
        }

        return apiFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body,
        }).then(onDone, function (err) {
            onError();
            throw err;
        });
    };

    // Retry con backoff exponencial: 1s, 2s, 4s (máx 4 intentos).
    function _scheduleRetry() {
        _saveFailedCount++;
        if (_saveFailedCount > 4) {
            _saveStatusSet('err', { msg: '⚠ No se pudo guardar — revisa tu conexión' });
            return;
        }
        var delay = Math.min(8000, 500 * Math.pow(2, _saveFailedCount));
        _saveStatusSet('err', { msg: '⚠ Reintentando…' });
        if (_saveRetryTimer) clearTimeout(_saveRetryTimer);
        _saveRetryTimer = setTimeout(function () { lwSave(false); }, delay);
    }

    // Flush vía sendBeacon al cerrar pestaña (el browser aún procesa la
    // petición aunque la página esté muriendo). No usa credentials header,
    // pero incluye cookie de sesión automáticamente.
    function _beaconFlush() {
        if (!state.lev) return;
        var base = '/app/api/iamet/levantamientos/' + state.lev.id + '/';
        // 1) Data de la fase actual
        if (state.dirty) {
            try {
                var data = collectPhaseData(state.phase);
                var payload = JSON.stringify({
                    fase: state.phase,
                    data: data,
                    fase_actual: state.lev.fase_actual,
                });
                var url = base + 'fase/';
                var blob = new Blob([payload], { type: 'application/json' });
                if (navigator.sendBeacon) {
                    navigator.sendBeacon(url, blob);
                } else {
                    var xhr = new XMLHttpRequest();
                    xhr.open('POST', url, false);
                    xhr.setRequestHeader('Content-Type', 'application/json');
                    try { xhr.send(payload); } catch (e) {}
                }
            } catch (e) { /* best effort */ }
        }
        // 2) Nombre del levantamiento si está pendiente
        if (_nombreDirty) {
            try {
                var payload2 = JSON.stringify({ nombre: state.lev.nombre });
                var url2 = base + 'actualizar/';
                var blob2 = new Blob([payload2], { type: 'application/json' });
                if (navigator.sendBeacon) {
                    navigator.sendBeacon(url2, blob2);
                } else {
                    var xhr2 = new XMLHttpRequest();
                    xhr2.open('POST', url2, false);
                    xhr2.setRequestHeader('Content-Type', 'application/json');
                    try { xhr2.send(payload2); } catch (e) {}
                }
            } catch (e) { /* best effort */ }
        }
    }
    window.addEventListener('pagehide', _beaconFlush);
    // beforeunload también dispara cuando el usuario cierra el tab o recarga
    window.addEventListener('beforeunload', function (e) {
        _beaconFlush();
        // Si todavía hay cosas en vuelo, mostrar aviso nativo del navegador
        if (state.dirty || _saveInFlight > 0) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    function showSaveFlash() {
        var ind = $('lwSaveIndicator');
        if (!ind) return;
        ind.classList.add('lw-save-flash');
        setTimeout(function () { ind.classList.remove('lw-save-flash'); }, 1600);
    }

    function collectPhaseData(phase) {
        if (phase === 1) return collectPhase1();
        if (phase === 2) return collectPhase2();
        if (phase === 3) return collectPhase3();
        if (phase === 4) return collectPhase4();
        if (phase === 5) return collectPhase5();
        return {};
    }

    // ═══════════════════════════════════════════════════════════════
    //  PHASE 1 — LEVANTAMIENTO (Canvas Experience)
    // ═══════════════════════════════════════════════════════════════

    // Helper: marca/desmarca .is-filled en un pill según su input
    function lwRefreshMetaPill(inputEl) {
        if (!inputEl) return;
        var pill = inputEl.closest('.lw-meta-pill');
        if (!pill) return;
        var has = (inputEl.value || '').toString().trim().length > 0;
        pill.classList.toggle('is-filled', has);
    }

    // Handler de inputs en píldoras (metadata toolbar)
    window.lwMetaInput = function (el) {
        lwRefreshMetaPill(el);
        lwFieldChange();
    };

    // Auto-grow del textarea de descripción (doc style)
    window.lwAutoGrow = function (ta) {
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = (ta.scrollHeight + 2) + 'px';
    };

    // Actualiza el nombre del levantamiento (hero title) — persiste en
    // el modelo (no es fase1_data). Autosave debounced.
    var _nombreTimer = null;
    var _nombreDirty = false;

    function _nombreFlush() {
        if (!state.lev || !_nombreDirty) return Promise.resolve();
        _nombreDirty = false;
        if (_nombreTimer) { clearTimeout(_nombreTimer); _nombreTimer = null; }
        return apiFetch('/app/api/iamet/levantamientos/' + state.lev.id + '/actualizar/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: state.lev.nombre }),
        }).then(function (r) {
            if (r && r.success) {
                if (r.data && r.data.fecha_actualizacion) state.lev.fecha_actualizacion = r.data.fecha_actualizacion;
                renderSaveStamp();
            }
        }).catch(function () { _nombreDirty = true; /* se reintenta en próximo flush */ });
    }

    window.lwUpdateNombre = function (val) {
        if (!state.lev) return;
        state.lev.nombre = val || '';
        _nombreDirty = true;
        // Refrescar el título en el header también
        var t = $('lwTitle');
        if (t) t.textContent = state.lev.nombre || 'Levantamiento';
        state.dirty = true;
        // Refrescar checklist en vivo (título es uno de los 6 items)
        if (state.phase === 1 && typeof lwRecomputeSummary === 'function') {
            try { lwRecomputeSummary(); } catch (e) { /* silencioso */ }
        }
        if (_nombreTimer) clearTimeout(_nombreTimer);
        _nombreTimer = setTimeout(_nombreFlush, 700);
    };

    function renderPhase1() {
        var d = state.lev.fase1_data || {};

        // Título hero (viene del nombre del levantamiento, no de fase1_data)
        var titleInput = $('lw_f1_titulo');
        if (titleInput) {
            titleInput.value = state.lev.nombre || '';
            // Autofocus sólo si está vacío (nueva creación)
            if (!titleInput.value) {
                setTimeout(function () { titleInput.focus(); }, 60);
            }
        }

        // Cliente + metadatos
        var mapping = { cliente: 'lw_f1_cliente', contacto: 'lw_f1_contacto', area: 'lw_f1_area', fecha: 'lw_f1_fecha', email: 'lw_f1_email', telefono: 'lw_f1_telefono' };
        Object.keys(mapping).forEach(function (k) {
            var el = $(mapping[k]);
            if (el) {
                el.value = d[k] || '';
                lwRefreshMetaPill(el);
            }
        });

        // Si hay cliente_id guardado, pre-fetch contactos para el dropdown
        if (d.cliente_id) _prefetchContactos(d.cliente_id);

        // El Programa de Implementacion ahora vive en Fase 2 (ver renderPhase2).

        // Descripción + auto-grow
        var desc = $('lw_f1_descripcion');
        if (desc) {
            desc.value = d.descripcion || '';
            setTimeout(function () { lwAutoGrow(desc); }, 40);
        }

        // Chips de servicios
        var sv = $('lw_f1_servicios');
        sv.innerHTML = SERVICIOS.map(function (s) {
            var on = (d.servicios || []).indexOf(s) !== -1;
            return '<button type="button" class="lw-chip' + (on ? ' sel' : '') + '" onclick="lwP1ToggleServicio(\'' + esc(s).replace(/'/g, "\\'") + '\')">' +
                (on ? '<i></i>' : '') + esc(s) + '</button>';
        }).join('');
        // Componentes — filtrados por servicios seleccionados
        renderPhase1Componentes();

        // Estado "locked" del cliente si tiene cliente_id
        lwRefreshClienteLock();

        // Isla 4 nueva — Evidencia & Notas
        var notasEl = $('lw_f1_notas_materiales');
        if (notasEl) notasEl.value = d.notas_materiales || '';
        lwF1RenderEvid();

        renderPhase1Productos();
        lwRecomputeSummary();
        // Inicializar modo movil (una isla a la vez)
        lwMobileInit();
    }

    // ═══════════════════════════════════════════════════════════════
    //  MODO MÓVIL (Fase 1) — una isla a la vez + botón Continuar
    // ═══════════════════════════════════════════════════════════════
    var _lwMobileIdx = 0; // 0-based, 0-3 (4 islas)
    function _lwIsMobile() { return window.matchMedia && window.matchMedia('(max-width: 767px)').matches; }

    function lwMobileInit() {
        if (!_lwIsMobile()) {
            // En desktop aseguramos que todas las islas son visibles
            document.querySelectorAll('#lwPhase1 .lw-island').forEach(function (el) {
                el.classList.remove('lw-mobile-active');
            });
            return;
        }
        _lwMobileIdx = 0;
        _lwMobileShow(0);
    }

    function _lwMobileShow(idx) {
        var islands = document.querySelectorAll('#lwPhase1 .lw-island');
        islands.forEach(function (el, i) {
            el.classList.toggle('lw-mobile-active', i === idx);
        });
        // Scroll al top del board
        var board = document.querySelector('#lwPhase1 .lw-islands-board');
        if (board) board.scrollTop = 0;

        // Actualizar botones
        var backBtn = document.getElementById('lwMobileBack');
        var nextBtn = document.getElementById('lwMobileNext');
        var indicator = document.getElementById('lwMobileStepIndicator');
        var total = islands.length;
        if (indicator) indicator.textContent = (idx + 1) + ' de ' + total;
        if (backBtn) backBtn.disabled = (idx === 0);
        if (nextBtn) {
            var isLast = (idx === total - 1);
            nextBtn.classList.toggle('lw-mobile-finalize', isLast);
            nextBtn.innerHTML = isLast
                ? 'Finalizar <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>'
                : 'Continuar <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>';
        }
    }

    window.lwMobileNext = function () {
        if (!_lwIsMobile()) return;
        var islands = document.querySelectorAll('#lwPhase1 .lw-island');
        var total = islands.length;
        if (_lwMobileIdx < total - 1) {
            _lwMobileIdx++;
            _lwMobileShow(_lwMobileIdx);
        } else {
            // Ultima isla → ir a Fase 2 (mismo gate 70% que en desktop)
            lwGoPhase(2);
        }
    };

    window.lwMobilePrev = function () {
        if (!_lwIsMobile()) return;
        if (_lwMobileIdx > 0) {
            _lwMobileIdx--;
            _lwMobileShow(_lwMobileIdx);
        }
    };

    // Re-inicializar si cambia el tamaño de ventana (rotar movil, etc).
    // IMPORTANTE: en Android, al abrir el teclado se dispara 'resize'
    // porque el viewport se encoge. Si lo ignoramos mal, al tocar un
    // input el wizard reseteaba a la isla 0 (parecía que "regresaba").
    // Solución: solo re-inicializar cuando cambia el ANCHO (rotación
    // real). Si solo cambia la altura, es el teclado y NO debemos tocar.
    var _lwLastWidth = window.innerWidth;
    window.addEventListener('resize', function () {
        if (!state.lev || state.phase !== 1) return;
        var w = window.innerWidth;
        if (w === _lwLastWidth) return;  // teclado android/ios, ignorar
        _lwLastWidth = w;
        lwMobileInit();
    });

    // ── Isla 4: Evidencia (fotos) & Notas de campo ─────────────────
    window.lwF1NotasInput = function (el) {
        var d = state.lev.fase1_data || {};
        d.notas_materiales = el.value || '';
        state.lev.fase1_data = d;
        lwFieldChange();
    };

    function lwF1RenderEvid() {
        var zone = $('lwF1EvidZone');
        if (!zone) return;
        var evs = state.lev.evidencias || [];
        var hasPhotos = evs.length > 0;
        zone.classList.toggle('lw-evid-empty', !hasPhotos);

        var thumbs = evs.map(function (ev) {
            return '<div class="lw-evid-thumb" onclick="lwP2Lightbox(' + ev.id + ')">' +
                '<img src="' + esc(ev.url) + '" alt="">' +
                '<button type="button" class="lw-evid-del" title="Eliminar" onclick="event.stopPropagation(); lwP2DeleteEvidencia(' + ev.id + ')">×</button>' +
            '</div>';
        }).join('');

        // En movil usamos capture="environment" → abre la camara
        // trasera directamente al tocar el input. En desktop se omite
        // para que el picker de archivos funcione normal.
        var isMobile = (window.matchMedia && window.matchMedia('(max-width: 767px)').matches);
        var captureAttr = isMobile ? ' capture="environment"' : '';
        var hintMobile = '<div class="lw-evid-add-title">Tomar foto o subir</div>' +
                         '<div class="lw-evid-add-hint">Se abre la cámara del dispositivo</div>';
        var hintDesktop = '<div class="lw-evid-add-title">Subir fotos del sitio</div>' +
                          '<div class="lw-evid-add-hint">Arrastra, pega <kbd>⌘V</kbd> o click</div>';

        var addCard = '<label class="lw-evid-add-card" for="lw_f1_photo_input" title="Subir fotos">' +
            (hasPhotos
                ? '<div class="lw-evid-add-plus">+</div><div class="lw-evid-add-label">' + (isMobile ? 'Cámara' : 'Subir') + '</div>'
                : '<div class="lw-evid-add-plus lw-evid-add-plus-lg">+</div>' + (isMobile ? hintMobile : hintDesktop)) +
            '<input type="file" id="lw_f1_photo_input" accept="image/*" multiple' + captureAttr +
            ' hidden onchange="lwP2UploadFiles(this.files); this.value=\'\';">' +
        '</label>';

        zone.innerHTML = thumbs + addCard;
    }
    // Exponer para que renderPhase2Photos tambien refresque la Isla 4
    window.lwF1RenderEvid = lwF1RenderEvid;

    // Renderea chips de componentes filtrando por servicios activos.
    // Si hay servicios seleccionados, solo muestra los componentes relevantes.
    // Si no, muestra todos. Mantiene el estado (seleccionado) incluso si el
    // componente ya no aplica (se marca con un badge pero sigue visible).
    function renderPhase1Componentes() {
        var d = state.lev.fase1_data || {};
        var servicios = d.servicios || [];
        var selectedComps = d.componentes || [];
        var relevantSet = null;
        if (servicios.length > 0 && servicios.indexOf('Otros') === -1) {
            relevantSet = {};
            servicios.forEach(function (s) {
                var list = SERVICIO_COMPONENTES[s];
                if (list === null) { relevantSet = null; return; }
                if (Array.isArray(list)) list.forEach(function (c) { relevantSet[c] = true; });
            });
        }
        // Unir: los relevantes + los ya seleccionados (para no ocultarlos si
        // cambia el servicio después)
        var toShow;
        if (relevantSet) {
            var merged = {};
            Object.keys(relevantSet).forEach(function (k) { merged[k] = true; });
            selectedComps.forEach(function (c) { merged[c] = true; });
            toShow = COMPONENTES.filter(function (c) { return merged[c]; });
        } else {
            toShow = COMPONENTES;
        }
        var cp = $('lw_f1_componentes');
        cp.innerHTML = toShow.map(function (c) {
            var on = selectedComps.indexOf(c) !== -1;
            return '<button type="button" class="lw-chip' + (on ? ' sel' : '') + '" onclick="lwP1ToggleComponente(\'' + esc(c).replace(/'/g, "\\'") + '\')">' +
                (on ? '<i></i>' : '') + esc(c) + '</button>';
        }).join('');
    }

    window.lwP1ToggleServicio = function (s) {
        var d = state.lev.fase1_data || {};
        d.servicios = d.servicios || [];
        var idx = d.servicios.indexOf(s);
        if (idx === -1) d.servicios.push(s); else d.servicios.splice(idx, 1);
        state.lev.fase1_data = d;
        // Re-render solo el chip row afectado y los componentes (se filtran)
        renderPhase1Chip('servicios');
        renderPhase1Componentes();
        lwRecomputeSummary();
        lwFieldChange();
    };
    window.lwP1ToggleComponente = function (c) {
        var d = state.lev.fase1_data || {};
        d.componentes = d.componentes || [];
        var idx = d.componentes.indexOf(c);
        if (idx === -1) d.componentes.push(c); else d.componentes.splice(idx, 1);
        state.lev.fase1_data = d;
        renderPhase1Chip('componentes');
        lwRecomputeSummary();
        lwFieldChange();
    };

    // Re-render solo una fila de chips (sin re-render de toda la fase)
    function renderPhase1Chip(kind) {
        var d = state.lev.fase1_data || {};
        if (kind === 'servicios') {
            var sv = $('lw_f1_servicios');
            if (sv) sv.innerHTML = SERVICIOS.map(function (s) {
                var on = (d.servicios || []).indexOf(s) !== -1;
                return '<button type="button" class="lw-chip' + (on ? ' sel' : '') + '" onclick="lwP1ToggleServicio(\'' + esc(s).replace(/'/g, "\\'") + '\')">' +
                    (on ? '<i></i>' : '') + esc(s) + '</button>';
            }).join('');
        } else if (kind === 'componentes') {
            renderPhase1Componentes();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  CLIENTE / CONTACTO AUTOCOMPLETE
    // ═══════════════════════════════════════════════════════════════

    var _clienteSearchTimer = null;
    var _contactoSearchTimer = null;
    var _clienteBlurTimer = null;
    var _contactoBlurTimer = null;
    var _cachedClienteContactos = []; // para pre-llenar dropdown de contacto

    function lwInitials(name) {
        if (!name) return '?';
        var parts = name.trim().split(/\s+/);
        var a = parts[0] ? parts[0][0] : '';
        var b = parts[1] ? parts[1][0] : '';
        return (a + b).toUpperCase() || '?';
    }

    // Input en el campo cliente → buscar en /api/buscar-clientes/
    window.lwClienteInput = function (inp) {
        var q = (inp.value || '').trim();
        lwFieldChange();
        lwRefreshMetaPill(inp);
        // Si el usuario empieza a teclear, desbloqueamos el estado "locked"
        // (cambiar de cliente implica limpiar el cliente_id previo)
        var d = state.lev.fase1_data || {};
        if (d.cliente_id && d.cliente !== inp.value) {
            d.cliente_id = null;
            state.lev.fase1_data = d;
            lwRefreshClienteLock();
        }
        if (_clienteSearchTimer) clearTimeout(_clienteSearchTimer);
        if (q.length < 2) { lwHideClienteDropdown(); return; }
        _clienteSearchTimer = setTimeout(function () {
            apiFetch('/app/api/buscar-clientes/?q=' + encodeURIComponent(q)).then(function (r) {
                var list = r.clientes || [];
                lwShowClienteDropdown(list);
            });
        }, 180);
    };

    window.lwClienteBlur = function () {
        // Delay para que el click en un row de dropdown alcance a disparar
        if (_clienteBlurTimer) clearTimeout(_clienteBlurTimer);
        _clienteBlurTimer = setTimeout(lwHideClienteDropdown, 160);
    };

    function lwShowClienteDropdown(list) {
        var dd = $('lw_f1_cliente_ac');
        if (!dd) return;
        if (!list.length) {
            dd.innerHTML = '<div class="lw-ac-empty">Sin resultados. Puedes teclear un nombre nuevo.</div>';
            dd.style.display = 'block';
            return;
        }
        dd.innerHTML = list.map(function (c, i) {
            var ini = lwInitials(c.nombre);
            var sub = [c.contacto_principal, c.email, c.telefono].filter(Boolean).join(' · ');
            return '<div class="lw-ac-row" data-id="' + c.id + '" data-idx="' + i + '" onmousedown="lwClienteSelect(' + i + ')">' +
                '<div class="lw-ac-row-avatar">' + esc(ini) + '</div>' +
                '<div class="lw-ac-row-main">' +
                    '<div class="lw-ac-row-name">' + esc(c.nombre) + '</div>' +
                    (sub ? '<div class="lw-ac-row-sub">' + esc(sub) + '</div>' : '') +
                '</div>' +
            '</div>';
        }).join('');
        dd.style.display = 'block';
        window._lwClienteResults = list;
    }

    function lwHideClienteDropdown() {
        var dd = $('lw_f1_cliente_ac');
        if (dd) dd.style.display = 'none';
    }

    window.lwClienteSelect = function (idx) {
        var list = window._lwClienteResults || [];
        var c = list[idx];
        if (!c) return;
        var d = state.lev.fase1_data || {};
        // Solo seteamos la identidad del cliente (id + nombre). El resto
        // de los campos — contacto, email, telefono — los captura el
        // ingeniero manualmente para evitar datos copiados sin verificar.
        d.cliente_id = c.id;
        d.cliente = c.nombre;
        state.lev.fase1_data = d;
        $('lw_f1_cliente').value = d.cliente;
        lwRefreshMetaPill($('lw_f1_cliente'));
        lwHideClienteDropdown();
        lwRefreshClienteLock();
        // Prefetch contactos del cliente — solo alimenta el dropdown
        // de sugerencias cuando el usuario clickea en Contacto; no
        // rellena el campo automaticamente.
        _prefetchContactos(c.id);
        lwRecomputeSummary();
        lwFieldChange();
    };

    window.lwClienteClear = function (e) {
        if (e) { e.stopPropagation(); e.preventDefault(); }
        var d = state.lev.fase1_data || {};
        d.cliente_id = null;
        d.cliente = '';
        state.lev.fase1_data = d;
        $('lw_f1_cliente').value = '';
        lwRefreshMetaPill($('lw_f1_cliente'));
        lwRefreshClienteLock();
        _cachedClienteContactos = [];
        lwRecomputeSummary();
        lwFieldChange();
        $('lw_f1_cliente').focus();
    };

    function lwRefreshClienteLock() {
        var d = state.lev.fase1_data || {};
        // Busca el contenedor del input cliente tanto en el layout viejo
        // (.lw-meta-pill-cliente) como en el nuevo (label padre del input).
        var inp = $('lw_f1_cliente');
        var pill = (inp && inp.closest('.lw-meta-pill-cliente, .lw-soft-input, label'))
                   || document.querySelector('.lw-meta-pill-cliente');
        var clearBtn = $('lwClienteClearBtn');
        if (!pill) return;
        if (d.cliente_id) {
            pill.classList.add('is-locked');
            if (clearBtn) clearBtn.style.display = '';
        } else {
            pill.classList.remove('is-locked');
            if (clearBtn) clearBtn.style.display = 'none';
        }
    }

    function _prefetchContactos(clienteId) {
        if (!clienteId) { _cachedClienteContactos = []; return; }
        apiFetch('/app/api/buscar-contactos/?cliente_id=' + encodeURIComponent(clienteId)).then(function (r) {
            _cachedClienteContactos = (r.contactos || []);
        });
    }

    // ── Contacto autocomplete ──
    window.lwContactoInput = function (inp) {
        var q = (inp.value || '').trim();
        lwFieldChange();
        lwRefreshMetaPill(inp);
        var d = state.lev.fase1_data || {};
        // Si no hay cliente seleccionado, no hay lista — solo input libre
        if (!d.cliente_id) { lwHideContactoDropdown(); return; }
        // Si tenemos contactos cacheados, filtrar en cliente
        if (_contactoSearchTimer) clearTimeout(_contactoSearchTimer);
        _contactoSearchTimer = setTimeout(function () {
            var list;
            if (_cachedClienteContactos.length) {
                var ql = q.toLowerCase();
                list = _cachedClienteContactos.filter(function (c) {
                    return !q || (c.nombre_completo || '').toLowerCase().indexOf(ql) !== -1;
                });
                lwShowContactoDropdown(list);
            } else {
                apiFetch('/app/api/buscar-contactos/?cliente_id=' + d.cliente_id + '&q=' + encodeURIComponent(q))
                    .then(function (r) {
                        var ll = r.contactos || [];
                        _cachedClienteContactos = ll;
                        lwShowContactoDropdown(ll);
                    });
            }
        }, 140);
    };

    window.lwContactoBlur = function () {
        if (_contactoBlurTimer) clearTimeout(_contactoBlurTimer);
        _contactoBlurTimer = setTimeout(lwHideContactoDropdown, 160);
    };

    function lwShowContactoDropdown(list) {
        var dd = $('lw_f1_contacto_ac');
        if (!dd) return;
        if (!list.length) {
            dd.innerHTML = '<div class="lw-ac-empty">Sin contactos en este cliente. Puedes teclear uno nuevo.</div>';
            dd.style.display = 'block';
            return;
        }
        dd.innerHTML = list.map(function (c, i) {
            return '<div class="lw-ac-row" data-idx="' + i + '" onmousedown="lwContactoSelect(' + i + ')">' +
                '<div class="lw-ac-row-avatar" style="background:linear-gradient(135deg,#A78BFA,#7C3AED);">' + esc(lwInitials(c.nombre_completo)) + '</div>' +
                '<div class="lw-ac-row-main">' +
                    '<div class="lw-ac-row-name">' + esc(c.nombre_completo) + '</div>' +
                '</div>' +
            '</div>';
        }).join('');
        dd.style.display = 'block';
        window._lwContactoResults = list;
    }

    function lwHideContactoDropdown() {
        var dd = $('lw_f1_contacto_ac');
        if (dd) dd.style.display = 'none';
    }

    window.lwContactoSelect = function (idx) {
        var list = window._lwContactoResults || [];
        var c = list[idx];
        if (!c) return;
        var d = state.lev.fase1_data || {};
        d.contacto = c.nombre_completo;
        state.lev.fase1_data = d;
        $('lw_f1_contacto').value = d.contacto;
        lwRefreshMetaPill($('lw_f1_contacto'));
        lwHideContactoDropdown();
        lwFieldChange();
    };

    // ═══════════════════════════════════════════════════════════════
    //  RESUMEN VIVO (sidebar stats)
    // ═══════════════════════════════════════════════════════════════

    // Checklist de Fase 1 — 6 items requeridos. Cada ✓ da feedback
    // inmediato al ingeniero ("llevo 4 de 6").
    // Lee directo del DOM (con fallback al state) para que el usuario
    // vea el cambio en tiempo real al escribir / borrar un campo —
    // antes sólo se actualizaba al auto-save (stale state).
    function _ckVal(id, stateFallback) {
        var el = document.getElementById(id);
        if (el) return (el.value || '').trim();
        return (stateFallback || '').toString().trim();
    }
    function lwRenderChecklist() {
        if (!state.lev) return;
        var d = state.lev.fase1_data || {};
        var evidenciaCount = (state.lev.evidencias || []).length;
        var notasTxt = _ckVal('lw_f1_notas_materiales', d.notas_materiales);
        var items = [
            { key: 'titulo',      label: 'Título del levantamiento',   done: !!_ckVal('lw_f1_titulo', state.lev.nombre) },
            { key: 'cliente',     label: 'Cliente',                    done: !!_ckVal('lw_f1_cliente', d.cliente) },
            { key: 'contacto',    label: 'Contacto',                   done: !!_ckVal('lw_f1_contacto', d.contacto) },
            { key: 'descripcion', label: 'Descripción de la necesidad',done: !!_ckVal('lw_f1_descripcion', d.descripcion) },
            { key: 'servicios',   label: 'Al menos 1 servicio',        done: (d.servicios || []).length > 0 },
            { key: 'productos',   label: 'Evidencia o notas de campo', done: (evidenciaCount > 0) || !!notasTxt },
        ];
        var done = items.filter(function (i) { return i.done; }).length;
        var total = items.length;
        var listEl = $('lwChecklistList');
        var countEl = $('lwChecklistCount');
        if (!listEl) return;
        listEl.innerHTML = items.map(function (i) {
            return '<div class="lw-ck-row' + (i.done ? ' done' : '') + '" data-key="' + i.key + '">' +
                '<span class="lw-ck-box">' +
                    (i.done ? '<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : '') +
                '</span>' +
                '<span class="lw-ck-text">' + i.label + '</span>' +
            '</div>';
        }).join('');
        if (countEl) countEl.textContent = done + ' / ' + total;
        // Si llega a 6/6 por primera vez, dispara celebración
        if (done === total && state.lev._ck_last_done !== total) {
            _celebrateFase1Done();
        }
        state.lev._ck_last_done = done;

        // Actualizar footer flotante nuevo (tablero de islas)
        _updateIslandsFooter(items, done, total);
    }

    // Footer flotante con progreso + palomitas inline en cada campo.
    // El umbral para avanzar a Fase 2 es 70% → a partir de ahi el
    // footer se pone verde y el boton "Siguiente fase" se habilita.
    function _updateIslandsFooter(items, done, total) {
        var pct = total > 0 ? Math.round((done / total) * 100) : 0;
        var canAdvance = pct >= 70;
        var pctEl = document.getElementById('lwIslandsProgressPct');
        var fillEl = document.getElementById('lwIslandsProgressFill');
        var statusEl = document.getElementById('lwIslandsStatus');
        if (pctEl) pctEl.textContent = pct + '%';
        if (fillEl) {
            fillEl.style.width = pct + '%';
            fillEl.classList.toggle('done', canAdvance);
        }
        // Estado textual
        if (statusEl) {
            var remaining = total - done;
            if (canAdvance) {
                statusEl.classList.add('ready');
                var lbl = pct === 100 ? 'Listo para Fase 2' : 'Puedes avanzar · ' + pct + '%';
                statusEl.innerHTML =
                    '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' +
                    '<span>' + lbl + '</span>';
            } else {
                statusEl.classList.remove('ready');
                statusEl.innerHTML =
                    '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
                    '<span>' + (remaining === 1 ? 'Falta 1 dato' : 'Faltan ' + remaining + ' datos') + '</span>';
            }
        }
        // Palomitas inline en cada isla
        items.forEach(function (it) {
            var ic = document.getElementById('lwCheck_' + it.key);
            if (ic) ic.classList.toggle('visible', !!it.done);
        });
        // Habilitar/deshabilitar el boton "Siguiente fase" del footer general
        var btnNext = document.getElementById('lwFooterNext');
        if (btnNext && state.phase === 1) {
            btnNext.classList.toggle('lw-btn-disabled', !canAdvance);
            btnNext.title = canAdvance ? '' : 'Completa al menos 70% de Fase 1';
        }
    }

    // Celebración efímera cuando completas la checklist de Fase 1
    function _celebrateFase1Done() {
        lwCheer('🎉 ¡Fase 1 completa!', 'Puedes seguir a Propuesta Técnica.');
    }

    // Toast propio del wizard — más visible que el showToast global y
    // siempre disponible dentro del overlay fullscreen.
    function lwCheer(title, sub, kind) {
        kind = kind || 'success';
        var existing = $('lwCheerToast');
        if (existing) existing.remove();
        var d = document.createElement('div');
        d.id = 'lwCheerToast';
        d.className = 'lw-cheer-toast lw-cheer-' + kind;
        d.innerHTML = '<div class="lw-cheer-title">' + esc(title) + '</div>' +
                      (sub ? '<div class="lw-cheer-sub">' + esc(sub) + '</div>' : '');
        (document.getElementById('levantamientoWizard') || document.body).appendChild(d);
        // Auto-dismiss a los 3.5s
        setTimeout(function () {
            if (d.parentNode) {
                d.classList.add('lw-cheer-out');
                setTimeout(function () { if (d.parentNode) d.remove(); }, 280);
            }
        }, 3500);
    }
    window.lwCheer = lwCheer;

    // ═══════════════════════════════════════════════════════════════
    //  MODO SIMPLE / COMPLETO — oculta campos avanzados para onboarding
    // ═══════════════════════════════════════════════════════════════
    var LW_MODE_KEY = 'lw_wizard_mode';  // 'simple' | 'full'

    function _lwApplyMode(mode) {
        var container = document.querySelector('.lw-container');
        var toggle    = $('lwModeToggle');
        var label     = $('lwModeLabel');
        if (!container) return;
        if (mode === 'full') {
            container.classList.remove('lw-mode-simple');
            container.classList.add('lw-mode-full');
            if (toggle) toggle.checked = true;
            if (label) label.textContent = 'Modo completo';
        } else {
            container.classList.remove('lw-mode-full');
            container.classList.add('lw-mode-simple');
            if (toggle) toggle.checked = false;
            if (label) label.textContent = 'Modo simple';
        }
    }

    window.lwToggleMode = function (isFull) {
        var mode = isFull ? 'full' : 'simple';
        try { localStorage.setItem(LW_MODE_KEY, mode); } catch (e) {}
        _lwApplyMode(mode);
        // Cheer al cambiar a modo completo la primera vez — sutil, informativo
        if (isFull) {
            lwCheer('Modo completo activado', 'Se muestran todos los campos avanzados.', 'info');
        }
    };

    // Restore mode al abrir el wizard — el toggle se removio, ahora
    // siempre forzamos "full" para que los campos avanzados (como
    // "Notas por partida") sean siempre visibles.
    function _lwRestoreMode() {
        _lwApplyMode('full');
    }

    // ── Sidebar lateral (colapsable) ──────────────────────────────
    var LW_SIDEBAR_KEY = 'lw_sidebar_hidden_v1';

    function _lwApplySidebar(hidden) {
        var wizard = $('levantamientoWizard');
        var btn = $('lwSidebarToggle');
        if (wizard) wizard.classList.toggle('lw-sidebar-hidden', !!hidden);
        if (btn) btn.classList.toggle('active', !hidden);
    }

    function _lwRestoreSidebar() {
        var saved;
        try { saved = localStorage.getItem(LW_SIDEBAR_KEY); } catch (e) { saved = null; }
        // Default: oculto (así ganamos espacio; el usuario lo abre cuando lo necesita)
        _lwApplySidebar(saved !== 'visible');
    }

    window.lwSidebarToggle = function () {
        var wizard = $('levantamientoWizard');
        if (!wizard) return;
        var hidden = !wizard.classList.contains('lw-sidebar-hidden');
        try { localStorage.setItem(LW_SIDEBAR_KEY, hidden ? 'hidden' : 'visible'); } catch (e) {}
        _lwApplySidebar(hidden);
    };

    // ═══════════════════════════════════════════════════════════════
    //  HELP PANEL FAB (mini FAQ)
    // ═══════════════════════════════════════════════════════════════
    window.lwHelpToggle = function () {
        var panel = $('lwHelpPanel');
        var fab = $('lwHelpFab');
        if (!panel) return;
        var open = panel.style.display !== 'none';
        if (open) {
            panel.classList.add('lw-help-panel-out');
            setTimeout(function () {
                panel.style.display = 'none';
                panel.classList.remove('lw-help-panel-out');
            }, 180);
            if (fab) fab.classList.remove('lw-help-fab-active');
        } else {
            panel.style.display = 'flex';
            if (fab) fab.classList.add('lw-help-fab-active');
        }
    };
    window.lwHelpExpand = function (qEl) {
        var item = qEl.closest('.lw-help-item');
        if (!item) return;
        // Toggle solo éste (UX tipo FAQ)
        var wasOpen = item.classList.contains('open');
        // Cierra todos
        var panel = $('lwHelpPanel');
        if (panel) {
            panel.querySelectorAll('.lw-help-item.open').forEach(function (x) { x.classList.remove('open'); });
        }
        if (!wasOpen) item.classList.add('open');
    };

    function lwRecomputeSummary() {
        if (!state.lev) return;
        lwRenderChecklist();
        var d = state.lev.fase1_data || {};
        var nServ = (d.servicios || []).length;
        var nComp = (d.componentes || []).length;
        var prods = d.productos || [];
        var nProd = prods.length;
        var monto = prods.reduce(function (a, p) {
            var qty = Number(p.qty) || 0;
            var precio = Number(p.precio) || 0;
            return a + qty * precio;
        }, 0);
        var elS = $('lwSumServicios');
        var elC = $('lwSumComponentes');
        var elP = $('lwSumProductos');
        var elM = $('lwSumMonto');
        if (elS) elS.textContent = nServ;
        if (elC) elC.textContent = nComp;
        if (elP) elP.textContent = nProd;
        if (elM) elM.textContent = '$' + monto.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

        // Progress bar (fase actual / 5)
        var phase = state.phase || 1;
        var pct = Math.min(100, phase * 20);
        var fill = $('lwSumProgressFill');
        var lbl = $('lwSumProgressLbl');
        if (fill) fill.style.width = pct + '%';
        if (lbl) lbl.textContent = 'Fase ' + phase + ' · ' + pct + '%';
    }

    // Sugerencias rápidas de productos populares (1-click add). Se muestran
    // como pills abajo del empty state; agrupadas por servicio.
    var QUICK_ADD_PRODUCTS = [
        { desc: 'Cámara IP Domo 4MP IR 30m', marca: 'Hikvision', modelo: 'DS-2CD2347G2-LU', unidad: 'PZA', precio: 2850, emoji: '📹' },
        { desc: 'NVR 32 canales 4K H.265+',   marca: 'Hikvision', modelo: 'DS-7732NI-I4/16P', unidad: 'PZA', precio: 18500, emoji: '🎥' },
        { desc: 'Cable UTP Cat6 CCA 305m',    marca: 'PANDUIT',   modelo: 'NUC6C04BU-CEG',   unidad: 'BOB', precio: 950, emoji: '🔌' },
        { desc: 'Switch PoE 24 puertos Gigabit', marca: 'TP-Link', modelo: 'TL-SG1224PE',    unidad: 'PZA', precio: 5400, emoji: '🔀' },
        { desc: 'Gabinete Rack 12U Pared',    marca: 'Linkedpro', modelo: 'LP-GB-12U-W',    unidad: 'PZA', precio: 3200, emoji: '🗄️' },
        { desc: 'Controladora acceso 2 puertas', marca: 'Hikvision', modelo: 'DS-K2602T',   unidad: 'PZA', precio: 8500, emoji: '🔐' },
    ];

    function renderPhase1Productos() {
        var d = state.lev.fase1_data || {};
        var prods = d.productos || [];
        var wrap = $('lw_f1_productos_wrap');
        if (!wrap) return; // la isla de productos ya no existe en Fase 1
        if (!prods.length) {
            // Empty state con buscador grande + sugerencias rápidas clickeables
            var suggestionsHtml = QUICK_ADD_PRODUCTS.map(function (p, i) {
                return '<button type="button" class="lw-quick-add-pill" onclick="lwP1QuickAddProduct(' + i + ')" title="' + esc(p.marca) + ' · ' + esc(p.modelo) + '">' +
                    '<span class="lw-quick-add-emoji">' + p.emoji + '</span>' +
                    '<span class="lw-quick-add-text">' + esc(p.desc.split(' ').slice(0, 3).join(' ')) + '</span>' +
                    '<span class="lw-quick-add-plus">+</span>' +
                '</button>';
            }).join('');
            wrap.innerHTML =
                '<div class="lw-empty-prods" onclick="lwP1OpenCatalog()">' +
                    '<div class="lw-empty-prods-icon">' +
                        '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>' +
                    '</div>' +
                    '<div class="lw-empty-prods-title">Busca un producto del catálogo</div>' +
                    '<div class="lw-empty-prods-hint">Teclea descripción, marca o número de parte · <kbd>⌘K</kbd></div>' +
                '</div>' +
                '<div class="lw-quick-add-wrap" onclick="event.stopPropagation()">' +
                    '<div class="lw-quick-add-label">O agrega uno popular con 1 clic</div>' +
                    '<div class="lw-quick-add-grid">' + suggestionsHtml + '</div>' +
                '</div>';
            return;
        }
        var html = '<div class="lw-p1-tbl-wrap"><table class="lw-p1-tbl"><thead><tr>' +
            '<th style="width:24px;"></th><th>#</th><th>Cant</th><th>Unid</th><th>Descripción</th><th>Marca</th><th>Modelo</th><th></th>' +
            '</tr></thead><tbody>';
        prods.forEach(function (p, idx) {
            html += '<tr draggable="true" data-idx="' + idx + '"' +
                ' ondragstart="lwP1DragStart(event,' + idx + ')"' +
                ' ondragover="lwP1DragOver(event,' + idx + ')"' +
                ' ondragleave="lwP1DragLeave(event)"' +
                ' ondrop="lwP1Drop(event,' + idx + ')"' +
                ' ondragend="lwP1DragEnd(event)">' +
                '<td><span class="lw-p1-drag-handle" title="Arrastra para reordenar">' +
                    '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>' +
                '</span></td>' +
                '<td><span class="lw-p1-partida">' + (idx + 1) + '</span></td>' +
                '<td><input type="number" min="1" value="' + (p.qty || 1) + '" class="lw-cell-input" style="width:48px;" oninput="lwP1UpdateProd(' + idx + ', \'qty\', this.value)"></td>' +
                '<td><span class="lw-p1-unidad">' + esc(p.unidad || 'PZA') + '</span></td>' +
                '<td><input type="text" value="' + esc(p.desc || '') + '" class="lw-cell-input lw-cell-wide" oninput="lwP1UpdateProd(' + idx + ', \'desc\', this.value)"></td>' +
                '<td><span class="lw-p1-muted">' + esc(p.marca || '') + '</span></td>' +
                '<td><span class="lw-p1-muted lw-p1-mono">' + esc(p.modelo || '') + '</span></td>' +
                '<td><button type="button" class="lw-cell-del" onclick="lwP1DelProd(' + idx + ')">×</button></td>' +
            '</tr>';
        });
        html += '</tbody></table></div>';
        wrap.innerHTML = html;
    }

    // ── Drag & drop reorder ───────────────────────────────────
    var _dragIdx = null;
    window.lwP1DragStart = function (e, idx) {
        _dragIdx = idx;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(idx)); } catch (_) {}
        var tr = e.currentTarget;
        tr.classList.add('lw-dragging');
    };
    window.lwP1DragOver = function (e, idx) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // Quitar drag-over de todas las filas y marcar la actual
        document.querySelectorAll('.lw-p1-tbl tr.lw-drag-over').forEach(function (r) { r.classList.remove('lw-drag-over'); });
        if (idx !== _dragIdx) e.currentTarget.classList.add('lw-drag-over');
    };
    window.lwP1DragLeave = function (e) {
        e.currentTarget.classList.remove('lw-drag-over');
    };
    window.lwP1Drop = function (e, targetIdx) {
        e.preventDefault();
        var src = _dragIdx;
        if (src == null || src === targetIdx) { lwP1DragEnd(e); return; }
        var d = state.lev.fase1_data || {};
        if (!d.productos) return;
        var moved = d.productos.splice(src, 1)[0];
        d.productos.splice(targetIdx, 0, moved);
        d.productos.forEach(function (p, i) { p.partida = i + 1; });
        state.lev.fase1_data = d;
        _dragIdx = null;
        renderPhase1Productos();
        lwRecomputeSummary();
        lwFieldChange();
    };
    window.lwP1DragEnd = function () {
        _dragIdx = null;
        document.querySelectorAll('.lw-p1-tbl tr.lw-dragging, .lw-p1-tbl tr.lw-drag-over').forEach(function (r) {
            r.classList.remove('lw-dragging'); r.classList.remove('lw-drag-over');
        });
    };
    // Quick-add desde las pill-sugerencias del empty state
    window.lwP1QuickAddProduct = function (i) {
        var p = QUICK_ADD_PRODUCTS[i];
        if (!p) return;
        var d = state.lev.fase1_data || {};
        d.productos = d.productos || [];
        d.productos.push({
            desc: p.desc, marca: p.marca, modelo: p.modelo,
            unidad: p.unidad || 'PZA', precio: p.precio || 0,
            qty: 1, partida: d.productos.length + 1,
        });
        state.lev.fase1_data = d;
        renderPhase1Productos();
        lwRecomputeSummary();
        lwFieldChange();
    };

    window.lwP1UpdateProd = function (idx, field, val) {
        var d = state.lev.fase1_data || {};
        if (!d.productos) return;
        if (field === 'qty') val = parseFloat(val) || 1;
        d.productos[idx][field] = val;
        state.lev.fase1_data = d;
        lwRecomputeSummary();
        lwFieldChange();
    };
    window.lwP1DelProd = function (idx) {
        var d = state.lev.fase1_data || {};
        d.productos.splice(idx, 1);
        d.productos.forEach(function (p, i) { p.partida = i + 1; });
        state.lev.fase1_data = d;
        renderPhase1Productos();
        lwRecomputeSummary();
        lwFieldChange();
    };

    // Catalog dropdown
    window.lwP1OpenCatalog = function () {
        var box = $('lwCatalogBox');
        if (!box) return; // isla catalogo ya no existe en Fase 1
        box.style.display = 'block';
        $('lwCatalogSearch').value = '';
        $('lwCatalogSearch').focus();
        renderCatalogList(DEMO_CATALOG);
    };
    window.lwP1CloseCatalog = function () {
        $('lwCatalogBox').style.display = 'none';
    };
    var _catalogTimer = null;
    window.lwP1CatalogSearch = function () {
        var q = $('lwCatalogSearch').value.trim();
        if (_catalogTimer) clearTimeout(_catalogTimer);
        if (q.length < 2) {
            renderCatalogList(DEMO_CATALOG);
            return;
        }
        _catalogTimer = setTimeout(function () {
            apiFetch('/app/api/iamet/catalogo-productos/?q=' + encodeURIComponent(q)).then(function (r) {
                if (r.ok && r.data && r.data.length) {
                    renderCatalogList(r.data);
                } else {
                    // fallback filtrando demo
                    var ql = q.toLowerCase();
                    renderCatalogList(DEMO_CATALOG.filter(function (p) {
                        return (p.desc + ' ' + p.marca + ' ' + p.modelo).toLowerCase().indexOf(ql) !== -1;
                    }));
                }
            });
        }, 200);
    };
    function renderCatalogList(list) {
        var wrap = $('lwCatalogList');
        if (!list.length) {
            wrap.innerHTML = '<div class="lw-catalog-empty">Sin resultados</div>';
            return;
        }
        wrap.innerHTML = list.map(function (p, i) {
            return '<div class="lw-catalog-row" onclick="lwP1AddProduct(' + i + ')">' +
                '<div>' +
                    '<div class="lw-catalog-desc">' + esc(p.desc) + '</div>' +
                    '<div class="lw-catalog-sub">' + esc(p.marca) + ' · ' + esc(p.modelo) + '</div>' +
                '</div>' +
                '<div class="lw-catalog-price">' + fmtMoney(p.precio) + '</div>' +
            '</div>';
        }).join('');
        // store current list for add
        window._lwCatalogCurrent = list;
    }
    window.lwP1AddProduct = function (i) {
        var list = window._lwCatalogCurrent || [];
        var p = list[i];
        if (!p) return;
        var d = state.lev.fase1_data || {};
        d.productos = d.productos || [];
        d.productos.push({
            id: p.id, desc: p.desc, marca: p.marca, modelo: p.modelo,
            unidad: p.unidad || 'PZA', precio: p.precio || 0,
            qty: 1, partida: d.productos.length + 1,
        });
        state.lev.fase1_data = d;
        $('lwCatalogBox').style.display = 'none';
        renderPhase1Productos();
        lwRecomputeSummary();
        lwFieldChange();
    };

    function collectPhase1() {
        var d = state.lev.fase1_data || {};
        var read = function (id) { var el = $(id); return el ? el.value : ''; };
        d.cliente     = read('lw_f1_cliente');
        d.contacto    = read('lw_f1_contacto');
        d.area        = read('lw_f1_area');
        d.fecha       = read('lw_f1_fecha');
        d.email       = read('lw_f1_email');
        d.telefono    = read('lw_f1_telefono');
        d.descripcion = read('lw_f1_descripcion');
        d.notas_materiales = read('lw_f1_notas_materiales');
        state.lev.fase1_data = d;
        return d;
    }

    // Turno (single-select chip en Programa e Implementación)
    window.lwP1SetTurno = function (t) {
        var d = state.lev.fase1_data || {};
        d.turno = d.turno === t ? '' : t; // toggle
        state.lev.fase1_data = d;
        var turnoEl = $('lw_f1_turno_chips');
        if (turnoEl) {
            turnoEl.innerHTML = ['Diurno', 'Nocturno', 'Mixto'].map(function (x) {
                var on = d.turno === x;
                return '<button type="button" class="lw-chip' + (on ? ' sel' : '') + '" onclick="lwP1SetTurno(\'' + x + '\')">' +
                    (on ? '<i></i>' : '') + x + '</button>';
            }).join('');
        }
        lwFieldChange();
    };

    // ═══════════════════════════════════════════════════════════════
    //  PHASE 2 — PROPUESTA TÉCNICA
    // ═══════════════════════════════════════════════════════════════
    function renderPhase2() {
        var f2 = state.lev.fase2_data || {};
        var f1 = state.lev.fase1_data || {};

        // Campos del formato — precargar con defaults inteligentes
        function setVal(id, val) { var el = $(id); if (el) { el.value = val || ''; lwRefreshMetaPill(el); } }
        setVal('lw_f2_elaboro',       f2.elaboro       || (state.lev.creado_por_nombre || ''));
        setVal('lw_f2_doc_fecha',     f2.doc_fecha     || new Date().toISOString().split('T')[0]);
        setVal('lw_f2_solicitante',   f2.solicitante   || f1.contacto || '');
        setVal('lw_f2_departamento',  f2.departamento  || '');
        setVal('lw_f2_planta',        f2.planta        || f1.cliente  || '');
        setVal('lw_f2_areas',         f2.areas         || f1.area     || '');
        setVal('lw_f2_tipo_solucion', f2.tipo_solucion || (f1.servicios || []).join(', '));
        setVal('lw_f2_fecha_inst',    f2.fecha_inst    || 'Acordar con usuario');

        // Descripción del proyecto (pre-llena con descripcion de Fase 1 si vacía)
        var desc = $('lw_f2_desc_proyecto');
        if (desc) {
            desc.value = f2.desc_proyecto || f1.descripcion || '';
            setTimeout(function () { lwAutoGrow(desc); }, 40);
        }

        // Listas de Especificaciones + Comentarios
        renderP2SpecList('especificaciones', f2.especificaciones);
        renderP2SpecList('comentarios', f2.comentarios_spec);

        // Productos / Materiales (seleccionados via catalogo)
        renderPhase2Productos();

        // Partidas con comentarios — ahora iteran fase2.productos
        var productos = f2.productos || [];
        var wrap = $('lw_f2_partidas');
        if (!productos.length) {
            wrap.innerHTML = '<div class="lw-empty-card">Agrega productos arriba primero para poder escribir notas por partida</div>';
        } else {
            var comentarios = f2.comentarios || {}; // idx -> texto
            wrap.innerHTML = productos.map(function (p, idx) {
                var com = comentarios[idx] || '';
                var hasNote = com.trim() !== '';
                return '<div class="lw-prod-card" data-idx="' + idx + '">' +
                    '<div class="lw-prod-head" onclick="lwP2ToggleExpand(' + idx + ')">' +
                        '<div class="lw-prod-head-left">' +
                            '<span class="lw-prod-num">' + (idx + 1) + '</span>' +
                            '<div>' +
                                '<div class="lw-prod-title">' + esc(p.desc || '') + '</div>' +
                                '<div class="lw-prod-sub">' + esc(p.marca || '') + ' · ' + esc(p.modelo || '') + ' · <strong>' + (p.qty || 0) + ' ' + esc(p.unidad || '') + '</strong></div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="lw-prod-head-right">' +
                            (hasNote ? '<span class="lw-prod-has-note">Nota</span>' : '') +
                            '<svg class="lw-prod-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
                        '</div>' +
                    '</div>' +
                    '<div class="lw-prod-body" style="display:none;">' +
                        '<label>Comentarios de Instalación</label>' +
                        '<textarea rows="3" oninput="lwP2UpdateComment(' + idx + ', this.value)" placeholder="Condiciones de instalación, herramientas necesarias…">' + esc(com) + '</textarea>' +
                    '</div>' +
                '</div>';
            }).join('');
        }
        // Evidencias
        renderPhase2Photos();
        // Notas sobre las evidencias
        var notasEv = $('lw_f2_notas_evidencia');
        if (notasEv) notasEv.value = f2.notas_evidencia || '';
        // Programa de implementacion (movido desde Fase 1)
        _lwF2FillPrograma();
        // Barra de progreso de Fase 2
        _lwF2RecomputeProgress();
    }

    // ── Productos/Materiales en Fase 2 (con catalog search) ─────────
    // Cada fila es editable inline — desc, marca, modelo, qty.
    function renderPhase2Productos() {
        var wrap = $('lw_f2_productos_wrap');
        if (!wrap) return;
        var f2 = state.lev.fase2_data || {};
        var prods = f2.productos || [];
        if (!prods.length) {
            wrap.innerHTML = '<div class="lw-empty-card" style="padding:16px;text-align:center;color:#94A3B8;font-style:italic;border:1px dashed #CBD5E1;border-radius:10px;">Ningún material seleccionado. Usa el buscador de arriba o agrégalos a mano.</div>';
            return;
        }
        wrap.innerHTML =
            '<div class="lw-f2-prods-list">' +
            prods.map(function (p, i) {
                return '<div class="lw-f2-prod-row">' +
                    '<span class="lw-f2-prod-num">' + (i + 1) + '</span>' +
                    '<div class="lw-f2-prod-info">' +
                        '<input class="lw-f2-prod-desc-input" type="text" value="' + esc(p.desc || '') + '" placeholder="Descripción" oninput="lwP2ProdField(' + i + ', \'desc\', this.value)">' +
                        '<div class="lw-f2-prod-sub-inputs">' +
                            '<input type="text" value="' + esc(p.marca || '') + '" placeholder="Marca" oninput="lwP2ProdField(' + i + ', \'marca\', this.value)">' +
                            '<input type="text" value="' + esc(p.modelo || '') + '" placeholder="Modelo / No. Parte" oninput="lwP2ProdField(' + i + ', \'modelo\', this.value)">' +
                        '</div>' +
                    '</div>' +
                    '<label class="lw-f2-prod-qty"><span>Cant</span>' +
                        '<input type="number" min="0" step="1" value="' + (p.qty || 1) + '" oninput="lwP2ProdField(' + i + ', \'qty\', this.value)">' +
                    '</label>' +
                    '<button type="button" class="lw-f2-prod-del" onclick="lwP2DelProd(' + i + ')" title="Eliminar">×</button>' +
                '</div>';
            }).join('') +
            '</div>' +
            '<button type="button" class="lw-ghost-btn" style="margin-top:8px;" onclick="lwP2AddBlankProd()">' +
                '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>' +
                'Agregar fila en blanco' +
            '</button>';
    }

    // Update generico de cualquier campo del producto, sin re-render
    // para no perder el foco mientras el usuario escribe.
    window.lwP2ProdField = function (i, field, val) {
        var f2 = state.lev.fase2_data || {};
        var prods = f2.productos || [];
        if (!prods[i]) return;
        if (field === 'qty') prods[i].qty = parseInt(val, 10) || 0;
        else prods[i][field] = val;
        state.lev.fase2_data = f2;
        lwFieldChange();
    };
    // Compat con el handler viejo
    window.lwP2ProdQty = function (i, val) { lwP2ProdField(i, 'qty', val); };

    // Agrega una fila vacia para llenar a mano
    window.lwP2AddBlankProd = function () {
        var f2 = state.lev.fase2_data || {};
        f2.productos = f2.productos || [];
        f2.productos.push({
            id: null, desc: '', marca: '', modelo: '',
            unidad: 'PZA', precio: 0,
            qty: 1, partida: f2.productos.length + 1,
        });
        state.lev.fase2_data = f2;
        renderPhase2Productos();
        renderPhase2();
        _lwF2RecomputeProgress();
        lwFieldChange();
        // Auto-focus la descripcion de la nueva fila
        setTimeout(function () {
            var rows = document.querySelectorAll('.lw-f2-prod-desc-input');
            if (rows.length) rows[rows.length - 1].focus();
        }, 50);
    };

    window.lwP2DelProd = function (i) {
        var f2 = state.lev.fase2_data || {};
        if (!f2.productos) return;
        f2.productos.splice(i, 1);
        state.lev.fase2_data = f2;
        renderPhase2Productos();
        // re-render partidas (ahora con índices correctos)
        renderPhase2();
        _lwF2RecomputeProgress();
        lwFieldChange();
    };

    // ── Catálogo en Fase 2 ─────────────────────────────────
    window.lwP2OpenCatalog = function () {
        var box = $('lwP2CatalogBox');
        if (!box) return;
        box.style.display = 'block';
        var inp = $('lwP2CatalogSearch');
        if (inp) { inp.value = ''; inp.focus(); }
        $('lwP2CatalogList').innerHTML = '<div class="lw-catalog-empty">Escribe al menos 2 caracteres para buscar…</div>';
    };
    window.lwP2CloseCatalog = function () {
        var box = $('lwP2CatalogBox');
        if (box) box.style.display = 'none';
    };
    var _p2CatTimer = null;
    window.lwP2CatalogSearch = function () {
        var q = ($('lwP2CatalogSearch').value || '').trim();
        if (_p2CatTimer) clearTimeout(_p2CatTimer);
        if (q.length < 2) {
            $('lwP2CatalogList').innerHTML = '<div class="lw-catalog-empty">Escribe al menos 2 caracteres para buscar…</div>';
            return;
        }
        _p2CatTimer = setTimeout(function () {
            apiFetch('/app/api/iamet/catalogo-productos/?q=' + encodeURIComponent(q) + '&limit=40').then(function (r) {
                var list = (r && r.ok && r.data) ? r.data : [];
                _p2RenderCatalogList(list);
            });
        }, 220);
    };
    function _p2RenderCatalogList(list) {
        var wrap = $('lwP2CatalogList');
        if (!wrap) return;
        var q = ($('lwP2CatalogSearch').value || '').trim();
        if (!list.length) {
            // Empty state con opcion de agregar manual — util porque el
            // catalogo CatalogoCableado solo tiene productos de cableado.
            // Para camaras/NVRs/etc el usuario agrega a mano.
            wrap.innerHTML =
                '<div class="lw-catalog-empty" style="padding:16px 14px;">' +
                    '<div style="color:#64748B;margin-bottom:10px;">No encontré "<b>' + esc(q) + '</b>" en el catálogo.</div>' +
                    '<button type="button" class="lw-ghost-btn" onclick="lwP2AddManualFromSearch()" style="border-color:#2563EB;color:#2563EB;">' +
                        '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>' +
                        'Agregar "' + esc(q) + '" manualmente' +
                    '</button>' +
                '</div>';
            return;
        }
        wrap.innerHTML = list.map(function (p, i) {
            return '<div class="lw-catalog-row" onclick="lwP2CatalogAdd(' + i + ')">' +
                '<div>' +
                    '<div class="lw-catalog-desc">' + esc(p.desc) + '</div>' +
                    '<div class="lw-catalog-sub">' + esc(p.marca || '—') + ' · ' + esc(p.modelo || '—') + '</div>' +
                '</div>' +
                '<div class="lw-catalog-price">' + fmtMoney(p.precio || 0) + '</div>' +
            '</div>';
        }).join('');
        window._lwP2CatalogCurrent = list;
    }

    // Agrega un producto manual (lo que el usuario escribio en el search
    // como descripcion). Marca/modelo quedan vacios para que el edite despues.
    window.lwP2AddManualFromSearch = function () {
        var q = ($('lwP2CatalogSearch').value || '').trim();
        if (!q) return;
        var f2 = state.lev.fase2_data || {};
        f2.productos = f2.productos || [];
        f2.productos.push({
            id: null, desc: q, marca: '', modelo: '',
            unidad: 'PZA', precio: 0,
            qty: 1, partida: f2.productos.length + 1,
        });
        state.lev.fase2_data = f2;
        // Limpiar search y cerrar catalogo
        $('lwP2CatalogSearch').value = '';
        lwP2CloseCatalog();
        renderPhase2Productos();
        renderPhase2();
        _lwF2RecomputeProgress();
        lwFieldChange();
        lwCheer('✓ Material agregado', esc(q).slice(0, 80));
    };
    window.lwP2CatalogAdd = function (i) {
        var list = window._lwP2CatalogCurrent || [];
        var p = list[i];
        if (!p) return;
        var f2 = state.lev.fase2_data || {};
        f2.productos = f2.productos || [];
        f2.productos.push({
            id: p.id, desc: p.desc, marca: p.marca, modelo: p.modelo,
            unidad: p.unidad || 'PZA', precio: p.precio || 0,
            qty: 1, partida: f2.productos.length + 1,
        });
        state.lev.fase2_data = f2;
        renderPhase2Productos();
        renderPhase2();
        _lwF2RecomputeProgress();
        lwFieldChange();
        lwCheer('✓ Material agregado', esc(p.desc).slice(0, 80));
    };

    // ── Progress bar Fase 2 ─────────────────────────────────
    function _lwF2RecomputeProgress() {
        if (!state.lev) return;
        var f2 = state.lev.fase2_data || {};
        var prog = f2.programa || {};
        var specs = (f2.especificaciones || []).filter(function (s) { return s && s.trim(); });
        var prods = (f2.productos || []).length;
        var fotos = (state.lev.evidencias || []).length;
        var hasProg = !!(prog.fecha_inicio || prog.fecha_fin);
        var items = [
            { done: specs.length > 0, label: 'Especificación técnica' },
            { done: prods > 0,        label: 'Producto o material' },
            { done: fotos > 0,        label: 'Foto de evidencia' },
            { done: hasProg,          label: 'Programa con fechas' },
        ];
        var done = items.filter(function (i) { return i.done; }).length;
        var pct = Math.round(done / items.length * 100);
        var pctEl = document.getElementById('lwF2ProgressPct');
        var fillEl = document.getElementById('lwF2ProgressFill');
        var statusEl = document.getElementById('lwF2Status');
        if (pctEl) pctEl.textContent = pct + '%';
        if (fillEl) {
            fillEl.style.width = pct + '%';
            fillEl.classList.toggle('done', pct === 100);
        }
        if (statusEl) {
            var remaining = items.length - done;
            if (pct === 100) {
                statusEl.classList.add('ready');
                statusEl.innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg><span>Listo para Fase 3</span>';
            } else if (pct >= 50) {
                statusEl.classList.add('ready');
                statusEl.innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg><span>Puedes avanzar · ' + pct + '%</span>';
            } else {
                statusEl.classList.remove('ready');
                statusEl.innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>' + (remaining === 1 ? 'Falta 1 dato' : 'Faltan ' + remaining + ' datos') + '</span>';
            }
        }
    }
    window.lwP2ToggleExpand = function (idx) {
        var card = document.querySelector('.lw-prod-card[data-idx="' + idx + '"]');
        if (!card) return;
        var body = card.querySelector('.lw-prod-body');
        var chev = card.querySelector('.lw-prod-chev');
        var open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        if (chev) chev.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
    };
    window.lwP2UpdateComment = function (idx, val) {
        var f2 = state.lev.fase2_data || {};
        f2.comentarios = f2.comentarios || {};
        f2.comentarios[idx] = val;
        state.lev.fase2_data = f2;
        lwFieldChange();
    };

    function renderPhase2Photos() {
        // Siempre refrescar tambien la isla 4 de Fase 1 (misma data).
        if (typeof lwF1RenderEvid === 'function') { try { lwF1RenderEvid(); } catch (e) {} }
        var zone = $('lwDropZone');
        if (!zone) return;
        var evs = state.lev.evidencias || [];
        var hasPhotos = evs.length > 0;
        zone.classList.toggle('lw-evid-empty', !hasPhotos);

        var thumbs = evs.map(function (ev) {
            return '<div class="lw-evid-thumb" onclick="lwP2Lightbox(' + ev.id + ')">' +
                '<img src="' + esc(ev.url) + '" alt="">' +
                '<button type="button" class="lw-evid-del" title="Eliminar" onclick="event.stopPropagation(); lwP2DeleteEvidencia(' + ev.id + ')">×</button>' +
                (ev.nombre_original ? '<div class="lw-evid-name">' + esc(ev.nombre_original) + '</div>' : '') +
            '</div>';
        }).join('');

        var addCard = '<label class="lw-evid-add-card" for="lw_f2_photo_input" title="Agregar fotos">' +
            (hasPhotos
                ? '<div class="lw-evid-add-plus">+</div><div class="lw-evid-add-label">Agregar</div>'
                : '<div class="lw-evid-add-plus lw-evid-add-plus-lg">+</div>' +
                  '<div class="lw-evid-add-title">Arrastra fotos aquí</div>' +
                  '<div class="lw-evid-add-hint">o pega con <kbd>⌘V</kbd> &middot; click para seleccionar</div>' +
                  '<div class="lw-evid-add-hint-sm">JPG · PNG · WebP</div>') +
            '<input type="file" id="lw_f2_photo_input" accept="image/jpeg,image/png,image/webp" multiple hidden onchange="lwP2UploadFiles(this.files); this.value=\'\';">' +
        '</label>';

        zone.innerHTML = thumbs + addCard;
    }
    window.lwP2Lightbox = function (id) {
        var ev = (state.lev.evidencias || []).find(function (e) { return e.id === id; });
        if (!ev) return;
        $('lwLightboxImg').src = ev.url;
        $('lwLightbox').style.display = 'flex';
    };
    window.lwP2UploadFiles = function (files) {
        if (!files || !files.length) return;
        Array.from(files).forEach(function (f) { uploadEvidencia(f); });
    };
    window.lwP2DeleteEvidencia = function (id) {
        lwConfirm({
            title: 'Eliminar foto',
            message: '¿Seguro que quieres eliminar esta foto de la evidencia? Esta acción es permanente.',
            confirmLabel: 'Eliminar foto',
            cancelLabel: 'Cancelar',
            tone: 'danger',
        }).then(function (ok) {
            if (!ok) return;
            apiFetch('/app/api/iamet/evidencias/' + id + '/eliminar/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            }).then(function (r) {
                if (r.success) {
                    state.lev.evidencias = (state.lev.evidencias || []).filter(function (e) { return e.id !== id; });
                    renderPhase2Photos();
                    lwCheer('Foto eliminada');
                } else {
                    alert(r.error || 'No se pudo eliminar');
                }
            });
        });
    };
    function uploadEvidencia(file) {
        var fd = new FormData();
        fd.append('archivo', file);
        fd.append('comentario', file.name || '');
        fetch('/app/api/iamet/levantamientos/' + state.lev.id + '/evidencia/', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRFToken': getCsrf(), 'X-Requested-With': 'XMLHttpRequest' },
            body: fd,
        }).then(function (r) { return r.json(); }).then(function (r) {
            if (r.success) {
                state.lev.evidencias = state.lev.evidencias || [];
                state.lev.evidencias.push(r.data);
                renderPhase2Photos();
                showSaveFlash();
            } else {
                alert(r.error || 'Error subiendo foto');
            }
        });
    }
    // Drag & drop + paste — funciona tanto en Isla 4 de Fase 1 como en Fase 2
    function _bindEvidenciaDrop(id) {
        var dz = document.getElementById(id);
        if (!dz) return;
        dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('lw-drop-active'); });
        dz.addEventListener('dragleave', function () { dz.classList.remove('lw-drop-active'); });
        dz.addEventListener('drop', function (e) {
            e.preventDefault(); dz.classList.remove('lw-drop-active');
            var files = Array.from(e.dataTransfer.files || []).filter(function (f) { return f.type.indexOf('image/') === 0; });
            if (files.length) lwP2UploadFiles(files);
        });
    }
    document.addEventListener('DOMContentLoaded', function () {
        _bindEvidenciaDrop('lwDropZone');      // Fase 2
        _bindEvidenciaDrop('lwF1EvidZone');    // Fase 1 (Isla 4)
        window.addEventListener('paste', function (e) {
            if (!state.lev || $('levantamientoWizard').style.display === 'none') return;
            // Pegar fotos funciona en Fase 1 (isla 4) o Fase 2
            if (state.phase !== 1 && state.phase !== 2) return;
            var items = Array.from(e.clipboardData.items || []);
            var files = items.filter(function (it) { return it.type.indexOf('image/') === 0; }).map(function (it) { return it.getAsFile(); }).filter(Boolean);
            if (files.length) lwP2UploadFiles(files);
        });
    });

    function collectPhase2() {
        var f2 = state.lev.fase2_data || {};
        // Campos del formato — leídos directo del DOM
        [
            ['elaboro','lw_f2_elaboro'], ['doc_fecha','lw_f2_doc_fecha'],
            ['solicitante','lw_f2_solicitante'], ['departamento','lw_f2_departamento'],
            ['planta','lw_f2_planta'], ['areas','lw_f2_areas'],
            ['tipo_solucion','lw_f2_tipo_solucion'], ['fecha_inst','lw_f2_fecha_inst'],
            ['desc_proyecto','lw_f2_desc_proyecto'],
            ['notas_evidencia','lw_f2_notas_evidencia'],
        ].forEach(function (pair) {
            var el = $(pair[1]);
            if (el) f2[pair[0]] = el.value || '';
        });
        // Programa de implementación (movido desde Fase 1). Se guarda
        // como sub-objeto fase2_data.programa para no mezclar con el
        // resto de los campos del documento. Los PDFs leen de aqui
        // primero y de fase1_data como fallback para data vieja.
        var progMap = {
            fecha_inicio:  'lw_f2_prog_fecha_inicio',
            fecha_fin:     'lw_f2_prog_fecha_fin',
            duracion:      'lw_f2_prog_duracion',
            apoyo_cliente: 'lw_f2_prog_apoyo_cliente',
            personal_req:  'lw_f2_prog_personal_req',
            elev_alto:     'lw_f2_prog_elev_alto',
            elev_ancho:    'lw_f2_prog_elev_ancho',
            elev_modelo:   'lw_f2_prog_elev_modelo',
        };
        var prog = f2.programa || {};
        Object.keys(progMap).forEach(function (k) {
            var el = $(progMap[k]);
            if (el) prog[k] = el.value || '';
        });
        f2.programa = prog;
        state.lev.fase2_data = f2;
        return f2;
    }

    // Notas sobre las evidencias — textarea libre en Isla 2 de Fase 2
    window.lwF2NotasEvidenciaInput = function (el) {
        var f2 = state.lev.fase2_data || {};
        f2.notas_evidencia = el.value || '';
        state.lev.fase2_data = f2;
        lwFieldChange();
    };

    // Handler de los inputs del Programa de Implementación (movido a Fase 2).
    // Guarda directo en state.lev.fase2_data.programa para que el save
    // recoja el valor al autosave.
    window.lwF2ProgInput = function (el, key) {
        var f2 = state.lev.fase2_data || {};
        f2.programa = f2.programa || {};
        f2.programa[key] = el.value || '';
        state.lev.fase2_data = f2;
        lwRefreshMetaPill(el);
        lwFieldChange();
        // Si cambian fechas → re-evaluar banner mismatch en vivo
        if (key === 'fecha_inicio' || key === 'fecha_fin') {
            _lwF2UpdateMismatchBanner();
        }
    };

    // Turno del Programa (chip single-select, ahora en Fase 2).
    window.lwF2ProgSetTurno = function (t) {
        var f2 = state.lev.fase2_data || {};
        f2.programa = f2.programa || {};
        f2.programa.turno = (f2.programa.turno === t) ? '' : t;
        state.lev.fase2_data = f2;
        _lwF2RenderTurnoChips();
        lwFieldChange();
    };

    function _lwF2RenderTurnoChips() {
        var turnoEl = $('lw_f2_prog_turno_chips');
        if (!turnoEl) return;
        var f2 = state.lev.fase2_data || {};
        var current = (f2.programa && f2.programa.turno) || '';
        turnoEl.innerHTML = ['Diurno', 'Nocturno', 'Mixto'].map(function (t) {
            var on = current === t;
            return '<button type="button" class="lw-chip' + (on ? ' sel' : '') + '" onclick="lwF2ProgSetTurno(\'' + t + '\')">' +
                (on ? '<i></i>' : '') + t + '</button>';
        }).join('');
    }

    // Rellenar los inputs de programa cuando se abre Fase 2.
    function _lwF2FillPrograma() {
        var f2 = state.lev.fase2_data || {};
        var f1 = state.lev.fase1_data || {};
        // Fuente: primero fase2.programa (nuevo), luego fase1 (legacy)
        var prog = f2.programa || {};
        var keys = ['fecha_inicio','fecha_fin','duracion','apoyo_cliente','personal_req','elev_alto','elev_ancho','elev_modelo'];
        keys.forEach(function (k) {
            var el = $('lw_f2_prog_' + k);
            if (!el) return;
            var v = (prog[k] != null && prog[k] !== '') ? prog[k] : (f1[k] || '');
            el.value = v;
            lwRefreshMetaPill(el);
        });
        // Migrar turno legacy si no existe en fase2
        if (!prog.turno && f1.turno) {
            prog.turno = f1.turno;
            f2.programa = prog;
            state.lev.fase2_data = f2;
        }
        _lwF2RenderTurnoChips();
        _lwF2UpdateMismatchBanner();
    }

    // Banner: el proyecto YA tiene fechas distintas a las del Programa
    // de Implementación. El backend respeta las fechas existentes del
    // proyecto y NO las pisa salvo que el usuario apriete "Sobrescribir".
    function _lwF2UpdateMismatchBanner() {
        var box = $('lwF2FechasMismatch');
        if (!box) return;
        var f2 = state.lev.fase2_data || {};
        var prog = f2.programa || {};
        var pIni = prog.fecha_inicio || '';
        var pFin = prog.fecha_fin || '';
        var proyIni = state.lev.proyecto_fecha_inicio || '';
        var proyFin = state.lev.proyecto_fecha_fin || '';
        // Solo aviso cuando AMBOS lados tienen fecha y al menos una difiere.
        var iniDiff = !!(pIni && proyIni && pIni !== proyIni);
        var finDiff = !!(pFin && proyFin && pFin !== proyFin);
        if (!iniDiff && !finDiff) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }
        function fmt(d) {
            if (!d) return '—';
            var p = String(d).split('-');
            if (p.length !== 3) return d;
            return p[2] + '/' + p[1] + '/' + p[0];
        }
        box.innerHTML =
            '<div class="lw-f2-fechas-mismatch">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
                '<div class="lw-f2-fechas-mismatch-text">' +
                    'El proyecto ya tiene fechas distintas: <b>' + fmt(proyIni) + ' → ' + fmt(proyFin) + '</b>. ' +
                    'Tu Programa de Implementación marca <b>' + fmt(pIni) + ' → ' + fmt(pFin) + '</b>. ' +
                    'Por defecto se respetan las del proyecto.' +
                '</div>' +
                '<button type="button" class="lw-f2-fechas-mismatch-btn" onclick="lwF2OverrideProyectoFechas()">Sobrescribir</button>' +
            '</div>';
        box.style.display = '';
    }

    // Sobrescribir las fechas del proyecto con las del Programa de
    // Implementación. Reenvía la fase 2 con flag explícito.
    window.lwF2OverrideProyectoFechas = function () {
        if (!state.lev || !state.lev.id) return;
        var f2 = state.lev.fase2_data || {};
        var prog = f2.programa || {};
        if (!prog.fecha_inicio && !prog.fecha_fin) return;
        var body = JSON.stringify({
            fase: 2,
            data: f2,
            fase_actual: state.lev.fase_actual,
            force_override_proyecto_fechas: true,
        });
        apiFetch('/app/api/iamet/levantamientos/' + state.lev.id + '/fase/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body,
        }).then(function (r) {
            if (r && r.success && r.data) {
                state.lev.proyecto_fecha_inicio = r.data.proyecto_fecha_inicio;
                state.lev.proyecto_fecha_fin = r.data.proyecto_fecha_fin;
                _lwF2UpdateMismatchBanner();
                if (typeof lwCheer === 'function') {
                    lwCheer('Fechas del proyecto actualizadas', 'El Programa de Obra usará el nuevo rango.', 'ok');
                }
            }
        });
    };

    // ── Especificaciones + Comentarios (listas editables tipo bullet) ──
    function renderP2SpecList(kind, items) {
        var listEl = $(kind === 'especificaciones' ? 'lw_f2_especif_list' : 'lw_f2_coment_list');
        if (!listEl) return;
        items = items || [];
        listEl.innerHTML = items.map(function (txt, idx) {
            return '<div class="lw-p2-specs-row">' +
                '<span class="lw-p2-specs-bullet"></span>' +
                '<input type="text" class="lw-p2-specs-input" value="' + esc(txt) + '" placeholder="Escribe aquí…" ' +
                    'oninput="lwP2SpecUpdate(\'' + kind + '\',' + idx + ', this.value)" ' +
                    'onkeydown="lwP2SpecKey(event, \'' + kind + '\',' + idx + ')">' +
                '<button type="button" class="lw-p2-specs-del" onclick="lwP2SpecDel(\'' + kind + '\',' + idx + ')" title="Eliminar">×</button>' +
            '</div>';
        }).join('');
    }

    window.lwP2AddSpec = function (kind) {
        var key = kind === 'especificaciones' ? 'especificaciones' : 'comentarios_spec';
        var f2 = state.lev.fase2_data || {};
        f2[key] = f2[key] || [];
        f2[key].push('');
        state.lev.fase2_data = f2;
        renderP2SpecList(kind, f2[key]);
        // Focus en el input recién creado
        setTimeout(function () {
            var listEl = $(kind === 'especificaciones' ? 'lw_f2_especif_list' : 'lw_f2_coment_list');
            if (listEl) {
                var inputs = listEl.querySelectorAll('.lw-p2-specs-input');
                if (inputs.length) inputs[inputs.length - 1].focus();
            }
        }, 30);
        lwFieldChange();
    };

    window.lwP2SpecUpdate = function (kind, idx, val) {
        var key = kind === 'especificaciones' ? 'especificaciones' : 'comentarios_spec';
        var f2 = state.lev.fase2_data || {};
        f2[key] = f2[key] || [];
        f2[key][idx] = val;
        state.lev.fase2_data = f2;
        lwFieldChange();
    };

    window.lwP2SpecDel = function (kind, idx) {
        var key = kind === 'especificaciones' ? 'especificaciones' : 'comentarios_spec';
        var f2 = state.lev.fase2_data || {};
        f2[key] = f2[key] || [];
        f2[key].splice(idx, 1);
        state.lev.fase2_data = f2;
        renderP2SpecList(kind, f2[key]);
        lwFieldChange();
    };

    // Enter → agrega nueva fila; Backspace en vacío → elimina
    window.lwP2SpecKey = function (e, kind, idx) {
        if (e.key === 'Enter') {
            e.preventDefault();
            lwP2AddSpec(kind);
        } else if (e.key === 'Backspace' && !e.currentTarget.value) {
            e.preventDefault();
            var key = kind === 'especificaciones' ? 'especificaciones' : 'comentarios_spec';
            var f2 = state.lev.fase2_data || {};
            if ((f2[key] || []).length > 1) lwP2SpecDel(kind, idx);
        }
    };

    // ── Dropdown PDF ───────────────────────────────────────
    window.lwPdfMenuToggle = function (e) {
        if (e) e.stopPropagation();
        var m = $('lwPdfMenu');
        if (!m) return;
        m.style.display = m.style.display === 'block' ? 'none' : 'block';
    };
    document.addEventListener('click', function (e) {
        var wrap = $('lwPdfWrap');
        var menu = $('lwPdfMenu');
        if (!wrap || !menu || menu.style.display !== 'block') return;
        if (!wrap.contains(e.target)) menu.style.display = 'none';
    });

    // Genera el PDF/Excel vía endpoint server-side.
    //   Fase 1 → /levantamiento-pdf/     modes: 'view' | 'download'
    //   Fase 2 → /propuesta-pdf/         modes: 'view' | 'download'
    //   Fase 3 → /volumetria-pdf/ + /volumetria-xlsx/
    //            modes: 'view-vol-full' | 'dl-vol-full' | 'dl-vol-nocost' | 'dl-vol-xlsx'
    window.lwPdfExport = function (mode) {
        if (!state.lev) return;
        $('lwPdfMenu').style.display = 'none';
        var base = '/app/api/iamet/levantamientos/' + state.lev.id + '/';
        var url;
        if (state.phase === 3) {
            if (mode === 'dl-vol-xlsx') {
                url = base + 'volumetria-xlsx/';
            } else if (mode === 'view-vol-full') {
                url = base + 'volumetria-pdf/';
            } else if (mode === 'dl-vol-full') {
                url = base + 'volumetria-pdf/?download=1';
            } else if (mode === 'dl-vol-nocost') {
                url = base + 'volumetria-pdf/?download=1&sin_costos=1';
            } else {
                return;
            }
        } else if (state.phase === 4) {
            if (!state.lev.proyecto_id) {
                alert('Este levantamiento no está asociado a un proyecto.');
                return;
            }
            var poBase = '/app/api/iamet/proyectos/' + state.lev.proyecto_id + '/programa-obra-pdf/';
            if (mode === 'view-po') {
                url = poBase;
            } else if (mode === 'dl-po') {
                url = poBase + '?download=1';
            } else {
                return;
            }
        } else if (state.phase === 5) {
            var rpBase = base + 'reporte-pdf/';
            if (mode === 'view-rp') {
                url = rpBase;
            } else if (mode === 'dl-rp') {
                url = rpBase + '?download=1';
            } else {
                return;
            }
        } else {
            var endpoint = state.phase === 1 ? 'levantamiento-pdf' : 'propuesta-pdf';
            url = base + endpoint + '/' + (mode === 'download' ? '?download=1' : '');
        }
        // Flush pendientes primero para que el export tenga la data fresca.
        lwFlushSave().then(function () { window.open(url, '_blank'); });
    };

    // ═══════════════════════════════════════════════════════════════
    //  PHASE 3 — VOLUMETRÍA
    // ═══════════════════════════════════════════════════════════════
    function calcMatRow(r) {
        var costoC = (r.costoUnit || 0) * (1 - (r.descCompra || 0) / 100);
        var precioV = (r.precioLista || 0) * (1 - (r.descVenta || 0) / 100);
        return { costoTotal: costoC * (r.qty || 0), precioVenta: precioV * (r.qty || 0) };
    }

    // ═══════════════════════════════════════════════════════════════
    //  PHASE 3 — VOLUMETRÍA (panel de borradores + editor)
    //  ─────────────────────────────────────────────────────────────
    //  Un levantamiento puede tener N volumetrías (escenarios).
    //  Al entrar a Fase 3 ves un panel listándolas; al click abres
    //  el editor (las 3 tablas). El editor existente opera sobre
    //  state.lev.fase3_data — cuando hay volumetría activa hacemos
    //  un alias `state.lev.fase3_data = state.volumetriaActiva.data`
    //  para que el editor "no sepa" que cambió la fuente. El save
    //  (lwSave) detecta el modo y redirige al endpoint correcto.
    // ═══════════════════════════════════════════════════════════════
    function renderPhase3() {
        // Estado inicial: ningún panel ni editor visible mientras
        // se determinan las volumetrías.
        var panel  = $('lwP3Panel');
        var wrap   = $('lwP3Wrap');
        if (panel) panel.style.display = 'none';
        if (wrap)  wrap.style.display  = 'none';

        // Si ya hay volumetría activa (volvimos del wizard mismo) y
        // estamos en el mismo levantamiento → render directo.
        if (state.volumetriaActiva && state.volumetriaActiva.levantamiento_id === state.lev.id) {
            _renderPhase3Editor();
            return;
        }
        // Limpia estado previo y carga volumetrías
        state.volumetriaActiva = null;
        _lwP3FetchVolumetrias();
    }

    function _lwP3FetchVolumetrias() {
        if (!state.lev || !state.lev.id) return;
        apiFetch('/app/api/iamet/levantamientos/' + state.lev.id + '/volumetrias/').then(function (r) {
            if (!r || !r.ok) {
                _lwP3RenderPanel([], false);
                return;
            }
            state.volumetrias = r.data || [];
            state.volumetriasPuedeEditar = !!r.puede_editar;
            _lwP3RenderPanel(state.volumetrias, state.volumetriasPuedeEditar);
        });
    }

    function _lwP3RenderPanel(list, puedeEditar) {
        var panel = $('lwP3Panel');
        var wrap  = $('lwP3Wrap');
        if (!panel) return;
        if (wrap)  wrap.style.display  = 'none';
        panel.style.display = 'block';

        var h = '';
        h += '<div class="lw-p3-panel-head">';
        h += '<div>';
        h += '<h2 class="lw-p3-panel-title">Volumetrías</h2>';
        h += '<p class="lw-p3-panel-sub">Crea distintos escenarios de la volumetría. Sólo las marcadas como <b>completadas</b> son visibles para vendedores.</p>';
        h += '</div>';
        if (puedeEditar) {
            h += '<button type="button" class="lw-p3-btn-primary" onclick="lwP3CrearVolumetria()">';
            h += '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
            h += 'Iniciar volumetría</button>';
        }
        h += '</div>';

        if (!list.length) {
            h += '<div class="lw-p3-empty">';
            if (puedeEditar) {
                h += '<button type="button" class="lw-p3-empty-cta" onclick="lwP3CrearVolumetria()">';
                h += '<svg width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>';
                h += '<div class="lw-p3-empty-title">Iniciar volumetría</div>';
                h += '<div class="lw-p3-empty-sub">Construye el desglose de materiales, mano de obra y gastos.</div>';
                h += '</button>';
            } else {
                h += '<div class="lw-p3-empty-readonly">';
                h += '<svg width="36" height="36" fill="none" stroke="#94A3B8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
                h += '<div style="margin-top:14px;font-weight:600;color:#0F172A;">Aún no hay volumetrías completadas</div>';
                h += '<div style="margin-top:6px;font-size:12.5px;color:#64748B;">El ingeniero las publicará aquí cuando estén listas.</div>';
                h += '</div>';
            }
            h += '</div>';
        } else {
            h += '<div class="lw-p3-table-wrap">';
            h += '<table class="lw-p3-list-table"><thead><tr>';
            h += '<th>Volumetría</th><th>Estado</th><th>Creado por</th><th>Editado por</th><th>Última edición</th>';
            if (puedeEditar) h += '<th></th>';
            h += '</tr></thead><tbody>';
            list.forEach(function (v) {
                var pillCls = v.status === 'completada' ? 'lw-p3-pill-ok' : 'lw-p3-pill-draft';
                h += '<tr onclick="lwP3OpenVolumetria(' + v.id + ')">';
                h += '<td class="lw-p3-list-name">' + esc(v.nombre || ('Volumetría ' + v.id)) + '</td>';
                h += '<td><span class="lw-p3-pill ' + pillCls + '">' + esc(v.status_label || v.status) + '</span></td>';
                h += '<td>' + esc(v.creado_por_nombre || '—') + '</td>';
                h += '<td>' + esc(v.actualizado_por_nombre || '—') + '</td>';
                h += '<td class="lw-p3-list-date">' + _lwP3FmtFecha(v.fecha_actualizacion) + '</td>';
                if (puedeEditar) {
                    h += '<td class="lw-p3-list-actions" onclick="event.stopPropagation();">';
                    if (v.status !== 'completada') {
                        h += '<button type="button" class="lw-p3-list-del" title="Eliminar borrador" onclick="lwP3DeleteVolumetria(' + v.id + ', \'' + esc(v.nombre || '') + '\')">';
                        h += '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
                        h += '</button>';
                    }
                    h += '</td>';
                }
                h += '</tr>';
            });
            h += '</tbody></table></div>';
        }
        panel.innerHTML = h;
    }

    function _lwP3FmtFecha(iso) {
        if (!iso) return '—';
        try {
            var d = new Date(iso);
            var meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
            return d.getDate() + ' ' + meses[d.getMonth()] + ' ' + d.getFullYear();
        } catch (e) { return iso; }
    }

    window.lwP3CrearVolumetria = function () {
        if (!state.lev || !state.lev.id) return;
        // Cuántas hay ya, para sugerir nombre por default
        var sugerido = 'Volumetría ' + (((state.volumetrias || []).length) + 1);
        lwPrompt({
            title: 'Nueva volumetría',
            message: 'Pónle un nombre para distinguirla. Si lo dejas vacío, el sistema le asignará uno automáticamente.',
            placeholder: sugerido,
            defaultValue: '',
            confirmLabel: 'Crear',
            cancelLabel: 'Cancelar',
        }).then(function (nombre) {
            if (nombre === null) return; // canceló
            apiFetch('/app/api/iamet/levantamientos/' + state.lev.id + '/volumetrias/crear/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre: (nombre || '').trim() }),
            }).then(function (r) {
                if (r && r.success && r.data) {
                    lwP3OpenVolumetria(r.data.id);
                }
            });
        });
    };

    window.lwP3OpenVolumetria = function (id) {
        apiFetch('/app/api/iamet/volumetrias/' + id + '/').then(function (r) {
            if (!r || !r.ok || !r.data) return;
            state.volumetriaActiva = r.data;
            // Alias: el editor existente lee/escribe en fase3_data.
            // Apuntarlo físicamente a volumetria.data hace que todo
            // el código del editor "siga funcionando" sin tocarlo.
            state.lev.fase3_data = r.data.data || {};
            _renderPhase3Editor();
        });
    };

    window.lwP3VolverAlPanel = function () {
        // Flush save pendiente antes de salir del editor
        lwFlushSave();
        state.volumetriaActiva = null;
        // Limpia el alias (el editor del wizard no debe seguir escribiendo
        // en data de una volumetría que ya no estamos editando).
        state.lev.fase3_data = {};
        _lwP3FetchVolumetrias();
    };

    window.lwP3RenameVolumetria = function () {
        if (!state.volumetriaActiva) return;
        var v = state.volumetriaActiva;
        lwPrompt({
            title: 'Renombrar volumetría',
            placeholder: 'Volumetría 1',
            defaultValue: v.nombre || '',
            confirmLabel: 'Guardar',
            cancelLabel: 'Cancelar',
            required: true,
        }).then(function (nuevo) {
            if (nuevo === null) return;
            nuevo = (nuevo || '').trim();
            if (!nuevo) return;
            apiFetch('/app/api/iamet/volumetrias/' + v.id + '/actualizar/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre: nuevo }),
            }).then(function (r) {
                if (r && r.success && r.data) {
                    state.volumetriaActiva.nombre = r.data.nombre;
                    _lwP3RenderEditHead();
                }
            });
        });
    };

    // ── Modal genérico de confirmación ─────────────────────────
    // Promise<boolean>. Reemplaza confirm() nativo por un widget
    // consistente con el look del wizard. Soporta:
    //   opts.title, opts.message (string o HTML), opts.confirmLabel,
    //   opts.cancelLabel, opts.tone ('danger' | 'primary' | 'ok')
    // Esc o click en backdrop equivale a Cancelar.
    // Cierra cualquier modal de confirm/prompt que ya esté abierto.
    // Defensa contra apilar modales por dobles clicks o handlers que
    // se llaman varias veces.
    function _lwCloseExistingModals() {
        var existing = document.querySelectorAll('.lw-confirm-backdrop');
        existing.forEach(function (n) {
            if (n.parentNode) n.parentNode.removeChild(n);
        });
    }

    window.lwConfirm = function (opts) {
        opts = opts || {};
        var title = opts.title || 'Confirmar';
        var message = opts.message || '';
        var confirmLabel = opts.confirmLabel || 'Confirmar';
        var cancelLabel = opts.cancelLabel || 'Cancelar';
        var tone = opts.tone || 'primary';

        // Cerrar cualquier modal previo antes de abrir éste.
        _lwCloseExistingModals();

        return new Promise(function (resolve) {
            // Crear DOM
            var bd = document.createElement('div');
            bd.className = 'lw-confirm-backdrop';
            var box = document.createElement('div');
            box.className = 'lw-confirm-box lw-confirm-' + tone;
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            box.innerHTML =
                '<div class="lw-confirm-icon">' +
                    (tone === 'danger'
                        ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
                        : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>') +
                '</div>' +
                '<div class="lw-confirm-body">' +
                    '<div class="lw-confirm-title">' + esc(title) + '</div>' +
                    '<div class="lw-confirm-msg">' + (typeof message === 'string' ? message : '') + '</div>' +
                '</div>' +
                '<div class="lw-confirm-actions">' +
                    '<button type="button" class="lw-confirm-cancel">' + esc(cancelLabel) + '</button>' +
                    '<button type="button" class="lw-confirm-ok">' + esc(confirmLabel) + '</button>' +
                '</div>';
            bd.appendChild(box);
            document.body.appendChild(bd);
            // Auto-focus al confirmar
            setTimeout(function () {
                var ok = box.querySelector('.lw-confirm-ok');
                if (ok) ok.focus();
            }, 30);

            function close(result) {
                document.removeEventListener('keydown', onKey, true);
                if (bd.parentNode) bd.parentNode.removeChild(bd);
                resolve(result);
            }
            function onKey(e) {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
                else if (e.key === 'Enter') { e.preventDefault(); close(true); }
            }
            box.querySelector('.lw-confirm-cancel').onclick = function () { close(false); };
            box.querySelector('.lw-confirm-ok').onclick      = function () { close(true);  };
            bd.onclick = function (e) { if (e.target === bd) close(false); };
            document.addEventListener('keydown', onKey, true);
        });
    };

    // ── Modal genérico de prompt ────────────────────────────────
    // Reemplazo de prompt() nativo con widget consistente. Retorna
    // Promise<string|null>: null si canceló, string (puede ser '')
    // si confirmó. Soporta opts:
    //   title, message, placeholder, defaultValue, confirmLabel,
    //   cancelLabel, required (true → bloquea OK si está vacío).
    window.lwPrompt = function (opts) {
        opts = opts || {};
        var title = opts.title || 'Ingresa un valor';
        var message = opts.message || '';
        var placeholder = opts.placeholder || '';
        var defaultValue = opts.defaultValue || '';
        var confirmLabel = opts.confirmLabel || 'Aceptar';
        var cancelLabel = opts.cancelLabel || 'Cancelar';
        var required = !!opts.required;

        // Cerrar modal previo (defensa contra dobles clicks)
        _lwCloseExistingModals();

        return new Promise(function (resolve) {
            var bd = document.createElement('div');
            bd.className = 'lw-confirm-backdrop';
            var box = document.createElement('div');
            box.className = 'lw-confirm-box lw-confirm-primary lw-prompt-box';
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            box.innerHTML =
                '<div class="lw-confirm-icon">' +
                    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>' +
                '</div>' +
                '<div class="lw-confirm-body">' +
                    '<div class="lw-confirm-title">' + esc(title) + '</div>' +
                    (message ? '<div class="lw-confirm-msg">' + (typeof message === 'string' ? message : '') + '</div>' : '') +
                    '<input type="text" class="lw-prompt-input" placeholder="' + esc(placeholder) + '" value="' + esc(defaultValue) + '">' +
                '</div>' +
                '<div class="lw-confirm-actions">' +
                    '<button type="button" class="lw-confirm-cancel">' + esc(cancelLabel) + '</button>' +
                    '<button type="button" class="lw-confirm-ok">' + esc(confirmLabel) + '</button>' +
                '</div>';
            bd.appendChild(box);
            document.body.appendChild(bd);

            var input = box.querySelector('.lw-prompt-input');
            var okBtn = box.querySelector('.lw-confirm-ok');
            setTimeout(function () { input.focus(); input.select(); }, 30);

            function refreshOk() {
                if (required) {
                    okBtn.disabled = !input.value.trim();
                    okBtn.style.opacity = okBtn.disabled ? '0.5' : '';
                    okBtn.style.cursor = okBtn.disabled ? 'not-allowed' : '';
                }
            }
            refreshOk();
            input.addEventListener('input', refreshOk);

            function close(result) {
                document.removeEventListener('keydown', onKey, true);
                if (bd.parentNode) bd.parentNode.removeChild(bd);
                resolve(result);
            }
            function onKey(e) {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
                else if (e.key === 'Enter' && !okBtn.disabled) { e.preventDefault(); close(input.value); }
            }
            box.querySelector('.lw-confirm-cancel').onclick = function () { close(null); };
            okBtn.onclick = function () {
                if (okBtn.disabled) return;
                close(input.value);
            };
            bd.onclick = function (e) { if (e.target === bd) close(null); };
            document.addEventListener('keydown', onKey, true);
        });
    };

    window.lwP3ToggleStatus = function () {
        if (!state.volumetriaActiva) return;
        var v = state.volumetriaActiva;
        var nuevo = v.status === 'completada' ? 'borrador' : 'completada';

        function aplicar() {
            apiFetch('/app/api/iamet/volumetrias/' + v.id + '/actualizar/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: nuevo }),
            }).then(function (r) {
                if (r && r.success && r.data) {
                    state.volumetriaActiva.status = r.data.status;
                    state.volumetriaActiva.status_label = r.data.status_label;
                    _lwP3RenderEditHead();
                }
            });
        }

        // Solo confirmamos al SUBIR a completada (es la acción que cambia
        // la visibilidad para vendedores). Bajar a borrador es reversible
        // y se aplica directo.
        if (nuevo === 'completada') {
            lwConfirm({
                title: 'Marcar como completada',
                message:
                    'La volumetría <b>' + esc(v.nombre || '') + '</b> quedará visible para vendedores. ' +
                    'Podrán consultar las cantidades y descargarla en PDF/Excel (sin costos).<br><br>' +
                    'Puedes bajarla a borrador en cualquier momento.',
                confirmLabel: 'Marcar como completada',
                cancelLabel: 'Cancelar',
                tone: 'primary',
            }).then(function (ok) {
                if (ok) aplicar();
            });
        } else {
            aplicar();
        }
    };

    window.lwP3DeleteVolumetria = function (id, nombre) {
        lwConfirm({
            title: 'Eliminar volumetría',
            message:
                '¿Eliminar la volumetría <b>' + esc(nombre || ('#' + id)) + '</b>? ' +
                'Esta acción no se puede deshacer.',
            confirmLabel: 'Eliminar',
            cancelLabel: 'Cancelar',
            tone: 'danger',
        }).then(function (ok) {
            if (!ok) return;
            apiFetch('/app/api/iamet/volumetrias/' + id + '/eliminar/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }).then(function (r) {
                if (r && r.success) {
                    _lwP3FetchVolumetrias();
                } else {
                    alert((r && r.error) || 'No se pudo eliminar.');
                }
            });
        });
    };

    function _lwP3RenderEditHead() {
        var head = $('lwP3EditHead');
        if (!head) return;
        var v = state.volumetriaActiva || {};
        var puedeEditar = state.volumetriasPuedeEditar !== false;
        var pillCls = v.status === 'completada' ? 'lw-p3-pill-ok' : 'lw-p3-pill-draft';
        var h = '';
        h += '<button type="button" class="lw-p3-btn-back" onclick="lwP3VolverAlPanel()">';
        h += '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>';
        h += 'Volver al listado</button>';
        h += '<div class="lw-p3-edit-title-wrap">';
        h += '<div class="lw-p3-edit-title-line">';
        h += '<span class="lw-p3-edit-title">' + esc(v.nombre || 'Volumetría') + '</span>';
        if (puedeEditar) {
            h += ' <button type="button" class="lw-p3-rename-btn" title="Renombrar" onclick="lwP3RenameVolumetria()">';
            h += '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>';
            h += '</button>';
        }
        h += '</div>';
        h += '<span class="lw-p3-pill ' + pillCls + '">' + esc(v.status_label || v.status) + '</span>';
        h += '</div>';
        if (puedeEditar) {
            var btnLabel = v.status === 'completada' ? 'Bajar a borrador' : 'Marcar como completada';
            var btnCls = v.status === 'completada' ? 'lw-p3-btn-ghost' : 'lw-p3-btn-primary';
            h += '<button type="button" class="' + btnCls + '" onclick="lwP3ToggleStatus()">' + btnLabel + '</button>';
        }
        head.innerHTML = h;
    }

    function _renderPhase3Editor() {
        var panel = $('lwP3Panel');
        var wrap  = $('lwP3Wrap');
        if (panel) panel.style.display = 'none';
        if (wrap)  wrap.style.display  = 'block';
        _lwP3RenderEditHead();

        var d = state.lev.fase3_data || {};
        // Migrar productos de fase 1 si no hay materiales aún
        if (!d.materiales) {
            var prods = (state.lev.fase1_data || {}).productos || [];
            d.materiales = prods.map(function (p, i) {
                return {
                    partida: i + 1, qty: p.qty || 1, unid: p.unidad || 'PZA',
                    desc: p.desc || '', marca: p.marca || '', modelo: p.modelo || '',
                    costoUnit: Number(p.precio || 0) * 0.7, precioLista: Number(p.precio || 0),
                    descCompra: 0, descVenta: 0, proveedor: '', entrega: '',
                };
            });
        }
        if (!d.manoObra) d.manoObra = [];
        if (!d.gastos) d.gastos = [];
        // TC default 19.50 si no hay valor guardado
        if (!d.tipo_cambio) d.tipo_cambio = 19.50;
        state.lev.fase3_data = d;
        // Mantener el alias con la volumetría activa
        if (state.volumetriaActiva) state.volumetriaActiva.data = d;
        // Sincronizar el input de TC con el valor guardado
        var tcInput = $('lwP3TC');
        if (tcInput) tcInput.value = (d.tipo_cambio || 19.50);
        _p3RenderTCFecha();
        renderP3Materiales();
        renderP3ManoObra();
        renderP3Gastos();
        bindP3Delegation();
        recalcP3Summary();
    }

    // ── Helpers de celdas (Fase 3) ─────────────────────────────────
    // Generan el HTML de un input sin usar string concatenación + onevent
    // inline, para poder volver a atar handlers después de addRow/delete sin
    // re-generar TODA la tabla (que destruía el foco del usuario).
    function p3Input(kind, i, field, val, opts) {
        opts = opts || {};
        var typeAttr = kind === 'num' ? 'type="number"' : 'type="text"';
        var cls = kind === 'num' ? 'lw-p3-num-input' : 'lw-p3-txt-input';
        if (opts.mono) cls += ' lw-p3-mono';
        var style = opts.style ? ' style="' + opts.style + '"' : '';
        var v = val == null ? '' : val;
        if (kind === 'text') v = esc(String(v));
        return '<input ' + typeAttr + ' class="' + cls + '" value="' + v +
               '" data-p3-field="' + field + '"' + style + '>';
    }

    function renderP3Materiales() {
        var mat = state.lev.fase3_data.materiales || [];
        var body = $('lw_f3_mat_body');
        body.innerHTML = mat.map(function (r, i) {
            var c = calcMatRow(r);
            return '<tr data-p3-row="' + i + '" data-p3-tbl="materiales">' +
                '<td><span class="lw-p3-num">' + (i + 1) + '</span></td>' +
                '<td>' + p3Input('num',  i, 'qty',         r.qty || 0) + '</td>' +
                '<td>' + p3Input('text', i, 'unid',        r.unid || 'PZA', { style: 'width:48px;' }) + '</td>' +
                '<td>' + p3Input('text', i, 'desc',        r.desc || '',    { style: 'min-width:160px;' }) + '</td>' +
                '<td>' + p3Input('text', i, 'marca',       r.marca || '',   { style: 'width:84px;' }) + '</td>' +
                '<td>' + p3Input('text', i, 'modelo',      r.modelo || '',  { style: 'width:110px;', mono: true }) + '</td>' +
                '<td>' + p3Input('num',  i, 'costoUnit',   r.costoUnit || 0) + '</td>' +
                '<td>' + p3Input('num',  i, 'precioLista', r.precioLista || 0) + '</td>' +
                '<td>' + p3Input('num',  i, 'descCompra',  r.descCompra || 0) + '</td>' +
                '<td>' + p3Input('num',  i, 'descVenta',   r.descVenta || 0) + '</td>' +
                '<td class="num" data-p3-cell="costoTotal"><span class="lw-p3-mono">' + fmtMoney(c.costoTotal) + '</span></td>' +
                '<td class="num" data-p3-cell="precioVenta"><span class="lw-p3-mono lw-p3-bold">' + fmtMoney(c.precioVenta) + '</span></td>' +
                '<td>' + p3Input('text', i, 'proveedor', r.proveedor || '', { style: 'width:90px;' }) + '</td>' +
                '<td>' + p3Input('text', i, 'entrega',   r.entrega || '',   { style: 'width:72px;' }) + '</td>' +
                '<td><button type="button" class="lw-cell-del" data-p3-del="1" title="Eliminar fila">×</button></td>' +
            '</tr>';
        }).join('');
        updateP3MatFooter();
    }

    function updateP3MatFooter() {
        var mat = state.lev.fase3_data.materiales || [];
        var foot = $('lw_f3_mat_foot');
        var tot = mat.reduce(function (a, r) { var c = calcMatRow(r); return { c: a.c + c.costoTotal, v: a.v + c.precioVenta }; }, { c: 0, v: 0 });
        foot.innerHTML = '<tr class="lw-p3-foot">' +
            '<td colspan="10">Subtotal Materiales</td>' +
            '<td class="num lw-p3-mono">' + fmtMoney(tot.c) + '</td>' +
            '<td class="num lw-p3-mono lw-p3-bold">' + fmtMoney(tot.v) + '</td>' +
            '<td colspan="3"></td></tr>';
    }

    function renderP3ManoObra() {
        var rows = state.lev.fase3_data.manoObra || [];
        var body = $('lw_f3_mo_body');
        body.innerHTML = rows.map(function (r, i) {
            var total = (r.precioUnit || 0) * (r.qty || 0);
            return '<tr data-p3-row="' + i + '" data-p3-tbl="manoObra">' +
                '<td><span class="lw-p3-num">' + (i + 1) + '</span></td>' +
                '<td>' + p3Input('num',  i, 'qty',        r.qty || 0) + '</td>' +
                '<td>' + p3Input('text', i, 'unid',       r.unid || 'SERV', { style: 'width:60px;' }) + '</td>' +
                '<td>' + p3Input('text', i, 'desc',       r.desc || '',     { style: 'min-width:220px;' }) + '</td>' +
                '<td>' + p3Input('num',  i, 'precioUnit', r.precioUnit || 0) + '</td>' +
                '<td class="num" data-p3-cell="total"><span class="lw-p3-mono lw-p3-bold">' + fmtMoney(total) + '</span></td>' +
                '<td><button type="button" class="lw-cell-del" data-p3-del="1" title="Eliminar fila">×</button></td>' +
            '</tr>';
        }).join('');
        updateP3MOFooter();
    }

    function updateP3MOFooter() {
        var rows = state.lev.fase3_data.manoObra || [];
        var foot = $('lw_f3_mo_foot');
        var tot = rows.reduce(function (a, r) { return a + (r.precioUnit || 0) * (r.qty || 0); }, 0);
        foot.innerHTML = '<tr class="lw-p3-foot"><td colspan="5">Subtotal Mano de Obra</td><td class="num lw-p3-mono lw-p3-bold">' + fmtMoney(tot) + '</td><td></td></tr>';
    }

    function renderP3Gastos() {
        var rows = state.lev.fase3_data.gastos || [];
        var body = $('lw_f3_gas_body');
        body.innerHTML = rows.map(function (r, i) {
            var total = (r.costoUnit || 0) * (r.qty || 0);
            return '<tr data-p3-row="' + i + '" data-p3-tbl="gastos">' +
                '<td><span class="lw-p3-num">' + (i + 1) + '</span></td>' +
                '<td>' + p3Input('num',  i, 'qty',       r.qty || 0) + '</td>' +
                '<td>' + p3Input('text', i, 'unid',      r.unid || 'GLOB', { style: 'width:60px;' }) + '</td>' +
                '<td>' + p3Input('text', i, 'desc',      r.desc || '',     { style: 'min-width:220px;' }) + '</td>' +
                '<td>' + p3Input('num',  i, 'costoUnit', r.costoUnit || 0) + '</td>' +
                '<td class="num" data-p3-cell="total"><span class="lw-p3-mono lw-p3-bold">' + fmtMoney(total) + '</span></td>' +
                '<td><button type="button" class="lw-cell-del" data-p3-del="1" title="Eliminar fila">×</button></td>' +
            '</tr>';
        }).join('');
        updateP3GasFooter();
    }

    function updateP3GasFooter() {
        var rows = state.lev.fase3_data.gastos || [];
        var foot = $('lw_f3_gas_foot');
        var tot = rows.reduce(function (a, r) { return a + (r.costoUnit || 0) * (r.qty || 0); }, 0);
        foot.innerHTML = '<tr class="lw-p3-foot"><td colspan="5">Subtotal Gastos</td><td class="num lw-p3-mono lw-p3-bold">' + fmtMoney(tot) + '</td><td></td></tr>';
    }
    function recalcP3Summary() {
        var d = state.lev.fase3_data || {};
        var tc = parseFloat(d.tipo_cambio || 0);
        if (!tc || tc <= 0) tc = 19.5; // fallback
        var totMat = (d.materiales || []).reduce(function (a, r) { var c = calcMatRow(r); return { c: a.c + c.costoTotal, v: a.v + c.precioVenta }; }, { c: 0, v: 0 });
        var totMO = (d.manoObra || []).reduce(function (a, r) { return a + (r.precioUnit || 0) * (r.qty || 0); }, 0);
        var totGas = (d.gastos || []).reduce(function (a, r) { return a + (r.costoUnit || 0) * (r.qty || 0); }, 0);
        var totalVenta = totMat.v + totMO + totGas;
        var totalCosto = totMat.c + totGas;
        var utilidad = totalVenta - totalCosto;
        var margen = totalVenta > 0 ? (utilidad / totalVenta * 100) : 0;
        // USD
        $('lwSumMat').textContent = fmtMoney(totMat.v);
        $('lwSumMO').textContent = fmtMoney(totMO);
        $('lwSumGas').textContent = fmtMoney(totGas);
        $('lwSumVenta').textContent = fmtMoney(totalVenta);
        $('lwSumCosto').textContent = fmtMoney(totalCosto);
        $('lwSumUtil').textContent = fmtMoney(utilidad);
        // MXN (conversión con TC)
        var mxn = function (usd) { return fmtMoney(usd * tc); };
        var elMat = $('lwSumMatMXN');    if (elMat) elMat.textContent = mxn(totMat.v);
        var elMO  = $('lwSumMOMXN');     if (elMO)  elMO.textContent  = mxn(totMO);
        var elGas = $('lwSumGasMXN');    if (elGas) elGas.textContent = mxn(totGas);
        var elVt  = $('lwSumVentaMXN');  if (elVt)  elVt.textContent  = mxn(totalVenta);

        $('lwP3MarginPct').textContent = margen.toFixed(1) + '%';
        var badge = $('lwP3Badge');
        var bar = $('lwP3MarginBar');
        var color, bg;
        if (margen >= 30) { color = '#059669'; bg = '#DCFCE7'; }
        else if (margen >= 15) { color = '#B45309'; bg = '#FEF3C7'; }
        else { color = '#DC2626'; bg = '#FEE2E2'; }
        badge.style.background = bg;
        badge.style.color = color;
        bar.style.width = Math.min(Math.max(margen, 0), 100) + '%';
        bar.style.background = color;
        $('lwSumUtilLbl').style.color = color;
        $('lwSumUtil').style.color = color;
    }

    // Tipo de cambio — guarda en fase3_data y dispara recalc.
    window.lwP3SetTC = function (val) {
        var d = state.lev.fase3_data || {};
        var n = parseFloat(val);
        if (!n || n <= 0) return;
        d.tipo_cambio = n;
        // Guardar la fecha del primer cambio (se usa como "fecha de elaboración")
        if (!d.tipo_cambio_fecha) {
            d.tipo_cambio_fecha = new Date().toISOString().slice(0, 10);
            _p3RenderTCFecha();
        }
        state.lev.fase3_data = d;
        recalcP3Summary();
        lwFieldChange();
    };

    function _p3RenderTCFecha() {
        var d = state.lev.fase3_data || {};
        var el = $('lwP3TCFecha');
        if (!el) return;
        if (d.tipo_cambio_fecha) {
            el.textContent = 'Fijado el ' + d.tipo_cambio_fecha;
        } else {
            el.innerHTML = '&nbsp;';
        }
    }

    // ── Campos numéricos por tabla ────────────────────────────────
    var P3_NUM_FIELDS = {
        materiales: ['qty', 'costoUnit', 'precioLista', 'descCompra', 'descVenta'],
        manoObra:   ['qty', 'precioUnit'],
        gastos:     ['qty', 'costoUnit'],
    };

    // Actualiza SOLO las celdas calculadas de una fila (sin re-render),
    // preservando el foco del input que está editando el usuario.
    function p3UpdateRowTotals(tbl, i) {
        var tr = document.querySelector('#lw_f3_' + (tbl === 'materiales' ? 'mat' : tbl === 'manoObra' ? 'mo' : 'gas') + '_body tr[data-p3-row="' + i + '"]');
        if (!tr) return;
        var r = state.lev.fase3_data[tbl][i];
        if (!r) return;
        if (tbl === 'materiales') {
            var c = calcMatRow(r);
            var ct = tr.querySelector('[data-p3-cell="costoTotal"] span');
            var pv = tr.querySelector('[data-p3-cell="precioVenta"] span');
            if (ct) ct.textContent = fmtMoney(c.costoTotal);
            if (pv) pv.textContent = fmtMoney(c.precioVenta);
        } else {
            var total = tbl === 'manoObra'
                ? (r.precioUnit || 0) * (r.qty || 0)
                : (r.costoUnit || 0) * (r.qty || 0);
            var tot = tr.querySelector('[data-p3-cell="total"] span');
            if (tot) tot.textContent = fmtMoney(total);
        }
    }

    // Handler unificado — llamado desde el listener delegado
    function p3OnInput(tbl, i, field, val) {
        if ((P3_NUM_FIELDS[tbl] || []).indexOf(field) !== -1) val = parseFloat(val) || 0;
        state.lev.fase3_data[tbl][i][field] = val;
        p3UpdateRowTotals(tbl, i);
        if (tbl === 'materiales') updateP3MatFooter();
        else if (tbl === 'manoObra') updateP3MOFooter();
        else if (tbl === 'gastos') updateP3GasFooter();
        recalcP3Summary();
        lwFieldChange();
    }

    // Delegación de eventos: un solo listener por tabla que NO re-renderiza
    // → el foco del usuario nunca se pierde al escribir.
    function bindP3Delegation() {
        ['lw_f3_mat_body', 'lw_f3_mo_body', 'lw_f3_gas_body'].forEach(function (bodyId) {
            var body = $(bodyId);
            if (!body || body.dataset.p3Bound) return;
            body.dataset.p3Bound = '1';

            body.addEventListener('input', function (ev) {
                var inp = ev.target.closest('input[data-p3-field]');
                if (!inp) return;
                var tr = inp.closest('tr[data-p3-row]');
                if (!tr) return;
                var tbl = tr.getAttribute('data-p3-tbl');
                var i = parseInt(tr.getAttribute('data-p3-row'), 10);
                p3OnInput(tbl, i, inp.getAttribute('data-p3-field'), inp.value);
            });

            // Enter en último row → nueva fila + foco en descripción
            // Tab en última celda de última fila → también crea nueva fila
            body.addEventListener('keydown', function (ev) {
                if (ev.key !== 'Enter') return;
                var inp = ev.target.closest('input[data-p3-field]');
                if (!inp) return;
                var tr = inp.closest('tr[data-p3-row]');
                if (!tr) return;
                var tbl = tr.getAttribute('data-p3-tbl');
                var i = parseInt(tr.getAttribute('data-p3-row'), 10);
                var rows = state.lev.fase3_data[tbl] || [];
                ev.preventDefault();
                if (i === rows.length - 1) {
                    lwP3AddRow(tbl, /*focusDesc*/ true);
                } else {
                    // Siguiente fila, mismo campo
                    var field = inp.getAttribute('data-p3-field');
                    var next = body.querySelector('tr[data-p3-row="' + (i + 1) + '"] input[data-p3-field="' + field + '"]');
                    if (next) { next.focus(); next.select(); }
                }
            });

            body.addEventListener('click', function (ev) {
                var del = ev.target.closest('button[data-p3-del]');
                if (!del) return;
                var tr = del.closest('tr[data-p3-row]');
                if (!tr) return;
                var tbl = tr.getAttribute('data-p3-tbl');
                var i = parseInt(tr.getAttribute('data-p3-row'), 10);
                lwP3DelRow(tbl, i);
            });
        });
    }

    // Retrocompat: mantenemos los helpers globales por si algo los usa.
    window.lwP3Mat = function (i, field, val) { p3OnInput('materiales', i, field, val); };
    window.lwP3MO  = function (i, field, val) { p3OnInput('manoObra', i, field, val); };
    window.lwP3Gas = function (i, field, val) { p3OnInput('gastos', i, field, val); };
    // ── Catálogo (Fase 3) ────────────────────────────────────────
    // Reutiliza el endpoint /catalogo-productos/ del wizard pero con su
    // propio box. Al seleccionar un producto se agrega una fila a
    // "materiales" con precioLista y costoUnit preloados.
    window.lwP3OpenCatalog = function () {
        var box = $('lwP3CatalogBox');
        if (!box) return;
        box.style.display = 'block';
        var inp = $('lwP3CatalogSearch');
        if (inp) { inp.value = ''; inp.focus(); }
        $('lwP3CatalogList').innerHTML = '<div class="lw-catalog-empty">Escribe al menos 2 caracteres para buscar…</div>';
    };
    window.lwP3CloseCatalog = function () {
        var box = $('lwP3CatalogBox');
        if (box) box.style.display = 'none';
    };
    var _p3CatTimer = null;
    window.lwP3CatalogSearch = function () {
        var q = ($('lwP3CatalogSearch').value || '').trim();
        if (_p3CatTimer) clearTimeout(_p3CatTimer);
        if (q.length < 2) {
            $('lwP3CatalogList').innerHTML = '<div class="lw-catalog-empty">Escribe al menos 2 caracteres para buscar…</div>';
            return;
        }
        _p3CatTimer = setTimeout(function () {
            apiFetch('/app/api/iamet/catalogo-productos/?q=' + encodeURIComponent(q) + '&limit=40').then(function (r) {
                var list = (r && r.ok && r.data) ? r.data : [];
                _p3RenderCatalogList(list);
            });
        }, 220);
    };
    function _p3RenderCatalogList(list) {
        var wrap = $('lwP3CatalogList');
        if (!wrap) return;
        if (!list.length) {
            wrap.innerHTML = '<div class="lw-catalog-empty">Sin resultados</div>';
            return;
        }
        wrap.innerHTML = list.map(function (p, i) {
            return '<div class="lw-catalog-row" onclick="lwP3CatalogAdd(' + i + ')">' +
                '<div>' +
                    '<div class="lw-catalog-desc">' + esc(p.desc) + '</div>' +
                    '<div class="lw-catalog-sub">' + esc(p.marca || '—') + ' · ' + esc(p.modelo || '—') + '</div>' +
                '</div>' +
                '<div class="lw-catalog-price">' + fmtMoney(p.precio || 0) + '</div>' +
            '</div>';
        }).join('');
        window._lwP3CatalogCurrent = list;
    }
    window.lwP3CatalogAdd = function (i) {
        var list = window._lwP3CatalogCurrent || [];
        var p = list[i];
        if (!p) return;
        var d = state.lev.fase3_data;
        d.materiales = d.materiales || [];
        d.materiales.push({
            partida: d.materiales.length + 1,
            qty: 1,
            unid: p.unidad || 'PZA',
            desc: p.desc || '',
            marca: p.marca || '',
            modelo: p.modelo || '',
            costoUnit: Number(p.precio_proveedor || 0) || Number(p.precio || 0) * 0.7,
            precioLista: Number(p.precio || 0),
            descCompra: 0,
            descVenta: 0,
            proveedor: '',
            entrega: '',
        });
        renderP3Materiales();
        recalcP3Summary();
        lwFieldChange();
        // No cerramos el box — permite seguir agregando
        lwCheer('✓ Agregado', esc(p.desc).slice(0, 80));
    };

    window.lwP3AddRow = function (tabla, focusDesc) {
        var d = state.lev.fase3_data;
        var newIdx;
        if (tabla === 'materiales') {
            d.materiales.push({ partida: d.materiales.length + 1, qty: 1, unid: 'PZA', desc: '', marca: '', modelo: '', costoUnit: 0, precioLista: 0, descCompra: 0, descVenta: 0, proveedor: '', entrega: '' });
            newIdx = d.materiales.length - 1;
            renderP3Materiales();
        } else if (tabla === 'manoObra') {
            d.manoObra.push({ partida: d.manoObra.length + 1, qty: 1, unid: 'SERV', desc: '', precioUnit: 0 });
            newIdx = d.manoObra.length - 1;
            renderP3ManoObra();
        } else if (tabla === 'gastos') {
            d.gastos.push({ partida: d.gastos.length + 1, qty: 1, unid: 'GLOB', desc: '', costoUnit: 0 });
            newIdx = d.gastos.length - 1;
            renderP3Gastos();
        }
        recalcP3Summary();
        lwFieldChange();
        if (focusDesc && newIdx != null) {
            var bodyId = tabla === 'materiales' ? 'lw_f3_mat_body' : tabla === 'manoObra' ? 'lw_f3_mo_body' : 'lw_f3_gas_body';
            setTimeout(function () {
                var sel = '#' + bodyId + ' tr[data-p3-row="' + newIdx + '"] input[data-p3-field="desc"]';
                var inp = document.querySelector(sel);
                if (inp) { inp.focus(); inp.select(); }
            }, 0);
        }
    };
    window.lwP3DelRow = function (tabla, idx) {
        state.lev.fase3_data[tabla].splice(idx, 1);
        state.lev.fase3_data[tabla].forEach(function (r, i) { r.partida = i + 1; });
        if (tabla === 'materiales') renderP3Materiales();
        if (tabla === 'manoObra') renderP3ManoObra();
        if (tabla === 'gastos') renderP3Gastos();
        recalcP3Summary();
        lwFieldChange();
    };

    function collectPhase3() {
        return state.lev.fase3_data || {};
    }

    // ═══════════════════════════════════════════════════════════════
    //  PHASE 4 — PROGRAMA DE OBRA
    // ═══════════════════════════════════════════════════════════════
    // Fase 4 reutiliza el calendario semanal del widget de Proyectos.
    // La data se persiste en la tabla ProgramacionActividad (no en
    // fase4_data) → misma fuente de verdad que el módulo del proyecto.
    function renderPhase4() {
        var wrap = $('lwP4ProgramaWrap');
        if (!wrap) return;
        var lev = state.lev || {};

        if (!lev.proyecto_id) {
            wrap.innerHTML = '<div class="lw-p4-note">Este levantamiento no está asociado a un proyecto.</div>';
            return;
        }
        if (!lev.proyecto_fecha_inicio || !lev.proyecto_fecha_fin) {
            wrap.innerHTML = '<div class="lw-p4-note">Define <b>Fecha de inicio</b> y <b>Fecha de fin</b> del proyecto para activar el Programa de Obra.<br><small>Esas fechas viven en el widget del proyecto, no en el levantamiento.</small></div>';
            return;
        }
        if (typeof window.proyectosRenderProgramaObra !== 'function') {
            wrap.innerHTML = '<div class="lw-p4-note">Calendario no disponible. Recarga la página.</div>';
            return;
        }

        // Toggle Simple ↔ Avanzado + contenedores
        var savedMode = localStorage.getItem('ganttViewMode') || 'simple';
        wrap.innerHTML =
            '<div class="gantt-view-toggle" id="lwGanttToggle">' +
                '<button type="button" class="gantt-toggle-btn' + (savedMode === 'simple' ? ' active' : '') + '" data-mode="simple">Simple</button>' +
                '<button type="button" class="gantt-toggle-btn' + (savedMode === 'avanzado' ? ' active' : '') + '" data-mode="avanzado">Avanzado</button>' +
            '</div>' +
            '<div id="lwP4Simple" style="' + (savedMode === 'avanzado' ? 'display:none;' : '') + '">' +
                '<div id="lwP4ProgramaContainer"></div>' +
            '</div>' +
            '<div id="lwP4Avanzado" style="' + (savedMode === 'simple' ? 'display:none;' : '') + '"></div>';

        // Render vista simple (calendario semanal)
        window.proyectosRenderProgramaObra(lev.proyecto_id, {
            containerId: 'lwP4ProgramaContainer',
            projectDetail: {
                id: lev.proyecto_id,
                nombre: lev.proyecto_nombre || lev.nombre || '',
                fecha_inicio: lev.proyecto_fecha_inicio,
                fecha_fin: lev.proyecto_fecha_fin,
            },
        });

        // Render vista avanzada (Gantt) si es el modo guardado
        if (savedMode === 'avanzado' && typeof window.initGanttProgramaObra === 'function') {
            window.initGanttProgramaObra('lwP4Avanzado', lev.proyecto_id);
        }

        // Toggle click handler
        wrap.querySelector('#lwGanttToggle').addEventListener('click', function(e) {
            var btn = e.target.closest('.gantt-toggle-btn');
            if (!btn) return;
            var mode = btn.dataset.mode;
            wrap.querySelectorAll('.gantt-toggle-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var simpleEl = $('lwP4Simple');
            var avanzadoEl = $('lwP4Avanzado');
            if (simpleEl) simpleEl.style.display = mode === 'simple' ? '' : 'none';
            if (avanzadoEl) avanzadoEl.style.display = mode === 'avanzado' ? '' : 'none';
            localStorage.setItem('ganttViewMode', mode);
            if (mode === 'avanzado' && typeof window.initGanttProgramaObra === 'function') {
                window.initGanttProgramaObra('lwP4Avanzado', lev.proyecto_id);
            }
        });
    }

    function collectPhase4() { return state.lev.fase4_data || {}; }

    // ═══════════════════════════════════════════════════════════════
    //  PHASE 5 — REPORTE (editor rico tipo docs)
    //  ───────────────
    //  El ingeniero redacta libremente. El HTML se persiste en
    //  fase5_data.reporte_html y se renderiza en PDF con el logo
    //  Bajanet arriba.
    // ═══════════════════════════════════════════════════════════════
    function renderPhase5() {
        var editor = $('lw_f5_editor');
        if (!editor) return;
        var f5 = state.lev.fase5_data || {};
        var levId = String(state.lev.id || '');
        // Sólo re-montar el HTML cuando cambió el levantamiento (id) —
        // si ya estás editando el mismo, conservamos el cursor.
        if (editor.dataset.lwLevId !== levId) {
            editor.innerHTML = f5.reporte_html || '';
            editor.dataset.lwLevId = levId;
        }
        _p5UpdatePlaceholder();
    }

    function _p5UpdatePlaceholder() {
        var editor = $('lw_f5_editor');
        if (!editor) return;
        var isEmpty = !editor.textContent.trim() && editor.innerHTML.replace(/<br\s*\/?>|&nbsp;|\s+/g, '') === '';
        editor.classList.toggle('is-empty', isEmpty);
    }

    window.lwP5EditorInput = function () {
        var editor = $('lw_f5_editor');
        if (!editor) return;
        var f5 = state.lev.fase5_data || {};
        f5.reporte_html = editor.innerHTML;
        state.lev.fase5_data = f5;
        _p5UpdatePlaceholder();
        lwFieldChange();
    };

    // Ejecuta comandos del navegador (bold, italic, lists, etc.).
    // document.execCommand está "deprecated" pero sigue funcionando en
    // todos los navegadores y es la forma más simple sin añadir librerías.
    window.lwP5Format = function (cmd, value) {
        var editor = $('lw_f5_editor');
        if (!editor) return;
        editor.focus();
        try { document.execCommand(cmd, false, value || null); } catch (e) {}
        lwP5EditorInput();
    };

    window.lwP5FormatBlock = function (tag) {
        var editor = $('lw_f5_editor');
        if (!editor) return;
        editor.focus();
        // Safari/Chrome aceptan "<H2>" con angle brackets; otros sólo "H2"
        try { document.execCommand('formatBlock', false, tag); } catch (e) {
            try { document.execCommand('formatBlock', false, '<' + tag + '>'); } catch (e2) {}
        }
        lwP5EditorInput();
    };

    window.lwP5InsertTable = function () {
        var rowsS = prompt('¿Cuántas filas? (incluye encabezado)', '3');
        if (!rowsS) return;
        var colsS = prompt('¿Cuántas columnas?', '3');
        if (!colsS) return;
        var rows = Math.max(1, Math.min(20, parseInt(rowsS, 10) || 3));
        var cols = Math.max(1, Math.min(10, parseInt(colsS, 10) || 3));
        var html = '<table class="lw-rt-table"><thead><tr>';
        for (var c = 0; c < cols; c++) html += '<th>Columna ' + (c + 1) + '</th>';
        html += '</tr></thead><tbody>';
        for (var r = 1; r < rows; r++) {
            html += '<tr>';
            for (var c2 = 0; c2 < cols; c2++) html += '<td>&nbsp;</td>';
            html += '</tr>';
        }
        html += '</tbody></table><p>&nbsp;</p>';
        var editor = $('lw_f5_editor');
        editor.focus();
        try { document.execCommand('insertHTML', false, html); } catch (e) {}
        lwP5EditorInput();
    };

    window.lwP5InsertDivider = function () {
        var editor = $('lw_f5_editor');
        editor.focus();
        try { document.execCommand('insertHTML', false, '<hr class="lw-rt-hr"><p>&nbsp;</p>'); } catch (e) {}
        lwP5EditorInput();
    };

    // Paste con limpieza — si pegan desde Word o páginas, limpiamos
    // estilos inline pesados para que no ensucien el documento.
    window.lwP5OnPaste = function (ev) {
        var cd = ev.clipboardData || window.clipboardData;
        if (!cd) return;
        var html = cd.getData('text/html');
        if (html) {
            ev.preventDefault();
            // Eliminar atributos style y class inline que traen suciedad de Word.
            var clean = html.replace(/<!--[\s\S]*?-->/g, '')
                .replace(/\s(style|class|lang|id)="[^"]*"/gi, '')
                .replace(/<o:p[^>]*>[\s\S]*?<\/o:p>/gi, '')
                .replace(/<\/?(meta|link|span|font)[^>]*>/gi, '');
            try { document.execCommand('insertHTML', false, clean); } catch (e) {}
            lwP5EditorInput();
        }
        // texto plano: dejamos el default del navegador
    };

    // Toggle del menú "Insertar" (dropdown debajo del botón).
    // Posicionamos manualmente (position: fixed) para que no sea
    // recortado por el overflow:hidden de .lw-p5-wrap / .lw-content.
    window.lwP5InsertMenuToggle = function (e) {
        if (e) e.stopPropagation();
        var m = $('lwP5InsertMenu');
        if (!m) return;
        if (m.style.display === 'block') {
            m.style.display = 'none';
            return;
        }
        var btn = e && e.currentTarget;
        if (btn && btn.getBoundingClientRect) {
            var r = btn.getBoundingClientRect();
            // Abrir hacia abajo, alineado a la izquierda del botón
            m.style.top = (r.bottom + 6) + 'px';
            // Preferimos alineado a izquierda del botón; si se sale por la
            // derecha, lo pegamos al borde derecho de la ventana.
            var menuWidth = 340;
            var left = r.left;
            if (left + menuWidth > window.innerWidth - 12) {
                left = Math.max(12, window.innerWidth - menuWidth - 12);
            }
            m.style.left = left + 'px';
        }
        m.style.display = 'block';
    };
    // Cerrar al click fuera
    document.addEventListener('click', function (e) {
        var menu = $('lwP5InsertMenu');
        if (!menu || menu.style.display !== 'block') return;
        // Si el click no fue dentro del menú ni en el botón que lo abre, cerramos
        if (menu.contains(e.target)) return;
        var btn = e.target.closest('[onclick*="lwP5InsertMenuToggle"]');
        if (btn) return;
        menu.style.display = 'none';
    });

    // Inserta el contenido de una fase en la posición actual del cursor.
    // La idea: traer del servidor el MISMO HTML que sale en el PDF de
    // esa fase (con su styling inline scoped), para que el reporte
    // libre literalmente acumule los documentos de las fases previas.
    window.lwP5InsertFase = function (phase) {
        var menu = $('lwP5InsertMenu');
        if (menu) menu.style.display = 'none';
        var editor = $('lw_f5_editor');
        if (!editor || !state.lev) return;
        editor.focus();

        var tipoMap = { 1: 'levantamiento', 2: 'propuesta', 3: 'volumetria', 4: 'programa-obra' };
        var tipo = tipoMap[phase];
        if (!tipo) return;

        // Asegurar que lo capturado esté guardado antes de traer el fragmento.
        lwFlushSave().then(function () {
            var url = '/app/api/iamet/levantamientos/' + state.lev.id + '/fragmento/?tipo=' + tipo;
            fetch(url, { credentials: 'same-origin' })
                .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, text: t }; }); })
                .then(function (res) {
                    if (!res.ok) {
                        alert('No pude generar el fragmento: ' + res.text.replace(/<[^>]+>/g, '').trim());
                        return;
                    }
                    editor.focus();
                    try { document.execCommand('insertHTML', false, res.text); }
                    catch (e) { editor.innerHTML += res.text; }
                    lwP5EditorInput();
                })
                .catch(function () { alert('Error de red al insertar la fase.'); });
        });
    };


    function collectPhase5() {
        var f5 = state.lev.fase5_data || {};
        var editor = $('lw_f5_editor');
        if (editor) f5.reporte_html = editor.innerHTML;
        state.lev.fase5_data = f5;
        return f5;
    }

    // Atajos de teclado dentro del wizard:
    //  - ⌘K / Ctrl+K: abrir catálogo de productos en Fase 1
    //  - ⌘S / Ctrl+S: guardar fase actual
    //  - NO hay ESC para cerrar (sólo la X, protege trabajo de campo).
    document.addEventListener('keydown', function (e) {
        var ov = $('levantamientoWizard');
        if (!ov || ov.style.display === 'none') return;
        // Esc cierra primero la isla expandida (Fase 2). No cierra el
        // wizard — eso protege trabajo de campo y mantiene la regla
        // "sólo la X cierra el wizard".
        if (e.key === 'Escape') {
            if (typeof window._lwIslandCollapseAll === 'function' && window._lwIslandCollapseAll()) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        }
        var mod = e.metaKey || e.ctrlKey;
        if (mod && (e.key === 'k' || e.key === 'K') && state.phase === 1) {
            e.preventDefault();
            lwP1OpenCatalog();
        } else if (mod && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            lwSave(true);
        }
    });

})();


/* ═══════════════════════════════════════════════════════════════
   LVC — Levantamiento Vendedor Consulta
   Overlay simple sólo-lectura para vendedores. Se abre con
   levantamientoConsultaAbrir(levData) en lugar del wizard cuando
   el backend devuelve puede_editar:false. NO usa state del wizard
   ni dispara autosave; sólo lee y abre PDFs.
   ═══════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // Helpers locales — el archivo principal tiene su propio esc() y _fmt()
    // dentro del IIFE de arriba; aquí redefinimos los necesarios.
    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _$(id) { return document.getElementById(id); }

    // Configuración por fase: título, helper de "tiene datos", helper de
    // resumen corto, helper de detalle expandido, URL del PDF.
    var STATUS_LABELS = {
        borrador:   'Borrador',
        revision:   'En Revisión',
        aprobado:   'Aprobado',
        rechazado:  'Rechazado',
        ejecutando: 'Ejecutando',
        completado: 'Completado',
    };

    function _fmtRel(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        var diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
        if (diff < 60)    return 'hace unos segundos';
        if (diff < 3600)  return 'hace ' + Math.round(diff / 60) + ' min';
        if (diff < 86400) return 'hace ' + Math.round(diff / 3600) + ' h';
        return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    // ¿Una fase tiene datos significativos?
    function _hasFase1(d) { d = d || {}; return !!(d.cliente || d.contacto || d.area || d.descripcion || (d.servicios||[]).length || (d.componentes||[]).length || (d.productos||[]).length); }
    function _hasFase2(d) {
        // Shape real de fase2_data:
        //   especificaciones [], comentarios_spec [], productos [],
        //   notas_evidencia "", desc_proyecto "",
        //   programa { fecha_inicio, fecha_fin, duracion, turno, ... }
        // Las fotos NO viven aquí (están en lev.evidencias, otro modelo).
        d = d || {};
        var prog = d.programa || {};
        return !!(
            (d.especificaciones || []).length ||
            (d.comentarios_spec || []).length ||
            (d.productos || []).length ||
            d.notas_evidencia ||
            d.desc_proyecto ||
            d.tipo_solucion ||
            prog.fecha_inicio || prog.fecha_fin || prog.duracion
        );
    }
    function _hasFase3(d) {
        d = d || {};
        return !!((d.materiales||[]).length || (d.manoObra||[]).length || (d.gastos||[]).length);
    }
    function _hasFase4(d) { d = d || {}; return !!((d.actividades||[]).length || (d.fases||[]).length); }
    function _hasFase5(d) { d = d || {}; return !!((d.reportes||[]).length || d.notas); }

    // Resumen corto (una línea) por fase
    function _summary1(d) {
        d = d || {};
        var p = [];
        if (d.cliente) p.push(d.cliente);
        var nProd = (d.productos || []).length;
        if (nProd) p.push(nProd + ' producto' + (nProd === 1 ? '' : 's'));
        var nServ = (d.servicios || []).length;
        if (nServ) p.push(nServ + ' servicio' + (nServ === 1 ? '' : 's'));
        return p.length ? p.join(' · ') : 'Sin datos capturados';
    }
    function _summary2(d) {
        d = d || {};
        var prog = d.programa || {};
        var p = [];
        var nE = (d.especificaciones || []).length;
        var nC = (d.comentarios_spec || []).length;
        var nP = (d.productos || []).length;
        if (nE) p.push(nE + ' especificación' + (nE === 1 ? '' : 'es'));
        if (nC) p.push(nC + ' comentario' + (nC === 1 ? '' : 's'));
        if (nP) p.push(nP + ' material' + (nP === 1 ? '' : 'es'));
        if (prog.duracion) p.push('Duración: ' + prog.duracion);
        return p.length ? p.join(' · ') : 'Sin datos capturados';
    }
    function _summary3(d) {
        d = d || {};
        var p = [];
        var nM = (d.materiales || []).length, nMO = (d.manoObra || []).length, nG = (d.gastos || []).length;
        if (nM)  p.push(nM + ' material' + (nM === 1 ? '' : 'es'));
        if (nMO) p.push(nMO + ' partida' + (nMO === 1 ? '' : 's') + ' de mano de obra');
        if (nG)  p.push(nG + ' gasto' + (nG === 1 ? '' : 's'));
        return p.length ? p.join(' · ') : 'Sin datos capturados';
    }
    function _summary4(d) {
        d = d || {};
        var nA = (d.actividades || []).length, nFa = (d.fases || []).length;
        var p = [];
        if (nFa) p.push(nFa + ' fase' + (nFa === 1 ? '' : 's'));
        if (nA)  p.push(nA + ' actividad' + (nA === 1 ? '' : 'es'));
        return p.length ? p.join(' · ') : 'Sin datos capturados';
    }
    function _summary5(d) {
        d = d || {};
        var nR = (d.reportes || []).length;
        if (nR) return nR + ' reporte' + (nR === 1 ? '' : 's');
        if (d.notas) return 'Notas finales capturadas';
        return 'Sin datos capturados';
    }

    // Detalle expandido (HTML) por fase — read-only, formato grid de campos.
    function _detail1(d) {
        d = d || {};
        var html = '<div class="lvc-detail-grid">';
        html += _detailItem('Cliente', d.cliente);
        html += _detailItem('Contacto', d.contacto);
        html += _detailItem('Email', d.email);
        html += _detailItem('Teléfono', d.telefono);
        html += _detailItem('Área', d.area);
        html += _detailItem('Fecha levantamiento', d.fecha);
        html += '</div>';
        if (d.descripcion) {
            html += '<div class="lvc-detail-block-title">Descripción / necesidad</div>';
            html += '<div class="lvc-detail-value" style="white-space:pre-wrap;">' + _esc(d.descripcion) + '</div>';
        }
        var servicios = d.servicios || [];
        if (servicios.length) {
            html += '<div class="lvc-detail-block-title">Servicios</div>';
            html += '<div>' + servicios.map(function(s){ return '<span class="lvc-detail-value" style="display:inline-block;background:#f1f5f9;padding:3px 10px;border-radius:999px;margin:2px;">' + _esc(s) + '</span>'; }).join('') + '</div>';
        }
        var productos = d.productos || [];
        if (productos.length) {
            html += '<div class="lvc-detail-block-title">Productos solicitados (' + productos.length + ')</div>';
            html += '<ul class="lvc-detail-list">';
            productos.forEach(function(p) {
                var qty = (p.qty || p.cantidad || '?');
                var unidad = (p.unidad || 'PZA');
                var desc = p.desc || p.descripcion || '—';
                var marca = p.marca ? ' · ' + p.marca : '';
                var modelo = p.modelo ? ' / ' + p.modelo : '';
                html += '<li class="lvc-detail-list-item">' +
                    '<b>' + _esc(qty) + ' ' + _esc(unidad) + '</b> · ' + _esc(desc) + _esc(marca) + _esc(modelo) +
                '</li>';
            });
            html += '</ul>';
        }
        return html;
    }

    function _detail2(d) {
        d = d || {};
        var prog = d.programa || {};
        var html = '<div class="lvc-detail-grid">';
        html += _detailItem('Cliente / Planta', d.planta);
        html += _detailItem('Solicitante', d.solicitante);
        html += _detailItem('Departamento', d.departamento);
        html += _detailItem('Áreas', d.areas);
        html += _detailItem('Tipo de solución', d.tipo_solucion);
        html += _detailItem('Inicio', prog.fecha_inicio);
        html += _detailItem('Fin', prog.fecha_fin);
        html += _detailItem('Duración', prog.duracion);
        html += _detailItem('Turno', prog.turno);
        html += _detailItem('Personal', prog.personal_req);
        html += _detailItem('Apoyo cliente', prog.apoyo_cliente);
        html += '</div>';
        if (d.desc_proyecto) {
            html += '<div class="lvc-detail-block-title">Descripción del proyecto</div>';
            html += '<div class="lvc-detail-value" style="white-space:pre-wrap;">' + _esc(d.desc_proyecto) + '</div>';
        }
        var espec = d.especificaciones || [];
        if (espec.length) {
            html += '<div class="lvc-detail-block-title">Especificaciones técnicas</div>';
            html += '<ul class="lvc-detail-list">' + espec.map(function(s){ return '<li class="lvc-detail-list-item">' + _esc(typeof s === 'string' ? s : (s.texto || s.value || '')) + '</li>'; }).join('') + '</ul>';
        }
        var coms = d.comentarios_spec || [];
        if (coms.length) {
            html += '<div class="lvc-detail-block-title">Comentarios</div>';
            html += '<ul class="lvc-detail-list">' + coms.map(function(s){ return '<li class="lvc-detail-list-item">' + _esc(typeof s === 'string' ? s : (s.texto || s.value || '')) + '</li>'; }).join('') + '</ul>';
        }
        var prods = d.productos || [];
        if (prods.length) {
            html += '<div class="lvc-detail-block-title">Productos / Materiales (' + prods.length + ')</div>';
            html += '<ul class="lvc-detail-list">' + prods.map(function(p){
                var qty = p.qty || 1;
                var unidad = p.unidad || 'PZA';
                var desc = p.desc || '—';
                var marca = p.marca ? ' · ' + _esc(p.marca) : '';
                var modelo = p.modelo ? ' · ' + _esc(p.modelo) : '';
                return '<li class="lvc-detail-list-item"><b>' + _esc(qty) + ' ' + _esc(unidad) + '</b> · ' + _esc(desc) + marca + modelo + '</li>';
            }).join('') + '</ul>';
        }
        if (d.notas_evidencia) {
            html += '<div class="lvc-detail-block-title">Notas del sitio</div>';
            html += '<div class="lvc-detail-value" style="white-space:pre-wrap;">' + _esc(d.notas_evidencia) + '</div>';
        }
        // Las fotos viven en levantamiento.evidencias (LevantamientoEvidencia),
        // no en fase2_data. Si el wizard las pasó al levData, las pintamos.
        var fotos = (_currentLev && _currentLev.evidencias) || [];
        if (fotos.length) {
            html += '<div class="lvc-detail-block-title">Evidencia fotográfica (' + fotos.length + ')</div>';
            html += '<div class="lvc-photos-grid">' + fotos.map(function(f) {
                var src = f.url || f.archivo_url || f.src || (typeof f === 'string' ? f : '');
                if (!src) return '';
                return '<a href="' + _esc(src) + '" target="_blank" class="lvc-photo" style="background-image:url(' + _esc(src) + ');" title="Abrir foto"></a>';
            }).join('') + '</div>';
        }
        return html;
    }

    // Para Fase 3 (Volumetría) — vendedor sólo ve cantidades, NO precios.
    function _detail3(d) {
        d = d || {};
        var html = '';
        var mat = d.materiales || [];
        if (mat.length) {
            html += '<div class="lvc-detail-block-title">Materiales / equipos (' + mat.length + ')</div>';
            html += '<ul class="lvc-detail-list">';
            mat.forEach(function(r) {
                var qty = r.qty || r.cantidad || '?';
                var unidad = r.unidad || 'PZA';
                var desc = r.desc || r.descripcion || '—';
                html += '<li class="lvc-detail-list-item"><b>' + _esc(qty) + ' ' + _esc(unidad) + '</b> · ' + _esc(desc) + '</li>';
            });
            html += '</ul>';
        }
        var mo = d.manoObra || [];
        if (mo.length) {
            html += '<div class="lvc-detail-block-title">Mano de obra / servicios (' + mo.length + ')</div>';
            html += '<ul class="lvc-detail-list">';
            mo.forEach(function(r) {
                var qty = r.qty || r.cantidad || '?';
                var unidad = r.unidad || 'JOR';
                var desc = r.desc || r.descripcion || '—';
                html += '<li class="lvc-detail-list-item"><b>' + _esc(qty) + ' ' + _esc(unidad) + '</b> · ' + _esc(desc) + '</li>';
            });
            html += '</ul>';
        }
        var gas = d.gastos || [];
        if (gas.length) {
            html += '<div class="lvc-detail-block-title">Gastos operativos (' + gas.length + ')</div>';
            html += '<ul class="lvc-detail-list">';
            gas.forEach(function(r) {
                var qty = r.qty || r.cantidad || '?';
                var unidad = r.unidad || '';
                var desc = r.desc || r.descripcion || '—';
                html += '<li class="lvc-detail-list-item"><b>' + _esc(qty) + ' ' + _esc(unidad) + '</b> · ' + _esc(desc) + '</li>';
            });
            html += '</ul>';
        }
        if (!mat.length && !mo.length && !gas.length) {
            return '<div class="lvc-detail-value is-muted">Sin partidas capturadas.</div>';
        }
        // Nota: por privacidad financiera, ocultamos costos/precios al vendedor.
        // El PDF "sin costos" cubre la entrega externa.
        return html + '<div class="lvc-detail-value is-muted" style="margin-top:14px;font-size:11.5px;">ⓘ Los costos y precios no se muestran. Descarga el PDF de presupuesto para verlos.</div>';
    }

    function _detail4(d) {
        d = d || {};
        var fases = d.fases || [];
        var html = '';
        if (fases.length) {
            html += '<div class="lvc-detail-block-title">Fases del programa de obra (' + fases.length + ')</div>';
            html += '<ul class="lvc-detail-list">';
            fases.forEach(function(f) {
                var nombre = f.nombre || f.title || '—';
                var ini = f.fechaInicio || f.inicio || '';
                var fin = f.fechaFin || f.fin || '';
                html += '<li class="lvc-detail-list-item"><b>' + _esc(nombre) + '</b>' +
                    (ini || fin ? ' · ' + _esc(ini) + (fin ? ' → ' + _esc(fin) : '') : '') + '</li>';
            });
            html += '</ul>';
        }
        var act = d.actividades || [];
        if (act.length) {
            html += '<div class="lvc-detail-block-title">Actividades (' + act.length + ')</div>';
            html += '<ul class="lvc-detail-list">' + act.map(function(a) {
                return '<li class="lvc-detail-list-item">' + _esc(a.nombre || a.title || '—') + '</li>';
            }).join('') + '</ul>';
        }
        if (!fases.length && !act.length) {
            return '<div class="lvc-detail-value is-muted">Programa de obra aún no definido.</div>';
        }
        return html;
    }

    function _detail5(d) {
        d = d || {};
        var html = '';
        if (d.notas) {
            html += '<div class="lvc-detail-block-title">Notas finales</div>';
            html += '<div class="lvc-detail-value" style="white-space:pre-wrap;">' + _esc(d.notas) + '</div>';
        }
        var rep = d.reportes || [];
        if (rep.length) {
            html += '<div class="lvc-detail-block-title">Reportes generados (' + rep.length + ')</div>';
            html += '<ul class="lvc-detail-list">' + rep.map(function(r) {
                return '<li class="lvc-detail-list-item">' + _esc(r.titulo || r.title || r.nombre || '—') + (r.fecha ? ' · ' + _esc(r.fecha) : '') + '</li>';
            }).join('') + '</ul>';
        }
        if (!d.notas && !rep.length) {
            return '<div class="lvc-detail-value is-muted">Aún no hay reportes.</div>';
        }
        return html;
    }

    function _detailItem(label, value) {
        var v = (value == null || value === '') ? null : value;
        return '<div class="lvc-detail-item">' +
            '<span class="lvc-detail-label">' + _esc(label) + '</span>' +
            '<span class="lvc-detail-value' + (v ? '' : ' is-muted') + '">' + _esc(v || '—') + '</span>' +
        '</div>';
    }

    // URLs de PDF por fase.
    function _pdfUrl(lev, fase) {
        if (!lev || !lev.id) return null;
        var base = '/app/api/iamet/levantamientos/' + lev.id + '/';
        if (fase === 1) return base + 'levantamiento-pdf/?download=1';
        if (fase === 2) return base + 'propuesta-pdf/?download=1';
        // Fase 3 — para vendedor SIEMPRE entregamos versión sin costos.
        if (fase === 3) return base + 'volumetria-pdf/?download=1&sin_costos=1';
        if (fase === 4) {
            if (!lev.proyecto_id) return null;
            return '/app/api/iamet/proyectos/' + lev.proyecto_id + '/programa-obra-pdf/?download=1';
        }
        if (fase === 5) return base + 'reporte-pdf/?download=1';
        return null;
    }

    var FASES = [
        { n: 1, titulo: 'Levantamiento técnico',     has: _hasFase1, summary: _summary1, detail: _detail1 },
        { n: 2, titulo: 'Propuesta técnica',          has: _hasFase2, summary: _summary2, detail: _detail2 },
        { n: 3, titulo: 'Volumetría / Presupuesto',   has: _hasFase3, summary: _summary3, detail: _detail3 },
        { n: 4, titulo: 'Programa de obra',           has: _hasFase4, summary: _summary4, detail: _detail4 },
        { n: 5, titulo: 'Reportes',                   has: _hasFase5, summary: _summary5, detail: _detail5 },
    ];

    function _renderFase(lev, def) {
        // Fase 3 tiene un flujo distinto: en lugar de usar el legacy
        // `lev.fase3_data`, listamos las volumetrías completadas del
        // levantamiento. Cada una con su propio botón "Exportar".
        if (def.n === 3) {
            return _renderFase3Card(lev);
        }
        var data = lev['fase' + def.n + '_data'] || {};
        var ok = def.has(data);
        var pdfUrl = ok ? _pdfUrl(lev, def.n) : null;
        var pdfBtn = pdfUrl
            ? '<a href="' + _esc(pdfUrl) + '" target="_blank" class="lvc-pdf-btn" onclick="event.stopPropagation()" title="Descargar PDF"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>PDF</a>'
            : '';
        var chevron = ok
            ? '<svg class="lvc-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
            : '';
        var clsTail = ok ? 'has-data' : 'is-empty';
        return '<div class="lvc-phase ' + clsTail + '" data-fase="' + def.n + '">' +
            '<div class="lvc-phase-head" onclick="' + (ok ? 'levantamientoConsultaToggle(' + def.n + ')' : '') + '">' +
                '<div class="lvc-phase-num">' + (ok ? '✓' : def.n) + '</div>' +
                '<div class="lvc-phase-info">' +
                    '<div class="lvc-phase-title">Fase ' + def.n + ' · ' + _esc(def.titulo) + '</div>' +
                    '<div class="lvc-phase-summary">' + _esc(def.summary(data)) + '</div>' +
                '</div>' +
                '<div class="lvc-phase-actions">' + pdfBtn + chevron + '</div>' +
            '</div>' +
            (ok ? '<div class="lvc-phase-body" id="lvcFaseBody' + def.n + '"></div>' : '') +
        '</div>';
    }

    // ── Fase 3 — Card con lista de volumetrías ─────────────────────
    // El vendedor recibe sólo las completadas (filtrado en backend);
    // ingenieros (si abrieran el overlay) verían todas. Cada
    // volumetría tiene su propio resumen + botón Exportar negro.
    function _renderFase3Card(lev) {
        var n = 3;
        var titulo = 'Volumetría / Presupuesto';
        var vols = _currentVolumetrias || [];
        var nVols = vols.length;
        var ok = nVols > 0;
        var summaryTxt = ok
            ? (nVols + ' volumetría' + (nVols === 1 ? '' : 's') + ' completada' + (nVols === 1 ? '' : 's'))
            : 'Sin volumetrías completadas';
        var chevron = ok
            ? '<svg class="lvc-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
            : '';
        var clsTail = ok ? 'has-data' : 'is-empty';
        return '<div class="lvc-phase ' + clsTail + '" data-fase="' + n + '">' +
            '<div class="lvc-phase-head" onclick="' + (ok ? 'levantamientoConsultaToggle(' + n + ')' : '') + '">' +
                '<div class="lvc-phase-num">' + (ok ? '✓' : n) + '</div>' +
                '<div class="lvc-phase-info">' +
                    '<div class="lvc-phase-title">Fase ' + n + ' · ' + _esc(titulo) + '</div>' +
                    '<div class="lvc-phase-summary">' + _esc(summaryTxt) + '</div>' +
                '</div>' +
                '<div class="lvc-phase-actions">' + chevron + '</div>' +
            '</div>' +
            (ok ? '<div class="lvc-phase-body" id="lvcFaseBody' + n + '"></div>' : '') +
        '</div>';
    }

    // Body expandido de Fase 3: lista cada volumetría con su resumen
    // y un botón "Exportar" negro con dropdown de 3 opciones.
    function _renderFase3Body() {
        var lev = _currentLev || {};
        var vols = _currentVolumetrias || [];
        if (!vols.length) return '<div class="lvc-detail-empty">No hay volumetrías completadas aún.</div>';
        return vols.map(function (vol) {
            var d = vol.data || {};
            var partidasResumen = '';
            var nM = (d.materiales || []).length;
            var nMO = (d.manoObra || []).length;
            var nG = (d.gastos || []).length;
            var bits = [];
            if (nM)  bits.push(nM  + ' material'  + (nM  === 1 ? '' : 'es'));
            if (nMO) bits.push(nMO + ' mano de obra');
            if (nG)  bits.push(nG  + ' gasto' + (nG === 1 ? '' : 's'));
            partidasResumen = bits.length ? bits.join(' · ') : 'Sin partidas';

            var html = '';
            html += '<div class="lvc-vol-card" data-vol-id="' + vol.id + '">';
            html += '<div class="lvc-vol-head">';
            html += '<div>';
            html += '<div class="lvc-vol-name">' + _esc(vol.nombre || 'Volumetría') + '</div>';
            html += '<div class="lvc-vol-sub">' + _esc(partidasResumen);
            if (vol.fecha_actualizacion) html += ' · Actualizado ' + _esc(_fmtRel(vol.fecha_actualizacion));
            html += '</div>';
            html += '</div>';
            // Botón Exportar negro con dropdown
            html += '<div class="lvc-export-wrap">';
            html += '<button type="button" class="lvc-export-btn" onclick="event.stopPropagation(); lvcExportToggle(' + vol.id + ')" title="Exportar">';
            html += '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>';
            html += '<span>Exportar</span>';
            html += '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
            html += '</button>';
            html += '<div class="lvc-export-menu" id="lvcExportMenu' + vol.id + '">';
            // Vendedor sólo opciones SIN COSTOS — coherente con la regla
            // existente del overlay (vendedor nunca ve precios).
            var base = '/app/api/iamet/levantamientos/' + lev.id + '/volumetria-pdf/?volumetria_id=' + vol.id + '&sin_costos=1';
            var baseDl = base + '&download=1';
            var xlsx = '/app/api/iamet/levantamientos/' + lev.id + '/volumetria-xlsx/?volumetria_id=' + vol.id + '&sin_costos=1';
            html += '<a href="' + base + '" target="_blank" class="lvc-export-item">';
            html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
            html += '<div><div class="lvc-export-item-title">Ver en pestaña</div><div class="lvc-export-item-sub">Previsualizar (sin costos)</div></div>';
            html += '</a>';
            html += '<a href="' + baseDl + '" class="lvc-export-item">';
            html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>';
            html += '<div><div class="lvc-export-item-title">Descargar PDF</div><div class="lvc-export-item-sub">Cantidades y descripciones</div></div>';
            html += '</a>';
            html += '<a href="' + xlsx + '" class="lvc-export-item">';
            html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>';
            html += '<div><div class="lvc-export-item-title">Descargar en Excel</div><div class="lvc-export-item-sub">Formato .xlsx</div></div>';
            html += '</a>';
            html += '</div>';
            html += '</div>';
            html += '</div>';
            // Resumen de partidas (sin costos — vendedor nunca los ve)
            html += '<div class="lvc-vol-body">' + _detail3(d) + '</div>';
            html += '</div>';
            return html;
        }).join('');
    }

    // Toggle del menú "Exportar" de una volumetría. Cierra cualquier
    // otro menú abierto antes (sólo uno abierto a la vez).
    window.lvcExportToggle = function (volId) {
        var all = document.querySelectorAll('.lvc-export-menu.is-open');
        all.forEach(function (m) {
            if (m.id !== 'lvcExportMenu' + volId) m.classList.remove('is-open');
        });
        var menu = _$('lvcExportMenu' + volId);
        if (menu) menu.classList.toggle('is-open');
    };

    // Click fuera de cualquier menú abierto → cerrarlo.
    document.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.lvc-export-wrap')) return;
        var open = document.querySelectorAll('.lvc-export-menu.is-open');
        open.forEach(function (m) { m.classList.remove('is-open'); });
    });

    var _currentLev = null;
    // Volumetrías completadas (para vendedor) o todas (ingeniero) del
    // levantamiento abierto. Llenado por fetch al abrir el overlay.
    var _currentVolumetrias = [];

    window.levantamientoConsultaAbrir = function (levData) {
        if (!levData) return;
        _currentLev = levData;
        _currentVolumetrias = [];
        var ov = _$('widgetLevantamientoConsulta');
        if (!ov) return;
        ov.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        var titleEl = _$('lvcTitle');
        if (titleEl) titleEl.textContent = levData.nombre || 'Levantamiento';

        var statusEl = _$('lvcStatus');
        if (statusEl) statusEl.textContent = STATUS_LABELS[levData.status] || levData.status_label || '—';

        var metaEl = _$('lvcMeta');
        if (metaEl) {
            var parts = [];
            if (levData.proyecto_nombre) parts.push('Proyecto: ' + levData.proyecto_nombre);
            if (levData.creado_por_nombre) parts.push('Creado por ' + levData.creado_por_nombre);
            if (levData.actualizado_por_nombre && levData.actualizado_por_id !== levData.creado_por_id) {
                parts.push('Última edición por ' + levData.actualizado_por_nombre);
            }
            if (levData.fecha_actualizacion) parts.push('Actualizado ' + _fmtRel(levData.fecha_actualizacion));
            metaEl.textContent = parts.join(' · ');
        }

        var phasesEl = _$('lvcPhases');
        if (!phasesEl) return;

        function renderAll() {
            phasesEl.innerHTML = FASES.map(function (def) { return _renderFase(levData, def); }).join('');
        }

        // Fetch volumetrías del levantamiento (vendedor recibe sólo
        // completadas; ingeniero las recibe todas). Mientras carga
        // mostramos un placeholder ligero. Si falla, render fallback
        // sin volumetrías (Fase 3 quedará vacía pero el resto carga).
        phasesEl.innerHTML = '<div class="lvc-loader">Cargando…</div>';
        if (typeof apiFetch === 'function') {
            apiFetch('/app/api/iamet/levantamientos/' + levData.id + '/volumetrias/').then(function (r) {
                // Aceptar tanto {ok:true,data:[...]} como {success:true,data:[...]}
                var arr = (r && Array.isArray(r.data)) ? r.data : [];
                _currentVolumetrias = arr;
                // Log de diagnóstico — útil mientras estabilizamos. Si se
                // ve "lev_id=X · 0 volumetrías" pero el ingeniero asegura
                // que sí marcó una completada, lo más probable es que el
                // levantamiento abierto NO sea el mismo (mismo proyecto,
                // distinto id). El log lo confirma.
                try { console.log('[consulta] lev_id=' + levData.id + ' volumetrías=' + arr.length, arr); } catch (e) {}
                renderAll();
            }, function (err) {
                _currentVolumetrias = [];
                try { console.log('[consulta] fetch volumetrías falló', err); } catch (e) {}
                renderAll();
            });
        } else {
            renderAll();
        }
    };

    window.levantamientoConsultaCerrar = function () {
        var ov = _$('widgetLevantamientoConsulta');
        if (ov) ov.style.display = 'none';
        document.body.style.overflow = '';
        _currentLev = null;
    };

    // Toggle del detalle expandido de una fase
    window.levantamientoConsultaToggle = function (n) {
        if (!_currentLev) return;
        var phasesEl = _$('lvcPhases');
        if (!phasesEl) return;
        var card = phasesEl.querySelector('.lvc-phase[data-fase="' + n + '"]');
        if (!card || card.classList.contains('is-empty')) return;
        var body = _$('lvcFaseBody' + n);
        if (!body) return;
        var isOpen = card.classList.contains('is-open');
        if (isOpen) {
            card.classList.remove('is-open');
            body.innerHTML = '';
        } else {
            card.classList.add('is-open');
            // Fase 3 usa la lista de volumetrías con sus dropdowns;
            // el resto sigue el patrón legacy (def.detail).
            if (n === 3) {
                body.innerHTML = _renderFase3Body();
            } else {
                var def = FASES[n - 1];
                var data = _currentLev['fase' + n + '_data'] || {};
                body.innerHTML = def.detail(data);
            }
        }
    };

    // Cerrar con click fuera o Escape
    document.addEventListener('keydown', function (e) {
        var ov = _$('widgetLevantamientoConsulta');
        if (e.key === 'Escape' && ov && ov.style.display !== 'none') {
            window.levantamientoConsultaCerrar();
        }
    });
    document.addEventListener('click', function (e) {
        var ov = _$('widgetLevantamientoConsulta');
        if (ov && e.target === ov) window.levantamientoConsultaCerrar();
    });

})();
