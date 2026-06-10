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

    /* ── Calendario como vista client-side ─────────────────────────────
       El widget #widgetCalendarioMaster vive SIEMPRE en el DOM del CRM;
       la página ?tab=calendario solo lo pone en "modo página" desde el
       server. Aquí hacemos lo mismo sin navegar: si la página actual es
       el CRM (tab=crm, con kanban y barras completas), el botón
       Calendario alterna el modo página en el cliente — y VOLVER al CRM
       es instantáneo (el kanban sigue vivo, las ventanas sobreviven).
       Aterrizajes directos en ?tab=calendario conservan la navegación
       Turbo de siempre (esa página no trae el chrome del CRM).         */

    var calInline = false;
    var SECTION_IDS = ['crmContentSection', 'tareasSection', 'proyectosSection', 'widgetCompras'];
    var SIDEBAR_BTNS = ['btnCRM', 'btnTareas', 'btnProyectos', 'btnCompras'];

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
        var ov = document.getElementById('widgetCalendarioMaster');
        if (!ov || typeof window.calendarioAbrir !== 'function') return false;
        SECTION_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        ov.classList.add('is-page-mode');
        // El branch page-mode de calendarioAbrir NO setea display (en el
        // server lo hace el template); aquí nos toca a nosotros.
        ov.style.display = 'flex';
        ov.style.alignItems = 'stretch';
        ov.style.justifyContent = 'stretch';
        try { window.calendarioAbrir(); } catch (e) {
            console.error('[crmNavV2] calendarioAbrir:', e);
        }
        calInline = true;
        replaceUrl('tab=calendario');
        window.scrollTo(0, 0);
        SIDEBAR_BTNS.forEach(function (id) {
            var b = document.getElementById(id);
            if (b) b.classList.remove('active');
        });
        var bc = document.getElementById('btnCalendario');
        if (bc) bc.classList.add('active');
        return true;
    }

    function calCloseInline() {
        var ov = document.getElementById('widgetCalendarioMaster');
        if (ov) {
            ov.classList.remove('is-page-mode');
            ov.style.alignItems = '';
            ov.style.justifyContent = '';
        }
        if (typeof window.calendarioCerrar === 'function') {
            try { window.calendarioCerrar(); } catch (e) { }
        }
        calInline = false;
    }

    // Captura a nivel document: corre ANTES que los onclick inline y los
    // listeners de crm_main, así podemos tomar la navegación sin tocarlos.
    document.addEventListener('click', function (ev) {
        var t = ev.target.closest && ev.target.closest('#btnCalendario, #btnCRM, #btnTareas, #btnProyectos, #btnCompras');
        if (!t) return;
        var cfg = window._CRM_CONFIG || {};

        if (t.id === 'btnCalendario') {
            if (cfg.tabActivo !== 'crm') return;   // landing ≠ crm → Turbo normal
            ev.preventDefault();
            ev.stopPropagation();
            if (!calInline) calOpenInline();
            return;
        }

        // Los demás botones solo nos interesan para SALIR del calendario inline.
        if (!calInline) return;
        ev.preventDefault();
        ev.stopPropagation();
        calCloseInline();
        if (typeof window.switchCrmView !== 'function') { hardReload('/app/home/?tab=crm'); return; }

        if (t.id === 'btnCRM') {
            window.switchCrmView('crm');
        } else if (t.id === 'btnTareas') {
            window.switchCrmView('tareas');
            if (typeof window.recargarTareasCRM === 'function') window.recargarTareasCRM();
        } else if (t.id === 'btnProyectos') {
            if (typeof window.proyectosAbrir === 'function') window.proyectosAbrir();
            else window.switchCrmView('proyectos');
        } else if (t.id === 'btnCompras') {
            window.switchCrmView('compras');
            if (typeof window.comprasInit === 'function') window.comprasInit();
        }
        urlToCrm();
    }, true);
})();
