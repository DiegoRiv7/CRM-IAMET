/**
 * crm_volumetria.js — Editor de Volumetría v4 (rediseño card-row)
 *
 * Cambio visual mayor (mayo 2026): se sustituye el layout estilo "tabla
 * Excel" por un layout estilo Linear / Notion: cada sección es una
 * tarjeta blanca con padding generoso, número grande "01" en pill gris a
 * la izquierda, título de sección al centro, y subtotal de zona alineado
 * a la derecha. Cada item dentro de la sección es una mini-card
 * independiente con icono coloreado a la izquierda y los campos
 * esenciales (cantidad / desc% / total) alineados a la derecha. El click
 * sobre el cuerpo del item lo expande inline mostrando todos los campos
 * adicionales (P. Lista, Desc% Costo, C. Unit, C. Total, Ganancia,
 * Proveedor, Entrega, Notas) — la lógica y el modelo de datos no cambian.
 *
 * Tipos de sección y su shape de items:
 *
 *   equipamiento  (14 cols) — row_type 'header' (rótulo) o 'item' (producto):
 *     { row_type: 'header', texto }
 *     { row_type: 'item', marca, parte, cantidad, descripcion, precioLista,
 *       descuentoVenta, descuentoCosto, costoUnitario|null, proveedor,
 *       entrega, notas }
 *
 *   mano_obra     (9 cols) — cobrada al cliente; ganancia 100%:
 *     { marca, parte, cantidad, descripcion, precioLista, descuentoVenta,
 *       notas } — `notas` es texto multi-línea (textarea).
 *     Defaults sugeridos: marca="BAJANET", parte="SERVICIOS PROFESIONALES".
 *
 *   costo_mo      (6 cols) — costo interno; resta a la ganancia:
 *     { descripcion, cantidad, costoUnitario, dias }
 *     (en el Excel se mapea: Descripción · Cantidad · Costo Unit · Días.
 *      Concentrado y Total son derivados — no se almacenan.)
 *
 *   gastos        — ELIMINADO en mayo 2026. Los items que antes vivían
 *                   aquí (combustible, casetas, comidas) ahora se
 *                   capturan como filas adicionales en `costo_mo`. La
 *                   migración v3→v4 convierte secciones `tipo:'gastos'`
 *                   a `costo_mo` automáticamente.
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
 *     unitario   = precioLista * (1 - descuentoVenta/100)
 *     totalCli   = cantidad * unitario
 *     totalCosto = 0
 *     ganancia   = totalCli
 *
 *   costo_mo:
 *     concentrado = cantidad * costoUnitario
 *     totalCosto  = concentrado * dias
 *     totalCli    = 0
 *     ganancia    = -totalCosto
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
 * Status pill (vive en el header del card stats):
 *   .cv-status, .cv-status-borrador, .cv-status-completada,
 *   .cv-status-dot, .cv-status-label
 *
 * Sección (card grande):
 *   .cv-stack,
 *   .cv-section, .cv-section-collapsed,
 *   .cv-section-equipamiento, .cv-section-mano_obra,
 *   .cv-section-costo_mo,
 *   .cv-section-head, .cv-section-head-left, .cv-section-head-right,
 *   .cv-section-num, .cv-section-title-block,
 *   .cv-section-title-input, .cv-section-meta,
 *   .cv-section-subtotal-label, .cv-section-subtotal-value,
 *   .cv-section-toggle, .cv-chevron,
 *   .cv-section-actions,
 *   .cv-btn, .cv-btn-add-row, .cv-btn-add-header,
 *   .cv-btn-del-section, .cv-btn-icon,
 *   .cv-section-body, .cv-items, .cv-items-empty
 *
 * Items (mini-cards):
 *   .cv-item, .cv-item-equipamiento, .cv-item-mano_obra,
 *   .cv-item-costo_mo,
 *   .cv-item-expanded, .cv-item-header,
 *   .cv-item-icon, .cv-item-icon-eq, .cv-item-icon-mo,
 *   .cv-item-icon-cmo,
 *   .cv-item-main, .cv-item-id, .cv-item-brand, .cv-item-brand-wide,
 *   .cv-item-part, .cv-item-desc, .cv-item-desc-preview,
 *   .cv-item-fields, .cv-item-field, .cv-item-field-label,
 *   .cv-item-total, .cv-item-total-label, .cv-item-total-value,
 *   .cv-item-positive, .cv-item-negative,
 *   .cv-item-detail, .cv-item-detail-grid, .cv-item-detail-cell,
 *   .cv-item-detail-cell-calc, .cv-item-detail-label,
 *   .cv-item-detail-value, .cv-item-detail-full,
 *   .cv-item-rotulo, .cv-item-rotulo-input,
 *   .cv-item-del, .cv-row-del,
 *   .cv-input, .cv-input-num, .cv-input-text, .cv-input-mini,
 *   .cv-input-textarea
 *
 * Add section dropdown:
 *   .cv-add-section-wrap, .cv-add-section, .cv-add-section-menu,
 *   .cv-add-section-item, .cv-add-section-icon, .cv-add-section-icon-equipamiento,
 *   .cv-add-section-icon-mano_obra, .cv-add-section-icon-costo_mo,
 *   .cv-add-section-caret, .cv-add-section-open
 *
 * Resumen + estadísticas (NO cambia):
 *   .cv-bottom, .cv-card, .cv-card-financiero, .cv-card-stats,
 *   .cv-card-header, .cv-card-header-row, .cv-card-title, .cv-card-body,
 *   .cv-fin-config, .cv-fin-config-field, .cv-fin-config-label,
 *   .cv-fin-config-input, .cv-fin-config-suffix,
 *   .cv-fin-row, .cv-fin-label, .cv-fin-value,
 *   .cv-fin-row-cost, .cv-fin-row-gain, .cv-fin-row-margin,
 *   .cv-fin-row-margin-low, .cv-fin-row-iva, .cv-fin-row-total,
 *   .cv-fin-sep, .cv-fin-foot, .cv-fin-values,
 *   .cv-stat-row, .cv-stat-label, .cv-stat-value,
 *   .cv-stat-pills, .cv-stat-pill,
 *   .cv-stat-pill-equipamiento, .cv-stat-pill-mano_obra,
 *   .cv-stat-pill-costo_mo
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

        // Set de IDs de items actualmente expandidos (vista detalle inline).
        // No se persiste en el JSON v4 — es solo estado de UI.
        expandedItems: null,
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

    function pad2(n) {
        n = parseInt(n, 10) || 0;
        return n < 10 ? '0' + n : String(n);
    }

    function isItemExpanded(itemId) {
        return !!(S.expandedItems && S.expandedItems.has && S.expandedItems.has(itemId));
    }

    // ── Tipos de sección — defaults ─────────────────────────────────
    // NOTA: el tipo `gastos` fue eliminado en mayo 2026; la migración
    // v3 → v4 lo convierte a `costo_mo` automáticamente para no romper
    // datos viejos. Si llegan datos con `tipo:'gastos'`, se reasignan.
    var SECTION_TYPES = ['equipamiento', 'mano_obra', 'costo_mo'];

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
            marca: 'BAJANET',
            parte: 'SERVICIOS PROFESIONALES',
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
            descripcion: '',
            cantidad: 0,
            costoUnitario: 0,
            dias: 1,
        };
    }

    function newItemForType(tipo) {
        switch (tipo) {
            case 'equipamiento': return newEquipItem();
            case 'mano_obra':    return newMoItem();
            case 'costo_mo':     return newCmoItem();
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
            // Sembramos una fila vacía: la sección recién creada es
            // editable de inmediato sin que el usuario vea un cuerpo en
            // blanco con un mensaje de "sin items".
            items: [newItemForType(tipo)],
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

        // costo_mo: tiene recurso o dias, sin parte. También capturamos
        // los items "estilo gastos" (unidad + costoUnitario, sin parte ni
        // precioLista) — desde v4d ya viven como costo_mo.
        if (sample.recurso != null || sample.dias != null) {
            if (!sample.parte) return 'costo_mo';
        }
        if (sample.unidad && !sample.parte && !sample.precioLista) return 'costo_mo';
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
        // Migración v4d (mayo 2026): el tipo `gastos` fue retirado.
        // Las secciones con `tipo:'gastos'` se reasignan a `costo_mo`
        // (cantidad/costoUnitario/dias=1). Los items se mapean abajo.
        var wasGastos = (tipo === 'gastos');
        if (wasGastos) tipo = 'costo_mo';
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
                if (wasGastos) {
                    // Item estilo `gastos` (cantidad, unidad, descripcion,
                    // costoUnitario) → fila de costo_mo. Conservamos la
                    // unidad anexándola a la descripción si es informativa
                    // (ej. "Combustible · LT").
                    var desc = it.descripcion || it.recurso || '';
                    var unidad = (it.unidad || '').trim();
                    if (unidad && unidad !== 'PZA' && unidad !== 'pza') {
                        desc = desc ? (desc + ' · ' + unidad) : unidad;
                    }
                    out.items.push({
                        id: it.id || uuid(),
                        descripcion: desc,
                        cantidad: num(it.cantidad),
                        costoUnitario: num(it.costoUnitario),
                        dias: it.dias != null ? num(it.dias) : 1,
                    });
                } else {
                    // Item costo_mo nativo. En v3 el campo era `recurso`;
                    // en v4d pasa a llamarse `descripcion` (alineado con
                    // el Excel). Preservamos `recurso` como fallback.
                    out.items.push({
                        id: it.id || uuid(),
                        descripcion: it.descripcion || it.recurso || '',
                        cantidad: num(it.cantidad),
                        costoUnitario: num(it.costoUnitario),
                        dias: it.dias != null ? num(it.dias) : 1,
                    });
                }
            }
        });

        // Si la sección llega sin items (migración de v1/v2/v3 con secciones
        // vacías o data corrupta), sembramos una fila vacía. Así el usuario
        // nunca ve un body sin filas y el botón «+ Fila» no es la única
        // pista visual para empezar a capturar.
        if (!out.items.length) {
            out.items.push(newItemForType(tipo));
        }

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
                    descripcion: it.recurso || it.descripcion || '',
                    cantidad: num(it.cant),
                    costoUnitario: num(it.costo_unit),
                    dias: num(it.dias) || 1,
                });
            });
            secs.push(cmoSec);
        }
        // v2/v3 traía la zona `gastos` como sección aparte; en v4d esos
        // items pasan a costo_mo (días=1, sin venta). Los anexamos a la
        // sección `costo_mo` recién creada o, si no existe, creamos una
        // dedicada. La heurística: si ya hay un costo_mo, anexamos; si
        // no, creamos uno con título "Gastos" para conservar contexto.
        if (raw.gastos && Array.isArray(raw.gastos.items) && raw.gastos.items.length) {
            var targetSec = secs.filter(function (s) { return s.tipo === 'costo_mo'; })[0];
            if (!targetSec) {
                targetSec = {
                    id: uuid(), titulo: 'Gastos', expanded: true,
                    tipo: 'costo_mo', items: [],
                };
                secs.push(targetSec);
            }
            raw.gastos.items.forEach(function (it) {
                var desc = it.descripcion || '';
                var unidad = String(it.unidad || '').trim();
                if (unidad && unidad !== 'PZA' && unidad !== 'pza') {
                    desc = desc ? (desc + ' · ' + unidad) : unidad;
                }
                targetSec.items.push({
                    id: uuid(),
                    descripcion: desc,
                    cantidad: num(it.cant),
                    costoUnitario: num(it.costo_unit),
                    dias: 1,
                });
            });
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
            // v4d: `gastos` ya no es un tipo válido — se mapea a costo_mo
            // con días=1. La unidad (si != PZA) se anexa a la descripción.
            var s3 = { id: uuid(), titulo: 'Gastos', expanded: true,
                       tipo: 'costo_mo', items: [] };
            raw.gastos.forEach(function (r) {
                var desc = r.desc || '';
                var unidad = String(r.unidad || '').trim();
                if (unidad && unidad !== 'PZA' && unidad !== 'pza') {
                    desc = desc ? (desc + ' · ' + unidad) : unidad;
                }
                s3.items.push({
                    id: uuid(),
                    descripcion: desc,
                    cantidad: num(r.qty),
                    costoUnitario: num(r.costo),
                    dias: 1,
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
            // costoUnitario null/vacío → derivar de precioLista × (1 - descCosto/100).
            // PERO si descCosto también es 0, el ítem es pura ganancia (cobramos
            // sin costo real — ej. MISCELANEOS). Devolver 0 en vez de precioLista,
            // que era el bug que inflaba el costo total por el monto de venta.
            var dc = num(it.descuentoCosto);
            cUnit = dc > 0 ? num(it.precioLista) * (1 - dc / 100) : 0;
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
        // dias por defecto 1 si no viene definido (esquema Excel R52-R59)
        var dias = (it.dias != null && it.dias !== '') ? num(it.dias) : 1;
        var concentrado = num(it.cantidad) * num(it.costoUnitario);
        var totalCosto = concentrado * dias;
        return {
            concentrado: concentrado,
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
        var byTipo = { equipamiento: 0, mano_obra: 0, costo_mo: 0 };
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
        tag: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',

        // Iconos para el cuadrado de cada item (3D-ish, 18px)
        boxItem: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
        wrenchItem: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
        clockItem: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        receiptItem: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z" transform="translate(0 0)"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>',
    };

    // Mapeo tipo → icono del item
    function itemIconForTipo(tipo) {
        switch (tipo) {
            case 'mano_obra': return ICON.wrenchItem;
            case 'costo_mo':  return ICON.clockItem;
        }
        return ICON.boxItem;
    }
    function itemIconClassForTipo(tipo) {
        switch (tipo) {
            case 'mano_obra': return 'cv-item-icon-mo';
            case 'costo_mo':  return 'cv-item-icon-cmo';
        }
        return 'cv-item-icon-eq';
    }

    // ── RENDER ──────────────────────────────────────────────────────
    function render() {
        if (!S.container) return;

        var html = '<div class="cv-root' + (S.readonly ? ' cv-readonly' : '') + '">';
        
        // Header
        html += '<header class="cv-app-header border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-30">';
        html += '  <div>';
        var cliName = esc((S.data && S.data.meta && S.data.meta.cliente) || "Proyecto");
        var levDate = esc((S.data && S.data.meta && S.data.meta.fecha) || "Reciente");
        
        var status = (S.volumetria && S.volumetria.status) || 'borrador';
        var statusLabel = status === 'completada' ? 'Completada' : 'Borrador';
        var statusCls = 'cv-status cv-status-' + status;
        var statusEl = '';
        if (!S.readonly) {
            statusEl = '<button type="button" class="' + statusCls + '" data-action="toggle-status" style="margin-left:12px; height:22px; padding:2px 10px; font-size:10px; line-height:1;">' +
                       '<span class="cv-status-dot" style="width:6px; height:6px;"></span><span class="cv-status-label">' + esc(statusLabel) + '</span></button>';
        } else {
            statusEl = '<div class="' + statusCls + '" style="margin-left:12px; height:22px; padding:2px 10px; font-size:10px; line-height:1;">' +
                       '<span class="cv-status-dot" style="width:6px; height:6px;"></span><span class="cv-status-label">' + esc(statusLabel) + '</span></div>';
        }

        html += '    <h1 class="text-xl font-semibold text-gray-900">Proyecto: ' + cliName + '</h1>';
        html += '    <div style="display:flex; align-items:center;">';
        html += '      <p class="text-xs text-gray-500 mt-0.5" style="margin:0;">Última edición: ' + levDate + '</p>';
        html += statusEl;
        html += '    </div>';
        html += '  </div>';
        html += '</header>';

        // Main App Body
        // OJO: NO ponemos `overflow-y:auto` ni `flex:1` aquí — el host
        // (#lwP3CvMount) ya hospeda el scroll. Dejar el main con su
        // propio scroll recortaba las tablas inferiores cuando había
        // muchas filas. Sólo `padding-bottom` para respirar al final.
        html += '<main class="cv-app-main flex-col p-4 gap-4" style="display:flex; flex-direction:column; padding-bottom:48px;">';
        
        // Table Box
        html += '  <div class="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col" style="background:#fff; border:1px solid var(--cv-border); border-radius:14px; overflow:visible; flex-shrink:0;">';
        
        // Toolbar (Search + Agregar Tabla)
        html += '    <div class="px-4 py-3 border-b flex items-center justify-between bg-white z-20" style="padding:12px 16px; border-bottom:1px solid var(--cv-border); display:flex; justify-content:space-between; align-items:center; border-top-left-radius:14px; border-top-right-radius:14px;">';
        html += '      <div class="relative" style="position:relative;">';
        html += '        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); color:#9ca3af;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
        html += '        <input type="text" placeholder="Buscar partida..." class="cv-input" style="width:250px; background:var(--cv-bg-zinc-100); padding-left:34px;">';
        html += '      </div>';
        if (!S.readonly) {
            html += '<div class="cv-toolbar-actions">';
            html += renderImportBtn();
            html += renderAddSectionWrap();
            html += '</div>';
        }
        html += '    </div>';

        html += '    <div class="cv-app-table-scroll"><div class="cv-stack">';
        (S.data.secciones || []).forEach(function (sec, idx) {
            html += renderSection(sec, idx);
        });
        html += '    </div></div>'; // end scroller
        html += '  </div>'; // end Table Box
        
        // Bottom / Sidebar summary card
        html += '  <div class="cv-app-bottom-summary" style="margin-top:24px;">';
        html += renderBottom();
        html += '  </div>';
        
        html += '</main>';
        html += '</div>';

        S.container.innerHTML = html;
        bindAll();
    }

    // ── Sección (card-row) ──────────────────────────────────────────
    /**
     * Render de la sección como card grande:
     *
     *   ┌─ HEAD ────────────────────────────────────────────────────┐
     *   │  [01]  ▾  📦  Equipamiento          SUBTOTAL ZONA         │
     *   │                                     $123,456.78           │
     *   ├─ BODY ────────────────────────────────────────────────────┤
     *   │   ┌─ item ─────────────────────────────────────────────┐  │
     *   │   │ [📦] CHARFIL · MG-51-431EZ   Cant Desc%  TOTAL  🗑│  │
     *   │   │      Charola tipo malla       [12] [ 0]  $420.00 │  │
     *   │   └────────────────────────────────────────────────────┘  │
     *   │   …                                                       │
     *   │   [+ Fila]  [+ Rótulo]  [🗑 sección]                      │
     *   └───────────────────────────────────────────────────────────┘
     */
    function renderSection(sec, sectionIdx) {
        var open = sec.expanded !== false;
        var t = calcSection(sec);
        var subtotal = (sec.tipo === 'costo_mo')
            ? t.totalCosto : t.totalCli;
        var info = TYPE_INFO[sec.tipo] || TYPE_INFO.equipamiento;
        var cls = 'cv-section cv-section-' + sec.tipo + (open ? '' : ' cv-section-collapsed');

        var h = '<section class="' + cls + '" data-section="' + esc(sec.id) + '" data-tipo="' + esc(sec.tipo) + '">';

        // Head: [01] · toggle · título · subtotal zona
        h += '<header class="cv-section-head">';

        h += '<div class="cv-section-head-left">';
        h += '<span class="cv-section-num">' + esc(pad2((sectionIdx || 0) + 1)) + '</span>';
        h += '<button type="button" class="cv-section-toggle" data-action="toggle-section" data-section="' + esc(sec.id) + '" aria-label="Expandir/colapsar">' +
             '<span class="cv-chevron">' + (open ? ICON.chevronDown : ICON.chevronRight) + '</span>' +
             '</button>';

        h += '<div class="cv-section-title-block">';
        var titDisabled = S.readonly ? 'disabled' : '';
        h += '<input type="text" class="cv-section-title-input" data-section="' + esc(sec.id) + '" ' +
             'value="' + esc(sec.titulo || '') + '" placeholder="' + esc(info.defaultTitle) + '" ' + titDisabled + ' />';
        var nItems = (sec.items || []).filter(function (x) { return x.row_type !== 'header'; }).length;
        h += '<span class="cv-section-meta">' + esc(info.label) +
             ' <span aria-hidden="true">·</span> ' + nItems +
             (nItems === 1 ? ' item' : ' items') + '</span>';
        h += '</div>';
        h += '</div>';

        // Right: subtotal zona
        h += '<div class="cv-section-head-right">';
        h += '<span class="cv-section-subtotal-label">Subtotal zona</span>';
        h += '<span class="cv-section-subtotal-value cv-mono">' + esc(fmtMoney(subtotal)) + '</span>';
        h += '</div>';

        h += '</header>';

        if (open) {
            h += '<div class="cv-section-body">';
            h += '<div class="cv-items">';
            var items = sec.items || [];
            if (!items.length) {
                h += '<div class="cv-items-empty">Sin items en esta sección.</div>';
            } else {
                items.forEach(function (it, idx) {
                    h += renderItem(sec, it, idx);
                });
            }
            h += '</div>';

            if (!S.readonly) {
                h += '<div class="cv-section-actions">';
                h += '<button type="button" class="cv-btn cv-btn-add-row" data-action="add-row" data-section="' + esc(sec.id) + '">' +
                     ICON.plus + '<span>Agregar fila</span></button>';
                h += '<button type="button" class="cv-btn cv-btn-del-section" data-action="del-section" data-section="' + esc(sec.id) + '" title="Eliminar tabla">' +
                     ICON.trash + '<span class="cv-sr-only">Eliminar tabla</span></button>';
                h += '</div>';
            }

            h += '</div>'; // cv-section-body
        }

        h += '</section>';
        return h;
    }

    // ── Item (mini-card) ────────────────────────────────────────────
    function renderItem(sec, it, idx) {
        if (sec.tipo === 'equipamiento' && it.row_type === 'header') {
            return renderRotuloItem(sec, it, idx);
        }
        switch (sec.tipo) {
            case 'equipamiento': return renderEquipItem(sec, it, idx);
            case 'mano_obra':    return renderMoItem(sec, it, idx);
            case 'costo_mo':     return renderCmoItem(sec, it, idx);
        }
        return '';
    }

    function itemAttrs(sec, it) {
        return 'data-section="' + esc(sec.id) + '" data-item="' + esc(it.id) + '"';
    }

    // Inputs para el card (versión más densa que la antigua versión-tabla)
    function inputNum(sec, it, field, value, opts) {
        opts = opts || {};
        var disabled = S.readonly ? 'disabled' : '';
        var v = (value == null || value === '') ? '' : value;
        var cls = 'cv-input cv-input-num cv-mono';
        if (opts.mini) cls += ' cv-input-mini';
        var ph = opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '';
        var step = opts.step != null ? opts.step : 'any';
        var min = opts.min != null ? ' min="' + esc(opts.min) + '"' : '';
        return '<input type="number" step="' + esc(step) + '"' + min + ' class="' + cls + '" ' +
               'data-field="' + field + '" data-section="' + esc(sec.id) + '" ' +
               'data-item="' + esc(it.id) + '" value="' + esc(v) + '"' + ph + ' ' + disabled + ' />';
    }
    function inputText(sec, it, field, value, opts) {
        opts = opts || {};
        var disabled = S.readonly ? 'disabled' : '';
        var v = value == null ? '' : value;
        var cls = 'cv-input cv-input-text';
        if (opts.mono) cls += ' cv-mono';
        if (opts.mini) cls += ' cv-input-mini';
        var ph = opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '';
        return '<input type="text" class="' + cls + '" ' +
               'data-field="' + field + '" data-section="' + esc(sec.id) + '" ' +
               'data-item="' + esc(it.id) + '" value="' + esc(v) + '"' + ph + ' ' + disabled + ' />';
    }

    /** Textarea multilínea para campos largos (ej. notas de mano de
     *  obra). El esc() preserva los saltos de línea — sólo escapamos
     *  caracteres HTML. */
    function inputTextarea(sec, it, field, value, opts) {
        opts = opts || {};
        var disabled = S.readonly ? 'disabled' : '';
        var v = value == null ? '' : value;
        var cls = 'cv-input cv-input-text cv-input-textarea';
        if (opts.mini) cls += ' cv-input-mini';
        var ph = opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '';
        var rows = opts.rows ? ' rows="' + opts.rows + '"' : ' rows="3"';
        return '<textarea class="' + cls + '"' + rows + ' ' +
               'data-field="' + field + '" data-section="' + esc(sec.id) + '" ' +
               'data-item="' + esc(it.id) + '"' + ph + ' ' + disabled + '>' +
               esc(v) + '</textarea>';
    }

    /** Icono cuadrado del item (rellena `cv-item-icon` con el SVG del tipo). */
    function renderItemIcon(sec) {
        var iconCls = 'cv-item-icon ' + itemIconClassForTipo(sec.tipo);
        var iconHtml = itemIconForTipo(sec.tipo);
        return '<div class="' + iconCls + '">' + iconHtml + '</div>';
    }

    /** Cabecera del item (compacto): brand/parte + descripción.
     *  Hermano del icono dentro del .cv-item-header (no incluye al icono
     *  para que el flex del header los acomode horizontalmente). */
    function renderItemMain(sec, it, opts) {
        opts = opts || {};

        var h = '<div class="cv-item-main" ' + itemAttrs(sec, it) + '>';

        h += '<div class="cv-item-id">';
        if (opts.brandField) {
            h += '<span class="cv-item-brand">' +
                 inputText(sec, it, opts.brandField, it[opts.brandField],
                           { mini: true, placeholder: opts.brandPlaceholder || 'Marca' }) +
                 '</span>';
        }
        if (opts.partField) {
            h += '<span class="cv-item-part">' +
                 inputText(sec, it, opts.partField, it[opts.partField],
                           { mini: true, mono: true, placeholder: opts.partPlaceholder || 'No. parte' }) +
                 '</span>';
        }
        if (opts.singleField) {
            // Para costo_mo (recurso) — un solo input ancho.
            h += '<span class="cv-item-brand cv-item-brand-wide">' +
                 inputText(sec, it, opts.singleField, it[opts.singleField],
                           { mini: true, placeholder: opts.singlePlaceholder || '' }) +
                 '</span>';
        }
        h += '</div>';

        if (opts.descField) {
            h += '<div class="cv-item-desc">' +
                 inputText(sec, it, opts.descField, it[opts.descField],
                           { mini: true, placeholder: opts.descPlaceholder || 'Descripción' }) +
                 '</div>';
        }

        h += '</div>'; // cv-item-main
        return h;
    }

    /** Caja de campos numéricos compactos a la derecha, con label encima. */
    function fieldBox(label, html) {
        return '<label class="cv-item-field">' +
               '<span class="cv-item-field-label">' + esc(label) + '</span>' +
               html +
               '</label>';
    }

    /** Total del item (a la extrema derecha). */
    function totalBox(label, value, opts) {
        opts = opts || {};
        var cls = 'cv-item-total';
        if (opts.positive) cls += ' cv-item-positive';
        if (opts.negative) cls += ' cv-item-negative';
        if (opts.cls) cls += ' ' + opts.cls;
        return '<div class="' + cls + '" data-calc="' + esc(opts.calc || 'totalCli') + '">' +
               '<span class="cv-item-total-label">' + esc(label) + '</span>' +
               '<span class="cv-item-total-value cv-mono">' + esc(fmtMoney(value)) + '</span>' +
               '</div>';
    }

    /** Botón de eliminar item (visible al hover, esquina superior derecha). */
    function renderItemDel(sec, it) {
        if (S.readonly) return '';
        return '<button type="button" class="cv-row-del cv-item-del" data-action="del-item" ' +
               'data-section="' + esc(sec.id) + '" data-item="' + esc(it.id) + '" ' +
               'title="Eliminar fila">' + ICON.x + '</button>';
    }

    /** Wrapper común del item-card */
    function itemWrapStart(sec, it) {
        var expanded = isItemExpanded(it.id);
        var cls = 'cv-item cv-item-' + sec.tipo + (expanded ? ' cv-item-expanded' : '');
        return '<article class="' + cls + '" ' + itemAttrs(sec, it) + '>';
    }

    /** Equipamiento: row_type 'header' = rótulo */
    function renderRotuloItem(sec, it, idx) {
        var disabled = S.readonly ? 'disabled' : '';
        var h = '<article class="cv-item cv-item-rotulo" ' + itemAttrs(sec, it) + ' data-row-type="header">';
        h += renderItemDel(sec, it);
        h += '<input type="text" class="cv-input cv-input-text cv-item-rotulo-input" ' +
             'data-field="texto" data-section="' + esc(sec.id) + '" ' +
             'data-item="' + esc(it.id) + '" value="' + esc(it.texto || '') + '" ' +
             'placeholder="Rótulo de subsección (ej. Escalerilla 100mm IDF3)" ' + disabled + ' />';
        h += '</article>';
        return h;
    }

    /** Equipamiento (item) */
    function renderEquipItem(sec, it, idx) {
        var c = calcEquipItem(it);
        var expanded = isItemExpanded(it.id);

        var h = itemWrapStart(sec, it);

        // Header compacto (clickable → expandir detalle)
        h += '<div class="cv-item-header" data-action="toggle-item" ' + itemAttrs(sec, it) + '>';
        h += renderItemIcon(sec);
        h += renderItemMain(sec, it, {
            brandField: 'marca',
            brandPlaceholder: 'Marca',
            partField: 'parte',
            partPlaceholder: 'No. parte',
            descField: 'descripcion',
            descPlaceholder: 'Descripción del producto',
        });
        h += '<div class="cv-item-fields">';
        h += fieldBox('Cant.', inputNum(sec, it, 'cantidad', it.cantidad, { mini: true, min: 0 }));
        h += fieldBox('Precio Un.', inputNum(sec, it, 'precioLista', it.precioLista, { mini: true, min: 0 }));
        h += fieldBox('Costo Un.',
            '<input type="number" step="any" class="cv-input cv-input-num cv-input-mini cv-mono" ' +
            'data-field="costoUnitario" data-section="' + esc(sec.id) + '" ' +
            'data-item="' + esc(it.id) + '" placeholder="' + esc(fmtPlain(c.cUnit)) + '" ' +
            'value="' + esc(it.costoUnitario != null ? it.costoUnitario : '') + '" ' +
            (S.readonly ? 'disabled' : '') + ' />');
        h += '</div>';
        
        var gainCls = c.ganancia >= 0 ? 'cv-item-positive' : 'cv-item-negative';
        h += totalBox('Ganancia', c.ganancia, { calc: 'ganancia', cls: gainCls });
        
        h += renderItemDel(sec, it);
        h += '</div>';

        // Detalle expandible
        h += '<div class="cv-item-detail">';
        h += '<div class="cv-item-detail-grid">';
        h += detailCell('Desc % Vnta',  inputNum(sec, it, 'descuentoVenta', it.descuentoVenta, { mini: true, min: 0 }));
        h += detailCell('Desc % Costo', inputNum(sec, it, 'descuentoCosto', it.descuentoCosto, { mini: true, min: 0 }));
        h += detailCalc('P. Unit Venta', fmtMoney(c.pVentaUnit), 'pVentaUnit', sec, it);
        h += detailCalc('C. Total',      fmtMoney(c.totalCosto), 'totalCosto',  sec, it);
        h += detailCalc('Total Cli.',    fmtMoney(c.totalCli),   'totalCli',    sec, it);
        h += detailCell('Proveedor', inputText(sec, it, 'proveedor', it.proveedor, { mini: true, placeholder: '—' }));
        h += detailCell('Entrega',   inputText(sec, it, 'entrega',   it.entrega,   { mini: true, placeholder: '—' }));
        h += '</div>';
        h += '<label class="cv-item-detail-cell cv-item-detail-full">' +
             '<span class="cv-item-detail-label">Notas</span>' +
             inputText(sec, it, 'notas', it.notas, { mini: true, placeholder: 'Notas internas / observaciones' }) +
             '</label>';
        h += '</div>';

        h += '</article>';
        return h;
    }

    /** Mano de obra (item)
     *  Esquema Excel R42-R50:
     *    Marca · No. Parte · Cantidad · Descripción · Precio Lista ·
     *    Desc% · Unitario(calc) · Total(calc) · Notas (texto largo)
     *  Defaults: marca=BAJANET, parte=SERVICIOS PROFESIONALES.
     *  Las notas son multilínea — en compacto se muestra solo la
     *  primera línea con ellipsis; en expandido un textarea grande. */
    function renderMoItem(sec, it, idx) {
        var c = calcMoItem(it);
        var notas = String(it.notas || '');
        var firstLine = notas.split(/\r?\n/)[0] || '';

        var h = itemWrapStart(sec, it);

        h += '<div class="cv-item-header" data-action="toggle-item" ' + itemAttrs(sec, it) + '>';
        h += renderItemIcon(sec);
        h += renderItemMain(sec, it, {
            brandField: 'marca',
            brandPlaceholder: 'Marca',
            partField: 'parte',
            partPlaceholder: 'No. parte',
            descField: 'descripcion',
            descPlaceholder: 'Descripción de la mano de obra',
        });
        h += '<div class="cv-item-fields">';
        h += fieldBox('Cant', inputNum(sec, it, 'cantidad', it.cantidad, { mini: true, min: 0 }));
        h += fieldBox('P. Lista', inputNum(sec, it, 'precioLista', it.precioLista, { mini: true, min: 0 }));
        h += fieldBox('Desc %', inputNum(sec, it, 'descuentoVenta', it.descuentoVenta, { mini: true, min: 0 }));
        h += '</div>';
        h += totalBox('Total', c.totalCli, { calc: 'totalCli' });
        h += renderItemDel(sec, it);
        h += '</div>';

        // Preview de notas (primera línea, debajo del header). Solo se
        // muestra si hay notas — sirve como pista visual sin abrir el
        // detalle. La preview es view-only (clickear el item lo expande).
        if (firstLine) {
            h += '<div class="cv-item-desc-preview" data-action="toggle-item" ' + itemAttrs(sec, it) + '>' +
                 esc(firstLine) +
                 (notas.indexOf('\n') >= 0 ? ' <span class="cv-item-desc-preview-more">…</span>' : '') +
                 '</div>';
        }

        h += '<div class="cv-item-detail">';
        h += '<div class="cv-item-detail-grid">';
        h += detailCalc('Unitario',  fmtMoney(c.pVentaUnit), 'pVentaUnit', sec, it);
        h += detailCalc('Total',     fmtMoney(c.totalCli),   'totalCli',   sec, it);
        h += '</div>';
        h += '<label class="cv-item-detail-cell cv-item-detail-full">' +
             '<span class="cv-item-detail-label">Notas</span>' +
             inputTextarea(sec, it, 'notas', it.notas, {
                 placeholder: 'Notas largas / observaciones (Enter para nueva línea)',
                 rows: 4,
             }) +
             '</label>';
        h += '</div>';

        h += '</article>';
        return h;
    }

    /** Costo MO (item) — costo interno; sin venta.
     *  Esquema Excel R52-R59:
     *    Cantidad · Descripción · Costo Unit · Concentrado(calc) ·
     *    Costo Total(calc) · Días
     *  Compacto: Descripción + Cant + Costo Unit + Días + Total.
     *  Expandido: muestra Concentrado (Cant × Costo Unit) read-only. */
    function renderCmoItem(sec, it, idx) {
        var c = calcCmoItem(it);

        var h = itemWrapStart(sec, it);

        h += '<div class="cv-item-header" data-action="toggle-item" ' + itemAttrs(sec, it) + '>';
        h += renderItemIcon(sec);
        h += renderItemMain(sec, it, {
            singleField: 'descripcion',
            singlePlaceholder: 'Descripción (ej. Técnico, Combustible, Casetas)',
        });
        h += '<div class="cv-item-fields">';
        h += fieldBox('Cant',       inputNum(sec, it, 'cantidad',      it.cantidad,      { mini: true, min: 0 }));
        h += fieldBox('Costo Unit', inputNum(sec, it, 'costoUnitario', it.costoUnitario, { mini: true, min: 0 }));
        h += fieldBox('Días',       inputNum(sec, it, 'dias',          it.dias,          { mini: true, min: 0 }));
        h += '</div>';
        h += totalBox('Total', c.totalCosto, { calc: 'totalCosto' });
        h += renderItemDel(sec, it);
        h += '</div>';

        h += '<div class="cv-item-detail">';
        h += '<div class="cv-item-detail-grid">';
        h += detailCalc('Concentrado (Cant × Costo Unit)', fmtMoney(c.concentrado), 'concentrado', sec, it);
        h += detailCalc('Costo Total (Concentrado × Días)', fmtMoney(c.totalCosto),  'totalCosto',  sec, it);
        h += '</div>';
        h += '</div>';

        h += '</article>';
        return h;
    }

    function detailCell(label, html) {
        return '<label class="cv-item-detail-cell">' +
               '<span class="cv-item-detail-label">' + esc(label) + '</span>' +
               html +
               '</label>';
    }
    function detailCalc(label, value, calcKey, sec, it, extraCls) {
        var cls = 'cv-item-detail-cell cv-item-detail-cell-calc' +
                  (extraCls ? ' ' + extraCls : '');
        return '<div class="' + cls + '" data-calc="' + esc(calcKey) + '" ' + itemAttrs(sec, it) + '>' +
               '<span class="cv-item-detail-label">' + esc(label) + '</span>' +
               '<span class="cv-item-detail-value cv-mono">' + esc(value) + '</span>' +
               '</div>';
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

    // ── Import button (Subir volumetría desde Excel) ────────────────
    var ICON_UPLOAD = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';

    function renderImportBtn() {
        // Usamos <label> + <input type="file" hidden> para que el click
        // sobre toda el área dispare el file picker nativo, sin handlers.
        return '<label class="cv-import-btn" data-role="import-vol" title="Importar Excel de volumetría legacy">' +
                   ICON_UPLOAD +
                   '<span>Subir volumetría</span>' +
                   '<input type="file" accept=".xlsx,.xls" hidden data-role="import-input" />' +
               '</label>';
    }

    function onImportFileChange(ev) {
        if (S.readonly) return;
        var input = ev.target;
        var file = input && input.files && input.files[0];
        if (!file) return;

        var hasItems = false;
        try {
            (S.data && S.data.secciones || []).some(function (sec) {
                var n = (sec.items || []).filter(function (x) {
                    return x && x.row_type !== 'header';
                }).length;
                if (n > 0) { hasItems = true; return true; }
                return false;
            });
        } catch (_) {}

        var doImport = function () {
            runImport(file).finally(function () {
                // Limpiamos el input para permitir re-importar el mismo archivo
                try { input.value = ''; } catch (_) {}
            });
        };

        if (hasItems) {
            askConfirm({
                title: 'Reemplazar volumetría',
                message: 'El contenido actual se reemplazará con los datos del Excel. ' +
                         'Se guardará un snapshot del contenido actual por seguridad.',
                confirmLabel: 'Importar',
                cancelLabel: 'Cancelar',
                tone: 'danger',
            }).then(function (ok) {
                if (!ok) {
                    try { input.value = ''; } catch (_) {}
                    return;
                }
                doImport();
            });
        } else {
            doImport();
        }
    }

    function runImport(file) {
        if (!S.volumetria || !S.volumetria.id) return Promise.resolve();
        var url = '/app/api/iamet/volumetrias/' + S.volumetria.id + '/importar-excel/';
        var fd = new FormData();
        fd.append('archivo', file);

        // Flush autosave pendiente para que no pise el resultado del import
        if (S.saveTimer) {
            try { clearTimeout(S.saveTimer); } catch (_) {}
            S.saveTimer = null;
        }

        log('importar-excel →', url, file.name);
        return fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'X-CSRFToken': getCsrf(),
                'X-Requested-With': 'XMLHttpRequest',
            },
            body: fd,
        }).then(function (r) {
            return r.json().then(function (j) { return { status: r.status, body: j }; });
        }).then(function (res) {
            var j = res.body || {};
            if (!(j.success || j.ok) || !j.data) {
                var msg = j.error || ('HTTP ' + res.status);
                log('importar-excel error', msg, j);
                window.alert('No se pudo importar el Excel.\n\n' + msg);
                return;
            }
            // Actualizar volumetria en memoria con la respuesta y re-renderizar.
            var v = j.data;
            // El endpoint devuelve la volumetría con `data` adentro; el
            // crmVolumetria.render espera `volumetria.data`.
            var newVol = {
                id: v.id || S.volumetria.id,
                nombre: v.nombre != null ? v.nombre : S.volumetria.nombre,
                status: v.status || S.volumetria.status,
                iva_pct: v.iva_pct != null ? v.iva_pct : S.volumetria.iva_pct,
                tipo_cambio: v.tipo_cambio != null ? v.tipo_cambio : S.volumetria.tipo_cambio,
                data: v.data || {},
            };
            // Re-render limpio (destroy + render con la data nueva).
            var container = S.container;
            var levantamiento = S.levantamiento;
            var readonly = S.readonly;
            var onSaved = S.onSaved;
            window.crmVolumetria.render(container, {
                volumetria: newVol,
                levantamiento: levantamiento,
                readonly: readonly,
                onSaved: onSaved,
            });
            var resumen = j.resumen || {};
            var nEq = resumen.equipamiento_items || 0;
            var nMo = resumen.mano_obra_items || 0;
            var nCmo = resumen.costo_mo_items || 0;
            var tcMsg = resumen.tipo_cambio_detectado
                ? ' · TC ' + Number(resumen.tipo_cambio_detectado).toFixed(2)
                : '';
            // Notificación discreta — el host puede definir lwToast.
            if (typeof window.lwToast === 'function') {
                window.lwToast('Volumetría importada · ' + nEq + ' eq · ' + nMo + ' MO · ' + nCmo + ' CMO' + tcMsg, 'success');
            } else {
                console.log('[crmVolumetria] Importado: eq=' + nEq + ' mo=' + nMo + ' cmo=' + nCmo + tcMsg);
            }
        }).catch(function (err) {
            log('importar-excel failed', err);
            window.alert('Error al importar el Excel: ' + (err && err.message || err));
        });
    }

    // ── Bottom: Resumen Financiero Horizontal ──────────────────────────────
    function renderBottom() {
        var h = '<div class="cv-bottom" style="width: 100%;">';
        h += renderFinanciero();
        h += '</div>';
        return h;
    }

    function renderFinanciero() {
        var h = '<aside class="cv-card cv-card-financiero">';
        h += '<div class="cv-card-header"><div class="cv-card-title">Resumen Financiero</div></div>';
        h += '<div class="cv-card-body">';
        h += renderFinConfig();
        h += '<div class="cv-fin-sep"></div>';
        h += '<div class="cv-fin-values">' + renderFinValues() + '</div>';
        h += '</div>';
        h += '</aside>';
        return h;
    }

    function renderFinConfig() {
        var tcVal = S.volumetria && S.volumetria.tipo_cambio != null ? S.volumetria.tipo_cambio : '';
        var ivaVal = S.volumetria && S.volumetria.iva_pct != null ? S.volumetria.iva_pct : '';
        var disabled = S.readonly ? 'disabled' : '';

        var h = '<div class="cv-fin-config">';
        h += '<label class="cv-fin-config-field">' +
                 '<span class="cv-fin-config-label">TC</span>' +
                 '<input type="number" step="any" class="cv-fin-config-input cv-mono" data-meta="tc" ' +
                    'value="' + esc(tcVal) + '" placeholder="19.50" ' + disabled + ' />' +
                 '<span class="cv-fin-config-suffix">MXN/USD</span>' +
             '</label>';
        h += '<label class="cv-fin-config-field">' +
                 '<span class="cv-fin-config-label">IVA</span>' +
                 '<input type="number" step="any" class="cv-fin-config-input cv-mono" data-meta="iva" ' +
                    'value="' + esc(ivaVal) + '" placeholder="16" ' + disabled + ' />' +
                 '<span class="cv-fin-config-suffix">%</span>' +
             '</label>';
        h += '</div>';
        return h;
    }

    function renderFinValues() {
        var t = calcTotals();
        var tc = num(S.volumetria && S.volumetria.tipo_cambio);
        var marginCls = 'cv-fin-row cv-fin-row-margin' + (t.margen < 20 ? ' cv-fin-row-margin-low' : '');

        var h = '';
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

        return h;
    }

    /** Actualiza solo los renglones de valores del card financiero,
     *  preservando el foco de los inputs de TC/IVA mientras el usuario
     *  los está editando. También refresca el card de stats (tablas/items). */
    function updateFinValuesAndStats() {
        if (!S.container) return;
        var valuesEl = S.container.querySelector('.cv-fin-values');
        if (valuesEl) valuesEl.innerHTML = renderFinValues();
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
        var statusCls = 'cv-status cv-status-' + status;
        var statusEl;
        if (!S.readonly) {
            statusEl =
                '<button type="button" class="' + statusCls + '" data-action="toggle-status">' +
                    '<span class="cv-status-dot"></span>' +
                    '<span class="cv-status-label">' + esc(statusLabel) + '</span>' +
                '</button>';
        } else {
            statusEl =
                '<span class="' + statusCls + '">' +
                    '<span class="cv-status-dot"></span>' +
                    '<span class="cv-status-label">' + esc(statusLabel) + '</span>' +
                '</span>';
        }

        var h = '<aside class="cv-card cv-card-stats">';
        h += '<div class="cv-card-header cv-card-header-row">';
        h += '<div class="cv-card-title">Resumen de Estadísticas</div>';
        h += statusEl;
        h += '</div>';
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

        S.container.querySelectorAll('.cv-items [data-field]').forEach(function (inp) {
            inp.addEventListener('input', onItemInput);
            inp.addEventListener('change', onItemInput);
            inp.addEventListener('blur', onItemBlur);
        });

        // Import file input (Subir volumetría)
        S.container.querySelectorAll('input[data-role="import-input"]').forEach(function (inp) {
            inp.addEventListener('change', onImportFileChange);
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

        // Si el click cayó sobre un input/textarea/select/label/button
        // dentro del bloque (pero el bloque sí tiene data-action), lo
        // dejamos pasar al elemento natural — NO togglemos. Esto aplica
        // sobre todo a `toggle-item` (cuyo área engloba los mini-inputs
        // de marca/parte/descripción y los <label> que envuelven los
        // inputs cant/desc%).
        if (action === 'toggle-item') {
            // toggle-item está en `.cv-item-header` (un div). Si el click
            // cayó sobre un input/label/button hijo, lo dejamos pasar.
            var inner = ev.target;
            if (inner && inner !== btn) {
                var skip = inner.closest && inner.closest(
                    'input, textarea, select, button, a, label'
                );
                if (skip && skip !== btn && btn.contains(skip)) return;
            }
        }

        if (action === 'toggle-section') {
            ev.preventDefault();
            toggleSection(secId);
        } else if (action === 'toggle-item') {
            ev.preventDefault();
            toggleItem(secId, itemId);
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
        } else if (action === 'toggle-sidebar') {
            ev.preventDefault();
            var root = S.container.querySelector('.cv-root');
            if (root) root.classList.toggle('cv-sidebar-hidden');
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
            // No tocamos los inputs de TC/IVA (el usuario los está editando):
            // refrescamos solo los valores derivados.
            updateFinValuesAndStats();
            return;
        }
        if (key === 'iva') {
            var iv = num(val);
            if (S.volumetria) S.volumetria.iva_pct = iv;
            scheduleMetaSave({ iva_pct: iv });
            updateFinValuesAndStats();
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

    /** Expande/colapsa el detalle inline de un item. Estado UI puro
     *  (no se persiste). Mutamos solo la clase del DOM y el Set
     *  S.expandedItems — sin re-render para mantener el foco / la
     *  posición del scroll. */
    function toggleItem(secId, itemId) {
        if (!S.expandedItems) return;
        var itemEl = S.container && S.container.querySelector(
            '.cv-item[data-section="' + cssEsc(secId) + '"][data-item="' + cssEsc(itemId) + '"]'
        );
        if (!itemEl) return;
        if (S.expandedItems.has(itemId)) {
            S.expandedItems.delete(itemId);
            itemEl.classList.remove('cv-item-expanded');
        } else {
            S.expandedItems.add(itemId);
            itemEl.classList.add('cv-item-expanded');
        }
    }

    function addRow(secId) {
        var sec = findSection(secId);
        if (!sec) return;
        sec.items.push(newItemForType(sec.tipo));
        sec.expanded = true;
        rerenderSection(sec);
        // Foco al primer input editable del item nuevo
        var rows = S.container.querySelectorAll(
            'section[data-section="' + cssEsc(secId) + '"] .cv-items > .cv-item'
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
            'section[data-section="' + cssEsc(secId) + '"] .cv-items > .cv-item-rotulo'
        );
        var last = rows[rows.length - 1];
        if (last) {
            var inp = last.querySelector('input.cv-item-rotulo-input');
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

    /** Promise que resuelve `true` si el usuario confirma la acción.
     *  Usa el widget custom `window.lwConfirm` (definido por el host
     *  `crm_levantamiento.js`). Si por alguna razón no está disponible
     *  (ej. el módulo se monta fuera del wizard), cae a `window.confirm`
     *  para no romper el flujo. */
    function askConfirm(opts) {
        opts = opts || {};
        if (typeof window.lwConfirm === 'function') {
            return window.lwConfirm(opts);
        }
        var ok = window.confirm(
            (opts.title ? opts.title + '\n\n' : '') +
            String(opts.message || '').replace(/<[^>]+>/g, '')
        );
        return Promise.resolve(!!ok);
    }

    function delItem(secId, itemId) {
        var sec = findSection(secId);
        if (!sec) return;
        var it = (sec.items || []).filter(function (x) { return x.id === itemId; })[0];
        // Etiqueta para el mensaje: descripcion / texto / parte / fallback
        var label = '';
        if (it) {
            if (it.row_type === 'header') label = it.texto || 'rótulo';
            else label = it.descripcion || it.parte || it.recurso || it.marca || '';
        }
        var msg;
        if (label) {
            msg = '¿Eliminar la fila <b>"' + esc(label) + '"</b>? Esta acción no se puede deshacer.';
        } else {
            msg = '¿Eliminar esta fila? Esta acción no se puede deshacer.';
        }
        askConfirm({
            title: 'Eliminar fila',
            message: msg,
            confirmLabel: 'Eliminar',
            cancelLabel: 'Cancelar',
            tone: 'danger',
        }).then(function (ok) {
            if (!ok) return;
            // Re-resolvemos sec/items por si el data cambió mientras tanto.
            var s = findSection(secId);
            if (!s) return;
            s.items = (s.items || []).filter(function (x) { return x.id !== itemId; });
            if (S.expandedItems && S.expandedItems.delete) S.expandedItems.delete(itemId);
            rerenderSection(s);
            updateBottom();
            scheduleAutosave();
        });
    }

    function delSection(secId) {
        var sec = findSection(secId);
        if (!sec) return;
        var n = (sec.items || []).filter(function (it) { return it.row_type !== 'header'; }).length;
        var titulo = sec.titulo || 'esta tabla';
        var msg;
        if (n > 0) {
            msg = 'La tabla <b>"' + esc(titulo) + '"</b> tiene ' + n + ' item' +
                  (n === 1 ? '' : 's') + '. Esta acción no se puede deshacer.';
        } else {
            msg = '¿Eliminar la tabla <b>"' + esc(titulo) + '"</b>? Esta acción no se puede deshacer.';
        }
        askConfirm({
            title: 'Eliminar tabla',
            message: msg,
            confirmLabel: 'Eliminar',
            cancelLabel: 'Cancelar',
            tone: 'danger',
        }).then(function (ok) {
            if (!ok) return;
            var s = findSection(secId);
            if (!s) return;
            // Limpiar expanded de todos los items de esta sección
            if (S.expandedItems && S.expandedItems.delete) {
                (s.items || []).forEach(function (x) { S.expandedItems.delete(x.id); });
            }
            S.data.secciones = (S.data.secciones || []).filter(function (z) { return z.id !== secId; });
            render();
            scheduleAutosave();
        });
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
        // Calcular idx actual de la sección (para el pill "01" / "02" / …).
        var idx = 0;
        var arr = (S.data && S.data.secciones) || [];
        for (var i = 0; i < arr.length; i++) {
            if (arr[i].id === sec.id) { idx = i; break; }
        }
        var tmp = document.createElement('div');
        tmp.innerHTML = renderSection(sec, idx);
        var newEl = tmp.firstChild;
        oldEl.replaceWith(newEl);
        // Re-bind del trozo
        newEl.querySelectorAll('.cv-section-title-input').forEach(function (inp) {
            inp.addEventListener('input', onSectionTitleInput);
        });
        newEl.querySelectorAll('.cv-items [data-field]').forEach(function (inp) {
            inp.addEventListener('input', onItemInput);
            inp.addEventListener('change', onItemInput);
            inp.addEventListener('blur', onItemBlur);
        });
    }

    function updateRowCalcs(sec, it) {
        if (!S.container) return;
        if (sec.tipo === 'equipamiento' && it.row_type === 'header') return;
        var c = calcItem(sec, it);
        // Item-card raíz
        var rowEl = S.container.querySelector(
            '.cv-item[data-section="' + cssEsc(sec.id) + '"][data-item="' + cssEsc(it.id) + '"]'
        );
        if (!rowEl) return;
        // El total de la cabecera y los calcs del detalle viven todos
        // bajo el item; los marcamos con [data-calc].
        var calcs = rowEl.querySelectorAll('[data-calc]');
        calcs.forEach(function (cell) {
            var k = cell.getAttribute('data-calc');
            var val = c[k];
            if (val == null) return;
            // El total del header tiene un span interno con el valor.
            var valSpan = cell.querySelector('.cv-item-total-value, .cv-item-detail-value');
            if (valSpan) {
                valSpan.textContent = fmtMoney(val);
            } else {
                cell.textContent = fmtMoney(val);
            }
            // Color de ganancia
            if (k === 'ganancia') {
                cell.classList.toggle('cv-item-positive', val >= 0);
                cell.classList.toggle('cv-item-negative', val < 0);
            }
        });
        // Actualizar placeholder de C.Unit en equipamiento (refleja calc actual)
        if (sec.tipo === 'equipamiento') {
            var cu = rowEl.querySelector('input[data-field="costoUnitario"]');
            if (cu) cu.placeholder = fmtPlain(c.cUnit);
        }
    }

    /** Refresca el "Subtotal zona" del head + el meta de # items.
     *  (Antes esto era el tfoot de la tabla; ahora el subtotal vive en
     *  el head como dato visible incluso al colapsar la sección.) */
    function updateSectionTfoot(sec) {
        if (!S.container) return;
        var secEl = S.container.querySelector('section[data-section="' + cssEsc(sec.id) + '"]');
        if (!secEl) return;
        var t = calcSection(sec);
        var subtotal = (sec.tipo === 'costo_mo')
            ? t.totalCosto : t.totalCli;
        var subEl = secEl.querySelector('.cv-section-subtotal-value');
        if (subEl) subEl.textContent = fmtMoney(subtotal);
        // Meta de items (ej. "Equipamiento · 3 items")
        var info = TYPE_INFO[sec.tipo] || TYPE_INFO.equipamiento;
        var nItems = (sec.items || []).filter(function (x) { return x.row_type !== 'header'; }).length;
        var metaEl = secEl.querySelector('.cv-section-meta');
        if (metaEl) {
            metaEl.innerHTML = esc(info.label) +
                ' <span aria-hidden="true">·</span> ' + nItems +
                (nItems === 1 ? ' item' : ' items');
        }
    }

    function updateBottom() {
        if (!S.container) return;
        var oldBottom = S.container.querySelector('.cv-bottom');
        var tmp = document.createElement('div');
        tmp.innerHTML = renderBottom();
        var newBottom = tmp.firstChild;
        if (oldBottom) oldBottom.replaceWith(newBottom);
        else S.container.querySelector('.cv-root').appendChild(newBottom);

        // Re-bind: el card de Resumen Financiero ahora hospeda los inputs
        // de TC e IVA con [data-meta]; al reemplazar el bottom hay que
        // restaurar los handlers (el click es delegado al contenedor, así
        // que el toggle-status del card stats no requiere rebind).
        newBottom.querySelectorAll('[data-meta]').forEach(function (inp) {
            inp.addEventListener('input', onMetaInput);
            inp.addEventListener('change', onMetaInput);
        });
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
            S.expandedItems = (typeof Set !== 'undefined') ? new Set() : null;

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
            S.expandedItems = null;
        },
    };
})();
