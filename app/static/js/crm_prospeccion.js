// crm_prospeccion.js — Modulo de Prospeccion CRM IAMET — v5
// OUTSIDE IIFE: test click handler
document.addEventListener('click', function(ev) {
    var t = ev.target.closest('#prospeccionTbody td');
    if (t) {
        console.log('[PROSPECCION-OUTSIDE] Click en td de prospeccionTbody!', t.textContent.substring(0, 20), t.dataset);
    }
});

(function() {
    'use strict';
    console.log('[PROSPECCION] ===== JS v5 cargado =====');

    var csrf = function() { return document.querySelector('[name=csrfmiddlewaretoken]').value; };

    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(text));
        return div.innerHTML;
    }

    function getInitials(name) {
        if (!name) return '??';
        var parts = name.trim().split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return (parts[0][0] || '?').toUpperCase();
    }

    // Current client context for the widget
    var _currentWidgetClienteId = null;
    var _currentWidgetClienteNombre = '';
    var _currentWidgetClienteRfc = '';

    // ── Abrir widget nuevo prospecto (tab=prospeccion/campañas: "cliente" mode) ──
    var btnNuevo = document.getElementById('btnNuevoProspecto');
    if (btnNuevo) {
        btnNuevo.addEventListener('click', function() {
            if (typeof window._setNuevoProspectoMode === 'function') {
                window._setNuevoProspectoMode('cliente');
            }
            document.getElementById('widgetNuevoProspecto').classList.add('active');
        });
    }

    // ── Persistencia: reabrir prospecto sin actividad al cargar ──
    (function() {
        var pendienteId = localStorage.getItem('_pendienteProspectoSinActividad');
        if (!pendienteId) return;
        // Primero verificar etapa: si está cerrado, limpiar y no reabrir.
        fetch('/app/api/prospecto/' + pendienteId + '/detalle/')
            .then(function(r) { return r.json(); })
            .then(function(det) {
                if (det && (det.etapa === 'cerrado_ganado' || det.etapa === 'cerrado_perdido')) {
                    localStorage.removeItem('_pendienteProspectoSinActividad');
                    return;
                }
                // Verificar si tiene actividades
                fetch('/app/api/prospecto/' + pendienteId + '/actividades/')
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        var acts = data.actividades || [];
                        if (acts.length === 0) {
                            // Sigue sin actividad, reabrir widget
                            setTimeout(function() {
                                if (typeof abrirWidgetProspecto === 'function') {
                                    abrirWidgetProspecto(parseInt(pendienteId));
                                }
                            }, 1000);
                        } else {
                            // Ya tiene actividad, limpiar
                            localStorage.removeItem('_pendienteProspectoSinActividad');
                        }
                    })
                    .catch(function() {
                        localStorage.removeItem('_pendienteProspectoSinActividad');
                    });
            })
            .catch(function() {
                localStorage.removeItem('_pendienteProspectoSinActividad');
            });
    })();

    // ══════════════════════════════════════════════════════════════
    // A. MAIN TABLE: Load clients with prospecto counts
    // ══════════════════════════════════════════════════════════════
    function cargarClientesProspeccion() {
        // Preferir el nuevo contenedor de filas sueltas; fallback al legacy tbody
        var body = document.getElementById('prospeccionListBody');
        var head = document.getElementById('prospeccionListHead');
        if (!body) return;

        var params = new URLSearchParams(window.location.search);
        var mes = params.get('mes') || '';
        var anio = params.get('anio') || '';
        var vendedores = params.get('vendedores') || '';

        fetch('/app/api/prospeccion/clientes/?mes=' + mes + '&anio=' + anio + '&vendedores=' + vendedores)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.rows) return;
                body.innerHTML = '';

                var prodKeys = ['zebra', 'panduit', 'apc', 'avigilon', 'genetec', 'axis', 'software', 'runrate', 'poliza', 'otros'];
                var prodLabels = ['Zebra', 'Panduit', 'APC', 'Avig.', 'Genet.', 'Axis', 'Soft.', 'RR', 'Pol.', 'Otros'];
                var prodChoicesMap = {
                    'zebra': 'ZEBRA', 'panduit': 'PANDUIT', 'apc': 'APC',
                    'avigilon': 'AVIGILION', 'genetec': 'GENETEC', 'axis': 'AXIS',
                    'software': 'SOFTWARE', 'runrate': 'RUNRATE', 'poliza': 'POLIZA', 'otros': ''
                };

                // Header (labels) — usa mismo estilo que .crm-list-head
                if (head) {
                    var hHtml = '<div class="crm-list-hcell" style="flex:2.6;padding-left:22px;">Cliente</div>';
                    prodLabels.forEach(function(l){
                        hHtml += '<div class="crm-list-hcell" style="flex:1;text-align:right;">' + l + '</div>';
                    });
                    head.innerHTML = hHtml;
                }

                data.rows.forEach(function(row) {
                    var rowEl = document.createElement('div');
                    // Reutilizamos la clase .crm-list-row (mismo dise;o que oportunidades) + modifier --prospect
                    rowEl.className = 'crm-list-row crm-list-row--prospect crm-data-row';
                    rowEl.dataset.clienteId = row.cliente_id;

                    // Cliente cell (equivalente a la columna "Oportunidad / Cliente")
                    var clienteOnclick = 'onclick="event.stopPropagation();window._prospeccionClickCliente(' + row.cliente_id + ',\'' + escapeHtml(row.cliente).replace(/'/g, "\\'") + '\',\'' + escapeHtml(row.rfc).replace(/'/g, "\\'") + '\')"';
                    var html = '<div class="crm-list-cell cell-cliente" style="flex:2.6;padding-left:22px;">' +
                        '<div class="crm-list-title"><span class="cliente-prospeccion-link" data-cliente-id="' + row.cliente_id + '" data-cliente-nombre="' + escapeHtml(row.cliente).replace(/"/g,'&quot;') + '" ' + clienteOnclick + '>' + escapeHtml(row.cliente) + '</span></div>';
                    if (row.rfc) {
                        html += '<div class="crm-list-sub">RFC: ' + escapeHtml(row.rfc) + '</div>';
                    }
                    html += '</div>';

                    // Product cells — cada uno como .crm-list-cell con flex:1
                    prodKeys.forEach(function(key) {
                        var val = row[key] || 0;
                        var prodValue = prodChoicesMap[key] || '';
                        var cellAttrs = '';
                        if (prodValue) {
                            cellAttrs = ' onclick="event.stopPropagation();window._prospeccionClickProducto(' +
                                row.cliente_id + ',\'' + escapeHtml(row.cliente).replace(/'/g, "\\'") +
                                '\',\'' + prodValue + '\')" style="flex:1;cursor:pointer;"';
                        } else {
                            cellAttrs = ' style="flex:1;"';
                        }
                        var cls = val === 0 ? 'cell-prod zero' : 'cell-prod filled';
                        html += '<div class="crm-list-cell ' + cls + '"' + cellAttrs + '>' + val + '</div>';
                    });

                    rowEl.innerHTML = html;
                    body.appendChild(rowEl);
                });

                // Footer
                var footer = document.getElementById('prospeccionFooter');
                if (footer && data.footer) {
                    footer.innerHTML = '<span style="font-size:11px;color:#86868B;">' + (data.footer.left || '') + '</span><span style="font-size:11px;font-weight:600;color:#1C1C1E;">' + (data.footer.right || '') + '</span>';
                    footer.style.display = 'flex';
                    footer.style.justifyContent = 'space-between';
                    footer.style.padding = '12px 8px 0';
                }

                console.log('[PROSPECCION] Lista cargada con', data.rows.length, 'clientes');
            });
    }

    // ── Global event delegation for ALL clicks in prospeccion table ──
    // Using document-level delegation — works regardless of DOM timing
    document.addEventListener('click', function(e) {
        // Procesar si está dentro del legacy tbody o del nuevo listBody
        var tbody = e.target.closest('#prospeccionTbody') || e.target.closest('#prospeccionListBody');
        if (!tbody) return;

        console.log('[PROSPECCION] Click dentro de prospeccionTbody, target:', e.target.tagName, e.target.className, e.target.textContent.substring(0, 30));

        // Handle campaign button clicks
        var campBtn = e.target.closest('.btn-campana');
        if (campBtn) {
            e.stopPropagation();
            var cId = campBtn.dataset.clienteId;
            var linkEl = campBtn.closest('tr') ? campBtn.closest('tr').querySelector('.cliente-prospeccion-link') : null;
            console.log('[PROSPECCION] Click campaña, clienteId:', cId);
            if (typeof abrirEditorCampana === 'function') {
                abrirEditorCampana({
                    clienteId: cId ? parseInt(cId) : null,
                    nombre: linkEl ? linkEl.dataset.clienteNombre : ''
                });
            }
            return;
        }

        // Handle client name clicks
        var link = e.target.closest('.cliente-prospeccion-link');
        if (link) {
            console.log('[PROSPECCION] Click cliente:', link.dataset.clienteNombre, link.dataset.clienteId);
            abrirClienteProspectos(
                parseInt(link.dataset.clienteId),
                link.dataset.clienteNombre,
                link.dataset.clienteRfc
            );
            return;
        }

        // Handle product cell clicks (any td with data-click-producto)
        var td = e.target.closest('td[data-click-producto]');
        if (td) {
            var clienteId = parseInt(td.dataset.clickClienteId);
            var clienteNombre = td.dataset.clickClienteNombre || '';
            var producto = td.dataset.clickProducto || '';
            console.log('[PROSPECCION] Click producto:', producto, 'cliente:', clienteNombre, 'id:', clienteId);
            if (producto) {
                abrirProspeccionConProducto(clienteId, clienteNombre, producto);
            }
            return;
        }
    });

    // Load clients if we are on the prospeccion tab
    if (new URLSearchParams(window.location.search).get('tab') === 'prospeccion') {
        cargarClientesProspeccion();
    }

    // Expose for tab change and reload after creating prospecto
    window.cargarProspectos = cargarClientesProspeccion;

    // Global onclick handlers (used by inline onclick in table cells)
    window._prospeccionClickProducto = function(clienteId, clienteNombre, producto) {
        console.log('[PROSPECCION] _prospeccionClickProducto:', clienteId, clienteNombre, producto);
        abrirProspeccionConProducto(clienteId, clienteNombre, producto);
    };
    window._prospeccionClickCliente = function(clienteId, clienteNombre, clienteRfc) {
        console.log('[PROSPECCION] _prospeccionClickCliente:', clienteId, clienteNombre);
        abrirClienteProspectos(clienteId, clienteNombre, clienteRfc);
    };
    window._prospeccionClickCampana = function(clienteId, clienteNombre) {
        console.log('[PROSPECCION] _prospeccionClickCampana:', clienteId, clienteNombre);
        if (typeof abrirEditorCampana === 'function') {
            abrirEditorCampana({ clienteId: clienteId, nombre: 'Campaña ' + clienteNombre });
        }
    };

    // Expose reload function for client widget (called from nuevo prospecto form)
    window._recargarProspectosCliente = function() {
        if (_currentWidgetClienteId) {
            cargarProspectosDeCliente(_currentWidgetClienteId);
        }
    };

    // ══════════════════════════════════════════════════════════════
    // A2. CLICK ON PRODUCT CELL: Open new prospecto form with client+product pre-filled
    // ══════════════════════════════════════════════════════════════
    function abrirProspeccionConProducto(clienteId, clienteNombre, producto) {
        console.log('[PROSPECCION] abrirProspeccionConProducto:', clienteId, clienteNombre, producto);
        // Open the new prospecto form
        var widget = document.getElementById('widgetNuevoProspecto');
        console.log('[PROSPECCION] widgetNuevoProspecto:', widget ? 'FOUND' : 'NOT FOUND');
        if (!widget) return;

        // Marcar contexto ANTES de abrir el form para que el init del widget
        // pueda detectar pre-llenado si lo soporta.
        window._wpfSelectedClienteId = clienteId;
        window._prospeccionProductoContext = {
            clienteId: clienteId,
            clienteNombre: clienteNombre,
            producto: producto
        };

        widget.classList.add('active');

        function _aplicarPrellenado() {
            // Pre-fill client name and hidden ID
            var clienteInput = document.getElementById('wpfCliente');
            var clienteHiddenId = document.getElementById('wpfClienteId');
            if (clienteInput) clienteInput.value = clienteNombre;
            if (clienteHiddenId) clienteHiddenId.value = clienteId;

            // Actualizar visualmente el pill del cliente
            var cliBtn = document.getElementById('wpClienteBtn');
            var cliLbl = document.getElementById('wpClienteLabel');
            if (cliLbl) cliLbl.textContent = clienteNombre;
            if (cliBtn) {
                cliBtn.classList.remove('empty');
                cliBtn.classList.add('filled');
            }

            // Pre-fill product select
            var productoSelect = document.getElementById('wpfProducto');
            if (productoSelect) productoSelect.value = producto;

            // Actualizar visualmente el pill de producto
            var prodBtn = document.getElementById('wpProdBtn');
            var prodLbl = document.getElementById('wpProdLabel');
            if (productoSelect && prodLbl) {
                var prodText = producto;
                for (var i = 0; i < productoSelect.options.length; i++) {
                    if (productoSelect.options[i].value === producto) {
                        prodText = productoSelect.options[i].text || producto;
                        break;
                    }
                }
                prodLbl.textContent = prodText;
                if (prodBtn) {
                    prodBtn.classList.remove('empty');
                    prodBtn.classList.add('filled');
                }
            }
        }

        // Aplicamos el pre-llenado en varios tiempos: ahora, tras el reflow,
        // y tras la animación de apertura — para que cualquier init del
        // widget que resetee los pills sea sobreescrito por nuestro pre-llenado.
        _aplicarPrellenado();
        requestAnimationFrame(_aplicarPrellenado);
        setTimeout(_aplicarPrellenado, 60);
        setTimeout(_aplicarPrellenado, 200);
        setTimeout(_aplicarPrellenado, 500);
    }
    window.abrirProspeccionConProducto = abrirProspeccionConProducto;

    // ══════════════════════════════════════════════════════════════
    // B. CLIENT WIDGET: Open and load prospectos for a client
    // ══════════════════════════════════════════════════════════════
    function abrirClienteProspectos(clienteId, clienteNombre, clienteRfc) {
        _currentWidgetClienteId = clienteId;
        _currentWidgetClienteNombre = clienteNombre;
        _currentWidgetClienteRfc = clienteRfc;

        var w = document.getElementById('widgetClienteProspectos');
        if (!w) return;
        w.classList.add('active');

        document.getElementById('wcpClienteName').textContent = clienteNombre || '';
        document.getElementById('wcpClienteRfc').textContent = clienteRfc ? 'RFC: ' + clienteRfc : '';

        cargarProspectosDeCliente(clienteId);
    }

    function cargarProspectosDeCliente(clienteId) {
        var tbody = document.getElementById('wcpProspectosTbody');
        var empty = document.getElementById('wcpEmpty');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:#86868B;">Cargando...</td></tr>';
        if (empty) empty.style.display = 'none';

        fetch('/app/api/prospeccion/cliente/' + clienteId + '/prospectos/')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                tbody.innerHTML = '';
                var rows = data.rows || [];

                if (!rows.length) {
                    if (empty) empty.style.display = 'block';
                    return;
                }
                if (empty) empty.style.display = 'none';

                var etapaLabel = {
                    'identificado': 'Identificado',
                    'calificado': 'Calificado',
                    'reunion': 'Reunion',
                    'en_progreso': 'En Progreso',
                    'procesado': 'Procesado',
                    'cerrado_ganado': 'Ganado',
                    'cerrado_perdido': 'Perdido'
                };
                var etapaColor = {
                    'identificado': '#8E8E93',
                    'calificado': '#007AFF',
                    'reunion': '#92400E',
                    'en_progreso': '#FF9500',
                    'procesado': '#34C759',
                    'cerrado_ganado': '#30D158',
                    'cerrado_perdido': '#FF3B30'
                };

                rows.forEach(function(row) {
                    var tr = document.createElement('tr');
                    tr.className = 'crm-data-row';
                    tr.style.cursor = 'pointer';

                    var pipelineBadge = row.tipo_pipeline === 'proyecto'
                        ? '<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;color:#92400E;"><span>P</span><svg width="10" height="10" fill="#92400E" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>'
                        : '<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;color:#34C759;"><span>R</span><svg width="10" height="10" fill="#34C759" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>';

                    var eColor = etapaColor[row.etapa] || '#8E8E93';
                    var eLabel = etapaLabel[row.etapa] || row.etapa;

                    // Reunion type suffix
                    if (row.etapa === 'reunion' && row.reunion_tipo) {
                        eLabel += ' (' + row.reunion_tipo + ')';
                    }

                    tr.innerHTML =
                        '<td class="px-2 py-4">' +
                            '<span class="wcp-prospecto-link" style="cursor:pointer;color:#1C1C1E;font-weight:600;font-size:11px;" data-prospecto-id="' + row.id + '">' + escapeHtml(row.nombre) + '</span>' +
                            (row.oportunidad_creada_id ? '<span style="display:inline-block;margin-left:6px;font-size:8px;padding:1px 5px;border-radius:4px;background:#34C75922;color:#34C759;font-weight:700;">OPP</span>' : '') +
                        '</td>' +
                        '<td class="px-2 py-4" style="font-size:11px;color:#3C3C43;">' + escapeHtml(row.contacto || '-') + '</td>' +
                        '<td class="px-2 py-4" style="font-size:11px;color:#3C3C43;">' + escapeHtml(row.producto || '-') + '</td>' +
                        '<td class="px-2 py-4" style="font-size:10px;color:#86868B;font-style:italic;">' + escapeHtml(row.area || '-') + '</td>' +
                        '<td class="px-2 py-4 text-center">' + pipelineBadge + '</td>' +
                        '<td class="px-2 py-4"><span style="background:' + eColor + '22;color:' + eColor + ';padding:2px 10px;border-radius:9999px;font-size:10px;font-weight:600;white-space:nowrap;">' + eLabel + '</span></td>' +
                        '<td class="px-2 py-4" style="font-size:10px;color:#86868B;">' + escapeHtml(row.fecha_iso || '') + '</td>' +
                        '<td class="px-2 py-4 text-center"><button class="btn-campana" data-prospecto-id="' + row.id + '" style="background:none;border:1px solid #FF9500;border-radius:6px;padding:3px 8px;cursor:pointer;color:#FF9500;font-size:11px;" title="Campaña" onclick="event.stopPropagation();if(typeof abrirEditorCampana===\'function\')abrirEditorCampana({producto:\'' + escapeHtml(row.producto||'') + '\',nombre:\'Campaña ' + escapeHtml(row.nombre||'') + '\'});">&#128226;</button></td>';

                    tbody.appendChild(tr);
                });

                // Click handlers for prospecto names
                tbody.querySelectorAll('.wcp-prospecto-link').forEach(function(el) {
                    el.addEventListener('click', function(e) {
                        e.stopPropagation();
                        abrirWidgetProspecto(parseInt(this.dataset.prospectoId));
                    });
                });
            });
    }

    // ── "Nuevo Prospecto" button inside client widget ──
    document.addEventListener('click', function(e) {
        if (e.target.id === 'wcpNuevoProspecto' || e.target.closest('#wcpNuevoProspecto')) {
            if (!_currentWidgetClienteId) return;

            // Pre-fill client in the new prospecto form
            var clienteInput = document.getElementById('wpfCliente');
            var clienteIdField = document.getElementById('wpfClienteId');
            if (clienteInput) clienteInput.value = _currentWidgetClienteNombre;
            if (clienteIdField) clienteIdField.value = _currentWidgetClienteId;

            // Open the new prospecto widget
            var w = document.getElementById('widgetNuevoProspecto');
            if (w) w.classList.add('active');
        }
    });

    // ── Close client widget ──
    document.addEventListener('click', function(e) {
        if (e.target.id === 'wcpClose') {
            var w = document.getElementById('widgetClienteProspectos');
            if (w) w.classList.remove('active');
        }
    });

    // Close on overlay click
    var wcpOverlay = document.getElementById('widgetClienteProspectos');
    if (wcpOverlay) {
        wcpOverlay.addEventListener('click', function(e) {
            if (e.target === wcpOverlay) {
                wcpOverlay.classList.remove('active');
            }
        });
    }

    // ══════════════════════════════════════════════════════════════
    // C. PROSPECTO DETAIL WIDGET (existing logic preserved)
    // ══════════════════════════════════════════════════════════════
    function abrirWidgetProspecto(id) {
        var w = document.getElementById('widgetProspecto');
        if (!w) return;
        w.classList.add('active');

        var loading = document.getElementById('prospectoLoading');
        var content = document.getElementById('prospectoContent');
        if (loading) loading.style.display = 'block';
        if (content) content.style.display = 'none';

        fetch('/app/api/prospecto/' + id + '/detalle/')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (loading) loading.style.display = 'none';
                if (content) content.style.display = 'flex';
                renderProspectoDetalle(data);
            });
    }
    window.abrirWidgetProspecto = abrirWidgetProspecto;

    function _isProspectoCerrado(data) {
        if (!data) return false;
        return data.etapa === 'cerrado_ganado' || data.etapa === 'cerrado_perdido';
    }

    function renderProspectoDetalle(data) {
        // Store current prospecto
        window._currentProspectoId = data.id;
        window._currentProspectoData = data;

        document.getElementById('wpTitle').textContent = data.nombre || '';
        document.getElementById('wpCliente').textContent = data.cliente || '-';
        document.getElementById('wpContacto').textContent = data.contacto || '-';
        document.getElementById('wpProducto').textContent = data.producto || '-';
        document.getElementById('wpArea').textContent = data.area || '-';

        // Banner "Generado desde evento" — visible solo si el prospecto tiene evento_origen
        var evtBanner = document.getElementById('wpEventoOrigen');
        var evtNombre = document.getElementById('wpEventoOrigenNombre');
        if (evtBanner && evtNombre) {
            if (data.evento_origen_id) {
                evtNombre.textContent = data.evento_origen_nombre || ('Evento #' + data.evento_origen_id);
                evtBanner.style.display = '';
                evtBanner.onclick = function(e) {
                    e.preventDefault();
                    if (typeof window.eventoDetalleAbrir === 'function') {
                        // Cerrar el widget del prospecto y abrir el del evento
                        var wp = document.getElementById('widgetProspecto');
                        if (wp) {
                            wp.classList.add('closing');
                            setTimeout(function(){ wp.classList.remove('active','closing'); }, 220);
                        }
                        setTimeout(function(){ window.eventoDetalleAbrir(data.evento_origen_id); }, 240);
                    }
                };
            } else {
                evtBanner.style.display = 'none';
                evtBanner.onclick = null;
            }
        }

        // Si el prospecto está cerrado (ganado/perdido), ocultar CTA de nueva
        // actividad — no debe pedirse crear actividades en prospectos cerrados.
        var btnNuevaAct = document.getElementById('wpBtnNuevaActividad');
        if (btnNuevaAct) {
            btnNuevaAct.style.display = _isProspectoCerrado(data) ? 'none' : '';
        }
        // Limpiar persistencia de "pendiente sin actividad" si el prospecto
        // ya está cerrado — no hay que pedir actividad nunca más.
        if (_isProspectoCerrado(data)) {
            try {
                var pendId = localStorage.getItem('_pendienteProspectoSinActividad');
                if (pendId && parseInt(pendId) === data.id) {
                    localStorage.removeItem('_pendienteProspectoSinActividad');
                }
            } catch (e) {}
        }

        // Tipo Pipeline badge
        var tipoPipEl = document.getElementById('wpTipoPipeline');
        if (tipoPipEl) {
            if (data.tipo_pipeline === 'proyecto') {
                tipoPipEl.innerHTML = '<span style="display:inline-block;padding:2px 10px;border-radius:9999px;background:#92400E22;color:#92400E;font-size:0.78rem;font-weight:600;">Proyecto</span>';
            } else {
                tipoPipEl.innerHTML = '<span style="display:inline-block;padding:2px 10px;border-radius:9999px;background:#34C75922;color:#34C759;font-size:0.78rem;font-weight:600;">Runrate</span>';
            }
        }

        document.getElementById('wpComentarioInicial').textContent = data.comentarios || '-';

        // Pipeline stages
        renderPipelineProspecto(data.etapa, data.reunion_tipo);

        // Comentarios
        cargarComentariosProspecto(data.id, data.comentarios, data.fecha_creacion);

        // Actividades
        cargarActividadesProspecto(data.id);

        // Correos vinculados (antes "Cotizaciones"; cambio de scope para
        // prospectos pre-conversión — el cotizador se abre solo al convertir).
        cargarCorreosProspecto(data.id, data);

        // Vendedor/Cliente cards
        renderStakeholders(data);
    }

    function renderStakeholders(data) {
        var vendedorAvatar = document.getElementById('wpVendedorAvatar');
        var vendedorName = document.getElementById('wpVendedorName');
        var clienteAvatar = document.getElementById('wpClienteAvatar');
        var clienteName = document.getElementById('wpClienteName');

        var vendedorNombre = data.usuario || data.vendedor || '-';
        if (vendedorAvatar) vendedorAvatar.textContent = getInitials(vendedorNombre);
        if (vendedorName) vendedorName.textContent = vendedorNombre;
        if (clienteAvatar) clienteAvatar.textContent = getInitials(data.cliente || '');
        if (clienteName) clienteName.textContent = data.cliente || '-';

        // Asignado por (supervisor/admin que delegó el prospecto al vendedor)
        var asigRow = document.getElementById('wpAsignadoPorRow');
        var asigDiv = document.getElementById('wpAsignadoPorDivider');
        var asigAvatar = document.getElementById('wpAsignadoPorAvatar');
        var asigName = document.getElementById('wpAsignadoPorName');
        var por = (data.asignado_por || '').trim();
        if (por) {
            if (asigAvatar) asigAvatar.textContent = getInitials(por);
            if (asigName) asigName.textContent = por;
            if (asigRow) asigRow.style.display = '';
            if (asigDiv) asigDiv.style.display = '';
        } else {
            if (asigRow) asigRow.style.display = 'none';
            if (asigDiv) asigDiv.style.display = 'none';
        }
    }

    // ── Pipeline ──
    function renderPipelineProspecto(etapaActual, reunionTipo) {
        var stages = [
            { key: 'identificado', label: 'Identificado' },
            { key: 'calificado', label: 'Calificado' },
            { key: 'reunion', label: 'Reunion' },
            { key: 'en_progreso', label: 'En Progreso' },
            { key: 'procesado', label: 'Procesado' },
            { key: 'cerrar', label: 'Cerrar Prospecto' }
        ];

        var container = document.getElementById('wpPipelineStages');
        if (!container) return;
        container.innerHTML = '';

        // Map cerrado_ganado/cerrado_perdido to 'cerrar'
        var etapaMap = etapaActual;
        if (etapaActual === 'cerrado_ganado' || etapaActual === 'cerrado_perdido') {
            etapaMap = 'cerrar';
        }

        var stageKeys = stages.map(function(s) { return s.key; });
        var etapaIndex = stageKeys.indexOf(etapaMap);

        stages.forEach(function(stage, i) {
            var isCompleted = (i < etapaIndex);
            var isActive = (i === etapaIndex);

            // Create stage button (pill style like oportunidad)
            var btn = document.createElement('div');
            btn.className = 'wo-stage-btn';
            if (isCompleted) btn.classList.add('completed');
            if (isActive) btn.classList.add('active');

            // Label text
            var labelText = stage.label;
            if (stage.key === 'reunion' && etapaActual === 'reunion' && reunionTipo) {
                labelText = 'Reunion (' + reunionTipo + ')';
            }
            if (etapaActual === 'cerrado_ganado' && stage.key === 'cerrar') {
                labelText = 'Ganado';
                btn.style.background = '#30D158';
                btn.style.borderColor = '#30D158';
                btn.style.color = '#fff';
                btn.style.boxShadow = '0 2px 12px rgba(48,209,88,0.35)';
            } else if (etapaActual === 'cerrado_perdido' && stage.key === 'cerrar') {
                labelText = 'Perdido';
                btn.style.background = '#FF3B30';
                btn.style.borderColor = '#FF3B30';
                btn.style.color = '#fff';
                btn.style.boxShadow = '0 2px 12px rgba(255,59,48,0.35)';
            }

            btn.style.padding = '7px 16px';
            btn.style.fontSize = '0.7rem';
            btn.textContent = labelText;

            // Click handler
            btn.addEventListener('click', function() {
                if (etapaActual === 'cerrado_ganado' || etapaActual === 'cerrado_perdido') return;

                if (stage.key === 'reunion') {
                    mostrarSelectorReunion();
                } else if (stage.key === 'cerrar') {
                    mostrarDialogCerrar();
                } else {
                    cambiarEtapaProspecto(stage.key);
                }
            });

            container.appendChild(btn);

            // Connector
            if (i < stages.length - 1) {
                var connector = document.createElement('div');
                connector.className = 'wo-stage-connector';
                connector.style.width = '20px';
                if (i < etapaIndex) connector.classList.add('completed');
                container.appendChild(connector);
            }
        });
    }

    function mostrarSelectorReunion() {
        var html = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10500;display:flex;align-items:center;justify-content:center;" id="reunionSelector">' +
            '<div style="background:#fff;border-radius:16px;padding:24px;max-width:300px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
            '<h3 style="margin:0 0 16px;font-size:14px;font-weight:700;color:#1C1C1E;">Tipo de Reunion</h3>' +
            '<div style="display:flex;gap:10px;">' +
            '<button onclick="confirmarReunion(\'virtual\')" style="flex:1;padding:12px;border:2px solid #92400E;border-radius:10px;background:#92400E22;color:#92400E;font-weight:700;font-size:13px;cursor:pointer;">Virtual</button>' +
            '<button onclick="confirmarReunion(\'presencial\')" style="flex:1;padding:12px;border:2px solid #92400E;border-radius:10px;background:#92400E22;color:#92400E;font-weight:700;font-size:13px;cursor:pointer;">Presencial</button>' +
            '</div>' +
            '<button onclick="document.getElementById(\'reunionSelector\').remove()" style="margin-top:12px;width:100%;padding:8px;border:none;background:#F2F2F7;border-radius:8px;color:#86868B;font-size:12px;cursor:pointer;">Cancelar</button>' +
            '</div></div>';
        document.body.insertAdjacentHTML('beforeend', html);
    }
    window.confirmarReunion = function(tipo) {
        document.getElementById('reunionSelector').remove();
        cambiarEtapaProspecto('reunion', tipo);
    };

    function mostrarDialogCerrar() {
        var html = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10500;display:flex;align-items:center;justify-content:center;" id="cerrarSelector">' +
            '<div style="background:#fff;border-radius:16px;padding:24px;max-width:340px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
            '<h3 style="margin:0 0 8px;font-size:14px;font-weight:700;color:#1C1C1E;">Cerrar Prospecto</h3>' +
            '<p style="margin:0 0 16px;font-size:12px;color:#86868B;">El prospecto fue ganado o perdido?</p>' +
            '<div style="display:flex;gap:10px;">' +
            '<button onclick="confirmarCerrar(\'cerrado_ganado\')" style="flex:1;padding:14px;border:2px solid #34C759;border-radius:10px;background:#34C75922;color:#34C759;font-weight:700;font-size:13px;cursor:pointer;">Ganado</button>' +
            '<button onclick="confirmarCerrar(\'cerrado_perdido\')" style="flex:1;padding:14px;border:2px solid #FF3B30;border-radius:10px;background:#FF3B3022;color:#FF3B30;font-weight:700;font-size:13px;cursor:pointer;">Perdido</button>' +
            '</div>' +
            '<button onclick="document.getElementById(\'cerrarSelector\').remove()" style="margin-top:12px;width:100%;padding:8px;border:none;background:#F2F2F7;border-radius:8px;color:#86868B;font-size:12px;cursor:pointer;">Cancelar</button>' +
            '</div></div>';
        document.body.insertAdjacentHTML('beforeend', html);
    }
    window.confirmarCerrar = function(etapa) {
        document.getElementById('cerrarSelector').remove();
        // ── Ganado: abre el modal "Crear Oportunidad(es) en serie". El cambio
        // de etapa se aplica al CERRAR el modal sólo si se creó >=1 opp.
        if (etapa === 'cerrado_ganado') {
            wpAbrirModalCrearOpp();
            return;
        }
        cambiarEtapaProspecto(etapa);
    };

    // ══════════════════════════════════════════════════════════════
    // CERRAR GANADO → MODAL CREAR OPORTUNIDAD(ES) EN SERIE
    // ══════════════════════════════════════════════════════════════
    // Estado del flow durante la sesión del modal abierto:
    var _wcoOppsCreadas = [];  // [{id, titulo, monto, tipo_negociacion}]

    function wpAbrirModalCrearOpp() {
        var data = window._currentProspectoData || {};
        var modal = document.getElementById('widgetCrearOppDesdeProspecto');
        if (!modal) return;
        // Reset estado de sesión
        _wcoOppsCreadas = [];
        _wcoRenderCreatedList();
        _wcoResetForm(true);

        // Prellenar campos read-only desde el prospecto
        var setVal = function(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; };
        setVal('wcoTitulo', data.nombre || '');
        setVal('wcoCliente', data.cliente || '-');
        setVal('wcoContacto', data.contacto || '-');
        setVal('wcoProducto', data.producto || 'SOFTWARE');
        setVal('wcoArea', data.area || 'SISTEMAS');
        setVal('wcoMonto', '');
        setVal('wcoTipoNeg', data.tipo_pipeline || '');
        setVal('wcoNotas', '');

        // Cargar dropdown de responsable. Default = vendedor del prospecto.
        // Si el user es supervisor/admin, podemos cargar la lista completa
        // de vendedores visibles para que elija a quién asignar.
        _wcoPoblarResponsables();

        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        setTimeout(function() {
            var t = document.getElementById('wcoTitulo');
            if (t) t.focus();
        }, 60);
    }

    function _wcoPoblarResponsables() {
        var sel = document.getElementById('wcoResponsable');
        if (!sel) return;
        var data = window._currentProspectoData || {};
        var vendedorIdProspecto = (data.usuario && data.usuario.id) || data.usuario_id || null;
        var vendedorNombre = (data.usuario && (data.usuario.nombre || data.usuario.first_name)) || data.vendedor || 'Vendedor del prospecto';
        // Vista base: vacío = vendedor del prospecto (default backend).
        sel.innerHTML = '<option value="">— ' + escapeHtml(vendedorNombre) + ' (default) —</option>';
        // Si el user actual es supervisor, intentamos cargar la lista
        // completa para que pueda elegir reasignar.
        fetch('/app/api/admin/usuarios/', { credentials: 'same-origin' })
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(payload) {
                if (!payload) return;
                var users = (payload.usuarios || payload.users || []);
                if (!users.length) return;
                users.forEach(function(u) {
                    var nombre = ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || u.username;
                    var opt = document.createElement('option');
                    opt.value = u.id;
                    opt.textContent = nombre + (u.id === vendedorIdProspecto ? ' (vendedor del prospecto)' : '');
                    sel.appendChild(opt);
                });
            })
            .catch(function() { /* vendor sin permisos — solo verá la opción default */ });
    }
    window.wpAbrirModalCrearOpp = wpAbrirModalCrearOpp;

    function _wcoResetForm(keepReadonly) {
        // Limpia los campos editables; los read-only (cliente/contacto) se
        // re-aplican desde el prospecto en cada apertura.
        ['wcoMonto', 'wcoNotas'].forEach(function(id){
            var el = document.getElementById(id); if (el) el.value = '';
        });
        // Para "Crear otra" reiniciamos también título a "Nombre prospecto - oportunidad N"
        var data = window._currentProspectoData || {};
        var titEl = document.getElementById('wcoTitulo');
        if (titEl) {
            var n = _wcoOppsCreadas.length;
            titEl.value = (n === 0)
                ? (data.nombre || '')
                : ((data.nombre || 'Oportunidad') + ' #' + (n + 1));
        }
        // Pipeline conserva valor previo (si hubo). Si no, vacío.
        if (!keepReadonly) {
            var t = document.getElementById('wcoTipoNeg');
            if (t) t.value = '';
        }
    }

    function _wcoRenderCreatedList() {
        var listWrap = document.getElementById('wcoCreatedList');
        var items = document.getElementById('wcoCreatedItems');
        var status = document.getElementById('wcoFooterStatus');
        if (!listWrap || !items || !status) return;

        if (_wcoOppsCreadas.length === 0) {
            listWrap.style.display = 'none';
            items.innerHTML = '';
            status.textContent = 'Aún no se ha creado ninguna oportunidad.';
            return;
        }
        listWrap.style.display = 'block';
        items.innerHTML = _wcoOppsCreadas.map(function(o) {
            var monto = (o.monto || 0).toLocaleString('es-MX', { style:'currency', currency:'MXN', maximumFractionDigits:0 });
            return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;">' +
                '<span style="width:22px;height:22px;border-radius:50%;background:#16A34A;color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">' +
                    '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' +
                '</span>' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="font-size:0.84rem;font-weight:600;color:#1D1D1F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(o.titulo) + '</div>' +
                    '<div style="font-size:0.7rem;color:#6B7280;">' + (o.tipo_negociacion === 'proyecto' ? 'Proyecto' : 'Runrate') + ' · ' + escapeHtml(monto) + '</div>' +
                '</div>' +
            '</div>';
        }).join('');
        var n = _wcoOppsCreadas.length;
        status.textContent = n === 1 ? '1 oportunidad creada.' : (n + ' oportunidades creadas.');
    }

    function _wcoCerrarModal() {
        var modal = document.getElementById('widgetCrearOppDesdeProspecto');
        if (modal) modal.style.display = 'none';

        // Si se creó al menos una oportunidad, marcar el prospecto como ganado.
        // Si no, dejar la etapa anterior intacta.
        if (_wcoOppsCreadas.length > 0) {
            cambiarEtapaProspecto('cerrado_ganado');
        }
        _wcoOppsCreadas = [];
    }

    // ── Hooks DOM del modal — registrar una sola vez ──
    (function _wcoHookOnce() {
        var form = document.getElementById('wcoForm');
        var btnClose = document.getElementById('wcoCloseBtn');
        var btnReset = document.getElementById('wcoResetBtn');
        var btnTerm = document.getElementById('wcoTerminarBtn');
        var overlay = document.getElementById('widgetCrearOppDesdeProspecto');

        if (form && !form._wcoHooked) {
            form._wcoHooked = true;
            form.addEventListener('submit', function(ev) {
                ev.preventDefault();
                _wcoEnviar();
            });
        }
        if (btnClose && !btnClose._wcoHooked) {
            btnClose._wcoHooked = true;
            btnClose.addEventListener('click', _wcoCerrarModal);
        }
        if (btnTerm && !btnTerm._wcoHooked) {
            btnTerm._wcoHooked = true;
            btnTerm.addEventListener('click', _wcoCerrarModal);
        }
        if (btnReset && !btnReset._wcoHooked) {
            btnReset._wcoHooked = true;
            btnReset.addEventListener('click', function() { _wcoResetForm(false); });
        }
        if (overlay && !overlay._wcoHooked) {
            overlay._wcoHooked = true;
            overlay.addEventListener('click', function(ev) {
                // Click en backdrop (fuera del card) cierra el modal con la
                // misma lógica que el botón Terminar.
                if (ev.target === overlay) _wcoCerrarModal();
            });
        }
    })();

    function _wcoEnviar() {
        var id = window._currentProspectoId;
        if (!id) return;

        var titulo = (document.getElementById('wcoTitulo').value || '').trim();
        var tipoNeg = (document.getElementById('wcoTipoNeg').value || '').trim();
        var monto = (document.getElementById('wcoMonto').value || '').trim();
        var producto = (document.getElementById('wcoProducto').value || '').trim();
        var area = (document.getElementById('wcoArea').value || '').trim();
        var notas = (document.getElementById('wcoNotas').value || '').trim();
        var responsableId = (document.getElementById('wcoResponsable')
            ? document.getElementById('wcoResponsable').value
            : '').trim();

        if (!titulo) {
            alert('El título de la oportunidad es requerido.');
            document.getElementById('wcoTitulo').focus();
            return;
        }
        if (!tipoNeg) {
            alert('Selecciona el tipo de pipeline (Runrate / Proyecto).');
            document.getElementById('wcoTipoNeg').focus();
            return;
        }

        var btn = document.getElementById('wcoSubmitBtn');
        var orig = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.innerHTML = 'Creando…'; }

        fetch('/app/api/prospecto/' + id + '/crear-oportunidad/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
            body: JSON.stringify({
                titulo: titulo,
                tipo_negociacion: tipoNeg,
                monto: monto || '0',
                producto: producto,
                area: area,
                comentarios: notas,
                probabilidad_cierre: 25,
                // Si está vacío, el backend usa prospecto.usuario por default.
                usuario_id: responsableId ? parseInt(responsableId, 10) : null,
            })
        }).then(function(r){ return r.json(); }).then(function(data) {
            if (btn) { btn.disabled = false; btn.innerHTML = orig; }
            if (!data || !data.success) {
                alert((data && data.error) || 'Error al crear la oportunidad.');
                return;
            }
            _wcoOppsCreadas.push({
                id: data.oportunidad_id,
                titulo: data.titulo || titulo,
                monto: data.monto || 0,
                tipo_negociacion: data.tipo_negociacion || tipoNeg
            });
            _wcoRenderCreatedList();
            // Listo para crear otra: limpiar editables pero conservar pipeline.
            _wcoResetForm(true);
            var titEl = document.getElementById('wcoTitulo');
            if (titEl) titEl.focus();
        }).catch(function(err) {
            if (btn) { btn.disabled = false; btn.innerHTML = orig; }
            alert('Error de red al crear oportunidad.');
            console.error('[Prospecto→Opp] error', err);
        });
    }

    function _showProspectoMissingActivityWarning() {
        var existing = document.getElementById('warnMissingProspectoActivity');
        if (existing) existing.remove();

        var warn = document.createElement('div');
        warn.id = 'warnMissingProspectoActivity';
        warn.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s;';
        warn.innerHTML = '<div style="background:#fff;border-radius:16px;padding:2rem;max-width:380px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.25);">' +
            '<div style="width:56px;height:56px;border-radius:50%;background:rgba(255,149,0,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">' +
            '<svg width="28" height="28" fill="none" stroke="#FF9500" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' +
            '</div>' +
            '<h3 style="margin:0 0 0.5rem;font-size:1.15rem;font-weight:700;color:#1D1D1F;">Falta agendar actividad</h3>' +
            '<p style="margin:0 0 1.5rem;font-size:0.9rem;color:#86868B;line-height:1.5;">Cada prospecto debe tener al menos una actividad programada antes de cerrarlo.</p>' +
            '<div style="display:flex;gap:0.75rem;justify-content:center;">' +
            '<button id="warnBtnAgendarProspecto" style="background:#B45309;color:#fff;border:none;padding:0.7rem 1.5rem;border-radius:10px;font-weight:700;font-size:0.9rem;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:transform 0.15s;" onmouseenter="this.style.transform=\'scale(1.03)\'" onmouseleave="this.style.transform=\'none\'">' +
            '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>' +
            'Agendar Actividad' +
            '</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(warn);

        // Close on background click
        warn.addEventListener('click', function(e) { if (e.target === warn) warn.remove(); });

        document.getElementById('warnBtnAgendarProspecto').addEventListener('click', function() {
            warn.remove();
            wpAbrirPanelActividades();
        });
    }

    function cambiarEtapaProspecto(nuevaEtapa, reunionTipo) {
        var id = window._currentProspectoId;
        if (!id) return;

        // Validate: must have at least one activity before closing
        if (nuevaEtapa === 'cerrado_ganado' || nuevaEtapa === 'cerrado_perdido') {
            fetch('/app/api/prospecto/' + id + '/actividades/')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var acts = data.actividades || [];
                    var pendientes = acts.filter(function(a) { return !a.completada; });
                    if (pendientes.length > 0) {
                        _ejecutarCambioEtapa(id, nuevaEtapa, reunionTipo);
                    } else {
                        _showProspectoMissingActivityWarning();
                    }
                })
                .catch(function() {
                    // Si falla el fetch, mostrar warning de todos modos
                    _showProspectoMissingActivityWarning();
                });
            return;
        }

        _ejecutarCambioEtapa(id, nuevaEtapa, reunionTipo);
    }

    function _ejecutarCambioEtapa(id, nuevaEtapa, reunionTipo) {
        var body = { etapa: nuevaEtapa };
        if (reunionTipo) body.reunion_tipo = reunionTipo;

        fetch('/app/api/prospecto/' + id + '/etapa/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
            body: JSON.stringify(body)
        }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.success) {
                if (nuevaEtapa === 'cerrado_ganado' && data.oportunidad_id) {
                    var toast = document.getElementById('widgetToast');
                    if (toast) {
                        toast.textContent = 'Prospecto ganado! Oportunidad #' + data.oportunidad_id + ' creada.';
                        toast.classList.add('show');
                        setTimeout(function() { toast.classList.remove('show'); }, 3000);
                    }
                }
                // Live update del kanban (sin reload). Mueve la card a la
                // columna nueva, refresca label y contadores.
                if (typeof window.pkMoveCardToStage === 'function') {
                    try { window.pkMoveCardToStage(id, nuevaEtapa); } catch (e) {}
                }
                abrirWidgetProspecto(id);
                // Reload client widget if open
                if (_currentWidgetClienteId) {
                    cargarProspectosDeCliente(_currentWidgetClienteId);
                }
                cargarClientesProspeccion();
            }
        });
    }

    // ── Comentarios (chat style) ──
    /* Menú de 3 puntos en cada comentario del prospecto.
       Soporta editar inline + eliminar con custom confirm. Solo
       montamos los listeners UNA vez (delegación) por contenedor. */
    function wireProspectoComMenus(container) {
        if (!container || container._comMenuWired) return;
        container._comMenuWired = true;
        // Cerrar menús abiertos al clickear fuera
        document.addEventListener('click', function () {
            container.querySelectorAll('.wp-com-menu').forEach(function (m) { m.remove(); });
        });
        // Delegación de clicks: abrir menú / editar / eliminar
        container.addEventListener('click', function (e) {
            var btnMenu = e.target.closest('[data-com-menu]');
            if (btnMenu) {
                e.stopPropagation();
                var cid = btnMenu.getAttribute('data-com-menu');
                var existing = container.querySelector('.wp-com-menu[data-com-menu-for="' + cid + '"]');
                container.querySelectorAll('.wp-com-menu').forEach(function (m) { m.remove(); });
                if (existing) return;
                var menu = document.createElement('div');
                menu.className = 'wp-com-menu';
                menu.setAttribute('data-com-menu-for', cid);
                menu.innerHTML = ''
                    + '<button type="button" data-com-edit="' + cid + '">'
                    +   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>'
                    +   'Editar'
                    + '</button>'
                    + '<button type="button" class="wp-com-menu-danger" data-com-del="' + cid + '">'
                    +   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>'
                    +   'Eliminar'
                    + '</button>';
                btnMenu.parentNode.appendChild(menu);
                return;
            }
            var editBtn = e.target.closest('[data-com-edit]');
            if (editBtn) {
                e.stopPropagation();
                container.querySelectorAll('.wp-com-menu').forEach(function (m) { m.remove(); });
                startEditProspectoComentario(editBtn.getAttribute('data-com-edit'));
                return;
            }
            var delBtn = e.target.closest('[data-com-del]');
            if (delBtn) {
                e.stopPropagation();
                container.querySelectorAll('.wp-com-menu').forEach(function (m) { m.remove(); });
                deleteProspectoComentario(delBtn.getAttribute('data-com-del'));
                return;
            }
        });
    }

    function startEditProspectoComentario(comId) {
        var container = document.getElementById('wpComentariosList');
        if (!container) return;
        var textEl = container.querySelector('[data-com-text="' + comId + '"]');
        if (!textEl || textEl.classList.contains('editing')) return;
        var original = textEl.textContent;
        textEl.classList.add('editing');
        textEl.innerHTML = ''
            + '<textarea class="wp-com-edit-area"></textarea>'
            + '<div class="wp-com-edit-actions">'
            +   '<button type="button" class="wp-com-edit-cancel">Cancelar</button>'
            +   '<button type="button" class="wp-com-edit-save">Guardar</button>'
            + '</div>';
        var ta = textEl.querySelector('textarea');
        ta.value = original;
        ta.focus();
        textEl.querySelector('.wp-com-edit-cancel').addEventListener('click', function () {
            textEl.classList.remove('editing');
            textEl.textContent = original;
        });
        textEl.querySelector('.wp-com-edit-save').addEventListener('click', function () {
            var nuevo = (ta.value || '').trim();
            if (!nuevo) {
                if (typeof window.showFlash === 'function') {
                    window.showFlash('El comentario no puede quedar vacío', 'error');
                }
                return;
            }
            fetch('/app/api/prospecto-comentarios/' + comId + '/', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                body: JSON.stringify({ texto: nuevo }),
            }).then(function (r) { return r.json(); }).then(function (d) {
                if (!d || !d.success) {
                    if (typeof window.showFlash === 'function') {
                        window.showFlash((d && d.error) || 'No se pudo guardar', 'error');
                    }
                    return;
                }
                textEl.classList.remove('editing');
                textEl.textContent = d.comentario.texto;
            });
        });
    }

    function deleteProspectoComentario(comId) {
        var doDelete = function () {
            fetch('/app/api/prospecto-comentarios/' + comId + '/', {
                method: 'DELETE',
                headers: { 'X-CSRFToken': csrf() },
            }).then(function (r) { return r.json(); }).then(function (d) {
                if (!d || !d.success) {
                    if (typeof window.showFlash === 'function') {
                        window.showFlash((d && d.error) || 'No se pudo eliminar', 'error');
                    }
                    return;
                }
                // Quitamos el comentario del DOM sin recargar todo.
                var node = document.querySelector('#wpComentariosList [data-com-id="' + comId + '"]');
                if (node) node.remove();
            });
        };
        if (typeof window.customConfirm === 'function') {
            window.customConfirm({
                title: '¿Eliminar comentario?',
                message: 'Esta acción no se puede deshacer.',
                okText: 'Eliminar',
            }, doDelete);
        } else {
            // Fallback si customConfirm no está disponible (debería estarlo).
            if (confirm('¿Eliminar este comentario? No se puede deshacer.')) doDelete();
        }
    }

    function cargarComentariosProspecto(id, comentarioInicial, fechaCreacion) {
        fetch('/app/api/prospecto/' + id + '/comentarios/')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var container = document.getElementById('wpComentariosList');
                if (!container) return;
                container.innerHTML = '';

                // Comentario inicial del prospecto como primer mensaje "sistema"
                if (comentarioInicial) {
                    var sysMsg = document.createElement('div');
                    sysMsg.className = 'wp-chat-msg wp-chat-msg--system';
                    sysMsg.innerHTML =
                        '<div class="wp-chat-avatar" style="background:#92400E22;color:#92400E;">' +
                            '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>' +
                        '</div>' +
                        '<div class="wp-chat-bubble wp-chat-bubble--system">' +
                            '<div class="wp-chat-meta">' +
                                '<span class="wp-chat-author">Comentario Inicial</span>' +
                                '<span class="wp-chat-time">' + escapeHtml(fechaCreacion || '') + '</span>' +
                            '</div>' +
                            '<div class="wp-chat-text">' + escapeHtml(comentarioInicial) + '</div>' +
                        '</div>';
                    container.appendChild(sysMsg);
                }

                // Comentarios de seguimiento
                (data.comentarios || []).forEach(function(c) {
                    var msg = document.createElement('div');
                    msg.className = 'wp-chat-msg';
                    msg.setAttribute('data-com-id', c.id);
                    // Menú de 3 puntos: solo si el user puede editar.
                    var menuBtn = c.puede_editar
                        ? '<button type="button" class="wp-com-menu-btn" data-com-menu="' + c.id + '" title="Opciones">' +
                            '<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>' +
                          '</button>'
                        : '';
                    msg.innerHTML =
                        '<div class="wp-chat-avatar">' + getInitials(c.usuario) + '</div>' +
                        '<div class="wp-chat-bubble">' +
                            '<div class="wp-chat-meta">' +
                                '<span class="wp-chat-author">' + escapeHtml(c.usuario) + '</span>' +
                                '<span class="wp-chat-meta-right">' +
                                    '<span class="wp-chat-time">' + escapeHtml(c.fecha) + '</span>' +
                                    menuBtn +
                                '</span>' +
                            '</div>' +
                            '<div class="wp-chat-text" data-com-text="' + c.id + '">' + escapeHtml(c.texto) + '</div>' +
                        '</div>';
                    container.appendChild(msg);
                });
                wireProspectoComMenus(container);

                if (!comentarioInicial && !(data.comentarios || []).length) {
                    container.innerHTML = '<div style="padding:2rem;text-align:center;color:#C7C7CC;font-size:0.8rem;font-style:italic;">Sin comentarios aun</div>';
                }

                // Scroll to bottom
                container.scrollTop = container.scrollHeight;
            });
    }

    // Agregar comentario
    document.addEventListener('click', function(e) {
        if (e.target.id === 'wpBtnAgregarComentario' || e.target.closest('#wpBtnAgregarComentario')) {
            var textarea = document.getElementById('wpNuevoComentario');
            var texto = textarea ? textarea.value.trim() : '';
            if (!texto || !window._currentProspectoId) return;

            fetch('/app/api/prospecto/' + window._currentProspectoId + '/comentarios/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                body: JSON.stringify({ texto: texto })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success) {
                    textarea.value = '';
                    var d = window._currentProspectoData;
                    cargarComentariosProspecto(window._currentProspectoId, d ? d.comentarios : null, d ? d.fecha_creacion : null);
                }
            });
        }
    });

    // Botón orb del asistente AI sobre este prospecto.
    // Abre el modal del consultor general en "modo prospecto" — chat
    // específico atado al prospecto actual.
    document.addEventListener('click', function(e) {
        if (e.target.id === 'wpBtnAsistente' || e.target.closest('#wpBtnAsistente')) {
            e.preventDefault();
            var id = window._currentProspectoId;
            var d = window._currentProspectoData;
            if (!id) return;
            if (typeof window.asistenteAbrir === 'function') {
                window.asistenteAbrir({prospecto: {
                    id: id,
                    titulo: (d && (d.nombre || (d.cliente && d.cliente.nombre_empresa))) || 'Prospecto',
                }});
            }
        }
    });

    // Refresh hook usado por el asistente AI cuando guarda un resumen
    // (manual o auto-save) para que el comentario nuevo aparezca al
    // instante en la bitácora sin tener que cerrar/reabrir el prospecto.
    window.refreshProspectoDetalle = function (prospectoId) {
        if (!prospectoId || prospectoId !== window._currentProspectoId) return;
        var d = window._currentProspectoData;
        cargarComentariosProspecto(prospectoId, d ? d.comentarios : null, d ? d.fecha_creacion : null);
    };

    // ── Actividades Programadas ──
    function cargarActividadesProspecto(id) {
        fetch('/app/api/prospecto/' + id + '/actividades/')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var actividades = data.actividades || [];

                // Render compact card (most recent/urgent activity)
                renderActividadCompacta(actividades);

                // Render full list in panel
                renderActividadesFullList(actividades);
            });
    }

    function renderActividadCompacta(actividades) {
        var body = document.getElementById('wpActividadRecienteBody');
        if (!body) return;

        var cerrado = _isProspectoCerrado(window._currentProspectoData);

        // Find the closest pending activity
        var pendientes = actividades.filter(function(a) { return !a.completada; });
        if (pendientes.length === 0) {
            if (actividades.length === 0) {
                if (cerrado) {
                    body.innerHTML = '<div style="font-size:0.78rem;color:#9CA3AF;font-style:italic;">Prospecto cerrado — sin nuevas actividades</div>';
                } else {
                    body.innerHTML = '<div style="font-size:0.82rem;color:#9CA3AF;">Sin actividades</div>';
                }
            } else {
                body.innerHTML = '<div style="font-size:0.82rem;color:#34C759;">Todas completadas</div>';
            }
            return;
        }

        var act = pendientes[0];
        var tipoColors = {
            'llamada': '#007AFF', 'correo': '#FF9500',
            'reunion': '#92400E', 'tarea': '#34C759', 'otro': '#8E8E93'
        };
        var color = tipoColors[act.tipo] || '#8E8E93';
        // Título compacto = nombre del prospecto (mismo criterio que el
        // header del modal de actividad). La descripción larga vive en
        // el modal, no aquí — antes desbordaba el layout cuando la
        // acción era de más de 1-2 líneas.
        var prospData = window._currentProspectoData;
        var titulo = (prospData && prospData.nombre) ? prospData.nombre : 'Actividad';

        body.innerHTML =
            '<div style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0;"></div>' +
            '<div style="flex:1;min-width:0;overflow:hidden;">' +
                '<div style="font-size:0.8rem;font-weight:600;color:#1C1C1E;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(titulo) + '</div>' +
                '<div style="font-size:0.7rem;color:#86868B;display:flex;gap:6px;align-items:center;white-space:nowrap;">' +
                    '<span style="text-transform:uppercase;font-weight:600;color:' + color + ';font-size:0.65rem;">' + escapeHtml((act.tipo || '').toUpperCase()) + '</span>' +
                    '<span style="overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(act.fecha_programada || '') + '</span>' +
                '</div>' +
            '</div>';
        body.style.cursor = 'pointer';
        body.onclick = function() { _mostrarInfoActividad(act); };
    }

    function renderActividadesFullList(actividades) {
        var container = document.getElementById('wpActividadesFullList');
        if (!container) return;
        container.innerHTML = '';

        if (!actividades.length) {
            container.innerHTML = '<div style="padding:2rem;text-align:center;color:#C7C7CC;font-size:0.82rem;font-style:italic;">Sin actividades programadas</div>';
            return;
        }

        actividades.forEach(function(a) {
            var div = document.createElement('div');
            div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #F2F2F7;';
            var checkBg = a.completada ? '#34C759' : '#fff';
            var checkBorder = a.completada ? '#34C759' : '#D1D1D6';
            div.innerHTML =
                '<button onclick="toggleActividadProspecto(' + a.id + ')" style="width:20px;height:20px;border-radius:50%;border:2px solid ' + checkBorder + ';background:' + checkBg + ';cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;">' +
                    (a.completada ? '<svg width="10" height="10" fill="#fff" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>' : '') +
                '</button>' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="display:flex;gap:6px;align-items:center;">' +
                        '<span style="font-size:0.65rem;padding:2px 8px;border-radius:9999px;background:#F2F2F7;color:#86868B;font-weight:600;text-transform:uppercase;">' + escapeHtml((a.tipo || '').toUpperCase()) + '</span>' +
                        '<span style="font-size:0.72rem;color:#86868B;">' + escapeHtml(a.fecha_programada || '') + '</span>' +
                    '</div>' +
                    '<p style="margin:3px 0 0;font-size:0.82rem;color:#1C1C1E;' + (a.completada ? 'text-decoration:line-through;opacity:0.5;' : '') + '">' + escapeHtml(a.descripcion) + '</p>' +
                '</div>';
            container.appendChild(div);
        });
    }

    window.toggleActividadProspecto = function(actividadId) {
        fetch('/app/api/prospecto-actividad/' + actividadId + '/toggle/', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrf() }
        }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.success && window._currentProspectoId) {
                cargarActividadesProspecto(window._currentProspectoId);
            }
        });
    };

    // Open activities panel
    window.wpAbrirPanelActividades = function() {
        var panel = document.getElementById('widgetProspectoActividades');
        if (panel) {
            panel.style.display = '';
            panel.classList.add('active');
            // Auto-rellenar fecha de hoy y hora actual
            var now = new Date();
            var pad = function(n) { return n < 10 ? '0' + n : n; };
            var fechaEl = document.getElementById('wpActFechaDate');
            var hiEl = document.getElementById('wpActHoraInicio');
            var hfEl = document.getElementById('wpActHoraFin');
            if (fechaEl && !fechaEl.value) {
                fechaEl.value = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
            }
            if (hiEl && hiEl.value === '09:00') {
                hiEl.value = pad(now.getHours()) + ':' + pad(now.getMinutes());
            }
            if (hfEl && hfEl.value === '10:00') {
                var fin = new Date(now.getTime() + 3600000);
                hfEl.value = pad(fin.getHours()) + ':' + pad(fin.getMinutes());
            }
        }
    };

    // Nueva actividad button — open the prospection activities panel
    document.addEventListener('click', function(e) {
        if (e.target.id === 'wpBtnNuevaActividad' || e.target.closest('#wpBtnNuevaActividad')) {
            wpAbrirPanelActividades();
        }
    });

    // Agregar actividad (formulario nuevo con fecha + hora separados)
    document.addEventListener('click', function(e) {
        if (e.target.id === 'wpBtnAgregarActividad' || e.target.closest('#wpBtnAgregarActividad')) {
            // Validación reactiva (marca campos vacíos en rojo + shake; sin alerts)
            if (typeof window.wactValidate === 'function' && !window.wactValidate('wp')) return;

            var tipo = document.getElementById('wpActTipo').value;
            var desc = document.getElementById('wpActDescripcion').value.trim();
            var fechaDate = document.getElementById('wpActFechaDate').value;
            var horaInicio = document.getElementById('wpActHoraInicio').value;
            var horaFin = document.getElementById('wpActHoraFin').value;

            if (horaInicio >= horaFin) { showToast('La hora de fin debe ser posterior a la de inicio', 'error'); return; }
            if (!window._currentProspectoId) return;

            var fechaProgramada = fechaDate + 'T' + horaInicio + ':00';

            fetch('/app/api/prospecto/' + window._currentProspectoId + '/actividades/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                body: JSON.stringify({ tipo: tipo, descripcion: desc, fecha_programada: fechaProgramada, desc_extra: (document.getElementById('wpActDescExtra') || {}).value || '' })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success) {
                    document.getElementById('wpActDescripcion').value = '';
                    document.getElementById('wpActFechaDate').value = '';
                    cargarActividadesProspecto(window._currentProspectoId);
                    // Refrescar calendario inmediatamente
                    if (typeof calGlobalRefetch === 'function') calGlobalRefetch();
                    // Limpiar persistencia (ya tiene actividad nueva)
                    localStorage.removeItem('_pendienteProspectoSinActividad');
                    // Cerrar panel
                    var panel = document.getElementById('widgetProspectoActividades');
                    if (panel) { panel.style.display = 'none'; panel.classList.remove('active'); }
                    // Toast
                    var toast = document.createElement('div');
                    toast.textContent = 'Actividad agendada correctamente';
                    toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#1D1D1F;color:#fff;padding:10px 24px;border-radius:10px;font-size:0.85rem;z-index:99999;';
                    document.body.appendChild(toast);
                    setTimeout(function() { toast.remove(); }, 3000);
                } else {
                    alert(data.error || 'Error al crear actividad');
                }
            }).catch(function() { alert('Error de conexion'); });
        }
    });

    // ── Mostrar info de actividad (en vez de abrir formulario) ──
    function _mostrarInfoActividad(act) {
        var existing = document.getElementById('wpActInfoOverlay');
        if (existing) existing.remove();

        var prospData = window._currentProspectoData;
        var prospectoNombre = prospData ? (prospData.nombre || '') : '';

        var overlay = document.createElement('div');
        overlay.id = 'wpActInfoOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:10400;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML =
            '<div style="background:#fff;border-radius:16px;width:480px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,0.25);overflow:hidden;">' +
                // Header morado — TÍTULO = nombre del prospecto.
                // La descripcion (la acción concreta) va en el body.
                '<div style="background:linear-gradient(135deg,#B45309,#78350F);padding:1.5rem;position:relative;">' +
                    '<button onclick="document.getElementById(\'wpActInfoOverlay\').remove()" style="position:absolute;top:12px;right:14px;background:rgba(255,255,255,0.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">&times;</button>' +
                    '<div style="width:40px;height:40px;background:rgba(255,255,255,0.2);border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;">' +
                        '<svg width="20" height="20" fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' +
                    '</div>' +
                    '<div style="font-size:1.15rem;font-weight:700;color:#fff;margin-bottom:4px;">' + escapeHtml(prospectoNombre || 'Actividad') + '</div>' +
                    '<div style="font-size:0.82rem;color:rgba(255,255,255,0.8);">' + escapeHtml(act.fecha_programada || '') + '</div>' +
                '</div>' +
                // Body
                '<div style="padding:1.5rem;">' +
                    // Descripcion (si tiene)
                    '<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:12px 14px;margin-bottom:16px;">' +
                        '<div style="font-size:0.7rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;margin-bottom:4px;">Descripcion</div>' +
                        '<div style="font-size:0.88rem;color:#1D1D1F;">' + escapeHtml(act.descripcion) + '</div>' +
                    '</div>' +
                    // Creador + Estado
                    '<div style="display:flex;gap:2rem;margin-bottom:16px;">' +
                        '<div>' +
                            '<div style="font-size:0.7rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;margin-bottom:3px;">Creador</div>' +
                            '<div style="font-size:0.88rem;font-weight:500;color:#1D1D1F;">' + escapeHtml(act.usuario || '—') + '</div>' +
                        '</div>' +
                        '<div>' +
                            '<div style="font-size:0.7rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;margin-bottom:3px;">Estado</div>' +
                            (act.completada
                                ? '<span style="font-size:0.82rem;font-weight:600;color:#34C759;">Completada</span>'
                                : '<span style="font-size:0.82rem;font-weight:600;color:#FF9500;">Pendiente</span>') +
                        '</div>' +
                    '</div>' +
                    // Relacionado a
                    '<div style="border-top:1px dashed #E5E7EB;padding-top:14px;">' +
                        '<div style="font-size:0.7rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;margin-bottom:6px;">Relacionado a</div>' +
                        '<div onclick="document.getElementById(\'wpActInfoOverlay\').remove();" style="display:inline-flex;align-items:center;gap:6px;background:#FAF0E0;color:#78350F;padding:8px 16px;border-radius:8px;font-size:0.85rem;font-weight:600;cursor:pointer;" onmouseover="this.style.background=\'#FAF6F0\'" onmouseout="this.style.background=\'#FAF0E0\'">' +
                            '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>' +
                            'Prospecto: ' + escapeHtml(prospectoNombre) + ' &rsaquo;' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                // Footer
                '<div style="padding:1rem 1.5rem;border-top:1px solid #E5E7EB;background:#F9FAFB;display:flex;justify-content:center;gap:12px;border-radius:0 0 16px 16px;">' +
                    (act.completada
                        ? '<span style="padding:0.6rem 2rem;background:#E5E7EB;color:#9CA3AF;border-radius:8px;font-weight:600;font-size:0.9rem;">Ya completada</span>'
                        : '<button onclick="_wpCompletarActividad(' + act.id + ')" style="padding:0.6rem 2rem;background:#34C759;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Completar</button>') +
                    '<button onclick="document.getElementById(\'wpActInfoOverlay\').remove()" style="padding:0.6rem 2rem;background:#B45309;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Cerrar</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    }

    // ── Completar actividad prospecto ──
    window._wpCompletarActividad = function(actividadId) {
        fetch('/app/api/prospecto-actividad/' + actividadId + '/toggle/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
        }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.success) {
                var overlay = document.getElementById('wpActInfoOverlay');
                if (overlay) overlay.remove();
                if (window._currentProspectoId) cargarActividadesProspecto(window._currentProspectoId);
                // También refrescar calendario si está abierto
                if (typeof calGlobalRefetch === 'function') calGlobalRefetch();
                var toast = document.createElement('div');
                toast.textContent = 'Actividad completada';
                toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#34C759;color:#fff;padding:10px 24px;border-radius:10px;font-size:0.85rem;z-index:99999;font-weight:600;';
                document.body.appendChild(toast);
                setTimeout(function() { toast.remove(); }, 3000);
            }
        });
    };

    // ── Participantes de actividad prospecto ──
    var _wpParticipantesSel = [];

    window.wpSearchParticipantes = function(query) {
        var dropdown = document.getElementById('wpActParticipantesDropdown');
        if (!dropdown) return;
        if (!query || query.length < 2) { dropdown.style.display = 'none'; return; }

        fetch('/app/api/admin/usuarios/').then(function(r) { return r.json(); }).then(function(data) {
            var users = (data.usuarios || []).filter(function(u) {
                var name = ((u.first_name || '') + ' ' + (u.last_name || '') + ' ' + (u.username || '')).toLowerCase();
                var alreadySel = _wpParticipantesSel.some(function(s) { return s.id === u.id; });
                return name.includes(query.toLowerCase()) && !alreadySel;
            });
            if (users.length === 0) { dropdown.style.display = 'none'; return; }
            dropdown.innerHTML = users.slice(0, 8).map(function(u) {
                var name = ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || u.username;
                return '<div onclick="wpAddParticipante(' + u.id + ',\'' + name.replace(/'/g, "\\'") + '\')" style="padding:8px 12px;cursor:pointer;font-size:0.85rem;border-bottom:1px solid #F3F4F6;" onmouseover="this.style.background=\'#F3F4F6\'" onmouseout="this.style.background=\'#fff\'">' + name + '</div>';
            }).join('');
            dropdown.style.display = '';
        });
    };

    window.wpAddParticipante = function(id, name) {
        if (_wpParticipantesSel.some(function(s) { return s.id === id; })) return;
        _wpParticipantesSel.push({ id: id, name: name });
        _wpRenderParticipantes();
        document.getElementById('wpActParticipantesSearch').value = '';
        document.getElementById('wpActParticipantesDropdown').style.display = 'none';
    };

    window.wpRemoveParticipante = function(id) {
        _wpParticipantesSel = _wpParticipantesSel.filter(function(s) { return s.id !== id; });
        _wpRenderParticipantes();
    };

    function _wpRenderParticipantes() {
        var container = document.getElementById('wpActParticipantesContainer');
        if (!container) return;
        container.innerHTML = _wpParticipantesSel.map(function(p) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;background:#DBEAFE;color:#1E40AF;padding:3px 8px;border-radius:6px;font-size:0.75rem;font-weight:500;">' +
                p.name + '<span onclick="event.stopPropagation();wpRemoveParticipante(' + p.id + ')" style="cursor:pointer;font-size:0.85rem;color:#6B7280;">&times;</span></span>';
        }).join('');
    }

    // ── Correos vinculados ──
    // Reemplaza la antigua sección de Cotizaciones del widget.
    // Lista los MailCorreo (enviados/recibidos) vinculados al prospecto.
    // Click en una card → window.woCorreoVerDetalle (definido en
    // _widget_oportunidad.html — solo carga el correo por id, sirve igual).
    function cargarCorreosProspecto(prospectoId, prospData) {
        var container = document.getElementById('wpCorreosList');
        if (!container) return;

        container.innerHTML = '<div class="wo-empty" style="padding:1rem;font-size:0.8rem;color:#86868B;">Cargando correos…</div>';

        fetch('/app/api/prospecto/' + prospectoId + '/correos/', {
            credentials: 'same-origin'
        })
        .then(function(r) { return r.json(); })
        .then(function(res) {
            if (!res || !res.success) {
                container.innerHTML = '<div class="wo-empty" style="padding:1rem;font-size:0.8rem;">No se pudo cargar la lista de correos</div>';
                return;
            }
            var correos = res.correos || [];
            if (!correos.length) {
                container.innerHTML = '<div class="wo-empty" style="padding:1rem;font-size:0.8rem;">Sin correos vinculados aún</div>';
                return;
            }
            container.innerHTML = correos.map(function(c) {
                var enviado = c.sentido === 'enviado';
                var accentBg = enviado ? '#EFF6FF' : '#F4F4F5';
                var accentBorder = enviado ? '#DBEAFE' : '#E5E7EB';
                var badgeText = enviado ? 'Enviado' : 'Recibido';
                var badgeColor = enviado ? '#1E40AF' : '#52525B';
                var attTag = c.tiene_adjuntos
                    ? '<span style="display:inline-block;margin-left:6px;font-size:0.62rem;color:#92400E;background:#FEF3C7;padding:1px 6px;border-radius:9999px;font-weight:600;">ADJ</span>'
                    : '';
                return ''
                    + '<div onclick="if(typeof window.woCorreoVerDetalle===\'function\')window.woCorreoVerDetalle(' + c.id + ');" '
                    +      'style="cursor:pointer;background:' + accentBg + ';border:1px solid ' + accentBorder + ';border-radius:10px;padding:9px 11px;transition:transform 0.15s,box-shadow 0.15s;" '
                    +      'onmouseover="this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 4px 12px -4px rgba(0,0,0,0.15)\'" '
                    +      'onmouseout="this.style.transform=\'translateY(0)\';this.style.boxShadow=\'none\'">'
                    +   '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:3px;">'
                    +     '<span style="font-size:0.62rem;font-weight:700;color:' + badgeColor + ';letter-spacing:0.04em;text-transform:uppercase;">' + badgeText + attTag + '</span>'
                    +     '<span style="font-size:0.68rem;color:#86868B;">' + escapeHtml(c.fecha) + '</span>'
                    +   '</div>'
                    +   '<div style="font-size:0.82rem;font-weight:600;color:#1C1C1E;margin-bottom:2px;line-height:1.25;">' + escapeHtml(c.asunto || '(Sin asunto)') + '</div>'
                    +   (c.snippet ? '<div style="font-size:0.72rem;color:#3C3C43;line-height:1.3;">' + escapeHtml(c.snippet) + '</div>' : '')
                    + '</div>';
            }).join('');
        })
        .catch(function() {
            container.innerHTML = '<div class="wo-empty" style="padding:1rem;font-size:0.8rem;">Error al cargar correos</div>';
        });
    }
    window.cargarCorreosProspecto = cargarCorreosProspecto;

    // ── Composer de correo con contexto del prospecto ──
    // Análogo a woConvAbrirCorreoComposer (oportunidades): abre el widget
    // Mail en modo "Redactar" y deja marcado window._mailCorreoContextoProspectoId
    // para que el envío vincule el correo al prospecto vía FormData.
    function wpAbrirComposerConPrellenado(correo) {
        correo = correo || {};
        var prospData = window._currentProspectoData || {};
        var prospectoId = window._currentProspectoId || prospData.id;
        if (!prospectoId) return;

        // Marcamos el contexto antes de abrir Mail.
        window._mailCorreoContextoProspectoId = prospectoId;
        window._mailCorreoContextoProspectoNombre = prospData.nombre || '';

        if (typeof window.mailAbrir !== 'function') return;
        window.mailAbrir();
        // Subir el z-index para que quede encima del widget de prospecto.
        var mailWidget = document.getElementById('widgetMail');
        if (mailWidget) mailWidget.style.zIndex = '11000';

        setTimeout(function() {
            if (typeof window.mailRedactar === 'function') window.mailRedactar();
            setTimeout(function() {
                var paraEl = document.getElementById('mailCompPara');
                var asuntoEl = document.getElementById('mailCompAsunto');
                var editorEl = document.getElementById('mailCompEditor');
                var prefillTo = correo.destinatario_email || prospData.cliente_email || (prospData.contacto_email || '');
                if (paraEl && prefillTo) paraEl.value = prefillTo;
                if (asuntoEl) {
                    if (correo.asunto) asuntoEl.value = correo.asunto;
                    else if (!asuntoEl.value) asuntoEl.value = prospData.nombre || '';
                }
                if (editorEl) {
                    if (correo.cuerpo) {
                        // Convertimos saltos de línea simples a <br> para preservar
                        // el formato del cuerpo redactado por el AI.
                        editorEl.innerHTML = String(correo.cuerpo)
                            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                            .replace(/\n/g, '<br>');
                    }
                    editorEl.focus();
                }
            }, 120);
        }, 220);
    }
    window.wpAbrirComposerConPrellenado = wpAbrirComposerConPrellenado;

    // Botón "Nuevo correo" — atajo que dispara la AI DIRECTAMENTE y
    // abre el composer con todo redactado. NO abre el chat del AI.
    // Bajo el cofre: llamamos al endpoint /redactar-correo-directo/
    // que internamente ejecuta 1 sola llamada al LLM con la tool de
    // redacción y devuelve el payload listo.
    document.addEventListener('click', function(e) {
        var btn = e.target.closest && e.target.closest('#wpNuevoCorreo');
        if (!btn && e.target.id !== 'wpNuevoCorreo') return;
        var pid = window._currentProspectoId;
        if (!pid) return;
        // Feedback visual: deshabilita el botón mientras la AI redacta.
        var origLabel = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = '0.6';
            btn.innerHTML = '<span style="font-size:0.75rem;">Redactando…</span>';
        }
        fetch('/app/api/prospectos/' + pid + '/asistente/redactar-correo-directo/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
            body: JSON.stringify({}),
        }).then(function(r) { return r.json(); }).then(function(data) {
            if (btn) {
                btn.disabled = false;
                btn.style.opacity = '';
                btn.innerHTML = origLabel;
            }
            if (!data || !data.ok) {
                // Fallback: abrir composer en blanco para que el user redacte solo.
                var prospData = window._currentProspectoData || {};
                wpAbrirComposerConPrellenado({
                    asunto: '',
                    cuerpo: '',
                    destinatario_email: prospData.cliente_email || prospData.contacto_email || '',
                });
                return;
            }
            wpAbrirComposerConPrellenado(data.correo_preparado || {});
        }).catch(function() {
            if (btn) {
                btn.disabled = false;
                btn.style.opacity = '';
                btn.innerHTML = origLabel;
            }
            var prospData = window._currentProspectoData || {};
            wpAbrirComposerConPrellenado({
                asunto: '',
                cuerpo: '',
                destinatario_email: prospData.cliente_email || prospData.contacto_email || '',
            });
        });
    });

    // Nota: el flujo de cotización para prospectos (botón antiguo wpNuevaCot)
    // se removió del template. La conversión a oportunidad se sigue ofreciendo
    // desde el pipeline; el handler de abajo queda como referencia histórica
    // por si en el futuro queremos volver a exponer "Convertir y cotizar"
    // desde el widget. El listener no hace nada porque #wpNuevaCot ya no
    // existe en el DOM.
    document.addEventListener('click', function(e) {
        if (e.target.id === 'wpNuevaCot' || e.target.closest('#wpNuevaCot')) {
            var data = window._currentProspectoData;
            if (!data) return;

            // If already converted, go straight to cotizador
            if (data.oportunidad_creada_id) {
                abrirCotizadorConOpp(data.oportunidad_creada_id, data.cliente_id);
                return;
            }

            // Show confirmation dialog
            var html = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10500;display:flex;align-items:center;justify-content:center;" id="wpConvertirDialog">' +
                '<div style="background:#fff;border-radius:16px;padding:28px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
                '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">' +
                    '<div style="width:40px;height:40px;border-radius:10px;background:#FF950022;display:flex;align-items:center;justify-content:center;">' +
                        '<svg width="20" height="20" fill="none" stroke="#FF9500" stroke-width="2" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' +
                    '</div>' +
                    '<div>' +
                        '<h3 style="margin:0;font-size:15px;font-weight:700;color:#1C1C1E;">Convertir a Oportunidad</h3>' +
                        '<p style="margin:2px 0 0;font-size:12px;color:#86868B;">Para cotizar, este prospecto se convertira en oportunidad</p>' +
                    '</div>' +
                '</div>' +
                '<div style="background:#F9FAFB;border-radius:10px;padding:12px 14px;margin-bottom:16px;font-size:12px;color:#3C3C43;">' +
                    '<strong>' + escapeHtml(data.nombre) + '</strong> pasara a la tabla de Oportunidades como <strong>' + (data.tipo_pipeline === 'proyecto' ? 'Proyecto' : 'Runrate') + '</strong>. Los comentarios se migraran a la conversacion.' +
                '</div>' +
                '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
                    '<button onclick="document.getElementById(\'wpConvertirDialog\').remove()" style="padding:10px 18px;border:none;background:#F2F2F7;border-radius:8px;color:#86868B;font-size:13px;cursor:pointer;">Cancelar</button>' +
                    '<button id="wpConfirmarConvertir" style="padding:10px 20px;border:none;background:#0052D4;border-radius:8px;color:#fff;font-weight:700;font-size:13px;cursor:pointer;">Convertir y Cotizar</button>' +
                '</div>' +
                '</div></div>';
            document.body.insertAdjacentHTML('beforeend', html);

            document.getElementById('wpConfirmarConvertir').addEventListener('click', function() {
                var btn = this;
                btn.disabled = true;
                btn.textContent = 'Convirtiendo...';

                fetch('/app/api/prospecto/' + data.id + '/convertir/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                    body: '{}'
                }).then(function(r) { return r.json(); }).then(function(res) {
                    document.getElementById('wpConvertirDialog').remove();
                    if (res.success) {
                        // Update local data
                        window._currentProspectoData.oportunidad_creada_id = res.oportunidad_id;
                        // Reload tables
                        cargarClientesProspeccion();
                        if (_currentWidgetClienteId) {
                            cargarProspectosDeCliente(_currentWidgetClienteId);
                        }
                        // Close prospecto widget
                        var w = document.getElementById('widgetProspecto');
                        if (w) w.classList.remove('active');
                        // Open cotizador with oportunidad pre-selected
                        abrirCotizadorConOpp(res.oportunidad_id, res.cliente_id);
                        // Toast
                        var toast = document.getElementById('widgetToast');
                        if (toast) {
                            toast.textContent = 'Prospecto convertido a oportunidad #' + res.oportunidad_id;
                            toast.classList.add('show');
                            setTimeout(function() { toast.classList.remove('show'); }, 3000);
                        }
                    }
                });
            });
        }
    });

    function abrirCotizadorConOpp(oppId, clienteId) {
        var cotizadorOverlay = document.getElementById('widgetCotizador');
        var cotizadorIframe = document.getElementById('cotizadorIframe');
        if (cotizadorOverlay && cotizadorIframe) {
            cotizadorOverlay.classList.add('active');
            cotizadorOverlay.classList.remove('closing');
            cotizadorIframe.src = '/app/crear-cotizacion/oportunidad/' + oppId + '/?widget_mode=1';
        } else {
            window.open('/app/crear-cotizacion/oportunidad/' + oppId + '/', '_blank');
        }
    }

    // ── Close prospecto detail widget ──
    document.addEventListener('click', function(e) {
        if (e.target.id === 'prospectoClose') {
            _intentarCerrarProspecto();
        }
    });

    function _intentarCerrarProspecto() {
        var id = window._currentProspectoId;
        if (!id) {
            var w = document.getElementById('widgetProspecto');
            if (w) w.classList.remove('active');
            return;
        }
        // Si el prospecto ya está cerrado (ganado/perdido), cerrar el widget
        // sin pedir actividad — no aplica para prospectos cerrados.
        if (_isProspectoCerrado(window._currentProspectoData)) {
            var w0 = document.getElementById('widgetProspecto');
            if (w0) w0.classList.remove('active');
            localStorage.removeItem('_pendienteProspectoSinActividad');
            return;
        }
        // Verificar si tiene actividades antes de cerrar
        fetch('/app/api/prospecto/' + id + '/actividades/')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var acts = data.actividades || [];
                var pendientes = acts.filter(function(a) { return !a.completada; });
                if (pendientes.length > 0) {
                    // Tiene actividades pendientes, puede cerrar
                    var w = document.getElementById('widgetProspecto');
                    if (w) w.classList.remove('active');
                    localStorage.removeItem('_pendienteProspectoSinActividad');
                } else {
                    // No tiene actividades pendientes, debe agendar una nueva
                    _showProspectoMissingActivityWarning();
                }
            })
            .catch(function() {
                // Si falla, dejar cerrar
                var w = document.getElementById('widgetProspecto');
                if (w) w.classList.remove('active');
            });
    }

    // Close on overlay click
    var overlay = document.getElementById('widgetProspecto');
    if (overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                _intentarCerrarProspecto();
            }
        });
    }

    // Close on Escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            // Close activities panel first if open
            var actPanel = document.getElementById('widgetProspectoActividades');
            if (actPanel && (actPanel.style.display !== 'none' && actPanel.classList.contains('active'))) {
                actPanel.style.display = 'none';
                actPanel.classList.remove('active');
                return;
            }
            // Close prospecto detail widget
            var w = document.getElementById('widgetProspecto');
            if (w && w.classList.contains('active')) {
                _intentarCerrarProspecto();
                return;
            }
            // Close client widget
            var wc = document.getElementById('widgetClienteProspectos');
            if (wc && wc.classList.contains('active')) {
                wc.classList.remove('active');
            }
        }
    });

})();
