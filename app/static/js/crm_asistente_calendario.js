/* ----------------------------------------------------------------------
 * crm_asistente_calendario.js — Asistente del Calendario (chat libre +
 * acciones rápidas).
 *
 * Vive sobre el modal compartido #widgetAsistente. Cuando se abre en
 * modo 'calendario' (calAsistenteAbrir), crm_asistente.js delega:
 *   - render del contenido a este módulo (window._calAiRenderRoot)
 *   - envío del input (cuando el user escribe) a window._calAiSendMessage
 *   - new chat a window._calAiNewChat
 *
 * Layout:
 *   Welcome (historial vacío) — orb + título + 2 sugestion cards:
 *     - Reagendar mis vencidas (flujo de plan directo)
 *     - Rellenar mi calendario  (flujo de plan directo)
 *   Conversación — bubbles user/assistant + planes inline + toasts.
 *
 * Endpoints:
 *   POST /app/api/calendario/asistente/chat/      {message, history}
 *     → {ok, reply, plan: {accion, resumen, plan: [...]} | null}
 *   POST /app/api/calendario/asistente/preview/   {accion}
 *     → {ok, accion, resumen, plan: [...]}     // flujo botones-acción
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

    /* ─── Markdown muy simple para los bubbles del bot.
       Reusamos la lógica del chat general si está disponible; si no,
       hacemos un pase mínimo que soporta **bold**, *italic*, `code`,
       saltos de línea y listas. */
    function renderMarkdown(text) {
        if (typeof window.asistenteRenderMarkdown === 'function') {
            try { return window.asistenteRenderMarkdown(text); } catch (e) { /* fall through */ }
        }
        if (typeof window.renderMarkdown === 'function') {
            try { return window.renderMarkdown(text); } catch (e) { /* fall through */ }
        }
        var html = esc(text);
        // Inline code
        var blocks = [];
        html = html.replace(/`([^`\n]+)`/g, function (_, c) {
            blocks.push(c);
            return '\x00CODE' + (blocks.length - 1) + '\x00';
        });
        html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        // Listas markdown simples (- o *) — convertimos a <ul><li>
        var lines = html.split('\n');
        var out = [];
        var inList = false;
        for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            var m = l.match(/^[ \t]*[-*]\s+(.*)$/);
            if (m) {
                if (!inList) { out.push('<ul>'); inList = true; }
                out.push('<li>' + m[1] + '</li>');
            } else {
                if (inList) { out.push('</ul>'); inList = false; }
                out.push(l);
            }
        }
        if (inList) out.push('</ul>');
        html = out.join('\n');
        // Saltos dobles → párrafos, simples → <br>
        html = html.replace(/\n\n+/g, '</p><p>');
        html = html.replace(/\n/g, '<br>');
        html = '<p>' + html + '</p>';
        // Restaurar code blocks
        html = html.replace(/\x00CODE(\d+)\x00/g, function (_, idx) {
            return '<code>' + esc(blocks[parseInt(idx, 10)]) + '</code>';
        });
        return html;
    }

    /* ─── State ─── */
    var STORAGE_KEY = 'calAiChatHistory';
    var MAX_USER_TURNS = 8;

    var STATE = {
        // Historial conversacional: [{role:'user'|'assistant', content:str}, ...]
        history: [],
        // Mensajes "ricos" para render: items con role + extras (plan, error).
        // Los reconstruimos del history en render; los planes se guardan en
        // un array paralelo indexado por turn idx para sobrevivir reload.
        plans: {}, // turnIdx → {accion, resumen, plan, applied?, applying?}
        sending: false,
        // Solo aplica al flujo de acción rápida (sugestion card click).
        quickAction: null, // 'reagendar_vencidas' | 'rellenar_calendario' | null
    };

    /* ─── Persistencia en sessionStorage ─── */
    function persist() {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                history: STATE.history,
                plans: STATE.plans,
            }));
        } catch (e) { /* silent */ }
    }
    function restore() {
        try {
            var raw = sessionStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            var data = JSON.parse(raw);
            if (data && Array.isArray(data.history)) {
                STATE.history = data.history;
            }
            if (data && data.plans && typeof data.plans === 'object') {
                STATE.plans = data.plans;
            }
        } catch (e) { /* silent */ }
    }
    function clearStorage() {
        try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* silent */ }
    }

    /* ─── Greeting (usa el del modal compartido) ───
       Cacheamos el primer nombre que vemos para sobrevivir re-renders
       (cuando reemplazamos #asistMessages, el id original del template
       deja de existir; el welcome del calendario emite su propio span
       sin id para evitar duplicados). */
    var _cachedFirstName = null;
    function getFirstName() {
        if (_cachedFirstName !== null) return _cachedFirstName;
        var el = document.getElementById('asistGreetName');
        var raw = el ? (el.textContent || '').trim() : '';
        _cachedFirstName = raw || '';
        return _cachedFirstName;
    }

    /* ─── Asegurar contenedor root dentro del modal ───
       En welcome (.asist-cal-root) el contenedor es centrado y angosto
       (max-width 560) para que las sugg cards no se vean estiradas.
       En modo chat le quitamos esa restricción para que los bubbles se
       comporten igual que los del consultor general. */
    function ensureRoot(modeChat) {
        var box = document.getElementById('asistMessages');
        if (!box) return null;
        var root = document.getElementById('asistenteCalendarioRoot');
        if (!root) {
            root = document.createElement('div');
            root.id = 'asistenteCalendarioRoot';
            box.innerHTML = '';
            box.appendChild(root);
        }
        root.className = modeChat ? 'asist-cal-rootchat' : 'asist-cal-root';
        return root;
    }

    /* ─── Orb grande reutilizable ─── */
    function orbLgHTML(thinking) {
        var thinkingCls = thinking ? ' is-thinking' : '';
        return '<div class="asist-orb asist-orb--lg' + thinkingCls + '" aria-hidden="true">'
            +   '<span class="asist-orb-core"></span>'
            +   '<span class="asist-orb-ring asist-orb-ring--horiz"></span>'
            +   '<span class="asist-orb-ring asist-orb-ring--vert"></span>'
            + '</div>';
    }
    function orbMdHTML() {
        return '<div class="asist-orb asist-orb--md" aria-hidden="true">'
            +   '<span class="asist-orb-core"></span>'
            +   '<span class="asist-orb-ring asist-orb-ring--horiz"></span>'
            +   '<span class="asist-orb-ring asist-orb-ring--vert"></span>'
            + '</div>';
    }

    /* ─── Formato de fecha ─── */
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
    function svgCheck() {
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'
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

    /* ─── Welcome (historial vacío) ───
       Reusa la misma estructura visual que el consultor general
       (.asist-welcome + .asist-suggestions con .asist-sugg-card) para
       que ambos asistentes se vean idénticos. Las cards usan data-prompt
       — el handler global del modal las captura y manda al sendMessage,
       que en modo calendar delega a _calAiSendMessage; ahí
       interceptamos las frases conocidas para usar el preview rápido
       en lugar de chat libre. */
    function renderWelcome(root) {
        var name = getFirstName();
        var greeting = name
            ? 'Hola, <span class="asist-greet-user">' + esc(name) + '</span>'
            : 'Hola';
        root.innerHTML = ''
            + '<div class="asist-welcome">'
            +   orbLgHTML(false)
            +   '<div class="asist-welcome-title">'
            +     '<span class="asist-greeting">' + greeting + '</span>'
            +     '<span class="asist-greeting-q">Asistente del Calendario</span>'
            +   '</div>'
            +   '<div class="asist-welcome-sub">'
            +     'Pregúntame por tu <strong>agenda</strong> o usa una <strong>acción rápida</strong>.'
            +   '</div>'
            +   '<div class="asist-suggestions">'
            +     suggCardHTML({
                    prompt: 'Reagendar mis vencidas',
                    icon: svgClockBack(),
                    title: 'Reagendar mis vencidas',
                    sub: 'Reorganizo pendientes en 5 días',
                  })
            +     suggCardHTML({
                    prompt: 'Rellenar mi calendario',
                    icon: svgWand(),
                    title: 'Rellenar mi calendario',
                    sub: 'Agendo en los huecos de tu semana',
                  })
            +   '</div>'
            + '</div>';
    }

    function suggCardHTML(opts) {
        return '<button type="button" class="asist-sugg-card" data-prompt="' + esc(opts.prompt) + '">'
            +   '<span class="asist-sugg-icon">' + opts.icon + '</span>'
            +   '<span class="asist-sugg-text">'
            +     '<strong>' + esc(opts.title) + '</strong>'
            +     '<em>' + esc(opts.sub) + '</em>'
            +   '</span>'
            + '</button>';
    }

    /* ─── Chat render ─── */
    function renderChat(root) {
        // Pintamos todos los mensajes del historial + planes adjuntos.
        var html = '<div class="asist-cal-chat" id="calAiChatStream">';
        STATE.history.forEach(function (m, idx) {
            html += msgHTML(m, idx);
            if (STATE.plans[idx]) {
                html += planCardInlineHTML(STATE.plans[idx], idx);
            }
        });
        html += '</div>';
        root.innerHTML = html;

        // Bind clicks de los planes inline.
        bindPlanCardEvents(root);
        // Scroll al final.
        var stream = document.getElementById('calAiChatStream');
        if (stream && stream.lastElementChild) {
            stream.lastElementChild.scrollIntoView({block: 'end'});
        }
        // El contenedor padre también puede tener scroll.
        var box = document.getElementById('asistMessages');
        if (box) box.scrollTop = box.scrollHeight;
    }

    function msgHTML(m, idx) {
        var role = m.role === 'user' ? 'user' : 'bot';
        var bubble = '';
        if (role === 'user') {
            bubble = '<div class="asist-msg-bubble">' + esc(m.content || '') + '</div>';
        } else {
            // Si el bubble está vacío (solo viene plan), no renderizamos
            // bubble para evitar burbuja en blanco.
            if (m.content && m.content.trim()) {
                bubble = '<div class="asist-msg-bubble">' + renderMarkdown(m.content) + '</div>';
            } else if (m.isError) {
                bubble = '<div class="asist-msg-bubble asist-cal-bubble-err">'
                    + esc(m.errorMsg || 'Algo salió mal.')
                    + ' <button type="button" class="asist-cal-retry-link" data-cal-retry-idx="' + idx + '">'
                    + svgRetry() + '<span>Reintentar</span></button>'
                    + '</div>';
            }
        }
        var orb = role === 'bot' ? orbMdHTML() : '';
        return '<div class="asist-msg asist-msg-' + role + '" data-idx="' + idx + '">'
            + orb + bubble
            + '</div>';
    }

    function planCardInlineHTML(planData, idx) {
        if (!planData || !planData.plan || !planData.plan.length) {
            // Plan vacío — mostramos badge informativo.
            return '<div class="asist-cal-plan-inline asist-cal-plan-inline--empty">'
                + '<div class="asist-cal-plan-inline-empty-text">'
                + esc(planData && planData.resumen ? planData.resumen : 'Sin items para mostrar.')
                + '</div></div>';
        }
        var accion = planData.accion || '';
        var headline = accion === 'reagendar_vencidas'
            ? 'Plan para reagendar tus vencidas'
            : (accion === 'rellenar_calendario'
                ? 'Plan para rellenar tu calendario'
                : 'Plan propuesto');
        var applied = !!planData.applied;
        var applying = !!planData.applying;

        var listHtml = '';
        planData.plan.forEach(function (item, i) {
            listHtml += renderPlanCard(item, i + 1, accion);
        });

        var footer;
        if (applied) {
            var aplicados = planData.appliedResult && typeof planData.appliedResult.aplicados === 'number'
                ? planData.appliedResult.aplicados : planData.plan.length;
            var fallidos = planData.appliedResult && typeof planData.appliedResult.fallidos === 'number'
                ? planData.appliedResult.fallidos : 0;
            footer = '<div class="asist-cal-plan-inline-footer is-applied">'
                + svgCheck()
                + '<span><strong>' + esc(String(aplicados)) + '</strong> cambio'
                + (aplicados === 1 ? '' : 's') + ' aplicado'
                + (aplicados === 1 ? '' : 's') + ' al calendario'
                + (fallidos
                    ? ' · ' + esc(String(fallidos)) + ' con error'
                    : '')
                + '</span></div>';
        } else if (applying) {
            footer = '<div class="asist-cal-plan-inline-footer is-applying">'
                + '<div class="asist-cal-spinner"></div>'
                + '<span>Aplicando cambios…</span>'
                + '</div>';
        } else {
            footer = '<div class="asist-cal-plan-inline-footer">'
                + '<button type="button" class="asist-cal-btn asist-cal-btn-secondary" data-cal-plan-cancel="' + idx + '">Cancelar</button>'
                + '<button type="button" class="asist-cal-btn asist-cal-btn-primary" data-cal-plan-apply="' + idx + '">'
                + svgCheck() + '<span>Aplicar plan</span>'
                + '</button>'
                + '</div>';
        }

        return '<div class="asist-cal-plan-inline" data-cal-plan-idx="' + idx + '">'
            + '<div class="asist-cal-plan-inline-head">'
            +   '<span class="asist-cal-plan-inline-headline">' + esc(headline) + '</span>'
            + '</div>'
            + (planData.resumen
                ? '<div class="asist-cal-resumen">' + esc(planData.resumen) + '</div>'
                : '')
            + '<div class="asist-cal-plan-list">' + listHtml + '</div>'
            + footer
            + '</div>';
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
            var ctxLabel = item.fuente_label || item.oportunidad_titulo || item.opp_titulo
                || item.prospecto_nombre || item.prospecto_titulo
                || item.cliente_label || item.cliente_nombre || item.cliente;
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

    function bindPlanCardEvents(root) {
        root.querySelectorAll('[data-cal-plan-apply]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = parseInt(btn.getAttribute('data-cal-plan-apply'), 10);
                applyPlan(idx);
            });
        });
        root.querySelectorAll('[data-cal-plan-cancel]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = parseInt(btn.getAttribute('data-cal-plan-cancel'), 10);
                cancelPlan(idx);
            });
        });
        root.querySelectorAll('[data-cal-retry-idx]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = parseInt(btn.getAttribute('data-cal-retry-idx'), 10);
                retryFromIdx(idx);
            });
        });
    }

    /* ─── Typing indicator ─── */
    function appendTypingBubble() {
        var stream = document.getElementById('calAiChatStream');
        if (!stream) return;
        var wrap = document.createElement('div');
        wrap.className = 'asist-msg asist-msg-bot';
        wrap.id = 'calAiTypingRow';
        wrap.innerHTML = orbMdHTML()
            + '<div class="asist-msg-bubble asist-thinking">'
            + '<span class="asist-thinking-text">Pensando…</span>'
            + '</div>';
        stream.appendChild(wrap);
        var orb = wrap.querySelector('.asist-orb');
        if (orb) orb.classList.add('is-thinking');
        var box = document.getElementById('asistMessages');
        if (box) box.scrollTop = box.scrollHeight;
    }
    function removeTypingBubble() {
        var t = document.getElementById('calAiTypingRow');
        if (t) t.remove();
    }

    /* ─── Toast ─── */
    function flash(msg) {
        try {
            if (typeof window.showFlash === 'function') {
                window.showFlash(msg);
                return;
            }
        } catch (e) { /* silent */ }
        // Fallback: console.
        try { console.log('[asist-cal]', msg); } catch (e) { /* silent */ }
    }

    /* ─── Render principal ─── */
    function render() {
        var modeChat = STATE.history.length > 0;
        var root = ensureRoot(modeChat);
        if (!root) return;
        if (modeChat) {
            renderChat(root);
        } else {
            renderWelcome(root);
        }
    }
    window._calAiRenderRoot = render;

    /* ─── Acción rápida (Reagendar / Rellenar) ───
       Flujo: muestra un mensaje user "implícito" + spinner; cuando llega
       el plan, lo pinta como card inline. Reusa endpoint /preview/. */
    function startQuickAction(accion) {
        if (!accion) return;
        if (STATE.sending) return;
        if (reachedTurnLimit(true)) return;

        STATE.quickAction = accion;
        STATE.sending = true;

        var userLabel = accion === 'reagendar_vencidas'
            ? 'Reagendar mis vencidas'
            : 'Rellenar mi calendario';
        STATE.history.push({role: 'user', content: userLabel});
        persist();
        render();
        appendTypingBubble();

        api('/app/api/calendario/asistente/preview/', {
            method: 'POST',
            body: JSON.stringify({accion: accion}),
        }).then(function (res) {
            STATE.sending = false;
            removeTypingBubble();
            if (!res.ok || !res.data || !res.data.ok) {
                pushAssistantError((res.data && res.data.error)
                    || 'No pude generar un plan ahora mismo.');
                return;
            }
            var plan = Array.isArray(res.data.plan) ? res.data.plan : [];
            var resumen = res.data.resumen || '';
            STATE.history.push({role: 'assistant', content: plan.length ? '' : resumen});
            var idx = STATE.history.length - 1;
            STATE.plans[idx] = {
                accion: accion,
                resumen: resumen,
                plan: plan,
            };
            persist();
            render();
        }).catch(function (err) {
            STATE.sending = false;
            removeTypingBubble();
            pushAssistantError('Error de red: ' + err);
        });
    }

    function pushAssistantError(msg) {
        STATE.history.push({
            role: 'assistant',
            content: '',
            isError: true,
            errorMsg: msg,
        });
        persist();
        render();
    }

    /* ─── Auto-reset por límite de turnos ───
       Devuelve true si NO podemos seguir (ya reseteamos y le avisamos al
       user). Cuando llega al límite mostramos un mensaje sutil y limpiamos
       el historial. */
    function countUserTurns() {
        var n = 0;
        for (var i = 0; i < STATE.history.length; i++) {
            if (STATE.history[i].role === 'user') n++;
        }
        return n;
    }
    function reachedTurnLimit(beforeAdding) {
        // beforeAdding=true → estamos por agregar 1 user turn más.
        var nUser = countUserTurns();
        if (beforeAdding) nUser += 1;
        if (nUser > MAX_USER_TURNS) {
            // Reset con mensaje informativo. Conservamos el ÚLTIMO mensaje
            // del user para que pueda re-enviarse fácil.
            STATE.history = [];
            STATE.plans = {};
            STATE.history.push({
                role: 'assistant',
                content: 'He acumulado mucho contexto, voy a empezar un chat nuevo para mantenerme rápido y barato. Vuelve a preguntarme lo que necesites.',
            });
            persist();
            render();
            return true;
        }
        return false;
    }

    /* ─── Enviar mensaje al chat libre ─── */
    function sendChatMessage(text) {
        text = (text || '').trim();
        if (!text) return;
        // Shortcut: si el texto matchea las labels de las cards del welcome,
        // disparamos la acción rápida (endpoint /preview/ — sin tokens LLM)
        // en vez de mandarlo al chat libre.
        if (text === 'Reagendar mis vencidas') {
            startQuickAction('reagendar_vencidas');
            return;
        }
        if (text === 'Rellenar mi calendario') {
            startQuickAction('rellenar_calendario');
            return;
        }
        if (STATE.sending) return;
        if (reachedTurnLimit(true)) return;

        STATE.sending = true;
        STATE.history.push({role: 'user', content: text});
        persist();
        render();
        appendTypingBubble();

        // Mandamos el historial COMPLETO (excluyendo el último user que
        // acabamos de agregar) — el backend lo mete junto con `message`
        // en el array de messages que ve el LLM.
        var historyToSend = STATE.history.slice(0, -1)
            .filter(function (m) {
                // Excluir mensajes de error y los planes vacíos del history
                // que vamos a mandar al LLM — no aportan contexto útil y
                // pueden confundir al modelo.
                if (m.isError) return false;
                return m.role === 'user' || m.role === 'assistant';
            })
            .map(function (m) {
                return {role: m.role, content: m.content || ''};
            });

        api('/app/api/calendario/asistente/chat/', {
            method: 'POST',
            body: JSON.stringify({
                message: text,
                history: historyToSend,
            }),
        }).then(function (res) {
            STATE.sending = false;
            removeTypingBubble();
            if (!res.ok || !res.data || !res.data.ok) {
                pushAssistantError((res.data && res.data.error)
                    || 'No pude procesar tu mensaje. Intenta de nuevo.');
                return;
            }
            var reply = res.data.reply || '';
            var plan = res.data.plan || null;
            STATE.history.push({role: 'assistant', content: reply});
            var idx = STATE.history.length - 1;
            if (plan && Array.isArray(plan.plan)) {
                STATE.plans[idx] = {
                    accion: plan.accion || '',
                    resumen: plan.resumen || '',
                    plan: plan.plan || [],
                };
            }
            persist();
            render();
        }).catch(function (err) {
            STATE.sending = false;
            removeTypingBubble();
            pushAssistantError('Error de red: ' + err);
        });
    }
    // Expuesto para crm_asistente.js (handler del input).
    window._calAiSendMessage = sendChatMessage;

    /* ─── Reintentar desde un mensaje de error ───
       Quitamos el mensaje de error (último entry) y reenviamos el último
       user message. Solo aplica si el último user message no era una
       acción rápida (en ese caso el reintento usa startQuickAction). */
    function retryFromIdx(idx) {
        if (STATE.sending) return;
        // Buscar el último 'user' antes de idx.
        var lastUserIdx = -1;
        for (var i = idx - 1; i >= 0; i--) {
            if (STATE.history[i] && STATE.history[i].role === 'user') {
                lastUserIdx = i;
                break;
            }
        }
        if (lastUserIdx < 0) return;
        var lastUserMsg = STATE.history[lastUserIdx];
        // Removemos desde lastUserIdx (incluido) hacia delante — la fn
        // sendChatMessage / startQuickAction lo volverá a agregar.
        STATE.history = STATE.history.slice(0, lastUserIdx);
        // Limpiar planes asociados a esos indices.
        var newPlans = {};
        Object.keys(STATE.plans).forEach(function (k) {
            var n = parseInt(k, 10);
            if (n < lastUserIdx) newPlans[n] = STATE.plans[k];
        });
        STATE.plans = newPlans;
        persist();
        // Heurística: si el texto coincide con las labels de acciones
        // rápidas, redisparamos esa acción.
        var txt = (lastUserMsg.content || '').trim();
        if (txt === 'Reagendar mis vencidas') {
            startQuickAction('reagendar_vencidas');
        } else if (txt === 'Rellenar mi calendario') {
            startQuickAction('rellenar_calendario');
        } else {
            sendChatMessage(txt);
        }
    }

    /* ─── Aplicar / Cancelar plan inline ─── */
    function applyPlan(idx) {
        var p = STATE.plans[idx];
        if (!p || p.applied || p.applying) return;
        if (!p.plan || !p.plan.length) return;
        p.applying = true;
        persist();
        render();
        api('/app/api/calendario/asistente/aplicar/', {
            method: 'POST',
            body: JSON.stringify({accion: p.accion, plan: p.plan}),
        }).then(function (res) {
            p.applying = false;
            if (!res.ok || !res.data || !res.data.ok) {
                p.applied = false;
                persist();
                render();
                pushAssistantError((res.data && res.data.error)
                    || 'No se pudieron aplicar los cambios.');
                return;
            }
            p.applied = true;
            p.appliedResult = {
                aplicados: typeof res.data.aplicados === 'number' ? res.data.aplicados : p.plan.length,
                fallidos: typeof res.data.fallidos === 'number' ? res.data.fallidos : 0,
                errores: Array.isArray(res.data.errores) ? res.data.errores : [],
            };
            persist();
            render();
            var n = p.appliedResult.aplicados;
            flash(n + (n === 1 ? ' cambio aplicado al calendario' : ' cambios aplicados al calendario'));
            // Refrescamos el calendario para que aparezca lo nuevo.
            try {
                if (typeof window.calGlobalRefetch === 'function') {
                    var sel = document.getElementById('calUserFilter');
                    window.calGlobalRefetch(sel ? sel.value : 'all');
                }
            } catch (e) { /* silent */ }
        }).catch(function (err) {
            p.applying = false;
            persist();
            render();
            pushAssistantError('Error de red aplicando: ' + err);
        });
    }
    function cancelPlan(idx) {
        var p = STATE.plans[idx];
        if (!p) return;
        if (p.applied || p.applying) return;
        delete STATE.plans[idx];
        // Agregamos mensaje sutil del asistente confirmando.
        STATE.history.push({
            role: 'assistant',
            content: 'OK, descarté ese plan. Dime qué necesitas.',
        });
        persist();
        render();
    }

    /* ─── Nuevo chat: limpia historial y vuelve al welcome ─── */
    function newChat() {
        STATE.history = [];
        STATE.plans = {};
        STATE.sending = false;
        STATE.quickAction = null;
        clearStorage();
        render();
    }
    window._calAiNewChat = newChat;

    /* ─── API pública ─── */
    window.calAsistenteAbrir = function () {
        // Restauramos sessionStorage solo en el primer abrir; los siguientes
        // mantienen el state en memoria.
        if (!window._calAiBooted) {
            restore();
            window._calAiBooted = true;
        }
        if (typeof window.asistenteAbrir === 'function') {
            window.asistenteAbrir({calendar: true});
        } else {
            render();
        }
    };

    /* ─── Wire-up del botón del topbar (mismo patrón que antes) ─── */
    document.addEventListener('click', function (e) {
        var trigger = e.target.closest('[data-cal-asist-open], #calAsistenteBtn');
        if (!trigger) return;
        if (trigger.hasAttribute('onclick')) return;
        e.preventDefault();
        window.calAsistenteAbrir();
    });
})();
