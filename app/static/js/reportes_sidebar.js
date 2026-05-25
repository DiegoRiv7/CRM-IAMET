/* ═══════════════════════════════════════════════════════════════════
 * reportes_sidebar.js — handlers para que el sidebar del CRM funcione
 * dentro del módulo Reportes.
 *
 * Las páginas de /app/reportes/ extienden base.html (NO crm_home.html)
 * y por eso no tienen crm_main.js cargado. Los botones del sidebar
 * (btnTareas, btnProyectos, btnCompras, etc.) que en el CRM dependen
 * de handlers JS cargados ahí, aquí quedaban muertos — el usuario
 * clickeaba y nada pasaba.
 *
 * Solución: navegamos a /app/todos/ persistiendo el destino vía
 * localStorage ('crmView') o query param, mismo patrón que ya usa el
 * sidebar cuando viene desde tab=calendario.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function setView(view) {
        try { localStorage.setItem('crmView', view); } catch (e) {}
    }

    function nav(url) { window.location.href = url; }

    function wire(id, handler) {
        var b = document.getElementById(id);
        if (!b) return;
        // Reemplazar onclick inline (que llama a funciones ausentes aquí)
        b.setAttribute('onclick', '');
        b.onclick = function (e) { e.preventDefault(); handler(); };
    }

    document.addEventListener('DOMContentLoaded', function () {
        wire('btnTareas', function () { setView('tareas'); nav('/app/todos/'); });
        wire('btnProyectos', function () { setView('proyectos'); nav('/app/todos/'); });
        wire('btnCRM', function () { setView('crm'); nav('/app/todos/'); });
        wire('btnCompras', function () { setView('compras'); nav('/app/todos/'); });

        // Overlays: van al home y desde ahí el user los abre. Si en el futuro
        // queremos auto-abrir, se puede agregar ?open=mail|muro|notif al URL
        // y manejarlo en crm_home.
        wire('btnMail', function () { nav('/app/todos/'); });
        wire('btnMuro', function () { nav('/app/todos/'); });
        wire('btnNotificaciones', function () { nav('/app/todos/?open=notif'); });
        wire('btnGrupo', function () { nav('/app/todos/'); });
        wire('btnAdmin', function () { nav('/app/todos/'); });
        wire('btnDashboard', function () { nav('/app/todos/'); });

        // Spotlight: openSpotlight vive en base.js (sí cargado aquí). Si
        // existe, lo usamos; si no, fallback al home.
        wire('btnSpotlight', function () {
            if (typeof window.openSpotlight === 'function') window.openSpotlight();
            else nav('/app/todos/');
        });

        // Perfil — el widget también necesita scripts del CRM. Fallback: home.
        var avatar = document.querySelector('.crm-sb-avatar');
        if (avatar) {
            avatar.setAttribute('onclick', '');
            avatar.onclick = function (e) { e.preventDefault(); nav('/app/todos/'); };
        }
    });
})();
