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

    // ── Abrir widget nuevo prospecto (top bar button) ──
    var btnNuevo = document.getElementById('btnNuevoProspecto');
    if (btnNuevo) {
        btnNuevo.addEventListener('click', function() {
            document.getElementById('widgetNuevoProspecto').classList.add('active');
        });
    }

    // ══════════════════════════════════════════════════════════════
    // A. MAIN TABLE: Load clients with prospecto counts
    // ══════════════════════════════════════════════════════════════
    function cargarClientesProspeccion() {
        var tbody = document.getElementById('prospeccionTbody');
        if (!tbody) return;

        var params = new URLSearchParams(window.location.search);
        var mes = params.get('mes') || '';
        var anio = params.get('anio') || '';
        var vendedores = params.get('vendedores') || '';

        fetch('/app/api/prospeccion/clientes/?mes=' + mes + '&anio=' + anio + '&vendedores=' + vendedores)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.rows) return;
                tbody.innerHTML = '';

                var prodKeys = ['zebra', 'panduit', 'apc', 'avigilon', 'genetec', 'axis', 'software', 'runrate', 'poliza', 'otros'];
                var prodLabels = ['Zebra', 'Panduit', 'APC', 'Avig.', 'Genet.', 'Axis', 'Soft.', 'RR', 'Pol.', 'Otros'];

                // Build thead from JS to guarantee alignment with data cells
                var thead = document.getElementById('prospeccionThead');
                if (thead) {
                    var hStyle = 'text-align:right;padding:12px 8px;font-size:9px;font-weight:900;color:#3B82F6;text-transform:uppercase;letter-spacing:0.1em;';
                    var hRow = '<tr style="border-bottom:1px solid #E5E7EB;background:rgba(249,250,251,0.8);">';
                    hRow += '<td style="text-align:left;padding:12px 8px;font-size:9px;font-weight:900;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.1em;width:120px;min-width:120px;max-width:120px;">Cliente</td>';
                    prodLabels.forEach(function(l){ hRow += '<td style="' + hStyle + '">' + l + '</td>'; });
                    hRow += '</tr>';
                    thead.innerHTML = hRow;
                }

                data.rows.forEach(function(row) {
                    var tr = document.createElement('tr');
                    tr.className = 'crm-data-row';
                    tr.dataset.clienteId = row.cliente_id;

                    // Product key to PRODUCTO_CHOICES value mapping
                    var prodChoicesMap = {
                        'zebra': 'ZEBRA', 'panduit': 'PANDUIT', 'apc': 'APC',
                        'avigilon': 'AVIGILION', 'genetec': 'GENETEC', 'axis': 'AXIS',
                        'software': 'SOFTWARE', 'runrate': 'RUNRATE', 'poliza': 'POLIZA', 'otros': ''
                    };

                    // Client name cell — use inline onclick
                    var clienteOnclick = 'onclick="window._prospeccionClickCliente(' + row.cliente_id + ',\'' + escapeHtml(row.cliente).replace(/'/g, "\\'") + '\',\'' + escapeHtml(row.rfc).replace(/'/g, "\\'") + '\')"';
                    var html = '<td style="padding:16px 8px;width:120px;min-width:120px;max-width:120px;">' +
                        '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
                        '<span style="cursor:pointer;color:#1C1C1E;font-weight:600;font-size:11px;" ' + clienteOnclick + '>' +
                            escapeHtml(row.cliente) +
                        '</span></div>';
                    if (row.rfc) {
                        html += '<div style="font-size:9px;color:#86868B;font-weight:500;text-transform:uppercase;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">RFC: ' + escapeHtml(row.rfc) + '</div>';
                    }
                    html += '</td>';

                    // Product columns — use inline onclick for maximum compatibility
                    prodKeys.forEach(function(key) {
                        var val = row[key] || 0;
                        var prodValue = prodChoicesMap[key] || '';
                        var onclickCode = prodValue
                            ? 'onclick="console.log(\'[PROSPECCION] ONCLICK producto\');window._prospeccionClickProducto(' + row.cliente_id + ',\'' + escapeHtml(row.cliente).replace(/'/g, "\\'") + '\',\'' + prodValue + '\')"'
                            : '';
                        var cursorStyle = prodValue ? 'cursor:pointer;' : '';
                        if (val === 0) {
                            html += '<td style="text-align:right;padding:16px 8px;' + cursorStyle + '" ' + onclickCode + '><span style="color:#D1D5DB;">0</span></td>';
                        } else {
                            html += '<td style="text-align:right;padding:16px 8px;' + cursorStyle + '" ' + onclickCode + '><span style="color:#2563EB;font-weight:700;">' + val + '</span></td>';
                        }
                    });

                    tr.innerHTML = html;
                    tbody.appendChild(tr);
                });

                // Footer
                var footer = document.getElementById('prospeccionFooter');
                if (footer && data.footer) {
                    footer.innerHTML = '<span style="font-size:11px;color:#86868B;">' + (data.footer.left || '') + '</span><span style="font-size:11px;font-weight:600;color:#1C1C1E;">' + (data.footer.right || '') + '</span>';
                    footer.style.display = 'flex';
                    footer.style.justifyContent = 'space-between';
                    footer.style.padding = '8px 12px';
                }


                console.log('[PROSPECCION] Tabla cargada con', data.rows.length, 'clientes');
            });
    }

    // ── Global event delegation for ALL clicks in prospeccion table ──
    // Using document-level delegation — works regardless of DOM timing
    document.addEventListener('click', function(e) {
        // Only process if we're inside prospeccionTbody
        var tbody = e.target.closest('#prospeccionTbody');
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
        widget.classList.add('active');

        // Pre-fill client name and hidden ID
        var clienteInput = document.getElementById('wpfCliente');
        var clienteHiddenId = document.getElementById('wpfClienteId');
        if (clienteInput) {
            clienteInput.value = clienteNombre;
        }
        if (clienteHiddenId) {
            clienteHiddenId.value = clienteId;
        }
        // Store selected client id for the form's autocomplete logic
        window._wpfSelectedClienteId = clienteId;

        // Pre-fill product select
        var productoSelect = document.getElementById('wpfProducto');
        if (productoSelect) {
            productoSelect.value = producto;
        }

        // Store context so after creation we open the client widget + prospecto detail
        window._prospeccionProductoContext = {
            clienteId: clienteId,
            clienteNombre: clienteNombre,
            producto: producto
        };
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
                    'reunion': '#5856D6',
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
                        ? '<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;color:#5856D6;"><span>P</span><svg width="10" height="10" fill="#5856D6" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>'
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

    function renderProspectoDetalle(data) {
        // Store current prospecto
        window._currentProspectoId = data.id;
        window._currentProspectoData = data;

        document.getElementById('wpTitle').textContent = data.nombre || '';
        document.getElementById('wpCliente').textContent = data.cliente || '-';
        document.getElementById('wpContacto').textContent = data.contacto || '-';
        document.getElementById('wpProducto').textContent = data.producto || '-';
        document.getElementById('wpArea').textContent = data.area || '-';

        // Tipo Pipeline badge
        var tipoPipEl = document.getElementById('wpTipoPipeline');
        if (tipoPipEl) {
            if (data.tipo_pipeline === 'proyecto') {
                tipoPipEl.innerHTML = '<span style="display:inline-block;padding:2px 10px;border-radius:9999px;background:#5856D622;color:#5856D6;font-size:0.78rem;font-weight:600;">Proyecto</span>';
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

        // Cotizaciones
        cargarCotizacionesProspecto(data);

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
            '<button onclick="confirmarReunion(\'virtual\')" style="flex:1;padding:12px;border:2px solid #5856D6;border-radius:10px;background:#5856D622;color:#5856D6;font-weight:700;font-size:13px;cursor:pointer;">Virtual</button>' +
            '<button onclick="confirmarReunion(\'presencial\')" style="flex:1;padding:12px;border:2px solid #5856D6;border-radius:10px;background:#5856D622;color:#5856D6;font-weight:700;font-size:13px;cursor:pointer;">Presencial</button>' +
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
        cambiarEtapaProspecto(etapa);
    };

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
            '<button id="warnBtnAgendarProspecto" style="background:#8B5CF6;color:#fff;border:none;padding:0.7rem 1.5rem;border-radius:10px;font-weight:700;font-size:0.9rem;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:transform 0.15s;" onmouseenter="this.style.transform=\'scale(1.03)\'" onmouseleave="this.style.transform=\'none\'">' +
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
                    if (data.actividades && data.actividades.length > 0) {
                        _ejecutarCambioEtapa(id, nuevaEtapa, reunionTipo);
                    } else {
                        _showProspectoMissingActivityWarning();
                    }
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
                        '<div class="wp-chat-avatar" style="background:#5856D622;color:#5856D6;">' +
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
                    msg.innerHTML =
                        '<div class="wp-chat-avatar">' + getInitials(c.usuario) + '</div>' +
                        '<div class="wp-chat-bubble">' +
                            '<div class="wp-chat-meta">' +
                                '<span class="wp-chat-author">' + escapeHtml(c.usuario) + '</span>' +
                                '<span class="wp-chat-time">' + escapeHtml(c.fecha) + '</span>' +
                            '</div>' +
                            '<div class="wp-chat-text">' + escapeHtml(c.texto) + '</div>' +
                        '</div>';
                    container.appendChild(msg);
                });

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

        // Find the closest pending activity
        var pendientes = actividades.filter(function(a) { return !a.completada; });
        if (pendientes.length === 0) {
            if (actividades.length === 0) {
                body.innerHTML = '<div style="font-size:0.82rem;color:#9CA3AF;">Sin actividades</div>';
            } else {
                body.innerHTML = '<div style="font-size:0.82rem;color:#34C759;">Todas completadas</div>';
            }
            return;
        }

        var act = pendientes[0];
        var tipoColors = {
            'llamada': '#007AFF', 'correo': '#FF9500',
            'reunion': '#5856D6', 'tarea': '#34C759', 'otro': '#8E8E93'
        };
        var color = tipoColors[act.tipo] || '#8E8E93';

        body.innerHTML =
            '<div style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0;"></div>' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:0.8rem;font-weight:600;color:#1C1C1E;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(act.descripcion) + '</div>' +
                '<div style="font-size:0.7rem;color:#86868B;display:flex;gap:6px;align-items:center;">' +
                    '<span style="text-transform:uppercase;font-weight:600;color:' + color + ';font-size:0.65rem;">' + escapeHtml((act.tipo || '').toUpperCase()) + '</span>' +
                    '<span>' + escapeHtml(act.fecha_programada || '') + '</span>' +
                '</div>' +
            '</div>';
        body.style.cursor = 'pointer';
        body.onclick = function() { wpAbrirPanelActividades(); };
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
        }
    };

    // Nueva actividad button — open the prospection activities panel
    document.addEventListener('click', function(e) {
        if (e.target.id === 'wpBtnNuevaActividad' || e.target.closest('#wpBtnNuevaActividad')) {
            wpAbrirPanelActividades();
        }
    });

    // Agregar actividad
    document.addEventListener('click', function(e) {
        if (e.target.id === 'wpBtnAgregarActividad') {
            var tipo = document.getElementById('wpActTipo').value;
            var desc = document.getElementById('wpActDescripcion').value.trim();
            var fecha = document.getElementById('wpActFecha').value;
            if (!desc || !fecha || !window._currentProspectoId) return;

            fetch('/app/api/prospecto/' + window._currentProspectoId + '/actividades/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                body: JSON.stringify({ tipo: tipo, descripcion: desc, fecha_programada: fecha })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success) {
                    document.getElementById('wpActDescripcion').value = '';
                    document.getElementById('wpActFecha').value = '';
                    cargarActividadesProspecto(window._currentProspectoId);
                }
            });
        }
    });

    // ── Cotizaciones ──
    function cargarCotizacionesProspecto(data) {
        var container = document.getElementById('wpQuoteList');
        if (!container) return;

        // If the API returns cotizaciones, render them
        if (data.cotizaciones && data.cotizaciones.length) {
            container.innerHTML = '';
            data.cotizaciones.forEach(function(cot) {
                var card = document.createElement('div');
                card.className = 'wo-quote-card';
                card.innerHTML =
                    '<div class="wo-quote-left">' +
                        '<div class="wo-quote-badge">' + escapeHtml(cot.folio || 'COT') + '</div>' +
                    '</div>' +
                    '<div class="wo-quote-info">' +
                        '<div class="wo-quote-title">' + escapeHtml(cot.titulo || cot.folio || 'Cotizacion') + '</div>' +
                        '<div class="wo-quote-meta">' + escapeHtml(cot.fecha || '') + ' &middot; ' + escapeHtml(cot.estado || '') + '</div>' +
                    '</div>';
                container.appendChild(card);
            });
        } else {
            container.innerHTML = '<div class="wo-empty" style="padding:1rem;font-size:0.8rem;">Sin cotizaciones aun</div>';
        }
    }

    // Nueva cotizacion button — confirm conversion to oportunidad, then open cotizador
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
            var w = document.getElementById('widgetProspecto');
            if (w) w.classList.remove('active');
        }
    });

    // Close on overlay click
    var overlay = document.getElementById('widgetProspecto');
    if (overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                overlay.classList.remove('active');
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
                w.classList.remove('active');
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
