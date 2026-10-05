import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

function dataUrl(javascript) {
  return `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`;
}

async function loadModule(path, replacements = []) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [search, replacement] of replacements) source = source.replace(search, replacement);
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return dataUrl(javascript);
}

const intelligenceModuleUrl = await loadModule('../functions/_shared/search-intelligence.ts');
const runtimeEnvUrl = await loadModule('../functions/_shared/runtime-env.ts');
const scanLimiterUrl = await loadModule('../functions/_shared/scan-limiter.ts');
const scanRepositoryUrl = await loadModule('../functions/_shared/scan-repository.ts');
const observabilityUrl = await loadModule('../functions/_shared/observability.ts', [
  ["from './runtime-env';", `from '${runtimeEnvUrl}';`],
]);
const moduleUrl = await loadModule('../functions/api/scan.ts', [
  ["from '../_shared/search-intelligence';", `from '${intelligenceModuleUrl}';`],
  ["from '../_shared/observability';", `from '${observabilityUrl}';`],
  ["from '../_shared/scan-limiter';", `from '${scanLimiterUrl}';`],
  ["from '../_shared/scan-repository';", `from '${scanRepositoryUrl}';`],
  ["from '../_shared/runtime-env';", `from '${runtimeEnvUrl}';`],
]);
const { onRequestPost } = await import(moduleUrl);
const originalFetch = globalThis.fetch;
const originalConsole = { log: console.log, warn: console.warn, error: console.error };
const structuredLogs = [];
console.log = (line) => structuredLogs.push(String(line));
console.warn = (line) => structuredLogs.push(String(line));
console.error = (line) => structuredLogs.push(String(line));
const psiRequests = [];
const pageFetches = [];
const persistenceProjectId = '11111111-1111-4111-8111-111111111111';
const mismatchedProjectId = '22222222-2222-4222-8222-222222222222';
const persistenceToken = 'test.header.signature';
const persistenceRequests = [];
const persistenceState = { scan: null, pages: [] };

function pageHtml(url) {
  const path = new URL(url).pathname;
  const title = path === '/duplicate'
    ? 'Shared title for duplicate tests'
    : path === '/page-1'
      ? 'Best running shoes for beginners under $100'
      : `Page ${path}`;
  const headingMarkup = path === '/page-1'
    ? '<h2>How do I choose running shoes?</h2><h2>What makes a shoe comfortable?</h2>'
    : '<h2>Page details</h2>';
  const jsonLd = path === '/page-2'
    ? '<script type="application/ld+json">{"@type":}</script>'
    : path === '/page-3'
      ? ''
      : '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"Test page"}</script><script TYPE="application/ld+json; charset=utf-8">[]</script>';
  return `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="A unique summary for this public website page, used by automated scanner tests."><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="${url}">${jsonLd}</head><body><script>const hidden = '<h2>Fake hidden search question?</h2>';</script><!-- <h2>Commented-out fake topic</h2> --><h1>${title}</h1>${headingMarkup}<img src="/image.png" alt="A sample image"></body></html>`;
}

function makeSitemap(paths) {
  return `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>https://example.com${path}</loc></url>`).join('')}</urlset>`;
}

function xmlResponse(text) {
  return new Response(text, { status: 200, headers: { 'content-type': 'application/xml; charset=utf-8' } });
}

function htmlResponse(url) {
  const contentType = new URL(url).pathname === '/page-4' ? 'application/xhtml+xml; charset=utf-8' : 'text/html; charset=utf-8';
  return new Response(pageHtml(url), { status: 200, headers: { 'content-type': contentType } });
}

function psiResponse(url) {
  psiRequests.push(url);
  return new Response(JSON.stringify({
    lighthouseResult: {
      categories: {
        performance: { score: 0.9, auditRefs: [{ id: 'largest-contentful-paint', weight: 1 }] },
        accessibility: { score: 0.91, auditRefs: [] },
        'best-practices': { score: 0.93, auditRefs: [] },
        seo: { score: 0.98, auditRefs: [] },
      },
      audits: {
        'largest-contentful-paint': { score: 0.4, title: 'Large content takes time', displayValue: '3.2 s', description: 'Review page assets.' },
        'cumulative-layout-shift': { displayValue: '0.02' },
        'total-blocking-time': { displayValue: '120 ms' },
      },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname === 'unavailable.supabase.co') return new Response('temporarily unavailable', { status: 503 });
  if (url.hostname === 'project.supabase.co') {
    persistenceRequests.push({ url, init });
    const table = url.pathname.split('/').at(-1);
    const method = init.method || 'GET';
    if (table === 'projects' && method === 'GET') {
      const projectId = url.searchParams.get('id')?.slice(3) || persistenceProjectId;
      const domain = projectId === mismatchedProjectId ? 'different.example' : 'example.com';
      return new Response(JSON.stringify([{ id: projectId, domain }]), { headers: { 'content-type': 'application/json' } });
    }
    if (table === 'scans' && method === 'POST') {
      const body = JSON.parse(init.body);
      persistenceState.scan = { ...body, created_at: '2026-10-05T12:00:00.000Z' };
      return new Response(JSON.stringify([persistenceState.scan]), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (table === 'scans' && method === 'GET') {
      const scanId = url.searchParams.get('id')?.slice(3);
      return new Response(JSON.stringify(persistenceState.scan?.id === scanId ? [persistenceState.scan] : []), { headers: { 'content-type': 'application/json' } });
    }
    if (table === 'scans' && method === 'PATCH') {
      Object.assign(persistenceState.scan, JSON.parse(init.body));
      return new Response(JSON.stringify([persistenceState.scan]), { headers: { 'content-type': 'application/json' } });
    }
    if (table === 'crawl_pages' && method === 'POST') {
      persistenceState.pages = JSON.parse(init.body);
      return new Response(null, { status: 204 });
    }
    if (table === 'crawl_pages' && method === 'GET') {
      return new Response(JSON.stringify(persistenceState.pages), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected Supabase request in scanner test: ${method} ${url.pathname}`);
  }
  if (url.hostname === 'www.googleapis.com') return psiResponse(url);
  if (url.hostname === 'example.com') {
    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /private/\nSitemap: https://example.com/sitemap-index.xml\n', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }
    if (url.pathname === '/sitemap.xml') return new Response('Not found', { status: 404 });
    if (url.pathname === '/sitemap-index.xml') {
      return xmlResponse('<sitemapindex><sitemap><loc>https://example.com/pages.xml</loc></sitemap></sitemapindex>');
    }
    if (url.pathname === '/pages.xml') {
      return xmlResponse(makeSitemap([
        ...Array.from({ length: 12 }, (_, index) => `/page-${index + 1}`),
        '/private/hidden',
        'https://outside.example.net/not-allowed',
      ]));
    }
    pageFetches.push(url.toString());
    return htmlResponse(url.toString());
  }
  if (url.hostname === 'many.example.com') {
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nSitemap: https://many.example.com/sitemap.xml\n', { status: 200 });
    if (url.pathname === '/sitemap.xml') {
      const entries = Array.from({ length: 5_000 }, (_, index) => `<url><loc>https://many.example.com/page-${index + 1}</loc></url>`).join('');
      return xmlResponse(`<urlset>${entries}</urlset>`);
    }
  }
  if (url.hostname === 'index.example.com') {
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nSitemap: https://index.example.com/sitemap-index.xml\n', { status: 200 });
    if (url.pathname === '/sitemap-index.xml') {
      const entries = Array.from({ length: 7 }, (_, index) => `<sitemap><loc>https://index.example.com/map-${index + 1}.xml</loc></sitemap>`).join('');
      return xmlResponse(`<sitemapindex>${entries}</sitemapindex>`);
    }
    if (/^\/map-\d+\.xml$/.test(url.pathname)) return xmlResponse(`<urlset><url><loc>https://index.example.com${url.pathname.replace('.xml', '')}/</loc></url></urlset>`);
    pageFetches.push(url.toString());
    return htmlResponse(url.toString());
  }
  throw new Error(`Unexpected outbound fetch in scanner test: ${url}`);
};

async function post(body, { ip = '198.51.100.10', origin = 'https://fatorati.me', env = {}, token } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Origin: origin,
    'CF-Connecting-IP': ip,
  };
  if (body.scanId) headers['X-Scan-ID'] = body.scanId;
  if (token) headers.Authorization = `Bearer ${token}`;
  const request = new Request('https://fatorati.me/api/scan', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return onRequestPost({ request, env });
}

try {
  const missingPermission = await post({ action: 'prepare', url: 'https://example.com' });
  assert.equal(missingPermission.status, 400);
  assert.match((await missingPermission.json()).error, /permission/i);

  const privateAddress = await post({ action: 'prepare', permission: true, url: 'http://127.0.0.1' });
  assert.equal(privateAddress.status, 400);
  assert.match((await privateAddress.json()).error, /public domain names/i);

  for (const [index, maliciousAddress] of [
    'http://127.1',
    'http://0177.0.0.1',
    'http://0x7f.0.0.1',
    'http://169.254.169.254',
    'http://127.0.0.1.nip.io',
    'http://metadata.google.internal',
    'http://internal-service.local',
    'http://database.internal',
  ].entries()) {
    const res = await post({ action: 'prepare', permission: true, url: maliciousAddress }, { ip: `198.51.100.${100 + index}` });
    assert.equal(res.status, 400, `Expected 400 for ${maliciousAddress}`);
    assert.match((await res.json()).error, /public domain names/i);
  }

  const controlCharUrl = await post({ action: 'prepare', permission: true, url: 'https://example.com\r\n/path' }, { ip: '198.51.100.120' });
  assert.equal(controlCharUrl.status, 400);
  assert.match((await controlCharUrl.json()).error, /control characters/i);

  const badOrigin = await post({ action: 'prepare', permission: true, url: 'https://example.com' }, { origin: 'https://attacker.invalid' });
  assert.equal(badOrigin.status, 403);

  const badBatch = await post({
    action: 'scan-pages', permission: true, siteUrl: 'https://example.com',
    pages: Array.from({ length: 11 }, (_, index) => `https://example.com/page-${index}`),
  });
  assert.equal(badBatch.status, 400);
  assert.match((await badBatch.json()).error, /between 1 and 10/i);

  const preparedResponse = await post({ action: 'prepare', permission: true, url: 'https://example.com/page-1?private=token#section' });
  assert.equal(preparedResponse.status, 200);
  const prepared = await preparedResponse.json();
  assert.match(prepared.scanId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(prepared.persisted, false, 'the public scanner remains stateless without a user JWT and project');
  assert.equal(preparedResponse.headers.get('x-request-id')?.length, 36);
  assert.equal(preparedResponse.headers.get('x-scan-id'), prepared.scanId);
  assert.equal(prepared.queryRemoved, true);
  assert.equal(prepared.submittedUrl, 'https://example.com/page-1');
  assert.equal(prepared.sitemapFound, true);
  assert.equal(prepared.discoveredCount, 12);
  assert.equal(prepared.pageUrls.length, 12);
  assert.equal(prepared.robotsDisallowedCount, 1);
  assert.equal(prepared.truncated, false);
  assert.equal(prepared.limits.maximumPages, 100);
  assert.equal(prepared.limits.pagesPerBatch, 10);
  assert.deepEqual(prepared.pageSpeed.scores.map(({ id, score }) => [id, score]), [['performance', 90], ['accessibility', 91], ['best-practices', 93], ['seo', 98]]);
  assert.equal(prepared.pageSpeed.issues.length, 1);
  assert.equal(psiRequests.length, 1);
  assert.equal(new URL(psiRequests[0]).searchParams.get('url'), 'https://example.com/page-1');

  const firstBatch = await post({ action: 'scan-pages', permission: true, scanId: prepared.scanId, siteUrl: prepared.siteUrl, pages: prepared.pageUrls.slice(0, 10), finalBatch: false });
  assert.equal(firstBatch.status, 200);
  const firstPages = await firstBatch.json();
  assert.equal(firstPages.scanId, prepared.scanId);
  assert.equal(firstPages.persisted, false);
  assert.equal(firstBatch.headers.get('x-scan-id'), prepared.scanId);
  assert.equal(firstPages.pages.length, 10);
  assert.ok(firstPages.pages.every((page) => page.status === 200 && page.ok && page.htmlLang === 'en'));
  assert.ok(firstPages.pages.every((page) => page.imageCount === 1 && page.imagesMissingAlt === 0));
  const searchEvidence = firstPages.pages[0].searchEvidence;
  assert.equal(searchEvidence.source, 'crawl');
  assert.equal(searchEvidence.primaryTopic, 'Best running shoes for beginners under $100');
  assert.equal(searchEvidence.pageRole.role, 'buying-guide');
  assert.equal(searchEvidence.headingEvidence.length, 3);
  assert.equal(searchEvidence.questions.length, 2);
  assert.equal(searchEvidence.questions[0].query.source[0], 'site-content-inferred');
  assert.equal(searchEvidence.questions[0].query.intent.primary, 'informational');
  assert.equal(searchEvidence.questions[0].query.searchVolume, undefined);
  assert.equal(firstPages.pages[0].jsonLdBlockCount, 2);
  assert.equal(firstPages.pages[0].invalidJsonLdCount, 0);
  assert.equal(firstPages.pages[1].jsonLdBlockCount, 1);
  assert.equal(firstPages.pages[1].invalidJsonLdCount, 1);
  assert.equal(firstPages.pages[2].jsonLdBlockCount, 0);
  assert.equal(firstPages.pages[2].invalidJsonLdCount, 0);
  assert.equal(firstPages.pages[3].contentType, 'application/xhtml+xml; charset=utf-8');
  assert.equal(firstPages.pages[3].ok, true);
  assert.equal(firstPages.pages[3].jsonLdBlockCount, 2);
  assert.equal(firstPages.pages[3].invalidJsonLdCount, 0);
  const secondBatch = await post({ action: 'scan-pages', permission: true, scanId: prepared.scanId, siteUrl: prepared.siteUrl, pages: prepared.pageUrls.slice(10), finalBatch: true });
  assert.equal((await secondBatch.json()).pages.length, 2);
  assert.equal(pageFetches.length, 12);

  const offSiteBatch = await post({ action: 'scan-pages', permission: true, siteUrl: prepared.siteUrl, pages: ['https://other.example.net/page'] });
  assert.equal(offSiteBatch.status, 400);
  assert.match((await offSiteBatch.json()).error, /only pages on the submitted website/i);

  const cappedResponse = await post({ action: 'prepare', permission: true, url: 'https://many.example.com' }, { ip: '198.51.100.20' });
  assert.equal(cappedResponse.status, 200);
  const capped = await cappedResponse.json();
  assert.equal(capped.pageUrls.length, 100);
  assert.equal(capped.discoveredCount, 5_001);
  assert.equal(capped.pageLimitReached, true);
  assert.equal(capped.sitemapEntryLimitHit, true);
  assert.equal(capped.limits.maximumSitemapEntries, 5_000);

  const sitemapIndexResponse = await post({ action: 'prepare', permission: true, url: 'https://index.example.com' }, { ip: '198.51.100.30' });
  assert.equal(sitemapIndexResponse.status, 200);
  const sitemapIndex = await sitemapIndexResponse.json();
  assert.equal(sitemapIndex.sitemapFileLimitHit, true);
  assert.ok(sitemapIndex.discoveredCount <= 6);

  const persistenceEnv = {
    APP_ENV: 'production',
    SCAN_PERSISTENCE_ENABLED: 'true',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
  };
  const persistedPrepareResponse = await post({
    action: 'prepare', permission: true, url: 'https://example.com', projectId: persistenceProjectId,
  }, { ip: '198.51.100.60', env: persistenceEnv, token: persistenceToken });
  assert.equal(persistedPrepareResponse.status, 200);
  const persistedPrepare = await persistedPrepareResponse.json();
  assert.equal(persistedPrepare.persisted, true);
  assert.equal(persistenceState.scan.id, persistedPrepare.scanId);
  assert.equal(persistenceState.scan.project_id, persistenceProjectId);
  const persistedBatchResponse = await post({
    action: 'scan-pages', permission: true, scanId: persistedPrepare.scanId,
    siteUrl: persistedPrepare.siteUrl, pages: [persistedPrepare.pageUrls[0]], finalBatch: true,
  }, { ip: '198.51.100.61', env: persistenceEnv, token: persistenceToken });
  assert.equal(persistedBatchResponse.status, 200);
  const persistedBatch = await persistedBatchResponse.json();
  assert.equal(persistedBatch.persisted, true);
  assert.equal(persistenceState.pages.length, 1);
  assert.equal(persistenceState.pages[0].scan_id, persistedPrepare.scanId);
  assert.equal(persistenceState.pages[0].normalized_url, 'https://example.com/');
  assert.equal(persistenceState.scan.status, 'completed');
  const databaseRequest = persistenceRequests.find(({ url }) => url.pathname.endsWith('/projects'));
  assert.equal(databaseRequest.init.headers.get('apikey'), 'test-anon-key');
  assert.equal(databaseRequest.init.headers.get('authorization'), `Bearer ${persistenceToken}`);
  assert.equal(databaseRequest.init.redirect, 'error');

  const mismatchedPrepare = await post({
    action: 'prepare', permission: true, url: 'https://example.com', projectId: mismatchedProjectId,
  }, { ip: '198.51.100.62', env: persistenceEnv, token: persistenceToken });
  assert.equal(mismatchedPrepare.status, 200);
  assert.equal((await mismatchedPrepare.json()).persisted, false, 'a project for another domain is not assigned this scan');
  assert.equal(persistenceState.scan.id, persistedPrepare.scanId, 'domain mismatch does not create another stored scan');

  const unavailableEnv = { ...persistenceEnv, SUPABASE_URL: 'https://unavailable.supabase.co' };
  const unavailableResponse = await post({
    action: 'prepare', permission: true, url: 'https://example.com', projectId: persistenceProjectId,
  }, { ip: '198.51.100.63', env: unavailableEnv, token: persistenceToken });
  assert.equal(unavailableResponse.status, 200, 'persistence outages do not fail the stateless scan response');
  assert.equal((await unavailableResponse.json()).persisted, false);

  const rateIp = '198.51.100.40';
  assert.equal((await post({ action: 'prepare', permission: true, url: 'https://example.com' }, { ip: rateIp })).status, 200);
  assert.equal((await post({ action: 'prepare', permission: true, url: 'https://example.com' }, { ip: rateIp })).status, 200);
  const rateLimited = await post({ action: 'prepare', permission: true, url: 'https://example.com' }, { ip: rateIp });
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.headers.get('retry-after'), '600');

  const logRecords = structuredLogs.map((line) => JSON.parse(line));
  assert.ok(logRecords.length > 0);
  assert.ok(logRecords.every((record) => record.requestId && record.environment));
  assert.ok(logRecords.every((record) => !JSON.stringify(record).includes('example.com')));
  assert.ok(logRecords.every((record) => !JSON.stringify(record).includes(persistenceToken)));

  console.log = originalConsole.log;
  console.log('Scanner tests passed: request safeguards, correlation IDs, non-sensitive structured logs, sitemap discovery/caps, PageSpeed parsing, page batches, optional RLS persistence, and rate limits.');
} finally {
  globalThis.fetch = originalFetch;
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}
