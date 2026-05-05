/**
 * crm_volumetria.js — Editor de Volumetría v4
 *
 * Rediseño "multi-tabla por tipo" inspirado en el cotizador legacy de
 * nethive.mx pero con la estructura de columnas del Excel real
 * (Volumetria Instalacion de rutas de escalerilla IDF2.xlsx). Cada sección
 * se renderiza como una tarjeta-tabla independiente con su propia banda de
 * header de color (según tipo), botones de acción y headers agrupados con
 * bandas pastel ("INFORMACIÓN DEL CLIENTE" azul / "COSTOS Y MÁRGENES"
 * verde / "ACCIONES" gris).
 *
 * Tipos de sección y su shape de items:
 *
 *   equipamiento  (14 cols) — row_type 'header' (rótulo) o 'item' (producto):
 *     { row_type: 'header', texto }
 *     { row_type: 'item', marca, parte, cantidad, descripcion, precioLista,
 *       descuentoVenta, descuentoCosto, costoUnitario|null, proveedor,
 *       entrega, notas }
 *
 *   mano_obra     (8 cols) — cobrada al cliente; ganancia 100%:
 *     { marca, parte, cantidad, descripcion, precioLista, descuentoVenta,
 *       notas }
 *
 *   costo_mo      (6 cols) — costo interno; resta a la ganancia:
 *     { recurso, cantidad, costoUnitario, dias }
 *
 *   gastos        (5 cols) — costo interno; resta a la ganancia:
 *     { cantidad, unidad, descripcion, costoUnitario }
 *
 * Cálculos:
 *
 *   equipamiento (item):
 *     pVentaUnit = precioLista * (1 - descuentoVenta/100)
 *     totalCli   = cantidad * pVentaUnit
 *     cUnit      = costoUnitario != null ? costoUnitario
 *                                       : precioLista * (1 - descuentoCosto/100)
 *     totalCosto = cantidad * cUnit
 *     ganancia   = totalCli - totalCosto
 *
 *   mano_obra:
 *     pVentaUnit = precioLista * (1 - descuentoVenta/100)
 *     totalCli   = cantidad * pVentaUnit
 *     totalCosto = 0
 *     ganancia   = totalCli
 *
 *   costo_mo:
 *     concentrado = cantidad * costoUnitario
 *     totalCosto  = concentrado * dias
 *     totalCli    = 0
 *     ganancia    = -totalCosto
 *
 *   gastos:
 *     totalCosto = cantidad * costoUnitario
 *     totalCli   = 0
 *     ganancia   = -totalCosto
 *
 *   Globales:
 *     subtotal_venta = Σ totalCli (todas las secciones)
 *     total_costo    = Σ totalCosto
 *     ganancia       = subtotal_venta - total_costo
 *     margen %       = subtotal_venta > 0 ? ganancia / subtotal_venta * 100 : 0
 *     iva            = subtotal_venta * (iva_pct / 100)
 *     total_con_iva  = subtotal_venta + iva
 *
 * Endpoints (sin cambios):
 *   POST /app/api/iamet/volumetrias/{id}/data/        ← autosave del JSON v4
 *   POST /app/api/iamet/volumetrias/{id}/actualizar/  ← iva_pct, tipo_cambio, nombre, status
 *
 * API pública (preservada): window.crmVolumetria.{render, getData,
 *   getVolumetria, flushSave, destroy}.
 *
 * ── Inventario de clases CSS (paridad estricta con crm_volumetria.css) ──
 *
 * Root / shell:
 *   .cv-root, .cv-readonly
 *
 * Document header:
 *   .cv-doc, .cv-doc-titlebar, .cv-doc-title-input,
 *   .cv-status, .cv-status-borrador, .cv-status-completada,
 *   .cv-status-dot, .cv-status-label,
 *   .cv-doc-meta, .cv-meta-field, .cv-meta-icon, .cv-meta-label,
 *   .cv-meta-input
 *
 * Sección (tarjeta-tabla):
 *   .cv-stack,
 *   .cv-section, .cv-section-collapsed,
 *   .cv-section-equipamiento, .cv-section-mano_obra,
 *   .cv-section-costo_mo, .cv-section-gastos,
 *   .cv-section-banner, .cv-section-banner-left,
 *   .cv-section-icon, .cv-section-title-input,
 *   .cv-section-actions, .cv-section-toggle, .cv-chevron,
 *   .cv-btn, .cv-btn-add-row, .cv-btn-add-header,
 *   .cv-btn-del-section, .cv-btn-icon
 *
 * Tabla:
 *   .cv-table-wrap,
 *   .cv-table, .cv-table-equipamiento, .cv-table-mano_obra,
 *   .cv-table-costo_mo, .cv-table-gastos,
 *   .cv-thead, .cv-thead-groups, .cv-thead-cols,
 *   .cv-th-group, .cv-th-group-info, .cv-th-group-costos,
 *   .cv-th-group-acciones, .cv-th-group-empty,
 *   .cv-th, .cv-th-num, .cv-th-text,
 *   .cv-tbody, .cv-tr, .cv-tr-header,
 *   .cv-td, .cv-td-num, .cv-td-text, .cv-td-calc, .cv-td-act,
 *   .cv-td-mono, .cv-td-total, .cv-td-positive, .cv-td-negative,
 *   .cv-td-rotulo,
 *   .cv-input, .cv-input-num, .cv-input-text, .cv-input-rotulo,
 *   .cv-row-del, .cv-tfoot, .cv-tfoot-tr, .cv-tfoot-label,
 *   .cv-tfoot-value
 *
 * Add section dropdown:
 *   .cv-add-section-wrap, .cv-add-section, .cv-add-section-menu,
 *   .cv-add-section-item, .cv-add-section-icon, .cv-add-section-open
 *
 * Resumen + estadísticas:
 *   .cv-bottom, .cv-card, .cv-card-financiero, .cv-card-stats,
 *   .cv-card-header, .cv-card-title, .cv-card-body,
 *   .cv-fin-row, .cv-fin-label, .cv-fin-value,
 *   .cv-fin-row-cost, .cv-fin-row-gain, .cv-fin-row-margin,
 *   .cv-fin-row-margin-low, .cv-fin-row-iva, .cv-fin-row-total,
 *   .cv-fin-sep, .cv-fin-foot,
 *   .cv-stat-row, .cv-stat-label, .cv-stat-value,
 *   .cv-stat-pills, .cv-stat-pill,
 *   .cv-stat-pill-equipamiento, .cv-stat-pill-mano_obra,
 *   .cv-stat-pill-costo_mo, .cv-stat-pill-gastos,
 *   .cv-card-actions, .cv-export-btn
 *
 * Misc:
 *   .cv-mono, .cv-empty, .cv-sr-only
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

        data: null,             // objeto v4 vivo

        saveTimer: null,
        saveInFlight: false,
        savePending: false,

        metaTimer: null,
        metaPending: {},

        // Para el dropdown "+ Agregar Tabla"
        addMenuOpen: false,
        outsideClickHandler: null,
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
        if (v === '' || v == null) return 0;
        var n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    }

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

    function cssEsc(s) {
        if (window.CSS && CSS.escape) return CSS.escape(s);
        return String(s).replace(/(["\\])/g, '\\$1');
    }

    // ── Tipos de sección — defaults ─────────────────────────────────
    var SECTION_TYPES = ['equipamiento', 'mano_obra', 'costo_mo', 'gastos'];

    var TYPE_INFO = {
        equipamiento: {
            label: 'Equipamiento',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
            defaultTitle: 'Equipamiento',
        },
        mano_obra: {
            label: 'Mano de Obra',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
            defaultTitle: 'Mano de Obra',
        },
        costo_mo: {
            label: 'Costo MO Interno',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
            defaultTitle: 'Costo MO Interno',
        },
        gastos: {
            label: 'Gastos',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
            defaultTitle: 'Gastos',
        },
    };

    // ── Constructores de items por tipo ─────────────────────────────
    function newEquipItem() {
        return {
            id: uuid(),
            row_type: 'item',
            marca: '',
            parte: '',
            cantidad: 0,
            descripcion: '',
            precioLista: 0,
            descuentoVenta: 0,
            descuentoCosto: 0,
            costoUnitario: null,    // null → calcular como precioLista * (1 - descuentoCosto/100)
            proveedor: '',
            entrega: '',
            notas: '',
        };
    }
    function newEquipHeaderItem(texto) {
        return {
            id: uuid(),
            row_type: 'header',
            texto: texto || '',
        };
    }
    function newMoItem() {
        return {
            id: uuid(),
            marca: '',
            parte: '',
            cantidad: 0,
            descripcion: '',
            precioLista: 0,
            descuentoVenta: 0,
            notas: '',
        };
    }
    function newCmoItem() {
        return {
            id: uuid(),
            recurso: '',
            cantidad: 0,
            costoUnitario: 0,
            dias: 0,
        };
    }
    function newGastoItem() {
        return {
            id: uuid(),
            cantidad: 0,
            unidad: 'PZA',
            descripcion: '',
            costoUnitario: 0,
        };
    }

    function newItemForType(tipo) {
        switch (tipo) {
            case 'equipamiento': return newEquipItem();
            case 'mano_obra':    return newMoItem();
            case 'costo_mo':     return newCmoItem();
            case 'gastos':       return newGastoItem();
        }
        return newEquipItem();
    }

    function newSection(tipo, titulo) {
        tipo = SECTION_TYPES.indexOf(tipo) >= 0 ? tipo : 'equipamiento';
        return {
            id: uuid(),
            tipo: tipo,
            titulo: titulo || TYPE_INFO[tipo].defaultTitle,
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
            version: 4,
            meta: meta,
            secciones: [newSection('equipamiento')],
        };
    }

    // ── Normalización + Migración v1/v2/v3 → v4 ─────────────────────

    function inferTipoFromV3Section(sec) {
        var items = (sec && sec.items) || [];
        if (!items.length) return 'equipamiento';

        var sample = null;
        // Primer item con datos (no header v2)
        for (var i = 0; i < items.length; i++) {
            if (items[i] && items[i].row_type !== 'header') { sample = items[i]; break; }
        }
        if (!sample) sample = items[0] || {};

        // costo_mo: tiene recurso o dias, sin parte
        if (sample.recurso != null || sample.dias != null) {
            if (!sample.parte) return 'costo_mo';
        }
        // gastos: tiene unidad explícita o (descripcion + costoUnitario sin parte/precioLista)
        if (sample.unidad && !sample.parte && !sample.precioLista) return 'gastos';
        // mano_obra: tiene parte/precioLista pero sin costoUnitario y sin descuentoCosto
        var hasCosto = sample.costoUnitario != null && Number(sample.costoUnitario) > 0;
        var hasParte = !!sample.parte;
        var hasPrecio = sample.precioLista != null && Number(sample.precioLista) > 0;
        if (hasParte && hasPrecio && !hasCosto && sample.descuentoCosto == null) {
            // Heurística suave: mano de obra
            // Si el título contiene 'OBRA' o 'MO', confirmamos
            var t = String((sec && sec.titulo) || '').toUpperCase();
            if (t.indexOf('OBRA') >= 0 || /\bMO\b/.test(t)) return 'mano_obra';
        }
        // Default: equipamiento
        return 'equipamiento';
    }

    function migrateV3SectionToV4(sec) {
        sec = sec || {};
        var tipo = sec.tipo;
        if (SECTION_TYPES.indexOf(tipo) < 0) tipo = inferTipoFromV3Section(sec);

        var out = {
            id: sec.id || uuid(),
            tipo: tipo,
            titulo: sec.titulo || TYPE_INFO[tipo].defaultTitle,
            expanded: sec.expanded !== false,
            items: [],
        };

        var srcItems = Array.isArray(sec.items) ? sec.items : [];
        srcItems.forEach(function (it) {
            it = it || {};
            if (it.row_type === 'header' && tipo === 'equipamiento') {
                out.items.push({
                    id: it.id || uuid(),
                    row_type: 'header',
                    texto: it.texto || it.descripcion || '',
                });
                return;
            }
            if (tipo === 'equipamiento') {
                out.items.push({
                    id: it.id || uuid(),
                    row_type: 'item',
                    marca: it.marca || '',
                    parte: it.parte || '',
                    cantidad: num(it.cantidad),
                    descripcion: it.descripcion || '',
                    precioLista: num(it.precioLista),
                    descuentoVenta: num(it.descuentoVenta),
                    descuentoCosto: it.descuentoCosto != null ? num(it.descuentoCosto) : 0,
                    // En v3, costoUnitario era 0 por defecto; preservamos
                    // como override solo si > 0, sino dejamos null para que
                    // el cálculo derivado use descuentoCosto.
                    costoUnitario: (it.costoUnitario != null && Number(it.costoUnitario) > 0)
                        ? num(it.costoUnitario) : null,
                    proveedor: it.proveedor || '',
                    entrega: it.entrega || '',
                    notas: it.notas || '',
                });
            } else if (tipo === 'mano_obra') {
                out.items.push({
                    id: it.id || uuid(),
                    marca: it.marca || '',
                    parte: it.parte || '',
                    cantidad: num(it.cantidad),
                    descripcion: it.descripcion || '',
                    precioLista: num(it.precioLista),
                    descuentoVenta: num(it.descuentoVenta),
                    notas: it.notas || '',
                });
            } else if (tipo === 'costo_mo') {
                out.items.push({
                    id: it.id || uuid(),
                    recurso: it.recurso || it.descripcion || '',
                    cantidad: num(it.cantidad),
                    costoUnitario: num(it.costoUnitario),
                    dias: it.dias != null ? num(it.dias) : 1,
                });
            } else if (tipo === 'gastos') {
                out.items.push({
                    id: it.id || uuid(),
                    cantidad: num(it.cantidad),
                    unidad: it.unidad || it.parte || 'PZA',
                    descripcion: it.descripcion || '',
                    costoUnitario: num(it.costoUnitario),
                });
            }
        });

        return out;
    }

    // v2 (con equipamiento/mano_obra/costo_mo/gastos en raíz) → secciones v3-shape
    function migrateV2ToV3Sections(raw) {
        var secs = [];

        // Equipamiento — múltiples sub-secciones, cada subsección puede tener
        // headers que dividen en sub-secciones también. Aplanamos a v3.
        if (raw.equipamiento && Array.isArray(raw.equipamiento.secciones)) {
            raw.equipamiento.secciones.forEach(function (sub) {
                var current = {
                    id: uuid(),
                    titulo: (sub && sub.nombre) ? sub.nombre : 'Equipamiento',
                    expanded: true,
                    tipo: 'equipamiento',
                    items: [],
                };
                secs.push(current);
                var items = (sub && Array.isArray(sub.items)) ? sub.items : [];
                items.forEach(function (it) {
                    if (it && it.row_type === 'header') {
                        // En v4 los headers son inline (row_type='header'),
                        // así que NO los partimos en sub-secciones nuevas;
                        // los preservamos dentro de la sección actual.
                        current.items.push({
                            id: uuid(),
                            row_type: 'header',
                            texto: it.texto || it.descripcion || '',
                        });
                        return;
                    }
                    current.items.push({
                        id: uuid(),
                        row_type: 'item',
                        cantidad: num(it.cant),
                        marca: it.marca || '',
                        parte: it.no_parte || '',
                        descripcion: it.descripcion || '',
                        precioLista: num(it.p_lista),
                        descuentoVenta: num(it.desc_v_pct),
                        descuentoCosto: num(it.desc_c_pct),
                        costoUnitario: it.c_unit != null ? num(it.c_unit) : null,
                        proveedor: it.proveedor || '',
                        entrega: it.entrega || '',
                        notas: it.notas || '',
                    });
                });
            });
        }
        if (raw.mano_obra && Array.isArray(raw.mano_obra.items) && raw.mano_obra.items.length) {
            var moSec = {
                id: uuid(), titulo: 'Mano de Obra', expanded: true,
                tipo: 'mano_obra', items: [],
            };
            raw.mano_obra.items.forEach(function (it) {
                moSec.items.push({
                    id: uuid(),
                    cantidad: num(it.cant),
                    marca: it.marca || '',
                    parte: it.no_parte || '',
                    descripcion: it.descripcion || '',
                    precioLista: num(it.p_unit || it.p_lista),
                    descuentoVenta: num(it.desc_v_pct),
                    notas: it.notas || '',
                });
            });
            secs.push(moSec);
        }
        if (raw.costo_mo && Array.isArray(raw.costo_mo.items) && raw.costo_mo.items.length) {
            var cmoSec = {
                id: uuid(), titulo: 'Costo MO Interno', expanded: true,
                tipo: 'costo_mo', items: [],
            };
            raw.costo_mo.items.forEach(function (it) {
                cmoSec.items.push({
                    id: uuid(),
                    recurso: it.recurso || '',
                    cantidad: num(it.cant),
                    costoUnitario: num(it.costo_unit),
                    dias: num(it.dias) || 1,
                });
            });
            secs.push(cmoSec);
        }
        if (raw.gastos && Array.isArray(raw.gastos.items) && raw.gastos.items.length) {
            var gSec = {
                id: uuid(), titulo: 'Gastos', expanded: true,
                tipo: 'gastos', items: [],
            };
            raw.gastos.items.forEach(function (it) {
                gSec.items.push({
                    id: uuid(),
                    cantidad: num(it.cant),
                    unidad: it.unidad || 'PZA',
                    descripcion: it.descripcion || '',
                    costoUnitario: num(it.costo_unit),
                });
            });
            secs.push(gSec);
        }
        return secs;
    }

    // v1 legacy
    function migrateV1ToV3Sections(raw) {
        var secs = [];
        if (Array.isArray(raw.materiales) && raw.materiales.length) {
            var s1 = { id: uuid(), titulo: 'Materiales', expanded: true,
                       tipo: 'equipamiento', items: [] };
            raw.materiales.forEach(function (r) {
                s1.items.push({
                    id: uuid(),
                    row_type: 'item',
                    cantidad: num(r.qty),
                    marca: r.marca || '',
                    parte: r.modelo || '',
                    descripcion: r.desc || '',
                    precioLista: num(r.precio),
                    descuentoVenta: num(r.desc_pct),
                    descuentoCosto: 0,
                    costoUnitario: r.costo != null ? num(r.costo) : null,
                    proveedor: r.proveedor || '',
                    entrega: '',
                    notas: '',
                });
            });
            secs.push(s1);
        }
        if (Array.isArray(raw.manoObra) && raw.manoObra.length) {
            var s2 = { id: uuid(), titulo: 'Mano de Obra', expanded: true,
                       tipo: 'mano_obra', items: [] };
            raw.manoObra.forEach(function (r) {
                s2.items.push({
                    id: uuid(),
                    cantidad: num(r.qty),
                    marca: '', parte: '',
                    descripcion: r.desc || '',
                    precioLista: num(r.precio),
                    descuentoVenta: 0,
                    notas: '',
                });
            });
            secs.push(s2);
        }
        if (Array.isArray(raw.gastos) && raw.gastos.length) {
            var s3 = { id: uuid(), titulo: 'Gastos', expanded: true,
                       tipo: 'gastos', items: [] };
            raw.gastos.forEach(function (r) {
                s3.items.push({
                    id: uuid(),
                    cantidad: num(r.qty),
                    unidad: r.unidad || 'PZA',
                    descripcion: r.desc || '',
                    costoUnitario: num(r.costo),
                });
            });
            secs.push(s3);
        }
        return secs;
    }

    function ensureV4(data) {
        data = data || {};
        data.version = 4;
        data.meta = data.meta || {};
        ['cliente', 'contacto', 'elaboro', 'fecha'].forEach(function (k) {
            if (data.meta[k] == null) data.meta[k] = '';
        });
        if (!Array.isArray(data.secciones)) data.secciones = [];
        data.secciones = data.secciones.map(function (sec) {
            return migrateV3SectionToV4(sec);
        });
        return data;
    }

    function normalizeData(raw, lev) {
        raw = raw || {};

        // Ya es v4
        if (raw.version === 4 && Array.isArray(raw.secciones)) {
            return ensureV4(raw);
        }

        // v3 (tiene meta + secciones, sin tipo en secciones o version=3)
        if (raw.version === 3 || (raw.meta && Array.isArray(raw.secciones))) {
            return ensureV4(raw);
        }

        // ¿v2? (equipamiento/mano_obra/costo_mo/gastos en raíz)
        var isV2 = raw.version === 2 ||
                   raw.equipamiento || raw.mano_obra || raw.costo_mo ||
                   (raw.gastos && raw.gastos.items);

        var secciones = [];
        if (isV2) {
            secciones = migrateV2ToV3Sections(raw);
        } else if (raw.materiales || raw.manoObra || raw.gastos) {
            secciones = migrateV1ToV3Sections(raw);
        }

        if (!secciones.length) {
            return defaultData(lev);
        }

        var meta = (raw.meta && typeof raw.meta === 'object') ? raw.meta : {};
        var defaults = defaultData(lev).meta;
        ['cliente', 'contacto', 'elaboro', 'fecha'].forEach(function (k) {
            if (!meta[k]) meta[k] = defaults[k];
        });

        return ensureV4({ version: 4, meta: meta, secciones: secciones });
    }

    // ── Cálculos por tipo ───────────────────────────────────────────
    function calcEquipItem(it) {
        if (it.row_type === 'header') {
            return { totalCli: 0, totalCosto: 0, ganancia: 0,
                     pVentaUnit: 0, cUnit: 0 };
        }
        var pVentaUnit = num(it.precioLista) * (1 - num(it.descuentoVenta) / 100);
        var totalCli = num(it.cantidad) * pVentaUnit;
        var cUnit;
        if (it.costoUnitario != null && it.costoUnitario !== '' && Number(it.costoUnitario) >= 0) {
            cUnit = num(it.costoUnitario);
        } else {
            cUnit = num(it.precioLista) * (1 - num(it.descuentoCosto) / 100);
        }
        var totalCosto = num(it.cantidad) * cUnit;
        return {
            pVentaUnit: pVentaUnit,
            cUnit: cUnit,
            totalCli: totalCli,
            totalCosto: totalCosto,
            ganancia: totalCli - totalCosto,
        };
    }
    function calcMoItem(it) {
        var pVentaUnit = num(it.precioLista) * (1 - num(it.descuentoVenta) / 100);
        var totalCli = num(it.cantidad) * pVentaUnit;
        return {
            pVentaUnit: pVentaUnit,
            totalCli: totalCli,
            totalCosto: 0,
            ganancia: totalCli,
        };
    }
    function calcCmoItem(it) {
        var concentrado = num(it.cantidad) * num(it.costoUnitario);
        var totalCosto = concentrado * num(it.dias);
        return {
            concentrado: concentrado,
            totalCli: 0,
            totalCosto: totalCosto,
            ganancia: -totalCosto,
        };
    }
    function calcGastoItem(it) {
        var totalCosto = num(it.cantidad) * num(it.costoUnitario);
        return {
            totalCli: 0,
            totalCosto: totalCosto,
            ganancia: -totalCosto,
        };
    }
    function calcItem(sec, it) {
        switch (sec.tipo) {
            case 'equipamiento': return calcEquipItem(it);
            case 'mano_obra':    return calcMoItem(it);
            case 'costo_mo':     return calcCmoItem(it);
            case 'gastos':       return calcGastoItem(it);
        }
        return { totalCli: 0, totalCosto: 0, ganancia: 0 };
    }

    function calcSection(sec) {
        var totalCli = 0, totalCosto = 0, ganancia = 0;
        var nItems = 0;
        (sec.items || []).forEach(function (it) {
            if (it.row_type === 'header') return;
            var c = calcItem(sec, it);
            totalCli += c.totalCli;
            totalCosto += c.totalCosto;
            ganancia += c.ganancia;
            nItems++;
        });
        return { totalCli: totalCli, totalCosto: totalCosto,
                 ganancia: ganancia, nItems: nItems };
    }

    function calcTotals() {
        var subtotalVenta = 0, totalCosto = 0;
        (S.data.secciones || []).forEach(function (sec) {
            var t = calcSection(sec);
            subtotalVenta += t.totalCli;
            totalCosto += t.totalCosto;
        });
        var ganancia = subtotalVenta - totalCosto;
        var margen = subtotalVenta > 0 ? (ganancia / subtotalVenta) * 100 : 0;
        var iva_pct = num(S.volumetria && S.volumetria.iva_pct);
        var iva = iva_pct > 0 ? subtotalVenta * (iva_pct / 100) : 0;
        var totalConIva = subtotalVenta + iva;
        return {
            subtotalVenta: subtotalVenta,
            totalCosto: totalCosto,
            ganancia: ganancia,
            margen: margen,
            iva_pct: iva_pct,
            iva: iva,
            totalConIva: totalConIva,
        };
    }

    function calcStats() {
        var secs = (S.data.secciones || []);
        var total = 0;
        var byTipo = { equipamiento: 0, mano_obra: 0, costo_mo: 0, gastos: 0 };
        secs.forEach(function (sec) {
            (sec.items || []).forEach(function (it) {
                if (it.row_type === 'header') return;
                total++;
                if (byTipo[sec.tipo] != null) byTipo[sec.tipo]++;
            });
        });
        return { tablas: secs.length, items: total, byTipo: byTipo };
    }

    // ── SVG icons ───────────────────────────────────────────────────
    var ICON = {
        chevronDown: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
        chevronRight: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>',
        plus: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        trash: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
        x: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        upload: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
        tag: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
        building: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>',
        user: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        calendar: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        coins: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/><path d="M12 18V6"/></svg>',
        percent: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
        edit: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>',
        fileText: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
        sheet: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
    };

    // ── RENDER ──────────────────────────────────────────────────────
    function render() {
        if (!S.container) return;

        var html = '<div class="cv-root' + (S.readonly ? ' cv-readonly' : '') + '">';
        html += renderDocHeader();
        html += '<div class="cv-stack">';
        (S.data.secciones || []).forEach(function (sec) {
            html += renderSection(sec);
        });
        html += '</div>';
        if (!S.readonly) html += renderAddSectionWrap();
        html += renderBottom();
        html += '</div>';

        S.container.innerHTML = html;
        bindAll();
    }

    // ── Document header ─────────────────────────────────────────────
    function renderDocHeader() {
        var meta = S.data.meta || {};
        var nombre = (S.volumetria && S.volumetria.nombre) || '';
        var disabled = S.readonly ? 'disabled' : '';

        var tcVal = S.volumetria && S.volumetria.tipo_cambio != null ? S.volumetria.tipo_cambio : '';
        var ivaVal = S.volumetria && S.volumetria.iva_pct != null ? S.volumetria.iva_pct : '';

        var status = (S.volumetria && S.volumetria.status) || 'borrador';
        var statusLabel = status === 'completada' ? 'Completada' : 'Borrador';
        var statusCls = 'cv-status cv-status-' + status;
        var statusBtn;
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
        h += metaField('cliente',  ICON.building, 'Cliente',        meta.cliente,  'ALLEGION ENSENADA');
        h += metaField('contacto', ICON.user,     'Contacto',       meta.contacto, 'Ing. Ricardo Sandoval');
        h += metaField('elaboro',  ICON.edit,     'Elaboró',        meta.elaboro,  'Jose Manuel');
        h += metaField('fecha',    ICON.calendar, 'Fecha',          meta.fecha,    '',  'date');
        h += metaField('tc',       ICON.coins,    'Tipo de cambio', tcVal,         '19.50', 'number');
        h += metaField('iva',      ICON.percent,  'IVA %',          ivaVal,        '16',    'number');
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

    // ── Sección (banner + tabla) ────────────────────────────────────
    function renderSection(sec) {
        var open = sec.expanded !== false;
        var info = TYPE_INFO[sec.tipo] || TYPE_INFO.equipamiento;
        var cls = 'cv-section cv-section-' + sec.tipo + (open ? '' : ' cv-section-collapsed');

        var h = '<section class="' + cls + '" data-section="' + esc(sec.id) + '" data-tipo="' + esc(sec.tipo) + '">';

        // Banner
        h += '<header class="cv-section-banner">';
        h += '<div class="cv-section-banner-left">';
        h += '<button type="button" class="cv-section-toggle" data-action="toggle-section" data-section="' + esc(sec.id) + '" aria-label="Expandir/colapsar">' +
             '<span class="cv-chevron">' + (open ? ICON.chevronDown : ICON.chevronRight) + '</span>' +
             '</button>';
        h += '<span class="cv-section-icon">' + info.icon + '</span>';
        var titDisabled = S.readonly ? 'disabled' : '';
        h += '<input type="text" class="cv-section-title-input" data-section="' + esc(sec.id) + '" ' +
             'value="' + esc(sec.titulo || '') + '" placeholder="' + esc(info.defaultTitle) + '" ' + titDisabled + ' />';
        h += '</div>';

        if (!S.readonly) {
            h += '<div class="cv-section-actions">';
            h += '<button type="button" class="cv-btn cv-btn-add-row" data-action="add-row" data-section="' + esc(sec.id) + '">' +
                 ICON.plus + '<span>Fila</span></button>';
            if (sec.tipo === 'equipamiento') {
                h += '<button type="button" class="cv-btn cv-btn-add-header" data-action="add-header" data-section="' + esc(sec.id) + '">' +
                     ICON.tag + '<span>Rótulo</span></button>';
            }
            h += '<button type="button" class="cv-btn cv-btn-del-section" data-action="del-section" data-section="' + esc(sec.id) + '" title="Eliminar tabla">' +
                 ICON.trash + '</button>';
            h += '</div>';
        }
        h += '</header>';

        if (open) {
            h += renderTable(sec);
        }
        h += '</section>';
        return h;
    }

    // ── Tabla (HTML <table> real) ───────────────────────────────────
    function renderTable(sec) {
        var h = '<div class="cv-table-wrap">';
        h += '<table class="cv-table cv-table-' + sec.tipo + '">';
        h += renderThead(sec);
        h += '<tbody class="cv-tbody">';
        var items = sec.items || [];
        if (!items.length) {
            var span = colCountForTipo(sec.tipo);
            h += '<tr class="cv-tr cv-tr-empty"><td class="cv-td cv-empty" colspan="' + span + '">Sin items. ' +
                 (S.readonly ? '' : 'Usa &laquo;+ Fila&raquo; para agregar.') + '</td></tr>';
        }
        items.forEach(function (it, idx) {
            h += renderRow(sec, it, idx);
        });
        h += '</tbody>';
        h += renderTfoot(sec);
        h += '</table>';
        h += '</div>';
        return h;
    }

    function colCountForTipo(tipo) {
        switch (tipo) {
            case 'equipamiento': return 16;  // # + 14 + acción
            case 'mano_obra':    return 10;  // # + 8 + acción
            case 'costo_mo':     return 8;   // # + 6 + acción
            case 'gastos':       return 7;   // # + 5 + acción
        }
        return 6;
    }

    // ── Headers (groups + cols) ─────────────────────────────────────
    function renderThead(sec) {
        switch (sec.tipo) {
            case 'equipamiento': return renderTheadEquipamiento();
            case 'mano_obra':    return renderTheadManoObra();
            case 'costo_mo':     return renderTheadCostoMo();
            case 'gastos':       return renderTheadGastos();
        }
        return '';
    }

    function renderTheadEquipamiento() {
        // Grupos: # | INFO CLIENTE (8 cols hasta Total Cliente) | COSTOS Y MÁRGENES (4) | ACCIONES (Prov + Entrega + Notas) | x
        // Columnas exactas (15 datos): # · Marca · No.Parte · Cant · Descripción · P.Lista · %V · P.Unit · Total Cliente · %C · C.Unit · Total Costo · Ganancia · Proveedor · Entrega · Notas · [del]
        // Para mantener el espec del usuario (INFO CLIENTE 8 / COSTOS 4 / ACCIONES 3) — agrupamos:
        //   INFO CLIENTE = Marca, NoP, Cant, Descripción, P.Lista, %V, P.Unit, Total Cliente (8)
        //   COSTOS Y MÁRGENES = %C, C.Unit, Total Costo, Ganancia (4)
        //   ACCIONES = Proveedor, Entrega, Notas (3)
        var h = '<thead class="cv-thead">';
        // Fila 1: bandas de grupo
        h += '<tr class="cv-thead-groups">';
        h += '<th class="cv-th-group cv-th-group-empty"></th>';
        h += '<th class="cv-th-group cv-th-group-info" colspan="8">INFORMACIÓN DEL CLIENTE</th>';
        h += '<th class="cv-th-group cv-th-group-costos" colspan="4">COSTOS Y MÁRGENES</th>';
        h += '<th class="cv-th-group cv-th-group-acciones" colspan="3">ACCIONES Y NOTAS</th>';
        h += '<th class="cv-th-group cv-th-group-empty"></th>';
        h += '</tr>';
        // Fila 2: cabeceras de columna
        h += '<tr class="cv-thead-cols">';
        h += '<th class="cv-th cv-th-num cv-th-idx">#</th>';
        h += '<th class="cv-th cv-th-text">Marca</th>';
        h += '<th class="cv-th cv-th-text">No. Parte</th>';
        h += '<th class="cv-th cv-th-num">Cant</th>';
        h += '<th class="cv-th cv-th-text cv-th-desc">Descripción</th>';
        h += '<th class="cv-th cv-th-num">P. Lista</th>';
        h += '<th class="cv-th cv-th-num">% V</th>';
        h += '<th class="cv-th cv-th-num">P. Unit</th>';
        h += '<th class="cv-th cv-th-num">Total Cliente</th>';
        h += '<th class="cv-th cv-th-num">% C</th>';
        h += '<th class="cv-th cv-th-num">C. Unit</th>';
        h += '<th class="cv-th cv-th-num">Total Costo</th>';
        h += '<th class="cv-th cv-th-num">Ganancia</th>';
        h += '<th class="cv-th cv-th-text">Proveedor</th>';
        h += '<th class="cv-th cv-th-text">Entrega</th>';
        h += '<th class="cv-th cv-th-text">Notas</th>';
        h += '<th class="cv-th cv-th-act"></th>';
        h += '</tr>';
        h += '</thead>';
        return h;
    }

    function renderTheadManoObra() {
        var h = '<thead class="cv-thead">';
        h += '<tr class="cv-thead-groups">';
        h += '<th class="cv-th-group cv-th-group-empty"></th>';
        h += '<th class="cv-th-group cv-th-group-info" colspan="7">INFORMACIÓN DEL CLIENTE</th>';
        h += '<th class="cv-th-group cv-th-group-acciones" colspan="1">NOTAS</th>';
        h += '<th class="cv-th-group cv-th-group-empty"></th>';
        h += '</tr>';
        h += '<tr class="cv-thead-cols">';
        h += '<th class="cv-th cv-th-num cv-th-idx">#</th>';
        h += '<th class="cv-th cv-th-text">Marca</th>';
        h += '<th class="cv-th cv-th-text">No. Parte</th>';
        h += '<th class="cv-th cv-th-num">Cant</th>';
        h += '<th class="cv-th cv-th-text cv-th-desc">Descripción</th>';
        h += '<th class="cv-th cv-th-num">P. Lista</th>';
        h += '<th class="cv-th cv-th-num">% V</th>';
        h += '<th class="cv-th cv-th-num">P. Unit</th>';
        h += '<th class="cv-th cv-th-num">Total</th>';
        h += '<th class="cv-th cv-th-text">Notas</th>';
        h += '<th class="cv-th cv-th-act"></th>';
        h += '</tr>';
        h += '</thead>';
        return h;
    }

    function renderTheadCostoMo() {
        var h = '<thead class="cv-thead">';
        h += '<tr class="cv-thead-groups">';
        h += '<th class="cv-th-group cv-th-group-empty"></th>';
        h += '<th class="cv-th-group cv-th-group-costos" colspan="6">RECURSO INTERNO</th>';
        h += '<th class="cv-th-group cv-th-group-empty"></th>';
        h += '</tr>';
        h += '<tr class="cv-thead-cols">';
        h += '<th class="cv-th cv-th-num cv-th-idx">#</th>';
        h += '<th class="cv-th cv-th-text cv-th-desc">Recurso</th>';
        h += '<th class="cv-th cv-th-num">Cant</th>';
        h += '<th class="cv-th cv-th-num">Costo Unit</th>';
        h += '<th class="cv-th cv-th-num">Concentrado</th>';
        h += '<th class="cv-th cv-th-num">Días</th>';
        h += '<th class="cv-th cv-th-num">Total</th>';
        h += '<th class="cv-th cv-th-act"></th>';
        h += '</tr>';
        h += '</thead>';
        return h;
    }

    function renderTheadGastos() {
        var h = '<thead class="cv-thead">';
        h += '<tr class="cv-thead-groups">';
        h += '<th class="cv-th-group cv-th-group-empty"></th>';
        h += '<th class="cv-th-group cv-th-group-costos" colspan="5">CONCEPTO DE GASTO</th>';
        h += '<th class="cv-th-group cv-th-group-empty"></th>';
        h += '</tr>';
        h += '<tr class="cv-thead-cols">';
        h += '<th class="cv-th cv-th-num cv-th-idx">#</th>';
        h += '<th class="cv-th cv-th-num">Cant</th>';
        h += '<th class="cv-th cv-th-text">Unidad</th>';
        h += '<th class="cv-th cv-th-text cv-th-desc">Descripción</th>';
        h += '<th class="cv-th cv-th-num">Costo Unit</th>';
        h += '<th class="cv-th cv-th-num">Total</th>';
        h += '<th class="cv-th cv-th-act"></th>';
        h += '</tr>';
        h += '</thead>';
        return h;
    }

    // ── Filas ───────────────────────────────────────────────────────
    function renderRow(sec, it, idx) {
        if (sec.tipo === 'equipamiento' && it.row_type === 'header') {
            return renderEquipHeaderRow(sec, it, idx);
        }
        switch (sec.tipo) {
            case 'equipamiento': return renderEquipRow(sec, it, idx);
            case 'mano_obra':    return renderMoRow(sec, it, idx);
            case 'costo_mo':     return renderCmoRow(sec, it, idx);
            case 'gastos':       return renderGastoRow(sec, it, idx);
        }
        return '';
    }

    function rowAttrs(sec, it) {
        return 'data-section="' + esc(sec.id) + '" data-item="' + esc(it.id) + '"';
    }

    function inputNum(sec, it, field, value, opts) {
        opts = opts || {};
        var disabled = S.readonly ? 'disabled' : '';
        var v = (value == null || value === '') ? '' : value;
        var cls = 'cv-input cv-input-num';
        if (opts.mono !== false) cls += ' cv-mono';
        var ph = opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '';
        return '<input type="number" step="any" class="' + cls + '" ' +
               'data-field="' + field + '" data-section="' + esc(sec.id) + '" ' +
               'data-item="' + esc(it.id) + '" value="' + esc(v) + '" ' + ph + ' ' + disabled + ' />';
    }
    function inputText(sec, it, field, value, opts) {
        opts = opts || {};
        var disabled = S.readonly ? 'disabled' : '';
        var v = value == null ? '' : value;
        var cls = 'cv-input cv-input-text';
        if (opts.mono) cls += ' cv-mono';
        var ph = opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '';
        return '<input type="text" class="' + cls + '" ' +
               'data-field="' + field + '" data-section="' + esc(sec.id) + '" ' +
               'data-item="' + esc(it.id) + '" value="' + esc(v) + '"' + ph + ' ' + disabled + ' />';
    }

    function renderEquipHeaderRow(sec, it, idx) {
        var disabled = S.readonly ? 'disabled' : '';
        var h = '<tr class="cv-tr cv-tr-header" ' + rowAttrs(sec, it) + ' data-row-type="header">';
        h += '<td class="cv-td cv-td-num cv-td-idx">' + (idx + 1) + '</td>';
        h += '<td class="cv-td cv-td-rotulo" colspan="15">';
        h += '<input type="text" class="cv-input cv-input-rotulo" ' +
             'data-field="texto" data-section="' + esc(sec.id) + '" ' +
             'data-item="' + esc(it.id) + '" value="' + esc(it.texto || '') + '" ' +
             'placeholder="Rótulo (ej. Escalerilla 100mm IDF3)" ' + disabled + ' />';
        h += '</td>';
        h += renderDelCell(sec, it);
        h += '</tr>';
        return h;
    }

    function renderEquipRow(sec, it, idx) {
        var c = calcEquipItem(it);
        var h = '<tr class="cv-tr" ' + rowAttrs(sec, it) + '>';
        h += '<td class="cv-td cv-td-num cv-td-idx">' + (idx + 1) + '</td>';
        h += '<td class="cv-td cv-td-text">' + inputText(sec, it, 'marca', it.marca) + '</td>';
        h += '<td class="cv-td cv-td-text">' + inputText(sec, it, 'parte', it.parte, { mono: true }) + '</td>';
        h += '<td class="cv-td cv-td-num">' + inputNum(sec, it, 'cantidad', it.cantidad) + '</td>';
        h += '<td class="cv-td cv-td-text cv-td-desc">' + inputText(sec, it, 'descripcion', it.descripcion) + '</td>';
        h += '<td class="cv-td cv-td-num">' + inputNum(sec, it, 'precioLista', it.precioLista) + '</td>';
        h += '<td class="cv-td cv-td-num">' + inputNum(sec, it, 'descuentoVenta', it.descuentoVenta) + '</td>';
        h += '<td class="cv-td cv-td-calc cv-td-mono" data-calc="pVentaUnit" ' + rowAttrs(sec, it) + '>' +
             esc(fmtMoney(c.pVentaUnit)) + '</td>';
        h += '<td class="cv-td cv-td-calc cv-td-mono cv-td-total" data-calc="totalCli" ' + rowAttrs(sec, it) + '>' +
             esc(fmtMoney(c.totalCli)) + '</td>';
        h += '<td class="cv-td cv-td-num">' + inputNum(sec, it, 'descuentoCosto', it.descuentoCosto) + '</td>';
        // C. Unit: si el usuario tipea, override; vacío = usa descuentoCosto.
        h += '<td class="cv-td cv-td-num">' +
             '<input type="number" step="any" class="cv-input cv-input-num cv-mono" ' +
             'data-field="costoUnitario" data-section="' + esc(sec.id) + '" ' +
             'data-item="' + esc(it.id) + '" placeholder="' + esc(fmtPlain(c.cUnit)) + '" ' +
             'value="' + esc(it.costoUnitario != null ? it.costoUnitario : '') + '" ' +
             (S.readonly ? 'disabled' : '') + ' />' +
             '</td>';
        h += '<td class="cv-td cv-td-calc cv-td-mono" data-calc="totalCosto" ' + rowAttrs(sec, it) + '>' +
             esc(fmtMoney(c.totalCosto)) + '</td>';
        var gainCls = c.ganancia >= 0 ? 'cv-td-positive' : 'cv-td-negative';
        h += '<td class="cv-td cv-td-calc cv-td-mono ' + gainCls + '" data-calc="ganancia" ' + rowAttrs(sec, it) + '>' +
             esc(fmtMoney(c.ganancia)) + '</td>';
        h += '<td class="cv-td cv-td-text">' + inputText(sec, it, 'proveedor', it.proveedor) + '</td>';
        h += '<td class="cv-td cv-td-text">' + inputText(sec, it, 'entrega', it.entrega) + '</td>';
        h += '<td class="cv-td cv-td-text">' + inputText(sec, it, 'notas', it.notas) + '</td>';
        h += renderDelCell(sec, it);
        h += '</tr>';
        return h;
    }

    function renderMoRow(sec, it, idx) {
        var c = calcMoItem(it);
        var h = '<tr class="cv-tr" ' + rowAttrs(sec, it) + '>';
        h += '<td class="cv-td cv-td-num cv-td-idx">' + (idx + 1) + '</td>';
        h += '<td class="cv-td cv-td-text">' + inputText(sec, it, 'marca', it.marca) + '</td>';
        h += '<td class="cv-td cv-td-text">' + inputText(sec, it, 'parte', it.parte, { mono: true }) + '</td>';
        h += '<td class="cv-td cv-td-num">' + inputNum(sec, it, 'cantidad', it.cantidad) + '</td>';
        h += '<td class="cv-td cv-td-text cv-td-desc">' + inputText(sec, it, 'descripcion', it.descripcion) + '</td>';
        h += '<td class="cv-td cv-td-num">' + inputNum(sec, it, 'precioLista', it.precioLista) + '</td>';
        h += '<td class="cv-td cv-td-num">' + inputNum(sec, it, 'descuentoVenta', it.descuentoVenta) + '</td>';
        h += '<td class="cv-td cv-td-calc cv-td-mono" data-calc="pVentaUnit" ' + rowAttrs(sec, it) + '>' +
             esc(fmtMoney(c.pVentaUnit)) + '</td>';
        h += '<td class="cv-td cv-td-calc cv-td-mono cv-td-total" data-calc="totalCli" ' + rowAttrs(sec, it) + '>' +
             esc(fmtMoney(c.totalCli)) + '</td>';
        h += '<td class="cv-td cv-td-text">' + inputText(sec, it, 'notas', it.notas) + '</td>';
        h += renderDelCell(sec, it);
        h += '</tr>';
        return h;
    }

    function renderCmoRow(sec, it, idx) {
        var c = calcCmoItem(it);
        var h = '<tr class="cv-tr" ' + rowAttrs(sec, it) + '>';
        h += '<td class="cv-td cv-td-num cv-td-idx">' + (idx + 1) + '</td>';
        h += '<td class="cv-td cv-td-text cv-td-desc">' + inputText(sec, it, 'recurso', it.recurso) + '</td>';
        h += '<td class="cv-td cv-td-num">' + inputNum(sec, it, 'cantidad', it.cantidad) + '</td>';
        h += '<td class="cv-td cv-td-num">' + inputNum(sec, it, 'costoUnitario', it.costoUnitario) + '</td>';
        h += '<td class="cv-td cv-td-calc cv-td-mono" data-calc="concentrado" ' + rowAttrs(sec, it) + '>' +
             esc(fmtMoney(c.concentrado)) + '</td>';
        h += '<td class="cv-td cv-td-num">' + inputNum(sec, it, 'dias', it.dias) + '</td>';
        h += '<td class="cv-td cv-td-calc cv-td-mono cv-td-total" data-calc="totalCosto" ' + rowAttrs(sec, it) + '>' +
             esc(fmtMoney(c.totalCosto)) + '</td>';
        h += renderDelCell(sec, it);
        h += '</tr>';
        return h;
    }

    function renderGastoRow(sec, it, idx) {
        var c = calcGastoItem(it);
        var h = '<tr class="cv-tr" ' + rowAttrs(sec, it) + '>';
        h += '<td class="cv-td cv-td-num cv-td-idx">' + (idx + 1) + '</td>';
        h += '<td class="cv-td cv-td-num">' + inputNum(sec, it, 'cantidad', it.cantidad) + '</td>';
        h += '<td class="cv-td cv-td-text">' + inputText(sec, it, 'unidad', it.unidad) + '</td>';
        h += '<td class="cv-td cv-td-text cv-td-desc">' + inputText(sec, it, 'descripcion', it.descripcion) + '</td>';
        h += '<td class="cv-td cv-td-num">' + inputNum(sec, it, 'costoUnitario', it.costoUnitario) + '</td>';
        h += '<td class="cv-td cv-td-calc cv-td-mono cv-td-total" data-calc="totalCosto" ' + rowAttrs(sec, it) + '>' +
             esc(fmtMoney(c.totalCosto)) + '</td>';
        h += renderDelCell(sec, it);
        h += '</tr>';
        return h;
    }

    function renderDelCell(sec, it) {
        if (S.readonly) return '<td class="cv-td cv-td-act"></td>';
        return '<td class="cv-td cv-td-act">' +
               '<button type="button" class="cv-row-del" data-action="del-item" ' +
               'data-section="' + esc(sec.id) + '" data-item="' + esc(it.id) + '" ' +
               'title="Eliminar fila">' + ICON.x + '</button>' +
               '</td>';
    }

    // ── Footer (totales por sección) ────────────────────────────────
    function renderTfoot(sec) {
        var t = calcSection(sec);
        var h = '<tfoot class="cv-tfoot">';
        h += '<tr class="cv-tfoot-tr">';

        if (sec.tipo === 'equipamiento') {
            // Span: idx (1) + 7 cols hasta antes de Total Cliente
            h += '<td class="cv-tfoot-label" colspan="8">TOTALES</td>';
            h += '<td class="cv-tfoot-value cv-mono">' + esc(fmtMoney(t.totalCli)) + '</td>';
            h += '<td colspan="2"></td>';
            h += '<td class="cv-tfoot-value cv-mono">' + esc(fmtMoney(t.totalCosto)) + '</td>';
            var gCls = t.ganancia >= 0 ? 'cv-td-positive' : 'cv-td-negative';
            h += '<td class="cv-tfoot-value cv-mono ' + gCls + '">' + esc(fmtMoney(t.ganancia)) + '</td>';
            h += '<td colspan="3"></td>';
            h += '<td></td>';
        } else if (sec.tipo === 'mano_obra') {
            // 1 (idx) + 7 = 8 cols antes de Total
            h += '<td class="cv-tfoot-label" colspan="8">TOTAL MANO DE OBRA</td>';
            h += '<td class="cv-tfoot-value cv-mono">' + esc(fmtMoney(t.totalCli)) + '</td>';
            h += '<td colspan="2"></td>';
        } else if (sec.tipo === 'costo_mo') {
            // 1 (idx) + 5 = 6 cols antes de Total
            h += '<td class="cv-tfoot-label" colspan="6">TOTAL COSTO MO</td>';
            h += '<td class="cv-tfoot-value cv-mono">' + esc(fmtMoney(t.totalCosto)) + '</td>';
            h += '<td></td>';
        } else if (sec.tipo === 'gastos') {
            // 1 (idx) + 4 = 5 cols antes de Total
            h += '<td class="cv-tfoot-label" colspan="5">TOTAL GASTOS</td>';
            h += '<td class="cv-tfoot-value cv-mono">' + esc(fmtMoney(t.totalCosto)) + '</td>';
            h += '<td></td>';
        }

        h += '</tr>';
        h += '</tfoot>';
        return h;
    }

    function fmtPlain(n) {
        return num(n).toFixed(2);
    }

    // ── Add section dropdown ────────────────────────────────────────
    function renderAddSectionWrap() {
        var h = '<div class="cv-add-section-wrap' + (S.addMenuOpen ? ' cv-add-section-open' : '') + '">';
        h += '<button type="button" class="cv-add-section" data-action="toggle-add-menu">' +
             ICON.plus + '<span>Agregar tabla</span>' +
             '<span class="cv-add-section-caret">' + ICON.chevronDown + '</span>' +
             '</button>';
        if (S.addMenuOpen) {
            h += '<div class="cv-add-section-menu" role="menu">';
            SECTION_TYPES.forEach(function (t) {
                var info = TYPE_INFO[t];
                h += '<button type="button" class="cv-add-section-item" data-action="add-section" data-tipo="' + t + '">' +
                     '<span class="cv-add-section-icon cv-add-section-icon-' + t + '">' + info.icon + '</span>' +
                     '<span>' + esc(info.label) + '</span>' +
                     '</button>';
            });
            h += '</div>';
        }
        h += '</div>';
        return h;
    }

    // ── Bottom: Resumen + Estadísticas ──────────────────────────────
    function renderBottom() {
        var h = '<div class="cv-bottom">';
        h += renderFinanciero();
        h += renderStats();
        h += '</div>';
        return h;
    }

    function renderFinanciero() {
        var t = calcTotals();
        var tc = num(S.volumetria && S.volumetria.tipo_cambio);
        var marginCls = 'cv-fin-row cv-fin-row-margin' + (t.margen < 20 ? ' cv-fin-row-margin-low' : '');

        var h = '<aside class="cv-card cv-card-financiero">';
        h += '<div class="cv-card-header"><div class="cv-card-title">Resumen Financiero</div></div>';
        h += '<div class="cv-card-body">';
        h += finRow('Subtotal venta', fmtMoney(t.subtotalVenta), 'cv-fin-row');
        h += finRow('Costo total',    fmtMoney(t.totalCosto),    'cv-fin-row cv-fin-row-cost');
        h += finRow('Ganancia',       fmtMoney(t.ganancia),      'cv-fin-row cv-fin-row-gain');
        h += finRow('Margen',         fmtPct(t.margen),          marginCls);

        h += '<div class="cv-fin-sep"></div>';

        if (t.iva_pct > 0) {
            h += finRow('IVA (' + fmtPct(t.iva_pct) + ')', fmtMoney(t.iva), 'cv-fin-row cv-fin-row-iva');
            h += finRow('Total con IVA', fmtMoney(t.totalConIva), 'cv-fin-row cv-fin-row-total');
        } else {
            h += finRow('Total cotización', fmtMoney(t.subtotalVenta), 'cv-fin-row cv-fin-row-total');
        }

        if (tc > 0) {
            var usdSubtotal = t.subtotalVenta / tc;
            var usdTotal = t.totalConIva / tc;
            h += '<div class="cv-fin-foot">';
            h += '<span class="cv-fin-label">En USD @ ' + esc(tc.toFixed(2)) + '</span>';
            h += '<span class="cv-fin-value cv-mono">$' + esc(usdSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) +
                 (t.iva_pct > 0 ? ' &middot; c/IVA $' + esc(usdTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : '') +
                 '</span>';
            h += '</div>';
        }

        h += '</div>';
        h += '</aside>';
        return h;
    }

    function finRow(label, value, cls) {
        return '<div class="' + cls + '">' +
               '<span class="cv-fin-label">' + esc(label) + '</span>' +
               '<span class="cv-fin-value cv-mono">' + esc(value) + '</span>' +
               '</div>';
    }

    function renderStats() {
        var s = calcStats();
        var status = (S.volumetria && S.volumetria.status) || 'borrador';
        var statusLabel = status === 'completada' ? 'Completada' : 'Borrador';

        var h = '<aside class="cv-card cv-card-stats">';
        h += '<div class="cv-card-header"><div class="cv-card-title">Resumen de Estadísticas</div></div>';
        h += '<div class="cv-card-body">';

        h += '<div class="cv-stat-row">';
        h += '<span class="cv-stat-label">Tablas activas</span>';
        h += '<span class="cv-stat-value cv-mono">' + s.tablas + '</span>';
        h += '</div>';

        h += '<div class="cv-stat-row">';
        h += '<span class="cv-stat-label">Total items</span>';
        h += '<span class="cv-stat-value cv-mono">' + s.items + '</span>';
        h += '</div>';

        h += '<div class="cv-stat-row">';
        h += '<span class="cv-stat-label">Por tipo</span>';
        h += '<span class="cv-stat-pills">';
        SECTION_TYPES.forEach(function (t) {
            if (s.byTipo[t] > 0) {
                h += '<span class="cv-stat-pill cv-stat-pill-' + t + '">' +
                     esc(TYPE_INFO[t].label) + ' &middot; ' + s.byTipo[t] + '</span>';
            }
        });
        if (s.items === 0) h += '<span class="cv-stat-label cv-mono">—</span>';
        h += '</span>';
        h += '</div>';

        h += '<div class="cv-fin-sep"></div>';

        h += '<div class="cv-stat-row">';
        h += '<span class="cv-stat-label">Estado</span>';
        h += '<span class="cv-status cv-status-' + status + '"><span class="cv-status-dot"></span>' +
             '<span class="cv-status-label">' + esc(statusLabel) + '</span></span>';
        h += '</div>';

        h += '<div class="cv-card-actions">';
        h += '<button type="button" class="cv-export-btn" data-action="export-pdf">' +
             ICON.fileText + '<span>Exportar PDF</span></button>';
        h += '<button type="button" class="cv-export-btn" data-action="export-xlsx">' +
             ICON.sheet + '<span>Exportar Excel</span></button>';
        h += '</div>';

        h += '</div>';
        h += '</aside>';
        return h;
    }

    // ── Bind ────────────────────────────────────────────────────────
    function bindAll() {
        if (!S.container) return;

        S.container.querySelectorAll('[data-meta]').forEach(function (inp) {
            inp.addEventListener('input', onMetaInput);
            inp.addEventListener('change', onMetaInput);
        });

        S.container.querySelectorAll('.cv-section-title-input').forEach(function (inp) {
            inp.addEventListener('input', onSectionTitleInput);
        });

        S.container.querySelectorAll('.cv-tbody [data-field], .cv-tr-header [data-field]').forEach(function (inp) {
            inp.addEventListener('input', onItemInput);
            inp.addEventListener('change', onItemInput);
            inp.addEventListener('blur', onItemBlur);
        });

        // Click delegation
        S.container.addEventListener('click', onContainerClick);
    }

    function unbindAll() {
        if (!S.container) return;
        try { S.container.removeEventListener('click', onContainerClick); } catch (_) {}
        if (S.outsideClickHandler) {
            try { document.removeEventListener('click', S.outsideClickHandler); } catch (_) {}
            S.outsideClickHandler = null;
        }
    }

    // ── Event handlers ──────────────────────────────────────────────
    function onContainerClick(ev) {
        var btn = ev.target.closest && ev.target.closest('[data-action]');
        if (!btn || !S.container.contains(btn)) return;
        var action = btn.getAttribute('data-action');
        var secId = btn.getAttribute('data-section');
        var itemId = btn.getAttribute('data-item');
        var tipo = btn.getAttribute('data-tipo');

        if (action === 'toggle-section') {
            ev.preventDefault();
            toggleSection(secId);
        } else if (action === 'add-row') {
            if (S.readonly) return;
            ev.preventDefault();
            addRow(secId);
        } else if (action === 'add-header') {
            if (S.readonly) return;
            ev.preventDefault();
            addHeaderRow(secId);
        } else if (action === 'toggle-add-menu') {
            if (S.readonly) return;
            ev.preventDefault();
            ev.stopPropagation();
            toggleAddMenu();
        } else if (action === 'add-section') {
            if (S.readonly) return;
            ev.preventDefault();
            addSection(tipo || 'equipamiento');
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
            if (typeof window.lwP3ToggleStatus === 'function') {
                window.lwP3ToggleStatus();
            }
        } else if (action === 'export-pdf') {
            ev.preventDefault();
            log('TODO: export-pdf');
            try { alert('Próximamente: exportación a PDF'); } catch (_) {}
        } else if (action === 'export-xlsx') {
            ev.preventDefault();
            log('TODO: export-xlsx');
            try { alert('Próximamente: exportación a Excel'); } catch (_) {}
        }
    }

    function onMetaInput(ev) {
        if (S.readonly) return;
        var inp = ev.target;
        var key = inp.getAttribute('data-meta');
        var val = inp.value;

        if (key === 'nombre') {
            if (S.volumetria) S.volumetria.nombre = val;
            S.data.meta._nombre = val;
            scheduleMetaSave({ nombre: val });
            scheduleAutosave();
            return;
        }
        if (key === 'tc') {
            var tc = num(val);
            if (S.volumetria) S.volumetria.tipo_cambio = tc;
            scheduleMetaSave({ tipo_cambio: tc });
            updateBottom();
            return;
        }
        if (key === 'iva') {
            var iv = num(val);
            if (S.volumetria) S.volumetria.iva_pct = iv;
            scheduleMetaSave({ iva_pct: iv });
            updateBottom();
            return;
        }
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
        var sec = findSection(secId);
        var it = findItem(secId, itemId);
        if (!sec || !it) return;

        var raw = inp.value;
        var isNum = inp.type === 'number';

        if (isNum) {
            // costoUnitario admite "vacío" como null (usar descuentoCosto)
            if (field === 'costoUnitario' && raw === '') {
                it[field] = null;
            } else if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
                it[field] = field === 'costoUnitario' ? null : 0;
            } else {
                it[field] = num(raw);
            }
        } else {
            it[field] = raw;
        }

        // Re-render localizado: solo si afecta cálculos.
        if (sec.tipo === 'equipamiento' && it.row_type === 'header') {
            // texto del rótulo: no toca cálculos, ni tabla.
        } else if (isNum || field === 'costoUnitario') {
            updateRowCalcs(sec, it);
            updateSectionTfoot(sec);
            updateBottom();
        }

        scheduleAutosave();
    }

    function onItemBlur(ev) {
        if (S.readonly) return;
        var inp = ev.target;
        var field = inp.getAttribute('data-field');
        if (!field) return;
        if (inp.type !== 'number') return;
        // costoUnitario: si null, dejamos vacío (mostraremos placeholder con el calc)
        var secId = inp.getAttribute('data-section');
        var itemId = inp.getAttribute('data-item');
        var sec = findSection(secId);
        var it = findItem(secId, itemId);
        if (!sec || !it) return;
        if (field === 'costoUnitario') {
            // refrescar el placeholder con el c.unit calc actual
            var c = calcEquipItem(it);
            inp.placeholder = fmtPlain(c.cUnit);
            return;
        }
        var n = num(inp.value);
        if (String(n) !== inp.value) inp.value = n === 0 ? '' : String(n);
    }

    // ── Operaciones sobre el data ──────────────────────────────────
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
        rerenderSection(sec);
        scheduleAutosave();
    }

    function addRow(secId) {
        var sec = findSection(secId);
        if (!sec) return;
        sec.items.push(newItemForType(sec.tipo));
        sec.expanded = true;
        rerenderSection(sec);
        // Foco al primer input editable de la fila nueva
        var rows = S.container.querySelectorAll(
            'section[data-section="' + cssEsc(secId) + '"] .cv-tbody .cv-tr'
        );
        var last = rows[rows.length - 1];
        if (last) {
            var first = last.querySelector('input.cv-input');
            if (first) try { first.focus(); first.select && first.select(); } catch (_) {}
        }
        scheduleAutosave();
        updateBottom();
    }

    function addHeaderRow(secId) {
        var sec = findSection(secId);
        if (!sec || sec.tipo !== 'equipamiento') return;
        sec.items.push(newEquipHeaderItem());
        sec.expanded = true;
        rerenderSection(sec);
        var rows = S.container.querySelectorAll(
            'section[data-section="' + cssEsc(secId) + '"] .cv-tbody .cv-tr-header'
        );
        var last = rows[rows.length - 1];
        if (last) {
            var inp = last.querySelector('input.cv-input-rotulo');
            if (inp) try { inp.focus(); } catch (_) {}
        }
        scheduleAutosave();
    }

    function addSection(tipo) {
        S.addMenuOpen = false;
        var info = TYPE_INFO[tipo] || TYPE_INFO.equipamiento;
        // Numerar: contar las secciones existentes del mismo tipo
        var sameTipo = (S.data.secciones || []).filter(function (s) { return s.tipo === tipo; }).length;
        var titulo = info.defaultTitle + (sameTipo > 0 ? ' ' + (sameTipo + 1) : '');
        S.data.secciones.push(newSection(tipo, titulo));
        render();
        // Foco al título de la sección recién creada
        var sects = S.container.querySelectorAll('.cv-section-title-input');
        var last = sects[sects.length - 1];
        if (last) try { last.focus(); last.select && last.select(); } catch (_) {}
        scheduleAutosave();
    }

    function delItem(secId, itemId) {
        var sec = findSection(secId);
        if (!sec) return;
        sec.items = (sec.items || []).filter(function (it) { return it.id !== itemId; });
        rerenderSection(sec);
        updateBottom();
        scheduleAutosave();
    }

    function delSection(secId) {
        var sec = findSection(secId);
        if (!sec) return;
        var n = (sec.items || []).filter(function (it) { return it.row_type !== 'header'; }).length;
        if (n > 0) {
            var ok = window.confirm('La tabla "' + (sec.titulo || '') + '" tiene ' + n + ' item' +
                (n === 1 ? '' : 's') + '. ¿Eliminar de todos modos?');
            if (!ok) return;
        }
        S.data.secciones = (S.data.secciones || []).filter(function (s) { return s.id !== secId; });
        render();
        scheduleAutosave();
    }

    function toggleAddMenu() {
        S.addMenuOpen = !S.addMenuOpen;
        var wrap = S.container.querySelector('.cv-add-section-wrap');
        if (!wrap) return;
        var tmp = document.createElement('div');
        tmp.innerHTML = renderAddSectionWrap();
        var newWrap = tmp.firstChild;
        wrap.replaceWith(newWrap);

        // Outside click → cerrar
        if (S.addMenuOpen) {
            S.outsideClickHandler = function (ev) {
                if (!S.container) return;
                var el = ev.target;
                if (el && el.closest && el.closest('.cv-add-section-wrap')) return;
                S.addMenuOpen = false;
                var w = S.container.querySelector('.cv-add-section-wrap');
                if (w) {
                    var t = document.createElement('div');
                    t.innerHTML = renderAddSectionWrap();
                    w.replaceWith(t.firstChild);
                }
                document.removeEventListener('click', S.outsideClickHandler);
                S.outsideClickHandler = null;
            };
            // Defer para evitar capturar el click actual
            setTimeout(function () {
                if (S.outsideClickHandler) document.addEventListener('click', S.outsideClickHandler);
            }, 0);
        } else if (S.outsideClickHandler) {
            document.removeEventListener('click', S.outsideClickHandler);
            S.outsideClickHandler = null;
        }
    }

    // ── Re-renders parciales ────────────────────────────────────────
    function rerenderSection(sec) {
        if (!S.container) return;
        var oldEl = S.container.querySelector('section[data-section="' + cssEsc(sec.id) + '"]');
        if (!oldEl) { render(); return; }
        var tmp = document.createElement('div');
        tmp.innerHTML = renderSection(sec);
        var newEl = tmp.firstChild;
        oldEl.replaceWith(newEl);
        // Re-bind del trozo
        newEl.querySelectorAll('.cv-section-title-input').forEach(function (inp) {
            inp.addEventListener('input', onSectionTitleInput);
        });
        newEl.querySelectorAll('.cv-tbody [data-field], .cv-tr-header [data-field]').forEach(function (inp) {
            inp.addEventListener('input', onItemInput);
            inp.addEventListener('change', onItemInput);
            inp.addEventListener('blur', onItemBlur);
        });
    }

    function updateRowCalcs(sec, it) {
        if (!S.container) return;
        if (sec.tipo === 'equipamiento' && it.row_type === 'header') return;
        var c = calcItem(sec, it);
        var rowEl = S.container.querySelector(
            '.cv-tr[data-section="' + cssEsc(sec.id) + '"][data-item="' + cssEsc(it.id) + '"]'
        );
        if (!rowEl) return;
        var calcs = rowEl.querySelectorAll('[data-calc]');
        calcs.forEach(function (cell) {
            var k = cell.getAttribute('data-calc');
            var val = c[k];
            if (val == null) return;
            cell.textContent = fmtMoney(val);
            // Color de ganancia
            if (k === 'ganancia') {
                cell.classList.toggle('cv-td-positive', val >= 0);
                cell.classList.toggle('cv-td-negative', val < 0);
            }
        });
        // Actualizar placeholder de C.Unit en equipamiento (refleja calc actual)
        if (sec.tipo === 'equipamiento') {
            var cu = rowEl.querySelector('input[data-field="costoUnitario"]');
            if (cu) cu.placeholder = fmtPlain(c.cUnit);
        }
    }

    function updateSectionTfoot(sec) {
        if (!S.container) return;
        var secEl = S.container.querySelector('section[data-section="' + cssEsc(sec.id) + '"]');
        if (!secEl) return;
        var oldFoot = secEl.querySelector('.cv-tfoot');
        if (!oldFoot) return;
        var tmp = document.createElement('table');
        tmp.innerHTML = renderTfoot(sec);
        var newFoot = tmp.querySelector('.cv-tfoot');
        if (newFoot) oldFoot.replaceWith(newFoot);
    }

    function updateBottom() {
        if (!S.container) return;
        var oldBottom = S.container.querySelector('.cv-bottom');
        var tmp = document.createElement('div');
        tmp.innerHTML = renderBottom();
        var newBottom = tmp.firstChild;
        if (oldBottom) oldBottom.replaceWith(newBottom);
        else S.container.querySelector('.cv-root').appendChild(newBottom);
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
                if (r.data.iva_pct != null)     S.volumetria.iva_pct = r.data.iva_pct;
                if (r.data.tipo_cambio != null) S.volumetria.tipo_cambio = r.data.tipo_cambio;
                if (r.data.nombre != null)      S.volumetria.nombre = r.data.nombre;
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
            // Limpiar instancia anterior si hubiera
            if (S.container) {
                try { this.destroy(); } catch (_) {}
            }

            S.container = container;
            S.volumetria = options.volumetria;
            S.levantamiento = options.levantamiento || null;
            S.readonly = !!options.readonly;
            S.onSaved = options.onSaved || null;
            S.addMenuOpen = false;

            if (S.volumetria.iva_pct == null)     S.volumetria.iva_pct = 16;
            if (S.volumetria.tipo_cambio == null) S.volumetria.tipo_cambio = 19.50;

            var rawIn = S.volumetria.data || {};
            S.data = normalizeData(rawIn, S.levantamiento);
            S.volumetria.data = S.data;

            var migrated = (rawIn && rawIn.version !== 4);
            log('render volumetría', S.volumetria.id, 'readonly=' + S.readonly,
                'tipos=' + (S.data.secciones || []).map(function (s) { return s.tipo; }).join(','),
                'migrated=' + !!migrated);
            render();
            if (migrated && !S.readonly) scheduleAutosave();
        },

        /** Snapshot JSON v4 actual (deep copy). */
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
            unbindAll();
            if (S.container) S.container.innerHTML = '';
            S.container = null;
            S.volumetria = null;
            S.levantamiento = null;
            S.data = null;
            S.readonly = false;
            S.onSaved = null;
            S.saveInFlight = false;
            S.savePending = false;
            S.metaPending = {};
            S.addMenuOpen = false;
        },
    };
})();
