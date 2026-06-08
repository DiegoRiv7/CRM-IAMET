/*
  crm_control_v2.js — Handler de la tab "Control" del dashboard.

  V2 (Boy Scout). NO modifica crm_main.js legacy. Estrategia:

    1. MONKEY-PATCH a window._crmSetMode (instalado al cargar este script).
       Mientras _controlActivo sea true, las llamadas con cualquier mode que
       NO sea '__control__' o 'control' se ignoran. Esto bloquea los refreshes
       periódicos del legacy (línea ~2291 de crm_main.js) que re-aplican el
       último modo cada vez que se carga el panel de clientes.

    2. CAPTURE-PHASE listeners en los botones de las otras tabs. El onclick
       inline del legacy ("_crmSetMode('oportunidades')") corre en bubbling.
       Si usamos capture, nuestro desactivarControl() corre PRIMERO → apaga
       _controlActivo → el guard ya no bloquea → el onclick legacy ejecuta
       normalmente.

    3. PERSISTENCIA: al cargar, si localStorage tiene 'control' → re-activar.
       Doble retry (50ms y 800ms) para sobrevivir a fetches async del legacy
       que podrían tratar de pintar Oportunidades por encima.

  Borrador — datos del HTML son fijos, sin fetch ni guardado todavía.
*/
(function () {
    'use strict';

    var _controlActivo = false;
    var _initialMode = null;
    try { _initialMode = localStorage.getItem('crm_clientes_mode'); } catch (e) {}

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
        _controlActivo = true;

        // 1. Llamar al legacy con un mode desconocido para que apague los 4 botones
        //    conocidos y oculte cliSection. El guard nos deja pasar el '__control__'.
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

        // 4. Footer (las otras tabs lo escriben; le ponemos algo coherente).
        var footerLeft = document.getElementById('footerLeft');
        var footerRight = document.getElementById('footerRight');
        if (footerLeft) footerLeft.textContent = '6 proyectos en logística';
        if (footerRight) footerRight.textContent = 'PO total: $8.46M · Utilidad: $2.55M';

        // 5. Persistir preferencia.
        try { localStorage.setItem('crm_clientes_mode', 'control'); } catch (e) {}
    }

    function desactivarControl() {
        // IMPORTANTE: apagar la flag ANTES de que el legacy ejecute su onclick,
        // si no, el guard bloquea el cambio a Oportunidades/Prospectos/etc.
        _controlActivo = false;

        var btn = document.getElementById('crmModeControl');
        if (btn) btn.classList.remove('active');
        var section = document.getElementById('ckControlSection');
        if (section) section.style.display = 'none';
    }

    /* MONKEY-PATCH:
       Reemplazamos window._crmSetMode. Cuando estamos en Control, ignoramos
       cualquier llamada automática a otros modos (refreshes periódicos del
       legacy). Las llamadas que vienen de clicks reales del usuario ya
       limpiaron _controlActivo en capture-phase, así que pasan. */
    function instalarGuard() {
        var orig = window._crmSetMode;
        if (typeof orig !== 'function') return false;
        if (orig._controlPatched) return true;
        var patched = function (mode) {
            if (_controlActivo && mode !== '__control__' && mode !== 'control') {
                // Refresh automático mientras estamos en Control: ignorar.
                return;
            }
            return orig.apply(this, arguments);
        };
        patched._controlPatched = true;
        // Conservamos referencia al original por si algún día se necesita.
        patched._original = orig;
        window._crmSetMode = patched;
        return true;
    }

    function init() {
        var btn = document.getElementById('crmModeControl');
        if (!btn) return;

        // Intentar instalar el guard ya. Si _crmSetMode aún no existe (orden
        // de carga raro), reintentamos en un tick.
        if (!instalarGuard()) {
            setTimeout(instalarGuard, 0);
        }

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            activarControl();
        });

        // Capture-phase: corremos ANTES del onclick inline del legacy.
        IDS_OTROS_BTNS.forEach(function (id) {
            var b = document.getElementById(id);
            if (b) b.addEventListener('click', desactivarControl, true);
        });
        var btnRep = document.getElementById('crmModeReportes');
        if (btnRep) btnRep.addEventListener('click', desactivarControl, true);

        // Persistencia: si el storage decía 'control', re-activar.
        // Doble retry por si una fetch async del legacy llega después y pinta encima.
        if (_initialMode === 'control') {
            setTimeout(activarControl, 50);
            setTimeout(function () { if (!_controlActivo) activarControl(); }, 800);
            setTimeout(function () { if (!_controlActivo) activarControl(); }, 2000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Exponemos para debug y para que otras partes puedan controlar Control.
    window._crmControl = {
        open: activarControl,
        close: desactivarControl,
        get activo() { return _controlActivo; }
    };
})();
