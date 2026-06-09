/*
  crm_marca_editar_v2.js — Lógica del widget de edición/creación de marca.

  Expone window._crmMarcaEditor con:
      .open({ mode: 'edit'|'create', key?: string })
      .close()
      .save()

  Endpoints:
      GET  /app/api/marcas/<key>/edit/        — payload (modo edit)
      POST /app/api/marcas/crear/             — alta (multipart o JSON)
      POST /app/api/marcas/<key>/actualizar/  — update (multipart o JSON)
      POST /app/api/marcas/<key>/eliminar/    — soft delete

  Soporta subida de logo con preview (FileReader) y POST como multipart
  cuando hay archivo nuevo. Si no hay archivo, envía JSON.
*/
(function () {
    'use strict';

    var STATE = {
        mode: 'edit',     // 'create' | 'edit'
        key: null,        // key actual en modo edit
        marca: null,      // payload server
        logoFile: null,   // File pendiente de subir
        logoRemoved: false, // si el user clickeó "Quitar logo"
        saving: false
    };

    /* ── DOM helpers ──────────────────────────────────────────────── */
    function $(id) { return document.getElementById(id); }
    function setVal(id, v) { var el = $(id); if (el) el.value = (v == null ? '' : v); }
    function getVal(id) { var el = $(id); return el ? (el.value || '') : ''; }
    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function initials(name) {
        var clean = String(name || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
        if (!clean[0]) return '?';
        return (clean[0][0] + (clean[1] ? clean[1][0] : '')).toUpperCase();
    }
    function getCsrf() {
        var el = document.querySelector('[name=csrfmiddlewaretoken]');
        return el ? el.value : '';
    }
    function fmtMoney(n) {
        var v = Number(n || 0);
        return '$' + Math.round(v).toLocaleString('en-US') + ' MXN';
    }
    function parseMoney(s) {
        return parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')) || 0;
    }
    function toast(msg, kind) {
        if (typeof window.toast === 'function') {
            window.toast(msg, kind || 'info');
        }
    }

    /* ── Open / close ─────────────────────────────────────────────── */
    function open(opts) {
        opts = opts || {};
        STATE.mode = opts.mode || 'edit';
        STATE.key = opts.key || null;
        STATE.marca = null;
        STATE.logoFile = null;
        STATE.logoRemoved = false;
        STATE.saving = false;

        var ov = $('meOverlay');
        if (!ov) {
            console.error('[crmMarcaEditor] overlay no encontrado');
            return;
        }
        clearForm();
        showError('');

        if (STATE.mode === 'create') {
            setHeader('Nueva marca', 'Datos, contactos y estrategia');
            var keyEl = $('meKey');
            if (keyEl) { keyEl.removeAttribute('readonly'); keyEl.placeholder = 'HIKVISION'; }
            var help = $('meKeyHelp');
            if (help) help.textContent = 'A-Z, 0-9, _, -. Se autocompleta del nombre.';
            var del = $('meBtnDelete');
            if (del) del.style.display = 'none';
            $('meBtnSaveLbl').textContent = 'Crear marca';
            wireKeyAutoFromName(true);
            setLogoPreview('', '');
            renderActiveTab('marca');
            ov.classList.add('is-open');
            ov.setAttribute('aria-hidden', 'false');
            setTimeout(function () { var n = $('meNombre'); if (n) n.focus(); }, 50);
            return;
        }

        // mode === 'edit': fetch payload
        ov.classList.add('is-open');
        ov.setAttribute('aria-hidden', 'false');
        setHeader('Cargando…', '');
        renderActiveTab('marca');

        fetch('/app/api/marcas/' + encodeURIComponent(STATE.key) + '/edit/', {
            credentials: 'same-origin'
        }).then(function (r) { return r.json(); })
          .then(function (resp) {
              if (!resp || !resp.ok) {
                  showError((resp && resp.error) || 'No se pudo cargar la marca.');
                  setHeader('Error', '');
                  return;
              }
              STATE.marca = resp.marca;
              fillForm(resp.marca);
              setHeader('Editar marca: ' + (resp.marca.nombre || ''),
                        'Datos, contactos y estrategia');
              var keyEl = $('meKey');
              if (keyEl) { keyEl.setAttribute('readonly', 'readonly'); }
              var help = $('meKeyHelp');
              if (help) help.textContent = 'Identificador inmutable.';
              var del = $('meBtnDelete');
              if (del) del.style.display = (resp.can_manage ? '' : 'none');
              $('meBtnSaveLbl').textContent = 'Guardar cambios';
              wireKeyAutoFromName(false);
              setTimeout(function () { var n = $('meNombre'); if (n) n.focus(); }, 50);
          })
          .catch(function (err) {
              showError(err && err.message ? err.message : 'Error de red.');
          });
    }

    function close() {
        var ov = $('meOverlay');
        if (!ov) return;
        ov.classList.remove('is-open');
        ov.setAttribute('aria-hidden', 'true');
    }

    function setHeader(title, sub) {
        var t = $('meTitle'); if (t) t.textContent = title || 'Marca';
        var s = $('meSubtitle'); if (s) s.textContent = sub || '';
    }

    /* ── Form fill/clear ──────────────────────────────────────────── */
    function clearForm() {
        ['meNombre', 'meKey', 'meCategoria', 'meDescripcion', 'meEstrategia',
         'meCtMarcaNombre', 'meCtMarcaEmail', 'meCtMarcaTel',
         'meCtIngNombre', 'meCtIngEmail', 'meCtIngTel',
         'meCtMayNombre', 'meCtMayEmail', 'meCtMayTel'].forEach(function (id) {
            setVal(id, '');
        });
        var m = $('meMetaAnual'); if (m) m.value = '';
        var f = $('meLogoInput'); if (f) f.value = '';
        setLogoPreview('', '');
    }

    function fillForm(marca) {
        setVal('meNombre', marca.nombre);
        setVal('meKey', marca.key);
        setVal('meCategoria', marca.categoria);
        setVal('meDescripcion', marca.descripcion);
        setVal('meEstrategia', marca.estrategia);
        var m = $('meMetaAnual');
        if (m) m.value = marca.meta_anual ? fmtMoney(marca.meta_anual) : '';

        var c = marca.contactos || {};
        var cm = c.marca || {}, ci = c.ingenieria || {}, cy = c.mayorista || {};
        setVal('meCtMarcaNombre', cm.nombre);
        setVal('meCtMarcaEmail', cm.email);
        setVal('meCtMarcaTel', cm.telefono);
        setVal('meCtIngNombre', ci.nombre);
        setVal('meCtIngEmail', ci.email);
        setVal('meCtIngTel', ci.telefono);
        setVal('meCtMayNombre', cy.nombre);
        setVal('meCtMayEmail', cy.email);
        setVal('meCtMayTel', cy.telefono);

        setLogoPreview(marca.logo_url || '', marca.nombre || '');
    }

    function setLogoPreview(url, name) {
        var box = $('meLogoPreview');
        var ini = $('meLogoInitials');
        var rm = $('meBtnLogoRemove');
        if (!box) return;
        if (url) {
            box.innerHTML = '<img src="' + escHtml(url) + '" alt="Logo">';
            if (rm) rm.style.display = '';
        } else {
            box.innerHTML = '<span id="meLogoInitials">' + escHtml(initials(name)) + '</span>';
            if (rm) rm.style.display = 'none';
        }
    }

    function showError(msg) {
        var el = $('meError');
        if (!el) return;
        if (msg) { el.textContent = msg; el.classList.add('is-on'); }
        else { el.textContent = ''; el.classList.remove('is-on'); }
    }

    /* ── Key auto-derive from nombre (create mode) ────────────────── */
    var _keyAutoWire = false;
    var _keyTouched = false;
    function wireKeyAutoFromName(enable) {
        var n = $('meNombre');
        var k = $('meKey');
        if (!n || !k) return;
        _keyTouched = !enable;  // edit mode no auto
        if (_keyAutoWire) return;
        _keyAutoWire = true;
        k.addEventListener('input', function () { _keyTouched = true; });
        n.addEventListener('input', function (e) {
            if (!enable || _keyTouched) return;
            var v = String(e.target.value || '').toUpperCase()
                .replace(/[ÁÄÂÀ]/g, 'A').replace(/[ÉËÊÈ]/g, 'E')
                .replace(/[ÍÏÎÌ]/g, 'I').replace(/[ÓÖÔÒ]/g, 'O')
                .replace(/[ÚÜÛÙ]/g, 'U').replace(/Ñ/g, 'N')
                .replace(/\s+/g, '_').replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
            k.value = v;
        });
    }

    /* ── Tabs de contactos ────────────────────────────────────────── */
    function renderActiveTab(tabKey) {
        document.querySelectorAll('#meCard .me-tab').forEach(function (b) {
            b.classList.toggle('is-on', b.getAttribute('data-me-tab') === tabKey);
        });
        document.querySelectorAll('#meCard .me-tab-panel').forEach(function (p) {
            p.classList.toggle('is-on', p.getAttribute('data-me-panel') === tabKey);
        });
    }

    /* ── Logo handlers ────────────────────────────────────────────── */
    function onLogoSelected(file) {
        if (!file) return;
        var allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];
        if (allowed.indexOf((file.type || '').toLowerCase()) === -1) {
            showError('Tipo de imagen no permitido. Usa PNG, JPEG, SVG o WEBP.');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showError('La imagen supera 5 MB.');
            return;
        }
        showError('');
        STATE.logoFile = file;
        STATE.logoRemoved = false;
        var reader = new FileReader();
        reader.onload = function (e) {
            setLogoPreview(e.target.result, getVal('meNombre'));
        };
        reader.readAsDataURL(file);
    }

    /* ── Save ─────────────────────────────────────────────────────── */
    function buildPayload() {
        return {
            nombre: getVal('meNombre').trim(),
            key: getVal('meKey').trim().toUpperCase(),
            categoria: getVal('meCategoria').trim(),
            descripcion: getVal('meDescripcion').trim(),
            estrategia: getVal('meEstrategia').trim(),
            meta_anual: parseMoney(getVal('meMetaAnual')),
            contactos: {
                marca: {
                    nombre: getVal('meCtMarcaNombre').trim(),
                    email: getVal('meCtMarcaEmail').trim(),
                    telefono: getVal('meCtMarcaTel').trim()
                },
                ingenieria: {
                    nombre: getVal('meCtIngNombre').trim(),
                    email: getVal('meCtIngEmail').trim(),
                    telefono: getVal('meCtIngTel').trim()
                },
                mayorista: {
                    nombre: getVal('meCtMayNombre').trim(),
                    email: getVal('meCtMayEmail').trim(),
                    telefono: getVal('meCtMayTel').trim()
                }
            }
        };
    }

    function save() {
        if (STATE.saving) return;
        var p = buildPayload();

        if (!p.nombre) {
            showError('El nombre es requerido.');
            $('meNombre').focus();
            return;
        }
        if (STATE.mode === 'create') {
            if (!p.key) {
                showError('La key es requerida.');
                $('meKey').focus();
                return;
            }
            if (!/^[A-Z0-9_-]{1,40}$/.test(p.key)) {
                showError('Key inválida (usa A-Z, 0-9, _, -).');
                $('meKey').focus();
                return;
            }
        }
        showError('');
        setSaving(true);

        var url = (STATE.mode === 'create')
            ? '/app/api/marcas/crear/'
            : '/app/api/marcas/' + encodeURIComponent(STATE.key) + '/actualizar/';

        // Si hay archivo nuevo, multipart; si no, JSON.
        var useMultipart = !!STATE.logoFile;
        var fetchOpts = {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRFToken': getCsrf() }
        };

        if (useMultipart) {
            var fd = new FormData();
            fd.append('nombre', p.nombre);
            if (STATE.mode === 'create') fd.append('key', p.key);
            fd.append('categoria', p.categoria);
            fd.append('descripcion', p.descripcion);
            fd.append('estrategia', p.estrategia);
            fd.append('meta_anual', String(p.meta_anual));
            // Contactos flat
            var cm = p.contactos.marca, ci = p.contactos.ingenieria, cy = p.contactos.mayorista;
            fd.append('contacto_marca_nombre', cm.nombre);
            fd.append('contacto_marca_email', cm.email);
            fd.append('contacto_marca_telefono', cm.telefono);
            fd.append('contacto_ingenieria_nombre', ci.nombre);
            fd.append('contacto_ingenieria_email', ci.email);
            fd.append('contacto_ingenieria_telefono', ci.telefono);
            fd.append('contacto_mayorista_nombre', cy.nombre);
            fd.append('contacto_mayorista_email', cy.email);
            fd.append('contacto_mayorista_telefono', cy.telefono);
            fd.append('logo', STATE.logoFile);
            fetchOpts.body = fd;
            // No Content-Type: el browser lo agrega con boundary.
        } else {
            fetchOpts.headers['Content-Type'] = 'application/json';
            fetchOpts.body = JSON.stringify(p);
        }

        fetch(url, fetchOpts)
            .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
            .then(function (res) {
                setSaving(false);
                if (!res.body || !res.body.ok) {
                    var err = (res.body && res.body.error) || ('HTTP ' + res.status);
                    showError(err);
                    return;
                }
                var marca = res.body.marca;
                toast(STATE.mode === 'create' ? 'Marca creada' : 'Marca actualizada', 'success');
                close();

                // Notificar al data-bus si existe (otros widgets se refrescan)
                try {
                    if (window.crmDataBus && typeof window.crmDataBus.emit === 'function') {
                        window.crmDataBus.emit('marca', STATE.mode === 'create' ? 'created' : 'updated', marca.key);
                    }
                } catch (e) {}

                // Refresca la sección Marcas si está activa
                if (window._crmMarcas && typeof window._crmMarcas.refresh === 'function') {
                    window._crmMarcas.refresh();
                }
                // Refresca también el panel admin si está mostrando marcas
                if (typeof window.loadMarcasAdmin === 'function' &&
                    document.querySelector('.admin-nav-item.active[id="admNav-marcas"]')) {
                    window.loadMarcasAdmin();
                }

                // Si modo create, abre el detalle de la marca recién creada
                if (STATE.mode === 'create' && window._crmMarcas && window._crmMarcas.openDetalle) {
                    setTimeout(function () { window._crmMarcas.openDetalle(marca.key); }, 250);
                }
            })
            .catch(function (err) {
                setSaving(false);
                showError(err && err.message ? err.message : 'Error de red.');
            });
    }

    function setSaving(v) {
        STATE.saving = v;
        var btn = $('meBtnSave');
        var lbl = $('meBtnSaveLbl');
        if (!btn || !lbl) return;
        btn.disabled = v;
        if (v) {
            lbl.innerHTML = '<span class="me-loading"><span class="me-spinner"></span>Guardando…</span>';
        } else {
            lbl.textContent = (STATE.mode === 'create') ? 'Crear marca' : 'Guardar cambios';
        }
    }

    /* ── Delete ──────────────────────────────────────────────────── */
    function onDelete() {
        if (STATE.mode !== 'edit' || !STATE.key) return;
        var label = (STATE.marca && STATE.marca.nombre) || STATE.key;
        if (!window.confirm('¿Eliminar la marca "' + label + '"? Se ocultará del catálogo (se puede reactivar).')) {
            return;
        }
        fetch('/app/api/marcas/' + encodeURIComponent(STATE.key) + '/eliminar/', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRFToken': getCsrf() }
        }).then(function (r) { return r.json(); })
          .then(function (res) {
              if (res && res.ok) {
                  toast('Marca eliminada', 'success');
                  close();
                  if (window._crmMarcas && window._crmMarcas.refresh) window._crmMarcas.refresh();
                  if (typeof window.loadMarcasAdmin === 'function' &&
                      document.querySelector('.admin-nav-item.active[id="admNav-marcas"]')) {
                      window.loadMarcasAdmin();
                  }
              } else {
                  showError((res && res.error) || 'No se pudo eliminar.');
              }
          })
          .catch(function (err) { showError(err && err.message ? err.message : 'Error de red.'); });
    }

    /* ── Wiring ──────────────────────────────────────────────────── */
    function init() {
        var ov = $('meOverlay');
        if (!ov) return;

        // Click fuera del card → cerrar
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

        // Botones
        var bc = $('meBtnClose'); if (bc) bc.addEventListener('click', close);
        var ca = $('meBtnCancel'); if (ca) ca.addEventListener('click', close);
        var sv = $('meBtnSave'); if (sv) sv.addEventListener('click', save);
        var dl = $('meBtnDelete'); if (dl) dl.addEventListener('click', onDelete);

        // Tabs
        document.querySelectorAll('#meCard .me-tab').forEach(function (b) {
            b.addEventListener('click', function () { renderActiveTab(b.getAttribute('data-me-tab')); });
        });

        // Logo
        var up = $('meBtnLogoUpload'); var fi = $('meLogoInput');
        if (up && fi) {
            up.addEventListener('click', function () { fi.click(); });
            fi.addEventListener('change', function (e) {
                onLogoSelected(e.target.files && e.target.files[0]);
            });
        }
        var rm = $('meBtnLogoRemove');
        if (rm) rm.addEventListener('click', function () {
            STATE.logoFile = null;
            STATE.logoRemoved = true;
            if (fi) fi.value = '';
            setLogoPreview('', getVal('meNombre'));
        });

        // Meta anual: formato money en blur (como admin)
        var mm = $('meMetaAnual');
        if (mm) {
            mm.addEventListener('focus', function () {
                var n = parseMoney(this.value);
                this.value = n ? String(n) : '';
            });
            mm.addEventListener('blur', function () {
                var n = parseMoney(this.value);
                this.value = n ? fmtMoney(n) : '';
            });
        }

        // ESC para cerrar
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && ov.classList.contains('is-open')) close();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window._crmMarcaEditor = {
        open: open,
        close: close,
        save: save
    };
})();
