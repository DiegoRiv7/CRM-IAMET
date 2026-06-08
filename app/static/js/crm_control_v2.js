/*
  crm_control_v2.js — Handler de la tab "Control" del dashboard.

  V2 (Boy Scout). NO modifica crm_main.js legacy. La estrategia:

    1. Al click en #crmModeControl:
         - Llamamos a window._crmSetMode('__control__'). Como ese mode no
           coincide con ninguna rama existente, _crmSetMode solo apaga
           el .active de los 4 botones conocidos y oculta ckClientesTablaSection.
         - Luego ocultamos a mano kpi/charts/detalle (que el legacy deja
           con su display anterior porque no entra a ninguna rama).
         - Marcamos #crmModeControl como .active y mostramos #ckControlSection.

    2. Al click en cualquier OTRO botón del dashDynamicIsland:
         - Quitamos .active de #crmModeControl y ocultamos #ckControlSection.
         - Su propio onclick="_crmSetMode(...)" se encarga del resto.

  Borrador — no hay fetch ni guardado todavía. Los datos del HTML son fijos.
*/
(function () {
    'use strict';

    var IDS_OTROS_KPI = [
        'ckKpiRow', 'ckKpiRowProsp', 'ckKpiRowProy',
        'ckChartsSection', 'ckChartsSectionProsp', 'ckChartsSectionProy',
        'ckDetalleSection', 'ckClientesTablaSection'
    ];
    var IDS_OTROS_BTNS = [
        'crmModeOpp', 'crmModeProsp', 'crmModeProyectos', 'crmModeClientes'
    ];

    function hide(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }

    function activarControl() {
        // 1. Llamar al legacy con un mode desconocido: apaga botones y limpia
        //    la sección de clientes. No toca kpi/charts/detalle.
        try {
            if (typeof window._crmSetMode === 'function') {
                window._crmSetMode('__control__');
            }
        } catch (e) { /* no-op */ }

        // 2. Ocultar manualmente las secciones que el legacy no toca con mode desconocido.
        IDS_OTROS_KPI.forEach(hide);

        // 3. Activar el botón Control y mostrar la sección.
        var btn = document.getElementById('crmModeControl');
        if (btn) btn.classList.add('active');

        var section = document.getElementById('ckControlSection');
        if (section) section.style.display = 'block';

        // 4. Update footer (las otras tabs escriben ahí; lo limpiamos).
        var footerLeft = document.getElementById('footerLeft');
        var footerRight = document.getElementById('footerRight');
        if (footerLeft) footerLeft.textContent = '6 proyectos en logística';
        if (footerRight) footerRight.textContent = 'PO total: $8.46M · Utilidad: $2.55M';

        // 5. Persistir preferencia (igual que el legacy hace con _crmClientesMode).
        try { localStorage.setItem('crm_clientes_mode', 'control'); } catch (e) {}
    }

    function desactivarControl() {
        var btn = document.getElementById('crmModeControl');
        if (btn) btn.classList.remove('active');
        var section = document.getElementById('ckControlSection');
        if (section) section.style.display = 'none';
    }

    function init() {
        var btn = document.getElementById('crmModeControl');
        if (!btn) return;

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            activarControl();
        });

        // Si el usuario clickea otro tab, ocultamos Control.
        IDS_OTROS_BTNS.forEach(function (id) {
            var b = document.getElementById(id);
            if (b) b.addEventListener('click', desactivarControl);
        });

        // Reportes también nos saca de Control.
        var btnRep = document.getElementById('crmModeReportes');
        if (btnRep) btnRep.addEventListener('click', desactivarControl);

        // Si la preferencia guardada era 'control', re-activar en load.
        try {
            if (localStorage.getItem('crm_clientes_mode') === 'control') {
                // Esperamos un tick para que el legacy termine su init.
                setTimeout(activarControl, 0);
            }
        } catch (e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Exponemos para debug y para que otras partes puedan abrir Control programáticamente.
    window._crmControl = {
        open: activarControl,
        close: desactivarControl
    };
})();
