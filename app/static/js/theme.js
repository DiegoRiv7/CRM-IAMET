
function applyTheme(theme) {
    const html = document.documentElement;

    // Remove all theme classes
    html.classList.remove('dark-theme', 'light-theme');

    // Remove all data-theme attributes
    html.removeAttribute('data-theme');

    if (theme === 'pink' || theme === 'white' || theme === 'coffee') {
        html.classList.add('light-theme');
    } else {
        html.classList.add('dark-theme');
    }

    if (theme !== 'dark') {
        html.setAttribute('data-theme', theme);
    }

    localStorage.setItem('theme', theme);
}
