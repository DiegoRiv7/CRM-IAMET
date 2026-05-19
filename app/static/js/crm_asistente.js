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
            {prompt: '¿Qué actividades tengo pendientes?', label: 'Mi agenda', sub: 'Lo que tengo que atender'},
            {prompt: '¿Cuál es mi oportunidad que más promete este mes?', label: 'Mi más prometedora', sub: 'Dónde poner el foco'},
            {prompt: '¿Qué clientes tengo asignados?', label: 'Mi cartera', sub: 'Clientes a mi nombre'},
            {prompt: '¿Cómo voy este mes?', label: 'Mi mes', sub: 'Cómo voy con mis números'},
        ];
    }

    function applyContextualSuggestions() {
        var container = document.querySelector('#asistWelcome .asist-suggestions');
        if (!container) return;
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
            applyContextualSuggestions();
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
        html = html.replace(/^[ \t]*:::\s*kpis\s*\n([\s\S]*?)^[ \t]*:::\s*$/gm, function (_, content) {
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
