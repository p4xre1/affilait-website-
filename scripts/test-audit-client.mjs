import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/site-audit.js', import.meta.url), 'utf8');

class FakeElement {
  constructor() {
    this.children = [];
    this.listeners = new Map();
    this.classList = { toggle() {} };
    this.hidden = false;
    this.value = '';
    this.disabled = false;
    this.checked = false;
    this._textContent = '';
  }
  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent || '').join('');
  }
  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._textContent = ''; this.children = [...children]; }
  reportValidity() { return true; }
  scrollIntoView() {}
  focus() {}
}

async function runAudit(jsonLdBlockCount, invalidJsonLdCount) {
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new FakeElement());
      return elements.get(selector);
    },
    createElement() { return new FakeElement(); },
    createTextNode(value) {
      const node = new FakeElement();
      node.textContent = value;
      return node;
    },
  };
  document.querySelector('#site-audit-url').value = 'https://example.com/';
  document.querySelector('#site-audit-permission').checked = true;
  const pageUrl = 'https://example.com/';
  const prepared = {
    scanId: '22222222-2222-4222-8222-222222222222',
    siteUrl: 'https://example.com/',
    submittedUrl: pageUrl,
    pageUrls: [pageUrl],
    discoveredCount: 1,
    limits: { pagesPerBatch: 10, maximumPages: 100, maximumSitemapEntries: 5000, maximumSitemaps: 6 },
    pageLimitReached: false,
    sitemapEntryLimitHit: false,
    sitemapFileLimitHit: false,
    discoveryBudgetHit: false,
    robotsDisallowedCount: 0,
    queryRemoved: false,
    sitemapFound: true,
    truncated: false,
    note: 'The sitemap was found.',
    pageSpeed: { scores: [], metrics: [], issues: [] },
  };
  const page = {
    url: pageUrl,
    status: 200,
    contentType: 'text/html; charset=utf-8',
    ok: true,
    isHttps: true,
    title: 'A clear and specific page title',
    description: 'A useful page summary that is long enough to pass the scanner readability heuristic.',
    h1Count: 1,
    canonical: pageUrl,
    canonicalSameSite: true,
    hasViewport: true,
    htmlLang: 'en',
    noindex: false,
    imageCount: 0,
    imagesMissingAlt: 0,
    jsonLdBlockCount,
    invalidJsonLdCount,
    searchEvidence: {
      source: 'crawl',
      language: 'en',
      primaryTopic: 'A clear and specific page title',
      topicConfidence: 0.8,
      pageRole: { role: 'informational-guide', confidence: 0.66, signals: ['The page has several section headings.'] },
      headingEvidence: [{ level: 1, text: 'A clear and specific page title' }],
      questions: [{
        text: 'How can this page help a reader?',
        pageUrl,
        headingLevel: 2,
        confidence: 0.9,
        query: { intent: { primary: 'informational', labels: [{ label: 'informational', confidence: 0.78, evidence: ['Question syntax is present.'] }] }, microIntent: ['how-to'], source: ['site-content-inferred'] },
      }],
      note: 'Topics and question patterns are inferred from crawled titles and headings.',
    },
  };
  const requests = [];
  const fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push({ request, headers: options.headers });
    const data = request.action === 'prepare' ? prepared : { scanId: prepared.scanId, persisted: false, pages: [page] };
    return { ok: true, async json() { return data; } };
  };

  runInNewContext(source, { document, fetch, URL });
  const form = document.querySelector('#site-audit-form');
  const submit = form.listeners.get('submit');
  assert.equal(typeof submit, 'function');
  await submit({ preventDefault() {} });
  elements.requests = requests;
  return elements;
}

const absent = await runAudit(0, 0);
assert.equal(absent.requests.length, 2);
assert.equal(absent.requests[1].request.scanId, '22222222-2222-4222-8222-222222222222');
assert.equal(absent.requests[1].request.finalBatch, true);
assert.equal(absent.requests[1].headers['X-Scan-ID'], '22222222-2222-4222-8222-222222222222');
assert.equal(absent.get('#audit-score-value').textContent, '100');
assert.doesNotMatch(absent.get('#audit-findings-list').textContent, /JSON-LD contains invalid JSON syntax/);
assert.match(absent.get('#audit-scan-note').textContent, /JSON-LD is optional and its absence is not scored as an issue/);
assert.match(absent.get('#audit-intelligence-summary').textContent, /1 scanned pages returned bounded title and heading evidence/);
assert.match(absent.get('#audit-topic-map').textContent, /A clear and specific page title/);
assert.match(absent.get('#audit-question-map').textContent, /How can this page help a reader/);
assert.match(absent.get('#audit-question-map').textContent, /inferred intent: informational/);
assert.match(absent.get('#audit-question-map').textContent, /intent signal: high/);

const valid = await runAudit(1, 0);
assert.equal(valid.get('#audit-score-value').textContent, '100');
assert.doesNotMatch(valid.get('#audit-findings-list').textContent, /JSON-LD contains invalid JSON syntax/);
assert.match(valid.get('#audit-scan-note').textContent, /1 block on 1 of 1 checked HTML pages/);
assert.match(valid.get('#audit-scan-note').textContent, /not a Schema.org or eligibility review/);

const invalid = await runAudit(1, 1);
assert.ok(Number(invalid.get('#audit-score-value').textContent) < 100);
assert.match(invalid.get('#audit-findings-list').textContent, /JSON-LD contains invalid JSON syntax/);
assert.match(invalid.get('#audit-findings-list').textContent, /does not guarantee rankings or AI-search inclusion/);
assert.match(invalid.get('#audit-scan-note').textContent, /1 failed basic JSON parsing/);

console.log('Audit client tests passed: JSON-LD limits remain intact and the separate crawl-derived topic/question panel renders without changing the technical score.');
