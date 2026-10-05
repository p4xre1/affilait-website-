const searchField = document.querySelector('[data-article-search]');
const articleCards = [...document.querySelectorAll('[data-article-card]')];
const resultsCount = document.querySelector('[data-results-count]');
const emptyMessage = document.querySelector('[data-search-empty]');

if (searchField instanceof HTMLInputElement) {
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      searchField.focus();
    }
  });
  searchField.addEventListener('input', () => {
    const query = searchField.value.trim().toLowerCase();
    let visible = 0;
    articleCards.forEach((card) => {
      const text = card.getAttribute('data-search-text') ?? '';
      const matches = !query || text.includes(query);
      card.hidden = !matches;
      if (matches) visible += 1;
    });
    if (resultsCount) resultsCount.textContent = `${visible} ${visible === 1 ? 'guide' : 'guides'}`;
    if (emptyMessage) emptyMessage.hidden = visible !== 0;
  });
}
