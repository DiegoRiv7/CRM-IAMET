document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if the main assistant elements are on the page
    if (document.getElementById('nethive-proactive-bot')) {
        console.log("Initializing Nethive Proactive Bot...");
        initProactiveLogic();
    }
});

// Make functions globally available
window.showProactiveBot = function(message) {
    const botContainer = document.getElementById('nethive-proactive-bot');
    const messageEl = document.getElementById('proactive-message');
    const avatarEl = document.getElementById('proactive-avatar-container');

    // Check if the main assistant is already open
    if (document.getElementById('nethive-assistant-modal') && !document.getElementById('nethive-assistant-modal').classList.contains('hidden')) {
        return; // Don't show if the main assistant is active
    }

    if (botContainer && messageEl && avatarEl) {
        if (typeof createMiniNethiveAvatar === 'function') {
            avatarEl.innerHTML = createMiniNethiveAvatar();
        } else {
            // Fallback avatar if the function is not available
            avatarEl.innerHTML = `<div class="w-12 h-12 rounded-full flex items-center justify-center bg-gradient-to-br from-cyan-500 to-blue-600"><span class="text-2xl">🤖</span></div>`;
        }
        messageEl.textContent = message;
        
        botContainer.classList.remove('hidden');
        setTimeout(() => {
            botContainer.classList.remove('opacity-0', 'translate-x-full');
        }, 10);
    }
}

window.hideProactiveBot = function() {
    const botContainer = document.getElementById('nethive-proactive-bot');
    if (botContainer) {
        botContainer.classList.add('opacity-0', 'translate-x-full');
        setTimeout(() => {
            botContainer.classList.add('hidden');
        }, 500);
    }
}

function initProactiveLogic() {
    // 1. Click tracking logic
    const MAX_CLICKS = 3;
    let clickCount = parseInt(sessionStorage.getItem('nethiveClickCount') || '0');
    let hasShownForClicks = sessionStorage.getItem('hasShownForClicks') === 'true';

    document.body.addEventListener('click', (e) => {
        if (e.target.closest('#nethive-proactive-bot') || e.target.closest('#assistant-btn') || e.target.closest('#nethive-assistant-modal')) {
            return; // Ignore clicks inside the bot itself or on its launcher
        }

        if (!hasShownForClicks) {
            clickCount++;
            sessionStorage.setItem('nethiveClickCount', clickCount);
            if (clickCount >= MAX_CLICKS) {
                window.showProactiveBot('He notado que has estado navegando un momento. ¿Puedo ayudarte en algo?');
                sessionStorage.setItem('hasShownForClicks', 'true');
                hasShownForClicks = true;
            }
        }
    }, true);

    // 2. Attach event listeners to the proactive bot's buttons
    const proactiveYes = document.getElementById('proactive-yes');
    const proactiveNo = document.getElementById('proactive-no');

    if (proactiveYes) {
        proactiveYes.addEventListener('click', () => {
            window.hideProactiveBot();
            if (typeof showNethiveAssistant === 'function') {
                showNethiveAssistant();
            }
        });
    }

    if (proactiveNo) {
        proactiveNo.addEventListener('click', () => {
            window.hideProactiveBot();
        });
    }

    console.log("Proactive logic initialized.");
}

// Logic for specific forms (e.g., quote creation)
window.initFormAssistance = function(fieldsToValidate) {
    console.log("Initializing form assistance...");
    Object.entries(fieldsToValidate).forEach(([fieldId, rules]) => {
        const field = document.getElementById(fieldId);
        if (field) {
            let inactivityTimer;

            field.addEventListener('focus', () => {
                // Start a timer to check for inactivity
                inactivityTimer = setTimeout(() => {
                    const label = document.querySelector(`label[for=${fieldId}]`);
                    const labelText = label ? label.textContent.trim() : "este campo";
                    window.showProactiveBot(`¿Necesitas ayuda con "${labelText}"? Parece que te has detenido un momento.`);
                }, 7000); // 7 seconds of inactivity
            });

            field.addEventListener('blur', () => {
                // Clear the inactivity timer
                clearTimeout(inactivityTimer);

                // Perform validation
                const { validate, message } = rules;
                if (!validate(field.value)) {
                    window.showProactiveBot(message);
                } else {
                    // Optional: hide the bot if the user corrects the field
                    // window.hideProactiveBot(); 
                }
            });

            // Clear timer if user starts typing
            field.addEventListener('input', () => {
                clearTimeout(inactivityTimer);
            });
        }
    });
}