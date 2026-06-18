/* ═══════════════════════════════════════════════════════════════════
   Programa de Obra — Instalaciones del Proyecto

   Componente del tab "Programa de Obra" dentro del widget de Proyecto.
   Renderiza la tabla de instalaciones del proyecto y orquesta un modal
   único que sirve para:
     - ver detalle de una instalación
     - editarla inline
     - asignar/quitar técnicos (asignaciones por fecha)

   El mismo modal lo invoca el calendario de Instalaciones al click sobre
   un evento (reemplaza el placeholder que abría /admin/ en pestaña
   nueva). Función pública: window.pobAbrirModal(instalacionId).

   Endpoints:
     GET  /api/proyecto/<pid>/instalaciones/
     POST /api/proyecto/<pid>/instalaciones/
     GET  /api/instalacion/<id>/
     PATCH /api/instalacion/<id>/
     DELETE /api/instalacion/<id>/
     POST /api/instalacion/<id>/asignaciones/
     DELETE /api/instalacion/<id>/asignaciones/<aid>/
     GET  /api/tecnicos/
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // Inyecta estilos del modal y la tabla. Duplican parcialmente los de
    // _widget_oportunidad.html para que este módulo sea autónomo (el modal
    // se abre también desde el tab de proyecto y desde el calendario,
    // donde el widget de opp puede no estar montado).
    (function _injectStyles() {
        if (document.getElementById('pobStyles')) return;
        var s = document.createElement('style');
        s.id = 'pobStyles';
        s.textContent = [
            '.wop-pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:0.68rem; font-weight:700; letter-spacing:0.02em; }',
            '.wop-pill-tent   { background:#FEF6E0; color:#92740E; }',
            '.wop-pill-prog   { background:#E0F2FE; color:#075985; }',
            '.wop-pill-curso  { background:#FEF3C7; color:#92400E; }',
            '.wop-pill-done   { background:#D1FAE5; color:#065F46; }',
            '.wop-pill-cancel { background:#FEE2E2; color:#991B1B; }',
            '.wop-table th { text-align:left; font-size:0.66rem; text-transform:uppercase; letter-spacing:0.04em; color:#86868B; font-weight:700; padding:10px 12px; border-bottom:1px solid #E5E5EA; background:#FAFAFC; }',
            '.wop-table td { padding:10px 12px; border-bottom:1px solid #F2F2F7; vertical-align:middle; }',
            '.wop-table tbody tr:hover { background:#F9FAFB; }',
            '.wop-table tr:last-child td { border-bottom:none; }',
            '.wop-icon-btn { background:transparent; border:none; cursor:pointer; padding:4px; border-radius:6px; color:#86868B; }',
            '.wop-icon-btn:hover { background:#F2F2F7; color:#FF3B30; }',
            '.wop-modal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:11500; display:none; align-items:center; justify-content:center; }',
            '.wop-modal-backdrop.open { display:flex; }',
            '.wop-modal { background:#fff; border-radius:14px; box-shadow:0 25px 60px rgba(0,0,0,0.2); width:min(560px, 92vw); max-height:88vh; display:flex; flex-direction:column; overflow:hidden; }',
            '.wop-modal-head { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid #E5E5EA; }',
            '.wop-modal-head h3 { margin:0; font-size:1rem; font-weight:700; color:#1D1D1F; }',
            '.wop-modal-body { padding:14px 18px; overflow-y:auto; }',
            '.wop-modal-foot { padding:12px 18px; border-top:1px solid #E5E5EA; display:flex; justify-content:flex-end; gap:8px; }',
            '.wop-field { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }',
            '.wop-field label { font-size:0.72rem; font-weight:700; color:#3C3C43; letter-spacing:0.02em; text-transform:uppercase; }',
            '.wop-field input, .wop-field select, .wop-field textarea { font-family:inherit; font-size:0.88rem; padding:7px 10px; border:1px solid #E5E5EA; border-radius:8px; outline:none; transition:border-color 0.15s; }',
            '.wop-field input:focus, .wop-field select:focus, .wop-field textarea:focus { border-color:#0052D4; }',
            '.wop-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }',
            '.wop-btn-primary { background:#0052D4; color:#fff; border:none; padding:8px 14px; border-radius:8px; font-weight:600; cursor:pointer; font-size:0.84rem; }',
            '.wop-btn-primary:hover { background:#0041a8; }',
            '.wop-btn-secondary { background:#F2F2F7; color:#1D1D1F; border:none; padding:8px 14px; border-radius:8px; font-weight:600; cursor:pointer; font-size:0.84rem; }',
            '.wop-btn-secondary:hover { background:#E5E5EA; }',

            /* ── Composer Notion-like para Nueva/Editar instalación ── */
            '.pob-modal { width:min(1240px, 96vw); }',
            '.pob-empty { padding:56px 24px; text-align:center; }',
            '.pob-empty-ic { margin:0 auto 8px; display:block; opacity:0.5; }',
            '.pob-empty-title { font-weight:700; color:#1d1d1f; margin-bottom:4px; font-size:1rem; }',
            '.pob-empty-sub { font-size:0.85rem; color:#86868B; }',
            '.pob-head { display:flex; align-items:center; justify-content:space-between; padding:14px 22px; border-bottom:1px solid #F2F2F7; }',
            '.pob-eyebrow { display:inline-flex; align-items:center; gap:6px; font-size:0.62rem; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; color:#86868B; }',
            // Canvas full-width estilo composer de oportunidad (sin columna
            // lateral): título grande, pills en fila, notas, y los técnicos como
            // sección a todo el ancho debajo.
            '.pob-body { padding:8px 40px 26px; overflow-y:auto; display:block; }',
            '.pob-main { padding-top:16px; }',
            '.pob-side { border-left:none; border-top:none; padding:0; margin-top:14px; }',
            // Botón cerrar más visible (círculo sólido) sobre la greca/cabecera.
            '.pob-head .pob-close { width:34px; height:34px; }',
            // Descripción: caja grande enmarcada, cómoda para escribir.
            '.pob-title-input { width:100%; box-sizing:border-box; border:1px solid #E5E5EA; border-radius:14px; outline:none; font-family:inherit; font-size:1.5rem; font-weight:800; color:#1D1D1F; letter-spacing:-0.02em; padding:16px 18px; resize:vertical; line-height:1.25; min-height:76px; background:#fff; transition:border-color 0.15s, box-shadow 0.15s; }',
            '.pob-title-input:focus { border-color:#0052D4; box-shadow:0 0 0 3px rgba(0,82,212,0.12); }',
            '.pob-title-input::placeholder { color:#C7C7CC; font-weight:700; }',
            /* fila meta inline tipo "etiqueta a la izquierda, control limpio a la derecha" */
            // Meta estilo composer de oportunidad: pills redondeados que fluyen
            // en una fila (icono + label + control inline borderless).
            // Grupos lógicos: etiqueta tenue + fila de pills. El orden guía el
            // llenado (cliente → cuándo → costos → personal).
            '.pob-group { margin-top:22px; }',
            '.pob-group-label { font-size:0.66rem; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; color:#86868B; margin-bottom:9px; }',
            '.pob-group .pob-meta { margin-top:0; }',
            '.pob-meta { display:flex; flex-wrap:wrap; align-items:center; gap:10px 12px; margin-top:18px; }',
            '.pob-meta-row { display:inline-flex; align-items:center; gap:8px; padding:8px 15px; border:1px solid #E5E5EA; border-radius:999px; background:#fff; box-shadow:0 1px 2px rgba(15,23,42,0.04); transition:border-color 0.15s, box-shadow 0.15s; }',
            '.pob-meta-row:hover { border-color:#CFCFD4; box-shadow:0 2px 8px rgba(15,23,42,0.07); }',
            '.pob-meta-row:focus-within { border-color:#0052D4; box-shadow:0 0 0 3px rgba(0,82,212,0.12); }',
            '.pob-meta-row--full { flex-basis:100%; }',
            '.pob-meta-label { display:inline-flex; align-items:center; gap:6px; font-size:0.78rem; font-weight:700; color:#6B7280; white-space:nowrap; }',
            '.pob-meta-label svg { color:#A1A1A6; }',
            '.pob-meta-row .pob-input { width:auto; min-width:54px; max-width:190px; border:none !important; background:transparent !important; padding:0; font-weight:600; color:#1D1D1F; }',
            '.pob-meta-row .pob-input::placeholder { font-weight:500; color:#B6B6BC; }',
            '#pobInstCliente { min-width:118px; max-width:170px; }',
            '#pobInstPo { min-width:96px; }',
            // El pill de Personal crece para aprovechar el ancho sobrante de su fila.
            '.pob-meta-grow { flex:1 1 280px; }',
            '.pob-meta-grow .pob-input { flex:1; min-width:120px; max-width:none; }',
            '.pob-input { width:100%; box-sizing:border-box; font-family:inherit; font-size:0.9rem; color:#1D1D1F; padding:6px 8px; border:1px solid transparent; border-radius:7px; outline:none; background:transparent; transition:border-color 0.15s, background 0.15s; }',
            '.pob-input:hover { background:#F2F2F7; }',
            '.pob-input:focus { background:#fff; border-color:#0052D4; box-shadow:0 0 0 3px rgba(0,82,212,0.12); }',
            '.pob-input::placeholder { color:#C7C7CC; }',
            '.pob-input-num { max-width:160px; }',
            '.pob-notes { width:100%; box-sizing:border-box; min-height:120px; font-family:inherit; font-size:0.92rem; line-height:1.45; color:#1D1D1F; padding:14px 16px; border:1px solid #E5E5EA; border-radius:12px; outline:none; resize:vertical; background:#FBFBFD; transition:border-color 0.15s; }',
            '.pob-notes:focus { border-color:#0052D4; background:#fff; box-shadow:0 0 0 3px rgba(0,82,212,0.10); }',
            // Dropdown personalizado (Estado, tipo de jornada): botón limpio en el
            // pill + menú blanco sólido flotante.
            '.pob-dd { position:relative; display:inline-flex; }',
            '.pob-dd-native { display:none !important; }',
            '.pob-dd-btn { display:inline-flex; align-items:center; gap:6px; border:none; background:transparent; font-family:inherit; font-size:0.9rem; font-weight:600; color:#1D1D1F; cursor:pointer; padding:0; white-space:nowrap; }',
            '.pob-dd-chev { color:#86868B; transition:transform 0.15s; flex-shrink:0; }',
            '.pob-dd-btn.open .pob-dd-chev { transform:rotate(180deg); }',
            '.pob-dd-menu { position:fixed; z-index:12000; background:#fff; border:1px solid #E5E5EA; border-radius:12px; box-shadow:0 16px 40px rgba(15,23,42,0.18); padding:6px; min-width:150px; max-height:300px; overflow-y:auto; animation:pobDdIn 0.12s ease; }',
            '@keyframes pobDdIn { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }',
            '.pob-dd-item { display:flex; align-items:center; gap:8px; padding:9px 14px 9px 8px; border-radius:8px; font-size:0.88rem; font-weight:500; color:#1D1D1F; cursor:pointer; white-space:nowrap; }',
            '.pob-dd-item:hover { background:#F2F2F7; }',
            '.pob-dd-item.sel { font-weight:700; }',
            '.pob-dd-check { width:15px; display:inline-flex; align-items:center; justify-content:center; color:#0052D4; opacity:0; flex-shrink:0; }',
            '.pob-dd-item.sel .pob-dd-check { opacity:1; }',
            // Buscador de técnicos: caja con lupa.
            '.pob-search { display:flex; align-items:center; gap:8px; background:#fff; border:1px solid #E5E5EA; border-radius:10px; padding:9px 12px; transition:border-color 0.15s, box-shadow 0.15s; }',
            '.pob-search:focus-within { border-color:#0052D4; box-shadow:0 0 0 3px rgba(0,82,212,0.12); }',
            '.pob-search-ic { color:#A1A1A6; flex-shrink:0; }',
            '.pob-search input { flex:1; min-width:0; border:none; outline:none; background:transparent; font-family:inherit; font-size:0.88rem; color:#1D1D1F; }',
            '.pob-search input::placeholder { color:#B6B6BC; }',
            '.pob-section-label { font-size:0.66rem; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; color:#86868B; margin:18px 0 8px; }',
            '.pob-side-label { font-size:0.66rem; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; color:#86868B; }',
            '@media (max-width:720px){ .pob-body { grid-template-columns:1fr; } .pob-side { border-left:none; border-top:1px solid #F2F2F7; padding:14px 0 0; margin-top:8px; } .pob-main { padding-right:0; } }',
        ].join('\n');
        (document.head || document.body).appendChild(s);
    })();

    function _csrf() {
        var v = document.cookie.match('(^|;)\\s*csrftoken\\s*=\\s*([^;]+)');
        return v ? v.pop() : '';
    }
    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _fmtMoney(v) {
        var n = Number(v || 0);
        if (!isFinite(n)) return '$0';
        return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    var MESES_CORTO = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    function _fmtFecha(iso, tentativa) {
        if (!iso) return tentativa ? _esc(tentativa) : '<span style="color:#C7C7CC;">—</span>';
        var p = iso.split('-');
        var d = new Date(+p[0], +p[1] - 1, +p[2]);
        return d.getDate() + ' ' + MESES_CORTO[d.getMonth()] + ' ' + d.getFullYear();
    }
    function _estadoPillCls(estado) {
        if (estado === 'completada') return 'wop-pill wop-pill-done';
        if (estado === 'en_curso')   return 'wop-pill wop-pill-curso';
        if (estado === 'cancelada')  return 'wop-pill wop-pill-cancel';
        if (estado === 'tentativa')  return 'wop-pill wop-pill-tent';
        return 'wop-pill wop-pill-prog';
    }

    // Avatares apilados (stack) para la columna "Personal" de la tabla.
    // Muestra hasta 4 técnicos; si hay más, un círculo "+N" con tooltip.
    function _renderTecnicoAvatars(tecnicos) {
        if (!tecnicos || !tecnicos.length) return '<span style="color:#C7C7CC;">—</span>';
        var VISIBLES = 4;
        var primeros = tecnicos.slice(0, VISIBLES);
        var resto = tecnicos.slice(VISIBLES);
        var html = '<div style="display:inline-flex;align-items:center;">';
        primeros.forEach(function (t, i) {
            var bg = _colorFromName(t.nombre);
            var common = 'width:26px;height:26px;border-radius:50%;border:2px solid #fff;display:inline-flex;align-items:center;justify-content:center;'
                + 'font-size:0.66rem;font-weight:700;color:#fff;flex-shrink:0;box-shadow:0 0 0 1px rgba(0,0,0,0.04);'
                + (i > 0 ? 'margin-left:-8px;' : '');
            var inner = t.avatar_url
                ? '<img src="' + _esc(t.avatar_url) + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="' + _esc(t.nombre) + '">'
                : _esc(t.iniciales || '?');
            html += '<div title="' + _esc(t.nombre) + '" style="' + common + 'background:' + bg + ';">' + inner + '</div>';
        });
        if (resto.length) {
            var more = resto.map(function (t) { return t.nombre; }).join(', ');
            html += '<div title="' + _esc(more) + '" style="width:26px;height:26px;border-radius:50%;border:2px solid #fff;background:#86868B;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:0.66rem;font-weight:700;flex-shrink:0;margin-left:-8px;">+' + resto.length + '</div>';
        }
        html += '</div>';
        return html;
    }
    var _AV_PALETTE = ['#0052D4','#34C759','#FF9500','#5856D6','#AF52DE','#FF3B30','#00C7BE','#A2845E'];
    function _colorFromName(name) {
        if (!name) return '#86868B';
        var h = 0;
        for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
        return _AV_PALETTE[Math.abs(h) % _AV_PALETTE.length];
    }

    // Proyecto activo (lo lee del global window._proyectoActualId que el
    // resto del widget mantiene). Fallback: data attr del root.
    function _proyectoIdActivo() {
        if (window._proyectoActualId) return window._proyectoActualId;
        if (window._currentProjectId) return window._currentProjectId;
        var detRoot = document.getElementById('proyectoDetailSection');
        if (detRoot && detRoot.dataset && detRoot.dataset.projectId) return parseInt(detRoot.dataset.projectId, 10);
        return null;
    }

    // ─── Tabla de instalaciones del proyecto ─────────────────────────
    window.pobCargarLista = function (proyectoId) {
        var pid = proyectoId || _proyectoIdActivo();
        var wrap = document.getElementById('pobContainer');
        if (!wrap) return;
        if (!pid) {
            wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#86868B;font-size:0.85rem;">Selecciona un proyecto.</div>';
            return;
        }
        wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#86868B;font-size:0.85rem;">Cargando…</div>';
        fetch('/app/api/proyecto/' + pid + '/instalaciones/', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success) {
                    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#FF3B30;">No se pudo cargar.</div>';
                    return;
                }
                var inst = data.instalaciones || [];
                if (!inst.length) {
                    wrap.innerHTML = '<div class="pob-empty">'
                        + '<svg class="pob-empty-ic" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>'
                        + '<div class="pob-empty-title">Sin instalaciones aún</div>'
                        + '<div class="pob-empty-sub">Da click en <b>+ Nueva instalación</b> para crear la primera.</div>'
                        + '</div>';
                    return;
                }
                var rows = inst.map(function (it) {
                    return '<tr onclick="pobAbrirModal(' + it.id + ')" style="cursor:pointer;">'
                        + '<td style="font-family:ui-monospace,monospace;color:#475569;font-weight:600;">' + (_esc(it.po) || '<span style="color:#C7C7CC;">—</span>') + '</td>'
                        + '<td><div style="font-weight:600;color:#1D1D1F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;" title="' + _esc(it.descripcion) + '">' + _esc(it.descripcion) + '</div>'
                        +   '<div style="font-size:0.7rem;color:#86868B;">' + _esc(it.cliente_nombre || '') + '</div></td>'
                        + '<td style="color:#3C3C43;white-space:nowrap;">' + _fmtFecha(it.fecha, it.fecha_tentativa_texto) + '</td>'
                        + '<td style="color:#3C3C43;">' + it.jornadas_count + ' <span style="color:#86868B;font-size:0.7rem;">' + _esc(it.jornadas_tipo_label) + '</span></td>'
                        + '<td>' + _renderTecnicoAvatars(it.tecnicos_asignados) + '</td>'
                        + '<td style="font-weight:600;color:#1D1D1F;white-space:nowrap;">' + _fmtMoney(it.monto_po) + '</td>'
                        + '<td><span class="' + _estadoPillCls(it.estado) + '">' + _esc(it.estado_label) + '</span></td>'
                        + '<td style="text-align:right;color:#86868B;font-size:0.78rem;">' + (it.asignaciones_count || 0) + ' técn.</td>'
                        + '</tr>';
                }).join('');
                wrap.innerHTML = '<div style="overflow-x:auto;background:#fff;border:1px solid #E5E5EA;border-radius:12px;">'
                    + '<table class="wop-table" style="width:100%;border-collapse:separate;border-spacing:0;font-size:0.82rem;">'
                    + '<thead><tr>'
                    + '<th>PO</th><th>Descripción</th><th>Fecha</th><th>Jornadas</th><th>Personal</th><th>Monto</th><th>Estado</th><th style="text-align:right;">Técn.</th>'
                    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
            })
            .catch(function () {
                wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#FF3B30;">Error de red.</div>';
            });
    };

    // ─── Modal único: detalle + edit + asignaciones ──────────────────
    function _ensureModal() {
        if (document.getElementById('pobModalBackdrop')) return;
        var html =
            '<div class="wop-modal-backdrop" id="pobModalBackdrop">'
          +   '<div class="wop-modal pob-modal" style="width:min(1180px, 96vw); max-width:96vw;">'
          +     '<div class="pob-head">'
          +       '<div class="pob-eyebrow">'
          +         '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
          +         '<span id="pobModalTitle">Nueva instalación</span>'
          +       '</div>'
          +       '<div style="display:flex;gap:8px;align-items:center;">'
          +         '<button type="button" id="pobBtnEliminar" class="wop-btn-secondary" style="background:#FFE3E3;color:#991B1B;" onclick="pobEliminar()">Eliminar</button>'
          +         '<button type="button" class="widget-close pob-close" onclick="pobCerrarModal()" aria-label="Cerrar"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
          +       '</div>'
          +     '</div>'
          +     '<div class="wop-modal-body pob-body">'
          +       '<div class="pob-main" id="pobFormCol">'
          // ── Descripción del trabajo: caja grande y cómoda ──
          +         '<div class="pob-group">'
          +           '<div class="pob-group-label">Descripción del trabajo</div>'
          +           '<textarea id="pobInstDescripcion" class="pob-title-input" rows="2" placeholder="¿Qué se va a instalar? Describe el trabajo…"></textarea>'
          +         '</div>'
          // ── Grupos lógicos de meta (orden de llenado) ──
          // 1) Cliente y orden de compra (incluye montos)
          +         '<div class="pob-group">'
          +           '<div class="pob-group-label">Cliente y orden de compra</div>'
          +           '<div class="pob-meta">'
          +             '<div class="pob-meta-row">'
          +               '<span class="pob-meta-label">'
          +                 '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
          +                 'Cliente</span>'
          +               '<input type="text" id="pobInstCliente" maxlength="200" class="pob-input" placeholder="Nombre del cliente">'
          +             '</div>'
          +             '<div class="pob-meta-row">'
          +               '<span class="pob-meta-label">'
          +                 '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
          +                 'PO</span>'
          +               '<input type="text" id="pobInstPo" maxlength="80" class="pob-input" placeholder="Orden de compra">'
          +             '</div>'
          +             '<div class="pob-meta-row">'
          +               '<span class="pob-meta-label">'
          +                 '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'
          +                 'Monto PO</span>'
          +               '<input type="number" id="pobInstMonto" step="0.01" class="pob-input pob-input-num" placeholder="0.00">'
          +             '</div>'
          +             '<div class="pob-meta-row">'
          +               '<span class="pob-meta-label">'
          +                 '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>'
          +                 'Utilidad</span>'
          +               '<input type="number" id="pobInstUtilidad" step="0.01" class="pob-input pob-input-num" placeholder="0.00">'
          +             '</div>'
          +           '</div>'
          +         '</div>'
          // 2) Programación (cuándo + jornada + personal)
          +         '<div class="pob-group">'
          +           '<div class="pob-group-label">Programación</div>'
          +           '<div class="pob-meta">'
          +             '<div class="pob-meta-row">'
          +               '<span class="pob-meta-label">'
          +                 '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
          +                 'Fecha</span>'
          +               '<input type="date" id="pobInstFecha" class="pob-input">'
          +             '</div>'
          +             '<div class="pob-meta-row">'
          +               '<span class="pob-meta-label">'
          +                 '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'
          +                 'Horario</span>'
          +               '<div style="display:flex;align-items:center;gap:6px;">'
          +                 '<input type="time" id="pobInstHoraInicio" class="pob-input" style="max-width:110px;">'
          +                 '<span style="color:#86868B;">–</span>'
          +                 '<input type="time" id="pobInstHoraFin" class="pob-input" style="max-width:110px;">'
          +               '</div>'
          +             '</div>'
          +             '<div class="pob-meta-row">'
          +               '<span class="pob-meta-label">'
          +                 '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'
          +                 'Estado</span>'
          +               '<div class="pob-dd">'
          +                 '<select id="pobInstEstado" class="pob-input">'
          +                   '<option value="tentativa">Tentativa</option>'
          +                   '<option value="programada">Programada</option>'
          +                   '<option value="en_curso">En curso</option>'
          +                   '<option value="completada">Completada</option>'
          +                   '<option value="cancelada">Cancelada</option>'
          +                 '</select>'
          +               '</div>'
          +             '</div>'
          +             '<div class="pob-meta-row">'
          +               '<span class="pob-meta-label">'
          +                 '<button type="button" id="pobJornadasCfgBtn" title="Configurar días de las jornadas (clic)" style="border:none;background:rgba(0,82,212,0.1);padding:3px;margin:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;color:#0052D4;transition:background 0.15s,box-shadow 0.15s;box-shadow:0 0 0 1px rgba(0,82,212,0.18);" onmouseover="this.style.background=\'rgba(0,82,212,0.18)\'" onmouseout="this.style.background=\'rgba(0,82,212,0.1)\'">'
          +                   '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'
          +                 '</button>'
          +                 'Jornadas</span>'
          +               '<div style="display:flex;align-items:center;gap:8px;position:relative;">'
          +                 '<input type="number" id="pobInstJornadas" min="1" class="pob-input pob-input-num" style="max-width:48px;">'
          +                 '<div class="pob-dd">'
          +                   '<select id="pobInstJornadasTipo" class="pob-input">'
          +                     '<option value="normal">Normal</option>'
          +                     '<option value="sabado">Sábado</option>'
          +                     '<option value="domingo">Domingo</option>'
          +                     '<option value="noche">Noche</option>'
          +                     '<option value="extraordinaria">Extraordinaria</option>'
          +                   '</select>'
          +                 '</div>'
          +                 '<span id="pobJornadasCfgBadge" style="display:none;font-size:0.68rem;font-weight:700;color:#0052D4;background:#E8F0FE;border-radius:6px;padding:2px 7px;white-space:nowrap;">Días elegidos</span>'
          +               '</div>'
          +             '</div>'
          +             '<div class="pob-meta-row pob-meta-grow">'
          +               '<span class="pob-meta-label">'
          +                 '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
          +                 'Personal</span>'
          +               '<input type="text" id="pobInstPersonal" maxlength="200" class="pob-input" placeholder="Ej. 1 SUPERVISOR Y 3 TÉCNICOS">'
          +             '</div>'
          +           '</div>'
          +         '</div>'
          // ── Notas / observaciones (más amplias) ──
          +         '<div class="pob-group">'
          +           '<div class="pob-group-label">Notas / observaciones</div>'
          +           '<textarea id="pobInstNotas" class="pob-notes" placeholder="Hora, instrucciones especiales, accesos, material…"></textarea>'
          +         '</div>'
          +       '</div>'
          +       '<div id="pobAsignCol" class="pob-side">'
          +         '<div id="pobAsignHeader" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
          +           '<div class="pob-group-label" style="margin:0;">Técnicos asignados</div>'
          +           '<button type="button" id="pobBtnToggleAddAsig" class="wop-btn-secondary" onclick="pobToggleAddAsig()" style="font-size:0.74rem;padding:4px 8px;">+ Agregar</button>'
          +         '</div>'

          // ── Picker en modo CREAR: busca Users del sistema ──
          +         '<div id="pobCreateUsersBox" style="display:none;background:#F9FAFB;padding:10px;border-radius:8px;margin-bottom:12px;">'
          +           '<div style="font-size:0.7rem;color:#86868B;margin-bottom:6px;">'
          +             'Selecciona técnicos del CRM. Se les creará la instalación en su calendario (fecha programada).'
          +           '</div>'
          +           '<div class="pob-search">'
          +             '<svg class="pob-search-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
          +             '<input type="text" id="pobUserSearch" placeholder="Buscar técnico por nombre…" autocomplete="off">'
          +           '</div>'
          +           '<div id="pobUserResults" style="margin-top:6px;max-height:160px;overflow-y:auto;"></div>'
          +           '<div style="font-size:0.66rem;color:#86868B;margin-top:8px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">Seleccionados</div>'
          +           '<div id="pobUserChips" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;min-height:24px;"></div>'
          +         '</div>'

          // ── Picker en modo EDITAR: agrega asignaciones puntuales ──
          +         '<div id="pobAddAsigForm" style="display:none;background:#F9FAFB;padding:10px;border-radius:8px;margin-bottom:12px;">'
          +           '<div class="wop-field" style="margin-bottom:6px;"><label style="font-size:0.66rem;">Técnico</label>'
          +             '<select id="pobAddAsigTecnico"></select></div>'
          +           '<div class="wop-field" style="margin-bottom:6px;"><label style="font-size:0.66rem;">Fecha</label>'
          +             '<input type="date" id="pobAddAsigFecha"></div>'
          +           '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">'
          +             '<div class="wop-field" style="margin:0;"><label style="font-size:0.66rem;">Inicio (opc)</label>'
          +               '<input type="time" id="pobAddAsigInicio"></div>'
          +             '<div class="wop-field" style="margin:0;"><label style="font-size:0.66rem;">Fin (opc)</label>'
          +               '<input type="time" id="pobAddAsigFin"></div>'
          +           '</div>'
          +           '<div style="display:flex;justify-content:flex-end;gap:6px;">'
          +             '<button type="button" class="wop-btn-secondary" onclick="pobToggleAddAsig(false)" style="font-size:0.74rem;padding:4px 10px;">Cancelar</button>'
          +             '<button type="button" class="wop-btn-primary" onclick="pobGuardarAsignacion()" style="font-size:0.74rem;padding:4px 10px;">Asignar</button>'
          +           '</div>'
          +         '</div>'
          +         '<div id="pobAsignList"></div>'
          +       '</div>'
          +     '</div>'
          +     '<div class="wop-modal-foot">'
          +       '<button type="button" class="wop-btn-secondary" onclick="pobCerrarModal()">Cerrar</button>'
          +       '<button type="button" class="wop-btn-primary" id="pobBtnGuardar" onclick="pobGuardarCambios()">Guardar cambios</button>'
          +     '</div>'
          +   '</div>'
          + '</div>';
        var div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstChild);
        pobInitDropdowns();

        // Configurador de días de las jornadas (popover del reloj).
        var cfgBtn = document.getElementById('pobJornadasCfgBtn');
        if (cfgBtn) cfgBtn.onclick = window.pobToggleJornadasCfg;
        // Al cambiar la cantidad de jornadas, re-renderiza el popover (más/menos
        // filas) y recorta los días personalizados si sobran.
        var jornInp = document.getElementById('pobInstJornadas');
        if (jornInp) {
            jornInp.addEventListener('input', function () {
                if (Array.isArray(_pobDiasPersonalizados)) {
                    var n = _pobJornadasNum();
                    if (_pobDiasPersonalizados.length > n) _pobDiasPersonalizados = _pobDiasPersonalizados.slice(0, n);
                }
                _pobSyncJornadasCfgUI();
            });
        }
    }

    // Convierte los <select> marcados con wrapper .pob-dd en dropdowns
    // personalizados (botón + menú blanco sólido), sin perder el <select>
    // nativo como fuente de valor (lo lee/escribe el resto del código).
    function pobInitDropdowns() {
        var wraps = document.querySelectorAll('.pob-dd');
        Array.prototype.forEach.call(wraps, function (wrap) {
            if (wrap._ddInit) return;
            var sel = wrap.querySelector('select');
            if (!sel) return;
            wrap._ddInit = true;
            sel.classList.add('pob-dd-native');

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pob-dd-btn';
            var val = document.createElement('span');
            val.className = 'pob-dd-val';
            btn.appendChild(val);
            btn.insertAdjacentHTML('beforeend', '<svg class="pob-dd-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>');
            wrap.insertBefore(btn, sel);

            function syncLabel() {
                var opt = sel.options[sel.selectedIndex];
                val.textContent = opt ? opt.text : '';
            }
            syncLabel();
            sel.addEventListener('change', syncLabel);

            var menu = null;
            function close() {
                if (!menu) return;
                menu.remove(); menu = null;
                btn.classList.remove('open');
                document.removeEventListener('mousedown', onDoc, true);
                window.removeEventListener('resize', close, true);
                window.removeEventListener('scroll', close, true);
            }
            function onDoc(e) {
                if (menu && !menu.contains(e.target) && !btn.contains(e.target)) close();
            }
            function open() {
                menu = document.createElement('div');
                menu.className = 'pob-dd-menu';
                Array.prototype.forEach.call(sel.options, function (o, i) {
                    var item = document.createElement('div');
                    item.className = 'pob-dd-item' + (i === sel.selectedIndex ? ' sel' : '');
                    item.innerHTML = '<span class="pob-dd-check"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span><span>' + o.text + '</span>';
                    item.addEventListener('mousedown', function (ev) {
                        ev.preventDefault();
                        sel.value = o.value;
                        sel.dispatchEvent(new Event('change', { bubbles: true }));
                        close();
                    });
                    menu.appendChild(item);
                });
                document.body.appendChild(menu);
                var r = btn.getBoundingClientRect();
                menu.style.top = (r.bottom + 6) + 'px';
                menu.style.left = r.left + 'px';
                menu.style.minWidth = Math.max(r.width, 150) + 'px';
                // Si se sale por abajo, ábrelo hacia arriba.
                var mh = menu.offsetHeight;
                if (r.bottom + 6 + mh > window.innerHeight - 8) {
                    menu.style.top = Math.max(8, r.top - 6 - mh) + 'px';
                }
                btn.classList.add('open');
                setTimeout(function () {
                    document.addEventListener('mousedown', onDoc, true);
                    window.addEventListener('resize', close, true);
                    window.addEventListener('scroll', close, true);
                }, 0);
            }
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                if (menu) { close(); } else { open(); }
            });
        });
    }

    // ─── Widget de VISTA amigable (modo lectura) ─────────────────────
    function _ensureViewer() {
        if (document.getElementById('pobViewerBackdrop')) return;
        var html =
            '<div class="wop-modal-backdrop" id="pobViewerBackdrop">'
          +   '<div class="wop-modal" style="width:min(920px, 96vw);">'
          +     '<div class="wop-modal-head" style="background:linear-gradient(135deg,#FF9500 0%,#FFB047 100%);padding:18px;border-bottom:none;">'
          +       '<div style="flex:1;min-width:0;color:#fff;">'
          +         '<div style="font-size:0.66rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;margin-bottom:4px;">'
          +           '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" style="vertical-align:-1px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
          +           '&nbsp;Programa de Obra · Instalación'
          +         '</div>'
          +         '<h3 id="pobViewTitle" style="margin:0;color:#fff;font-size:1.15rem;font-weight:700;letter-spacing:-0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></h3>'
          +       '</div>'
          +       '<button type="button" class="widget-close" onclick="pobCerrarVista()" style="font-size:1.4rem;color:#fff;background:rgba(255,255,255,0.15);">&times;</button>'
          +     '</div>'
          +     '<div class="wop-modal-body" id="pobViewBody" style="padding:18px 22px;">'
          +       '<div style="text-align:center;padding:30px;color:#86868B;font-size:0.85rem;">Cargando…</div>'
          +     '</div>'
          +     '<div class="wop-modal-foot">'
          +       '<button type="button" class="wop-btn-secondary" onclick="pobCerrarVista()">Cerrar</button>'
          +       '<button type="button" class="wop-btn-primary" id="pobBtnEditarFromView">Editar</button>'
          +     '</div>'
          +   '</div>'
          + '</div>';
        var div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstChild);
        document.getElementById('pobBtnEditarFromView').addEventListener('click', function () {
            if (!_pobActiveInst || !_pobActiveInst.id) return;
            var id = _pobActiveInst.id;
            pobCerrarVista();
            pobAbrirEditar(id);
        });
    }

    function _renderViewerBody(inst) {
        var body = document.getElementById('pobViewBody');
        if (!body) return;
        var fechaTxt = inst.fecha
            ? _fmtFecha(inst.fecha)
            : (inst.fecha_tentativa_texto ? _esc(inst.fecha_tentativa_texto) : '<span style="color:#C7C7CC;">Sin fecha</span>');

        var asigs = (inst.asignaciones || []).map(function (a) {
            return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#F9FAFB;border-radius:8px;margin-bottom:4px;">'
                +   '<div style="width:28px;height:28px;border-radius:50%;background:#0052D4;color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.74rem;font-weight:700;flex-shrink:0;">'
                +     _esc((a.tecnico_nombre || '?').substring(0, 1).toUpperCase())
                +   '</div>'
                +   '<div style="flex:1;min-width:0;">'
                +     '<div style="font-size:0.86rem;font-weight:600;color:#1D1D1F;">' + _esc(a.tecnico_nombre) + '</div>'
                +     '<div style="font-size:0.7rem;color:#86868B;">' + _fmtFecha(a.fecha)
                +       (a.hora_inicio ? ' · ' + _esc(a.hora_inicio) + (a.hora_fin ? '–' + _esc(a.hora_fin) : '') : '')
                +     '</div>'
                +   '</div>'
                + '</div>';
        }).join('');

        var html = '';

        // ── Key data card (cliente / PO / fecha / monto) ──
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px;">';
        html +=   _statBlock('CLIENTE', _esc(inst.cliente_nombre || '—'));
        html +=   _statBlock('PO', inst.po ? '<span style="font-family:ui-monospace,monospace;">' + _esc(inst.po) + '</span>' : '<span style="color:#C7C7CC;">—</span>');
        html +=   _statBlock('FECHA PROGRAMADA', fechaTxt);
        html +=   _statBlock('ESTADO', '<span class="' + _estadoPillCls(inst.estado) + '">' + _esc(inst.estado_label || '') + '</span>');
        html += '</div>';

        // ── Económicos + jornadas ──
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px;">';
        html +=   _statBlock('MONTO PO', '<span style="font-size:1.05rem;font-weight:700;color:#1D1D1F;">' + _fmtMoney(inst.monto_po) + '</span>');
        html +=   _statBlock('UTILIDAD', '<span style="font-size:1.05rem;font-weight:700;color:#059669;">' + _fmtMoney(inst.utilidad) + '</span>');
        html +=   _statBlock('JORNADAS', _esc(String(inst.jornadas_count || 1)) + ' <span style="color:#86868B;font-size:0.8rem;">' + _esc(inst.jornadas_tipo_label || '') + '</span>');
        html +=   _statBlock('PERSONAL (TEXTO)', _esc(inst.personal || '') || '<span style="color:#C7C7CC;">—</span>');
        html += '</div>';

        // ── Desglose horizontal de jornadas (cada día con su horario) ──
        var _dias = inst.dias && inst.dias.length ? inst.dias : (inst.fecha ? [inst.fecha] : []);
        var _hi = inst.hora_inicio || '08:00';
        var _hf = inst.hora_fin || '17:00';
        if (_dias.length) {
            html += '<div style="margin-bottom:18px;">';
            html +=   '<div style="font-size:0.66rem;font-weight:700;color:#86868B;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px;">Desglose de jornadas · ' + _dias.length + ' día' + (_dias.length > 1 ? 's' : '') + ' · ' + _esc(_hi) + '–' + _esc(_hf) + '</div>';
            html +=   '<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;">';
            _dias.forEach(function (diaISO, idx) {
                html += '<div style="flex:0 0 auto;min-width:128px;background:#F9FAFB;border:1px solid #EEF0F3;border-left:3px solid #7C3AED;border-radius:10px;padding:10px 12px;">'
                      +   '<div style="font-size:0.6rem;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#7C3AED;">Jornada ' + (idx + 1) + '</div>'
                      +   '<div style="font-size:0.92rem;font-weight:700;color:#1D1D1F;margin-top:3px;">' + _esc(_fmtFecha(diaISO)) + '</div>'
                      +   '<div style="display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;color:#4B5563;margin-top:4px;">'
                      +     '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'
                      +     _esc(_hi) + '–' + _esc(_hf)
                      +   '</div>'
                      + '</div>';
            });
            html +=   '</div>';
            html += '</div>';
        }

        // ── Proyecto ligado (click abre widget) ──
        if (inst.proyecto_id) {
            html += '<div style="margin-bottom:18px;">';
            html +=   '<div style="font-size:0.66rem;font-weight:700;color:#86868B;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px;">Proyecto</div>';
            html +=   '<div onclick="pobAbrirProyectoDesdeVista(' + inst.proyecto_id + ')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background=\'#DBEAFE\'" onmouseout="this.style.background=\'#EFF6FF\'">';
            html +=     '<div style="width:32px;height:32px;border-radius:8px;background:#0052D4;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">';
            html +=       '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
            html +=     '</div>';
            html +=     '<div style="flex:1;min-width:0;">';
            html +=       '<div style="font-size:0.92rem;font-weight:600;color:#1D1D1F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(inst.proyecto_nombre || 'Proyecto #' + inst.proyecto_id) + '</div>';
            html +=       '<div style="font-size:0.7rem;color:#0052D4;">Click para abrir →</div>';
            html +=     '</div>';
            html +=   '</div>';
            html += '</div>';
        }

        // ── Oportunidad ligada ──
        if (inst.oportunidad_id && inst.oportunidad_titulo) {
            html += '<div style="margin-bottom:18px;">';
            html +=   '<div style="font-size:0.66rem;font-weight:700;color:#86868B;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px;">Oportunidad ligada</div>';
            html +=   '<div onclick="pobAbrirOppDesdeVista(' + inst.oportunidad_id + ')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#F9FAFB;border-radius:8px;cursor:pointer;" onmouseover="this.style.background=\'#F2F4F7\'" onmouseout="this.style.background=\'#F9FAFB\'">';
            html +=     '<svg width="14" height="14" fill="none" stroke="#0052D4" stroke-width="2.4" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';
            html +=     '<div style="flex:1;font-size:0.84rem;color:#1D1D1F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(inst.oportunidad_titulo) + '</div>';
            html +=     '<svg width="14" height="14" fill="none" stroke="#C7C7CC" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>';
            html +=   '</div>';
            html += '</div>';
        }

        // ── Técnicos asignados ──
        html += '<div style="margin-bottom:18px;">';
        html +=   '<div style="font-size:0.66rem;font-weight:700;color:#86868B;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px;">Técnicos asignados</div>';
        if (asigs) html += asigs;
        else html += '<div style="font-size:0.82rem;color:#86868B;padding:10px;text-align:center;background:#F9FAFB;border-radius:8px;">Sin técnicos asignados.</div>';
        html += '</div>';

        // ── Notas/Observaciones ──
        if (inst.notas || inst.observaciones) {
            html += '<div>';
            html +=   '<div style="font-size:0.66rem;font-weight:700;color:#86868B;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px;">Notas</div>';
            html +=   '<div style="font-size:0.86rem;color:#3C3C43;background:#FFF7EB;border-left:3px solid #FF9500;padding:10px 12px;border-radius:0 8px 8px 0;white-space:pre-wrap;">';
            html +=     _esc(inst.notas || inst.observaciones);
            html +=   '</div>';
            html += '</div>';
        }

        body.innerHTML = html;
    }

    function _statBlock(label, valueHtml) {
        return '<div style="background:#F9FAFB;border-radius:10px;padding:10px 12px;">'
            + '<div style="font-size:0.62rem;font-weight:700;color:#86868B;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px;">' + label + '</div>'
            + '<div style="font-size:0.92rem;font-weight:600;color:#1D1D1F;">' + valueHtml + '</div>'
            + '</div>';
    }

    window.pobAbrirVista = function (instalacionId) {
        _ensureViewer();
        var backdrop = document.getElementById('pobViewerBackdrop');
        var titleEl = document.getElementById('pobViewTitle');
        var body = document.getElementById('pobViewBody');
        if (titleEl) titleEl.textContent = 'Cargando…';
        if (body) body.innerHTML = '<div style="text-align:center;padding:30px;color:#86868B;font-size:0.85rem;">Cargando…</div>';
        if (backdrop) backdrop.classList.add('open');
        fetch('/app/api/instalacion/' + instalacionId + '/', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success) {
                    if (titleEl) titleEl.textContent = 'No se pudo cargar';
                    if (body) body.innerHTML = '<div style="text-align:center;padding:24px;color:#FF3B30;">Instalación no encontrada.</div>';
                    return;
                }
                _pobActiveInst = data.instalacion;
                if (titleEl) titleEl.textContent = _pobActiveInst.descripcion || 'Instalación';
                _renderViewerBody(_pobActiveInst);
            })
            .catch(function () {
                if (body) body.innerHTML = '<div style="text-align:center;padding:24px;color:#FF3B30;">Error de red.</div>';
            });
    };

    window.pobCerrarVista = function () {
        var backdrop = document.getElementById('pobViewerBackdrop');
        if (backdrop) backdrop.classList.remove('open');
    };

    window.pobAbrirProyectoDesdeVista = function (proyectoId) {
        pobCerrarVista();
        if (typeof window.proyectosVerDetalle === 'function') {
            window.proyectosVerDetalle(proyectoId);
        }
    };

    window.pobAbrirOppDesdeVista = function (oppId) {
        pobCerrarVista();
        if (typeof window.openDetalle === 'function') {
            window.openDetalle(oppId);
        }
    };

    var _pobActiveInst = null;     // datos de la instalación abierta en el modal
    var _pobCreatingMode = false;   // true cuando es "Nueva instalación" sin id
    var _pobTecnicosCache = null;   // [{id,nombre,rol_label}] activos
    var _pobUserSelectedIds = [];   // Users elegidos en el picker (modo crear)
    var _pobUserSelectedMap = {};   // {userId: {id, text, avatar_url}} para chips
    var _pobUserSearchResults = {}; // {userId: userObj} de la última búsqueda — fuente
                                    // de datos para pobToggleUser sin JSON-en-onclick.
    var _pobUserSearchDebounce = null;

    // ── Configurador de días de las jornadas ──────────────────────────
    // null  → modo "Seguidas" (días consecutivos auto, comportamiento previo)
    // array → modo "Elegir días": lista de fechas ISO, una por jornada.
    var _pobDiasPersonalizados = null;
    var _pobJornadasCfgOpen = false;

    // Calcula las N fechas consecutivas (mismo criterio que el backend) a
    // partir de la fecha base y el tipo de jornada — semilla para "Elegir días".
    function _pobDiasConsecutivos(fechaIso, n, tipo) {
        var out = [];
        if (!fechaIso) return out;
        var incluirFinde = (tipo === 'sabado' || tipo === 'domingo');
        var base = new Date(fechaIso + 'T00:00:00');
        if (isNaN(base.getTime())) return out;
        var cursor = new Date(base);
        var guard = 0;
        while (out.length < n && guard < 400) {
            guard++;
            var dow = cursor.getDay(); // 0=dom, 6=sáb
            var esFinde = (dow === 0 || dow === 6);
            if (!incluirFinde && esFinde) {
                cursor.setDate(cursor.getDate() + 1);
                continue;
            }
            out.push(_pobIsoDate(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }
        return out;
    }

    function _pobIsoDate(d) {
        var y = d.getFullYear();
        var m = ('0' + (d.getMonth() + 1)).slice(-2);
        var day = ('0' + d.getDate()).slice(-2);
        return y + '-' + m + '-' + day;
    }

    function _pobJornadasNum() {
        var el = document.getElementById('pobInstJornadas');
        var n = parseInt((el && el.value) || '1', 10);
        return (isNaN(n) || n < 1) ? 1 : n;
    }

    // Refleja el estado del configurador en la UI (badge + popover si abierto).
    function _pobSyncJornadasCfgUI() {
        var badge = document.getElementById('pobJornadasCfgBadge');
        if (badge) badge.style.display = (_pobDiasPersonalizados && _pobDiasPersonalizados.length) ? '' : 'none';
        if (_pobJornadasCfgOpen) _pobRenderJornadasCfgPopover();
    }

    function _pobCloseJornadasCfg() {
        _pobJornadasCfgOpen = false;
        var pop = document.getElementById('pobJornadasCfgPop');
        if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
        document.removeEventListener('mousedown', _pobJornadasCfgOutside, true);
    }

    function _pobJornadasCfgOutside(ev) {
        var pop = document.getElementById('pobJornadasCfgPop');
        var btn = document.getElementById('pobJornadasCfgBtn');
        if (!pop) return;
        if (pop.contains(ev.target) || (btn && btn.contains(ev.target))) return;
        _pobCloseJornadasCfg();
    }

    window.pobToggleJornadasCfg = function () {
        if (_pobJornadasCfgOpen) { _pobCloseJornadasCfg(); return; }
        _pobJornadasCfgOpen = true;
        _pobRenderJornadasCfgPopover();
        setTimeout(function () {
            document.addEventListener('mousedown', _pobJornadasCfgOutside, true);
        }, 0);
    };

    function _pobRenderJornadasCfgPopover() {
        var btn = document.getElementById('pobJornadasCfgBtn');
        if (!btn) return;
        var pop = document.getElementById('pobJornadasCfgPop');
        if (!pop) {
            pop = document.createElement('div');
            pop.id = 'pobJornadasCfgPop';
            pop.className = 'pob-dd-menu';
            pop.style.padding = '12px';
            pop.style.minWidth = '230px';
            document.body.appendChild(pop);
        }
        var elegir = !!(_pobDiasPersonalizados && _pobDiasPersonalizados.length);
        var n = _pobJornadasNum();

        // Semilla de fechas: lo ya elegido, completado/recortado a N con
        // consecutivos a partir de la fecha del form.
        var fechaBase = (document.getElementById('pobInstFecha') || {}).value || '';
        var tipo = (document.getElementById('pobInstJornadasTipo') || {}).value || 'normal';
        var seed = (_pobDiasPersonalizados || []).slice(0, n);
        if (seed.length < n) {
            var cons = _pobDiasConsecutivos(fechaBase, n, tipo);
            for (var i = seed.length; i < n; i++) seed.push(cons[i] || '');
        }

        var rows = '';
        if (elegir) {
            for (var j = 0; j < n; j++) {
                rows += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'
                      +   '<span style="font-size:0.72rem;color:#86868B;font-weight:700;width:64px;flex-shrink:0;">Jornada ' + (j + 1) + '</span>'
                      +   '<input type="date" class="pob-input pob-jcfg-day" data-idx="' + j + '" value="' + (seed[j] || '') + '" style="flex:1;">'
                      + '</div>';
            }
        }

        pop.innerHTML =
            '<div style="font-size:0.72rem;font-weight:700;color:#1D1D1F;margin-bottom:8px;">Días de las jornadas</div>'
          + '<div style="display:flex;gap:4px;background:#F2F2F7;border-radius:8px;padding:3px;margin-bottom:' + (elegir ? '10px' : '0') + ';">'
          +   '<button type="button" class="pob-jcfg-mode" data-mode="seguidas" style="flex:1;border:none;border-radius:6px;padding:6px 8px;font-size:0.78rem;font-weight:600;cursor:pointer;'
          +     (elegir ? 'background:transparent;color:#86868B;' : 'background:#fff;color:#1D1D1F;box-shadow:0 1px 3px rgba(0,0,0,0.12);') + '">Seguidas</button>'
          +   '<button type="button" class="pob-jcfg-mode" data-mode="elegir" style="flex:1;border:none;border-radius:6px;padding:6px 8px;font-size:0.78rem;font-weight:600;cursor:pointer;'
          +     (elegir ? 'background:#fff;color:#1D1D1F;box-shadow:0 1px 3px rgba(0,0,0,0.12);' : 'background:transparent;color:#86868B;') + '">Elegir días</button>'
          + '</div>'
          + rows;

        // Posición: anclado bajo el botón del reloj.
        var r = btn.getBoundingClientRect();
        pop.style.position = 'fixed';
        pop.style.top = (r.bottom + 6) + 'px';
        pop.style.left = Math.max(8, r.left) + 'px';

        Array.prototype.forEach.call(pop.querySelectorAll('.pob-jcfg-mode'), function (b) {
            b.onclick = function () {
                if (b.getAttribute('data-mode') === 'elegir') {
                    // Al activar "Elegir días", siembra con los consecutivos.
                    _pobDiasPersonalizados = _pobDiasConsecutivos(fechaBase, _pobJornadasNum(), tipo);
                    if (!_pobDiasPersonalizados.length) _pobDiasPersonalizados = [];
                } else {
                    _pobDiasPersonalizados = null;
                }
                _pobSyncJornadasCfgUI();
            };
        });
        Array.prototype.forEach.call(pop.querySelectorAll('.pob-jcfg-day'), function (inp) {
            inp.onchange = function () {
                var idx = parseInt(inp.getAttribute('data-idx'), 10);
                if (!Array.isArray(_pobDiasPersonalizados)) _pobDiasPersonalizados = [];
                _pobDiasPersonalizados[idx] = inp.value || '';
                var badge = document.getElementById('pobJornadasCfgBadge');
                if (badge) badge.style.display = (_pobDiasPersonalizados.some(function (x) { return !!x; })) ? '' : 'none';
            };
        });
    }

    // Devuelve la lista limpia (sin vacíos) o null para el payload.
    function _pobDiasPersonalizadosPayload() {
        if (!_pobDiasPersonalizados) return null;
        var clean = _pobDiasPersonalizados.filter(function (x) { return !!x; });
        return clean.length ? clean : null;
    }

    function _fillForm(inst) {
        var f = function (id, val) {
            var el = document.getElementById(id);
            if (!el) return;
            el.value = val == null ? '' : val;
            if (el.tagName === 'SELECT') el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        f('pobInstDescripcion', inst.descripcion);
        f('pobInstPo', inst.po);
        f('pobInstCliente', inst.cliente_nombre);
        f('pobInstFecha', inst.fecha);
        f('pobInstHoraInicio', inst.hora_inicio || '');
        f('pobInstHoraFin', inst.hora_fin || '');
        f('pobInstEstado', inst.estado || 'programada');
        f('pobInstJornadas', inst.jornadas_count || 1);
        f('pobInstJornadasTipo', inst.jornadas_tipo || 'normal');
        f('pobInstPersonal', inst.personal);
        f('pobInstMonto', inst.monto_po);
        f('pobInstUtilidad', inst.utilidad);
        f('pobInstNotas', inst.notas);

        // Restaura el configurador de jornadas (días personalizados).
        _pobCloseJornadasCfg();
        var dp = inst.dias_personalizados;
        _pobDiasPersonalizados = (Array.isArray(dp) && dp.length) ? dp.slice() : null;
        _pobSyncJornadasCfgUI();
    }

    function _renderAsignaciones(asignaciones) {
        var lst = document.getElementById('pobAsignList');
        if (!lst) return;
        if (!asignaciones || !asignaciones.length) {
            lst.innerHTML = '<div style="font-size:0.78rem;color:#86868B;padding:12px;text-align:center;background:#F9FAFB;border-radius:8px;">Sin asignaciones aún</div>';
            return;
        }
        lst.innerHTML = asignaciones.map(function (a) {
            var hora = '';
            if (a.hora_inicio && a.hora_fin) hora = a.hora_inicio + '–' + a.hora_fin;
            else if (a.hora_inicio) hora = 'desde ' + a.hora_inicio;
            return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:#F9FAFB;margin-bottom:6px;">'
                + '<div style="flex:1;min-width:0;">'
                +   '<div style="font-size:0.84rem;font-weight:700;color:#1D1D1F;">' + _esc(a.tecnico_nombre) + '</div>'
                +   '<div style="font-size:0.7rem;color:#86868B;">' + _fmtFecha(a.fecha) + (hora ? ' · ' + _esc(hora) : '') + '</div>'
                + '</div>'
                + '<button type="button" class="wop-icon-btn" title="Quitar" onclick="pobQuitarAsignacion(' + a.id + ')">'
                + '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
                + '</button>'
                + '</div>';
        }).join('');
    }

    function _cargarTecnicosCache() {
        if (_pobTecnicosCache) {
            _llenarSelectTecnicos();
            return Promise.resolve(_pobTecnicosCache);
        }
        return fetch('/app/api/tecnicos/', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.success) {
                    _pobTecnicosCache = data.tecnicos || [];
                    _llenarSelectTecnicos();
                    return _pobTecnicosCache;
                }
                return [];
            });
    }
    function _llenarSelectTecnicos() {
        var sel = document.getElementById('pobAddAsigTecnico');
        if (!sel || !_pobTecnicosCache) return;
        sel.innerHTML = '<option value="">— Selecciona —</option>'
            + _pobTecnicosCache.map(function (t) {
                return '<option value="' + t.id + '">' + _esc(t.nombre) + ' (' + _esc(t.rol_label) + ')</option>';
            }).join('');
    }

    // pobAbrirModal por compatibilidad: el click por default ahora muestra
    // el WIDGET DE VISTA amigable (preview tipo lectura), no el form de
    // edición. Para entrar al form: pobAbrirEditar(id) o click en "Editar"
    // dentro del widget de vista.
    window.pobAbrirModal = function (instalacionId) {
        return window.pobAbrirVista(instalacionId);
    };

    window.pobAbrirEditar = function (instalacionId) {
        _ensureModal();
        _pobCreatingMode = false;
        var titleEl = document.getElementById('pobModalTitle');
        var modal = document.getElementById('pobModalBackdrop');
        var btnDel = document.getElementById('pobBtnEliminar');
        if (titleEl) titleEl.textContent = 'Cargando…';
        if (btnDel) btnDel.style.display = '';
        if (modal) modal.classList.add('open');
        // Modo EDITAR: oculta el picker de Users y muestra el flow normal.
        _pobAplicarUiModoCrear(false);
        fetch('/app/api/instalacion/' + instalacionId + '/', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success) {
                    if (titleEl) titleEl.textContent = 'No se pudo cargar';
                    return;
                }
                _pobActiveInst = data.instalacion;
                if (titleEl) titleEl.textContent = (_pobActiveInst.descripcion || 'Instalación').substring(0, 80);
                _fillForm(_pobActiveInst);
                _renderAsignaciones(_pobActiveInst.asignaciones);
                _cargarTecnicosCache();
            });
    };

    window.pobAbrirNueva = function () {
        var pid = _proyectoIdActivo();
        if (!pid) {
            if (typeof showToast === 'function') showToast('Selecciona un proyecto primero', 'error');
            return;
        }
        _ensureModal();
        _pobCreatingMode = true;
        _pobActiveInst = { proyecto_id: pid, asignaciones: [] };
        _pobUserSelectedIds = [];
        _pobUserSelectedMap = {};
        _pobUserSearchResults = {};
        var titleEl = document.getElementById('pobModalTitle');
        if (titleEl) titleEl.textContent = 'Nueva instalación';
        var btnDel = document.getElementById('pobBtnEliminar');
        if (btnDel) btnDel.style.display = 'none';
        _fillForm({
            descripcion: '', po: '', cliente_nombre: '', fecha: '',
            hora_inicio: '08:00', hora_fin: '17:00',
            estado: 'programada', jornadas_count: 1, jornadas_tipo: 'normal',
            personal: '', monto_po: '', utilidad: '', notas: '', dias_personalizados: null,
        });
        _renderAsignaciones([]);
        _pobAplicarUiModoCrear(true);
        _pobRenderUserChips();
        _pobRenderUserResults([]);

        var modal = document.getElementById('pobModalBackdrop');
        if (modal) modal.classList.add('open');

        // Pre-llenado INMEDIATO del PO desde el detalle de proyecto ya cacheado
        // (crm_proyectos.js → window.proyGetCachedDetail). Si la oportunidad
        // ligada tiene po_number, lo ponemos sin esperar al fetch de defaults.
        // Solo en modo crear y si el campo está vacío (no pisa nada escrito).
        try {
            var detail = (typeof window.proyGetCachedDetail === 'function') ? window.proyGetCachedDetail() : null;
            if (detail && detail.oportunidad_po) {
                var poElNow = document.getElementById('pobInstPo');
                if (poElNow && !poElNow.value) poElNow.value = detail.oportunidad_po;
            }
        } catch (e) { /* silencioso */ }

        // Pre-llenar cliente / PO desde la oportunidad ligada al proyecto.
        fetch('/app/api/proyecto/' + pid + '/instalacion-defaults/', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success || !data.defaults) return;
                var d = data.defaults;
                var clEl = document.getElementById('pobInstCliente');
                if (clEl && !clEl.value && d.cliente_nombre) clEl.value = d.cliente_nombre;
                var poEl = document.getElementById('pobInstPo');
                if (poEl && !poEl.value && d.po) poEl.value = d.po;
                if (_pobActiveInst) _pobActiveInst.oportunidad_id = d.oportunidad_id || null;
            })
            .catch(function () { /* silencioso */ });

        var desc = document.getElementById('pobInstDescripcion');
        if (desc) desc.focus();

        // Hook del input de búsqueda de Users (live search).
        var input = document.getElementById('pobUserSearch');
        if (input) {
            input.value = '';
            input.oninput = function () {
                clearTimeout(_pobUserSearchDebounce);
                var q = input.value.trim();
                _pobUserSearchDebounce = setTimeout(function () {
                    if (!q) { _pobRenderUserResults([]); return; }
                    fetch('/app/api/users/?q=' + encodeURIComponent(q), { credentials: 'same-origin' })
                        .then(function (r) { return r.json(); })
                        .then(function (results) { _pobRenderUserResults(results || []); })
                        .catch(function () {});
                }, 200);
            };
        }
    };

    function _pobAplicarUiModoCrear(esCrear) {
        // En CREAR: muestra el picker de Users (pobCreateUsersBox) y oculta
        // el botón "+ Agregar" + el form de asignación puntual (esos viven
        // sólo en modo EDITAR).
        var box = document.getElementById('pobCreateUsersBox');
        var btnToggle = document.getElementById('pobBtnToggleAddAsig');
        var addForm = document.getElementById('pobAddAsigForm');
        var lst = document.getElementById('pobAsignList');
        var hdr = document.getElementById('pobAsignHeader');
        if (box) box.style.display = esCrear ? '' : 'none';
        if (btnToggle) btnToggle.style.display = esCrear ? 'none' : '';
        if (addForm && esCrear) addForm.style.display = 'none';
        // La lista de asignaciones programadas ("Sin asignaciones aún") sólo
        // tiene sentido en EDITAR; en CREAR los técnicos se eligen arriba.
        if (lst) lst.style.display = esCrear ? 'none' : '';
        // El encabezado "Técnicos asignados" es redundante en CREAR (la caja
        // gris ya lo explica) → se oculta para pegar el selector a las notas.
        if (hdr) hdr.style.display = esCrear ? 'none' : '';
    }

    function _pobRenderUserResults(results) {
        var wrap = document.getElementById('pobUserResults');
        if (!wrap) return;
        // Cachear resultados para que pobToggleUser pueda hidratarse sin
        // pasar el objeto entero por el onclick (rompía con JSON-en-HTML).
        _pobUserSearchResults = {};
        (results || []).forEach(function (u) { _pobUserSearchResults[u.id] = u; });

        if (!results || !results.length) {
            wrap.innerHTML = '<div style="color:#86868B;font-size:0.74rem;padding:6px;">Escribe para buscar usuarios.</div>';
            return;
        }
        wrap.innerHTML = results.map(function (u) {
            var seleccionado = !!_pobUserSelectedMap[u.id];
            var avatar = u.avatar_url
                ? '<img src="' + _esc(u.avatar_url) + '" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
                : '<div style="width:24px;height:24px;border-radius:50%;background:#0052D4;color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.66rem;font-weight:700;flex-shrink:0;">'
                  + _esc((u.text || '?').substring(0, 1).toUpperCase()) + '</div>';
            return '<div data-pob-user-id="' + u.id + '" '
                + 'style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;'
                + (seleccionado ? 'background:#E0F2FE;' : '') + '">'
                + avatar
                + '<div style="flex:1;min-width:0;font-size:0.82rem;color:#1D1D1F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(u.text) + '</div>'
                + (seleccionado ? '<svg width="14" height="14" fill="none" stroke="#0052D4" stroke-width="2.4" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : '')
                + '</div>';
        }).join('');

        // Delegate click: un solo listener para todos los results, sin
        // strings JSON en el HTML.
        wrap.onclick = function (ev) {
            var t = ev.target;
            while (t && t !== wrap && !t.hasAttribute('data-pob-user-id')) t = t.parentElement;
            if (!t || t === wrap) return;
            var uid = parseInt(t.getAttribute('data-pob-user-id'), 10);
            if (!isFinite(uid)) return;
            pobToggleUser(uid);
        };
    }

    function _pobRenderUserChips() {
        var wrap = document.getElementById('pobUserChips');
        if (!wrap) return;
        if (!_pobUserSelectedIds.length) {
            wrap.innerHTML = '<div style="font-size:0.72rem;color:#86868B;">Ninguno seleccionado todavía.</div>';
            return;
        }
        wrap.innerHTML = _pobUserSelectedIds.map(function (uid) {
            var u = _pobUserSelectedMap[uid] || { text: 'Usuario ' + uid };
            return '<div style="display:inline-flex;align-items:center;gap:4px;background:#0052D4;color:#fff;padding:3px 4px 3px 10px;border-radius:999px;font-size:0.74rem;font-weight:600;">'
                + _esc(u.text)
                + '<button type="button" data-pob-chip-remove="' + uid + '" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:0.7rem;padding:0;line-height:1;">×</button>'
                + '</div>';
        }).join('');
        // Listener delegado para los X de los chips.
        wrap.onclick = function (ev) {
            var btn = ev.target.closest && ev.target.closest('[data-pob-chip-remove]');
            if (!btn) return;
            var uid = parseInt(btn.getAttribute('data-pob-chip-remove'), 10);
            if (isFinite(uid)) pobToggleUser(uid);
        };
    }

    window.pobToggleUser = function (userId) {
        var uid = parseInt(userId, 10);
        if (!isFinite(uid)) return;
        if (_pobUserSelectedMap[uid]) {
            // Quitar
            _pobUserSelectedIds = _pobUserSelectedIds.filter(function (x) { return x !== uid; });
            delete _pobUserSelectedMap[uid];
        } else {
            // Agregar. Hidratamos el objeto del cache de la última búsqueda.
            _pobUserSelectedIds.push(uid);
            var u = _pobUserSearchResults[uid] || { id: uid, text: 'Usuario ' + uid };
            _pobUserSelectedMap[uid] = u;
        }
        _pobRenderUserChips();
        // Re-render de la lista de resultados con el highlight actualizado,
        // usando el cache local — sin re-fetch.
        var input = document.getElementById('pobUserSearch');
        if (input && input.value.trim()) {
            var resultsArr = Object.keys(_pobUserSearchResults).map(function (k) { return _pobUserSearchResults[k]; });
            _pobRenderUserResults(resultsArr);
        }
    };

    window.pobCerrarModal = function () {
        var modal = document.getElementById('pobModalBackdrop');
        if (modal) modal.classList.remove('open');
        _pobActiveInst = null;
        _pobCreatingMode = false;
        _pobUserSelectedIds = [];
        _pobUserSelectedMap = {};
        _pobUserSearchResults = {};
        var addForm = document.getElementById('pobAddAsigForm');
        if (addForm) addForm.style.display = 'none';
        _pobCloseJornadasCfg();
        _pobDiasPersonalizados = null;
    };

    function _readForm() {
        var v = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
        return {
            descripcion: v('pobInstDescripcion').trim(),
            po: v('pobInstPo').trim(),
            cliente_nombre: v('pobInstCliente').trim(),
            fecha: v('pobInstFecha'),
            hora_inicio: v('pobInstHoraInicio'),
            hora_fin: v('pobInstHoraFin'),
            estado: v('pobInstEstado'),
            jornadas_count: parseInt(v('pobInstJornadas') || '1', 10),
            jornadas_tipo: v('pobInstJornadasTipo'),
            personal: v('pobInstPersonal').trim(),
            monto_po: v('pobInstMonto') || '0',
            utilidad: v('pobInstUtilidad') || '0',
            notas: v('pobInstNotas').trim(),
            dias_personalizados: _pobDiasPersonalizadosPayload(),
        };
    }

    window.pobGuardarCambios = function () {
        var payload = _readForm();
        if (!payload.descripcion) {
            if (typeof showToast === 'function') showToast('La descripción es obligatoria.', 'error');
            var d = document.getElementById('pobInstDescripcion'); if (d) d.focus();
            return;
        }
        var btn = document.getElementById('pobBtnGuardar');
        if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

        var url, method;
        if (_pobCreatingMode) {
            url = '/app/api/proyecto/' + _proyectoIdActivo() + '/instalaciones/';
            method = 'POST';
            // Solo en create: pasar la lista de Users elegidos en el picker.
            // El backend auto-crea Tecnico si no existe y crea la asignación
            // para la fecha programada.
            if (_pobUserSelectedIds.length) payload.tecnico_user_ids = _pobUserSelectedIds;
            // Heredar oportunidad de la opp del proyecto si la hay (vino en
            // los defaults). El backend la usa solo si no hay otra.
            if (_pobActiveInst && _pobActiveInst.oportunidad_id) {
                payload.oportunidad_id = _pobActiveInst.oportunidad_id;
            }
        } else if (_pobActiveInst && _pobActiveInst.id) {
            url = '/app/api/instalacion/' + _pobActiveInst.id + '/';
            method = 'PATCH';
        } else {
            if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
            return;
        }

        fetch(url, {
            method: method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': _csrf() },
            body: JSON.stringify(payload),
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }); })
          .then(function (res) {
              if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
              if (res.ok && res.data && res.data.success) {
                  if (typeof showToast === 'function') showToast(_pobCreatingMode ? 'Instalación creada' : 'Cambios guardados', 'success');
                  pobCerrarModal();
                  pobCargarLista();
                  // Refresca el calendario si está visible.
                  if (typeof window.calGlobalRefetch === 'function' && window._calCurrentSource === 'instalaciones') {
                      try { window.calGlobalRefetch('all'); } catch (e) {}
                  }
              } else {
                  var err = (res.data && res.data.error) || 'No se pudo guardar.';
                  if (res.data && res.data.trace) {
                      console.error('[pob] Backend trace:\n' + res.data.trace);
                  }
                  if (typeof showToast === 'function') showToast(err, 'error');
              }
          })
          .catch(function () {
              if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
              if (typeof showToast === 'function') showToast('Error de red', 'error');
          });
    };

    window.pobEliminar = function () {
        if (!_pobActiveInst || !_pobActiveInst.id) return;
        if (!confirm('¿Eliminar esta instalación del Programa de Obra? Se quitan también las asignaciones de técnicos.')) return;
        fetch('/app/api/instalacion/' + _pobActiveInst.id + '/', {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: { 'X-CSRFToken': _csrf() },
        }).then(function (r) { return r.json(); }).then(function (data) {
            if (data && data.success) {
                pobCerrarModal();
                pobCargarLista();
                if (typeof window.calGlobalRefetch === 'function' && window._calCurrentSource === 'instalaciones') {
                    try { window.calGlobalRefetch('all'); } catch (e) {}
                }
            } else if (typeof showToast === 'function') {
                showToast('No se pudo eliminar.', 'error');
            }
        });
    };

    window.pobToggleAddAsig = function (forceVisible) {
        var f = document.getElementById('pobAddAsigForm');
        if (!f) return;
        if (_pobCreatingMode) {
            if (typeof showToast === 'function') showToast('Guarda la instalación antes de asignar técnicos.', 'info');
            return;
        }
        if (forceVisible === false) { f.style.display = 'none'; return; }
        if (f.style.display === 'none') {
            f.style.display = '';
            _cargarTecnicosCache();
            // Pre-llena la fecha con la fecha programada de la instalación.
            var fdate = document.getElementById('pobAddAsigFecha');
            if (fdate && _pobActiveInst && _pobActiveInst.fecha) fdate.value = _pobActiveInst.fecha;
        } else {
            f.style.display = 'none';
        }
    };

    window.pobGuardarAsignacion = function () {
        if (!_pobActiveInst || !_pobActiveInst.id) return;
        var tec = document.getElementById('pobAddAsigTecnico');
        var fch = document.getElementById('pobAddAsigFecha');
        var hi  = document.getElementById('pobAddAsigInicio');
        var hf  = document.getElementById('pobAddAsigFin');
        if (!tec || !tec.value) {
            if (typeof showToast === 'function') showToast('Selecciona un técnico', 'error');
            return;
        }
        if (!fch || !fch.value) {
            if (typeof showToast === 'function') showToast('Selecciona una fecha', 'error');
            return;
        }
        fetch('/app/api/instalacion/' + _pobActiveInst.id + '/asignaciones/', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': _csrf() },
            body: JSON.stringify({
                tecnico_id: parseInt(tec.value, 10),
                fecha: fch.value,
                hora_inicio: hi ? hi.value : '',
                hora_fin: hf ? hf.value : '',
            }),
        }).then(function (r) { return r.json(); }).then(function (data) {
            if (data && data.success) {
                // Refresca el detalle para traer las asignaciones actualizadas.
                fetch('/app/api/instalacion/' + _pobActiveInst.id + '/', { credentials: 'same-origin' })
                    .then(function (r2) { return r2.json(); })
                    .then(function (d2) {
                        if (d2 && d2.success) {
                            _pobActiveInst = d2.instalacion;
                            _renderAsignaciones(_pobActiveInst.asignaciones);
                        }
                    });
                pobToggleAddAsig(false);
                if (typeof window.calGlobalRefetch === 'function' && (window._calCurrentSource === 'instalaciones' || window._calViewMode === 'tecnicos')) {
                    try { window.calGlobalRefetch('all'); } catch (e) {}
                }
                if (typeof showToast === 'function') {
                    showToast(data.created ? 'Técnico asignado' : 'Ya estaba asignado', data.created ? 'success' : 'info');
                }
            } else if (typeof showToast === 'function') {
                showToast((data && data.error) || 'No se pudo asignar', 'error');
            }
        });
    };

    window.pobQuitarAsignacion = function (asignacionId) {
        if (!_pobActiveInst || !_pobActiveInst.id) return;
        fetch('/app/api/instalacion/' + _pobActiveInst.id + '/asignaciones/' + asignacionId + '/', {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: { 'X-CSRFToken': _csrf() },
        }).then(function (r) { return r.json(); }).then(function (data) {
            if (data && data.success) {
                // Quitar localmente sin refetch.
                if (_pobActiveInst && _pobActiveInst.asignaciones) {
                    _pobActiveInst.asignaciones = _pobActiveInst.asignaciones.filter(function (a) { return a.id !== asignacionId; });
                    _renderAsignaciones(_pobActiveInst.asignaciones);
                }
                if (typeof window.calGlobalRefetch === 'function' && (window._calCurrentSource === 'instalaciones' || window._calViewMode === 'tecnicos')) {
                    try { window.calGlobalRefetch('all'); } catch (e) {}
                }
            }
        });
    };

    // ─── Hook al cambio de tab ───────────────────────────────────────
    // El widget de Proyecto usa proyectosSetTab(); recargamos la tabla
    // cada vez que se active 'programa-obra' POR CUALQUIER MEDIO (click
    // del usuario, persistencia de tab al recargar, deep-link). Antes
    // solo hookeábamos el click → al cambiar de proyecto sin re-clickear
    // el tab, la tabla quedaba con los datos del proyecto anterior.
    //
    // Estrategia: monkey-patch de window.proyectosSetTab (definido en
    // crm_proyectos.js que carga antes que este módulo).

    function _wrapProyectosSetTab() {
        if (typeof window.proyectosSetTab !== 'function') return false;
        if (window.proyectosSetTab._pobWrapped) return true;
        var orig = window.proyectosSetTab;
        var wrapped = function (tabName) {
            var r = orig.apply(this, arguments);
            if (tabName === 'programa-obra') {
                // Defer mínimo para que el pane ya esté visible.
                setTimeout(function () { pobCargarLista(); }, 30);
            }
            return r;
        };
        wrapped._pobWrapped = true;
        window.proyectosSetTab = wrapped;
        return true;
    }

    // También wrap a proyectosVerDetalle para limpiar el pane al cambiar
    // de proyecto, evitando ver fugazmente la tabla del proyecto anterior.
    function _wrapProyectosVerDetalle() {
        if (typeof window.proyectosVerDetalle !== 'function') return false;
        if (window.proyectosVerDetalle._pobWrapped) return true;
        var orig = window.proyectosVerDetalle;
        var wrapped = function (projectId, initialTab) {
            // Si ya había una lista cargada de OTRO proyecto, límpiala
            // para que no se vea contenido viejo mientras carga el nuevo.
            var wrap = document.getElementById('pobContainer');
            if (wrap) wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#86868B;font-size:0.85rem;">Cargando…</div>';
            return orig.apply(this, arguments);
        };
        wrapped._pobWrapped = true;
        window.proyectosVerDetalle = wrapped;
        return true;
    }

    function _initHooks() {
        _wrapProyectosSetTab();
        _wrapProyectosVerDetalle();
    }

    // Cerrar con Escape.
    document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Escape') return;
        var m = document.getElementById('pobModalBackdrop');
        if (m && m.classList.contains('open')) { pobCerrarModal(); ev.stopPropagation(); }
    });

    // Migrado a crmReady (Turbo-friendly).
    window.crmReady(_initHooks);
    // Reintentar por si crm_proyectos.js todavía no estaba listo.
    setTimeout(_initHooks, 500);
    setTimeout(_initHooks, 1500);
})();
