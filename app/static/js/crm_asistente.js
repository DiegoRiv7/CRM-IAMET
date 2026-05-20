/* ----------------------------------------------------------------------
 * crm_asistente.js — Widget chat del asistente AI.
 *
 * Triggers para abrirlo (registra listeners en init):
 *   - data-asist-open en cualquier elemento
 *   - window.asistenteAbrir()
 *
 * Endpoints:
 *   GET    /app/api/asistente/config/                  → nombre + logo
 *   GET    /app/api/asistente/conversacion/            → historial visible
 *   DELETE /app/api/asistente/conversacion/eliminar/   → limpiar
 *   POST   /app/api/asistente/mensaje/                 → mandar mensaje
 * --------------------------------------------------------------------*/
(function () {
    'use strict';
    if (window._asistenteLoaded) return;
    window._asistenteLoaded = true;

    // Prompt canónico del botón "Próximo paso" en modo prospecto.
    // Lo usamos para detectar cuándo la respuesta del AI debe ir
    // acompañada de la card "Agendar seguimiento".
    var PROXIMO_PASO_PROMPT = '¿Cuál es el próximo paso recomendado para este prospecto?';

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
        config: null,
        configLoaded: false,
        historyLoaded: false,
        sending: false,
        // Contextos embebidos. Solo uno puede estar activo a la vez:
        //   - ideaCtx: modo "idea" (sparring sobre una idea capturada).
        //   - prospectoCtx: modo "prospecto" (coach táctico de ventas).
        //   - ambos null: modo general (consultor de pipeline).
        // Cuando hay contexto embebido el asistente usa endpoints
        // distintos, muestra "Guardar resumen" en el header, y el
        // welcome trae sugerencias específicas del modo.
        ideaCtx: null,
        prospectoCtx: null,
        oportunidadCtx: null,
        // Flag: la PRÓXIMA respuesta del asistente (en modo prospecto
        // o modo oportunidad) debe traer la card "Agendar seguimiento"
        // debajo. Se levanta cuando el user manda exactamente
        // PROXIMO_PASO_PROMPT y se baja en cuanto la card se renderea.
        expectingProximoPaso: false,
        lastAssistantText: '',
    };

    /* ─── Open / close ─── */
    function openAsistente(options) {
        var ov = document.getElementById('widgetAsistente');
        if (!ov) return;
        options = options || {};
        // Detectamos el contexto embebido (idea/prospecto) o modo general.
        var prevCtxKey = ctxKey();
        STATE.ideaCtx = options.idea || null;
        STATE.prospectoCtx = options.prospecto || null;
        STATE.oportunidadCtx = options.oportunidad || null;
        var nextCtxKey = ctxKey();
        // Si cambiamos de modo o de target, vaciamos mensajes y forzamos
        // recarga de historial.
        if (prevCtxKey !== nextCtxKey) {
            STATE.historyLoaded = false;
            var box = document.getElementById('asistMessages');
            if (box) {
                box.innerHTML = '';
                box.appendChild(buildWelcomeNode());
                applyContextualSuggestions();
            }
        }
        ov.style.display = 'flex';
        ov.classList.add('active');
        document.body.style.overflow = 'hidden';
        applyMode();
        ensureConfig();
        loadHistory();
        setTimeout(function () {
            var inp = document.getElementById('asistInput');
            if (inp) inp.focus();
        }, 50);
    }
    function closeAsistente() {
        var ov = document.getElementById('widgetAsistente');
        if (!ov) return;
        ov.style.display = 'none';
        ov.classList.remove('active');
        document.body.style.overflow = '';
    }
    window.asistenteAbrir = openAsistente;
    window.asistenteCerrar = closeAsistente;

    /* ─── Modo (general / idea / prospecto / oportunidad) ─── */
    function isIdeaMode() { return !!STATE.ideaCtx; }
    function isProspectoMode() { return !!STATE.prospectoCtx; }
    function isOportunidadMode() { return !!STATE.oportunidadCtx; }
    function isEmbedMode() {
        return isIdeaMode() || isProspectoMode() || isOportunidadMode();
    }
    function ctxKey() {
        // Identidad del contexto embebido — sirve para detectar cambios.
        if (STATE.ideaCtx) return 'idea:' + STATE.ideaCtx.id;
        if (STATE.prospectoCtx) return 'prospecto:' + STATE.prospectoCtx.id;
        if (STATE.oportunidadCtx) return 'opp:' + STATE.oportunidadCtx.id;
        return 'general';
    }

    function applyMode() {
        var tagText = document.getElementById('asistTaglineText');
        if (tagText) {
            if (isIdeaMode()) {
                tagText.textContent = 'Idea: ' + (STATE.ideaCtx.titulo || 'sin título');
            } else if (isProspectoMode()) {
                tagText.textContent = 'Prospecto: ' + (STATE.prospectoCtx.titulo || 'sin nombre');
            } else if (isOportunidadMode()) {
                tagText.textContent = 'Oportunidad: ' + (STATE.oportunidadCtx.titulo || 'sin título');
            } else {
                tagText.textContent = 'En línea · listo para ayudarte';
            }
        }
        var saveBtn = document.getElementById('asistSaveResumenBtn');
        if (saveBtn) saveBtn.style.display = isEmbedMode() ? '' : 'none';
        applyContextualSuggestions();
    }

    /* ─── Endpoints por modo ─── */
    function urlHistory() {
        if (isIdeaMode())
            return '/app/api/ideas/' + STATE.ideaCtx.id + '/asistente/mensajes/';
        if (isProspectoMode())
            return '/app/api/prospectos/' + STATE.prospectoCtx.id + '/asistente/mensajes/';
        if (isOportunidadMode())
            return '/app/api/oportunidades/' + STATE.oportunidadCtx.id + '/asistente/mensajes/';
        return '/app/api/asistente/conversacion/';
    }
    function urlSend() {
        if (isIdeaMode())
            return '/app/api/ideas/' + STATE.ideaCtx.id + '/asistente/mensaje/';
        if (isProspectoMode())
            return '/app/api/prospectos/' + STATE.prospectoCtx.id + '/asistente/mensaje/';
        if (isOportunidadMode())
            return '/app/api/oportunidades/' + STATE.oportunidadCtx.id + '/asistente/mensaje/';
        return '/app/api/asistente/mensaje/';
    }
    function urlReset() {
        if (isIdeaMode())
            return '/app/api/ideas/' + STATE.ideaCtx.id + '/asistente/reset/';
        if (isProspectoMode())
            return '/app/api/prospectos/' + STATE.prospectoCtx.id + '/asistente/reset/';
        if (isOportunidadMode())
            return '/app/api/oportunidades/' + STATE.oportunidadCtx.id + '/asistente/reset/';
        return '/app/api/asistente/conversacion/eliminar/';
    }
    function urlResumen() {
        if (isIdeaMode())
            return '/app/api/ideas/' + STATE.ideaCtx.id + '/asistente/resumen/';
        if (isProspectoMode())
            return '/app/api/prospectos/' + STATE.prospectoCtx.id + '/asistente/resumen/';
        if (isOportunidadMode())
            return '/app/api/oportunidades/' + STATE.oportunidadCtx.id + '/asistente/resumen/';
        return '';
    }

    /* ─── Config (nombre + logo + rol del user) ─── */
    function ensureConfig() {
        if (STATE.configLoaded) return;
        STATE.configLoaded = true;
        api('/app/api/asistente/config/').then(function (res) {
            if (!res.ok || !res.data.ok) return;
            STATE.config = res.data;
            // Aplicar al header
            var nameEl = document.getElementById('asistName');
            if (nameEl && res.data.nombre) {
                // Conservar el badge BETA si existe
                var beta = nameEl.querySelector('.asist-beta');
                nameEl.textContent = res.data.nombre + ' ';
                if (beta) nameEl.appendChild(beta);
            }
            if (res.data.logo_url) {
                var av = document.getElementById('asistAvatar');
                if (av) av.innerHTML = '<img src="' + esc(res.data.logo_url) + '" alt="logo">';
            }
            // Re-pintar sugerencias según rol si el welcome está visible.
            applyContextualSuggestions();
        });
    }

    /* Sugerencias por rol. Si es supervisor mostramos prompts de líder
       (rankings, forecasts, evaluaciones), si es vendedor mostramos
       prompts operacionales (mi agenda, mis clientes, mis opp). */
    function getSuggestionsForRole(esSupervisor) {
        // El layout del welcome es grid 2×2:
        // [0]=top-left   [1]=top-right
        // [2]=bottom-left [3]=bottom-right
        if (esSupervisor) {
            return [
                {prompt: '¿Cómo va la empresa este mes?', label: 'Resumen del mes', sub: 'KPIs del negocio'},
                {prompt: '¿Cómo cerraremos el mes?', label: 'Proyección del mes', sub: 'Forecast ponderado'},
                {prompt: 'Dame el rendimiento completo del equipo este mes', label: 'Rendimiento de vendedores', sub: 'Quién aporta más'},
                {prompt: '¿Qué clientes llevan 2 meses sin que les hagamos una oportunidad?', label: 'Clientes sin atender', sub: 'Cartera olvidada'},
            ];
        }
        return [
            {prompt: '¿Cómo voy este mes?', label: 'Mi resumen del mes', sub: 'Mis KPIs personales'},
            {prompt: '¿Cómo cerraré el mes?', label: 'Mi proyección', sub: 'Forecast de mis opp'},
            {prompt: 'Dame mi rendimiento de este mes', label: 'Mi rendimiento', sub: 'Mis números y consejos'},
            {prompt: '¿Qué clientes míos llevo tiempo sin atender?', label: 'Mis clientes sin atender', sub: 'Cartera por reactivar'},
        ];
    }

    function applyContextualSuggestions() {
        var container = document.querySelector('#asistWelcome .asist-suggestions');
        if (!container) return;
        // Modo idea: 1 sola sugerencia + texto del welcome adaptado.
        if (isIdeaMode()) {
            var qEl = document.querySelector('#asistWelcome .asist-greeting-q');
            if (qEl) qEl.textContent = 'Vamos a aterrizar tu idea';
            var subEl = document.querySelector('#asistWelcome .asist-welcome-sub');
            if (subEl) {
                subEl.innerHTML = 'Pregúntame por <strong>la idea</strong>, '
                    + 'pídeme una <strong>opinión rápida</strong> o '
                    + '<strong>preguntas clave</strong> para validarla.';
            }
            container.innerHTML = ''
                + '<button type="button" class="asist-sugg-card" data-prompt="Opinión de mi idea">'
                +   '<span class="asist-sugg-icon">'
                +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'
                +   '</span>'
                +   '<span class="asist-sugg-text"><strong>Opinión de mi idea</strong><em>Evaluación corta y preguntas clave</em></span>'
                + '</button>';
            return;
        }
        // Modo oportunidad: 2 sugerencias predeterminadas — Cómo va este
        // deal + Próximo paso. El user puede pedir además "Redacta un
        // seguimiento" como tercera función pero NO la ponemos en el
        // welcome para no abrumar; el system prompt sabe responderla.
        if (isOportunidadMode()) {
            var qElO = document.querySelector('#asistWelcome .asist-greeting-q');
            if (qElO) qElO.textContent = 'Cerremos este deal';
            var subElO = document.querySelector('#asistWelcome .asist-welcome-sub');
            if (subElO) {
                subElO.innerHTML = 'Pídeme <strong>cómo va este deal</strong>, '
                    + 'el <strong>próximo paso</strong>, o pídeme que '
                    + '<strong>redacte un seguimiento</strong>.';
            }
            container.innerHTML = ''
                + '<button type="button" class="asist-sugg-card" data-prompt="¿Cómo va este deal? Léete las tareas, actividades, cotizaciones, conversación y correos vinculados. Dame un diagnóstico razonado: estado actual, lo que veo bien, errores o red flags que detectes, y recomendaciones concretas para los siguientes movimientos.">'
                +   '<span class="asist-sugg-icon">'
                +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 5-5"/></svg>'
                +   '</span>'
                +   '<span class="asist-sugg-text"><strong>Cómo va este deal</strong><em>Diagnóstico + errores + recomendaciones</em></span>'
                + '</button>'
                + '<button type="button" class="asist-sugg-card" data-prompt="¿Cuál es el próximo paso urgente para este deal?">'
                +   '<span class="asist-sugg-icon">'
                +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
                +   '</span>'
                +   '<span class="asist-sugg-text"><strong>Próximo paso</strong><em>UNA acción urgente, lista para agendar</em></span>'
                + '</button>'
                + '<button type="button" class="asist-sugg-card" data-prompt="Redacta un correo de seguimiento para el cliente basado en el contexto del deal.">'
                +   '<span class="asist-sugg-icon">'
                +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>'
                +   '</span>'
                +   '<span class="asist-sugg-text"><strong>Redactar seguimiento</strong><em>Un correo listo para enviar</em></span>'
                + '</button>';
            return;
        }
        // Modo prospecto: 2 sugerencias — Próximo paso + Sugerencias prospección.
        if (isProspectoMode()) {
            var qEl2 = document.querySelector('#asistWelcome .asist-greeting-q');
            if (qEl2) qEl2.textContent = 'Vamos a cerrar este prospecto';
            var subEl2 = document.querySelector('#asistWelcome .asist-welcome-sub');
            if (subEl2) {
                subEl2.innerHTML = 'Pídeme el <strong>próximo paso</strong>, '
                    + 'pídeme <strong>sugerencias para la prospección</strong>, '
                    + 'o pásame una <strong>objeción</strong> que estás enfrentando.';
            }
            container.innerHTML = ''
                + '<button type="button" class="asist-sugg-card" data-prompt="' + PROXIMO_PASO_PROMPT + '">'
                +   '<span class="asist-sugg-icon">'
                +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
                +   '</span>'
                +   '<span class="asist-sugg-text"><strong>Próximo paso</strong><em>Qué hacer ahora para mover el deal</em></span>'
                + '</button>'
                + '<button type="button" class="asist-sugg-card" data-prompt="Dame sugerencias para avanzar este prospecto.">'
                +   '<span class="asist-sugg-icon">'
                +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12" y2="17"/></svg>'
                +   '</span>'
                +   '<span class="asist-sugg-text"><strong>Sugerencias para la prospección</strong><em>Opciones para destrabar y cerrar</em></span>'
                + '</button>';
            return;
        }
        var esSup = !!(STATE.config && STATE.config.user && STATE.config.user.es_supervisor);
        var items = getSuggestionsForRole(esSup);
        var icons = [
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 5-5"/></svg>',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        ];
        container.innerHTML = items.map(function (it, i) {
            return '<button type="button" class="asist-sugg-card" data-prompt="' + esc(it.prompt) + '">'
                + '<span class="asist-sugg-icon">' + icons[i % icons.length] + '</span>'
                + '<span class="asist-sugg-text"><strong>' + esc(it.label) + '</strong><em>' + esc(it.sub) + '</em></span>'
                + '</button>';
        }).join('');
    }

    /* ─── Historial (general o por idea, según modo) ─── */
    function loadHistory() {
        if (STATE.historyLoaded) return;
        STATE.historyLoaded = true;
        api(urlHistory()).then(function (res) {
            if (!res.ok || !res.data.ok) return;
            var msgs = res.data.mensajes || [];
            if (!msgs.length) return;
            // Hay historial → ocultar welcome y pintar mensajes.
            var welcome = document.getElementById('asistWelcome');
            if (welcome) welcome.remove();
            msgs.forEach(function (m) {
                renderMessage(m.role, m.contenido);
            });
            scrollToBottom();
        });
    }

    /* Welcome reusable: usa orb animado + saludo personalizado.
       Captura el nombre del greeting que ya pintó Django en el template
       inicial para conservarlo entre clears. */
    var _greetingName = '';
    function buildWelcomeNode() {
        var div = document.createElement('div');
        div.id = 'asistWelcome';
        div.className = 'asist-welcome';
        div.innerHTML =
            orbHTML('lg')
            + '<div class="asist-welcome-title">'
            +   '<span class="asist-greeting">Hola, <span id="asistGreetName">' + esc(_greetingName || '') + '</span></span>'
            +   '<span class="asist-greeting-q">¿En qué te ayudo?</span>'
            + '</div>'
            + '<div class="asist-welcome-sub">Pregúntame por <strong>clientes</strong>, <strong>oportunidades</strong>, <strong>tu equipo</strong> o <strong>cómo va el mes</strong>.</div>'
            + '<div class="asist-suggestions">'
            +   '<button type="button" class="asist-sugg-card" data-prompt="¿Qué clientes llevan 2 meses sin que les hagamos una oportunidad?">'
            +     '<span class="asist-sugg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>'
            +     '<span class="asist-sugg-text"><strong>Clientes sin atender</strong><em>Quiénes llevan meses sin movimiento</em></span>'
            +   '</button>'
            +   '<button type="button" class="asist-sugg-card" data-prompt="Dame un resumen de cómo va la empresa este mes">'
            +     '<span class="asist-sugg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 5-5"/></svg></span>'
            +     '<span class="asist-sugg-text"><strong>Resumen del mes</strong><em>Cómo va el negocio</em></span>'
            +   '</button>'
            +   '<button type="button" class="asist-sugg-card" data-prompt="¿Cuál es la oportunidad activa que más promete?">'
            +     '<span class="asist-sugg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span>'
            +     '<span class="asist-sugg-text"><strong>La más prometedora</strong><em>Dónde poner el foco</em></span>'
            +   '</button>'
            +   '<button type="button" class="asist-sugg-card" data-prompt="¿Cómo voy a cerrar el mes?">'
            +     '<span class="asist-sugg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg></span>'
            +     '<span class="asist-sugg-text"><strong>Forecast del mes</strong><em>Proyección del cierre</em></span>'
            +   '</button>'
            + '</div>';
        return div;
    }

    function newChat(silent) {
        var promptText;
        if (isIdeaMode()) {
            promptText = '¿Borrar la conversación con la AI sobre esta idea? El resumen guardado en bitácora no se borra.';
        } else if (isProspectoMode()) {
            promptText = '¿Borrar la conversación con la AI sobre este prospecto? El resumen guardado en bitácora no se borra.';
        } else if (isOportunidadMode()) {
            promptText = '¿Borrar la conversación con la AI sobre esta oportunidad? El resumen guardado en la conversación del deal no se borra.';
        } else {
            promptText = '¿Iniciar un nuevo chat? Se perderá la conversación actual.';
        }
        if (!silent && !confirm(promptText)) return;
        // General usa DELETE, los embebidos usan POST.
        var method = isEmbedMode() ? 'POST' : 'DELETE';
        var opts = {method: method};
        if (method === 'POST') opts.body = '{}';
        api(urlReset(), opts).then(function (res) {
            if (!res.ok) return;
            var box = document.getElementById('asistMessages');
            if (!box) return;
            box.innerHTML = '';
            box.appendChild(buildWelcomeNode());
            applyContextualSuggestions();
        });
    }

    /* ─── Guardar resumen (solo en modo embebido: idea o prospecto) ─── */
    function saveResumen() {
        if (!isEmbedMode() || STATE.sending) return;
        STATE.sending = true;
        var btn = document.getElementById('asistSaveResumenBtn');
        if (btn) btn.disabled = true;
        api(urlResumen(), {method: 'POST', body: '{}'}).then(function (res) {
            if (!res.ok || !res.data.ok) {
                if (typeof window.showFlash === 'function') {
                    window.showFlash((res.data && res.data.error) || 'No se pudo guardar el resumen', 'error');
                } else {
                    alert((res.data && res.data.error) || 'No se pudo guardar el resumen');
                }
                return;
            }
            if (typeof window.showFlash === 'function') {
                var dest = isOportunidadMode() ? 'la conversación del deal' : 'la bitácora';
                window.showFlash('Resumen agregado a ' + dest);
            }
            // Refrescar el detalle (idea / prospecto / oportunidad) para
            // que el comentario nuevo aparezca de inmediato.
            try {
                if (isIdeaMode() && typeof window.refreshIdeaDetalle === 'function') {
                    window.refreshIdeaDetalle(STATE.ideaCtx.id);
                } else if (isProspectoMode() && typeof window.refreshProspectoDetalle === 'function') {
                    window.refreshProspectoDetalle(STATE.prospectoCtx.id);
                } else if (isOportunidadMode() && typeof window.refreshOportunidadDetalle === 'function') {
                    window.refreshOportunidadDetalle(STATE.oportunidadCtx.id);
                }
            } catch (e) { /* silent */ }
        }).finally(function () {
            STATE.sending = false;
            if (btn) btn.disabled = false;
        });
    }

    /* Markdown rendering profesional. Soporta:
       - Headings #, ##, ###
       - **bold**, *italic*, `code`
       - Listas con "- " o "* "
       - Listas numeradas "1. "
       - Tablas markdown | col | col |
       - Links: [texto](url) y formato custom [texto](opp:ID) para abrir
         el widget de una oportunidad sin salir del chat.
       Escapamos HTML ANTES de inyectar — no se interpreta HTML del modelo. */
    function renderMarkdown(text) {
        var html = esc(text);

        // Inline code (proteger contenido antes que el resto)
        var codeBlocks = [];
        html = html.replace(/`([^`\n]+)`/g, function (_, c) {
            codeBlocks.push(c);
            return '\x00CODE' + (codeBlocks.length - 1) + '\x00';
        });

        // Negritas y cursivas
        html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

        // Links: [texto](url). Detectamos custom `opp:ID` para hacer click handler.
        html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
            var oppMatch = url.match(/^opp:(\d+)$/);
            if (oppMatch) {
                // El label del modelo viene en formato "Título — Cliente — $Monto".
                // Si lo identificamos, partimos en pedazos para un layout 3-col.
                var parts = label.split(/\s+—\s+/);
                if (parts.length >= 3) {
                    var titulo = parts[0];
                    var cliente = parts.slice(1, -1).join(' — ');
                    var monto = parts[parts.length - 1];
                    return '<a href="#" data-asist-opp="' + oppMatch[1] + '" class="asist-opp-row">'
                        + '<span class="asist-opp-row-arrow">↗</span>'
                        + '<span class="asist-opp-row-main">'
                        +   '<span class="asist-opp-row-title">' + titulo + '</span>'
                        +   '<span class="asist-opp-row-sub">' + cliente + '</span>'
                        + '</span>'
                        + '<span class="asist-opp-row-amount">' + monto + '</span>'
                        + '</a>';
                }
                // Fallback: pill simple si el formato no incluye separadores —
                return '<a href="#" data-asist-opp="' + oppMatch[1] + '" class="asist-link asist-link--opp">' + label + '</a>';
            }
            // URLs aceptadas: SOLO mismo dominio o paths relativos del CRM.
            // Cualquier dominio externo (incluso si el modelo lo inventa)
            // queda como texto plano — evita que mande al user a sitios random.
            var sameHost = false;
            try {
                if (/^https?:\/\//i.test(url)) {
                    sameHost = (new URL(url)).host === window.location.host;
                }
            } catch (e) { sameHost = false; }

            if (sameHost) {
                return '<a href="' + url + '" target="_blank" rel="noopener" class="asist-link">' + label + '</a>';
            }
            if (/^\/app\//.test(url)) {
                var isReport = url.indexOf('/api/asistente/reporte/') !== -1;
                var cls = isReport ? 'asist-link asist-link--report' : 'asist-link';
                return '<a href="' + url + '" target="_blank" rel="noopener" class="' + cls + '">' + label + '</a>';
            }
            // Dominio externo o URL sospechosa → solo texto (sin link)
            return label;
        });

        // Bloques de KPI cards: ::: kpis ... ::: → grid de tarjetas.
        // Cada línea dentro del bloque es: "Label | Valor | Subtítulo" (pipes).
        // Antes de procesar línea por línea, extraemos los bloques kpis para
        // que el parser normal no toque su contenido.
        var kpiBlocks = [];
        html = html.replace(/^[ \t]*:::\s*kpis(?:\s*:::)?\s*\n([\s\S]*?)^[ \t]*:::\s*$/gm, function (_, content) {
            var rows = content.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
            var cards = '';
            rows.forEach(function (l) {
                // Quitar bullet/numeral inicial si lo trae
                l = l.replace(/^\s*[-*•]\s+/, '');
                var parts = l.split('|').map(function (s) { return s.trim(); });
                if (parts.length === 0 || !parts[0]) return;
                var label = parts[0];
                var value = parts[1] || '';
                var sub = parts[2] || '';
                cards += '<div class="asist-kpi-card">'
                    + '<div class="asist-kpi-label">' + label + '</div>'
                    + '<div class="asist-kpi-value">' + value + '</div>'
                    + (sub ? '<div class="asist-kpi-sub">' + sub + '</div>' : '')
                    + '</div>';
            });
            var idx = kpiBlocks.length;
            kpiBlocks.push('<div class="asist-kpi-grid">' + cards + '</div>');
            return '\x00KPIBLOCK' + idx + '\x00';
        });

        // Procesar línea por línea para listas, headings y tablas.
        var lines = html.split('\n');
        var out = [];
        var inList = null;        // 'ul' | 'ol' | null
        var inTable = false;
        var tableHeader = null;

        function closeList() {
            if (inList) { out.push('</' + inList + '>'); inList = null; }
        }
        function closeTable() {
            if (inTable) { out.push('</tbody></table>'); inTable = false; tableHeader = null; }
        }

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            // Headings (#, ##, ###, #### …) — cualquier nivel se renderea
            // con clase .asist-h-N (N=1..6). El CSS solo distingue 1/2/3
            // y trata 4+ igual que 3 (sub-heading).
            var h = line.match(/^\s*(#{1,6})\s+(.+)$/);
            if (h) {
                closeList(); closeTable();
                var lvl = Math.min(h[1].length, 6);
                var cssLevel = Math.min(lvl, 3);  // CSS hasta nivel 3
                var htmlLevel = Math.min(lvl + 2, 6);  // h3..h6
                out.push('<h' + htmlLevel + ' class="asist-h asist-h-' + cssLevel + '">' + h[2] + '</h' + htmlLevel + '>');
                continue;
            }
            // Tabla — detectar líneas con |
            var isTableRow = /^\s*\|.+\|\s*$/.test(line);
            var isTableSep = /^\s*\|[\s\-:|]+\|\s*$/.test(line);
            if (isTableRow && !isTableSep) {
                closeList();
                var cells = line.trim().replace(/^\||\|$/g, '').split('|').map(function (s) { return s.trim(); });
                if (!inTable) {
                    // Mirar siguiente línea — si es separador, esto es header
                    var next = lines[i + 1];
                    if (next && /^\s*\|[\s\-:|]+\|\s*$/.test(next)) {
                        out.push('<table class="asist-table"><thead><tr>'
                            + cells.map(function (c) { return '<th>' + c + '</th>'; }).join('')
                            + '</tr></thead><tbody>');
                        inTable = true;
                        i++; // saltar separator
                        continue;
                    }
                    // Sin header: abrir tabla simple
                    out.push('<table class="asist-table"><tbody>');
                    inTable = true;
                }
                out.push('<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>');
                continue;
            }
            if (inTable) closeTable();

            // Listas
            var ul = line.match(/^\s*(?:-|•|\*)\s+(.*)$/);
            var ol = line.match(/^\s*\d+\.\s+(.*)$/);
            if (ul) {
                if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; }
                out.push('<li>' + ul[1] + '</li>');
                continue;
            }
            if (ol) {
                if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; }
                out.push('<li>' + ol[1] + '</li>');
                continue;
            }
            // Línea vacía
            if (!line.trim()) {
                closeList();
                out.push('');
                continue;
            }
            // Línea normal
            closeList();
            out.push(line);
        }
        closeList();
        closeTable();

        html = out.join('\n');

        // Restaurar code blocks
        html = html.replace(/\x00CODE(\d+)\x00/g, function (_, idx) {
            return '<code>' + codeBlocks[parseInt(idx, 10)] + '</code>';
        });
        // Restaurar KPI grids
        html = html.replace(/\x00KPIBLOCK(\d+)\x00/g, function (_, idx) {
            return kpiBlocks[parseInt(idx, 10)] || '';
        });

        // Saltos de línea simples → <br>, sin tocar bloques estructurales.
        var blockTags = '(?:<\\/(?:ul|ol|li|h\\d|table|thead|tbody|tr|td|th|p)>)|(?:<(?:ul|ol|h\\d|table|thead|tbody|tr)\\b)';
        html = html.split(/\n/).join('\n');
        html = html.replace(/\n(?!\s*(?:<\/?(?:ul|ol|li|h\d|table|thead|tbody|tr|td|th|p)\b))/g, '<br>');
        // Quitar <br> sobrantes adyacentes a bloques
        html = html.replace(/<br>\s*(<\/?(?:ul|ol|h\d|table|thead|tbody|tr)\b)/g, '$1');
        html = html.replace(/(<\/(?:ul|ol|h\d|table|thead|tbody|tr)>)\s*<br>/g, '$1');

        return html;
    }

    /* Abrir widget de oportunidad desde el chat. Cerramos el chat primero
       (z-index 10400) para que la oportunidad quede VISIBLE encima sin
       competir con el overlay del asistente. El user puede reabrir el chat
       desde el logo del sidebar. */
    function openOpportunityFromChat(oppId) {
        closeAsistente();
        // Pequeño delay para que el overlay termine su transición antes de
        // abrir el siguiente (evita "flash" visual de ambos abiertos).
        setTimeout(function () {
            if (typeof window.openDetalle === 'function') {
                window.openDetalle(oppId);
            } else if (typeof window.woAbrirDetalle === 'function') {
                window.woAbrirDetalle(oppId);
            } else if (typeof window.abrirOportunidad === 'function') {
                window.abrirOportunidad(oppId);
            } else {
                window.location.href = '/app/todos/?tab=crm&open_proyecto=' + oppId;
            }
        }, 80);
    }
    window.asistenteAbrirOportunidad = openOpportunityFromChat;

    /* API pública del renderer — otros módulos (p.ej. el asistente de
       ideas) la reusan para mantener UN SOLO formatter de markdown
       (KPI cards, tablas, links, etc.). */
    window.AsistenteRender = {
        renderMarkdown: renderMarkdown,
        escapeHtml: esc,
        orbHTML: orbHTML,
    };

    /* Modal de confirmación estilizado — global, reusable desde cualquier
       parte del CRM. Reemplaza al confirm() del browser. */
    window.customConfirm = function (opts, onConfirm) {
        opts = opts || {};
        var backdrop = document.createElement('div');
        backdrop.className = 'asist-confirm-backdrop';
        backdrop.innerHTML = ''
            + '<div class="asist-confirm-modal" role="dialog" aria-modal="true">'
            +   '<div class="asist-confirm-icon">'
            +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            +       '<polyline points="3 6 5 6 21 6"/>'
            +       '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'
            +       '<path d="M10 11v6"/><path d="M14 11v6"/>'
            +       '<path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>'
            +     '</svg>'
            +   '</div>'
            +   '<h3 class="asist-confirm-title">' + esc(opts.title || '¿Confirmas?') + '</h3>'
            +   '<p class="asist-confirm-message">' + esc(opts.message || '') + '</p>'
            +   '<div class="asist-confirm-actions">'
            +     '<button type="button" class="asist-confirm-cancel">' + esc(opts.cancelText || 'Cancelar') + '</button>'
            +     '<button type="button" class="asist-confirm-ok">' + esc(opts.okText || 'Eliminar') + '</button>'
            +   '</div>'
            + '</div>';
        document.body.appendChild(backdrop);
        function close() { backdrop.remove(); document.removeEventListener('keydown', onKey); }
        function onKey(e) { if (e.key === 'Escape') close(); }
        backdrop.querySelector('.asist-confirm-cancel').addEventListener('click', close);
        backdrop.querySelector('.asist-confirm-ok').addEventListener('click', function () {
            close();
            try { onConfirm(); } catch (e) { console.error(e); }
        });
        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) close();
        });
        document.addEventListener('keydown', onKey);
        setTimeout(function () {
            var c = backdrop.querySelector('.asist-confirm-cancel');
            if (c) c.focus();
        }, 50);
    };

    /* Orb compuesto (core + 2 anillos cruzados en X). */
    function orbHTML(size) {
        size = size || 'md';
        return '<div class="asist-orb asist-orb--' + esc(size) + '" aria-hidden="true">'
            + '<span class="asist-orb-core"></span>'
            + '<span class="asist-orb-ring asist-orb-ring--horiz"></span>'
            + '<span class="asist-orb-ring asist-orb-ring--vert"></span>'
            + '</div>';
    }

    /* ─── Render ─── */
    function renderMessage(role, texto) {
        var box = document.getElementById('asistMessages');
        if (!box) return;
        var welcome = document.getElementById('asistWelcome');
        if (welcome) welcome.remove();

        var wrap = document.createElement('div');
        wrap.className = 'asist-msg asist-msg-' + (role === 'user' ? 'user' : 'bot');

        if (role !== 'user') {
            wrap.insertAdjacentHTML('beforeend', orbHTML('md'));
        }

        var bub = document.createElement('div');
        bub.className = 'asist-msg-bubble';
        if (role === 'user') {
            // Mensajes del user: solo escape, sin markdown.
            bub.textContent = texto;
        } else {
            bub.innerHTML = renderMarkdown(texto || '');
        }
        wrap.appendChild(bub);
        box.appendChild(wrap);
        scrollToBottom();
    }

    function showTyping(label) {
        hideTyping();
        var box = document.getElementById('asistMessages');
        if (!box) return;
        var wrap = document.createElement('div');
        wrap.className = 'asist-msg asist-msg-bot';
        wrap.id = 'asistTypingRow';
        var lbl = label || 'Pensando…';
        wrap.innerHTML =
            orbHTML('md')
            + '<div class="asist-msg-bubble asist-thinking">'
            + '<span class="asist-thinking-text">' + esc(lbl) + '</span>'
            + '</div>';
        box.appendChild(wrap);
        // Marcar el orb como "thinking" → animación más intensa
        var orb = wrap.querySelector('.asist-orb');
        if (orb) orb.classList.add('is-thinking');
        scrollToBottom();
    }
    function hideTyping() {
        var t = document.getElementById('asistTypingRow');
        if (t) t.remove();
    }

    function scrollToBottom() {
        var box = document.getElementById('asistMessages');
        if (box) box.scrollTop = box.scrollHeight;
    }

    /* ─── Card "Agendar seguimiento" (modo prospecto) ─────────────────
       Aparece debajo del último mensaje del bot cuando el user pidió
       "próximo paso". Calcula la fecha sugerida (+2 días naturales,
       fin de semana → lunes) y permite agendar con 1 click. */
    function _proximaFechaSeguimiento() {
        // Mismo cálculo que el backend para que la preview coincida.
        var d = new Date();
        d.setDate(d.getDate() + 2);
        var dow = d.getDay(); // 0=Dom, 1=Lun, ..., 6=Sab
        if (dow === 6) d.setDate(d.getDate() + 2);       // Sáb → Lun
        else if (dow === 0) d.setDate(d.getDate() + 1);  // Dom → Lun
        return d;
    }
    /* ISO con offset local (NO UTC). Necesario para preservar el
       reloj de pared del usuario. JavaScript .toISOString() siempre
       devuelve UTC, lo que hace que la hora cambie cuando el server
       o el render conviertan timezones. Esta función devuelve algo
       como "2026-05-22T15:17:00-07:00" que el backend parsea
       directo como datetime aware en la TZ del user. */
    function _toLocalIsoOffset(d) {
        var pad = function (n) { return String(n).padStart(2, '0'); };
        var year = d.getFullYear();
        var month = pad(d.getMonth() + 1);
        var day = pad(d.getDate());
        var hh = pad(d.getHours());
        var mm = pad(d.getMinutes());
        var ss = pad(d.getSeconds());
        var off = -d.getTimezoneOffset(); // minutos desde UTC
        var sign = off >= 0 ? '+' : '-';
        var absOff = Math.abs(off);
        var offH = pad(Math.floor(absOff / 60));
        var offM = pad(absOff % 60);
        return year + '-' + month + '-' + day + 'T'
             + hh + ':' + mm + ':' + ss + sign + offH + ':' + offM;
    }
    function _fmtFechaSeguimiento(d) {
        var meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                     'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        var diasSemana = ['domingo', 'lunes', 'martes', 'miércoles',
                          'jueves', 'viernes', 'sábado'];
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        return diasSemana[d.getDay()] + ' '
            + d.getDate() + ' ' + meses[d.getMonth()] + ' '
            + hh + ':' + mm;
    }
    /* Extrae la acción concreta del response del AI (patrón "Próximo
       paso: X" o variantes con bold). Si no encuentra patrón, devuelve
       la primera oración. Mantiene la descripcion de la actividad
       corta y limpia. */
    function _extraerProximoPasoTexto(txt) {
        if (!txt) return '';
        // Quitamos markdown para que los patterns funcionen sobre el
        // texto plano y para el fallback.
        var plain = txt.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/`+/g, '');
        var patterns = [
            /Pr[óo]ximo\s+paso\s+recomendado\s*:\s*([^\n]+(?:\.\s*[A-Z][^\n.]+)?)\.?/i,
            /Pr[óo]ximo\s+paso\s*(?:\(UNO\s+solo\))?\s*:\s*([^\n]+)/i,
            /El\s+pr[óo]ximo\s+paso\s*:\s*([^\n]+)/i,
        ];
        for (var i = 0; i < patterns.length; i++) {
            var m = plain.match(patterns[i]);
            if (m) {
                var s = m[1].trim();
                // Cortar antes del siguiente bloque tipo "Por qué...", "Alternativa B..."
                s = s.split(/\s*(?:Por\s+qu[eé]\s|Alternativa\s|Por\s+qué\s)/i)[0].trim();
                if (s.length > 280) s = s.slice(0, 277) + '...';
                return s.replace(/[.,;:\s]+$/, '');
            }
        }
        // Fallback: primera oración
        var firstSent = plain.match(/^([^.\n]{20,280}\.)/);
        if (firstSent) return firstSent[1].trim();
        return plain.slice(0, 200).trim();
    }

    function renderAgendarSeguimientoCard(descripcionFull) {
        var box = document.getElementById('asistMessages');
        if (!box) return;
        // Extraemos SOLO la acción (no el contexto completo).
        var descripcion = _extraerProximoPasoTexto(descripcionFull);
        var fecha = _proximaFechaSeguimiento();
        var fechaTxt = _fmtFechaSeguimiento(fecha);
        var card = document.createElement('div');
        card.className = 'asist-agendar-card';
        card.innerHTML = ''
            + '<div class="asist-agendar-icon">'
            +   '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
            + '</div>'
            + '<div class="asist-agendar-body">'
            +   '<div class="asist-agendar-title">¿Agendamos este seguimiento?</div>'
            +   '<div class="asist-agendar-fecha">' + esc(fechaTxt) + '</div>'
            + '</div>'
            + '<div class="asist-agendar-actions">'
            +   '<button type="button" class="asist-agendar-btn asist-agendar-skip">Ahora no</button>'
            +   '<button type="button" class="asist-agendar-btn asist-agendar-ok">Agendar</button>'
            + '</div>';
        box.appendChild(card);
        scrollToBottom();

        var skip = card.querySelector('.asist-agendar-skip');
        var ok = card.querySelector('.asist-agendar-ok');
        skip.addEventListener('click', function () {
            card.remove();
        });
        ok.addEventListener('click', function () {
            // Endpoint según el modo embebido activo.
            var endpoint = '';
            if (isProspectoMode() && STATE.prospectoCtx) {
                endpoint = '/app/api/prospectos/' + STATE.prospectoCtx.id + '/asistente/actividad-rapida/';
            } else if (isOportunidadMode() && STATE.oportunidadCtx) {
                endpoint = '/app/api/oportunidades/' + STATE.oportunidadCtx.id + '/asistente/actividad-rapida/';
            }
            if (!endpoint) return;
            ok.disabled = true;
            skip.disabled = true;
            ok.textContent = 'Agendando…';
            api(endpoint, {
                method: 'POST',
                body: JSON.stringify({
                    descripcion: descripcion,
                    tipo: 'tarea',
                    // ISO local con offset — preserva el reloj del user.
                    fecha_iso: _toLocalIsoOffset(fecha),
                }),
            }).then(function (res) {
                if (!res.ok || !res.data.ok) {
                    if (typeof window.showFlash === 'function') {
                        window.showFlash((res.data && res.data.error) || 'No se pudo agendar', 'error');
                    }
                    ok.disabled = false;
                    skip.disabled = false;
                    ok.textContent = 'Agendar';
                    return;
                }
                // Reemplazamos la card por una confirmación.
                var act = res.data.actividad || {};
                // El payload de prospecto trae fecha_programada; el de
                // oportunidad trae fecha_inicio. Aceptamos ambos.
                var fechaRaw = act.fecha_programada || act.fecha_inicio || null;
                var fechaConfirm = fechaRaw
                    ? _fmtFechaSeguimiento(new Date(fechaRaw))
                    : fechaTxt;
                card.innerHTML = ''
                    + '<div class="asist-agendar-icon asist-agendar-icon--ok">'
                    +   '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
                    + '</div>'
                    + '<div class="asist-agendar-body">'
                    +   '<div class="asist-agendar-title">Seguimiento agendado</div>'
                    +   '<div class="asist-agendar-fecha">' + esc(fechaConfirm) + '</div>'
                    + '</div>';
                if (typeof window.showFlash === 'function') {
                    window.showFlash('Seguimiento agendado para ' + fechaConfirm);
                }
                // Refrescamos el detalle (prospecto u oportunidad) para
                // que la actividad aparezca en el bloque "Actividad".
                try {
                    if (isProspectoMode() && typeof window.refreshProspectoDetalle === 'function') {
                        window.refreshProspectoDetalle(STATE.prospectoCtx.id);
                    } else if (isOportunidadMode() && typeof window.refreshOportunidadDetalle === 'function') {
                        window.refreshOportunidadDetalle(STATE.oportunidadCtx.id);
                    }
                } catch (e) { /* silent */ }
            });
        });
    }

    /* ─── Card "Correo preparado" (modo oportunidad) ────────────────
       Aparece debajo del mensaje del bot cuando el AI usó la tool
       preparar_correo_seguimiento. Muestra el asunto, una preview del
       cuerpo, y un botón para abrir el composer del módulo Mail con
       todo pre-llenado. NO envía nada — siempre revisión humana. */
    function renderCorreoPreparadoCard(correo) {
        var box = document.getElementById('asistMessages');
        if (!box) return;
        var card = document.createElement('div');
        card.className = 'asist-correo-card';
        var asunto = correo.asunto || '(sin asunto)';
        var preview = (correo.cuerpo || '').split('\n').filter(function (l) { return l.trim(); }).slice(0, 3).join(' · ');
        if (preview.length > 180) preview = preview.slice(0, 177) + '...';
        var dest = correo.destinatario_email || '';
        card.innerHTML = ''
            + '<div class="asist-correo-icon">'
            +   '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>'
            + '</div>'
            + '<div class="asist-correo-body">'
            +   '<div class="asist-correo-title">Correo listo para revisar</div>'
            +   '<div class="asist-correo-asunto">' + esc(asunto) + '</div>'
            +   (dest ? '<div class="asist-correo-dest">Para: ' + esc(dest) + '</div>' : '')
            +   '<div class="asist-correo-preview">' + esc(preview) + '</div>'
            + '</div>'
            + '<div class="asist-correo-actions">'
            +   '<button type="button" class="asist-correo-btn asist-correo-skip">Cancelar</button>'
            +   '<button type="button" class="asist-correo-btn asist-correo-open">Abrir correo</button>'
            + '</div>';
        box.appendChild(card);
        scrollToBottom();

        var skip = card.querySelector('.asist-correo-skip');
        var ok = card.querySelector('.asist-correo-open');
        skip.addEventListener('click', function () { card.remove(); });
        ok.addEventListener('click', function () {
            if (typeof window.woAbrirComposerConPrellenado === 'function') {
                window.woAbrirComposerConPrellenado(correo);
            } else if (typeof window.woConvAbrirCorreoComposer === 'function') {
                // Fallback al composer básico — solo prefilea asunto.
                window.woConvAbrirCorreoComposer();
            }
            // Tras abrir, transformamos la card en confirmación silenciosa.
            card.innerHTML = ''
                + '<div class="asist-correo-icon asist-correo-icon--ok">'
                +   '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
                + '</div>'
                + '<div class="asist-correo-body">'
                +   '<div class="asist-correo-title">Composer abierto</div>'
                +   '<div class="asist-correo-preview">Revisa el correo y dale Enviar cuando estés listo.</div>'
                + '</div>';
        });
    }

    /* Frases que se rotan en el indicador "pensando" para que no sea monótono */
    var THINKING_PHRASES = [
        'Consultando datos…',
        'Analizando información…',
        'Procesando tu pregunta…',
        'Buscando en el CRM…',
        'Razonando…',
    ];
    function pickThinkingPhrase() {
        return THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
    }

    /* ─── Enviar mensaje ─── */
    function sendMessage(texto) {
        texto = (texto || '').trim();
        if (!texto || STATE.sending) return;
        STATE.sending = true;
        // Si el user pidió el "próximo paso" en modo prospecto,
        // levantamos el flag para que la próxima respuesta del AI
        // se acompañe del botón "Agendar seguimiento".
        // El flag se levanta para mostrar la card "Agendar" cuando el
        // user pide el próximo paso en prospecto u oportunidad. Match
        // por varias frases comunes que dispara esa intención.
        var pidiendoProxPaso = (texto === PROXIMO_PASO_PROMPT)
            || /pr[óo]ximo\s+paso/i.test(texto)
            || /(?:la|una)\s+(?:sola\s+)?acci[oó]n\s+(?:m[áa]s\s+)?urgente/i.test(texto)
            || /lista\s+para\s+(?:que\s+)?(?:la\s+)?agend/i.test(texto);
        STATE.expectingProximoPaso = pidiendoProxPaso
            && (isProspectoMode() || isOportunidadMode());

        renderMessage('user', texto);
        var inp = document.getElementById('asistInput');
        if (inp) { inp.value = ''; inp.style.height = 'auto'; }
        document.getElementById('asistSendBtn').disabled = true;
        showTyping(pickThinkingPhrase());

        // Cada 4s rotamos la frase para sentir progreso si tarda.
        var phraseTimer = setInterval(function () {
            var box = document.querySelector('#asistTypingRow .asist-thinking-text');
            if (box) box.textContent = pickThinkingPhrase();
        }, 4000);

        api(urlSend(), {
            method: 'POST',
            body: JSON.stringify({texto: texto}),
        }).then(function (res) {
            hideTyping();
            if (!res.ok || !res.data.ok) {
                renderMessage('assistant', '⚠️ ' + (res.data.error || 'Error de conexión. Intenta de nuevo.'));
                return;
            }
            // Modo general devuelve {respuesta:"..."}, modo idea devuelve
            // {mensaje:{contenido:"..."}}.
            var respTexto = '';
            if (res.data.respuesta) respTexto = res.data.respuesta;
            else if (res.data.mensaje && res.data.mensaje.contenido) respTexto = res.data.mensaje.contenido;
            // Auto-save: cuando el backend de un modo embebido llega al
            // tope de turnos guarda un resumen + reinicia el hilo y nos
            // avisa con auto_saved_resumen. Refrescamos el detalle
            // (idea o prospecto) para que el comentario aparezca ya en
            // la bitácora.
            if (res.data.auto_saved_resumen && isEmbedMode()) {
                var dest = isOportunidadMode() ? 'la conversación del deal' : 'la bitácora';
                if (typeof window.showFlash === 'function') {
                    window.showFlash('Resumen guardado en ' + dest + ' · chat reiniciado');
                }
                try {
                    if (isIdeaMode() && typeof window.refreshIdeaDetalle === 'function') {
                        window.refreshIdeaDetalle(STATE.ideaCtx.id);
                    } else if (isProspectoMode() && typeof window.refreshProspectoDetalle === 'function') {
                        window.refreshProspectoDetalle(STATE.prospectoCtx.id);
                    } else if (isOportunidadMode() && typeof window.refreshOportunidadDetalle === 'function') {
                        window.refreshOportunidadDetalle(STATE.oportunidadCtx.id);
                    }
                } catch (e) { /* silent */ }
            }
            var finalTxt = respTexto || '(sin respuesta)';
            STATE.lastAssistantText = finalTxt;
            renderMessage('assistant', finalTxt);
            // Si la AI creó la actividad ELLA MISMA via function calling
            // (caso de instrucción directa "agéndame X"), avisamos al
            // user con un flash y refrescamos el detalle. No mostramos
            // la card de Agendar — ya se ejecutó.
            if (res.data.actividad_creada && (isProspectoMode() || isOportunidadMode())) {
                if (typeof window.showFlash === 'function') {
                    window.showFlash('Actividad agendada por el asistente');
                }
                try {
                    if (isProspectoMode() && typeof window.refreshProspectoDetalle === 'function') {
                        window.refreshProspectoDetalle(STATE.prospectoCtx.id);
                    } else if (isOportunidadMode() && typeof window.refreshOportunidadDetalle === 'function') {
                        window.refreshOportunidadDetalle(STATE.oportunidadCtx.id);
                    }
                } catch (e) { /* silent */ }
                STATE.expectingProximoPaso = false;
            } else if (STATE.expectingProximoPaso && (isProspectoMode() || isOportunidadMode()) && respTexto) {
                // Card "Agendar seguimiento" debajo del último mensaje
                // del bot — solo cuando venimos de pedir próximo paso.
                renderAgendarSeguimientoCard(finalTxt);
            }
            STATE.expectingProximoPaso = false;
            // Card "Abrir correo" cuando el AI preparó un correo via
            // la tool preparar_correo_seguimiento (modo oportunidad).
            if (res.data.correo_preparado && isOportunidadMode()) {
                renderCorreoPreparadoCard(res.data.correo_preparado);
            }
        }).catch(function (err) {
            hideTyping();
            renderMessage('assistant', '⚠️ Error de red: ' + err);
        }).finally(function () {
            clearInterval(phraseTimer);
            STATE.sending = false;
            document.getElementById('asistSendBtn').disabled = false;
            var inp2 = document.getElementById('asistInput');
            if (inp2) inp2.focus();
        });
    }

    /* ─── Wire up ─── */
    function wireEvents() {
        var sendBtn = document.getElementById('asistSendBtn');
        var inp = document.getElementById('asistInput');
        var closeBtn = document.getElementById('asistCloseBtn');
        var clearBtn = document.getElementById('asistClearBtn');
        var overlay = document.getElementById('widgetAsistente');

        if (sendBtn) sendBtn.addEventListener('click', function () {
            sendMessage(inp ? inp.value : '');
        });
        if (inp) {
            // Auto-grow del textarea
            inp.addEventListener('input', function () {
                inp.style.height = 'auto';
                inp.style.height = Math.min(inp.scrollHeight, 140) + 'px';
            });
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(inp.value);
                }
            });
        }
        if (closeBtn) closeBtn.addEventListener('click', closeAsistente);
        if (clearBtn) clearBtn.addEventListener('click', newChat);
        var newChatBtn = document.getElementById('asistNewChatBtn');
        if (newChatBtn) newChatBtn.addEventListener('click', newChat);
        var saveResBtn = document.getElementById('asistSaveResumenBtn');
        if (saveResBtn) saveResBtn.addEventListener('click', saveResumen);
        if (overlay) overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeAsistente();
        });

        // Sugerencias del welcome y clicks en oportunidades dentro de respuestas
        document.addEventListener('click', function (e) {
            var sug = e.target.closest('.asist-sugg-card, .asist-suggestion');
            if (sug) {
                var prompt = sug.getAttribute('data-prompt') || sug.textContent;
                sendMessage(prompt);
                return;
            }
            // Link a oportunidad dentro de una respuesta del bot: abre el widget
            var oppLink = e.target.closest('a[data-asist-opp]');
            if (oppLink) {
                e.preventDefault();
                var oppId = parseInt(oppLink.getAttribute('data-asist-opp'), 10);
                if (oppId) openOpportunityFromChat(oppId);
                return;
            }
            var opener = e.target.closest('[data-asist-open]');
            if (opener) {
                e.preventDefault();
                openAsistente();
            }
        });

        // Escape cierra
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var ov = document.getElementById('widgetAsistente');
                if (ov && ov.style.display !== 'none') closeAsistente();
            }
        });
    }

    function boot() {
        if (!document.getElementById('widgetAsistente')) return;
        if (window._asistBooted) return;
        window._asistBooted = true;
        // Capturar el nombre que Django pintó en el welcome inicial,
        // para reusarlo cuando reconstruimos el welcome tras un clear.
        var greetEl = document.getElementById('asistGreetName');
        if (greetEl) _greetingName = (greetEl.textContent || '').trim();
        wireEvents();
    }
    document.addEventListener('DOMContentLoaded', boot);
    if (document.readyState !== 'loading') boot();
})();
