/*
 * crm_asistente_ideas.js
 *
 * Cliente del asistente AI atado a una idea (hilo por idea, separado del
 * consultor general). Expone:
 *   - window.IdeaAsistente.abrir(idea)
 *   - window.IdeaAsistente.cerrar()
 *
 * Reutiliza window.AsistenteRender.renderMarkdown del módulo principal
 * para que TODA la lógica de formato (KPIs, tablas, links opp:ID,
 * headings) viva en un solo lugar.
 */
(function () {
    'use strict';
    if (window._asistenteIdeasLoaded) return;
    window._asistenteIdeasLoaded = true;

    var STATE = {
        idea: null,           // {id, titulo, ...}
        loading: false,       // hay una llamada en curso al LLM
        historyLoaded: false, // ya pegamos al endpoint de historial
    };

    function $(id) { return document.getElementById(id); }

    function esc(s) {
        if (window.AsistenteRender && window.AsistenteRender.escapeHtml) {
            return window.AsistenteRender.escapeHtml(s);
        }
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderMarkdown(text) {
        if (window.AsistenteRender && window.AsistenteRender.renderMarkdown) {
            return window.AsistenteRender.renderMarkdown(text);
        }
        // Fallback ultra-básico si el módulo principal no cargó.
        return esc(text).replace(/\n/g, '<br>');
    }

    function csrf() {
        var el = document.querySelector('[name=csrfmiddlewaretoken]');
        return el ? el.value : '';
    }

    function api(url, options) {
        options = options || {};
        options.headers = Object.assign(
            {'Content-Type': 'application/json', 'X-CSRFToken': csrf()},
            options.headers || {}
        );
        options.credentials = 'same-origin';
        return fetch(url, options).then(function (r) {
            return r.json()
                .then(function (d) { return {ok: r.ok, data: d}; })
                .catch(function () { return {ok: r.ok, data: {error: 'Respuesta inválida'}}; });
        });
    }

    function showFlash(msg, type) {
        if (typeof window.showFlash === 'function') {
            window.showFlash(msg, type || 'info');
            return;
        }
        // Fallback: alert simple si no existe showFlash global.
        try { console.log('[idea-ai]', msg); } catch (e) {}
        if (type === 'error') alert(msg);
    }

    /* ─── Render de mensajes ─── */

    function orbSnippet() {
        // Orb estático (sin animaciones) para las burbujas del asistente.
        return ''
            + '<span class="asist-orb asist-orb--static asist-orb--md" aria-hidden="true">'
            +   '<span class="asist-orb-core"></span>'
            +   '<span class="asist-orb-ring asist-orb-ring--horiz"></span>'
            +   '<span class="asist-orb-ring asist-orb-ring--vert"></span>'
            + '</span>';
    }

    function appendMessage(role, contenido) {
        var box = $('asistideaMessages');
        if (!box) return;
        // Quitar welcome la primera vez.
        var welcome = $('asistideaWelcome');
        if (welcome) welcome.remove();

        var wrap = document.createElement('div');
        wrap.className = 'asistidea-msg asistidea-msg-' + (role === 'user' ? 'user' : 'bot');
        if (role !== 'user') {
            wrap.insertAdjacentHTML('beforeend', orbSnippet());
        }
        var bub = document.createElement('div');
        bub.className = 'asistidea-bubble';
        bub.innerHTML = renderMarkdown(contenido);
        wrap.appendChild(bub);
        box.appendChild(wrap);
        box.scrollTop = box.scrollHeight;
        return wrap;
    }

    function appendTypingIndicator() {
        var box = $('asistideaMessages');
        if (!box) return null;
        var wrap = document.createElement('div');
        wrap.className = 'asistidea-msg asistidea-msg-bot';
        wrap.id = 'asistideaTyping';
        wrap.innerHTML = orbSnippet()
            + '<div class="asistidea-bubble"><span class="asistidea-typing"><span></span><span></span><span></span></span></div>';
        box.appendChild(wrap);
        box.scrollTop = box.scrollHeight;
        return wrap;
    }

    function removeTypingIndicator() {
        var t = $('asistideaTyping');
        if (t) t.remove();
    }

    function clearMessagesArea() {
        var box = $('asistideaMessages');
        if (!box) return;
        // Reset al welcome.
        box.innerHTML = ''
            + '<div class="asistidea-welcome" id="asistideaWelcome">'
            +   '<span class="asist-orb asist-orb--static asist-orb--lg" aria-hidden="true">'
            +     '<span class="asist-orb-core"></span>'
            +     '<span class="asist-orb-ring asist-orb-ring--horiz"></span>'
            +     '<span class="asist-orb-ring asist-orb-ring--vert"></span>'
            +   '</span>'
            +   '<h3 class="asistidea-welcome-title">Vamos a aterrizar tu idea</h3>'
            +   '<p class="asistidea-welcome-sub">Cuéntame qué tienes en mente o pídeme una opinión rápida sobre lo que ya escribiste.</p>'
            +   '<div class="asistidea-suggestions">'
            +     '<button type="button" class="asistidea-sugg" data-prompt="Opinión de mi idea">'
            +       '<span class="asistidea-sugg-icon">'
            +         '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'
            +       '</span>'
            +       '<span class="asistidea-sugg-text"><strong>Opinión de mi idea</strong><em>Evaluación corta, sin alucinar</em></span>'
            +     '</button>'
            +   '</div>'
            + '</div>';
        wireSuggestionClicks();
    }

    function wireSuggestionClicks() {
        document.querySelectorAll('#asistideaWelcome .asistidea-sugg').forEach(function (b) {
            b.addEventListener('click', function () {
                var p = b.getAttribute('data-prompt') || '';
                if (p) sendMessage(p);
            });
        });
    }

    /* ─── Cargar historial ─── */

    function loadHistory() {
        if (!STATE.idea) return Promise.resolve();
        STATE.historyLoaded = false;
        return api('/app/api/ideas/' + STATE.idea.id + '/asistente/mensajes/').then(function (res) {
            if (!res.ok || !res.data.ok) return;
            var msgs = res.data.mensajes || [];
            if (!msgs.length) return; // welcome se queda
            // Hay historial → quitar welcome y pintar todo.
            var welcome = $('asistideaWelcome');
            if (welcome) welcome.remove();
            msgs.forEach(function (m) { appendMessage(m.role, m.contenido); });
            STATE.historyLoaded = true;
        });
    }

    /* ─── Enviar mensaje ─── */

    function setSending(b) {
        STATE.loading = b;
        var send = $('asistideaSendBtn');
        var inp = $('asistideaInput');
        if (send) send.disabled = b;
        if (inp) inp.disabled = b;
    }

    function sendMessage(text) {
        if (!STATE.idea) return;
        text = (text || '').trim();
        if (!text || STATE.loading) return;

        appendMessage('user', text);
        var inp = $('asistideaInput');
        if (inp) { inp.value = ''; inp.style.height = ''; }

        setSending(true);
        appendTypingIndicator();
        api('/app/api/ideas/' + STATE.idea.id + '/asistente/mensaje/', {
            method: 'POST',
            body: JSON.stringify({texto: text}),
        }).then(function (res) {
            removeTypingIndicator();
            if (!res.ok || !res.data.ok) {
                appendMessage('assistant', (res.data && res.data.error) || 'No se pudo procesar el mensaje.');
                return;
            }
            var m = res.data.mensaje || {};
            appendMessage('assistant', m.contenido || '(sin respuesta)');
        }).catch(function () {
            removeTypingIndicator();
            appendMessage('assistant', 'Error de red al consultar el asistente.');
        }).finally(function () {
            setSending(false);
            var inp2 = $('asistideaInput');
            if (inp2) inp2.focus();
        });
    }

    /* ─── Guardar resumen como comentario en la idea ─── */

    function saveResumen() {
        if (!STATE.idea || STATE.loading) return;
        setSending(true);
        api('/app/api/ideas/' + STATE.idea.id + '/asistente/resumen/', {
            method: 'POST',
            body: '{}',
        }).then(function (res) {
            if (!res.ok || !res.data.ok) {
                showFlash((res.data && res.data.error) || 'No se pudo guardar el resumen', 'error');
                return;
            }
            showFlash('Resumen agregado a la bitácora');
            // Si la idea está abierta en el widget detalle, refrescamos
            // sus comentarios para que el resumen aparezca al instante.
            try {
                if (typeof window.refreshIdeaDetalle === 'function') {
                    window.refreshIdeaDetalle(STATE.idea.id);
                }
            } catch (e) { /* silent */ }
        }).catch(function () {
            showFlash('Error de red al guardar el resumen', 'error');
        }).finally(function () { setSending(false); });
    }

    /* ─── Nuevo chat (reset del hilo) ─── */

    function nuevoChat() {
        if (!STATE.idea || STATE.loading) return;
        if (!confirm('¿Borrar la conversación actual con la AI sobre esta idea? El resumen guardado en bitácora no se borra.')) return;
        setSending(true);
        api('/app/api/ideas/' + STATE.idea.id + '/asistente/reset/', {
            method: 'POST', body: '{}',
        }).then(function (res) {
            if (!res.ok || !res.data.ok) {
                showFlash((res.data && res.data.error) || 'No se pudo resetear', 'error');
                return;
            }
            clearMessagesArea();
        }).finally(function () { setSending(false); });
    }

    /* ─── Apertura / cierre ─── */

    function abrir(idea) {
        if (!idea || !idea.id) {
            showFlash('Idea inválida', 'error');
            return;
        }
        STATE.idea = idea;
        var overlay = $('widgetAsistenteIdea');
        if (!overlay) return;
        var tituloEl = $('asistideaIdeaTitulo');
        if (tituloEl) tituloEl.textContent = idea.titulo || 'Idea sin título';
        clearMessagesArea();
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        // Cargar historial (puede traer 0 mensajes → welcome se queda).
        loadHistory().finally(function () {
            var inp = $('asistideaInput');
            if (inp) { inp.focus(); }
        });
    }

    function cerrar() {
        var overlay = $('widgetAsistenteIdea');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
        STATE.idea = null;
    }

    /* ─── Wire events ─── */

    function wireEvents() {
        var overlay = $('widgetAsistenteIdea');
        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) cerrar();
            });
        }
        var closeBtn = $('asistideaCloseBtn');
        if (closeBtn) closeBtn.addEventListener('click', cerrar);

        var sendBtn = $('asistideaSendBtn');
        if (sendBtn) sendBtn.addEventListener('click', function () {
            var inp = $('asistideaInput');
            sendMessage(inp ? inp.value : '');
        });

        var inp = $('asistideaInput');
        if (inp) {
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(inp.value);
                }
            });
            inp.addEventListener('input', function () {
                inp.style.height = 'auto';
                inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
            });
        }

        var saveBtn = $('asistideaSaveResumen');
        if (saveBtn) saveBtn.addEventListener('click', saveResumen);

        var nuevoBtn = $('asistideaNuevoChat');
        if (nuevoBtn) nuevoBtn.addEventListener('click', nuevoChat);

        wireSuggestionClicks();

        // Esc para cerrar.
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var ov = $('widgetAsistenteIdea');
                if (ov && ov.style.display !== 'none') cerrar();
            }
        });
    }

    function boot() {
        if (window._asistIdeasBooted) return;
        window._asistIdeasBooted = true;
        wireEvents();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.IdeaAsistente = { abrir: abrir, cerrar: cerrar };
})();
