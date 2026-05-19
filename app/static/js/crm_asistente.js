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

    function clearHistory() {
        if (!confirm('¿Limpiar toda la conversación? No se puede deshacer.')) return;
        api('/app/api/asistente/conversacion/eliminar/', {method: 'DELETE'}).then(function (res) {
            if (!res.ok) return;
            var box = document.getElementById('asistMessages');
            if (!box) return;
            box.innerHTML = '';
            // Re-insertar welcome
            var welcome = document.createElement('div');
            welcome.id = 'asistWelcome';
            welcome.className = 'asist-welcome';
            welcome.innerHTML = ''
                + '<div class="asist-welcome-icon">'
                + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
                + '<path d="M5 9.3V6.5a3.5 3.5 0 0 1 7 0v10"/>'
                + '<path d="M19 9.3V6.5a3.5 3.5 0 0 0 -7 0"/>'
                + '<path d="M6.5 16a3.5 3.5 0 0 1 0-7h.5"/>'
                + '<path d="M17.5 16a3.5 3.5 0 0 0 0-7h-.5"/>'
                + '<path d="M8.5 13a3.5 3.5 0 0 1 3.5 3.5V19a3 3 0 0 1-6 0"/>'
                + '<path d="M15.5 13a3.5 3.5 0 0 0-3.5 3.5V19a3 3 0 0 0 6 0"/>'
                + '</svg>'
                + '</div>'
                + '<div class="asist-welcome-title">¿En qué te ayudo?</div>'
                + '<div class="asist-welcome-sub">Pregúntame por tus clientes, oportunidades, equipo o cómo va el mes.</div>';
            box.appendChild(welcome);
        });
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
            var av = document.createElement('div');
            av.className = 'asist-msg-bot-avatar';
            av.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9.3V6.5a3.5 3.5 0 0 1 7 0v10"/><path d="M19 9.3V6.5a3.5 3.5 0 0 0 -7 0"/><path d="M6.5 16a3.5 3.5 0 0 1 0-7h.5"/><path d="M17.5 16a3.5 3.5 0 0 0 0-7h-.5"/><path d="M8.5 13a3.5 3.5 0 0 1 3.5 3.5V19a3 3 0 0 1-6 0"/><path d="M15.5 13a3.5 3.5 0 0 0-3.5 3.5V19a3 3 0 0 0 6 0"/></svg>';
            wrap.appendChild(av);
        }

        var bub = document.createElement('div');
        bub.className = 'asist-msg-bubble';
        bub.textContent = texto;
        wrap.appendChild(bub);
        box.appendChild(wrap);
        scrollToBottom();
    }

    function showTyping() {
        hideTyping();
        var box = document.getElementById('asistMessages');
        if (!box) return;
        var wrap = document.createElement('div');
        wrap.className = 'asist-msg asist-msg-bot';
        wrap.id = 'asistTypingRow';
        wrap.innerHTML = ''
            + '<div class="asist-msg-bot-avatar">'
            + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9.3V6.5a3.5 3.5 0 0 1 7 0v10"/><path d="M19 9.3V6.5a3.5 3.5 0 0 0 -7 0"/><path d="M6.5 16a3.5 3.5 0 0 1 0-7h.5"/><path d="M17.5 16a3.5 3.5 0 0 0 0-7h-.5"/><path d="M8.5 13a3.5 3.5 0 0 1 3.5 3.5V19a3 3 0 0 1-6 0"/><path d="M15.5 13a3.5 3.5 0 0 0-3.5 3.5V19a3 3 0 0 0 6 0"/></svg>'
            + '</div>'
            + '<div class="asist-msg-bubble asist-typing">'
            + '<span class="asist-typing-dot"></span><span class="asist-typing-dot"></span><span class="asist-typing-dot"></span>'
            + '</div>';
        box.appendChild(wrap);
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

    /* ─── Enviar mensaje ─── */
    function sendMessage(texto) {
        texto = (texto || '').trim();
        if (!texto || STATE.sending) return;
        STATE.sending = true;

        renderMessage('user', texto);
        var inp = document.getElementById('asistInput');
        if (inp) { inp.value = ''; inp.style.height = 'auto'; }
        document.getElementById('asistSendBtn').disabled = true;
        showTyping();

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
        if (clearBtn) clearBtn.addEventListener('click', clearHistory);
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
        wireEvents();
    }
    document.addEventListener('DOMContentLoaded', boot);
    if (document.readyState !== 'loading') boot();
})();
