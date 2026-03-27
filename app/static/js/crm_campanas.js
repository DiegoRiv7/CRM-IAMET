// crm_campanas.js — Campaign template browser
(function() {
    'use strict';

    var csrf = function() { return document.querySelector('[name=csrfmiddlewaretoken]').value; };
    var currentMarca = '';
    var isAdmin = false;

    // ══════════════════════════════════════
    // OPEN CAMPAIGN WIDGET
    // ══════════════════════════════════════
    window.abrirEditorCampana = function(options) {
        options = options || {};
        var widget = document.getElementById('widgetCampana');
        if (!widget) return;
        widget.classList.add('active');

        currentMarca = (options.producto || options.marca || '').toUpperCase();

        // Check if user is supervisor or superuser
        isAdmin = (typeof window._CRM_CONFIG !== 'undefined' && (window._CRM_CONFIG.esSupervisor || window._CRM_CONFIG.isSuperuser));

        // Show/hide import button
        var importBtn = document.getElementById('campBtnImportar');
        if (importBtn) {
            importBtn.style.display = isAdmin ? 'inline-flex' : 'none';
        }

        // Set title
        var title = document.getElementById('campTitle');
        var subtitle = document.getElementById('campSubtitle');
        if (title) title.textContent = currentMarca ? 'Plantillas de ' + currentMarca : 'Plantillas de Campaña';
        if (subtitle) subtitle.textContent = 'Selecciona una plantilla para usar en tu campaña';

        // Render marca tabs
        renderMarcaTabs();

        // Load templates
        loadTemplates();
    };

    // ══════════════════════════════════════
    // MARCA TABS
    // ══════════════════════════════════════
    function renderMarcaTabs() {
        var container = document.getElementById('campMarcaTabs');
        if (!container) return;

        var marcas = ['TODAS', 'ZEBRA', 'PANDUIT', 'APC', 'AVIGILION', 'GENETEC', 'AXIS', 'SOFTWARE', 'CISCO', 'GENERAL'];
        var html = '';
        marcas.forEach(function(m) {
            var isActive = (m === 'TODAS' && !currentMarca) || m === currentMarca;
            html += '<button onclick="window._campFilterMarca(\'' + m + '\')" style="padding:6px 14px;border-radius:20px;font-size:0.7rem;font-weight:' + (isActive ? '700' : '600') + ';cursor:pointer;border:1px solid ' + (isActive ? '#0052D4' : '#E5E5EA') + ';background:' + (isActive ? '#0052D4' : '#fff') + ';color:' + (isActive ? '#fff' : '#3C3C43') + ';transition:all 0.15s;">' + m + '</button>';
        });
        container.innerHTML = html;
    }

    window._campFilterMarca = function(marca) {
        currentMarca = marca === 'TODAS' ? '' : marca;
        renderMarcaTabs();
        loadTemplates();
    };

    // ══════════════════════════════════════
    // LOAD TEMPLATES
    // ══════════════════════════════════════
    function loadTemplates() {
        var grid = document.getElementById('campGrid');
        var empty = document.getElementById('campEmpty');
        if (!grid) return;

        grid.innerHTML = '<div style="text-align:center;padding:40px;color:#86868B;grid-column:1/-1;">Cargando plantillas...</div>';
        if (empty) empty.style.display = 'none';

        var url = '/app/api/campana/templates/';
        if (currentMarca) url += '?marca=' + encodeURIComponent(currentMarca);

        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var templates = data.templates || [];
                if (templates.length === 0) {
                    grid.innerHTML = '';
                    if (empty) {
                        empty.style.display = 'block';
                        var hint = document.getElementById('campEmptyHint');
                        if (hint) {
                            hint.textContent = isAdmin
                                ? 'Haz click en "Importar Plantilla" para agregar una.'
                                : 'Pide al administrador que importe una plantilla HTML.';
                        }
                    }
                    return;
                }

                if (empty) empty.style.display = 'none';
                grid.innerHTML = '';

                templates.forEach(function(t) {
                    var card = document.createElement('div');
                    card.style.cssText = 'border:1px solid #E5E5EA;border-radius:12px;overflow:hidden;cursor:pointer;transition:all 0.2s;background:#fff;';
                    card.onmouseenter = function() { this.style.boxShadow = '0 4px 20px rgba(0,0,0,0.1)'; this.style.transform = 'translateY(-2px)'; };
                    card.onmouseleave = function() { this.style.boxShadow = 'none'; this.style.transform = 'none'; };

                    card.innerHTML =
                        '<div style="height:140px;background:#F9FAFB;border-bottom:1px solid #E5E5EA;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;">' +
                            '<div style="transform:scale(0.3);transform-origin:top center;width:600px;pointer-events:none;position:absolute;top:0;" id="campThumb' + t.id + '"></div>' +
                            '<div style="position:absolute;bottom:8px;right:8px;background:#0052D4;color:#fff;font-size:0.65rem;font-weight:700;padding:3px 8px;border-radius:4px;">' + escapeHtml(t.marca) + '</div>' +
                        '</div>' +
                        '<div style="padding:12px 14px;">' +
                            '<div style="font-size:0.85rem;font-weight:700;color:#1D1D1F;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(t.nombre) + '</div>' +
                            '<div style="font-size:0.7rem;color:#86868B;">' + escapeHtml(t.fecha) + ' · ' + escapeHtml(t.creado_por) + '</div>' +
                            '<div style="display:flex;gap:6px;margin-top:8px;">' +
                                '<button onclick="event.stopPropagation();window._campPreview(' + t.id + ',\'' + escapeHtml(t.nombre).replace(/'/g, "\\'") + '\')" style="flex:1;padding:7px;border:1px solid #007AFF;border-radius:6px;background:#007AFF11;color:#007AFF;font-size:0.72rem;font-weight:600;cursor:pointer;">Vista Previa</button>' +
                                '<button onclick="event.stopPropagation();window._campEnviarCorreo(' + t.id + ')" style="flex:1;padding:7px;border:1px solid #34C759;border-radius:6px;background:#34C75911;color:#34C759;font-size:0.72rem;font-weight:600;cursor:pointer;">Correo</button>' +
                                (isAdmin ? '<button onclick="event.stopPropagation();window._campDelete(' + t.id + ')" style="padding:7px 10px;border:1px solid #FF3B30;border-radius:6px;background:#FF3B3011;color:#FF3B30;font-size:0.72rem;font-weight:600;cursor:pointer;">X</button>' : '') +
                            '</div>' +
                        '</div>';

                    // Click to preview
                    card.addEventListener('click', function() {
                        window._campPreview(t.id, t.nombre);
                    });

                    grid.appendChild(card);

                    // Load mini thumbnail
                    loadThumb(t.id);
                });
            });
    }

    function loadThumb(templateId) {
        fetch('/app/api/campana/template/' + templateId + '/render/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
            body: '{}'
        }).then(function(r) { return r.json(); }).then(function(data) {
            var el = document.getElementById('campThumb' + templateId);
            if (el && data.html) {
                // Create a sandboxed mini-preview
                var iframe = document.createElement('iframe');
                iframe.style.cssText = 'width:600px;height:800px;border:none;pointer-events:none;';
                iframe.sandbox = 'allow-same-origin';
                el.innerHTML = '';
                el.appendChild(iframe);
                iframe.srcdoc = data.html;
            }
        });
    }

    // ══════════════════════════════════════
    // PREVIEW
    // ══════════════════════════════════════
    window._campPreview = function(templateId, nombre) {
        fetch('/app/api/campana/template/' + templateId + '/render/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
            body: '{}'
        }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.html) {
                var overlay = document.getElementById('campPreviewOverlay');
                var iframe = document.getElementById('campPreviewIframe');
                var title = document.getElementById('campPreviewTitle');
                if (overlay && iframe) {
                    overlay.style.display = 'flex';
                    if (title) title.textContent = nombre || 'Vista Previa';
                    iframe.srcdoc = data.html;
                    iframe.onload = function() {
                        try { iframe.style.height = iframe.contentDocument.body.scrollHeight + 'px'; } catch(e) {}
                    };
                }
            }
        });
    };

    // ══════════════════════════════════════
    // ENVIAR POR CORREO — abre widget de mail con HTML embebido
    // ══════════════════════════════════════
    window._campEnviarCorreo = function(templateId) {
        fetch('/app/api/campana/template/' + templateId + '/render/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
            body: '{}'
        }).then(function(r) { return r.json(); }).then(function(data) {
            if (!data.html) return;

            // Cerrar TODOS los widgets de prospección y campañas
            var campWidget = document.getElementById('widgetCampana');
            if (campWidget) campWidget.classList.remove('active');
            var clienteWidget = document.getElementById('widgetClienteProspectos');
            if (clienteWidget) clienteWidget.classList.remove('active');
            var prospectoWidget = document.getElementById('widgetProspecto');
            if (prospectoWidget) prospectoWidget.classList.remove('active');

            // Abrir widget de mail
            if (typeof mailAbrir === 'function') mailAbrir();

            // Esperar a que el widget se abra, luego activar redacción
            setTimeout(function() {
                if (typeof mailRedactar === 'function') mailRedactar();

                // Insertar el HTML del template en el editor
                setTimeout(function() {
                    var editor = document.getElementById('mailCompEditor');
                    if (editor) {
                        editor.innerHTML = data.html;
                    }
                    // Pre-llenar asunto con el nombre del template
                    var asunto = document.getElementById('mailCompAsunto');
                    if (asunto && data.nombre) {
                        asunto.value = data.nombre;
                    }
                    // Store campaign context so when email is sent, we register it
                    window._campanaEnvioContext = {
                        templateId: templateId,
                        nombre: data.nombre || '',
                        marca: data.marca || ''
                    };
                }, 200);
            }, 300);
        });
    };

    // ══════════════════════════════════════
    // DELETE (admin)
    // ══════════════════════════════════════
    window._campDelete = function(templateId) {
        if (!confirm('¿Eliminar esta plantilla?')) return;
        fetch('/app/api/campana/template/' + templateId + '/', {
            method: 'DELETE',
            headers: { 'X-CSRFToken': csrf() }
        }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.success) loadTemplates();
        });
    };

    // ══════════════════════════════════════
    // IMPORT (admin) — with drag & drop + marca grid
    // ══════════════════════════════════════
    var _selectedImportMarca = '';

    var importBtn = document.getElementById('campBtnImportar');
    if (importBtn) {
        importBtn.addEventListener('click', function() {
            // Pre-select current marca in the grid
            _selectedImportMarca = currentMarca || '';
            highlightMarcaGrid();
            // Reset form state
            document.getElementById('campImpNombre').value = '';
            document.getElementById('campImpFile').value = '';
            document.getElementById('campFileName').style.display = 'none';
            document.getElementById('campDropText').textContent = 'Arrastra tu archivo .html aquí';
            document.getElementById('campDropArea').style.borderColor = '#D1D1D6';
            document.getElementById('campDropArea').style.background = '#FAFAFA';
            document.getElementById('campImportDialog').style.display = 'flex';
        });
    }

    // Marca grid buttons
    document.querySelectorAll('.camp-marca-opt').forEach(function(btn) {
        btn.addEventListener('click', function() {
            _selectedImportMarca = this.dataset.marca;
            document.getElementById('campImpMarca').value = _selectedImportMarca;
            highlightMarcaGrid();
        });
    });

    function highlightMarcaGrid() {
        document.querySelectorAll('.camp-marca-opt').forEach(function(b) {
            if (b.dataset.marca === _selectedImportMarca) {
                b.style.borderColor = '#0052D4';
                b.style.background = '#0052D4';
                b.style.color = '#fff';
            } else {
                b.style.borderColor = '#E5E5EA';
                b.style.background = '#fff';
                b.style.color = '#3C3C43';
            }
        });
        document.getElementById('campImpMarca').value = _selectedImportMarca;
    }

    // Drag & drop zone
    var dropArea = document.getElementById('campDropArea');
    var fileInput = document.getElementById('campImpFile');

    if (dropArea && fileInput) {
        // Click to select file
        dropArea.addEventListener('click', function() { fileInput.click(); });

        // File selected via input
        fileInput.addEventListener('change', function() {
            if (this.files.length) showSelectedFile(this.files[0]);
        });

        // Drag events
        dropArea.addEventListener('dragover', function(e) {
            e.preventDefault();
            this.style.borderColor = '#0052D4';
            this.style.background = '#EBF5FF';
        });
        dropArea.addEventListener('dragleave', function(e) {
            e.preventDefault();
            this.style.borderColor = '#D1D1D6';
            this.style.background = '#FAFAFA';
        });
        dropArea.addEventListener('drop', function(e) {
            e.preventDefault();
            this.style.borderColor = '#D1D1D6';
            this.style.background = '#FAFAFA';
            var files = e.dataTransfer.files;
            if (files.length && (files[0].name.endsWith('.html') || files[0].name.endsWith('.htm'))) {
                // Transfer file to the input
                var dt = new DataTransfer();
                dt.items.add(files[0]);
                fileInput.files = dt.files;
                showSelectedFile(files[0]);
            }
        });
    }

    function showSelectedFile(file) {
        var dropText = document.getElementById('campDropText');
        var fileName = document.getElementById('campFileName');
        if (dropText) dropText.textContent = '✓ Archivo seleccionado';
        if (fileName) {
            fileName.textContent = '📄 ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
            fileName.style.display = 'block';
        }
        if (dropArea) {
            dropArea.style.borderColor = '#34C759';
            dropArea.style.background = '#34C75908';
        }
        // Auto-fill name if empty
        var nombreInput = document.getElementById('campImpNombre');
        if (nombreInput && !nombreInput.value) {
            var name = file.name.replace(/\.html?$/i, '').replace(/[-_]/g, ' ');
            nombreInput.value = name.charAt(0).toUpperCase() + name.slice(1);
        }
    }

    // Form submit
    var importForm = document.getElementById('campImportForm');
    if (importForm) {
        importForm.addEventListener('submit', function(e) {
            e.preventDefault();

            var nombre = document.getElementById('campImpNombre').value.trim();
            var marca = document.getElementById('campImpMarca').value;
            var fileInp = document.getElementById('campImpFile');

            if (!marca) { alert('Selecciona una marca'); return; }
            if (!nombre) { document.getElementById('campImpNombre').focus(); return; }
            if (!fileInp.files.length) { alert('Selecciona un archivo HTML'); return; }

            var submitBtn = document.getElementById('campImpSubmit');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Subiendo...';

            var formData = new FormData();
            formData.append('nombre', nombre);
            formData.append('marca', marca);
            formData.append('html_file', fileInp.files[0]);

            fetch('/app/api/campana/templates/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf() },
                body: formData
            }).then(function(r) { return r.json(); }).then(function(data) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Subir Plantilla';

                if (data.success) {
                    document.getElementById('campImportDialog').style.display = 'none';
                    importForm.reset();
                    _selectedImportMarca = '';
                    currentMarca = data.marca || currentMarca;
                    renderMarcaTabs();
                    loadTemplates();

                    var toast = document.getElementById('widgetToast');
                    if (toast) {
                        toast.textContent = 'Plantilla "' + data.nombre + '" subida exitosamente';
                        toast.classList.add('show');
                        setTimeout(function() { toast.classList.remove('show'); }, 3000);
                    }
                } else {
                    alert(data.error || 'Error al subir');
                }
            }).catch(function() {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Subir Plantilla';
            });
        });
    }

    // ══════════════════════════════════════
    // CLOSE
    // ══════════════════════════════════════
    document.getElementById('campClose')?.addEventListener('click', function() {
        document.getElementById('widgetCampana').classList.remove('active');
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            var preview = document.getElementById('campPreviewOverlay');
            if (preview && preview.style.display === 'flex') {
                preview.style.display = 'none';
                return;
            }
            var importDlg = document.getElementById('campImportDialog');
            if (importDlg && importDlg.style.display === 'flex') {
                importDlg.style.display = 'none';
                return;
            }
            var widget = document.getElementById('widgetCampana');
            if (widget && widget.classList.contains('active')) {
                widget.classList.remove('active');
            }
        }
    });

    function escapeHtml(t) { if(!t) return ''; var d=document.createElement('div'); d.appendChild(document.createTextNode(t)); return d.innerHTML; }

})();
