/* ----------------------------------------------------------------------
 * crm_ideas.js — JS del módulo Ideas (kanban + crear + detalle + convertir).
 * Patrón espejo a crm_prospectos_kanban.js pero más compacto.
 *
 * Endpoints:
 *   GET    /app/api/ideas/                 → { etapas, ideas_por_etapa }
 *   POST   /app/api/ideas/crear/           → crea idea
 *   GET    /app/api/ideas/<id>/            → detalle
 *   PATCH  /app/api/ideas/<id>/            → editar campos
 *   DELETE /app/api/ideas/<id>/            → eliminar
 *   POST   /app/api/ideas/<id>/mover/      → cambiar etapa
 *   POST   /app/api/ideas/<id>/comentar/   → agregar comentario
 *   POST   /app/api/ideas/<id>/convertir/  → convertir a prospección
 * --------------------------------------------------------------------*/
(function () {
    'use strict';

    if (window._ideasLoaded) return;
    window._ideasLoaded = true;

    var ETAPAS = window._IDEAS_ETAPAS || [];
    var TIPOS = window._IDEAS_TIPOS || [];
    var POTENCIAL = window._IDEAS_POTENCIAL || [];

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
            return r.json().then(function (d) { return {ok: r.ok, data: d}; });
        });
    }
    function fmtMoney(n) {
        if (n == null || isNaN(n)) return '—';
        try { return '$' + Number(n).toLocaleString('es-MX', {maximumFractionDigits: 0}); }
        catch (e) { return '$' + n; }
    }
    function fmtFecha(iso) {
        if (!iso) return '';
        try {
            var d = new Date(iso);
            return d.toLocaleDateString('es-MX', {day: 'numeric', month: 'short', year: 'numeric'});
        } catch (e) { return iso.substring(0, 10); }
    }
    function showFlash(msg, kind) {
        // Toast simple; reaprovecha el de marketing si existe, si no usa alert.
        var m = document.getElementById('mkthubToastMsg');
        var t = document.getElementById('mkthubToast');
        if (m && t) {
            m.textContent = msg;
            t.classList.add('is-visible');
            clearTimeout(t._hideTimer);
            t._hideTimer = setTimeout(function () { t.classList.remove('is-visible'); }, 2400);
            return;
        }
        // Fallback in-place toast
        var existing = document.getElementById('ideasFlash');
        if (existing) existing.remove();
        var el = document.createElement('div');
        el.id = 'ideasFlash';
        el.textContent = msg;
        el.style.cssText = 'position:fixed;top:20px;right:20px;background:' + (kind === 'error' ? '#DC2626' : '#1D1D1F') +
            ';color:#fff;padding:10px 18px;border-radius:10px;font-size:0.85rem;font-weight:600;' +
            'box-shadow:0 10px 30px -8px rgba(0,0,0,0.35);z-index:99999;';
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 2400);
    }

    /* ─── State ─── */
    var STATE = {
        ideas_por_etapa: {},     // etapa_key → [idea, ...]
        ideas_by_id: {},         // id → idea
        canSeeAll: false,
        currentIdea: null,       // idea abierta en el widget de detalle
        creating: {               // form de creación
            tipo: 'territorial',
            potencial: 'medio',
        },
    };

    /* ─── Inyectar botón "+ Nueva Idea" en el topbar ─── */
    function injectTopbarButton() {
        var bar = document.querySelector('.crm-bar-right');
        if (!bar) return;
        if (document.getElementById('ideasNuevaBtn')) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'ideasNuevaBtn';
        btn.className = 'idea-topbar-btn';
        btn.innerHTML = '<svg width="13" height="13" fill="none" viewBox="0 0 14 14"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Nueva idea';
        btn.addEventListener('click', openNuevaIdea);
        bar.appendChild(btn);
    }

    /* ─── Fetch + render del kanban ─── */
    function buildKanbanQuery() {
        // Lee user_id de la URL (cuando un supervisor mira el tablero de un
        // vendedor específico) y los devuelve como query string.
        var qs = new URLSearchParams();
        try {
            var u = new URL(window.location.href);
            var uid = u.searchParams.get('user_id');
            if (uid) qs.set('user_id', uid);
        } catch (e) { /* ignore */ }
        // Filtros locales (etapa/tipo/potencial/sort) los aplica el cliente
        // sobre los datos ya cargados — no se mandan al backend.
        var s = qs.toString();
        return s ? ('?' + s) : '';
    }

    function fetchKanban() {
        return api('/app/api/ideas/' + buildKanbanQuery()).then(function (res) {
            if (!res.ok || !res.data.ok) {
                showFlash('No se pudo cargar el tablero', 'error');
                return;
            }
            STATE.ideas_por_etapa = res.data.ideas_por_etapa || {};
            STATE.canSeeAll = !!res.data.can_see_all;
            STATE.ideas_by_id = {};
            Object.keys(STATE.ideas_por_etapa).forEach(function (k) {
                (STATE.ideas_por_etapa[k] || []).forEach(function (i) { STATE.ideas_by_id[i.id] = i; });
            });
            // Invalidar snapshot raw para que filtros/orden trabajen sobre los datos frescos.
            STATE._rawByEtapa = null;
            renderKanban();
            // Re-aplicar filtros locales (si los hay) sobre los datos nuevos.
            if (typeof applyFiltros === 'function') applyFiltros();
        });
    }

    function renderKanban() {
        var board = document.getElementById('ideasKanbanBoard');
        if (!board) return;
        var html = '';
        ETAPAS.forEach(function (et) {
            var items = STATE.ideas_por_etapa[et.key] || [];
            html += '<div class="crm-kanban-col crm-kanban-col--idea" data-stage="' + esc(et.key) + '">'
                + '  <div class="crm-kanban-head">'
                + '    <div class="crm-kanban-head-expanded">'
                + '      <div class="crm-kanban-head-top">'
                + '        <div class="crm-kanban-head-title">'
                + '          <span class="crm-kanban-dot' + (items.length ? ' active' : '') + '"></span>'
                + '          <span class="crm-kanban-stage-name">' + esc(et.label) + '</span>'
                + '          <span class="crm-kanban-count">' + items.length + '</span>'
                + '        </div>'
                + '        <div class="crm-kanban-head-actions">'
                + '          <button type="button" class="crm-kanban-col-btn" data-act="add-idea" data-stage="' + esc(et.key) + '" title="Nueva idea en esta etapa">'
                + '            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
                + '          </button>'
                + '        </div>'
                + '      </div>'
                + '      <div class="crm-kanban-head-bottom">'
                + '        <span class="crm-kanban-total-label">Total:</span>'
                + '        <span class="crm-kanban-total-value">' + items.length + ' idea' + (items.length === 1 ? '' : 's') + '</span>'
                + '      </div>'
                + '    </div>'
                + '  </div>'
                + '  <div class="crm-kanban-col-body" data-stage="' + esc(et.key) + '">'
                + (items.length ? items.map(renderCard).join('') : renderEmpty(et.key))
                + '  </div>'
                + '</div>';
        });
        board.innerHTML = html;
        wireKanbanEvents();
    }

    function renderCard(idea) {
        var tags = (idea.etiquetas || []).slice(0, 3);
        var tagsHtml = tags.length
            ? '<div class="idea-card-tags">' + tags.map(function (t) { return '<span class="idea-card-tag">' + esc(t) + '</span>'; }).join('') + '</div>'
            : '';
        var iniciales = (idea.autor && idea.autor.iniciales) || '?';
        var autorNombre = (idea.autor && idea.autor.nombre) || '—';
        return '<div class="idea-card" data-idea-id="' + idea.id + '" draggable="true">'
            + '  <div class="idea-card-strip"></div>'
            + '  <div class="idea-card-title">' + esc(idea.titulo) + '</div>'
            + '  <div class="idea-card-row">'
            + '    <div class="idea-card-pill">'
            + '      <span class="idea-card-pill-label">Tipo</span>'
            + '      <span class="idea-card-pill-value">' + esc(idea.tipo_display || idea.tipo) + '</span>'
            + '    </div>'
            + '    <div class="idea-card-pill">'
            + '      <span class="idea-card-pill-label">Mercado</span>'
            + '      <span class="idea-card-pill-value">' + esc(idea.mercado_objetivo || '—') + '</span>'
            + '    </div>'
            + '  </div>'
            +    tagsHtml
            + '  <div class="idea-card-foot">'
            + '    <span class="idea-card-author">'
            + '      <span class="idea-card-avatar">' + esc(iniciales) + '</span>'
            + '      <span>' + esc(autorNombre) + '</span>'
            + '    </span>'
            + '    <span class="idea-card-potencial is-' + esc(idea.potencial_comercial) + '">' + esc(idea.potencial_display || idea.potencial_comercial) + '</span>'
            + '  </div>'
            + '</div>';
    }

    function renderEmpty(stageKey) {
        return '<div class="idea-kanban-empty" data-act="add-idea" data-stage="' + esc(stageKey) + '">'
            + '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
            + '<span style="display:block;margin-top:4px;">Sin ideas</span>'
            + '</div>';
    }

    function wireKanbanEvents() {
        // Click en card → abrir detalle
        document.querySelectorAll('.idea-card').forEach(function (card) {
            card.addEventListener('click', function () {
                var id = parseInt(card.getAttribute('data-idea-id'), 10);
                if (id) openIdeaDetail(id);
            });
            // Drag&drop
            card.addEventListener('dragstart', function (e) {
                e.dataTransfer.setData('text/plain', card.getAttribute('data-idea-id'));
                e.dataTransfer.effectAllowed = 'move';
                card.style.opacity = '0.5';
            });
            card.addEventListener('dragend', function () { card.style.opacity = '1'; });
        });
        // Botón "+ nueva en esta etapa"
        document.querySelectorAll('[data-act="add-idea"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                openNuevaIdea(btn.getAttribute('data-stage'));
            });
        });
        // Drop targets en columnas
        document.querySelectorAll('.crm-kanban-col-body').forEach(function (body) {
            body.addEventListener('dragover', function (e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                body.style.background = 'rgba(139,92,246,0.06)';
            });
            body.addEventListener('dragleave', function () { body.style.background = ''; });
            body.addEventListener('drop', function (e) {
                e.preventDefault();
                body.style.background = '';
                var id = parseInt(e.dataTransfer.getData('text/plain'), 10);
                var newEtapa = body.getAttribute('data-stage');
                if (!id || !newEtapa) return;
                moverEtapa(id, newEtapa);
            });
        });
    }

    function moverEtapa(ideaId, etapa) {
        var idea = STATE.ideas_by_id[ideaId] || (STATE.currentIdea && STATE.currentIdea.id === ideaId ? STATE.currentIdea : null);
        if (!idea || idea.etapa === etapa) return;

        // Si se mueve a "convertida" y aún no hay prospecto creado, abrir el
        // modal de conversión (pide cliente). NO movemos a "convertida"
        // hasta que el usuario confirme la creación del prospecto — porque
        // ese flujo crea el Prospecto y mueve la etapa atómicamente.
        if (etapa === 'convertida' && !idea.prospecto_creado_id) {
            STATE.currentIdea = STATE.currentIdea || idea;
            abrirConvertir();
            return;
        }

        api('/app/api/ideas/' + ideaId + '/mover/', {
            method: 'POST',
            body: JSON.stringify({etapa: etapa}),
        }).then(function (res) {
            if (!res.ok || !res.data.ok) {
                showFlash(res.data.error || 'No se pudo mover', 'error');
                return;
            }
            fetchKanban();
        });
    }

    /* ─── Modal NUEVA IDEA ─── */
    function openNuevaIdea(stagePref) {
        var ov = document.getElementById('widgetNuevaIdea');
        if (!ov) return;
        // Reset
        STATE.creating = {tipo: 'territorial', potencial: 'medio'};
        STATE.editingId = null;
        document.getElementById('newIdeaTitulo').value = '';
        document.getElementById('newIdeaDescripcion').value = '';
        document.getElementById('newIdeaMercado').value = '';
        document.getElementById('newIdeaClienteId').value = '';
        var sb = document.getElementById('newIdeaMercadoSearch'); if (sb) sb.value = '';
        var lst = document.getElementById('newIdeaMercadoList'); if (lst) { lst.style.display = 'none'; lst.innerHTML = ''; }
        var ut = document.getElementById('newIdeaMercadoUseText'); if (ut) ut.style.display = 'none';
        document.getElementById('newIdeaEtiquetas').value = '';
        document.getElementById('newIdeaInspiracion').value = '';
        document.getElementById('newIdeaValor').value = '';
        updateNiLabel('tipo');
        updateNiLabel('potencial');
        updateNiLabel('mercado');
        renderNiPicker('tipo');
        renderNiPicker('potencial');
        validateNiForm();
        var crumb = document.querySelector('#widgetNuevaIdea .wn-ctw-crumb-current');
        if (crumb) crumb.textContent = 'Capturar idea';
        var sub = document.getElementById('niSubmitBtn');
        if (sub) {
            sub.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Capturar idea';
        }
        ov.classList.add('active');
        ov.style.display = 'flex';
        setTimeout(function () { document.getElementById('newIdeaTitulo').focus(); }, 30);
    }

    /* Validación live: el botón submit sigue gris hasta que título, tipo,
       descripción y mercado estén llenos. Se llama desde cada `input` evento. */
    function validateNiForm() {
        var titulo = (document.getElementById('newIdeaTitulo') || {}).value || '';
        var desc = (document.getElementById('newIdeaDescripcion') || {}).value || '';
        var mercado = (document.getElementById('newIdeaMercado') || {}).value || '';
        var ok = titulo.trim() && desc.trim() && mercado.trim() && STATE.creating.tipo;
        var btn = document.getElementById('niSubmitBtn');
        if (!btn) return;
        if (ok) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.style.background = '';
        } else {
            btn.disabled = true;
            btn.style.opacity = '0.55';
            btn.style.cursor = 'not-allowed';
            btn.style.background = '#CBD5E1';
        }
    }

    /* ─── Cliente picker del form de creación ─── */
    function wireMercadoPicker() {
        var sb = document.getElementById('newIdeaMercadoSearch');
        var list = document.getElementById('newIdeaMercadoList');
        var useTextBtn = document.getElementById('newIdeaMercadoUseText');
        if (!sb || !list) return;
        var timer = null;
        sb.addEventListener('input', function () {
            clearTimeout(timer);
            var q = sb.value.trim();
            if (useTextBtn) useTextBtn.style.display = q ? '' : 'none';
            if (q.length < 2) { list.style.display = 'none'; return; }
            timer = setTimeout(function () {
                fetch('/app/api/buscar-clientes/?q=' + encodeURIComponent(q), {credentials: 'same-origin'})
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        var items = data.clientes || data.results || [];
                        if (!items.length) {
                            list.innerHTML = '<div style="padding:8px;color:#9CA3AF;font-size:0.84rem;">Sin resultados — usa "Usar texto libre" para guardar como mercado.</div>';
                            list.style.display = 'block';
                            return;
                        }
                        list.innerHTML = items.slice(0, 8).map(function (c) {
                            var name = c.nombre_empresa || c.nombre || c.text || '';
                            return '<div data-cli="' + c.id + '" data-name="' + esc(name) + '" '
                                + 'style="padding:7px 10px;cursor:pointer;border-radius:6px;font-size:0.86rem;">'
                                + esc(name) + '</div>';
                        }).join('');
                        list.querySelectorAll('[data-cli]').forEach(function (row) {
                            row.addEventListener('click', function () {
                                document.getElementById('newIdeaClienteId').value = row.getAttribute('data-cli');
                                document.getElementById('newIdeaMercado').value = row.getAttribute('data-name');
                                sb.value = row.getAttribute('data-name');
                                list.style.display = 'none';
                                updateNiLabel('mercado');
                                validateNiForm();
                                hideAllNiPops();
                            });
                            row.addEventListener('mouseenter', function () { row.style.background = 'rgba(91,33,182,0.08)'; });
                            row.addEventListener('mouseleave', function () { row.style.background = ''; });
                        });
                        list.style.display = 'block';
                    }).catch(function () { list.style.display = 'none'; });
            }, 220);
        });
        if (useTextBtn) {
            useTextBtn.addEventListener('click', function () {
                var v = sb.value.trim();
                if (!v) return;
                document.getElementById('newIdeaClienteId').value = '';
                document.getElementById('newIdeaMercado').value = v;
                list.style.display = 'none';
                updateNiLabel('mercado');
                validateNiForm();
                hideAllNiPops();
            });
        }
    }
    window.cerrarWidgetNuevaIdea = function () {
        var ov = document.getElementById('widgetNuevaIdea');
        if (!ov) return;
        ov.classList.remove('active');
        ov.style.display = 'none';
    };
    function renderNiPicker(which) {
        var src = which === 'tipo' ? TIPOS : POTENCIAL;
        var list = document.getElementById(which === 'tipo' ? 'newIdeaTipoList' : 'newIdeaPotencialList');
        if (!list) return;
        list.innerHTML = src.map(function (item) {
            var on = (which === 'tipo' ? STATE.creating.tipo : STATE.creating.potencial) === item.id;
            return '<button type="button" data-pick="' + which + '" data-val="' + esc(item.id) + '" '
                + 'style="text-align:left;padding:8px 12px;border-radius:8px;border:1px solid ' + (on ? '#8B5CF6' : '#E5E7EB') + ';'
                + 'background:' + (on ? '#F5F3FF' : '#FFFFFF') + ';cursor:pointer;font-size:0.86rem;color:#1D1D1F;font-weight:500;">'
                + esc(item.label)
                + (on ? '<span style="float:right;color:#8B5CF6;">✓</span>' : '')
                + '</button>';
        }).join('');
        list.querySelectorAll('[data-pick]').forEach(function (b) {
            b.addEventListener('click', function () {
                var w = b.getAttribute('data-pick');
                var v = b.getAttribute('data-val');
                if (w === 'tipo') STATE.creating.tipo = v;
                else if (w === 'potencial') STATE.creating.potencial = v;
                updateNiLabel(w);
                renderNiPicker(w);
                hideAllNiPops();
                validateNiForm();
            });
        });
    }
    function updateNiLabel(which) {
        if (which === 'tipo') {
            var t = TIPOS.find(function (x) { return x.id === STATE.creating.tipo; });
            var el = document.querySelector('[data-niact-label="tipo"]');
            if (el) el.textContent = 'Tipo: ' + (t ? t.label : '—');
        } else if (which === 'potencial') {
            var p = POTENCIAL.find(function (x) { return x.id === STATE.creating.potencial; });
            var el2 = document.querySelector('[data-niact-label="potencial"]');
            if (el2) el2.textContent = 'Potencial: ' + (p ? p.label : '—');
        } else if (which === 'mercado') {
            var inp = document.getElementById('newIdeaMercado');
            var v = inp ? inp.value : '';
            var el3 = document.querySelector('[data-niact-label="mercado"]');
            if (el3) el3.textContent = v ? ('Mercado: ' + v.substring(0, 28) + (v.length > 28 ? '…' : '')) : 'Mercado: selecciona…';
        }
    }
    function hideAllNiPops() {
        document.querySelectorAll('[data-niact-pop]').forEach(function (p) { p.style.display = 'none'; });
    }
    window.niOpenPop = function (which, ev) {
        if (ev) ev.stopPropagation();
        var pop = document.querySelector('[data-niact-pop="' + which + '"]');
        if (!pop) return;
        var willOpen = pop.style.display !== 'block';
        hideAllNiPops();
        if (willOpen) pop.style.display = 'block';
    };
    document.addEventListener('click', function (e) {
        if (!e.target.closest('[data-niact-pop]') && !e.target.closest('[data-niact]')) {
            hideAllNiPops();
        }
    });

    function readValorEstimado() {
        var inp = document.getElementById('newIdeaValor');
        if (!inp) return null;
        var v = parseFloat(inp.value);
        return isNaN(v) ? null : v;
    }

    function submitNuevaIdea() {
        var titulo = document.getElementById('newIdeaTitulo').value.trim();
        var desc = document.getElementById('newIdeaDescripcion').value.trim();
        var mercado = document.getElementById('newIdeaMercado').value.trim();
        var clienteIdRaw = (document.getElementById('newIdeaClienteId') || {}).value || '';
        if (!titulo || !desc || !mercado) {
            showFlash('Faltan campos obligatorios', 'error');
            return;
        }
        var payload = {
            titulo: titulo,
            descripcion: desc,
            tipo: STATE.creating.tipo,
            potencial_comercial: STATE.creating.potencial,
            valor_estimado: readValorEstimado(),
            mercado_objetivo: mercado,
            cliente_id: clienteIdRaw ? parseInt(clienteIdRaw, 10) : null,
            inspiracion: document.getElementById('newIdeaInspiracion').value.trim(),
            etiquetas: document.getElementById('newIdeaEtiquetas').value.trim(),
        };
        var btn = document.getElementById('niSubmitBtn');
        if (btn) btn.disabled = true;
        api('/app/api/ideas/crear/', {
            method: 'POST',
            body: JSON.stringify(payload),
        }).then(function (res) {
            if (!res.ok || !res.data.ok) {
                showFlash(res.data.error || 'No se pudo crear', 'error');
                return;
            }
            showFlash('Idea capturada');
            window.cerrarWidgetNuevaIdea();
            fetchKanban();
        }).finally(function () { if (btn) btn.disabled = false; });
    }

    /* ─── Detalle de idea ─── */
    function openIdeaDetail(ideaId) {
        var ov = document.getElementById('widgetIdea');
        if (!ov) return;
        document.getElementById('ideaLoading').style.display = '';
        document.getElementById('ideaContent').style.display = 'none';
        ov.classList.add('active');
        ov.style.display = 'flex';
        api('/app/api/ideas/' + ideaId + '/').then(function (res) {
            if (!res.ok || !res.data.ok) {
                showFlash(res.data.error || 'No se pudo cargar', 'error');
                closeIdeaDetail();
                return;
            }
            STATE.currentIdea = res.data.idea;
            renderIdeaDetail();
        });
    }
    function closeIdeaDetail() {
        var ov = document.getElementById('widgetIdea');
        if (!ov) return;
        ov.classList.remove('active');
        ov.style.display = 'none';
        STATE.currentIdea = null;
    }
    function renderIdeaDetail() {
        var i = STATE.currentIdea;
        if (!i) return;
        document.getElementById('ideaLoading').style.display = 'none';
        document.getElementById('ideaContent').style.display = 'flex';
        document.getElementById('wiTitulo').textContent = i.titulo;
        document.getElementById('wiTipo').textContent = i.tipo_display || i.tipo;
        document.getElementById('wiPotencial').textContent = i.potencial_display || i.potencial_comercial;
        document.getElementById('wiValor').textContent = i.valor_estimado != null ? fmtMoney(i.valor_estimado) : '—';
        document.getElementById('wiMercado').textContent = (i.cliente && i.cliente.nombre) || i.mercado_objetivo || '—';
        document.getElementById('wiAutor').textContent = (i.autor && i.autor.nombre) || '—';
        document.getElementById('wiFecha').textContent = fmtFecha(i.fecha_creacion);
        document.getElementById('wiDescripcion').textContent = i.descripcion || '—';
        document.getElementById('wiInspiracion').textContent = i.inspiracion || '—';
        var tags = i.etiquetas || [];
        document.getElementById('wiEtiquetas').innerHTML = tags.length
            ? tags.map(function (t) { return '<span class="idea-card-tag" style="margin-right:4px;">' + esc(t) + '</span>'; }).join('')
            : '—';

        // Vendedor / autor block
        var vAv = document.getElementById('wiVendedorAvatar');
        var vN = document.getElementById('wiVendedorNombre');
        if (vAv) vAv.textContent = (i.autor && i.autor.iniciales) || '?';
        if (vN) vN.textContent = (i.autor && i.autor.nombre) || '—';
        // Cliente / mercado block
        var cAv = document.getElementById('wiClienteAvatar');
        var cN = document.getElementById('wiClienteNombre');
        var clienteName = (i.cliente && i.cliente.nombre) || i.mercado_objetivo || '—';
        if (cN) cN.textContent = clienteName;
        if (cAv) {
            var initials = clienteName === '—' ? '—' :
                clienteName.split(/\s+/).slice(0, 2).map(function (s) { return (s[0] || '').toUpperCase(); }).join('') || '?';
            cAv.textContent = initials;
        }

        // Pipeline (Apple Intelligence gradient en la etapa activa)
        var pipe = document.getElementById('wiPipelineStages');
        pipe.innerHTML = ETAPAS.map(function (et) {
            var on = et.key === i.etapa;
            return '<button type="button" data-set-etapa="' + esc(et.key) + '" class="idea-pipeline-stage' + (on ? ' active' : '') + '">'
                + esc(et.label) + '</button>';
        }).join('');
        pipe.querySelectorAll('[data-set-etapa]').forEach(function (b) {
            b.addEventListener('click', function () {
                var nueva = b.getAttribute('data-set-etapa');
                if (nueva === i.etapa) return;
                // Si va a "convertida" sin prospecto, moverEtapa abre el modal
                // de conversión y NO actualiza la etapa hasta que se confirme.
                if (nueva === 'convertida' && !i.prospecto_creado_id) {
                    moverEtapa(i.id, nueva);
                    return;
                }
                moverEtapa(i.id, nueva);
                i.etapa = nueva;
                renderIdeaDetail();
            });
        });

        // Actividades del calendario
        renderActividades(i.actividades || []);

        // Comentarios
        var list = document.getElementById('wiComentariosList');
        var coms = i.comentarios || [];
        list.innerHTML = coms.length
            ? coms.map(function (c) {
                return '<div style="background:#F9FAFB;border-radius:10px;padding:8px 12px;">'
                    + '<div style="display:flex;justify-content:space-between;font-size:0.72rem;color:#6B7280;margin-bottom:2px;">'
                    + '<strong>' + esc((c.usuario && c.usuario.nombre) || '?') + '</strong>'
                    + '<span>' + fmtFecha(c.fecha) + '</span>'
                    + '</div>'
                    + '<div style="font-size:0.85rem;color:#1D1D1F;white-space:pre-wrap;">' + esc(c.texto) + '</div>'
                    + '</div>';
              }).join('')
            : '<div style="font-size:0.82rem;color:#9CA3AF;font-style:italic;padding:8px 0;">Aún no hay comentarios.</div>';

        // Convertida info: solo se muestra si ya tiene prospecto_creado.
        var convInfo = document.getElementById('wiConvertidaInfo');
        if (convInfo) {
            if (i.prospecto_creado_id) {
                convInfo.style.display = 'inline-flex';
                var link = document.getElementById('wiVerProspectoLink');
                if (link) link.href = '/app/todos/?tab=prospectos#prospecto-' + i.prospecto_creado_id;
            } else {
                convInfo.style.display = 'none';
            }
        }
    }

    /* ─── Actividades del calendario ─── */
    function renderActividades(acts) {
        var list = document.getElementById('wiActividadesList');
        if (!list) return;
        if (!acts.length) {
            list.innerHTML = '<div style="font-size:0.82rem;color:#9CA3AF;font-style:italic;padding:8px 0;">Sin actividades agendadas. Captura una desde el botón Agendar.</div>';
            return;
        }
        list.innerHTML = acts.map(function (a) {
            var d = a.fecha_inicio ? new Date(a.fecha_inicio) : null;
            var fechaFmt = d ? d.toLocaleString('es-MX', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}) : 'Sin fecha';
            return '<div class="idea-act-row' + (a.completada ? ' is-done' : '') + '">'
                + '  <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">'
                + '    <svg width="14" height="14" fill="none" stroke="' + (a.completada ? '#16A34A' : '#5E5CE6') + '" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>'
                + '    <div style="display:flex;flex-direction:column;min-width:0;">'
                + '      <span style="font-weight:600;color:#1D1D1F;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(a.titulo) + '</span>'
                + '      <span class="idea-act-meta">' + esc(fechaFmt) + ((a.creado_por && a.creado_por.nombre) ? ' · por ' + esc(a.creado_por.nombre) : '') + '</span>'
                + '    </div>'
                + '  </div>'
                + '</div>';
        }).join('');
    }

    function openActividadForm() {
        var f = document.getElementById('wiActividadForm');
        if (!f) return;
        f.style.display = '';
        // Defaults: fecha hoy, hora actual + 1h
        var t = document.getElementById('wiActTitulo');
        var d = document.getElementById('wiActFecha');
        var h = document.getElementById('wiActHora');
        var now = new Date();
        if (d) d.value = now.toISOString().substring(0, 10);
        if (h) {
            var hh = String(now.getHours()).padStart(2, '0');
            var mm = String(now.getMinutes()).padStart(2, '0');
            h.value = hh + ':' + mm;
        }
        if (t) { t.value = ''; setTimeout(function () { t.focus(); }, 30); }
    }
    function submitActividad() {
        var i = STATE.currentIdea;
        if (!i) return;
        var titulo = document.getElementById('wiActTitulo').value.trim();
        var fecha = document.getElementById('wiActFecha').value;
        var hora = document.getElementById('wiActHora').value;
        if (!titulo || !fecha || !hora) {
            showFlash('Título, fecha y hora son requeridos', 'error');
            return;
        }
        // Construir inicio y fin (default duración = 1h).
        var startIso = fecha + 'T' + hora + ':00';
        var startDt = new Date(startIso);
        var endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
        function localIso(d) {
            var p = function (n) { return String(n).padStart(2, '0'); };
            return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
                + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':00';
        }
        var payload = {
            title: titulo,
            description: 'Actividad ligada a idea "' + i.titulo + '"',
            tipo: 'tarea',
            start: localIso(startDt),
            end: localIso(endDt),
            color: '#5E5CE6',
            participants: [],
            idea: i.id,
        };
        var btn = document.getElementById('wiActGuardar');
        if (btn) btn.disabled = true;
        api('/app/api/actividades/', {
            method: 'POST',
            body: JSON.stringify(payload),
        }).then(function (res) {
            if (!res.ok || res.data.error) {
                showFlash(res.data.error || 'No se pudo agendar', 'error');
                return;
            }
            showFlash('Actividad agendada');
            document.getElementById('wiActividadForm').style.display = 'none';
            // Append local sin re-fetch del detalle
            i.actividades = i.actividades || [];
            i.actividades.push({
                id: res.data.id,
                titulo: res.data.title || titulo,
                tipo_actividad: res.data.tipo || 'tarea',
                fecha_inicio: res.data.start || startDt.toISOString(),
                fecha_fin: res.data.end || endDt.toISOString(),
                descripcion: res.data.description || '',
                color: res.data.color || '#5E5CE6',
                completada: false,
                creado_por: res.data.creado_por || null,
            });
            renderActividades(i.actividades);
        }).finally(function () { if (btn) btn.disabled = false; });
    }

    function comentarIdea() {
        var i = STATE.currentIdea;
        if (!i) return;
        var inp = document.getElementById('wiComentarioInput');
        var texto = inp.value.trim();
        if (!texto) return;
        api('/app/api/ideas/' + i.id + '/comentar/', {
            method: 'POST',
            body: JSON.stringify({texto: texto}),
        }).then(function (res) {
            if (!res.ok || !res.data.ok) {
                showFlash(res.data.error || 'No se pudo comentar', 'error');
                return;
            }
            i.comentarios = i.comentarios || [];
            i.comentarios.push(res.data.comentario);
            inp.value = '';
            renderIdeaDetail();
        });
    }

    function eliminarIdea() {
        var i = STATE.currentIdea;
        if (!i) return;
        if (!confirm('¿Eliminar la idea "' + i.titulo + '"? Esta acción no se puede deshacer.')) return;
        api('/app/api/ideas/' + i.id + '/', {method: 'DELETE'}).then(function (res) {
            if (!res.ok || !res.data.ok) {
                showFlash(res.data.error || 'No se pudo eliminar', 'error');
                return;
            }
            showFlash('Idea eliminada');
            closeIdeaDetail();
            fetchKanban();
        });
    }

    /* ─── Convertir idea → prospección ─── */
    function abrirConvertir() {
        var i = STATE.currentIdea;
        if (!i) return;
        if (i.prospecto_creado_id) return;
        var ov = document.getElementById('widgetIdeaConvertir');
        if (!ov) return;
        document.getElementById('wiCnvClienteSearch').value = '';
        document.getElementById('wiCnvClienteId').value = '';
        document.getElementById('wiCnvClienteList').innerHTML = '';
        document.getElementById('wiCnvClienteList').style.display = 'none';
        document.getElementById('wiCnvOk').disabled = true;
        ov.style.display = 'flex';
        setTimeout(function () { document.getElementById('wiCnvClienteSearch').focus(); }, 30);
    }
    function cerrarConvertir() {
        var ov = document.getElementById('widgetIdeaConvertir');
        if (ov) ov.style.display = 'none';
    }
    function buscarClienteConv(q) {
        q = (q || '').trim();
        var list = document.getElementById('wiCnvClienteList');
        if (q.length < 2) { list.style.display = 'none'; list.innerHTML = ''; return; }
        fetch('/app/api/buscar-clientes/?q=' + encodeURIComponent(q), {credentials: 'same-origin'})
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var items = data.clientes || data.results || [];
                if (!items.length) {
                    list.innerHTML = '<div style="padding:10px;color:#9CA3AF;font-size:0.84rem;">Sin resultados</div>';
                    list.style.display = 'block';
                    return;
                }
                list.innerHTML = items.slice(0, 8).map(function (c) {
                    return '<div data-cli="' + c.id + '" data-name="' + esc(c.nombre_empresa || c.nombre || c.text || '') + '" '
                        + 'style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #F2F2F7;font-size:0.86rem;">'
                        + esc(c.nombre_empresa || c.nombre || c.text || '') + '</div>';
                }).join('');
                list.querySelectorAll('[data-cli]').forEach(function (row) {
                    row.addEventListener('click', function () {
                        document.getElementById('wiCnvClienteId').value = row.getAttribute('data-cli');
                        document.getElementById('wiCnvClienteSearch').value = row.getAttribute('data-name');
                        list.style.display = 'none';
                        document.getElementById('wiCnvOk').disabled = false;
                    });
                });
                list.style.display = 'block';
            }).catch(function () { list.style.display = 'none'; });
    }
    function confirmarConvertir() {
        var i = STATE.currentIdea;
        if (!i) return;
        var cid = document.getElementById('wiCnvClienteId').value;
        if (!cid) return;
        var btn = document.getElementById('wiCnvOk');
        btn.disabled = true;
        api('/app/api/ideas/' + i.id + '/convertir/', {
            method: 'POST',
            body: JSON.stringify({cliente_id: parseInt(cid, 10)}),
        }).then(function (res) {
            if (!res.ok || !res.data.ok) {
                showFlash(res.data.error || 'No se pudo convertir', 'error');
                btn.disabled = false;
                return;
            }
            showFlash('Idea convertida en prospección');
            cerrarConvertir();
            STATE.currentIdea = res.data.idea;
            STATE.currentIdea.prospecto_creado_id = res.data.prospecto_id;
            renderIdeaDetail();
            fetchKanban();
        });
    }

    /* ─── Editar idea (reusa el modal en modo edición) ─── */
    function editarIdea() {
        var i = STATE.currentIdea;
        if (!i) return;
        openNuevaIdea();
        STATE.editingId = i.id;
        document.querySelector('#widgetNuevaIdea .wn-ctw-crumb-current').textContent = 'Editar idea';
        document.getElementById('niSubmitBtn').innerHTML =
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Guardar cambios';
        document.getElementById('newIdeaTitulo').value = i.titulo || '';
        document.getElementById('newIdeaDescripcion').value = i.descripcion || '';
        document.getElementById('newIdeaMercado').value = i.mercado_objetivo || '';
        document.getElementById('newIdeaEtiquetas').value = (i.etiquetas || []).join(', ');
        document.getElementById('newIdeaInspiracion').value = i.inspiracion || '';
        document.getElementById('newIdeaValor').value = i.valor_estimado != null ? i.valor_estimado : '';
        STATE.creating.tipo = i.tipo;
        STATE.creating.potencial = i.potencial_comercial;
        updateNiLabel('tipo');
        updateNiLabel('potencial');
        renderNiPicker('tipo');
        renderNiPicker('potencial');
        validateNiForm();
    }

    function submitNiSwitch() {
        if (STATE.editingId) {
            var id = STATE.editingId;
            var titulo = document.getElementById('newIdeaTitulo').value.trim();
            var desc = document.getElementById('newIdeaDescripcion').value.trim();
            var mercado = document.getElementById('newIdeaMercado').value.trim();
            if (!titulo || !desc || !mercado) {
                showFlash('Faltan campos obligatorios', 'error');
                return;
            }
            var payload = {
                titulo: titulo,
                descripcion: desc,
                tipo: STATE.creating.tipo,
                potencial_comercial: STATE.creating.potencial,
                valor_estimado: readValorEstimado(),
                mercado_objetivo: mercado,
                inspiracion: document.getElementById('newIdeaInspiracion').value.trim(),
                etiquetas: document.getElementById('newIdeaEtiquetas').value.trim(),
            };
            api('/app/api/ideas/' + id + '/', {
                method: 'PATCH',
                body: JSON.stringify(payload),
            }).then(function (res) {
                if (!res.ok || !res.data.ok) {
                    showFlash(res.data.error || 'No se pudo guardar', 'error');
                    return;
                }
                showFlash('Cambios guardados');
                STATE.editingId = null;
                window.cerrarWidgetNuevaIdea();
                if (STATE.currentIdea && STATE.currentIdea.id === id) {
                    STATE.currentIdea = Object.assign({}, STATE.currentIdea, res.data.idea);
                    renderIdeaDetail();
                }
                fetchKanban();
            });
        } else {
            submitNuevaIdea();
        }
    }

    /* ─── Wire events del widget detalle + modal ─── */
    function wireDetailEvents() {
        var closeBtn = document.getElementById('ideaCloseBtn');
        if (closeBtn) closeBtn.addEventListener('click', closeIdeaDetail);
        var ov = document.getElementById('widgetIdea');
        if (ov) ov.addEventListener('click', function (e) { if (e.target === ov) closeIdeaDetail(); });

        var elim = document.getElementById('wiEliminarBtn');
        if (elim) elim.addEventListener('click', eliminarIdea);
        var edit = document.getElementById('wiEditarBtn');
        if (edit) edit.addEventListener('click', editarIdea);

        var cBtn = document.getElementById('wiComentarBtn');
        if (cBtn) cBtn.addEventListener('click', comentarIdea);

        var addActBtn = document.getElementById('wiAddActBtn');
        if (addActBtn) addActBtn.addEventListener('click', openActividadForm);
        var actGuardar = document.getElementById('wiActGuardar');
        if (actGuardar) actGuardar.addEventListener('click', submitActividad);

        var cnvCancel = document.getElementById('wiCnvCancel');
        if (cnvCancel) cnvCancel.addEventListener('click', cerrarConvertir);
        var cnvOk = document.getElementById('wiCnvOk');
        if (cnvOk) cnvOk.addEventListener('click', confirmarConvertir);
        var cnvSearch = document.getElementById('wiCnvClienteSearch');
        if (cnvSearch) {
            var timer = null;
            cnvSearch.addEventListener('input', function () {
                clearTimeout(timer);
                timer = setTimeout(function () { buscarClienteConv(cnvSearch.value); }, 220);
                document.getElementById('wiCnvClienteId').value = '';
                document.getElementById('wiCnvOk').disabled = true;
            });
        }

        // Modal nueva/editar idea
        var niClose = document.getElementById('niCloseBtn');
        if (niClose) niClose.addEventListener('click', window.cerrarWidgetNuevaIdea);
        var niCancel = document.getElementById('niCancelBtn');
        if (niCancel) niCancel.addEventListener('click', window.cerrarWidgetNuevaIdea);
        var niSubmit = document.getElementById('niSubmitBtn');
        if (niSubmit) niSubmit.addEventListener('click', submitNiSwitch);
        // Validación live: cada input obligatorio dispara validateNiForm.
        ['newIdeaTitulo', 'newIdeaDescripcion', 'newIdeaMercado'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('input', validateNiForm);
        });
    }

    /* ─── Click-to-edit en el widget de detalle ─── */
    function patchIdea(payload, onDone) {
        var i = STATE.currentIdea;
        if (!i) return;
        api('/app/api/ideas/' + i.id + '/', {
            method: 'PATCH',
            body: JSON.stringify(payload),
        }).then(function (res) {
            if (!res.ok || !res.data.ok) {
                showFlash(res.data.error || 'No se pudo guardar', 'error');
                return;
            }
            STATE.currentIdea = Object.assign({}, STATE.currentIdea, res.data.idea);
            renderIdeaDetail();
            fetchKanban();
            if (typeof onDone === 'function') onDone();
        });
    }

    function startInlineEdit(el) {
        if (!el || el.classList.contains('is-editing')) return;
        var field = el.getAttribute('data-edit-field');
        var kind = el.getAttribute('data-edit-kind') || 'text';
        if (!field) return;
        var i = STATE.currentIdea;
        if (!i) return;

        // Cliente picker es un popup, no un input inline.
        if (kind === 'cliente') {
            startClientePicker(el);
            return;
        }

        var current;
        if (kind === 'number') current = (i[field] != null ? i[field] : '');
        else if (kind === 'select' && field === 'tipo') current = i.tipo;
        else if (kind === 'select' && field === 'potencial_comercial') current = i.potencial_comercial;
        else if (field === 'etiquetas') current = (i.etiquetas || []).join(', ');
        else if (field === 'titulo') current = i.titulo || '';
        else current = i[field] || '';

        var inp;
        if (kind === 'select') {
            inp = document.createElement('select');
            inp.className = 'idea-edit-input';
            var opts = field === 'tipo' ? TIPOS : POTENCIAL;
            opts.forEach(function (o) {
                var opt = document.createElement('option');
                opt.value = o.id;
                opt.textContent = o.label;
                if (o.id === current) opt.selected = true;
                inp.appendChild(opt);
            });
        } else if (kind === 'textarea') {
            inp = document.createElement('textarea');
            inp.className = 'idea-edit-input';
            inp.rows = Math.max(3, Math.min(8, (current.split('\n').length + 1)));
            inp.value = current;
        } else if (kind === 'number') {
            inp = document.createElement('input');
            inp.type = 'number';
            inp.min = '0';
            inp.step = '1000';
            inp.className = 'idea-edit-input';
            inp.value = current;
        } else {
            inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'idea-edit-input';
            inp.value = current;
        }

        var originalHtml = el.innerHTML;
        el.innerHTML = '';
        el.appendChild(inp);
        el.classList.add('is-editing');
        inp.focus();
        if (inp.select) inp.select();

        var finished = false;
        function commit() {
            if (finished) return;
            finished = true;
            var newVal = inp.value;
            if (kind === 'number') {
                newVal = newVal === '' ? null : parseFloat(newVal);
                if (isNaN(newVal)) newVal = null;
            }
            // Si no cambió, revertir.
            var changed = String(newVal == null ? '' : newVal) !== String(current == null ? '' : current);
            if (!changed) { el.classList.remove('is-editing'); el.innerHTML = originalHtml; return; }
            var payload = {};
            payload[field] = newVal;
            patchIdea(payload, function () {
                el.classList.remove('is-editing');
            });
        }
        function cancel() {
            finished = true;
            el.classList.remove('is-editing');
            el.innerHTML = originalHtml;
        }
        inp.addEventListener('blur', commit);
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && kind !== 'textarea') { e.preventDefault(); inp.blur(); }
            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); inp.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        if (kind === 'select') {
            inp.addEventListener('change', function () { inp.blur(); });
        }
    }

    function startClientePicker(el) {
        // Popup compacto con búsqueda. Coloca al lado del campo.
        var existing = document.querySelector('.idea-edit-cliente-pop');
        if (existing) existing.remove();
        var pop = document.createElement('div');
        pop.className = 'idea-edit-cliente-pop';
        pop.innerHTML =
            '<input type="text" placeholder="Buscar cliente…" autocomplete="off">'
            + '<div class="idea-edit-cliente-pop-list" style="display:none;"></div>'
            + '<button type="button" data-action="clear" style="margin-top:6px;background:#F1F5F9;border:none;padding:6px 10px;border-radius:6px;font-size:0.8rem;cursor:pointer;width:100%;color:#475569;">Quitar cliente</button>';
        document.body.appendChild(pop);
        var rect = el.getBoundingClientRect();
        pop.style.left = (rect.left + window.scrollX) + 'px';
        pop.style.top = (rect.bottom + window.scrollY) + 'px';
        var search = pop.querySelector('input');
        var list = pop.querySelector('.idea-edit-cliente-pop-list');
        search.focus();
        var timer = null;
        search.addEventListener('input', function () {
            clearTimeout(timer);
            var q = search.value.trim();
            if (q.length < 2) { list.style.display = 'none'; return; }
            timer = setTimeout(function () {
                fetch('/app/api/buscar-clientes/?q=' + encodeURIComponent(q), {credentials: 'same-origin'})
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        var items = data.clientes || data.results || [];
                        if (!items.length) {
                            list.innerHTML = '<div style="color:#9CA3AF;">Sin resultados</div>';
                            list.style.display = 'block';
                            return;
                        }
                        list.innerHTML = items.slice(0, 8).map(function (c) {
                            return '<div data-cli="' + c.id + '" data-name="' + esc(c.nombre_empresa || c.nombre || '') + '">' + esc(c.nombre_empresa || c.nombre || '') + '</div>';
                        }).join('');
                        list.querySelectorAll('[data-cli]').forEach(function (row) {
                            row.addEventListener('click', function () {
                                var cid = parseInt(row.getAttribute('data-cli'), 10);
                                pop.remove();
                                patchIdea({cliente_id: cid});
                            });
                        });
                        list.style.display = 'block';
                    });
            }, 220);
        });
        pop.querySelector('[data-action="clear"]').addEventListener('click', function () {
            pop.remove();
            patchIdea({cliente_id: null, mercado_objetivo: ''});
        });
        // Click fuera cierra
        setTimeout(function () {
            document.addEventListener('click', function close(e) {
                if (!pop.contains(e.target) && e.target !== el) {
                    pop.remove();
                    document.removeEventListener('click', close);
                }
            });
        }, 0);
    }

    function wireClickToEdit() {
        var content = document.getElementById('ideaContent');
        if (!content) return;
        content.addEventListener('click', function (e) {
            var el = e.target.closest('.idea-edit-field');
            if (!el || el.classList.contains('is-editing')) return;
            startInlineEdit(el);
        });
    }

    /* ─── Filtros y orden (popovers del topbar izquierdo) ─── */
    var FILTROS = { tipo: null, potencial: null };
    var SORT_KEY = 'recientes'; // 'recientes' | 'valor_desc' | 'valor_asc' | 'alfa'

    function buildFilterPop() {
        var pop = document.getElementById('ideasPopFilter');
        if (!pop) return;
        var html = '<div class="ideas-pop-section">Tipo</div>';
        html += '<button type="button" class="ideas-pop-option' + (FILTROS.tipo == null ? ' is-on' : '') + '" data-filter-tipo="">Todos</button>';
        TIPOS.forEach(function (t) {
            html += '<button type="button" class="ideas-pop-option' + (FILTROS.tipo === t.id ? ' is-on' : '') + '" data-filter-tipo="' + esc(t.id) + '">' + esc(t.label) + '</button>';
        });
        html += '<div class="ideas-pop-section">Potencial</div>';
        html += '<button type="button" class="ideas-pop-option' + (FILTROS.potencial == null ? ' is-on' : '') + '" data-filter-pot="">Todos</button>';
        POTENCIAL.forEach(function (p) {
            html += '<button type="button" class="ideas-pop-option' + (FILTROS.potencial === p.id ? ' is-on' : '') + '" data-filter-pot="' + esc(p.id) + '">' + esc(p.label) + '</button>';
        });
        pop.innerHTML = html;
        pop.querySelectorAll('[data-filter-tipo]').forEach(function (b) {
            b.addEventListener('click', function () {
                FILTROS.tipo = b.getAttribute('data-filter-tipo') || null;
                applyFiltros();
            });
        });
        pop.querySelectorAll('[data-filter-pot]').forEach(function (b) {
            b.addEventListener('click', function () {
                FILTROS.potencial = b.getAttribute('data-filter-pot') || null;
                applyFiltros();
            });
        });
    }
    function buildSortPop() {
        var pop = document.getElementById('ideasPopSort');
        if (!pop) return;
        var opts = [
            {id: 'recientes',  label: 'Más recientes'},
            {id: 'valor_desc', label: 'Mayor valor estimado'},
            {id: 'valor_asc',  label: 'Menor valor estimado'},
            {id: 'alfa',       label: 'Alfabético'},
        ];
        var html = opts.map(function (o) {
            return '<button type="button" class="ideas-pop-option' + (SORT_KEY === o.id ? ' is-on' : '') + '" data-sort="' + esc(o.id) + '">' + esc(o.label) + '</button>';
        }).join('');
        pop.innerHTML = html;
        pop.querySelectorAll('[data-sort]').forEach(function (b) {
            b.addEventListener('click', function () {
                SORT_KEY = b.getAttribute('data-sort');
                document.getElementById('ideasSortLabel').textContent =
                    'Ordenar: ' + (b.textContent || '').trim();
                applyFiltros();
                pop.style.display = 'none';
            });
        });
    }
    function applyFiltros() {
        // Aplica los filtros locales sobre STATE.ideas_por_etapa y re-renderea.
        // Mantiene una copia "raw" en _rawByEtapa para no perder datos.
        if (!STATE._rawByEtapa) STATE._rawByEtapa = JSON.parse(JSON.stringify(STATE.ideas_por_etapa));
        var filtered = {};
        Object.keys(STATE._rawByEtapa).forEach(function (etapa) {
            var items = (STATE._rawByEtapa[etapa] || []).filter(function (i) {
                if (FILTROS.tipo && i.tipo !== FILTROS.tipo) return false;
                if (FILTROS.potencial && i.potencial_comercial !== FILTROS.potencial) return false;
                return true;
            });
            // Sort
            items.sort(function (a, b) {
                if (SORT_KEY === 'recientes') {
                    return (b.fecha_creacion || '').localeCompare(a.fecha_creacion || '');
                }
                if (SORT_KEY === 'valor_desc') return (b.valor_estimado || 0) - (a.valor_estimado || 0);
                if (SORT_KEY === 'valor_asc') return (a.valor_estimado || 0) - (b.valor_estimado || 0);
                if (SORT_KEY === 'alfa') return (a.titulo || '').localeCompare(b.titulo || '');
                return 0;
            });
            filtered[etapa] = items;
        });
        STATE.ideas_por_etapa = filtered;
        renderKanban();
        // Mostrar "Limpiar" si hay filtros activos.
        var clear = document.getElementById('ideasBtnClear');
        if (clear) clear.style.display = (FILTROS.tipo || FILTROS.potencial || SORT_KEY !== 'recientes') ? '' : 'none';
        buildFilterPop();
        buildSortPop();
    }

    function wireTopbarFilters() {
        var filtroBtn = document.getElementById('ideasBtnFiltro');
        var sortBtn = document.getElementById('ideasBtnOrdenar');
        var filtroPop = document.getElementById('ideasPopFilter');
        var sortPop = document.getElementById('ideasPopSort');
        var clearBtn = document.getElementById('ideasBtnClear');
        if (filtroBtn && filtroPop) {
            filtroBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var willOpen = filtroPop.style.display !== 'block';
                if (sortPop) sortPop.style.display = 'none';
                filtroPop.style.display = willOpen ? 'block' : 'none';
                if (willOpen) buildFilterPop();
            });
        }
        if (sortBtn && sortPop) {
            sortBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var willOpen = sortPop.style.display !== 'block';
                if (filtroPop) filtroPop.style.display = 'none';
                sortPop.style.display = willOpen ? 'block' : 'none';
                if (willOpen) buildSortPop();
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                FILTROS = {tipo: null, potencial: null};
                SORT_KEY = 'recientes';
                document.getElementById('ideasSortLabel').textContent = 'Ordenar';
                applyFiltros();
            });
        }
        // Click fuera cierra los popovers
        document.addEventListener('click', function (e) {
            if (filtroPop && !e.target.closest('#ideasBtnFiltro') && !e.target.closest('#ideasPopFilter')) {
                filtroPop.style.display = 'none';
            }
            if (sortPop && !e.target.closest('#ideasBtnOrdenar') && !e.target.closest('#ideasPopSort')) {
                sortPop.style.display = 'none';
            }
        });
    }

    /* ─── Boot ─── */
    function boot() {
        if (!document.getElementById('ideasKanbanBoard')) return;
        if (window._ideasBooted) return;
        window._ideasBooted = true;
        injectTopbarButton();
        wireDetailEvents();
        wireTopbarFilters();
        wireMercadoPicker();
        wireClickToEdit();
        fetchKanban().then(function () { applyFiltros(); });
    }
    document.addEventListener('DOMContentLoaded', boot);
    if (document.readyState !== 'loading') boot();
})();
