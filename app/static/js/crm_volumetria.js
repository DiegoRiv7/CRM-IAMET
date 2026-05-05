/**
 * crm_volumetria.js — Editor de Volumetría v3
 *
 * Rediseño "Linear/Notion" de la Fase 3 del wizard de levantamiento:
 *   - Document header al estilo Notion (titulo grande + 4 metadatos inline).
 *   - Un solo grid de datos (estilo Linear/Stripe), con secciones colapsables,
 *     edición inline, hover-only delete, P. Unit y Total calculados.
 *   - Summary card al final (no sidebar sticky).
 *
 * Schema v3 — JSON guardado en `volumetria.data`:
 *   {
 *     version: 3,
 *     meta:    { cliente, contacto, elaboro, fecha },
 *     secciones: [{
 *       id, titulo, expanded,
 *       items: [{
 *         id, cantidad, marca, parte, descripcion, notas,
 *         precioLista, descuentoVenta, costoUnitario, proveedor, entrega
 *       }]
 *     }]
 *   }
 *
 * Cálculos:
 *   precioVentaUnitario = precioLista * (1 - descuentoVenta/100)
 *   totalVenta_item     = precioVentaUnitario * cantidad
 *   costoTotal_item     = costoUnitario * cantidad
 *   subtotalVenta = Σ totalVenta_item
 *   costoTotal    = Σ costoTotal_item
 *   ganancia      = subtotalVenta - costoTotal
 *   margen %      = subtotalVenta > 0 ? ganancia / subtotalVenta * 100 : 0
 *   iva (si iva_pct > 0) = subtotalVenta * iva_pct/100
 *   totalConIva   = subtotalVenta + iva
 *
 * Endpoints (sin cambios):
 *   POST /app/api/iamet/volumetrias/{id}/data/        ← autosave del JSON v3
 *   POST /app/api/iamet/volumetrias/{id}/actualizar/  ← iva_pct, tipo_cambio
 *
 * API pública (preservada): window.crmVolumetria.{render, getData,
 *   getVolumetria, flushSave, destroy}.
 *
 * ── Inventario de clases CSS (paridad estricta con crm_volumetria.css) ──
 *
 * Root / shell:
 *   .cv-root, .cv-readonly
 *
 * Document header (Notion-style):
 *   .cv-doc, .cv-doc-title, .cv-doc-title-input,
 *   .cv-doc-meta, .cv-meta-field, .cv-meta-icon, .cv-meta-label,
 *   .cv-meta-input
 *
 * Grid de datos:
 *   .cv-grid, .cv-grid-head, .cv-grid-head-cell,
 *   .cv-section, .cv-section-row, .cv-section-toggle, .cv-chevron,
 *   .cv-section-title-input, .cv-section-actions,
 *   .cv-row, .cv-row-cell,
 *   .cv-cell-act, .cv-cell-num, .cv-cell-text, .cv-cell-desc,
 *   .cv-cell-calc, .cv-cell-total, .cv-cell-mono,
 *   .cv-input, .cv-input-num, .cv-input-text, .cv-input-desc,
 *   .cv-notas, .cv-notas-input, .cv-has-notas,
 *   .cv-row-del, .cv-add-row, .cv-add-section
 *
 * Summary card:
 *   .cv-summary, .cv-summary-title, .cv-summary-row,
 *   .cv-summary-label, .cv-summary-value,
 *   .cv-row-cost, .cv-row-gain, .cv-row-margin, .cv-row-margin-low,
 *   .cv-row-iva, .cv-row-total, .cv-summary-sep
 *
 * Misc:
 *   .cv-mono, .cv-empty
 */
(function () {
    'use strict';

    // ── Estado ──────────────────────────────────────────────────────
    var S = {
        container: null,
        volumetria: null,
        levantamiento: null,
        readonly: false,
        onSaved: null,

        data: null,             // objeto v3 vivo

        saveTimer: null,
        saveInFlight: false,
        savePending: false,

        metaTimer: null,
        metaPending: {},
    };

    // ── Helpers ─────────────────────────────────────────────────────
    function log() {
        try {
            var args = ['[volumetria]'].concat(Array.prototype.slice.call(arguments));
            console.log.apply(console, args);
        } catch (_) {}
    }

    function esc(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function uuid() {
        try {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        } catch (_) {}
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function num(v) {
        var n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    }

    // Format en MXN siempre — el React de referencia formatea en MXN
    // aunque la data esté en USD; los números crudos los respetamos, esto
    // es solo presentacional.
    var _moneyFmt = null;
    function fmtMoney(n) {
        if (!_moneyFmt) {
            try {
                _moneyFmt = new Intl.NumberFormat('es-MX', {
                    style: 'currency', currency: 'MXN',
                    minimumFractionDigits: 2, maximumFractionDigits: 2,
                });
            } catch (_) {
                _moneyFmt = { format: function (v) { return '$' + num(v).toFixed(2); } };
            }
        }
        return _moneyFmt.format(num(n));
    }

    function fmtPct(n) {
        return num(n).toLocaleString('es-MX', {
            minimumFractionDigits: 1, maximumFractionDigits: 1,
        }) + '%';
    }

    function getCsrf() {
        var el = document.querySelector('[name=csrfmiddlewaretoken]');
        if (el) return el.value;
        var m = document.cookie.match(/(^|;\s*)csrftoken=([^;]+)/);
        return m ? m[2] : '';
    }

    function apiPost(url, body) {
        return fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'X-CSRFToken': getCsrf(),
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body || {}),
        }).then(function (r) { return r.json(); });
    }

    // ── Migración / normalización a v3 ──────────────────────────────
    function emptyItem(extra) {
        var it = {
            id: uuid(),
            cantidad: 0,
            marca: '',
            parte: '',
            descripcion: '',
            notas: '',
            precioLista: 0,
            descuentoVenta: 0,
            costoUnitario: 0,
            proveedor: '',
            entrega: '',
        };
        if (extra) Object.keys(extra).forEach(function (k) { it[k] = extra[k]; });
        return it;
    }

    function emptySection(titulo) {
        return {
            id: uuid(),
            titulo: titulo || 'NUEVA SECCIÓN',
            expanded: true,
            items: [],
        };
    }

    function defaultData(lev) {
        var meta = { cliente: '', contacto: '', elaboro: '', fecha: '' };
        if (lev && lev.fase1_data) {
            var d = lev.fase1_data;
            if (d.cliente)  meta.cliente  = d.cliente;
            if (d.contacto) meta.contacto = d.contacto;
            if (d.fecha)    meta.fecha    = d.fecha;
        }
        return {
            version: 3,
            meta: meta,
            secciones: [emptySection('EQUIPAMIENTO')],
        };
    }

    // Asegura shape v3 mínimo (rellena meta y secciones faltantes).
    function ensureV3(data) {
        data = data || {};
        data.version = 3;
        data.meta = data.meta || {};
        ['cliente', 'contacto', 'elaboro', 'fecha'].forEach(function (k) {
            if (data.meta[k] == null) data.meta[k] = '';
        });
        if (!Array.isArray(data.secciones)) data.secciones = [];
        data.secciones = data.secciones.map(function (sec) {
            sec = sec || {};
            if (!sec.id) sec.id = uuid();
            if (typeof sec.titulo !== 'string') sec.titulo = 'SECCIÓN';
            if (typeof sec.expanded !== 'boolean') sec.expanded = true;
            if (!Array.isArray(sec.items)) sec.items = [];
            sec.items = sec.items.map(function (it) {
                it = it || {};
                if (!it.id) it.id = uuid();
                ['marca', 'parte', 'descripcion', 'notas', 'proveedor', 'entrega'].forEach(function (k) {
                    if (typeof it[k] !== 'string') it[k] = it[k] == null ? '' : String(it[k]);
                });
                ['cantidad', 'precioLista', 'descuentoVenta', 'costoUnitario'].forEach(function (k) {
                    it[k] = num(it[k]);
                });
                return it;
            });
            return sec;
        });
        return data;
    }

    // Convierte items v2 (sub-sección equipamiento) a items v3.
    function mapEqV2Item(it) {
        it = it || {};
        return emptyItem({
            cantidad:       num(it.cant),
            marca:          it.marca || '',
            parte:          it.no_parte || '',
            descripcion:    it.descripcion || '',
            notas:          it.notas || '',
            precioLista:    num(it.p_lista),
            descuentoVenta: num(it.desc_v_pct),
            costoUnitario:  num(it.c_unit),
            proveedor:      it.proveedor || '',
            entrega:        it.entrega || '',
        });
    }

    // v2.equipamiento.secciones → array de secciones v3.
    // Cada subsección v2 → sección v3. Si dentro de los items de una
    // subsección aparece row_type='header', ese header arranca otra
    // sección v3 (los items posteriores se agrupan en ella).
    function migrateEquipamiento(eq) {
        var out = [];
        if (!eq || !Array.isArray(eq.secciones)) return out;
        eq.secciones.forEach(function (sub) {
            var current = emptySection(sub && sub.nombre ? sub.nombre : 'EQUIPAMIENTO');
            out.push(current);
            var items = (sub && Array.isArray(sub.items)) ? sub.items : [];
            items.forEach(function (it) {
                if (it && it.row_type === 'header') {
                    current = emptySection(it.texto || it.descripcion || 'SECCIÓN');
                    out.push(current);
                    return;
                }
                current.items.push(mapEqV2Item(it));
            });
        });
        return out;
    }

    function migrateManoObra(mo) {
        if (!mo || !Array.isArray(mo.items) || !mo.items.length) return null;
        var sec = emptySection('MANO DE OBRA');
        mo.items.forEach(function (it) {
            sec.items.push(emptyItem({
                cantidad:    num(it.cant),
                marca:       it.marca || '',
                parte:       it.no_parte || '',
                descripcion: it.descripcion || '',
                notas:       it.notas || '',
                precioLista: num(it.p_unit),
            }));
        });
        return sec;
    }

    function migrateCostoMo(cmo) {
        // v3 simplifica: pierde `dias` y `concentrado` (aceptado).
        if (!cmo || !Array.isArray(cmo.items) || !cmo.items.length) return null;
        var sec = emptySection('COSTO MO INTERNO');
        cmo.items.forEach(function (it) {
            sec.items.push(emptyItem({
                descripcion:   it.recurso || it.descripcion || '',
                cantidad:      num(it.cant),
                costoUnitario: num(it.costo_unit),
            }));
        });
        return sec;
    }

    function migrateGastos(g) {
        if (!g || !Array.isArray(g.items) || !g.items.length) return null;
        var sec = emptySection('GASTOS');
        g.items.forEach(function (it) {
            sec.items.push(emptyItem({
                cantidad:      num(it.cant),
                descripcion:   it.descripcion || '',
                parte:         it.unidad || '',  // unidad → "parte" (col más cercana visualmente)
                costoUnitario: num(it.costo_unit),
            }));
        });
        return sec;
    }

    // v1 legacy: { materiales: [...], manoObra: [...], gastos: [...] }
    function migrateV1(raw) {
        var secs = [];
        if (Array.isArray(raw.materiales) && raw.materiales.length) {
            var s1 = emptySection('MATERIALES');
            raw.materiales.forEach(function (r) {
                s1.items.push(emptyItem({
                    cantidad:      num(r.qty),
                    marca:         r.marca || '',
                    parte:         r.modelo || '',
                    descripcion:   r.desc || '',
                    precioLista:   num(r.precio),
                    descuentoVenta:num(r.desc_pct),
                    costoUnitario: num(r.costo),
                    proveedor:     r.proveedor || '',
                }));
            });
            secs.push(s1);
        }
        if (Array.isArray(raw.manoObra) && raw.manoObra.length) {
            var s2 = emptySection('MANO DE OBRA');
            raw.manoObra.forEach(function (r) {
                s2.items.push(emptyItem({
                    cantidad:    num(r.qty),
                    descripcion: r.desc || '',
                    precioLista: num(r.precio),
                }));
            });
            secs.push(s2);
        }
        if (Array.isArray(raw.gastos) && raw.gastos.length) {
            var s3 = emptySection('GASTOS');
            raw.gastos.forEach(function (r) {
                s3.items.push(emptyItem({
                    cantidad:      num(r.qty),
                    descripcion:   r.desc || '',
                    costoUnitario: num(r.costo),
                }));
            });
            secs.push(s3);
        }
        return secs;
    }

    function normalizeData(raw, lev) {
        raw = raw || {};

        // Ya es v3 con secciones → solo asegurar shape.
        if (raw.version === 3 || (raw.meta && Array.isArray(raw.secciones))) {
            return ensureV3(raw);
        }

        // ¿Es v2? (tiene equipamiento/mano_obra/costo_mo/gastos en su raíz)
        var isV2 = raw.version === 2 ||
                   raw.equipamiento || raw.mano_obra || raw.costo_mo ||
                   (raw.gastos && raw.gastos.items);

        var secciones = [];
        if (isV2) {
            secciones = secciones.concat(migrateEquipamiento(raw.equipamiento));
            var mo = migrateManoObra(raw.mano_obra);   if (mo)  secciones.push(mo);
            var cm = migrateCostoMo(raw.costo_mo);     if (cm)  secciones.push(cm);
            var ga = migrateGastos(raw.gastos);        if (ga)  secciones.push(ga);
        } else if (raw.materiales || raw.manoObra || raw.gastos) {
            // v1 legacy
            secciones = migrateV1(raw);
        }

        // Fallback: estructura totalmente vacía → sección default.
        if (!secciones.length) {
            return defaultData(lev);
        }

        // Meta: heredar de v2 si existía, si no del lev.
        var meta = (raw.meta && typeof raw.meta === 'object') ? raw.meta : {};
        var defaults = defaultData(lev).meta;
        ['cliente', 'contacto', 'elaboro', 'fecha'].forEach(function (k) {
            if (!meta[k]) meta[k] = defaults[k];
        });

        return ensureV3({ version: 3, meta: meta, secciones: secciones });
    }

    // ── Cálculos ────────────────────────────────────────────────────
    function calcItem(it) {
        var pu = num(it.precioLista) * (1 - num(it.descuentoVenta) / 100);
        var totalVenta = pu * num(it.cantidad);
        var totalCosto = num(it.costoUnitario) * num(it.cantidad);
        return { precioVentaUnitario: pu, totalVenta: totalVenta, totalCosto: totalCosto };
    }

    function calcTotals() {
        var subtotalVenta = 0;
        var costoTotal = 0;
        (S.data.secciones || []).forEach(function (sec) {
            (sec.items || []).forEach(function (it) {
                var c = calcItem(it);
                subtotalVenta += c.totalVenta;
                costoTotal += c.totalCosto;
            });
        });
        var ganancia = subtotalVenta - costoTotal;
        var margen = subtotalVenta > 0 ? (ganancia / subtotalVenta) * 100 : 0;
        var iva_pct = num(S.volumetria && S.volumetria.iva_pct);
        var iva = iva_pct > 0 ? subtotalVenta * (iva_pct / 100) : 0;
        var totalConIva = subtotalVenta + iva;
        return {
            subtotalVenta: subtotalVenta,
            costoTotal: costoTotal,
            ganancia: ganancia,
            margen: margen,
            iva_pct: iva_pct,
            iva: iva,
            totalConIva: totalConIva,
        };
    }

    // ── SVG icons (lucide-style, inline) ────────────────────────────
    var ICON = {
        chevronDown: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
        chevronRight: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>',
        trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>',
        plus: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
        user: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
        contact: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92V21a1 1 0 0 1-1.11 1A19 19 0 0 1 2 4.11 1 1 0 0 1 3 3h4.09a1 1 0 0 1 1 .75l1 4a1 1 0 0 1-.27 1L7 10.5a16 16 0 0 0 6.5 6.5l1.75-1.82a1 1 0 0 1 1-.27l4 1a1 1 0 0 1 .75 1z"></path></svg>',
        calendar: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>',
        coins: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"></circle><path d="M18.09 10.37A6 6 0 1 1 10.34 18"></path><path d="M7 6h1v4"></path><path d="M16.71 13.88l.7.71-2.82 2.82"></path></svg>',
    };

    // ── Render ──────────────────────────────────────────────────────
    function render() {
        if (!S.container) return;

        var html = '<div class="cv-root' + (S.readonly ? ' cv-readonly' : '') + '">';
        html += renderDocHeader();
        html += renderGrid();
        html += renderSummary();
        html += '</div>';
        S.container.innerHTML = html;

        bindAll();
    }

    function renderDocHeader() {
        var meta = S.data.meta || {};
        var nombre = (S.volumetria && S.volumetria.nombre) || '';
        var disabled = S.readonly ? 'disabled' : '';

        var tcVal = S.volumetria && S.volumetria.tipo_cambio != null ? S.volumetria.tipo_cambio : '';
        var ivaVal = S.volumetria && S.volumetria.iva_pct != null ? S.volumetria.iva_pct : '';

        // Pill de estado: muestra Borrador/Completada y al click toggea
        // (la lógica vive en el wizard: window.lwP3ToggleStatus). Usa
        // el ID de la volumetría como guard (en standalone no hay wizard).
        var status = (S.volumetria && S.volumetria.status) || 'borrador';
        var statusLabel = status === 'completada' ? 'Completada' : 'Borrador';
        var statusCls = 'cv-status cv-status-' + status;
        var statusBtn = '';
        if (!S.readonly) {
            statusBtn =
                '<button type="button" class="' + statusCls + '" data-action="toggle-status">' +
                    '<span class="cv-status-dot"></span>' +
                    '<span class="cv-status-label">' + esc(statusLabel) + '</span>' +
                '</button>';
        } else {
            statusBtn =
                '<span class="' + statusCls + '">' +
                    '<span class="cv-status-dot"></span>' +
                    '<span class="cv-status-label">' + esc(statusLabel) + '</span>' +
                '</span>';
        }

        var h = '<div class="cv-doc">';
        h += '<div class="cv-doc-titlebar">';
        h += '<input type="text" class="cv-doc-title-input" data-meta="nombre" ' +
             'placeholder="Sin título" value="' + esc(nombre) + '" ' + disabled + ' />';
        h += statusBtn;
        h += '</div>';

        h += '<div class="cv-doc-meta">';
        h += metaField('cliente',  ICON.user,     'Cliente',        meta.cliente,  'ALLEGION ENSENADA');
        h += metaField('contacto', ICON.contact,  'Contacto',       meta.contacto, 'Ing. Ricardo Sandoval');
        h += metaField('fecha',    ICON.calendar, 'Fecha',          meta.fecha,    '',  'date');
        // El tipo de cambio y el IVA viven en columnas del modelo, no en data.meta.
        h += metaField('tc',       ICON.coins,    'Tipo de cambio', tcVal,         '19.50', 'number');
        h += metaField('iva',      ICON.coins,    'IVA %',          ivaVal,        '16',    'number');
        h += '</div>';

        h += '</div>';
        return h;
    }

    function metaField(key, icon, label, value, placeholder, type) {
        var disabled = S.readonly ? 'disabled' : '';
        var t = type || 'text';
        var val = value == null ? '' : value;
        return '<label class="cv-meta-field">' +
               '<span class="cv-meta-icon">' + icon + '</span>' +
               '<span class="cv-meta-label">' + esc(label) + '</span>' +
               '<input type="' + t + '" class="cv-meta-input" data-meta="' + key + '" ' +
                  'placeholder="' + esc(placeholder) + '" value="' + esc(val) + '" ' + disabled + ' />' +
               '</label>';
    }

    function renderGrid() {
        var h = '<div class="cv-grid">';
        h += renderGridHead();
        (S.data.secciones || []).forEach(function (sec) {
            h += renderSection(sec);
        });
        if (!S.readonly) {
            h += '<button type="button" class="cv-add-section" data-action="add-section">' +
                 ICON.plus + '<span>Agregar sección</span></button>';
        }
        h += '</div>';
        return h;
    }

    function renderGridHead() {
        // 12 columnas. Mantener consistencia exacta con .cv-row en CSS.
        var cols = [
            { cls: 'cv-col-act',     label: '' },
            { cls: 'cv-col-cant',    label: 'Cant' },
            { cls: 'cv-col-marca',   label: 'Marca' },
            { cls: 'cv-col-parte',   label: 'No. Parte' },
            { cls: 'cv-col-desc',    label: 'Descripción' },
            { cls: 'cv-col-plista',  label: 'Precio L.' },
            { cls: 'cv-col-desc-pct',label: 'Desc %' },
            { cls: 'cv-col-punit',   label: 'P. Unit' },
            { cls: 'cv-col-costo',   label: 'Costo' },
            { cls: 'cv-col-prov',    label: 'Proveedor' },
            { cls: 'cv-col-entrega', label: 'Entrega' },
            { cls: 'cv-col-total',   label: 'Total' },
        ];
        var h = '<div class="cv-grid-head">';
        cols.forEach(function (c) {
            h += '<div class="cv-grid-head-cell ' + c.cls + '">' + esc(c.label) + '</div>';
        });
        h += '</div>';
        return h;
    }

    function renderSection(sec) {
        var open = sec.expanded !== false;
        var h = '<div class="cv-section' + (open ? ' cv-section-open' : '') + '" data-section="' + esc(sec.id) + '">';

        // Section header (toggle row)
        h += '<div class="cv-section-row">';
        h += '<button type="button" class="cv-section-toggle" data-action="toggle-section" data-section="' + esc(sec.id) + '" aria-label="Expandir/colapsar">' +
             '<span class="cv-chevron">' + (open ? ICON.chevronDown : ICON.chevronRight) + '</span>' +
             '</button>';
        var disabled = S.readonly ? 'disabled' : '';
        h += '<input type="text" class="cv-section-title-input" data-section="' + esc(sec.id) + '" ' +
             'value="' + esc(sec.titulo || '') + '" placeholder="NOMBRE DE SECCIÓN" ' + disabled + ' />';
        if (!S.readonly) {
            h += '<div class="cv-section-actions">';
            h += '<button type="button" class="cv-row-del" data-action="del-section" data-section="' + esc(sec.id) + '" title="Eliminar sección">' + ICON.trash + '</button>';
            h += '</div>';
        }
        h += '</div>';

        if (open) {
            (sec.items || []).forEach(function (it) {
                h += renderRow(sec.id, it);
            });
            if (!S.readonly) {
                h += '<button type="button" class="cv-add-row" data-action="add-row" data-section="' + esc(sec.id) + '">' +
                     ICON.plus + '<span>Nueva fila</span></button>';
            }
            if (S.readonly && !(sec.items || []).length) {
                h += '<div class="cv-empty">Sin items.</div>';
            }
        }

        h += '</div>';
        return h;
    }

    function renderRow(secId, it) {
        var c = calcItem(it);
        var disabled = S.readonly ? 'disabled' : '';
        var hasNotas = !!(it.notas && String(it.notas).trim());

        var h = '<div class="cv-row' + (hasNotas ? ' cv-has-notas' : '') + '" ' +
                'data-section="' + esc(secId) + '" data-item="' + esc(it.id) + '">';

        // Acción (delete)
        h += '<div class="cv-row-cell cv-cell-act">';
        if (!S.readonly) {
            h += '<button type="button" class="cv-row-del" data-action="del-item" ' +
                 'data-section="' + esc(secId) + '" data-item="' + esc(it.id) + '" ' +
                 'title="Eliminar fila">' + ICON.trash + '</button>';
        }
        h += '</div>';

        // Cant
        h += cellInput('num',  secId, it.id, 'cantidad', it.cantidad, 'cv-col-cant');

        // Marca
        h += cellInput('text', secId, it.id, 'marca', it.marca, 'cv-col-marca');

        // No. Parte (mono)
        h += cellInput('text', secId, it.id, 'parte', it.parte, 'cv-col-parte', { mono: true });

        // Descripción + notas (debajo)
        h += '<div class="cv-row-cell cv-cell-desc cv-col-desc">';
        h += '<input type="text" class="cv-input cv-input-desc" data-field="descripcion" ' +
             'data-section="' + esc(secId) + '" data-item="' + esc(it.id) + '" ' +
             'value="' + esc(it.descripcion || '') + '" placeholder="Descripción del producto" ' + disabled + ' />';
        h += '<input type="text" class="cv-input cv-notas-input" data-field="notas" ' +
             'data-section="' + esc(secId) + '" data-item="' + esc(it.id) + '" ' +
             'value="' + esc(it.notas || '') + '" placeholder="Notas (opcional)" ' + disabled + ' />';
        h += '</div>';

        // Precio L.
        h += cellInput('num',  secId, it.id, 'precioLista', it.precioLista, 'cv-col-plista', { mono: true });

        // Desc %
        h += cellInput('num',  secId, it.id, 'descuentoVenta', it.descuentoVenta, 'cv-col-desc-pct', { mono: true });

        // P. Unit calculado
        h += '<div class="cv-row-cell cv-cell-calc cv-cell-mono cv-col-punit" data-calc="punit" ' +
             'data-section="' + esc(secId) + '" data-item="' + esc(it.id) + '">' +
             esc(fmtMoney(c.precioVentaUnitario)) + '</div>';

        // Costo
        h += cellInput('num',  secId, it.id, 'costoUnitario', it.costoUnitario, 'cv-col-costo', { mono: true });

        // Proveedor
        h += cellInput('text', secId, it.id, 'proveedor', it.proveedor, 'cv-col-prov');

        // Entrega
        h += cellInput('text', secId, it.id, 'entrega', it.entrega, 'cv-col-entrega');

        // Total
        h += '<div class="cv-row-cell cv-cell-total cv-cell-mono cv-col-total" data-calc="total" ' +
             'data-section="' + esc(secId) + '" data-item="' + esc(it.id) + '">' +
             esc(fmtMoney(c.totalVenta)) + '</div>';

        h += '</div>';
        return h;
    }

    function cellInput(kind, secId, itemId, field, value, colCls, opts) {
        opts = opts || {};
        var disabled = S.readonly ? 'disabled' : '';
        var typeAttr = kind === 'num' ? 'type="number"' : 'type="text"';
        var stepAttr = kind === 'num' ? ' step="any"' : '';
        var cls = 'cv-input ' + (kind === 'num' ? 'cv-input-num' : 'cv-input-text');
        if (opts.mono) cls += ' cv-mono';
        var v = value == null ? '' : value;
        var h = '<div class="cv-row-cell cv-cell-' + (kind === 'num' ? 'num' : 'text') + ' ' + colCls + '">';
        h += '<input ' + typeAttr + stepAttr + ' class="' + cls + '" data-field="' + field + '" ' +
             'data-section="' + esc(secId) + '" data-item="' + esc(itemId) + '" ' +
             'value="' + esc(v) + '" ' + disabled + ' />';
        h += '</div>';
        return h;
    }

    function renderSummary() {
        var t = calcTotals();
        var h = '<aside class="cv-summary">';
        h += '<div class="cv-summary-title">Resumen</div>';

        h += summaryRow('Subtotal venta', fmtMoney(t.subtotalVenta));
        h += summaryRow('Costo proyecto', fmtMoney(t.costoTotal), 'cv-row-cost');
        h += summaryRow('Ganancia bruta', fmtMoney(t.ganancia), 'cv-row-gain');

        var marginCls = 'cv-row-margin' + (t.margen < 20 ? ' cv-row-margin-low' : '');
        h += summaryRow('Margen comercial', fmtPct(t.margen), marginCls);

        h += '<div class="cv-summary-sep"></div>';

        if (t.iva_pct > 0) {
            h += summaryRow('Subtotal', fmtMoney(t.subtotalVenta));
            h += summaryRow('IVA (' + fmtPct(t.iva_pct) + ')', fmtMoney(t.iva), 'cv-row-iva');
            h += summaryRow('Total con IVA', fmtMoney(t.totalConIva), 'cv-row-total');
        } else {
            h += summaryRow('Total cotización', fmtMoney(t.subtotalVenta), 'cv-row-total');
        }

        h += '</aside>';
        return h;
    }

    function summaryRow(label, value, cls) {
        return '<div class="cv-summary-row ' + (cls || '') + '">' +
               '<span class="cv-summary-label">' + esc(label) + '</span>' +
               '<span class="cv-summary-value cv-mono">' + esc(value) + '</span>' +
               '</div>';
    }

    // ── Event binding ───────────────────────────────────────────────
    function bindAll() {
        if (!S.container) return;

        // Document header inputs (meta + nombre + tc + iva)
        S.container.querySelectorAll('[data-meta]').forEach(function (inp) {
            inp.addEventListener('input', onMetaInput);
            inp.addEventListener('change', onMetaInput);
        });

        // Section title
        S.container.querySelectorAll('.cv-section-title-input').forEach(function (inp) {
            inp.addEventListener('input', onSectionTitleInput);
        });

        // Item inputs
        S.container.querySelectorAll('.cv-row [data-field]').forEach(function (inp) {
            inp.addEventListener('input', onItemInput);
            inp.addEventListener('change', onItemInput);
            inp.addEventListener('blur', onItemBlur);
        });

        // Click delegation (toggle, add-row, add-section, del-item, del-section)
        S.container.addEventListener('click', onContainerClick);
    }

    function onContainerClick(ev) {
        var btn = ev.target.closest && ev.target.closest('[data-action]');
        if (!btn || !S.container.contains(btn)) return;
        var action = btn.getAttribute('data-action');
        var secId = btn.getAttribute('data-section');
        var itemId = btn.getAttribute('data-item');

        if (action === 'toggle-section') {
            ev.preventDefault();
            toggleSection(secId);
        } else if (action === 'add-row') {
            if (S.readonly) return;
            ev.preventDefault();
            addRow(secId);
        } else if (action === 'add-section') {
            if (S.readonly) return;
            ev.preventDefault();
            addSection();
        } else if (action === 'del-item') {
            if (S.readonly) return;
            ev.preventDefault();
            delItem(secId, itemId);
        } else if (action === 'del-section') {
            if (S.readonly) return;
            ev.preventDefault();
            delSection(secId);
        } else if (action === 'toggle-status') {
            if (S.readonly) return;
            ev.preventDefault();
            // Delega al wizard host (lwP3ToggleStatus tiene la confirmación
            // y maneja la persistencia + re-render del módulo).
            if (typeof window.lwP3ToggleStatus === 'function') {
                window.lwP3ToggleStatus();
            }
        }
    }

    function onMetaInput(ev) {
        if (S.readonly) return;
        var inp = ev.target;
        var key = inp.getAttribute('data-meta');
        var val = inp.value;

        if (key === 'nombre') {
            if (S.volumetria) S.volumetria.nombre = val;
            // Nombre vive en columna de modelo, no en data — pero el endpoint
            // /actualizar/ acepta nombre. Por ahora, lo guardamos como meta
            // para no romper nada del modelo (las versiones previas no lo
            // tocaban aquí). Si se requiere persistir el nombre, agregar
            // 'nombre' al body de /actualizar/. (TODO: confirmar con backend.)
            // Lo guardamos también dentro del data para no perderlo:
            S.data.meta._nombre = val;
            scheduleAutosave();
            return;
        }
        if (key === 'tc') {
            var tc = num(val);
            if (S.volumetria) S.volumetria.tipo_cambio = tc;
            scheduleMetaSave({ tipo_cambio: tc });
            updateSummary();
            return;
        }
        if (key === 'iva') {
            var iv = num(val);
            if (S.volumetria) S.volumetria.iva_pct = iv;
            scheduleMetaSave({ iva_pct: iv });
            updateSummary();
            return;
        }
        // cliente / contacto / fecha / elaboro → data.meta
        if (!S.data.meta) S.data.meta = {};
        S.data.meta[key] = val;
        scheduleAutosave();
    }

    function onSectionTitleInput(ev) {
        if (S.readonly) return;
        var inp = ev.target;
        var secId = inp.getAttribute('data-section');
        var sec = findSection(secId);
        if (!sec) return;
        sec.titulo = inp.value;
        scheduleAutosave();
    }

    function onItemInput(ev) {
        if (S.readonly) return;
        var inp = ev.target;
        var secId = inp.getAttribute('data-section');
        var itemId = inp.getAttribute('data-item');
        var field = inp.getAttribute('data-field');
        var it = findItem(secId, itemId);
        if (!it) return;

        var isNum = inp.type === 'number' ||
                    field === 'cantidad' || field === 'precioLista' ||
                    field === 'descuentoVenta' || field === 'costoUnitario';

        if (isNum) {
            // Permitir input parcial (ej. "12.") sin convertir; pero si valor
            // numérico válido, guardamos número.
            var raw = inp.value;
            if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
                it[field] = 0;
            } else {
                it[field] = num(raw);
            }
        } else {
            it[field] = inp.value;
        }

        // Re-render localizado (solo la fila + summary), preservando foco.
        if (field === 'cantidad' || field === 'precioLista' ||
            field === 'descuentoVenta' || field === 'costoUnitario') {
            updateRowCalcs(secId, itemId);
            updateSummary();
        } else if (field === 'notas') {
            // Toggle de class cv-has-notas (visibilidad permanente).
            var rowEl = S.container.querySelector(
                '.cv-row[data-section="' + cssEsc(secId) + '"][data-item="' + cssEsc(itemId) + '"]'
            );
            if (rowEl) {
                if ((inp.value || '').trim()) rowEl.classList.add('cv-has-notas');
                else rowEl.classList.remove('cv-has-notas');
            }
        }
        scheduleAutosave();
    }

    function onItemBlur(ev) {
        // En blur de un campo numérico, normalizamos la representación del
        // input (ej. "12." → "12") sin tocar el data (ya está num).
        if (S.readonly) return;
        var inp = ev.target;
        var field = inp.getAttribute('data-field');
        if (!field) return;
        var isNum = inp.type === 'number' ||
                    field === 'cantidad' || field === 'precioLista' ||
                    field === 'descuentoVenta' || field === 'costoUnitario';
        if (isNum) {
            var n = num(inp.value);
            // Solo reescribimos si la representación cambió, para no romper
            // el caret durante typing.
            if (String(n) !== inp.value) inp.value = n === 0 ? '' : String(n);
        }
    }

    // CSS-escape para selectores con uuid (tienen guiones, OK, pero por si
    // acaso). El uuid v4 es seguro, pero blindamos.
    function cssEsc(s) {
        if (window.CSS && CSS.escape) return CSS.escape(s);
        return String(s).replace(/(["\\])/g, '\\$1');
    }

    // ── Operaciones sobre el data ───────────────────────────────────
    function findSection(id) {
        if (!S.data || !id) return null;
        var arr = S.data.secciones || [];
        for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
        return null;
    }

    function findItem(secId, itemId) {
        var sec = findSection(secId);
        if (!sec) return null;
        var arr = sec.items || [];
        for (var i = 0; i < arr.length; i++) if (arr[i].id === itemId) return arr[i];
        return null;
    }

    function toggleSection(secId) {
        var sec = findSection(secId);
        if (!sec) return;
        sec.expanded = !sec.expanded;
        // Re-render del grid (solo) — el doc header y summary no cambian.
        rerenderGrid();
        scheduleAutosave();
    }

    function addRow(secId) {
        var sec = findSection(secId);
        if (!sec) return;
        sec.items.push(emptyItem());
        sec.expanded = true;
        rerenderGrid();
        // Foco al primer input de la fila nueva.
        var rowEls = S.container.querySelectorAll('.cv-row[data-section="' + cssEsc(secId) + '"]');
        var last = rowEls[rowEls.length - 1];
        if (last) {
            var first = last.querySelector('input.cv-input-num');
            if (first) try { first.focus(); first.select && first.select(); } catch (_) {}
        }
        scheduleAutosave();
    }

    function addSection() {
        S.data.secciones.push(emptySection());
        rerenderGrid();
        // Foco al título de la sección nueva.
        var sects = S.container.querySelectorAll('.cv-section-title-input');
        var last = sects[sects.length - 1];
        if (last) try { last.focus(); last.select && last.select(); } catch (_) {}
        scheduleAutosave();
    }

    function delItem(secId, itemId) {
        var sec = findSection(secId);
        if (!sec) return;
        sec.items = (sec.items || []).filter(function (it) { return it.id !== itemId; });
        rerenderGrid();
        updateSummary();
        scheduleAutosave();
    }

    function delSection(secId) {
        var sec = findSection(secId);
        if (!sec) return;
        var n = (sec.items || []).length;
        if (n > 0) {
            var ok = window.confirm('La sección "' + (sec.titulo || '') + '" tiene ' + n + ' items. ¿Eliminar de todos modos?');
            if (!ok) return;
        }
        S.data.secciones = (S.data.secciones || []).filter(function (s) { return s.id !== secId; });
        rerenderGrid();
        updateSummary();
        scheduleAutosave();
    }

    // ── Re-renders parciales ────────────────────────────────────────
    function rerenderGrid() {
        if (!S.container) return;
        var oldGrid = S.container.querySelector('.cv-grid');
        if (!oldGrid) { render(); return; }
        var tmp = document.createElement('div');
        tmp.innerHTML = renderGrid();
        var newGrid = tmp.firstChild;
        oldGrid.replaceWith(newGrid);
        // Re-bind solo los listeners del grid.
        newGrid.querySelectorAll('.cv-section-title-input').forEach(function (inp) {
            inp.addEventListener('input', onSectionTitleInput);
        });
        newGrid.querySelectorAll('.cv-row [data-field]').forEach(function (inp) {
            inp.addEventListener('input', onItemInput);
            inp.addEventListener('change', onItemInput);
            inp.addEventListener('blur', onItemBlur);
        });
        // El click delegado se mantiene en S.container.
    }

    function updateRowCalcs(secId, itemId) {
        var it = findItem(secId, itemId);
        if (!it) return;
        var c = calcItem(it);
        var puEl = S.container.querySelector(
            '[data-calc="punit"][data-section="' + cssEsc(secId) + '"][data-item="' + cssEsc(itemId) + '"]'
        );
        var totEl = S.container.querySelector(
            '[data-calc="total"][data-section="' + cssEsc(secId) + '"][data-item="' + cssEsc(itemId) + '"]'
        );
        if (puEl) puEl.textContent = fmtMoney(c.precioVentaUnitario);
        if (totEl) totEl.textContent = fmtMoney(c.totalVenta);
    }

    function updateSummary() {
        if (!S.container) return;
        var oldSum = S.container.querySelector('.cv-summary');
        var tmp = document.createElement('div');
        tmp.innerHTML = renderSummary();
        var newSum = tmp.firstChild;
        if (oldSum) oldSum.replaceWith(newSum);
        else S.container.querySelector('.cv-root').appendChild(newSum);
    }

    // ── Autosave ────────────────────────────────────────────────────
    function scheduleAutosave() {
        if (S.readonly) return;
        if (S.saveTimer) clearTimeout(S.saveTimer);
        S.saveTimer = setTimeout(doAutosave, 700);
    }

    function doAutosave() {
        S.saveTimer = null;
        if (S.readonly) return;
        if (!S.volumetria || !S.volumetria.id) return;

        if (S.saveInFlight) {
            S.savePending = true;
            return;
        }
        S.saveInFlight = true;
        S.savePending = false;

        var url = '/app/api/iamet/volumetrias/' + S.volumetria.id + '/data/';
        var snapshot = JSON.parse(JSON.stringify(S.data));
        log('autosave →', url);

        apiPost(url, { data: snapshot }).then(function (r) {
            S.saveInFlight = false;
            if (r && (r.ok || r.success)) {
                log('autosave OK');
                if (typeof S.onSaved === 'function') {
                    try { S.onSaved(S.volumetria); } catch (_) {}
                }
            } else {
                log('autosave error', r);
            }
            if (S.savePending) {
                S.savePending = false;
                doAutosave();
            }
        }).catch(function (err) {
            S.saveInFlight = false;
            log('autosave failed', err);
            if (S.savePending) {
                S.savePending = false;
                setTimeout(doAutosave, 1500);
            }
        });
    }

    function scheduleMetaSave(partial) {
        if (S.readonly) return;
        Object.keys(partial || {}).forEach(function (k) { S.metaPending[k] = partial[k]; });
        if (S.metaTimer) clearTimeout(S.metaTimer);
        S.metaTimer = setTimeout(doMetaSave, 700);
    }

    function doMetaSave() {
        S.metaTimer = null;
        if (S.readonly) return;
        if (!S.volumetria || !S.volumetria.id) return;
        if (!Object.keys(S.metaPending).length) return;
        var body = S.metaPending;
        S.metaPending = {};
        var url = '/app/api/iamet/volumetrias/' + S.volumetria.id + '/actualizar/';
        log('meta save →', body);
        apiPost(url, body).then(function (r) {
            if (r && (r.ok || r.success) && r.data) {
                if (r.data.iva_pct != null) S.volumetria.iva_pct = r.data.iva_pct;
                if (r.data.tipo_cambio != null) S.volumetria.tipo_cambio = r.data.tipo_cambio;
            } else {
                log('meta save error', r);
            }
        }).catch(function (err) {
            log('meta save failed', err);
        });
    }

    // ── API pública ─────────────────────────────────────────────────
    window.crmVolumetria = {
        /**
         * Monta el editor en `container`.
         * @param {HTMLElement} container
         * @param {object}      options
         * @param {object}      options.volumetria      {id, nombre, status, data, iva_pct, tipo_cambio}
         * @param {object}      [options.levantamiento] objeto del lev (para defaults de meta)
         * @param {boolean}     [options.readonly]      true → solo lectura
         * @param {function}    [options.onSaved]       callback(volumetria) tras autosave OK
         */
        render: function (container, options) {
            options = options || {};
            if (!container || !options.volumetria) {
                log('render: faltan args (container o volumetria)');
                return;
            }
            // Limpiar instancia anterior si hubiera.
            if (S.container) {
                try { this.destroy(); } catch (_) {}
            }

            S.container = container;
            S.volumetria = options.volumetria;
            S.levantamiento = options.levantamiento || null;
            S.readonly = !!options.readonly;
            S.onSaved = options.onSaved || null;

            // Defaults razonables si vienen null.
            if (S.volumetria.iva_pct == null)     S.volumetria.iva_pct = 16;
            if (S.volumetria.tipo_cambio == null) S.volumetria.tipo_cambio = 19.50;

            S.data = normalizeData(S.volumetria.data || {}, S.levantamiento);
            S.volumetria.data = S.data;

            // Si la migración cambió la shape (v1/v2 → v3), guardamos pronto
            // para "consagrar" la migración en backend.
            var migrated = (options.volumetria.data && options.volumetria.data.version !== 3);
            log('render volumetría', S.volumetria.id, 'readonly=' + S.readonly,
                'migrated=' + !!migrated);
            render();
            if (migrated && !S.readonly) scheduleAutosave();
        },

        /** Snapshot JSON v3 actual (deep copy). */
        getData: function () {
            return S.data ? JSON.parse(JSON.stringify(S.data)) : null;
        },

        /** Volumetría en memoria (incluye iva_pct, tipo_cambio actualizados). */
        getVolumetria: function () {
            return S.volumetria;
        },

        /** Fuerza flush de autosave + metaSave pendientes. */
        flushSave: function () {
            if (S.saveTimer) {
                clearTimeout(S.saveTimer);
                S.saveTimer = null;
                doAutosave();
            }
            if (S.metaTimer) {
                clearTimeout(S.metaTimer);
                S.metaTimer = null;
                doMetaSave();
            }
        },

        /** Destruye la instancia: quita listeners, vacía el contenedor. */
        destroy: function () {
            if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
            if (S.metaTimer) { clearTimeout(S.metaTimer); S.metaTimer = null; }
            if (S.container) {
                try {
                    S.container.removeEventListener('click', onContainerClick);
                } catch (_) {}
                S.container.innerHTML = '';
            }
            S.container = null;
            S.volumetria = null;
            S.levantamiento = null;
            S.data = null;
            S.readonly = false;
            S.onSaved = null;
            S.saveInFlight = false;
            S.savePending = false;
            S.metaPending = {};
        },
    };
})();
