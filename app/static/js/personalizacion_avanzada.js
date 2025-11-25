// Variables globales para el estado del avatar
let selectedImageFile = null;
let currentImageFile = null;
let cropData = { x: 0, y: 0, scale: 1 };

// Variables para el dock
let defaultDockOrder = [
    { id: 'dashboard', name: 'Dashboard', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
    { id: 'ventas', name: 'Ventas', icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' },
    { id: 'clientes', name: 'Clientes', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' },
    { id: 'productos', name: 'Productos', icon: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' },
    { id: 'separator', name: 'Separator', icon: '' },
    { id: 'settings', name: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' }
];

// Función para abrir configuración de avatar
function openAvatarSettings() {
    console.log('Abriendo configuración de avatar...');
    
    const modal = document.getElementById('avatarModal');
    if (!modal) {
        console.error('No se encontró el modal de avatar');
        return;
    }
    
    showModal('avatarModal');
    
    setTimeout(() => {
        try {
            console.log('Inicializando sistema de avatar...');
            initializeAvatarSystem();
            
            // Asegurarse de que los botones sean visibles
            const uploadButton = document.querySelector('.avatar-section .btn-primary');
            if (uploadButton) {
                uploadButton.style.display = 'flex';
                uploadButton.style.visibility = 'visible';
                uploadButton.style.opacity = '1';
                uploadButton.style.position = 'relative';
                uploadButton.style.zIndex = '100';
            }
            
            console.log('Sistema de avatar inicializado correctamente');
        } catch (error) {
            console.error('Error al inicializar el sistema de avatar:', error);
            showNotification('Error al cargar la configuración de avatar', 'error');
        }
    }, 100);
}

// Función para abrir configuración de diseño
function openDesignSettings() {
    console.log('Abriendo configuración de diseño...');
    
    const modal = document.getElementById('designModal');
    if (!modal) {
        console.error('No se encontró el modal de diseño');
        return;
    }
    
    showModal('designModal');
    
    setTimeout(() => {
        try {
            // Inicializar el dock preview
            initializeDockPreview();
            
            // Inicializar el tema actual
            const currentTheme = localStorage.getItem('theme') || 'dark';
            updateThemePreview(currentTheme);
            
            // Inicializar el tipo de dock actual
            const currentDockType = localStorage.getItem('dockType') || 'normal';
            setDockTypeWithAnimation(currentDockType, false);
            
            console.log('Configuración de diseño inicializada correctamente');
        } catch (error) {
            console.error('Error al inicializar la configuración de diseño:', error);
            showNotification('Error al cargar la configuración de diseño', 'error');
        }
    }, 100);
}

// Función para abrir configuración de idioma
function openLanguageSettings() {
    console.log('Abriendo configuración de idioma...');
    showModal('languageModal');
}

// Función para abrir configuración de información de usuario
function openUserInfoSettings() {
    console.log('Abriendo configuración de información de usuario...');
    showModal('userInfoModal');
}

// Funciones para mostrar/ocultar modales
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.style.visibility = 'visible';
    document.body.style.overflow = 'hidden';
    
    void modal.offsetWidth;
    console.log(`Mostrando modal: ${modalId}`);
}

function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
    document.body.style.overflow = 'auto';
}

function applyTheme(theme) {
    console.log('applyTheme called with:', theme);

    const validThemes = ['dark', 'pink', 'light', 'white', 'coffee', 'perla'];
    if (!validThemes.includes(theme)) {
        console.error('Invalid theme provided:', theme);
        theme = 'dark';
    }

    // Apply the theme to the main document
    const html = document.documentElement;
    html.classList.remove('dark-theme', 'light-theme', 'pink-theme', 'white-theme', 'coffee-theme', 'perla-theme');
    html.removeAttribute('data-theme');

    if (theme === 'pink' || theme === 'white' || theme === 'coffee' || theme === 'perla') {
        html.classList.add('light-theme');
    } else {
        html.classList.add('dark-theme');
    }

    if (theme !== 'dark') {
        html.setAttribute('data-theme', theme);
    }

    updateThemePreview(theme);

    document.querySelectorAll('.theme-dot-container').forEach(container => {
        container.querySelector('.theme-dot').style.boxShadow = '';
    });
    const selectedDot = document.getElementById(`${theme}-theme-dot`);
    if (selectedDot) {
        selectedDot.querySelector('.theme-dot').style.boxShadow = '0 0 0 3px rgba(0, 122, 255, 0.5), 0 0 15px rgba(0, 122, 255, 0.7)';
    }

    localStorage.setItem('theme', theme);

    const themeNames = {
        'dark': 'Oscuro',
        'pink': 'Rosa',
        'white': 'Blanco',
        'coffee': 'Café',
        'perla': 'Perla'
    };
    showNotification(`Tema cambiado a ${themeNames[theme] || theme}.`, 'success');
}

// Sistema de avatar completo
function initializeAvatarSystem() {
    console.log('Inicializando sistema de avatar...');
    const avatarChoices = document.querySelectorAll('.avatar-choice');
    const animGalleryPreview = document.getElementById('animGalleryPreview');
    const uploadedAvatar = document.getElementById('uploadedAvatar');
    const avatarUpload = document.getElementById('avatarUpload');
    
    if (avatarUpload) {
        console.log('Elemento de carga de archivo encontrado');
        avatarUpload.onchange = function(e) {
            const file = e.target.files[0];
            if (file) {
                selectedImageFile = file;
                const reader = new FileReader();
                reader.onload = function(event) {
                    if (uploadedAvatar) {
                        uploadedAvatar.src = event.target.result;
                        uploadedAvatar.style.display = 'block';
                        const applyButton = document.querySelector('button[onclick="applyCrop()"]');
                        if (applyButton) applyButton.style.display = 'inline-block';
                    }
                    showNotification('Imagen cargada. Haz clic en Aplicar para guardar los cambios.', 'info');
                };
                reader.readAsDataURL(file);
            }
        };
    } else {
        console.error('No se encontró el elemento de carga de archivo');
    }
    
    let selectedAvatar = 'dinosaur';
    
    function setAnimPreview(idx) {
        const btn = document.querySelector('.avatar-choice[data-avatar="'+idx+'"]');
        if (!btn) return;
        
        const previewContent = btn.cloneNode(true);
        
        animGalleryPreview.innerHTML = '';
        animGalleryPreview.className = 'avatar-preview-content';
        animGalleryPreview.style = '';
        
        const previewImg = previewContent.querySelector('img');
        if (previewImg) {
            previewImg.style.width = '100%';
            previewImg.style.height = '100%';
            previewImg.style.objectFit = 'cover';
            previewImg.style.borderRadius = '50%';
        }
        
        animGalleryPreview.style.display = 'flex';
        animGalleryPreview.style.alignItems = 'center';
        animGalleryPreview.style.justifyContent = 'center';
        animGalleryPreview.style.width = '100%';
        animGalleryPreview.style.height = '100%';
        
        previewContent.style.width = '100%';
        previewContent.style.height = '100%';
        previewContent.style.padding = '0';
        previewContent.style.border = 'none';
        previewContent.style.background = 'transparent';
        previewContent.style.boxShadow = 'none';
        
        animGalleryPreview.appendChild(previewContent);
        uploadedAvatar.style.display = 'none';
    }
    
    avatarChoices.forEach(btn => {
        btn.addEventListener('click', function() {
            avatarChoices.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            btn.style.borderColor = 'var(--apple-blue)';
            btn.style.boxShadow = '0 0 10px rgba(0, 122, 255, 0.5)';
            
            avatarChoices.forEach(b => {
                if (b !== btn) {
                    b.style.borderColor = 'transparent';
                    b.style.boxShadow = 'none';
                }
            });
            
            selectedAvatar = btn.getAttribute('data-avatar');
            setAnimPreview(selectedAvatar);
            document.getElementById('avatarChoice').value = selectedAvatar;
        });
    });
    
    // Inicializar con el avatar actual del usuario
    const defaultAvatar = window.avatarConfig ? window.avatarConfig.avatarTipo : 'dinosaur';
    const initialAvatar = document.querySelector(`.avatar-choice[data-avatar="${defaultAvatar}"]`);
    
    if (window.avatarConfig && window.avatarConfig.hasCustomAvatar && window.avatarConfig.customAvatarUrl) {
        console.log('Usuario tiene foto personalizada, mostrándola en la vista previa');
        uploadedAvatar.src = window.avatarConfig.customAvatarUrl;
        uploadedAvatar.style.display = 'block';
        animGalleryPreview.style.display = 'none';
        
        avatarChoices.forEach(b => {
            b.classList.remove('selected');
            b.style.borderColor = 'transparent';
            b.style.boxShadow = 'none';
        });
        document.getElementById('avatarChoice').value = '';
    } else {
        console.log('Usuario no tiene foto personalizada, usando avatar animado:', defaultAvatar);
        if (initialAvatar) {
            initialAvatar.click();
        } else {
            const defaultBtn = document.querySelector('.avatar-choice[data-avatar="dinosaur"]');
            if (defaultBtn) {
                defaultBtn.click();
            }
        }
    }
    
    // Manejar el botón de edición
    const editBtn = document.getElementById('editAvatarBtn');
    if (editBtn) {
        editBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            document.getElementById('avatarUpload').click();
        });
    }
}

// Funcionalidad de crop de imagen
function applyCrop() {
    if (!selectedImageFile) {
        showNotification('No hay ninguna imagen seleccionada', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('avatar', selectedImageFile);
    formData.append('csrfmiddlewaretoken', document.querySelector('[name=csrfmiddlewaretoken]').value);
    
    const applyButton = document.querySelector('button[onclick="applyCrop()"]');
    const originalText = applyButton ? applyButton.innerHTML : '';
    if (applyButton) {
        applyButton.disabled = true;
        applyButton.innerHTML = '<span>⏳</span> Guardando...';
    }
    
    fetch('/actualizar_avatar/', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('Foto de perfil actualizada correctamente', 'success');
            setTimeout(() => location.reload(), 1000);
        } else {
            throw new Error(data.error || 'Error al guardar la imagen');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showNotification('Error al guardar la foto: ' + error.message, 'error');
    })
    .finally(() => {
        if (applyButton) {
            applyButton.disabled = false;
            applyButton.innerHTML = originalText;
        }
    });
}

function cancelCrop() {
    document.getElementById('cropModal').style.display = 'none';
    document.getElementById('avatarUpload').value = '';
    imageX = 0;
    imageY = 0;
    cropData = { x: 0, y: 0, scale: 1 };
    const zoomSlider = document.getElementById('zoomSlider');
    if (zoomSlider) zoomSlider.value = 1;
    const cropImage = document.getElementById('cropImage');
    if (cropImage) cropImage.style.transform = 'translate(-50%, -50%) scale(1)';
}

// Sistema de temas


function updateThemePreview(theme) {
    const welcomePreview = document.getElementById('welcomePreview');
    if (!welcomePreview) return;
    
    const appleBg = welcomePreview.querySelector('.apple-bg');
    const userAvatar = welcomePreview.querySelector('.user-avatar-preview');
    const welcomeTitle = welcomePreview.querySelector('h1');
    const welcomeText = welcomePreview.querySelector('p');
    const searchBar = welcomePreview.querySelector('.central-search-bar');
    const searchIcon = searchBar ? searchBar.querySelector('svg') : null;
    const searchText = searchBar ? searchBar.querySelector('span') : null;
    
    welcomePreview.classList.remove('dark-preview', 'pink-preview', 'white-preview', 'coffee-preview');
    welcomePreview.classList.add(`${theme}-preview`);
    
    welcomePreview.style.transform = 'scale(0.95)';
    welcomePreview.style.opacity = '0.7';
    welcomePreview.style.transition = 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    
    setTimeout(() => {
        if (theme === 'dark') {
            welcomePreview.style.background = '#000000';
            if (appleBg) appleBg.style.background = 'radial-gradient(ellipse at top left, rgba(0, 122, 255, 0.1) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(0, 122, 255, 0.05) 0%, transparent 50%), linear-gradient(180deg, #000000 0%, #1D1D1F 100%)';
            if (userAvatar) userAvatar.style.borderColor = '#007AFF';
            if (welcomeTitle) welcomeTitle.style.color = '#FFFFFF';
            if (welcomeText) welcomeText.style.color = '#EBEBF5';
            if (searchBar) searchBar.style.background = 'rgba(28, 28, 30, 0.8)';
            if (searchIcon) searchIcon.style.color = '#8E8E93';
            if (searchText) searchText.style.color = '#8E8E93';
        } else if (theme === 'pink') {
            welcomePreview.style.background = 'linear-gradient(135deg, #FFF5F8 0%, #FFE8EF 30%, #FFD1DC 60%, #FFC0CB 100%)';
            if (appleBg) appleBg.style.background = 'radial-gradient(ellipse at top left, rgba(255, 107, 157, 0.1) 0%, transparent 60%), radial-gradient(ellipse at bottom right, rgba(255, 182, 193, 0.08) 0%, transparent 60%), linear-gradient(135deg, #FFF5F8 0%, #FFE8EF 30%, #FFD1DC 60%, #FFC0CB 100%)';
            if (userAvatar) userAvatar.style.borderColor = '#FF6B9D';
            if (welcomeTitle) welcomeTitle.style.color = '#2D1B2E';
            if (welcomeText) welcomeText.style.color = '#4A2B4D';
            if (searchBar) searchBar.style.background = 'linear-gradient(135deg, rgba(255, 245, 248, 0.9) 0%, rgba(255, 232, 239, 0.85) 50%, rgba(255, 218, 230, 0.8) 100%)';
            if (searchIcon) searchIcon.style.color = '#E55A87';
            if (searchText) searchText.style.color = '#6B4C6D';
        } else if (theme === 'white') {
            welcomePreview.style.background = '#ffffff';
            if (appleBg) appleBg.style.background = 'radial-gradient(ellipse at top left, rgba(0, 123, 255, 0.05) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(0, 123, 255, 0.03) 0%, transparent 50%), linear-gradient(180deg, #ffffff 0%, #f8f9fa 100%)';
            if (userAvatar) userAvatar.style.borderColor = '#007bff';
            if (welcomeTitle) welcomeTitle.style.color = '#212529';
            if (welcomeText) welcomeText.style.color = '#343a40';
            if (searchBar) searchBar.style.background = 'rgba(248, 249, 250, 0.8)';
            if (searchIcon) searchIcon.style.color = '#6c757d';
            if (searchText) searchText.style.color = '#6c757d';
        } else if (theme === 'coffee') {
            welcomePreview.style.background = 'linear-gradient(135deg, #f5e6d3 0%, #f0dcc7 100%)';
            if (appleBg) appleBg.style.background = 'radial-gradient(ellipse at top left, rgba(139, 69, 19, 0.05) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(139, 98, 57, 0.03) 0%, transparent 50%), linear-gradient(135deg, #f5e6d3 0%, #f0dcc7 100%)';
            if (userAvatar) userAvatar.style.borderColor = '#8b6239';
            if (welcomeTitle) welcomeTitle.style.color = '#4a3020';
            if (welcomeText) welcomeText.style.color = '#5d3d2a';
            if (searchBar) searchBar.style.background = 'rgba(139, 69, 19, 0.1)';
            if (searchIcon) searchIcon.style.color = '#8b6239';
            if (searchText) searchText.style.color = '#8b6239';
        } else if (theme === 'perla') {
            welcomePreview.style.background = '#FFFFFF';
            if (appleBg) appleBg.style.background = 'radial-gradient(ellipse at top left, rgba(0, 82, 212, 0.05) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(0, 82, 212, 0.03) 0%, transparent 50%), linear-gradient(180deg, #FFFFFF 0%, #F0F2F5 100%)';
            if (userAvatar) userAvatar.style.borderColor = '#0052D4';
            if (welcomeTitle) welcomeTitle.style.color = '#111827';
            if (welcomeText) welcomeText.style.color = '#374151';
            if (searchBar) searchBar.style.background = 'rgba(240, 242, 245, 0.8)';
            if (searchIcon) searchIcon.style.color = '#6B7280';
            if (searchText) searchText.style.color = '#6B7280';
        }
        
        welcomePreview.style.transform = 'scale(1.05)';
        welcomePreview.style.opacity = '1';
        
        setTimeout(() => {
            welcomePreview.style.transform = 'scale(1)';
        }, 200);
    }, 300);
}

// Sistema de dock
let previousDockType = 'normal';

function setDockTypeWithAnimation(type, animate = true) {
    console.log('setDockTypeWithAnimation called with type:', type, 'and animate:', animate);
    const dockPreview = document.getElementById('dockPreview');
    
    if (!dockPreview) {
        console.error('dockPreview element not found!');
        return;
    }
    
    document.querySelectorAll('.dock-type-option').forEach(option => {
        option.classList.remove('active');
        const previewCircle = option.querySelector('.dock-type-preview');
        if (previewCircle) {
            if (option.id === 'normal-dock-option') {
                previewCircle.style.background = 'var(--apple-blue)';
                previewCircle.style.boxShadow = '0 0 0 3px rgba(0, 122, 255, 0.2)';
            } else if (option.id === 'transparent-dock-option') {
                previewCircle.style.background = 'rgba(255, 255, 255, 0.8)';
                previewCircle.style.boxShadow = '0 0 0 3px rgba(255, 255, 255, 0.2)';
            } else if (option.id === 'compact-dock-option') {
                previewCircle.style.background = 'var(--apple-label-secondary)';
                previewCircle.style.boxShadow = '0 0 0 3px rgba(235, 235, 245, 0.2)';
            }
        }
    });
    
    if (previousDockType !== type) {
        const previousOption = document.getElementById(`${previousDockType}-dock-option`);
        if (previousOption) {
            const previousPreviewCircle = previousOption.querySelector('.dock-type-preview');
            if (previousPreviewCircle) {
                previousPreviewCircle.style.background = 'rgba(0, 122, 255, 0.7)';
                previousPreviewCircle.style.boxShadow = '0 0 0 3px rgba(0, 122, 255, 0.4)';
            }
        }
    }
    
    const selectedOption = document.getElementById(`${type}-dock-option`);
    if (selectedOption) {
        selectedOption.classList.add('active');
        const selectedPreviewCircle = selectedOption.querySelector('.dock-type-preview');
        if (selectedPreviewCircle) {
            selectedPreviewCircle.style.background = 'var(--apple-blue)';
            selectedPreviewCircle.style.boxShadow = '0 0 0 3px rgba(0, 122, 255, 0.5), 0 0 15px rgba(0, 122, 255, 0.7)';
        }
    }
    
    previousDockType = type;
    
    dockPreview.style.transform = 'scale(0.95)';
    dockPreview.style.opacity = '0.7';
    dockPreview.style.transition = 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    
    const generateDock = (isTransparent, isCompact) => {
        console.log('generateDock called with isTransparent:', isTransparent, 'isCompact:', isCompact);
        const dock = document.createElement('div');
        dock.className = 'macos-dock';
        dock.style.display = 'flex';
        dock.style.gap = '8px';
        dock.style.padding = '10px';
        dock.style.borderRadius = '16px';
        dock.style.transition = 'all 0.3s ease';
        
        if (isCompact) {
            dock.style.borderRadius = '50%';
            dock.style.width = '60px';
            dock.style.height = '60px';
            dock.style.justifyContent = 'center';
            dock.style.alignItems = 'center';
            const compactIcon = document.createElement('div');
            compactIcon.className = 'dock-item';
            compactIcon.style.width = '48px';
            compactIcon.style.height = '48px';
            compactIcon.style.borderRadius = '50%';
            compactIcon.style.display = 'flex';
            compactIcon.style.alignItems = 'center';
            compactIcon.style.justifyContent = 'center';
            compactIcon.style.background = 'rgba(0, 122, 255, 0.8)';
            compactIcon.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9,22 9,12 15,12 15,22"></polyline></svg>`;
            dock.appendChild(compactIcon);
        } else {
            dock.style.padding = '10px 20px';
            defaultDockOrder.slice(0, 5).forEach(item => {
                if (item.id === 'separator') return;
                const iconElement = document.createElement('div');
                iconElement.className = 'dock-item';
                iconElement.style.width = '48px';
                iconElement.style.height = '48px';
                iconElement.style.borderRadius = '12px';
                iconElement.style.display = 'flex';
                iconElement.style.alignItems = 'center';
                iconElement.style.justifyContent = 'center';
                iconElement.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="${item.icon}"></path></svg>`;
                iconElement.style.background = isTransparent ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 122, 255, 0.8)';
                dock.appendChild(iconElement);
            });
        }
        
        if (isTransparent) {
            dock.style.background = 'rgba(255, 255, 255, 0.01)';
            dock.style.backdropFilter = 'blur(40px) saturate(500%) contrast(180%) brightness(140%)';
            dock.style.webkitBackdropFilter = 'blur(40px) saturate(500%) contrast(180%) brightness(140%)';
            dock.style.border = '1px solid rgba(255, 255, 255, 0.05)';
        } else {
            dock.style.background = 'rgba(29, 29, 31, 0.85)';
            dock.style.border = '1px solid rgba(255, 255, 255, 0.15)';
        }
        
        console.log('Generated dock:', dock);
        return dock;
    };
    
    if (animate) {
        dockPreview.style.transform = 'scale(0.9)';
        dockPreview.style.opacity = '0';
        setTimeout(() => {
            dockPreview.innerHTML = '';
            let newDock;
            if (type === 'normal') newDock = generateDock(false, false);
            else if (type === 'transparent') newDock = generateDock(true, false);
            else if (type === 'compact') newDock = generateDock(false, true);
            dockPreview.appendChild(newDock);
            console.log('Appended new dock to preview:', newDock);
            dockPreview.style.transform = 'scale(1)';
            dockPreview.style.opacity = '1';
        }, 200);
    } else {
        dockPreview.innerHTML = '';
        let newDock;
        if (type === 'normal') newDock = generateDock(false, false);
        else if (type === 'transparent') newDock = generateDock(true, false);
        else if (type === 'compact') newDock = generateDock(false, true);
        dockPreview.appendChild(newDock);
        console.log('Appended new dock to preview (no animation):', newDock);
    }
    
    setDockType(type);
}

function initializeDockPreview() {
    const dockPreview = document.getElementById('dockPreview');
    if (!dockPreview) {
        console.error('dockPreview element not found during initialization');
        return;
    }
    
    const currentDockType = localStorage.getItem('dockType') || 'normal';
    setDockTypeWithAnimation(currentDockType, false);
}

function setDockType(type) {
    localStorage.setItem('dockType', type);
}

function setDockPosition(position) {
    localStorage.setItem('dockPosition', position);
    
    document.querySelectorAll('.dock-option').forEach(option => {
        option.classList.remove('active');
        if (option.getAttribute('data-position') === position) {
            option.classList.add('active');
        }
    });
    
    const positionNames = {
        'bottom': 'Inferior',
        'top': 'Superior',
        'left': 'Izquierda',
        'right': 'Derecha'
    };
    
    showNotification(`Posición del dock cambiada a ${positionNames[position]}`, 'success');
}

// Funciones para el dock editor
function resetDockOrder() {
    const editableDock = document.getElementById('editable-dock');
    if (!editableDock) return;
    
    // Limpiar el dock actual
    editableDock.innerHTML = '';
    
    // Restaurar el orden por defecto
    defaultDockOrder.forEach(item => {
        if (item.id === 'separator') {
            const separator = document.createElement('div');
            separator.className = 'dock-editor-separator';
            editableDock.appendChild(separator);
        } else {
            const dockItem = createDockEditorItem(item);
            editableDock.appendChild(dockItem);
        }
    });
    
    showNotification('Orden del dock restablecido', 'success');
}

function createDockEditorItem(item) {
    const dockItem = document.createElement('div');
    dockItem.className = 'dock-editor-item';
    dockItem.draggable = true;
    dockItem.dataset.itemId = item.id;
    
    // Crear el icono SVG
    const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('width', '28');
    iconSvg.setAttribute('height', '28');
    iconSvg.setAttribute('viewBox', '0 0 24 24');
    iconSvg.setAttribute('fill', 'none');
    iconSvg.setAttribute('stroke', 'white');
    iconSvg.setAttribute('stroke-width', '2');
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', item.icon);
    
    iconSvg.appendChild(path);
    dockItem.appendChild(iconSvg);
    
    // Añadir event listeners para drag and drop
    dockItem.addEventListener('dragstart', handleDragStart);
    dockItem.addEventListener('dragend', handleDragEnd);
    dockItem.addEventListener('dragover', handleDragOver);
    dockItem.addEventListener('drop', handleDrop);
    dockItem.addEventListener('dragenter', handleDragEnter);
    dockItem.addEventListener('dragleave', handleDragLeave);
    
    return dockItem;
}

function saveDockOrder() {
    const editableDock = document.getElementById('editable-dock');
    if (!editableDock) return;
    
    const dockItems = editableDock.querySelectorAll('.dock-editor-item');
    const newOrder = [];
    
    dockItems.forEach(item => {
        const itemId = item.dataset.itemId;
        const originalItem = defaultDockOrder.find(i => i.id === itemId);
        if (originalItem) {
            newOrder.push(originalItem);
        }
    });
    
    // Guardar el nuevo orden en localStorage
    localStorage.setItem('dockOrder', JSON.stringify(newOrder));
    
    showNotification('Orden del dock guardado correctamente', 'success');
    
    // Actualizar el dock preview
    setTimeout(() => {
        const currentDockType = localStorage.getItem('dockType') || 'normal';
        setDockTypeWithAnimation(currentDockType, false);
    }, 300);
}

// Variables para el drag and drop
let draggedElement = null;

function handleDragStart(e) {
    draggedElement = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    
    // Limpiar todas las clases de drop target
    const allItems = document.querySelectorAll('.dock-editor-item');
    allItems.forEach(item => {
        item.classList.remove('drop-target');
    });
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    if (this !== draggedElement) {
        this.classList.add('drop-target');
    }
}

function handleDragLeave(e) {
    this.classList.remove('drop-target');
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }
    
    if (draggedElement !== this) {
        const editableDock = document.getElementById('editable-dock');
        const allItems = [...editableDock.querySelectorAll('.dock-editor-item')];
        const draggedIndex = allItems.indexOf(draggedElement);
        const targetIndex = allItems.indexOf(this);
        
        if (draggedIndex < targetIndex) {
            this.parentNode.insertBefore(draggedElement, this.nextSibling);
        } else {
            this.parentNode.insertBefore(draggedElement, this);
        }
    }
    
    return false;
}

// Inicializar el dock editor cuando se abre el modal de diseño
function initializeDockEditor() {
    const editableDock = document.getElementById('editable-dock');
    if (!editableDock) return;
    
    // Limpiar el dock actual
    editableDock.innerHTML = '';
    
    // Cargar el orden guardado o usar el por defecto
    let dockOrder = defaultDockOrder;
    const savedOrder = localStorage.getItem('dockOrder');
    
    if (savedOrder) {
        try {
            dockOrder = JSON.parse(savedOrder);
        } catch (e) {
            console.error('Error parsing dock order from localStorage:', e);
            dockOrder = defaultDockOrder;
        }
    }
    
    // Crear los elementos del dock
    dockOrder.forEach(item => {
        if (item.id === 'separator') {
            const separator = document.createElement('div');
            separator.className = 'dock-editor-separator';
            editableDock.appendChild(separator);
        } else {
            const dockItem = createDockEditorItem(item);
            editableDock.appendChild(dockItem);
        }
    });
}

// Modificar la función openDesignSettings para inicializar el dock editor
const originalOpenDesignSettings = openDesignSettings;
openDesignSettings = function() {
    originalOpenDesignSettings();
    
    setTimeout(() => {
        initializeDockEditor();
    }, 200);
};

// Guardar configuración de diseño
function saveDesignSettings() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    const savedDockType = localStorage.getItem('dockType') || 'normal';
    const savedDockPosition = localStorage.getItem('dockPosition') || 'bottom';
    
    const themeNames = {
        'dark': 'Oscuro',
        'pink': 'Rosa',
        'white': 'Blanco',
        'coffee': 'Café'
    };
    
    const typeNames = {
        'normal': 'Normal',
        'transparent': 'Transparente',
        'compact': 'Compacto'
    };
    
    const positionNames = {
        'bottom': 'Inferior',
        'top': 'Superior',
        'left': 'Izquierda',
        'right': 'Derecha'
    };
    
    showNotification(
        `Configuración guardada:\n` +
        `Tema: ${themeNames[savedTheme] || savedTheme}\n` +
        `Tipo de dock: ${typeNames[savedDockType] || savedDockType}\n` +
        `Posición: ${positionNames[savedDockPosition] || savedDockPosition}`,
        'success'
    );
    
    hideModal('designModal');
    setTimeout(() => {
        location.reload(true);
    }, 500);
}

// Sistema de idioma
function changeLanguage(langCode, langName) {
    const languageButtons = document.querySelectorAll('.language-option');
    languageButtons.forEach(btn => {
        btn.disabled = true;
        if (btn.getAttribute('onclick').includes(`'${langCode}'`)) {
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${btn.textContent}`;
        }
    });
    
    const formData = new FormData();
    formData.append('language', langCode);
    formData.append('next', window.location.pathname);
    formData.append('csrfmiddlewaretoken', document.querySelector('[name=csrfmiddlewaretoken]').value);
    
    fetch('/i18n/setlang/', {
        method: 'POST',
        body: formData,
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]').value
        },
        credentials: 'same-origin'
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();
    })
    .then(data => {
        if (data.status === 'success') {
            document.documentElement.lang = langCode;
            showNotification(`Idioma cambiado a ${langName}`, 'success');
            setTimeout(() => {
                window.location.reload(true);
            }, 500);
        } else {
            throw new Error(data.message || 'Error al cambiar el idioma');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showNotification(error.message || 'Error al cambiar el idioma', 'error');
        
        languageButtons.forEach(btn => {
            btn.disabled = false;
            const langText = btn.textContent.trim();
            btn.textContent = langText;
        });
    });
}

// Sistema de información de usuario
function saveUserInfo() {
    const formData = new FormData();
    formData.append('username', document.getElementById('username').value);
    formData.append('first_name', document.getElementById('firstName').value);
    formData.append('last_name', document.getElementById('lastName').value);
    formData.append('email', document.getElementById('email').value);
    formData.append('birthday', document.getElementById('birthday').value);
    formData.append('gender', document.getElementById('gender').value);
    formData.append('csrfmiddlewaretoken', document.querySelector('[name=csrfmiddlewaretoken]').value);
    
    fetch('/configuracion_avanzada/', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('Información actualizada correctamente', 'success');
            hideModal('userInfoModal');
            setTimeout(() => location.reload(), 500);
        } else {
            showNotification('Error: ' + (data.error || 'Error desconocido'), 'error');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showNotification('Error al guardar la información', 'error');
    });
}

function logout() {
    if (confirm('¿Estás seguro de que quieres cerrar sesión?')) {
        window.location.href = '/logout/';
    }
}

// Sistema de notificaciones
function showNotification(message, type = 'info') {
    let container = document.querySelector('.notification-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
    }
    
    const notification = document.createElement('div');
    notification.className = `notification ${type} show`;
    notification.innerHTML = `
        <span class="icon">
            ${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}
        </span>
        <span>${message}</span>
    `;
    
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
            if (container && container.children.length === 0) {
                container.remove();
            }
        }, 300);
    }, 5000);
}

// Inicialización al cargar el documento
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOMContentLoaded started');
    
    let currentTheme = localStorage.getItem('theme');
    if (currentTheme === 'auto') {
        currentTheme = 'dark';
        localStorage.setItem('theme', 'dark');
    }
    console.log('DOMContentLoaded - currentTheme:', currentTheme);
    
    if (currentTheme) {
        setTimeout(() => {
            initializeActiveTheme(currentTheme);
            initializeThemeDots(currentTheme);
            
            setTimeout(() => {
                const savedTheme = localStorage.getItem('theme');
                if (savedTheme !== currentTheme) {
                    console.error('Theme changed unexpectedly during initialization!');
                    localStorage.setItem('theme', currentTheme);
                }
            }, 100);
        }, 100);
    } else {
        console.log('No saved theme found, will use default from base.html');
    }
    
    setTimeout(function() {
        const currentDockPosition = localStorage.getItem('dockPosition') || 'bottom';
        initializeActiveDockOption(currentDockPosition);
        
        const currentDockType = localStorage.getItem('dockType') || 'normal';
        initializeActiveDockType(currentDockType);
    }, 200);
});

function initializeActiveTheme(theme) {
    if (!theme) {
        console.log('No theme provided to initializeActiveTheme, skipping');
        return;
    }
    
    console.log('initializeActiveTheme called with:', theme);
    
    // Desactivar todos los temas primero
    document.querySelectorAll('.theme-dot-container').forEach(option => {
        option.classList.remove('active');
        option.style.boxShadow = 'none';
        option.style.transform = 'translateY(0)';
    });
    
    // Activar el tema correcto por ID
    const activeOption = document.getElementById(`${theme}-theme-dot`);
    if (activeOption) {
        activeOption.classList.add('active');
        activeOption.style.transform = 'translateY(-5px)';
        
        // Aplicar la sombra correcta según el tema
        const dot = activeOption.querySelector('.theme-dot');
        if (dot) {
            if (theme === 'dark') {
                dot.style.boxShadow = '0 0 0 3px rgba(0, 122, 255, 0.5), 0 0 15px rgba(0, 122, 255, 0.7)';
            } else if (theme === 'pink') {
                dot.style.boxShadow = '0 0 0 3px rgba(255, 107, 157, 0.5), 0 0 15px rgba(255, 107, 157, 0.7)';
            } else if (theme === 'white') {
                dot.style.boxShadow = '0 0 0 3px rgba(0, 169, 255, 0.5), 0 0 15px rgba(0, 169, 255, 0.7)';
            } else if (theme === 'coffee') {
                dot.style.boxShadow = '0 0 0 3px rgba(139, 98, 57, 0.5), 0 0 15px rgba(139, 98, 57, 0.7)';
            } else if (theme === 'perla') {
                dot.style.boxShadow = '0 0 0 3px rgba(0, 82, 212, 0.5), 0 0 15px rgba(0, 82, 212, 0.7)';
            }
        }
        console.log('Theme option activated by ID:', theme, activeOption);
    } else {
        console.warn('No theme option found for ID:', `${theme}-theme-dot`);
    }
}

function initializeThemeDots(theme) {
    console.log('initializeThemeDots called with:', theme);
    
    document.querySelectorAll('.theme-dot').forEach(dot => {
        dot.style.boxShadow = '';
    });
    
    const selectedDot = document.getElementById(`${theme}-theme-dot`);
    if (selectedDot) {
        const dot = selectedDot.querySelector('.theme-dot');
        if (dot) {
            if (theme === 'dark') {
                dot.style.boxShadow = '0 0 0 3px rgba(0, 122, 255, 0.5), 0 0 15px rgba(0, 122, 255, 0.7)';
            } else if (theme === 'pink') {
                dot.style.boxShadow = '0 0 0 3px rgba(255, 107, 157, 0.5), 0 0 15px rgba(255, 107, 157, 0.7)';
            } else if (theme === 'white') {
                dot.style.boxShadow = '0 0 0 3px rgba(0, 123, 255, 0.5), 0 0 15px rgba(0, 123, 255, 0.7)';
            } else if (theme === 'coffee') {
                dot.style.boxShadow = '0 0 0 3px rgba(139, 98, 57, 0.5), 0 0 15px rgba(139, 98, 57, 0.7)';
            } else if (theme === 'perla') {
                dot.style.boxShadow = '0 0 0 3px rgba(0, 82, 212, 0.5), 0 0 15px rgba(0, 82, 212, 0.7)';
            }
            console.log('Theme dot illuminated for theme:', theme);
        } else {
            console.warn('Theme dot element not found in container:', selectedDot);
        }
    } else {
        console.warn('Theme dot container not found for theme:', theme);
    }
}

function initializeActiveDockOption(position) {
    document.querySelectorAll('.dock-option').forEach(option => {
        option.classList.remove('active');
        if (option.getAttribute('data-position') === position) {
            option.classList.add('active');
        }
    });
}

function initializeActiveDockType(type) {
    document.querySelectorAll('.dock-type-option').forEach(option => {
        option.classList.remove('active');
        if (option.getAttribute('data-type') === type) {
            option.classList.add('active');
        }
    });
}