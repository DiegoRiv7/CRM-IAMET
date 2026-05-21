/* ----------------------------------------------------------------------
 * crm_asistente_calendario.js — Asistente del Calendario (action-driven).
 *
 * Vive sobre el modal compartido #widgetAsistente. Cuando se abre en
 * modo 'calendario' (calAsistenteAbrir), crm_asistente.js oculta el
 * chat normal y delega el render del contenido a este módulo.
 *
 * Flujo:
 *   Vista 1 — selector de acción (reagendar vencidas | rellenar 5 días)
 *   Vista 2 — loading (spinner mientras el AI piensa)
 *   Vista 3 — plan propuesto (lista de cards + Aplicar / Cancelar)
 *   Vista 4 — resultado (N cambios aplicados, botón Cerrar)
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
        view: 'home',       // 'home' | 'loading' | 'plan' | 'done'
        applying: false,
        result: null,       // {aplicados, fallidos, errores}
    };

    /* ─── Estilos (inyectados una sola vez) ─── */
    function ensureStyles() {
        if (document.getElementById('calAiStyles')) return;
        var st = document.createElement('style');
        st.id = 'calAiStyles';
        st.textContent = ''
            + '#asistenteCalendarioRoot{display:flex;flex-direction:column;gap:18px;padding:24px 6px;width:100%;max-width:680px;margin:0 auto;}'
            + '.calai-title{font-size:1.5rem;font-weight:700;letter-spacing:-0.02em;color:#0F172A;margin:0;'
                + 'background:linear-gradient(135deg,#0F172A 30%,#0066FF 70%,#6366F1);'
                + '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;'
                + 'text-align:center;display:flex;align-items:center;justify-content:center;gap:10px;}'
            + '.calai-subtitle{font-size:0.95rem;color:#64748B;text-align:center;margin:-6px 0 14px 0;}'
            + '.calai-actions{display:flex;flex-direction:column;gap:14px;}'
            + '.calai-action-card{display:flex;flex-direction:column;gap:8px;padding:20px 22px;'
                + 'background:linear-gradient(135deg,#FFFFFF 0%,#F8FAFF 100%);'
                + 'border:1px solid rgba(99,102,241,0.18);border-radius:16px;'
                + 'box-shadow:0 2px 10px -4px rgba(99,102,241,0.20);'
                + 'cursor:pointer;text-align:left;font-family:inherit;color:#0F172A;'
                + 'transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease;}'
            + '.calai-action-card:hover{transform:translateY(-1px);border-color:#6366F1;'
                + 'box-shadow:0 14px 32px -10px rgba(99,102,241,0.32);}'
            + '.calai-action-head{display:flex;align-items:center;gap:12px;}'
            + '.calai-action-icon{width:42px;height:42px;border-radius:12px;flex-shrink:0;'
                + 'background:linear-gradient(135deg,#0066FF,#6366F1);color:#fff;'
                + 'display:flex;align-items:center;justify-content:center;'
                + 'box-shadow:0 6px 14px -6px rgba(0,102,255,0.45);}'
            + '.calai-action-icon svg{width:22px;height:22px;}'
            + '.calai-action-title{font-size:1.05rem;font-weight:700;color:#0F172A;letter-spacing:-0.01em;}'
            + '.calai-action-desc{font-size:0.86rem;color:#475569;line-height:1.5;margin-top:2px;}'
            + '.calai-action-cta{align-self:flex-end;margin-top:6px;display:inline-flex;align-items:center;gap:6px;'
                + 'padding:8px 14px;border-radius:999px;border:none;cursor:pointer;font-family:inherit;'
                + 'background:linear-gradient(135deg,#0066FF,#0052D4);color:#fff;font-weight:700;font-size:0.84rem;'
                + 'box-shadow:0 4px 12px -4px rgba(0,102,255,0.45);'
                + 'transition:transform .14s ease, box-shadow .14s ease;}'
            + '.calai-action-cta:hover{transform:translateY(-1px);'
                + 'box-shadow:0 10px 20px -6px rgba(0,102,255,0.55);}'
            + '.calai-loading{display:flex;flex-direction:column;align-items:center;gap:18px;padding:40px 20px;}'
            + '.calai-loading-text{font-size:0.95rem;font-weight:600;color:#475569;text-align:center;'
                + 'background:linear-gradient(90deg,#0066FF,#C026D3,#0066FF);background-size:200% 100%;'
                + '-webkit-background-clip:text;background-clip:text;color:transparent;'
                + 'animation:calai-shimmer 2s linear infinite;}'
            + '@keyframes calai-shimmer{to{background-position:-200% 0;}}'
            + '.calai-spinner{width:48px;height:48px;border-radius:50%;'
                + 'border:3px solid rgba(99,102,241,0.18);border-top-color:#6366F1;'
                + 'animation:calai-spin 0.9s linear infinite;}'
            + '@keyframes calai-spin{to{transform:rotate(360deg);}}'
            + '.calai-resumen{padding:14px 18px;border-radius:12px;'
                + 'background:linear-gradient(135deg,rgba(0,102,255,0.06),rgba(99,102,241,0.06));'
                + 'border:1px solid rgba(99,102,241,0.18);color:#1E293B;font-size:0.92rem;line-height:1.55;}'
            + '.calai-resumen strong{color:#0F172A;font-weight:700;}'
            + '.calai-plan-list{display:flex;flex-direction:column;gap:10px;}'
            + '.calai-plan-card{padding:14px 16px;border:1px solid #E5E7EB;border-radius:12px;background:#FFFFFF;'
                + 'box-shadow:0 1px 3px -1px rgba(15,23,42,0.08);transition:border-color .14s ease, box-shadow .14s ease;}'
            + '.calai-plan-card:hover{border-color:#6366F1;box-shadow:0 6px 16px -6px rgba(99,102,241,0.28);}'
            + '.calai-plan-num{display:inline-flex;align-items:center;justify-content:center;'
                + 'width:22px;height:22px;border-radius:50%;font-size:0.74rem;font-weight:700;'
                + 'background:linear-gradient(135deg,#0066FF,#6366F1);color:#fff;flex-shrink:0;}'
            + '.calai-plan-head{display:flex;align-items:flex-start;gap:10px;}'
            + '.calai-plan-title{font-size:0.95rem;font-weight:700;color:#0F172A;line-height:1.35;flex:1;min-width:0;}'
            + '.calai-plan-dur{font-size:0.74rem;color:#64748B;font-weight:600;flex-shrink:0;padding-top:2px;}'
            + '.calai-plan-meta{margin-top:8px;display:flex;flex-direction:column;gap:4px;font-size:0.84rem;color:#475569;}'
            + '.calai-plan-meta .calai-old{color:#94A3B8;text-decoration:line-through;}'
            + '.calai-plan-meta .calai-new{color:#0F172A;font-weight:600;}'
            + '.calai-plan-meta .calai-link{color:#0052D4;font-weight:600;}'
            + '.calai-plan-razon{margin-top:6px;display:flex;gap:6px;align-items:flex-start;'
                + 'padding:8px 10px;border-radius:8px;background:#FAFBFF;'
                + 'border:1px dashed rgba(99,102,241,0.30);font-size:0.82rem;color:#475569;line-height:1.45;}'
            + '.calai-plan-razon .calai-bulb{color:#F59E0B;flex-shrink:0;}'
            + '.calai-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;'
                + 'padding-top:14px;border-top:1px solid rgba(99,102,241,0.12);margin-top:6px;}'
            + '.calai-btn{padding:10px 18px;border-radius:10px;border:none;cursor:pointer;'
                + 'font-family:inherit;font-weight:700;font-size:0.88rem;'
                + 'transition:transform .14s ease, box-shadow .14s ease, background .14s ease;}'
            + '.calai-btn-secondary{background:#F1F5F9;color:#475569;}'
            + '.calai-btn-secondary:hover{background:#E2E8F0;color:#0F172A;}'
            + '.calai-btn-primary{background:linear-gradient(135deg,#0066FF,#0052D4);color:#fff;'
                + 'box-shadow:0 4px 12px -4px rgba(0,102,255,0.45);}'
            + '.calai-btn-primary:hover{transform:translateY(-1px);'
                + 'box-shadow:0 10px 22px -6px rgba(0,102,255,0.55);}'
            + '.calai-btn-primary:disabled{opacity:0.6;cursor:not-allowed;transform:none;}'
            + '.calai-empty{padding:40px 20px;text-align:center;color:#64748B;}'
            + '.calai-empty-title{font-size:1.05rem;font-weight:700;color:#0F172A;margin-bottom:6px;}'
            + '.calai-done{display:flex;flex-direction:column;align-items:center;gap:14px;padding:34px 20px;text-align:center;}'
            + '.calai-done-check{width:64px;height:64px;border-radius:50%;'
                + 'background:linear-gradient(135deg,#10B981,#059669);color:#fff;'
                + 'display:flex;align-items:center;justify-content:center;'
                + 'box-shadow:0 12px 30px -10px rgba(16,185,129,0.55);'
                + 'animation:calai-pop 0.36s cubic-bezier(.18,.89,.32,1.28);}'
            + '@keyframes calai-pop{0%{transform:scale(0);opacity:0;}100%{transform:scale(1);opacity:1;}}'
            + '.calai-done-title{font-size:1.4rem;font-weight:700;color:#0F172A;letter-spacing:-0.01em;}'
            + '.calai-done-text{font-size:0.95rem;color:#475569;max-width:420px;line-height:1.5;}'
            + '.calai-error{padding:14px 18px;border-radius:12px;background:#FEF2F2;'
                + 'border:1px solid #FCA5A5;color:#991B1B;font-size:0.9rem;line-height:1.5;}'
            + '.calai-back{display:inline-flex;align-items:center;gap:5px;padding:6px 10px;border-radius:8px;'
                + 'border:none;background:transparent;color:#475569;cursor:pointer;font-family:inherit;'
                + 'font-size:0.82rem;font-weight:600;align-self:flex-start;'
                + 'transition:background .14s ease;}'
            + '.calai-back:hover{background:#F1F5F9;color:#0F172A;}'
            ;
        document.head.appendChild(st);
    }

    /* ─── Asegurar contenedor root dentro del modal ─── */
    function ensureRoot() {
        var box = document.getElementById('asistMessages');
        if (!box) return null;
        var root = document.getElementById('asistenteCalendarioRoot');
        if (!root) {
            root = document.createElement('div');
            root.id = 'asistenteCalendarioRoot';
            box.innerHTML = '';
            box.appendChild(root);
        }
        return root;
    }

    /* ─── Formato de fecha ───
       El backend envía ISO 8601 (con TZ o sin). Renderemos en es-MX. */
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

    /* ─── Vistas ─── */
    function viewHome(root) {
        root.innerHTML = ''
            + '<h2 class="calai-title">'
            +   svgSparkles()
            +   '<span>Asistente del Calendario</span>'
            + '</h2>'
            + '<div class="calai-subtitle">¿Qué quieres hacer hoy?</div>'
            + '<div class="calai-actions">'
            +   actionCardHTML({
                    id: 'reagendar_vencidas',
                    icon: svgClockBack(),
                    title: 'Reagendar mis actividades vencidas',
                    desc: 'Reviso tus tareas y actividades vencidas y las reorganizo en los próximos 5 días hábiles. Las más importantes para hoy, el resto distribuido inteligentemente sin encimarse con tu agenda.',
                    cta: 'Empezar',
                })
            +   actionCardHTML({
                    id: 'rellenar_calendario',
                    icon: svgWand(),
                    title: 'Rellenar mi calendario (próx. 5 días)',
                    desc: 'Detecto tus oportunidades y prospectos más importantes sin actividad reciente y agendo seguimientos en los huecos de tu calendario.',
                    cta: 'Empezar',
                })
            + '</div>';

        // Wire clicks
        root.querySelectorAll('.calai-action-card').forEach(function (card) {
            card.addEventListener('click', function () {
                var accion = card.getAttribute('data-accion');
                empezar(accion);
            });
        });
    }

    function actionCardHTML(opts) {
        return '<button type="button" class="calai-action-card" data-accion="' + esc(opts.id) + '">'
            +   '<div class="calai-action-head">'
            +     '<span class="calai-action-icon">' + opts.icon + '</span>'
            +     '<div>'
            +       '<div class="calai-action-title">' + esc(opts.title) + '</div>'
            +     '</div>'
            +   '</div>'
            +   '<div class="calai-action-desc">' + esc(opts.desc) + '</div>'
            +   '<span class="calai-action-cta">'
            +     '<span>' + esc(opts.cta) + '</span>'
            +     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>'
            +   '</span>'
            + '</button>';
    }

    function viewLoading(root, txt) {
        root.innerHTML = ''
            + '<div class="calai-loading">'
            +   '<div class="calai-spinner"></div>'
            +   '<div class="calai-loading-text">' + esc(txt || 'Analizando tu calendario…') + '</div>'
            + '</div>';
    }

    function viewPlan(root) {
        var accion = STATE.accion;
        var plan = STATE.plan || [];
        var html = ''
            + '<button type="button" class="calai-back" id="calAiBack">'
            +   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
            +   '<span>Volver</span>'
            + '</button>'
            + '<h2 class="calai-title">' + svgSparkles() + '<span>Plan propuesto</span></h2>';

        if (STATE.resumen) {
            html += '<div class="calai-resumen">' + esc(STATE.resumen) + '</div>';
        }

        if (!plan.length) {
            html += '<div class="calai-empty">'
                + '<div class="calai-empty-title">Nada que hacer</div>'
                + '<div>No encontré ' + (accion === 'reagendar_vencidas' ? 'actividades vencidas que necesiten reagendarse.' : 'huecos relevantes para agendar nuevos seguimientos.') + '</div>'
                + '</div>'
                + '<div class="calai-footer" style="justify-content:flex-end;">'
                + '<button type="button" class="calai-btn calai-btn-secondary" id="calAiCerrar1">Cerrar</button>'
                + '</div>';
        } else {
            html += '<div class="calai-plan-list">';
            plan.forEach(function (item, i) {
                html += renderPlanCard(item, i + 1, accion);
            });
            html += '</div>'
                + '<div class="calai-footer">'
                +   '<button type="button" class="calai-btn calai-btn-secondary" id="calAiCancelar">Cancelar</button>'
                +   '<button type="button" class="calai-btn calai-btn-primary" id="calAiAplicar">'
                +     '<span style="display:inline-flex;align-items:center;gap:6px;">'
                +       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
                +       'Aplicar plan'
                +     '</span>'
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
        var partes = '';

        if (accion === 'reagendar_vencidas') {
            // Espera: fecha_anterior, fecha_nueva, duracion_min, razon
            var feAnt = item.fecha_anterior || item.fecha_antigua || item.era || null;
            var feNue = item.fecha_nueva || item.nueva || item.nueva_fecha || null;
            if (feAnt) {
                partes += '<div><span style="color:#64748B;font-weight:600;">Era:</span> '
                    + '<span class="calai-old">' + esc(fmtFechaCorta(feAnt)) + '</span></div>';
            }
            if (feNue) {
                partes += '<div><span style="color:#64748B;font-weight:600;">Nueva:</span> '
                    + '<span class="calai-new">' + esc(fmtFechaCorta(feNue)) + '</span>'
                    + (durMin ? ' <span style="color:#94A3B8;">· ' + esc(String(durMin)) + ' min</span>' : '')
                    + '</div>';
            }
        } else {
            // rellenar_calendario: fecha, duracion_min, contexto (opp/prospecto), razon
            var fe = item.fecha || item.fecha_propuesta || item.fecha_nueva || null;
            if (fe) {
                partes += '<div><span style="color:#64748B;font-weight:600;">Crear en:</span> '
                    + '<span class="calai-new">' + esc(fmtFechaCorta(fe)) + '</span>'
                    + (durMin ? ' <span style="color:#94A3B8;">· ' + esc(String(durMin)) + ' min</span>' : '')
                    + '</div>';
            }
            var ctxLabel = null;
            if (item.oportunidad_titulo || item.opp_titulo) {
                ctxLabel = 'Para oportunidad: ' + (item.oportunidad_titulo || item.opp_titulo);
            } else if (item.prospecto_nombre || item.prospecto_titulo) {
                ctxLabel = 'Para prospecto: ' + (item.prospecto_nombre || item.prospecto_titulo);
            } else if (item.cliente_nombre || item.cliente) {
                ctxLabel = 'Cliente: ' + (item.cliente_nombre || item.cliente);
            }
            if (ctxLabel) {
                partes += '<div><span class="calai-link">' + esc(ctxLabel) + '</span></div>';
            }
        }

        var razonHtml = razon
            ? '<div class="calai-plan-razon"><span class="calai-bulb">'
                + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
                +   '<path d="M9 18h6"/><path d="M10 22h4"/>'
                +   '<path d="M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2z"/>'
                + '</svg></span><span>' + esc(razon) + '</span></div>'
            : '';

        return '<div class="calai-plan-card">'
            + '<div class="calai-plan-head">'
            +   '<span class="calai-plan-num">' + esc(String(idx)) + '</span>'
            +   '<span class="calai-plan-title">' + esc(titulo) + '</span>'
            + '</div>'
            + (partes ? '<div class="calai-plan-meta">' + partes + '</div>' : '')
            + razonHtml
            + '</div>';
    }

    function viewDone(root) {
        var r = STATE.result || {};
        var aplicados = typeof r.aplicados === 'number' ? r.aplicados : (STATE.plan ? STATE.plan.length : 0);
        var fallidos = typeof r.fallidos === 'number' ? r.fallidos : 0;
        var errores = Array.isArray(r.errores) ? r.errores : [];
        var verbo = STATE.accion === 'rellenar_calendario' ? 'creé' : 'reagendé';
        var html = ''
            + '<div class="calai-done">'
            +   '<div class="calai-done-check">'
            +     '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
            +   '</div>'
            +   '<div class="calai-done-title">Listo</div>'
            +   '<div class="calai-done-text">'
            +     'Apliqué <strong>' + esc(String(aplicados)) + '</strong> '
            +     (aplicados === 1 ? 'cambio' : 'cambios') + ' al calendario.'
            +     (fallidos ? ' <br><span style="color:#B45309;">' + esc(String(fallidos)) + ' no se pudieron aplicar.</span>' : '')
            +   '</div>'
            +   (errores.length
                ? '<div class="calai-error" style="text-align:left;width:100%;max-width:480px;">'
                  + '<strong>Detalles:</strong><br>'
                  + errores.slice(0, 5).map(function (e) { return esc(typeof e === 'string' ? e : (e && e.error ? e.error : JSON.stringify(e))); }).join('<br>')
                  + '</div>'
                : '')
            +   '<div style="margin-top:8px;">'
            +     '<button type="button" class="calai-btn calai-btn-primary" id="calAiCerrarDone">Cerrar</button>'
            +   '</div>'
            + '</div>';
        root.innerHTML = html;
        var btn = document.getElementById('calAiCerrarDone');
        if (btn) btn.addEventListener('click', cerrarYRefrescar);
    }

    function viewError(root, msg) {
        root.innerHTML = ''
            + '<button type="button" class="calai-back" id="calAiBackErr">'
            +   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
            +   '<span>Volver</span>'
            + '</button>'
            + '<h2 class="calai-title"><span>Algo salió mal</span></h2>'
            + '<div class="calai-error">' + esc(msg || 'No se pudo procesar tu solicitud. Intenta de nuevo en un momento.') + '</div>'
            + '<div class="calai-footer" style="justify-content:flex-end;">'
            +   '<button type="button" class="calai-btn calai-btn-secondary" id="calAiBackErr2">Volver</button>'
            + '</div>';
        var b1 = document.getElementById('calAiBackErr');
        var b2 = document.getElementById('calAiBackErr2');
        if (b1) b1.addEventListener('click', volver);
        if (b2) b2.addEventListener('click', volver);
    }

    /* ─── Iconos SVG inline ─── */
    function svgSparkles() {
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#6366F1;">'
            +   '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/>'
            +   '<path d="M19 17l.7 1.8L21.5 19.5l-1.8.7L19 22l-.7-1.8L16.5 19.5l1.8-.7L19 17z"/>'
            + '</svg>';
    }
    function svgClockBack() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            +   '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>'
            +   '<path d="M3 3v5h5"/>'
            +   '<polyline points="12 7 12 12 15 14"/>'
            + '</svg>';
    }
    function svgWand() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            +   '<path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/>'
            +   '<path d="M17.8 11.8 19 13"/><path d="M15 9h0"/><path d="M17.8 6.2 19 5"/>'
            +   '<path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/>'
            + '</svg>';
    }

    /* ─── Acciones / flujo ─── */
    function render() {
        ensureStyles();
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
        render();
    }

    function aplicarPlan() {
        if (STATE.applying) return;
        if (!STATE.plan || !STATE.plan.length) return;
        STATE.applying = true;
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
