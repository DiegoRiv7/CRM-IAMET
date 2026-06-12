/* ═══════════════════════════════════════════════════════════════════════
 * oportunidad_widget_v2.js — CÓDIGO NUEVO (desde 2026-06-09)
 *
 * Widget de Oportunidad INSTANCIABLE — Refactor Etapa 1.
 *
 * Reemplaza el bloque "Widget Detalle de Oportunidad" de crm_main.js
 * (líneas ~751-2041, congelado) y el markup singleton #widgetDetalle.
 * Cada oportunidad abierta es una INSTANCIA: un clon del <template>
 * #tplOppWidgetV2 (_widget_oportunidad_v2.html) con todo el estado y
 * los lookups scoped a su raíz (data-wo, cero ids → hasta 4 abiertas
 * a la vez, todas editables, integradas con widget_window.js).
 *
 * Contrato público que mantiene (ver mapa en memoria del proyecto):
 *   window.openDetalle(oppId)         — 17 llamadores externos
 *   window._woCurrentOppId / _woCurrentOppData — instancia con foco
 *   window.woSetCurrentOppId(id)      — se invoca al cambiar foco
 *   sessionStorage._crm_open_opp_id   — restaura al recargar
 *   ?open_opp=<id>                    — URL sync (crmWidgetUrl)
 *
 * Widgets satélite (siguen siendo singletons, se abren tras fijar foco):
 *   Drive (woAbrirGestorDrive), Conversación (woAbrirGestorConversacion),
 *   crear actividad (woAbrirWidgetCrearActividad), crear tarea
 *   (crmTaskAbrirCrear), todas-tareas (woAbrirTodasTareas), detalle tarea
 *   (crmTaskVerDetalle), actividad (woVerActividad), asistente
 *   (asistenteAbrir), cotizador (openCotizador/openEditCotizacion),
 *   confirm tipo (#widgetConfirmTipo), vincular proyecto (#wopVincularModal).
 *
 * Takeover: si este script carga y el <template> existe, window.openDetalle
 * apunta aquí y la línea-guard en el openDetalle legacy enruta los callers
 * internos (kanban/lista). Rollback: localStorage.setItem('opp_v2_off','1')
 * y recargar, o quitar el include/script.
 * ═══════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    var MAX_INSTANCES = 4;

    var MES_NOMBRES = {
        '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
        '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
        '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
    };
    var WO_PRODUCTOS = [['ZEBRA', 'Zebra'], ['PANDUIT', 'Panduit'], ['APC', 'APC'], ['AVIGILION', 'Avigilon'], ['GENETEC', 'Genetec'], ['AXIS', 'Axis'], ['SOFTWARE', 'Software'], ['RUNRATE', 'Runrate'], ['PÓLIZA', 'Poliza'], ['CISCO', 'Cisco'], ['SERVICIO', 'Servicio']];
    var WO_AREAS = [['SISTEMAS', 'Sistemas'], ['Recursos Humanos', 'Recursos Humanos'], ['Compras', 'Compras'], ['Seguridad', 'Seguridad'], ['Mantenimiento', 'Mantenimiento'], ['Almacén', 'Almacén']];
    var WO_MESES = [['01', 'Enero'], ['02', 'Febrero'], ['03', 'Marzo'], ['04', 'Abril'], ['05', 'Mayo'], ['06', 'Junio'], ['07', 'Julio'], ['08', 'Agosto'], ['09', 'Septiembre'], ['10', 'Octubre'], ['11', 'Noviembre'], ['12', 'Diciembre']];

    var instances = [];
    var focused = null;
    var instSeq = 0;
    var lastNotifiedOppId = null;   // último id pasado a woSetCurrentOppId

    /* ── Helpers ──────────────────────────────────────────────────── */

    function q(inst, name) {
        return inst.root.querySelector('[data-wo="' + name + '"]');
    }

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function getInitials(name) {
        if (!name) return '?';
        var parts = name.trim().split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return parts[0].substring(0, 2).toUpperCase();
    }

    function csrf() {
        var inp = document.querySelector('[name=csrfmiddlewaretoken]');
        if (inp && inp.value) return inp.value;
        var m = document.cookie.match(/csrftoken=([^;]+)/);
        return m ? m[1] : '';
    }

    function notify(msg, type) {
        if (typeof window.toast === 'function') window.toast(msg, type || 'info');
        else console.warn('[oppV2]', msg);
    }

    function getEtapasForTipo(tipo) {
        var cfg = (window._CRM_CONFIG && window._CRM_CONFIG.etapasPipeline) || {};
        var pipelineData = cfg[tipo];
        if (pipelineData && pipelineData.length) {
            return pipelineData.map(function (e) { return e.nombre; });
        }
        if (tipo === 'proyecto') {
            return ['Oportunidad', 'Levantamiento', 'Base Cotización', 'Cotizando', 'Enviada', 'Seguimiento', 'Vendido s/PO', 'Vendido c/PO', 'Cotiz. Proveedor', 'Comprando', 'En Tránsito', 'Ejecutando', 'Entregado', 'Facturado', 'Reportes', 'Pagado', 'Perdido'];
        }
        return ['En Solicitud', 'Cotizando', 'Enviada', 'Seguimiento', 'Vendido s/PO', 'Vendido c/PO', 'En Tránsito', 'Facturado', 'Programado', 'Entregado', 'Esperando Pago', 'Sin Respuesta', 'Ganado', 'Perdido'];
    }

    function alive(inst) {
        return inst && inst.alive && document.body.contains(inst.root);
    }

    function liveInstances() {
        instances = instances.filter(alive);
        return instances;
    }

    function isVisible(inst) {
        var cs = window.getComputedStyle(inst.root);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    function isWindowed(inst) { return inst.root.classList.contains('ww-windowed'); }
    function isMinimized(inst) { return inst.root.classList.contains('ww-minimized'); }

    /* ── Sub-widgets como VENTANA cuando la opp está en ventana ─────
       Drive, Conversación, Actividad y Todas-las-tareas son overlays
       SINGLETON del legacy: abiertos desde una opp windowizada tapaban
       TODO el escritorio (modal fullscreen sobre las demás ventanas).
       Regla: si la opp que los abre está en ventana, el sub-widget
       también — en cascada junto a ella. Al cerrarse, widget_window lo
       regresa a modal (el estado ventana no persiste), así el flujo
       modal clásico queda intacto cuando la opp es modal. Se llama
       DESPUÉS del opener legacy (que ya lo dejó visible). */
    function openSubWindowed(inst, overlayId) {
        if (!inst || !isWindowed(inst)) return;          // modo modal clásico
        var ww = window.crmWidgetWindow;
        if (!ww || typeof ww.windowize !== 'function') return;
        var ov = document.getElementById(overlayId);
        if (!ov || !ov.classList.contains('widget-overlay')) return;
        if (ov.classList.contains('ww-windowed')) {
            // Ya está en ventana (p.ej. el drive de OTRA opp): el opener
            // legacy ya re-apuntó su contenido al nuevo foco — solo
            // traerla al frente.
            if (window.crmWidgetStack) {
                window.crmWidgetStack.remove(ov);
                window.crmWidgetStack.push(ov);
            }
            return;
        }
        try { ww.enhance(ov); } catch (e) { }
        var r = null;
        try {
            var card = inst.root.querySelector('.ww-card') || inst.root.firstElementChild;
            var b = card ? card.getBoundingClientRect() : null;
            var vw = window.innerWidth, vh = window.innerHeight;
            // Formularios compactos: ventana a la medida del contenido —
            // con el tamaño genérico quedaban como sábana blanca vacía.
            var pref = {
                widgetOppCrearActividad: { w: 620, h: 560 },
                widgetOppVerActividad: { w: 640, h: 600 },
                widgetTodasTareas: { w: 780, h: 680 },
            }[overlayId] || null;
            var w = Math.min(pref ? pref.w : Math.min(Math.round(vw * 0.46), 880), vw - 24);
            var h = Math.min(pref ? pref.h : Math.min(Math.round(vh * 0.74), 740), vh - 24);
            var x = b ? Math.round(Math.min(b.left + 56, vw - w - 12)) : Math.round((vw - w) / 2);
            var y = b ? Math.round(Math.min(b.top + 56, vh - h - 12)) : Math.round((vh - h) / 2);
            r = { x: Math.max(8, x), y: Math.max(8, y), w: w, h: h };
        } catch (e) { r = null; }
        ww.windowize(ov, r);
    }

    function bringFront(inst) {
        if (window.crmWidgetStack) {
            window.crmWidgetStack.remove(inst.root);
            window.crmWidgetStack.push(inst.root);
        }
    }

    function updateBodyScroll() {
        var anyModal = liveInstances().some(function (i) {
            return isVisible(i) && !isWindowed(i);
        });
        document.body.style.overflow = anyModal ? 'hidden' : '';
    }

    /* ── Foco (contrato _woCurrentOppId para los satélites) ───────── */

    function setFocus(inst) {
        focused = inst;
        window._woCurrentOppId = inst.oppId;
        window._woCurrentOppData = inst.data;
        // woSetCurrentOppId (template legacy) además recarga tareas/actividad
        // en el markup legacy oculto — solo avisar cuando el id CAMBIA para
        // no duplicar fetches en cada click.
        if (inst.oppId && inst.oppId !== lastNotifiedOppId &&
            typeof window.woSetCurrentOppId === 'function') {
            lastNotifiedOppId = inst.oppId;
            try { window.woSetCurrentOppId(inst.oppId); } catch (e) { }
        }
    }

    /* ── Creación de instancias ───────────────────────────────────── */

    function createInstance() {
        var tpl = document.getElementById('tplOppWidgetV2');
        if (!tpl) return null;
        var frag = tpl.content.cloneNode(true);
        var root = frag.querySelector('[data-wo="root"]');
        root.setAttribute('data-opp-v2-inst', String(++instSeq));

        var inst = {
            seq: instSeq,
            root: root,
            oppId: null,
            data: null,        // snapshot original (woOriginalData)
            edited: {},        // campos modificados (woEditedFields)
            actividadId: null, // _woActividadRecienteId scoped
            alive: true,
        };

        // Foco al interactuar con la instancia
        root.addEventListener('pointerdown', function () { setFocus(inst); });

        // Delegación de acciones declarativas (data-action)
        root.addEventListener('click', function (ev) {
            var el = ev.target.closest('[data-action]');
            if (!el || !root.contains(el)) return;
            handleAction(inst, el.getAttribute('data-action'), ev);
        });

        // Backdrop (solo modo modal: en ventana el overlay no recibe clicks)
        root.addEventListener('click', function (ev) {
            if (ev.target === root) close(inst, false);
        });

        // PO / Factura: blur guarda, Enter = blur, focus subraya
        wireDocInput(inst, 'poNumber', 'po_number');
        wireDocInput(inst, 'facturaNumero', 'factura_numero');

        // Probabilidad: drag en la barra
        q(inst, 'probBar').addEventListener('mousedown', function (e) {
            if (window.ES_INGENIERO) return;
            probDrag = inst;
            updateProbVisual(inst, probFromEvent(inst, e));
            e.preventDefault();
        });

        document.body.appendChild(frag);
        instances.push(inst);

        // Integración con el sistema de ventanas (esquinas, — □, dock).
        if (window.crmWidgetWindow) {
            try { window.crmWidgetWindow.enhance(root); } catch (e) { }
        }
        return inst;
    }

    function wireDocInput(inst, name, field) {
        var input = q(inst, name);
        input.addEventListener('focus', function () {
            input.style.borderBottomColor = '#0052D4';
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') input.blur();
        });
        input.addEventListener('blur', function () {
            input.style.borderBottomColor = 'transparent';
            var val = input.value.trim();
            if (!inst.data || val === (inst.data[field] || '')) return;
            var fd = new FormData();
            fd.append(field, val);
            fetch('/app/api/oportunidad/' + inst.oppId + '/po/', {
                method: 'POST', body: fd,
                headers: { 'X-CSRFToken': csrf() },
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (data.ok) { inst.data[field] = val; }
                else { input.value = inst.data[field] || ''; }
            }).catch(function () { input.value = inst.data[field] || ''; });
        });
    }

    /* ── Acciones (data-action) ───────────────────────────────────── */

    function handleAction(inst, action, ev) {
        switch (action) {
            case 'close':
                ev.stopPropagation();
                close(inst, false);
                break;
            case 'pipeline-izq':
                q(inst, 'pipelineScroll').scrollBy({ left: -150, behavior: 'smooth' });
                break;
            case 'pipeline-der':
                q(inst, 'pipelineScroll').scrollBy({ left: 150, behavior: 'smooth' });
                break;
            case 'nueva-tarea':
                setFocus(inst);
                if (typeof window.crmTaskAbrirCrear === 'function') window.crmTaskAbrirCrear(inst.oppId);
                else notify('Funcionalidad de crear tarea no disponible', 'warning');
                break;
            case 'nueva-cot':
                setFocus(inst);
                openCotizadorV2(inst.oppId, inst);
                break;
            case 'nueva-actividad':
                ev.stopPropagation();
                setFocus(inst);
                if (typeof window.woAbrirWidgetCrearActividad === 'function') window.woAbrirWidgetCrearActividad();
                break;
            case 'abrir-actividad':
                setFocus(inst);
                if (inst.actividadId && typeof window.woVerActividad === 'function') {
                    window.woVerActividad(inst.actividadId);
                    openSubWindowed(inst, 'widgetOppVerActividad');
                } else if (typeof window.woAbrirWidgetCrearActividad === 'function') {
                    window.woAbrirWidgetCrearActividad();
                    openSubWindowed(inst, 'widgetOppCrearActividad');
                }
                break;
            case 'abrir-drive':
                setFocus(inst);
                if (isWindowed(inst)) {
                    // Multi-drive real: una ventana-iframe POR oportunidad
                    // (página standalone /app/widget/drive/<id>/ — el
                    // singleton legacy se instancia gratis dentro del
                    // iframe, mismo truco que el cotizador).
                    openDriveWindow(inst);
                } else if (typeof window.woAbrirGestorDrive === 'function') {
                    window.woAbrirGestorDrive();
                }
                break;
            case 'abrir-conversacion':
                setFocus(inst);
                if (typeof window.woAbrirGestorConversacion === 'function') {
                    window.woAbrirGestorConversacion();
                    openSubWindowed(inst, 'widgetOppConversacion');
                }
                break;
            case 'abrir-asistente':
                setFocus(inst);
                if (typeof window.asistenteAbrir === 'function') {
                    window.asistenteAbrir({
                        oportunidad: {
                            id: inst.oppId,
                            titulo: (inst.data && inst.data.oportunidad) || '',
                        },
                    });
                }
                break;
            case 'vincular-proyecto':
                abrirVincularProyecto(inst);
                break;
            case 'save-confirm':
                saveEdits(inst);
                break;
            case 'save-cancel':
                inst.edited = {};
                hideSaveBar(inst);
                if (inst.data) render(inst, inst.data);
                break;
        }
    }

    /* ── Apertura / política de instancias ────────────────────────── */

    function open(oppId) {
        var id = parseInt(String(oppId).replace(/[^\d]/g, ''), 10);
        if (!id || isNaN(id)) return;

        var list = liveInstances();

        // ¿Ya está abierta esta oportunidad? → traerla al frente y refrescar.
        var same = list.find(function (i) { return i.oppId === id; });
        if (same) {
            same.root.classList.remove('ww-minimized');  // restaura del dock si aplica
            same.root.style.display = 'flex';
            bringFront(same);
            load(same, id);
            return;
        }

        // Política: una instancia MODAL visible se reutiliza (paridad con el
        // legacy: abrir otra opp desde el kanban reemplaza el modal). Las
        // instancias en MODO VENTANA no se tocan: la nueva abre aparte.
        var target = list.find(function (i) {
            return isVisible(i) && !isWindowed(i) && !isMinimized(i);
        });

        if (!target) {
            if (list.length >= MAX_INSTANCES) {
                notify('Máximo ' + MAX_INSTANCES + ' oportunidades abiertas — se reutiliza la activa', 'warning');
                target = (focused && alive(focused)) ? focused : list[list.length - 1];
                target.root.classList.remove('ww-minimized');
            } else {
                target = createInstance();
                if (!target) return;
                var others = liveInstances().filter(function (i) {
                    return i !== target && isVisible(i) && !isMinimized(i);
                });
                target.root.style.display = 'flex';
                // Si ya hay ventanas abiertas, la nueva nace como ventana en
                // cascada (no como modal que taparía a las demás).
                if (others.length && window.crmWidgetWindow) {
                    var vw = window.innerWidth, vh = window.innerHeight;
                    var w = Math.min(Math.round(vw * 0.62), 1150);
                    var h = Math.round(vh * 0.8);
                    var n = others.length;
                    window.crmWidgetWindow.windowize(target.root, {
                        x: Math.max(10, Math.min(40 + n * 38, vw - w - 16)),
                        y: Math.max(8, Math.min(28 + n * 34, vh - h - 12)),
                        w: w, h: h,
                    });
                }
            }
        }

        load(target, id);
    }

    function load(inst, oppId) {
        inst.oppId = oppId;
        inst.edited = {};
        inst._lastLoad = Date.now();
        inst.root.style.display = 'flex';
        setFocus(inst);
        updateBodyScroll();

        q(inst, 'loading').style.display = 'block';
        q(inst, 'content').style.display = 'none';
        hideSaveBar(inst);

        // Persistencia + URL: la última abierta es la que se restaura.
        try { sessionStorage.setItem('_crm_open_opp_id', oppId); } catch (e) { }
        if (window.crmWidgetUrl) window.crmWidgetUrl.set('opp', oppId);

        fetch('/app/api/oportunidad-detalle-crm/' + oppId + '/')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!alive(inst) || inst.oppId !== oppId) return;  // cerrada o reusada mientras cargaba
                if (data.error) {
                    notify('Error: ' + data.error, 'error');
                    doClose(inst);
                    return;
                }
                try {
                    render(inst, data);
                } catch (err) {
                    // Nunca dejar el spinner infinito: el error se muestra en
                    // la card (diagnosticable) y la instancia se puede cerrar.
                    console.error('[oppV2] render error opp ' + oppId + ':', err);
                    q(inst, 'loading').innerHTML =
                        '<div style="color:#FF3B30;font-size:0.9rem;font-weight:600;margin-bottom:0.5rem;">Error al mostrar la oportunidad</div>' +
                        '<div style="color:#86868B;font-size:0.78rem;font-family:monospace;max-width:480px;margin:0 auto 1rem;word-break:break-word;">' + esc(err && err.message) + '</div>' +
                        '<button type="button" data-action="close" style="background:#F2F2F7;border:none;border-radius:10px;padding:0.55rem 1.4rem;font-weight:600;cursor:pointer;">Cerrar</button>';
                    return;
                }
                q(inst, 'loading').style.display = 'none';
                q(inst, 'content').style.display = 'flex';
                setFocus(inst);  // ahora con data completa
                // Proyectos Bitrix24: abrir el Drive automáticamente.
                if (data.tipo_negociacion === 'bitrix_proyecto') {
                    setTimeout(function () {
                        if (isWindowed(inst)) {
                            openDriveWindow(inst);
                        } else if (typeof window.woAbrirGestorDrive === 'function') {
                            window.woAbrirGestorDrive();
                        }
                    }, 150);
                }
            })
            .catch(function () {
                notify('Error cargando detalle', 'error');
                doClose(inst);
            });
    }

    /* ── Render principal (port de renderDetalle, scoped) ─────────── */

    function render(inst, d) {
        inst.data = JSON.parse(JSON.stringify(d));
        inst.edited = {};
        hideSaveBar(inst);

        var tipo = d.tipo_negociacion || 'runrate';
        var ing = !!window.ES_INGENIERO;
        // Compat: crm_ingeniero.js seteaba este flag observando el widget legacy.
        if (ing) window._ingenieroModeActive = true;

        // ── Type badge ──
        var badge = q(inst, 'typeBadge');
        badge.className = 'wo-type-badge ' + tipo;
        var badgeIcon, badgeLabel;
        if (tipo === 'bitrix_proyecto') {
            badgeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
            badgeLabel = 'PROYECTO BITRIX24';
            badge.style.cssText += 'cursor:default;background:#5856D6;border-color:#5856D6;color:#fff;';
        } else {
            badge.style.cursor = ing ? 'default' : 'pointer';
            badge.style.background = '';
            badge.style.borderColor = '';
            badge.style.color = '';
            badgeIcon = tipo === 'proyecto'
                ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>'
                : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>';
            badgeLabel = tipo === 'proyecto' ? 'VENTA PROYECTO' : 'VENTA RUNRATE';
        }
        badge.innerHTML = badgeIcon + '<span>' + badgeLabel + '</span>';
        badge.onclick = (tipo === 'bitrix_proyecto' || ing) ? null : function (e) {
            e.preventDefault();
            e.stopPropagation();
            confirmarCambioTipo(inst, tipo);
        };

        // ── Título (editable) ──
        var titleEl = q(inst, 'title');
        titleEl.textContent = d.oportunidad || '';
        if (ing) {
            titleEl.style.cursor = 'default'; titleEl.title = ''; titleEl.onclick = null;
        } else {
            titleEl.style.cursor = 'pointer';
            titleEl.title = 'Clic para editar nombre';
            titleEl.onclick = function () {
                if (titleEl.querySelector('input')) return;
                var currentName = titleEl.textContent;
                var inp = document.createElement('input');
                inp.type = 'text';
                inp.value = currentName;
                inp.style.cssText = 'font-size:1.8rem;font-weight:700;color:#1D1D1F;border:none;border-bottom:2px solid #0052D4;background:transparent;outline:none;width:100%;letter-spacing:-0.02em;font-family:inherit;padding:0;';
                titleEl.textContent = '';
                titleEl.appendChild(inp);
                inp.focus();
                inp.select();
                function commitTitle() {
                    var newName = inp.value.trim();
                    if (!newName) newName = currentName;
                    titleEl.textContent = newName;
                    if (newName !== (inst.data.oportunidad || '')) {
                        fieldChanged(inst, 'oportunidad', newName);
                    }
                }
                inp.addEventListener('blur', commitTitle);
                inp.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
                    if (e.key === 'Escape') { titleEl.textContent = currentName; }
                });
            };
        }

        // Título de ventana (dock, breadcrumb)
        inst.root.setAttribute('data-widget-title', d.oportunidad || 'Oportunidad');

        // ── Pipeline ──
        var stagesContainer = q(inst, 'pipelineStages');
        stagesContainer.innerHTML = '';
        var pipelineWrap = q(inst, 'pipelineWrap');
        pipelineWrap.style.display = (tipo === 'bitrix_proyecto') ? 'none' : '';

        var etapas = getEtapasForTipo(tipo);
        var currentEtapa = d.etapa_corta || etapas[0];
        var currentIdx = -1;
        for (var i = 0; i < etapas.length; i++) {
            if (etapas[i].toLowerCase() === currentEtapa.toLowerCase() ||
                currentEtapa.toLowerCase().indexOf(etapas[i].toLowerCase()) !== -1 ||
                etapas[i].toLowerCase().indexOf(currentEtapa.toLowerCase()) !== -1) {
                currentIdx = i;
                break;
            }
        }
        if (currentIdx === -1) currentIdx = 0;

        etapas.forEach(function (et, idx) {
            if (idx > 0) {
                var conn = document.createElement('span');
                conn.className = 'wo-stage-connector' + (idx <= currentIdx ? ' completed' : '');
                stagesContainer.appendChild(conn);
            }
            var btn = document.createElement('button');
            btn.type = 'button';
            if (idx < currentIdx) {
                btn.className = 'wo-stage-btn completed';
                btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> ' + esc(et);
            } else if (idx === currentIdx) {
                btn.className = 'wo-stage-btn active';
                btn.textContent = et;
            } else {
                btn.className = 'wo-stage-btn';
                btn.textContent = et;
            }
            if (ing) {
                btn.style.pointerEvents = 'none';
                btn.style.opacity = '0.7';
            } else {
                btn.addEventListener('click', function () { changeStage(inst, et); });
            }
            stagesContainer.appendChild(btn);
        });

        setTimeout(function () {
            var activeBtn = stagesContainer.querySelector('.wo-stage-btn.active');
            if (activeBtn) {
                var scroll = q(inst, 'pipelineScroll');
                scroll.scrollLeft = activeBtn.offsetLeft - scroll.offsetWidth / 2 + activeBtn.offsetWidth / 2;
            }
        }, 50);

        // ── Info card ──
        var montoNum = Number(d.monto) || 0;
        q(inst, 'monto').textContent = '$' + montoNum.toLocaleString('es-MX', { minimumFractionDigits: 0 });
        var mesNombre = MES_NOMBRES[d.mes_cierre] || d.mes_cierre || '-';
        q(inst, 'fechaCierre').textContent = mesNombre + ' ' + new Date().getFullYear();
        q(inst, 'producto').textContent = d.producto || 'N/A';
        q(inst, 'area').textContent = d.area || 'N/A';
        q(inst, 'poNumber').value = d.po_number || '';
        q(inst, 'facturaNumero').value = d.factura_numero || '';
        updateProbVisual(inst, d.probabilidad_cierre || 0);

        // ── Vendedor / Cliente / Contacto ──
        var vendedor = d.usuario || 'Sin asignar';
        q(inst, 'vendedorAvatar').textContent = getInitials(vendedor);
        q(inst, 'vendedorName').textContent = vendedor;
        var clienteNombre = d.cliente ? d.cliente.nombre : 'Sin empresa';
        q(inst, 'clienteAvatar').textContent = getInitials(clienteNombre);
        q(inst, 'clienteName').textContent = clienteNombre;
        q(inst, 'contactoName').textContent = d.contacto || 'No asignado';

        // ── Cotizaciones ──
        renderCotizaciones(inst, d);

        // ── Edición inline ──
        if (!ing) setupEditable(inst, d);
        else aplicarRestriccionesIngeniero(inst);

        // ── Secciones asíncronas (un error en una sección no tumba el render) ──
        try { renderTareas(inst); } catch (e) { console.error('[oppV2] tareas:', e); }
        try { renderActividad(inst); } catch (e) { console.error('[oppV2] actividad:', e); }
        try { renderProyecto(inst, d); } catch (e) { console.error('[oppV2] proyecto:', e); }
    }

    function renderCotizaciones(inst, d) {
        var ing = !!window.ES_INGENIERO;
        var quoteList = q(inst, 'quoteList');
        quoteList.innerHTML = '';
        q(inst, 'btnNuevaCot').style.display = ing ? 'none' : '';
        if (d.cotizaciones && d.cotizaciones.length > 0) {
            d.cotizaciones.forEach(function (cot) {
                var card = document.createElement('div');
                card.className = 'wo-quote-card';
                var cotId = String(cot.id == null ? '' : cot.id).padStart(3, '0');
                var totalStr = (Number(cot.total) || 0).toLocaleString('es-MX', { minimumFractionDigits: 0 });
                card.innerHTML =
                    '<div class="wo-quote-left">' +
                    '<div class="wo-quote-badge">#' + cotId + '</div>' +
                    '<div class="wo-quote-info" data-cot-open style="cursor:pointer;">' +
                    '<div class="wo-quote-title">COT-' + new Date().getFullYear() + '-' + cotId + '<span class="wo-quote-version">(v1.0)</span></div>' +
                    '<div class="wo-quote-meta">' + esc(cot.fecha) + ' &bull; $' + totalStr + '</div>' +
                    '</div>' +
                    '</div>' +
                    '<div class="wo-quote-actions">' +
                    '<a href="#" data-cot-edit class="wo-action-btn" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></a>' +
                    '<a href="/app/cotizacion/pdf/' + cot.id + '/" class="wo-action-btn" title="Descargar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a>' +
                    '</div>';
                card.querySelector('[data-cot-open]').addEventListener('click', function () {
                    window.open('/app/cotizacion/view/' + cot.id + '/', '_blank');
                });
                card.querySelector('[data-cot-edit]').addEventListener('click', function (e) {
                    e.preventDefault();
                    setFocus(inst);
                    openEditCotizacionV2(cot.id, inst);
                });
                quoteList.appendChild(card);
            });
        } else {
            quoteList.innerHTML = '<div class="wo-empty">Sin cotizaciones aun</div>';
        }
    }

    /* ── Cambio de tipo (modal de confirmación singleton) ─────────── */

    function confirmarCambioTipo(inst, tipoActual) {
        var newTipo = tipoActual === 'proyecto' ? 'runrate' : 'proyecto';
        var targetName = newTipo === 'proyecto' ? 'Ventas de Proyectos' : 'Ventas Runrate';

        var overlay = document.getElementById('widgetConfirmTipo');
        if (!overlay) { notify('Error: widgetConfirmTipo no encontrado', 'error'); return; }
        var txt = document.getElementById('confirmTipoText');
        if (txt) txt.innerHTML = '¿Estás seguro que deseas cambiar esta oportunidad a <b>' + targetName + '</b>?<br><br>Al confirmar, las etapas del pipeline se reiniciarán a su estado inicial.';
        var btnCancel = document.getElementById('confirmTipoCancel');
        var btnAccept = document.getElementById('confirmTipoAccept');

        overlay.classList.add('active');
        btnCancel.onclick = function () { overlay.classList.remove('active'); };
        btnAccept.onclick = function () {
            overlay.classList.remove('active');
            var fd = new FormData();
            fd.append('tipo_negociacion', newTipo);
            fd.append('etapa_corta', getEtapasForTipo(newTipo)[0]);
            btnAccept.textContent = 'Cambiando...';
            fetch('/app/api/editar-oportunidad/' + inst.oppId + '/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf() },
                body: fd,
            }).then(function (r) { return r.json(); }).then(function (resp) {
                btnAccept.textContent = 'Sí, cambiar';
                if (resp.success) {
                    notify('Tipo cambiado a ' + (newTipo === 'proyecto' ? 'Proyecto' : 'Runrate'), 'success');
                    emitOppChange(inst.oppId);
                    load(inst, inst.oppId);
                } else {
                    notify(resp.error || 'Error', 'error');
                }
            });
        };
    }

    /* ── Edición inline ───────────────────────────────────────────── */

    function showSaveBar(inst) {
        if (Object.keys(inst.edited).length > 0) q(inst, 'saveBar').style.display = 'flex';
    }
    function hideSaveBar(inst) {
        q(inst, 'saveBar').style.display = 'none';
    }
    function fieldChanged(inst, field, value) {
        inst.edited[field] = value;
        showSaveBar(inst);
    }

    function makeSelect(options, currentVal) {
        var sel = document.createElement('select');
        sel.className = 'wo-inline-select';
        options.forEach(function (o) {
            var opt = document.createElement('option');
            opt.value = o[0];
            opt.textContent = o[1];
            if (o[0] === currentVal || o[1] === currentVal) opt.selected = true;
            sel.appendChild(opt);
        });
        return sel;
    }

    function makeAutocomplete(container, placeholder, searchUrl, onSelect) {
        container.innerHTML = '';
        var wrap = document.createElement('div');
        wrap.className = 'wo-inline-ac';
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = placeholder;
        inp.className = 'wo-inline-input';
        var dd = document.createElement('div');
        dd.className = 'wo-ac-dropdown';
        dd.style.display = 'none';
        wrap.appendChild(inp);
        wrap.appendChild(dd);
        container.appendChild(wrap);
        inp.focus();

        function doSearch(qStr) {
            var sep = searchUrl.indexOf('?') !== -1 ? '&' : '?';
            fetch(searchUrl + sep + 'q=' + encodeURIComponent(qStr))
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    dd.innerHTML = '';
                    var items = data.clientes || data.usuarios || data.contactos || [];
                    if (items.length === 0) { dd.style.display = 'none'; return; }
                    items.forEach(function (item) {
                        var div = document.createElement('div');
                        div.className = 'wo-ac-item';
                        var name = item.nombre_completo || item.nombre || item.username || '';
                        var sub = item.contacto_principal || item.email || item.rol || '';
                        div.innerHTML = esc(name) + (sub ? '<div class="wo-ac-sub">' + esc(sub) + '</div>' : '');
                        div.addEventListener('click', function () {
                            onSelect(item);
                            dd.style.display = 'none';
                        });
                        dd.appendChild(div);
                    });
                    dd.style.display = 'block';
                });
        }

        doSearch('');

        var acTimer = null;
        inp.addEventListener('input', function () {
            clearTimeout(acTimer);
            acTimer = setTimeout(function () { doSearch(inp.value.trim()); }, 200);
        });
        setTimeout(function () {
            document.addEventListener('click', function closeAc(e) {
                if (!wrap.contains(e.target)) {
                    dd.style.display = 'none';
                    document.removeEventListener('click', closeAc);
                }
            });
        }, 100);
    }

    function wireSelectField(inst, name, field, options, suffix) {
        var el = q(inst, name);
        el.classList.add('editable');
        el.onclick = function () {
            if (el.querySelector('select')) return;
            var currentVal = inst.edited[field] || inst.data[field] || '';
            var sel = makeSelect(options, currentVal);
            el.textContent = '';
            el.appendChild(sel);
            sel.focus();
            function setLabel() {
                var label = sel.options[sel.selectedIndex].text;
                el.textContent = label + (suffix || '');
            }
            sel.addEventListener('change', function () {
                var v = sel.value;
                setLabel();
                if (v !== inst.data[field]) fieldChanged(inst, field, v);
            });
            sel.addEventListener('blur', function () {
                if (!sel.parentNode) return;
                setLabel();
            });
        };
    }

    function setupEditable(inst, d) {
        // Monto: solo lectura.
        var montoEl = q(inst, 'monto');
        montoEl.classList.remove('editable');
        montoEl.onclick = null;
        montoEl.style.cursor = 'default';

        wireSelectField(inst, 'producto', 'producto', WO_PRODUCTOS);
        wireSelectField(inst, 'area', 'area', WO_AREAS);
        wireSelectField(inst, 'fechaCierre', 'mes_cierre', WO_MESES, ' ' + new Date().getFullYear());

        q(inst, 'probValue').classList.add('editable');

        // Cliente (autocomplete)
        var clienteNameEl = q(inst, 'clienteName');
        var clienteAvatarEl = q(inst, 'clienteAvatar');
        var contactoEl = q(inst, 'contactoName');
        clienteNameEl.classList.add('editable');
        clienteNameEl.onclick = function () {
            if (clienteNameEl.querySelector('.wo-inline-ac')) return;
            makeAutocomplete(clienteNameEl, 'Buscar cliente...', '/app/api/buscar-clientes/', function (item) {
                clienteNameEl.textContent = item.nombre;
                clienteAvatarEl.textContent = getInitials(item.nombre);
                if (item.contacto_principal) contactoEl.textContent = item.contacto_principal;
                if (item.id !== (inst.data.cliente ? inst.data.cliente.id : null)) {
                    fieldChanged(inst, 'cliente', item.id);
                }
            });
        };

        // Contacto (autocomplete, depende del cliente)
        contactoEl.classList.add('editable');
        contactoEl.onclick = function () {
            if (contactoEl.querySelector('.wo-inline-ac')) return;
            var cId = inst.edited.cliente || (inst.data.cliente ? inst.data.cliente.id : '');
            if (!cId) return;
            makeAutocomplete(contactoEl, 'Buscar contacto...', '/app/api/buscar-contactos/?cliente_id=' + cId, function (item) {
                var name = item.nombre_completo || (item.nombre + ' ' + (item.apellido || '')).trim();
                contactoEl.textContent = name;
                if (item.id !== inst.data.contacto_id) {
                    fieldChanged(inst, 'contacto', item.id);
                }
            });
        };

        // Vendedor (autocomplete)
        var vendedorNameEl = q(inst, 'vendedorName');
        var vendedorAvatarEl = q(inst, 'vendedorAvatar');
        vendedorNameEl.classList.add('editable');
        vendedorNameEl.onclick = function () {
            if (vendedorNameEl.querySelector('.wo-inline-ac')) return;
            makeAutocomplete(vendedorNameEl, 'Buscar usuario...', '/app/api/buscar-usuarios/', function (item) {
                var name = item.nombre || item.nombre_completo || item.username;
                vendedorNameEl.textContent = name;
                vendedorAvatarEl.textContent = getInitials(name);
                if (item.id !== inst.data.usuario_id) {
                    fieldChanged(inst, 'usuario', item.id);
                }
            });
        };
    }

    function aplicarRestriccionesIngeniero(inst) {
        inst.root.querySelectorAll('.wo-editable, .editable').forEach(function (el) {
            el.style.cursor = 'default';
            el.onclick = null;
        });
    }

    /* ── Probabilidad (drag) ──────────────────────────────────────── */

    var probDrag = null;  // instancia en drag, o null

    function probFromEvent(inst, e) {
        var rect = q(inst, 'probBar').getBoundingClientRect();
        var x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        var pct = Math.round((x / rect.width) * 100 / 5) * 5;
        return Math.max(0, Math.min(100, pct));
    }

    function updateProbVisual(inst, val) {
        var color = val >= 70 ? '#16A34A' : val >= 40 ? '#F59E0B' : '#EF4444';
        var probValEl = q(inst, 'probValue');
        var probFillEl = q(inst, 'probFill');
        probValEl.textContent = val + '%';
        probValEl.style.color = color;
        probFillEl.style.width = val + '%';
        probFillEl.style.background = color;
    }

    document.addEventListener('mousemove', function (e) {
        if (!probDrag) return;
        updateProbVisual(probDrag, probFromEvent(probDrag, e));
    });
    document.addEventListener('mouseup', function (e) {
        if (!probDrag) return;
        var inst = probDrag;
        probDrag = null;
        var val = probFromEvent(inst, e);
        updateProbVisual(inst, val);
        if (inst.data && val !== (inst.data.probabilidad_cierre || 0)) {
            fieldChanged(inst, 'probabilidad', val);
        }
    });

    /* ── Guardar / etapa ──────────────────────────────────────────── */

    function emitOppChange(oppId) {
        if (window.crmDataBus) window.crmDataBus.emit('oportunidad', 'update', oppId);
        else if (typeof window.refreshCrmTable === 'function') window.refreshCrmTable();
    }

    function saveEdits(inst) {
        if (Object.keys(inst.edited).length === 0) { hideSaveBar(inst); return; }
        var fd = new FormData();
        for (var key in inst.edited) fd.append(key, inst.edited[key]);
        var btn = q(inst, 'saveConfirm');
        btn.textContent = 'Guardando...';
        btn.disabled = true;
        fetch('/app/api/editar-oportunidad/' + inst.oppId + '/', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrf() },
            body: fd,
        })
            .then(function (r) { return r.json(); })
            .then(function (resp) {
                btn.textContent = 'Guardar';
                btn.disabled = false;
                if (resp.success) {
                    notify('Cambios guardados', 'success');
                    inst.edited = {};
                    hideSaveBar(inst);
                    emitOppChange(inst.oppId);
                    load(inst, inst.oppId);
                } else {
                    notify(resp.error || 'Error al guardar', 'error');
                }
            })
            .catch(function () {
                btn.textContent = 'Guardar';
                btn.disabled = false;
                notify('Error de conexión', 'error');
            });
    }

    function changeStage(inst, etapa) {
        var fd = new FormData();
        fd.append('etapa_corta', etapa);
        fetch('/app/api/editar-oportunidad/' + inst.oppId + '/', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrf() },
            body: fd,
        }).then(function (r) { return r.json(); }).then(function (resp) {
            if (resp.success) {
                notify('Etapa actualizada', 'success');
                emitOppChange(inst.oppId);
                load(inst, inst.oppId);
            } else {
                notify(resp.error || 'Error', 'error');
            }
        });
    }

    /* ── Cierre con validación de actividad ───────────────────────── */

    function close(inst, forceClose) {
        var d = inst.data;
        var esResponsable = d && d.usuario_id && window._CRM_CONFIG &&
            String(d.usuario_id) === String(window._CRM_CONFIG.userId);
        var etapaSinActividad = ['Ganado', 'Perdido', 'Pagado'];
        var etapaActual = d && d.etapa_corta ? d.etapa_corta : '';
        var esEtapaCerrada = etapaSinActividad.indexOf(etapaActual) !== -1;

        if (!forceClose && inst.oppId && esResponsable && !esEtapaCerrada) {
            fetch('/app/api/oportunidad/' + inst.oppId + '/tareas/')
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    if (res.success && res.tareas) {
                        var pendientes = res.tareas.filter(function (t) { return t.estado !== 'completada'; });
                        if (pendientes.length === 0) {
                            showMissingActivityWarning(inst);
                            return;
                        }
                    }
                    doClose(inst);
                })
                .catch(function () { doClose(inst); });
        } else {
            doClose(inst);
        }
    }

    function doClose(inst) {
        inst.root.classList.add('closing');
        var root = inst.root;
        setTimeout(function () {
            if (window.crmWidgetStack) window.crmWidgetStack.remove(root);
            root.remove();
        }, 200);
        inst.alive = false;
        instances = instances.filter(function (i) { return i !== inst; });

        // Persistencia/URL: si esta instancia era la registrada, pasársela a
        // la siguiente visible o limpiar.
        try {
            var stored = parseInt(sessionStorage.getItem('_crm_open_opp_id'), 10);
            if (stored === inst.oppId) {
                var next = liveInstances().filter(function (i) { return isVisible(i) || isMinimized(i); }).pop();
                if (next && next.oppId) {
                    sessionStorage.setItem('_crm_open_opp_id', next.oppId);
                    if (window.crmWidgetUrl) window.crmWidgetUrl.set('opp', next.oppId);
                    setFocus(next);
                } else {
                    sessionStorage.removeItem('_crm_open_opp_id');
                    if (window.crmWidgetUrl) window.crmWidgetUrl.clear('opp');
                }
            }
        } catch (e) { }

        if (focused === inst) focused = liveInstances()[liveInstances().length - 1] || null;
        updateBodyScroll();
        if (typeof window.refreshCrmTable === 'function') window.refreshCrmTable();
    }

    function showMissingActivityWarning(inst) {
        var existing = document.getElementById('warnMissingActivity');
        if (existing) existing.remove();

        var warn = document.createElement('div');
        warn.id = 'warnMissingActivity';
        warn.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s;';
        warn.innerHTML = '<div style="background:#fff;border-radius:16px;padding:2rem;max-width:380px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.25);">' +
            '<div style="width:56px;height:56px;border-radius:50%;background:rgba(255,149,0,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">' +
            '<svg width="28" height="28" fill="none" stroke="#FF9500" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' +
            '</div>' +
            '<h3 style="margin:0 0 0.5rem;font-size:1.15rem;font-weight:700;color:#1D1D1F;">Falta agendar actividad</h3>' +
            '<p style="margin:0 0 1.5rem;font-size:0.9rem;color:#86868B;line-height:1.5;">Cada oportunidad debe tener al menos una actividad programada para garantizar el seguimiento.</p>' +
            '<div style="display:flex;gap:0.75rem;justify-content:center;">' +
            '<button data-warn-agendar style="background:#0052D4;color:#fff;border:none;padding:0.7rem 1.5rem;border-radius:10px;font-weight:700;font-size:0.9rem;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">' +
            '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>' +
            'Agendar Actividad' +
            '</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(warn);

        warn.querySelector('[data-warn-agendar]').addEventListener('click', function () {
            warn.remove();
            setFocus(inst);
            if (typeof window.woAbrirWidgetCrearActividad === 'function') {
                window.woAbrirWidgetCrearActividad();
            }
        });
    }

    /* ── Sección: Tareas inline (port de woCargarTareasInline) ────── */

    function renderTareas(inst) {
        var container = q(inst, 'tareasList');
        container.innerHTML = '<div style="text-align:center;padding:1rem;color:#9CA3AF;font-size:0.8rem;">Cargando...</div>';
        var oppId = inst.oppId;

        fetch('/app/api/tareas/?oportunidad_id=' + oppId)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!alive(inst) || inst.oppId !== oppId) return;
                var tareas = data.tareas || data.results || [];
                if (!tareas.length) {
                    container.innerHTML = '<div class="wo-empty" style="padding:1rem;font-size:0.8rem;">' +
                        '<svg width="20" height="20" fill="none" stroke="#C7C7CC" stroke-width="1.5" viewBox="0 0 24 24" style="display:block;margin:0 auto 0.4rem;">' +
                        '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>' +
                        '</svg>Sin tareas aún</div>';
                    return;
                }
                var now = new Date();
                tareas.sort(function (a, b) {
                    var aDone = a.estado === 'completada', bDone = b.estado === 'completada';
                    var aV = !aDone && a.fecha_limite && new Date(a.fecha_limite) < now;
                    var bV = !bDone && b.fecha_limite && new Date(b.fecha_limite) < now;
                    if (aV && !bV) return -1; if (!aV && bV) return 1;
                    if (aDone && !bDone) return 1; if (!aDone && bDone) return -1;
                    var aT = a.fecha_limite ? new Date(a.fecha_limite).getTime() : Infinity;
                    var bT = b.fecha_limite ? new Date(b.fecha_limite).getTime() : Infinity;
                    return aT - bT;
                });
                container.innerHTML = '';
                tareas.slice(0, 5).forEach(function (t) {
                    var done = t.estado === 'completada';
                    var venc = !done && t.fecha_limite && new Date(t.fecha_limite) < now;
                    var dot = done ? '#34C759' : (venc ? '#FF3B30' : '#FF9500');
                    var titleColor = done ? '#9CA3AF' : (venc ? '#FF3B30' : '#1D1D1F');
                    var row = document.createElement('div');
                    row.className = 'wo-tarea-inline-item';
                    if (done) row.style.background = 'rgba(52,199,89,0.06)';
                    else if (venc) row.style.background = 'rgba(255,59,48,0.07)';
                    row.innerHTML =
                        '<span style="width:6px;height:6px;border-radius:50%;background:' + dot + ';flex-shrink:0;"></span>' +
                        '<span style="flex:1;font-size:0.78rem;color:' + titleColor + ';' + (done ? 'text-decoration:line-through;' : '') + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(t.titulo || 'Sin título') + '</span>' +
                        '<span style="font-size:0.7rem;color:' + (venc ? '#FF3B30' : '#9CA3AF') + ';flex-shrink:0;">' +
                        (t.fecha_limite ? new Date(t.fecha_limite).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '') +
                        '</span>';
                    row.addEventListener('click', function () {
                        setFocus(inst);
                        if (typeof window.crmTaskVerDetalle === 'function') window.crmTaskVerDetalle(t.id);
                    });
                    container.appendChild(row);
                });
                if (tareas.length > 5) {
                    var more = document.createElement('div');
                    more.style.cssText = 'text-align:center;padding:0.4rem;';
                    var btn = document.createElement('button');
                    btn.type = 'button';
                    btn.style.cssText = 'background:none;border:none;color:#0052D4;font-size:0.75rem;font-weight:600;cursor:pointer;';
                    btn.textContent = 'Ver todas (' + tareas.length + ')';
                    btn.addEventListener('click', function () {
                        setFocus(inst);
                        if (typeof window.woAbrirTodasTareas === 'function') {
                            window.woAbrirTodasTareas(oppId);
                            openSubWindowed(inst, 'widgetTodasTareas');
                        }
                    });
                    more.appendChild(btn);
                    container.appendChild(more);
                }
            })
            .catch(function () {
                if (!alive(inst)) return;
                container.innerHTML = '<div class="wo-empty" style="padding:1rem;font-size:0.8rem;">Error al cargar</div>';
            });
    }

    /* ── Sección: Actividad programada (port woCargarActividadReciente) ── */

    function renderActividad(inst) {
        var body = q(inst, 'actividadBody');
        var btnNueva = q(inst, 'btnNuevaActividad');
        var oppId = inst.oppId;
        inst.actividadId = null;
        btnNueva.style.display = 'none';
        body.innerHTML = '<div style="font-size:0.82rem;color:#9CA3AF;">Cargando...</div>';

        fetch('/app/api/oportunidad/' + oppId + '/tareas/')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!alive(inst) || inst.oppId !== oppId) return;
                var tareas = data.tareas || data.results || [];
                var pendientes = tareas.filter(function (t) { return t.estado !== 'completada'; });
                if (!pendientes.length) {
                    body.innerHTML = '<div style="font-size:0.82rem;color:#9CA3AF;font-style:italic;">Sin actividad programada</div>';
                    return;
                }
                pendientes.sort(function (a, b) {
                    var aT = a.fecha_limite ? new Date(a.fecha_limite).getTime() : Infinity;
                    var bT = b.fecha_limite ? new Date(b.fecha_limite).getTime() : Infinity;
                    return aT - bT;
                });
                var t = pendientes[0];
                inst.actividadId = t.id;
                var now = new Date();
                var venc = t.fecha_limite && new Date(t.fecha_limite) < now;
                var color = venc ? '#FF3B30' : '#1D1D1F';
                var fechaStr = t.fecha_limite
                    ? new Date(t.fecha_limite).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
                    : 'Sin fecha';
                body.innerHTML =
                    '<span style="width:8px;height:8px;border-radius:50%;background:' + (venc ? '#FF3B30' : '#FF9500') + ';flex-shrink:0;display:inline-block;"></span>' +
                    '<div style="flex:1;min-width:0;">' +
                    '<div style="font-size:0.82rem;font-weight:600;color:' + color + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(t.titulo || 'Sin título') + '</div>' +
                    '<div style="font-size:0.72rem;color:' + (venc ? '#FF3B30' : '#86868B') + ';">' + fechaStr + (venc ? ' · Vencida' : '') + '</div>' +
                    '</div>';
                btnNueva.style.display = 'inline-flex';
            })
            .catch(function () {
                if (!alive(inst)) return;
                body.innerHTML = '<div style="font-size:0.82rem;color:#9CA3AF;">-</div>';
            });
    }

    /* ── Sección: Proyecto vinculado (port woRenderProyectoSection) ── */

    function renderProyecto(inst, d) {
        var card = q(inst, 'proyectoCard');
        var tipo = d && d.tipo_negociacion;
        var esProyecto = (tipo === 'proyecto' || tipo === 'bitrix_proyecto');
        if (!esProyecto) {
            card.style.display = 'none';
            return;
        }
        card.style.display = '';
        cargarProyectos(inst);
    }

    function cargarProyectos(inst) {
        var listEl = q(inst, 'proyectoList');
        var oppId = inst.oppId;
        listEl.innerHTML = '<div class="wo-empty" style="font-size:0.78rem;">Cargando…</div>';
        fetch('/app/api/oportunidad/' + oppId + '/proyectos-ligados/', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!alive(inst) || inst.oppId !== oppId) return;
                if (!data || !data.success) {
                    listEl.innerHTML = '<div class="wo-empty">No se pudo cargar.</div>';
                    return;
                }
                var proys = data.proyectos || [];
                if (!proys.length) {
                    listEl.innerHTML = '<div class="wo-empty">Sin proyecto vinculado aún</div>';
                    return;
                }
                listEl.innerHTML = '';
                proys.forEach(function (p) {
                    var row = document.createElement('div');
                    row.className = 'wop-proy-card';
                    row.title = 'Abrir proyecto';
                    row.innerHTML =
                        '<div style="width:30px;height:30px;border-radius:7px;background:#0052D4;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
                        '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' +
                        '</div>' +
                        '<div style="flex:1; min-width:0;">' +
                        '<div style="font-size:0.86rem;font-weight:600;color:#1D1D1F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(p.nombre) + '</div>' +
                        '<div style="font-size:0.7rem;color:#86868B;">' + esc(p.tipo_label) + '</div>' +
                        '</div>' +
                        '<button type="button" class="wop-icon-btn" data-proy-unlink title="Desvincular">' +
                        '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
                        '</button>' +
                        '<svg width="14" height="14" fill="none" stroke="#C7C7CC" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>';
                    row.addEventListener('click', function () {
                        if (typeof window.proyectosVerDetalle === 'function') {
                            // El widget de proyecto necesita el foco: si esta
                            // instancia está en modo modal, se cierra; en modo
                            // ventana ambos pueden convivir.
                            if (!isWindowed(inst)) doClose(inst);
                            window.proyectosVerDetalle(p.id);
                        } else {
                            window.location.href = '/app/home/?tab=proyectos&proyecto_id=' + p.id;
                        }
                    });
                    row.querySelector('[data-proy-unlink]').addEventListener('click', function (ev) {
                        ev.stopPropagation();
                        if (!window.confirm('¿Desvincular este proyecto de la oportunidad?')) return;
                        fetch('/app/api/oportunidad/' + oppId + '/proyectos-ligados/', {
                            method: 'DELETE',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                            body: JSON.stringify({ proyecto_id: p.id }),
                        }).then(function (r) { return r.json(); }).then(function (resp) {
                            if (resp && resp.success) cargarProyectos(inst);
                            else notify('No se pudo desvincular.', 'error');
                        });
                    });
                    listEl.appendChild(row);
                });
            })
            .catch(function () {
                if (!alive(inst)) return;
                listEl.innerHTML = '<div class="wo-empty">Error de red.</div>';
            });
    }

    // Modal de vincular: reusa el DOM singleton #wopVincularModal pero con
    // wiring propio (el legacy escucha #woBtnVincularProyecto, que el v2 no
    // tiene, así que no hay doble manejo).
    var vincULTimer = null;
    function abrirVincularProyecto(inst) {
        var modal = document.getElementById('wopVincularModal');
        if (!modal) { notify('Modal de vincular no disponible', 'error'); return; }
        modal.classList.add('open');
        var input = document.getElementById('wopSearchProyectos');
        var resWrap = document.getElementById('wopSearchResultados');

        function renderResultados(proys) {
            if (!resWrap) return;
            if (!proys.length) {
                resWrap.innerHTML = '<div style="color:#86868B;font-size:0.84rem;padding:8px;">Sin resultados</div>';
                return;
            }
            resWrap.innerHTML = '';
            proys.forEach(function (p) {
                var item = document.createElement('div');
                item.className = 'wop-search-result';
                item.innerHTML =
                    '<div class="wop-search-result-name">' + esc(p.nombre) + '</div>' +
                    '<div class="wop-search-result-meta">' + esc(p.tipo_label) + '</div>';
                item.addEventListener('click', function () {
                    fetch('/app/api/oportunidad/' + inst.oppId + '/proyectos-ligados/', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                        body: JSON.stringify({ proyecto_id: p.id }),
                    }).then(function (r) { return r.json(); }).then(function (resp) {
                        if (resp && resp.success) {
                            modal.classList.remove('open');
                            cargarProyectos(inst);
                        } else {
                            notify('No se pudo vincular.', 'error');
                        }
                    });
                });
                resWrap.appendChild(item);
            });
        }

        function buscar(qStr) {
            if (resWrap) resWrap.innerHTML = '<div style="color:#86868B;font-size:0.84rem;padding:8px;">Buscando…</div>';
            fetch('/app/api/proyectos-ligados/buscar/?q=' + encodeURIComponent(qStr || ''), { credentials: 'same-origin' })
                .then(function (r) { return r.json(); })
                .then(function (data) { renderResultados((data && data.proyectos) || []); })
                .catch(function () {
                    if (resWrap) resWrap.innerHTML = '<div style="color:#FF3B30;font-size:0.84rem;padding:8px;">Error de red</div>';
                });
        }

        if (input) {
            input.value = '';
            input.focus();
            input.oninput = function () {
                clearTimeout(vincULTimer);
                vincULTimer = setTimeout(function () { buscar(input.value); }, 200);
            };
        }
        buscar('');
    }

    /* ── Cotizador instanciado ────────────────────────────────────────
       El cotizador legacy (#widgetCotizador) es un singleton: abrirlo
       para otra opp reemplaza el anterior. Aquí cada cotización abierta
       es su propia ventana-iframe (key 'opp:<id>' al crear, 'cot:<id>'
       al editar), integrada con widget_window. El iframe postea
       {type:'cotizacion-created'} al guardar (protocolo legacy). */

    var cotWindows = {};  // key -> overlay

    function openCotWindow(key, src, titulo, inst, opts) {
        var existing = cotWindows[key];
        if (existing && document.body.contains(existing)) {
            existing.classList.remove('ww-minimized');
            existing.style.display = 'flex';
            if (window.crmWidgetStack) {
                window.crmWidgetStack.remove(existing);
                window.crmWidgetStack.push(existing);
            }
            return existing;
        }

        var ov = document.createElement('div');
        ov.className = 'widget-overlay oppv2-cot';
        ov.setAttribute('data-widget-title', titulo);
        ov.innerHTML =
            '<div class="widget-card widget-card-cotizador">' +
            '<div class="wo-header" style="padding:1rem 1.5rem 0.75rem;border-bottom:1px solid #F2F2F7;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
            '<div data-cot-title style="font-size:1.05rem;font-weight:700;color:#1D1D1F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;"></div>' +
            '<button type="button" class="widget-close">&times;</button>' +
            '</div>' +
            '<iframe class="cotizador-iframe"></iframe>' +
            '</div>';
        ov.querySelector('[data-cot-title]').textContent = titulo;
        ov.querySelector('iframe').src = src;
        ov.querySelector('.widget-close').addEventListener('click', function (ev) {
            ev.stopPropagation();
            closeCotWindow(key);
        });
        ov._oppV2CotKey = key;
        ov._oppV2Inst = inst || null;

        document.body.appendChild(ov);
        ov.style.display = 'flex';  // widget_stack lo registra solo
        cotWindows[key] = ov;
        if (window.crmWidgetWindow) {
            try { window.crmWidgetWindow.enhance(ov); } catch (e) { }
        }
        // Si la opp está en modo ventana, el cotizador también nace como
        // ventana (encimada con offset) para no tapar a las demás.
        // opts.forceWindow: nace como ventana sin opp ligada (p.ej. las
        // ventanas de prospecto que abre prospecto_windows.js).
        if (((inst && isWindowed(inst)) || (opts && opts.forceWindow)) && window.crmWidgetWindow) {
            var vw = window.innerWidth, vh = window.innerHeight;
            var w = Math.min(Math.round(vw * ((opts && opts.wf) || 0.72)), (opts && opts.maxw) || 1400);
            var h = Math.round(vh * ((opts && opts.hf) || 0.86));
            var n = Object.keys(cotWindows).length;
            window.crmWidgetWindow.windowize(ov, {
                x: Math.max(8, Math.min(60 + n * 30, vw - w - 12)),
                y: Math.max(6, Math.min(20 + n * 26, vh - h - 8)),
                w: w, h: h,
            });
        }
        return ov;
    }

    function closeCotWindow(key) {
        var ov = cotWindows[key];
        if (!ov) return;
        delete cotWindows[key];
        var inst = ov._oppV2Inst;
        ov.classList.add('closing');
        setTimeout(function () {
            if (window.crmWidgetStack) window.crmWidgetStack.remove(ov);
            ov.remove();
        }, 200);
        // Refrescar la opp ligada (lista de cotizaciones) + kanban — SOLO
        // al cerrar un cotizador (pudo crear/editar una cotización). Las
        // ventanas de drive no cambian la card de la opp: recargarla hacía
        // un flash de "Cargando oportunidad" gratuito al cerrar el drive.
        var esCotizador = String(key).indexOf('drive:') !== 0;
        if (esCotizador) {
            if (inst && alive(inst) && isVisible(inst)) load(inst, inst.oppId);
            if (window.crmDataBus && inst) window.crmDataBus.emit('oportunidad', 'update', inst ? inst.oppId : null);
        }
    }

    function openCotizadorV2(oppId, inst) {
        var id = parseInt(String(oppId).replace(/[^\d]/g, ''), 10);
        if (!id) return;
        if (!inst) {
            inst = liveInstances().find(function (i) { return i.oppId === id; }) || null;
        }
        var titulo = 'Cotizar — ' + ((inst && inst.data && inst.data.oportunidad) || ('Oportunidad #' + id));
        openCotWindow('opp:' + id, '/app/crear-cotizacion/oportunidad/' + id + '/?widget_mode=1', titulo, inst);
    }

    function openEditCotizacionV2(cotId, inst) {
        var id = parseInt(String(cotId).replace(/[^\d]/g, ''), 10);
        if (!id) return;
        openCotWindow('cot:' + id, '/app/cotizacion/' + id + '/editar/?widget_mode=1', 'Editar cotización #' + id, inst || null);
    }

    // Infraestructura de ventanas-iframe expuesta para otros módulos
    // (prospecto_windows.js la usa para el multi-prospecto).
    window.crmIframeWindow = { open: openCotWindow, close: closeCotWindow };

    // Drive como ventana-iframe (key 'drive:<oppId>'): reabre/trae al
    // frente si ya existe — un drive POR oportunidad, simultáneos.
    function openDriveWindow(inst) {
        var titulo = 'Drive — ' + ((inst.data && inst.data.oportunidad) || ('Oportunidad #' + inst.oppId));
        openCotWindow('drive:' + inst.oppId, '/app/widget/drive/' + inst.oppId + '/', titulo, inst,
            { wf: 0.5, maxw: 980, hf: 0.8 });
    }

    // El iframe del cotizador postea 'cotizacion-created' al guardar:
    // identificar QUÉ ventana lo envió (e.source) y refrescar su opp.
    // Las páginas-iframe (idea/prospecto) postean su título real al cargar
    // — el marco nace con título genérico porque al click no lo conocemos.
    window.addEventListener('message', function (e) {
        if (!e.data || e.data.type !== 'widget-title' || !e.data.title) return;
        for (var key in cotWindows) {
            var ov = cotWindows[key];
            if (!ov || !document.body.contains(ov)) continue;
            var ifr = ov.querySelector('iframe');
            if (ifr && ifr.contentWindow === e.source) {
                var t = ov.querySelector('[data-cot-title]');
                if (t) t.textContent = String(e.data.title).slice(0, 120);
                return;
            }
        }
    });

    window.addEventListener('message', function (e) {
        if (!e.data || e.data.type !== 'cotizacion-created') return;
        for (var key in cotWindows) {
            var ov = cotWindows[key];
            if (!ov || !document.body.contains(ov)) continue;
            var ifr = ov.querySelector('iframe');
            if (ifr && ifr.contentWindow === e.source) {
                var inst = ov._oppV2Inst;
                if (inst && alive(inst) && isVisible(inst)) load(inst, inst.oppId);
                if (window.crmDataBus) {
                    window.crmDataBus.emit('cotizacion', 'create', null);
                    if (inst) window.crmDataBus.emit('oportunidad', 'update', inst.oppId);
                }
                return;
            }
        }
    });

    /* ── Data bus: refrescar instancias cuando cambian datos ──────── */

    var busTimers = {};
    function busDebounce(key, fn) {
        clearTimeout(busTimers[key]);
        busTimers[key] = setTimeout(fn, 600);
    }

    function wireBus() {
        if (!window.crmDataBus) return;
        // Cotizaciones: re-cargar el detalle de las instancias visibles
        // (el evento trae el id de la cotización, no de la opp).
        window.crmDataBus.on('cotizacion', function () {
            busDebounce('cot', function () {
                liveInstances().forEach(function (i) {
                    if (isVisible(i) && Object.keys(i.edited).length === 0) load(i, i.oppId);
                });
            });
        });
        // Tareas: refrescar las secciones de tareas/actividad.
        function refreshTareas() {
            busDebounce('tareas', function () {
                liveInstances().forEach(function (i) {
                    if (isVisible(i)) { renderTareas(i); renderActividad(i); }
                });
            });
        }
        window.crmDataBus.on('tarea', refreshTareas);
        window.crmDataBus.on('tarea-opp', refreshTareas);
        window.crmDataBus.on('actividad', refreshTareas);
        // Sync entre usuarios: si OTRO usuario edita una oportunidad que
        // tengo abierta, recargar esa instancia (sin pisar edición en curso;
        // el guard de 2s evita el doble reload cuando el cambio fue mío —
        // mis propios saves ya recargan vía load()).
        window.crmDataBus.on('oportunidad', function (detail) {
            if (!detail || !detail.id) return;
            busDebounce('opp-' + detail.id, function () {
                liveInstances().forEach(function (i) {
                    if (i.oppId !== detail.id) return;
                    if (!isVisible(i) && !isMinimized(i)) return;
                    if (Object.keys(i.edited).length > 0) return;       // edición en curso
                    if (i._lastLoad && Date.now() - i._lastLoad < 2000) return;  // recién cargada
                    load(i, i.oppId);
                });
            });
        });
    }

    /* ── API pública + takeover ───────────────────────────────────── */

    function takeoverActive() {
        try {
            if (window.localStorage && localStorage.getItem('opp_v2_off') === '1') return false;
        } catch (e) { }
        return !!document.getElementById('tplOppWidgetV2');
    }

    window.OppWidgetV2 = {
        get takeover() { return takeoverActive(); },
        open: open,
        openCotizador: openCotizadorV2,
        openEditCotizacion: openEditCotizacionV2,
        instances: function () { return liveInstances().slice(); },
        focused: function () { return focused; },
        close: function (oppId) {
            var inst = liveInstances().find(function (i) { return i.oppId === oppId; });
            if (inst) close(inst, true);
        },
    };

    // Globals: este script carga DESPUÉS de crm_main.js, así que gana la
    // asignación. Si el takeover está apagado, delega al legacy.
    var legacyOpenDetalle = window.openDetalle;
    window.openDetalle = function (oppId) {
        if (takeoverActive()) return open(oppId);
        if (typeof legacyOpenDetalle === 'function') return legacyOpenDetalle(oppId);
    };
    var legacyOpenCotizador = window.openCotizador;
    window.openCotizador = function (oppId) {
        if (takeoverActive()) return openCotizadorV2(oppId);
        if (typeof legacyOpenCotizador === 'function') return legacyOpenCotizador(oppId);
    };
    var legacyOpenEditCot = window.openEditCotizacion;
    window.openEditCotizacion = function (cotId) {
        if (takeoverActive()) return openEditCotizacionV2(cotId);
        if (typeof legacyOpenEditCot === 'function') return legacyOpenEditCot(cotId);
    };

    if (!window._oppV2Wired) {
        window._oppV2Wired = true;
        window.crmReady(wireBus);
    }
})();
