const themeToggleSelector = '[data-theme-toggle]';
const root = document.documentElement;

function getPreferredTheme() {
  const current = root.dataset.theme;
  if (current === 'light' || current === 'dark') return current;

  try {
    const savedTheme = localStorage.getItem('fatorati-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
  } catch {
    // Fall back to the operating-system preference when storage is unavailable.
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme, persist = false) {
  const isDark = theme === 'dark';
  root.dataset.theme = isDark ? 'dark' : 'light';
  const nextTheme = isDark ? 'light' : 'dark';

  document.querySelectorAll(themeToggleSelector).forEach((button) => {
    button.setAttribute('aria-label', `Switch to ${nextTheme} mode`);
    button.setAttribute('title', `Switch to ${nextTheme} mode`);
    button.setAttribute('aria-pressed', String(isDark));
  });

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = isDark ? '#0d1713' : '#f8faf8';

  if (persist) {
    try {
      localStorage.setItem('fatorati-theme', root.dataset.theme);
    } catch {
      // The selected theme still applies for this page when storage is unavailable.
    }
  }
}

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest(themeToggleSelector);
  if (!button) return;
  applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
});

applyTheme(getPreferredTheme());
