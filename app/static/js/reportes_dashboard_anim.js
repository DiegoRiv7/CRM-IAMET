/* ═══════════════════════════════════════════════════════════════════
 * reportes_dashboard_anim.js
 * Bridge SPA Dashboard ↔ Reportes.
 *
 * Cuando un reporte se carga DENTRO del iframe del dashboard
 * (?embedded=1 en la URL), este script:
 *
 *   1) Aplica body.rep-embedded — el CSS oculta el header completo del
 *      reporte (.rep-header), el sidebar lateral y la dynamic island
 *      interna. Todos los controles "viven" en el dashboard padre.
 *   2) Envía postMessage `rep:ready` al parent con la config del
 *      reporte activo:
 *           - sort_options: secciones + opciones del dropdown Ordenar.
 *           - current_sort: clave del orden activo.
 *           - current_label: label del orden activo.
 *           - search_placeholder + search_value.
 *           - has_filters / has_active_filters / has_export.
 *      El parent usa esa metadata para configurar sus proxies
 *      (botones Ordenar/Filtros/Exportar y la barra de búsqueda).
 *   3) Escucha postMessages del parent:
 *           rep:sort:pick {key}       → simular click en .rep-sort-item.
 *           rep:search {q}            → setear value en #repSearch +
 *                                       disparar 'input'.
 *           rep:filters:open          → click en #repBtnFilter.
 *           rep:export                → click en #repBtnExport.
 *           rep:filters:update {f}    → aplicar filtros nuevos venidos
 *                                       del dashboard (pills de
 *                                       periodo/vendedor) sin reload.
 *   4) Sobreescribe window.openDetalle y window.openClienteModal para
 *      que envíen postMessage al parent (widgets se abren en el
 *      contexto del dashboard, no encajonados en el iframe).
 *
 * Cuando un reporte se abre directo (sin iframe, navegación normal a
 * /app/reportes/<slug>/), este script no aplica embedded → el reporte
 * muestra su header tradicional con sus propios controles.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var DASHBOARD_FALLBACK_URL = '/app/home/?tab=clientes';

    function isEmbedded() {
        try {
            return new URL(window.location.href).searchParams.get('embedded') === '1';
        } catch (e) {
            return false;
        }
    }

    function postToParent(msg) {
        try {
            (window.parent || window.opener || window).postMessage(msg, '*');
        } catch (e) { /* defensivo */ }
    }

    function buildBackBtn() {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'repBackToDashboard';
        btn.className = 'rep-back-to-dashboard';
        btn.title = 'Volver al Dashboard';
        btn.innerHTML =
            '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
            + '<span>Dashboard</span>';
        return btn;
    }

    function navigateBack(embedded) {
        var header = document.querySelector('.rep-header');
        if (header) header.classList.add('rep-header-sliding-out-right');
        setTimeout(function () {
            if (embedded) {
                postToParent({ type: 'rep:close' });
            } else {
                window.location.href = DASHBOARD_FALLBACK_URL;
            }
        }, 240);
    }

    // ─── Helpers embedded mode ────────────────────────────────────────

    // Extrae las opciones del dropdown Ordenar del header del reporte.
    // El HTML estructura las opciones como:
    //   <div class="rep-sort-menu">
    //     <div class="rep-sort-section">Monto</div>
    //     <button class="rep-sort-item" data-sort="monto_desc">Mayor monto</button>
    //     ...
    //   </div>
    function readSortConfig() {
        var menu = document.querySelector('.rep-sort-menu');
        if (!menu) return null;
        var sections = [];
        var current = null;
        menu.childNodes.forEach(function (n) {
            if (!n || n.nodeType !== 1) return;
            if (n.classList && n.classList.contains('rep-sort-section')) {
                sections.push({ section: n.textContent.trim(), items: [] });
            } else if (n.classList && n.classList.contains('rep-sort-item')) {
                if (!sections.length) sections.push({ section: '', items: [] });
                sections[sections.length - 1].items.push({
                    key: n.getAttribute('data-sort'),
                    label: n.textContent.trim(),
                });
                if (n.classList.contains('is-active')) {
                    current = n.getAttribute('data-sort');
                }
            }
        });
        // Si no hay marker is-active, tomar el primer item.
        if (!current && sections.length && sections[0].items.length) {
            current = sections[0].items[0].key;
        }
        var label = document.querySelector('.rep-sort-label');
        return {
            sort_options: sections,
            current_sort: current,
            current_label: label ? label.textContent.trim() : '',
        };
    }

    function readSearchPlaceholder() {
        var inp = document.querySelector('#repSearch');
        return inp ? (inp.getAttribute('placeholder') || '') : '';
    }
    function readSearchValue() {
        var inp = document.querySelector('#repSearch');
        return inp ? inp.value : '';
    }
    function hasFilters() {
        return !!document.querySelector('#repBtnFilter');
    }
    function hasActiveFilterDot() {
        var dot = document.querySelector('#repFilterDot');
        if (!dot) return false;
        var st = window.getComputedStyle(dot);
        return st && st.display !== 'none';
    }
    function hasExport() {
        return !!document.querySelector('#repBtnExport');
    }

    function sendReady() {
        var sortCfg = readSortConfig() || { sort_options: [], current_sort: null, current_label: '' };
        postToParent({
            type: 'rep:ready',
            sort_options: sortCfg.sort_options,
            current_sort: sortCfg.current_sort,
            current_label: sortCfg.current_label,
            has_search: !!document.querySelector('#repSearch'),
            search_placeholder: readSearchPlaceholder(),
            search_value: readSearchValue(),
            has_filters: hasFilters(),
            has_active_filters: hasActiveFilterDot(),
            has_export: hasExport(),
        });
    }

    // ─── Proxies ──────────────────────────────────────────────────────

    function handleSortPick(key) {
        var item = document.querySelector('.rep-sort-item[data-sort="' + key + '"]');
        if (item) item.click();
    }

    function handleSearch(q) {
        var inp = document.querySelector('#repSearch');
        if (!inp) return;
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(inp, q);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function handleFiltersOpen() {
        var btn = document.querySelector('#repBtnFilter');
        if (btn) btn.click();
    }

    function handleExport() {
        var btn = document.querySelector('#repBtnExport');
        if (btn) btn.click();
    }

    // Aplicar filtros venidos del dashboard (pills periodo/vendedor)
    // sin reload del iframe. Setea los <select> del drawer y dispara el
    // apply (#repFltApply). El reporte hace fetch del endpoint con los
    // nuevos params y re-renderiza.
    function handleFiltersUpdate(f) {
        if (!f || typeof f !== 'object') return;
        var map = {
            vendedor: '#repFltVendedor',
            mes: '#repFltMes',
            anio: '#repFltAnio',
            pipeline: '#repFltPipeline',
            etapa: '#repFltEtapa',
            producto: '#repFltMarca',
            resultado: '#repFltResultado',
            monto_min: '#repFltMontoMin',
        };
        // Renombrar vendedores (plural) → vendedor (single).
        if (f.vendedores && !f.vendedor) {
            var first = String(f.vendedores).split(',')[0].trim();
            if (first) f.vendedor = first;
        }
        Object.keys(map).forEach(function (key) {
            var el = document.querySelector(map[key]);
            if (!el) return;
            var v = f[key];
            // mes/anio del dashboard pueden ser string sin padding ('5')
            // mientras el <option> usa zero-padded ('05'). Normalizar.
            if (key === 'mes' && v) {
                v = String(parseInt(v, 10)).padStart(2, '0');
            }
            el.value = (v == null ? '' : String(v));
        });
        var apply = document.querySelector('#repFltApply');
        if (apply) apply.click();
        // Cerrar drawer si estuviera abierto.
        var close = document.querySelector('#repDrawerClose');
        if (close) close.click();
        // Notificar al padre que el dot de filtros cambió (puede haber
        // pasado de inactivo a activo o viceversa).
        setTimeout(function () {
            postToParent({ type: 'rep:filterdot', active: hasActiveFilterDot() });
        }, 50);
    }

    // ─── Main ─────────────────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', function () {
        var embedded = isEmbedded();

        if (embedded) {
            document.body.classList.add('rep-embedded');
            // Wrappers de openDetalle/openClienteModal → postMessage al
            // parent (widgets se abren en su contexto, no en el iframe).
            window.openDetalle = function (id) {
                postToParent({ type: 'rep:opendetalle', id: id });
            };
            window.openClienteModal = function (id, nombre, tab) {
                postToParent({ type: 'rep:opencliente', id: id, nombre: nombre || '', tab: tab || 'oportunidades' });
            };

            // Escuchar mensajes del parent (proxies + propagación de
            // filtros desde pills del dashboard).
            window.addEventListener('message', function (e) {
                var d = e.data;
                if (!d || typeof d !== 'object' || !d.type) return;
                if (d.type === 'rep:sort:pick') handleSortPick(d.key);
                else if (d.type === 'rep:search') handleSearch(d.q || '');
                else if (d.type === 'rep:filters:open') handleFiltersOpen();
                else if (d.type === 'rep:export') handleExport();
                else if (d.type === 'rep:filters:update') handleFiltersUpdate(d.filters || {});
            });

            // Detectar cambios en el dot de filtros del reporte y
            // propagar al padre (cuando el usuario aplica/limpia filtros
            // dentro del drawer del propio iframe).
            var dot = document.querySelector('#repFilterDot');
            if (dot) {
                var mo = new MutationObserver(function () {
                    postToParent({ type: 'rep:filterdot', active: hasActiveFilterDot() });
                });
                mo.observe(dot, { attributes: true, attributeFilter: ['style', 'class'] });
            }

            // Detectar cuando cambia el orden activo (label) para que el
            // padre actualice el label del proxy.
            var sortLabel = document.querySelector('.rep-sort-label');
            if (sortLabel) {
                var moS = new MutationObserver(function () {
                    sendReady();
                });
                moS.observe(sortLabel, { childList: true, characterData: true, subtree: true });
            }

            // Enviar config inicial al padre. Esperamos un tick para
            // permitir que el reporte ejecute su init (que puede modificar
            // el label inicial del sort).
            setTimeout(sendReady, 60);
        }

        var header = document.querySelector('.rep-header');
        if (!header) return;

        // Animación de entrada del header (slide desde la derecha).
        // En embedded el header está oculto via CSS, pero la animación
        // no daña — solo no se ve.
        header.classList.add('rep-header-sliding-in-from-right');
        setTimeout(function () {
            header.classList.remove('rep-header-sliding-in-from-right');
        }, 350);

        // En modo embedded los controles "← Dashboard" + tabs internos
        // se ocultan via CSS. Solo en navegación directa (sin iframe)
        // inyectamos el botón Dashboard al inicio del header.
        if (!embedded) {
            var izq = header.querySelector('.rep-plantillas') || header;
            var existingBack = izq.querySelector('a[href="/app/reportes/"], a[href^="/app/reportes/"]:not(.rep-tab)');
            if (existingBack) existingBack.style.display = 'none';

            var btn = buildBackBtn();
            if (izq.firstChild) {
                izq.insertBefore(btn, izq.firstChild);
            } else {
                izq.appendChild(btn);
            }
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                navigateBack(false);
            });
        }

        // ESC vuelve al dashboard (atajo natural). Respeta drawer/popover
        // abierto.
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            var drawerOpen = document.querySelector('.rep-drawer.open, .repp-popover.open');
            if (drawerOpen) return;
            navigateBack(embedded);
        });
    });
})();
