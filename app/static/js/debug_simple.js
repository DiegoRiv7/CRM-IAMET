// Script de diagnóstico ultra simple
console.log('🚀 DEBUG SIMPLE: Script cargado');

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DEBUG: DOM cargado');
    
    // 1. Verificar si los elementos existen
    const dock = document.querySelector('.macos-dock');
    console.log('🔍 Dock encontrado:', !!dock);
    
    const assistantBtn = document.getElementById('assistant-btn');
    console.log('🔍 Botón assistant-btn encontrado:', !!assistantBtn);
    
    if (assistantBtn) {
        console.log('✅ Botón encontrado! Texto:', assistantBtn.textContent.trim());
        
        // 2. Agregar un click listener simple
        assistantBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('🎯 CLICK DETECTADO EN BOTÓN DE ASISTENTE!');
            
            // Click detectado correctamente
            
            // Intentar llamar a showNethiveAssistant si existe
            if (typeof window.showNethiveAssistant === 'function') {
                console.log('✅ showNethiveAssistant existe, llamándola...');
                try {
                    window.showNethiveAssistant();
                    console.log('✅ showNethiveAssistant ejecutada sin errores');
                    
                    // FORZAR la visualización del modal
                    const modal = document.getElementById('nethive-assistant-modal');
                    const container = document.getElementById('nethive-bot-container');
                    
                    if (modal && container) {
                        console.log('🔧 Forzando visualización del modal...');
                        container.classList.remove('hidden');
                        modal.classList.remove('hidden');
                        console.log('✅ Clases hidden removidas forzosamente');
                    }
                    
                    // Verificar si el modal apareció
                    setTimeout(() => {
                        const modal = document.getElementById('nethive-assistant-modal');
                        const container = document.getElementById('nethive-bot-container');
                        console.log('🔍 Modal después de showNethiveAssistant:', !!modal);
                        console.log('🔍 Container después de showNethiveAssistant:', !!container);
                        if (modal) {
                            console.log('🔍 Modal tiene clase hidden:', modal.classList.contains('hidden'));
                            console.log('🔍 Modal estilos:', modal.style.cssText);
                        }
                        if (container) {
                            console.log('🔍 Container tiene clase hidden:', container.classList.contains('hidden'));
                            console.log('🔍 Container estilos:', container.style.cssText);
                        }
                    }, 100);
                    
                } catch (error) {
                    console.error('❌ Error al ejecutar showNethiveAssistant:', error);
                }
            } else {
                console.log('❌ showNethiveAssistant NO existe');
                console.log('🔍 Funciones disponibles en window:', Object.keys(window).filter(key => key.includes('Nethive') || key.includes('show')));
                
                // Crear un modal simple para probar
                showSimpleModal();
            }
        });
        
        console.log('✅ Event listener agregado al botón');
    } else {
        console.error('❌ Botón assistant-btn NO encontrado');
        
        // Buscar todos los elementos con href="#"
        const allLinks = document.querySelectorAll('a[href="#"]');
        console.log('🔍 Enlaces con href="#" encontrados:', allLinks.length);
        
        allLinks.forEach((link, index) => {
            console.log(`Link ${index}: ID="${link.id}", texto="${link.textContent.trim()}"`);
        });
    }
    
    // 3. Verificar si Koti está cargado
    console.log('🔍 Verificando funciones de Koti...');
    console.log('showNethiveAssistant:', typeof window.showNethiveAssistant);
    console.log('showAdvancedNethiveChat:', typeof window.showAdvancedNethiveChat);
    console.log('updateNethiveMood:', typeof window.updateNethiveMood);
    
    // 4. Verificar configuración
    console.log('🔍 KOTI_CONFIG:', window.KOTI_CONFIG);
    
    // 5. Buscar contenedores del bot
    const nethiveContainer = document.getElementById('nethive-bot-container');
    console.log('🔍 Contenedor nethive-bot-container:', !!nethiveContainer);
    
    const assistantModal = document.getElementById('nethive-assistant-modal');
    console.log('🔍 Modal nethive-assistant-modal:', !!assistantModal);
});

// Función de test manual que se puede llamar desde la consola
window.testNethiveManual = function() {
    console.log('🧪 Test manual iniciado');
    
    if (typeof window.showNethiveAssistant === 'function') {
        console.log('✅ Ejecutando showNethiveAssistant manualmente...');
        window.showNethiveAssistant();
    } else {
        console.log('❌ showNethiveAssistant no disponible');
        alert('showNethiveAssistant no está disponible. Revisa la consola para más detalles.');
    }
};

// Función para mostrar modal simple de prueba
function showSimpleModal() {
    console.log('🧪 Creando modal simple de prueba...');
    
    const modal = document.createElement('div');
    modal.id = 'simple-test-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;
    
    modal.innerHTML = `
        <div style="background: #1e293b; padding: 24px; border-radius: 12px; max-width: 400px; width: 90%;">
            <h2 style="color: #06b6d4; margin: 0 0 16px 0;">🤖 Modal de Prueba</h2>
            <p style="color: white; margin: 0 0 16px 0;">
                ¡Esta es una prueba para verificar que los modals funcionan!
            </p>
            <div style="text-align: center;">
                <button onclick="document.getElementById('simple-test-modal').remove()" 
                        style="background: #06b6d4; color: white; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer;">
                    Cerrar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    console.log('✅ Modal simple creado');
}

window.showSimpleModal = showSimpleModal;

console.log('🔧 Para probar manualmente, ejecuta: testNethiveManual() en la consola');