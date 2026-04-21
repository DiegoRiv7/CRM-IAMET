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
    var COMPONENTES = ['Cámara IP', 'Cámara Analógica', 'NVR', 'Cableado', 'Gabinete/Rack', 'Switches', 'UPS', 'Access Point'];

    // Mapa: qué componentes son relevantes para cada servicio.
    // Si no hay servicios seleccionados, se muestran todos (fallback).
    // Si el usuario marca "Otros", también se muestran todos.
    var SERVICIO_COMPONENTES = {
        'CCTV':                  ['Cámara IP', 'Cámara Analógica', 'NVR', 'Cableado', 'Gabinete/Rack', 'Switches', 'UPS'],
        'Alarma Intrusión':      ['Cableado', 'Gabinete/Rack', 'UPS'],
        'Control de Acceso':     ['Cableado', 'Gabinete/Rack', 'Switches', 'UPS'],
        'Cableado Estructurado': ['Cableado', 'Gabinete/Rack', 'Switches', 'Access Point'],
        'Voceo':                 ['Cableado', 'Gabinete/Rack', 'UPS'],
        'Telefonía':             ['Cableado', 'Switches', 'UPS', 'Access Point'],
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
    window.levantamientoWizardOpen = function (levData) {
        if (!levData) return;
        state.lev = JSON.parse(JSON.stringify(levData)); // deep copy
        state.phase = Math.max(1, Math.min(5, levData.fase_actual || 1));
        state.dirty = false;
        var ov = $('levantamientoWizard');
        if (!ov) return;
        ov.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        renderHeader();
        renderPhaseTabs();
        renderPhase(state.phase);
    };

    window.levantamientoWizardClose = function () {
        if (state.dirty) {
            if (!confirm('Hay cambios sin guardar. ¿Cerrar sin guardar?')) return;
        }
        var ov = $('levantamientoWizard');
        if (ov) ov.style.display = 'none';
        document.body.style.overflow = '';
        state.lev = null;
        state.phase = 1;
        state.dirty = false;
        if (typeof window.levantamientoRefrescarLista === 'function') {
            window.levantamientoRefrescarLista();
        }
    };

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

    window.lwGoPhase = function (n) {
        if (n < 1 || n > 5) return;
        // Guardar fase actual antes de movernos
        lwSave(false);
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
            if (el) el.style.display = (i === n) ? 'block' : 'none';
        }
        // Botón PDF sólo visible en Fase 2 (Propuesta Técnica)
        var pdfWrap = $('lwPdfWrap');
        if (pdfWrap) pdfWrap.style.display = (n === 2) ? '' : 'none';
        var pdfMenu = $('lwPdfMenu');
        if (pdfMenu) pdfMenu.style.display = 'none';

        if (n === 1) renderPhase1();
        else if (n === 2) renderPhase2();
        else if (n === 3) renderPhase3();
        else if (n === 4) renderPhase4();
        else if (n === 5) renderPhase5();
    }

    // ── Auto-save (debounce 600ms) ───────────────────────────
    window.lwFieldChange = function () {
        state.dirty = true;
        if (state.saveTimer) clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(function () { lwSave(false); }, 600);
    };

    window.lwSave = function (showFlash) {
        if (!state.lev) return;
        // Recolectar data de la fase actual desde el DOM
        var data = collectPhaseData(state.phase);
        state.lev['fase' + state.phase + '_data'] = data;
        return apiFetch('/app/api/iamet/levantamientos/' + state.lev.id + '/fase/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fase: state.phase, data: data, fase_actual: state.lev.fase_actual }),
        }).then(function (r) {
            if (r.success) {
                state.dirty = false;
                // Actualizar timestamp desde la respuesta del servidor
                if (r.data && r.data.fecha_actualizacion) {
                    state.lev.fecha_actualizacion = r.data.fecha_actualizacion;
                }
                renderSaveStamp();
                if (showFlash) showSaveFlash();
            }
        });
    };

    function showSaveFlash() {
        var ind = $('lwSaveIndicator');
        if (!ind) return;
        ind.textContent = '✓ Guardado';
        ind.classList.add('lw-save-flash');
        setTimeout(function () { ind.classList.remove('lw-save-flash'); ind.textContent = ''; }, 1600);
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
    window.lwUpdateNombre = function (val) {
        if (!state.lev) return;
        state.lev.nombre = val || '';
        // Refrescar el título en el header también
        var t = $('lwTitle');
        if (t) t.textContent = state.lev.nombre || 'Levantamiento';
        state.dirty = true;
        if (_nombreTimer) clearTimeout(_nombreTimer);
        _nombreTimer = setTimeout(function () {
            apiFetch('/app/api/iamet/levantamientos/' + state.lev.id + '/actualizar/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre: state.lev.nombre }),
            }).then(function (r) {
                if (r.success) {
                    state.dirty = false;
                    if (r.data && r.data.fecha_actualizacion) state.lev.fecha_actualizacion = r.data.fecha_actualizacion;
                    renderSaveStamp();
                    showSaveFlash();
                }
            });
        }, 700);
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

        renderPhase1Productos();
        lwRecomputeSummary();
    }

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
        d.cliente_id = c.id;
        d.cliente = c.nombre;
        // Auto-fill si los campos están vacíos
        if (!d.email && c.email) d.email = c.email;
        if (!d.telefono && c.telefono) d.telefono = c.telefono;
        // Contacto: si no hay contacto escrito, usa contacto_principal como sugerencia
        if (!d.contacto && c.contacto_principal) d.contacto = c.contacto_principal;
        state.lev.fase1_data = d;
        // Reflejar en inputs
        $('lw_f1_cliente').value = d.cliente;
        $('lw_f1_contacto').value = d.contacto || '';
        $('lw_f1_email').value = d.email || '';
        $('lw_f1_telefono').value = d.telefono || '';
        [ 'lw_f1_cliente','lw_f1_contacto','lw_f1_email','lw_f1_telefono' ].forEach(function(id){
            var el = $(id); if (el) lwRefreshMetaPill(el);
        });
        lwHideClienteDropdown();
        lwRefreshClienteLock();
        // Prefetch contactos del cliente para el dropdown de contactos
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
        var pill = document.querySelector('.lw-meta-pill-cliente');
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

    function lwRecomputeSummary() {
        if (!state.lev) return;
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

    function renderPhase1Productos() {
        var d = state.lev.fase1_data || {};
        var prods = d.productos || [];
        var wrap = $('lw_f1_productos_wrap');
        if (!prods.length) {
            wrap.innerHTML =
                '<div class="lw-empty-prods" onclick="lwP1OpenCatalog()">' +
                    '<div class="lw-empty-prods-icon">' +
                        '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>' +
                    '</div>' +
                    '<div class="lw-empty-prods-title">Busca un producto del catálogo</div>' +
                    '<div class="lw-empty-prods-hint">Teclea descripción, marca o número de parte · <kbd>⌘K</kbd></div>' +
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
        // Los valores ya están en state.lev.fase1_data excepto inputs simples
        var d = state.lev.fase1_data || {};
        d.cliente     = $('lw_f1_cliente').value;
        d.contacto    = $('lw_f1_contacto').value;
        d.area        = $('lw_f1_area').value;
        d.fecha       = $('lw_f1_fecha').value;
        d.email       = $('lw_f1_email').value;
        d.telefono    = $('lw_f1_telefono').value;
        d.descripcion = $('lw_f1_descripcion').value;
        state.lev.fase1_data = d;
        return d;
    }

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

        // Partidas con comentarios (opcional)
        var productos = f1.productos || [];
        var wrap = $('lw_f2_partidas');
        if (!productos.length) {
            wrap.innerHTML = '<div class="lw-empty-card">Agrega productos en la Fase 1 primero</div>';
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
        var grid = $('lw_f2_photos');
        var evs = state.lev.evidencias || [];
        if (!evs.length) { grid.innerHTML = ''; return; }
        grid.innerHTML = evs.map(function (ev) {
            return '<div class="lw-photo-thumb" onclick="lwP2Lightbox(' + ev.id + ')">' +
                '<img src="' + esc(ev.url) + '" alt="">' +
                '<button type="button" class="lw-photo-del" title="Eliminar" onclick="event.stopPropagation(); lwP2DeleteEvidencia(' + ev.id + ')">×</button>' +
                (ev.nombre_original ? '<div class="lw-photo-name">' + esc(ev.nombre_original) + '</div>' : '') +
            '</div>';
        }).join('');
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
        if (!confirm('¿Eliminar esta foto?')) return;
        apiFetch('/app/api/iamet/evidencias/' + id + '/eliminar/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        }).then(function (r) {
            if (r.success) {
                state.lev.evidencias = (state.lev.evidencias || []).filter(function (e) { return e.id !== id; });
                renderPhase2Photos();
            }
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
    // Drag & drop + paste
    document.addEventListener('DOMContentLoaded', function () {
        var dz = $('lwDropZone');
        if (dz) {
            dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('lw-drop-active'); });
            dz.addEventListener('dragleave', function () { dz.classList.remove('lw-drop-active'); });
            dz.addEventListener('drop', function (e) {
                e.preventDefault(); dz.classList.remove('lw-drop-active');
                var files = Array.from(e.dataTransfer.files || []).filter(function (f) { return f.type.indexOf('image/') === 0; });
                if (files.length) lwP2UploadFiles(files);
            });
        }
        window.addEventListener('paste', function (e) {
            if (!state.lev || $('levantamientoWizard').style.display === 'none') return;
            if (state.phase !== 2) return;
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
        ].forEach(function (pair) {
            var el = $(pair[1]);
            if (el) f2[pair[0]] = el.value || '';
        });
        // Los arrays de especificaciones + comentarios_spec y comentarios (por partida)
        // ya están sincronizados en state.lev.fase2_data por los handlers.
        state.lev.fase2_data = f2;
        return f2;
    }

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

    // Genera el PDF usando el endpoint server-side (WeasyPrint).
    // mode: 'view' → abre en pestaña nueva para previsualizar
    //       'download' → fuerza descarga
    window.lwPdfExport = function (mode) {
        if (!state.lev) return;
        $('lwPdfMenu').style.display = 'none';
        // Guardar primero para que el PDF tenga la data fresca
        lwSave(false).then(function () {
            var base = '/app/api/iamet/levantamientos/' + state.lev.id + '/propuesta-pdf/';
            var url = base + (mode === 'download' ? '?download=1' : '');
            window.open(url, '_blank');
        }).catch(function () {
            // Incluso si falla el save, intenta generar con la data actual del servidor
            var base = '/app/api/iamet/levantamientos/' + state.lev.id + '/propuesta-pdf/';
            var url = base + (mode === 'download' ? '?download=1' : '');
            window.open(url, '_blank');
        });
    };

    // ═══════════════════════════════════════════════════════════════
    //  PHASE 3 — VOLUMETRÍA
    // ═══════════════════════════════════════════════════════════════
    function calcMatRow(r) {
        var costoC = (r.costoUnit || 0) * (1 - (r.descCompra || 0) / 100);
        var precioV = (r.precioLista || 0) * (1 - (r.descVenta || 0) / 100);
        return { costoTotal: costoC * (r.qty || 0), precioVenta: precioV * (r.qty || 0) };
    }

    function renderPhase3() {
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
        state.lev.fase3_data = d;
        renderP3Materiales();
        renderP3ManoObra();
        renderP3Gastos();
        recalcP3Summary();
    }

    function renderP3Materiales() {
        var mat = state.lev.fase3_data.materiales || [];
        var body = $('lw_f3_mat_body');
        var foot = $('lw_f3_mat_foot');
        body.innerHTML = mat.map(function (r, i) {
            var c = calcMatRow(r);
            return '<tr>' +
                '<td><span class="lw-p3-num">' + (i + 1) + '</span></td>' +
                '<td><input type="number" class="lw-p3-num-input" value="' + (r.qty || 0) + '" oninput="lwP3Mat(' + i + ', \'qty\', this.value)"></td>' +
                '<td><input type="text" class="lw-p3-txt-input" style="width:48px;" value="' + esc(r.unid || 'PZA') + '" oninput="lwP3Mat(' + i + ', \'unid\', this.value)"></td>' +
                '<td><input type="text" class="lw-p3-txt-input" value="' + esc(r.desc || '') + '" oninput="lwP3Mat(' + i + ', \'desc\', this.value)" style="min-width:160px;"></td>' +
                '<td><input type="text" class="lw-p3-txt-input" value="' + esc(r.marca || '') + '" oninput="lwP3Mat(' + i + ', \'marca\', this.value)" style="width:84px;"></td>' +
                '<td><input type="text" class="lw-p3-txt-input lw-p3-mono" value="' + esc(r.modelo || '') + '" oninput="lwP3Mat(' + i + ', \'modelo\', this.value)" style="width:110px;"></td>' +
                '<td><input type="number" class="lw-p3-num-input" value="' + (r.costoUnit || 0) + '" oninput="lwP3Mat(' + i + ', \'costoUnit\', this.value)"></td>' +
                '<td><input type="number" class="lw-p3-num-input" value="' + (r.precioLista || 0) + '" oninput="lwP3Mat(' + i + ', \'precioLista\', this.value)"></td>' +
                '<td><input type="number" class="lw-p3-num-input" value="' + (r.descCompra || 0) + '" oninput="lwP3Mat(' + i + ', \'descCompra\', this.value)"></td>' +
                '<td><input type="number" class="lw-p3-num-input" value="' + (r.descVenta || 0) + '" oninput="lwP3Mat(' + i + ', \'descVenta\', this.value)"></td>' +
                '<td class="num"><span class="lw-p3-mono">' + fmtMoney(c.costoTotal) + '</span></td>' +
                '<td class="num"><span class="lw-p3-mono lw-p3-bold">' + fmtMoney(c.precioVenta) + '</span></td>' +
                '<td><input type="text" class="lw-p3-txt-input" value="' + esc(r.proveedor || '') + '" oninput="lwP3Mat(' + i + ', \'proveedor\', this.value)" style="width:90px;"></td>' +
                '<td><input type="text" class="lw-p3-txt-input" value="' + esc(r.entrega || '') + '" oninput="lwP3Mat(' + i + ', \'entrega\', this.value)" style="width:72px;"></td>' +
                '<td><button type="button" class="lw-cell-del" onclick="lwP3DelRow(\'materiales\', ' + i + ')">×</button></td>' +
            '</tr>';
        }).join('');
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
        var foot = $('lw_f3_mo_foot');
        body.innerHTML = rows.map(function (r, i) {
            var total = (r.precioUnit || 0) * (r.qty || 0);
            return '<tr>' +
                '<td><span class="lw-p3-num">' + (i + 1) + '</span></td>' +
                '<td><input type="number" class="lw-p3-num-input" value="' + (r.qty || 0) + '" oninput="lwP3MO(' + i + ', \'qty\', this.value)"></td>' +
                '<td><input type="text" class="lw-p3-txt-input" style="width:60px;" value="' + esc(r.unid || 'SERV') + '" oninput="lwP3MO(' + i + ', \'unid\', this.value)"></td>' +
                '<td><input type="text" class="lw-p3-txt-input" value="' + esc(r.desc || '') + '" oninput="lwP3MO(' + i + ', \'desc\', this.value)" style="min-width:220px;"></td>' +
                '<td><input type="number" class="lw-p3-num-input" value="' + (r.precioUnit || 0) + '" oninput="lwP3MO(' + i + ', \'precioUnit\', this.value)"></td>' +
                '<td class="num"><span class="lw-p3-mono lw-p3-bold">' + fmtMoney(total) + '</span></td>' +
                '<td><button type="button" class="lw-cell-del" onclick="lwP3DelRow(\'manoObra\', ' + i + ')">×</button></td>' +
            '</tr>';
        }).join('');
        var tot = rows.reduce(function (a, r) { return a + (r.precioUnit || 0) * (r.qty || 0); }, 0);
        foot.innerHTML = '<tr class="lw-p3-foot"><td colspan="5">Subtotal Mano de Obra</td><td class="num lw-p3-mono lw-p3-bold">' + fmtMoney(tot) + '</td><td></td></tr>';
    }
    function renderP3Gastos() {
        var rows = state.lev.fase3_data.gastos || [];
        var body = $('lw_f3_gas_body');
        var foot = $('lw_f3_gas_foot');
        body.innerHTML = rows.map(function (r, i) {
            var total = (r.costoUnit || 0) * (r.qty || 0);
            return '<tr>' +
                '<td><span class="lw-p3-num">' + (i + 1) + '</span></td>' +
                '<td><input type="number" class="lw-p3-num-input" value="' + (r.qty || 0) + '" oninput="lwP3Gas(' + i + ', \'qty\', this.value)"></td>' +
                '<td><input type="text" class="lw-p3-txt-input" style="width:60px;" value="' + esc(r.unid || 'GLOB') + '" oninput="lwP3Gas(' + i + ', \'unid\', this.value)"></td>' +
                '<td><input type="text" class="lw-p3-txt-input" value="' + esc(r.desc || '') + '" oninput="lwP3Gas(' + i + ', \'desc\', this.value)" style="min-width:220px;"></td>' +
                '<td><input type="number" class="lw-p3-num-input" value="' + (r.costoUnit || 0) + '" oninput="lwP3Gas(' + i + ', \'costoUnit\', this.value)"></td>' +
                '<td class="num"><span class="lw-p3-mono lw-p3-bold">' + fmtMoney(total) + '</span></td>' +
                '<td><button type="button" class="lw-cell-del" onclick="lwP3DelRow(\'gastos\', ' + i + ')">×</button></td>' +
            '</tr>';
        }).join('');
        var tot = rows.reduce(function (a, r) { return a + (r.costoUnit || 0) * (r.qty || 0); }, 0);
        foot.innerHTML = '<tr class="lw-p3-foot"><td colspan="5">Subtotal Gastos</td><td class="num lw-p3-mono lw-p3-bold">' + fmtMoney(tot) + '</td><td></td></tr>';
    }
    function recalcP3Summary() {
        var d = state.lev.fase3_data || {};
        var totMat = (d.materiales || []).reduce(function (a, r) { var c = calcMatRow(r); return { c: a.c + c.costoTotal, v: a.v + c.precioVenta }; }, { c: 0, v: 0 });
        var totMO = (d.manoObra || []).reduce(function (a, r) { return a + (r.precioUnit || 0) * (r.qty || 0); }, 0);
        var totGas = (d.gastos || []).reduce(function (a, r) { return a + (r.costoUnit || 0) * (r.qty || 0); }, 0);
        var totalVenta = totMat.v + totMO + totGas;
        var totalCosto = totMat.c + totGas;
        var utilidad = totalVenta - totalCosto;
        var margen = totalVenta > 0 ? (utilidad / totalVenta * 100) : 0;
        $('lwSumMat').textContent = fmtMoney(totMat.v);
        $('lwSumMO').textContent = fmtMoney(totMO);
        $('lwSumGas').textContent = fmtMoney(totGas);
        $('lwSumVenta').textContent = fmtMoney(totalVenta);
        $('lwSumCosto').textContent = fmtMoney(totalCosto);
        $('lwSumUtil').textContent = fmtMoney(utilidad);
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

    window.lwP3Mat = function (i, field, val) {
        if (['qty', 'costoUnit', 'precioLista', 'descCompra', 'descVenta'].indexOf(field) !== -1) val = parseFloat(val) || 0;
        state.lev.fase3_data.materiales[i][field] = val;
        // Re-render solo totales para no perder foco
        renderP3Materiales();
        recalcP3Summary();
        lwFieldChange();
    };
    window.lwP3MO = function (i, field, val) {
        if (['qty', 'precioUnit'].indexOf(field) !== -1) val = parseFloat(val) || 0;
        state.lev.fase3_data.manoObra[i][field] = val;
        renderP3ManoObra();
        recalcP3Summary();
        lwFieldChange();
    };
    window.lwP3Gas = function (i, field, val) {
        if (['qty', 'costoUnit'].indexOf(field) !== -1) val = parseFloat(val) || 0;
        state.lev.fase3_data.gastos[i][field] = val;
        renderP3Gastos();
        recalcP3Summary();
        lwFieldChange();
    };
    window.lwP3AddRow = function (tabla) {
        var d = state.lev.fase3_data;
        if (tabla === 'materiales') {
            d.materiales.push({ partida: d.materiales.length + 1, qty: 1, unid: 'PZA', desc: '', marca: '', modelo: '', costoUnit: 0, precioLista: 0, descCompra: 0, descVenta: 0, proveedor: '', entrega: '' });
            renderP3Materiales();
        } else if (tabla === 'manoObra') {
            d.manoObra.push({ partida: d.manoObra.length + 1, qty: 1, unid: 'SERV', desc: '', precioUnit: 0 });
            renderP3ManoObra();
        } else if (tabla === 'gastos') {
            d.gastos.push({ partida: d.gastos.length + 1, qty: 1, unid: 'GLOB', desc: '', costoUnit: 0 });
            renderP3Gastos();
        }
        recalcP3Summary();
        lwFieldChange();
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
    function renderPhase4() {
        var d = state.lev.fase4_data || {};
        if (!d.actividades) d.actividades = [];
        state.lev.fase4_data = d;
        var list = $('lw_f4_actividades');
        var empty = $('lw_f4_empty');
        if (!d.actividades.length) {
            list.innerHTML = '';
            empty.style.display = 'flex';
            return;
        }
        empty.style.display = 'none';
        list.innerHTML = d.actividades.map(function (a, i) {
            return '<div class="lw-p4-act">' +
                '<div class="lw-p4-act-head">' +
                    '<input class="lw-p4-nombre" type="text" value="' + esc(a.nombre || '') + '" placeholder="Nombre de la actividad" oninput="lwP4Field(' + i + ', \'nombre\', this.value)">' +
                    '<button type="button" class="lw-cell-del" onclick="lwP4DelActividad(' + i + ')">×</button>' +
                '</div>' +
                '<div class="lw-p4-act-grid">' +
                    '<div class="lw-field"><label>Responsable</label><input type="text" value="' + esc(a.responsable || '') + '" oninput="lwP4Field(' + i + ', \'responsable\', this.value)"></div>' +
                    '<div class="lw-field"><label>Inicio</label><input type="date" value="' + esc(a.inicio || '') + '" oninput="lwP4Field(' + i + ', \'inicio\', this.value)"></div>' +
                    '<div class="lw-field"><label>Fin</label><input type="date" value="' + esc(a.fin || '') + '" oninput="lwP4Field(' + i + ', \'fin\', this.value)"></div>' +
                    '<div class="lw-field"><label>Progreso %</label><input type="number" min="0" max="100" value="' + (a.progreso || 0) + '" oninput="lwP4Field(' + i + ', \'progreso\', this.value)"></div>' +
                '</div>' +
                '<div class="lw-p4-bar-wrap"><div class="lw-p4-bar" style="width:' + Math.min(100, Math.max(0, a.progreso || 0)) + '%;"></div></div>' +
            '</div>';
        }).join('');
    }
    window.lwP4Field = function (i, field, val) {
        if (field === 'progreso') val = Math.max(0, Math.min(100, parseFloat(val) || 0));
        state.lev.fase4_data.actividades[i][field] = val;
        lwFieldChange();
        // re-render solo la barra (sin reset de inputs para no perder foco)
        var card = document.querySelectorAll('.lw-p4-act')[i];
        if (card) {
            var bar = card.querySelector('.lw-p4-bar');
            if (bar && field === 'progreso') bar.style.width = val + '%';
        }
    };
    window.lwP4AddActividad = function () {
        var today = new Date().toISOString().split('T')[0];
        var d = state.lev.fase4_data;
        d.actividades = d.actividades || [];
        d.actividades.push({
            id: Date.now(), nombre: 'Nueva actividad', responsable: '',
            inicio: today, fin: today, progreso: 0,
        });
        renderPhase4();
        lwFieldChange();
    };
    window.lwP4DelActividad = function (i) {
        state.lev.fase4_data.actividades.splice(i, 1);
        renderPhase4();
        lwFieldChange();
    };
    function collectPhase4() { return state.lev.fase4_data || {}; }

    // ═══════════════════════════════════════════════════════════════
    //  PHASE 5 — REPORTES (preview A4)
    // ═══════════════════════════════════════════════════════════════
    function renderPhase5() {
        var f1 = state.lev.fase1_data || {};
        var f3 = state.lev.fase3_data || {};
        var f4 = state.lev.fase4_data || {};
        var mat = f3.materiales || [];
        var mo = f3.manoObra || [];
        var gas = f3.gastos || [];
        var totMat = mat.reduce(function (a, r) { var c = calcMatRow(r); return { c: a.c + c.costoTotal, v: a.v + c.precioVenta }; }, { c: 0, v: 0 });
        var totMO = mo.reduce(function (a, r) { return a + (r.precioUnit || 0) * (r.qty || 0); }, 0);
        var totGas = gas.reduce(function (a, r) { return a + (r.costoUnit || 0) * (r.qty || 0); }, 0);
        var totalVenta = totMat.v + totMO + totGas;
        var totalCosto = totMat.c + totGas;
        var utilidad = totalVenta - totalCosto;
        var margen = totalVenta > 0 ? (utilidad / totalVenta * 100) : 0;
        var today = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

        var html = '<div class="lw-p5-portada">' +
            '<div class="lw-p5-logo">IAMET</div>' +
            '<h1>' + esc(state.lev.nombre || 'Levantamiento') + '</h1>' +
            '<h2>' + esc(f1.cliente || '') + '</h2>' +
            '<div class="lw-p5-meta">' + esc(f1.area || '') + (f1.fecha ? ' · ' + esc(f1.fecha) : '') + '</div>' +
            '<div class="lw-p5-date">Emitido el ' + today + '</div>' +
        '</div>';

        html += '<hr class="lw-p5-sep">';

        html += '<div class="lw-p5-section">' +
            '<h3>Datos Generales</h3>' +
            '<div class="lw-p5-grid">' +
                '<div><span>Cliente:</span> ' + esc(f1.cliente || '—') + '</div>' +
                '<div><span>Contacto:</span> ' + esc(f1.contacto || '—') + '</div>' +
                '<div><span>Área:</span> ' + esc(f1.area || '—') + '</div>' +
                '<div><span>Fecha:</span> ' + esc(f1.fecha || '—') + '</div>' +
                '<div><span>Email:</span> ' + esc(f1.email || '—') + '</div>' +
                '<div><span>Teléfono:</span> ' + esc(f1.telefono || '—') + '</div>' +
            '</div>' +
        '</div>';

        html += '<div class="lw-p5-section">' +
            '<h3>Necesidad Reportada</h3>' +
            '<p>' + esc(f1.descripcion || 'Sin descripción.') + '</p>' +
        '</div>';

        if ((f1.servicios || []).length || (f1.componentes || []).length) {
            html += '<div class="lw-p5-section">' +
                '<h3>Alcance</h3>' +
                '<div><strong>Servicios:</strong> ' + esc((f1.servicios || []).join(', ') || '—') + '</div>' +
                '<div style="margin-top:4px;"><strong>Componentes:</strong> ' + esc((f1.componentes || []).join(', ') || '—') + '</div>' +
            '</div>';
        }

        // Volumetría (resumen)
        html += '<div class="lw-p5-section">' +
            '<h3>Resumen Financiero</h3>' +
            '<table class="lw-p5-table">' +
                '<tr><td>Subtotal Materiales</td><td class="num">' + fmtMoney(totMat.v) + '</td></tr>' +
                '<tr><td>Subtotal Mano de Obra</td><td class="num">' + fmtMoney(totMO) + '</td></tr>' +
                '<tr><td>Subtotal Gastos</td><td class="num">' + fmtMoney(totGas) + '</td></tr>' +
                '<tr class="lw-p5-strong"><td>TOTAL VENTA</td><td class="num">' + fmtMoney(totalVenta) + '</td></tr>' +
                '<tr><td>Total Costos</td><td class="num">' + fmtMoney(totalCosto) + '</td></tr>' +
                '<tr class="lw-p5-strong"><td>Utilidad Bruta</td><td class="num">' + fmtMoney(utilidad) + ' (' + margen.toFixed(1) + '%)</td></tr>' +
            '</table>' +
        '</div>';

        // Programa de obra
        var acts = f4.actividades || [];
        if (acts.length) {
            html += '<div class="lw-p5-section">' +
                '<h3>Programa de Obra</h3>' +
                '<table class="lw-p5-table">' +
                    '<tr><th>Actividad</th><th>Responsable</th><th>Inicio</th><th>Fin</th><th class="num">Progreso</th></tr>' +
                    acts.map(function (a) {
                        return '<tr>' +
                            '<td>' + esc(a.nombre || '') + '</td>' +
                            '<td>' + esc(a.responsable || '') + '</td>' +
                            '<td>' + esc(a.inicio || '') + '</td>' +
                            '<td>' + esc(a.fin || '') + '</td>' +
                            '<td class="num">' + (a.progreso || 0) + '%</td>' +
                        '</tr>';
                    }).join('') +
                '</table>' +
            '</div>';
        }

        $('lw_f5_preview').innerHTML = html;
    }
    window.lwP5Imprimir = function () {
        window.print();
    };
    window.lwP5ExportarPDF = function () {
        alert('Exportación PDF — pendiente: se implementará del lado del servidor en una iteración posterior. Por ahora usa "Imprimir" → Guardar como PDF.');
    };
    function collectPhase5() { return state.lev.fase5_data || {}; }

    // Atajos de teclado dentro del wizard:
    //  - ⌘K / Ctrl+K: abrir catálogo de productos en Fase 1
    //  - ⌘S / Ctrl+S: guardar fase actual
    //  - NO hay ESC para cerrar (sólo la X, protege trabajo de campo).
    document.addEventListener('keydown', function (e) {
        var ov = $('levantamientoWizard');
        if (!ov || ov.style.display === 'none') return;
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
