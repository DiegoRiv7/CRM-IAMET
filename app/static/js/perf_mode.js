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
        // Cambio manual: cortar cualquier probe/estado del controlador y
        // re-arrancar según el nuevo modo (auto → vigila; manual → para).
        _autoDowngraded = false; _probing = false; _rafOn = false;
        if (_probeTimer) { clearTimeout(_probeTimer); _probeTimer = null; }
        resolve();
        startController();
        // Telemetría del cambio manual (el usuario eligió explícitamente).
        var liteNow = !!(document.body && document.body.classList.contains(LITE_CLASS));
        if (v === 'lite') report('lite', 'manual_lite', null);
        else if (v === 'full') report('full', 'manual_full', null);
        else report(liteNow ? 'lite' : 'full', 'manual_auto', null);
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

    // Cache POR SESIÓN de "este equipo va lento": evita re-medir (y el
    // micro-jank del benchmark) en cada recarga. Se limpia al cerrar la
    // pestaña; si la carga se libera, el probe lo borra al volver a completo.
    var SS_LITE = 'crmPerfSessionLite';
    function sessionLiteSet(v) { try { v ? sessionStorage.setItem(SS_LITE, '1') : sessionStorage.removeItem(SS_LITE); } catch (e) { } }
    function sessionLiteGet() { try { return sessionStorage.getItem(SS_LITE) === '1'; } catch (e) { return false; } }

    var _fxTimer = null;
    function applyLite(on, smooth) {
        var b = document.body;
        if (!b) return;
        var was = b.classList.contains(LITE_CLASS);
        if (!!on === was) return;   // sin cambio real
        // Crossfade: al cambiar de modo (sobre todo SUBIR a completo) las
        // sombras/blur/brillo aparecen/desaparecen con transición, no de
        // golpe. El JS pone ww-fx-fade ~420ms (ver perf_lite.css).
        if (smooth) {
            b.classList.add('ww-fx-fade');
            if (_fxTimer) clearTimeout(_fxTimer);
            _fxTimer = setTimeout(function () { b.classList.remove('ww-fx-fade'); }, 460);
        }
        if (on) b.classList.add(LITE_CLASS);
        else b.classList.remove(LITE_CLASS);
    }

    function resolve() {
        var pref = getPref();
        if (pref === 'lite') { applyLite(true); updateToggleUI(); return; }
        if (pref === 'full') { applyLite(false); updateToggleUI(); return; }
        // auto: ligero si señal estática, o jank ya visto, o el equipo ya
        // venía marcado lento esta sesión (evita re-jank en cada recarga).
        applyLite(staticLowEnd() || _jankSeen || sessionLiteGet());
        updateToggleUI();
    }

    /* ── Aviso sutil (estilo notice de fallo): pill chico abajo, 5s ── */
    var _noticeEl = null, _noticeTimer = null;
    function showNotice(text) {
        try {
            if (!_noticeEl) {
                _noticeEl = document.createElement('div');
                _noticeEl.id = 'perfModeNotice';
                _noticeEl.style.cssText = [
                    'position:fixed', 'left:50%', 'bottom:18px', 'transform:translateX(-50%) translateY(8px)',
                    'z-index:99998', 'background:rgba(28,28,30,0.92)', 'color:#fff',
                    'font:500 12.5px -apple-system,"Segoe UI",Roboto,sans-serif', 'letter-spacing:0.01em',
                    'padding:8px 14px', 'border-radius:999px', 'box-shadow:0 4px 16px rgba(0,0,0,0.25)',
                    'pointer-events:none', 'opacity:0', 'transition:opacity .25s ease, transform .25s ease',
                    'display:flex', 'align-items:center', 'gap:8px', 'max-width:90vw', 'white-space:nowrap'
                ].join(';');
                document.body.appendChild(_noticeEl);
            }
            _noticeEl.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:#34C759;flex:0 0 auto;"></span><span></span>';
            _noticeEl.lastChild.textContent = text;
            // forzar reflow → animar entrada
            void _noticeEl.offsetHeight;
            _noticeEl.style.opacity = '1';
            _noticeEl.style.transform = 'translateX(-50%) translateY(0)';
            if (_noticeTimer) clearTimeout(_noticeTimer);
            _noticeTimer = setTimeout(function () {
                if (!_noticeEl) return;
                _noticeEl.style.opacity = '0';
                _noticeEl.style.transform = 'translateX(-50%) translateY(8px)';
            }, 5000);
        } catch (e) { /* el aviso nunca debe romper nada */ }
    }

    /* ── Telemetría (opcional, fire-and-forget) ──
       Reporta SOLO cambios ASENTADOS de modo (no por frame) a
       /app/api/perf/evento/ para que los supervisores vean en el panel
       qué equipos batallan. Nunca bloquea ni rompe nada: si falla, se
       ignora. 'benchmark'/'static' se mandan una vez por sesión (no una
       fila por recarga); los dinámicos/manuales son raros de por sí. */
    function csrfCookie() {
        try {
            var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
            if (m) return decodeURIComponent(m[1]);
            var el = document.querySelector('[name=csrfmiddlewaretoken]');
            return el ? el.value : '';
        } catch (e) { return ''; }
    }
    function deviceInfo() {
        var info = {};
        try { info.cores = navigator.hardwareConcurrency || null; } catch (e) { }
        try { info.device_memory = (typeof navigator.deviceMemory === 'number') ? navigator.deviceMemory : null; } catch (e) { }
        try {
            var dpr = Math.round((window.devicePixelRatio || 1) * 10) / 10;
            info.pantalla = (screen.width + 'x' + screen.height + '@' + dpr).slice(0, 24);
        } catch (e) { }
        return info;
    }
    function report(modo, motivo, fps) {
        try {
            // Dedupe por sesión para los motivos que se repiten en cada carga.
            if (motivo === 'benchmark' || motivo === 'static') {
                var k = 'crmPerfRep_' + motivo;
                if (sessionStorage.getItem(k) === '1') return;
                sessionStorage.setItem(k, '1');
            }
            var payload = deviceInfo();
            payload.modo = modo;
            payload.motivo = motivo;
            if (typeof fps === 'number' && isFinite(fps)) payload.fps = Math.round(fps * 10) / 10;
            var body = JSON.stringify(payload);
            // sendBeacon no manda CSRF header → usamos fetch keepalive.
            fetch('/app/api/perf/evento/', {
                method: 'POST',
                credentials: 'same-origin',
                keepalive: true,
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfCookie() },
                body: body
            }).catch(function () { /* telemetría: nunca romper */ });
        } catch (e) { /* idem */ }
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
        if (document.body.classList.contains(LITE_CLASS)) { _benchDone = true; startController(); return; } // ya ligero (reduced-motion)
        _benchDone = true;
        var t0 = performance.now(), last = t0, jank = 0, frames = 0;
        function tick(now) {
            var dt = now - last; last = now;
            frames++;
            if (dt > 40) jank++;                 // frame >40ms = <25fps
            if (frames >= 55) {                  // ~1s de muestra real
                var fps = frames * 1000 / (now - t0);   // FPS promedio real de la muestra
                if (jank >= 22) {                // ≥40% frames lentos SOSTENIDO → equipo lento
                    _jankSeen = true;
                    applyLite(true);             // al cargar: instantáneo (aún no hay nada que "suavizar")
                    sessionLiteSet(true);
                    updateToggleUI();
                    showNotice('Modo ligero activado para mantener la fluidez');
                    report('lite', 'benchmark', fps);
                }
                startController();               // el benchmark cede al controlador adaptativo
                return;                          // benchmark terminado
            }
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    /* ══════════════════════════════════════════════════════════════════
       CONTROLADOR ADAPTATIVO DE DOS VÍAS (solo en modo 'auto')

       · En COMPLETO: vigila los FPS. Si la máquina SUFRE de forma
         SOSTENIDA (≈2.5s bajo 32fps — p.ej. AutoCAD + 10 apps comiéndose
         el equipo) → baja a ligero. Requiere jank sostenido, no picos,
         para no dar "falsos bajos rendimientos".
       · En LIGERO (bajado por el controlador): cada cierto tiempo y SOLO
         en reposo (usuario sin interactuar), hace un "probe" a completo
         ~1.6s; si fluye (carga liberada) → se queda en completo; si no →
         vuelve a ligero y ESPACIA el próximo intento (backoff 30s→3min).
       · Pausado cuando la pestaña no es visible. En ligero NO corre rAF
         continuo (espera el probe por timer) → cero costo en reposo.
       ══════════════════════════════════════════════════════════════════ */
    var FPS_BAD = 32, FPS_GOOD = 50;
    var DOWNGRADE_MS = 2500;          // jank sostenido → completo→ligero
    var PROBE_DUR = 1600;             // duración del probe a completo
    var PROBE_BASE = 30000, PROBE_MAX = 180000;

    var _autoDowngraded = false;      // en ligero por decisión del controlador
    var _fpsAvg = 60, _badAccum = 0, _lastT = 0, _rafOn = false;
    var _lastInteract = Date.now();
    var _probing = false, _probeUntil = 0, _probeGood = 0;
    var _probeTimer = null, _probeInterval = PROBE_BASE;

    function idle() { return Date.now() - _lastInteract > 1800; }

    function ensureRaf() {
        if (_rafOn) return;
        if (getPref() !== 'auto' || document.hidden) return;
        _rafOn = true; _lastT = 0;
        requestAnimationFrame(rafLoop);
    }
    function markInteract() { _lastInteract = Date.now(); ensureRaf(); }
    ['pointerdown', 'pointermove', 'wheel', 'keydown'].forEach(function (e) {
        window.addEventListener(e, markInteract, { passive: true, capture: true });
    });
    window.addEventListener('scroll', markInteract, { passive: true, capture: true });

    function rafLoop(now) {
        if (!_rafOn) return;
        if (document.hidden || getPref() !== 'auto') { _rafOn = false; return; }
        if (_lastT === 0) { _lastT = now; requestAnimationFrame(rafLoop); return; }
        var dt = now - _lastT; _lastT = now;
        if (dt > 0) {
            _fpsAvg = _fpsAvg * 0.85 + (1000 / dt) * 0.15;
            step(now, dt);
        }
        if (_rafOn) requestAnimationFrame(rafLoop);
    }

    function step(now, dt) {
        var lite = document.body.classList.contains(LITE_CLASS);
        if (_probing) {
            if (_fpsAvg >= FPS_GOOD) _probeGood += dt;
            if (now >= _probeUntil) endProbe();
            return;
        }
        if (lite) return;  // en ligero sin probe: el rAF no debería correr
        // COMPLETO: acumular jank SOSTENIDO → bajar.
        if (_fpsAvg < FPS_BAD) _badAccum += dt;
        else _badAccum = Math.max(0, _badAccum - dt * 0.6);  // recupera, no de golpe
        if (_badAccum > DOWNGRADE_MS) {
            // Bajar INSTANTÁNEO (escapar del jank ya), sin crossfade.
            applyLite(true, false); _autoDowngraded = true; _jankSeen = true;
            sessionLiteSet(true);
            _badAccum = 0; _rafOn = false;     // en ligero esperamos al probe por timer
            updateToggleUI();
            showNotice('Modo ligero activado para mantener la fluidez');
            report('lite', 'dynamic', _fpsAvg);
            scheduleProbe();
        } else if (_fpsAvg >= FPS_GOOD && now - _lastInteract > 6000) {
            // Completo fluido + reposo prolongado → apagar rAF para ahorrar
            // (se re-arma en la próxima interacción / visibilitychange).
            _rafOn = false;
        }
    }

    function scheduleProbe() {
        if (_probeTimer) clearTimeout(_probeTimer);
        _probeTimer = setTimeout(tryProbe, _probeInterval);
    }
    function tryProbe() {
        if (getPref() !== 'auto' || !_autoDowngraded) return;
        if (document.hidden || !idle()) { scheduleProbe(); return; }  // reintentar en reposo
        _probing = true; _probeGood = 0; _probeUntil = performance.now() + PROBE_DUR;
        _fpsAvg = 60;
        applyLite(false, true);   // SUBIR a completo SUAVE (crossfade) para medir
        ensureRaf();
    }
    function endProbe() {
        _probing = false;
        if (_probeGood > PROBE_DUR * 0.6) {
            // Fluye → la carga se liberó: quedarse en completo.
            _autoDowngraded = false; _jankSeen = false; _probeInterval = PROBE_BASE;
            sessionLiteSet(false);
            updateToggleUI();   // seguimos en completo con rAF vigilando
            showNotice('Efectos completos restaurados');
            report('full', 'probe_up', _fpsAvg);
        } else {
            // Sigue pesado → volver a ligero SUAVE y espaciar el próximo probe.
            applyLite(true, true);
            _probeInterval = Math.min(_probeInterval * 2, PROBE_MAX);
            _rafOn = false;
            updateToggleUI();
            scheduleProbe();
        }
    }

    // Arrancar a vigilar tras resolver el modo inicial.
    function startController() {
        if (getPref() !== 'auto') { _rafOn = false; if (_probeTimer) clearTimeout(_probeTimer); return; }
        if (document.body.classList.contains(LITE_CLASS)) {
            // Si es ligero por señal ESTÁTICA (reduced-motion / RAM baja),
            // el usuario/equipo PIDE poco movimiento → quedarse en ligero,
            // sin probes de subida. Si es por JANK del benchmark, sí
            // programar probes para recuperar completo cuando se libere carga.
            if (staticLowEnd()) { _autoDowngraded = false; report('lite', 'static', null); return; }
            _autoDowngraded = true;
            scheduleProbe();
        } else {
            ensureRaf();
        }
    }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) { _rafOn = false; return; }
        if (getPref() === 'auto' && !document.body.classList.contains(LITE_CLASS)) ensureRaf();
    });

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
