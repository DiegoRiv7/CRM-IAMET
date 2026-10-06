/* ════════════════════════════════════════════════════════════════════
   TEMA OTOÑO — escena de fondo en Canvas (árboles pintados + faroles).
   Se dibuja SOLO cuando body[data-theme="temporada"]. Lee la fase del día
   de body[data-fase] (la pone el motor de base.html) y se redibuja al
   cambiar la fase o al redimensionar. Inerte para cualquier otro tema.
   Mismo diseño aprobado en la vista previa.
   ════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    var canvas = null, ctx = null, _obs = null;

    // Paleta de follaje/tronco por fase (el día que avanza recolorea el árbol).
    var PAL = {
        despertar: { trunk: '#241711', wc: true, foliage: ['#C97B33', '#D99A47', '#B85E28', '#CE8A3C', '#E0A850', '#A85A2A'] },
        pleno: { trunk: '#2A1A10', wc: true, foliage: ['#E0922C', '#EEA836', '#C85A1E', '#D98227', '#F0B54A', '#B85020'] },
        atardecer: { trunk: '#1C0F09', wc: true, foliage: ['#C14D1E', '#A8361A', '#D9772A', '#B5451C', '#8E2A14'] },
        crepusculo: { trunk: '#120B08', foliage: ['#7A3E1A', '#6B4428', '#8A4A22', '#5A3A20', '#73421E', '#4E3016'] }
    };
    // Árboles: enmarcan los lados, con profundidad. Faroles: solo de noche.
    var TREES = [
        { xf: .50, yf: 1.00, hs: 60, depth: 6, seed: 83, a: .30 },
        { xf: .28, yf: 1.00, hs: 102, depth: 7, seed: 53, a: .60 },
        { xf: .72, yf: 1.00, hs: 108, depth: 7, seed: 67, a: .60 },
        { xf: .115, yf: .995, hs: 150, depth: 7, seed: 11, a: .95 },
        { xf: .885, yf: .995, hs: 160, depth: 7, seed: 29, a: .95 }
    ];
    var FAROLES = [
        { xf: .185, yf: .93, s: 1.05 }, { xf: .40, yf: .84, s: .72 },
        { xf: .60, yf: .86, s: .80 }, { xf: .83, yf: .945, s: 1.14 }
    ];

    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            var t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function drawTree(cfg, W, H, pal) {
        var rand = mulberry32(cfg.seed);
        var x = cfg.xf * W, y = cfg.yf * H, h = cfg.hs * (H / 900), tips = [];
        ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = pal.trunk;
        function branch(x, y, ang, len, w, d) {
            var x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
            if (pal.wc) {
                var over = len * (0.08 + rand() * 0.2),
                    ex = x2 + Math.cos(ang) * over + (rand() - 0.5) * w * 1.4,
                    ey = y2 + Math.sin(ang) * over + (rand() - 0.5) * w * 1.4;
                ctx.globalAlpha = cfg.a * (0.68 + rand() * 0.32);
                ctx.lineWidth = Math.max(0.5, w * (0.7 + rand() * 0.7));
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
                if (w > 1.3 && rand() < 0.7) {
                    ctx.globalAlpha = cfg.a * 0.22; ctx.lineWidth = Math.max(0.5, w * 0.42);
                    ctx.beginPath(); ctx.moveTo(x + (rand() - 0.5) * w, y + (rand() - 0.5) * w);
                    ctx.lineTo(ex + (rand() - 0.5) * w * 1.7, ey + (rand() - 0.5) * w); ctx.stroke();
                }
            } else {
                ctx.globalAlpha = cfg.a; ctx.lineWidth = Math.max(0.5, w);
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
            }
            if (d <= 0) { tips.push([x2, y2, len]); return; }
            var n = rand() < 0.38 ? 3 : 2;
            for (var i = 0; i < n; i++) {
                var spread = (i - (n - 1) / 2) * 0.5 + (rand() - 0.5) * 0.5,
                    nl = len * (0.70 + rand() * 0.12);
                branch(x2, y2, ang + spread, nl, w * 0.67, d - 1);
            }
        }
        branch(x, y, -Math.PI / 2 + (rand() - 0.5) * 0.08, h, h * 0.12, cfg.depth);
        for (var i = 0; i < tips.length; i++) {
            var t = tips[i], fx = t[0], fy = t[1], r = Math.max(10, t[2] * 2.3), m = 6 + ((rand() * 6) | 0);
            for (var k = 0; k < m; k++) {
                var a = rand() * 6.2832, rr = Math.sqrt(rand()) * r, px = fx + Math.cos(a) * rr, py = fy + Math.sin(a) * rr;
                ctx.globalAlpha = cfg.a * (0.35 + rand() * 0.4);
                ctx.fillStyle = pal.foliage[(rand() * pal.foliage.length) | 0];
                if (pal.wc) {
                    ctx.save(); ctx.translate(px, py); ctx.rotate(rand() * 6.2832);
                    ctx.beginPath(); ctx.ellipse(0, 0, 2.6 + rand() * 4.4, 1.1 + rand() * 2.2, 0, 0, 6.2832); ctx.fill();
                    ctx.restore();
                } else {
                    ctx.beginPath(); ctx.arc(px, py, 2.2 + rand() * 3.6, 0, 6.2832); ctx.fill();
                }
            }
        }
        ctx.restore();
    }

    function drawFarol(cfg, W, H) {
        var x = cfg.xf * W, y = cfg.yf * H, s = cfg.s * (H / 900), postH = 160 * s, headY = y - postH;
        ctx.save(); ctx.globalAlpha = 1;
        var gr0 = ctx.createLinearGradient(0, y, 0, y + 150 * s);
        gr0.addColorStop(0, 'rgba(240,168,80,.20)'); gr0.addColorStop(1, 'rgba(240,168,80,0)');
        ctx.fillStyle = gr0; ctx.fillRect(x - 16 * s, y, 32 * s, 150 * s);
        ctx.globalCompositeOperation = 'lighter';
        var gr = ctx.createRadialGradient(x, headY, 0, x, headY, 150 * s);
        gr.addColorStop(0, 'rgba(255,205,120,.85)'); gr.addColorStop(.32, 'rgba(240,160,70,.42)'); gr.addColorStop(1, 'rgba(235,145,55,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, headY, 150 * s, 0, 6.2832); ctx.fill(); ctx.restore();
        ctx.save(); ctx.globalAlpha = 1; ctx.strokeStyle = '#140D0A'; ctx.fillStyle = '#1A120C'; ctx.lineCap = 'round';
        ctx.lineWidth = 6 * s; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, headY + 8 * s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 11 * s, headY + 8 * s); ctx.lineTo(x + 11 * s, headY + 8 * s); ctx.lineTo(x + 8 * s, headY - 18 * s); ctx.lineTo(x - 8 * s, headY - 18 * s); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - 13 * s, headY - 18 * s); ctx.lineTo(x + 13 * s, headY - 18 * s); ctx.lineTo(x, headY - 32 * s); ctx.closePath(); ctx.fill(); ctx.restore();
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        var gi = ctx.createRadialGradient(x, headY - 5 * s, 0, x, headY - 5 * s, 15 * s);
        gi.addColorStop(0, 'rgba(255,230,160,1)'); gi.addColorStop(1, 'rgba(255,195,95,0)');
        ctx.fillStyle = gi; ctx.beginPath(); ctx.arc(x, headY - 5 * s, 15 * s, 0, 6.2832); ctx.fill(); ctx.restore();
    }

    var _W = 0, _H = 0;
    function faseActual() {
        var f = document.body.getAttribute('data-fase') || 'pleno';
        return PAL[f] ? f : 'pleno';
    }
    function esTemporada() { return document.body.getAttribute('data-theme') === 'temporada'; }

    function dibujar() {
        if (!_W || !_H) return;
        ctx.clearRect(0, 0, _W, _H);
        if (!esTemporada()) return;
        var fase = faseActual(), pal = PAL[fase];
        for (var i = 0; i < TREES.length; i++) drawTree(TREES[i], _W, _H, pal);
        if (fase === 'crepusculo') for (var j = 0; j < FAROLES.length; j++) drawFarol(FAROLES[j], _W, _H);
    }

    function setup() {
        if (!canvas || !ctx) return;
        if (!esTemporada()) { if (_W && _H) ctx.clearRect(0, 0, _W, _H); return; }
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        _W = window.innerWidth; _H = window.innerHeight;
        canvas.width = _W * dpr; canvas.height = _H * dpr;
        canvas.style.width = _W + 'px'; canvas.style.height = _H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        dibujar();
    }

    // Re-inicializa: re-encuentra el canvas (Turbo reemplaza el <body> al
    // navegar), re-aplica la fase del día, re-observa y redibuja.
    function boot() {
        canvas = document.getElementById('tmpEscena');
        if (!canvas || !canvas.getContext) return;
        ctx = canvas.getContext('2d');
        if (window.__tmpAplicarFase) { try { window.__tmpAplicarFase(); } catch (e) { } }
        if (_obs) { try { _obs.disconnect(); } catch (e) { } }
        try {
            _obs = new MutationObserver(function () { dibujar(); });
            _obs.observe(document.body, { attributes: true, attributeFilter: ['data-fase', 'data-theme'] });
        } catch (e) { }
        setup();
    }

    var _rt;
    window.addEventListener('resize', function () { clearTimeout(_rt); _rt = setTimeout(setup, 150); });
    document.addEventListener('turbo:load', boot);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
