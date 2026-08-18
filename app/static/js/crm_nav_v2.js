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

    // Config por tab: qué contenedores server-rendered se trasplantan y qué
    // re-inicialización corre después del swap. Agregar un tab nuevo = una
    // entrada aquí (los pills/labels/URL son genéricos).
    var SWAP_CONFIG = {
        crm: {
            ids: ['crmTbody', 'crmListBody', 'crmCardsGrid'],
            after: function (params, mes, anio) {
                // Colores/KPIs/kanban/binds — el mismo pase de cada page load
                // (refreshCrmTable usa el periodo ya seteado en el closure).
                if (typeof window.refreshCrmTable === 'function') window.refreshCrmTable();
                // KPI facturado: en page load un script de _scripts_main lo
                // sobreescribe con el total del desglose (la fuente "real").
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
            },
        },
        prospectos: {
            ids: ['pkKanbanBoard'],
            after: function () {
                // Re-aplicar filtros/orden/colapsadas guardados a las cards
                // nuevas (crm_prospectos_kanban.js).
                if (typeof window.pkKanbanRehydrate === 'function') {
                    try { window.pkKanbanRehydrate(); } catch (e) { }
                }
            },
        },
    };
    var LABEL_IDS = ['crmWorkspaceCount'];
    var busy = false;

    function setLoading(on, ids) {
        (ids || []).forEach(function (id) {
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
        var tab, cfg;
        try {
            // Aplica en los tabs con config de swap (crm, prospectos); el
            // resto conserva el reload clásico.
            tab = params.get('tab') || (window._CRM_CONFIG && window._CRM_CONFIG.tabActivo) || 'crm';
            cfg = SWAP_CONFIG[tab];
            if (!cfg) return false;
            if (!document.getElementById(cfg.ids[0])) return false;
            if (typeof window._crmSetPeriodo !== 'function') return false;
            if (busy) return true;  // ya hay un cambio en vuelo; ignorar el doble click
        } catch (e) {
            return false;
        }

        params.set('tab', tab);
        var url = window.location.pathname + '?' + params.toString();
        busy = true;
        setLoading(true, cfg.ids);

        // Timeout duro: si el server tarda (504/saturación) NO dejamos el
        // botón congelado en "Aplicando…" para siempre. Abortamos a los 18s y
        // recuperamos la UI en el .catch (sin recargar hacia la misma URL
        // lenta, que sólo provoca otro 504).
        var _ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var _timedOut = false;
        var _to = setTimeout(function () {
            _timedOut = true;
            if (_ac) { try { _ac.abort(); } catch (e) {} }
        }, 18000);

        fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'crm-nav-v2' }, signal: _ac ? _ac.signal : undefined })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            })
            .then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');

                // Validación: si el HTML no trae el contenedor (sesión
                // expirada, error del server), mejor recargar de verdad.
                if (!doc.getElementById(cfg.ids[0])) throw new Error('fragmento sin ' + cfg.ids[0]);

                // 1. Trasplantar contenedores de datos.
                cfg.ids.forEach(function (id) {
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
                window._crmSetPeriodo(mes, anio, tab);
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

                // 5. Re-inicialización propia del tab (colores/KPIs/binds…).
                try { cfg.after(params, mes, anio); } catch (e) {
                    console.error('[crmNavV2] after-swap:', e);
                }

                clearTimeout(_to);
                setLoading(false, cfg.ids);
                busy = false;
            })
            .catch(function (err) {
                clearTimeout(_to);
                busy = false;
                setLoading(false, cfg.ids);
                if (_timedOut || (err && err.name === 'AbortError')) {
                    // El server no respondió a tiempo. Recargar hacia la misma
                    // URL lenta sólo encadenaría otro timeout → mejor avisar y
                    // dejar la vista actual usable.
                    console.warn('[crmNavV2] period-apply timeout (server lento):', url);
                    if (typeof window.crmToast === 'function') {
                        window.crmToast('El servidor tardó demasiado. Intenta de nuevo en un momento.', 'error');
                    } else if (typeof window.showNotification === 'function') {
                        window.showNotification('El servidor tardó demasiado. Intenta de nuevo.', 'error');
                    }
                    return;
                }
                // Otros errores (sesión expirada, fragmento inválido): recarga real.
                console.error('[crmNavV2] swap falló, recargando:', err);
                hardReload(url);
            });

        return true;
    };

    /* ── Calendario: SIEMPRE en modo página, sin navegar ─────────────────
       (2026-06-10, pedido del usuario) El calendario debe verse como la
       página completa de ?tab=calendario — con Instalaciones, filtro,
       picker de usuarios, técnicos, asistente — NO como widget modal. El
       header modal fue ELIMINADO del template (tenía ids duplicados con
       el page-bar); el page-bar es ahora el único header, así que el modo
       página se puede activar client-side en cualquier página del CRM:

       · window.calendarioAbrir queda envuelto: CUALQUIER llamador
         (sidebar, notificaciones, ingeniero) entra en modo página.
       · pageizeCalendar(): oculta las secciones de la página, aplica
         is-page-mode + estilos de página a overlay/card (guardando los
         originales), sincroniza URL. unpageizeCalendar() restaura todo.
       · Aterrizajes nativos en ?tab=calendario: sin cambios (el server
         ya renderiza page-mode; el wrap no interviene).                  */

    var calInline = false;
    var calSaved = null;   // { sections: {id: display}, overlayCss, cardCss }
    // widgetProyectoDetalle: el detalle de proyecto es HERMANO de
    // #proyectosSection (se muestra vía clase .is-open, no por display) —
    // si está abierto al entrar al calendario también hay que taparlo, y
    // el inline display:none gana sobre la clase sin tocarla, así que al
    // restaurar el user vuelve exactamente al proyecto que tenía abierto.
    var CAL_SECTION_IDS = ['crmContentSection', 'tareasSection', 'proyectosSection', 'widgetProyectoDetalle', 'widgetCompras'];
    var SIDEBAR_BTN_SEL = '.island-nav-btn, .crm-sb-btn';
    // OJO: NO usamos min-height:100vh aquí — el card debe caber dentro del
    // overlay con padding (margen en los 4 lados, incluido ABAJO). La clase
    // .cal-card--page (que añadimos en pageize) trae el layout flotante real
    // con !important; este inline solo da un fallback mínimo.
    var CAL_CARD_PAGE_CSS = ';width:auto;height:auto;max-width:none;';

    function replaceUrl(qs) {
        try { window.history.replaceState({}, '', window.location.pathname + '?' + qs); } catch (e) { }
    }

    function urlToCrm() {
        var cfg = window._CRM_CONFIG || {};
        var p = new URLSearchParams();
        p.set('tab', PAGE_TAB && PAGE_TAB !== 'calendario' ? PAGE_TAB : 'crm');
        if (cfg.mesFiltro) p.set('mes', cfg.mesFiltro);
        if (cfg.anioFiltro) p.set('anio', cfg.anioFiltro);
        if (cfg.vendedoresFilter) p.set('vendedores', cfg.vendedoresFilter);
        replaceUrl(p.toString());
    }

    function pageizeCalendar() {
        var ov = document.getElementById('widgetCalendarioMaster');
        if (!ov) return false;
        if (ov.classList.contains('is-page-mode')) return true;  // nativo o ya activo
        var card = ov.querySelector('.cal-card');
        calSaved = {
            sections: {},
            overlayCss: ov.style.cssText,
            cardCss: card ? card.style.cssText : '',
        };
        CAL_SECTION_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) {
                calSaved.sections[id] = el.style.display;
                el.style.display = 'none';
            }
        });
        ov.classList.add('is-page-mode');
        ov.style.display = 'flex';
        ov.style.alignItems = 'stretch';
        ov.style.justifyContent = 'stretch';
        // Añadir la clase --page para que apliquen las reglas de card flotante
        // (mismas que en modo página nativo ?tab=calendario). Sin esto el card
        // quedaba transparente/100vh y se comía el margen inferior.
        if (card) { card.classList.add('cal-card--page'); card.style.cssText += CAL_CARD_PAGE_CSS; }
        calInline = true;
        window._crmNavCalInline = true;  // leído por el botón de cierre oculto del template
        replaceUrl('tab=calendario');
        window.scrollTo(0, 0);
        // Sidebar: solo Calendario debe verse activo. Antes solo se limpiaba
        // btnCRM y al entrar desde Proyectos/Tareas quedaban DOS botones
        // marcados. Se guarda cuáles estaban activos para restaurarlos al salir.
        calSaved.activeBtnIds = [];
        document.querySelectorAll(SIDEBAR_BTN_SEL).forEach(function (b) {
            if (b.classList.contains('active')) {
                if (b.id) calSaved.activeBtnIds.push(b.id);
                b.classList.remove('active');
            }
        });
        var bc = document.getElementById('btnCalendario');
        if (bc) bc.classList.add('active');
        return true;
    }

    function unpageizeCalendar() {
        if (!calInline) return;
        calInline = false;
        window._crmNavCalInline = false;
        var ov = document.getElementById('widgetCalendarioMaster');
        if (ov) {
            ov.classList.remove('is-page-mode');
            var card = ov.querySelector('.cal-card');
            ov.style.cssText = (calSaved && calSaved.overlayCss) || '';
            ov.style.display = 'none';
            if (card) {
                card.classList.remove('cal-card--page');
                if (calSaved) card.style.cssText = calSaved.cardCss;
            }
        }
        if (calSaved) {
            Object.keys(calSaved.sections).forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.style.display = calSaved.sections[id];
            });
        }
        var bc = document.getElementById('btnCalendario');
        if (bc) bc.classList.remove('active');
        if (calSaved && calSaved.activeBtnIds) {
            calSaved.activeBtnIds.forEach(function (id) {
                var b = document.getElementById(id);
                if (b) b.classList.add('active');
            });
        }
        calSaved = null;
        urlToCrm();
    }

    // Wraps: CUALQUIER apertura entra en modo página; CUALQUIER cierre
    // (Esc vía stack, botón oculto, sidebar) restaura la página original.
    // OJO: el script inline del template del calendario se RE-EJECUTA en
    // cada navegación Turbo y reasigna calendarioAbrir/Cerrar CRUDAS — un
    // guard de una-sola-vez dejaba las páginas post-navegación sin el wrap
    // (el calendario abría como widget modal "a veces"). Se re-envuelve en
    // cada crmReady; el marcador _navWrapped evita doble wrap.
    window.crmReady(function () {
        if (typeof window.calendarioAbrir !== 'function' ||
            typeof window.calendarioCerrar !== 'function') return;
        if (window.calendarioAbrir._navWrapped) return;

        var origAbrir = window.calendarioAbrir;
        window.calendarioAbrir = function () {
            if (PAGE_TAB !== 'calendario') {
                dashCloseInline();
                pageizeCalendar();
            }
            return origAbrir.apply(this, arguments);
        };
        window.calendarioAbrir._navWrapped = true;

        var origCerrar = window.calendarioCerrar;
        window.calendarioCerrar = function () {
            var r = origCerrar.apply(this, arguments);
            unpageizeCalendar();
            return r;
        };
        window.calendarioCerrar._navWrapped = true;
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

        // (2026-06-11 fix) #ckDashRoot vive DENTRO de #crmContentSection.
        // Si el usuario está en la vista Tareas/Proyectos/Compras, esa
        // sección está oculta y el dashboard se "mostraba" dentro de un
        // contenedor invisible (pantalla trabada: URL y botón cambiaban
        // pero seguías viendo Tareas). Cambiar primero a la vista CRM —
        // switchCrmView además normaliza las demás secciones y actives.
        if (typeof window.switchCrmView === 'function') {
            try { window.switchCrmView('crm'); } catch (e) { }
        }

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

        // Sidebar: solo Reportes activo. Limpieza COMPLETA — antes solo se
        // quitaba btnCRM y al entrar desde Tareas/Proyectos quedaban dos
        // botones marcados.
        document.querySelectorAll(SIDEBAR_BTN_SEL).forEach(function (b) { b.classList.remove('active'); });
        var bd = document.getElementById('btnDashboard');
        if (bd) bd.classList.add('active');
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
        // Modo Ligero: NO precargar el dashboard en background — es trabajo
        // (fetches + render) que el equipo viejo no pidió. Reportes igual
        // carga al entrar; solo se pierde el "ya estaba caliente".
        if (document.body.classList.contains('ww-lite')) return;
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
            if (PAGE_TAB === 'calendario') return;  // página nativa → default
            // Correo es una página exclusiva (page-mode): abrir el calendario
            // INLINE lo apilaba debajo del correo. Navegación Turbo normal.
            if (PAGE_TAB === 'correo') return;
            if (!document.getElementById('widgetCalendarioMaster')) return;  // sin widget → Turbo normal
            ev.preventDefault();
            ev.stopPropagation();
            // El wrap de calendarioAbrir hace el pageize (y cierra el
            // dashboard inline si estaba abierto).
            if (!calInline && typeof window.calendarioAbrir === 'function') window.calendarioAbrir();
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
