// crm_prospeccion.js — Modulo de Prospeccion CRM IAMET
(function() {
    'use strict';

    var csrf = function() { return document.querySelector('[name=csrfmiddlewaretoken]').value; };

    // ── Abrir widget nuevo prospecto ──
    var btnNuevo = document.getElementById('btnNuevoProspecto');
    if (btnNuevo) {
        btnNuevo.addEventListener('click', function() {
            document.getElementById('widgetNuevoProspecto').classList.add('active');
        });
    }

    // ── Cargar tabla de prospectos ──
    function cargarProspectos() {
        var tbody = document.getElementById('prospeccionTbody');
        if (!tbody) return;

        var params = new URLSearchParams(window.location.search);
        var mes = params.get('mes') || '';
        var anio = params.get('anio') || '';
        var vendedores = params.get('vendedores') || '';

        fetch('/app/api/prospectos/?mes=' + mes + '&anio=' + anio + '&vendedores=' + vendedores)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.rows) return;
                tbody.innerHTML = '';
                data.rows.forEach(function(row) {
                    var tr = document.createElement('tr');
                    tr.className = 'crm-data-row';
                    tr.dataset.prospectoId = row.id;

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

                    var pipelineIcon = row.tipo_pipeline === 'proyecto'
                        ? '<span style="color:#5856D6;font-weight:700;">P</span>'
                        : '<span style="color:#34C759;font-weight:700;">R</span>';

                    tr.innerHTML =
                        '<td class="px-2 py-4"><span class="prospecto-name-link" style="cursor:pointer;color:#1C1C1E;font-weight:600;" data-prospecto-id="' + row.id + '">' + escapeHtml(row.nombre) + '</span>' +
                        '<span class="text-[9px] text-gray-400 font-medium uppercase mt-1 block">' + escapeHtml(row.cliente) + '</span></td>' +
                        '<td class="px-2 py-4 text-gray-600">' + escapeHtml(row.contacto || '-') + '</td>' +
                        '<td class="px-2 py-4 text-gray-400 text-xs italic">' + escapeHtml(row.area || '-') + '</td>' +
                        '<td class="px-2 py-4 text-gray-600">' + escapeHtml(row.producto || '-') + '</td>' +
                        '<td class="px-2 py-4 text-center">' + pipelineIcon + '</td>' +
                        '<td class="px-2 py-4"><span style="background:' + (etapaColor[row.etapa] || '#8E8E93') + '22;color:' + (etapaColor[row.etapa] || '#8E8E93') + ';padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;">' + (etapaLabel[row.etapa] || row.etapa) + '</span></td>' +
                        '<td class="px-2 py-4 text-gray-400 text-xs">' + escapeHtml(row.fecha_iso || '') + '</td>' +
                        '<td class="px-2 py-4 text-center"><button class="btn-campana" data-prospecto-id="' + row.id + '" style="background:none;border:1px solid #FF9500;border-radius:6px;padding:3px 8px;cursor:pointer;color:#FF9500;font-size:11px;" title="Campana">&#128226;</button></td>';

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

                // Click handlers para abrir widget detalle
                tbody.querySelectorAll('.prospecto-name-link').forEach(function(el) {
                    el.addEventListener('click', function() {
                        abrirWidgetProspecto(parseInt(this.dataset.prospectoId));
                    });
                });
            });
    }

    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(text));
        return div.innerHTML;
    }

    // Cargar prospectos si estamos en el tab
    if (new URLSearchParams(window.location.search).get('tab') === 'prospeccion') {
        cargarProspectos();
    }

    // ── Widget detalle prospecto ──
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
        document.getElementById('wpTipoPipeline').textContent = data.tipo_pipeline === 'proyecto' ? 'Proyecto' : 'Runrate';
        document.getElementById('wpComentarioInicial').textContent = data.comentarios || '-';

        // Pipeline stages
        renderPipelineProspecto(data.etapa, data.reunion_tipo);

        // Comentarios
        cargarComentariosProspecto(data.id);

        // Actividades
        cargarActividadesProspecto(data.id);
    }

    function renderPipelineProspecto(etapaActual, reunionTipo) {
        var stages = [
            { key: 'identificado', label: 'Identificado', color: '#8E8E93' },
            { key: 'calificado', label: 'Calificado', color: '#007AFF' },
            { key: 'reunion', label: 'Reunion', color: '#5856D6' },
            { key: 'en_progreso', label: 'En Progreso', color: '#FF9500' },
            { key: 'procesado', label: 'Procesado', color: '#34C759' },
            { key: 'cerrar', label: 'Cerrar Prospecto', color: '#FF3B30' }
        ];

        var container = document.getElementById('wpPipelineStages');
        if (!container) return;
        container.innerHTML = '';

        var etapaIndex = -1;
        var stageKeys = stages.map(function(s) { return s.key; });

        // Map cerrado_ganado/cerrado_perdido to 'cerrar'
        var etapaMap = etapaActual;
        if (etapaActual === 'cerrado_ganado' || etapaActual === 'cerrado_perdido') {
            etapaMap = 'cerrar';
        }
        etapaIndex = stageKeys.indexOf(etapaMap);

        stages.forEach(function(stage, i) {
            var div = document.createElement('div');
            div.className = 'wo-stage';
            var isActive = (i <= etapaIndex);
            var isCurrent = (stageKeys[i] === etapaMap);

            div.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;padding:8px 12px;border-radius:8px;min-width:80px;transition:all 0.2s;' +
                (isActive ? 'background:' + stage.color + '18;' : '') +
                (isCurrent ? 'box-shadow:0 0 0 2px ' + stage.color + ';' : '');

            var dot = '<div style="width:10px;height:10px;border-radius:50%;background:' + (isActive ? stage.color : '#D1D1D6') + ';"></div>';
            var labelHtml = '<span style="font-size:9px;font-weight:600;color:' + (isActive ? stage.color : '#86868B') + ';white-space:nowrap;">' + stage.label + '</span>';

            if (stage.key === 'reunion' && etapaActual === 'reunion' && reunionTipo) {
                labelHtml += '<span style="font-size:8px;color:#5856D6;display:block;">(' + reunionTipo + ')</span>';
            }

            if (etapaActual === 'cerrado_ganado' && stage.key === 'cerrar') {
                labelHtml = '<span style="font-size:9px;font-weight:600;color:#30D158;white-space:nowrap;">Ganado</span>';
            } else if (etapaActual === 'cerrado_perdido' && stage.key === 'cerrar') {
                labelHtml = '<span style="font-size:9px;font-weight:600;color:#FF3B30;white-space:nowrap;">Perdido</span>';
            }

            div.innerHTML = dot + labelHtml;

            // Click handler
            div.addEventListener('click', function() {
                if (etapaActual === 'cerrado_ganado' || etapaActual === 'cerrado_perdido') return;

                if (stage.key === 'reunion') {
                    mostrarSelectorReunion();
                } else if (stage.key === 'cerrar') {
                    mostrarDialogCerrar();
                } else {
                    cambiarEtapaProspecto(stage.key);
                }
            });

            container.appendChild(div);

            // Connector line
            if (i < stages.length - 1) {
                var line = document.createElement('div');
                line.style.cssText = 'width:20px;height:2px;background:' + (i < etapaIndex ? stages[i+1].color : '#E5E5EA') + ';align-self:center;flex-shrink:0;';
                container.appendChild(line);
            }
        });
    }

    function mostrarSelectorReunion() {
        var html = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10200;display:flex;align-items:center;justify-content:center;" id="reunionSelector">' +
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
        var html = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10200;display:flex;align-items:center;justify-content:center;" id="cerrarSelector">' +
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

    function cambiarEtapaProspecto(nuevaEtapa, reunionTipo) {
        var id = window._currentProspectoId;
        if (!id) return;

        var body = { etapa: nuevaEtapa };
        if (reunionTipo) body.reunion_tipo = reunionTipo;

        fetch('/app/api/prospecto/' + id + '/etapa/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
            body: JSON.stringify(body)
        }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.success) {
                if (nuevaEtapa === 'cerrado_ganado' && data.oportunidad_id) {
                    // Mostrar mensaje de exito
                    var toast = document.getElementById('widgetToast');
                    if (toast) {
                        toast.textContent = 'Prospecto ganado! Oportunidad #' + data.oportunidad_id + ' creada.';
                        toast.classList.add('show');
                        setTimeout(function() { toast.classList.remove('show'); }, 3000);
                    }
                }
                // Recargar detalle
                abrirWidgetProspecto(id);
                // Recargar tabla
                cargarProspectos();
            }
        });
    }

    // ── Comentarios ──
    function cargarComentariosProspecto(id) {
        fetch('/app/api/prospecto/' + id + '/comentarios/')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var container = document.getElementById('wpComentariosList');
                if (!container) return;
                container.innerHTML = '';
                (data.comentarios || []).forEach(function(c) {
                    var div = document.createElement('div');
                    div.style.cssText = 'padding:10px 12px;border-bottom:1px solid #F2F2F7;';
                    div.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="font-size:11px;font-weight:700;color:#1C1C1E;">' + escapeHtml(c.usuario) + '</span><span style="font-size:10px;color:#86868B;">' + escapeHtml(c.fecha) + '</span></div>' +
                        '<p style="margin:0;font-size:12px;color:#3C3C43;line-height:1.4;">' + escapeHtml(c.texto) + '</p>';
                    container.appendChild(div);
                });
                if (!(data.comentarios || []).length) {
                    container.innerHTML = '<div style="padding:20px;text-align:center;color:#C7C7CC;font-size:11px;font-style:italic;">Sin comentarios aun</div>';
                }
            });
    }

    // Agregar comentario
    document.addEventListener('click', function(e) {
        if (e.target.id === 'wpBtnAgregarComentario') {
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
                    cargarComentariosProspecto(window._currentProspectoId);
                }
            });
        }
    });

    // ── Actividades Programadas ──
    function cargarActividadesProspecto(id) {
        fetch('/app/api/prospecto/' + id + '/actividades/')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var container = document.getElementById('wpActividadesList');
                if (!container) return;
                container.innerHTML = '';
                (data.actividades || []).forEach(function(a) {
                    var div = document.createElement('div');
                    div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #F2F2F7;';
                    var checkStyle = a.completada ? 'background:#34C759;border-color:#34C759;' : 'background:#fff;border-color:#D1D1D6;';
                    div.innerHTML =
                        '<button onclick="toggleActividadProspecto(' + a.id + ')" style="width:18px;height:18px;border-radius:50%;border:2px solid;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;' + checkStyle + '">' + (a.completada ? '<svg width="10" height="10" fill="#fff" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>' : '') + '</button>' +
                        '<div style="flex:1;min-width:0;">' +
                        '<div style="display:flex;gap:6px;align-items:center;">' +
                        '<span style="font-size:9px;padding:1px 6px;border-radius:4px;background:#F2F2F7;color:#86868B;font-weight:600;">' + escapeHtml((a.tipo || '').toUpperCase()) + '</span>' +
                        '<span style="font-size:10px;color:#86868B;">' + escapeHtml(a.fecha_programada || '') + '</span>' +
                        '</div>' +
                        '<p style="margin:2px 0 0;font-size:11px;color:#1C1C1E;' + (a.completada ? 'text-decoration:line-through;opacity:0.5;' : '') + '">' + escapeHtml(a.descripcion) + '</p>' +
                        '</div>';
                    container.appendChild(div);
                });
                if (!(data.actividades || []).length) {
                    container.innerHTML = '<div style="padding:20px;text-align:center;color:#C7C7CC;font-size:11px;font-style:italic;">Sin actividades programadas</div>';
                }
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

    // Expose for tab change
    window.cargarProspectos = cargarProspectos;

    // Close widget
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

})();
