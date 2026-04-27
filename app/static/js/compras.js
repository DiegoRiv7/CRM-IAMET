/* ═══════════════════════════════════════════════════════════════════════
   compras.js — Núcleo del módulo Compras (perfil administrador)
   - Switching entre secciones (Productos / Proveedores / OC / Gastos)
   - Helpers: comprasFetch (CSRF + JSON), comprasInit
   - Stubs públicos (window.compras*) que serán inyectados por:
       compras_productos.js / compras_proveedores.js
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function comprasSwitchSection(section) {
        var panels = document.querySelectorAll('.compras-section');
        panels.forEach(function (p) {
            p.classList.toggle('is-active', p.dataset.section === section);
        });

        var tabs = document.querySelectorAll('.compras-tabs .crm-tab');
        tabs.forEach(function (t) {
            t.classList.toggle('active', t.dataset.comprasSection === section);
        });

        if (section === 'productos' && typeof window.comprasProductosInit === 'function') {
            window.comprasProductosInit();
        }
        if (section === 'proveedores' && typeof window.comprasProveedoresInit === 'function') {
            window.comprasProveedoresInit();
        }

        try { localStorage.setItem('comprasSection', section); } catch (e) {}
    }

    function comprasInit() {
        var saved = null;
        try { saved = localStorage.getItem('comprasSection'); } catch (e) {}
        var allowed = { productos: 1, proveedores: 1, oc: 1, gastos: 1 };
        var section = (saved && allowed[saved]) ? saved : 'productos';
        comprasSwitchSection(section);
    }

    // CSRF helper for fetch
    function getCookie(name) {
        var v = '; ' + document.cookie;
        var parts = v.split('; ' + name + '=');
        if (parts.length === 2) return parts.pop().split(';').shift();
        return '';
    }

    function comprasFetch(url, options) {
        options = options || {};
        options.headers = options.headers || {};
        options.headers['X-CSRFToken'] = getCookie('csrftoken');
        options.credentials = options.credentials || 'same-origin';
        if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(options.body);
        }
        return fetch(url, options).then(function (r) {
            if (!r.ok) {
                return r.json().then(function (j) { throw j; }).catch(function () {
                    throw { error: 'HTTP ' + r.status };
                });
            }
            return r.json();
        });
    }

    // Empty stubs — filled by compras_productos.js / compras_proveedores.js
    window.comprasProductosInit = window.comprasProductosInit || function () {};
    window.comprasProveedoresInit = window.comprasProveedoresInit || function () {};

    // Public API
    window.comprasSwitchSection = comprasSwitchSection;
    window.comprasInit = comprasInit;
    window.comprasFetch = comprasFetch;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            // Don't auto-init; let switchCrmView('compras') trigger it
        });
    }
})();
