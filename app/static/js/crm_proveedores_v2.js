/*
  crm_proveedores_v2.js — Handler de la tab "Proveedores".
  Placeholder: solo activa/desactiva la sección sin lógica de datos.
*/
(function () {
    'use strict';

    var _activo = false;
    var _initialMode = null;
    try { _initialMode = localStorage.getItem('crm_clientes_mode'); } catch (e) {}

    var IDS_OTROS_KPI = [
        'ckKpiRow', 'ckKpiRowProsp', 'ckKpiRowProy',
        'ckChartsSection', 'ckChartsSectionProsp', 'ckChartsSectionProy',
        'ckDetalleSection', 'ckClientesTablaSection',
        'ckControlSection', 'ckMarcasSection'
    ];
    var IDS_OTROS_BTNS = [
        'crmModeOpp', 'crmModeProsp', 'crmModeProyectos', 'crmModeClientes',
        'crmModeControl', 'crmModeMarcas'
    ];

    function hide(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }

    function activar() {
        _activo = true;
        try { if (typeof window._crmSetMode === 'function') window._crmSetMode('__proveedores__'); } catch (e) {}
        IDS_OTROS_KPI.forEach(hide);

        var btn = document.getElementById('crmModeProveedores');
        if (btn) btn.classList.add('active');
        var section = document.getElementById('ckProveedoresSection');
        if (section) section.style.display = 'block';

        if (document.body) document.body.classList.add('crm-proveedores-active');

        try { localStorage.setItem('crm_clientes_mode', 'proveedores'); } catch (e) {}
    }

    function desactivar() {
        _activo = false;
        var btn = document.getElementById('crmModeProveedores');
        if (btn) btn.classList.remove('active');
        var section = document.getElementById('ckProveedoresSection');
        if (section) section.style.display = 'none';
        if (document.body) document.body.classList.remove('crm-proveedores-active');
    }

    function instalarGuard() {
        var orig = window._crmSetMode;
        if (typeof orig !== 'function') return false;
        if (orig._proveedoresPatched) return true;
        var patched = function (mode) {
            if (_activo && mode !== '__proveedores__' && mode !== 'proveedores') return;
            return orig.apply(this, arguments);
        };
        patched._proveedoresPatched = true;
        patched._original = orig;
        window._crmSetMode = patched;
        return true;
    }

    function init() {
        var btn = document.getElementById('crmModeProveedores');
        if (!btn) return;

        if (!instalarGuard()) setTimeout(instalarGuard, 0);

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            activar();
        });

        IDS_OTROS_BTNS.forEach(function (id) {
            var b = document.getElementById(id);
            if (b) b.addEventListener('click', desactivar, true);
        });
        var btnRep = document.getElementById('crmModeReportes');
        if (btnRep) btnRep.addEventListener('click', desactivar, true);

        if (_initialMode === 'proveedores') {
            setTimeout(activar, 50);
            setTimeout(function () { if (!_activo) activar(); }, 800);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window._crmProveedores = { open: activar, close: desactivar };
})();
