/* ═══════════════════════════════════════════════════════════════════════
 * crm_nav_v2.js — CÓDIGO NUEVO (desde 2026-06-10)
 *
 * Navegación del CRM sin recargar la página (Etapa SPA).
 *
 * Hoy cambiar mes/año/vendedores hace window.location.href (recarga
 * completa: se pierde scroll, ventanas abiertas y ~1-2s de re-render).
 * Este módulo lo convierte en un swap in-place:
 *
 *   1. fetch del MISMO /app/home/?tab=crm&mes=... (HTML server-rendered:
 *      toda la lógica de anotaciones/orden/anclas del backend, gratis).
 *   2. DOMParser → se trasplantan SOLO los contenedores de datos
 *      (#crmListBody, #crmCardsGrid, #crmTbody) + labels de pills +
 *      contador + hrefs de tabs. El resto de la página NO se toca:
 *      las ventanas de oportunidades abiertas SOBREVIVEN.
 *   3. window._crmSetPeriodo() actualiza los closures del legacy y
 *      window.refreshCrmTable() re-aplica colores/KPIs/kanban/binds
 *      (el mismo camino que ya corre en cada page load y cada edición).
 *   4. history.replaceState deja la URL compartible.
 *
 * Entrada: window.crmApplyPeriod(params) — lo llaman reloadWithPeriod /
 * reloadWithPeriodo (_content.html). Devuelve true si tomó el trabajo;
 * false → el caller hace el reload clásico (fallback siempre disponible).
 * ═══════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    var SWAP_IDS = ['crmTbody', 'crmListBody', 'crmCardsGrid'];
    var LABEL_IDS = ['crmWorkspaceCount'];
    var busy = false;

    function setLoading(on) {
        SWAP_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) {
                el.style.transition = 'opacity 0.15s ease';
                el.style.opacity = on ? '0.45' : '';
                el.style.pointerEvents = on ? 'none' : '';
            }
        });
        // Pills atenuadas mientras aplica (el server puede tardar varios seg).
        ['pillPeriodo', 'pillVendedor'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) {
                el.style.opacity = on ? '0.55' : '';
                el.style.pointerEvents = on ? 'none' : '';
            }
        });
        // Botón "Aplicar" del popover abierto: gris + texto de estado. El
        // popover se queda abierto hasta que el cambio termina (lo cierra
        // _crmSyncPeriodPills) para que el usuario VEA que está trabajando.
        document.querySelectorAll('[data-act="periodo-apply"], [data-act="period-apply-vendor"]').forEach(function (btn) {
            if (on) {
                btn.dataset.prevText = btn.textContent;
                btn.textContent = 'Aplicando…';
                btn.disabled = true;
                btn.style.opacity = '0.55';
                btn.style.cursor = 'wait';
            } else {
                if (btn.dataset.prevText) btn.textContent = btn.dataset.prevText;
                btn.disabled = false;
                btn.style.opacity = '';
                btn.style.cursor = '';
            }
        });
    }

    function hardReload(url) {
        window.location.href = url;
    }

    window.crmApplyPeriod = function (params) {
        try {
            // Solo aplica en la pestaña CRM con el kanban presente; en otras
            // pestañas (clientes/prospección/ideas) el contenido es otro y
            // el reload clásico sigue siendo el camino.
            var tab = params.get('tab') || (window._CRM_CONFIG && window._CRM_CONFIG.tabActivo) || 'crm';
            if (tab !== 'crm') return false;
            if (!document.getElementById('crmListBody')) return false;
            if (typeof window.refreshCrmTable !== 'function') return false;
            if (typeof window._crmSetPeriodo !== 'function') return false;
            if (busy) return true;  // ya hay un cambio en vuelo; ignorar el doble click
        } catch (e) {
            return false;
        }

        params.set('tab', 'crm');
        var url = window.location.pathname + '?' + params.toString();
        busy = true;
        setLoading(true);

        fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'crm-nav-v2' } })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            })
            .then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');

                // Validación: si el HTML no trae el kanban (sesión expirada,
                // error del server), mejor recargar de verdad.
                if (!doc.getElementById('crmListBody')) throw new Error('fragmento sin kanban');

                // 1. Trasplantar contenedores de datos.
                SWAP_IDS.forEach(function (id) {
                    var cur = document.getElementById(id);
                    var nue = doc.getElementById(id);
                    if (cur && nue) cur.innerHTML = nue.innerHTML;
                });

                // 2. Labels de pills + contador (el server ya los renderiza bien).
                LABEL_IDS.forEach(function (id) {
                    var cur = document.getElementById(id);
                    var nue = doc.getElementById(id);
                    if (cur && nue) cur.textContent = nue.textContent;
                });

                // 3. Tabs del topbar: que sus hrefs lleven el periodo nuevo.
                var nuevos = doc.querySelectorAll('.crm-tab');
                var actuales = document.querySelectorAll('.crm-tab');
                if (nuevos.length === actuales.length) {
                    for (var i = 0; i < actuales.length; i++) {
                        if (nuevos[i].getAttribute('href')) {
                            actuales[i].setAttribute('href', nuevos[i].getAttribute('href'));
                        }
                    }
                }

                // 4. Estado del legacy + URL + config global.
                var mes = params.get('mes');
                var anio = params.get('anio');
                window._crmSetPeriodo(mes, anio, 'crm');
                if (window._CRM_CONFIG) {
                    if (mes != null) window._CRM_CONFIG.mesFiltro = mes;
                    if (anio != null) window._CRM_CONFIG.anioFiltro = anio;
                    window._CRM_CONFIG.vendedoresFilter = params.get('vendedores') || '';
                }
                try { window.history.replaceState({}, '', url); } catch (e) { }

                // Pills: re-sincronizar labels desde la URL nueva ("Junio · 2026",
                // "2 vendedores"…) y cerrar el popover de "Aplicando…".
                if (typeof window._crmSyncPeriodPills === 'function') {
                    try { window._crmSyncPeriodPills(); } catch (e) { }
                }

                // 5. Colores/KPIs/kanban/binds — el mismo pase que corre en
                //    cada page load (refreshCrmTable usa el periodo ya seteado).
                window.refreshCrmTable();

                // 6. KPI facturado: en page load un script de _scripts_main
                //    lo sobreescribe con el total del desglose (la fuente
                //    "real", incluye clientes sin match) — replicarlo.
                var vq = params.get('vendedores') ? '&vendedores=' + encodeURIComponent(params.get('vendedores')) : '';
                fetch('/app/api/desglose-facturacion/?mes=' + (mes || 'todos') + '&anio=' + (anio || 'todos') + vq, { credentials: 'same-origin' })
                    .then(function (r) { return r.json(); })
                    .then(function (resp) {
                        if (resp.ok && resp.total !== undefined) {
                            var fa = document.getElementById('facturadoAmount');
                            if (fa) fa.textContent = '$' + Number(resp.total).toLocaleString('en-US', { maximumFractionDigits: 0 });
                        }
                    })
                    .catch(function () { });

                setLoading(false);
                busy = false;
            })
            .catch(function (err) {
                console.error('[crmNavV2] swap falló, recargando:', err);
                busy = false;
                hardReload(url);
            });

        return true;
    };

    /* ── Calendario sin navegación ──────────────────────────────────────
       El calendario ya existe COMPLETO como widget modal en toda página
       CRM (#widgetCalendarioMaster, 98vw×97vh, con su header y subnav).
       En vez de navegar a ?tab=calendario (re-render del server, barra
       azul, se pierden las ventanas), el botón del sidebar lo abre como
       overlay encima del CRM: abrir es inmediato y CERRAR es instantáneo
       porque el CRM nunca dejó de estar ahí. La URL se sincroniza con
       replaceState para que F5/compartir caigan en la página real del
       calendario. Aterrizajes directos en ?tab=calendario conservan el
       modo página del server (markup propio, no se toca).

       NOTA: NO se puede replicar el modo página en el cliente — los dos
       headers del template son ramas {% if %}/{% else %} con ids
       duplicados entre sí (calUserPickerBtn, calUserFilter…); renderizar
       ambos rompería los scripts del calendario.                        */

    var calInline = false;

    function replaceUrl(qs) {
        try { window.history.replaceState({}, '', window.location.pathname + '?' + qs); } catch (e) { }
    }

    function urlToCrm() {
        var cfg = window._CRM_CONFIG || {};
        var p = new URLSearchParams();
        p.set('tab', 'crm');
        if (cfg.mesFiltro) p.set('mes', cfg.mesFiltro);
        if (cfg.anioFiltro) p.set('anio', cfg.anioFiltro);
        if (cfg.vendedoresFilter) p.set('vendedores', cfg.vendedoresFilter);
        replaceUrl(p.toString());
    }

    function calOpenInline() {
        if (!document.getElementById('widgetCalendarioMaster')) return false;
        if (typeof window.calendarioAbrir !== 'function') return false;
        try { window.calendarioAbrir(); } catch (e) {
            console.error('[crmNavV2] calendarioAbrir:', e);
            return false;
        }
        calInline = true;
        replaceUrl('tab=calendario');
        var bc = document.getElementById('btnCalendario');
        if (bc) bc.classList.add('active');
        return true;
    }

    // Cualquier cierre del calendario (X, Esc vía stack, o nuestros botones)
    // pasa por calendarioCerrar — el wrap restaura la URL del CRM cuando el
    // calendario lo abrimos nosotros. calendarioCerrar ya limpia el .active.
    window.crmReady(function () {
        if (window._crmNavCalWrapped) return;
        if (typeof window.calendarioCerrar !== 'function') return;
        window._crmNavCalWrapped = true;
        var origCerrar = window.calendarioCerrar;
        window.calendarioCerrar = function () {
            var r = origCerrar.apply(this, arguments);
            if (calInline) {
                calInline = false;
                urlToCrm();
            }
            return r;
        };
    });

    /* ── Reportes (dashboard tab=clientes) como vista client-side ───────
       El dashboard es esqueleto puro: sus datos llegan por los 7 fetchs
       paralelos de loadAllClientesPanels. En páginas tab=crm el markup
       viene OCULTO (#ckDashRoot + #ckDashBarRoot, ver _content.html), así
       que "entrar a Reportes" es mostrar el esqueleto al instante y
       disparar los fetchs — igual de inmediato que Tareas, cero server
       render. refreshCrmTable() con currentTab='clientes' (vía
       _crmSetPeriodo) ya llama loadAllClientesPanels() solo.            */

    var dashInline = false;

    // Tab REAL con el que el server sirvió la página actual. Se captura en
    // cada carga/turbo:load porque _CRM_CONFIG.tabActivo se MUTA durante el
    // modo dashboard-inline (paridad con la página nativa) y los guards de
    // navegación de este módulo necesitan el valor original.
    var PAGE_TAB = (window._CRM_CONFIG || {}).tabActivo || '';
    window.crmReady(function () {
        if (!dashInline) PAGE_TAB = (window._CRM_CONFIG || {}).tabActivo || '';
    });

    function dashOpenInline() {
        var root = document.getElementById('ckDashRoot');
        var barRoot = document.getElementById('ckDashBarRoot');
        if (!root || !barRoot) return false;
        if (typeof window._crmSetPeriodo !== 'function' ||
            typeof window.refreshCrmTable !== 'function') return false;

        document.body.classList.add('ck-dash-inline');
        root.style.display = '';
        // display:contents → los hijos participan del flex de la barra
        // como si no hubiera wrapper.
        barRoot.style.display = 'contents';

        // Paridad TOTAL con la página nativa tab=clientes:
        // 1) La barra cambia de clase (centrado de la island y estilos del
        //    dashboard viven en .crm-bar--dashboard).
        var bar = document.querySelector('.crm-bar');
        if (bar) {
            bar.classList.add('crm-bar--dashboard');
            bar.classList.remove('crm-bar--unified');
        }
        // 2) Mucho código legacy y de módulos v2 se bifurca por
        //    _CRM_CONFIG.tabActivo — en modo inline debe decir 'clientes'
        //    (los guards de navegación de este módulo usan PAGE_TAB, que
        //    captura el tab REAL con el que se sirvió la página).
        if (window._CRM_CONFIG) window._CRM_CONFIG.tabActivo = 'clientes';

        window._crmSetPeriodo(null, null, 'clientes');
        window.refreshCrmTable();  // currentTab='clientes' → loadAllClientesPanels()
        if (typeof window._crmSetMode === 'function') {
            var saved = null;
            try { saved = localStorage.getItem('crm_clientes_mode'); } catch (e) { }
            try { window._crmSetMode(saved || 'oportunidades'); } catch (e) { }
        }

        dashInline = true;
        var cfg = window._CRM_CONFIG || {};
        var p = new URLSearchParams();
        p.set('tab', 'clientes');
        if (cfg.mesFiltro) p.set('mes', cfg.mesFiltro);
        if (cfg.anioFiltro) p.set('anio', cfg.anioFiltro);
        if (cfg.vendedoresFilter) p.set('vendedores', cfg.vendedoresFilter);
        replaceUrl(p.toString());
        window.scrollTo(0, 0);

        var bd = document.getElementById('btnDashboard');
        if (bd) bd.classList.add('active');
        var bc = document.getElementById('btnCRM');
        if (bc) bc.classList.remove('active');
        return true;
    }

    function dashCloseInline() {
        if (!dashInline) return;
        dashInline = false;
        document.body.classList.remove('ck-dash-inline');
        var root = document.getElementById('ckDashRoot');
        if (root) root.style.display = 'none';
        var barRoot = document.getElementById('ckDashBarRoot');
        if (barRoot) barRoot.style.display = 'none';
        var bar = document.querySelector('.crm-bar');
        if (bar) {
            bar.classList.remove('crm-bar--dashboard');
            bar.classList.add('crm-bar--unified');
        }
        if (window._CRM_CONFIG) window._CRM_CONFIG.tabActivo = PAGE_TAB;
        if (typeof window._crmSetPeriodo === 'function') window._crmSetPeriodo(null, null, 'crm');
        // Los KPIs del topbar/footer son nodos COMPARTIDOS y el dashboard
        // los pisó con sus totales — re-pintar los del kanban.
        if (typeof window.refreshCrmTable === 'function') window.refreshCrmTable();
        var bd = document.getElementById('btnDashboard');
        if (bd) bd.classList.remove('active');
        urlToCrm();
    }

    /* ── Prewarm del dashboard ───────────────────────────────────────
       En páginas tab=crm, tras ~3.5s de idle, se disparan los fetchs del
       dashboard EN BACKGROUND y todo se renderiza dentro del root oculto:
       cuando el usuario haga click en Reportes ya está PINTADO — entrada
       instantánea estilo Tareas (dashOpenInline además refresca datos
       frescos encima).

       Protección: el render del dashboard también escribe en nodos
       COMPARTIDOS del topbar/footer (facturadoAmount, footerLeft, etc.).
       Durante el warm, un MutationObserver los regresa a su valor del
       kanban en cuanto algo los toque; se desconecta solo.             */

    var dashWarmed = false;
    var SHARED_KPI_IDS = ['facturadoAmount', 'metaDisplay', 'progressPct',
                          'topbarTotalLabel', 'footerLeft', 'footerRight'];

    function dashPrewarm() {
        if (dashWarmed || dashInline || calInline) return;
        if (document.visibilityState === 'hidden') return;
        if (PAGE_TAB !== 'crm') return;
        if (!document.getElementById('ckDashRoot')) return;
        if (typeof window._crmSetPeriodo !== 'function' ||
            typeof window.refreshCrmTable !== 'function') return;
        dashWarmed = true;

        // Snapshot + guard de los nodos compartidos del kanban.
        var snap = {};
        var fill = document.getElementById('progressFill');
        var fillW = fill ? fill.style.width : null;
        SHARED_KPI_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) snap[id] = el.textContent;
        });
        var restoring = false;
        var obs = new MutationObserver(function () {
            if (restoring || dashInline) return;
            restoring = true;
            SHARED_KPI_IDS.forEach(function (id) {
                var el = document.getElementById(id);
                if (el && snap[id] !== undefined && el.textContent !== snap[id]) {
                    el.textContent = snap[id];
                }
            });
            if (fill && fillW !== null && fill.style.width !== fillW) fill.style.width = fillW;
            restoring = false;
        });
        SHARED_KPI_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) obs.observe(el, { childList: true, characterData: true, subtree: true });
        });
        if (fill) obs.observe(fill, { attributes: true, attributeFilter: ['style'] });
        // El guard vive mientras llegan los 5 paneles; después ya no estorba.
        setTimeout(function () { obs.disconnect(); }, 20000);

        try {
            window._crmSetPeriodo(null, null, 'clientes');
            window.refreshCrmTable();   // → loadAllClientesPanels() (fetchs en paralelo)
        } finally {
            window._crmSetPeriodo(null, null, 'crm');  // restaurar de inmediato
        }
    }

    window.crmReady(function () {
        dashWarmed = false;  // página nueva (turbo:load) → permitir re-warm
        setTimeout(dashPrewarm, 3500);
    });

    // Captura a nivel document: corre ANTES que los onclick inline y los
    // listeners de crm_main, así tomamos la navegación sin tocar el legacy.
    document.addEventListener('click', function (ev) {
        var t = ev.target.closest && ev.target.closest('#btnCalendario, #btnDashboard, #btnCRM, #btnTareas, #btnProyectos, #btnCompras');
        if (!t) return;

        if (t.id === 'btnCalendario') {
            if (PAGE_TAB !== 'crm') return;   // landing ≠ crm → navegación normal
            ev.preventDefault();
            ev.stopPropagation();
            dashCloseInline();  // calendario sobre el CRM, no sobre el dashboard
            if (!calInline) calOpenInline();
            return;
        }

        if (t.id === 'btnDashboard') {
            if (PAGE_TAB !== 'crm') return;   // landing ≠ crm → Turbo normal
            if (calInline && typeof window.calendarioCerrar === 'function') window.calendarioCerrar();
            if (dashInline) { ev.preventDefault(); ev.stopPropagation(); return; }
            if (dashOpenInline()) {
                ev.preventDefault();
                ev.stopPropagation();
            }
            return;
        }

        // Los demás botones del sidebar: si el calendario o el dashboard
        // están abiertos inline, cerrarlos y dejar que el handler normal
        // (switchCrmView de crm_main) haga el cambio de vista.
        if (calInline && typeof window.calendarioCerrar === 'function') {
            window.calendarioCerrar();
        }
        dashCloseInline();
    }, true);
})();
