/* ═══════════════════════════════════════════════════════════════════════
   perf_mode.js — Modo Ligero adaptativo (CRM + Tareas + Ventanas).

   Decide si la página corre en MODO LIGERO (clase body.ww-lite, ver
   perf_lite.css) según TRES señales, en orden de prioridad:

     1. MANUAL (toggle en el perfil): localStorage 'crmPerfMode' =
        'lite' | 'full' | 'auto'  (default 'auto'). Si es lite/full, manda.

     2. ESTÁTICO (auto): máquina probablemente vieja →
        navigator.hardwareConcurrency ≤ 4  o  deviceMemory ≤ 4  o
        prefers-reduced-motion. Se aplica de inmediato al cargar.

     3. DINÁMICO (auto): mientras arrastras una ventana (el peor caso de
        repintado) se mide el FPS. Si la página "sufre" (muchos frames
        largos sostenidos) → se pasa a ligero por el resto de la sesión.
        La recuperación ("ya va fluida → quitar ligero") ocurre al
        recargar: la marca de jank es en memoria (no persiste), así cada
        carga re-evalúa desde cero. Sin parpadeo de modo a media sesión.

   Costo: CERO en reposo. El monitor rAF solo corre DURANTE un arrastre de
   ventana, y se detiene al soltar. No hay polling de fondo.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var LS_KEY = 'crmPerfMode';        // 'auto' | 'lite' | 'full'
    var LITE_CLASS = 'ww-lite';
    var _jankSeen = false;             // EN MEMORIA → se resetea en cada reload

    function getPref() {
        try { return localStorage.getItem(LS_KEY) || 'auto'; } catch (e) { return 'auto'; }
    }
    function setPref(v) {
        if (v !== 'auto' && v !== 'lite' && v !== 'full') return;
        try { localStorage.setItem(LS_KEY, v); } catch (e) { }
        resolve();
    }

    // Señales ESTÁTICAS solo si son inequívocas. NO usamos
    // hardwareConcurrency: Safari lo capa y reportaba ≤4 hasta en una M2 →
    // metía equipos modernos a ligero por error. La detección real de
    // "equipo lento" la hace el benchmark de FPS (mide rendimiento de
    // verdad, sin falsos positivos).
    function staticLowEnd() {
        try {
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
            var dm = navigator.deviceMemory;   // Chrome; ausente en Safari
            if (typeof dm === 'number' && dm > 0 && dm <= 2) return true;  // RAM genuinamente baja
        } catch (e) { }
        return false;
    }

    function applyLite(on) {
        var b = document.body;
        if (!b) return;
        if (on) b.classList.add(LITE_CLASS);
        else b.classList.remove(LITE_CLASS);
    }

    function resolve() {
        var pref = getPref();
        if (pref === 'lite') { applyLite(true); updateToggleUI(); return; }
        if (pref === 'full') { applyLite(false); updateToggleUI(); return; }
        // auto
        applyLite(staticLowEnd() || _jankSeen);
        updateToggleUI();
    }

    /* ── Benchmark de carga: medición REAL de rendimiento ──
       Corre en modo COMPLETO durante ~1s, cuando el kanban (con sus
       animaciones de urgencia) ya está pintado. Si la máquina sufre
       (muchos frames largos sostenidos) → ligero. Mide rendimiento de
       verdad: una M2 lo pasa fácil → completo; una 2015 con kanban lleno
       no lo pasa → ligero. Cero falsos positivos por specs reportadas. */
    var _benchDone = false;
    function loadBenchmark() {
        if (_benchDone) return;
        if (getPref() !== 'auto') { _benchDone = true; return; }       // manual: no medir
        if (document.body.classList.contains(LITE_CLASS)) { _benchDone = true; return; } // ya ligero (reduced-motion)
        _benchDone = true;
        var last = performance.now(), jank = 0, frames = 0;
        function tick(now) {
            var dt = now - last; last = now;
            frames++;
            if (dt > 40) jank++;                 // frame >40ms = <25fps
            if (frames >= 55) {                  // ~1s de muestra real
                if (jank >= 22) {                // ≥40% frames lentos SOSTENIDO → equipo lento
                    _jankSeen = true;
                    applyLite(true);
                    updateToggleUI();
                }
                return;                          // benchmark terminado
            }
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    /* ── Monitor dinámico: solo durante un arrastre de ventana ── */
    var _monRunning = false;
    function startMonitor() {
        if (_monRunning) return;
        if (getPref() !== 'auto') return;                 // manual: sin auto-switch
        if (document.body.classList.contains(LITE_CLASS)) return;  // ya ligero
        _monRunning = true;
        var last = performance.now();
        var jank = 0, frames = 0;
        function tick(now) {
            if (!_monRunning) return;
            var dt = now - last; last = now;
            frames++;
            if (dt > 50) jank++;                          // frame >50ms = pico <20fps
            if (frames >= 45) {                           // ~0.75-1.5s de muestra
                if (jank >= 18) {                         // ≥40% frames con jank → sufre
                    _jankSeen = true;
                    applyLite(true);
                    updateToggleUI();
                    _monRunning = false;
                    return;
                }
                jank = 0; frames = 0;
            }
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }
    function stopMonitor() { _monRunning = false; }

    // Arrancar el monitor al iniciar un arrastre sobre una ventana (peor
    // caso de repintado); detener al soltar. Captura para correr antes que
    // los handlers del drag.
    document.addEventListener('pointerdown', function (ev) {
        if (!ev.target || !ev.target.closest) return;
        if (ev.target.closest('.ww-card')) startMonitor();
    }, true);
    document.addEventListener('pointerup', stopMonitor, true);
    document.addEventListener('pointercancel', stopMonitor, true);

    /* ── UI del toggle en el perfil (3 estados) ── */
    function updateToggleUI() {
        var pref = getPref();
        var isLite = document.body && document.body.classList.contains(LITE_CLASS);
        var seg = document.getElementById('perfModeSeg');
        if (seg) {
            seg.querySelectorAll('[data-perf-opt]').forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-perf-opt') === pref);
            });
        }
        var hint = document.getElementById('perfModeHint');
        if (hint) {
            if (pref === 'auto') {
                hint.textContent = isLite
                    ? 'Automático · ligero activo (equipo lento detectado)'
                    : 'Automático · efectos completos';
            } else if (pref === 'lite') {
                hint.textContent = 'Siempre ligero en este equipo';
            } else {
                hint.textContent = 'Siempre completo en este equipo';
            }
        }
    }

    // API pública (la consume el toggle del perfil).
    window.crmPerfMode = {
        get: getPref,
        set: setPref,
        isLite: function () { return !!(document.body && document.body.classList.contains(LITE_CLASS)); },
        resolve: resolve,
        refreshUI: updateToggleUI,
    };

    // Aplicar lo antes posible (este script se carga al final del body).
    if (document.body) resolve();
    else document.addEventListener('DOMContentLoaded', resolve);
    // Re-aplicar en cada navegación Turbo (body reemplazado pierde la clase).
    if (window.crmReady) window.crmReady(resolve);
    document.addEventListener('turbo:load', resolve);

    // Benchmark de carga: tras ~700ms (el kanban + sus animaciones ya están
    // pintados) se mide el rendimiento real ~1s. Solo una vez por carga.
    function scheduleBench() { setTimeout(loadBenchmark, 700); }
    if (document.readyState === 'complete') scheduleBench();
    else window.addEventListener('load', scheduleBench);
})();
