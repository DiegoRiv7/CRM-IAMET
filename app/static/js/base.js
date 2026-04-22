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
    // SPOTLIGHT SEARCH v2 (doble espacio / ⌘K)
    //   - Prefijos: /t /o /c /q /p  ·  @user  ·  #123  ·  >acción
    //   - Scopes chips + recientes + resultados ricos
    // ═══════════════════════════════════════════════
    var spotlightTimeout = null;
    var selectedIndex = -1;
    var currentResults = [];
    var currentScope = 'all';      // scope del chip (all|oportunidad|cotizacion|tarea|cliente|proyecto)
    var parsedUserFilter = null;   // resultado del parse @user (se aplica al query activo)
    var RECENTS_KEY = 'crm_spotlight_recents_v2';

    // ── Rol del usuario (Fase 2 — search limitado para ingenieros) ───────
    //   Cuando user_profile.rol == 'ingeniero', el Spotlight solo debe buscar
    //   en Tareas y Proyectos (no oportunidades, cotizaciones, clientes).
    function isIngeniero() {
        try { return document.body && document.body.dataset && document.body.dataset.userRole === 'ingeniero'; }
        catch (e) { return false; }
    }
    var ING_ALLOWED_SCOPES = { tarea: 1, proyecto: 1 };
    var ING_ALLOWED_TYPES = { tarea: 1, proyecto: 1 };
    // Acciones rápidas prohibidas para ingenieros (nueva opp, nueva cotización, ir a CRM, etc).
    var ING_BLOCKED_ACTIONS = { 'crear-opp': 1, 'crear-cot': 1, 'ir-crm': 1 };

    var ICONS = {
        oportunidad: '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        cotizacion:  '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
        cliente:     '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        proyecto:    '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        tarea:       '<svg viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
        accion:      '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    };
    var LABELS = { oportunidad: 'Oportunidades', cotizacion: 'Cotizaciones', cliente: 'Clientes', proyecto: 'Proyectos', tarea: 'Tareas', accion: 'Acciones rápidas', reciente: 'Recientes', sugerido: 'Sugerencias' };
    var PREFIX_MAP = { t: 'tarea', o: 'oportunidad', q: 'cotizacion', c: 'cliente', p: 'proyecto' };

    // ── Acciones rápidas (> comandos) ─────────────────────
    var QUICK_ACTIONS = [
        { id: 'crear-opp',  title: 'Crear nueva oportunidad', subtitle: 'Abre el formulario de nueva oportunidad', keywords: ['nueva', 'oportunidad', 'crear', 'opp', 'deal'], action: function () { window.location.href = '/app/todos/?tab=crm&action=nueva_opp'; } },
        { id: 'crear-cot',  title: 'Crear nueva cotización',  subtitle: 'Ir al módulo de cotizaciones', keywords: ['nueva', 'cotizacion', 'cotizar', 'quote'], action: function () { window.location.href = '/app/cotizaciones/'; } },
        { id: 'crear-tarea', title: 'Crear nueva tarea',       subtitle: 'Abre el panel de tareas del CRM', keywords: ['nueva', 'tarea', 'task', 'todo', 'pendiente'], action: function () { window.location.href = '/app/todos/?tab=crm&action=nueva_tarea'; } },
        { id: 'ir-crm',     title: 'Ir al CRM',                subtitle: 'Vista principal de oportunidades', keywords: ['crm', 'inicio', 'dashboard', 'oportunidades'], action: function () { window.location.href = '/app/todos/?tab=crm'; } },
        { id: 'ir-cal',     title: 'Ir al calendario',         subtitle: 'Agenda y actividades programadas', keywords: ['calendario', 'calendar', 'agenda'], action: function () { window.location.href = '/app/calendario/'; } },
        { id: 'ir-tareas',  title: 'Ir a Tareas',              subtitle: 'Vista cockpit de tareas', keywords: ['tareas', 'cockpit', 'mis tareas'], action: function () { window.location.href = '/app/crm-tareas/'; } }
    ];

    // ── Helpers ───────────────────────────────────────────
    function $sp(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }

    function highlight(text, q) {
        if (!q || !text) return escapeHtml(text);
        var safe = escapeHtml(text);
        try {
            var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
            return safe.replace(re, '<mark class="sp-mark">$1</mark>');
        } catch (e) { return safe; }
    }

    function parseQuery(raw) {
        // Devuelve { q, scope, userFilter, actionQuery }
        var q = (raw || '').trim();
        var scope = null;
        var userFilter = null;
        var actionQuery = null;

        // > acciones  (ej: "> nueva tarea")
        if (q.charAt(0) === '>') {
            actionQuery = q.slice(1).trim().toLowerCase();
            return { q: '', scope: 'accion', userFilter: null, actionQuery: actionQuery };
        }

        // /prefijo (solo al inicio)
        var pref = q.match(/^\/([a-z])(\s+(.*))?$/i);
        if (pref && PREFIX_MAP[pref[1].toLowerCase()]) {
            scope = PREFIX_MAP[pref[1].toLowerCase()];
            q = (pref[3] || '').trim();
        }

        // @usuario (en cualquier parte)
        var um = q.match(/@(\S+)/);
        if (um) {
            userFilter = um[1];
            q = q.replace(um[0], '').trim();
        }

        return { q: q, scope: scope, userFilter: userFilter, actionQuery: actionQuery };
    }

    // ── Renderers ────────────────────────────────────────
    function renderAvatar(u) {
        if (!u) return '';
        if (u.avatar_url) {
            return '<span class="sp-avatar" title="' + escapeHtml(u.nombre) + '"><img src="' + escapeHtml(u.avatar_url) + '" alt="' + escapeHtml(u.iniciales || '') + '"></span>';
        }
        return '<span class="sp-avatar sp-avatar-initials" title="' + escapeHtml(u.nombre) + '">' + escapeHtml(u.iniciales || '?') + '</span>';
    }

    function renderStatusPill(r) {
        if (!r.status_label) return '';
        var cls = r.status_class || 'neutral';
        return '<span class="sp-pill sp-pill-' + cls + '"><i></i>' + escapeHtml(r.status_label) + '</span>';
    }

    function renderBadges(r) {
        var out = '';
        if (r.po_number)       out += '<span class="sp-badge sp-badge-po">PO ' + escapeHtml(r.po_number) + '</span>';
        if (r.factura_numero)  out += '<span class="sp-badge sp-badge-factura">Fac. ' + escapeHtml(r.factura_numero) + '</span>';
        return out;
    }

    function renderResultItem(r, idx, q) {
        var icon = ICONS[r.type] || ICONS.accion;
        var iconTag = r.type === 'accion' ? ICONS.accion : icon;
        var title = highlight(r.title, q);
        var subtitle = highlight(r.subtitle || '', q);
        var metaParts = [];
        if (r.responsable) metaParts.push(renderAvatar(r.responsable) + '<span class="sp-owner-name">' + escapeHtml(r.responsable.nombre) + '</span>');
        if (r.monto_formatted) metaParts.push('<span class="sp-monto">' + escapeHtml(r.monto_formatted) + '</span>');
        if (r.fecha_relative)  metaParts.push('<span class="sp-date">' + escapeHtml(r.fecha_relative) + '</span>');
        var metaHtml = metaParts.length ? '<div class="sp-meta">' + metaParts.join('<span class="sp-dot-sep">·</span>') + '</div>' : '';

        return (
            '<div class="sp-item" data-index="' + idx + '" onclick="selectResult(' + idx + ')">' +
                '<div class="sp-icon sp-icon-' + escapeHtml(r.type) + '">' + iconTag + '</div>' +
                '<div class="sp-body">' +
                    '<div class="sp-row1">' +
                        '<span class="sp-title">' + title + '</span>' +
                        renderStatusPill(r) +
                        renderBadges(r) +
                    '</div>' +
                    '<div class="sp-row2">' +
                        (subtitle ? '<span class="sp-subtitle">' + subtitle + '</span>' : '') +
                        metaHtml +
                    '</div>' +
                '</div>' +
                '<svg class="sp-arrow" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>' +
            '</div>'
        );
    }

    function renderSectionHeader(type, count) {
        var label = LABELS[type] || type;
        var badge = (count != null) ? ' <span class="sp-section-count">' + count + '</span>' : '';
        return '<div class="sp-section-header">' + label + badge + '</div>';
    }

    function displayResults(results, q) {
        var c = $sp('spotlight-results');
        if (!c) return;
        currentResults = results;
        if (!results.length) {
            c.innerHTML =
                '<div class="sp-empty">' +
                    '<div class="sp-empty-icon">' +
                        '<svg width="38" height="38" fill="none" stroke="#CBD5E1" stroke-width="1.6" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>' +
                    '</div>' +
                    '<div class="sp-empty-title">Sin resultados</div>' +
                '</div>';
            return;
        }
        // Group by type conservando orden de appearance
        var groups = {}, order = [];
        results.forEach(function (r, i) {
            r._idx = i;
            if (!groups[r.type]) { groups[r.type] = []; order.push(r.type); }
            groups[r.type].push(r);
        });
        var html = '';
        order.forEach(function (type) {
            html += renderSectionHeader(type, groups[type].length);
            groups[type].forEach(function (r) { html += renderResultItem(r, r._idx, q); });
        });
        c.innerHTML = html;
    }

    function showLoading() {
        var c = $sp('spotlight-results');
        if (c) c.innerHTML = '<div class="sp-loading"><div class="sp-spinner"></div><div>Buscando…</div></div>';
    }

    // ── Estado vacío: Acciones rápidas + Recientes + Hint ──
    function getRecents() {
        try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch (e) { return []; }
    }
    function pushRecent(r) {
        if (!r || !r.type || r.type === 'accion') return;
        try {
            var list = getRecents().filter(function (x) { return !(x.type === r.type && x.id === r.id); });
            list.unshift({
                type: r.type, id: r.id, opp_id: r.opp_id || null,
                title: r.title, subtitle: r.subtitle, url: r.url,
                status_class: r.status_class, status_label: r.status_label,
                responsable: r.responsable, monto_formatted: r.monto_formatted,
                fecha_relative: r.fecha_relative,
                po_number: r.po_number || '', factura_numero: r.factura_numero || '',
                ts: Date.now()
            });
            localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 8)));
        } catch (e) {}
    }
    function showInitialState() {
        var c = $sp('spotlight-results');
        if (!c) return;
        currentResults = [];
        var recents = getRecents();
        // Ingenieros: ocultar recents que no sean tareas/proyectos.
        if (isIngeniero()) {
            recents = recents.filter(function (r) { return ING_ALLOWED_TYPES[r.type]; });
        }
        if (recents.length) {
            var html = renderSectionHeader('reciente');
            recents.forEach(function (r) {
                currentResults.push(r);
                html += renderResultItem(r, currentResults.length - 1, '');
            });
            c.innerHTML = html;
        } else {
            c.innerHTML = '';
        }
    }

    // ── User chip (filtro por @usuario) ───────────────────
    function renderUserChip(uname) {
        var chip = $sp('sp-user-chip');
        if (!chip) return;
        if (!uname) { chip.style.display = 'none'; chip.innerHTML = ''; return; }
        chip.style.display = 'inline-flex';
        chip.innerHTML = '<span>@' + escapeHtml(uname) + '</span><button type="button" class="sp-chip-close" onclick="spotlightClearUserFilter(event)" aria-label="Quitar filtro">&times;</button>';
    }
    window.spotlightClearUserFilter = function (e) {
        if (e) e.stopPropagation();
        var inp = $sp('spotlight-input');
        if (inp) inp.value = inp.value.replace(/@\S+/g, '').replace(/\s+/g, ' ').trim();
        parsedUserFilter = null;
        renderUserChip(null);
        triggerSearch(inp ? inp.value : '');
    };

    // ── Búsqueda ─────────────────────────────────────────
    function triggerSearch(raw) {
        var parsed = parseQuery(raw);

        // Acciones rápidas (> ...)
        if (parsed.actionQuery !== null) {
            showActionResults(parsed.actionQuery);
            return;
        }

        // scope override por prefijo
        var effectiveScope = parsed.scope || currentScope;

        // Ingenieros: si el scope solicitado no es tarea/proyecto/all, forzarlo a 'all'
        // (luego el filtrado client-side lo limita a tarea+proyecto). El backend también
        // aplica este filtro como defensa en profundidad.
        if (isIngeniero() && effectiveScope !== 'all' && !ING_ALLOWED_SCOPES[effectiveScope]) {
            effectiveScope = 'all';
        }

        // user filter render
        parsedUserFilter = parsed.userFilter;
        renderUserChip(parsed.userFilter);

        // si no hay q ni userFilter -> estado inicial
        if ((!parsed.q || parsed.q.length < 2) && !parsed.userFilter) {
            showInitialState();
            return;
        }

        showLoading();
        var params = new URLSearchParams();
        params.set('q', parsed.q || '');
        params.set('scope', effectiveScope);
        if (parsed.userFilter) params.set('user', parsed.userFilter);

        var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
        var token = csrf ? csrf.value : '';
        fetch('/app/api/spotlight-search/?' + params.toString(), {
            method: 'GET',
            headers: { 'X-CSRFToken': token, 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var rs = data.results || [];
                // Ingenieros: filtrar cualquier resultado fuera de tarea/proyecto
                // (defensa extra por si el backend devolviera otros tipos).
                if (isIngeniero()) {
                    rs = rs.filter(function (r) { return ING_ALLOWED_TYPES[r.type]; });
                }
                displayResults(rs, parsed.q);
                selectedIndex = -1;
            })
            .catch(function () { displayResults([], parsed.q); });
    }

    function showActionResults(actionQuery) {
        var c = $sp('spotlight-results');
        if (!c) return;
        var ingeniero = isIngeniero();
        var filtered = QUICK_ACTIONS.filter(function (a) {
            // Ingenieros: ocultar acciones ligadas a oportunidades/cotizaciones/CRM de ventas.
            if (ingeniero && ING_BLOCKED_ACTIONS[a.id]) return false;
            if (!actionQuery) return true;
            var hay = (a.title + ' ' + a.subtitle + ' ' + a.keywords.join(' ')).toLowerCase();
            return hay.indexOf(actionQuery) !== -1;
        });
        currentResults = filtered.map(function (a) {
            return { type: 'accion', _action_id: a.id, title: a.title, subtitle: a.subtitle, _action: true };
        });
        selectedIndex = -1;
        if (!currentResults.length) {
            c.innerHTML = '<div class="sp-empty"><div class="sp-empty-title">Sin acciones</div><div class="sp-empty-hint">Prueba &quot;&gt; nueva cotización&quot; o &quot;&gt; calendario&quot;</div></div>';
            return;
        }
        var html = renderSectionHeader('accion', currentResults.length);
        currentResults.forEach(function (r, i) { html += renderResultItem(r, i, actionQuery); });
        c.innerHTML = html;
    }

    // ── Selección / navegación ───────────────────────────
    function navigateSpotlight(dir) {
        if (!currentResults.length) return;
        var items = document.querySelectorAll('#spotlight-results .sp-item');
        items.forEach(function (i) { i.classList.remove('selected'); });
        selectedIndex += dir;
        if (selectedIndex < 0) selectedIndex = currentResults.length - 1;
        if (selectedIndex >= currentResults.length) selectedIndex = 0;
        if (items[selectedIndex]) {
            items[selectedIndex].classList.add('selected');
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    window.selectResult = function (index, opts) {
        var r = currentResults[index];
        if (!r) return;
        opts = opts || {};
        var newTab = !!opts.newTab;

        // Acciones rápidas
        if (r._action || r.type === 'accion') {
            var act = null;
            for (var i = 0; i < QUICK_ACTIONS.length; i++) {
                if (QUICK_ACTIONS[i].id === r._action_id) { act = QUICK_ACTIONS[i]; break; }
            }
            closeSpotlight();
            if (act) act.action();
            return;
        }

        // Guardar en recientes antes de navegar
        pushRecent(r);
        closeSpotlight();

        var enCRM = window.location.pathname === '/app/todos/';

        if (r.type === 'oportunidad' && r.id) {
            var url = '/app/todos/?tab=crm&mes=todos&open_opp=' + r.id;
            if (newTab) { window.open(url, '_blank'); return; }
            if (enCRM && typeof window.openDetalle === 'function') { window.openDetalle(r.id); return; }
            window.location.href = url;
            return;
        }
        if (r.type === 'cotizacion') {
            if (r.opp_id) {
                var url2 = '/app/todos/?tab=crm&mes=todos&open_opp=' + r.opp_id;
                if (newTab) { window.open(url2, '_blank'); return; }
                if (enCRM && typeof window.openDetalle === 'function') { window.openDetalle(r.opp_id); return; }
                window.location.href = url2;
            } else {
                if (newTab) window.open('/app/todos/?tab=crm', '_blank');
                else window.location.href = '/app/todos/?tab=crm';
            }
            return;
        }
        if (r.type === 'tarea' && r.id) {
            var url3 = '/app/todos/?tab=crm&open_task=' + r.id;
            if (newTab) { window.open(url3, '_blank'); return; }
            if (enCRM && typeof window.crmTaskVerDetalle === 'function') { window.crmTaskVerDetalle(r.id); return; }
            window.location.href = url3;
            return;
        }
        if (r.url) {
            if (newTab) window.open(r.url, '_blank');
            else window.location.href = r.url;
        }
    };

    // ── Scopes chips ─────────────────────────────────────
    function wireScopes() {
        var box = $sp('sp-scopes');
        if (!box) return;
        box.addEventListener('click', function (e) {
            var b = e.target.closest('.sp-chip');
            if (!b) return;
            var scope = b.getAttribute('data-scope') || 'all';
            currentScope = scope;
            box.querySelectorAll('.sp-chip').forEach(function (x) { x.classList.remove('active'); });
            b.classList.add('active');
            triggerSearch($sp('spotlight-input') ? $sp('spotlight-input').value : '');
        });
    }

    // ── Open / close ─────────────────────────────────────
    window.openSpotlight = function () {
        var m = $sp('spotlight-modal');
        var inp = $sp('spotlight-input');
        m.classList.add('active');
        selectedIndex = -1; currentResults = [];
        showInitialState();
        setTimeout(function () { if (inp) { inp.focus(); inp.select(); } }, 100);
    };
    window.closeSpotlight = function () {
        var m = $sp('spotlight-modal');
        var inp = $sp('spotlight-input');
        m.classList.remove('active');
        if (inp) inp.value = '';
        parsedUserFilter = null;
        renderUserChip(null);
        currentScope = 'all';
        var box = $sp('sp-scopes');
        if (box) {
            box.querySelectorAll('.sp-chip').forEach(function (x) { x.classList.remove('active'); });
            var all = box.querySelector('[data-scope="all"]');
            if (all) all.classList.add('active');
        }
        if (spotlightTimeout) { clearTimeout(spotlightTimeout); spotlightTimeout = null; }
    };

    document.addEventListener('DOMContentLoaded', function () {
        var inp = $sp('spotlight-input');
        if (inp) {
            inp.addEventListener('input', function (e) {
                var q = e.target.value;
                if (spotlightTimeout) clearTimeout(spotlightTimeout);
                spotlightTimeout = setTimeout(function () { triggerSearch(q); }, 220);
            });
            // Nota: las flechas/Enter/Esc se manejan en el handler global de keydown (abajo).
        }
        wireScopes();
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
            else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < currentResults.length) {
                e.preventDefault();
                selectResult(selectedIndex, { newTab: e.metaKey || e.ctrlKey });
            }
        }
        // Enter in ayuda chat
        var am = document.getElementById('ayuda-modal');
        if (am && am.classList.contains('active') && e.key === 'Enter') { e.preventDefault(); aiChatSend(); }
    });
})();
