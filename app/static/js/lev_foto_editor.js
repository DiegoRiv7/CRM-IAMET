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
            seleccionado: -1,  // indice de la marca seleccionada con la herramienta "mover"
            arrastrando: false,
            dragPrev: null,
            redimensionando: false,  // arrastrando una manija de esquina
            resizeCorner: -1, resizeO: null, resizeFixed: null, resizeSnap: null,
            resizeCenter: null, resizeRot: 0,
            rotando: false, rotCentro: null,   // arrastrando la manija de rotación
            crop: null, cropDrag: null,        // recorte de la foto
            editadoBase: false,                // se recortó la foto (hay algo que guardar aunque no haya marcas)
        };

        var ov = el('div', 'lfe-ov');
        ov.id = 'levFotoEditor';
        ov.innerHTML =
            '<div class="lfe-box">' +
              '<div class="lfe-top">' +
                '<div class="lfe-seg lfe-tools" data-tools>' +
                  '<button type="button" class="lfe-t" data-h="mover" title="Seleccionar / mover">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.12 1.58a2 2 0 0 0-1.44 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z"/></svg></button>' +
                  '<button type="button" class="lfe-t is-on" data-h="lapiz" title="Dibujar">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg></button>' +
                  '<button type="button" class="lfe-t" data-h="linea" title="Línea">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"/></svg></button>' +
                  '<button type="button" class="lfe-t" data-h="flecha" title="Flecha">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="12 5 19 5 19 12"/></svg></button>' +
                  '<button type="button" class="lfe-t" data-h="rect" title="Rectángulo">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/></svg></button>' +
                  '<button type="button" class="lfe-t" data-h="elipse" title="Elipse / círculo">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg></button>' +
                  '<button type="button" class="lfe-t" data-h="texto" title="Escribir">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg></button>' +
                '</div>' +
                '<span class="lfe-div"></span>' +
                '<div class="lfe-colores" data-colores></div>' +
                '<span class="lfe-div"></span>' +
                '<div class="lfe-seg lfe-grosores" data-grosores></div>' +
                '<span class="lfe-div"></span>' +
                '<div class="lfe-seg">' +
                  '<button type="button" class="lfe-t" data-imagen title="Poner una imagen encima">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg></button>' +
                  '<button type="button" class="lfe-t" data-recortar title="Recortar la foto">' +
                    '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg></button>' +
                '</div>' +
                '<div class="lfe-sep"></div>' +
                '<div class="lfe-actions">' +
                  '<button type="button" class="lfe-b" data-deshacer title="Deshacer">' +
                    '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 7"/></svg>' +
                    '<span>Deshacer</span></button>' +
                  '<button type="button" class="lfe-b" data-limpiar title="Quitar todas las marcas">' +
                    '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>' +
                    '<span>Limpiar</span></button>' +
                '</div>' +
                '<button type="button" class="lfe-x" data-cerrar title="Cerrar">&times;</button>' +
              '</div>' +
              '<div class="lfe-lienzo" data-lienzo><canvas data-canvas></canvas></div>' +
              '<div class="lfe-pie">' +
                '<label class="lfe-capwrap">' +
                  '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>' +
                  '<input type="text" class="lfe-cap" data-cap maxlength="255" placeholder="¿De qué es esta foto?">' +
                '</label>' +
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

        function activarBoton(bEl) {
            ov.querySelectorAll('.lfe-t').forEach(function (x) { x.classList.remove('is-on'); });
            if (bEl) bEl.classList.add('is-on');
        }
        ov.querySelector('[data-tools]').addEventListener('click', function (e) {
            var b = e.target.closest('[data-h]');
            if (!b) return;
            if (st.crop) salirRecorte();   // cambiar de herramienta cancela el recorte en curso
            st.herramienta = b.getAttribute('data-h');
            activarBoton(b);
            canvas.style.cursor = st.herramienta === 'texto' ? 'text'
                : st.herramienta === 'mover' ? 'move' : 'crosshair';
            // La selección solo tiene sentido con la herramienta "mover".
            if (st.herramienta !== 'mover') st.seleccionado = -1;
            if (img.complete) repintar();
        });

        // ── Poner una imagen encima ──
        var imgCache = {};   // src(dataURL) → HTMLImageElement ya cargado
        function obtenerImg(src) {
            var im = imgCache[src];
            if (!im) { im = new Image(); im.onload = function () { repintar(); }; im.src = src; imgCache[src] = im; }
            return im;
        }
        var fileInput = el('input');
        fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.style.display = 'none';
        ov.appendChild(fileInput);
        ov.querySelector('[data-imagen]').onclick = function () {
            if (st.crop) salirRecorte();
            fileInput.value = ''; fileInput.click();
        };
        fileInput.addEventListener('change', function () {
            var f = fileInput.files && fileInput.files[0];
            if (!f) return;
            var rd = new FileReader();
            rd.onload = function () { ponerImagen(rd.result); };
            rd.readAsDataURL(f);
        });
        function ponerImagen(src) {
            var im = new Image();
            im.onload = function () {
                imgCache[src] = im;
                // Que quepa en ~45% de la foto respetando su proporción.
                var w = im.naturalWidth, h = im.naturalHeight;
                var r = Math.min(canvas.width * 0.45 / w, canvas.height * 0.45 / h, 1);
                w *= r; h *= r;
                var cx = canvas.width / 2, cy = canvas.height / 2;
                st.trazos.push({ tipo: 'imagen', src: src, rot: 0,
                                 x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 });
                st.herramienta = 'mover';
                activarBoton(ov.querySelector('[data-h="mover"]'));
                st.seleccionado = st.trazos.length - 1;
                canvas.style.cursor = 'move';
                repintar();
            };
            im.onerror = function () { estado.textContent = 'No se pudo cargar esa imagen.'; };
            im.src = src;
        }

        // ── Recortar la foto ──
        var barraCrop = el('div', 'lfe-cropbar');
        barraCrop.innerHTML =
            '<span class="lfe-cropinfo">Ajusta el marco y aplica el recorte</span>' +
            '<button type="button" class="lfe-cancel" data-crop-cancel>Cancelar</button>' +
            '<button type="button" class="lfe-ok" data-crop-ok>Aplicar recorte</button>';
        barraCrop.style.display = 'none';
        ov.querySelector('.lfe-box').appendChild(barraCrop);
        ov.querySelector('[data-recortar]').onclick = function () {
            if (!img.complete) return;
            entrarRecorte();
        };
        barraCrop.querySelector('[data-crop-cancel]').onclick = function () { salirRecorte(); repintar(); };
        barraCrop.querySelector('[data-crop-ok]').onclick = function () { aplicarRecorte(); };
        function entrarRecorte() {
            cerrarTextoAbierto();
            st.seleccionado = -1;
            var w = canvas.width * 0.8, h = canvas.height * 0.8;
            st.crop = { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w: w, h: h };
            st.cropDrag = null;
            st.herramienta = 'recortar';
            activarBoton(ov.querySelector('[data-recortar]'));
            barraCrop.style.display = 'flex';
            canvas.style.cursor = 'crosshair';
            repintar();
        }
        function salirRecorte() {
            st.crop = null; st.cropDrag = null;
            barraCrop.style.display = 'none';
            st.herramienta = 'mover';
            activarBoton(ov.querySelector('[data-h="mover"]'));
            canvas.style.cursor = 'move';
        }
        function aplicarRecorte() {
            if (!st.crop) return;
            var cr = { x: Math.round(Math.max(0, st.crop.x)),
                       y: Math.round(Math.max(0, st.crop.y)),
                       w: Math.round(Math.min(st.crop.w, canvas.width - st.crop.x)),
                       h: Math.round(Math.min(st.crop.h, canvas.height - st.crop.y)) };
            if (cr.w < 8 || cr.h < 8) { salirRecorte(); repintar(); return; }
            var off = document.createElement('canvas');
            off.width = cr.w; off.height = cr.h;
            off.getContext('2d').drawImage(img, cr.x, cr.y, cr.w, cr.h, 0, 0, cr.w, cr.h);
            var durl;
            try { durl = off.toDataURL('image/png'); }
            catch (err) { estado.textContent = 'No se pudo recortar (imagen protegida).'; return; }
            var nimg = new Image();
            nimg.onload = function () {
                img = nimg;                       // la base pasa a ser la recortada
                canvas.width = cr.w; canvas.height = cr.h;
                st.trazos.forEach(function (t) { moverTrazo(t, -cr.x, -cr.y); });  // reubicar marcas
                st.editadoBase = true;
                salirRecorte();
                repintar();
            };
            nimg.src = durl;
        }

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
            st.trazos.forEach(function (t) { if (!t._oculto) pintarTrazo(t); });
            if (st.actual) pintarTrazo(st.actual);
            if (st.herramienta === 'mover' && st.seleccionado >= 0 && st.trazos[st.seleccionado]) {
                pintarSeleccion(st.trazos[st.seleccionado]);
            }
            if (st.crop) pintarRecorte();
        }

        function pintarTrazo(t) {
            ctx.save();
            // Rotación alrededor del centro de la marca (si la tiene).
            if (t.rot) {
                var cr = centroDe(t);
                ctx.translate(cr.x, cr.y); ctx.rotate(t.rot); ctx.translate(-cr.x, -cr.y);
            }
            if (t.color) { ctx.strokeStyle = t.color; ctx.fillStyle = t.color; }
            if (t.grosor) ctx.lineWidth = t.grosor;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (t.tipo === 'imagen') {
                var im = obtenerImg(t.src);
                if (im.complete && im.naturalWidth) {
                    var ix = Math.min(t.x1, t.x2), iy = Math.min(t.y1, t.y2);
                    ctx.drawImage(im, ix, iy, Math.abs(t.x2 - t.x1), Math.abs(t.y2 - t.y1));
                }
            } else if (t.tipo === 'lapiz' && t.pts.length) {
                ctx.beginPath();
                ctx.moveTo(t.pts[0].x, t.pts[0].y);
                t.pts.forEach(function (p) { ctx.lineTo(p.x, p.y); });
                ctx.stroke();
            } else if (t.tipo === 'rect') {
                ctx.strokeRect(t.x1, t.y1, t.x2 - t.x1, t.y2 - t.y1);
            } else if (t.tipo === 'linea') {
                ctx.beginPath();
                ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
            } else if (t.tipo === 'elipse') {
                var ecx = (t.x1 + t.x2) / 2, ecy = (t.y1 + t.y2) / 2;
                var erx = Math.abs(t.x2 - t.x1) / 2, ery = Math.abs(t.y2 - t.y1) / 2;
                ctx.beginPath();
                ctx.ellipse(ecx, ecy, erx, ery, 0, 0, Math.PI * 2);
                ctx.stroke();
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

        // ── Selección y movimiento de marcas ya puestas ──
        // Cuántos px reales de la foto equivalen a 1 px de pantalla (para que el
        // grosor del recuadro y el margen de agarre se vean constantes).
        function escalaFoto() {
            var r = canvas.getBoundingClientRect();
            return r.width ? (canvas.width / r.width) : 1;
        }
        // Caja envolvente de una marca, en coordenadas de la foto.
        function cajaDe(t) {
            if (t.tipo === 'lapiz') {
                var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
                t.pts.forEach(function (p) {
                    if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
                    if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
                });
                return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
            }
            if (t.tipo === 'texto') {
                var px = Math.max(18, t.grosor * 6);
                ctx.save();
                ctx.font = '700 ' + px + 'px system-ui, -apple-system, sans-serif';
                var w = ctx.measureText(t.texto || '').width;
                ctx.restore();
                return { x: t.x1, y: t.y1, w: w, h: px * 1.2 };
            }
            // rect, linea, flecha, elipse → definidos por dos esquinas
            var x = Math.min(t.x1, t.x2), y = Math.min(t.y1, t.y2);
            return { x: x, y: y, w: Math.abs(t.x2 - t.x1), h: Math.abs(t.y2 - t.y1) };
        }
        function centroDe(t) { var b = cajaDe(t); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
        // Puntero (mundo) → marco local de la marca (des-rotado alrededor de su centro).
        function aLocal(t, p) {
            var r = t.rot || 0;
            if (!r) return p;
            var c = centroDe(t), cos = Math.cos(-r), sin = Math.sin(-r);
            var dx = p.x - c.x, dy = p.y - c.y;
            return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
        }
        // Índice de la marca bajo el punto p (de arriba hacia abajo), o -1.
        function marcaEn(p) {
            var pad = 10 * escalaFoto();   // ~10px de pantalla de margen para agarrar
            for (var i = st.trazos.length - 1; i >= 0; i--) {
                if (st.trazos[i]._oculto) continue;
                var b = cajaDe(st.trazos[i]), lp = aLocal(st.trazos[i], p);
                if (lp.x >= b.x - pad && lp.x <= b.x + b.w + pad &&
                    lp.y >= b.y - pad && lp.y <= b.y + b.h + pad) return i;
            }
            return -1;
        }
        function moverTrazo(t, dx, dy) {
            if (t.tipo === 'lapiz') t.pts.forEach(function (p) { p.x += dx; p.y += dy; });
            else if (t.tipo === 'texto') { t.x1 += dx; t.y1 += dy; }
            else { t.x1 += dx; t.y1 += dy; t.x2 += dx; t.y2 += dy; }
        }
        function clonar(o) { return JSON.parse(JSON.stringify(o)); }
        // Las 4 esquinas del recuadro de selección (0=SI, 1=SD, 2=ID, 3=II).
        function manijas(t) {
            var b = cajaDe(t), m = 6 * escalaFoto();
            var x1 = b.x - m, y1 = b.y - m, x2 = b.x + b.w + m, y2 = b.y + b.h + m;
            return [{ c: 0, x: x1, y: y1 }, { c: 1, x: x2, y: y1 },
                    { c: 2, x: x2, y: y2 }, { c: 3, x: x1, y: y2 }];
        }
        function manijaEn(t, p) {
            var r = 12 * escalaFoto(), hs = manijas(t), lp = aLocal(t, p);
            for (var i = 0; i < hs.length; i++) {
                if (Math.abs(lp.x - hs[i].x) <= r && Math.abs(lp.y - hs[i].y) <= r) return hs[i].c;
            }
            return -1;
        }
        // Punto (local) de la manija de rotación, arriba del centro.
        function puntoRot(t) {
            var b = cajaDe(t), s = escalaFoto();
            return { x: b.x + b.w / 2, y: b.y - 6 * s - 26 * s };
        }
        function enManijaRot(t, p) {
            var lp = aLocal(t, p), h = puntoRot(t), r = 13 * escalaFoto();
            return Math.abs(lp.x - h.x) <= r && Math.abs(lp.y - h.y) <= r;
        }
        function iniciarResize(t, corner) {
            st.redimensionando = true;
            st.resizeCorner = corner;
            var b = cajaDe(t);
            st.resizeO = { x: b.x, y: b.y, w: b.w, h: b.h };
            st.resizeCenter = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
            st.resizeRot = t.rot || 0;
            // La esquina opuesta a la que se agarra queda fija (caso sin rotar).
            st.resizeFixed = {
                x: (corner === 0 || corner === 3) ? b.x + b.w : b.x,
                y: (corner === 0 || corner === 1) ? b.y + b.h : b.y,
            };
            st.resizeSnap = clonar(t);
        }
        // Reescala una copia de la marca desde la caja O (original) a la N (nueva).
        function remapTrazo(snap, O, N) {
            var t = clonar(snap);
            var sx = O.w ? N.w / O.w : 0, sy = O.h ? N.h / O.h : 0;
            function mx(x) { return N.x + (x - O.x) * sx; }
            function my(y) { return N.y + (y - O.y) * sy; }
            if (t.tipo === 'lapiz') {
                t.pts = t.pts.map(function (pt) { return { x: mx(pt.x), y: my(pt.y) }; });
            } else if (t.tipo === 'texto') {
                t.x1 = mx(t.x1); t.y1 = my(t.y1);
                t.grosor = Math.max(1, snap.grosor * (sy || sx || 1));   // el tamaño de letra sigue la altura
            } else {
                t.x1 = mx(t.x1); t.y1 = my(t.y1); t.x2 = mx(t.x2); t.y2 = my(t.y2);
            }
            return t;
        }
        function pintarSeleccion(t) {
            var b = cajaDe(t), s = escalaFoto(), m = 6 * s, azul = 'rgba(37, 99, 235, .95)';
            ctx.save();
            // Todo el chrome se dibuja en el marco (rotado) de la marca.
            if (t.rot) {
                var c = centroDe(t);
                ctx.translate(c.x, c.y); ctx.rotate(t.rot); ctx.translate(-c.x, -c.y);
            }
            ctx.strokeStyle = azul;
            ctx.lineWidth = Math.max(1.5, 2 * s);
            ctx.setLineDash([7 * s, 5 * s]);
            ctx.strokeRect(b.x - m, b.y - m, b.w + m * 2, b.h + m * 2);
            ctx.setLineDash([]);
            // Manija de rotación: línea al pomo de arriba.
            var rp = puntoRot(t);
            ctx.beginPath();
            ctx.moveTo(b.x + b.w / 2, b.y - m); ctx.lineTo(rp.x, rp.y); ctx.stroke();
            ctx.beginPath(); ctx.arc(rp.x, rp.y, 6 * s, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = azul; ctx.stroke();
            // Manijas de esquina para redimensionar.
            var r = 5 * s;
            manijas(t).forEach(function (h) {
                ctx.beginPath();
                ctx.rect(h.x - r, h.y - r, r * 2, r * 2);
                ctx.fillStyle = '#fff'; ctx.fill();
                ctx.strokeStyle = azul; ctx.stroke();
            });
            ctx.restore();
        }
        // ── Overlay del recorte ──
        function clamp(v, a, z) { return v < a ? a : (v > z ? z : v); }
        function cropCorners() {
            var cr = st.crop;
            return [[cr.x, cr.y], [cr.x + cr.w, cr.y], [cr.x + cr.w, cr.y + cr.h], [cr.x, cr.y + cr.h]];
        }
        function cropManijaEn(p) {
            var r = 14 * escalaFoto(), cs = cropCorners();
            for (var i = 0; i < cs.length; i++) {
                if (Math.abs(p.x - cs[i][0]) <= r && Math.abs(p.y - cs[i][1]) <= r) return i;
            }
            return -1;
        }
        function dentroCrop(p) {
            var cr = st.crop;
            return p.x >= cr.x && p.x <= cr.x + cr.w && p.y >= cr.y && p.y <= cr.y + cr.h;
        }
        function pintarRecorte() {
            var s = escalaFoto(), cr = st.crop;
            ctx.save();
            // Oscurecer todo menos el recorte.
            ctx.fillStyle = 'rgba(0, 0, 0, .55)';
            ctx.beginPath();
            ctx.rect(0, 0, canvas.width, canvas.height);
            ctx.rect(cr.x, cr.y, cr.w, cr.h);
            ctx.fill('evenodd');
            // Marco y guías de tercios.
            ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5, 2 * s);
            ctx.strokeRect(cr.x, cr.y, cr.w, cr.h);
            ctx.strokeStyle = 'rgba(255, 255, 255, .4)'; ctx.lineWidth = Math.max(1, s);
            for (var i = 1; i < 3; i++) {
                ctx.beginPath(); ctx.moveTo(cr.x + cr.w * i / 3, cr.y); ctx.lineTo(cr.x + cr.w * i / 3, cr.y + cr.h); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(cr.x, cr.y + cr.h * i / 3); ctx.lineTo(cr.x + cr.w, cr.y + cr.h * i / 3); ctx.stroke();
            }
            // Manijas de esquina.
            var r = 6 * s;
            cropCorners().forEach(function (c) {
                ctx.beginPath(); ctx.rect(c[0] - r, c[1] - r, r * 2, r * 2);
                ctx.fillStyle = '#fff'; ctx.fill();
                ctx.strokeStyle = '#2563EB'; ctx.lineWidth = Math.max(1.5, 2 * s); ctx.stroke();
            });
            ctx.restore();
        }

        // ── Texto en el lugar (estilo "Marcado" de Mac) ──
        // En vez de un prompt del navegador, se coloca un campo de texto justo
        // sobre el punto tocado; se escribe en su sitio y al confirmar queda
        // dibujado en la foto. Enter confirma, Esc cancela, y tocar fuera guarda.
        var textoInput = null;
        // opts (opcional) para re-editar un texto existente:
        //   { valor, color, grosor, reemplazar: <indice> }.
        // Si no viene, se crea un texto nuevo con el color/grosor activos.
        function abrirTexto(e, p, opts) {
            cerrarTextoAbierto();
            opts = opts || {};
            var editando = (opts.reemplazar != null && opts.reemplazar >= 0);
            var colorTxt = opts.color || st.color;
            var grosorTxt = opts.grosor || st.grosor;
            var lr = lienzo.getBoundingClientRect();
            var vista = canvas.getBoundingClientRect();
            var escala = canvas.width ? (vista.width / canvas.width) : 1;
            var px = Math.max(18, grosorTxt * 6) * escala;   // tamaño visible ≈ el que quedará dibujado
            var sx, sy;
            if (editando) {
                // Colocar el campo justo sobre el texto que se edita.
                sx = (vista.left - lr.left + lienzo.scrollLeft) + p.x * escala;
                sy = (vista.top - lr.top + lienzo.scrollTop) + p.y * escala;
            } else {
                var src = (e.touches && e.touches[0]) || e;
                sx = src.clientX - lr.left + lienzo.scrollLeft;
                sy = src.clientY - lr.top + lienzo.scrollTop;
            }
            var inp = el('input', 'lfe-textin');
            inp.type = 'text';
            inp.maxLength = 120;
            inp.setAttribute('placeholder', 'Escribe…');
            inp.value = opts.valor || '';
            inp.style.left = sx + 'px';
            inp.style.top = (sy - px * 0.7) + 'px';
            inp.style.color = colorTxt;
            inp.style.fontSize = px + 'px';
            lienzo.appendChild(inp);
            textoInput = { el: inp, p: p, color: colorTxt, grosor: grosorTxt,
                           reemplazar: editando ? opts.reemplazar : -1 };
            setTimeout(function () { inp.focus(); if (inp.select) inp.select(); }, 10);
            // Que el campo no dispare trazos del canvas.
            ['mousedown', 'touchstart', 'mousemove', 'touchmove', 'mouseup', 'click', 'dblclick'].forEach(function (evt) {
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
                var nuevo = { tipo: 'texto', texto: val, x1: ref.p.x, y1: ref.p.y,
                              color: ref.color, grosor: ref.grosor };
                if (ref.reemplazar >= 0 && st.trazos[ref.reemplazar]) st.trazos[ref.reemplazar] = nuevo;
                else st.trazos.push(nuevo);
            } else if (ref.reemplazar >= 0 && st.trazos[ref.reemplazar]) {
                // Editar y dejar vacío = borrar ese texto.
                st.trazos.splice(ref.reemplazar, 1);
            }
            st.seleccionado = -1;
            repintar();
        }
        function cancelarTexto() {
            if (!textoInput) return;
            var ref = textoInput; textoInput = null;
            if (ref.el.parentNode) ref.el.parentNode.removeChild(ref.el);
            // Si se cancela una edición, volver a mostrar el texto original.
            if (ref.reemplazar >= 0 && st.trazos[ref.reemplazar]) {
                delete st.trazos[ref.reemplazar]._oculto;
                repintar();
            }
        }
        // Re-editar el texto en el índice dado (doble clic con la herramienta mover).
        function editarTexto(idx) {
            var t = st.trazos[idx];
            if (!t || t.tipo !== 'texto') return;
            t._oculto = true;   // se oculta el original mientras se edita
            repintar();
            abrirTexto(null, { x: t.x1, y: t.y1 },
                       { valor: t.texto, color: t.color, grosor: t.grosor, reemplazar: idx });
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
            // Modo recorte: mover el marco o arrastrar una esquina.
            if (st.crop) {
                e.preventDefault();
                var cc = cropManijaEn(p);
                if (cc >= 0) {
                    var cs = cropCorners();
                    var opp = cs[(cc + 2) % 4];   // esquina opuesta, queda fija
                    st.cropDrag = { tipo: 'corner', ox: opp[0], oy: opp[1] };
                } else if (dentroCrop(p)) {
                    st.cropDrag = { tipo: 'move', prev: p };
                } else {
                    st.cropDrag = null;
                }
                return;
            }
            // Herramienta "mover": seleccionar la marca bajo el dedo y arrastrarla.
            if (st.herramienta === 'mover') {
                e.preventDefault();
                if (st.seleccionado >= 0 && st.trazos[st.seleccionado]) {
                    var selT = st.trazos[st.seleccionado];
                    // ¿Se agarró la manija de rotación? → rotar.
                    if (enManijaRot(selT, p)) {
                        st.rotando = true; st.rotCentro = centroDe(selT);
                        canvas.style.cursor = 'grabbing'; repintar(); return;
                    }
                    // ¿Una manija de esquina? → redimensionar.
                    var mc = manijaEn(selT, p);
                    if (mc >= 0) { iniciarResize(selT, mc); repintar(); return; }
                }
                st.seleccionado = marcaEn(p);
                st.arrastrando = st.seleccionado >= 0;
                st.dragPrev = p;
                canvas.style.cursor = st.arrastrando ? 'grabbing' : 'move';
                repintar();
                return;
            }
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
            // Arrastre del marco de recorte.
            if (st.crop && st.cropDrag) {
                e.preventDefault();
                var pc = punto(e), cr = st.crop;
                if (st.cropDrag.tipo === 'move') {
                    var ddx = pc.x - st.cropDrag.prev.x, ddy = pc.y - st.cropDrag.prev.y;
                    cr.x = clamp(cr.x + ddx, 0, canvas.width - cr.w);
                    cr.y = clamp(cr.y + ddy, 0, canvas.height - cr.h);
                    st.cropDrag.prev = pc;
                } else {   // arrastrando una esquina; la opuesta (ox,oy) queda fija
                    var nx = clamp(pc.x, 0, canvas.width), ny = clamp(pc.y, 0, canvas.height);
                    var x1 = Math.min(st.cropDrag.ox, nx), y1 = Math.min(st.cropDrag.oy, ny);
                    cr.x = x1; cr.y = y1;
                    cr.w = Math.max(8, Math.abs(nx - st.cropDrag.ox));
                    cr.h = Math.max(8, Math.abs(ny - st.cropDrag.oy));
                }
                repintar();
                return;
            }
            // Cursor de redimensionar/mover al pasar por encima (mover, sin arrastrar).
            if (st.herramienta === 'mover' && !st.arrastrando && !st.redimensionando && !st.rotando) {
                if (st.seleccionado >= 0 && st.trazos[st.seleccionado]) {
                    var selM = st.trazos[st.seleccionado], ph = punto(e);
                    if (enManijaRot(selM, ph)) canvas.style.cursor = 'grab';
                    else {
                        var mh = manijaEn(selM, ph);
                        if (mh >= 0) canvas.style.cursor = (mh === 0 || mh === 2) ? 'nwse-resize' : 'nesw-resize';
                        else canvas.style.cursor = marcaEn(ph) >= 0 ? 'grab' : 'move';
                    }
                }
            }
            // Rotando la marca seleccionada.
            if (st.rotando && st.seleccionado >= 0 && st.trazos[st.seleccionado]) {
                e.preventDefault();
                var pro = punto(e), cc2 = st.rotCentro;
                st.trazos[st.seleccionado].rot = Math.atan2(pro.y - cc2.y, pro.x - cc2.x) + Math.PI / 2;
                repintar();
                return;
            }
            // Redimensionando desde una manija.
            if (st.redimensionando && st.seleccionado >= 0 && st.trazos[st.seleccionado]) {
                e.preventDefault();
                var pr = punto(e), O = st.resizeO, N;
                if (st.resizeRot) {
                    // Rotada: se reescala centrada (el puntero se lleva al marco local).
                    var c = st.resizeCenter, co = Math.cos(-st.resizeRot), si = Math.sin(-st.resizeRot);
                    var dx = pr.x - c.x, dy = pr.y - c.y;
                    var lx = c.x + dx * co - dy * si, ly = c.y + dx * si + dy * co;
                    var hw = Math.max(3, Math.abs(lx - c.x)), hh = Math.max(3, Math.abs(ly - c.y));
                    N = { x: c.x - hw, y: c.y - hh, w: hw * 2, h: hh * 2 };
                } else {
                    var F = st.resizeFixed;
                    N = { x: Math.min(F.x, pr.x), y: Math.min(F.y, pr.y),
                          w: Math.abs(pr.x - F.x), h: Math.abs(pr.y - F.y) };
                    if (N.w < 6) N.w = 6;
                    if (N.h < 6) N.h = 6;
                }
                st.trazos[st.seleccionado] = remapTrazo(st.resizeSnap, O, N);
                repintar();
                return;
            }
            // Arrastrando una marca seleccionada.
            if (st.arrastrando && st.seleccionado >= 0 && st.trazos[st.seleccionado]) {
                e.preventDefault();
                var pd = punto(e);
                moverTrazo(st.trazos[st.seleccionado], pd.x - st.dragPrev.x, pd.y - st.dragPrev.y);
                st.dragPrev = pd;
                repintar();
                return;
            }
            if (!st.dibujando || !st.actual) return;
            e.preventDefault();
            var p = punto(e);
            if (st.actual.tipo === 'lapiz') st.actual.pts.push(p);
            else { st.actual.x2 = p.x; st.actual.y2 = p.y; }
            repintar();
        }
        function soltar() {
            if (st.crop) { st.cropDrag = null; return; }
            if (st.rotando) {
                st.rotando = false;
                if (st.herramienta === 'mover') canvas.style.cursor = 'move';
                return;
            }
            if (st.redimensionando) {
                st.redimensionando = false;
                st.resizeSnap = null;
                if (st.herramienta === 'mover') canvas.style.cursor = 'move';
                return;
            }
            if (st.arrastrando) {
                st.arrastrando = false;
                if (st.herramienta === 'mover') canvas.style.cursor = 'move';
                return;
            }
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
        // Doble clic con "mover" sobre un texto → re-editarlo en su sitio.
        canvas.addEventListener('dblclick', function (e) {
            if (st.herramienta !== 'mover') return;
            var idx = marcaEn(punto(e));
            if (idx >= 0 && st.trazos[idx].tipo === 'texto') { e.preventDefault(); editarTexto(idx); }
        });

        ov.querySelector('[data-deshacer]').onclick = function () { st.trazos.pop(); st.seleccionado = -1; repintar(); };
        ov.querySelector('[data-limpiar]').onclick = function () { st.trazos = []; st.seleccionado = -1; repintar(); };

        function cerrar() {
            cancelarTexto();
            window.removeEventListener('mouseup', soltar);
            document.removeEventListener('keydown', teclas);
            ov.remove();
        }
        function teclas(e) {
            var tag = (e.target && e.target.tagName || '').toLowerCase();
            var escribiendo = (tag === 'input' || tag === 'textarea');
            if (e.key === 'Escape') {
                if (st.crop) { salirRecorte(); repintar(); return; }
                cerrar(); return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault(); st.trazos.pop(); st.seleccionado = -1; repintar(); return;
            }
            // Borrar la marca seleccionada (solo si no se está escribiendo en un campo).
            if ((e.key === 'Delete' || e.key === 'Backspace') && !escribiendo &&
                st.seleccionado >= 0 && st.trazos[st.seleccionado]) {
                e.preventDefault();
                st.trazos.splice(st.seleccionado, 1);
                st.seleccionado = -1;
                repintar();
            }
        }
        document.addEventListener('keydown', teclas);
        ov.addEventListener('click', function (e) {
            if (e.target === ov || e.target.closest('[data-cerrar]')) cerrar();
        });

        ov.querySelector('[data-guardar]').onclick = function () {
            var btn = this;
            if (!st.trazos.length && !st.editadoBase && cap.value === (opts.comentario || '')) {
                estado.textContent = 'No hay nada que guardar.';
                return;
            }
            // Si quedó un recorte sin aplicar, se ignora al guardar (se exporta la foto completa).
            if (st.crop) { salirRecorte(); }
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
