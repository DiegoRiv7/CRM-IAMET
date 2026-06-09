/*
  crm_proveedor_editar_v2.js — Lógica del widget de edición/creación de
  proveedor. Espejo de crm_marca_editar_v2.js.

  Expone window._crmProveedorEditor con:
      .open({ mode: 'edit'|'create', key?: string })
      .close()
      .save()

  Endpoints:
      GET  /app/api/proveedores/<key>/edit/        — payload (modo edit)
      POST /app/api/proveedores/crear/             — alta (multipart o JSON)
      POST /app/api/proveedores/<key>/actualizar/  — update (multipart o JSON)
      POST /app/api/proveedores/<key>/eliminar/    — soft delete

  Soporta subida de logo con preview (FileReader) y POST como multipart
  cuando hay archivo nuevo. Si no hay archivo, envía JSON.

  Cambios vs Marca editor:
    - Tabs de contactos: principal / ventas / soporte (en vez de
      marca / ingenieria / mayorista).
    - IDs prefijados pe* (peNombre, peKey, peCt*, etc.).
*/
(function () {
    'use strict';

    var STATE = {
        mode: 'edit',
        key: null,
        proveedor: null,
        logoFile: null,
        logoRemoved: false,
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
        STATE.proveedor = null;
        STATE.logoFile = null;
        STATE.logoRemoved = false;
        STATE.saving = false;

        var ov = $('peOverlay');
        if (!ov) {
            console.error('[crmProveedorEditor] overlay no encontrado');
            return;
        }
        clearForm();
        showError('');

        if (STATE.mode === 'create') {
            setHeader('Nuevo proveedor', 'Datos, contactos y estrategia');
            var keyEl = $('peKey');
            if (keyEl) { keyEl.removeAttribute('readonly'); keyEl.placeholder = 'PROVEEDOR_X'; }
            var help = $('peKeyHelp');
            if (help) help.textContent = 'A-Z, 0-9, _, -. Se autocompleta del nombre.';
            var del = $('peBtnDelete');
            if (del) del.style.display = 'none';
            $('peBtnSaveLbl').textContent = 'Crear proveedor';
            wireKeyAutoFromName(true);
            setLogoPreview('', '');
            renderActiveTab('principal');
            ov.classList.add('is-open');
            ov.setAttribute('aria-hidden', 'false');
            if (document.body) document.body.classList.add('proveedor-modal-open');
            setTimeout(function () { var n = $('peNombre'); if (n) n.focus(); }, 50);
            return;
        }

        // mode === 'edit': fetch payload
        ov.classList.add('is-open');
        ov.setAttribute('aria-hidden', 'false');
        if (document.body) document.body.classList.add('proveedor-modal-open');
        setHeader('Cargando…', '');
        renderActiveTab('principal');

        fetch('/app/api/proveedores/' + encodeURIComponent(STATE.key) + '/edit/', {
            credentials: 'same-origin'
        }).then(function (r) { return r.json(); })
          .then(function (resp) {
              if (!resp || !resp.ok) {
                  showError((resp && resp.error) || 'No se pudo cargar el proveedor.');
                  setHeader('Error', '');
                  return;
              }
              STATE.proveedor = resp.proveedor;
              fillForm(resp.proveedor);
              setHeader('Editar proveedor: ' + (resp.proveedor.nombre || ''),
                        'Datos, contactos y estrategia');
              var keyEl = $('peKey');
              if (keyEl) { keyEl.setAttribute('readonly', 'readonly'); }
              var help = $('peKeyHelp');
              if (help) help.textContent = 'Identificador inmutable.';
              var del = $('peBtnDelete');
              if (del) del.style.display = (resp.can_manage ? '' : 'none');
              $('peBtnSaveLbl').textContent = 'Guardar cambios';
              wireKeyAutoFromName(false);
              setTimeout(function () { var n = $('peNombre'); if (n) n.focus(); }, 50);
          })
          .catch(function (err) {
              showError(err && err.message ? err.message : 'Error de red.');
          });
    }

    function close() {
        var ov = $('peOverlay');
        if (!ov) return;
        ov.classList.remove('is-open');
        ov.setAttribute('aria-hidden', 'true');
        // Solo quitar el lock si tampoco está abierto el detalle.
        var det = document.getElementById('proveedorWidgetOverlay');
        var detOpen = det && det.classList.contains('is-open');
        if (!detOpen && document.body) document.body.classList.remove('proveedor-modal-open');
    }

    function setHeader(title, sub) {
        var t = $('peTitle'); if (t) t.textContent = title || 'Proveedor';
        var s = $('peSubtitle'); if (s) s.textContent = sub || '';
    }

    /* ── Form fill/clear ──────────────────────────────────────────── */
    function clearForm() {
        ['peNombre', 'peKey', 'peCategoria', 'peDescripcion', 'peEstrategia',
         'peCtPrincNombre', 'peCtPrincEmail', 'peCtPrincTel',
         'peCtVtaNombre', 'peCtVtaEmail', 'peCtVtaTel',
         'peCtSopNombre', 'peCtSopEmail', 'peCtSopTel'].forEach(function (id) {
            setVal(id, '');
        });
        var m = $('peMetaAnual'); if (m) m.value = '';
        var f = $('peLogoInput'); if (f) f.value = '';
        setLogoPreview('', '');
    }

    function fillForm(proveedor) {
        setVal('peNombre', proveedor.nombre);
        setVal('peKey', proveedor.key);
        setVal('peCategoria', proveedor.categoria);
        setVal('peDescripcion', proveedor.descripcion);
        setVal('peEstrategia', proveedor.estrategia);
        var m = $('peMetaAnual');
        if (m) m.value = proveedor.meta_anual ? fmtMoney(proveedor.meta_anual) : '';

        var c = proveedor.contactos || {};
        var cp = c.principal || {}, cv = c.ventas || {}, cs = c.soporte || {};
        setVal('peCtPrincNombre', cp.nombre);
        setVal('peCtPrincEmail', cp.email);
        setVal('peCtPrincTel', cp.telefono);
        setVal('peCtVtaNombre', cv.nombre);
        setVal('peCtVtaEmail', cv.email);
        setVal('peCtVtaTel', cv.telefono);
        setVal('peCtSopNombre', cs.nombre);
        setVal('peCtSopEmail', cs.email);
        setVal('peCtSopTel', cs.telefono);

        setLogoPreview(proveedor.logo_url || '', proveedor.nombre || '');
    }

    function setLogoPreview(url, name) {
        var box = $('peLogoPreview');
        var rm = $('peBtnLogoRemove');
        var dz = $('peDropzone');
        if (!box) return;
        if (url) {
            box.innerHTML = '<img src="' + escHtml(url) + '" alt="Logo">';
            if (rm) rm.style.display = '';
            if (dz) dz.classList.add('has-img');
        } else {
            box.innerHTML = '<span id="peLogoInitials">' + escHtml(initials(name) || '?') + '</span>';
            if (rm) rm.style.display = 'none';
            if (dz) dz.classList.remove('has-img');
        }
    }

    function showError(msg) {
        var el = $('peError');
        if (!el) return;
        if (msg) { el.textContent = msg; el.classList.add('is-on'); }
        else { el.textContent = ''; el.classList.remove('is-on'); }
    }

    /* ── Key auto-derive from nombre (create mode) ────────────────── */
    var _keyAutoWire = false;
    var _keyTouched = false;
    function wireKeyAutoFromName(enable) {
        var n = $('peNombre');
        var k = $('peKey');
        if (!n || !k) return;
        _keyTouched = !enable;
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
        document.querySelectorAll('#peCard .pe-tab').forEach(function (b) {
            b.classList.toggle('is-on', b.getAttribute('data-pe-tab') === tabKey);
        });
        document.querySelectorAll('#peCard .pe-tab-panel').forEach(function (p) {
            p.classList.toggle('is-on', p.getAttribute('data-pe-panel') === tabKey);
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
            setLogoPreview(e.target.result, getVal('peNombre'));
        };
        reader.readAsDataURL(file);
    }

    /* ── Save ─────────────────────────────────────────────────────── */
    function buildPayload() {
        return {
            nombre: getVal('peNombre').trim(),
            key: getVal('peKey').trim().toUpperCase(),
            categoria: getVal('peCategoria').trim(),
            descripcion: getVal('peDescripcion').trim(),
            estrategia: getVal('peEstrategia').trim(),
            meta_anual: parseMoney(getVal('peMetaAnual')),
            contactos: {
                principal: {
                    nombre: getVal('peCtPrincNombre').trim(),
                    email: getVal('peCtPrincEmail').trim(),
                    telefono: getVal('peCtPrincTel').trim()
                },
                ventas: {
                    nombre: getVal('peCtVtaNombre').trim(),
                    email: getVal('peCtVtaEmail').trim(),
                    telefono: getVal('peCtVtaTel').trim()
                },
                soporte: {
                    nombre: getVal('peCtSopNombre').trim(),
                    email: getVal('peCtSopEmail').trim(),
                    telefono: getVal('peCtSopTel').trim()
                }
            }
        };
    }

    function save() {
        if (STATE.saving) return;
        var p = buildPayload();

        if (!p.nombre) {
            showError('El nombre es requerido.');
            $('peNombre').focus();
            return;
        }
        showError('');
        setSaving(true);

        var url = (STATE.mode === 'create')
            ? '/app/api/proveedores/crear/'
            : '/app/api/proveedores/' + encodeURIComponent(STATE.key) + '/actualizar/';

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
            var cp = p.contactos.principal, cv = p.contactos.ventas, cs = p.contactos.soporte;
            fd.append('contacto_principal_nombre', cp.nombre);
            fd.append('contacto_principal_email', cp.email);
            fd.append('contacto_principal_telefono', cp.telefono);
            fd.append('contacto_ventas_nombre', cv.nombre);
            fd.append('contacto_ventas_email', cv.email);
            fd.append('contacto_ventas_telefono', cv.telefono);
            fd.append('contacto_soporte_nombre', cs.nombre);
            fd.append('contacto_soporte_email', cs.email);
            fd.append('contacto_soporte_telefono', cs.telefono);
            fd.append('logo', STATE.logoFile);
            fetchOpts.body = fd;
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
                var proveedor = res.body.proveedor;
                toast(STATE.mode === 'create' ? 'Proveedor creado' : 'Proveedor actualizado', 'success');
                close();

                try {
                    if (window.crmDataBus && typeof window.crmDataBus.emit === 'function') {
                        window.crmDataBus.emit('proveedor', STATE.mode === 'create' ? 'created' : 'updated', proveedor.key);
                    }
                } catch (e) {}

                if (window._crmProveedores && typeof window._crmProveedores.refresh === 'function') {
                    window._crmProveedores.refresh();
                }
                if (typeof window.loadProveedoresAdmin === 'function' &&
                    document.querySelector('.admin-nav-item.active[id="admNav-proveedores"]')) {
                    window.loadProveedoresAdmin();
                }

                if (STATE.mode === 'create' && window._crmProveedores && window._crmProveedores.openDetalle) {
                    setTimeout(function () { window._crmProveedores.openDetalle(proveedor.key); }, 250);
                }
            })
            .catch(function (err) {
                setSaving(false);
                showError(err && err.message ? err.message : 'Error de red.');
            });
    }

    function setSaving(v) {
        STATE.saving = v;
        var btn = $('peBtnSave');
        var lbl = $('peBtnSaveLbl');
        if (!btn || !lbl) return;
        btn.disabled = v;
        if (v) {
            lbl.innerHTML = '<span class="pe-loading"><span class="pe-spinner"></span>Guardando…</span>';
        } else {
            lbl.textContent = (STATE.mode === 'create') ? 'Crear proveedor' : 'Guardar cambios';
        }
    }

    /* ── Delete ──────────────────────────────────────────────────── */
    function onDelete() {
        if (STATE.mode !== 'edit' || !STATE.key) return;
        var label = (STATE.proveedor && STATE.proveedor.nombre) || STATE.key;
        if (!window.confirm('¿Eliminar el proveedor "' + label + '"? Se ocultará del catálogo (se puede reactivar).')) {
            return;
        }
        fetch('/app/api/proveedores/' + encodeURIComponent(STATE.key) + '/eliminar/', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRFToken': getCsrf() }
        }).then(function (r) { return r.json(); })
          .then(function (res) {
              if (res && res.ok) {
                  toast('Proveedor eliminado', 'success');
                  close();
                  if (window._crmProveedores && window._crmProveedores.refresh) window._crmProveedores.refresh();
                  if (typeof window.loadProveedoresAdmin === 'function' &&
                      document.querySelector('.admin-nav-item.active[id="admNav-proveedores"]')) {
                      window.loadProveedoresAdmin();
                  }
              } else {
                  showError((res && res.error) || 'No se pudo eliminar.');
              }
          })
          .catch(function (err) { showError(err && err.message ? err.message : 'Error de red.'); });
    }

    /* ── Wiring ──────────────────────────────────────────────────── */
    function init() {
        var ov = $('peOverlay');
        if (!ov) return;

        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

        var bc = $('peBtnClose'); if (bc) bc.addEventListener('click', close);
        var ca = $('peBtnCancel'); if (ca) ca.addEventListener('click', close);
        var sv = $('peBtnSave'); if (sv) sv.addEventListener('click', save);
        var dl = $('peBtnDelete'); if (dl) dl.addEventListener('click', onDelete);

        document.querySelectorAll('#peCard .pe-tab').forEach(function (b) {
            b.addEventListener('click', function () { renderActiveTab(b.getAttribute('data-pe-tab')); });
        });

        var dz = $('peDropzone'); var fi = $('peLogoInput');
        if (dz && fi) {
            dz.addEventListener('click', function () { fi.click(); });
            dz.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); }
            });
            ['dragenter', 'dragover'].forEach(function (ev) {
                dz.addEventListener(ev, function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    dz.classList.add('is-dragover');
                });
            });
            ['dragleave', 'drop'].forEach(function (ev) {
                dz.addEventListener(ev, function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    dz.classList.remove('is-dragover');
                });
            });
            dz.addEventListener('drop', function (e) {
                var dt = e.dataTransfer;
                if (!dt || !dt.files || !dt.files.length) return;
                onLogoSelected(dt.files[0]);
            });
            fi.addEventListener('change', function (e) {
                onLogoSelected(e.target.files && e.target.files[0]);
            });
        }
        var rm = $('peBtnLogoRemove');
        if (rm) rm.addEventListener('click', function (e) {
            e.stopPropagation();
            STATE.logoFile = null;
            STATE.logoRemoved = true;
            if (fi) fi.value = '';
            setLogoPreview('', getVal('peNombre'));
        });

        var mm = $('peMetaAnual');
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

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && ov.classList.contains('is-open')) close();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window._crmProveedorEditor = {
        open: open,
        close: close,
        save: save
    };
})();
