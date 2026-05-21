/* ----------------------------------------------------------------------
 * crm_asistente_calendario.js — Asistente del Calendario (action-driven).
 *
 * Vive sobre el modal compartido #widgetAsistente. Cuando se abre en
 * modo 'calendario' (calAsistenteAbrir), crm_asistente.js oculta el
 * chat normal y delega el render del contenido a este módulo.
 *
 * Visualmente consistente con los modos prospecto/oportunidad/idea:
 * usa clases .asist-cal-* declaradas en _widget_asistente.html y reusa
 * .asist-orb--lg, .asist-sugg-card patterns. NO inyecta estilos
 * namespaceados.
 *
 * Flujo:
 *   Vista 1 — selector de acción (reagendar vencidas | rellenar 5 días)
 *   Vista 2 — loading (orb pulsante + texto shimmer)
 *   Vista 3 — plan propuesto (lista compacta + Cancelar / Aplicar plan)
 *   Vista 4 — resultado (orb + check overlay + N cambios + Cerrar)
 *   Error  — botón "Reintentar" repite la última acción.
 *
 * Endpoints:
 *   POST /app/api/calendario/asistente/preview/   {accion}
 *     → {ok, accion, resumen, plan: [...]}
 *   POST /app/api/calendario/asistente/aplicar/   {accion, plan}
 *     → {ok, aplicados, fallidos, errores}
 *
 * Después de aplicar refrescamos el calendario con calGlobalRefetch.
 * --------------------------------------------------------------------*/
(function () {
    'use strict';
    if (window._calAsistenteLoaded) return;
    window._calAsistenteLoaded = true;

    /* ─── Helpers ─── */
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function csrf() {
        var el = document.querySelector('[name=csrfmiddlewaretoken]');
        if (el && el.value) return el.value;
        var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }
    function api(url, opts) {
        opts = opts || {};
        opts.credentials = 'same-origin';
        opts.headers = Object.assign(
            {'Content-Type': 'application/json', 'X-CSRFToken': csrf()},
            opts.headers || {}
        );
        return fetch(url, opts).then(function (r) {
            return r.json().then(function (d) { return {ok: r.ok, data: d}; })
                .catch(function () { return {ok: r.ok, data: {error: 'Respuesta inválida'}}; });
        });
    }

    /* ─── State ─── */
    var STATE = {
        accion: null,       // 'reagendar_vencidas' | 'rellenar_calendario' | null
        plan: [],           // array de items del plan
        resumen: '',        // texto resumen que el AI explica
        view: 'home',       // 'home' | 'loading' | 'plan' | 'done' | 'error'
        applying: false,
        result: null,       // {aplicados, fallidos, errores}
        errorMsg: '',
        loadingTxt: '',
        // lastAction: 'preview' | 'apply' — para Reintentar desde error
        lastAction: null,
    };

    /* ─── Greeting (usa el del modal compartido) ─── */
    function getFirstName() {
        var el = document.getElementById('asistGreetName');
        var raw = el ? (el.textContent || '').trim() : '';
        return raw || '';
    }

    /* ─── Asegurar contenedor root dentro del modal ─── */
    function ensureRoot() {
        var box = document.getElementById('asistMessages');
        if (!box) return null;
        var root = document.getElementById('asistenteCalendarioRoot');
        if (!root) {
            root = document.createElement('div');
            root.id = 'asistenteCalendarioRoot';
            root.className = 'asist-cal-root';
            box.innerHTML = '';
            box.appendChild(root);
        } else {
            // Garantizar clase por si quedó del estilo anterior.
            root.className = 'asist-cal-root';
        }
        return root;
    }

    /* ─── Orb grande reutilizable (mismo HTML que el welcome del chat) ─── */
    function orbLgHTML(thinking) {
        var thinkingCls = thinking ? ' is-thinking' : '';
        return '<div class="asist-orb asist-orb--lg' + thinkingCls + '" aria-hidden="true">'
            +   '<span class="asist-orb-core"></span>'
            +   '<span class="asist-orb-ring asist-orb-ring--horiz"></span>'
            +   '<span class="asist-orb-ring asist-orb-ring--vert"></span>'
            + '</div>';
    }

    /* ─── Formato de fecha ──────────────────────────────────────────── */
    var MESES_ABREV = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    var DIAS_ABREV = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    function parseISO(s) {
        if (!s) return null;
        try {
            var d = new Date(s);
            if (isNaN(d.getTime())) return null;
            return d;
        } catch (e) { return null; }
    }
    function fmtFechaCorta(s) {
        var d = parseISO(s);
        if (!d) return esc(s || '');
        var hh = d.getHours();
        var mm = d.getMinutes();
        var ampm = hh >= 12 ? 'pm' : 'am';
        var hh12 = hh % 12; if (hh12 === 0) hh12 = 12;
        var mmStr = mm < 10 ? ('0' + mm) : String(mm);
        return DIAS_ABREV[d.getDay()] + ' ' + d.getDate() + ' ' + MESES_ABREV[d.getMonth()]
            + ', ' + hh12 + ':' + mmStr + ampm;
    }

    /* ─── Iconos SVG inline ─── */
    function svgClockBack() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
            +   '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>'
            +   '<path d="M3 3v5h5"/>'
            +   '<polyline points="12 7 12 12 15 14"/>'
            + '</svg>';
    }
    function svgWand() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
            +   '<path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/>'
            +   '<path d="M17.8 11.8 19 13"/><path d="M15 9h0"/><path d="M17.8 6.2 19 5"/>'
            +   '<path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/>'
            + '</svg>';
    }
    function svgBack() {
        return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'
            +   '<polyline points="15 18 9 12 15 6"/>'
            + '</svg>';
    }
    function svgCheck() {
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'
            +   '<polyline points="20 6 9 17 4 12"/>'
            + '</svg>';
    }
    function svgBulb() {
        return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            +   '<path d="M9 18h6"/><path d="M10 22h4"/>'
            +   '<path d="M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2z"/>'
            + '</svg>';
    }
    function svgRetry() {
        return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'
            +   '<polyline points="23 4 23 10 17 10"/>'
            +   '<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'
            + '</svg>';
    }

    /* ─── Vista 1 — Home ─── */
    function viewHome(root) {
        var name = getFirstName();
        var greeting = name
            ? 'Hola, <span style="color:var(--ai-muted);font-weight:500;">' + esc(name) + '</span>'
            : 'Hola';
        root.innerHTML = ''
            + '<div class="asist-cal-welcome">'
            +   orbLgHTML(false)
            +   '<div style="font-size:1.05rem;font-weight:500;color:var(--ai-muted);margin-bottom:4px;">'
            +     greeting
            +   '</div>'
            +   '<h2 class="asist-cal-title">Asistente del Calendario</h2>'
            +   '<div class="asist-cal-sub">¿Cómo organizamos tu agenda?</div>'
            + '</div>'
            + '<div class="asist-cal-actions">'
            +   actionCardHTML({
                    id: 'reagendar_vencidas',
                    icon: svgClockBack(),
                    title: 'Reagendar mis vencidas',
                    desc: 'Reorganizo tus pendientes vencidos en los próximos 5 días hábiles, priorizando los más importantes sin encimarse con tu agenda.',
                })
            +   actionCardHTML({
                    id: 'rellenar_calendario',
                    icon: svgWand(),
                    title: 'Rellenar mi calendario',
                    desc: 'Detecto oportunidades y prospectos sin seguimiento reciente y agendo en los huecos de los próximos 5 días.',
                })
            + '</div>';

        // Wire clicks — toda la card es clickable.
        root.querySelectorAll('.asist-cal-action').forEach(function (card) {
            card.addEventListener('click', function () {
                var accion = card.getAttribute('data-accion');
                empezar(accion);
            });
        });
    }

    function actionCardHTML(opts) {
        return '<button type="button" class="asist-cal-action" data-accion="' + esc(opts.id) + '">'
            +   '<span class="asist-cal-action-icon">' + opts.icon + '</span>'
            +   '<span class="asist-cal-action-text">'
            +     '<span class="asist-cal-action-title">' + esc(opts.title) + '</span>'
            +     '<span class="asist-cal-action-desc">' + esc(opts.desc) + '</span>'
            +   '</span>'
            + '</button>';
    }

    /* ─── Vista 2 — Loading ─── */
    function viewLoading(root, txt) {
        root.innerHTML = ''
            + '<div class="asist-cal-loading">'
            +   orbLgHTML(true)
            +   '<div class="asist-cal-loading-text">' + esc(txt || 'Analizando tu calendario…') + '</div>'
            + '</div>';
    }

    /* ─── Vista 3 — Plan ─── */
    function viewPlan(root) {
        var accion = STATE.accion;
        var plan = STATE.plan || [];
        var headline = accion === 'reagendar_vencidas'
            ? 'Plan para reagendar tus vencidas'
            : 'Plan para rellenar tu calendario';

        var html = ''
            + '<div class="asist-cal-plan-header">'
            +   '<button type="button" class="asist-cal-back" id="calAiBack">'
            +     svgBack()
            +     '<span>Volver</span>'
            +   '</button>'
            +   '<h2 class="asist-cal-plan-headline">' + esc(headline) + '</h2>'
            + '</div>';

        if (STATE.resumen) {
            html += '<div class="asist-cal-resumen">' + esc(STATE.resumen) + '</div>';
        }

        if (!plan.length) {
            html += '<div class="asist-cal-empty">'
                + '<div class="asist-cal-empty-title">Nada por hacer</div>'
                + '<div class="asist-cal-empty-text">'
                + (accion === 'reagendar_vencidas'
                    ? 'No encontré actividades vencidas que necesiten reagendarse.'
                    : 'No encontré huecos relevantes para agendar nuevos seguimientos.')
                + '</div>'
                + '</div>'
                + '<div class="asist-cal-footer">'
                +   '<button type="button" class="asist-cal-btn asist-cal-btn-secondary" id="calAiCerrar1">Cerrar</button>'
                + '</div>';
        } else {
            html += '<div class="asist-cal-plan-list">';
            plan.forEach(function (item, i) {
                html += renderPlanCard(item, i + 1, accion);
            });
            html += '</div>'
                + '<div class="asist-cal-footer">'
                +   '<button type="button" class="asist-cal-btn asist-cal-btn-secondary" id="calAiCancelar">Cancelar</button>'
                +   '<button type="button" class="asist-cal-btn asist-cal-btn-primary" id="calAiAplicar">'
                +     svgCheck() + '<span>Aplicar plan</span>'
                +   '</button>'
                + '</div>';
        }
        root.innerHTML = html;

        var back = document.getElementById('calAiBack');
        if (back) back.addEventListener('click', volver);
        var cancelar = document.getElementById('calAiCancelar');
        if (cancelar) cancelar.addEventListener('click', volver);
        var aplicar = document.getElementById('calAiAplicar');
        if (aplicar) aplicar.addEventListener('click', aplicarPlan);
        var cerrar1 = document.getElementById('calAiCerrar1');
        if (cerrar1) cerrar1.addEventListener('click', cerrar);
    }

    function renderPlanCard(item, idx, accion) {
        item = item || {};
        var titulo = item.titulo || item.title || '(sin título)';
        var durMin = item.duracion_min || item.duracion || null;
        var razon = item.razon || item.motivo || '';
        var metaParts = [];

        if (accion === 'reagendar_vencidas') {
            var feAnt = item.fecha_anterior || item.fecha_antigua || item.era || null;
            var feNue = item.fecha_nueva || item.nueva || item.nueva_fecha || null;
            if (feAnt) {
                metaParts.push('<span class="asist-cal-old">' + esc(fmtFechaCorta(feAnt)) + '</span>');
            }
            if (feNue) {
                metaParts.push('<span class="asist-cal-new">' + esc(fmtFechaCorta(feNue)) + '</span>');
            }
            if (durMin) {
                metaParts.push('<span>' + esc(String(durMin)) + ' min</span>');
            }
        } else {
            var fe = item.fecha || item.fecha_propuesta || item.fecha_nueva || null;
            if (fe) {
                metaParts.push('<span class="asist-cal-new">' + esc(fmtFechaCorta(fe)) + '</span>');
            }
            if (durMin) {
                metaParts.push('<span>' + esc(String(durMin)) + ' min</span>');
            }
            var ctxLabel = null;
            if (item.oportunidad_titulo || item.opp_titulo) {
                ctxLabel = item.oportunidad_titulo || item.opp_titulo;
            } else if (item.prospecto_nombre || item.prospecto_titulo) {
                ctxLabel = item.prospecto_nombre || item.prospecto_titulo;
            } else if (item.cliente_nombre || item.cliente) {
                ctxLabel = item.cliente_nombre || item.cliente;
            }
            if (ctxLabel) {
                metaParts.push('<span class="asist-cal-ctx">' + esc(ctxLabel) + '</span>');
            }
        }

        var metaHtml = '';
        if (metaParts.length) {
            metaHtml = '<div class="asist-cal-plan-meta">'
                + metaParts.join('<span class="asist-cal-dot">·</span>')
                + '</div>';
        }

        var razonHtml = '';
        if (razon) {
            razonHtml = '<div class="asist-cal-plan-razon">'
                + svgBulb()
                + '<span>' + esc(razon) + '</span>'
                + '</div>';
        }

        return '<div class="asist-cal-plan-card">'
            + '<div class="asist-cal-plan-row1">'
            +   '<span class="asist-cal-plan-num">' + esc(String(idx)) + '.</span>'
            +   '<span class="asist-cal-plan-title">' + esc(titulo) + '</span>'
            + '</div>'
            + metaHtml
            + razonHtml
            + '</div>';
    }

    /* ─── Vista 4 — Done ─── */
    function viewDone(root) {
        var r = STATE.result || {};
        var aplicados = typeof r.aplicados === 'number' ? r.aplicados : (STATE.plan ? STATE.plan.length : 0);
        var fallidos = typeof r.fallidos === 'number' ? r.fallidos : 0;
        var errores = Array.isArray(r.errores) ? r.errores : [];
        var html = ''
            + '<div class="asist-cal-done">'
            +   '<div class="asist-cal-done-orb-wrap">'
            +     orbLgHTML(false)
            +     '<div class="asist-cal-done-check">' + svgCheck() + '</div>'
            +   '</div>'
            +   '<h2 class="asist-cal-done-title">Listo</h2>'
            +   '<div class="asist-cal-done-text">'
            +     'Apliqué <strong>' + esc(String(aplicados)) + '</strong> '
            +     (aplicados === 1 ? 'cambio' : 'cambios') + ' al calendario.'
            +   '</div>'
            +   (fallidos
                ? '<div class="asist-cal-done-warn">'
                  + esc(String(fallidos)) + ' ' + (fallidos === 1 ? 'no se pudo aplicar' : 'no se pudieron aplicar') + '.'
                  + '</div>'
                : '')
            +   (errores.length
                ? '<div class="asist-cal-error-card" style="text-align:left;margin-top:8px;max-width:480px;">'
                  + '<strong>Detalles:</strong>'
                  + '<div class="asist-cal-error-details">'
                  + errores.slice(0, 5).map(function (e) {
                      return esc(typeof e === 'string' ? e : (e && e.error ? e.error : JSON.stringify(e)));
                    }).join('<br>')
                  + '</div>'
                  + '</div>'
                : '')
            + '</div>'
            + '<div class="asist-cal-footer" style="justify-content:center;border-top:none;padding-top:6px;">'
            +   '<button type="button" class="asist-cal-btn asist-cal-btn-primary" id="calAiCerrarDone">Cerrar</button>'
            + '</div>';
        root.innerHTML = html;
        var btn = document.getElementById('calAiCerrarDone');
        if (btn) btn.addEventListener('click', cerrarYRefrescar);
    }

    /* ─── Vista Error (con Reintentar) ─── */
    function viewError(root, msg) {
        root.innerHTML = ''
            + '<div class="asist-cal-plan-header">'
            +   '<button type="button" class="asist-cal-back" id="calAiBackErr">'
            +     svgBack()
            +     '<span>Volver</span>'
            +   '</button>'
            +   '<h2 class="asist-cal-plan-headline">Algo salió mal</h2>'
            + '</div>'
            + '<div class="asist-cal-error-card">' + esc(msg || 'No se pudo procesar tu solicitud. Intenta de nuevo en un momento.') + '</div>'
            + '<div class="asist-cal-footer">'
            +   '<button type="button" class="asist-cal-btn asist-cal-btn-secondary" id="calAiBackErr2">'
            +     svgBack() + '<span>Volver</span>'
            +   '</button>'
            +   (STATE.lastAction
                ? '<button type="button" class="asist-cal-btn asist-cal-btn-primary" id="calAiReintentar">'
                  + svgRetry() + '<span>Reintentar</span>'
                  + '</button>'
                : '')
            + '</div>';
        var b1 = document.getElementById('calAiBackErr');
        var b2 = document.getElementById('calAiBackErr2');
        var br = document.getElementById('calAiReintentar');
        if (b1) b1.addEventListener('click', volver);
        if (b2) b2.addEventListener('click', volver);
        if (br) br.addEventListener('click', reintentar);
    }

    /* ─── Reintentar: repite la última acción que falló ─── */
    function reintentar() {
        if (STATE.lastAction === 'apply') {
            // Mantenemos el plan que ya teníamos y reintentamos aplicar.
            aplicarPlan();
        } else if (STATE.lastAction === 'preview' && STATE.accion) {
            empezar(STATE.accion);
        } else {
            volver();
        }
    }

    /* ─── Acciones / flujo ─── */
    function render() {
        var root = ensureRoot();
        if (!root) return;
        switch (STATE.view) {
            case 'home':    viewHome(root); break;
            case 'loading': viewLoading(root, STATE.loadingTxt || 'Analizando tu calendario…'); break;
            case 'plan':    viewPlan(root); break;
            case 'done':    viewDone(root); break;
            case 'error':   viewError(root, STATE.errorMsg); break;
            default:        viewHome(root);
        }
    }
    // Expuesto para que crm_asistente.js dispare el render al abrir.
    window._calAiRenderRoot = render;

    function empezar(accion) {
        if (!accion) return;
        STATE.accion = accion;
        STATE.plan = [];
        STATE.resumen = '';
        STATE.result = null;
        STATE.lastAction = 'preview';
        STATE.view = 'loading';
        STATE.loadingTxt = accion === 'reagendar_vencidas'
            ? 'Revisando tus actividades vencidas…'
            : 'Buscando huecos y prioridades…';
        render();

        api('/app/api/calendario/asistente/preview/', {
            method: 'POST',
            body: JSON.stringify({accion: accion}),
        }).then(function (res) {
            if (!res.ok || !res.data || !res.data.ok) {
                STATE.view = 'error';
                STATE.errorMsg = (res.data && res.data.error)
                    || 'No pude generar un plan ahora mismo. Intenta de nuevo.';
                render();
                return;
            }
            STATE.plan = Array.isArray(res.data.plan) ? res.data.plan : [];
            STATE.resumen = res.data.resumen || '';
            STATE.view = 'plan';
            render();
        }).catch(function (err) {
            STATE.view = 'error';
            STATE.errorMsg = 'Error de red: ' + err;
            render();
        });
    }

    function volver() {
        STATE.view = 'home';
        STATE.plan = [];
        STATE.resumen = '';
        STATE.errorMsg = '';
        STATE.lastAction = null;
        render();
    }

    function aplicarPlan() {
        if (STATE.applying) return;
        if (!STATE.plan || !STATE.plan.length) return;
        STATE.applying = true;
        STATE.lastAction = 'apply';
        STATE.view = 'loading';
        STATE.loadingTxt = 'Aplicando cambios al calendario…';
        render();

        api('/app/api/calendario/asistente/aplicar/', {
            method: 'POST',
            body: JSON.stringify({accion: STATE.accion, plan: STATE.plan}),
        }).then(function (res) {
            STATE.applying = false;
            if (!res.ok || !res.data || !res.data.ok) {
                STATE.view = 'error';
                STATE.errorMsg = (res.data && res.data.error) || 'No se pudieron aplicar los cambios.';
                render();
                return;
            }
            STATE.result = {
                aplicados: typeof res.data.aplicados === 'number' ? res.data.aplicados : (STATE.plan.length),
                fallidos: typeof res.data.fallidos === 'number' ? res.data.fallidos : 0,
                errores: Array.isArray(res.data.errores) ? res.data.errores : [],
            };
            STATE.view = 'done';
            render();
        }).catch(function (err) {
            STATE.applying = false;
            STATE.view = 'error';
            STATE.errorMsg = 'Error de red: ' + err;
            render();
        });
    }

    function cerrar() {
        if (typeof window.asistenteCerrar === 'function') {
            window.asistenteCerrar();
        }
    }

    function cerrarYRefrescar() {
        cerrar();
        // Refrescamos el calendario para que los cambios aparezcan en la UI.
        try {
            if (typeof window.calGlobalRefetch === 'function') {
                var sel = document.getElementById('calUserFilter');
                window.calGlobalRefetch(sel ? sel.value : 'all');
            }
        } catch (e) { /* silent */ }
    }

    /* ─── API pública ─── */
    window.calAsistenteAbrir = function () {
        // Reset al estado inicial cada vez que se abre.
        STATE.accion = null;
        STATE.plan = [];
        STATE.resumen = '';
        STATE.result = null;
        STATE.errorMsg = '';
        STATE.applying = false;
        STATE.lastAction = null;
        STATE.view = 'home';
        if (typeof window.asistenteAbrir === 'function') {
            window.asistenteAbrir({calendar: true});
        } else {
            // Fallback: si por alguna razón el chat no está cargado, intentamos
            // pintar a nuestro root dentro del modal si ya está montado.
            render();
        }
    };

    /* ─── Wire-up del botón existente en el topbar ───
       El HTML del topbar ya tiene onclick="calAsistenteAbrir()", así
       que basta con que la función global esté definida arriba. Pero
       defensivamente también escuchamos clicks en [data-cal-asist-open]
       y en #calAsistenteBtn por si algún render dinámico no usa onclick. */
    document.addEventListener('click', function (e) {
        var trigger = e.target.closest('[data-cal-asist-open], #calAsistenteBtn');
        if (!trigger) return;
        // Solo intervenir si el botón NO tiene onclick (para no duplicar).
        if (trigger.hasAttribute('onclick')) return;
        e.preventDefault();
        window.calAsistenteAbrir();
    });
})();
