// Funciones para la personalización avanzada

// Función para abrir configuración de avatar
window.openAvatarSettings = function() {
    console.log('Abriendo configuración de avatar...');
    
    // Mostrar el modal
    const modal = document.getElementById('avatarModal');
    if (!modal) {
        console.error('No se encontró el modal de avatar');
        return;
    }
    
    showModal('avatarModal');
    
    // Inicializar el sistema de avatar después de que el modal esté visible
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
            // Mostrar un mensaje de error al usuario
            showNotification('Error al cargar la configuración de avatar', 'error');
        }
    }, 100);
}

// Función para abrir configuración de diseño
window.openDesignSettings = function() {
    console.log('Abriendo configuración de diseño...');
    showModal('designModal');
    
    setTimeout(() => {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        applyTheme(savedTheme);
        initializeActiveTheme(savedTheme);
        initializeThemeDots(savedTheme);

        const savedDockType = localStorage.getItem('dockType') || 'normal';
        setDockTypeWithAnimation(savedDockType, false);
    }, 100);
}

// Función para abrir configuración de idioma
window.openLanguageSettings = function() {
    console.log('Abriendo configuración de idioma...');
    showModal('languageModal');
}

// Función para abrir configuración de información de usuario
window.openUserInfoSettings = function() {
    console.log('Abriendo configuración de información de usuario...');
    showModal('userInfoModal');
}

// Función para guardar configuración de diseño
function saveDesignSettings() {
    // Guardar la configuración del diseño
    const savedTheme = localStorage.getItem('theme') || 'dark';
    const savedDockType = localStorage.getItem('dockType') || 'normal';
    const savedDockPosition = localStorage.getItem('dockPosition') || 'bottom';
    
    // Mostrar notificación de éxito
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
    
    // Cerrar el modal después de guardar
    setTimeout(() => {
        hideModal('designModal');
        // Recargar la página para aplicar los cambios
        setTimeout(() => location.reload(), 300);
    }, 1000);
}

// Modal utilities
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.style.visibility = 'visible';
    document.body.style.overflow = 'hidden';
    
    // Forzar un reflow para asegurar que los estilos se apliquen
    void modal.offsetWidth;
    
    console.log(`Mostrando modal: ${modalId}`, modal);
}

function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
    document.body.style.overflow = 'auto';
    if (modalId === 'designModal') {
        location.reload();
    }
}

// Sistema de notificaciones
function showNotification(message, type = 'info') {
    // Create notification container if it doesn't exist
    let container = document.querySelector('.notification-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
               <div class="notification-content">
                   <span>${message}</span>
                   <button class="notification-close">&times;</button>
               </div>
           `;

    // Add to container
    container.appendChild(notification);

    // Auto remove after 5 seconds
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => {
            notification.remove();
        // Remove container if no more notifications
        if (container && container.children.length === 0) {
            container.remove();
        }
        }, 300);
    }, 5000);

    // Close button functionality
    const closeBtn = notification.querySelector('.notification-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            notification.classList.add('fade-out');
            setTimeout(() => {
                notification.remove();
            // Remove container if no more notifications
            if (container && container.children.length === 0) {
                container.remove();
            }
            }, 300);
        });
    }
}

console.log('Funciones de personalización avanzada cargadas correctamente');