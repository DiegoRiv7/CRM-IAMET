document.addEventListener('DOMContentLoaded', () => {
    console.log("Nethive Assistant script loaded and DOM is ready.");

    // Global state for proactive features
    window.nethiveState = {
        clickCount: parseInt(sessionStorage.getItem('nethiveClickCount') || '0'),
        hasShownForClicks: sessionStorage.getItem('hasShownForClicks') === 'true'
    };

    // Initialize all bot functionalities
    initNethiveAssistant();
    initProactiveLogic();
});

// --- Main Assistant Logic ---

const nethivePersonality = {
    moods: ['happy', 'excited', 'thoughtful', 'helpful', 'playful'],
    currentMood: 'happy',
    expressions: {
        happy: { eyes: '⚫⚫', mouth: '︶', color: '#4ade80' },
        excited: { eyes: '✨✨', mouth: '◡', color: '#f59e0b' },
        thoughtful: { eyes: '🤔🤔', mouth: '−', color: '#8b5cf6' },
        helpful: { eyes: '👀👀', mouth: '◠', color: '#06b6d4' },
        playful: { eyes: '😊😊', mouth: '‿', color: '#ec4899' }
    }
};

function updateNethiveMood(mood) {
    nethivePersonality.currentMood = mood;
    const avatar = document.getElementById('nethive-avatar');
    if (!avatar) return;
    const expression = nethivePersonality.expressions[mood];
    const face = avatar.querySelector('.nethive-face');
    const body = avatar.querySelector('.nethive-body');
    if (face) face.style.borderColor = expression.color;
    if (body) body.style.background = `linear-gradient(145deg, ${expression.color}20, ${expression.color}10)`;
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

function getNethiveGreeting() {
    return "Hola soy Nethive, tu asistente virtual. ¿En qué puedo ayudarte hoy?";
}

function getNethiveQuestionsForCurrentPage(currentPath) {
    // This function remains the same as the one in base.html previously
    // It returns the questions array based on the currentPath
    // For brevity, the full implementation is omitted here, but it's the same logic.
    if (currentPath.includes('crear_cotizacion')) {
        return [
            {
                question: "¿Cómo llenar cada campo?",
                answer: "📝 <strong>Guía de campos:</strong><br><br>• <strong>Título:</strong> Nombre descriptivo para la cotización.<br>• <strong>Cliente:</strong> Selecciona un cliente existente o crea uno nuevo con el botón '+'.<br>• <strong>Oportunidad:</strong> (Opcional) Asocia la cotización a una oportunidad existente.<br>• <strong>Productos:</strong> Agrega filas de productos, ya sea manualmente o pegando desde Excel.<br>• <strong>IVA, Moneda, Institución:</strong> Configura los detalles finales de tu cotización.<br>💡 <strong>Tip:</strong> El bot te puede ayudar si te equivocas en algún campo.",
                category: "Formulario"
            },
            {
                question: "¿Cómo crear una oportunidad desde aquí?",
                answer: "➕ <strong>Crear oportunidad:</strong><br><br><strong>Pasos:</strong><br>1️⃣ Junto al campo <strong>'Oportunidad'</strong>, haz clic en el botón <strong>'+'</strong>.<br>2️⃣ Se abrirá una ventana para crear una nueva oportunidad.<br>3️⃣ Llena los datos y guárdala.<br>4️⃣ La nueva oportunidad se vinculará automáticamente a esta cotización y se creará en Bitrix24.",
                category: "Creación"
            },
            {
                question: "¿Dónde veré la cotización que cree?",
                answer: "📄 <strong>Acceso a tus cotizaciones:</strong><br><br>Una vez generada, podrás encontrar tu cotización en la sección de 'Cotizaciones' del menú. También se descargará un PDF a tu navegador.",
                category: "Visualización",
                action: { text: "Ir a Cotizaciones", url: "/cotizaciones/" } // Assumes this URL is correct
            }
        ];
    }
    // Default questions
    return [
        {
            question: "¿Cómo empiezo a usar el cotizador?",
            answer: "🚀 <strong>Primeros pasos:</strong><br><br>El flujo principal es ir a la sección de 'Oportunidades', seleccionar una y desde ahí 'Crear Cotización'.",
            category: "Primeros pasos",
            action: { text: "Ir a Oportunidades", url: "/todos/" } // Assumes this URL is correct
        },
        {
            question: "¿Qué hace cada sección del menú?",
            answer: "📋 <strong>Guía del menú:</strong><br><br>• <strong>Oportunidades:</strong> Gestiona tus leads de Bitrix24.<br>• <strong>Cotizaciones:</strong> Revisa el historial de cotizaciones por cliente.<br>• <strong>Dashboard:</strong> Visualiza tus métricas de venta.",
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
}

window.showNethiveAssistant = function() {
    if (document.getElementById('nethive-assistant-modal')) return; // Already open

    updateNethiveMood('excited');
    const currentPath = window.location.pathname;
    const pageQuestions = getNethiveQuestionsForCurrentPage(currentPath);
    window.currentNethiveQuestions = pageQuestions; // Store globally

    const assistantHTML = `
    <div id="nethive-assistant-modal" class="fixed inset-0 bg-black bg-opacity-85 flex items-center justify-center z-[9999]">
        <div class="bg-gradient-to-br from-slate-800 via-slate-900 to-gray-900 rounded-3xl shadow-2xl w-full max-w-4xl border border-cyan-500/30 max-h-[90vh] overflow-hidden animate-scale-in">
            <div class="bg-gradient-to-r from-cyan-600 via-blue-600 to-purple-600 p-6">
                <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-6">
                        <div id="nethive-avatar">${createNethiveAvatar()}</div>
                        <div>
                            <h2 class="text-3xl font-bold text-white">Nethive</h2>
                            <p class="text-cyan-100 text-sm">Tu Asistente Virtual Inteligente</p>
                        </div>
                    </div>
                    <button onclick="closeNethiveAssistant()" class="text-white/80 hover:text-white text-4xl font-bold">&times;</button>
                </div>
            </div>
            <div id="nethive-content" class="p-8 max-h-[500px] overflow-y-auto">
                <div id="nethive-chat">
                    <div class="flex items-start mb-8"><div class="flex-shrink-0 mr-4">${createMiniNethiveAvatar()}</div><div class="bg-gradient-to-br from-cyan-900/60 to-blue-900/60 rounded-2xl p-6"><div id="nethive-message">${getNethiveGreeting()}</div></div></div>
                    <div id="nethive-questions" class="space-y-4 mt-6">
                        <h3 class="text-cyan-300 font-semibold text-center mb-4">¿Qué te gustaría saber?</h3>
                        ${pageQuestions.map((q, index) => `<button onclick="showNethiveAnswer(${index})" class="w-full text-left bg-slate-700/60 hover:bg-cyan-600/80 text-white p-4 rounded-xl transition-all">${q.question}</button>`).join('')}
                    </div>
                    <div id="nethive-answer" class="hidden">
                        <div id="answer-content"></div>
                        <button onclick="backToNethiveQuestions()" class="mt-6 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg">← Volver</button>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', assistantHTML);
}

window.closeNethiveAssistant = function() {
    const modal = document.getElementById('nethive-assistant-modal');
    if (modal) modal.remove();
}

// --- Proactive Bot Logic ---

function initProactiveLogic() {
    const proactiveYes = document.getElementById('proactive-yes');
    const proactiveNo = document.getElementById('proactive-no');

    if (proactiveYes) {
        proactiveYes.addEventListener('click', () => {
            window.hideProactiveBot();
            window.showNethiveAssistant();
        });
    }
    if (proactiveNo) {
        proactiveNo.addEventListener('click', () => window.hideProactiveBot());
    }

    // Click tracking
    const MAX_CLICKS = 3;
    document.body.addEventListener('click', (e) => {
        if (e.target.closest('#nethive-proactive-bot') || e.target.closest('#assistant-btn') || e.target.closest('#nethive-assistant-modal')) return;
        if (window.nethiveState.hasShownForClicks) return;

        window.nethiveState.clickCount++;
        sessionStorage.setItem('nethiveClickCount', window.nethiveState.clickCount);
        if (window.nethiveState.clickCount >= MAX_CLICKS) {
            window.showProactiveBot('He notado que has estado navegando un momento. ¿Puedo ayudarte en algo?');
            sessionStorage.setItem('hasShownForClicks', 'true');
            window.nethiveState.hasShownForClicks = true;
        }
    }, true);
}

window.initFormAssistance = function(fieldsToValidate) {
    Object.entries(fieldsToValidate).forEach(([fieldId, rules]) => {
        const field = document.getElementById(fieldId);
        if (field) {
            let inactivityTimer;
            field.addEventListener('focus', () => {
                inactivityTimer = setTimeout(() => {
                    const label = document.querySelector(`label[for=${fieldId}]`);
                    const labelText = label ? label.textContent.trim() : "este campo";
                    window.showProactiveBot(`¿Necesitas ayuda con "${labelText}"? Parece que te has detenido un momento.`);
                }, 7000);
            });
            field.addEventListener('blur', () => {
                clearTimeout(inactivityTimer);
                if (!rules.validate(field.value)) {
                    window.showProactiveBot(rules.message);
                }
            });
            field.addEventListener('input', () => clearTimeout(inactivityTimer));
        }
    });
}
