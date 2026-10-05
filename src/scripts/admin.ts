export {};

interface ArticleSummary {
    slug: string;
    title: string;
    category: string;
    publishedAt: string;
    sha: string;
  }
  interface Article extends ArticleSummary { content: string; }
  interface ApiError { error?: string; }

  const listElement = document.querySelector<HTMLElement>('#article-list')!;
  const countElement = document.querySelector<HTMLElement>('#article-count')!;
  const libraryStatus = document.querySelector<HTMLElement>('#library-status')!;
  const form = document.querySelector<HTMLFormElement>('#article-form')!;
  const slugField = document.querySelector<HTMLInputElement>('#article-slug')!;
  const sourceField = document.querySelector<HTMLTextAreaElement>('#article-source')!;
  const saveButton = document.querySelector<HTMLButtonElement>('#save-article')!;
  const newButton = document.querySelector<HTMLButtonElement>('#new-article')!;
  const refreshButton = document.querySelector<HTMLButtonElement>('#refresh-articles')!;
  const titleElement = document.querySelector<HTMLElement>('#editor-title')!;
  const revisionElement = document.querySelector<HTMLElement>('#revision-state')!;
  const editorStatus = document.querySelector<HTMLElement>('#editor-status')!;

  let articleList: ArticleSummary[] = [];
  let activeSlug: string | null = null;
  let activeSha: string | undefined;
  let isDirty = false;
  let loading = false;

  async function apiRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { ...(init.headers ?? {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    let payload: T & ApiError;
    try {
      payload = await response.json() as T & ApiError;
    } catch {
      throw new Error(response.status === 401 ? 'Your Cloudflare Access session expired. Sign in again.' : 'The editorial service returned an unexpected response.');
    }
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  }

  function setEditorStatus(message: string, state: 'info' | 'success' | 'error' = 'info') {
    editorStatus.textContent = message;
    editorStatus.dataset.state = state;
  }

  function setBusy(value: boolean) {
    loading = value;
    saveButton.disabled = value || sourceField.disabled || !sourceField.value.trim() || !slugField.value.trim() || (!isDirty && Boolean(activeSha));
    newButton.disabled = value;
    refreshButton.disabled = value;
    listElement.setAttribute('aria-busy', String(value));
    if (value) saveButton.textContent = 'Publishing…';
    else saveButton.textContent = 'Commit & publish';
  }

  function refreshSaveState() {
    saveButton.disabled = loading || sourceField.disabled || !sourceField.value.trim() || !slugField.value.trim();
    isDirty = true;
    revisionElement.textContent = activeSha ? 'Unsaved changes' : 'New article';
  }

  function makeArticleTemplate(): string {
    const date = new Date().toISOString().slice(0, 10);
    return `---
title: "New article title"
description: "Write a clear 50–180 character description that tells readers what this guide covers."
category: education
publishedAt: ${date}
updatedAt: ${date}
readTime: 5
shortAnswer: "Write a direct, useful answer of at least forty characters that responds to the reader's main question."
featured: false
topPick: "A practical reader-first approach"
comparison:
  - product: "Recommended approach"
    bestFor: "Readers who need a clear starting point"
    standout: "Explain the most useful distinction or benefit for this audience"
    keepInMind: "Describe a limitation or trade-off readers should understand"
  - product: "Alternative approach"
    bestFor: "Readers with a different priority or constraint"
    standout: "Explain when this alternative can make sense"
    keepInMind: "Name the evidence or caveat readers should check"
pros:
  - "A clear advantage that is useful to the intended reader"
  - "Another specific benefit that can be explained with evidence"
cons:
  - "A meaningful limitation or trade-off to disclose"
  - "Another practical constraint readers should consider"
productLink:
  product: Semrush
  label: Explore Semrush tools
  href: "https://www.semrush.com/"
sources: []
---

Write an original, evidence-led article for a specific reader. Link important claims to reliable sources, explain uncertainty, and avoid unsupported product claims.

## Short answer

Summarize the main answer in plain language.

## Who this is for

Describe the intended reader and the situations where the advice is useful.

## How to approach the decision

Compare meaningful options, explain the evidence, and name practical trade-offs.

## Conclusion

Offer a clear next step without overstating what a tool can do.
`;
  }

  function renderList() {
    listElement.replaceChildren();
    countElement.textContent = `${articleList.length} ${articleList.length === 1 ? 'article' : 'articles'}`;
    if (!articleList.length) {
      const empty = document.createElement('p');
      empty.className = 'admin-list-empty';
      empty.textContent = 'No Markdown articles were found.';
      listElement.append(empty);
      return;
    }
    for (const article of articleList) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'admin-article-item';
      button.setAttribute('aria-current', String(article.slug === activeSlug));
      button.dataset.slug = article.slug;
      const title = document.createElement('span');
      title.className = 'admin-article-item__title';
      title.textContent = article.title;
      const meta = document.createElement('span');
      meta.className = 'admin-article-item__meta';
      meta.textContent = `${article.category} · ${article.publishedAt || 'date not set'}`;
      button.append(title, meta);
      listElement.append(button);
    }
  }

  async function loadArticles(selectSlug?: string) {
    libraryStatus.textContent = 'Loading article library…';
    try {
      const result = await apiRequest<{ articles: ArticleSummary[] }>('/api/admin/content');
      articleList = result.articles;
      libraryStatus.textContent = '';
      renderList();
      if (selectSlug) await openArticle(selectSlug, true);
    } catch (error) {
      libraryStatus.textContent = error instanceof Error ? error.message : 'Could not load the article library.';
      countElement.textContent = 'Unable to load';
    }
  }

  async function openArticle(slug: string, discardChanges = false) {
    if (isDirty && !discardChanges && !window.confirm('Discard your unsaved changes and open another article?')) return;
    listElement.querySelectorAll<HTMLButtonElement>('.admin-article-item').forEach((button) => {
      button.setAttribute('aria-current', String(button.dataset.slug === slug));
    });
    setBusy(true);
    setEditorStatus('Loading Markdown from GitHub…');
    try {
      const result = await apiRequest<{ article: Article }>(`/api/admin/content/${encodeURIComponent(slug)}`);
      const article = result.article;
      activeSlug = article.slug;
      activeSha = article.sha;
      slugField.value = article.slug;
      slugField.readOnly = true;
      sourceField.value = article.content;
      sourceField.disabled = false;
      titleElement.textContent = article.title;
      revisionElement.textContent = 'Saved revision';
      isDirty = false;
      setEditorStatus('Loaded from the configured GitHub branch.');
      renderList();
    } catch (error) {
      setEditorStatus(error instanceof Error ? error.message : 'Could not open this article.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function startNewArticle() {
    if (isDirty && !window.confirm('Discard your unsaved changes and start a new article?')) return;
    activeSlug = null;
    activeSha = undefined;
    slugField.value = '';
    slugField.readOnly = false;
    sourceField.value = makeArticleTemplate();
    sourceField.disabled = false;
    titleElement.textContent = 'New article';
    revisionElement.textContent = 'Not published';
    isDirty = false;
    setEditorStatus('Complete the template, choose a unique slug, then commit to publish.');
    renderList();
    slugField.focus();
    refreshSaveState();
  }

  listElement.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('.admin-article-item');
    if (button?.dataset.slug) void openArticle(button.dataset.slug);
  });
  newButton.addEventListener('click', startNewArticle);
  refreshButton.addEventListener('click', () => void loadArticles());
  sourceField.addEventListener('input', refreshSaveState);
  slugField.addEventListener('input', refreshSaveState);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const slug = slugField.value.trim();
    const content = sourceField.value;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setEditorStatus('Use lowercase letters and numbers separated by single hyphens for the slug.', 'error');
      slugField.focus();
      return;
    }
    setBusy(true);
    setEditorStatus('Validating the article and committing it to GitHub…');
    try {
      const result = await apiRequest<{ article: { slug: string; title: string; sha: string } }>('/api/admin/content', {
        method: 'POST',
        body: JSON.stringify({ slug, content, expectedSha: activeSha }),
      });
      activeSlug = result.article.slug;
      activeSha = result.article.sha;
      slugField.value = activeSlug;
      slugField.readOnly = true;
      titleElement.textContent = result.article.title;
      revisionElement.textContent = 'Committed to GitHub';
      isDirty = false;
      setEditorStatus('Article committed successfully. A Cloudflare Pages deployment will follow if repository builds are enabled.', 'success');
      await loadArticles(activeSlug);
    } catch (error) {
      setEditorStatus(error instanceof Error ? error.message : 'Could not publish this article.', 'error');
    } finally {
      setBusy(false);
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!isDirty) return;
    event.preventDefault();
    Reflect.set(event, 'returnValue', '');
  });

  void loadArticles();
