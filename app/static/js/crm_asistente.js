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
    };

    /* ─── Open / close ─── */
    function openAsistente() {
        var ov = document.getElementById('widgetAsistente');
        if (!ov) return;
        ov.style.display = 'flex';
        ov.classList.add('active');
        document.body.style.overflow = 'hidden';
        ensureConfig();
        ensureHistory();
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

    /* ─── Config (nombre + logo) ─── */
    function ensureConfig() {
        if (STATE.configLoaded) return;
        STATE.configLoaded = true;
        api('/app/api/asistente/config/').then(function (res) {
            if (!res.ok || !res.data.ok) return;
            STATE.config = res.data;
            // Aplicar al header
            var nameEl = document.getElementById('asistName');
            if (nameEl && res.data.nombre) nameEl.textContent = res.data.nombre;
            if (res.data.logo_url) {
                var av = document.getElementById('asistAvatar');
                if (av) av.innerHTML = '<img src="' + esc(res.data.logo_url) + '" alt="logo">';
            }
        });
    }

    /* ─── Historial ─── */
    function ensureHistory() {
        if (STATE.historyLoaded) return;
        STATE.historyLoaded = true;
        api('/app/api/asistente/conversacion/').then(function (res) {
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
        if (!silent && !confirm('¿Iniciar un nuevo chat? Se perderá la conversación actual.')) return;
        api('/app/api/asistente/conversacion/eliminar/', {method: 'DELETE'}).then(function (res) {
            if (!res.ok) return;
            var box = document.getElementById('asistMessages');
            if (!box) return;
            box.innerHTML = '';
            box.appendChild(buildWelcomeNode());
        });
    }

    /* Markdown muy básico: **bold**, *italic*, `code`, líneas con "- " → <ul><li>.
       Sin librerías externas. Sanitizo escape ANTES de inyectar HTML. */
    function renderMarkdown(text) {
        var html = esc(text);
        // Negritas y cursivas
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Listas: agrupar líneas consecutivas que empiezan con "- " o "• ".
        var lines = html.split('\n');
        var out = [];
        var inList = false;
        lines.forEach(function (line) {
            var m = line.match(/^\s*(?:-|•|•)\s+(.*)$/);
            if (m) {
                if (!inList) { out.push('<ul>'); inList = true; }
                out.push('<li>' + m[1] + '</li>');
            } else {
                if (inList) { out.push('</ul>'); inList = false; }
                out.push(line);
            }
        });
        if (inList) out.push('</ul>');
        html = out.join('\n');
        // Saltos de línea simples → <br>, pero no dentro de <ul>
        html = html.split(/(<ul>[\s\S]*?<\/ul>)/g).map(function (chunk) {
            if (chunk.startsWith('<ul>')) return chunk;
            return chunk.replace(/\n/g, '<br>');
        }).join('');
        return html;
    }

    /* Orb compuesto (core + 3 anillos) — mismo markup que el template inicial. */
    function orbHTML(size) {
        size = size || 'md';
        return '<div class="asist-orb asist-orb--' + esc(size) + '" aria-hidden="true">'
            + '<span class="asist-orb-core"></span>'
            + '<span class="asist-orb-ring asist-orb-ring--1"></span>'
            + '<span class="asist-orb-ring asist-orb-ring--2"></span>'
            + '<span class="asist-orb-ring asist-orb-ring--3"></span>'
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

        api('/app/api/asistente/mensaje/', {
            method: 'POST',
            body: JSON.stringify({texto: texto}),
        }).then(function (res) {
            hideTyping();
            if (!res.ok || !res.data.ok) {
                renderMessage('assistant', '⚠️ ' + (res.data.error || 'Error de conexión. Intenta de nuevo.'));
                return;
            }
            renderMessage('assistant', res.data.respuesta || '(sin respuesta)');
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
        if (overlay) overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeAsistente();
        });

        // Sugerencias del welcome
        document.addEventListener('click', function (e) {
            var sug = e.target.closest('.asist-suggestion');
            if (sug) {
                var prompt = sug.getAttribute('data-prompt') || sug.textContent;
                sendMessage(prompt);
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
