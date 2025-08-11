// ==================== KOTI BOT - ASISTENTE VIRTUAL HÍBRIDO ====================
// Sistema de asistente virtual avanzado para gestión de ventas
// Funciones: Chat IA, detección proactiva, automatización de cotizaciones
// ==========================================================================

// Configuración API de Gemini AI
const GEMINI_API_KEY = 'AIzaSyCliVaBtT0hju3OQR-FTUONRYIfhLAaXUA';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// Estado global de Nethive
window.nethiveState = {
    clickCount: 0,
    hasShownForClicks: false,
    userDismissedHelp: false,
    dismissalReason: null,
    criticalErrorsCount: 0,
    currentContext: null,
    lastHelpOffered: null,
    zoneClicks: new Map(),
    lastClickedElement: null,
    consecutiveClicksOnElement: 0,
    userStuckInArea: false,
    formErrors: new Map(),
    scrollBehavior: { position: 0, stuckTime: 0 },
    sessionStartTime: Date.now(),
    lastOpportunityCheck: parseInt(sessionStorage.getItem('lastOpportunityCheck') || Date.now()),
    isWatchingOpportunities: false,
    opportunityWatchInterval: null
};

// Sistema de personalidad de Nethive
const nethivePersonality = {
    moods: ['happy', 'excited', 'thoughtful', 'helpful', 'playful', 'sad', 'worried', 'proud', 'focused', 'celebrating'],
    currentMood: 'happy',
    expressions: {
        happy: { 
            eyes: '⚫⚫', 
            mouth: '︶', 
            color: '#4ade80',
            glow: '#4ade80',
            animation: 'pulse-gentle',
            description: 'Contento y listo para ayudar'
        },
        excited: { 
            eyes: '✨✨', 
            mouth: '◡', 
            color: '#f59e0b',
            glow: '#f59e0b',
            animation: 'bounce-excited',
            description: 'Emocionado de ayudarte'
        },
        sad: { 
            eyes: '💧💧', 
            mouth: '︵', 
            color: '#3b82f6',
            glow: '#3b82f6',
            animation: 'sway-sad',
            description: 'Preocupado por los errores'
        },
        proud: { 
            eyes: '⭐⭐', 
            mouth: '◠', 
            color: '#fbbf24',
            glow: '#fbbf24',
            animation: 'glow-proud',
            description: '¡Orgulloso de haber ayudado!'
        },
        worried: { 
            eyes: '😰😰', 
            mouth: '~', 
            color: '#f97316',
            glow: '#f97316',
            animation: 'shake-worried',
            description: 'Detectando problemas'
        },
        thoughtful: { 
            eyes: '🤔🤔', 
            mouth: '−', 
            color: '#8b5cf6',
            glow: '#8b5cf6',
            animation: 'think-pulse',
            description: 'Analizando la situación'
        },
        helpful: { 
            eyes: '👀👀', 
            mouth: '◠', 
            color: '#06b6d4',
            glow: '#06b6d4',
            animation: 'ready-bounce',
            description: 'Listo para resolver problemas'
        },
        focused: { 
            eyes: '👁️👁️', 
            mouth: '━', 
            color: '#10b981',
            glow: '#10b981',
            animation: 'focus-glow',
            description: 'Concentrado en tu tarea'
        },
        celebrating: { 
            eyes: '🎉🎉', 
            mouth: '◉', 
            color: '#ec4899',
            glow: '#ec4899',
            animation: 'celebrate-dance',
            description: '¡Misión cumplida!'
        },
        playful: { 
            eyes: '😊😊', 
            mouth: '‿', 
            color: '#ec4899',
            glow: '#ec4899',
            animation: 'wiggle-playful',
            description: 'En modo juguetón'
        }
    }
};

// Base de conocimiento local para el CRM
const SALES_KNOWLEDGE_BASE = {
    "dashboard": {
        keywords: ["dashboard", "tablero", "resumen", "inicio", "principal", "métricas"],
        response: "El dashboard te muestra un resumen de tus oportunidades de venta, ingresos proyectados, y métricas clave. Puedes ver gráficos por mes, producto y usuario. ¿Necesitas ayuda con alguna métrica específica?"
    },
    "oportunidades": {
        keywords: ["oportunidad", "oportunidades", "ventas", "deals", "negocio", "seguimiento"],
        response: "Las oportunidades son tus deals activos. Puedes crear nuevas, editarlas, cambiar su estado (prospecto, propuesta, negociación, cerrada), asignar probabilidades y fechas de cierre. ¿Quieres saber cómo crear una nueva oportunidad?"
    },
    "clientes": {
        keywords: ["cliente", "clientes", "empresa", "compañía", "contacto", "contactos"],
        response: "En la sección de clientes puedes gestionar toda la información de tus empresas y contactos. El sistema se sincroniza con Bitrix24. Puedes ver el historial de oportunidades por cliente. ¿Necesitas ayuda para agregar un nuevo cliente?"
    },
    "cotizaciones": {
        keywords: ["cotización", "cotizaciones", "presupuesto", "propuesta", "pdf", "iamet", "bajanet"],
        response: "Las cotizaciones te permiten crear presupuestos detallados con productos, cantidades y precios. Puedes generar PDFs con plantillas de Iamet o Bajanet. ¿Quieres saber cómo crear una cotización?"
    },
    "bitrix": {
        keywords: ["bitrix", "bitrix24", "crm", "sincronización", "sync", "integración"],
        response: "El sistema está integrado con Bitrix24. Los clientes, contactos y oportunidades se sincronizan automáticamente. Si tienes problemas de sincronización, contacta al administrador."
    },
    "reportes": {
        keywords: ["reporte", "reportes", "exportar", "análisis", "estadísticas", "gráficos"],
        response: "Puedes generar reportes por cliente, usuario, período y producto. Hay gráficos interactivos y opciones de exportación. ¿Qué tipo de reporte necesitas?"
    },
    "tutorial": {
        keywords: ["ayuda", "tutorial", "cómo", "empezar", "inicio", "comenzar", "guía"],
        response: "¡Perfecto! Te voy a guiar paso a paso:\n1. Comienza en el Dashboard para ver tu resumen\n2. Crea o revisa tus Oportunidades de venta\n3. Gestiona tus Clientes y contactos\n4. Genera Cotizaciones cuando sea necesario\n5. Revisa Reportes para analizar tu rendimiento\n\n¿Por dónde quieres empezar?"
    }
};

// ==================== INICIALIZACIÓN ====================
function initNethive() {
    console.log("🤖 Iniciando Koti Bot...");
    
    // Inicializar sistemas
    initProactiveLogic();
    initContextualIntelligence();
    
    // Agregar estilos CSS
    addNethiveStyles();
    
    // Inicializar sistemas omnipresentes
    initializeOmnipresentSystem();
    initializeErrorDetection();
    
    // Inicializar detección de oportunidades
    setTimeout(() => initializeOpportunityWatcher(), 2000);
    
    console.log("✅ Koti Bot inicializado correctamente");
}

// ==================== SISTEMA OMNIPRESENTE ====================
function initializeOmnipresentSystem() {
    console.log("🌐 Iniciando sistema omnipresente de Koti...");
    
    // Monitoreo global de la página
    window.kotiOmnipresence = {
        pageLoadTime: Date.now(),
        currentPage: window.location.pathname,
        errorCount: 0,
        userStuckTime: 0,
        lastActivity: Date.now(),
        formErrors: new Map(),
        warningShown: false,
        helpOffers: 0
    };
    
    // Detectar cambios de página
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            onPageChange();
        }
    }).observe(document, { subtree: true, childList: true });
    
    // Monitoreo de actividad del usuario
    ['click', 'keydown', 'scroll'].forEach(event => {
        document.addEventListener(event, updateUserActivity);
    });
    
    // Verificar cada 5 segundos si el usuario necesita ayuda
    setInterval(checkUserStatus, 5000);
}

function initializeErrorDetection() {
    console.log("🚨 Iniciando detección automática de errores...");
    
    // Interceptar errores de JavaScript
    window.addEventListener('error', handleJavaScriptError);
    
    // Interceptar errores de promesas no manejadas
    window.addEventListener('unhandledrejection', handlePromiseError);
    
    // Monitoreo de formularios con errores
    observeFormErrors();
    
    // Detectar elementos de error en la página
    observeErrorElements();
    
    // Monitoreo de llamadas HTTP fallidas
    interceptNetworkErrors();
}

function onPageChange() {
    console.log("📄 Koti detectó cambio de página:", window.location.pathname);
    
    window.kotiOmnipresence.currentPage = window.location.pathname;
    window.kotiOmnipresence.pageLoadTime = Date.now();
    window.kotiOmnipresence.warningShown = false;
    
    // Resetear contadores por página nueva
    window.kotiOmnipresence.userStuckTime = 0;
    window.kotiOmnipresence.formErrors.clear();
    
    // Re-observar nuevos elementos
    setTimeout(() => {
        observeFormErrors();
        observeErrorElements();
    }, 1000);
}

function updateUserActivity() {
    window.kotiOmnipresence.lastActivity = Date.now();
    window.kotiOmnipresence.userStuckTime = 0;
}

function checkUserStatus() {
    const now = Date.now();
    const timeSinceActivity = now - window.kotiOmnipresence.lastActivity;
    const timeOnPage = now - window.kotiOmnipresence.pageLoadTime;
    
    // Usuario inactivo por más de 30 segundos en una página
    if (timeSinceActivity > 30000 && timeOnPage > 60000 && !window.kotiOmnipresence.warningShown) {
        window.kotiOmnipresence.userStuckTime += 5000;
        
        // Si lleva más de 2 minutos en la misma página sin actividad
        if (window.kotiOmnipresence.userStuckTime > 120000) {
            offerProactiveHelp('inactivity', '¿Necesitas ayuda navegando esta sección?');
        }
    }
    
    // Verificar errores acumulados
    if (window.kotiOmnipresence.errorCount > 2 && !window.kotiOmnipresence.warningShown) {
        offerProactiveHelp('multiple_errors', 'He detectado varios errores. ¿Te ayudo a solucionarlos?');
    }
    
    // Verificar errores en formularios
    if (window.kotiOmnipresence.formErrors.size > 0 && !window.kotiOmnipresence.warningShown) {
        offerProactiveHelp('form_errors', 'Veo que hay campos con errores. ¿Te explico cómo completarlos?');
    }
}

function handleJavaScriptError(event) {
    console.error("🚨 Koti detectó error JavaScript:", event.error);
    window.kotiOmnipresence.errorCount++;
    
    const errorMessage = event.error?.message || 'Error desconocido';
    
    // Errores críticos que requieren intervención inmediata
    if (errorMessage.includes('NetworkError') || errorMessage.includes('Failed to fetch')) {
        setTimeout(() => {
            offerProactiveHelp('network_error', 'Detecté un problema de conexión. ¿Te ayudo a solucionarlo?');
        }, 2000);
    }
}

function handlePromiseError(event) {
    console.error("🚨 Koti detectó promesa rechazada:", event.reason);
    window.kotiOmnipresence.errorCount++;
    
    if (event.reason?.message?.includes('fetch')) {
        setTimeout(() => {
            offerProactiveHelp('api_error', 'Parece que hay un problema con el servidor. ¿Te ayudo a continuar?');
        }, 2000);
    }
}

function observeFormErrors() {
    // Buscar campos con errores existentes
    const errorInputs = document.querySelectorAll('input.is-invalid, .form-error, .error-message, .invalid-feedback:not(:empty)');
    errorInputs.forEach(element => {
        const fieldName = element.name || element.id || 'campo desconocido';
        window.kotiOmnipresence.formErrors.set(fieldName, element.textContent || 'Error de validación');
    });
    
    // Observar nuevos errores de formulario
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Buscar mensajes de error
                    const errorElements = node.querySelectorAll?.('.error-message, .invalid-feedback, .is-invalid') || [];
                    if (errorElements.length > 0 || node.classList?.contains('error-message')) {
                        const fieldName = node.closest('form')?.querySelector('input, select')?.name || 'campo';
                        window.kotiOmnipresence.formErrors.set(fieldName, node.textContent || 'Error de validación');
                        console.log("🔍 Koti detectó error en formulario:", fieldName);
                    }
                }
            });
        });
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

function observeErrorElements() {
    // Detectar elementos de error comunes en Django y páginas web
    const errorSelectors = [
        '.alert-danger',
        '.alert-error', 
        '.error',
        '.errorlist',
        '[class*="error"]',
        '.notification.is-danger',
        '.message.error',
        '.toast.error'
    ];
    
    errorSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            if (element.textContent.trim() && element.offsetHeight > 0) {
                console.log("🚨 Koti detectó elemento de error:", element.textContent);
                setTimeout(() => {
                    offerProactiveHelp('page_error', `Veo un error en la página: "${element.textContent.trim()}". ¿Te ayudo a solucionarlo?`);
                }, 1000);
            }
        });
    });
}

function interceptNetworkErrors() {
    // Interceptar fetch requests
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        return originalFetch.apply(this, args).catch(error => {
            console.error("🌐 Koti detectó error de red:", error);
            window.kotiOmnipresence.errorCount++;
            setTimeout(() => {
                offerProactiveHelp('network_error', 'Hay problemas de conexión. ¿Te ayudo a continuar sin conexión?');
            }, 2000);
            throw error;
        });
    };
    
    // Interceptar XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(...args) {
        this.addEventListener('error', () => {
            console.error("🌐 Koti detectó error en XMLHttpRequest");
            window.kotiOmnipresence.errorCount++;
        });
        return originalOpen.apply(this, args);
    };
}

function offerProactiveHelp(type, message) {
    if (window.kotiOmnipresence.warningShown) return;
    if (window.kotiOmnipresence.helpOffers >= 3) return; // Máximo 3 ofertas por sesión
    
    window.kotiOmnipresence.warningShown = true;
    window.kotiOmnipresence.helpOffers++;
    
    updateNethiveMood('worried', `Detecté problema: ${type}`);
    
    showProactiveBot(message, true, [
        {
            text: "Sí, ayúdame 🤖",
            action: () => {
                hideProactiveBot();
                setTimeout(() => window.showNethiveAssistant(), 500);
            }
        },
        {
            text: "No ahora",
            action: () => {
                hideProactiveBot();
                window.kotiOmnipresence.warningShown = false;
            }
        }
    ]);
    
    console.log(`🤖 Koti ofreció ayuda proactiva: ${type} - ${message}`);
}

// ==================== SISTEMA DE PERSONALIDAD ====================
function updateNethiveMood(mood, reason = '') {
    nethivePersonality.currentMood = mood;

    const avatars = document.querySelectorAll('[class*="nethive-avatar"], [class*="nethive-mini-avatar"]');
    const expression = nethivePersonality.expressions[mood];

    if (!expression) return;

    avatars.forEach(avatar => {
        const face = avatar.querySelector('.nethive-face');
        const body = avatar.querySelector('.nethive-body, .nethive-mini-avatar');
        const eyes = avatar.querySelector('.nethive-eyes');
        const mouth = avatar.querySelector('.nethive-mouth');

        if (face) {
            face.style.borderColor = expression.color;
            face.style.boxShadow = `0 0 15px ${expression.glow}40, inset 0 0 10px ${expression.glow}20`;
        }

        if (body) {
            body.style.background = `linear-gradient(145deg, ${expression.color}30, ${expression.color}15)`;
            body.style.boxShadow = `0 0 20px ${expression.glow}30, inset 0 0 15px ${expression.glow}20`;
        }

        if (eyes) {
            eyes.innerHTML = `
                <div class="nethive-eye w-4 h-4 bg-white rounded-full" style="box-shadow: 0 0 8px ${expression.glow};">${expression.eyes.charAt(0)}</div>
                <div class="nethive-eye w-4 h-4 bg-white rounded-full" style="box-shadow: 0 0 8px ${expression.glow};">${expression.eyes.charAt(1) || expression.eyes.charAt(0)}</div>
            `;
        }

        if (mouth) {
            mouth.textContent = expression.mouth;
            mouth.style.color = expression.color;
        }

        avatar.className = avatar.className.replace(/animate-\S+/g, '');
        if (expression.animation) {
            avatar.classList.add('animate-' + expression.animation);
        }
    });

    const miniAvatars = document.querySelectorAll('.nethive-mini-avatar');
    miniAvatars.forEach(miniAvatar => {
        miniAvatar.style.background = `linear-gradient(145deg, ${expression.color}40, ${expression.color}20)`;
        miniAvatar.style.boxShadow = `0 0 10px ${expression.glow}30`;

        const content = miniAvatar.querySelector('div[class*="relative"]');
        if (content) {
            content.style.color = expression.color;
            content.textContent = expression.eyes.charAt(0);
        }
    });

    console.log(`🤖 Koti mood: ${mood} (${expression.description}) ${reason ? '- ' + reason : ''}`);
}

function createNethiveAvatar() {
    const { currentMood, expressions } = nethivePersonality;
    const expression = expressions[currentMood];
    return `
        <div class="nethive-avatar-main relative w-24 h-24 md:w-32 md:h-32 flex items-center justify-center animate-float">
            <div class="nethive-body absolute w-full h-full rounded-full transition-all duration-500" style="background: linear-gradient(145deg, ${expression.color}20, ${expression.color}10); box-shadow: inset 0 0 15px ${expression.color}40, 0 0 20px ${expression.color}30;"></div>
            <div class="nethive-head absolute w-3/4 h-3/4 rounded-full bg-gray-700 border-2 border-gray-600 flex items-center justify-center transition-all duration-500" style="transform: translateY(-30%); background: radial-gradient(circle at 50% 50%, #374151, #1f2937);">
                <div class="nethive-face relative w-3/4 h-3/4 rounded-full border-2 border-gray-500 flex flex-col items-center justify-center transition-all duration-500" style="border-color: ${expression.color}; background: #111827;">
                    <div class="nethive-eyes flex space-x-3">
                        <div class="nethive-eye w-4 h-4 bg-white rounded-full animate-pulse-light" style="box-shadow: 0 0 8px ${expression.color};"></div>
                        <div class="nethive-eye w-4 h-4 bg-white rounded-full animate-pulse-light" style="box-shadow: 0 0 8px ${expression.color};"></div>
                    </div>
                    <div class="nethive-mouth mt-2 text-white text-xl font-bold transition-all duration-500" style="color: ${expression.color};">${expression.mouth}</div>
                </div>
            </div>
        </div>
    `;
}

function createMiniNethiveAvatar() {
    const { currentMood, expressions } = nethivePersonality;
    const expression = expressions[currentMood];
    return `
        <div class="nethive-mini-avatar w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 relative overflow-hidden" style="background: linear-gradient(145deg, ${expression.color}40, ${expression.color}20); box-shadow: 0 0 10px ${expression.color}30;">
            <div class="absolute inset-0 bg-gray-800 opacity-70 rounded-full"></div>
            <div class="relative text-white text-lg font-bold" style="color: ${expression.color};">${expression.eyes ? expression.eyes.substring(0,1) : 'N'}</div>
        </div>
    `;
}

// ==================== INTERFAZ PRINCIPAL ====================
window.showNethiveAssistant = function() {
    const modal = document.getElementById('nethive-assistant-modal');
    const container = document.getElementById('nethive-bot-container');
    
    if (modal && container) {
        updateNethiveMood('excited', '¡El usuario abrió mi panel principal!');
        
        // Insertar avatares dinámicamente
        const avatarContainer = document.getElementById('nethive-avatar-container');
        const miniAvatarContainer = document.getElementById('mini-avatar-container');
        
        if (avatarContainer) {
            avatarContainer.innerHTML = createNethiveAvatar();
        }
        if (miniAvatarContainer) {
            miniAvatarContainer.innerHTML = createMiniNethiveAvatar();
        }
        
        // Actualizar mensaje con el saludo personalizado
        const messageElement = document.getElementById('nethive-message');
        if (messageElement) {
            messageElement.innerHTML = getNethiveGreeting();
        }
        
        // Cargar preguntas contextuales
        loadContextualQuestions();
        
        // Mostrar el modal
        container.classList.remove('hidden');
        modal.classList.remove('hidden');
    }
}

window.closeNethiveAssistant = function() {
    const modal = document.getElementById('nethive-assistant-modal');
    const container = document.getElementById('nethive-bot-container');
    const advancedChat = document.getElementById('nethive-advanced-chat');
    
    // Cerrar completamente todo el sistema
    if (container) {
        container.classList.add('hidden');
    }
    if (modal) {
        modal.classList.add('hidden');
    }
    if (advancedChat) {
        advancedChat.classList.add('hidden');
    }
}

// ==================== BASE DE CONOCIMIENTO DEL SISTEMA ====================
const SYSTEM_KNOWLEDGE_BASE = {
    // SECCIONES PRINCIPALES
    home: {
        keywords: ["home", "inicio", "principal", "empezar"],
        title: "🏠 Página de Inicio",
        response: `La página de inicio es tu punto de partida en el sistema:

**🎯 Desde aquí puedes:**
• Navegar a Oportunidades para gestionar tus ventas
• Ir a Cotizaciones para crear propuestas
• Usar el dock lateral para navegación rápida

**📋 Flujo recomendado:**
1. **Oportunidades** → Crear y gestionar posibles ventas
2. **Cotizaciones** → Formalizar propuestas para clientes

**💡 Tip:** Usa la barra lateral (dock) para navegar rápidamente entre secciones.`,
        actions: [
            { text: "Ver Oportunidades", url: "/app/todos/" },
            { text: "Ver Cotizaciones", url: "/app/cotizaciones/" }
        ]
    },

    oportunidades: {
        keywords: ["oportunidades", "ventas", "deals", "negocios", "todos", "prospects"],
        title: "🎯 Gestión de Oportunidades",
        response: `Las oportunidades son el corazón de tu sistema de ventas:

**✨ Qué puedes hacer:**
• Ver todas tus oportunidades en una tabla
• Filtrar por estado, cliente, producto
• Crear nuevas oportunidades fácilmente
• Editar probabilidades de cierre
• Seguimiento de fechas importantes

**📋 Estados disponibles:**
• 🟢 Activa (en proceso)
• 🔵 Ganada (cerrada exitosamente)
• 🔴 Perdida (no se concretó)

**💡 Tip:** Actualiza las probabilidades regularmente para tener proyecciones precisas.`,
        actions: [
            { text: "Ver todas las oportunidades", url: "/app/todos/" },
            { text: "Crear nueva oportunidad", url: "/app/ingresar-venta/" }
        ]
    },

    cotizaciones: {
        keywords: ["cotizaciones", "presupuestos", "quotes", "pdf", "propuestas"],
        title: "📄 Sistema de Cotizaciones",
        response: `El sistema de cotizaciones te permite crear propuestas profesionales:

**🔧 Funciones principales:**
• Crear cotizaciones detalladas
• Agregar múltiples productos/servicios
• Calcular totales automáticamente
• Generar PDFs profesionales
• Vincular con oportunidades existentes

**📋 Tipos de plantilla:**
• Bajanet (servicios de hosting)
• Iamet (desarrollo y consultoría)

**💡 Tip:** Puedes duplicar cotizaciones existentes para ahorrar tiempo.`,
        actions: [
            { text: "Ver cotizaciones", url: "/app/cotizaciones/" },
            { text: "Crear nueva cotización", url: "/app/crear-cotizacion/" }
        ]
    },


    // FUNCIONES ESPECÍFICAS
    crear_oportunidad: {
        keywords: ["crear oportunidad", "nueva venta", "nuevo negocio", "agregar oportunidad"],
        title: "➕ Crear Nueva Oportunidad",
        response: `Para crear una nueva oportunidad necesitas:

**📝 Datos básicos:**
• Nombre de la oportunidad
• Cliente asociado
• Monto estimado
• Fecha probable de cierre
• Probabilidad de éxito (%)

**🎯 Productos disponibles:**
• Hosting y Dominios
• Desarrollo Web
• Consultoría IT
• Telecomunicaciones
• Otros servicios

**💡 Tip:** Usa nombres descriptivos como "Hosting Empresa ABC - 2024" para fácil identificación.`,
        actions: [
            { text: "Crear oportunidad ahora", url: "/app/ingresar-venta/" }
        ]
    },


    // PREGUNTAS BÁSICAS PREDEFINIDAS
    crear_cotizacion: {
        keywords: ["crear cotización", "cómo creo cotización", "nueva cotización", "hacer cotización"],
        title: "📄 Cómo Crear una Cotización - Paso a Paso",
        response: `Aquí te explico el **proceso paso a paso** para crear una cotización:

**📋 Pasos a seguir:**

**1. 🎯 Ve a Oportunidades**
   • Haz clic en el ícono de "Oportunidades" en el dock lateral (barra izquierda)
   • Verás la lista de todas tus oportunidades de venta

**2. ✅ Selecciona tu Oportunidad**
   • Busca la oportunidad para la que quieres crear la cotización
   • Si no existe, primero crea una nueva oportunidad

**3. 📄 Crear Cotización**
   • Haz clic en el botón "Crear Cotización" junto a tu oportunidad
   • También puedes ir directamente a la sección "Cotizaciones" del dock

**4. 📝 Completa la Información**
   • Agrega productos/servicios
   • Define precios y cantidades
   • Selecciona la plantilla (Bajanet o Iamet)

**5. 🎯 Generar PDF**
   • Revisa todos los datos
   • Genera el PDF final para enviar al cliente

**💡 Tip:** Siempre es mejor empezar desde una oportunidad existente para mantener todo organizado.`,
        actions: [
            { text: "Ir a Oportunidades", url: "/app/todos/" },
            { text: "Ir a Cotizaciones", url: "/app/cotizaciones/" }
        ]
    },

    como_funciona_sistema: {
        keywords: ["cómo funciona", "explicar sistema", "cómo usar", "tutorial sistema"],
        title: "❓ Cómo Funciona el Sistema - Las 3 Secciones Principales",
        response: `Te explico las **3 secciones principales** del sistema de gestión de ventas:

**🏠 1. HOME (Inicio)**
   • **Qué es:** Tu página principal y punto de partida
   • **Qué ves:** Acceso rápido a las funciones principales
   • **Para qué sirve:** Navegar a las otras secciones del sistema
   • **Cuándo usarlo:** Como punto de partida para acceder al sistema

**🎯 2. OPORTUNIDADES**
   • **Qué es:** La gestión de tus posibles ventas
   • **Qué ves:** Lista de todos tus negocios potenciales
   • **Para qué sirve:** Crear, editar y seguir oportunidades
   • **Cuándo usarlo:** Para agregar nuevos clientes o actualizar el estado de ventas

**📄 3. COTIZACIONES**  
   • **Qué es:** Sistema para crear propuestas profesionales
   • **Qué ves:** PDFs elegantes para enviar a clientes
   • **Para qué sirve:** Convertir oportunidades en propuestas formales
   • **Cuándo usarlo:** Cuando el cliente está listo para ver precios

**🔄 Flujo Recomendado:**
1. **Home** → Punto de partida
2. **Oportunidades** → Crear/gestionar posibles ventas  
3. **Cotizaciones** → Formalizar propuestas

**💡 Tip:** El sistema está diseñado para seguir el proceso natural de ventas: identificar → gestionar → cotizar.`,
        actions: [
            { text: "Ir al Home", url: "/app/home/" },
            { text: "Ver Oportunidades", url: "/app/todos/" },
            { text: "Ver Cotizaciones", url: "/app/cotizaciones/" }
        ]
    },

    // AYUDA TÉCNICA
    navegacion: {
        keywords: ["navegar", "navegación", "menú", "dock", "barra lateral"],
        title: "🧭 Navegación del Sistema",
        response: `El sistema usa un dock lateral para navegación rápida:

**🎯 Secciones principales:**
• 🏠 Home - Página de inicio
• 🎯 Oportunidades - Gestión de ventas
• 📄 Cotizaciones - Crear propuestas
• 🤖 Asistente Virtual - ¡Soy yo!

**💡 Tip:** Puedes hacer hover sobre cada ícono para ver su descripción.`,
        actions: [
            { text: "Ir al Home", url: "/app/home/" },
            { text: "Ver Oportunidades", url: "/app/todos/" },
            { text: "Ver Cotizaciones", url: "/app/cotizaciones/" }
        ]
    },

    // PROBLEMAS COMUNES
    troubleshooting: {
        keywords: ["problema", "error", "no funciona", "ayuda técnica", "bug", "falla"],
        title: "🔧 Solución de Problemas",
        response: `Si tienes problemas técnicos, prueba estos pasos:

**🔄 Pasos básicos:**
1. Recarga la página (F5 o Ctrl+R)
2. Verifica tu conexión a internet
3. Limpia la caché del navegador
4. Prueba en modo incógnito

**📱 Problemas específicos:**
• **PDF no genera:** Verifica los datos de la cotización
• **No se guardan cambios:** Revisa conexión de red
• **Error de permisos:** Contacta al administrador

**💡 Si persiste:** Contacta al soporte técnico con detalles del error.`,
        actions: []
    }
};

// ==================== PREGUNTAS FRECUENTES CONTEXTUALES ====================
function getContextualQuestions(currentPath) {
    const questions = [];
    
    if (currentPath.includes('/dashboard')) {
        questions.push(
            { text: "¿Cómo interpretar los gráficos?", category: "dashboard" },
            { text: "¿Qué significan las métricas?", category: "dashboard" },
            { text: "¿Cómo crear una nueva oportunidad?", category: "crear_oportunidad" }
        );
    } else if (currentPath.includes('/todos')) {
        questions.push(
            { text: "¿Cómo editar una oportunidad?", category: "oportunidades" },
            { text: "¿Qué es la probabilidad de cierre?", category: "oportunidades" },
            { text: "¿Cómo crear una cotización?", category: "cotizaciones" }
        );
    } else if (currentPath.includes('/cotizaciones')) {
        questions.push(
            { text: "¿Cómo generar un PDF?", category: "cotizaciones" },
            { text: "¿Cómo duplicar una cotización?", category: "cotizaciones" },
            { text: "¿Qué plantillas están disponibles?", category: "cotizaciones" }
        );
    } else if (currentPath.includes('/reporte')) {
        questions.push(
            { text: "¿Cómo leer los reportes?", category: "reportes" },
            { text: "¿Cómo exportar datos?", category: "reportes" },
            { text: "¿Qué período analizar?", category: "reportes" }
        );
    }
    
    // Las preguntas básicas ahora están en el template HTML, no aquí
    
    return questions;
}

// ==================== DETECCIÓN INTELIGENTE DE INTENCIONES ====================
function detectLocalIntent(message) {
    const messageLower = message.toLowerCase().trim();
    
    // Buscar en la base de conocimiento
    for (const [key, data] of Object.entries(SYSTEM_KNOWLEDGE_BASE)) {
        if (data.keywords.some(keyword => messageLower.includes(keyword))) {
            return {
                type: 'knowledge_base',
                category: key,
                title: data.title,
                response: data.response,
                actions: data.actions || []
            };
        }
    }
    
    // Detección de intenciones específicas
    if (messageLower.includes("empezar") || messageLower.includes("comenzar") || messageLower.includes("nuevo")) {
        return {
            type: 'onboarding',
            title: "🚀 Empezando en el Sistema",
            response: `¡Bienvenido al Sistema de Gestión de Ventas! 

**Pasos recomendados para empezar:**

1. **📊 Revisa el Dashboard** - Ve tu resumen general
2. **🎯 Crea tu primera oportunidad** - Agrega un posible negocio
3. **👥 Importa tus clientes** - O créalos manualmente
4. **📄 Genera una cotización** - Crea propuestas profesionales

**💡 Tip:** El sistema está integrado con Bitrix24, así que tus datos se sincronizan automáticamente.`,
            actions: [
                { text: "Ir al Dashboard", url: "/app/dashboard/" },
                { text: "Crear primera oportunidad", url: "/app/ingresar-venta/" }
            ]
        };
    }
    
    return null;
}

function getNethiveGreeting() {
    const currentPath = window.location.pathname;
    const hasErrors = window.nethiveState.formErrors.size > 0;
    
    let greeting = "¡Hola! Soy **Koti**, tu asistente virtual especializado en este sistema de gestión de ventas. 🤖\n\n";

    // Saludo contextual según la página
    if (currentPath.includes('/dashboard')) {
        greeting += "📊 Veo que estás en el **Dashboard**. Aquí puedes revisar todas tus métricas de ventas y análisis.";
    } else if (currentPath.includes('/todos')) {
        greeting += "🎯 Estás en la sección de **Oportunidades**. Aquí puedes gestionar todos tus posibles negocios.";
    } else if (currentPath.includes('/cotizaciones')) {
        greeting += "📄 Estás en **Cotizaciones**. Puedes crear y gestionar propuestas profesionales para tus clientes.";
    } else if (currentPath.includes('/reporte')) {
        greeting += "📊 Estás viendo **Reportes**. Aquí puedes analizar el desempeño de tus ventas.";
    } else if (currentPath.includes('crear-cotizacion')) {
        greeting += "📝 Estás creando una **nueva cotización**. Te puedo ayudar con el proceso.";
    } else if (currentPath.includes('ingresar-venta')) {
        greeting += "➕ Estás creando una **nueva oportunidad**. Te guío paso a paso.";
    } else {
        greeting += "🏠 Te doy la bienvenida al sistema de gestión de ventas.";
    }

    if (hasErrors) {
        greeting += "\n\n⚠️ **Nota:** He detectado algunos campos que necesitan atención.";
    }

    greeting += "\n\n**¿En qué puedo ayudarte?** Puedo explicarte cualquier función del sistema o resolver dudas específicas.";
    
    return greeting;
}

// ==================== CARGA DE PREGUNTAS CONTEXTUALES ====================
function loadContextualQuestions() {
    const currentPath = window.location.pathname;
    const questions = getContextualQuestions(currentPath);
    const container = document.getElementById('contextual-questions');
    
    if (!container) return;
    
    container.innerHTML = questions.map((question, index) => `
        <button onclick="showContextualAnswer('${question.category}')" 
                class="w-full text-left bg-slate-700/60 hover:bg-cyan-600/80 text-white p-3 rounded-lg transition-all text-sm">
            <div class="flex items-center space-x-2">
                <span class="text-cyan-400">❓</span>
                <span>${question.text}</span>
            </div>
        </button>
    `).join('');
}

function showContextualAnswer(category) {
    const knowledge = SYSTEM_KNOWLEDGE_BASE[category];
    if (knowledge) {
        showSystemResponse(knowledge.title, knowledge.response, knowledge.actions);
    }
}

function showSystemResponse(title, response, actions = []) {
    const questionsDiv = document.getElementById('nethive-questions');
    const answerDiv = document.getElementById('nethive-answer');
    const answerContent = document.getElementById('answer-content');
    
    if (questionsDiv && answerDiv && answerContent) {
        questionsDiv.classList.add('hidden');
        answerDiv.classList.remove('hidden');
        
        let actionsHTML = '';
        if (actions.length > 0) {
            actionsHTML = `
                <div class="mt-6 space-y-2">
                    <p class="text-cyan-300 font-semibold text-sm">Acciones rápidas:</p>
                    ${actions.map(action => `
                        <a href="${action.url}" class="inline-block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition-colors mr-2">
                            ${action.text}
                        </a>
                    `).join('')}
                </div>
            `;
        }
        
        answerContent.innerHTML = `
            <div class="flex items-start mb-6">
                <div class="flex-shrink-0 mr-4">${createMiniNethiveAvatar()}</div>
                <div class="bg-gradient-to-br from-cyan-900/60 to-blue-900/60 rounded-2xl p-6">
                    <h3 class="text-xl font-bold text-cyan-300 mb-4">${title}</h3>
                    <div class="text-gray-100 whitespace-pre-line">${response}</div>
                    ${actionsHTML}
                </div>
            </div>
        `;
    }
}

// ==================== PREGUNTAS CONTEXTUALES ====================
function getNethiveQuestionsForCurrentPage(currentPath) {
    if (currentPath.includes('dashboard')) {
        return [
            {
                question: "¿Cómo interpretar las métricas de ventas?",
                answer: "📊 <strong>Guía del Dashboard:</strong><br><br>• <strong>Ventas por mes:</strong> Muestra el progreso mensual de tus oportunidades cerradas.<br>• <strong>Por producto:</strong> Analiza qué productos tienen mejor rendimiento.<br>• <strong>Probabilidad promedio:</strong> Indica qué tan cerca estás de cerrar tus oportunidades.<br>• <strong>Filtros:</strong> Usa los filtros de fecha para análisis específicos.",
                category: "Análisis"
            }
        ];
    }

    if (currentPath.includes('todos')) {
        return [
            {
                question: "¿Cómo gestiono mis oportunidades de venta?",
                answer: "💼 <strong>Gestión de Oportunidades:</strong><br><br>• <strong>Crear nueva:</strong> Botón 'Agregar Oportunidad' para crear una nueva.<br>• <strong>Editar:</strong> Haz clic en cualquier oportunidad para editarla.<br>• <strong>Probabilidades:</strong> Actualiza el % de probabilidad según tu progreso.<br>• <strong>Estados:</strong> Cambia entre 'En proceso', 'Ganada', 'Perdida'.",
                category: "Gestión",
                action: { text: "Crear Nueva Oportunidad", url: "/app/ingresar-venta/" }
            }
        ];
    }

    return [
        {
            question: "¿Cómo navego por el sistema?",
            answer: "🧭 <strong>Navegación del sistema:</strong><br><br>• <strong>Menú flotante:</strong> Acceso rápido desde cualquier página.<br>• <strong>Breadcrumbs:</strong> Rastrea tu ubicación actual.<br>• <strong>Shortcuts:</strong> Usa atajos de teclado para acciones comunes.<br>• <strong>Búsqueda:</strong> Campo de búsqueda global en la parte superior.",
            category: "Navegación"
        }
    ];
}

function showNethiveAnswer(questionIndex) {
    const question = window.currentNethiveQuestions[questionIndex];
    const answerContent = document.getElementById('answer-content');
    if (!answerContent) return;

    answerContent.innerHTML = `
        <div class="flex items-start mb-6 animate-fade-in">
            <div class="ml-3 bg-gray-700 rounded-2xl rounded-tl-none p-4 max-w-md">
                <p class="text-white text-sm font-medium">${question.question}</p>
            </div>
        </div>
        <div class="flex items-start mb-6 animate-fade-in">
            <div class="flex-shrink-0 mr-4">${createMiniNethiveAvatar()}</div>
            <div class="ml-3 bg-gradient-to-r from-green-900/30 to-blue-900/30 rounded-2xl rounded-tl-none p-4">
                <div class="text-green-100 text-sm leading-relaxed">${question.answer}</div>
            </div>
        </div>
        ${question.action ? `<div class="mt-4 text-center animate-fade-in"><button onclick="window.location.href='${question.action.url}'" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">${question.action.text}</button></div>` : ''}
    `;

    document.getElementById('nethive-questions').classList.add('hidden');
    document.getElementById('nethive-answer').classList.remove('hidden');
}

function backToNethiveQuestions() {
    document.getElementById('nethive-answer').classList.add('hidden');
    document.getElementById('nethive-questions').classList.remove('hidden');
    
    // Recargar preguntas contextuales por si cambió la página
    loadContextualQuestions();
}

// ==================== CHAT AVANZADO CON IA ====================
window.openAdvancedChatFromBasic = function() {
    updateNethiveMood('excited', '¡Usuario cambió al chat avanzado!');
    
    // Solo ocultar el modal básico, NO el contenedor principal
    const modal = document.getElementById('nethive-assistant-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    
    // Mostrar inmediatamente el chat avanzado (sin timeout)
    showAdvancedNethiveChat();
}

window.showAdvancedNethiveChat = function() {
    updateNethiveMood('excited', '¡Usuario abrió el chat avanzado!');
    
    // Buscar el chat avanzado existente en el template
    const existingChat = document.getElementById('nethive-advanced-chat');
    
    if (existingChat) {
        console.log('✅ Usando chat avanzado existente del template');
        
        // Inicializar estado del chat
        if (!window.chatState) {
            window.chatState = {
                messages: [],
                extractedData: {},
                currentStep: 'greeting',
                isProcessing: false
            };
        }
        
        // Insertar avatares dinámicamente
        const chatAvatarContainer = document.getElementById('chat-avatar-container');
        const initialAvatarContainer = document.getElementById('initial-avatar');
        
        if (chatAvatarContainer) {
            chatAvatarContainer.innerHTML = createNethiveAvatar();
        }
        if (initialAvatarContainer) {
            initialAvatarContainer.innerHTML = createNethiveAvatar();
        }
        
        // Configurar event listeners si no están configurados
        setupChatEventListeners();
        
        // Mostrar el chat
        existingChat.classList.remove('hidden');
        
        // Hacer foco en el input
        setTimeout(() => {
            const input = document.getElementById('chat-input');
            if (input) input.focus();
        }, 300);
        
        return;
    }

    // Si no existe, crear dinámicamente (fallback)
    const chatHTML = `
        <div id="nethive-advanced-chat" class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
            <div class="bg-slate-900/95 backdrop-blur-md rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] border border-cyan-500/40 flex flex-col">
                <div class="bg-gradient-to-r from-cyan-600 via-blue-600 to-purple-600 p-6 rounded-t-3xl">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center space-x-4">
                            <div class="scale-75">${createNethiveAvatar()}</div>
                            <div>
                                <h2 class="text-2xl font-bold text-white">🤖 Chat Avanzado con Koti</h2>
                                <p class="text-cyan-100 text-sm">Conversemos para crear tu oportunidad perfecta</p>
                                <div class="flex items-center space-x-2 mt-1">
                                    <div class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                    <span class="text-green-300 text-xs font-medium">Powered by Gemini AI</span>
                                </div>
                            </div>
                        </div>
                        <button onclick="closeAdvancedChat()" class="text-white/80 hover:text-white text-3xl font-bold transition-colors">&times;</button>
                    </div>
                </div>
                
                <div class="flex-1 flex flex-col min-h-0">
                    <div id="chat-messages" class="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-800/30">
                        <div class="flex items-start space-x-3 opacity-0 animate-fade-in">
                            <div class="scale-50">${createNethiveAvatar()}</div>
                            <div class="bg-slate-700/60 backdrop-blur-sm rounded-2xl rounded-tl-sm p-4 max-w-md">
                                <p class="text-white text-sm">¡Hola! 👋 Soy tu asistente avanzado. Puedo ayudarte a crear una oportunidad de venta completa.</p>
                                <p class="text-cyan-200 text-xs mt-2">Solo dime cosas como:</p>
                                <ul class="text-cyan-300 text-xs mt-1 space-y-1">
                                    <li>• "Necesito crear una oportunidad para Empresa ABC"</li>
                                    <li>• "El cliente quiere servicios de hosting por $15,000"</li>
                                    <li>• "Es una cotización de desarrollo web"</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    
                    <div class="p-6 bg-slate-800/50 border-t border-slate-700/50">
                        <div class="flex items-end space-x-3">
                            <div class="flex-1">
                                <textarea id="chat-input" 
                                        placeholder="Escribe aquí para contarme sobre tu oportunidad..."
                                        class="w-full bg-slate-700/60 text-white placeholder-slate-400 border border-slate-600/50 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50"
                                        rows="2"></textarea>
                            </div>
                            <button onclick="sendChatMessage()" 
                                    class="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white font-semibold px-6 py-3 rounded-xl transition-all hover:scale-105 flex items-center space-x-2">
                                <span>Enviar</span>
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
                                </svg>
                            </button>
                        </div>
                        
                        <div class="flex flex-wrap gap-2 mt-3">
                            <button onclick="insertQuickMessage('Quiero crear una oportunidad para un nuevo cliente')" 
                                    class="bg-slate-700/60 hover:bg-slate-600/60 text-slate-300 text-xs px-3 py-1.5 rounded-lg transition-colors">
                                🏢 Nuevo cliente
                            </button>
                            <button onclick="insertQuickMessage('Necesito una cotización de servicios IT')" 
                                    class="bg-slate-700/60 hover:bg-slate-600/60 text-slate-300 text-xs px-3 py-1.5 rounded-lg transition-colors">
                                💻 Servicios IT
                            </button>
                            <button onclick="insertQuickMessage('El monto estimado es de $50,000 pesos')" 
                                    class="bg-slate-700/60 hover:bg-slate-600/60 text-slate-300 text-xs px-3 py-1.5 rounded-lg transition-colors">
                                💰 Agregar monto
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', chatHTML);
    setupChatEventListeners();
    
    setTimeout(() => {
        const input = document.getElementById('chat-input');
        if (input) input.focus();
        document.querySelector('#chat-messages .animate-fade-in').style.opacity = '1';
    }, 500);
}

window.closeAdvancedChat = function() {
    const chat = document.getElementById('nethive-advanced-chat');
    const basicModal = document.getElementById('nethive-assistant-modal');
    
    if (chat) {
        // Ocultar el chat avanzado
        if (chat.classList.contains('hidden') === false) {
            chat.classList.add('hidden');
        } else {
            // Si es dinámico, remover con animación
            chat.style.opacity = '0';
            chat.style.transform = 'scale(0.95)';
            setTimeout(() => chat.remove(), 300);
        }
    }
    
    // Mostrar el modal básico nuevamente
    if (basicModal) {
        basicModal.classList.remove('hidden');
    }
    
    updateNethiveMood('happy', 'Volviendo al asistente principal');
}

function setupChatEventListeners() {
    // Evitar duplicar listeners
    if (window.chatListenersSetup) return;
    window.chatListenersSetup = true;
    
    console.log('🔧 Configurando event listeners del chat...');
    
    const chatInput = document.getElementById('chat-input');
    const sendButton = document.querySelector('button[onclick="sendChatMessage()"]');
    
    if (chatInput) {
        // Remover listeners existentes para evitar duplicados
        chatInput.removeEventListener('keydown', handleChatKeydown);
        
        // Agregar listener para Enter
        chatInput.addEventListener('keydown', handleChatKeydown);
        console.log('✅ Event listener agregado al input del chat');
    }
    
    if (sendButton) {
        console.log('🔍 Botón de enviar encontrado, agregando listener adicional...');
        sendButton.removeEventListener('click', handleSendButtonClick);
        sendButton.addEventListener('click', handleSendButtonClick);
        console.log('✅ Event listener adicional agregado al botón');
    } else {
        console.error('❌ No se encontró el botón de enviar');
    }
}

function handleChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        console.log('⌨️ Enter presionado, enviando mensaje...');
        window.sendChatMessage();
    }
}

function handleSendButtonClick(e) {
    e.preventDefault();
    console.log('🖱️ Botón de enviar clickeado, enviando mensaje...');
    window.sendChatMessage();
}

// ==================== SISTEMA DE CHAT ====================
// Esta función ya no se necesita, la funcionalidad se movió a setupChatEventListeners

window.insertQuickMessage = function(message) {
    const input = document.getElementById('chat-input');
    if (input) {
        input.value = message;
        input.focus();
    }
}

window.sendChatMessage = function() {
    console.log('🚀 sendChatMessage ejecutado - INICIO DE FUNCIÓN');
    console.log('🔍 Función llamada desde:', new Error().stack);
    
    const input = document.getElementById('chat-input');
    console.log('📝 Input encontrado:', !!input);
    console.log('🔍 chatState existe:', !!window.chatState);
    console.log('⏳ isProcessing:', window.chatState?.isProcessing);
    
    if (!input) {
        console.error('❌ Input chat-input no encontrado');
        return;
    }
    
    if (!window.chatState) {
        console.error('❌ chatState no inicializado, inicializando...');
        window.chatState = {
            messages: [],
            extractedData: {},
            currentStep: 'greeting',
            isProcessing: false
        };
    }
    
    if (window.chatState.isProcessing) {
        console.log('⚠️ Chat está procesando, saltando...');
        return;
    }

    const message = input.value.trim();
    console.log('💬 Mensaje:', message);
    
    if (!message) {
        console.log('⚠️ Mensaje vacío');
        return;
    }

    input.value = '';
    window.chatState.isProcessing = true;

    console.log('✅ Enviando mensaje al chat...');
    addChatMessage(message, 'user');
    setTimeout(() => processUserMessage(message), 1000);
}

function addChatMessage(message, sender = 'bot', isTyping = false) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;

    const messageClass = sender === 'user' ? 'ml-auto bg-gradient-to-r from-cyan-600 to-blue-600 text-white' : 'bg-slate-700/60 text-white';
    const alignClass = sender === 'user' ? 'justify-end' : 'justify-start';

    const messageHTML = `
        <div class="flex ${alignClass} animate-fade-in" style="opacity: 0;">
            ${sender === 'bot' ? `<div class="scale-50 mr-3">${createNethiveAvatar()}</div>` : ''}
            <div class="${messageClass} backdrop-blur-sm rounded-2xl ${sender === 'user' ? 'rounded-tr-sm' : 'rounded-tl-sm'} p-4 max-w-md">
                ${isTyping ? '<div class="typing-indicator">●●●</div>' : `<p class="text-sm">${message}</p>`}
            </div>
        </div>
    `;

    messagesContainer.insertAdjacentHTML('beforeend', messageHTML);

    setTimeout(() => {
        const newMessage = messagesContainer.lastElementChild;
        if (newMessage) newMessage.style.opacity = '1';
    }, 100);

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function processUserMessage(message) {
    updateNethiveMood('thoughtful', 'Procesando mensaje con IA');
    addChatMessage('', 'bot', true);

    try {
        const response = await processWithGeminiAI(message, window.chatState.extractedData);

        const messages = document.getElementById('chat-messages');
        if (messages.lastElementChild) {
            messages.lastElementChild.remove();
        }

        if (response.extractedData) {
            Object.assign(window.chatState.extractedData, response.extractedData);
        }

        addChatMessage(response.message, 'bot');

        if (response.mood) {
            updateNethiveMood(response.mood, response.moodReason);
        }

        if (response.canCreateOpportunity) {
            setTimeout(() => showOpportunityCreationSummary(), 2000);
        }

    } catch (error) {
        console.error('Error processing with Gemini:', error);

        const messages = document.getElementById('chat-messages');
        if (messages.lastElementChild) {
            messages.lastElementChild.remove();
        }

        addChatMessage('Disculpa, hubo un problema con mi conexión. ¿Puedes repetir tu mensaje? 😅', 'bot');
        updateNethiveMood('worried', 'Error de conexión con IA');
    }

    window.chatState.isProcessing = false;
}

// ==================== INTEGRACIÓN GEMINI AI ====================
async function processWithGeminiAI(userMessage, currentData) {
    console.log('🤖 Procesando mensaje con conocimiento del sistema...');
    
    // Primero intentar respuesta automática
    const localResponse = detectLocalIntent(userMessage);
    if (localResponse) {
        console.log('✅ Respuesta automática encontrada');
        return {
            message: `**${localResponse.title}**\n\n${localResponse.response}`,
            mood: 'helpful',
            moodReason: 'Respuesta automática del sistema',
            showForm: false,
            extractedData: null,
            actions: localResponse.actions || []
        };
    }

    // Si no hay respuesta automática, usar Gemini AI con contexto completo
    console.log('🔄 Usando Gemini AI con contexto del sistema...');
    const prompt = buildGeminiPrompt(userMessage, currentData);

    try {
        const response = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 800,
                    topP: 0.8,
                    topK: 10
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Gemini API error: ${response.status}`);
        }

        const data = await response.json();
        const aiResponse = data.candidates[0].content.parts[0].text;

        return parseGeminiResponse(aiResponse);
    } catch (error) {
        console.error('Error processing with Gemini:', error);
        return {
            message: "Disculpa, hubo un problema con la conexión. Pero puedo ayudarte con las preguntas frecuentes sobre el sistema. ¿Te gustaría que te explique alguna función específica?",
            mood: 'worried',
            moodReason: 'Error de conexión con IA',
            showForm: false
        };
    }
}

function buildGeminiPrompt(userMessage, currentData) {
    const currentPath = window.location.pathname;
    
    return `Eres Koti, un asistente virtual mexicano especializado en el Sistema de Gestión de Ventas. Eres amigable, profesional y tienes conocimiento completo del sistema.

CONTEXTO DEL SISTEMA:
Este es un sistema Django de gestión de ventas con las siguientes 3 secciones principales:

🏠 HOME (/app/home/):
- Página principal de inicio
- Punto de partida para navegación
- Acceso a las otras secciones del sistema

🎯 OPORTUNIDADES (/app/todos/):
- Gestión completa de oportunidades de venta
- Estados: Activa, Ganada, Perdida
- Seguimiento de probabilidades (%)
- Filtros por cliente, producto, fecha
- Creación y edición de oportunidades

📄 COTIZACIONES (/app/cotizaciones/):
- Creación de cotizaciones profesionales
- Plantillas Bajanet (hosting) e Iamet (desarrollo)
- Generación automática de PDFs
- Vínculos con oportunidades
- Gestión completa del proceso de cotización

PÁGINA ACTUAL: ${currentPath}

PRODUCTOS DISPONIBLES:
- Hosting y Dominios
- Desarrollo Web
- Consultoría IT
- Telecomunicaciones
- Otros servicios tecnológicos

INSTRUCCIONES:
1. Si la pregunta es sobre navegación, funciones del sistema, o ayuda técnica, responde como experto del sistema
2. Si es una conversación general, responde amigablemente
3. Usa emojis apropiados para cada sección
4. Si mencionan crear, editar, o gestionar algo del sistema, ofrece guía específica
5. Mantén un tono profesional pero cercano

USUARIO PREGUNTA: "${userMessage}"

Responde de manera clara y útil, considerando el contexto de la página actual y las funciones disponibles en el sistema.`;
}

function parseGeminiResponse(aiResponse) {
    try {
        let cleanResponse = aiResponse.trim();

        if (cleanResponse.startsWith('```json')) {
            cleanResponse = cleanResponse.replace(/```json\n?/, '').replace(/```$/, '');
        } else if (cleanResponse.startsWith('```')) {
            cleanResponse = cleanResponse.replace(/```\n?/, '').replace(/```$/, '');
        }

        const parsed = JSON.parse(cleanResponse);

        return {
            extractedData: parsed.extractedData || {},
            message: parsed.message || 'Entiendo tu mensaje. ¿Puedes darme más detalles?',
            mood: parsed.mood || 'thoughtful',
            moodReason: parsed.moodReason || 'Procesando información',
            canCreateOpportunity: parsed.canCreateOpportunity || false
        };
        
    } catch (error) {
        console.error('Error parsing Gemini response:', error);
        console.log('Raw response:', aiResponse);

        return {
            extractedData: {},
            message: aiResponse.length > 0 ? aiResponse : 'Entiendo. ¿Puedes darme más información sobre la oportunidad?',
            mood: 'thoughtful',
            moodReason: 'Procesando respuesta',
            canCreateOpportunity: false
        };
    }
}

// ==================== LÓGICA PROACTIVA ====================
function initProactiveLogic() {
    setupZoneDetection();
    setupFormValidation();
    setupScrollDetection();
    setupProactiveButtons();
}

function setupZoneDetection() {
    let lastClickTime = 0;
    let clicksInSameArea = 0;
    let lastClickArea = null;

    document.body.addEventListener('click', (e) => {
        if (e.target.closest('#nethive-proactive-bot') || 
            e.target.closest('.nethive-assistant') || 
            e.target.closest('#nethive-assistant-modal')) return;

        const currentTime = Date.now();
        const clickArea = identifyClickArea(e.target);

        if (clickArea) {
            const zoneCount = window.nethiveState.zoneClicks.get(clickArea) || 0;
            window.nethiveState.zoneClicks.set(clickArea, zoneCount + 1);

            if (clickArea === lastClickArea && (currentTime - lastClickTime) < 3000) {
                clicksInSameArea++;
                if (clicksInSameArea >= 3) {
                    handleUserStuckInArea(clickArea, e.target);
                    clicksInSameArea = 0;
                }
            } else {
                clicksInSameArea = 1;
            }

            lastClickArea = clickArea;
            lastClickTime = currentTime;
        }

        if (e.target === window.nethiveState.lastClickedElement) {
            window.nethiveState.consecutiveClicksOnElement++;
            if (window.nethiveState.consecutiveClicksOnElement >= 2) {
                handleElementConfusion(e.target);
                window.nethiveState.consecutiveClicksOnElement = 0;
            }
        } else {
            window.nethiveState.lastClickedElement = e.target;
            window.nethiveState.consecutiveClicksOnElement = 1;
        }
    }, true);
}

function identifyClickArea(element) {
    if (element.closest('form')) return 'form-area';
    if (element.closest('table')) return 'table-area';
    if (element.closest('[class*="dashboard"]')) return 'dashboard-area';
    if (element.closest('[class*="nav"], [class*="menu"]')) return 'navigation-area';
    if (element.closest('button[type="submit"]')) return 'submit-area';
    if (element.closest('input, select, textarea')) return 'input-area';
    if (element.closest('[class*="card"], [class*="panel"]')) return 'content-area';
    return 'general-area';
}

function handleUserStuckInArea(area, element) {
    const currentPath = window.location.pathname;
    let message = '';
    let context = { type: 'zone-stuck', area, element, path: currentPath };

    switch (area) {
        case 'form-area':
            if (currentPath.includes('crear_cotizacion')) {
                message = '¿Necesitas ayuda llenando la cotización? Puedo guiarte paso a paso y llenar los campos por ti.';
            } else if (currentPath.includes('ingresar-venta')) {
                message = '¿Tienes problemas creando la oportunidad? Te ayudo con los campos y los lleno automáticamente.';
            } else {
                message = '¿Necesitas ayuda con este formulario? Puedo explicarte cada campo y llenarlo por ti.';
            }
            break;
        case 'table-area':
            message = '¿Buscas algo específico en esta tabla? Puedo ayudarte a encontrarlo, filtrar datos o explicar las columnas.';
            break;
        case 'dashboard-area':
            message = '¿Necesitas ayuda interpretando estas métricas? Puedo explicarte qué significan y cómo mejorar tus números.';
            break;
        default:
            message = 'Parece que estás teniendo dificultades. ¿Quieres que te ayude a completar esta tarea?';
    }

    showProactiveBot(message, 'field-help', context);
}

function setupFormValidation() {
    document.addEventListener('input', (e) => {
        if (e.target.matches('input, select, textarea')) {
            validateFieldProactively(e.target);
        }
    });

    document.addEventListener('blur', (e) => {
        if (e.target.matches('input, select, textarea')) {
            setTimeout(() => validateFieldProactively(e.target, true), 500);
        }
    });
}

function validateFieldProactively(field, onBlur = false) {
    const fieldName = field.name || field.id;
    const value = field.value.trim();
    const currentPath = window.location.pathname;
    const isQuotationForm = currentPath.includes('crear_cotizacion') || currentPath.includes('editar_cotizacion');

    let errorMessage = '';
    let isError = false;
    let errorSeverity = 'medium';

    if (isQuotationForm) {
        if (fieldName && (fieldName.toLowerCase().includes('precio') || fieldName.toLowerCase().includes('monto'))) {
            if (value && !/^[\d.,]+$/.test(value)) {
                errorMessage = `¡Ups! Este campo solo acepta números. Escribiste "${value}" pero debería ser algo como "1500.00"`;
                isError = true;
                errorSeverity = 'critical';
                updateNethiveMood('worried', 'Usuario puso letras en campo de precio');
            }
        }
    }

    if (field.type === 'email' && value && !isValidEmail(value)) {
        errorMessage = `El formato del email no es válido. Debe ser como: usuario@dominio.com`;
        isError = true;
        errorSeverity = 'high';
        updateNethiveMood('worried', 'Email con formato incorrecto');
    }

    if (isError) {
        window.nethiveState.formErrors.set(fieldName, { message: errorMessage, severity: errorSeverity, field: field });

        if (errorSeverity === 'critical' && isQuotationForm) {
            setTimeout(() => {
                showQuotationErrorAssistance(field, errorMessage);
            }, 500);
        }
    } else {
        window.nethiveState.formErrors.delete(fieldName);
        if (window.nethiveState.formErrors.size === 0) {
            updateNethiveMood('happy', 'Todos los campos están correctos');
        }
    }
}

function showQuotationErrorAssistance(field, errorMessage) {
    const assistanceMessage = `¡Detecté un problema! ${errorMessage}. ¿Quieres que te ayude a crear toda la cotización automáticamente?`;
    
    showProactiveBot(
        assistanceMessage, 
        'critical', 
        { 
            type: 'quotation-assistance', 
            field: field, 
            originalError: errorMessage 
        }
    );
}

function setupScrollDetection() {
    let scrollTimer;
    let lastScrollPosition = 0;
    let scrollStuckCount = 0;

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;

        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
            if (Math.abs(currentScroll - lastScrollPosition) < 50) {
                scrollStuckCount++;
                if (scrollStuckCount >= 3 && !window.nethiveState.hasShownForScroll) {
                    showProactiveBot('¿Buscas algo específico? Puedo ayudarte a navegar por la página.');
                    window.nethiveState.hasShownForScroll = true;
                }
            } else {
                scrollStuckCount = 0;
            }
            lastScrollPosition = currentScroll;
        }, 2000);
    });
}

function setupProactiveButtons() {
    document.addEventListener('click', (e) => {
        const proactiveYes = e.target.closest('#proactive-yes');
        const proactiveNo = e.target.closest('#proactive-no');

        if (proactiveYes) {
            handleProactiveYes();
        }
        if (proactiveNo) {
            handleProactiveNo();
        }
    }, true);
}

function handleProactiveYes() {
    const context = window.nethiveState.currentContext;
    
    hideProactiveBot();
    updateNethiveMood('excited', 'Usuario aceptó ayuda');

    if (context && context.type === 'quotation-assistance') {
        setTimeout(() => showAdvancedNethiveChat(), 500);
    } else {
        setTimeout(() => showAdvancedNethiveChat(), 500);
    }
}

function handleProactiveNo() {
    window.nethiveState.userDismissedHelp = true;
    window.nethiveState.dismissalReason = 'user_declined';
    
    updateNethiveMood('sad', 'Usuario declinó mi ayuda');
    showProactiveBot('Entendido. Solo te ayudaré si detecto errores críticos. 👍', 'help');
    
    setTimeout(() => {
        updateNethiveMood('thoughtful', 'Respetando la decisión del usuario');
        hideProactiveBot();
    }, 2000);
}

// ==================== BOT PROACTIVO ====================
function showProactiveBot(message, type = 'question', context = null) {
    if (window.nethiveState.userDismissedHelp && type !== 'critical') return;
    if (document.getElementById('nethive-proactive-bot')) return;

    const isDirectHelp = type === 'help';
    const isCritical = type === 'critical';

    if (type === 'critical') {
        updateNethiveMood('worried', 'Detecté un problema importante');
    } else if (type === 'help') {
        updateNethiveMood('helpful', 'Ofreciendo ayuda específica');
    } else {
        updateNethiveMood('thoughtful', 'Preguntando si necesitas ayuda');
    }

    window.nethiveState.currentContext = context;
    window.nethiveState.lastHelpOffered = { message, type, context, timestamp: Date.now() };

    const avatar = createMiniNethiveAvatar();

    const proactiveBotHTML = `
        <div id="nethive-proactive-bot" class="fixed bottom-6 right-6 max-w-sm z-[9998] nethive-slide-in cursor-pointer group">
            <div class="bg-slate-900/90 backdrop-blur-lg rounded-xl shadow-lg border border-slate-700/50 overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-xl ${isCritical ? 'border-red-400/60 shadow-red-500/20' : 'hover:border-cyan-400/60'}">
                <div class="p-4">
                    <div class="flex items-center space-x-3">
                        <div class="flex-shrink-0 transition-transform duration-300 group-hover:scale-110">
                            ${avatar}
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between mb-2">
                                <p class="text-cyan-400 text-xs font-medium">
                                    ${isCritical ? '🚨 Ayuda Urgente' : '🤖 Koti'}
                                </p>
                                <button onclick="hideProactiveBot()" class="text-gray-500 hover:text-white transition-colors p-1 rounded">
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                                    </svg>
                                </button>
                            </div>
                            <p class="text-gray-300 text-sm leading-tight mb-3">${message}</p>
                            ${!isDirectHelp ? `
                                <div class="flex space-x-2">
                                    <button id="proactive-yes" class="bg-cyan-600/80 hover:bg-cyan-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:shadow-md">
                                        ✨ Ayúdame
                                    </button>
                                    <button id="proactive-no" class="bg-slate-700/60 hover:bg-slate-600 text-gray-400 hover:text-white px-3 py-1.5 rounded-lg text-xs transition-all">
                                        ${isCritical ? 'Ignorar' : 'No gracias'}
                                    </button>
                                </div>
                            ` : `
                                <div class="flex justify-end">
                                    <button id="proactive-no" class="bg-green-600/80 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:shadow-md">
                                        ✅ Ok
                                    </button>
                                </div>
                            `}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', proactiveBotHTML);

    const autoHideDelay = isCritical ? 10000 : isDirectHelp ? 3000 : 5000;
    setTimeout(() => {
        const bot = document.getElementById('nethive-proactive-bot');
        if (bot && !bot.querySelector('button:hover')) {
            hideProactiveBot();
        }
    }, autoHideDelay);
}

window.hideProactiveBot = function() {
    const bot = document.getElementById('nethive-proactive-bot');
    if (bot) bot.remove();
}

// ==================== DETECCIÓN DE OPORTUNIDADES ====================
function initializeOpportunityWatcher() {
    console.log('🔍 Inicializando detección de oportunidades en tiempo real...');

    window.nethiveState.isWatchingOpportunities = true;
    updateNethiveMood('focused', 'Monitoreando nuevas oportunidades');

    window.nethiveState.opportunityWatchInterval = setInterval(() => {
        checkForNewOpportunities();
    }, 30000);

    setTimeout(() => checkForNewOpportunities(), 5000);
}

async function checkForNewOpportunities() {
    if (!window.nethiveState.isWatchingOpportunities) return;

    try {
        const response = await fetch(`/app/api/check-new-local-opportunities/?last_check=${window.nethiveState.lastOpportunityCheck}`, {
            method: 'GET',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/json',
            },
            credentials: 'same-origin'
        });

        if (response.ok) {
            const data = await response.json();

            if (data.new_opportunities && data.new_opportunities.length > 0) {
                console.log('🎯 Nueva oportunidad detectada:', data.new_opportunities);
                handleNewOpportunityDetected(data.new_opportunities[0]);

                window.nethiveState.lastOpportunityCheck = Date.now();
                sessionStorage.setItem('lastOpportunityCheck', window.nethiveState.lastOpportunityCheck);
            }
        }
    } catch (error) {
        console.log('Error checking local opportunities:', error);
    }
}

function handleNewOpportunityDetected(opportunity) {
    updateNethiveMood('excited', '¡Nueva oportunidad detectada!');
    hideProactiveBot?.();
    showPersistentOpportunityNotification(opportunity);
}

function showPersistentOpportunityNotification(opportunity) {
    const existing = document.getElementById('nethive-opportunity-notification');
    if (existing) existing.remove();

    const notificationHTML = `
        <div id="nethive-opportunity-notification" class="fixed top-4 right-4 z-[9999] animate-slide-in-right">
            <div class="bg-gradient-to-br from-green-600 via-emerald-600 to-teal-700 rounded-2xl shadow-2xl border border-green-400/30 max-w-sm">
                <div class="absolute inset-0 bg-green-400/20 rounded-2xl animate-pulse"></div>
                
                <div class="relative p-4">
                    <div class="flex items-start space-x-3">
                        <div class="scale-75 animate-bounce">
                            ${createNethiveAvatar()}
                        </div>
                        
                        <div class="flex-1">
                            <div class="flex items-center space-x-2 mb-2">
                                <h3 class="font-bold text-white text-sm">🎯 ¡Nueva Oportunidad!</h3>
                                <div class="w-2 h-2 bg-green-300 rounded-full animate-pulse"></div>
                            </div>
                            
                            <div class="bg-white/10 backdrop-blur-sm rounded-lg p-3 mb-3">
                                <p class="text-green-100 text-xs font-medium">${opportunity.titulo || 'Nueva oportunidad'}</p>
                                <p class="text-green-200 text-xs mt-1">Cliente: ${opportunity.cliente_nombre || 'Sin especificar'}</p>
                                <p class="text-green-200 text-xs">Monto: ${opportunity.monto_estimado || 'N/A'}</p>
                            </div>
                            
                            <div class="space-y-2">
                                <button onclick="acceptOpportunityQuotation(${opportunity.id})" 
                                        class="w-full bg-white/20 hover:bg-white/30 text-white font-semibold py-2 px-3 rounded-lg text-xs transition-all hover:scale-105 border border-white/20">
                                    ✨ Crear Cotización Ahora
                                </button>
                                <button onclick="dismissOpportunityNotification()" 
                                        class="w-full bg-red-500/20 hover:bg-red-500/40 text-red-100 py-1.5 px-3 rounded-lg text-xs transition-all border border-red-400/20">
                                    Recordar más tarde
                                </button>
                            </div>
                        </div>
                        
                        <div class="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full animate-ping"></div>
                        <div class="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full"></div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', notificationHTML);
    window.currentDetectedOpportunity = opportunity;
}

window.acceptOpportunityQuotation = function(opportunityId) {
    updateNethiveMood('celebrating', '¡Usuario aceptó crear cotización!');

    const notification = document.getElementById('nethive-opportunity-notification');
    if (notification) {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => notification.remove(), 300);
    }

    const opportunity = window.currentDetectedOpportunity;
    if (opportunity) {
        const url = new URL('/app/crear-cotizacion/', window.location.origin);
        url.searchParams.set('oportunidad_id', opportunityId);
        url.searchParams.set('cliente_id', opportunity.cliente_id || '');
        url.searchParams.set('auto_filled', 'true');

        setTimeout(() => {
            window.location.href = url.toString();
        }, 1000);
    }
}

window.dismissOpportunityNotification = function() {
    updateNethiveMood('sad', 'Usuario pospuso crear cotización');

    const notification = document.getElementById('nethive-opportunity-notification');
    if (notification) {
        notification.style.transform = 'translateX(100%)';
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }
}

// ==================== CREACIÓN DE OPORTUNIDADES ====================
function showOpportunityCreationSummary() {
    const data = window.chatState.extractedData;
    
    const summaryMessage = `
        <div class="bg-gradient-to-r from-green-600/20 to-emerald-600/20 border border-green-500/30 rounded-xl p-4 mt-2">
            <h4 class="text-green-300 font-semibold mb-2">📋 Resumen de la Oportunidad</h4>
            <div class="space-y-2 text-sm">
                ${data.cliente ? `<div><span class="text-gray-400">Cliente:</span> <span class="text-white font-medium">${data.cliente}</span></div>` : ''}
                ${data.monto ? `<div><span class="text-gray-400">Monto:</span> <span class="text-green-300 font-medium">${data.monto.toLocaleString()}</span></div>` : ''}
                ${data.area || data.producto ? `<div><span class="text-gray-400">Servicio:</span> <span class="text-blue-300 font-medium">${data.producto || data.area}</span></div>` : ''}
                ${data.titulo ? `<div><span class="text-gray-400">Descripción:</span> <span class="text-white">${data.titulo}</span></div>` : ''}
            </div>
            <div class="flex space-x-2 mt-4">
                <button onclick="createOpportunityFromChat()" 
                        class="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded-lg text-xs transition-colors flex items-center space-x-2">
                    <span>✅ Crear Oportunidad</span>
                </button>
                <button onclick="continueEditing()" 
                        class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg text-xs transition-colors">
                    ✏️ Editar Datos
                </button>
            </div>
        </div>
    `;
    
    addChatMessage(summaryMessage, 'bot');
    updateNethiveMood('excited', '¡Listo para crear oportunidad!');
}

window.createOpportunityFromChat = function() {
    updateNethiveMood('celebrating', '¡Creando oportunidad desde chat!');
    
    const data = window.chatState.extractedData;
    
    createOpportunityViaAPI(data).then(result => {
        if (result.success) {
            addChatMessage(`🎉 ¡Oportunidad creada exitosamente!<br><br>Se ha generado la oportunidad "${result.titulo}" en el sistema. En unos segundos recibirás una notificación para crear la cotización correspondiente.`, 'bot');
            
            setTimeout(() => {
                closeAdvancedChat();
                if (typeof checkForNewOpportunities === 'function') {
                    setTimeout(() => checkForNewOpportunities(), 2000);
                }
            }, 3000);
        } else {
            addChatMessage(`❌ Hubo un error al crear la oportunidad: ${result.error}<br><br>¿Quieres intentarlo de nuevo?`, 'bot');
            updateNethiveMood('worried', 'Error al crear oportunidad');
        }
    });
}

window.continueEditing = function() {
    addChatMessage(`¡Perfecto! Sigamos editando los datos. ¿Qué te gustaría cambiar o agregar? 😊`, 'bot');
    updateNethiveMood('helpful', 'Usuario quiere editar datos');
}

async function createOpportunityViaAPI(data) {
    try {
        const response = await fetch('/app/api/crear-oportunidad/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]')?.value || ''
            },
            body: JSON.stringify({
                oportunidad_nombre: data.titulo || `Oportunidad - ${data.cliente || 'Cliente'}`,
                cliente_nombre: data.cliente || 'Cliente por definir',
                area: data.area || 'consultoría',
                producto: data.producto || 'servicios',
                monto: data.monto || 0,
                probabilidad: data.probabilidad || 50,
                created_from_chat: true
            })
        });

        const result = await response.json();
        return {
            success: result.success,
            titulo: result.oportunidad?.nombre || data.titulo,
            error: result.errors ? Object.values(result.errors).flat().map(e => e.message || e).join(', ') : 'Error desconocido'
        };
        
    } catch (error) {
        return {
            success: false,
            error: `Error de conexión: ${error.message}`
        };
    }
}

// ==================== INTELIGENCIA CONTEXTUAL ====================
function initContextualIntelligence() {
    window.nethiveContextualIntelligence = {
        pageLoadTime: Date.now(),
        userActions: [],
        currentFocus: null,
        behaviorPatterns: new Map(),

        trackUserAction(action, element = null) {
            this.userActions.push({
                action,
                timestamp: Date.now(),
                element: element ? element.tagName + (element.id ? '#' + element.id : '') : null,
                path: window.location.pathname
            });

            if (this.userActions.length > 50) {
                this.userActions.shift();
            }
        }
    };
}

// ==================== UTILIDADES ====================
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateChatResponse(message, extractedData) {
    const lowerMessage = message.toLowerCase();
    
    let response = {
        message: '',
        mood: 'helpful',
        moodReason: 'Ayudando al usuario',
        canCreateOpportunity: false
    };
    
    const hasClient = extractedData.cliente;
    const hasAmount = extractedData.monto;
    const hasService = extractedData.area || extractedData.producto;
    
    if (lowerMessage.includes('hola') || lowerMessage.includes('buenos') || lowerMessage.includes('saludos')) {
        response.message = `¡Hola! 👋 Me da mucho gusto poder ayudarte. Cuéntame sobre la oportunidad que tienes en mente. ¿Para qué cliente es?`;
        response.mood = 'excited';
        response.moodReason = 'Usuario saludó amablemente';
        
    } else if (hasClient && hasAmount && hasService) {
        response.message = `¡Excelente! Ya tengo la información principal:<br><br>🏢 <strong>Cliente:</strong> ${extractedData.cliente}<br>💼 <strong>Servicio:</strong> ${extractedData.producto || extractedData.area}<br>💰 <strong>Monto:</strong> ${extractedData.monto.toLocaleString()}<br><br>¿Te parece que creemos la oportunidad con estos datos?`;
        response.canCreateOpportunity = true;
        response.mood = 'proud';
        response.moodReason = 'Información completa recopilada';
        
    } else {
        response.message = `Entiendo lo que me dices. Para ayudarte mejor a crear la oportunidad, ¿podrías contarme más detalles? Por ejemplo: el nombre del cliente, el tipo de servicio, o el monto estimado. 🤔`;
        response.mood = 'thoughtful';
    }
    
    return response;
}

// ==================== ESTILOS CSS ====================
function addNethiveStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes scale-in {
            from { opacity: 0; transform: scale(0.9); }
            to { opacity: 1; transform: scale(1); }
        }
        .animate-scale-in {
            animation: scale-in 0.3s ease-out;
        }
        
        @keyframes nethive-slide-in {
            from { 
                opacity: 0; 
                transform: translateX(50px) translateY(10px) scale(0.9); 
            }
            to { 
                opacity: 1; 
                transform: translateX(0) translateY(0) scale(1); 
            }
        }
        .nethive-slide-in {
            animation: nethive-slide-in 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }

        @keyframes slide-in-right {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in-right {
            animation: slide-in-right 0.5s ease-out forwards;
        }
        
        @keyframes bounce-subtle {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-4px); }
        }
        .animate-bounce-subtle {
            animation: bounce-subtle 2s infinite;
        }
        
        @keyframes pulse-gentle {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.05); opacity: 0.9; }
        }
        .animate-pulse-gentle {
            animation: pulse-gentle 2s infinite ease-in-out;
        }
        
        @keyframes bounce-excited {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            25% { transform: translateY(-6px) rotate(-2deg); }
            75% { transform: translateY(-3px) rotate(2deg); }
        }
        .animate-bounce-excited {
            animation: bounce-excited 0.8s infinite;
        }
        
        @keyframes sway-sad {
            0%, 100% { transform: translateX(0) translateY(2px); }
            50% { transform: translateX(-2px) translateY(0); }
        }
        .animate-sway-sad {
            animation: sway-sad 3s infinite ease-in-out;
        }
        
        @keyframes glow-proud {
            0%, 100% { 
                transform: scale(1); 
                filter: brightness(1) drop-shadow(0 0 5px currentColor); 
            }
            50% { 
                transform: scale(1.1); 
                filter: brightness(1.2) drop-shadow(0 0 15px currentColor); 
            }
        }
        .animate-glow-proud {
            animation: glow-proud 1.5s infinite ease-in-out;
        }
        
        @keyframes shake-worried {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-2px) translateY(-1px); }
            75% { transform: translateX(2px) translateY(1px); }
        }
        .animate-shake-worried {
            animation: shake-worried 0.5s infinite;
        }
        
        @keyframes think-pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(0.95); opacity: 0.8; }
        }
        .animate-think-pulse {
            animation: think-pulse 2s infinite;
        }
        
        @keyframes ready-bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
        }
        .animate-ready-bounce {
            animation: ready-bounce 1s infinite;
        }
        
        @keyframes focus-glow {
            0%, 100% { 
                box-shadow: 0 0 10px currentColor; 
                transform: scale(1); 
            }
            50% { 
                box-shadow: 0 0 20px currentColor, 0 0 30px currentColor; 
                transform: scale(1.02); 
            }
        }
        .animate-focus-glow {
            animation: focus-glow 2s infinite;
        }
        
        @keyframes celebrate-dance {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            25% { transform: translateY(-8px) rotate(-10deg); }
            50% { transform: translateY(-4px) rotate(5deg); }
            75% { transform: translateY(-6px) rotate(-5deg); }
        }
        .animate-celebrate-dance {
            animation: celebrate-dance 0.6s infinite;
        }
        
        @keyframes wiggle-playful {
            0%, 100% { transform: rotate(0deg); }
            25% { transform: rotate(-5deg); }
            75% { transform: rotate(5deg); }
        }
        .animate-wiggle-playful {
            animation: wiggle-playful 1s infinite ease-in-out;
        }

        @keyframes float {
            0% { transform: translateY(0px); }
            50% { transform: translateY(-8px); }
            100% { transform: translateY(0px); }
        }
        .animate-float {
            animation: float 3s ease-in-out infinite;
        }

        @keyframes pulse-light {
            0% { box-shadow: 0 0 8px rgba(255,255,255,0.7); }
            50% { box-shadow: 0 0 15px rgba(255,255,255,1); }
            100% { box-shadow: 0 0 8px rgba(255,255,255,0.7); }
        }
        .animate-pulse-light {
            animation: pulse-light 2s infinite;
        }

        @keyframes fade-in {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
            animation: fade-in 0.5s ease-out forwards;
        }
        
        .typing-indicator::after {
            content: '';
            animation: typing 1.4s infinite;
        }
        
        @keyframes typing {
            0%, 60%, 100% { opacity: 0; }
            30% { opacity: 1; }
        }

        #chat-messages {
            scrollbar-width: thin;
            scrollbar-color: #475569 #1e293b;
        }
        
        #chat-messages::-webkit-scrollbar {
            width: 6px;
        }
        
        #chat-messages::-webkit-scrollbar-track {
            background: #1e293b;
        }
        
        #chat-messages::-webkit-scrollbar-thumb {
            background: #475569;
            border-radius: 3px;
        }
    `;
    document.head.appendChild(style);
}

// ==================== INICIALIZACIÓN AUTOMÁTICA ====================
document.addEventListener('DOMContentLoaded', () => {
    console.log("🤖 Koti Bot - Iniciando...");
    initNethive();
});

// ==================== EXPORTAR FUNCIONES GLOBALES ====================
// Asegurar que todas las funciones estén disponibles globalmente
console.log("🔧 Exportando funciones de Koti Bot...");

// Funciones principales del asistente
if (typeof window.showNethiveAssistant !== 'function') {
    console.log("⚠️ showNethiveAssistant not found, attempting to define...");
}
window.showNethiveAssistant = window.showNethiveAssistant || function() {
    console.log("🤖 showNethiveAssistant called");
    const modal = document.getElementById('nethive-assistant-modal');
    const container = document.getElementById('nethive-bot-container');
    
    if (modal && container) {
        console.log("✅ Opening bot modal...");
        container.classList.remove('hidden');
        modal.classList.remove('hidden');
    } else {
        console.error("❌ Bot elements not found");
    }
};

window.closeNethiveAssistant = window.closeNethiveAssistant || function() {
    const modal = document.getElementById('nethive-assistant-modal');
    const container = document.getElementById('nethive-bot-container');
    
    if (container) container.classList.add('hidden');
    if (modal) modal.classList.add('hidden');
};

window.openAdvancedChatFromBasic = window.openAdvancedChatFromBasic || function() {
    const basicModal = document.getElementById('nethive-assistant-modal');
    const advancedChat = document.getElementById('nethive-advanced-chat');
    
    if (basicModal) basicModal.classList.add('hidden');
    if (advancedChat) advancedChat.classList.remove('hidden');
};

// Funciones auxiliares
window.showAdvancedNethiveChat = window.showAdvancedNethiveChat || function() {};
window.updateNethiveMood = window.updateNethiveMood || function() {};
window.showProactiveBot = window.showProactiveBot || function() {};

console.log("✅ Koti Bot functions exported globally");

// ==================== DETECCIÓN PROACTIVA DE NUEVAS OPORTUNIDADES ====================
let lastOpportunityCount = 0;
let isFirstLoad = true;

// Función para contar oportunidades en la página actual
function countOpportunitiesOnPage() {
    const opportunityRows = document.querySelectorAll('.oportunidad-item, [data-oportunidad-id]');
    return opportunityRows.length;
}

// Función para obtener la última oportunidad de la página
function getLatestOpportunityFromPage() {
    const opportunityRows = document.querySelectorAll('.oportunidad-item');
    if (opportunityRows.length === 0) return null;
    
    // Asumir que la primera fila es la más reciente (si están ordenadas por fecha)
    const firstRow = opportunityRows[0];
    const nameElement = firstRow.querySelector('a[href*="cotizaciones_por_oportunidad"]');
    const clientElement = firstRow.querySelector('td[data-label="Cliente"]');
    
    if (nameElement) {
        // Extraer ID de oportunidad de la URL
        const href = nameElement.getAttribute('href');
        const idMatch = href.match(/\/(\d+)\/$/);
        const opportunityId = idMatch ? parseInt(idMatch[1]) : null;
        
        return {
            id: opportunityId,
            name: nameElement.textContent.trim(),
            client_name: clientElement ? clientElement.textContent.trim() : null
        };
    }
    
    return null;
}

// Función para verificar nuevas oportunidades usando el DOM
function checkForNewOpportunities() {
    try {
        const currentCount = countOpportunitiesOnPage();
        
        console.log(`📊 Oportunidades en página: ${currentCount}, anteriores: ${lastOpportunityCount}`);
        
        // Si hay más oportunidades que antes y no es la primera carga
        if (currentCount > lastOpportunityCount && !isFirstLoad && lastOpportunityCount > 0) {
            const latestOpportunity = getLatestOpportunityFromPage();
            
            if (latestOpportunity) {
                console.log('🎉 ¡Nueva oportunidad detectada en la página!', latestOpportunity);
                showNewOpportunityBot(latestOpportunity);
            }
        }
        
        lastOpportunityCount = currentCount;
        isFirstLoad = false;
        
    } catch (error) {
        console.log('Error verificando oportunidades:', error);
    }
}

// Observador de mutaciones para detectar cambios en la tabla
function setupOpportunityObserver() {
    const opportunityTable = document.querySelector('#tablaOportunidades, .apple-table tbody');
    if (!opportunityTable) {
        console.log('⚠️ No se encontró tabla de oportunidades para observar');
        return;
    }
    
    const observer = new MutationObserver((mutations) => {
        let hasNewRows = false;
        
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                // Verificar si se agregaron nuevas filas
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.classList && node.classList.contains('oportunidad-item')) {
                        hasNewRows = true;
                    }
                });
            }
        });
        
        if (hasNewRows) {
            console.log('🔄 Se detectaron cambios en la tabla de oportunidades');
            setTimeout(checkForNewOpportunities, 1000); // Esperar un poco para que el DOM se estabilice
        }
    });
    
    observer.observe(opportunityTable, {
        childList: true,
        subtree: true
    });
    
    console.log('👀 Observador de oportunidades iniciado');
}

// Función para detectar si la página se recargó con nueva oportunidad
function checkForNewOpportunityOnLoad() {
    // Verificar si hay parámetros en la URL que indiquen una nueva oportunidad
    const urlParams = new URLSearchParams(window.location.search);
    const fromBitrix = urlParams.get('from_bitrix');
    const newOpportunity = urlParams.get('new_opportunity');
    
    if (fromBitrix === 'true' || newOpportunity === 'true') {
        console.log('🎯 Detectada nueva oportunidad desde Bitrix');
        setTimeout(() => {
            const latestOpportunity = getLatestOpportunityFromPage();
            if (latestOpportunity) {
                showNewOpportunityBot(latestOpportunity);
            }
        }, 2000); // Esperar a que la página cargue completamente
    }
}

// Función para mostrar el bot cuando se detecta nueva oportunidad
function showNewOpportunityBot(opportunity) {
    console.log('🤖 Mostrando bot proactivo para nueva oportunidad');
    
    const proactiveBot = document.getElementById('nethive-proactive-bot');
    if (!proactiveBot) return;
    
    // Configurar el contenido del bot proactivo
    const messageElement = proactiveBot.querySelector('#proactive-message');
    const buttonsElement = proactiveBot.querySelector('#proactive-buttons');
    
    if (messageElement) {
        messageElement.innerHTML = `
            ¡Detecté una nueva oportunidad!<br>
            <strong>"${opportunity.name}"</strong><br>
            <small>Cliente: ${opportunity.client_name || 'Sin cliente'}</small>
        `;
    }
    
    if (buttonsElement) {
        buttonsElement.innerHTML = `
            <button onclick="createQuoteForOpportunity(${opportunity.id})" 
                    class="w-full bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded text-xs font-medium transition-colors mb-2">
                📄 Crear Cotización
            </button>
            <button onclick="hideProactiveBot()" 
                    class="w-full bg-gray-400 hover:bg-gray-500 text-white px-3 py-2 rounded text-xs transition-colors">
                Ahora no
            </button>
        `;
    }
    
    // Mostrar el bot
    proactiveBot.classList.remove('hidden');
    
    // Auto-ocultar después de 15 segundos si no hay acción
    setTimeout(() => {
        if (!proactiveBot.classList.contains('hidden')) {
            hideProactiveBot();
        }
    }, 15000);
}

// Función para ir al formulario de cotización con datos pre-llenados
window.createQuoteForOpportunity = function(opportunityId) {
    console.log(`🚀 Redirigiendo a crear cotización para oportunidad ${opportunityId}`);
    hideProactiveBot();
    
    // Redirigir al formulario con la oportunidad pre-seleccionada
    window.location.href = `/app/crear-cotizacion/oportunidad/${opportunityId}/`;
};

// Función para ocultar el bot proactivo
window.hideProactiveBot = function() {
    const proactiveBot = document.getElementById('nethive-proactive-bot');
    if (proactiveBot) {
        proactiveBot.classList.add('hidden');
    }
};

// Inicializar la verificación periódica de oportunidades
function startOpportunityWatcher() {
    console.log('👀 Iniciando vigilancia de nuevas oportunidades...');
    
    // Verificar inmediatamente para establecer el conteo inicial
    checkForNewOpportunities();
    
    // Verificar cada 30 segundos
    setInterval(checkForNewOpportunities, 30000);
}

// Auto-inicializar si estamos en la página de todos/oportunidades
if (window.location.pathname.includes('/app/todos/') || window.location.pathname.includes('/app/')) {
    console.log('🎯 Iniciando detección de oportunidades...');
    setTimeout(startOpportunityWatcher, 2000); // Esperar 2 segundos después del load
}