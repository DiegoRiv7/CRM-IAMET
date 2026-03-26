// crm_campanas.js — Campaign Email Editor
(function() {
    'use strict';

    var csrf = function() { return document.querySelector('[name=csrfmiddlewaretoken]').value; };
    var blocks = []; // Array of block objects
    var selectedBlockIndex = -1;
    var currentTemplateId = null;

    // ══════════════════════════════════════
    // BLOCK DEFINITIONS — default content for each type
    // ══════════════════════════════════════
    var blockDefaults = {
        header: { type: 'header', content: { text: 'Título del Email', level: 1, align: 'center' } },
        text: { type: 'text', content: { html: '<p>Escribe tu contenido aquí. Puedes usar <b>negritas</b> y <i>cursivas</i>.</p>', align: 'left' } },
        image: { type: 'image', content: { src: '', alt: 'Imagen', width: '100%', align: 'center', link: '' } },
        button: { type: 'button', content: { text: 'Ver más', url: 'https://', color: '#0052D4', align: 'center' } },
        divider: { type: 'divider', content: { color: '#E5E5EA', spacing: '20' } },
        product: { type: 'product', content: { name: 'Producto', description: 'Descripción del producto', price: '', image_src: '' } },
        spacer: { type: 'spacer', content: { height: '30' } },
        footer: { type: 'footer', content: { text: '© 2026 Tu Empresa. Todos los derechos reservados.', unsubscribe_text: 'Cancelar suscripción' } }
    };

    // ══════════════════════════════════════
    // OPEN/CLOSE EDITOR
    // ══════════════════════════════════════
    window.abrirEditorCampana = function(options) {
        options = options || {};
        var widget = document.getElementById('widgetCampana');
        if (!widget) return;
        widget.classList.add('active');

        // Reset
        blocks = [];
        selectedBlockIndex = -1;
        currentTemplateId = options.templateId || null;

        document.getElementById('campNombre').value = options.nombre || '';
        document.getElementById('campAsunto').value = options.asunto || '';
        if (options.colorPrimario) document.getElementById('campColorPrimario').value = options.colorPrimario;
        if (options.colorFondo) document.getElementById('campColorFondo').value = options.colorFondo;

        // If editing existing template, load blocks
        if (currentTemplateId) {
            fetch('/app/api/campana/template/' + currentTemplateId + '/')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.bloques_json) blocks = data.bloques_json;
                    document.getElementById('campNombre').value = data.nombre || '';
                    document.getElementById('campAsunto').value = data.asunto || '';
                    if (data.color_primario) document.getElementById('campColorPrimario').value = data.color_primario;
                    if (data.color_fondo) document.getElementById('campColorFondo').value = data.color_fondo;
                    if (data.logo_url) document.getElementById('campLogoUrl').value = data.logo_url;
                    renderCanvas();
                });
        } else {
            // Default blocks for new template
            if (options.producto) {
                blocks = [
                    { type: 'header', content: { text: 'Conoce ' + options.producto, level: 1, align: 'center' } },
                    { type: 'text', content: { html: '<p>Hola, le compartimos información sobre nuestras soluciones en <b>' + options.producto + '</b>.</p>', align: 'left' } },
                    { type: 'divider', content: { color: '#E5E5EA', spacing: '16' } },
                    { type: 'product', content: { name: options.producto, description: 'Descripción del producto o servicio', price: '', image_src: '' } },
                    { type: 'button', content: { text: 'Solicitar información', url: 'https://', color: '#0052D4', align: 'center' } },
                    { type: 'footer', content: { text: '© 2026 IAMET. Todos los derechos reservados.', unsubscribe_text: '' } }
                ];
            }
            renderCanvas();
        }
    };

    // ══════════════════════════════════════
    // RENDER CANVAS — renders blocks visually in the editor
    // ══════════════════════════════════════
    function renderCanvas() {
        var dropZone = document.getElementById('campDropZone');
        if (!dropZone) return;

        dropZone.innerHTML = '';

        if (blocks.length === 0) {
            dropZone.appendChild(createEmptyMessage());
            return;
        }

        blocks.forEach(function(block, index) {
            var el = createBlockElement(block, index);
            dropZone.appendChild(el);
        });
    }

    function createEmptyMessage() {
        var div = document.createElement('div');
        div.id = 'campEmptyMsg';
        div.style.cssText = 'text-align:center;padding:60px 20px;color:#C7C7CC;';
        div.innerHTML = '<svg width="48" height="48" fill="none" stroke="#D1D1D6" stroke-width="1.5" viewBox="0 0 24 24" style="margin:0 auto 12px;display:block;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg><p style="font-size:0.9rem;font-weight:600;">Arrastra bloques aquí</p><p style="font-size:0.8rem;margin-top:4px;">o haz click en un bloque del panel izquierdo</p>';
        return div;
    }

    function createBlockElement(block, index) {
        var wrapper = document.createElement('div');
        wrapper.className = 'camp-block' + (index === selectedBlockIndex ? ' camp-block--selected' : '');
        wrapper.dataset.index = index;

        // Block content preview
        var content = document.createElement('div');
        content.className = 'camp-block-content';

        switch (block.type) {
            case 'header':
                var sizes = {1: '1.5rem', 2: '1.2rem', 3: '1rem'};
                content.innerHTML = '<div style="font-size:' + (sizes[block.content.level] || '1.2rem') + ';font-weight:700;text-align:' + (block.content.align || 'center') + ';color:#1D1D1F;padding:8px 16px;">' + escapeHtml(block.content.text) + '</div>';
                break;
            case 'text':
                content.innerHTML = '<div style="font-size:0.85rem;text-align:' + (block.content.align || 'left') + ';color:#3C3C43;padding:4px 16px;line-height:1.5;">' + (block.content.html || '') + '</div>';
                break;
            case 'image':
                if (block.content.src) {
                    content.innerHTML = '<div style="text-align:' + (block.content.align || 'center') + ';padding:8px 16px;"><img src="' + block.content.src + '" alt="' + escapeHtml(block.content.alt) + '" style="max-width:' + (block.content.width || '100%') + ';border-radius:6px;"></div>';
                } else {
                    content.innerHTML = '<div style="text-align:center;padding:20px;background:#F2F2F7;border-radius:6px;margin:8px 16px;color:#86868B;font-size:0.8rem;">📷 Click para agregar imagen (URL)</div>';
                }
                break;
            case 'button':
                var color = block.content.color || '#0052D4';
                content.innerHTML = '<div style="text-align:' + (block.content.align || 'center') + ';padding:12px 16px;"><span style="display:inline-block;padding:10px 24px;background:' + color + ';color:#fff;border-radius:8px;font-weight:700;font-size:0.85rem;">' + escapeHtml(block.content.text) + '</span></div>';
                break;
            case 'divider':
                content.innerHTML = '<div style="padding:' + (block.content.spacing || 20) + 'px 16px;"><hr style="border:none;border-top:1px solid ' + (block.content.color || '#E5E5EA') + ';"></div>';
                break;
            case 'product':
                content.innerHTML = '<div style="display:flex;gap:12px;padding:12px 16px;background:#F9FAFB;border-radius:8px;margin:4px 8px;">' +
                    (block.content.image_src ? '<img src="' + block.content.image_src + '" style="width:80px;height:80px;object-fit:cover;border-radius:6px;">' : '<div style="width:80px;height:80px;background:#E5E5EA;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#86868B;">📦</div>') +
                    '<div><div style="font-weight:700;font-size:0.9rem;color:#1D1D1F;">' + escapeHtml(block.content.name) + '</div><div style="font-size:0.75rem;color:#86868B;margin-top:2px;">' + escapeHtml(block.content.description) + '</div>' +
                    (block.content.price ? '<div style="font-weight:700;color:#0052D4;margin-top:4px;">' + escapeHtml(block.content.price) + '</div>' : '') +
                    '</div></div>';
                break;
            case 'spacer':
                content.innerHTML = '<div style="height:' + (block.content.height || 30) + 'px;display:flex;align-items:center;justify-content:center;color:#D1D1D6;font-size:0.7rem;">↕ ' + (block.content.height || 30) + 'px</div>';
                break;
            case 'footer':
                content.innerHTML = '<div style="text-align:center;padding:12px 16px;font-size:0.75rem;color:#86868B;border-top:1px solid #E5E5EA;">' + escapeHtml(block.content.text) + '</div>';
                break;
        }

        // Toolbar overlay (move up/down, select, delete)
        var toolbar = document.createElement('div');
        toolbar.className = 'camp-block-toolbar';
        toolbar.innerHTML =
            '<button class="camp-tb-btn" onclick="campMoveBlock(' + index + ',-1)" title="Subir">↑</button>' +
            '<button class="camp-tb-btn" onclick="campMoveBlock(' + index + ',1)" title="Bajar">↓</button>' +
            '<button class="camp-tb-btn camp-tb-btn--del" onclick="campDeleteBlock(' + index + ')" title="Eliminar">✕</button>';

        wrapper.appendChild(content);
        wrapper.appendChild(toolbar);

        // Click to select
        wrapper.addEventListener('click', function(e) {
            if (!e.target.closest('.camp-tb-btn')) {
                selectBlock(index);
            }
        });

        return wrapper;
    }

    // ══════════════════════════════════════
    // BLOCK OPERATIONS
    // ══════════════════════════════════════
    function addBlock(type) {
        var def = blockDefaults[type];
        if (!def) return;
        blocks.push(JSON.parse(JSON.stringify(def)));
        renderCanvas();
        selectBlock(blocks.length - 1);
    }

    window.campMoveBlock = function(index, direction) {
        var newIndex = index + direction;
        if (newIndex < 0 || newIndex >= blocks.length) return;
        var temp = blocks[index];
        blocks[index] = blocks[newIndex];
        blocks[newIndex] = temp;
        if (selectedBlockIndex === index) selectedBlockIndex = newIndex;
        renderCanvas();
    };

    window.campDeleteBlock = function(index) {
        blocks.splice(index, 1);
        if (selectedBlockIndex === index) selectedBlockIndex = -1;
        else if (selectedBlockIndex > index) selectedBlockIndex--;
        renderCanvas();
        hideProperties();
    };

    // ══════════════════════════════════════
    // PROPERTIES PANEL
    // ══════════════════════════════════════
    function selectBlock(index) {
        selectedBlockIndex = index;
        renderCanvas();
        showProperties(blocks[index], index);
    }

    function showProperties(block, index) {
        var panel = document.getElementById('campProperties');
        var content = document.getElementById('campPropContent');
        if (!panel || !content) return;
        panel.style.display = 'block';

        var html = '';
        var c = block.content;

        // Generate property fields based on block type
        switch (block.type) {
            case 'header':
                html = propField('Texto', 'text', 'campPropText', c.text) +
                    propSelect('Tamaño', 'campPropLevel', [{v:'1',l:'H1 Grande'},{v:'2',l:'H2 Mediano'},{v:'3',l:'H3 Pequeño'}], String(c.level)) +
                    propSelect('Alineación', 'campPropAlign', [{v:'left',l:'Izquierda'},{v:'center',l:'Centro'},{v:'right',l:'Derecha'}], c.align);
                break;
            case 'text':
                html = propTextarea('Contenido HTML', 'campPropHtml', c.html) +
                    propSelect('Alineación', 'campPropAlign', [{v:'left',l:'Izquierda'},{v:'center',l:'Centro'},{v:'right',l:'Derecha'}], c.align);
                break;
            case 'image':
                html = propField('URL de imagen', 'url', 'campPropSrc', c.src) +
                    propField('Texto alternativo', 'text', 'campPropAlt', c.alt) +
                    propField('Ancho', 'text', 'campPropWidth', c.width) +
                    propField('Link (opcional)', 'url', 'campPropLink', c.link) +
                    propSelect('Alineación', 'campPropAlign', [{v:'left',l:'Izquierda'},{v:'center',l:'Centro'},{v:'right',l:'Derecha'}], c.align);
                break;
            case 'button':
                html = propField('Texto del botón', 'text', 'campPropBtnText', c.text) +
                    propField('URL destino', 'url', 'campPropBtnUrl', c.url) +
                    propColor('Color', 'campPropBtnColor', c.color) +
                    propSelect('Alineación', 'campPropAlign', [{v:'left',l:'Izquierda'},{v:'center',l:'Centro'},{v:'right',l:'Derecha'}], c.align);
                break;
            case 'divider':
                html = propColor('Color de línea', 'campPropDivColor', c.color) +
                    propField('Espaciado (px)', 'number', 'campPropDivSpacing', c.spacing);
                break;
            case 'product':
                html = propField('Nombre del producto', 'text', 'campPropProdName', c.name) +
                    propTextarea('Descripción', 'campPropProdDesc', c.description) +
                    propField('Precio (opcional)', 'text', 'campPropProdPrice', c.price) +
                    propField('URL imagen', 'url', 'campPropProdImg', c.image_src);
                break;
            case 'spacer':
                html = propField('Altura (px)', 'number', 'campPropSpacerH', c.height);
                break;
            case 'footer':
                html = propTextarea('Texto del pie', 'campPropFooterText', c.text) +
                    propField('Texto cancelar suscripción', 'text', 'campPropFooterUnsub', c.unsubscribe_text);
                break;
        }

        content.innerHTML = html;

        // Bind change events
        content.querySelectorAll('input, textarea, select').forEach(function(el) {
            el.addEventListener('input', function() {
                updateBlockProperty(index, block.type);
            });
        });
    }

    function hideProperties() {
        var panel = document.getElementById('campProperties');
        if (panel) panel.style.display = 'none';
    }

    // Property field helpers
    function propField(label, type, id, value) {
        return '<div style="margin-bottom:12px;"><label style="font-size:0.7rem;color:#86868B;display:block;margin-bottom:4px;font-weight:600;">' + label + '</label><input type="' + type + '" id="' + id + '" value="' + escapeAttr(value || '') + '" style="width:100%;padding:8px 10px;border:1px solid #E5E5EA;border-radius:6px;font-size:0.8rem;outline:none;"></div>';
    }
    function propTextarea(label, id, value) {
        return '<div style="margin-bottom:12px;"><label style="font-size:0.7rem;color:#86868B;display:block;margin-bottom:4px;font-weight:600;">' + label + '</label><textarea id="' + id + '" rows="4" style="width:100%;padding:8px 10px;border:1px solid #E5E5EA;border-radius:6px;font-size:0.8rem;outline:none;resize:vertical;font-family:inherit;">' + escapeHtml(value || '') + '</textarea></div>';
    }
    function propSelect(label, id, options, selected) {
        var opts = options.map(function(o) { return '<option value="' + o.v + '"' + (o.v === selected ? ' selected' : '') + '>' + o.l + '</option>'; }).join('');
        return '<div style="margin-bottom:12px;"><label style="font-size:0.7rem;color:#86868B;display:block;margin-bottom:4px;font-weight:600;">' + label + '</label><select id="' + id + '" style="width:100%;padding:8px 10px;border:1px solid #E5E5EA;border-radius:6px;font-size:0.8rem;outline:none;background:#fff;">' + opts + '</select></div>';
    }
    function propColor(label, id, value) {
        return '<div style="margin-bottom:12px;"><label style="font-size:0.7rem;color:#86868B;display:block;margin-bottom:4px;font-weight:600;">' + label + '</label><input type="color" id="' + id + '" value="' + (value || '#0052D4') + '" style="width:100%;height:36px;border:1px solid #E5E5EA;border-radius:6px;cursor:pointer;"></div>';
    }

    function updateBlockProperty(index, type) {
        var c = blocks[index].content;
        var el = function(id) { var e = document.getElementById(id); return e ? e.value : ''; };

        switch (type) {
            case 'header': c.text = el('campPropText'); c.level = parseInt(el('campPropLevel')) || 1; c.align = el('campPropAlign'); break;
            case 'text': c.html = el('campPropHtml'); c.align = el('campPropAlign'); break;
            case 'image': c.src = el('campPropSrc'); c.alt = el('campPropAlt'); c.width = el('campPropWidth'); c.link = el('campPropLink'); c.align = el('campPropAlign'); break;
            case 'button': c.text = el('campPropBtnText'); c.url = el('campPropBtnUrl'); c.color = el('campPropBtnColor'); c.align = el('campPropAlign'); break;
            case 'divider': c.color = el('campPropDivColor'); c.spacing = el('campPropDivSpacing'); break;
            case 'product': c.name = el('campPropProdName'); c.description = el('campPropProdDesc'); c.price = el('campPropProdPrice'); c.image_src = el('campPropProdImg'); break;
            case 'spacer': c.height = el('campPropSpacerH'); break;
            case 'footer': c.text = el('campPropFooterText'); c.unsubscribe_text = el('campPropFooterUnsub'); break;
        }
        renderCanvas();
    }

    // ══════════════════════════════════════
    // PALETTE CLICK + DRAG
    // ══════════════════════════════════════
    document.querySelectorAll('.camp-palette-item').forEach(function(item) {
        item.addEventListener('click', function() {
            addBlock(this.dataset.blockType);
        });
        // Drag start
        item.addEventListener('dragstart', function(e) {
            e.dataTransfer.setData('text/plain', this.dataset.blockType);
        });
    });

    // Drop zone
    var dropZone = document.getElementById('campDropZone');
    if (dropZone) {
        dropZone.addEventListener('dragover', function(e) {
            e.preventDefault();
            this.style.background = '#EBF5FF';
        });
        dropZone.addEventListener('dragleave', function() {
            this.style.background = '';
        });
        dropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            this.style.background = '';
            var type = e.dataTransfer.getData('text/plain');
            if (type) addBlock(type);
        });
    }

    // ══════════════════════════════════════
    // SAVE TEMPLATE
    // ══════════════════════════════════════
    var btnGuardar = document.getElementById('campBtnGuardar');
    if (btnGuardar) {
        btnGuardar.addEventListener('click', function() {
            var nombre = document.getElementById('campNombre').value.trim();
            if (!nombre) { document.getElementById('campNombre').focus(); return; }

            var payload = {
                nombre: nombre,
                asunto: document.getElementById('campAsunto').value.trim(),
                bloques_json: blocks,
                color_primario: document.getElementById('campColorPrimario').value,
                color_fondo: document.getElementById('campColorFondo').value,
                logo_url: document.getElementById('campLogoUrl').value.trim(),
            };

            var url = currentTemplateId
                ? '/app/api/campana/template/' + currentTemplateId + '/'
                : '/app/api/campana/templates/';
            var method = currentTemplateId ? 'PUT' : 'POST';

            fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                body: JSON.stringify(payload)
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success || data.id) {
                    if (!currentTemplateId && data.id) currentTemplateId = data.id;
                    var toast = document.getElementById('widgetToast');
                    if (toast) {
                        toast.textContent = 'Template guardado exitosamente';
                        toast.classList.add('show');
                        setTimeout(function() { toast.classList.remove('show'); }, 2000);
                    }
                }
            });
        });
    }

    // ══════════════════════════════════════
    // PREVIEW
    // ══════════════════════════════════════
    var btnPreview = document.getElementById('campBtnPreview');
    if (btnPreview) {
        btnPreview.addEventListener('click', function() {
            if (!currentTemplateId && blocks.length === 0) return;

            // Render server-side
            var payload = {
                bloques_json: blocks,
                color_primario: document.getElementById('campColorPrimario').value,
                color_fondo: document.getElementById('campColorFondo').value,
                logo_url: document.getElementById('campLogoUrl').value.trim(),
            };

            fetch('/app/api/campana/template/' + (currentTemplateId || '0') + '/render/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                body: JSON.stringify(payload)
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.html) {
                    var overlay = document.getElementById('campPreviewOverlay');
                    var iframe = document.getElementById('campPreviewIframe');
                    if (overlay && iframe) {
                        overlay.style.display = 'flex';
                        iframe.srcdoc = data.html;
                        // Auto-resize iframe
                        iframe.onload = function() {
                            try {
                                iframe.style.height = iframe.contentDocument.body.scrollHeight + 'px';
                            } catch(e) {}
                        };
                    }
                }
            });
        });
    }

    // ══════════════════════════════════════
    // CLOSE + PROPERTY PANEL CLOSE
    // ══════════════════════════════════════
    var btnClose = document.getElementById('campClose');
    if (btnClose) {
        btnClose.addEventListener('click', function() {
            document.getElementById('widgetCampana').classList.remove('active');
        });
    }

    var btnPropClose = document.getElementById('campPropClose');
    if (btnPropClose) {
        btnPropClose.addEventListener('click', hideProperties);
    }

    var btnDeleteBlock = document.getElementById('campBtnDeleteBlock');
    if (btnDeleteBlock) {
        btnDeleteBlock.addEventListener('click', function() {
            if (selectedBlockIndex >= 0) {
                campDeleteBlock(selectedBlockIndex);
            }
        });
    }

    // Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            var preview = document.getElementById('campPreviewOverlay');
            if (preview && preview.style.display === 'flex') {
                preview.style.display = 'none';
                return;
            }
            var widget = document.getElementById('widgetCampana');
            if (widget && widget.classList.contains('active')) {
                widget.classList.remove('active');
            }
        }
    });

    // Helpers
    function escapeHtml(t) { if(!t) return ''; var d=document.createElement('div'); d.appendChild(document.createTextNode(t)); return d.innerHTML; }
    function escapeAttr(t) { return (t||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

})();
