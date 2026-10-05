(() => {
  let savedTheme = null;
  try {
    savedTheme = window.localStorage.getItem('fatorati-theme');
  } catch {
    // Continue with the operating-system preference when storage is blocked.
  }

  const validPreference = savedTheme === 'light' || savedTheme === 'dark';
  document.documentElement.dataset.theme = validPreference
    ? savedTheme
    : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = document.documentElement.dataset.theme === 'dark' ? '#0d1713' : '#f8faf8';
})();
