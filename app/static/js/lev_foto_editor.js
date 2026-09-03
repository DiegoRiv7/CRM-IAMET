/* Editor de fotos de evidencia — marcado sobre la imagen.
 *
 * Se abre desde el visor de una foto del levantamiento. Permite dibujar a mano
 * alzada, escribir texto, poner flechas y rectangulos, elegir color y grosor,
 * deshacer y limpiar. Al guardar NO se pisa la original: el servidor guarda la
 * version marcada como una foto nueva que apunta a ella.
 *
 * Se dibuja en un canvas a la RESOLUCION REAL de la foto, no a la que se ve en
 * pantalla: si se guardara lo mostrado, una evidencia de 4000px volveria
 * reducida a 900 y se perderia el detalle, que es justo para lo que sirve.
 *
 * Expone window.levFotoEditor.abrir({url, evidenciaId, comentario, alGuardar}).
 */
(function () {
    'use strict';

    var COLORES = ['#EF4444', '#F59E0B', '#10B981', '#2563EB', '#111827', '#FFFFFF'];
    var GROSORES = [3, 6, 12];

    function el(tag, cls, html) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (html != null) n.innerHTML = html;
        return n;
    }

    function abrir(opts) {
        var previo = document.getElementById('levFotoEditor');
        if (previo) previo.remove();

        var st = {
            herramienta: 'lapiz',
            color: COLORES[0],
            grosor: GROSORES[1],
            trazos: [],        // cada entrada es una accion completa: deshacer = quitar la ultima
            dibujando: false,
            actual: null,
        };

        var ov = el('div', 'lfe-ov');
        ov.id = 'levFotoEditor';
        ov.innerHTML =
            '<div class="lfe-box">' +
              '<div class="lfe-top">' +
                '<div class="lfe-tools" data-tools>' +
                  '<button type="button" class="lfe-t is-on" data-h="lapiz" title="Dibujar">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg></button>' +
                  '<button type="button" class="lfe-t" data-h="flecha" title="Flecha">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="12 5 19 5 19 12"/></svg></button>' +
                  '<button type="button" class="lfe-t" data-h="rect" title="Rectángulo">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/></svg></button>' +
                  '<button type="button" class="lfe-t" data-h="texto" title="Escribir">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg></button>' +
                '</div>' +
                '<div class="lfe-colores" data-colores></div>' +
                '<div class="lfe-grosores" data-grosores></div>' +
                '<div class="lfe-sep"></div>' +
                '<button type="button" class="lfe-b" data-deshacer title="Deshacer">Deshacer</button>' +
                '<button type="button" class="lfe-b" data-limpiar title="Quitar todas las marcas">Limpiar</button>' +
                '<button type="button" class="lfe-x" data-cerrar title="Cerrar">&times;</button>' +
              '</div>' +
              '<div class="lfe-lienzo" data-lienzo><canvas data-canvas></canvas></div>' +
              '<div class="lfe-pie">' +
                '<input type="text" class="lfe-cap" data-cap maxlength="255" placeholder="¿De qué es esta foto?">' +
                '<span class="lfe-estado" data-estado></span>' +
                '<button type="button" class="lfe-cancel" data-cerrar>Cancelar</button>' +
                '<button type="button" class="lfe-ok" data-guardar>Guardar marcado</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(ov);

        var canvas = ov.querySelector('[data-canvas]');
        var ctx = canvas.getContext('2d');
        var lienzo = ov.querySelector('[data-lienzo]');
        var estado = ov.querySelector('[data-estado]');
        var cap = ov.querySelector('[data-cap]');
        cap.value = opts.comentario || '';

        // Paleta y grosores
        var cont = ov.querySelector('[data-colores]');
        COLORES.forEach(function (c, i) {
            var b = el('button', 'lfe-c' + (i === 0 ? ' is-on' : ''));
            b.type = 'button';
            b.style.background = c;
            b.title = 'Color';
            b.onclick = function () {
                st.color = c;
                cont.querySelectorAll('.lfe-c').forEach(function (x) { x.classList.remove('is-on'); });
                b.classList.add('is-on');
            };
            cont.appendChild(b);
        });
        var cg = ov.querySelector('[data-grosores]');
        GROSORES.forEach(function (g, i) {
            var b = el('button', 'lfe-g' + (i === 1 ? ' is-on' : ''));
            b.type = 'button';
            b.title = 'Grosor';
            b.innerHTML = '<span style="width:' + (g + 4) + 'px;height:' + (g + 4) + 'px"></span>';
            b.onclick = function () {
                st.grosor = g;
                cg.querySelectorAll('.lfe-g').forEach(function (x) { x.classList.remove('is-on'); });
                b.classList.add('is-on');
            };
            cg.appendChild(b);
        });

        ov.querySelector('[data-tools]').addEventListener('click', function (e) {
            var b = e.target.closest('[data-h]');
            if (!b) return;
            st.herramienta = b.getAttribute('data-h');
            ov.querySelectorAll('.lfe-t').forEach(function (x) { x.classList.remove('is-on'); });
            b.classList.add('is-on');
            canvas.style.cursor = (st.herramienta === 'texto') ? 'text' : 'crosshair';
        });

        // ── La imagen ──
        // crossOrigin para que el canvas no quede "manchado" y toBlob funcione;
        // las fotos se sirven del mismo dominio, asi que no estorba.
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            repintar();
        };
        img.onerror = function () { estado.textContent = 'No se pudo cargar la foto.'; };
        img.src = opts.url;

        function repintar() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            st.trazos.forEach(pintarTrazo);
            if (st.actual) pintarTrazo(st.actual);
        }

        function pintarTrazo(t) {
            ctx.save();
            ctx.strokeStyle = t.color;
            ctx.fillStyle = t.color;
            ctx.lineWidth = t.grosor;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (t.tipo === 'lapiz' && t.pts.length) {
                ctx.beginPath();
                ctx.moveTo(t.pts[0].x, t.pts[0].y);
                t.pts.forEach(function (p) { ctx.lineTo(p.x, p.y); });
                ctx.stroke();
            } else if (t.tipo === 'rect') {
                ctx.strokeRect(t.x1, t.y1, t.x2 - t.x1, t.y2 - t.y1);
            } else if (t.tipo === 'flecha') {
                var dx = t.x2 - t.x1, dy = t.y2 - t.y1;
                var ang = Math.atan2(dy, dx);
                var punta = Math.max(14, t.grosor * 4);
                ctx.beginPath();
                ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(t.x2, t.y2);
                ctx.lineTo(t.x2 - punta * Math.cos(ang - Math.PI / 7), t.y2 - punta * Math.sin(ang - Math.PI / 7));
                ctx.lineTo(t.x2 - punta * Math.cos(ang + Math.PI / 7), t.y2 - punta * Math.sin(ang + Math.PI / 7));
                ctx.closePath(); ctx.fill();
            } else if (t.tipo === 'texto') {
                var px = Math.max(18, t.grosor * 6);
                ctx.font = '700 ' + px + 'px system-ui, -apple-system, sans-serif';
                ctx.textBaseline = 'top';
                // Halo oscuro para que el texto claro se lea sobre foto clara.
                ctx.lineWidth = Math.max(3, px / 8);
                ctx.strokeStyle = 'rgba(0,0,0,.55)';
                ctx.strokeText(t.texto, t.x1, t.y1);
                ctx.fillText(t.texto, t.x1, t.y1);
            }
            ctx.restore();
        }

        // Pantalla → coordenadas reales de la foto.
        function punto(e) {
            var r = canvas.getBoundingClientRect();
            var src = (e.touches && e.touches[0]) || e;
            return {
                x: (src.clientX - r.left) * (canvas.width / r.width),
                y: (src.clientY - r.top) * (canvas.height / r.height),
            };
        }

        // ── Texto en el lugar (estilo "Marcado" de Mac) ──
        // En vez de un prompt del navegador, se coloca un campo de texto justo
        // sobre el punto tocado; se escribe en su sitio y al confirmar queda
        // dibujado en la foto. Enter confirma, Esc cancela, y tocar fuera guarda.
        var textoInput = null;
        function abrirTexto(e, p) {
            cerrarTextoAbierto();
            var lr = lienzo.getBoundingClientRect();
            var src = (e.touches && e.touches[0]) || e;
            var sx = src.clientX - lr.left + lienzo.scrollLeft;
            var sy = src.clientY - lr.top + lienzo.scrollTop;
            var vista = canvas.getBoundingClientRect();
            var escala = canvas.width ? (vista.width / canvas.width) : 1;
            var px = Math.max(18, st.grosor * 6) * escala;   // tamaño visible ≈ el que quedará dibujado
            var inp = el('input', 'lfe-textin');
            inp.type = 'text';
            inp.maxLength = 120;
            inp.setAttribute('placeholder', 'Escribe…');
            inp.style.left = sx + 'px';
            inp.style.top = (sy - px * 0.7) + 'px';
            inp.style.color = st.color;
            inp.style.fontSize = px + 'px';
            lienzo.appendChild(inp);
            textoInput = { el: inp, p: p };
            setTimeout(function () { inp.focus(); }, 10);
            // Que el campo no dispare trazos del canvas.
            ['mousedown', 'touchstart', 'mousemove', 'touchmove', 'mouseup', 'click'].forEach(function (evt) {
                inp.addEventListener(evt, function (e2) { e2.stopPropagation(); });
            });
            inp.addEventListener('keydown', function (ke) {
                if (ke.key === 'Enter') { ke.preventDefault(); commitTexto(); }
                else if (ke.key === 'Escape') { ke.preventDefault(); ke.stopPropagation(); cancelarTexto(); }
            });
            inp.addEventListener('blur', function () { commitTexto(); });
        }
        function commitTexto() {
            if (!textoInput) return;
            var ref = textoInput; textoInput = null;   // primero, para que el blur no re-entre
            var val = (ref.el.value || '').trim();
            if (ref.el.parentNode) ref.el.parentNode.removeChild(ref.el);
            if (val) {
                st.trazos.push({ tipo: 'texto', texto: val, x1: ref.p.x, y1: ref.p.y,
                                 color: st.color, grosor: st.grosor });
                repintar();
            }
        }
        function cancelarTexto() {
            if (!textoInput) return;
            var ref = textoInput; textoInput = null;
            if (ref.el.parentNode) ref.el.parentNode.removeChild(ref.el);
        }
        function cerrarTextoAbierto() {
            if (textoInput) { commitTexto(); return true; }
            return false;
        }

        function empezar(e) {
            if (!img.complete) return;
            // Si había un campo de texto abierto, este toque lo confirma (no dibuja).
            if (cerrarTextoAbierto()) { e.preventDefault(); return; }
            var p = punto(e);
            if (st.herramienta === 'texto') {
                e.preventDefault();
                abrirTexto(e, p);
                return;
            }
            e.preventDefault();
            st.dibujando = true;
            st.actual = st.herramienta === 'lapiz'
                ? { tipo: 'lapiz', pts: [p], color: st.color, grosor: st.grosor }
                : { tipo: st.herramienta, x1: p.x, y1: p.y, x2: p.x, y2: p.y,
                    color: st.color, grosor: st.grosor };
        }
        function mover(e) {
            if (!st.dibujando || !st.actual) return;
            e.preventDefault();
            var p = punto(e);
            if (st.actual.tipo === 'lapiz') st.actual.pts.push(p);
            else { st.actual.x2 = p.x; st.actual.y2 = p.y; }
            repintar();
        }
        function soltar() {
            if (!st.dibujando) return;
            st.dibujando = false;
            if (st.actual) { st.trazos.push(st.actual); st.actual = null; }
            repintar();
        }

        canvas.addEventListener('mousedown', empezar);
        canvas.addEventListener('mousemove', mover);
        window.addEventListener('mouseup', soltar);
        canvas.addEventListener('touchstart', empezar, { passive: false });
        canvas.addEventListener('touchmove', mover, { passive: false });
        canvas.addEventListener('touchend', soltar);

        ov.querySelector('[data-deshacer]').onclick = function () { st.trazos.pop(); repintar(); };
        ov.querySelector('[data-limpiar]').onclick = function () { st.trazos = []; repintar(); };

        function cerrar() {
            cancelarTexto();
            window.removeEventListener('mouseup', soltar);
            document.removeEventListener('keydown', teclas);
            ov.remove();
        }
        function teclas(e) {
            if (e.key === 'Escape') cerrar();
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); st.trazos.pop(); repintar(); }
        }
        document.addEventListener('keydown', teclas);
        ov.addEventListener('click', function (e) {
            if (e.target === ov || e.target.closest('[data-cerrar]')) cerrar();
        });

        ov.querySelector('[data-guardar]').onclick = function () {
            var btn = this;
            if (!st.trazos.length && cap.value === (opts.comentario || '')) {
                estado.textContent = 'No hay nada que guardar.';
                return;
            }
            btn.disabled = true;
            estado.textContent = 'Guardando…';
            canvas.toBlob(function (blob) {
                if (!blob) { estado.textContent = 'No se pudo generar la imagen.'; btn.disabled = false; return; }
                var fd = new FormData();
                fd.append('imagen', blob, 'marcada-' + Date.now() + '.png');
                fd.append('comentario', cap.value.trim());
                fetch('/app/api/iamet/evidencias/' + opts.evidenciaId + '/marcar/', {
                    method: 'POST', body: fd, credentials: 'same-origin',
                    headers: { 'X-CSRFToken': csrf() },
                })
                    .then(function (r) { return r.json(); })
                    .then(function (d) {
                        btn.disabled = false;
                        if (d && d.success) {
                            if (opts.alGuardar) opts.alGuardar(d.evidencia);
                            cerrar();
                            return;
                        }
                        estado.textContent = (d && d.error) || 'No se pudo guardar.';
                    })
                    .catch(function () { btn.disabled = false; estado.textContent = 'Problema de red.'; });
            }, 'image/png');
        };

        function csrf() {
            var m = document.cookie.match(/csrftoken=([^;]+)/);
            return m ? m[1] : '';
        }

        return { cerrar: cerrar };
    }

    window.levFotoEditor = { abrir: abrir };
})();
