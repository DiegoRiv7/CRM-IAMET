// ═══════════════════════════════════════════════
// PART 1: RESPONSIVE UTILITIES
// ═══════════════════════════════════════════════
window.ResponsiveUtils = {
    isMobile: () => window.innerWidth <= 768,
    isTablet: () => window.innerWidth > 768 && window.innerWidth <= 1024,
    isDesktop: () => window.innerWidth > 1024,

    updateBodyClasses: () => {
        const body = document.body;
        body.classList.remove('is-mobile', 'is-tablet', 'is-desktop');

        if (window.ResponsiveUtils.isMobile()) body.classList.add('is-mobile');
        else if (window.ResponsiveUtils.isTablet()) body.classList.add('is-tablet');
        else if (window.ResponsiveUtils.isDesktop()) body.classList.add('is-desktop');
    }
};

window.ResponsiveUtils.updateBodyClasses();

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        window.ResponsiveUtils.updateBodyClasses();
    }, 150);
});

// ═══════════════════════════════════════════════
// PART 2: SPOTLIGHT SEARCH + AI CHAT + KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════
(function () {
    // ═══════════════════════════════════════════════
    // SPOTLIGHT SEARCH (doble espacio / ⌘K)
    // ═══════════════════════════════════════════════
    var spotlightTimeout = null;
    var selectedIndex = -1;
    var currentResults = [];

    var ICONS = {
        oportunidad: '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        cotizacion:  '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
        cliente:     '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        proyecto:    '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        tarea:       '<svg viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
    };
    var LABELS = { oportunidad: 'Oportunidades', cotizacion: 'Cotizaciones', cliente: 'Clientes', proyecto: 'Proyectos', tarea: 'Tareas' };

    function showEmptyState() {
        var c = document.getElementById('spotlight-results');
        if (c) c.innerHTML = '<div class="spotlight-empty"><div class="spotlight-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35" stroke-linecap="round"/></svg></div><div class="spotlight-empty-text">Busca oportunidades, cotizaciones o clientes</div><div class="spotlight-empty-hint">Por nombre, PO, número de factura o #cotización</div></div>';
    }
    function showLoadingState() {
        var c = document.getElementById('spotlight-results');
        if (c) c.innerHTML = '<div class="spotlight-loading"><div class="spotlight-spinner"></div><div>Buscando...</div></div>';
    }
    function performSearch(query) {
        if (!query || query.length < 2) { showEmptyState(); return; }
        showLoadingState();
        var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
        var token = csrf ? csrf.value : '';
        fetch('/app/api/spotlight-search/?q=' + encodeURIComponent(query), { method: 'GET', headers: { 'X-CSRFToken': token, 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                displayResults(data.results || []);
                currentResults = data.results || [];
                selectedIndex = -1;
            })
            .catch(function () { showEmptyState(); });
    }
    function displayResults(results) {
        var c = document.getElementById('spotlight-results');
        if (!c) return;
        if (results.length === 0) {
            c.innerHTML = '<div class="spotlight-empty"><div class="spotlight-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35" stroke-linecap="round"/></svg></div><div class="spotlight-empty-text">Sin resultados</div><div class="spotlight-empty-hint">Intenta con otro nombre, PO o número</div></div>';
            return;
        }
        // Group by type
        var groups = {};
        var order = [];
        results.forEach(function (r, i) {
            r._idx = i;
            if (!groups[r.type]) { groups[r.type] = []; order.push(r.type); }
            groups[r.type].push(r);
        });
        var html = '';
        order.forEach(function (type) {
            html += '<div class="spotlight-section-header">' + (LABELS[type] || type) + '</div>';
            groups[type].forEach(function (r) {
                var icon = ICONS[r.type] || ICONS.cotizacion;
                var badges = '';
                if (r.po_number) badges += '<span class="spotlight-badge po">PO ' + r.po_number + '</span>';
                if (r.factura_numero) badges += '<span class="spotlight-badge factura">Fac. ' + r.factura_numero + '</span>';
                html += '<div class="spotlight-item" data-index="' + r._idx + '" onclick="selectResult(' + r._idx + ')">' +
                    '<div class="spotlight-item-icon ' + r.type + '">' + icon + '</div>' +
                    '<div class="spotlight-item-content">' +
                        '<div class="spotlight-item-top">' +
                            '<span class="spotlight-item-title">' + r.title + '</span>' +
                            badges +
                        '</div>' +
                        '<div class="spotlight-item-subtitle">' + r.subtitle + '</div>' +
                    '</div>' +
                    '<svg class="spotlight-item-arrow" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>' +
                    '</div>';
            });
        });
        c.innerHTML = html;
    }
    function navigateSpotlight(dir) {
        if (currentResults.length === 0) return;
        var items = document.querySelectorAll('#spotlight-results .spotlight-item');
        items.forEach(function (i) { i.classList.remove('selected'); });
        selectedIndex += dir;
        if (selectedIndex < 0) selectedIndex = currentResults.length - 1;
        if (selectedIndex >= currentResults.length) selectedIndex = 0;
        if (items[selectedIndex]) { items[selectedIndex].classList.add('selected'); items[selectedIndex].scrollIntoView({ block: 'nearest' }); }
    }
    window.selectResult = function (index) {
        var r = currentResults[index]; if (!r) return;
        closeSpotlight();

        if (r.type === 'oportunidad' && r.id) {
            var enCRM = window.location.pathname === '/app/todos/';
            if (enCRM && typeof window.openDetalle === 'function') {
                window.openDetalle(r.id);
                return;
            }
            window.location.href = '/app/todos/?tab=crm&mes=todos&open_opp=' + r.id;
            return;
        }

        if (r.url) window.location.href = r.url;
    };

    window.openSpotlight = function () {
        var m = document.getElementById('spotlight-modal');
        var inp = document.getElementById('spotlight-input');
        m.classList.add('active');
        selectedIndex = -1; currentResults = []; showEmptyState();
        setTimeout(function () { if (inp) inp.focus(); }, 100);
    };
    window.closeSpotlight = function () {
        var m = document.getElementById('spotlight-modal');
        var inp = document.getElementById('spotlight-input');
        m.classList.remove('active');
        if (inp) inp.value = '';
        if (spotlightTimeout) { clearTimeout(spotlightTimeout); spotlightTimeout = null; }
    };

    document.addEventListener('DOMContentLoaded', function () {
        var inp = document.getElementById('spotlight-input');
        if (inp) {
            inp.addEventListener('input', function (e) {
                var q = e.target.value.trim();
                if (spotlightTimeout) clearTimeout(spotlightTimeout);
                spotlightTimeout = setTimeout(function () { performSearch(q); }, 300);
            });
        }
    });

    // ═══════════════════════════════════════════════
    // AI HELP CHAT (botón AYUDA)
    // ═══════════════════════════════════════════════
    var _aiKB = [
        {
            id: 'cotizar', keywords: ['cotiz', 'cotización', 'cotizacion', 'precio', 'presupuesto', 'quot', 'crear cotizacion', 'como cotizo', 'generar cotización'], title: '📄 Cómo Crear una Cotización',
            answer: '<div class="step"><span class="step-num">1</span>Ve a la sección de <b>Cotizaciones</b> desde el menú principal o el dock inferior.</div><div class="step"><span class="step-num">2</span>Haz clic en <b>"Nueva Cotización"</b> o selecciona un cliente existente.</div><div class="step"><span class="step-num">3</span>Selecciona el <b>tipo de cotización</b> (Bajanet o Iamet) y vincula una oportunidad si aplica.</div><div class="step"><span class="step-num">4</span>Agrega los productos: selecciona la <b>marca</b>, busca por <b>número de parte</b>, ajusta cantidad y descuento.</div><div class="step"><span class="step-num">5</span>Revisa el desglose de <b>subtotal, IVA y total</b> en la parte inferior.</div><div class="step"><span class="step-num">6</span>Haz clic en <b>"Guardar"</b> para crear la cotización. Podrás descargar o ver el PDF.</div><div style="margin-top:10px;font-size:0.78rem;opacity:0.7">💡 También puedes cotizar rápidamente desde el widget <b>"Cotizar Rápido"</b> en el panel del CRM.</div>',
            followUp: ['¿Cómo creo una oportunidad?', '¿Qué son las notificaciones?']
        },
        {
            id: 'oportunidad', keywords: ['oportunidad', 'oportunidades', 'venta', 'crear oportunidad', 'nueva oportunidad', 'deal', 'lead', 'negocio', 'prospecto'], title: '⭐ Cómo Crear una Oportunidad',
            answer: '<div class="step"><span class="step-num">1</span>Ve a <b>"Oportunidades"</b> desde el dock o el menú lateral.</div><div class="step"><span class="step-num">2</span>Haz clic en <b>"Nueva Oportunidad"</b> (botón azul superior derecho).</div><div class="step"><span class="step-num">3</span>Completa los datos: <b>título</b>, <b>cliente</b> (busca o crea uno nuevo), <b>monto estimado</b> y <b>producto</b>.</div><div class="step"><span class="step-num">4</span>Selecciona el <b>estatus</b> (En captura, En proceso, Ganada, etc.) y la <b>probabilidad</b> de cierre.</div><div class="step"><span class="step-num">5</span>Opcionalmente, agrega <b>observaciones</b> y vincula <b>contactos</b>.</div><div class="step"><span class="step-num">6</span>Haz clic en <b>"Guardar"</b>. La oportunidad aparecerá en tu lista y en el timeline del CRM.</div><div style="margin-top:10px;font-size:0.78rem;opacity:0.7">💡 Cada oportunidad tiene su propio <b>drive de archivos</b>, <b>bitácora de chat</b> y <b>tareas</b> asociadas.</div>',
            followUp: ['¿Cómo cotizo?', '¿Cómo creo tareas?']
        },
        {
            id: 'notificaciones', keywords: ['notificacion', 'notificaciones', 'alerta', 'alertas', 'aviso', 'avisos', 'campana', 'notification'], title: '🔔 ¿Qué Son las Notificaciones?',
            answer: 'Las <b>notificaciones</b> te mantienen informado sobre la actividad relevante del CRM en tiempo real.<div style="margin:10px 0 6px;font-weight:700;font-size:0.82rem">Tipos de notificaciones:</div><div class="step">📌 <b>Menciones:</b> Cuando alguien te @menciona en un comentario de proyecto o tarea.</div><div class="step">💬 <b>Respuestas:</b> Cuando responden a uno de tus comentarios.</div><div class="step">✅ <b>Tareas:</b> Cuando te asignan una nueva tarea o cambia su estado.</div><div class="step">📋 <b>Proyectos:</b> Cuando te programan en una actividad de proyecto.</div><div class="step">📅 <b>Recordatorios:</b> Antes de que comience una actividad programada.</div><div style="margin-top:10px;font-size:0.78rem;opacity:0.7">💡 Accede a tus notificaciones desde el <b>ícono de campana</b> en la barra superior (Dynamic Island). Las no leídas muestran un badge rojo.</div>',
            followUp: ['¿Cómo creo tareas?', '¿Cómo creo una oportunidad?']
        },
        {
            id: 'tareas', keywords: ['tarea', 'tareas', 'task', 'tasks', 'pendiente', 'pendientes', 'asignar tarea', 'crear tarea', 'to do', 'todo', 'actividad', 'kanban'], title: '✅ Cómo Crear Tareas',
            answer: '<div style="margin-bottom:8px;font-weight:700;font-size:0.82rem">Desde un Proyecto:</div><div class="step"><span class="step-num">1</span>Abre el <b>proyecto</b> desde "Tareas y Proyectos" o el dashboard.</div><div class="step"><span class="step-num">2</span>En la sección de tareas del proyecto, haz clic en <b>"Agregar tarea"</b>.</div><div class="step"><span class="step-num">3</span>Define el <b>título</b>, <b>responsable</b>, <b>fecha límite</b> y <b>prioridad</b> (baja, media, alta).</div><div class="step"><span class="step-num">4</span>La tarea se puede mover entre columnas: <b>Pendiente → En progreso → Completada</b>.</div><div style="margin:12px 0 8px;font-weight:700;font-size:0.82rem">Desde una Oportunidad:</div><div class="step"><span class="step-num">1</span>Abre la oportunidad y ve a la pestaña de <b>"Tareas"</b>.</div><div class="step"><span class="step-num">2</span>Crea tareas específicas para dar seguimiento al cierre de la venta.</div><div style="margin-top:10px;font-size:0.78rem;opacity:0.7">💡 Cada tarea tiene <b>timer</b> para registrar tiempo invertido, <b>comentarios</b> con menciones y <b>archivos adjuntos</b>.</div>',
            followUp: ['¿Cómo cotizo?', '¿Qué son las notificaciones?']
        },
        {
            id: 'calendario', keywords: ['calendario', 'calendar', 'programar', 'programacion', 'evento', 'eventos', 'horario', 'agenda', 'disponibilidad'], title: '📅 Calendario y Programación',
            answer: 'El <b>calendario</b> es tu centro de programación y visibilidad de eventos.<div class="step"><span class="step-num">1</span>Accede al calendario desde el <b>dock inferior</b> o el widget en el panel del CRM.</div><div class="step"><span class="step-num">2</span>Usa los controles de <b>navegación</b> (anterior/hoy/siguiente) para moverte entre meses.</div><div class="step"><span class="step-num">3</span>Haz clic en <b>"+ Nueva Actividad"</b> para crear un evento con fecha, hora, participantes y color.</div><div class="step"><span class="step-num">4</span>Usa el <b>filtro de empleados</b> para ver el calendario de una persona específica o de todos.</div><div style="margin-top:10px;font-size:0.78rem;opacity:0.7">💡 Los supervisores pueden programar actividades de proyecto que aparecerán automáticamente en el calendario de los responsables asignados.</div>',
            followUp: ['¿Cómo creo tareas?', '¿Cómo creo una oportunidad?']
        },
        {
            id: 'proyectos', keywords: ['proyecto', 'proyectos', 'project', 'ingeniero', 'ingenieria', 'programacion proyecto', 'plan', 'planear', 'planificar'], title: '🏗️ Proyectos y Programación',
            answer: '<div class="step"><span class="step-num">1</span>Ve a <b>"Tareas y Proyectos"</b> desde el dock o menú.</div><div class="step"><span class="step-num">2</span>Crea un nuevo proyecto: define <b>título</b>, <b>tipo</b> (Runrate o Ingeniería) y <b>miembros</b>.</div><div class="step"><span class="step-num">3</span>Dentro del proyecto tienes: <b>Feed</b> (comentarios), <b>Tareas</b> (kanban), <b>Drive</b> (archivos) y <b>Gantt</b>.</div><div class="step"><span class="step-num">4</span>Los ingenieros ven su <b>panel de control</b> personalizado con actividades y programación semanal.</div><div class="step"><span class="step-num">5</span>Usa el botón <b>⤢ (expandir)</b> en la programación para ver la vista de 7 días completa.</div><div style="margin-top:10px;font-size:0.78rem;opacity:0.7">💡 Los proyectos pueden ser <b>públicos</b> o <b>privados</b>. En privados, solo los miembros pueden ver el contenido.</div>',
            followUp: ['¿Cómo creo tareas?', '¿Cómo cotizo?']
        }
    ];
    var _aiFAQs = ['¿Cómo creo una cotización?', '¿Cómo creo una oportunidad?', '¿Qué son las notificaciones?', '¿Cómo creo tareas?', '¿Cómo uso el calendario?', '¿Cómo funcionan los proyectos?'];

    function _aiAddBotMsg(html, delay) {
        var box = document.getElementById('aiChatMessages'); if (!box) return;
        if (delay) {
            var t = document.createElement('div'); t.className = 'ai-typing'; t.id = 'aiTypingInd';
            t.innerHTML = '<div class="ai-typing-dot"></div><div class="ai-typing-dot"></div><div class="ai-typing-dot"></div>';
            box.appendChild(t); box.scrollTop = box.scrollHeight;
            setTimeout(function () { var el = document.getElementById('aiTypingInd'); if (el) el.remove(); _aiInsertBotBubble(html); }, delay);
        } else { _aiInsertBotBubble(html); }
    }
    function _aiInsertBotBubble(html) { var box = document.getElementById('aiChatMessages'); var el = document.createElement('div'); el.className = 'ai-msg bot'; el.innerHTML = html; box.appendChild(el); box.scrollTop = box.scrollHeight; }
    function _aiAddUserMsg(text) { var box = document.getElementById('aiChatMessages'); if (!box) return; var el = document.createElement('div'); el.className = 'ai-msg user'; el.textContent = text; box.appendChild(el); box.scrollTop = box.scrollHeight; }
    function _aiShowFollowUp(suggestions) {
        var box = document.getElementById('aiChatMessages'); if (!box || !suggestions || !suggestions.length) return;
        var wrap = document.createElement('div'); wrap.style.cssText = 'align-self:flex-start;animation:aiFadeIn 0.3s ease';
        var html = '<div class="ai-faq-wrap">';
        suggestions.forEach(function (q) { html += '<button class="ai-faq-chip" onclick="aiChatAskFAQ(\'' + q.replace(/'/g, "\\'") + '\')">' + q + '</button>'; });
        html += '</div>'; wrap.innerHTML = html; box.appendChild(wrap); box.scrollTop = box.scrollHeight;
    }
    function _aiFindAnswer(query) {
        var q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        var best = null, bestScore = 0;
        _aiKB.forEach(function (entry) { var score = 0; entry.keywords.forEach(function (kw) { var kwn = kw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); if (q.indexOf(kwn) !== -1) score += kwn.length; kwn.split(' ').forEach(function (w) { if (w.length > 2 && q.indexOf(w) !== -1) score += 1; }); }); if (score > bestScore) { bestScore = score; best = entry; } });
        return bestScore > 0 ? best : null;
    }
    window.aiChatSend = function () {
        var input = document.getElementById('ayuda-input'); if (!input) return;
        var text = input.value.trim(); if (!text) return; input.value = '';
        _aiAddUserMsg(text);
        var match = _aiFindAnswer(text);
        if (match) { _aiAddBotMsg('<div style="font-weight:700;margin-bottom:8px;">' + match.title + '</div>' + match.answer, 800 + Math.random() * 600); setTimeout(function () { _aiShowFollowUp(match.followUp); }, 1600 + Math.random() * 400); }
        else { _aiAddBotMsg('No encontré información exacta sobre eso. 🤔 Te sugiero probar con alguna de estas preguntas:', 600); setTimeout(function () { _aiShowFollowUp(_aiFAQs.slice(0, 4)); }, 1200); }
    };
    window.aiChatAskFAQ = function (question) {
        var wraps = document.querySelectorAll('.ai-faq-wrap'); wraps.forEach(function (w) { var p = w.parentElement; if (p && !p.classList.contains('ai-msg')) p.remove(); else w.remove(); });
        _aiAddUserMsg(question); var match = _aiFindAnswer(question);
        if (match) { _aiAddBotMsg('<div style="font-weight:700;margin-bottom:8px;">' + match.title + '</div>' + match.answer, 700 + Math.random() * 500); setTimeout(function () { _aiShowFollowUp(match.followUp); }, 1400 + Math.random() * 400); }
    };
    window.openAyudaChat = function () {
        var m = document.getElementById('ayuda-modal'); m.classList.add('active');
        var box = document.getElementById('aiChatMessages'); if (box) box.innerHTML = '';
        _aiAddBotMsg('¡Hola! 👋 Soy el <b>asistente de IAMET</b>. ¿En qué puedo ayudarte hoy?');
        var faqHtml = '<div class="ai-faq-wrap" style="margin-top:4px">';
        _aiFAQs.forEach(function (q) { faqHtml += '<button class="ai-faq-chip" onclick="aiChatAskFAQ(\'' + q.replace(/'/g, "\\'") + '\')">' + q + '</button>'; });
        faqHtml += '</div>'; var el = document.createElement('div'); el.style.cssText = 'align-self:flex-start;animation:aiFadeIn 0.3s ease;animation-delay:0.2s;opacity:0;animation-fill-mode:forwards'; el.innerHTML = faqHtml; box.appendChild(el);
        setTimeout(function () { var inp = document.getElementById('ayuda-input'); if (inp) inp.focus(); }, 150);
    };
    window.closeAyudaChat = function () { var m = document.getElementById('ayuda-modal'); m.classList.remove('active'); var inp = document.getElementById('ayuda-input'); if (inp) inp.value = ''; };

    // ═══════════════════════════════════════════════
    // KEYBOARD SHORTCUTS
    // ═══════════════════════════════════════════════
    var lastSpaceTime = 0, spaceDoubleTapTimeout = null;
    function isUserTyping() { var ae = document.activeElement; if (!ae) return false; var tags = ['input', 'textarea', 'select']; return tags.indexOf(ae.tagName.toLowerCase()) !== -1 || ae.contentEditable === 'true'; }

    document.addEventListener('keydown', function (e) {
        // ⌘K → Spotlight
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openSpotlight(); return; }
        // Double spacebar → Spotlight
        if (e.key === ' ' && e.code === 'Space') {
            if (isUserTyping()) { lastSpaceTime = 0; return; }
            e.preventDefault();
            var now = Date.now(), diff = now - lastSpaceTime;
            if (diff < 400 && diff > 50) { openSpotlight(); lastSpaceTime = 0; return; }
            lastSpaceTime = now;
            if (spaceDoubleTapTimeout) clearTimeout(spaceDoubleTapTimeout);
            spaceDoubleTapTimeout = setTimeout(function () { lastSpaceTime = 0; }, 400);
        }
        // Escape → close whichever is open
        if (e.key === 'Escape') { closeSpotlight(); closeAyudaChat(); }
        // Arrow nav in spotlight
        var sm = document.getElementById('spotlight-modal');
        if (sm && sm.classList.contains('active')) {
            if (e.key === 'ArrowDown') { e.preventDefault(); navigateSpotlight(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); navigateSpotlight(-1); }
            else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < currentResults.length) { e.preventDefault(); selectResult(selectedIndex); }
        }
        // Enter in ayuda chat
        var am = document.getElementById('ayuda-modal');
        if (am && am.classList.contains('active') && e.key === 'Enter') { e.preventDefault(); aiChatSend(); }
    });
})();
