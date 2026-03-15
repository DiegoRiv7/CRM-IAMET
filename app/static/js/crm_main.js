/* ── Utilidad CSRF global (disponible para todos los scripts) ── */
    if (typeof window.getCsrf === 'undefined') {
        window.getCsrf = function () {
            var v = document.cookie.match('(^|;)\\s*csrftoken\\s*=\\s*([^;]+)');
            return v ? v.pop() : '';
        };
    }

    /* ── Auto-cambio de mes en día 1 ── */
    (function () {
        var today = new Date();
        if (today.getDate() === 1) {
            var currentMes = String(today.getMonth() + 1).padStart(2, '0');
            var params = new URLSearchParams(window.location.search);
            var urlMes = params.get('mes');
            if (urlMes && urlMes !== 'todos' && urlMes !== currentMes) {
                params.set('mes', currentMes);
                window.location.replace(window.location.pathname + '?' + params.toString());
            }
        }
    })();

    /* ── Filtros mes/año/vendedor (script independiente) ── */
    document.addEventListener('DOMContentLoaded', function () {
        var mesFilter = document.getElementById('mesFilter');
        var anioFilter = document.getElementById('anioFilter');

        function applyFilter() {
            var params = new URLSearchParams(window.location.search);
            if (mesFilter) params.set('mes', mesFilter.value);
            if (anioFilter) params.set('anio', anioFilter.value);
            if (!params.get('tab')) params.set('tab', 'crm');
            // Preserve vendor filter
            var vfChecks = document.querySelectorAll('.vf-user:checked');
            var vfAllCheck = document.getElementById('vfAll');
            if (vfChecks.length > 0 && vfAllCheck && !vfAllCheck.checked) {
                var ids = [];
                vfChecks.forEach(function (c) { ids.push(c.value); });
                params.set('vendedores', ids.join(','));
            } else {
                params.delete('vendedores');
            }
            window.location.href = window.location.pathname + '?' + params.toString();
        }

        if (mesFilter) mesFilter.addEventListener('change', applyFilter);
        if (anioFilter) anioFilter.addEventListener('change', applyFilter);

        // Vendor filter dropdown
        var vfBtn = document.getElementById('vendorFilterBtn');
        var vfDrop = document.getElementById('vendorFilterDropdown');
        var vfAll = document.getElementById('vfAll');

        if (vfBtn && vfDrop) {
            vfBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                vfDrop.classList.toggle('show');
            });
            document.addEventListener('click', function (e) {
                if (!vfDrop.contains(e.target) && e.target !== vfBtn) {
                    vfDrop.classList.remove('show');
                }
            });
        }

        function updateVendorFilterLabel() {
            if (!vfBtn || !vfAll) return;
            if (vfAll.checked) { vfBtn.textContent = 'Todos \u25BE'; return; }
            var checked = document.querySelectorAll('.vf-user:checked');
            if (checked.length === 0) { vfAll.checked = true; vfBtn.textContent = 'Todos \u25BE'; }
            else if (checked.length === 1) { vfBtn.textContent = checked[0].parentElement.querySelector('span').textContent.trim() + ' \u25BE'; }
            else { vfBtn.textContent = checked.length + ' vendedores \u25BE'; }
        }

        if (vfAll) {
            vfAll.addEventListener('change', function () {
                document.querySelectorAll('.vf-user').forEach(function (c) { c.checked = false; });
                updateVendorFilterLabel();
                applyFilter();
            });
        }
        document.querySelectorAll('.vf-user').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var anyChecked = document.querySelectorAll('.vf-user:checked').length > 0;
                if (vfAll) vfAll.checked = !anyChecked;
                updateVendorFilterLabel();
                applyFilter();
            });
        });

        // Init vendor filter from URL
        var initVendedores = _CRM_CONFIG.vendedoresFilter;
        if (initVendedores) {
            var initIds = initVendedores.split(',');
            if (vfAll) vfAll.checked = false;
            initIds.forEach(function (id) {
                var cb = document.querySelector('.vf-user[value="' + id + '"]');
                if (cb) cb.checked = true;
            });
            updateVendorFilterLabel();
        }

    });

    document.addEventListener('DOMContentLoaded', function () {
        const island = document.getElementById('mainIsland');
        const expandedContent = document.getElementById('islandExpandedContent');
        const btnUploadTrigger = document.getElementById('btnUploadXlsTrigger');
        const realUploadBtn = document.getElementById('btnUploadXls');
        let isIslandExpanded = false;

        console.log('[CRM] Island:', island, 'ExpandedContent:', expandedContent);

        // Island Expansion Logic - DISABLED per user request (no hover expansion)
        /*
        if (island && expandedContent) {
            island.addEventListener('mouseenter', () => {
                island.classList.add('is-expanded');
                expandedContent.style.display = 'block';
                setTimeout(() => { expandedContent.style.opacity = '1'; }, 10);
            });

            island.addEventListener('mouseleave', () => {
                if (!isIslandExpanded) {
                    island.classList.remove('is-expanded');
                    expandedContent.style.display = 'none';
                    expandedContent.style.opacity = '0';
                }
            });
        }
        */

        // Trigger real upload button from island
        if (btnUploadTrigger && realUploadBtn) {
            btnUploadTrigger.addEventListener('click', () => {
                realUploadBtn.click();
            });
        }
        // ── Ocultar dock ──
        function hideDock() {
            ['.macos-dock', '#dock-bottom', '#dock-left', '#dock-right', '#dock-top',
                '.dock-activation-zone', '.dock-zone-left', '.dock-zone-right',
                '.dock-zone-bottom', '.dock-zone-top', '.design-panel', '#design-panel',
                '.edit-mode-exit', '#night-shift-filter'].forEach(function (sel) {
                    document.querySelectorAll(sel).forEach(function (el) {
                        el.style.setProperty('display', 'none', 'important');
                        el.style.setProperty('opacity', '0', 'important');
                        el.style.setProperty('visibility', 'hidden', 'important');
                        el.style.setProperty('pointer-events', 'none', 'important');
                    });
                });
        }
        hideDock();
        setTimeout(hideDock, 60);
        setTimeout(hideDock, 200);
        setTimeout(hideDock, 500);

        // Filtros mes/año movidos a script independiente arriba

        // ── Widget Negociación ──
        try {
            var overlay = document.getElementById('widgetNegociacion');
            var btnOpen = document.getElementById('btnNegociacion');
            var btnClose = document.getElementById('widgetClose');
            var btnCancel = document.getElementById('wfCancel');
            var form = document.getElementById('formNegociacion');
            var toast = document.getElementById('widgetToast');

            console.log('[CRM] btnNegociacion:', btnOpen, 'overlay:', overlay, 'btnClose:', btnClose, 'btnCancel:', btnCancel);

            function openWidget() {
                if (!overlay) { console.error('[CRM] widgetNegociacion overlay not found!'); return; }
                overlay.classList.add('active');
                overlay.classList.remove('closing');
                var wfCliente = document.getElementById('wfCliente');
                if (wfCliente) wfCliente.focus();
            }
            function closeWidget() {
                if (!overlay) return;
                overlay.classList.add('closing');
                setTimeout(function () {
                    overlay.classList.remove('active', 'closing');
                    if (form) form.reset();
                    // Close any open autocomplete
                    document.querySelectorAll('.wf-autocomplete').forEach(function (el) { el.classList.remove('open'); });
                }, 200);
            }
            function showToast(msg, type) {
                if (!toast) return;
                toast.textContent = msg;
                toast.className = 'widget-toast ' + type;
                setTimeout(function () { toast.className = 'widget-toast'; }, 3000);
            }

            if (btnOpen) {
                btnOpen.addEventListener('click', function () {
                    console.log('[CRM] Negociacion clicked! _crmTareasMode:', window._crmTareasMode);
                    if (window._crmTareasMode) {
                        crmTaskAbrirCrear();
                    } else {
                        openWidget();
                    }
                });
            }
            if (btnClose) btnClose.addEventListener('click', closeWidget);
            if (btnCancel) btnCancel.addEventListener('click', closeWidget);

            // Close on overlay background click
            if (overlay) {
                overlay.addEventListener('click', function (e) {
                    if (e.target === overlay) closeWidget();
                });
            }

            // Close on Escape
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && overlay && overlay.classList.contains('active')) closeWidget();
            });

            // ── Autocomplete: Cliente ──
            var clienteInput = document.getElementById('wfCliente');
            var clienteAC = document.getElementById('wfClienteAC');
            var selectedClienteId = null;
            var acTimeout = null;

            if (clienteInput) {
                clienteInput.addEventListener('input', function () {
                    var q = this.value.trim();
                    selectedClienteId = null;
                    if (q.length < 2) { if (clienteAC) clienteAC.classList.remove('open'); return; }

                    clearTimeout(acTimeout);
                    acTimeout = setTimeout(function () {
                        fetch('/app/api/buscar-clientes/?q=' + encodeURIComponent(q))
                            .then(function (r) { return r.json(); })
                            .then(function (data) {
                                if (!clienteAC) return;
                                clienteAC.innerHTML = '';
                                if (data.clientes && data.clientes.length > 0) {
                                    data.clientes.forEach(function (c) {
                                        var div = document.createElement('div');
                                        div.className = 'wf-ac-item';
                                        div.innerHTML = c.nombre + (c.contacto_principal ? '<div class="wf-ac-sub">' + c.contacto_principal + '</div>' : '');
                                        div.addEventListener('click', function () {
                                            clienteInput.value = c.nombre;
                                            selectedClienteId = c.id;
                                            clienteAC.classList.remove('open');
                                        });
                                        clienteAC.appendChild(div);
                                    });
                                    clienteAC.classList.add('open');
                                } else {
                                    clienteAC.classList.remove('open');
                                }
                            });
                    }, 250);
                });
            }

            // ── Autocomplete: Contacto ──
            var contactoInput = document.getElementById('wfContacto');
            var contactoAC = document.getElementById('wfContactoAC');

            if (contactoInput) {
                contactoInput.addEventListener('input', function () {
                    var q = this.value.trim();
                    if (q.length < 2 || !selectedClienteId) { if (contactoAC) contactoAC.classList.remove('open'); return; }

                    clearTimeout(acTimeout);
                    acTimeout = setTimeout(function () {
                        fetch('/app/api/buscar-contactos/?cliente_id=' + selectedClienteId + '&q=' + encodeURIComponent(q))
                            .then(function (r) { return r.json(); })
                            .then(function (data) {
                                if (!contactoAC) return;
                                contactoAC.innerHTML = '';
                                if (data.contactos && data.contactos.length > 0) {
                                    data.contactos.forEach(function (c) {
                                        var div = document.createElement('div');
                                        div.className = 'wf-ac-item';
                                        div.textContent = c.nombre_completo || (c.nombre + ' ' + (c.apellido || ''));
                                        div.addEventListener('click', function () {
                                            contactoInput.value = div.textContent;
                                            contactoAC.classList.remove('open');
                                        });
                                        contactoAC.appendChild(div);
                                    });
                                    contactoAC.classList.add('open');
                                } else {
                                    contactoAC.classList.remove('open');
                                }
                            });
                    }, 250);
                });
            }

            // Close autocompletes on outside click
            document.addEventListener('click', function (e) {
                if (!e.target.closest('.wf-group')) {
                    document.querySelectorAll('.wf-autocomplete').forEach(function (el) { el.classList.remove('open'); });
                }
            });

            // ── Submit form via AJAX ──
            if (form) {
                form.addEventListener('submit', function (e) {
                    e.preventDefault();
                    var submitBtn = document.getElementById('wfSubmit');
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Creando...';

                    var csrfToken = form.querySelector('[name=csrfmiddlewaretoken]').value;
                    var payload = {
                        cliente_nombre: document.getElementById('wfCliente').value.trim(),
                        contacto_nombre: document.getElementById('wfContacto').value.trim(),
                        oportunidad: document.getElementById('wfOportunidad').value.trim(),
                        monto: document.getElementById('wfMonto').value || '0',
                        probabilidad_cierre: document.getElementById('wfProbabilidad').value || '25',
                        area: document.getElementById('wfArea').value,
                        producto: document.getElementById('wfProducto').value,
                        mes_cierre: document.getElementById('wfMesCierre').value,
                        tipo_negociacion: document.getElementById('wfTipo').value,
                        comentarios: document.getElementById('wfComentarios').value.trim()
                    };

                    fetch('/app/api/crear-oportunidad/', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': csrfToken
                        },
                        body: JSON.stringify(payload)
                    })
                        .then(function (r) { return r.json(); })
                        .then(function (data) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = 'Crear Negociacion';

                            if (data.ok) {
                                closeWidget();
                                showToast(data.message, 'success');
                                // Cambiar a mes=todos para que la nueva oportunidad sea visible
                                currentMes = 'todos';
                                var _p = new URLSearchParams(window.location.search);
                                _p.set('mes', 'todos');
                                history.replaceState(null, '', window.location.pathname + '?' + _p.toString());
                                var mf = document.getElementById('mesFilter');
                                if (mf) mf.value = 'todos';
                                refreshCrmTable();
                                // Abrir el widget de la nueva oportunidad directamente
                                if (data.id) {
                                    setTimeout(function () { openDetalle(data.id); }, 800);
                                }

                                // Si fue abierto desde un correo, vincular automáticamente
                                var correoId = window._mailOppFromCorreoId;
                                if (correoId && data.id) {
                                    window._mailOppFromCorreoId = null;
                                    fetch('/app/api/mail/vincular/' + correoId + '/', {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'X-CSRFToken': csrfToken
                                        },
                                        body: JSON.stringify({ oportunidad_id: data.id })
                                    }).catch(function () { });
                                }
                            } else {
                                showToast(data.error || 'Error al crear', 'error');
                            }
                        })
                        .catch(function (err) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = 'Crear Negociacion';
                            showToast('Error de conexion', 'error');
                        });
                });
            }

            // Set default mes_cierre to next month
            var now = new Date();
            var nextMonth = now.getMonth() + 2; // getMonth is 0-indexed
            if (nextMonth > 12) nextMonth = 1;
            var mesCierreSelect = document.getElementById('wfMesCierre');
            if (mesCierreSelect) {
                mesCierreSelect.value = nextMonth.toString().padStart(2, '0');
            }
        } catch (e) { console.error('Negociacion Init Error', e); }

        // ══════════════════════════════════════════════
        // ── Widget Detalle de Oportunidad ──
        // ══════════════════════════════════════════════
        try {
            var detalleOverlay = document.getElementById('widgetDetalle');
            var detalleClose = document.getElementById('detalleClose');
            var detalleLoading = document.getElementById('detalleLoading');
            var detalleContent = document.getElementById('detalleContent');
            var currentOppId = null;

            // Etapas definitions
            var ETAPAS_RUNRATE = [
                'En Solicitud', 'Cotizando', 'Enviada', 'Seguimiento',
                'Vendido s/PO', 'Vendido c/PO', 'En Tránsito', 'Facturado',
                'Programado', 'Entregado', 'Esperando Pago', 'Sin Respuesta',
                'Ganado', 'Perdido'
            ];
            var ETAPAS_PROYECTO = [
                'Oportunidad', 'Levantamiento', 'Base Cotización', 'Cotizando',
                'Enviada', 'Seguimiento', 'Vendido s/PO', 'Vendido c/PO',
                'Cotiz. Proveedor', 'Comprando', 'En Tránsito', 'Ejecutando',
                'Entregado', 'Facturado', 'Reportes', 'Pagado', 'Perdido'
            ];

            function openDetalle(oppId) {
                // Sanitize: strip any non-digit characters (e.g. locale thousands separators)
                var cleanId = parseInt(String(oppId).replace(/[^\d]/g, ''), 10);
                if (!cleanId || isNaN(cleanId)) return;
                oppId = cleanId;
                currentOppId = oppId;
                if (typeof woSetCurrentOppId === 'function') woSetCurrentOppId(oppId);
                detalleOverlay.classList.add('active');
                detalleOverlay.classList.remove('closing');
                document.body.style.overflow = 'hidden';
                detalleLoading.style.display = 'block';
                detalleContent.style.display = 'none';

                // Persistir widget abierto
                try { sessionStorage.setItem('_crm_open_opp_id', oppId); } catch (e) { }

                fetch('/app/api/oportunidad-detalle-crm/' + oppId + '/')
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (data.error) { showToast('Error: ' + data.error, 'error'); return; }
                        renderDetalle(data);
                        detalleLoading.style.display = 'none';
                        detalleContent.style.display = 'flex';
                        // Para proyectos Bitrix24: abrir el Drive automáticamente
                        if (data.tipo_negociacion === 'bitrix_proyecto') {
                            setTimeout(function () {
                                if (typeof woAbrirGestorDrive === 'function') woAbrirGestorDrive();
                            }, 150);
                        }
                    })
                    .catch(function () {
                        showToast('Error cargando detalle', 'error');
                        closeDetalleWidget(true);
                    });
            }
            window.openDetalle = openDetalle;

            // Restaurar widget si estaba abierto antes de recargar
            try {
                var _savedOppId = sessionStorage.getItem('_crm_open_opp_id');
                if (_savedOppId) {
                    var _savedClean = parseInt(String(_savedOppId).replace(/[^\d]/g, ''), 10);
                    if (_savedClean) {
                        setTimeout(function () { openDetalle(_savedClean); }, 300);
                    } else {
                        sessionStorage.removeItem('_crm_open_opp_id');
                    }
                }
            } catch (e) { }

            // Auto-abrir oportunidad/tarea desde parámetro URL (viene del spotlight)
            try {
                var _urlParams = new URLSearchParams(window.location.search);
                var _openOppId = _urlParams.get('open_opp');
                var _openTaskId = _urlParams.get('open_task');
                var _cleanParams = false;
                if (_openOppId) {
                    var _openOppClean = parseInt(_openOppId, 10);
                    if (_openOppClean) {
                        setTimeout(function () { openDetalle(_openOppClean); }, 600);
                        _urlParams.delete('open_opp');
                        _cleanParams = true;
                    }
                }
                if (_openTaskId) {
                    var _openTaskClean = parseInt(_openTaskId, 10);
                    if (_openTaskClean) {
                        setTimeout(function () { if (typeof crmTaskVerDetalle === 'function') crmTaskVerDetalle(_openTaskClean); }, 600);
                        _urlParams.delete('open_task');
                        _cleanParams = true;
                    }
                }
                if (_cleanParams) {
                    var newUrl = window.location.pathname + (_urlParams.toString() ? '?' + _urlParams.toString() : '');
                    window.history.replaceState({}, '', newUrl);
                }
            } catch (e) { }

            var MES_NOMBRES = {
                '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
                '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
                '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
            };

            function getInitials(name) {
                if (!name) return '?';
                var parts = name.trim().split(/\s+/);
                if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
                return parts[0].substring(0, 2).toUpperCase();
            }

            function renderDetalle(d) {
                var tipo = d.tipo_negociacion || 'runrate';

                // Type badge
                var badge = document.getElementById('woTypeBadge');
                badge.className = 'wo-type-badge ' + tipo;
                var badgeIcon, badgeLabel;
                if (tipo === 'bitrix_proyecto') {
                    badgeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
                    badgeLabel = 'PROYECTO BITRIX24';
                    badge.style.cursor = 'default';
                    badge.style.background = '#5856D6';
                    badge.style.borderColor = '#5856D6';
                    badge.style.color = '#fff';
                } else {
                    badge.style.cursor = 'pointer';
                    badge.style.background = '';
                    badge.style.borderColor = '';
                    badge.style.color = '';
                    badgeIcon = tipo === 'proyecto'
                        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>'
                        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>';
                    badgeLabel = tipo === 'proyecto' ? 'VENTA PROYECTO' : 'VENTA RUNRATE';
                }
                badge.innerHTML = badgeIcon + '<span>' + badgeLabel + '</span>';

                // Limpiar event listeners previos
                var newBadge = badge.cloneNode(true);
                badge.parentNode.replaceChild(newBadge, badge);
                badge = newBadge;

                // bitrix_proyecto: badge no cambia de tipo
                if (tipo === 'bitrix_proyecto') {
                    badge.style.cursor = 'default';
                    badge.style.background = '#5856D6';
                    badge.style.borderColor = '#5856D6';
                    badge.style.color = '#fff';
                    // skip click handler
                } else
                    badge.addEventListener('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log("[DEBUG] Badge clicked by addEventListener!");
                        var newTipo = tipo === 'proyecto' ? 'runrate' : 'proyecto';
                        var targetName = newTipo === 'proyecto' ? 'Ventas de Proyectos' : 'Ventas Runrate';

                        var txt = document.getElementById('confirmTipoText');
                        if (txt) txt.innerHTML = '¿Estás seguro que deseas cambiar esta oportunidad a <b>' + targetName + '</b>?<br><br>Al confirmar, las etapas del pipeline se reiniciarán a su estado inicial.';

                        var overlay = document.getElementById('widgetConfirmTipo');
                        if (!overlay) {
                            console.error("[DEBUG] No se encontró widgetConfirmTipo!");
                            showToast("Error: widgetConfirmTipo no encontrado", "error");
                            return;
                        }
                        var btnCancel = document.getElementById('confirmTipoCancel');
                        var btnAccept = document.getElementById('confirmTipoAccept');

                        overlay.classList.add('active');

                        btnCancel.onclick = function () {
                            overlay.classList.remove('active');
                        };

                        btnAccept.onclick = function () {
                            overlay.classList.remove('active');
                            var csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;
                            var formData = new FormData();
                            formData.append('tipo_negociacion', newTipo);
                            // Also reset etapa to first stage of new type
                            var newEtapas = newTipo === 'proyecto' ? ETAPAS_PROYECTO : ETAPAS_RUNRATE;
                            formData.append('etapa_corta', newEtapas[0]);
                            btnAccept.textContent = 'Cambiando...';
                            fetch('/app/api/editar-oportunidad/' + d.id + '/', {
                                method: 'POST',
                                headers: { 'X-CSRFToken': csrfToken },
                                body: formData
                            }).then(function (r) { return r.json(); }).then(function (resp) {
                                btnAccept.textContent = 'Sí, cambiar';
                                if (resp.success) {
                                    showToast('Tipo cambiado a ' + (newTipo === 'proyecto' ? 'Proyecto' : 'Runrate'), 'success');
                                    openDetalle(d.id);
                                } else {
                                    showToast(resp.error || 'Error', 'error');
                                }
                            });
                        };
                    }); // end badge click

                // Title (editable)
                var titleEl = document.getElementById('woTitle');
                titleEl.textContent = d.oportunidad || '';
                titleEl.style.cursor = 'pointer';
                titleEl.title = 'Clic para editar nombre';
                titleEl.onclick = function () {
                    if (titleEl.querySelector('input')) return;
                    var currentName = titleEl.textContent;
                    var inp = document.createElement('input');
                    inp.type = 'text';
                    inp.value = currentName;
                    inp.style.cssText = 'font-size:1.8rem;font-weight:700;color:#1D1D1F;border:none;border-bottom:2px solid #0052D4;background:transparent;outline:none;width:100%;letter-spacing:-0.02em;font-family:inherit;padding:0;';
                    titleEl.textContent = '';
                    titleEl.appendChild(inp);
                    inp.focus();
                    inp.select();
                    function commitTitle() {
                        var newName = inp.value.trim();
                        if (!newName) newName = currentName;
                        titleEl.textContent = newName;
                        if (newName !== (woOriginalData.oportunidad || '')) {
                            woFieldChanged('oportunidad', newName);
                        }
                    }
                    inp.addEventListener('blur', commitTitle);
                    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { titleEl.textContent = currentName; } });
                };

                // Pipeline
                var stagesContainer = document.getElementById('woPipelineStages');
                stagesContainer.innerHTML = '';
                var pipelineWrap = document.getElementById('woPipelineScroll') && document.getElementById('woPipelineScroll').closest('.wo-pipeline');
                if (tipo === 'bitrix_proyecto') {
                    // Mostrar una sola etiqueta en lugar del pipeline completo
                    if (pipelineWrap) pipelineWrap.style.display = 'none';
                } else {
                    if (pipelineWrap) pipelineWrap.style.display = '';
                }
                var etapas = tipo === 'proyecto' ? ETAPAS_PROYECTO : ETAPAS_RUNRATE;
                var currentEtapa = d.etapa_corta || etapas[0];
                var currentIdx = -1;
                // Fuzzy match
                for (var i = 0; i < etapas.length; i++) {
                    if (etapas[i].toLowerCase() === currentEtapa.toLowerCase() ||
                        currentEtapa.toLowerCase().indexOf(etapas[i].toLowerCase()) !== -1 ||
                        etapas[i].toLowerCase().indexOf(currentEtapa.toLowerCase()) !== -1) {
                        currentIdx = i;
                        break;
                    }
                }
                if (currentIdx === -1) currentIdx = 0;
                var stageColor = d.etapa_color || '#0052D4';

                etapas.forEach(function (et, i) {
                    if (i > 0) {
                        var conn = document.createElement('span');
                        conn.className = 'wo-stage-connector' + (i <= currentIdx ? ' completed' : '');
                        stagesContainer.appendChild(conn);
                    }
                    var btn = document.createElement('button');
                    btn.type = 'button';
                    if (i < currentIdx) {
                        btn.className = 'wo-stage-btn completed';
                        btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> ' + et;
                    } else if (i === currentIdx) {
                        btn.className = 'wo-stage-btn active';
                        btn.textContent = et;
                    } else {
                        btn.className = 'wo-stage-btn';
                        btn.textContent = et;
                    }
                    btn.addEventListener('click', function () { changeStage(d.id, et, tipo); });
                    stagesContainer.appendChild(btn);
                });

                // Auto-scroll to active stage
                setTimeout(function () {
                    var activeBtn = stagesContainer.querySelector('.wo-stage-btn.active');
                    if (activeBtn) {
                        var scroll = document.getElementById('woPipelineScroll');
                        scroll.scrollLeft = activeBtn.offsetLeft - scroll.offsetWidth / 2 + activeBtn.offsetWidth / 2;
                    }
                }, 50);

                // Info card
                var montoNum = Number(d.monto) || 0;
                document.getElementById('woMonto').textContent = '$' + montoNum.toLocaleString('es-MX', { minimumFractionDigits: 0 });
                var mesNombre = MES_NOMBRES[d.mes_cierre] || d.mes_cierre || '-';
                document.getElementById('woFechaCierre').textContent = mesNombre + ' ' + new Date().getFullYear();
                document.getElementById('woProducto').textContent = d.producto || 'N/A';
                document.getElementById('woArea').textContent = d.area || 'N/A';
                document.getElementById('woPoNumber').value = d.po_number || '';
                document.getElementById('woFacturaNumero').value = d.factura_numero || '';

                // Probability
                var prob = d.probabilidad_cierre || 0;
                var probEl = document.getElementById('woProbValue');
                probEl.textContent = prob + '%';
                probEl.style.color = prob >= 70 ? '#16A34A' : prob >= 40 ? '#F59E0B' : '#EF4444';
                var fillEl = document.getElementById('woProbFill');
                fillEl.style.width = prob + '%';
                fillEl.style.background = prob >= 70 ? '#16A34A' : prob >= 40 ? '#F59E0B' : '#EF4444';

                // Vendedor
                var vendedor = d.usuario || 'Sin asignar';
                document.getElementById('woVendedorAvatar').textContent = getInitials(vendedor);
                document.getElementById('woVendedorName').textContent = vendedor;

                // Cliente
                var clienteNombre = d.cliente ? d.cliente.nombre : 'Sin empresa';
                var contactoNombre = d.contacto || 'No asignado';
                document.getElementById('woClienteAvatar').textContent = getInitials(clienteNombre);
                document.getElementById('woContactoName').textContent = contactoNombre;
                document.getElementById('woClienteName').textContent = clienteNombre;

                // Cotizaciones
                var quoteList = document.getElementById('woQuoteList');
                quoteList.innerHTML = '';
                if (d.cotizaciones && d.cotizaciones.length > 0) {
                    d.cotizaciones.forEach(function (cot) {
                        var card = document.createElement('div');
                        card.className = 'wo-quote-card';
                        var cotId = cot.id.toString().padStart(3, '0');
                        var totalStr = Number(cot.total).toLocaleString('es-MX', { minimumFractionDigits: 0 });
                        card.innerHTML =
                            '<div class="wo-quote-left">' +
                            '<div class="wo-quote-badge">#' + cotId + '</div>' +
                            '<div class="wo-quote-info" onclick="window.open(\'/app/cotizacion/view/' + cot.id + '/\',\'_blank\')">' +
                            '<div class="wo-quote-title">COT-' + new Date().getFullYear() + '-' + cotId + '<span class="wo-quote-version">(v1.0)</span></div>' +
                            '<div class="wo-quote-meta">' + cot.fecha + ' &bull; $' + totalStr + '</div>' +
                            '</div>' +
                            '</div>' +
                            '<div class="wo-quote-actions">' +
                            '<a href="#" onclick="openEditCotizacion(' + cot.id + '); return false;" class="wo-action-btn" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></a>' +
                            '<a href="/app/cotizacion/pdf/' + cot.id + '/" class="wo-action-btn" title="Descargar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a>' +
                            '</div>';
                        quoteList.appendChild(card);
                    });
                } else {
                    quoteList.innerHTML = '<div class="wo-empty">Sin cotizaciones aun</div>';
                }

                // Setup inline editing
                woSetupEditableFields(d);

                // Restricciones para rol Ingeniero
                if (window.ES_INGENIERO) {
                    // Título: solo lectura
                    var titleElI = document.getElementById('woTitle');
                    if (titleElI) { titleElI.style.cursor = 'default'; titleElI.title = ''; titleElI.onclick = null; }
                    // Badge: no cambia tipo
                    var badgeI = document.getElementById('woTypeBadge');
                    if (badgeI) { badgeI.style.cursor = 'default'; badgeI.onclick = null; }
                    // Stage buttons: deshabilitados
                    document.querySelectorAll('.wo-stage-btn').forEach(function (b) {
                        b.style.pointerEvents = 'none'; b.style.opacity = '0.7';
                    });
                    // Cotizar button: ocultar
                    var cotizarBtn = document.getElementById('woNuevaCotBtn');
                    if (cotizarBtn) cotizarBtn.style.display = 'none';
                    // Campos editables: solo lectura
                    document.querySelectorAll('.wo-editable').forEach(function (el) {
                        el.style.cursor = 'default'; el.onclick = null;
                    });
                }
            }

            // ══════════════════════════════════════════════
            // ── Inline Editing Logic ──
            // ══════════════════════════════════════════════
            var WO_PRODUCTOS = [['ZEBRA', 'Zebra'], ['PANDUIT', 'Panduit'], ['APC', 'APC'], ['AVIGILION', 'Avigilon'], ['GENETEC', 'Genetec'], ['AXIS', 'Axis'], ['SOFTWARE', 'Software'], ['RUNRATE', 'Runrate'], ['PÓLIZA', 'Poliza'], ['CISCO', 'Cisco'], ['SERVICIO', 'Servicio']];
            var WO_AREAS = [['SISTEMAS', 'Sistemas'], ['Recursos Humanos', 'Recursos Humanos'], ['Compras', 'Compras'], ['Seguridad', 'Seguridad'], ['Mantenimiento', 'Mantenimiento'], ['Almacén', 'Almacén']];
            var WO_MESES = [['01', 'Enero'], ['02', 'Febrero'], ['03', 'Marzo'], ['04', 'Abril'], ['05', 'Mayo'], ['06', 'Junio'], ['07', 'Julio'], ['08', 'Agosto'], ['09', 'Septiembre'], ['10', 'Octubre'], ['11', 'Noviembre'], ['12', 'Diciembre']];

            var woOriginalData = {};
            var woEditedFields = {};
            var woSaveBar = document.getElementById('woSaveBar');

            function woShowSaveBar() {
                if (Object.keys(woEditedFields).length > 0) {
                    woSaveBar.style.display = 'flex';
                }
            }
            function woHideSaveBar() {
                woSaveBar.style.display = 'none';
            }
            function woFieldChanged(field, value) {
                woEditedFields[field] = value;
                woShowSaveBar();
            }

            // Helper: make a select from options array, pre-selecting current value
            function woMakeSelect(options, currentVal, className) {
                var sel = document.createElement('select');
                sel.className = 'wo-inline-select ' + (className || '');
                options.forEach(function (o) {
                    var opt = document.createElement('option');
                    opt.value = o[0];
                    opt.textContent = o[1];
                    if (o[0] === currentVal || o[1] === currentVal) opt.selected = true;
                    sel.appendChild(opt);
                });
                return sel;
            }

            // Helper: make an autocomplete input
            function woMakeAutocomplete(container, placeholder, searchUrl, onSelect) {
                container.innerHTML = '';
                var wrap = document.createElement('div');
                wrap.className = 'wo-inline-ac';
                var inp = document.createElement('input');
                inp.type = 'text';
                inp.placeholder = placeholder;
                inp.className = 'wo-inline-input';
                var dd = document.createElement('div');
                dd.className = 'wo-ac-dropdown';
                dd.style.display = 'none';
                wrap.appendChild(inp);
                wrap.appendChild(dd);
                container.appendChild(wrap);
                inp.focus();

                function doSearch(q) {
                    var sep = searchUrl.indexOf('?') !== -1 ? '&' : '?';
                    fetch(searchUrl + sep + 'q=' + encodeURIComponent(q))
                        .then(function (r) { return r.json(); })
                        .then(function (data) {
                            dd.innerHTML = '';
                            var items = data.clientes || data.usuarios || data.contactos || [];
                            if (items.length === 0) { dd.style.display = 'none'; return; }
                            items.forEach(function (item) {
                                var div = document.createElement('div');
                                div.className = 'wo-ac-item';
                                var name = item.nombre_completo || item.nombre || item.username || '';
                                var sub = item.contacto_principal || item.email || item.rol || '';
                                div.innerHTML = name + (sub ? '<div class="wo-ac-sub">' + sub + '</div>' : '');
                                div.addEventListener('click', function () {
                                    onSelect(item);
                                    dd.style.display = 'none';
                                });
                                dd.appendChild(div);
                            });
                            dd.style.display = 'block';
                        });
                }

                // Show full list immediately on focus
                doSearch('');

                var acTimer = null;
                inp.addEventListener('input', function () {
                    var q = inp.value.trim();
                    clearTimeout(acTimer);
                    acTimer = setTimeout(function () { doSearch(q); }, 200);
                });
                // Close on outside click
                setTimeout(function () {
                    document.addEventListener('click', function closeAc(e) {
                        if (!wrap.contains(e.target)) {
                            dd.style.display = 'none';
                            document.removeEventListener('click', closeAc);
                        }
                    });
                }, 100);
            }

            function woSetupEditableFields(d) {
                woOriginalData = JSON.parse(JSON.stringify(d));
                woEditedFields = {};
                woHideSaveBar();

                // Title is set up in renderDetalle already

                // ── Monto ──
                var montoEl = document.getElementById('woMonto');
                montoEl.classList.add('editable');
                montoEl.onclick = function () {
                    if (montoEl.querySelector('input')) return;
                    var current = woEditedFields.monto !== undefined ? woEditedFields.monto : (d.monto || 0);
                    var inp = document.createElement('input');
                    inp.type = 'number';
                    inp.className = 'wo-inline-input large';
                    inp.value = current;
                    inp.step = '0.01';
                    montoEl.textContent = '';
                    montoEl.appendChild(inp);
                    inp.focus();
                    inp.select();
                    function commit() {
                        var val = parseFloat(inp.value) || 0;
                        montoEl.textContent = '$' + val.toLocaleString('es-MX', { minimumFractionDigits: 0 });
                        if (val !== (woOriginalData.monto || 0)) {
                            woFieldChanged('monto', val);
                        }
                    }
                    inp.addEventListener('blur', commit);
                    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
                };

                // ── Producto ──
                var prodEl = document.getElementById('woProducto');
                prodEl.classList.add('editable');
                prodEl.onclick = function () {
                    if (prodEl.querySelector('select')) return;
                    var currentVal = woEditedFields.producto || d.producto || '';
                    var sel = woMakeSelect(WO_PRODUCTOS, currentVal);
                    prodEl.textContent = '';
                    prodEl.appendChild(sel);
                    sel.focus();
                    sel.addEventListener('change', function () {
                        var v = sel.value;
                        var label = sel.options[sel.selectedIndex].text;
                        prodEl.textContent = label;
                        if (v !== woOriginalData.producto) woFieldChanged('producto', v);
                    });
                    sel.addEventListener('blur', function () {
                        if (!sel.parentNode) return;
                        var label = sel.options[sel.selectedIndex].text;
                        prodEl.textContent = label;
                    });
                };

                // ── Area ──
                var areaEl = document.getElementById('woArea');
                areaEl.classList.add('editable');
                areaEl.onclick = function () {
                    if (areaEl.querySelector('select')) return;
                    var currentVal = woEditedFields.area || d.area || '';
                    var sel = woMakeSelect(WO_AREAS, currentVal);
                    areaEl.textContent = '';
                    areaEl.appendChild(sel);
                    sel.focus();
                    sel.addEventListener('change', function () {
                        var v = sel.value;
                        var label = sel.options[sel.selectedIndex].text;
                        areaEl.textContent = label;
                        if (v !== woOriginalData.area) woFieldChanged('area', v);
                    });
                    sel.addEventListener('blur', function () {
                        if (!sel.parentNode) return;
                        var label = sel.options[sel.selectedIndex].text;
                        areaEl.textContent = label;
                    });
                };

                // ── Mes de Cierre ──
                var mesEl = document.getElementById('woFechaCierre');
                mesEl.classList.add('editable');
                mesEl.onclick = function () {
                    if (mesEl.querySelector('select')) return;
                    var currentVal = woEditedFields.mes_cierre || d.mes_cierre || '';
                    var sel = woMakeSelect(WO_MESES, currentVal);
                    mesEl.textContent = '';
                    mesEl.appendChild(sel);
                    sel.focus();
                    sel.addEventListener('change', function () {
                        var v = sel.value;
                        var label = sel.options[sel.selectedIndex].text;
                        mesEl.textContent = label + ' ' + new Date().getFullYear();
                        if (v !== woOriginalData.mes_cierre) woFieldChanged('mes_cierre', v);
                    });
                    sel.addEventListener('blur', function () {
                        if (!sel.parentNode) return;
                        var label = sel.options[sel.selectedIndex].text;
                        mesEl.textContent = label + ' ' + new Date().getFullYear();
                    });
                };

                // ── PO Number ──
                window.woGuardarPO = function (input) {
                    input.style.borderBottomColor = 'transparent';
                    var val = input.value.trim();
                    if (val === (woOriginalData.po_number || '')) return;
                    var fd = new FormData();
                    fd.append('po_number', val);
                    fetch('/app/api/oportunidad/' + currentOppId + '/po/', {
                        method: 'POST', body: fd,
                        headers: { 'X-CSRFToken': document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '' }
                    }).then(function (r) { return r.json(); }).then(function (data) {
                        if (data.ok) { woOriginalData.po_number = val; }
                        else { input.value = woOriginalData.po_number || ''; }
                    }).catch(function () { input.value = woOriginalData.po_number || ''; });
                };

                // ── Factura ──
                window.woGuardarFactura = function (input) {
                    input.style.borderBottomColor = 'transparent';
                    var val = input.value.trim();
                    if (val === (woOriginalData.factura_numero || '')) return;
                    var fd = new FormData();
                    fd.append('factura_numero', val);
                    fetch('/app/api/oportunidad/' + currentOppId + '/po/', {
                        method: 'POST', body: fd,
                        headers: { 'X-CSRFToken': document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '' }
                    }).then(function (r) { return r.json(); }).then(function (data) {
                        if (data.ok) { woOriginalData.factura_numero = val; }
                        else { input.value = woOriginalData.factura_numero || ''; }
                    }).catch(function () { input.value = woOriginalData.factura_numero || ''; });
                };

                // ── Probabilidad (click/drag on bar) ──
                var probBar = document.getElementById('woProbFill').parentElement;
                var probValEl = document.getElementById('woProbValue');
                var probFillEl = document.getElementById('woProbFill');
                probValEl.classList.add('editable');

                function updateProbVisual(val) {
                    var color = val >= 70 ? '#16A34A' : val >= 40 ? '#F59E0B' : '#EF4444';
                    probValEl.textContent = val + '%';
                    probValEl.style.color = color;
                    probFillEl.style.width = val + '%';
                    probFillEl.style.background = color;
                }

                function probFromEvent(e) {
                    var rect = probBar.getBoundingClientRect();
                    var x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                    var pct = Math.round((x / rect.width) * 100 / 5) * 5;
                    return Math.max(0, Math.min(100, pct));
                }

                var draggingProb = false;
                probBar.addEventListener('mousedown', function (e) {
                    draggingProb = true;
                    var val = probFromEvent(e);
                    updateProbVisual(val);
                });
                document.addEventListener('mousemove', function (e) {
                    if (!draggingProb) return;
                    var val = probFromEvent(e);
                    updateProbVisual(val);
                });
                document.addEventListener('mouseup', function (e) {
                    if (!draggingProb) return;
                    draggingProb = false;
                    var val = probFromEvent(e);
                    updateProbVisual(val);
                    if (val !== (woOriginalData.probabilidad_cierre || 0)) {
                        woFieldChanged('probabilidad', val);
                    }
                });
                probValEl.onclick = function (e) { e.stopPropagation(); };

                // ── Cliente (autocomplete) ──
                var clienteNameEl = document.getElementById('woClienteName');
                var clienteContactoEl = document.getElementById('woContactoName');
                var clienteAvatarEl = document.getElementById('woClienteAvatar');
                clienteNameEl.classList.add('editable');
                clienteNameEl.onclick = function () {
                    if (clienteNameEl.querySelector('.wo-inline-ac')) return;
                    woMakeAutocomplete(clienteNameEl, 'Buscar cliente...', '/app/api/buscar-clientes/', function (item) {
                        clienteNameEl.textContent = item.nombre;
                        clienteAvatarEl.textContent = getInitials(item.nombre);
                        if (item.contacto_principal) clienteContactoEl.textContent = item.contacto_principal;
                        if (item.id !== (woOriginalData.cliente ? woOriginalData.cliente.id : null)) {
                            woFieldChanged('cliente', item.id);
                        }
                    });
                };

                // ── Contacto (autocomplete, depends on cliente) ──
                var contactoEl = document.getElementById('woContactoName');
                contactoEl.classList.add('editable');
                contactoEl.onclick = function () {
                    if (contactoEl.querySelector('.wo-inline-ac')) return;
                    var cId = woEditedFields.cliente || (d.cliente ? d.cliente.id : '');
                    if (!cId) return;
                    woMakeAutocomplete(contactoEl, 'Buscar contacto...', '/app/api/buscar-contactos/?cliente_id=' + cId, function (item) {
                        var name = item.nombre_completo || (item.nombre + ' ' + (item.apellido || '')).trim();
                        contactoEl.textContent = name;
                        if (item.id !== woOriginalData.contacto_id) {
                            woFieldChanged('contacto', item.id);
                        }
                    });
                };

                // ── Vendedor (autocomplete) ──
                var vendedorNameEl = document.getElementById('woVendedorName');
                var vendedorAvatarEl = document.getElementById('woVendedorAvatar');
                vendedorNameEl.classList.add('editable');
                vendedorNameEl.onclick = function () {
                    if (vendedorNameEl.querySelector('.wo-inline-ac')) return;
                    woMakeAutocomplete(vendedorNameEl, 'Buscar usuario...', '/app/api/buscar-usuarios/', function (item) {
                        var name = item.nombre || item.nombre_completo || item.username;
                        vendedorNameEl.textContent = name;
                        vendedorAvatarEl.textContent = getInitials(name);
                        if (item.id !== woOriginalData.usuario_id) {
                            woFieldChanged('usuario', item.id);
                        }
                    });
                };
            }

            // ── Save / Cancel handlers ──
            document.getElementById('woSaveConfirm').addEventListener('click', function () {
                if (Object.keys(woEditedFields).length === 0) { woHideSaveBar(); return; }
                var csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;
                var formData = new FormData();
                for (var key in woEditedFields) {
                    formData.append(key, woEditedFields[key]);
                }
                var btn = this;
                btn.textContent = 'Guardando...';
                btn.disabled = true;
                fetch('/app/api/editar-oportunidad/' + currentOppId + '/', {
                    method: 'POST',
                    headers: { 'X-CSRFToken': csrfToken },
                    body: formData
                })
                    .then(function (r) { return r.json(); })
                    .then(function (resp) {
                        btn.textContent = 'Guardar';
                        btn.disabled = false;
                        if (resp.success) {
                            showToast('Cambios guardados', 'success');
                            woEditedFields = {};
                            woHideSaveBar();
                            _crmTableDirty = true;
                            // Refresh data
                            openDetalle(currentOppId);
                        } else {
                            showToast(resp.error || 'Error al guardar', 'error');
                        }
                    })
                    .catch(function () {
                        btn.textContent = 'Guardar';
                        btn.disabled = false;
                        showToast('Error de conexión', 'error');
                    });
            });

            document.getElementById('woSaveCancel').addEventListener('click', function () {
                woEditedFields = {};
                woHideSaveBar();
                // Re-render with original data
                renderDetalle(woOriginalData);
            });

            function changeStage(oppId, etapa, tipo) {
                var csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;
                var formData = new FormData();
                formData.append('etapa_corta', etapa);

                fetch('/app/api/editar-oportunidad/' + oppId + '/', {
                    method: 'POST',
                    headers: { 'X-CSRFToken': csrfToken },
                    body: formData
                }).then(function (r) { return r.json(); }).then(function (resp) {
                    if (resp.success) {
                        showToast('Etapa actualizada', 'success');
                        openDetalle(oppId);
                    } else {
                        showToast(resp.error || 'Error', 'error');
                    }
                });
            }

            // (Auto-save removed — widget is now read-only display)

            function closeDetalleWidget(forceClose) {
                // Solo aplica la verificación si el usuario actual es el responsable de la oportunidad
                var esResponsable = woOriginalData && woOriginalData.usuario_id &&
                    String(woOriginalData.usuario_id) === String(_CRM_CONFIG.userId);

                if (!forceClose && currentOppId && esResponsable) {
                    // Verificar si la oportunidad tiene al menos una actividad pendiente
                    fetch('/app/api/oportunidad/' + currentOppId + '/tareas/')
                        .then(function (r) { return r.json(); })
                        .then(function (res) {
                            if (res.success && res.tareas) {
                                var pendientes = res.tareas.filter(function (t) { return t.estado !== 'completada'; });
                                if (pendientes.length === 0) {
                                    // No hay actividades pendientes — bloquear cierre
                                    _showMissingActivityWarning();
                                    return;
                                }
                            }
                            _doCloseDetalle();
                        })
                        .catch(function () {
                            _doCloseDetalle();
                        });
                } else {
                    _doCloseDetalle();
                }
            }

            var _crmTableDirty = false; // Solo refrescar si algo cambió

            function _doCloseDetalle() {
                detalleOverlay.classList.add('closing');
                setTimeout(function () {
                    detalleOverlay.classList.remove('active', 'closing');
                    document.body.style.overflow = '';
                }, 200);
                try { sessionStorage.removeItem('_crm_open_opp_id'); } catch (e) { }
                _crmTableDirty = false;
                refreshCrmTable();
            }

            function _showMissingActivityWarning() {
                // Crear overlay de advertencia
                var existing = document.getElementById('warnMissingActivity');
                if (existing) existing.remove();

                var warn = document.createElement('div');
                warn.id = 'warnMissingActivity';
                warn.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s;';
                warn.innerHTML = '<div style="background:#fff;border-radius:16px;padding:2rem;max-width:380px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.25);">' +
                    '<div style="width:56px;height:56px;border-radius:50%;background:rgba(255,149,0,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">' +
                    '<svg width="28" height="28" fill="none" stroke="#FF9500" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' +
                    '</div>' +
                    '<h3 style="margin:0 0 0.5rem;font-size:1.15rem;font-weight:700;color:#1D1D1F;">Falta agendar actividad</h3>' +
                    '<p style="margin:0 0 1.5rem;font-size:0.9rem;color:#86868B;line-height:1.5;">Cada oportunidad debe tener al menos una actividad programada para garantizar el seguimiento.</p>' +
                    '<div style="display:flex;gap:0.75rem;justify-content:center;">' +
                    '<button id="warnBtnAgendar" style="background:#0052D4;color:#fff;border:none;padding:0.7rem 1.5rem;border-radius:10px;font-weight:700;font-size:0.9rem;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:transform 0.15s;" onmouseenter="this.style.transform=\'scale(1.03)\'" onmouseleave="this.style.transform=\'none\'">' +
                    '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>' +
                    'Agendar Actividad' +
                    '</button>' +
                    '</div>' +
                    '</div>';
                document.body.appendChild(warn);

                document.getElementById('warnBtnAgendar').addEventListener('click', function () {
                    warn.remove();
                    // Abrir el widget de crear actividad
                    if (typeof woAbrirWidgetCrearActividad === 'function') {
                        woAbrirWidgetCrearActividad();
                    } else {
                        var crearWidget = document.getElementById('widgetOppCrearActividad');
                        if (crearWidget) crearWidget.style.display = 'flex';
                    }
                });
            }

            detalleClose.addEventListener('click', function () { closeDetalleWidget(); });
            detalleOverlay.addEventListener('click', function (e) {
                if (e.target === detalleOverlay) closeDetalleWidget();
            });

            // Click on opportunity name to open detalle widget
            document.querySelectorAll('.opp-name-link').forEach(function (el) {
                el.addEventListener('click', function () {
                    var oppId = this.getAttribute('data-oportunidad-id');
                    if (oppId) openDetalle(oppId);
                });
            });

            // "Nueva cotización" button in detalle widget
            document.getElementById('detNuevaCot').addEventListener('click', function () {
                if (currentOppId) {
                    openCotizador(currentOppId);
                }
            });

            // ══════════════════════════════════════════════
            // ── Widget Cotizador (iframe) ──
            // ══════════════════════════════════════════════
            var cotizadorOverlay = document.getElementById('widgetCotizador');
            var cotizadorCloseBtn = document.getElementById('cotizadorClose');
            var cotizadorIframe = document.getElementById('cotizadorIframe');

            var cotizadorOppId = null;

            function openCotizador(oppId) {
                cotizadorOppId = oppId;
                cotizadorOverlay.classList.add('active');
                cotizadorOverlay.classList.remove('closing');
                cotizadorIframe.src = '/app/crear-cotizacion/oportunidad/' + oppId + '/?widget_mode=1';
            }

            window.openEditCotizacion = function (cotId) {
                // Cierra el widget de detalle si está abierto
                if (detalleOverlay.classList.contains('active')) {
                    detalleOverlay.classList.remove('active', 'closing');
                }
                cotizadorOverlay.classList.add('active');
                cotizadorOverlay.classList.remove('closing');
                cotizadorIframe.src = '/app/cotizacion/' + cotId + '/editar/?widget_mode=1';
            };

            function closeCotizador() {
                cotizadorOverlay.classList.add('closing');
                setTimeout(function () {
                    cotizadorOverlay.classList.remove('active', 'closing');
                    cotizadorIframe.src = 'about:blank';
                }, 200);
                if (cotizacionCreated) {
                    cotizacionCreated = false;
                    refreshCrmTable();
                }
            }

            cotizadorCloseBtn.addEventListener('click', closeCotizador);
            cotizadorOverlay.addEventListener('click', function (e) {
                if (e.target === cotizadorOverlay) closeCotizador();
            });

            // ── Refresh table via API (sin recargar página) ──
            var currentTab = _CRM_CONFIG.tabActivo;
            var currentMes = _CRM_CONFIG.mesFiltro;
            var currentAnio = _CRM_CONFIG.anioFiltro;

            var PRODUCT_COLS = ['ZEBRA', 'PANDUIT', 'APC', ['AVIGILON', 'AVIGILION'], 'GENETEC', 'AXIS', ['SOFTWARE', 'Desarrollo'], 'RUNRATE', ['PÓLIZA', 'POLIZA']];

            function fmtMoney(s) { return '$' + s; }

            function fmtShort(val) {
                // Format number without decimals, with comma separators: 50000 -> "50,000"
                // Strip commas first: API returns "1,086" (Python format) which parseFloat reads as 1
                var n = parseFloat(String(val).replace(/,/g, ''));
                if (isNaN(n)) return val;
                return Math.round(n).toLocaleString('en-US');
            }

            function productMatch(prod, col) {
                if (Array.isArray(col)) return col.indexOf(prod) !== -1;
                return prod === col;
            }

            function isOtherProduct(prod) {
                for (var i = 0; i < PRODUCT_COLS.length; i++) {
                    if (productMatch(prod, PRODUCT_COLS[i])) return false;
                }
                return true;
            }

            function buildCrmRow(r) {
                var esBitrix = r.tipo_negociacion === 'bitrix_proyecto';
                var prodCells = '';
                if (esBitrix) {
                    // Pipeline Bitrix24: todas las celdas de producto muestran —, sin importes
                    var totalCols = PRODUCT_COLS.length + 1; // +1 por "Otros"
                    for (var i = 0; i < totalCols; i++) {
                        prodCells += '<td class="px-2 py-4 text-right"><span class="money-zero">—</span></td>';
                    }
                } else {
                    for (var i = 0; i < PRODUCT_COLS.length; i++) {
                        var match = productMatch(r.producto, PRODUCT_COLS[i]);
                        prodCells += '<td class="px-2 py-4 text-right">' + (match ? '<span class="text-blue-600 font-bold">$' + fmtShort(r.monto) + '</span>' : '<span class="money-zero">$0</span>') + '</td>';
                    }
                    // Otros
                    prodCells += '<td class="px-2 py-4 text-right">' + (isOtherProduct(r.producto) && r.producto ? '<span class="text-blue-600 font-bold">$' + fmtShort(r.monto) + '</span>' : '<span class="money-zero">$0</span>') + '</td>';
                }

                var nameStyle = '';
                var vencidaIcon = '';
                var rowExtraClass = '';
                if (r.tiene_actividad_vencida) {
                    nameStyle = ' style="color:#EF4444 !important;"';
                    vencidaIcon = '<span title="Actividad vencida" style="color:#EF4444;font-size:0.7rem;margin-left:4px;">&#9888;</span>';
                    rowExtraClass = ' crm-row-vencida';
                }

                // Badge para proyectos Bitrix24
                var bitrixBadge = esBitrix
                    ? '<span style="display:inline-block;background:#5856D6;color:#fff;font-size:0.55rem;font-weight:700;padding:1px 4px;border-radius:3px;margin-left:4px;vertical-align:middle;letter-spacing:0.04em;">B24</span>'
                    : '';

                var totalCell = esBitrix
                    ? '<td class="px-2 py-4 text-right font-black border-l border-gray-100 bg-gray-50/20"><span class="money-zero">$0</span></td>'
                    : '<td class="px-2 py-4 text-right font-black text-gray-900 border-l border-gray-100 bg-gray-50/20">$' + r.monto + '</td>';

                return '<tr class="crm-data-row' + rowExtraClass + '" data-opp-id="' + r.id + '" data-tipo="' + (r.tipo_negociacion || '') + '" data-etapa="' + (r.etapa || '') + '" data-fecha="' + (r.fecha_ts || '0') + '">' +
                    '<td class="px-2 py-4"><span class="opp-name-link" data-oportunidad-id="' + r.id + '"' + nameStyle + '>' + r.oportunidad + vencidaIcon + '</span>' + bitrixBadge +
                    '<span class="client-name-link text-[9px] text-gray-400 font-medium uppercase mt-1 cursor-pointer hover:text-blue-500 transition-colors block" data-cliente-id="' + (r.cliente_id || '') + '" data-tab="crm">' + (r.cliente || '- Sin Cliente -') + '</span></td>' +
                    '<td class="px-2 py-4 text-gray-600">' + r.contacto + '</td>' +
                    '<td class="px-2 py-4 text-gray-400 text-xs italic">' + r.area + '</td>' +
                    prodCells +
                    totalCell +
                    '</tr>';
            }

            function buildFacturadoRow(r) {
                var prodCells = '';
                var cols = ['zebra', 'panduit', 'apc', 'avigilon', 'genetec', 'axis', 'software', 'runrate', 'poliza', 'otros'];
                cols.forEach(function (c) {
                    var val = r[c] || '0';
                    prodCells += '<td class="px-2 py-4 text-right">' + (val !== '0' ? '<span class="text-blue-600 font-bold">$' + val + '</span>' : '<span class="money-zero">$0</span>') + '</td>';
                });
                return '<tr class="crm-data-row">' +
                    '<td class="px-2 py-4"><span class="client-name-link font-bold text-gray-900 leading-tight cursor-pointer hover:text-blue-600 transition-colors" data-cliente-id="' + r.cliente_id + '">' + r.cliente + '</span></td>' +
                    '<td class="px-2 py-4 text-gray-600">-</td>' +
                    '<td class="px-2 py-4 text-gray-400 text-xs italic">-</td>' +
                    prodCells +
                    '<td class="px-2 py-4 text-right font-black text-gray-900 border-l border-gray-100 bg-gray-50/20">$' + r.total + '</td>' +
                    '<td class="px-2 py-4 text-right font-bold border-l border-gray-100 bg-gray-50/20">$' + r.meta_cliente + '</td>' +
                    '<td class="px-2 py-4 text-right font-bold bg-gray-50/20">$' + r.meta_restante + '</td>' +
                    '<td class="px-2 py-3 text-center"><a href="/app/admin/crear-oportunidad/' + r.cliente_id + '" class="inline-block px-2 py-1.5 bg-blue-600 text-white rounded-lg text-[9px] font-black uppercase">Nuevo Deal</a></td>' +
                    '</tr>';
            }

            function buildCobradoRow(r) {
                return '<tr class="crm-data-row" data-opp-id="' + r.id + '">' +
                    '<td class="px-2 py-4"><span class="opp-name-link" data-oportunidad-id="' + r.id + '">' + r.oportunidad + '</span>' +
                    '<span class="client-name-link text-[9px] text-gray-400 font-medium uppercase mt-1 cursor-pointer hover:text-blue-500 transition-colors block" data-cliente-id="' + (r.cliente_id || '') + '" data-tab="crm">' + (r.cliente || '- Sin Cliente -') + '</span></td>' +
                    '<td class="px-2 py-4"><span class="text-xs font-medium text-gray-600">' + r.producto + '</span></td>' +
                    '<td class="px-2 py-4 text-gray-500 text-xs">' + r.usuario + '</td>' +
                    '<td class="px-2 py-4 text-center text-gray-400 text-xs">' + r.fecha + '</td>' +
                    '<td class="px-2 py-4 text-right font-black text-emerald-600">$' + r.monto + '</td>' +
                    '</tr>';
            }

            function buildCotizadoRow(r) {
                var oppCell = r.oportunidad
                    ? '<span class="opp-name-link" data-oportunidad-id="' + r.oportunidad_id + '">' + r.oportunidad + '</span>'
                    : '—';
                return '<tr class="crm-data-row" data-opp-id="' + (r.oportunidad_id || '') + '">' +
                    '<td class="px-2 py-4">' + oppCell +
                    '<span class="client-name-link text-[9px] text-gray-400 font-medium uppercase mt-1 cursor-pointer hover:text-blue-500 transition-colors block" data-cliente-id="' + (r.cliente_id || '') + '" data-tab="crm">' + (r.cliente || '- Sin Cliente -') + '</span></td>' +
                    '<td class="px-2 py-4"><a href="' + r.pdf_url + '" target="_blank" class="px-2 py-1 bg-blue-50 rounded text-xs font-mono font-bold text-blue-600 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-colors cursor-pointer" style="text-decoration:none;">COT-' + r.id + '</a></td>' +
                    '<td class="px-2 py-4 text-gray-500 text-xs">' + (r.usuario || '—') + '</td>' +
                    '<td class="px-2 py-4 text-right text-gray-400 font-medium">$' + r.subtotal + '</td>' +
                    '<td class="px-2 py-4 text-right font-black text-blue-600">$' + r.total + '</td>' +
                    '</tr>';
            }
        } catch (e) { console.error('Detail Error', e); }

        function getVendedoresParam() {
            var checks = document.querySelectorAll('.vf-user:checked');
            var allCheck = document.getElementById('vfAll');
            if (!allCheck || allCheck.checked || checks.length === 0) return '';
            var ids = [];
            checks.forEach(function (c) { ids.push(c.value); });
            return ids.join(',');
        }

        function refreshCrmTable() {
            var vendedores = getVendedoresParam();
            var url = '/app/api/crm-table-data/?tab=' + currentTab + '&mes=' + currentMes + '&anio=' + currentAnio;
            if (vendedores) url += '&vendedores=' + vendedores;
            fetch(url)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var tbody = null;
                    if (currentTab === 'cotizado') tbody = document.getElementById('cotizadoTbody');
                    else if (currentTab === 'cobrado') tbody = document.getElementById('cobradoTbody');
                    else if (currentTab === 'facturado') tbody = document.getElementById('facturadoTbody');
                    else tbody = document.getElementById('crmTbody');

                    if (!tbody) return;

                    if (data.rows.length === 0) {
                        var cols = currentTab === 'cotizado' ? 5 : currentTab === 'cobrado' ? 5 : currentTab === 'facturado' ? 17 : 14;
                        tbody.innerHTML = '<tr><td colspan="' + cols + '" class="text-center py-20 text-gray-400 italic">No hay datos disponibles para este periodo.</td></tr>';
                    } else {
                        var html = '';
                        for (var i = 0; i < data.rows.length; i++) {
                            if (currentTab === 'cotizado') html += buildCotizadoRow(data.rows[i]);
                            else if (currentTab === 'facturado') html += buildFacturadoRow(data.rows[i]);
                            else if (currentTab === 'cobrado') html += buildCobradoRow(data.rows[i]);
                            else html += buildCrmRow(data.rows[i]);
                        }
                        tbody.innerHTML = html;
                        if (typeof populateEtapaDatalist === 'function') populateEtapaDatalist();
                    }

                    // Update footer
                    document.getElementById('footerLeft').textContent = data.footer.left;
                    document.getElementById('footerRight').textContent = data.footer.right;

                    // Update vendor card stats if available
                    if (data.total_facturado !== undefined) {
                        var fa = document.getElementById('facturadoAmount');
                        if (fa) fa.textContent = '$' + data.total_facturado;
                    }
                    if (data.meta !== undefined) {
                        var md = document.getElementById('metaDisplay');
                        if (md) md.textContent = 'META: $' + data.meta;
                    }
                    if (data.progreso !== undefined) {
                        var pf = document.getElementById('progressFill');
                        if (pf) pf.style.width = data.progreso + '%';
                        var pct = document.getElementById('progressPct');
                        if (pct) pct.textContent = data.progreso + '%';
                    }

                    // Re-bind event listeners on new rows
                    bindTableEvents();
                    // Re-populate filter dropdowns with fresh data
                    populateIslandFilters();
                })
                .catch(function (err) { console.error('Error refreshing table:', err); });
        }

        function bindTableEvents() {
            // Re-bind opp-name-link clicks
            document.querySelectorAll('.opp-name-link').forEach(function (el) {
                el.addEventListener('click', function () {
                    var oppId = this.getAttribute('data-oportunidad-id');
                    if (oppId) openDetalle(oppId);
                });
            });
            // Re-bind cotizar buttons
            document.querySelectorAll('.btn-cotizar-widget').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    var oppId = this.getAttribute('data-oportunidad-id');
                    if (oppId) openCotizador(oppId);
                });
            });
        }

        // Track if a cotización was created to refresh on close
        var cotizacionCreated = false;

        window.addEventListener('message', function (e) {
            if (e.data && e.data.type === 'cotizacion-created') {
                cotizacionCreated = true;
                _crmTableDirty = true;
                if (typeof currentOppId !== 'undefined' && currentOppId && typeof openDetalle === 'function') {
                    openDetalle(currentOppId);
                }
            }
        });

        // "Cotizar" buttons in table (initial bind)
        document.querySelectorAll('.btn-cotizar-widget').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                var oppId = this.getAttribute('data-oportunidad-id');
                if (oppId) openCotizador(oppId);
            });
        });

        // ── Global Escape key ──
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (adminOverlay && adminOverlay.classList.contains('active')) { adminOverlay.classList.add('closing'); setTimeout(function () { adminOverlay.classList.remove('active', 'closing'); }, 250); return; }
                if (cotizadorOverlay.classList.contains('active')) { closeCotizador(); return; }
                if (detalleOverlay.classList.contains('active')) { closeDetalleWidget(); return; }
            }
        });

        // ── Search bar filter (global: busca en todos los años vía API) ──
        var searchInput = document.getElementById('islandSearch');
        var _searchTimer = null;
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                var q = this.value.trim();
                clearTimeout(_searchTimer);
                if (!q) {
                    // Sin query: restaurar tabla normal con filtros de mes/año
                    refreshCrmTable();
                    return;
                }
                // Con query: llamar API sin mes/año
                _searchTimer = setTimeout(function () {
                    var vendedores = getVendedoresParam();
                    var url = '/app/api/crm-table-data/?tab=' + currentTab + '&q=' + encodeURIComponent(q);
                    if (vendedores) url += '&vendedores=' + vendedores;
                    fetch(url).then(function (r) { return r.json(); }).then(function (data) {
                        var tbody = document.getElementById('crmTbody');
                        if (!tbody) return;
                        if (!data.rows || data.rows.length === 0) {
                            tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:2rem;color:#9CA3AF;">Sin resultados para "' + q + '"</td></tr>';
                        } else {
                            tbody.innerHTML = data.rows.map(buildCrmRow).join('');
                        }
                        if (data.footer) {
                            var fl = document.getElementById('footerLeft');
                            var fr = document.getElementById('footerRight');
                            if (fl) fl.textContent = data.footer.left;
                            if (fr) fr.textContent = data.footer.right;
                        }
                    });
                }, 350);
            });
        }

        // Vendor filter movido a script independiente arriba

        // ── XLS Upload (supervisor only) ──
        try {
            var btnUpload = document.getElementById('btnUploadXls');
            var fileInput = document.getElementById('xlsFileInput');
            if (btnUpload && fileInput) {
                btnUpload.addEventListener('click', function () {
                    fileInput.click();
                });
                fileInput.addEventListener('change', function () {
                    if (!this.files || !this.files[0]) return;
                    var file = this.files[0];
                    var fd = new FormData();
                    fd.append('archivo', file);
                    fd.append('mes', currentMes);
                    fd.append('anio', currentAnio);

                    btnUpload.textContent = 'Subiendo...';
                    btnUpload.disabled = true;

                    fetch('/app/api/subir-facturacion/', {
                        method: 'POST',
                        headers: { 'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]').value },
                        body: fd
                    })
                        .then(function (r) { return r.json(); })
                        .then(function (data) {
                            btnUpload.textContent = 'Subir Facturación';
                            btnUpload.disabled = false;
                            fileInput.value = '';

                            if (data.success) {
                                // Update the facturado amount
                                var fa = document.getElementById('facturadoAmount');
                                if (fa) fa.textContent = '$' + Number(data.total_facturado).toLocaleString('en-US', { maximumFractionDigits: 0 });

                                // Refresh table to update progress bar
                                refreshCrmTable();

                                // Show toast
                                var toast = document.createElement('div');
                                toast.className = 'wo-toast';
                                toast.textContent = 'Facturación actualizada: $' + Number(data.total_facturado).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' (' + data.num_clientes + ' clientes)';
                                document.body.appendChild(toast);
                                setTimeout(function () { toast.classList.add('show'); }, 10);
                                setTimeout(function () { toast.classList.remove('show'); setTimeout(function () { toast.remove(); }, 300); }, 3000);
                            } else {
                                alert('Error: ' + (data.error || 'Error desconocido'));
                            }
                        })
                        .catch(function (err) {
                            btnUpload.textContent = 'Subir Facturación';
                            btnUpload.disabled = false;
                            fileInput.value = '';
                            alert('Error de conexión');
                        });
                });
            }
        } catch (e) { console.error('Widget/Upload Error', e); }

        // ═══════════════════════════════════════════
        // ══  ADMIN PANEL  ═════════════════════════
        // ═══════════════════════════════════════════
        try {
            var adminOverlay = document.getElementById('adminOverlay');
            var btnAdmin = document.getElementById('btnAdminPanel');
            var adminContent = document.getElementById('adminContent');
            var adminClose = document.getElementById('adminClose');

            if (btnAdmin && adminOverlay) {
                btnAdmin.addEventListener('click', function () {
                    adminOverlay.classList.add('active');
                    adminOverlay.classList.remove('closing');
                    // Load first section
                    var firstBtn = adminOverlay.querySelector('.admin-nav-item.active');
                    if (firstBtn) loadAdminSection(firstBtn.getAttribute('data-section'));
                });

                adminClose.addEventListener('click', function () { closeAdmin(); });
                adminOverlay.addEventListener('click', function (e) {
                    if (e.target === adminOverlay) closeAdmin();
                });

                function closeAdmin() {
                    adminOverlay.classList.add('closing');
                    setTimeout(function () {
                        adminOverlay.classList.remove('active', 'closing');
                    }, 250);
                }

                // Sidebar navigation
                adminOverlay.querySelectorAll('.admin-nav-item').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        adminOverlay.querySelectorAll('.admin-nav-item').forEach(function (b) { b.classList.remove('active'); });
                        this.classList.add('active');
                        loadAdminSection(this.getAttribute('data-section'));
                    });
                });

                var csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;

                function loadAdminSection(section) {
                    adminContent.innerHTML = '<div style="text-align:center;color:#8E8E93;margin-top:40px;">Cargando...</div>';
                    if (section === 'usuarios') loadUsuarios();
                    else if (section === 'clientes') loadClientes();
                    else if (section === 'contactos') loadContactos();
                    else if (section === 'metas') loadMetas();
                    else if (section === 'permisos') loadPermisos();
                }

                // ── USUARIOS ──
                function loadUsuarios() {
                    fetch('/app/api/admin/usuarios/').then(function (r) { return r.json(); }).then(function (data) {
                        var html = '<div class="adm-section-title">Usuarios del Sistema</div>';
                        html += '<div style="margin-bottom:16px;"><button class="adm-btn adm-btn-primary" id="admNewUser">+ Nuevo Usuario</button></div>';
                        html += '<div id="admNewUserForm" style="display:none;background:#F9F9FB;border-radius:12px;padding:16px;margin-bottom:16px;">';
                        html += '<div class="adm-form-row"><input class="adm-input" id="nuUsername" placeholder="Username"><input class="adm-input" id="nuPassword" placeholder="Password" type="password"></div>';
                        html += '<div class="adm-form-row"><input class="adm-input" id="nuFirstName" placeholder="Nombre"><input class="adm-input" id="nuLastName" placeholder="Apellido"></div>';
                        html += '<div class="adm-form-row"><input class="adm-input" id="nuEmail" placeholder="Email" type="email"><select class="adm-input adm-select" id="nuRol"><option value="vendedor">Vendedor</option><option value="ingeniero">Ingeniero</option></select></div>';
                        html += '<div style="display:flex;gap:8px;margin-top:8px;"><button class="adm-btn adm-btn-primary" id="admSaveUser">Crear</button><button class="adm-btn adm-btn-secondary" id="admCancelUser">Cancelar</button></div>';
                        html += '</div>';
                        html += '<table class="adm-table"><thead><tr><th>Usuario</th><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th></tr></thead><tbody>';
                        data.usuarios.forEach(function (u) {
                            var rolLabel = u.is_supervisor ? 'Admin' : (u.rol === 'ingeniero' ? 'Ingeniero' : 'Vendedor');
                            var rolBadgeClass = u.is_supervisor ? 'adm-badge-blue' : (u.rol === 'ingeniero' ? 'adm-badge-purple' : 'adm-badge-gray');
                            var badge = '<span class="adm-badge ' + rolBadgeClass + '">' + rolLabel + '</span>';
                            var estado = u.is_active ? '<span class="adm-badge adm-badge-green">Activo</span>' : '<span class="adm-badge adm-badge-gray">Inactivo</span>';
                            html += '<tr class="adm-user-row" id="adm-user-row-' + u.id + '" style="cursor:pointer;"'
                                + ' data-uid="' + u.id + '" data-username="' + (u.username || '').replace(/"/g, '&quot;') + '"'
                                + ' data-fn="' + (u.first_name || '').replace(/"/g, '&quot;') + '"'
                                + ' data-ln="' + (u.last_name || '').replace(/"/g, '&quot;') + '"'
                                + ' data-email="' + (u.email || '').replace(/"/g, '&quot;') + '"'
                                + ' data-active="' + (u.is_active ? '1' : '0') + '"'
                                + ' data-rol="' + (u.rol || 'vendedor') + '"'
                                + ' onclick="admToggleEditRow(this)">';
                            html += '<td><strong>' + u.username + '</strong></td>';
                            html += '<td>' + u.first_name + ' ' + u.last_name + '</td>';
                            html += '<td>' + (u.email || '') + '</td>';
                            html += '<td>' + badge + '</td>';
                            html += '<td>' + estado + '</td>';
                            html += '</tr>';
                        });
                        html += '</tbody></table>';
                        adminContent.innerHTML = html;

                        document.getElementById('admNewUser').addEventListener('click', function () {
                            document.getElementById('admNewUserForm').style.display = 'block';
                            document.querySelectorAll('.adm-edit-inline-row').forEach(function (r) { r.remove(); });
                        });
                        document.getElementById('admCancelUser').addEventListener('click', function () {
                            document.getElementById('admNewUserForm').style.display = 'none';
                        });
                        document.getElementById('admSaveUser').addEventListener('click', function () {
                            var body = {
                                username: document.getElementById('nuUsername').value,
                                password: document.getElementById('nuPassword').value,
                                first_name: document.getElementById('nuFirstName').value,
                                last_name: document.getElementById('nuLastName').value,
                                email: document.getElementById('nuEmail').value,
                                rol: document.getElementById('nuRol').value,
                            };
                            fetch('/app/api/admin/usuarios/', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                                body: JSON.stringify(body)
                            }).then(function (r) { return r.json(); }).then(function (res) {
                                if (res.success) loadUsuarios();
                                else alert(res.error || 'Error');
                            });
                        });
                    });
                }

                function admToggleEditRow(row) {
                    var uid = row.dataset.uid;
                    var existing = document.getElementById('adm-edit-inline-' + uid);
                    if (existing) { existing.remove(); return; }
                    document.querySelectorAll('.adm-edit-inline-row').forEach(function (r) { r.remove(); });
                    document.getElementById('admNewUserForm').style.display = 'none';
                    var rolVal = row.dataset.rol || 'vendedor';
                    var rolOpts = '<option value="vendedor"' + (rolVal === 'vendedor' ? ' selected' : '') + '>Vendedor</option>'
                        + '<option value="ingeniero"' + (rolVal === 'ingeniero' ? ' selected' : '') + '>Ingeniero</option>';
                    var fn = (row.dataset.fn || '').replace(/"/g, '&quot;');
                    var ln = (row.dataset.ln || '').replace(/"/g, '&quot;');
                    var em = (row.dataset.email || '').replace(/"/g, '&quot;');
                    var chk = row.dataset.active === '1' ? ' checked' : '';
                    var editHtml = '<td colspan="5" style="padding:0;">'
                        + '<div style="background:#F0F4FF;border-radius:0 0 8px 8px;padding:14px 16px;border-top:2px solid #C7D4F0;">'
                        + '<div style="font-size:0.75rem;font-weight:700;color:#4A6FA5;margin-bottom:10px;">Editar: ' + row.dataset.username + '</div>'
                        + '<div class="adm-form-row"><input class="adm-input" id="euFirstName" placeholder="Nombre" value="' + fn + '"><input class="adm-input" id="euLastName" placeholder="Apellido" value="' + ln + '"></div>'
                        + '<div class="adm-form-row"><input class="adm-input" id="euEmail" placeholder="Email" type="email" value="' + em + '"><input class="adm-input" id="euPassword" placeholder="Nueva contraseña (vacío = sin cambio)" type="password"></div>'
                        + '<div class="adm-form-row" style="align-items:center;">'
                        + '<select class="adm-input adm-select" id="euRol">' + rolOpts + '</select>'
                        + '<label style="display:flex;align-items:center;gap:6px;font-size:0.75rem;color:#86868b;white-space:nowrap;"><input type="checkbox" id="euIsActive"' + chk + '>&nbsp;Activo</label>'
                        + '</div>'
                        + '<div style="display:flex;gap:8px;margin-top:10px;">'
                        + '<button class="adm-btn adm-btn-primary" id="admSaveEditUser-' + uid + '">Guardar</button>'
                        + '<button class="adm-btn adm-btn-secondary" onclick="this.closest(\'.adm-edit-inline-row\').remove()">Cancelar</button>'
                        + '</div></div></td>';
                    var tr = document.createElement('tr');
                    tr.id = 'adm-edit-inline-' + uid;
                    tr.className = 'adm-edit-inline-row';
                    tr.innerHTML = editHtml;
                    row.parentNode.insertBefore(tr, row.nextSibling);
                    tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    document.getElementById('admSaveEditUser-' + uid).addEventListener('click', function () {
                        var body = {
                            first_name: document.getElementById('euFirstName').value,
                            last_name: document.getElementById('euLastName').value,
                            email: document.getElementById('euEmail').value,
                            is_active: document.getElementById('euIsActive').checked,
                            password: document.getElementById('euPassword').value,
                            rol: document.getElementById('euRol').value,
                        };
                        fetch('/app/api/admin/usuarios/' + uid + '/', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                            body: JSON.stringify(body)
                        }).then(function (r) { return r.json(); }).then(function (res) {
                            if (res.success) loadUsuarios();
                            else alert(res.error || 'Error al guardar');
                        });
                    });
                }
                window.admToggleEditRow = admToggleEditRow;

                // ── CLIENTES ──
                function loadClientes() {
                    Promise.all([
                        fetch('/app/api/admin/clientes/').then(function (r) { return r.json(); }),
                        fetch('/app/api/admin/usuarios/').then(function (r) { return r.json(); })
                    ]).then(function (results) {
                        var clientes = results[0].clientes;
                        var usuarios = results[1].usuarios;
                        var html = '<div class="adm-section-title">Clientes (' + clientes.length + ')</div>';
                        html += '<table class="adm-table"><thead><tr><th>Empresa</th><th>Categor&iacute;a</th><th>Asignado a</th><th>Meta Mensual</th><th>Tel&eacute;fono</th></tr></thead><tbody>';
                        clientes.forEach(function (c) {
                            var options = '<option value="">Sin asignar</option>';
                            usuarios.forEach(function (u) {
                                var sel = u.id == c.asignado_a_id ? ' selected' : '';
                                options += '<option value="' + u.id + '"' + sel + '>' + (u.first_name + ' ' + u.last_name).trim() + '</option>';
                            });
                            html += '<tr><td><strong>' + c.nombre_empresa + '</strong></td>';
                            html += '<td>' + (c.categoria || '-') + '</td>';
                            html += '<td><select class="adm-select adm-assign-user" data-cliente-id="' + c.id + '">' + options + '</select></td>';
                            html += '<td><input type="number" class="adm-input adm-client-meta" data-cliente-id="' + c.id + '" value="' + (c.meta_mensual || 0) + '" style="width:100px;"></td>';
                            html += '<td>' + c.telefono + '</td></tr>';
                        });
                        html += '</tbody></table>';
                        html += '<div style="margin-top:16px;"><button class="adm-btn adm-btn-primary" id="admSaveClientMetas">Guardar Metas de Clientes</button></div>';
                        adminContent.innerHTML = html;

                        document.querySelectorAll('.adm-assign-user').forEach(function (sel) {
                            sel.addEventListener('change', function () {
                                var cid = this.getAttribute('data-cliente-id');
                                fetch('/app/api/admin/clientes/' + cid + '/', {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                                    body: JSON.stringify({ asignado_a_id: this.value ? parseInt(this.value) : null })
                                }).then(function (r) { return r.json(); }).then(function (res) {
                                    if (!res.success) alert(res.error || 'Error');
                                });
                            });
                        });

                        document.getElementById('admSaveClientMetas').addEventListener('click', function () {
                            var metas = {};
                            document.querySelectorAll('.adm-client-meta').forEach(function (inp) {
                                var cid = inp.getAttribute('data-cliente-id');
                                metas[cid] = inp.value;
                            });

                            fetch('/app/api/admin/clientes/metas/', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                                body: JSON.stringify({ metas: metas })
                            }).then(function (r) { return r.json(); }).then(function (res) {
                                if (res.success) {
                                    alert('Metas de clientes guardadas correctamente');
                                } else {
                                    alert(res.error || 'Error al guardar metas');
                                }
                            });
                        });
                    });
                }

                // ── CONTACTOS ──
                function loadContactos() {
                    fetch('/app/api/admin/clientes/').then(function (r) { return r.json(); }).then(function (data) {
                        var html = '<div class="adm-section-title">Contactos</div>';
                        html += '<div style="margin-bottom:16px;display:flex;gap:10px;align-items:center;">';
                        html += '<select class="adm-select" id="admContactCliente" style="min-width:200px;"><option value="">Seleccionar cliente...</option>';
                        data.clientes.forEach(function (c) {
                            html += '<option value="' + c.id + '">' + c.nombre_empresa + '</option>';
                        });
                        html += '</select></div>';
                        html += '<div id="admContactList"></div>';
                        adminContent.innerHTML = html;

                        document.getElementById('admContactCliente').addEventListener('change', function () {
                            var cid = this.value;
                            if (!cid) { document.getElementById('admContactList').innerHTML = ''; return; }
                            loadContactosForCliente(cid);
                        });
                    });
                }

                function loadContactosForCliente(clienteId) {
                    fetch('/app/api/admin/contactos/?cliente_id=' + clienteId).then(function (r) { return r.json(); }).then(function (data) {
                        var html = '<div style="margin-bottom:12px;"><button class="adm-btn adm-btn-primary" id="admNewContact">+ Nuevo Contacto</button></div>';
                        html += '<div id="admNewContactForm" style="display:none;background:#F9F9FB;border-radius:12px;padding:16px;margin-bottom:16px;">';
                        html += '<div class="adm-form-row"><input class="adm-input" id="ncNombre" placeholder="Nombre"><input class="adm-input" id="ncApellido" placeholder="Apellido"></div>';
                        html += '<div class="adm-form-row"><input class="adm-input" id="ncEmail" placeholder="Email"><input class="adm-input" id="ncTelefono" placeholder="Tel&eacute;fono"></div>';
                        html += '<div style="display:flex;gap:8px;margin-top:8px;"><button class="adm-btn adm-btn-primary" id="admSaveContact">Crear</button><button class="adm-btn adm-btn-secondary" id="admCancelContact">Cancelar</button></div>';
                        html += '</div>';

                        if (data.contactos.length === 0) {
                            html += '<div style="color:#8E8E93;text-align:center;padding:20px;">No hay contactos para este cliente</div>';
                        } else {
                            html += '<table class="adm-table"><thead><tr><th>Nombre</th><th>Email</th><th>Tel&eacute;fono</th></tr></thead><tbody>';
                            data.contactos.forEach(function (c) {
                                html += '<tr><td><strong>' + c.nombre + ' ' + c.apellido + '</strong></td><td>' + c.email + '</td><td>' + c.telefono + '</td></tr>';
                            });
                            html += '</tbody></table>';
                        }

                        document.getElementById('admContactList').innerHTML = html;

                        document.getElementById('admNewContact').addEventListener('click', function () {
                            document.getElementById('admNewContactForm').style.display = 'block';
                        });
                        document.getElementById('admCancelContact').addEventListener('click', function () {
                            document.getElementById('admNewContactForm').style.display = 'none';
                        });
                        document.getElementById('admSaveContact').addEventListener('click', function () {
                            var body = {
                                nombre: document.getElementById('ncNombre').value,
                                apellido: document.getElementById('ncApellido').value,
                                email: document.getElementById('ncEmail').value,
                                telefono: document.getElementById('ncTelefono').value,
                                empresa_id: parseInt(clienteId),
                            };
                            fetch('/app/api/admin/contactos/', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                                body: JSON.stringify(body)
                            }).then(function (r) { return r.json(); }).then(function (res) {
                                if (res.success) loadContactosForCliente(clienteId);
                                else alert(res.error || 'Error');
                            });
                        });
                    });
                }

                // ── METAS ──
                function loadMetas() {
                    fetch('/app/api/admin/usuarios/').then(function (r) { return r.json(); }).then(function (data) {
                        var fmt = function (v) { return parseFloat(String(v || 0).replace(/,/g, '')).toLocaleString('en-US', { maximumFractionDigits: 0 }); };
                        var html = '<div class="adm-section-title">Metas Mensuales por Vendedor</div>';
                        html += '<table class="adm-table"><thead><tr>';
                        html += '<th>Vendedor</th>';
                        html += '<th>Oportunidades (MXN)</th>';
                        html += '<th>Cotizado (MXN)</th>';
                        html += '<th>Cobrado (MXN)</th>';
                        html += '<th>Facturado (MXN)</th>';
                        html += '</tr></thead><tbody>';
                        data.usuarios.forEach(function (u) {
                            if (u.is_supervisor) return;
                            var inpStyle = 'max-width:130px;text-align:right;font-weight:600;';
                            html += '<tr>';
                            html += '<td><strong>' + (u.first_name + ' ' + u.last_name).trim() + '</strong><br><span style="color:#8E8E93;font-size:0.72rem;">@' + u.username + '</span></td>';
                            html += '<td><input class="adm-input adm-meta-input" data-uid="' + u.id + '" data-field="oportunidades" value="' + fmt(u.meta_oportunidades) + '" style="' + inpStyle + '"></td>';
                            html += '<td><input class="adm-input adm-meta-input" data-uid="' + u.id + '" data-field="cotizado"     value="' + fmt(u.meta_cotizado) + '" style="' + inpStyle + '"></td>';
                            html += '<td><input class="adm-input adm-meta-input" data-uid="' + u.id + '" data-field="cobrado"      value="' + fmt(u.meta_cobrado) + '" style="' + inpStyle + '"></td>';
                            html += '<td><input class="adm-input adm-meta-input" data-uid="' + u.id + '" data-field="mensual"      value="' + fmt(u.meta_mensual) + '" style="' + inpStyle + '"></td>';
                            html += '</tr>';
                        });
                        html += '</tbody></table>';
                        html += '<div style="margin-top:16px;"><button class="adm-btn adm-btn-primary" id="admSaveMetas">Guardar Metas</button></div>';
                        adminContent.innerHTML = html;

                        document.getElementById('admSaveMetas').addEventListener('click', function () {
                            var metas = {};
                            document.querySelectorAll('.adm-meta-input').forEach(function (inp) {
                                var uid = inp.getAttribute('data-uid');
                                var field = inp.getAttribute('data-field');
                                var val = inp.value.replace(/,/g, '').trim();
                                if (!metas[uid]) metas[uid] = {};
                                if (val) metas[uid][field] = val;
                            });
                            fetch('/app/api/admin/metas/', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                                body: JSON.stringify({ metas: metas })
                            }).then(function (r) { return r.json(); }).then(function (res) {
                                if (res.success) {
                                    var toast = document.createElement('div');
                                    toast.className = 'wo-toast';
                                    toast.textContent = res.updated + ' metas actualizadas';
                                    document.body.appendChild(toast);
                                    setTimeout(function () { toast.classList.add('show'); }, 10);
                                    setTimeout(function () { toast.classList.remove('show'); setTimeout(function () { toast.remove(); }, 300); }, 2000);
                                } else alert(res.error || 'Error');
                            });
                        });
                    });
                }

                // ── PERMISOS ──
                function loadPermisos() {
                    fetch('/app/api/admin/usuarios/').then(function (r) { return r.json(); }).then(function (data) {
                        var html = '<div class="adm-section-title">Permisos de Usuario</div>';
                        html += '<p style="color:#8E8E93;font-size:0.78rem;margin-bottom:16px;">Los administradores pueden ver datos de todos los vendedores, subir facturaci&oacute;n y acceder a este panel.</p>';
                        html += '<table class="adm-table"><thead><tr><th>Usuario</th><th>Nombre</th><th>Administrador</th></tr></thead><tbody>';
                        data.usuarios.forEach(function (u) {
                            var cls = u.is_supervisor ? 'adm-toggle on' : 'adm-toggle';
                            html += '<tr><td><strong>' + u.username + '</strong></td><td>' + (u.first_name + ' ' + u.last_name).trim() + '</td>';
                            html += '<td><button class="' + cls + ' adm-perm-toggle" data-uid="' + u.id + '"></button></td></tr>';
                        });
                        html += '</tbody></table>';
                        adminContent.innerHTML = html;

                        document.querySelectorAll('.adm-perm-toggle').forEach(function (btn) {
                            btn.addEventListener('click', function () {
                                var uid = this.getAttribute('data-uid');
                                var isOn = this.classList.contains('on');
                                var el = this;
                                fetch('/app/api/admin/permisos/' + uid + '/', {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                                    body: JSON.stringify({ is_supervisor: !isOn })
                                }).then(function (r) { return r.json(); }).then(function (res) {
                                    if (res.success) {
                                        if (res.is_supervisor) el.classList.add('on');
                                        else el.classList.remove('on');
                                    }
                                });
                            });
                        });
                    });
                }
            }

        } catch (e) { console.error('Admin Error', e); }

        // ═══════════════════════════════════════════════════════════
        // WIDGET: OPORTUNIDADES / COTIZACIONES / COBRADO POR CLIENTE
        // ═══════════════════════════════════════════════════════════

        try {
            var widgetClienteOpp = document.getElementById('widgetClienteOportunidades');
            var clienteOppClose = document.getElementById('clienteOppClose');
            var clienteOppTitle = document.getElementById('clienteOppTitle');
            var clienteOppTbody = document.getElementById('clienteOppTbody');
            var clienteOppSearch = document.getElementById('clienteOppSearch');
            var clienteOppFilterArea = document.getElementById('clienteOppFilterArea');
            var clienteOppFilterProducto = document.getElementById('clienteOppFilterProducto');
            var clienteOppClearFilters = document.getElementById('clienteOppClearFilters');
            var clienteOppFiltersOpp = document.getElementById('clienteOppFiltersOpp');
            var clienteOppHeadOpp = document.getElementById('clienteOppHeadOpp');
            var clienteOppHeadCot = document.getElementById('clienteOppHeadCot');

            var currentClienteId = null;
            var currentMode = 'oportunidades'; // 'oportunidades' | 'cobrado' | 'cotizado'
            var allClienteData = [];

            // ── Click en nombre de cliente ──
            document.addEventListener('click', function (e) {
                if (e.target.classList.contains('client-name-link')) {
                    var clienteId = e.target.getAttribute('data-cliente-id');
                    if (!clienteId) return;
                    var tab = e.target.getAttribute('data-tab') || 'crm';
                    var clienteNombre = e.target.textContent.trim();
                    openClienteModal(clienteId, clienteNombre, tab);
                }
            });

            // ── Cerrar widget ──
            if (clienteOppClose) {
                clienteOppClose.addEventListener('click', function () { widgetClienteOpp.style.display = 'none'; });
            }
            widgetClienteOpp.addEventListener('click', function (e) {
                if (e.target === widgetClienteOpp) widgetClienteOpp.style.display = 'none';
            });

            // ── Cambiar modo visual del widget ──
            function setWidgetMode(mode) {
                currentMode = mode;
                var isCot = (mode === 'cotizado');
                if (clienteOppHeadOpp) clienteOppHeadOpp.style.display = isCot ? 'none' : '';
                if (clienteOppHeadCot) clienteOppHeadCot.style.display = isCot ? '' : 'none';
                if (clienteOppFiltersOpp) clienteOppFiltersOpp.style.display = isCot ? 'none' : '';
            }

            // ── Abrir widget ──
            function openClienteModal(clienteId, clienteNombre, tab) {
                currentClienteId = clienteId;
                allClienteData = [];
                var modeMap = { crm: 'oportunidades', cobrado: 'cobrado', cotizado: 'cotizado' };
                var mode = modeMap[tab] || 'oportunidades';
                var labelMap = { oportunidades: 'Oportunidades', cobrado: 'Cobrado', cotizado: 'Cotizaciones' };
                clienteOppTitle.textContent = labelMap[mode] + ' — ' + clienteNombre;
                widgetClienteOpp.style.display = 'flex';

                if (clienteOppSearch) clienteOppSearch.value = '';
                if (clienteOppFilterArea) clienteOppFilterArea.value = '';
                if (clienteOppFilterProducto) clienteOppFilterProducto.value = '';
                setWidgetMode(mode);

                var colspan = (mode === 'cotizado') ? '6' : '7';
                clienteOppTbody.innerHTML = '<tr><td colspan="' + colspan + '" class="text-center py-10 text-gray-400">Cargando...</td></tr>';

                var url = mode === 'cotizado'
                    ? '/app/api/cliente-cotizaciones/' + clienteId + '/'
                    : '/app/api/cliente-oportunidades/' + clienteId + '/' + (mode === 'cobrado' ? '?tipo=cobrado' : '');

                fetch(url)
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        allClienteData = data.rows || [];
                        renderClienteData();
                    })
                    .catch(function (err) {
                        console.error('Error cargando datos cliente:', err);
                        clienteOppTbody.innerHTML = '<tr><td colspan="' + colspan + '" class="text-center py-10 text-red-400">Error al cargar los datos</td></tr>';
                    });
            }

            // ── Renderizar filas según modo ──
            function renderClienteData() {
                var filtered = filterClienteData();
                var colspan = (currentMode === 'cotizado') ? '6' : '7';

                if (filtered.length === 0) {
                    clienteOppTbody.innerHTML = '<tr><td colspan="' + colspan + '" class="text-center py-10 text-gray-400">No se encontraron registros</td></tr>';
                    return;
                }

                var html = '';
                if (currentMode === 'cotizado') {
                    filtered.forEach(function (cot) {
                        html += '<tr class="hover:bg-blue-50/40 transition-colors">';
                        html += '<td class="px-2 py-3"><a href="' + (cot.pdf_url || '#') + '" target="_blank" class="px-2 py-1 bg-blue-50 rounded text-xs font-mono font-bold text-blue-600 border border-blue-200 hover:bg-blue-100 transition-colors" style="text-decoration:none;">COT-' + cot.id + '</a></td>';
                        html += '<td class="px-2 py-3 text-gray-700">' + truncate(cot.titulo || 'Cotización', 35) + '</td>';
                        html += '<td class="px-2 py-3 text-gray-500 text-xs">' + truncate(cot.oportunidad || '—', 30) + '</td>';
                        html += '<td class="px-2 py-3 text-gray-400 text-xs">' + (cot.fecha || '—') + '</td>';
                        html += '<td class="px-2 py-3 text-gray-500 text-xs">' + (cot.usuario || '—') + '</td>';
                        html += '<td class="px-2 py-3 text-right font-bold text-blue-600">$' + (cot.total || '0') + ' <span class="text-gray-400 font-normal text-[10px]">' + (cot.moneda || '') + '</span></td>';
                        html += '</tr>';
                    });
                } else {
                    filtered.forEach(function (opp) {
                        var contactoNombre = opp.contacto ? opp.contacto.nombre : '-';
                        var monto = formatCurrency(opp.monto_raw !== undefined ? opp.monto_raw : parseFloat((opp.monto || '0').toString().replace(/,/g, '')) || 0);
                        var probabilidad = opp.probabilidad_cierre || 0;
                        html += '<tr class="hover:bg-blue-50/40 transition-colors">';
                        html += '<td class="px-2 py-3"><span class="opp-name-link cursor-pointer text-blue-600 hover:text-blue-800" data-oportunidad-id="' + opp.id + '">' + truncate(opp.oportunidad, 40) + '</span></td>';
                        html += '<td class="px-2 py-3 text-gray-600">' + truncate(contactoNombre, 20) + '</td>';
                        html += '<td class="px-2 py-3 text-gray-500 text-xs">' + (opp.area || '-') + '</td>';
                        html += '<td class="px-2 py-3 text-gray-500 text-xs">' + (opp.producto || '-') + '</td>';
                        html += '<td class="px-2 py-3 text-right font-bold text-gray-900">$' + monto + '</td>';
                        html += '<td class="px-2 py-3 text-center"><span class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold">' + probabilidad + '%</span></td>';
                        if (currentMode === 'oportunidades') {
                            html += '<td class="px-2 py-3 text-center"><button class="btn-cotizar btn-cotizar-widget px-2 py-1 bg-blue-600 text-white rounded text-xs" data-oportunidad-id="' + opp.id + '">Cotizar</button></td>';
                        } else {
                            html += '<td class="px-2 py-3 text-center text-xs text-emerald-600 font-bold">Cobrado</td>';
                        }
                        html += '</tr>';
                    });
                }
                clienteOppTbody.innerHTML = html;
            }

            // ── Filtrar datos locales ──
            function filterClienteData() {
                var searchTerm = clienteOppSearch ? clienteOppSearch.value.toLowerCase() : '';
                var areaFilter = clienteOppFilterArea ? clienteOppFilterArea.value : '';
                var productoFilter = clienteOppFilterProducto ? clienteOppFilterProducto.value : '';

                return allClienteData.filter(function (item) {
                    if (currentMode === 'cotizado') {
                        return !searchTerm ||
                            (item.titulo && item.titulo.toLowerCase().includes(searchTerm)) ||
                            (item.oportunidad && item.oportunidad.toLowerCase().includes(searchTerm));
                    }
                    var matchSearch = !searchTerm ||
                        item.oportunidad.toLowerCase().includes(searchTerm) ||
                        (item.contacto && item.contacto.nombre.toLowerCase().includes(searchTerm));
                    var matchArea = !areaFilter || item.area === areaFilter;
                    var matchProducto = !productoFilter || item.producto === productoFilter;
                    return matchSearch && matchArea && matchProducto;
                });
            }

            if (clienteOppSearch) clienteOppSearch.addEventListener('input', renderClienteData);
            if (clienteOppFilterArea) clienteOppFilterArea.addEventListener('change', renderClienteData);
            if (clienteOppFilterProducto) clienteOppFilterProducto.addEventListener('change', renderClienteData);

            if (clienteOppClearFilters) {
                clienteOppClearFilters.addEventListener('click', function () {
                    if (clienteOppSearch) clienteOppSearch.value = '';
                    if (clienteOppFilterArea) clienteOppFilterArea.value = '';
                    if (clienteOppFilterProducto) clienteOppFilterProducto.value = '';
                    renderClienteData();
                });
            }

            // Compatibilidad con código anterior
            window.openClienteOportunidadesModal = function (clienteId, clienteNombre) {
                openClienteModal(clienteId, clienteNombre, 'crm');
            };

        } catch (e) { console.error('ClientOpp Error', e); }

        // Funciones auxiliares
        function formatCurrency(num) {
            return new Intl.NumberFormat('es-MX').format(num || 0);
        }

        function truncate(str, maxLen) {
            if (!str) return '';
            return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
        }

        // ═══════════════════════════════════════════════════════════
        // PANEL DE FILTROS AVANZADOS
        // ═══════════════════════════════════════════════════════════

        var btnToggleFilters = document.getElementById('btnToggleFilters');
        var btnCloseFilters = document.getElementById('btnCloseFilters');
        var filtersPanel = document.getElementById('filtersPanel');
        var filtersOverlay = document.getElementById('filtersOverlay');
        var btnApplyFilters = document.getElementById('btnApplyFilters');
        var btnClearFilters = document.getElementById('btnClearFilters');
        var btnExportExcel = document.getElementById('btnExportExcel');

        var currentFilters = {
            cliente: '',
            area: '',
            contacto: '',
            monto: '',
            producto: '',
            tipo: '',
            etapa: '',
            fecha: ''
        };

        // Abrir/Toggle filtros en la isla
        try {
            if (btnToggleFilters) {
                btnToggleFilters.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var island = document.getElementById('mainIsland');
                    if (island) {
                        island.classList.toggle('filters-open');
                        // Si se abre la isla de filtros, NO abrimos el panel lateral por defecto
                        // Pero si el usuario REALMENTE quiere el panel lateral, podemos poner un botón dentro de la isla abierta
                    }
                });
            }
        } catch (e) { console.error('Island Toggle Error', e); }

        // ── CRM bar filter panel toggle ──
        var btnToggleFilterPanel = document.getElementById('btnToggleFilterPanel');
        var crmFilterPanel = document.getElementById('crmFilterPanel');
        var crmBar = document.querySelector('.crm-bar');

        function closeFilterPanel() {
            if (crmFilterPanel) crmFilterPanel.classList.remove('open');
            if (btnToggleFilterPanel) btnToggleFilterPanel.classList.remove('active');
            if (crmBar) crmBar.classList.remove('filter-open');
            document.querySelectorAll('.crm-tabs .crm-tab').forEach(function (t) { t.style.display = ''; });
        }

        if (btnToggleFilterPanel && crmFilterPanel) {
            btnToggleFilterPanel.addEventListener('click', function (e) {
                e.stopPropagation();
                var isOpen = crmFilterPanel.classList.toggle('open');
                btnToggleFilterPanel.classList.toggle('active', isOpen);
                if (crmBar) crmBar.classList.toggle('filter-open', isOpen);
                document.querySelectorAll('.crm-tabs .crm-tab:not(.active)').forEach(function (t) {
                    t.style.display = isOpen ? 'none' : '';
                });
            });
            document.addEventListener('click', function (e) {
                if (!crmFilterPanel.contains(e.target) && e.target !== btnToggleFilterPanel) {
                    closeFilterPanel();
                }
            });
        }

        // Cerrar panel de filtros (legacy - filtersPanel removed)
        function closeFiltersPanel() {
            if (filtersPanel) filtersPanel.style.right = '-400px';
            if (filtersOverlay) filtersOverlay.style.display = 'none';
        }

        if (btnCloseFilters) {
            btnCloseFilters.addEventListener('click', closeFiltersPanel);
        }

        if (filtersOverlay) {
            filtersOverlay.addEventListener('click', closeFiltersPanel);
        }

        // ─── POPULATE ISLAND FILTER DROPDOWNS FROM TABLE DATA (Excel-like) ───
        function populateIslandFilters() {
            var activeTab = _CRM_CONFIG.tabActivo;
            var tbody = null;
            if (activeTab === 'crm') tbody = document.getElementById('crmTbody');
            else if (activeTab === 'cotizado') tbody = document.getElementById('cotizadoTbody');
            else if (activeTab === 'cobrado') tbody = document.getElementById('cobradoTbody');
            else if (activeTab === 'facturado') tbody = document.getElementById('facturadoTbody');

            if (!tbody) return;

            var clientes = new Set();
            var contactos = new Set();
            var areas = new Set();
            var productos = new Set();

            var rows = tbody.querySelectorAll('tr');
            rows.forEach(function (row) {
                var cells = row.querySelectorAll('td');
                if (cells.length < 3 || row.querySelector('td[colspan]')) return;

                // Col 0: Oportunidad (has client name in sub-text)
                var cell0 = cells[0];
                var subText = cell0.querySelector('div:last-child, span.text-gray-400, .text-\\[9px\\]');
                if (subText) {
                    var clientName = subText.textContent.trim();
                    if (clientName) clientes.add(clientName);
                } else {
                    // Try getting all text nodes
                    var divs = cell0.querySelectorAll('div');
                    if (divs.length > 1) {
                        var clientName = divs[divs.length - 1].textContent.trim();
                        if (clientName) clientes.add(clientName);
                    }
                }

                // Col 1: Contacto
                if (cells[1]) {
                    var contacto = cells[1].textContent.trim();
                    if (contacto && contacto !== '-') contactos.add(contacto);
                }

                // Col 2: Área
                if (cells[2]) {
                    var area = cells[2].textContent.trim();
                    if (area) areas.add(area);
                }

                // Productos: cols 3+ check for amounts > 0
                var prodNames = ['ZEBRA', 'PANDUIT', 'APC', 'AVIGILON', 'GENETEC', 'AXIS', 'SOFTWARE', 'RUNRATE', 'PÓLIZA', 'OTROS'];
                for (var i = 3; i < cells.length - 2 && i - 3 < prodNames.length; i++) {
                    var val = cells[i].textContent.replace(/[$,\s]/g, '');
                    if (parseFloat(val) > 0) {
                        productos.add(prodNames[i - 3]);
                    }
                }
            });

            function fillSelect(id, values, defaultLabel) {
                var sel = document.getElementById(id);
                if (!sel) return;
                var currentVal = sel.value;
                sel.innerHTML = '<option value="">' + defaultLabel + '</option>';
                var sorted = Array.from(values).sort(function (a, b) { return a.localeCompare(b); });
                sorted.forEach(function (v) {
                    var opt = document.createElement('option');
                    opt.value = v;
                    opt.textContent = v;
                    sel.appendChild(opt);
                });
                sel.value = currentVal;
            }

            fillSelect('filterCliente', clientes, 'Cliente: Todos');
            fillSelect('filterArea', areas, 'Área: Todas');
            fillSelect('filterProducto', productos, 'Producto: Todos');
        }

        // Run on load
        populateIslandFilters();

        // ─── ISLAND FILTER LISTENERS (immediate apply on change) ───
        function setupIslandFilterListener(id, field) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', function () {
                currentFilters[field] = this.value;
                applyFiltersToTable();
            });
        }

        setupIslandFilterListener('filterCliente', 'cliente');
        setupIslandFilterListener('filterArea', 'area');
        setupIslandFilterListener('filterProducto', 'producto');
        setupIslandFilterListener('filterMonto', 'monto');
        setupIslandFilterListener('filterTipo', 'tipo');
        // Text input: filter on every keystroke
        var filterContactoEl = document.getElementById('filterContacto');
        if (filterContactoEl) {
            filterContactoEl.addEventListener('input', function () {
                currentFilters.contacto = this.value;
                applyFiltersToTable();
            });
        }
        var filterEtapaEl = document.getElementById('filterEtapa');
        if (filterEtapaEl) {
            filterEtapaEl.addEventListener('input', function () {
                currentFilters.etapa = this.value;
                applyFiltersToTable();
            });
        }

        // Poblar datalist de etapas con valores únicos de las filas cargadas
        function populateEtapaDatalist() {
            var datalist = document.getElementById('etapaOptionsList');
            if (!datalist) return;
            var tbody = document.getElementById('crmTbody');
            if (!tbody) return;
            var seen = {};
            datalist.innerHTML = '';
            tbody.querySelectorAll('tr[data-etapa]').forEach(function (row) {
                var val = (row.dataset.etapa || '').trim();
                if (val && !seen[val]) {
                    seen[val] = true;
                    var opt = document.createElement('option');
                    opt.value = val;
                    datalist.appendChild(opt);
                }
            });
        }
        populateEtapaDatalist();

        // Filtro orden por fecha
        setupIslandFilterListener('filterFecha', 'fecha');

        // Limpiar filtros (Island button)
        var btnClearIsland = document.getElementById('btnClearIslandFilters');
        if (btnClearIsland) {
            btnClearIsland.addEventListener('click', function () {
                ['filterCliente', 'filterContacto', 'filterArea', 'filterProducto', 'filterMonto', 'filterTipo', 'filterEtapa', 'filterFecha'].forEach(function (id) {
                    var el = document.getElementById(id);
                    if (el) el.value = '';
                });
                currentFilters = { cliente: '', area: '', contacto: '', monto: '', producto: '', tipo: '', etapa: '', fecha: '' };
                applyFiltersToTable();
            });
        }

        // Aplicar filtros
        if (btnApplyFilters) {
            btnApplyFilters.addEventListener('click', function () {
                var fc = document.getElementById('filterCliente');
                var fa = document.getElementById('filterArea');
                var fcont = document.getElementById('filterContacto');
                var fm = document.getElementById('filterMonto');
                var fp = document.getElementById('filterProducto');
                var fe = document.getElementById('filterEtapa');
                var ff = document.getElementById('filterFecha');
                if (fc) currentFilters.cliente = fc.value;
                if (fa) currentFilters.area = fa.value;
                if (fcont) currentFilters.contacto = fcont.value;
                if (fm) currentFilters.monto = fm.value;
                if (fp) currentFilters.producto = fp.value;
                if (fe) currentFilters.etapa = fe.value;
                if (ff) currentFilters.fecha = ff.value;
                applyFiltersToTable();
                closeFilterPanel();
            });
        }

        // Limpiar filtros
        if (btnClearFilters) {
            btnClearFilters.addEventListener('click', function () {
                ['filterCliente', 'filterArea', 'filterContacto', 'filterMonto', 'filterProducto', 'filterTipo', 'filterEtapa', 'filterFecha'].forEach(function (id) {
                    var el = document.getElementById(id);
                    if (el) el.value = '';
                });
                currentFilters = { cliente: '', area: '', contacto: '', monto: '', producto: '', tipo: '', etapa: '', fecha: '' };
                applyFiltersToTable();
            });
        }

        // Aplicar filtros a la tabla activa
        function applyFiltersToTable() {
            var activeTab = _CRM_CONFIG.tabActivo;
            var tbody = null;

            if (activeTab === 'crm') {
                tbody = document.getElementById('crmTbody');
            } else if (activeTab === 'cotizado') {
                tbody = document.getElementById('cotizadoTbody');
            } else if (activeTab === 'cobrado') {
                tbody = document.getElementById('cobradoTbody');
            } else if (activeTab === 'facturado') {
                tbody = document.getElementById('facturadoTbody');
            }

            if (!tbody) return;

            var rows = Array.from(tbody.querySelectorAll('tr'));
            var filteredRows = rows.filter(function (row) {
                if (row.querySelector('td[colspan]')) return true; // Keep empty message row

                var cells = row.querySelectorAll('td');
                if (cells.length === 0) return false;

                // Filtro por cliente
                if (currentFilters.cliente) {
                    var cellText = cells[0].textContent.toLowerCase();
                    if (!cellText.includes(currentFilters.cliente.toLowerCase())) {
                        return false;
                    }
                }

                // Filtro por área
                if (currentFilters.area) {
                    var areaText = '';
                    // Assuming Area is roughly in column 2 or 3, but searching all for safety or targeting specific index if known
                    // Based on previous code, it searched all cells. Let's stick to searching all cells or specific index 2
                    if (cells[2] && cells[2].textContent.toLowerCase().includes(currentFilters.area.toLowerCase())) {
                        // match
                    } else {
                        // check strict column? Let's search row for now but column 2 is usually Area
                        // Previous logic: loop all cells.
                        var found = false;
                        for (var i = 0; i < cells.length; i++) {
                            if (cells[i].textContent.toLowerCase().includes(currentFilters.area.toLowerCase())) {
                                found = true;
                                break;
                            }
                        }
                        if (!found) return false;
                    }
                }

                // Filtro por contacto
                if (currentFilters.contacto) {
                    var found = false;
                    for (var i = 0; i < cells.length; i++) {
                        if (cells[i].textContent.toLowerCase().includes(currentFilters.contacto.toLowerCase())) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) return false;
                }

                // Filtro por producto
                if (currentFilters.producto) {
                    var found = false;
                    for (var i = 0; i < cells.length; i++) {
                        if (cells[i].textContent.toLowerCase().includes(currentFilters.producto.toLowerCase())) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) return false;
                }

                // Filtro por tipo de negociación (solo tab crm)
                if (currentFilters.tipo && activeTab === 'crm') {
                    var tipoVal = (row.dataset.tipo || '').toLowerCase();
                    if (tipoVal !== currentFilters.tipo) return false;
                }

                // Filtro por etapa (solo tab crm)
                if (currentFilters.etapa && activeTab === 'crm') {
                    var etapaVal = (row.dataset.etapa || '').toLowerCase();
                    if (!etapaVal.includes(currentFilters.etapa.toLowerCase())) return false;
                }

                return true;
            });

            // Ordenar por monto si se especificó
            if (currentFilters.monto) {
                filteredRows.sort(function (a, b) {
                    var montoA = extractMonto(a);
                    var montoB = extractMonto(b);

                    if (currentFilters.monto === 'desc') {
                        return montoB - montoA;
                    } else {
                        return montoA - montoB;
                    }
                });
            }

            // Ordenar por fecha si se especificó
            if (currentFilters.fecha) {
                filteredRows.sort(function (a, b) {
                    var fa = parseInt(a.dataset.fecha || '0', 10);
                    var fb = parseInt(b.dataset.fecha || '0', 10);
                    return currentFilters.fecha === 'desc' ? fb - fa : fa - fb;
                });
            }

            // Ocultar todas las filas
            rows.forEach(function (row) {
                row.style.display = 'none';
            });

            // Mostrar solo las filas filtradas
            filteredRows.forEach(function (row) {
                row.style.display = '';
            });
        }

        // Extraer monto de una fila
        function extractMonto(row) {
            var cells = row.querySelectorAll('td');
            var montoText = '';

            // Buscar la celda con el monto total (usualmente la última antes de acciones)
            for (var i = cells.length - 1; i >= 0; i--) {
                var text = cells[i].textContent.trim();
                if (text.startsWith('$')) {
                    montoText = text.replace(/[$,]/g, '');
                    break;
                }
            }

            return parseFloat(montoText) || 0;
        }

        // ═══════════════════════════════════════════════════════════
        // EXPORTAR A EXCEL
        // ═══════════════════════════════════════════════════════════

        if (btnExportExcel) {
            btnExportExcel.addEventListener('click', function () {
                if (typeof XLSX === 'undefined') {
                    alert('La librería de Excel no está disponible. Recarga la página e intenta de nuevo.');
                    return;
                }

                var activeTab = _CRM_CONFIG.tabActivo;
                var tabNames = { crm: 'Oportunidades', cotizado: 'Cotizado', cobrado: 'Cobrado', facturado: 'Facturado' };
                var tabName = tabNames[activeTab] || activeTab;

                var mes = _CRM_CONFIG.mesFiltro;
                var anio = _CRM_CONFIG.anioFiltro;
                var usuario = _CRM_CONFIG.usuarioNombre;

                var ahora = new Date();
                var fechaStr = ahora.toLocaleDateString('es-MX');
                var horaStr = ahora.toLocaleTimeString('es-MX');

                // Filtros aplicados
                var filtrosAplicados = [];
                if (currentFilters.cliente) filtrosAplicados.push('Cliente: ' + currentFilters.cliente);
                if (currentFilters.area) filtrosAplicados.push('Área: ' + currentFilters.area);
                if (currentFilters.contacto) filtrosAplicados.push('Contacto: ' + currentFilters.contacto);
                if (currentFilters.producto) filtrosAplicados.push('Producto: ' + currentFilters.producto);
                if (currentFilters.tipo) filtrosAplicados.push('Tipo: ' + (currentFilters.tipo === 'runrate' ? 'Runrate' : 'Proyecto'));
                if (currentFilters.monto) filtrosAplicados.push('Orden monto: ' + (currentFilters.monto === 'desc' ? 'Mayor → Menor' : 'Menor → Mayor'));
                var filtrosStr = filtrosAplicados.length > 0 ? filtrosAplicados.join(' | ') : 'Sin filtros';

                // Hoja 1: Información de la exportación
                var infoData = [
                    ['Campo', 'Valor'],
                    ['Usuario', usuario],
                    ['Fecha', fechaStr],
                    ['Hora', horaStr],
                    ['Tab exportado', tabName],
                    ['Mes', mes],
                    ['Año', anio],
                    ['Filtros aplicados', filtrosStr]
                ];

                // Hoja 2: Datos de la tabla
                var tbodyId = { crm: 'crmTbody', cotizado: 'cotizadoTbody', cobrado: 'cobradoTbody', facturado: 'facturadoTbody' }[activeTab];
                var tbody = document.getElementById(tbodyId);
                var tableData = [];

                if (tbody) {
                    var table = tbody.closest('table');
                    var headers = [];
                    if (table) {
                        table.querySelectorAll('thead th').forEach(function (th) {
                            headers.push(th.textContent.trim());
                        });
                    }
                    if (headers.length) tableData.push(headers);

                    Array.from(tbody.querySelectorAll('tr')).forEach(function (row) {
                        if (row.style.display === 'none') return;
                        if (row.querySelector('td[colspan]')) return;
                        var rowData = [];
                        row.querySelectorAll('td').forEach(function (td) {
                            rowData.push(td.textContent.trim().replace(/\s+/g, ' '));
                        });
                        if (rowData.length) tableData.push(rowData);
                    });
                }

                var wb = XLSX.utils.book_new();
                var wsInfo = XLSX.utils.aoa_to_sheet(infoData);
                wsInfo['!cols'] = [{ wch: 22 }, { wch: 50 }];
                XLSX.utils.book_append_sheet(wb, wsInfo, 'Info');

                if (tableData.length) {
                    var wsData = XLSX.utils.aoa_to_sheet(tableData);
                    XLSX.utils.book_append_sheet(wb, wsData, tabName);
                }

                var fileName = 'CRM_' + tabName + '_' + anio + '-' + mes + '_' + fechaStr.replace(/\//g, '-') + '.xlsx';
                XLSX.writeFile(wb, fileName);
            });
        }

        // ══════════════════════════════════════════════════════
        // ═══ TAREAS EN CRM - SWITCHING, CARGA Y MODALES ═══
        // ══════════════════════════════════════════════════════

        window._crmTareasMode = false;
        var _crmAllTareas = [];
        var _crmCurrentFilter = 'pendientes';
        var _crmCurrentTaskId = null;
        var _crmTimerInterval = null;

        // ── Switching CRM <-> Tareas ──
        var btnTareas = document.getElementById('btnTareas');
        var btnCRM = document.getElementById('btnCRM');
        var crmContent = document.getElementById('crmContentSection');
        var tareasSection = document.getElementById('tareasSection');
        var islandFilters = document.getElementById('islandFiltersSection');
        var islandSep = document.getElementById('islandSepFilters');
        var btnNeg = document.getElementById('btnNegociacion');

        try {
            if (btnTareas) {
                btnTareas.addEventListener('click', function () {
                    localStorage.setItem('crmView', 'tareas');
                    window._crmTareasMode = true;
                    if (crmContent) crmContent.style.display = 'none';
                    if (tareasSection) tareasSection.classList.add('active');

                    // Toggle active buttons
                    document.querySelectorAll('.island-nav-btn').forEach(function (b) { b.classList.remove('active'); });
                    btnTareas.classList.add('active');

                    // Change Negociacion -> Crear
                    if (btnNeg) btnNeg.textContent = 'Crear';

                    cargarTareasCRM();
                });
            }

            if (btnCRM) {
                btnCRM.addEventListener('click', function () {
                    localStorage.setItem('crmView', 'crm');
                    window._crmTareasMode = false;
                    if (crmContent) crmContent.style.display = '';
                    if (tareasSection) tareasSection.classList.remove('active');

                    document.querySelectorAll('.island-nav-btn').forEach(function (b) { b.classList.remove('active'); });
                    btnCRM.classList.add('active');

                    if (btnNeg) btnNeg.textContent = 'Negociacion';
                });
            }
        } catch (e) { console.error('Tasks Init Error', e); }

        // ── Cargar tareas desde API ──
        var _crmTareasPrioFilter = 'todas';
        var _crmTareasRespFilter = 'todos';


        window.updateGlobalNavBadges = function (counts) {
            // Tareas Vencidas Badge
            const btnTareas = document.getElementById('btnTareas');
            if (btnTareas) {
                let badge = btnTareas.querySelector('.tareas-red-badge');
                if (counts && counts.tareas > 0) {
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'tareas-red-badge';
                        badge.style.cssText = 'position:absolute;top:-4px;right:-8px;background:#EF4444;color:#fff;font-size:0.65rem;font-weight:700;padding:2px 5px;border-radius:10px;line-height:1;pointer-events:none;z-index:10;border:2px solid #fff;';
                        btnTareas.style.position = 'relative';
                        btnTareas.appendChild(badge);
                    }
                    // Specifically count vencidas in notif labels if possible, but requested by category is fine
                    badge.innerText = counts.tareas > 99 ? '99+' : counts.tareas;
                } else if (badge) {
                    badge.remove();
                }
            }

            // Muro Badge
            const btnMuro = document.getElementById('btnMuro');
            if (btnMuro) {
                let badge = btnMuro.querySelector('.muro-red-badge');
                if (counts && counts.muro > 0) {
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'muro-red-badge';
                        badge.style.cssText = 'position:absolute;top:-4px;right:-8px;background:#EF4444;color:#fff;font-size:0.65rem;font-weight:700;padding:2px 5px;border-radius:10px;line-height:1;pointer-events:none;z-index:10;border:2px solid #fff;';
                        btnMuro.style.position = 'relative';
                        btnMuro.appendChild(badge);
                    }
                    badge.innerText = counts.muro > 99 ? '99+' : counts.muro;
                } else if (badge) {
                    badge.remove();
                }
            }
        };

        function cargarTareasCRM() {
            var tbody = document.getElementById('tareasTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:3rem;color:#9CA3AF;">Cargando tareas...</td></tr>';

            fetch('/app/api/tareas/')
                .then(function (r) {
                    if (!r.ok) {
                        console.error('[Tareas] API status:', r.status);
                        return r.json().then(function (d) { throw new Error(d.error || 'Error ' + r.status); });
                    }
                    return r.json();
                })
                .then(function (data) {
                    if (data.success && Array.isArray(data.tareas)) {
                        _crmAllTareas = data.tareas;
                        // Poblar dropdown de responsables
                        var sel = document.getElementById('tareasFilterResponsable');
                        if (sel) {
                            var respSet = {};
                            data.tareas.forEach(function (t) { if (t.responsable) respSet[t.responsable] = 1; });
                            var current = sel.value;
                            sel.innerHTML = '<option value="todos">Todos los responsables</option>';
                            Object.keys(respSet).sort().forEach(function (r) {
                                var o = document.createElement('option');
                                o.value = r; o.textContent = r;
                                sel.appendChild(o);
                            });
                            if (current && respSet[current]) sel.value = current;
                        }
                        renderTareasCRM(_crmCurrentFilter);
                    } else {
                        console.error('[Tareas] Respuesta inesperada:', data);
                        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="tareas-empty">No se pudieron cargar las tareas.</td></tr>';
                    }
                })
                .catch(function (err) {
                    console.error('[Tareas] Error cargando tareas:', err);
                    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="tareas-empty">Error: ' + err.message + '</td></tr>';
                });
        }

        // ── Renderizar tabla de tareas ──

        document.addEventListener('DOMContentLoaded', function () {
            // Restore last view from localStorage
            if (localStorage.getItem('crmView') === 'tareas') {
                var btnTareas = document.getElementById('btnTareas');
                if (btnTareas) btnTareas.click();
            }

            // Refresh tasks every minute to check for new vencimientos
            setInterval(function () {
                if (typeof cargarTareasCRM === 'function') cargarTareasCRM();
            }, 60000);
        });

        function renderTareasCRM(filtro) {
            var tbody = document.getElementById('tareasTableBody');
            var countEl = document.getElementById('tareasCount');
            if (!tbody) return;

            var tareas = _crmAllTareas.slice();
            if (filtro === 'pendientes') {
                tareas = tareas.filter(function (t) { return t.estado !== 'completada'; });
            } else if (filtro === 'completadas') {
                tareas = tareas.filter(function (t) { return t.estado === 'completada'; });
            }

            // Apply priority filter
            if (_crmTareasPrioFilter && _crmTareasPrioFilter !== 'todas') {
                tareas = tareas.filter(function (t) { return t.prioridad === _crmTareasPrioFilter; });
            }
            // Apply responsable filter
            if (_crmTareasRespFilter && _crmTareasRespFilter !== 'todos') {
                tareas = tareas.filter(function (t) { return t.responsable === _crmTareasRespFilter; });
            }

            // Apply search filter
            var searchVal = (document.getElementById('tareasSearchInput') || {}).value || '';
            if (searchVal.trim()) {
                var q = searchVal.trim().toLowerCase();
                tareas = tareas.filter(function (t) { return t.titulo.toLowerCase().indexOf(q) !== -1; });
            }

            // Sort: vencidas primero, luego próximas por fecha, completadas al final
            var _now = new Date();
            tareas.sort(function (a, b) {
                var aDone = a.estado === 'completada';
                var bDone = b.estado === 'completada';
                var aVencida = !aDone && a.fecha_limite && new Date(a.fecha_limite) < _now;
                var bVencida = !bDone && b.fecha_limite && new Date(b.fecha_limite) < _now;
                if (aVencida && !bVencida) return -1;
                if (!aVencida && bVencida) return 1;
                if (aDone && !bDone) return 1;
                if (!aDone && bDone) return -1;
                var aT = a.fecha_limite ? new Date(a.fecha_limite).getTime() : Infinity;
                var bT = b.fecha_limite ? new Date(b.fecha_limite).getTime() : Infinity;
                return aT - bT;
            });

            // Update count
            if (countEl) countEl.innerHTML = '<strong>' + tareas.length + '</strong> tarea' + (tareas.length !== 1 ? 's' : '');

            if (tareas.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="tareas-empty">No hay tareas disponibles.</td></tr>';
                return;
            }

            tbody.innerHTML = tareas.map(function (t) { return createTaskRowCRM(t); }).join('');
        }

        function createTaskRowCRM(tarea) {
            var now2 = new Date();
            var done = tarea.estado === 'completada';
            var vencida = !done && tarea.fecha_limite && new Date(tarea.fecha_limite) < now2;
            var isHP = tarea.prioridad === 'alta' && !done;
            var rowBg = done ? 'background:rgba(52,199,89,0.07);' : (vencida ? 'background:rgba(255,59,48,0.07);' : '');
            var tituloStyle = done ? 'text-decoration:line-through;color:#9CA3AF;' : (vencida ? 'color:#FF3B30;' : '');
            var fechaStyle = vencida ? 'color:#FF3B30;font-weight:600;' : 'color:#6B7280;';
            var icon = isHP ? '<span style="color:#F59E0B;font-size:0.8rem;">&#9650;</span>' : (vencida ? '<span style="color:#FF3B30;font-size:0.8rem;">&#9888;</span>' : '');
            var oppCell;
            if (tarea.oportunidad_id) {
                var oppLabel = (tarea.oportunidad_nombre || 'Oportunidad');
                if (oppLabel.length > 35) oppLabel = oppLabel.substring(0, 33) + '…';
                oppCell = '<span style="color:#0052D4;font-size:0.75rem;font-weight:600;display:inline-flex;align-items:center;cursor:pointer;background:#EFF6FF;padding:2px 8px;border-radius:12px;border:1px solid #BFDBFE;" title="Oportunidad: ' + (tarea.oportunidad_nombre || '') + '" onclick="event.stopPropagation();openDetalle(' + tarea.oportunidad_id + ')"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>' + oppLabel + '</span>';
            } else if (tarea.proyecto_id) {
                var proyLabel = (tarea.proyecto_nombre || 'Proyecto');
                if (proyLabel.length > 35) proyLabel = proyLabel.substring(0, 33) + '…';
                oppCell = '<span style="color:#7C3AED;font-size:0.75rem;font-weight:600;display:inline-flex;align-items:center;cursor:pointer;background:#F5F3FF;padding:2px 8px;border-radius:12px;border:1px solid #DDD6FE;" title="Proyecto: ' + tarea.proyecto_nombre + '" onclick="event.stopPropagation();ingenieroAbrirProyecto(' + tarea.proyecto_id + ')"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' + proyLabel + '</span>';
            } else {
                oppCell = '<span class="crm-task-asignar-opp" data-task-id="' + tarea.id + '" style="color:#9CA3AF;font-size:0.78rem;cursor:pointer;text-decoration:underline dotted;" onclick="event.stopPropagation();crmTaskAbrirAsignarOpp(this,' + tarea.id + ')">Asignar...</span>';
            }
            return '<tr class="' + (isHP ? 'task-row-priority' : '') + '" style="' + rowBg + 'cursor:pointer;" onclick="crmTaskVerDetalle(' + tarea.id + ')">' +
                '<td><div style="display:flex;align-items:center;gap:0.4rem;">' + icon + '<span class="task-name" style="' + tituloStyle + '">' + tarea.titulo + '</span></div></td>' +
                '<td>' + getEstadoBadgeCRM(tarea.estado) + '</td>' +
                '<td style="' + fechaStyle + '">' + (tarea.fecha_limite ? formatearFechaCRM(tarea.fecha_limite) : 'Sin fecha') + '</td>' +
                '<td style="color:#6B7280;">' + tarea.creado_por + '</td>' +
                '<td style="color:#6B7280;">' + (tarea.responsable || 'Sin asignar') + '</td>' +
                '<td>' + oppCell + '</td>' +
                '</tr>';
        }

        // ── Dropdown para asignar oportunidad a tarea ──
        var _crmOppPickerTaskId = null;
        var _crmOppPickerTimer = null;
        function crmTaskAbrirAsignarOpp(anchor, tareaId) {
            var existing = document.getElementById('crmOppPickerDropdown');
            if (existing) existing.remove();
            if (_crmOppPickerTaskId === tareaId) { _crmOppPickerTaskId = null; return; }
            _crmOppPickerTaskId = tareaId;
            var drop = document.createElement('div');
            drop.id = 'crmOppPickerDropdown';
            drop.style.cssText = 'position:fixed;background:#fff;border:1px solid #E5E5EA;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.12);z-index:99999;width:280px;padding:8px;';
            drop.innerHTML = '<input id="crmOppPickerInput" placeholder="Buscar oportunidad..." style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #E5E5EA;border-radius:8px;font-size:0.82rem;outline:none;margin-bottom:6px;"><div id="crmOppPickerList" style="max-height:200px;overflow-y:auto;"></div>';
            document.body.appendChild(drop);
            var rect = anchor.getBoundingClientRect();
            drop.style.top = (rect.bottom + 4) + 'px';
            drop.style.left = Math.min(rect.left, window.innerWidth - 290) + 'px';
            var inp = document.getElementById('crmOppPickerInput');
            inp.focus();
            crmOppPickerSearch('');
            inp.addEventListener('input', function () {
                clearTimeout(_crmOppPickerTimer);
                _crmOppPickerTimer = setTimeout(function () { crmOppPickerSearch(inp.value); }, 250);
            });
            setTimeout(function () {
                document.addEventListener('click', function _closePicker(e) {
                    if (!drop.contains(e.target)) { drop.remove(); _crmOppPickerTaskId = null; document.removeEventListener('click', _closePicker); }
                });
            }, 50);
        }
        function crmOppPickerSearch(q) {
            var list = document.getElementById('crmOppPickerList');
            if (!list) return;
            list.innerHTML = '<div style="color:#9CA3AF;font-size:0.78rem;padding:6px;">Buscando...</div>';
            fetch('/app/api/buscar-oportunidades-proyecto/?q=' + encodeURIComponent(q))
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (!list) return;
                    var opps = data.oportunidades || [];
                    if (!opps.length) { list.innerHTML = '<div style="color:#9CA3AF;font-size:0.78rem;padding:6px;">Sin resultados</div>'; return; }
                    list.innerHTML = opps.map(function (o) {
                        var lbl = (o.titulo || o.oportunidad || '').substring(0, 40);
                        var cli = (o['cliente__nombre_empresa'] || o.cliente || '').substring(0, 25);
                        return '<div style="padding:7px 8px;border-radius:6px;cursor:pointer;font-size:0.82rem;" onmouseenter="this.style.background=\'#F2F2F7\'" onmouseleave="this.style.background=\'\'" onclick="crmOppPickerSelect(' + o.id + ',\'' + lbl.replace(/'/g, '') + '\')">' +
                            '<div style="font-weight:600;color:#1D1D1F;">' + lbl + '</div>' +
                            (cli ? '<div style="color:#8E8E93;font-size:0.72rem;">' + cli + '</div>' : '') +
                            '</div>';
                    }).join('');
                });
        }
        function crmOppPickerSelect(oppId, oppNombre) {
            var tareaId = _crmOppPickerTaskId;
            var drop = document.getElementById('crmOppPickerDropdown');
            if (drop) drop.remove();
            _crmOppPickerTaskId = null;
            if (!tareaId) return;
            fetch('/app/api/tarea/' + tareaId + '/actualizar/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]').value },
                body: JSON.stringify({ oportunidad_id: oppId })
            }).then(function (r) { return r.json(); }).then(function (res) {
                if (res.success) {
                    showToast('Oportunidad asignada', 'success');
                    cargarTareasCRM();
                } else {
                    showToast(res.error || 'Error al asignar', 'error');
                }
            });
        }

        function getEstadoBadgeCRM(estado) {
            var cfg = {
                'pendiente': { label: 'Pendiente', color: '#8E8E93', bg: 'rgba(142,142,147,0.12)' },
                'iniciada': { label: 'Pausado', color: '#FF9500', bg: 'rgba(255,149,0,0.12)' },
                'en_progreso': { label: 'En Progreso', color: '#0052D4', bg: 'rgba(0,82,212,0.1)' },
                'completada': { label: 'Completada', color: '#34C759', bg: 'rgba(52,199,89,0.12)' },
                'cancelada': { label: 'Cancelada', color: '#FF3B30', bg: 'rgba(255,59,48,0.12)' }
            };
            var c = cfg[estado] || cfg['pendiente'];
            return '<span class="task-estado-badge" style="background:' + c.bg + ';color:' + c.color + ';">' + c.label + '</span>';
        }

        function formatearFechaCRM(fechaStr) {
            if (!fechaStr) return '-';
            var f = new Date(fechaStr);
            return f.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        }

        // ── Tabs internos ──
        var tareasTabs = document.getElementById('tareasTabs');
        if (tareasTabs) {
            tareasTabs.addEventListener('click', function (e) {
                var btn = e.target.closest('.tareas-tab');
                if (!btn) return;
                tareasTabs.querySelectorAll('.tareas-tab').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                _crmCurrentFilter = btn.getAttribute('data-filter');
                renderTareasCRM(_crmCurrentFilter);
            });
        }

        // ── Filter panel toggle ──
        var tareasFilterBtn = document.getElementById('tareasFilterBtn');
        var tareasFilterPanel = document.getElementById('tareasFilterPanel');
        if (tareasFilterBtn && tareasFilterPanel) {
            tareasFilterBtn.addEventListener('click', function () {
                var open = tareasFilterPanel.classList.toggle('open');
                tareasFilterBtn.classList.toggle('active', open);
            });
            // Priority chip filter
            var prioChips = document.getElementById('tareasFilterPrioridad');
            if (prioChips) {
                prioChips.addEventListener('click', function (e) {
                    var chip = e.target.closest('.tareas-chip');
                    if (!chip) return;
                    prioChips.querySelectorAll('.tareas-chip').forEach(function (c) { c.classList.remove('active'); });
                    chip.classList.add('active');
                    _crmTareasPrioFilter = chip.getAttribute('data-prio');
                    renderTareasCRM(_crmCurrentFilter);
                });
            }
        }

        // ── Filtro responsable ──
        var tareasRespSel = document.getElementById('tareasFilterResponsable');
        if (tareasRespSel) {
            tareasRespSel.addEventListener('change', function () {
                _crmTareasRespFilter = this.value;
                renderTareasCRM(_crmCurrentFilter);
            });
        }

        // ── Búsqueda ──
        var tareasSearch = document.getElementById('tareasSearchInput');
        if (tareasSearch) {
            tareasSearch.addEventListener('input', function () {
                renderTareasCRM(_crmCurrentFilter);
            });
        }

        // ══════════════════════════════════
        // ═══ MODAL DETALLE TAREA ═══
        // ══════════════════════════════════

        // Store current opp id for drive/oportunidad actions
        var _crmTaskCurrentOppId = null;

        function crmTaskRenderData(tarea) {
            crmTaskSetText('crm-task-titulo', tarea.titulo);
            var descHtml = tarea.descripcion_html || (tarea.descripcion ? tarea.descripcion.replace(/\n/g, '<br>') : 'Sin descripción');
            crmTaskSetHTML('crm-task-descripcion', descHtml);

            // Prioridad badge (solo mostrar si es alta)
            var prioBadge = document.getElementById('crm-task-prioridad-badge');
            if (prioBadge) {
                if (tarea.prioridad === 'alta') {
                    prioBadge.style.display = 'inline-flex';
                    prioBadge.style.background = '#EF444412';
                    prioBadge.style.color = '#EF4444';
                    prioBadge.style.borderColor = '#EF444425';
                    crmTaskSetText('crm-task-prioridad-text', 'Alta');
                } else {
                    prioBadge.style.display = 'none';
                }
            }

            // Estado
            var estadoEl = document.getElementById('crm-task-estado');
            if (estadoEl) estadoEl.innerHTML = getEstadoBadgeCRM(tarea.estado);

            // Prioridad sidebar
            var prioSidebarWrap = document.getElementById('crmTaskPrioridadSidebarWrap');
            if (prioSidebarWrap) prioSidebarWrap.style.display = tarea.prioridad === 'alta' ? '' : 'none';

            // Botón terminar
            var btnTerminar = document.getElementById('crmTaskBtnTerminar');
            if (btnTerminar) {
                if (tarea.estado === 'completada') {
                    btnTerminar.classList.add('completada');
                    btnTerminar.textContent = 'Completada';
                    btnTerminar.disabled = true;
                } else {
                    btnTerminar.classList.remove('completada');
                    btnTerminar.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Terminar tarea';
                    btnTerminar.disabled = false;
                }
            }

            // Info sidebar
            crmTaskSetText('crm-task-fecha-limite', tarea.fecha_limite ? formatearFechaCRM(tarea.fecha_limite) : 'Sin fecha');
            crmTaskSetText('crm-task-creado-por', tarea.creado_por_data ? tarea.creado_por_data.nombre : tarea.creado_por);
            crmTaskSetText('crm-task-fecha-creacion', tarea.fecha_creacion ? formatearFechaCRM(tarea.fecha_creacion) : '--');

            // Cliente
            var clienteRow = document.getElementById('crmTaskClienteRow');
            if (tarea.cliente_nombre) {
                crmTaskSetText('crm-task-cliente-nombre', tarea.cliente_nombre);
                if (clienteRow) clienteRow.style.display = '';
            } else {
                if (clienteRow) clienteRow.style.display = 'none';
            }

            // Oportunidad card (in sidebar)
            _crmTaskCurrentOppId = tarea.oportunidad_id || null;
            var oppCard = document.getElementById('crmTaskOppCard');
            var driveCard = document.getElementById('crmTaskDriveCard');
            var sidebarLinks = document.getElementById('crmTaskSidebarLinks');
            if (tarea.oportunidad_id) {
                crmTaskSetText('crmTaskOppNombre', tarea.oportunidad_nombre || 'Oportunidad');
                crmTaskSetText('crmTaskOppCliente', tarea.cliente_nombre || '');
                if (oppCard) oppCard.style.display = 'flex';
                if (driveCard) driveCard.style.display = 'flex';
                if (sidebarLinks) sidebarLinks.style.display = '';
            } else {
                if (oppCard) oppCard.style.display = 'none';
                if (driveCard) driveCard.style.display = 'none';
                if (sidebarLinks) sidebarLinks.style.display = 'none';
            }

            // Responsable
            var respContainer = document.getElementById('crm-task-responsable-container');
            if (respContainer) {
                if (tarea.responsable_data) {
                    var rd = tarea.responsable_data;
                    var initials = crmTaskGetInitials(rd.nombre);
                    respContainer.innerHTML = '<div class="crm-task-avatar" style="background:#0052D4;">' + (rd.avatar_url ? '<img src="' + rd.avatar_url + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : initials) + '</div><span style="font-weight:500;font-size:0.85rem;">' + rd.nombre + '</span>';
                } else {
                    respContainer.innerHTML = '<span style="color:#9CA3AF;font-size:0.85rem;">Sin asignar</span>';
                }
            }

            _crmTaskLastData = tarea;
            var _curId = _CRM_CONFIG.userId;
            var _isSu = _CRM_CONFIG.isSuperuser;
            _crmTaskCanEdit = (
                _curId === (tarea.creado_por_data && tarea.creado_por_data.id ? tarea.creado_por_data.id : -1) || _isSu
            );
            _crmTaskEdits = {};
            _crmTaskOriginal = {
                titulo: tarea.titulo,
                descripcion: tarea.descripcion || '',
                fecha_limite: tarea.fecha_limite || null,
                responsable_id: tarea.responsable_data ? tarea.responsable_data.id : null,
                responsable_nombre: tarea.responsable_data ? tarea.responsable_data.nombre : null,
            };
            crmTaskRenderEditUI(tarea);
        }

        function crmTaskVerDetalle(tareaId) {
            _crmCurrentTaskId = tareaId;
            _crmTaskCurrentOppId = null;
            var modal = document.getElementById('crmTaskDetailModal');
            if (!modal) return;
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
            fetch('/app/api/tarea/' + tareaId + '/')
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (tarea) {
                    if (tarea.error) { showToast(tarea.error, 'error'); return; }
                    crmTaskRenderData(tarea);
                    crmTaskCargarComentarios(tareaId);
                })
                .catch(function (err) {
                    console.error('Error cargando tarea:', err);
                    showToast('Error al cargar la tarea', 'error');
                });
        }

        function crmTaskSetText(id, text) {
            var el = document.getElementById(id);
            if (el) el.textContent = text || '';
        }

        function crmTaskSetHTML(id, html) {
            var el = document.getElementById(id);
            if (el) el.innerHTML = html || '';
        }

        function crmTaskGetInitials(name) {
            if (!name) return '?';
            var parts = name.trim().split(/\s+/);
            return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].substring(0, 2).toUpperCase();
        }

        // ── Inline edit state ──
        var _crmTaskCanEdit = false;
        var _crmTaskEdits = {};
        var _crmTaskOriginal = {};
        var _crmTaskLastData = null;

        function crmTaskShowSaveBar() {
            var bar = document.getElementById('crmTaskSaveBar');
            if (bar) {
                bar.style.display = 'flex';
                // Add a small animation effect
                bar.style.animation = 'crmFadeInDown 0.3s ease';
            }
        }
        function crmTaskHideSaveBar() {
            var bar = document.getElementById('crmTaskSaveBar');
            if (bar) bar.style.display = 'none';
            _crmTaskEdits = {};
        }

        function crmTaskRenderEditUI(tarea) {
            _crmTaskLastData = tarea;
            crmTaskHideSaveBar();

            var partContainer = document.getElementById('crm-task-participantes-container');
            if (partContainer) {
                var parts = tarea.participantes || [];
                var html = parts.map(function (p) {
                    var rm = _crmTaskCanEdit ? '<span onclick="crmTaskRemoverInvolucrado(\'participantes\',' + p.id + ')" style="position:absolute;top:-3px;right:-3px;background:#EF4444;color:white;border-radius:50%;width:13px;height:13px;font-size:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;">x</span>' : '';
                    return '<div style="position:relative;display:inline-flex;width:28px;height:28px;border-radius:50%;background:#6366f1;align-items:center;justify-content:center;font-size:0.6rem;color:white;font-weight:700;" title="' + p.nombre + '">' + crmTaskGetInitials(p.nombre) + rm + '</div>';
                }).join('');
                if (_crmTaskCanEdit) html += '<button onclick="crmTaskAgregarInvolucrado(\'participantes\')" style="width:28px;height:28px;border-radius:50%;border:1.5px dashed #D1D5DB;background:none;color:#9CA3AF;cursor:pointer;font-size:1rem;line-height:1;vertical-align:middle;">+</button>';
                partContainer.innerHTML = html || '<span style="color:#9CA3AF;font-size:0.78rem;">Ninguno</span>';
            }

            var obsContainer = document.getElementById('crm-task-observadores-container');
            if (obsContainer) {
                var obs = tarea.observadores || [];
                var html2 = obs.map(function (o) {
                    var rm = _crmTaskCanEdit ? '<span onclick="crmTaskRemoverInvolucrado(\'observadores\',' + o.id + ')" style="position:absolute;top:-3px;right:-3px;background:#EF4444;color:white;border-radius:50%;width:13px;height:13px;font-size:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;">x</span>' : '';
                    return '<div style="position:relative;display:inline-flex;width:28px;height:28px;border-radius:50%;background:#8B5CF6;align-items:center;justify-content:center;font-size:0.6rem;color:white;font-weight:700;" title="' + o.nombre + '">' + crmTaskGetInitials(o.nombre) + rm + '</div>';
                }).join('');
                if (_crmTaskCanEdit) html2 += '<button onclick="crmTaskAgregarInvolucrado(\'observadores\')" style="width:28px;height:28px;border-radius:50%;border:1.5px dashed #D1D5DB;background:none;color:#9CA3AF;cursor:pointer;font-size:1rem;line-height:1;vertical-align:middle;">+</button>';
                obsContainer.innerHTML = html2 || '<span style="color:#9CA3AF;font-size:0.78rem;">Ninguno</span>';
            }

            if (_crmTaskCanEdit) {
                var respContainer = document.getElementById('crm-task-responsable-container');
                if (respContainer && !respContainer.querySelector('.crm-resp-edit-btn')) {
                    var editBtn = document.createElement('button');
                    editBtn.className = 'crm-resp-edit-btn';
                    editBtn.onclick = crmTaskEditarResponsable;
                    editBtn.style.cssText = 'margin-left:auto;background:none;border:1px solid #E5E5EA;color:#6B7280;cursor:pointer;font-size:0.72rem;padding:1px 7px;border-radius:4px;';
                    editBtn.textContent = 'editar';
                    respContainer.appendChild(editBtn);
                }
                var titleEl2 = document.getElementById('crm-task-titulo');
                if (titleEl2 && titleEl2.tagName === 'H1') {
                    titleEl2.style.cursor = 'pointer';
                    titleEl2.title = 'Clic para editar';
                    titleEl2.onclick = crmTaskEditarTitulo;
                }
                var fechaEl2 = document.getElementById('crm-task-fecha-limite');
                if (fechaEl2 && fechaEl2.tagName === 'SPAN') {
                    fechaEl2.style.cursor = 'pointer';
                    fechaEl2.title = 'Clic para editar';
                    fechaEl2.onclick = function () { crmTaskEditarFechaLimite(_crmTaskOriginal.fecha_limite); };
                }
                var clienteEl2 = document.getElementById('crm-task-cliente-nombre');
                if (clienteEl2) {
                    clienteEl2.style.cursor = 'pointer';
                    clienteEl2.style.color = '#0052D4';
                    clienteEl2.title = 'Clic para editar cliente';
                    clienteEl2.onclick = function () { crmTaskEditarCliente(clienteEl2.textContent); };
                }
                var descEl2 = document.getElementById('crm-task-descripcion');
                if (descEl2 && descEl2.tagName !== 'TEXTAREA') {
                    descEl2.style.cursor = 'pointer';
                    descEl2.title = 'Clic para editar descripción';
                    descEl2.onclick = crmTaskEditarDescripcion;
                }
            }
        }

        function crmTaskEditarDescripcion() {
            var descEl = document.getElementById('crm-task-descripcion');
            if (!descEl || descEl.tagName === 'TEXTAREA') return;
            var current = descEl.textContent === 'Sin descripción' ? '' : descEl.textContent;
            var ta = document.createElement('textarea');
            ta.id = 'crm-task-descripcion';
            ta.rows = 4;
            ta.value = current;
            ta.style.cssText = 'width:100%;border:1px solid #0052D4;border-radius:6px;padding:6px 8px;font-size:0.85rem;outline:none;color:#1D1D1F;resize:vertical;font-family:inherit;background:#FAFAFA;';
            descEl.replaceWith(ta); ta.focus();
            crmTaskShowSaveBar();
            ta.addEventListener('input', function () {
                if (ta.value !== _crmTaskOriginal.descripcion) {
                    _crmTaskEdits.descripcion = ta.value;
                } else { delete _crmTaskEdits.descripcion; }
            });
            ta.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') crmTaskCancelarEdicion();
                if (e.key === 'Enter' && e.ctrlKey) crmTaskGuardar();
            });
        }

        function crmTaskEditarTitulo() {
            var titleEl = document.getElementById('crm-task-titulo');
            if (!titleEl || titleEl.tagName !== 'H1') return;
            var current = titleEl.textContent;
            var inp = document.createElement('input');
            inp.type = 'text'; inp.value = current; inp.id = 'crm-task-titulo';
            inp.style.cssText = 'font-size:1.1rem;font-weight:700;width:100%;border:none;border-bottom:2px solid #0052D4;outline:none;background:transparent;color:#1D1D1F;padding:2px 0;';
            titleEl.replaceWith(inp); inp.focus(); inp.select();
            crmTaskShowSaveBar();
            inp.addEventListener('input', function () {
                if (inp.value.trim() && inp.value.trim() !== _crmTaskOriginal.titulo) {
                    _crmTaskEdits.titulo = inp.value.trim();
                } else { delete _crmTaskEdits.titulo; }
            });
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') crmTaskCancelarEdicion();
                if (e.key === 'Enter') { inp.blur(); crmTaskGuardar(); }
            });
        }

        function crmTaskEditarFechaLimite(currentIso) {
            var fechaEl = document.getElementById('crm-task-fecha-limite');
            if (!fechaEl) return;
            var inp = document.createElement('input');
            inp.type = 'datetime-local'; inp.id = 'crm-task-fecha-limite';
            inp.style.cssText = 'font-size:0.82rem;border:1px solid #0052D4;border-radius:6px;padding:2px 6px;outline:none;color:#1D1D1F;';
            if (currentIso) { try { var d = new Date(currentIso); inp.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); } catch (e) { } }
            fechaEl.replaceWith(inp); inp.focus();
            crmTaskShowSaveBar();
            inp.addEventListener('change', function () { _crmTaskEdits.fecha_limite = inp.value || ''; });
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') crmTaskCancelarEdicion();
                if (e.key === 'Enter') { inp.blur(); crmTaskGuardar(); }
            });
        }

        function crmTaskEditarResponsable() {
            var respContainer = document.getElementById('crm-task-responsable-container');
            if (!respContainer) return;
            crmTaskShowSaveBar();
            respContainer.innerHTML = '<div id="crmTaskRespSW" style="position:relative;width:100%;"></div>';
            var wrap = document.getElementById('crmTaskRespSW');
            var inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Buscar usuario...';
            inp.style.cssText = 'width:100%;border:1px solid #0052D4;border-radius:6px;padding:4px 8px;font-size:0.85rem;outline:none;';
            var dd = document.createElement('div');
            dd.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:white;border:1px solid #E5E5EA;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-height:180px;overflow-y:auto;z-index:200;display:none;';
            wrap.appendChild(inp); wrap.appendChild(dd); inp.focus();
            function buscarResp(q) {
                fetch('/app/api/buscar-usuarios/?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (data) {
                    var users = data.usuarios || []; dd.innerHTML = '';
                    if (!users.length) { dd.style.display = 'none'; return; }
                    users.forEach(function (u) {
                        var div = document.createElement('div'); div.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.85rem;';
                        var nombre = u.nombre_completo || u.nombre || u.username || ''; div.textContent = nombre;
                        div.addEventListener('mouseenter', function () { div.style.background = '#F3F4F6'; });
                        div.addEventListener('mouseleave', function () { div.style.background = ''; });
                        div.addEventListener('click', function () {
                            _crmTaskEdits.asignado_a = u.id;
                            _crmTaskEdits.asignado_a_nombre = nombre;
                            _crmTaskEdits.asignado_a_avatar = u.avatar_url || null;
                            crmTaskShowSaveBar();
                            respContainer.innerHTML = '<div class="crm-task-avatar" style="background:#0052D4;">' + crmTaskGetInitials(nombre) + '</div><span style="font-weight:500;font-size:0.85rem;">' + nombre + '</span>';
                            var eb = document.createElement('button'); eb.className = 'crm-resp-edit-btn'; eb.onclick = crmTaskEditarResponsable;
                            eb.style.cssText = 'margin-left:auto;background:none;border:1px solid #E5E5EA;color:#6B7280;cursor:pointer;font-size:0.72rem;padding:1px 7px;border-radius:4px;'; eb.textContent = 'editar';
                            respContainer.appendChild(eb);
                        });
                        dd.appendChild(div);
                    }); dd.style.display = 'block';
                });
            }
            inp.addEventListener('input', function () { buscarResp(this.value); });
            inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') crmTaskRenderEditUI(_crmTaskLastData); });
            buscarResp('');
        }

        function crmTaskAgregarInvolucrado(tipo) {
            var existing = document.getElementById('crmTaskInvSW'); if (existing) existing.remove();
            var cid = tipo === 'participantes' ? 'crm-task-participantes-container' : 'crm-task-observadores-container';
            var container = document.getElementById(cid); if (!container) return;
            var wrap = document.createElement('div'); wrap.id = 'crmTaskInvSW'; wrap.style.cssText = 'position:relative;width:100%;margin-top:6px;';
            var inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Buscar usuario...';
            inp.style.cssText = 'width:100%;border:1px solid #0052D4;border-radius:6px;padding:4px 8px;font-size:0.82rem;outline:none;';
            var dd = document.createElement('div');
            dd.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:white;border:1px solid #E5E5EA;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-height:160px;overflow-y:auto;z-index:200;display:none;';
            wrap.appendChild(inp); wrap.appendChild(dd); container.parentElement.appendChild(wrap); inp.focus();
            function buscarInv(q) {
                fetch('/app/api/buscar-usuarios/?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (data) {
                    var users = data.usuarios || []; dd.innerHTML = '';
                    if (!users.length) { dd.style.display = 'none'; return; }
                    users.forEach(function (u) {
                        var div = document.createElement('div'); div.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.82rem;';
                        var nombre = u.nombre_completo || u.nombre || u.username || ''; div.textContent = nombre;
                        div.addEventListener('mouseenter', function () { div.style.background = '#F3F4F6'; });
                        div.addEventListener('mouseleave', function () { div.style.background = ''; });
                        div.addEventListener('click', function () {
                            var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
                            fetch('/app/api/tarea/' + _crmCurrentTaskId + '/', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf ? csrf.value : '' }, body: JSON.stringify({ user_id: u.id, action: 'add', tipo: tipo }) })
                                .then(function (r) { return r.json(); }).then(function (d) { wrap.remove(); if (d.success) { crmTaskVerDetalle(_crmCurrentTaskId); } else { showToast(d.error || 'Error', 'error'); } });
                        });
                        dd.appendChild(div);
                    }); dd.style.display = 'block';
                });
            }
            inp.addEventListener('input', function () { buscarInv(this.value); });
            inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') wrap.remove(); });
            buscarInv('');
        }

        function crmTaskRemoverInvolucrado(tipo, userId) {
            var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
            fetch('/app/api/tarea/' + _crmCurrentTaskId + '/', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf ? csrf.value : '' }, body: JSON.stringify({ user_id: userId, action: 'remove', tipo: tipo }) })
                .then(function (r) { return r.json(); }).then(function (d) { if (d.success) { crmTaskVerDetalle(_crmCurrentTaskId); } else { showToast(d.error || 'Error', 'error'); } });
        }

        function crmTaskGuardar() {
            if (!Object.keys(_crmTaskEdits).length) { crmTaskHideSaveBar(); return; }
            var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
            var payload = {};
            if (_crmTaskEdits.titulo) payload.titulo = _crmTaskEdits.titulo;
            if ('descripcion' in _crmTaskEdits) payload.descripcion = _crmTaskEdits.descripcion;
            if ('fecha_limite' in _crmTaskEdits) payload.fecha_limite = _crmTaskEdits.fecha_limite;
            if ('asignado_a' in _crmTaskEdits) payload.asignado_a = _crmTaskEdits.asignado_a;
            if ('cliente_id' in _crmTaskEdits) payload.cliente_id = _crmTaskEdits.cliente_id;
            fetch('/app/api/tarea/' + _crmCurrentTaskId + '/actualizar/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf ? csrf.value : '' }, body: JSON.stringify(payload) })
                .then(function (r) { return r.json(); }).then(function (d) {
                    if (d.success) {
                        // Merge edits into _crmTaskLastData and re-render sin fetch
                        if (_crmTaskEdits.titulo) _crmTaskLastData.titulo = _crmTaskEdits.titulo;
                        if ('descripcion' in _crmTaskEdits) _crmTaskLastData.descripcion = _crmTaskEdits.descripcion;
                        if ('fecha_limite' in _crmTaskEdits) _crmTaskLastData.fecha_limite = _crmTaskEdits.fecha_limite;
                        if ('asignado_a' in _crmTaskEdits) {
                            _crmTaskLastData.responsable_data = {
                                id: _crmTaskEdits.asignado_a,
                                nombre: _crmTaskEdits.asignado_a_nombre || '',
                                avatar_url: _crmTaskEdits.asignado_a_avatar || null
                            };
                        }
                        if ('cliente_id' in _crmTaskEdits) {
                            _crmTaskLastData.cliente_id = _crmTaskEdits.cliente_id;
                            _crmTaskLastData.cliente_nombre = _crmTaskEdits.cliente_nombre || '';
                        }
                        crmTaskRenderData(_crmTaskLastData);
                        showToast('Tarea actualizada', 'success');
                        if (window._crmTareasMode) cargarTareasCRM();
                    } else { showToast(d.error || 'Error al guardar', 'error'); }
                }).catch(function () { showToast('Error de conexion', 'error'); });
        }

        function crmTaskCancelarEdicion() {
            crmTaskHideSaveBar();
            // Restaurar desde los datos en memoria sin fetch
            if (_crmTaskLastData) crmTaskRenderData(_crmTaskLastData);
        }

        function crmTaskCerrarModal() {
            var modal = document.getElementById('crmTaskDetailModal');
            if (modal) modal.classList.remove('active');
            document.body.style.overflow = '';
            _crmCurrentTaskId = null;
            if (_crmTimerInterval) { clearInterval(_crmTimerInterval); _crmTimerInterval = null; }
        }

        // Click outside to close
        var taskModal = document.getElementById('crmTaskDetailModal');
        if (taskModal) {
            taskModal.addEventListener('click', function (e) {
                if (e.target === taskModal) crmTaskCerrarModal();
            });
        }

        // ── Terminar tarea ──
        function crmTaskCompletar() {
            if (!_crmCurrentTaskId) return;
            var btn = document.getElementById('crmTaskBtnTerminar');
            if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
            var csrfEl = document.querySelector('[name=csrfmiddlewaretoken]');
            fetch('/app/api/tarea/' + _crmCurrentTaskId + '/completar/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrfEl ? csrfEl.value : '' }
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.success !== false) {
                        if (btn) {
                            btn.classList.add('completada');
                            btn.textContent = 'Completada';
                            btn.disabled = true;
                        }

                        var estadoEl = document.getElementById('crm-task-estado');
                        if (estadoEl) estadoEl.innerHTML = getEstadoBadgeCRM('completada');
                        showToast('Tarea completada', 'success');

                        // Marcar notificaciones de esta tarea como leidas
                        try {
                            fetch('/app/api/marcar-todas-notificaciones-leidas/', {
                                method: 'POST',
                                headers: { 'X-CSRFToken': csrfEl ? csrfEl.value : '', 'Content-Type': 'application/json' },
                                body: JSON.stringify({ 'tarea_id': _crmCurrentTaskId })
                            }).then(function () { if (typeof notifLoad === 'function') notifLoad(); });
                        } catch (ex) { }

                        // Actualizar en modo silencioso sin recargar tabla
                        if (_crmTaskLastData) _crmTaskLastData.estado = 'completada';
                        var idx = _crmAllTareas.findIndex(function (t) { return t.id === _crmCurrentTaskId; });
                        if (idx !== -1) {
                            _crmAllTareas[idx].estado = 'completada';
                            if (window._crmTareasMode) renderTareasCRM(_crmCurrentFilter);
                        }
                    } else {
                        if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Terminar tarea'; }
                        showToast(data.error || 'Error al completar', 'error');
                    }
                })
                .catch(function () {
                    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Terminar tarea'; }
                    showToast('Error de conexión', 'error');
                });
        }

        // ── Abrir oportunidad desde tarea ──
        function crmTaskAbrirOportunidad() {
            if (!_crmTaskCurrentOppId) return;
            crmTaskCerrarModal();
            setTimeout(function () {
                if (typeof openDetalle === 'function') openDetalle(_crmTaskCurrentOppId);
            }, 200);
        }

        // ── Abrir drive desde tarea ──
        function crmTaskAbrirDrive() {
            if (!_crmTaskCurrentOppId) return;
            if (typeof woSetCurrentOppId === 'function') woSetCurrentOppId(_crmTaskCurrentOppId);
            if (typeof woAbrirGestorDrive === 'function') woAbrirGestorDrive();
        }

        // ── Comentarios ──
        var _crmCurrentUserId = _CRM_CONFIG.userId;

        function crmTaskCargarComentarios(tareaId) {
            var feed = document.getElementById('crm-task-activity-feed');
            if (!feed) return;
            feed.innerHTML = '<div style="text-align:center;padding:1rem;color:#9CA3AF;">Cargando...</div>';

            fetch('/app/api/tarea/' + tareaId + '/comentarios/')
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.comentarios && data.comentarios.length > 0) {
                        feed.innerHTML = data.comentarios.map(function (c) {
                            var nombreUsuario = (c.usuario && c.usuario.nombre) ? c.usuario.nombre : 'Usuario';
                            var userId = c.usuario && c.usuario.id;
                            var initials = crmTaskGetInitials(nombreUsuario);
                            var avatarUrl = c.usuario && c.usuario.avatar_url;
                            var avatarHtml = avatarUrl
                                ? '<img src="' + avatarUrl + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">'
                                : initials;
                            var fecha = c.fecha_creacion || c.fecha || '';
                            var _localIsSu = _CRM_CONFIG.isSuperuser;
                            var canManage = (userId === _crmCurrentUserId || _localIsSu);
                            var menuHtml = canManage
                                ? '<div style="position:relative;display:inline-block;" class="crm-comment-menu-wrap">' +
                                '<button onclick="crmCommentToggleMenu(this)" style="background:none;border:none;cursor:pointer;color:#9CA3AF;padding:2px 6px;border-radius:4px;font-size:1rem;line-height:1;" title="Opciones">&#8943;</button>' +
                                '<div class="crm-comment-dropdown" style="display:none;position:absolute;right:0;top:100%;background:white;border:1px solid #E5E5EA;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.12);min-width:130px;z-index:50;">' +
                                '<button onclick="crmCommentEditar(' + c.id + ',this)" style="display:block;width:100%;text-align:left;padding:8px 14px;background:none;border:none;cursor:pointer;font-size:0.83rem;color:#1D1D1F;">Editar</button>' +
                                '<button onclick="crmCommentEliminar(' + c.id + ')" style="display:block;width:100%;text-align:left;padding:8px 14px;background:none;border:none;cursor:pointer;font-size:0.83rem;color:#EF4444;">Eliminar</button>' +
                                '</div></div>'
                                : '';
                            return '<div data-comment-id="' + c.id + '" style="display:flex;gap:0.75rem;padding:0.75rem;background:#F9FAFB;border-radius:10px;border:1px solid #F3F4F6;">' +
                                '<div class="crm-task-avatar" style="background:#0052D4;width:32px;height:32px;font-size:0.65rem;flex-shrink:0;">' + avatarHtml + '</div>' +
                                '<div style="flex:1;min-width:0;">' +
                                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">' +
                                '<span style="font-weight:600;font-size:0.85rem;color:#1D1D1F;">' + nombreUsuario + '</span>' +
                                '<div style="display:flex;align-items:center;gap:4px;">' +
                                '<span style="font-size:0.7rem;color:#9CA3AF;">' + (fecha ? formatearFechaCRM(fecha) : '') + '</span>' +
                                menuHtml + '</div></div>' +
                                '<div class="crm-comment-content" style="font-size:0.85rem;color:#374151;line-height:1.5;">' + (c.contenido_con_menciones || c.contenido || '') + '</div>' +
                                '</div></div>';
                        }).join('');
                        // Close menus on outside click
                        feed._menuClose = function (e) {
                            if (!e.target.closest('.crm-comment-menu-wrap')) {
                                feed.querySelectorAll('.crm-comment-dropdown').forEach(function (d) { d.style.display = 'none'; });
                            }
                        };
                        document.addEventListener('click', feed._menuClose);
                    } else {
                        feed.innerHTML = '<div style="text-align:center;padding:1rem;color:#9CA3AF;font-size:0.85rem;">No hay comentarios aún.</div>';
                    }
                })
                .catch(function (err) {
                    console.error('Error cargando comentarios:', err);
                    feed.innerHTML = '<div style="text-align:center;padding:1rem;color:#9CA3AF;">Error al cargar comentarios.</div>';
                });
        }

        function crmCommentToggleMenu(btn) {
            var dd = btn.nextElementSibling;
            var isOpen = dd.style.display === 'block';
            document.querySelectorAll('.crm-comment-dropdown').forEach(function (d) { d.style.display = 'none'; });
            if (!isOpen) dd.style.display = 'block';
        }

        function crmCommentEditar(commentId, btn) {
            var wrap = btn.closest('[data-comment-id]');
            if (!wrap) return;
            btn.closest('.crm-comment-dropdown').style.display = 'none';
            var contentEl = wrap.querySelector('.crm-comment-content');
            var currentText = contentEl.textContent;
            var ta = document.createElement('textarea');
            ta.value = currentText;
            ta.style.cssText = 'width:100%;border:1px solid #0052D4;border-radius:6px;padding:6px 8px;font-size:0.85rem;outline:none;resize:vertical;min-height:60px;';
            var saveBtn = document.createElement('button');
            saveBtn.textContent = 'Guardar';
            saveBtn.style.cssText = 'margin-top:4px;background:#0052D4;color:white;border:none;padding:4px 14px;border-radius:6px;cursor:pointer;font-size:0.82rem;font-weight:600;';
            var cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancelar';
            cancelBtn.style.cssText = 'margin-top:4px;margin-left:6px;background:none;border:1px solid #D1D5DB;color:#6B7280;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:0.82rem;';
            contentEl.replaceWith(ta);
            ta.after(saveBtn); saveBtn.after(cancelBtn);
            ta.focus();
            cancelBtn.onclick = function () { crmTaskCargarComentarios(_crmCurrentTaskId); };
            saveBtn.onclick = function () {
                var newText = ta.value.trim();
                if (!newText) return;
                var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
                var fd = new FormData(); fd.append('contenido', newText);
                fetch('/app/api/comentario-tarea/' + commentId + '/editar/', { method: 'POST', body: fd, headers: { 'X-CSRFToken': csrf ? csrf.value : '' } })
                    .then(function (r) { return r.json(); })
                    .then(function (d) { if (d.success) crmTaskCargarComentarios(_crmCurrentTaskId); else showToast(d.error || 'Error', 'error'); });
            };
        }

        function crmCommentEliminar(commentId) {
            var overlay = document.getElementById('crmCommentConfirmOverlay');
            var btn = document.getElementById('crmCommentConfirmBtn');
            if (!overlay || !btn) return;
            overlay.style.display = 'flex';
            btn.onclick = function () {
                overlay.style.display = 'none';
                var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
                var fd = new FormData();
                fetch('/app/api/comentario-tarea/' + commentId + '/eliminar/', { method: 'POST', body: fd, headers: { 'X-CSRFToken': csrf ? csrf.value : '' } })
                    .then(function (r) { return r.json(); })
                    .then(function (d) { if (d.success) crmTaskCargarComentarios(_crmCurrentTaskId); else showToast(d.error || 'Error', 'error'); });
            };
        }

        function crmCommentConfirmCancel() {
            var overlay = document.getElementById('crmCommentConfirmOverlay');
            if (overlay) overlay.style.display = 'none';
        }

        function crmTaskEditarCliente(currentClienteNombre) {
            var clienteEl = document.getElementById('crm-task-cliente-nombre');
            if (!clienteEl) return;
            var wrap = document.createElement('div');
            wrap.style.cssText = 'position:relative;width:100%;';
            var inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Buscar cliente (min 2 letras)...';
            inp.style.cssText = 'width:100%;border:1px solid #0052D4;border-radius:6px;padding:3px 8px;font-size:0.82rem;outline:none;';
            inp.value = currentClienteNombre || '';
            var dd = document.createElement('div');
            dd.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:white;border:1px solid #E5E5EA;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-height:180px;overflow-y:auto;z-index:200;display:none;';
            wrap.appendChild(inp); wrap.appendChild(dd);
            clienteEl.replaceWith(wrap); inp.focus();
            crmTaskShowSaveBar();
            function buscarCliente(q) {
                if (q.length < 2) { dd.style.display = 'none'; return; }
                fetch('/app/api/buscar-clientes/?q=' + encodeURIComponent(q))
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        var clientes = data.clientes || []; dd.innerHTML = '';
                        if (!clientes.length) { dd.style.display = 'none'; return; }
                        clientes.forEach(function (cl) {
                            var div = document.createElement('div'); div.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.82rem;';
                            div.textContent = cl.nombre;
                            div.addEventListener('mouseenter', function () { div.style.background = '#F3F4F6'; });
                            div.addEventListener('mouseleave', function () { div.style.background = ''; });
                            div.addEventListener('click', function () {
                                _crmTaskEdits.cliente_id = cl.id;
                                _crmTaskEdits.cliente_nombre = cl.nombre;
                                crmTaskShowSaveBar();
                                var span = document.createElement('span');
                                span.id = 'crm-task-cliente-nombre';
                                span.className = 'crm-task-info-value';
                                span.style.cssText = 'color:#0052D4;font-weight:600;cursor:pointer;';
                                span.textContent = cl.nombre;
                                span.onclick = function () { crmTaskEditarCliente(cl.nombre); };
                                wrap.replaceWith(span);
                                dd.style.display = 'none';
                            });
                            dd.appendChild(div);
                        }); dd.style.display = 'block';
                    });
            }
            inp.addEventListener('input', function () { buscarCliente(this.value); });
            inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') crmTaskVerDetalle(_crmCurrentTaskId); });
        }

        // Submit comment
        var commentForm = document.getElementById('crm-task-comment-form');
        if (commentForm) {
            commentForm.addEventListener('submit', function (e) {
                e.preventDefault();
                var input = document.getElementById('crm-task-comment-input');
                var contenido = input ? input.value.trim() : '';
                if (!contenido || !_crmCurrentTaskId) return;

                var formData = new FormData();
                formData.append('contenido', contenido);

                var csrfEl = document.querySelector('[name=csrfmiddlewaretoken]');
                if (csrfEl) formData.append('csrfmiddlewaretoken', csrfEl.value);

                fetch('/app/api/tarea/' + _crmCurrentTaskId + '/comentarios/agregar/', {
                    method: 'POST',
                    body: formData,
                    headers: { 'X-CSRFToken': csrfEl ? csrfEl.value : '' }
                })
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (data.success) {
                            input.value = '';
                            crmTaskCargarComentarios(_crmCurrentTaskId);
                        }
                    })
                    .catch(function (err) { console.error('Error enviando comentario:', err); });
            });
        }

        // ── Timer ──
        function crmTaskToggleTimer() {
            if (!_crmCurrentTaskId) return;
            var csrfEl = document.querySelector('[name=csrfmiddlewaretoken]');

            fetch('/app/api/tarea/' + _crmCurrentTaskId + '/toggle-timer/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfEl ? csrfEl.value : ''
                }
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var startBtn = document.getElementById('crm-task-btn-start');
                    var timerDisplay = document.getElementById('crm-task-timer-display');
                    if (!startBtn || !timerDisplay) return;

                    if (data.trabajando) {
                        startBtn.classList.add('running');
                        startBtn.querySelector('span').textContent = 'Pausar Tarea';
                        timerDisplay.style.display = 'block';
                        crmTaskStartTimerDisplay(data.tiempo_trabajado, data.fecha_inicio_sesion);
                    } else {
                        startBtn.classList.remove('running');
                        startBtn.querySelector('span').textContent = 'Iniciar Tarea';
                        if (_crmTimerInterval) { clearInterval(_crmTimerInterval); _crmTimerInterval = null; }
                        timerDisplay.textContent = data.tiempo_trabajado || '00:00:00';
                    }
                })
                .catch(function (err) { console.error('Error toggle timer:', err); });
        }

        function crmTaskStartTimerDisplay(baseTime, startISO) {
            if (_crmTimerInterval) clearInterval(_crmTimerInterval);
            var timerDisplay = document.getElementById('crm-task-timer-display');
            if (!timerDisplay) return;

            var baseParts = (baseTime || '00:00:00').split(':');
            var baseSeconds = parseInt(baseParts[0] || 0) * 3600 + parseInt(baseParts[1] || 0) * 60 + parseInt(baseParts[2] || 0);
            var startDate = startISO ? new Date(startISO) : new Date();

            function update() {
                var elapsed = Math.floor((Date.now() - startDate.getTime()) / 1000);
                var total = baseSeconds + elapsed;
                var h = Math.floor(total / 3600);
                var m = Math.floor((total % 3600) / 60);
                var s = total % 60;
                timerDisplay.textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
            }
            update();
            _crmTimerInterval = setInterval(update, 1000);
        }

        // ── Editable fields (placeholder) ──
        function crmTaskMakeEditable(field) {
            // Placeholder for inline editing - can be expanded
            console.log('Edit field:', field, 'Task:', _crmCurrentTaskId);
        }

        // ══════════════════════════════════
        // ═══ MODAL CREAR TAREA ═══
        // ══════════════════════════════════

        function crmTaskAbrirCrear(oppId) {
            var modal = document.getElementById('crmCreateTaskModal');
            if (modal) {
                modal.classList.add('active');
                document.body.style.overflow = 'hidden';
                // Set oportunidad silently if provided
                var oppIdEl = document.getElementById('crmTaskOppId');
                if (oppIdEl) oppIdEl.value = oppId || '';
                // Default due date: today + 1 hour
                var dueDateEl = document.getElementById('crmTaskDueDate');
                if (dueDateEl && !dueDateEl.value) {
                    var d = new Date();
                    d.setHours(d.getHours() + 1);
                    var pad = function (n) { return n < 10 ? '0' + n : n; };
                    dueDateEl.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
                }
                var titleInput = document.getElementById('crmTaskTitleInput');
                if (titleInput) titleInput.focus();
            }
        }

        function crmTaskCerrarCrear() {
            var modal = document.getElementById('crmCreateTaskModal');
            if (modal) modal.classList.remove('active');
            document.body.style.overflow = '';
            // Reset form
            var ti = document.getElementById('crmTaskTitleInput'); if (ti) ti.value = '';
            var de = document.getElementById('crmTaskDescEditor'); if (de) de.innerHTML = '';
            var hp = document.getElementById('crmTaskHighPriority'); if (hp) hp.checked = false;
            var dd = document.getElementById('crmTaskDueDate'); if (dd) dd.value = '';
            ['crmTaskSelectedResponsible', 'crmTaskSelectedParticipants', 'crmTaskSelectedObservers'].forEach(function (id) {
                var el = document.getElementById(id); if (el) el.innerHTML = '';
            });
            // Reset state
            _crmTaskSelectedResp = null;
            _crmTaskSelectedParts = [];
            _crmTaskSelectedObs = [];
            // Reset oportunidad
            var oid = document.getElementById('crmTaskOppId'); if (oid) oid.value = '';
            // Remove any open user dropdown
            var dd = document.querySelector('.crm-user-dropdown'); if (dd) dd.remove();
        }

        // Close create modal on outside click
        var createModal = document.getElementById('crmCreateTaskModal');
        if (createModal) {
            createModal.addEventListener('click', function (e) {
                if (e.target === createModal) crmTaskCerrarCrear();
            });
        }

        // Cap fecha límite de tarea a las 18:00
        var dueDateInp = document.getElementById('crmTaskDueDate');
        if (dueDateInp) {
            dueDateInp.addEventListener('change', function () {
                if (!this.value) return;
                var parts = this.value.split('T');
                if (parts.length === 2 && parts[1] > '18:00') {
                    this.value = parts[0] + 'T18:00';
                }
            });
        }

        // Assignment tabs in create modal
        document.querySelectorAll('.crm-create-task-assign-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.crm-create-task-assign-tab').forEach(function (t) { t.classList.remove('active'); });
                document.querySelectorAll('.crm-create-task-assign-panel').forEach(function (p) { p.classList.remove('active'); });
                tab.classList.add('active');
                var panel = document.getElementById(tab.getAttribute('data-panel'));
                if (panel) panel.classList.add('active');
            });
        });

        // User search for assignments
        var _crmTaskUsers = [];
        var _crmTaskSelectedResp = null;
        var _crmTaskSelectedParts = [];
        var _crmTaskSelectedObs = [];

        function crmTaskSearchUsers(query, callback) {
            // No cacheamos para asegurar que siempre traiga los resultados más recientes y no se pierdan usuarios por límites previos.
            fetch('/app/api/buscar-usuarios/?q=' + encodeURIComponent(query))
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    _crmTaskUsers = data.usuarios || data.results || [];
                    callback(_crmTaskUsers);
                })
                .catch(function () { callback([]); });
        }

        function _crmBuildUserDropdown(users, inputEl, onSelect) {
            var existing = document.querySelector('.crm-user-dropdown');
            if (existing) existing.remove();
            if (users.length === 0) return;

            var dropdown = document.createElement('div');
            dropdown.className = 'crm-user-dropdown';
            // Position fixed below input to bypass overflow:hidden parents
            var rect = inputEl.getBoundingClientRect();
            dropdown.style.cssText = 'position:fixed;top:' + (rect.bottom + 3) + 'px;left:' + rect.left + 'px;width:' + Math.max(rect.width, 220) + 'px;z-index:99999;';

            users.forEach(function (u) {
                var item = document.createElement('div');
                item.className = 'crm-user-dropdown-item';
                var initials = u.iniciales || (u.nombre || u.username || '?')[0].toUpperCase();
                item.innerHTML = '<span class="crm-user-avatar-sm">' + initials + '</span><span>' + (u.nombre || u.username) + '</span>';
                item.onmousedown = function (e) {
                    e.preventDefault(); // prevent blur before click fires
                    dropdown.remove();
                    if (inputEl) inputEl.value = '';
                    onSelect(u);
                };
                dropdown.appendChild(item);
            });

            document.body.appendChild(dropdown);

            function closeDropdown(e) {
                if (!dropdown.contains(e.target) && e.target !== inputEl) {
                    dropdown.remove();
                    document.removeEventListener('click', closeDropdown);
                }
            }
            setTimeout(function () { document.addEventListener('click', closeDropdown); }, 0);
        }

        // Responsible search
        var respSearch = document.getElementById('crmTaskResponsibleSearch');
        if (respSearch) {
            respSearch.addEventListener('input', function () {
                var q = this.value.trim();
                if (q.length < 1) { var dd = document.querySelector('.crm-user-dropdown'); if (dd) dd.remove(); return; }
                crmTaskSearchUsers(q, function (users) {
                    var container = document.getElementById('crmTaskSelectedResponsible');
                    if (!container) return;
                    _crmBuildUserDropdown(users, respSearch, function (u) {
                        _crmTaskSelectedResp = u;
                        var chip = document.createElement('div');
                        chip.className = 'crm-user-chip';
                        var initials = u.iniciales || (u.nombre || u.username || '?')[0].toUpperCase();
                        chip.innerHTML = '<span class="crm-user-avatar-sm">' + initials + '</span><span>' + (u.nombre || u.username) + '</span><button type="button" class="crm-chip-remove">&times;</button>';
                        chip.querySelector('.crm-chip-remove').onclick = function () { _crmTaskSelectedResp = null; chip.remove(); };
                        var prevChip = container.querySelector('.crm-user-chip'); if (prevChip) prevChip.remove();
                        container.appendChild(chip);
                    });
                });
            });
        }

        // Participants search
        var partsSearch = document.getElementById('crmTaskParticipantsSearch');
        if (partsSearch) {
            partsSearch.addEventListener('input', function () {
                var q = this.value.trim();
                if (q.length < 1) { var dd = document.querySelector('.crm-user-dropdown'); if (dd) dd.remove(); return; }
                crmTaskSearchUsers(q, function (users) {
                    var container = document.getElementById('crmTaskSelectedParticipants');
                    if (!container) return;
                    var available = users.filter(function (u) { return !_crmTaskSelectedParts.some(function (p) { return p.id === u.id; }); });
                    _crmBuildUserDropdown(available, partsSearch, function (u) {
                        _crmTaskSelectedParts.push(u);
                        var chip = document.createElement('div');
                        chip.className = 'crm-user-chip';
                        var initials = u.iniciales || (u.nombre || u.username || '?')[0].toUpperCase();
                        chip.innerHTML = '<span class="crm-user-avatar-sm">' + initials + '</span><span>' + (u.nombre || u.username) + '</span><button type="button" class="crm-chip-remove">&times;</button>';
                        chip.querySelector('.crm-chip-remove').onclick = function () { _crmTaskSelectedParts = _crmTaskSelectedParts.filter(function (p) { return p.id !== u.id; }); chip.remove(); };
                        container.appendChild(chip);
                    });
                });
            });
        }

        // Observers search
        var obsSearch = document.getElementById('crmTaskObserversSearch');
        if (obsSearch) {
            obsSearch.addEventListener('input', function () {
                var q = this.value.trim();
                if (q.length < 1) { var dd = document.querySelector('.crm-user-dropdown'); if (dd) dd.remove(); return; }
                crmTaskSearchUsers(q, function (users) {
                    var container = document.getElementById('crmTaskSelectedObservers');
                    if (!container) return;
                    var available = users.filter(function (u) { return !_crmTaskSelectedObs.some(function (o) { return o.id === u.id; }); });
                    _crmBuildUserDropdown(available, obsSearch, function (u) {
                        _crmTaskSelectedObs.push(u);
                        var chip = document.createElement('div');
                        chip.className = 'crm-user-chip';
                        var initials = u.iniciales || (u.nombre || u.username || '?')[0].toUpperCase();
                        chip.innerHTML = '<span class="crm-user-avatar-sm">' + initials + '</span><span>' + (u.nombre || u.username) + '</span><button type="button" class="crm-chip-remove">&times;</button>';
                        chip.querySelector('.crm-chip-remove').onclick = function () { _crmTaskSelectedObs = _crmTaskSelectedObs.filter(function (o) { return o.id !== u.id; }); chip.remove(); };
                        container.appendChild(chip);
                    });
                });
            });
        }

        function crmTaskCrear() {
            var titulo = (document.getElementById('crmTaskTitleInput') || {}).value || '';
            if (!titulo.trim()) { alert('El nombre de la tarea es requerido'); return; }

            var descEditor = document.getElementById('crmTaskDescEditor');
            var descripcion = descEditor ? (descEditor.innerText || descEditor.textContent) : '';
            var highPriority = (document.getElementById('crmTaskHighPriority') || {}).checked;
            var dueDate = (document.getElementById('crmTaskDueDate') || {}).value || '';

            var payload = {
                nombre: titulo.trim(),
                descripcion: descripcion.trim(),
                prioridad: highPriority ? 'alta' : 'media'
            };
            if (dueDate) payload.fecha_limite = dueDate;
            if (_crmTaskSelectedResp) payload.asignado_a = _crmTaskSelectedResp.id;
            if (_crmTaskSelectedParts.length > 0) payload.participantes = _crmTaskSelectedParts.map(function (u) { return u.id; });
            if (_crmTaskSelectedObs.length > 0) payload.observadores = _crmTaskSelectedObs.map(function (u) { return u.id; });
            var oppIdEl = document.getElementById('crmTaskOppId');
            if (oppIdEl && oppIdEl.value) payload.oportunidad_id = oppIdEl.value;

            var submitBtn = document.getElementById('crmTaskSubmitBtn');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creando...'; }

            fetch('/app/api/crear-tarea/', {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrf()
                }
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Crear tarea'; }
                    if (data.success) {
                        var oppId = oppIdEl ? oppIdEl.value : '';
                        crmTaskCerrarCrear();
                        cargarTareasCRM();
                        showToast('Tarea creada exitosamente', 'success');
                        if (typeof dashRefreshData === 'function') { dashRefreshData(); }
                        if (oppId && typeof window.woCargarTareasInline === 'function') {
                            window.woCargarTareasInline(oppId);
                        }
                        if (oppId && typeof refreshCrmTable === 'function') {
                            refreshCrmTable();
                        }
                        // Añadir al calendario como evento naranja si tiene fecha_limite
                        if (dueDate && typeof _globalCalendar !== 'undefined' && _globalCalendar) {
                            _globalCalendar.addEvent({
                                id: 'tarea-' + (data.id || Date.now()),
                                title: titulo.trim(),
                                start: dueDate,
                                color: '#FF9500',
                                extendedProps: { tipo_actividad: 'tarea', tarea_id: data.id }
                            });
                        }
                    } else {
                        alert(data.error || 'Error al crear la tarea');
                    }
                })
                .catch(function (err) {
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Crear tarea'; }
                    console.error('Error creando tarea:', err);
                    alert('Error al crear la tarea. Intenta recargar la página e intentarlo de nuevo.');
                });
        }


        window.refreshCrmTable = refreshCrmTable;

        // Expose to global scope for inline onclick handlers
        window.crmTaskVerDetalle = crmTaskVerDetalle;
        window.crmTaskRenderData = crmTaskRenderData;
        window.crmTaskCerrarModal = crmTaskCerrarModal;
        window.crmTaskToggleTimer = crmTaskToggleTimer;
        window.crmTaskMakeEditable = crmTaskMakeEditable;
        window.crmTaskAbrirCrear = crmTaskAbrirCrear;
        window.crmTaskCerrarCrear = crmTaskCerrarCrear;
        window.crmTaskCrear = crmTaskCrear;
        window.crmTaskCompletar = crmTaskCompletar;
        window.crmTaskAbrirOportunidad = crmTaskAbrirOportunidad;
        window.crmTaskAbrirDrive = crmTaskAbrirDrive;
        window.crmTaskGuardar = crmTaskGuardar;
        window.crmTaskCancelarEdicion = crmTaskCancelarEdicion;
        window.crmTaskRemoverInvolucrado = crmTaskRemoverInvolucrado;
        window.crmTaskAgregarInvolucrado = crmTaskAgregarInvolucrado;
        window.crmTaskEditarTitulo = crmTaskEditarTitulo;
        window.crmTaskEditarFechaLimite = crmTaskEditarFechaLimite;
        window.crmTaskEditarResponsable = crmTaskEditarResponsable;
        window.crmTaskEditarCliente = crmTaskEditarCliente;
        window.crmTaskEditarDescripcion = crmTaskEditarDescripcion;
        window.crmCommentToggleMenu = crmCommentToggleMenu;
        window.crmCommentEditar = crmCommentEditar;
        window.crmCommentEliminar = crmCommentEliminar;
        window.crmCommentConfirmCancel = crmCommentConfirmCancel;

    });


    document.addEventListener('DOMContentLoaded', function () {
        initDynamicIslandFilters();
    });

    function initDynamicIslandFilters() {
        // Identify active table body
        var activeTbody = null;
        if (document.getElementById('crmTbody')) activeTbody = document.getElementById('crmTbody');
        else if (document.getElementById('cotizadoTbody')) activeTbody = document.getElementById('cotizadoTbody');
        else if (document.getElementById('cobradoTbody')) activeTbody = document.getElementById('cobradoTbody');
        else if (document.getElementById('facturadoTbody')) activeTbody = document.getElementById('facturadoTbody');

        if (!activeTbody) return;

        // Get filter elements (filters panel removed, these return null safely)
        var fCliente = null;
        var fContacto = null;
        var fArea = null;
        var fProducto = null;
        var fMonto = null;
        var btnClear = document.getElementById('btnClearIslandFilters');

        // Store original rows for sorting/resetting
        var originalRows = Array.from(activeTbody.querySelectorAll('tr'));

        // Extract unique values
        var clientes = new Set();
        var contactos = new Set();
        var areas = new Set();
        var productos = new Set();

        originalRows.forEach(function (row) {
            if (row.dataset.cliente && row.dataset.cliente !== '- Sin Cliente -') clientes.add(row.dataset.cliente);
            if (row.dataset.contacto && row.dataset.contacto !== '-') contactos.add(row.dataset.contacto);
            if (row.dataset.area && row.dataset.area !== '-') areas.add(row.dataset.area);
            if (row.dataset.producto) productos.add(row.dataset.producto);
        });

        // Populate Selects
        function populateSelect(select, values, label) {
            if (!select) return;
            // Keep first option (placeholder)
            var first = select.firstElementChild;
            select.innerHTML = '';
            ect.appendChild(first);

            Array.from(values).sort().forEach(function (val) {
                var opt = document.createElement('option');
                opt.value = val;
                opt.textContent = val;
                select.appendChild(opt);
            });
        }

        populateSelect(fCliente, clientes);
        populateSelect(fContacto, contactos);
        populateSelect(fArea, areas);
        populateSelect(fProducto, productos);

        // Filter Function
        function applyFilters() {
            var vCliente = fCliente ? fCliente.value : '';
            var vContacto = fContacto ? fContacto.value : '';
            var vArea = fArea ? fArea.value : '';
            var vProducto = fProducto ? fProducto.value : '';
            var vMonto = fMonto ? fMonto.value : '';

            var visibleRows = [];
            var hiddenRows = [];

            originalRows.forEach(function (row) {
                var show = true;
                if (vCliente && row.dataset.cliente !== vCliente) show = false;
                if (vContacto && row.dataset.contacto !== vContacto) show = false;
                if (vArea && row.dataset.area !== vArea) show = false;
                if (vProducto && row.dataset.producto !== vProducto) show = false;

                row.style.display = show ? '' : 'none';
                if (show) visibleRows.push(row);
                else hiddenRows.push(row);
            });

            // Apply Sorting if Monto is selected
            if (vMonto && (vMonto === 'asc' || vMonto === 'desc')) {
                visibleRows.sort(function (a, b) {
                    var ma = parseFloat(a.dataset.monto || 0);
                    var mb = parseFloat(b.dataset.monto || 0);
                    return vMonto === 'desc' ? mb - ma : ma - mb;
                });

                // Re-append rows in new order
                // Note: This removes them from their current position and appends them
                // We must be careful not to lose the hidden rows
                activeTbody.innerHTML = '';
                visibleRows.forEach(function (r) { activeTbody.appendChild(r); });
                hiddenRows.forEach(function (r) { activeTbody.appendChild(r); });
            } else {
                // If no sort, restore original order of visible rows? 
                // Currently they are in original order because we iterated originalRows
            }
        }

        // Add Event Listeners
        if (fCliente) fCliente.addEventListener('change', applyFilters);
        if (fContacto) fContacto.addEventListener('change', applyFilters);
        if (fArea) fArea.addEventListener('change', applyFilters);
        if (fProducto) fProducto.addEventListener('change', applyFilters);
        if (fMonto) fMonto.addEventListener('change', applyFilters);

        if (btnClear) {
            btnClear.addEventListener('click', function () {
                if (fCliente) fCliente.value = '';
                if (fContacto) fContacto.value = '';
                if (fArea) fArea.value = '';
                if (fProducto) fProducto.value = '';
                if (fMonto) fMonto.value = '';

                activeTbody.innerHTML = '';
                originalRows.forEach(function (row) {
                    row.style.display = '';
                    activeTbody.appendChild(row);
                });
            });
        }
    }

    // ═══ EMPLEADOS WIDGET — SUPERVISOR ONLY ═══
    var _empCurrentMes = null, _empCurrentAnio = null;
    var _EMP_MES_NOMBRES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    function empleadosAbrir() {
        var overlay = document.getElementById('widgetEmpleados');
        if (!overlay) return;
        var topbarMes = document.getElementById('mesFilter');
        var topbarAnio = document.getElementById('anioFilter');
        if (topbarMes) {
            var mv = parseInt(topbarMes.value, 10);
            if (mv >= 1 && mv <= 12) _empCurrentMes = mv;
        }
        if (topbarAnio) _empCurrentAnio = parseInt(topbarAnio.value, 10) || new Date().getFullYear();
        if (!_empCurrentMes) _empCurrentMes = new Date().getMonth() + 1;
        if (!_empCurrentAnio) _empCurrentAnio = new Date().getFullYear();
        empInitDatePicker();
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        empCargarDatos();
    }
    window.empleadosAbrir = empleadosAbrir;

    function empCerrar() {
        var overlay = document.getElementById('widgetEmpleados');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    window.empCerrar = empCerrar;

    function empInitDatePicker() {
        var mesOpts = document.getElementById('empMesOpts');
        var anioOpts = document.getElementById('empAnioOpts');
        var label = document.getElementById('empDatePickerLabel');
        if (!mesOpts || !anioOpts) return;
        var mHtml = '';
        for (var m = 1; m <= 12; m++) {
            var mActive = m === _empCurrentMes ? 'background:#F0F4FF;color:#007AFF;font-weight:700;' : 'color:#1D1D1F;';
            mHtml += '<div style="padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.72rem;' + mActive + '"'
                + ' onclick="empSelectMes(' + m + ')">' + _EMP_MES_NOMBRES[m] + '</div>';
        }
        mesOpts.innerHTML = mHtml;
        var now = new Date();
        var aHtml = '';
        for (var y = now.getFullYear(); y >= now.getFullYear() - 3; y--) {
            var yActive = y === _empCurrentAnio ? 'background:#F0F4FF;color:#007AFF;font-weight:700;' : 'color:#1D1D1F;';
            aHtml += '<div style="padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.72rem;' + yActive + '"'
                + ' onclick="empSelectAnio(' + y + ')">' + y + '</div>';
        }
        anioOpts.innerHTML = aHtml;
        if (label) label.textContent = (_empCurrentMes ? _EMP_MES_NOMBRES[_empCurrentMes] : '—') + ' ' + (_empCurrentAnio || '—');
        var mesInp = document.getElementById('empMesFilter');
        var anioInp = document.getElementById('empAnioFilter');
        if (mesInp) mesInp.value = _empCurrentMes || '';
        if (anioInp) anioInp.value = _empCurrentAnio || '';
    }
    window.empInitDatePicker = empInitDatePicker;

    function empToggleDatePicker(ev) {
        if (ev) ev.stopPropagation();
        var dd = document.getElementById('empDatePickerDropdown');
        if (!dd) return;
        dd.style.display = dd.style.display === 'none' ? '' : 'none';
    }
    window.empToggleDatePicker = empToggleDatePicker;

    function empSelectMes(m) {
        _empCurrentMes = m;
        var dd = document.getElementById('empDatePickerDropdown');
        if (dd) dd.style.display = 'none';
        empInitDatePicker();
        empCargarDatos();
    }
    window.empSelectMes = empSelectMes;

    function empSelectAnio(y) {
        _empCurrentAnio = y;
        var dd = document.getElementById('empDatePickerDropdown');
        if (dd) dd.style.display = 'none';
        empInitDatePicker();
        empCargarDatos();
    }
    window.empSelectAnio = empSelectAnio;

    function empCargarDatos() {
        var mes = document.getElementById('empMesFilter');
        var anio = document.getElementById('empAnioFilter');
        var content = document.getElementById('empContent');
        if (!mes || !anio || !content) return;
        content.innerHTML = '<div style="text-align:center;padding:3rem;color:#8E8E93;font-size:0.85rem;">Cargando...</div>';
        fetch('/app/api/empleados/jornadas/?mes=' + mes.value + '&anio=' + anio.value)
            .then(function (r) { return r.json(); })
            .then(function (data) { empRenderDatos(data); })
            .catch(function () {
                content.innerHTML = '<div style="color:#FF3B30;padding:2rem;text-align:center;">Error cargando datos</div>';
            });
    }
    window.empCargarDatos = empCargarDatos;

    function empRenderDatos(data) {
        var content = document.getElementById('empContent');
        if (!content) return;
        var mesNom = _EMP_MES_NOMBRES[data.mes] || data.mes;
        var now = new Date();
        var isCurrentMonth = (data.mes === (now.getMonth() + 1) && data.anio === now.getFullYear());
        if (!data.empleados || data.empleados.length === 0) {
            content.innerHTML = '<div style="text-align:center;padding:3rem;color:#8E8E93;">Sin empleados activos</div>';
            return;
        }
        var colSpan = isCurrentMonth ? 6 : 5;
        var h = '<div style="font-size:0.72rem;font-weight:700;color:#8E8E93;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.06em;">'
            + mesNom + ' ' + data.anio + '</div>';
        h += '<table class="adm-table"><thead><tr>'
            + '<th style="text-align:left;">Empleado</th>'
            + '<th style="text-align:center;">Días</th>'
            + '<th style="text-align:center;">Horas Tot.</th>'
            + '<th style="text-align:center;">Efic. Prom.</th>';
        if (isCurrentMonth) h += '<th style="text-align:center;">Estado Hoy</th>';
        h += '<th></th></tr></thead><tbody>';

        data.empleados.forEach(function (emp) {
            var diasEntries = Object.entries(emp.dias).sort(function (a, b) { return parseInt(a[0]) - parseInt(b[0]); });
            var numDias = diasEntries.length;
            var totalHoras = 0, totalEfic = 0;
            diasEntries.forEach(function (e) { totalHoras += e[1].horas; totalEfic += e[1].eficiencia; });
            var avgEfic = numDias > 0 ? totalEfic / numDias : 0;
            var efColor = avgEfic >= 80 ? '#34C759' : avgEfic >= 50 ? '#FF9500' : avgEfic > 0 ? '#FF3B30' : '#8E8E93';
            var efText = numDias > 0 ? Math.round(avgEfic) + '%' : '&mdash;';
            var estadoTd = '';
            if (isCurrentMonth) {
                var est = emp.estado_hoy;
                if (est === 'activo') {
                    estadoTd = '<td style="text-align:center;"><span style="background:#E8F8ED;color:#34C759;font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:20px;">Activo</span></td>';
                } else if (est === 'pausa') {
                    estadoTd = '<td style="text-align:center;"><span style="background:#FFF5E6;color:#FF9500;font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:20px;">Pausa</span></td>';
                } else if (est === 'inactivo') {
                    estadoTd = '<td style="text-align:center;"><span style="background:#FFF0F0;color:#FF3B30;font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:20px;">Inactivo</span></td>';
                } else {
                    estadoTd = '<td style="text-align:center;color:#C7C7CC;font-size:0.8rem;">&mdash;</td>';
                }
            }
            h += '<tr style="cursor:pointer;" onclick="empToggleDetalle(' + emp.id + ')">'
                + '<td><strong>' + emp.nombre + '</strong></td>'
                + '<td style="text-align:center;">' + numDias + '</td>'
                + '<td style="text-align:center;">' + totalHoras.toFixed(1) + 'h</td>'
                + '<td style="text-align:center;color:' + efColor + ';font-weight:700;">' + efText + '</td>'
                + estadoTd
                + '<td style="text-align:center;font-size:0.7rem;color:#8E8E93;">&#9660;</td>'
                + '</tr>';

            h += '<tr id="empDetalle_' + emp.id + '" style="display:none;"><td colspan="' + colSpan + '" style="padding:0;">'
                + '<div style="padding:6px 12px 10px;background:#F9FAFB;border-top:1px solid #F2F2F7;">';
            if (diasEntries.length === 0) {
                h += '<span style="color:#8E8E93;font-size:0.72rem;">Sin registros este mes</span>';
            } else {
                h += '<table style="width:100%;font-size:0.68rem;border-collapse:collapse;">'
                    + '<thead><tr style="color:#8E8E93;"><th style="text-align:left;padding:2px 8px;">Fecha</th>'
                    + '<th style="text-align:right;padding:2px 8px;">Horas</th>'
                    + '<th style="text-align:right;padding:2px 8px;">Eficiencia</th></tr></thead><tbody>';
                diasEntries.forEach(function (entry) {
                    var d = entry[1];
                    var ef = Math.round(d.eficiencia);
                    var efc = ef >= 80 ? '#34C759' : ef >= 50 ? '#FF9500' : '#FF3B30';
                    var dStr = String(entry[0]).padStart(2, '0') + '/' + String(data.mes).padStart(2, '0') + '/' + data.anio;
                    h += '<tr style="border-bottom:1px solid #F2F2F7;">'
                        + '<td style="padding:3px 8px;">' + dStr + '</td>'
                        + '<td style="text-align:right;padding:3px 8px;">' + d.horas.toFixed(1) + 'h</td>'
                        + '<td style="text-align:right;padding:3px 8px;color:' + efc + ';font-weight:700;">' + ef + '%</td>'
                        + '</tr>';
                });
                h += '</tbody></table>';
            }
            h += '</div></td></tr>';
        });

        h += '</tbody></table>';
        content.innerHTML = h;
    }
    window.empRenderDatos = empRenderDatos;

    function empToggleDetalle(uid) {
        var row = document.getElementById('empDetalle_' + uid);
        if (!row) return;
        row.style.display = row.style.display === 'none' ? '' : 'none';
    }
    window.empToggleDetalle = empToggleDetalle;

    document.addEventListener('click', function (e) {
        var wrap = document.getElementById('empPickerWrap');
        if (wrap && !wrap.contains(e.target)) {
            var dd = document.getElementById('empDatePickerDropdown');
            if (dd) dd.style.display = 'none';
        }
    });

    // ═══ COTIZAR RÁPIDO ═══
    var _crClientes = [];

    function cotizarRapidoAbrir() {
        var overlay = document.getElementById('widgetCotizarRapido');
        if (!overlay) return;
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        crCargarClientes();
    }
    window.cotizarRapidoAbrir = cotizarRapidoAbrir;

    function cotizarRapidoCerrar() {
        var overlay = document.getElementById('widgetCotizarRapido');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
        var inp = document.getElementById('crClienteInput');
        if (inp) inp.value = '';
        var cid = document.getElementById('crClienteId');
        if (cid) cid.value = '';
        var dd = document.getElementById('crClienteDropdown');
        if (dd) dd.style.display = 'none';
        var secCl = document.getElementById('crNuevoClienteSection');
        if (secCl) secCl.style.display = 'none';
        var oppSel = document.getElementById('crOppSelect');
        if (oppSel) { oppSel.innerHTML = '<option value="">— seleccionar —</option>'; oppSel.disabled = true; }
        var sec = document.getElementById('crNuevaOppSection');
        if (sec) sec.style.display = 'none';
        var goBtn = document.getElementById('crGoBtn');
        if (goBtn) { goBtn.disabled = true; goBtn.style.opacity = '0.5'; goBtn.style.cursor = 'not-allowed'; }
    }
    window.cotizarRapidoCerrar = cotizarRapidoCerrar;

    function crCargarClientes() {
        fetch('/app/api/cotizar-rapido/clientes/')
            .then(function (r) { return r.json(); })
            .then(function (data) { _crClientes = data.clientes || []; });
    }
    window.crCargarClientes = crCargarClientes;

    function crFiltrarClientes() {
        var inp = document.getElementById('crClienteInput');
        var dd = document.getElementById('crClienteDropdown');
        var cid = document.getElementById('crClienteId');
        var q = inp ? inp.value.trim().toLowerCase() : '';
        if (cid) cid.value = '';
        // Reset opps when client changes
        var oppSel = document.getElementById('crOppSelect');
        if (oppSel) { oppSel.innerHTML = '<option value="">— seleccionar —</option>'; oppSel.disabled = true; }
        var goBtn = document.getElementById('crGoBtn');
        if (goBtn) { goBtn.disabled = true; goBtn.style.opacity = '0.5'; goBtn.style.cursor = 'not-allowed'; }
        if (!dd) return;
        if (!q) { dd.style.display = 'none'; return; }
        var filtered = _crClientes.filter(function (c) { return c.nombre.toLowerCase().indexOf(q) >= 0; }).slice(0, 12);
        if (filtered.length === 0) {
            dd.innerHTML = '<div style="padding:10px 12px;color:#8E8E93;font-size:0.78rem;">Sin resultados</div>';
        } else {
            dd.innerHTML = filtered.map(function (c) {
                return '<div style="padding:8px 12px;cursor:pointer;font-size:0.8rem;" '
                    + 'onmousedown="crSelectCliente(' + c.id + ',\'' + c.nombre.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">'
                    + c.nombre + '</div>';
            }).join('');
        }
        dd.style.display = '';
    }
    window.crFiltrarClientes = crFiltrarClientes;

    function crSelectCliente(id, nombre) {
        var inp = document.getElementById('crClienteInput');
        var cid = document.getElementById('crClienteId');
        var dd = document.getElementById('crClienteDropdown');
        if (inp) inp.value = nombre;
        if (cid) cid.value = id;
        if (dd) dd.style.display = 'none';
        var oppSel = document.getElementById('crOppSelect');
        if (oppSel) {
            oppSel.disabled = false;
            oppSel.innerHTML = '<option value="">Cargando...</option>';
            fetch('/app/api/cotizar-rapido/oportunidades/?cliente_id=' + id)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    oppSel.innerHTML = '<option value="">— seleccionar oportunidad —</option>';
                    (data.opps || []).forEach(function (o) {
                        oppSel.innerHTML += '<option value="' + o.id + '">' + o.nombre + '</option>';
                    });
                });
        }
    }
    window.crSelectCliente = crSelectCliente;

    function crOppChanged() {
        var oppSel = document.getElementById('crOppSelect');
        var goBtn = document.getElementById('crGoBtn');
        if (goBtn) {
            var hasVal = oppSel && oppSel.value;
            goBtn.disabled = !hasVal;
            goBtn.style.opacity = hasVal ? '1' : '0.5';
            goBtn.style.cursor = hasVal ? 'pointer' : 'not-allowed';
        }
    }
    window.crOppChanged = crOppChanged;

    function crToggleNuevoCliente() {
        var sec = document.getElementById('crNuevoClienteSection');
        if (!sec) return;
        sec.style.display = sec.style.display === 'none' ? '' : 'none';
    }
    window.crToggleNuevoCliente = crToggleNuevoCliente;

    function crCrearCliente() {
        var nombreInp = document.getElementById('crNuevoClienteNombre');
        var nombre = (nombreInp ? nombreInp.value : '').trim();
        if (!nombre) { alert('Escribe el nombre del cliente'); return; }
        var csrfMatch = document.cookie.match(/csrftoken=([^;]+)/);
        var csrf = csrfMatch ? csrfMatch[1] : '';
        fetch('/app/api/cotizar-rapido/clientes/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
            body: JSON.stringify({ nombre: nombre })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.id) {
                    _crClientes.push({ id: data.id, nombre: data.nombre });
                    crSelectCliente(data.id, data.nombre);
                    var sec = document.getElementById('crNuevoClienteSection');
                    if (sec) sec.style.display = 'none';
                    if (nombreInp) nombreInp.value = '';
                } else {
                    alert(data.error || 'Error al crear cliente');
                }
            })
            .catch(function () { alert('Error de conexión'); });
    }
    window.crCrearCliente = crCrearCliente;

    function crToggleNuevaOpp() {
        var sec = document.getElementById('crNuevaOppSection');
        if (!sec) return;
        sec.style.display = sec.style.display === 'none' ? '' : 'none';
    }
    window.crToggleNuevaOpp = crToggleNuevaOpp;

    function crCrearOpp() {
        var cid = document.getElementById('crClienteId');
        var nombreInp = document.getElementById('crNuevaOppNombre');
        var nombre = (nombreInp ? nombreInp.value : '').trim();
        if (!cid || !cid.value) { alert('Selecciona un cliente primero'); return; }
        if (!nombre) { alert('Escribe un nombre para la oportunidad'); return; }
        var csrfMatch = document.cookie.match(/csrftoken=([^;]+)/);
        var csrf = csrfMatch ? csrfMatch[1] : '';
        fetch('/app/api/cotizar-rapido/oportunidades/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
            body: JSON.stringify({ cliente_id: cid.value, nombre: nombre })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.id) {
                    var oppSel = document.getElementById('crOppSelect');
                    if (oppSel) {
                        var opt = document.createElement('option');
                        opt.value = data.id;
                        opt.textContent = data.nombre;
                        oppSel.insertBefore(opt, oppSel.options[1] || null);
                        oppSel.value = data.id;
                        oppSel.disabled = false;
                    }
                    var sec = document.getElementById('crNuevaOppSection');
                    if (sec) sec.style.display = 'none';
                    if (nombreInp) nombreInp.value = '';
                    crOppChanged();
                } else {
                    alert(data.error || 'Error al crear oportunidad');
                }
            })
            .catch(function () { alert('Error de conexión'); });
    }
    window.crCrearOpp = crCrearOpp;

    function cotizarRapidoIr() {
        var oppSel = document.getElementById('crOppSelect');
        if (!oppSel || !oppSel.value) return;
        var oppId = parseInt(oppSel.value, 10);
        cotizarRapidoCerrar();
        openCotizador(oppId);
    }
    window.cotizarRapidoIr = cotizarRapidoIr;

    // Close client dropdown on outside click
    document.addEventListener('click', function (e) {
        var dd = document.getElementById('crClienteDropdown');
        var inp = document.getElementById('crClienteInput');
        if (dd && inp && !inp.contains(e.target) && !dd.contains(e.target)) {
            dd.style.display = 'none';
        }
    });