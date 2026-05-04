/**
 * crm_volumetria.js — Editor de Volumetría v2 (Fase A)
 *
 * Módulo de UI para editar una volumetría (Fase 3 del wizard de levantamiento).
 * Reemplaza el editor plano `_renderPhase3Editor` que vivía en
 * crm_levantamiento.js. Toda la lógica de cálculo, render, autosave y
 * persistencia está autocontenida aquí — solo expone el global
 * `window.crmVolumetria` para que el host (crm_levantamiento.js) lo monte.
 *
 * Contrato del JSON `data` v2 — ver spec en repo. Estructura resumida:
 *   {
 *     version: 2,
 *     equipamiento: { secciones: [{ id, nombre, items: [{row_type:'item'|'header', ...}] }] },
 *     mano_obra:    { items: [...] },
 *     costo_mo:     { items: [...] },
 *     gastos:       { items: [...] },
 *   }
 *
 * Endpoints usados (no los modifica):
 *   POST /app/api/iamet/volumetrias/{id}/data/        ← autosave de data
 *   POST /app/api/iamet/volumetrias/{id}/actualizar/  ← meta (iva_pct, tipo_cambio, ...)
 *   GET  /app/api/iamet/catalogo-productos/?q=...     ← buscador de productos
 *
 * Convenciones:
 *   - IIFE estricto, vanilla DOM.
 *   - Logs prefijo `[volumetria]`.
 *   - Clases CSS prefijo `cv-` (las implementa otro agente en paralelo, ver
 *     bloque al final del archivo con la lista completa).
 */
(function () {
    'use strict';

    // ── Estado del módulo (singleton — solo un editor a la vez) ─────
    var S = {
        container: null,        // HTMLElement raíz donde montamos
        volumetria: null,       // Objeto plano: {id, nombre, status, data, iva_pct, tipo_cambio, ...}
        levantamiento: null,    // Lev data (por si necesitamos fallback)
        readonly: false,
        onDirty: null,
        onSaved: null,

        data: null,             // El objeto v2 vivo (lo que editamos en memoria)

        // Autosave
        saveTimer: null,
        saveInFlight: false,
        savePending: false,     // hubo cambios mientras estábamos guardando

        // Catálogo (modal compartido — se crea bajo demanda)
        catalogState: {
            visible: false,
            current: [],        // resultado de la última búsqueda
            target: null,       // { sectionId, itemId } — fila destino
            timer: null,
        },

        // Drag handlers globales registrados (para limpiar en destroy)
        boundDocClick: null,
        boundDocKey: null,
    };

    // ── Helpers básicos ──────────────────────────────────────────────
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
        // Fallback RFC4122-ish
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

    function fmtMoney(n, currency) {
        currency = currency || 'USD';
        var v = num(n);
        var sign = v < 0 ? '-' : '';
        v = Math.abs(v);
        var s = v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return sign + (currency === 'MXN' ? '$' : '$') + s;
    }

    function fmtPct(n) {
        return num(n).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
    }

    function getCsrf() {
        var el = document.querySelector('[name=csrfmiddlewaretoken]');
        if (el) return el.value;
        // Fallback: cookie
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

    function apiGet(url) {
        return fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
        }).then(function (r) { return r.json(); });
    }

    // ── Migración / normalización de data v2 ────────────────────────
    // Acepta: data v2 (lo deja como está), data v1 ({materiales, manoObra, gastos}) o vacío.
    function normalizeData(raw) {
        raw = raw || {};

        // ¿Ya es v2?
        if (raw.version === 2 && raw.equipamiento) {
            return ensureShape(raw);
        }

        // Migración suave desde v1 → v2:
        var d = {
            version: 2,
            equipamiento: { secciones: [] },
            mano_obra: { items: [] },
            costo_mo: { items: [] },
            gastos: { items: [] },
        };

        // v1.materiales → equipamiento.secciones[0].items
        if (Array.isArray(raw.materiales) && raw.materiales.length) {
            d.equipamiento.secciones.push({
                id: uuid(),
                nombre: 'Equipamiento',
                items: raw.materiales.map(function (m) {
                    var pLista = num(m.precioLista || m.precio || 0);
                    var dC = num(m.descCompra || 0);
                    var dV = num(m.descVenta || 0);
                    return {
                        id: uuid(),
                        row_type: 'item',
                        marca: m.marca || '',
                        no_parte: m.modelo || '',
                        cant: num(m.qty || 0),
                        descripcion: m.desc || '',
                        p_lista: pLista,
                        desc_v_pct: dV,
                        p_unit_v: 0,
                        p_total_v: 0,
                        desc_c_pct: dC,
                        c_unit: 0,
                        c_total: 0,
                        ganancia: 0,
                        proveedor: m.proveedor || '',
                        entrega: m.entrega || '',
                        notas: '',
                    };
                }),
            });
        }

        // v1.manoObra → mano_obra.items (servicios cobrados)
        if (Array.isArray(raw.manoObra) && raw.manoObra.length) {
            d.mano_obra.items = raw.manoObra.map(function (r) {
                return {
                    id: uuid(),
                    marca: r.marca || 'BAJANET',
                    no_parte: r.modelo || 'SERVICIO',
                    cant: num(r.qty || 0),
                    descripcion: r.desc || '',
                    p_unit: num(r.precioUnit || r.precio || 0),
                    total: 0,
                    notas: '',
                };
            });
        }

        // v1.gastos → gastos.items
        if (Array.isArray(raw.gastos) && raw.gastos.length) {
            d.gastos.items = raw.gastos.map(function (r) {
                return {
                    id: uuid(),
                    cant: num(r.qty || 0),
                    unidad: r.unid || 'PZA',
                    descripcion: r.desc || '',
                    costo_unit: num(r.costoUnit || r.precio || 0),
                    total: 0,
                };
            });
        }

        return ensureShape(d);
    }

    // Asegura que cada nivel tenga las llaves esperadas (por si llega data parcial).
    function ensureShape(d) {
        d.version = 2;
        d.equipamiento = d.equipamiento || { secciones: [] };
        d.equipamiento.secciones = d.equipamiento.secciones || [];
        d.mano_obra = d.mano_obra || { items: [] };
        d.mano_obra.items = d.mano_obra.items || [];
        d.costo_mo = d.costo_mo || { items: [] };
        d.costo_mo.items = d.costo_mo.items || [];
        d.gastos = d.gastos || { items: [] };
        d.gastos.items = d.gastos.items || [];

        // Si no hay ninguna sección de equipamiento, crear una por default
        if (!d.equipamiento.secciones.length) {
            d.equipamiento.secciones.push({
                id: uuid(),
                nombre: 'Equipamiento',
                items: [],
            });
        }

        // Asegurar que cada item tenga id + row_type
        d.equipamiento.secciones.forEach(function (sec) {
            sec.id = sec.id || uuid();
            sec.items = sec.items || [];
            sec.items.forEach(function (it) {
                it.id = it.id || uuid();
                it.row_type = it.row_type || 'item';
            });
        });
        d.mano_obra.items.forEach(function (it) { it.id = it.id || uuid(); });
        d.costo_mo.items.forEach(function (it) { it.id = it.id || uuid(); });
        d.gastos.items.forEach(function (it) { it.id = it.id || uuid(); });

        return d;
    }

    // ── Cálculos puros ─────────────────────────────────────────────
    function calcEqItem(it) {
        if (it.row_type === 'header') return { p_unit_v: 0, p_total_v: 0, c_unit: 0, c_total: 0, ganancia: 0 };
        var pLista = num(it.p_lista);
        var dV = num(it.desc_v_pct);
        var dC = num(it.desc_c_pct);
        var cant = num(it.cant);

        var pUnitV = pLista * (1 - dV / 100);
        var pTotalV = cant * pUnitV;
        var cUnit = pLista * (1 - dC / 100);
        var cTotal = cant * cUnit;
        var ganancia = pTotalV - cTotal;

        return {
            p_unit_v: pUnitV,
            p_total_v: pTotalV,
            c_unit: cUnit,
            c_total: cTotal,
            ganancia: ganancia,
        };
    }

    function calcMoRow(r) {
        return num(r.cant) * num(r.p_unit);
    }
    function calcCmoRow(r) {
        var conc = num(r.cant) * num(r.costo_unit);
        return { concentrado: conc, total: conc * num(r.dias) };
    }
    function calcGastoRow(r) {
        return num(r.cant) * num(r.costo_unit);
    }

    function computeTotals() {
        var d = S.data;
        var totEqV = 0, totEqC = 0;
        d.equipamiento.secciones.forEach(function (sec) {
            sec.items.forEach(function (it) {
                if (it.row_type !== 'item') return;
                var c = calcEqItem(it);
                totEqV += c.p_total_v;
                totEqC += c.c_total;
            });
        });
        var totMoV = 0;
        d.mano_obra.items.forEach(function (r) { totMoV += calcMoRow(r); });
        var totMoC = 0;
        d.costo_mo.items.forEach(function (r) { totMoC += calcCmoRow(r).total; });
        var totGastos = 0;
        d.gastos.items.forEach(function (r) { totGastos += calcGastoRow(r); });

        var subtotalVenta = totEqV + totMoV;
        var totalCosto = totEqC + totMoC + totGastos;
        var ganancia = subtotalVenta - totalCosto;
        var margenPct = subtotalVenta > 0 ? (ganancia / subtotalVenta * 100) : 0;
        var ivaPct = num(S.volumetria.iva_pct != null ? S.volumetria.iva_pct : 16);
        var ivaMonto = subtotalVenta * (ivaPct / 100);
        var totalConIva = subtotalVenta + ivaMonto;

        return {
            total_eq_venta: totEqV,
            total_eq_costo: totEqC,
            total_mo_cobrada: totMoV,
            total_mo_costo: totMoC,
            total_gastos: totGastos,
            subtotal_venta: subtotalVenta,
            total_costo: totalCosto,
            ganancia: ganancia,
            margen_pct: margenPct,
            iva_pct: ivaPct,
            iva_monto: ivaMonto,
            total_con_iva: totalConIva,
        };
    }

    // ── Render principal ────────────────────────────────────────────
    function render() {
        var c = S.container;
        c.innerHTML = ''; // limpia
        var root = el('div', 'cv-root' + (S.readonly ? ' cv-readonly' : ''));
        root.appendChild(renderConfigBar());

        var layout = el('div', 'cv-layout');
        var content = el('div', 'cv-content');
        content.appendChild(renderEquipamiento());
        content.appendChild(renderMoCobrada());
        content.appendChild(renderCostoMo());
        content.appendChild(renderGastos());
        layout.appendChild(content);

        var sidebar = el('aside', 'cv-sidebar');
        sidebar.id = 'cv-sidebar';
        sidebar.appendChild(renderSidebar());
        layout.appendChild(sidebar);

        root.appendChild(layout);

        // Modal de catálogo (oculto por default)
        root.appendChild(renderCatalogModal());

        c.appendChild(root);

        bindDelegated(root);
        refreshSidebar();
    }

    // Helper: crea elementos
    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }

    // ── Barra superior: Moneda · TC · IVA · catálogo ────────────────
    function renderConfigBar() {
        var bar = el('div', 'cv-config-bar');
        var tc = num(S.volumetria.tipo_cambio || 19.50);
        var iva = num(S.volumetria.iva_pct != null ? S.volumetria.iva_pct : 16);
        var ro = S.readonly ? 'disabled' : '';

        // Config bar compacta: solo TC e IVA. El botón "Buscar en catálogo"
        // global se quitó porque queda desconectado de las filas — ahora
        // cada fila de Equipamiento tiene su propia lupa para hacer el
        // prefill en su contexto.
        bar.innerHTML =
            '<div class="cv-cfg-group">' +
                '<label class="cv-cfg-label">Moneda</label>' +
                '<span class="cv-cfg-value">USD</span>' +
            '</div>' +
            '<div class="cv-cfg-sep"></div>' +
            '<div class="cv-cfg-group">' +
                '<label class="cv-cfg-label" for="cv-tc">Tipo de cambio</label>' +
                '<input id="cv-tc" class="cv-cfg-input" type="number" step="0.01" min="0" value="' + tc.toFixed(2) + '" ' + ro + '>' +
                '<span class="cv-cfg-suffix">MXN/USD</span>' +
            '</div>' +
            '<div class="cv-cfg-sep"></div>' +
            '<div class="cv-cfg-group">' +
                '<label class="cv-cfg-label" for="cv-iva">IVA</label>' +
                '<input id="cv-iva" class="cv-cfg-input" type="number" step="0.01" min="0" max="100" value="' + iva + '" ' + ro + '>' +
                '<span class="cv-cfg-suffix">%</span>' +
            '</div>' +
            '<div class="cv-cfg-spacer"></div>';

        return bar;
    }

    // ── Sección genérica con acordeón ───────────────────────────────
    function renderSectionShell(key, titulo, subtotalLabel) {
        var sec = el('section', 'cv-section');
        sec.setAttribute('data-key', key);
        sec.classList.add('cv-section-open'); // default expandido

        var head = el('div', 'cv-section-header');
        head.setAttribute('data-cv-action', 'toggle-section');
        head.setAttribute('data-section-key', key);
        head.innerHTML =
            '<svg class="cv-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
            '<h3 class="cv-section-title">' + esc(titulo) + '</h3>' +
            '<span class="cv-section-subtotal" data-cv-subtotal="' + key + '">' +
                '<span class="cv-subtotal-label">' + esc(subtotalLabel || 'Subtotal') + ':</span> ' +
                '<span class="cv-subtotal-value" data-cv-subtotal-value="' + key + '">$0.00</span>' +
            '</span>';
        sec.appendChild(head);

        var body = el('div', 'cv-section-body');
        sec.appendChild(body);
        return { section: sec, body: body };
    }

    // ── Equipamiento ────────────────────────────────────────────────
    function renderEquipamiento() {
        var shell = renderSectionShell('equipamiento', 'Equipamiento', 'Subtotal venta');
        var body = shell.body;

        S.data.equipamiento.secciones.forEach(function (sub) {
            body.appendChild(renderSubsection(sub));
        });

        if (!S.readonly) {
            var add = el('button', 'cv-add-subsection');
            add.type = 'button';
            add.setAttribute('data-cv-action', 'add-subsection');
            add.innerHTML =
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
                'Agregar sub-sección';
            body.appendChild(add);
        }

        return shell.section;
    }

    function renderSubsection(sub) {
        var s = el('div', 'cv-subsection');
        s.setAttribute('data-section-id', sub.id);

        // Header con nombre editable + botones
        var head = el('div', 'cv-subsection-header');
        var nameInput;
        if (S.readonly) {
            nameInput = el('span', 'cv-subsection-name', esc(sub.nombre || '(sin nombre)'));
        } else {
            nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'cv-subsection-name-input';
            nameInput.value = sub.nombre || '';
            nameInput.placeholder = 'Nombre de la sub-sección';
            nameInput.setAttribute('data-cv-bind', 'subsection-name');
        }
        head.appendChild(nameInput);

        if (!S.readonly) {
            var actions = el('div', 'cv-subsection-actions');
            actions.innerHTML =
                '<button type="button" class="cv-btn cv-btn-ghost" data-cv-action="add-item">' +
                    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
                    'Producto' +
                '</button>' +
                '<button type="button" class="cv-btn cv-btn-ghost" data-cv-action="add-header-row">' +
                    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/></svg>' +
                    'Rótulo' +
                '</button>' +
                '<button type="button" class="cv-btn cv-btn-danger-ghost" data-cv-action="del-subsection" title="Eliminar sub-sección">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>' +
                '</button>';
            head.appendChild(actions);
        }
        s.appendChild(head);

        var body = el('div', 'cv-subsection-body');
        body.appendChild(renderEqTable(sub));
        s.appendChild(body);

        return s;
    }

    // Tabla de Equipamiento — 14 columnas + delete.
    // Header en 2 filas con grupos visuales: BÁSICOS · VENTA · COSTO · EXTRA
    // para que el ingeniero no tenga que descifrar abreviaciones tipo
    // "% D V". Si la sub-sección está vacía, se renderiza un estado
    // vacío en lugar de la tabla con headers flotando solos.
    function renderEqTable(sub) {
        if (!sub.items || sub.items.length === 0) {
            return renderEmptyState({
                kind: 'eq',
                title: 'Aún no hay productos',
                message: 'Agrega el primero o búscalo en el catálogo.',
                primary: { label: 'Agregar producto', action: 'add-item' },
                secondary: { label: 'Buscar en catálogo', action: 'add-item-from-catalog' },
            });
        }

        var tableWrap = el('div', 'cv-table-wrap');
        var table = el('table', 'cv-table cv-table-eq');
        table.setAttribute('data-section-id', sub.id);

        var actCol = S.readonly ? '' : '<th class="cv-th-act" rowspan="2"></th>';
        var thead = el('thead', '', (
            '<tr class="cv-th-groups">' +
                '<th class="cv-th-grp-basicos" colspan="5">Básicos</th>' +
                '<th class="cv-th-grp-venta" colspan="4">Venta</th>' +
                '<th class="cv-th-grp-costo" colspan="3">Costo</th>' +
                '<th class="cv-th-grp-resto" colspan="4">Detalle</th>' +
                actCol +
            '</tr>' +
            '<tr class="cv-th-cols">' +
                '<th class="cv-th-num">#</th>' +
                '<th>Marca</th>' +
                '<th>No. Parte</th>' +
                '<th class="cv-th-num">Cant</th>' +
                '<th>Descripción</th>' +
                '<th class="cv-th-num">P. Lista</th>' +
                '<th class="cv-th-num" title="Descuento sobre lista (venta)">% Desc</th>' +
                '<th class="cv-th-num">P. Unit</th>' +
                '<th class="cv-th-num">P. Total</th>' +
                '<th class="cv-th-num" title="Descuento sobre lista (costo)">% Desc</th>' +
                '<th class="cv-th-num">C. Unit</th>' +
                '<th class="cv-th-num">C. Total</th>' +
                '<th class="cv-th-num">Ganancia</th>' +
                '<th>Proveedor</th>' +
                '<th>Entrega</th>' +
                '<th>Notas</th>' +
            '</tr>'
        ));
        table.appendChild(thead);

        var tbody = el('tbody');
        sub.items.forEach(function (it, i) {
            tbody.appendChild(renderEqRow(sub, it, i));
        });
        table.appendChild(tbody);

        tableWrap.appendChild(table);
        return tableWrap;
    }

    // Estado vacío genérico para una tabla sin items
    function renderEmptyState(opts) {
        var box = el('div', 'cv-empty');
        if (S.readonly) {
            box.innerHTML =
                '<div class="cv-empty-icon">' +
                    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
                '</div>' +
                '<div class="cv-empty-title">Sin información</div>' +
                '<div class="cv-empty-msg">El ingeniero no capturó datos en esta sección.</div>';
            return box;
        }
        var prim = opts.primary || {};
        var sec = opts.secondary;
        var html =
            '<div class="cv-empty-icon">' +
                '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>' +
            '</div>' +
            '<div class="cv-empty-title">' + esc(opts.title || 'Sin items') + '</div>' +
            '<div class="cv-empty-msg">' + esc(opts.message || '') + '</div>' +
            '<div class="cv-empty-actions">' +
                '<button type="button" class="cv-btn cv-btn-primary" data-cv-action="' + esc(prim.action) + '">' +
                    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
                    esc(prim.label) +
                '</button>' +
                (sec ?
                    '<button type="button" class="cv-btn cv-btn-ghost" data-cv-action="' + esc(sec.action) + '">' +
                        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
                        esc(sec.label) +
                    '</button>'
                : '') +
            '</div>';
        box.innerHTML = html;
        return box;
    }

    function renderEqRow(sub, it, idx) {
        var tr = el('tr');
        tr.setAttribute('data-item-id', it.id);
        tr.setAttribute('data-row-type', it.row_type);

        if (it.row_type === 'header') {
            tr.classList.add('cv-row-header');
            var totalCols = S.readonly ? 16 : 16; // 16 cells visibles + 1 acción si edit
            // Render: una sola celda spanning con el texto editable
            var label;
            if (S.readonly) {
                label = '<span class="cv-header-text">' + esc(it.texto || '') + '</span>';
            } else {
                label = '<input type="text" class="cv-header-input" data-cv-field="texto" value="' + esc(it.texto || '') + '" placeholder="Rótulo (ej. Escalerilla 100mm IDF3)">';
            }
            tr.innerHTML =
                '<td class="cv-cell-num">' + (idx + 1) + '</td>' +
                '<td colspan="' + (S.readonly ? 15 : 15) + '" class="cv-header-cell">' + label + '</td>' +
                (S.readonly ? '' : '<td class="cv-cell-act">' + delBtnHtml() + '</td>');
            return tr;
        }

        // Row item normal
        var c = calcEqItem(it);
        var ro = S.readonly;

        function inp(field, type, val, opts) {
            opts = opts || {};
            if (ro) {
                return '<span class="cv-cell-ro">' + esc(val == null ? '' : String(val)) + '</span>';
            }
            var step = type === 'num' ? ' step="0.01"' : '';
            var typeAttr = type === 'num' ? 'number' : 'text';
            return '<input type="' + typeAttr + '" class="cv-cell-input ' + (opts.cls || '') + '"' +
                ' data-cv-field="' + field + '"' + step +
                ' value="' + esc(val == null ? '' : String(val)) + '"' +
                (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + '>';
        }

        tr.innerHTML =
            '<td class="cv-cell-num">' + (idx + 1) + '</td>' +
            '<td>' + inp('marca', 'text', it.marca) + '</td>' +
            '<td>' + inp('no_parte', 'text', it.no_parte, { cls: 'cv-mono' }) + '</td>' +
            '<td class="cv-cell-num">' + inp('cant', 'num', it.cant) + '</td>' +
            '<td class="cv-cell-desc">' + inp('descripcion', 'text', it.descripcion) + '</td>' +
            '<td class="cv-cell-num">' + inp('p_lista', 'num', it.p_lista) + '</td>' +
            '<td class="cv-cell-num">' + inp('desc_v_pct', 'num', it.desc_v_pct) + '</td>' +
            '<td class="cv-cell-num cv-cell-calc"><span data-cv-calc="p_unit_v">' + fmtMoney(c.p_unit_v) + '</span></td>' +
            '<td class="cv-cell-num cv-cell-calc cv-cell-strong"><span data-cv-calc="p_total_v">' + fmtMoney(c.p_total_v) + '</span></td>' +
            '<td class="cv-cell-num">' + inp('desc_c_pct', 'num', it.desc_c_pct) + '</td>' +
            '<td class="cv-cell-num cv-cell-calc"><span data-cv-calc="c_unit">' + fmtMoney(c.c_unit) + '</span></td>' +
            '<td class="cv-cell-num cv-cell-calc"><span data-cv-calc="c_total">' + fmtMoney(c.c_total) + '</span></td>' +
            '<td class="cv-cell-num cv-cell-calc cv-cell-gain"><span data-cv-calc="ganancia">' + fmtMoney(c.ganancia) + '</span></td>' +
            '<td>' + inp('proveedor', 'text', it.proveedor) + '</td>' +
            '<td>' + inp('entrega', 'text', it.entrega) + '</td>' +
            '<td>' + inp('notas', 'text', it.notas) + '</td>' +
            (S.readonly ? '' : '<td class="cv-cell-act">' +
                '<button type="button" class="cv-row-tool" data-cv-action="catalog-prefill" title="Buscar en catálogo">' +
                    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
                '</button>' +
                delBtnHtml() +
            '</td>');

        return tr;
    }

    function delBtnHtml() {
        return '<button type="button" class="cv-row-del" data-cv-action="del-row" title="Eliminar fila">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>';
    }

    // ── Mano de Obra Cobrada ────────────────────────────────────────
    function renderMoCobrada() {
        var shell = renderSectionShell('mano_obra', 'Mano de Obra Cobrada', 'Subtotal venta');
        var body = shell.body;
        if ((S.data.mano_obra.items || []).length === 0) {
            body.appendChild(renderEmptyState({
                title: 'Aún no hay servicios cobrados',
                message: 'Captura los servicios profesionales que se le cobran al cliente.',
                primary: { label: 'Agregar servicio', action: 'add-row-mo_cobrada' },
            }));
        } else {
            body.appendChild(renderMoTable());
            if (!S.readonly) body.appendChild(addRowBtn('mano_obra', 'Agregar servicio'));
        }
        return shell.section;
    }

    function renderMoTable() {
        var wrap = el('div', 'cv-table-wrap');
        var t = el('table', 'cv-table cv-table-mo');
        t.innerHTML =
            '<thead><tr>' +
                '<th class="cv-th-num">#</th>' +
                '<th>Marca</th>' +
                '<th>No. Parte</th>' +
                '<th class="cv-th-num">Cant</th>' +
                '<th>Descripción</th>' +
                '<th class="cv-th-num">P. Unit</th>' +
                '<th class="cv-th-num">Total</th>' +
                '<th>Notas</th>' +
                (S.readonly ? '' : '<th class="cv-th-act"></th>') +
            '</tr></thead>';
        var tb = el('tbody');
        t.appendChild(tb);
        S.data.mano_obra.items.forEach(function (r, i) {
            tb.appendChild(renderMoRow(r, i));
        });
        wrap.appendChild(t);
        return wrap;
    }

    function renderMoRow(r, idx) {
        var tr = el('tr');
        tr.setAttribute('data-item-id', r.id);
        tr.setAttribute('data-table', 'mano_obra');
        var total = calcMoRow(r);
        var ro = S.readonly;

        function inp(field, type, val) {
            if (ro) return '<span class="cv-cell-ro">' + esc(val == null ? '' : String(val)) + '</span>';
            var step = type === 'num' ? ' step="0.01"' : '';
            var typeAttr = type === 'num' ? 'number' : 'text';
            return '<input type="' + typeAttr + '" class="cv-cell-input"' +
                ' data-cv-field="' + field + '"' + step +
                ' value="' + esc(val == null ? '' : String(val)) + '">';
        }

        tr.innerHTML =
            '<td class="cv-cell-num">' + (idx + 1) + '</td>' +
            '<td>' + inp('marca', 'text', r.marca) + '</td>' +
            '<td>' + inp('no_parte', 'text', r.no_parte) + '</td>' +
            '<td class="cv-cell-num">' + inp('cant', 'num', r.cant) + '</td>' +
            '<td class="cv-cell-desc">' + inp('descripcion', 'text', r.descripcion) + '</td>' +
            '<td class="cv-cell-num">' + inp('p_unit', 'num', r.p_unit) + '</td>' +
            '<td class="cv-cell-num cv-cell-calc cv-cell-strong"><span data-cv-calc="total">' + fmtMoney(total) + '</span></td>' +
            '<td>' + inp('notas', 'text', r.notas) + '</td>' +
            (S.readonly ? '' : '<td class="cv-cell-act">' + delBtnHtml() + '</td>');
        return tr;
    }

    // ── Costo MO Interno ────────────────────────────────────────────
    function renderCostoMo() {
        var shell = renderSectionShell('costo_mo', 'Costo MO Interno', 'Total costo MO');
        var body = shell.body;
        if ((S.data.costo_mo.items || []).length === 0) {
            body.appendChild(renderEmptyState({
                title: 'Aún no hay recursos',
                message: 'Desglosa lo que le cuesta a la empresa: técnicos, supervisores, viáticos.',
                primary: { label: 'Agregar recurso', action: 'add-row-cmo' },
            }));
        } else {
            body.appendChild(renderCmoTable());
            if (!S.readonly) body.appendChild(addRowBtn('costo_mo', 'Agregar recurso'));
        }
        return shell.section;
    }

    function renderCmoTable() {
        var wrap = el('div', 'cv-table-wrap');
        var t = el('table', 'cv-table cv-table-cmo');
        t.innerHTML =
            '<thead><tr>' +
                '<th class="cv-th-num">#</th>' +
                '<th>Recurso</th>' +
                '<th class="cv-th-num">Cant</th>' +
                '<th class="cv-th-num">Costo Unit</th>' +
                '<th class="cv-th-num">Concentrado</th>' +
                '<th class="cv-th-num">Días</th>' +
                '<th class="cv-th-num">Total</th>' +
                (S.readonly ? '' : '<th class="cv-th-act"></th>') +
            '</tr></thead>';
        var tb = el('tbody');
        t.appendChild(tb);
        S.data.costo_mo.items.forEach(function (r, i) {
            tb.appendChild(renderCmoRow(r, i));
        });
        wrap.appendChild(t);
        return wrap;
    }

    function renderCmoRow(r, idx) {
        var tr = el('tr');
        tr.setAttribute('data-item-id', r.id);
        tr.setAttribute('data-table', 'costo_mo');
        var calc = calcCmoRow(r);
        var ro = S.readonly;

        function inp(field, type, val) {
            if (ro) return '<span class="cv-cell-ro">' + esc(val == null ? '' : String(val)) + '</span>';
            var step = type === 'num' ? ' step="0.01"' : '';
            var typeAttr = type === 'num' ? 'number' : 'text';
            return '<input type="' + typeAttr + '" class="cv-cell-input"' +
                ' data-cv-field="' + field + '"' + step +
                ' value="' + esc(val == null ? '' : String(val)) + '">';
        }

        tr.innerHTML =
            '<td class="cv-cell-num">' + (idx + 1) + '</td>' +
            '<td>' + inp('recurso', 'text', r.recurso) + '</td>' +
            '<td class="cv-cell-num">' + inp('cant', 'num', r.cant) + '</td>' +
            '<td class="cv-cell-num">' + inp('costo_unit', 'num', r.costo_unit) + '</td>' +
            '<td class="cv-cell-num cv-cell-calc"><span data-cv-calc="concentrado">' + fmtMoney(calc.concentrado) + '</span></td>' +
            '<td class="cv-cell-num">' + inp('dias', 'num', r.dias) + '</td>' +
            '<td class="cv-cell-num cv-cell-calc cv-cell-strong"><span data-cv-calc="total">' + fmtMoney(calc.total) + '</span></td>' +
            (S.readonly ? '' : '<td class="cv-cell-act">' + delBtnHtml() + '</td>');
        return tr;
    }

    // ── Gastos ──────────────────────────────────────────────────────
    function renderGastos() {
        var shell = renderSectionShell('gastos', 'Gastos', 'Total gastos');
        var body = shell.body;
        if ((S.data.gastos.items || []).length === 0) {
            body.appendChild(renderEmptyState({
                title: 'Aún no hay gastos',
                message: 'Otros gastos del proyecto: combustible, casetas, comidas, etc.',
                primary: { label: 'Agregar gasto', action: 'add-row-gastos' },
            }));
        } else {
            body.appendChild(renderGastosTable());
            if (!S.readonly) body.appendChild(addRowBtn('gastos', 'Agregar gasto'));
        }
        return shell.section;
    }

    function renderGastosTable() {
        var wrap = el('div', 'cv-table-wrap');
        var t = el('table', 'cv-table cv-table-gastos');
        t.innerHTML =
            '<thead><tr>' +
                '<th class="cv-th-num">#</th>' +
                '<th class="cv-th-num">Cant</th>' +
                '<th>Unidad</th>' +
                '<th>Descripción</th>' +
                '<th class="cv-th-num">Costo Unit</th>' +
                '<th class="cv-th-num">Total</th>' +
                (S.readonly ? '' : '<th class="cv-th-act"></th>') +
            '</tr></thead>';
        var tb = el('tbody');
        t.appendChild(tb);
        S.data.gastos.items.forEach(function (r, i) {
            tb.appendChild(renderGastoRow(r, i));
        });
        wrap.appendChild(t);
        return wrap;
    }

    function renderGastoRow(r, idx) {
        var tr = el('tr');
        tr.setAttribute('data-item-id', r.id);
        tr.setAttribute('data-table', 'gastos');
        var total = calcGastoRow(r);
        var ro = S.readonly;

        function inp(field, type, val) {
            if (ro) return '<span class="cv-cell-ro">' + esc(val == null ? '' : String(val)) + '</span>';
            var step = type === 'num' ? ' step="0.01"' : '';
            var typeAttr = type === 'num' ? 'number' : 'text';
            return '<input type="' + typeAttr + '" class="cv-cell-input"' +
                ' data-cv-field="' + field + '"' + step +
                ' value="' + esc(val == null ? '' : String(val)) + '">';
        }

        tr.innerHTML =
            '<td class="cv-cell-num">' + (idx + 1) + '</td>' +
            '<td class="cv-cell-num">' + inp('cant', 'num', r.cant) + '</td>' +
            '<td>' + inp('unidad', 'text', r.unidad) + '</td>' +
            '<td class="cv-cell-desc">' + inp('descripcion', 'text', r.descripcion) + '</td>' +
            '<td class="cv-cell-num">' + inp('costo_unit', 'num', r.costo_unit) + '</td>' +
            '<td class="cv-cell-num cv-cell-calc cv-cell-strong"><span data-cv-calc="total">' + fmtMoney(total) + '</span></td>' +
            (S.readonly ? '' : '<td class="cv-cell-act">' + delBtnHtml() + '</td>');
        return tr;
    }

    function addRowBtn(table, label) {
        var b = el('button', 'cv-add-row');
        b.type = 'button';
        b.setAttribute('data-cv-action', 'add-row');
        b.setAttribute('data-cv-table', table);
        b.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
            esc(label);
        return b;
    }

    // ── Sidebar ────────────────────────────────────────────────────
    // Jerarquía:
    //   1) Hero — Margen % grande con barra de gauge + chips Ganancia / Total.
    //   2) Resumen — Subtotal venta · Costo total · IVA · Total con IVA.
    //   3) Detalle — subtotales por sección (colapsado por default, secundario).
    //   4) MXN — equivalente al tipo de cambio actual.
    function renderSidebar() {
        var box = el('div', 'cv-sidebar-inner');
        box.innerHTML =
            // 1) HERO — margen y headline
            '<div class="cv-sb-hero">' +
                '<div class="cv-sb-hero-label">Margen del proyecto</div>' +
                '<div class="cv-sb-hero-margen" data-cv-sb="margen_pct">0.0%</div>' +
                '<div class="cv-sb-gauge"><div class="cv-sb-gauge-fill is-low" data-cv-sb-gauge style="width:0%"></div></div>' +
                '<div class="cv-sb-hero-chips">' +
                    '<div class="cv-sb-chip cv-sb-chip-gain">' +
                        '<span class="cv-sb-chip-label">Ganancia</span>' +
                        '<span class="cv-sb-chip-value" data-cv-sb="ganancia">$0.00</span>' +
                    '</div>' +
                    '<div class="cv-sb-chip">' +
                        '<span class="cv-sb-chip-label">Total c/IVA</span>' +
                        '<span class="cv-sb-chip-value" data-cv-sb="total_con_iva">$0.00</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +

            // 2) RESUMEN principal
            '<div class="cv-sb-block">' +
                row('Subtotal venta', 'subtotal_venta', 'cv-row-strong') +
                row('Costo total', 'total_costo', 'cv-row-cost') +
                '<hr class="cv-sb-sep">' +
                row('IVA', 'iva_monto') +
                row('Total con IVA', 'total_con_iva_2', 'cv-row-grand') +
            '</div>' +

            // 3) DETALLE colapsable
            '<details class="cv-sb-details">' +
                '<summary>Desglose por sección</summary>' +
                row('Equipamiento · venta', 'total_eq_venta') +
                row('Equipamiento · costo', 'total_eq_costo', 'cv-row-cost') +
                row('MO cobrada', 'total_mo_cobrada') +
                row('MO costo', 'total_mo_costo', 'cv-row-cost') +
                row('Gastos', 'total_gastos', 'cv-row-cost') +
            '</details>' +

            // 4) MXN
            '<div class="cv-sidebar-mxn">' +
                '<div class="cv-mxn-title">Equivalente en MXN <span class="cv-mxn-tc" data-cv-sb-tc>TC 19.50</span></div>' +
                rowMxn('Subtotal venta', 'subtotal_venta_mxn') +
                rowMxn('Costo total', 'total_costo_mxn') +
                rowMxn('Ganancia', 'ganancia_mxn', 'cv-row-gain') +
                rowMxn('Total con IVA', 'total_con_iva_mxn', 'cv-row-strong') +
            '</div>';

        return box;

        function row(label, key, extraCls) {
            return '<div class="cv-sb-row ' + (extraCls || '') + '">' +
                '<span class="cv-sb-label">' + esc(label) + '</span>' +
                '<span class="cv-sb-value" data-cv-sb="' + key + '">$0.00</span>' +
            '</div>';
        }
        function rowPct(label, key) {
            return '<div class="cv-sb-row cv-row-margin">' +
                '<span class="cv-sb-label">' + esc(label) + '</span>' +
                '<span class="cv-sb-value" data-cv-sb="' + key + '">0.0%</span>' +
            '</div>';
        }
        function rowMxn(label, key, extraCls) {
            return '<div class="cv-sb-row ' + (extraCls || '') + '">' +
                '<span class="cv-sb-label">' + esc(label) + '</span>' +
                '<span class="cv-sb-value cv-mxn" data-cv-sb="' + key + '">$0.00</span>' +
            '</div>';
        }
    }

    function refreshSidebar() {
        var t = computeTotals();
        var tc = num(S.volumetria.tipo_cambio || 19.50);
        var c = S.container;

        function set(key, value) {
            var n = c.querySelector('[data-cv-sb="' + key + '"]');
            if (n) n.textContent = value;
        }

        set('total_eq_venta', fmtMoney(t.total_eq_venta));
        set('total_eq_costo', fmtMoney(t.total_eq_costo));
        set('total_mo_cobrada', fmtMoney(t.total_mo_cobrada));
        set('total_mo_costo', fmtMoney(t.total_mo_costo));
        set('total_gastos', fmtMoney(t.total_gastos));
        set('subtotal_venta', fmtMoney(t.subtotal_venta));
        set('total_costo', fmtMoney(t.total_costo));
        set('ganancia', fmtMoney(t.ganancia));
        set('margen_pct', fmtPct(t.margen_pct));
        set('iva_monto', fmtMoney(t.iva_monto));
        set('total_con_iva', fmtMoney(t.total_con_iva));
        set('total_con_iva_2', fmtMoney(t.total_con_iva));

        // Gauge de margen (rojo<15, ámbar 15-25, verde>25)
        var g = c.querySelector('[data-cv-sb-gauge]');
        if (g) {
            var p = Math.max(0, Math.min(100, t.margen_pct || 0));
            g.style.width = p + '%';
            g.classList.remove('is-low', 'is-mid', 'is-high');
            if (p < 15) g.classList.add('is-low');
            else if (p < 25) g.classList.add('is-mid');
            else g.classList.add('is-high');
        }

        // MXN
        set('subtotal_venta_mxn', fmtMoney(t.subtotal_venta * tc, 'MXN'));
        set('total_costo_mxn', fmtMoney(t.total_costo * tc, 'MXN'));
        set('ganancia_mxn', fmtMoney(t.ganancia * tc, 'MXN'));
        set('total_con_iva_mxn', fmtMoney(t.total_con_iva * tc, 'MXN'));

        var tcEl = c.querySelector('[data-cv-sb-tc]');
        if (tcEl) tcEl.textContent = 'TC ' + tc.toFixed(2);

        // Subtotales por sección (en el header del acordeón)
        setSubtotal('equipamiento', fmtMoney(t.total_eq_venta));
        setSubtotal('mano_obra', fmtMoney(t.total_mo_cobrada));
        setSubtotal('costo_mo', fmtMoney(t.total_mo_costo));
        setSubtotal('gastos', fmtMoney(t.total_gastos));

        function setSubtotal(key, value) {
            var n = c.querySelector('[data-cv-subtotal-value="' + key + '"]');
            if (n) n.textContent = value;
        }
    }

    // ── Modal de catálogo ──────────────────────────────────────────
    function renderCatalogModal() {
        var bd = el('div', 'cv-catalog-backdrop');
        bd.id = 'cv-catalog-backdrop';
        bd.style.display = 'none';
        bd.innerHTML =
            '<div class="cv-catalog-modal" role="dialog" aria-modal="true">' +
                '<div class="cv-catalog-head">' +
                    '<input id="cv-catalog-search" type="text" class="cv-catalog-search" placeholder="Buscar producto en catálogo (mín. 2 caracteres)…" autocomplete="off">' +
                    '<button type="button" class="cv-catalog-close" data-cv-action="close-catalog" aria-label="Cerrar">' +
                        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
                    '</button>' +
                '</div>' +
                '<div class="cv-catalog-list" id="cv-catalog-list">' +
                    '<div class="cv-catalog-empty">Escribe al menos 2 caracteres para buscar…</div>' +
                '</div>' +
                '<div class="cv-catalog-foot">' +
                    '<span class="cv-catalog-hint">Endpoint: <code>/app/api/iamet/catalogo-productos/</code></span>' +
                '</div>' +
            '</div>';
        return bd;
    }

    function openCatalog(target) {
        S.catalogState.target = target || null; // null = "agregar nueva fila a la primera sub-sección"
        S.catalogState.visible = true;
        var bd = S.container.querySelector('#cv-catalog-backdrop');
        if (!bd) return;
        bd.style.display = 'flex';
        var inp = bd.querySelector('#cv-catalog-search');
        if (inp) {
            inp.value = '';
            try { inp.focus(); } catch (_) {}
        }
        var list = bd.querySelector('#cv-catalog-list');
        if (list) list.innerHTML = '<div class="cv-catalog-empty">Escribe al menos 2 caracteres para buscar…</div>';
    }

    function closeCatalog() {
        S.catalogState.visible = false;
        S.catalogState.target = null;
        var bd = S.container.querySelector('#cv-catalog-backdrop');
        if (bd) bd.style.display = 'none';
    }

    function catalogSearch(q) {
        if (S.catalogState.timer) clearTimeout(S.catalogState.timer);
        var list = S.container.querySelector('#cv-catalog-list');
        if (!list) return;
        if (q.length < 2) {
            list.innerHTML = '<div class="cv-catalog-empty">Escribe al menos 2 caracteres para buscar…</div>';
            return;
        }
        list.innerHTML = '<div class="cv-catalog-empty">Buscando…</div>';
        S.catalogState.timer = setTimeout(function () {
            apiGet('/app/api/iamet/catalogo-productos/?q=' + encodeURIComponent(q) + '&limit=40')
                .then(function (r) {
                    var rows = (r && r.ok && r.data) ? r.data : [];
                    S.catalogState.current = rows;
                    renderCatalogList(rows, q);
                })
                .catch(function (err) {
                    log('catalog search failed', err);
                    list.innerHTML = '<div class="cv-catalog-empty">Error al buscar. Intenta de nuevo.</div>';
                });
        }, 220);
    }

    function renderCatalogList(rows, q) {
        var list = S.container.querySelector('#cv-catalog-list');
        if (!list) return;
        if (!rows.length) {
            list.innerHTML =
                '<div class="cv-catalog-empty">' +
                    'Sin resultados para "<b>' + esc(q) + '</b>".<br>' +
                    'Puedes capturar el producto manualmente en la fila.' +
                '</div>';
            return;
        }
        list.innerHTML = rows.map(function (p, i) {
            return '<div class="cv-catalog-row" data-cv-action="catalog-pick" data-cv-pick-idx="' + i + '">' +
                '<div class="cv-catalog-row-main">' +
                    '<div class="cv-catalog-desc">' + esc(p.desc || '(sin descripción)') + '</div>' +
                    '<div class="cv-catalog-sub">' +
                        esc(p.marca || '—') + ' · ' + esc(p.modelo || '—') +
                        (p.unidad ? ' · ' + esc(p.unidad) : '') +
                    '</div>' +
                '</div>' +
                '<div class="cv-catalog-price">' + fmtMoney(p.precio || 0) + '</div>' +
            '</div>';
        }).join('');
    }

    function catalogPick(idx) {
        var p = S.catalogState.current[idx];
        if (!p) return;

        // Convertir producto del catálogo → fila item
        // Asumimos: precio = precio lista; sin descuento default.
        var newItem = {
            id: uuid(),
            row_type: 'item',
            marca: p.marca || '',
            no_parte: p.modelo || '',
            cant: 1,
            descripcion: p.desc || '',
            p_lista: num(p.precio || 0),
            desc_v_pct: 0,
            p_unit_v: 0, p_total_v: 0,
            desc_c_pct: 0,
            c_unit: 0, c_total: 0,
            ganancia: 0,
            proveedor: p.proveedor || '',
            entrega: 'STOCK',
            notas: '',
        };

        var target = S.catalogState.target;
        if (target && target.itemId && target.sectionId) {
            // Pre-fill de fila existente
            var sub = findSub(target.sectionId);
            if (sub) {
                var existing = sub.items.find(function (it) { return it.id === target.itemId; });
                if (existing && existing.row_type === 'item') {
                    existing.marca = newItem.marca;
                    existing.no_parte = newItem.no_parte;
                    existing.descripcion = newItem.descripcion;
                    existing.p_lista = newItem.p_lista;
                    existing.proveedor = newItem.proveedor;
                    closeCatalog();
                    markDirty();
                    rerender();
                    return;
                }
            }
        }
        // Sin target → agregar al final de la primera sub-sección (o crear si no hay)
        var sec = S.data.equipamiento.secciones[0];
        if (!sec) {
            sec = { id: uuid(), nombre: 'Equipamiento', items: [] };
            S.data.equipamiento.secciones.push(sec);
        }
        sec.items.push(newItem);
        closeCatalog();
        markDirty();
        rerender();
    }

    function findSub(sectionId) {
        for (var i = 0; i < S.data.equipamiento.secciones.length; i++) {
            if (S.data.equipamiento.secciones[i].id === sectionId) return S.data.equipamiento.secciones[i];
        }
        return null;
    }

    // ── Re-render rápido vs incremental ─────────────────────────────
    // Para autosave / cálculos vivos, cambiamos solo los nodos necesarios.
    // Para alta/baja de filas o sub-secciones, full re-render.
    function rerender() {
        // Preservar el foco si lo hay
        var active = document.activeElement;
        var sel = null;
        if (active && active.tagName === 'INPUT' && S.container.contains(active)) {
            sel = {
                field: active.getAttribute('data-cv-field'),
                itemId: active.closest('[data-item-id]') ? active.closest('[data-item-id]').getAttribute('data-item-id') : null,
                sectionId: active.closest('[data-section-id]') ? active.closest('[data-section-id]').getAttribute('data-section-id') : null,
                start: active.selectionStart, end: active.selectionEnd,
            };
        }
        render();
        // Restore focus
        if (sel) {
            var sel2 = '';
            if (sel.itemId) sel2 += '[data-item-id="' + sel.itemId + '"] ';
            if (sel.field) sel2 += '[data-cv-field="' + sel.field + '"]';
            if (sel2) {
                var newEl = S.container.querySelector(sel2);
                if (newEl) {
                    try {
                        newEl.focus();
                        if (sel.start != null) newEl.setSelectionRange(sel.start, sel.end);
                    } catch (_) {}
                }
            }
        }
    }

    // Actualiza solo las celdas calculadas de una fila (no rerender completo).
    function refreshRowCells(itemId) {
        var tr = S.container.querySelector('[data-item-id="' + itemId + '"]');
        if (!tr) return;

        // Detectar de qué tabla viene
        var tableAttr = tr.getAttribute('data-table');
        if (tableAttr === 'mano_obra') {
            var mo = findItem('mano_obra', itemId);
            if (mo) setCell(tr, 'total', fmtMoney(calcMoRow(mo)));
            return;
        }
        if (tableAttr === 'costo_mo') {
            var cmo = findItem('costo_mo', itemId);
            if (cmo) {
                var calc = calcCmoRow(cmo);
                setCell(tr, 'concentrado', fmtMoney(calc.concentrado));
                setCell(tr, 'total', fmtMoney(calc.total));
            }
            return;
        }
        if (tableAttr === 'gastos') {
            var g = findItem('gastos', itemId);
            if (g) setCell(tr, 'total', fmtMoney(calcGastoRow(g)));
            return;
        }

        // Equipamiento
        var sec = tr.closest('[data-section-id]');
        if (!sec) return;
        var sub = findSub(sec.getAttribute('data-section-id'));
        if (!sub) return;
        var it = sub.items.find(function (x) { return x.id === itemId; });
        if (!it || it.row_type !== 'item') return;
        var c = calcEqItem(it);
        setCell(tr, 'p_unit_v', fmtMoney(c.p_unit_v));
        setCell(tr, 'p_total_v', fmtMoney(c.p_total_v));
        setCell(tr, 'c_unit', fmtMoney(c.c_unit));
        setCell(tr, 'c_total', fmtMoney(c.c_total));
        setCell(tr, 'ganancia', fmtMoney(c.ganancia));
    }

    function setCell(tr, calcKey, value) {
        var n = tr.querySelector('[data-cv-calc="' + calcKey + '"]');
        if (n) n.textContent = value;
    }

    function findItem(table, itemId) {
        var arr = (S.data[table] || {}).items || [];
        for (var i = 0; i < arr.length; i++) if (arr[i].id === itemId) return arr[i];
        return null;
    }

    // ── Eventos delegados ───────────────────────────────────────────
    function bindDelegated(root) {
        // Click handlers
        root.addEventListener('click', onClick);
        // Input handlers (input event = fuego en cada keystroke; debounced para autosave)
        root.addEventListener('input', onInput);
        // Change handlers (para selects / inputs num al perder foco — recalcula confirmado)
        root.addEventListener('change', onChange);
        // Keydown — Esc cierra catálogo
        S.boundDocKey = function (e) {
            if (e.key === 'Escape' && S.catalogState.visible) {
                closeCatalog();
            }
        };
        document.addEventListener('keydown', S.boundDocKey);
    }

    function onClick(e) {
        var t = e.target;
        var actionEl = t.closest ? t.closest('[data-cv-action]') : null;
        if (!actionEl) {
            // ¿click en backdrop del catálogo?
            if (t.id === 'cv-catalog-backdrop') closeCatalog();
            return;
        }
        var action = actionEl.getAttribute('data-cv-action');
        switch (action) {
            case 'toggle-section':
                var key = actionEl.getAttribute('data-section-key');
                var sec = S.container.querySelector('.cv-section[data-key="' + key + '"]');
                if (sec) sec.classList.toggle('cv-section-open');
                break;

            case 'add-subsection':
                if (S.readonly) return;
                S.data.equipamiento.secciones.push({
                    id: uuid(),
                    nombre: 'Nueva sub-sección',
                    items: [],
                });
                markDirty();
                rerender();
                break;

            case 'del-subsection':
                if (S.readonly) return;
                var subEl = actionEl.closest('[data-section-id]');
                if (!subEl) return;
                var sid = subEl.getAttribute('data-section-id');
                if (!confirm('¿Eliminar esta sub-sección y todas sus filas?')) return;
                S.data.equipamiento.secciones = S.data.equipamiento.secciones.filter(function (s) { return s.id !== sid; });
                if (!S.data.equipamiento.secciones.length) {
                    S.data.equipamiento.secciones.push({ id: uuid(), nombre: 'Equipamiento', items: [] });
                }
                markDirty();
                rerender();
                break;

            case 'add-item':
                if (S.readonly) return;
                var subEl2 = actionEl.closest('[data-section-id]');
                if (!subEl2) return;
                var sub = findSub(subEl2.getAttribute('data-section-id'));
                if (!sub) return;
                sub.items.push(emptyEqItem());
                markDirty();
                rerender();
                break;

            case 'add-item-from-catalog':
                if (S.readonly) return;
                var subElC = actionEl.closest('[data-section-id]');
                if (!subElC) return;
                var subC = findSub(subElC.getAttribute('data-section-id'));
                if (!subC) return;
                var nuevo = emptyEqItem();
                subC.items.push(nuevo);
                markDirty();
                rerender();
                openCatalog({ sectionId: subC.id, itemId: nuevo.id });
                break;

            case 'add-header-row':
                if (S.readonly) return;
                var subEl3 = actionEl.closest('[data-section-id]');
                if (!subEl3) return;
                var sub3 = findSub(subEl3.getAttribute('data-section-id'));
                if (!sub3) return;
                sub3.items.push({ id: uuid(), row_type: 'header', texto: '' });
                markDirty();
                rerender();
                break;

            case 'add-row':
                if (S.readonly) return;
                var tbl = actionEl.getAttribute('data-cv-table');
                if (tbl === 'mano_obra') {
                    S.data.mano_obra.items.push(emptyMoItem());
                } else if (tbl === 'costo_mo') {
                    S.data.costo_mo.items.push(emptyCmoItem());
                } else if (tbl === 'gastos') {
                    S.data.gastos.items.push(emptyGastoItem());
                }
                markDirty();
                rerender();
                break;

            // Atajos del estado vacío de cada sección
            case 'add-row-mo_cobrada':
                if (S.readonly) return;
                S.data.mano_obra.items.push(emptyMoItem());
                markDirty(); rerender();
                break;
            case 'add-row-cmo':
                if (S.readonly) return;
                S.data.costo_mo.items.push(emptyCmoItem());
                markDirty(); rerender();
                break;
            case 'add-row-gastos':
                if (S.readonly) return;
                S.data.gastos.items.push(emptyGastoItem());
                markDirty(); rerender();
                break;

            case 'del-row':
                if (S.readonly) return;
                var tr = actionEl.closest('tr');
                if (!tr) return;
                var itemId = tr.getAttribute('data-item-id');
                var tableName = tr.getAttribute('data-table');
                if (tableName) {
                    S.data[tableName].items = S.data[tableName].items.filter(function (x) { return x.id !== itemId; });
                } else {
                    // Equipamiento
                    var secEl = tr.closest('[data-section-id]');
                    if (secEl) {
                        var subDel = findSub(secEl.getAttribute('data-section-id'));
                        if (subDel) {
                            subDel.items = subDel.items.filter(function (x) { return x.id !== itemId; });
                        }
                    }
                }
                markDirty();
                rerender();
                break;

            case 'open-catalog':
                if (S.readonly) return;
                openCatalog(null);
                break;

            case 'catalog-prefill':
                if (S.readonly) return;
                var trC = actionEl.closest('tr');
                var secC = actionEl.closest('[data-section-id]');
                if (!trC || !secC) return;
                openCatalog({
                    sectionId: secC.getAttribute('data-section-id'),
                    itemId: trC.getAttribute('data-item-id'),
                });
                break;

            case 'close-catalog':
                closeCatalog();
                break;

            case 'catalog-pick':
                var idx = parseInt(actionEl.getAttribute('data-cv-pick-idx'), 10);
                catalogPick(idx);
                break;
        }
    }

    function onInput(e) {
        var t = e.target;
        if (!t || !t.matches) return;

        // Catálogo search
        if (t.id === 'cv-catalog-search') {
            catalogSearch((t.value || '').trim());
            return;
        }

        // TC / IVA en barra superior
        if (t.id === 'cv-tc') {
            S.volumetria.tipo_cambio = num(t.value);
            refreshSidebar();
            scheduleMetaSave({ tipo_cambio: S.volumetria.tipo_cambio });
            return;
        }
        if (t.id === 'cv-iva') {
            S.volumetria.iva_pct = num(t.value);
            refreshSidebar();
            scheduleMetaSave({ iva_pct: S.volumetria.iva_pct });
            return;
        }

        // Nombre de sub-sección
        if (t.matches('[data-cv-bind="subsection-name"]')) {
            var subEl = t.closest('[data-section-id]');
            if (subEl) {
                var sub = findSub(subEl.getAttribute('data-section-id'));
                if (sub) {
                    sub.nombre = t.value;
                    markDirty();
                }
            }
            return;
        }

        // Field input en una fila
        if (t.matches('[data-cv-field]')) {
            var field = t.getAttribute('data-cv-field');
            var trI = t.closest('tr');
            if (!trI) return;
            var iid = trI.getAttribute('data-item-id');
            var table = trI.getAttribute('data-table');
            var item;
            if (table) {
                item = findItem(table, iid);
            } else {
                // Equipamiento
                var secI = trI.closest('[data-section-id]');
                if (!secI) return;
                var subI = findSub(secI.getAttribute('data-section-id'));
                if (!subI) return;
                item = subI.items.find(function (x) { return x.id === iid; });
            }
            if (!item) return;

            var isNumField = NUM_FIELDS.indexOf(field) !== -1;
            item[field] = isNumField ? num(t.value) : t.value;

            // Si es item de equipamiento, recompute campos cacheados (para JSON consistente)
            if (table == null && item.row_type === 'item') {
                var c = calcEqItem(item);
                item.p_unit_v = c.p_unit_v;
                item.p_total_v = c.p_total_v;
                item.c_unit = c.c_unit;
                item.c_total = c.c_total;
                item.ganancia = c.ganancia;
            } else if (table === 'mano_obra') {
                item.total = calcMoRow(item);
            } else if (table === 'costo_mo') {
                var calc = calcCmoRow(item);
                item.concentrado = calc.concentrado;
                item.total = calc.total;
            } else if (table === 'gastos') {
                item.total = calcGastoRow(item);
            }

            refreshRowCells(iid);
            refreshSidebar();
            markDirty();
        }
    }

    function onChange(e) {
        // Mismo handler que input para cubrir change events sin perder consistencia.
        // (Hoy los inputs disparan 'input' en cada keystroke; este handler es un seguro.)
        // Disparado también para el debounce final.
        if (e.target.matches && e.target.matches('[data-cv-field], #cv-tc, #cv-iva')) {
            // ya manejado por onInput
        }
    }

    var NUM_FIELDS = [
        'cant', 'p_lista', 'desc_v_pct', 'desc_c_pct', 'p_unit', 'costo_unit',
        'dias', 'p_unit_v', 'p_total_v', 'c_unit', 'c_total', 'ganancia', 'total', 'concentrado',
    ];

    // ── Factories de items vacíos ────────────────────────────────
    function emptyEqItem() {
        return {
            id: uuid(), row_type: 'item',
            marca: '', no_parte: '', cant: 0, descripcion: '',
            p_lista: 0, desc_v_pct: 0, p_unit_v: 0, p_total_v: 0,
            desc_c_pct: 0, c_unit: 0, c_total: 0, ganancia: 0,
            proveedor: '', entrega: '', notas: '',
        };
    }
    function emptyMoItem() {
        return {
            id: uuid(),
            marca: 'BAJANET', no_parte: 'SERVICIOS PROFESIONALES',
            cant: 1, descripcion: '', p_unit: 0, total: 0, notas: '',
        };
    }
    function emptyCmoItem() {
        return {
            id: uuid(), recurso: '', cant: 1, dias: 1,
            costo_unit: 0, concentrado: 0, total: 0,
        };
    }
    function emptyGastoItem() {
        return {
            id: uuid(), cant: 1, unidad: 'PZA',
            descripcion: '', costo_unit: 0, total: 0,
        };
    }

    // ── Dirty + autosave ────────────────────────────────────────────
    function markDirty() {
        if (typeof S.onDirty === 'function') {
            try { S.onDirty(); } catch (_) {}
        }
        scheduleAutosave();
    }

    function scheduleAutosave() {
        if (S.readonly) return;
        if (S.saveTimer) clearTimeout(S.saveTimer);
        S.saveTimer = setTimeout(function () {
            doAutosave();
        }, 700);
    }

    function doAutosave() {
        if (S.readonly) return;
        if (!S.volumetria || !S.volumetria.id) return;

        if (S.saveInFlight) {
            // Si ya hay un save en vuelo, marcamos pending para reintentar
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
            // Reintento simple
            if (S.savePending) {
                S.savePending = false;
                setTimeout(doAutosave, 1500);
            }
        });
    }

    // Meta save (iva_pct, tipo_cambio, nombre, status...)
    var _metaTimer = null;
    var _metaPending = {};
    function scheduleMetaSave(partial) {
        Object.keys(partial || {}).forEach(function (k) { _metaPending[k] = partial[k]; });
        if (_metaTimer) clearTimeout(_metaTimer);
        _metaTimer = setTimeout(doMetaSave, 700);
    }

    function doMetaSave() {
        if (S.readonly) return;
        if (!S.volumetria || !S.volumetria.id) return;
        if (!Object.keys(_metaPending).length) return;
        var body = _metaPending;
        _metaPending = {};
        var url = '/app/api/iamet/volumetrias/' + S.volumetria.id + '/actualizar/';
        log('meta save →', body);
        apiPost(url, body).then(function (r) {
            if (r && (r.ok || r.success) && r.data) {
                // Sincronizar la copia local con lo que el backend confirmó
                if (r.data.iva_pct != null) S.volumetria.iva_pct = r.data.iva_pct;
                if (r.data.tipo_cambio != null) S.volumetria.tipo_cambio = r.data.tipo_cambio;
                refreshSidebar();
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
         * Renderiza el editor de volumetría dentro del contenedor.
         * @param {HTMLElement} container
         * @param {object}      options
         * @param {object}      options.volumetria      {id, nombre, status, data, iva_pct, tipo_cambio}
         * @param {object}      [options.levantamiento] objeto completo del lev
         * @param {boolean}     [options.readonly]      true → solo lectura
         * @param {function}    [options.onDirty]       callback() cuando hay cambio
         * @param {function}    [options.onSaved]       callback(volumetria) cuando guardamos
         */
        render: function (container, options) {
            options = options || {};
            if (!container || !options.volumetria) {
                log('render: faltan args (container o volumetria)');
                return;
            }
            // Limpiar instancia anterior si existía
            if (S.container) {
                try { this.destroy(); } catch (_) {}
            }

            S.container = container;
            S.volumetria = options.volumetria;
            S.levantamiento = options.levantamiento || null;
            S.readonly = !!options.readonly;
            S.onDirty = options.onDirty || null;
            S.onSaved = options.onSaved || null;

            // Defaults de meta
            if (S.volumetria.iva_pct == null) S.volumetria.iva_pct = 16;
            if (S.volumetria.tipo_cambio == null) S.volumetria.tipo_cambio = 19.50;

            // Normalizar/migrar data
            S.data = normalizeData(S.volumetria.data || {});
            S.volumetria.data = S.data; // mantener sincronizado el alias

            log('render volumetría', S.volumetria.id, 'readonly=' + S.readonly);
            render();
        },

        /** Snapshot del data v2 actual. */
        getData: function () {
            return S.data ? JSON.parse(JSON.stringify(S.data)) : null;
        },

        /** Devuelve el objeto volumetria en memoria (incluye iva_pct, tipo_cambio actualizados). */
        getVolumetria: function () {
            return S.volumetria;
        },

        /** Fuerza el flush del autosave pendiente (útil al cerrar wizard). */
        flushSave: function () {
            if (S.saveTimer) {
                clearTimeout(S.saveTimer);
                S.saveTimer = null;
                doAutosave();
            }
            if (_metaTimer) {
                clearTimeout(_metaTimer);
                _metaTimer = null;
                doMetaSave();
            }
        },

        /** Limpia DOM + listeners. */
        destroy: function () {
            if (S.boundDocKey) {
                document.removeEventListener('keydown', S.boundDocKey);
                S.boundDocKey = null;
            }
            if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
            if (_metaTimer) { clearTimeout(_metaTimer); _metaTimer = null; }
            if (S.catalogState.timer) { clearTimeout(S.catalogState.timer); S.catalogState.timer = null; }
            if (S.container) {
                S.container.innerHTML = '';
            }
            S.container = null;
            S.volumetria = null;
            S.levantamiento = null;
            S.data = null;
            S.readonly = false;
            S.onDirty = null;
            S.onSaved = null;
            S.saveInFlight = false;
            S.savePending = false;
        },
    };

    /**
     * ─── CSS classes utilizadas (prefijo cv-) ────────────────────────
     * El módulo de estilos correspondiente debe implementar al menos:
     *
     * Layout:
     *   .cv-root                       contenedor raíz
     *   .cv-readonly                   modificador (root) modo lectura
     *   .cv-config-bar                 barra superior (Moneda, TC, IVA, btn catálogo)
     *   .cv-cfg-group, .cv-cfg-label, .cv-cfg-value, .cv-cfg-input,
     *     .cv-cfg-suffix, .cv-cfg-sep, .cv-cfg-spacer
     *   .cv-layout                     grid 2-cols (content + sidebar)
     *   .cv-content                    columna principal
     *   .cv-sidebar                    columna lateral (sticky)
     *   .cv-sidebar-inner              contenido interno del sidebar
     *
     * Secciones / acordeón:
     *   .cv-section                    contenedor de cada bloque (Equipamiento, MO, ...)
     *   .cv-section-open               modificador: acordeón expandido
     *   .cv-section-header             cabecera clickeable
     *   .cv-section-title              título
     *   .cv-section-subtotal           pill con el subtotal
     *   .cv-subtotal-label, .cv-subtotal-value
     *   .cv-section-body               cuerpo (contenido de la sección)
     *   .cv-chevron                    chevron del acordeón (rotar al abrir/cerrar)
     *
     * Sub-secciones (solo Equipamiento):
     *   .cv-subsection                 grupo dentro de Equipamiento
     *   .cv-subsection-header
     *   .cv-subsection-name            modo readonly (span)
     *   .cv-subsection-name-input      modo editable (input)
     *   .cv-subsection-actions         botonera derecha
     *   .cv-subsection-body
     *   .cv-add-subsection             botón "+ sub-sección"
     *   .cv-add-row                    botón "+ fila" en cada tabla simple
     *
     * Tablas:
     *   .cv-table-wrap                 wrapper con scroll horizontal
     *   .cv-table                      tabla base
     *   .cv-table-eq, .cv-table-mo,
     *   .cv-table-cmo, .cv-table-gastos
     *   .cv-th-num, .cv-th-act         th alineado a número / col de acciones
     *   .cv-cell-num                   td alineado a número
     *   .cv-cell-desc                  td de descripción (usar min-width amplio)
     *   .cv-cell-calc                  td calculado (no editable)
     *   .cv-cell-strong                td con estilo destacado
     *   .cv-cell-gain                  ganancia (color por signo, opcional)
     *   .cv-cell-act                   td de acciones
     *   .cv-cell-input                 input dentro de celda
     *   .cv-cell-ro                    span readonly dentro de celda
     *   .cv-mono                       mono-spaced (no_parte)
     *   .cv-row-header                 tr de "rótulo" (style highlighted)
     *   .cv-header-cell                td con colspan del rótulo
     *   .cv-header-text                texto del rótulo (readonly)
     *   .cv-header-input               input del rótulo (editable)
     *   .cv-row-tool                   botón pequeño en celda de acciones (catálogo)
     *   .cv-row-del                    botón eliminar fila
     *
     * Botones genéricos:
     *   .cv-btn                        base
     *   .cv-btn-primary                primario (azul)
     *   .cv-btn-ghost                  ghost (border + texto)
     *   .cv-btn-danger-ghost           ghost en rojo (eliminar sub-sección)
     *
     * Sidebar:
     *   .cv-sidebar-totals             grid con USD
     *   .cv-sidebar-mxn                grid con MXN al TC
     *   .cv-mxn-title, .cv-mxn-tc, .cv-mxn
     *   .cv-sb-row                     fila label + value
     *   .cv-sb-label, .cv-sb-value
     *   .cv-sb-sep                     separador <hr>
     *   .cv-row-cost                   línea de costo (color tenue)
     *   .cv-row-strong                 línea de subtotal/total
     *   .cv-row-grand                  línea final (total con IVA)
     *   .cv-row-gain                   línea de ganancia (verde/rojo)
     *   .cv-row-margin                 línea de margen %
     *
     * Modal de catálogo:
     *   .cv-catalog-backdrop           fondo oscuro
     *   .cv-catalog-modal              caja del modal
     *   .cv-catalog-head               cabecera con search + close
     *   .cv-catalog-search             input de búsqueda
     *   .cv-catalog-close              botón X
     *   .cv-catalog-list               lista scrolleable
     *   .cv-catalog-row                fila (clickeable)
     *   .cv-catalog-row-main, .cv-catalog-desc, .cv-catalog-sub, .cv-catalog-price
     *   .cv-catalog-empty              estado vacío / loading
     *   .cv-catalog-foot, .cv-catalog-hint
     */
})();
