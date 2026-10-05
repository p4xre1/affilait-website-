import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

function toDataUrl(javascript) {
  return `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`;
}

async function loadTypeScript(path, replacements = []) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [search, replacement] of replacements) source = source.replace(search, replacement);
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(toDataUrl(javascript));
}

const runtime = await loadTypeScript('../functions/_shared/runtime-env.ts');
const limiter = await loadTypeScript('../functions/_shared/scan-limiter.ts');
const repositoryModule = await loadTypeScript('../functions/_shared/scan-repository.ts');
const observability = await loadTypeScript('../functions/_shared/observability.ts', [
  ["from './runtime-env';", `from '${toDataUrl(ts.transpileModule(await readFile(new URL('../functions/_shared/runtime-env.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)}';`],
]);
const contracts = await loadTypeScript('../functions/_shared/intelligence-contracts.ts');
const migration = await readFile(new URL('../supabase/migrations/20261005000000_initial_scan_foundation.sql', import.meta.url), 'utf8');
const wranglerConfig = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');

for (const table of ['projects', 'scans', 'crawl_pages', 'findings']) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
}
assert.match(migration, /references auth\.users\s*\(id\)/i);
assert.match(migration, /findings_page_same_scan_fk/i);
assert.match(migration, /for delete to authenticated/i);
assert.doesNotMatch(migration, /service_role/i);
assert.match(wranglerConfig, /\[env\.preview\.vars\]/);
assert.match(wranglerConfig, /APP_ENV = "staging"/);
assert.match(wranglerConfig, /\[env\.production\.vars\]/);
assert.doesNotMatch(wranglerConfig, /\[env\.staging\]/);
assert.match(wranglerConfig, /SCAN_PERSISTENCE_ENABLED = "false"/);

assert.equal(runtime.appEnvironment({ APP_ENV: 'staging' }), 'staging');
assert.equal(runtime.appEnvironment({ APP_ENV: 'PRODUCTION' }), 'production');
assert.equal(runtime.appEnvironment({ APP_ENV: 'unexpected' }), 'unknown');
assert.deepEqual(runtime.supabaseConfig({ SCAN_PERSISTENCE_ENABLED: 'true' }), { enabled: false, reason: 'configuration-missing' });
assert.deepEqual(runtime.supabaseConfig({
  APP_ENV: 'production', SCAN_PERSISTENCE_ENABLED: 'TRUE',
  SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key',
}), { enabled: true, url: 'https://project.supabase.co', anonKey: 'public-anon-key' });
assert.deepEqual(runtime.supabaseConfig({
  APP_ENV: 'production', SCAN_PERSISTENCE_ENABLED: 'true',
  SUPABASE_URL: 'http://project.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key',
}), { enabled: false, reason: 'configuration-invalid' });
assert.equal(runtime.supabaseConfig({
  APP_ENV: 'development', SCAN_PERSISTENCE_ENABLED: 'true',
  SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'public-anon-key',
}).enabled, true);
assert.equal(runtime.supabaseConfig({
  APP_ENV: 'development', SCAN_PERSISTENCE_ENABLED: 'true',
  SUPABASE_URL: 'http://[::1]:54321', SUPABASE_ANON_KEY: 'public-anon-key',
}).enabled, true);
assert.deepEqual(runtime.supabaseConfig({
  APP_ENV: 'production', SCAN_PERSISTENCE_ENABLED: 'true',
  SUPABASE_URL: 'https://project.supabase.co/private', SUPABASE_ANON_KEY: 'public-anon-key',
}), { enabled: false, reason: 'configuration-invalid' });

const scanLimiter = new limiter.InMemoryScanLimiter();
const subject = { ip: '198.51.100.10' };
assert.equal(scanLimiter.allow('prepare', subject, 1_000), true);
assert.equal(scanLimiter.allow('prepare', subject, 2_000), true);
assert.equal(scanLimiter.allow('prepare', subject, 3_000), false);
assert.equal(scanLimiter.retryAfterSeconds('prepare'), 600);
for (let index = 0; index < 20; index += 1) assert.equal(scanLimiter.allow('batches', subject, 3_001 + index), true);
assert.equal(scanLimiter.allow('batches', subject, 4_000), false);
assert.equal(scanLimiter.allow('prepare', subject, 602_001), true, 'expired entries are removed before a new window is counted');

const trace = observability.requestTrace({ APP_ENV: 'staging' }, observability.newTraceId(), '33333333-3333-4333-8333-333333333333');
const originalConsoleLog = console.log;
let structuredLine = '';
console.log = (line) => { structuredLine = String(line); };
try {
  observability.logStructured('info', 'test.safe_event', trace, { pageCount: 2, persisted: false });
} finally {
  console.log = originalConsoleLog;
}
const structured = JSON.parse(structuredLine);
assert.equal(structured.environment, 'staging');
assert.equal(structured.requestId, trace.requestId);
assert.equal(structured.scanId, trace.scanId);
assert.equal(structured.pageCount, 2);
assert.match(trace.requestId, /^[0-9a-f-]{36}$/i);

const projectId = '11111111-1111-4111-8111-111111111111';
const scanId = '33333333-3333-4333-8333-333333333333';
const calls = [];
const state = { scan: null, pages: [], findings: [] };
const project = { id: projectId, domain: 'example.com' };
const connection = { url: 'https://project.supabase.co', anonKey: 'public-anon-key', accessToken: 'header.payload.signature' };
const fetcher = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method || 'GET';
  const table = url.pathname.split('/').at(-1);
  calls.push({ url, init, method, table });
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  if (table === 'projects' && method === 'GET') return json([project]);
  if (table === 'scans' && method === 'POST') {
    const input = JSON.parse(init.body);
    state.scan = { ...input, created_at: '2026-10-05T12:00:00.000Z' };
    return json([state.scan], 201);
  }
  if (table === 'scans' && method === 'GET') return json(state.scan ? [state.scan] : []);
  if (table === 'scans' && method === 'PATCH') {
    Object.assign(state.scan, JSON.parse(init.body));
    return json([state.scan]);
  }
  if (table === 'scans' && method === 'DELETE') {
    state.scan = null;
    return new Response(null, { status: 204 });
  }
  if (table === 'crawl_pages' && method === 'POST') {
    state.pages.push(...JSON.parse(init.body));
    return new Response(null, { status: 204 });
  }
  if (table === 'crawl_pages' && method === 'GET') return json(state.pages);
  if (table === 'findings' && method === 'POST') {
    const body = JSON.parse(init.body);
    state.findings.push(...(Array.isArray(body) ? body : [body]));
    return new Response(null, { status: 204 });
  }
  if (table === 'findings' && method === 'GET') return json(state.findings);
  throw new Error(`Unexpected repository test request: ${method} ${url.pathname}`);
};

const repository = new repositoryModule.SupabaseScanRepository(connection, fetcher);
assert.deepEqual(await repository.getProject(projectId), project);
const created = await repository.createScan({ id: scanId, projectId, crawlerVersion: 'fatorati-scan-v1', pageLimit: 2, pagesDiscovered: 2 });
assert.equal(created.id, scanId);
assert.equal(created.status, 'running');
await repository.savePages([
  { scanId, url: 'https://example.com/', normalizedUrl: 'https://example.com/', statusCode: 200, title: 'Home', headings: [{ level: 1, text: 'Welcome' }] },
  { scanId, url: 'https://example.com/guide', normalizedUrl: 'https://example.com/guide', statusCode: 404, title: 'Guide' },
]);
assert.equal(state.pages.length, 2);
const pages = await repository.getScanPages(scanId);
assert.equal(pages.length, 2);
assert.equal(pages[1].statusCode, 404);
await repository.saveFinding({
  scanId, category: 'metadata', type: 'title-missing', severity: 'warning', title: 'Page title is missing',
  description: 'A scanned page returned no title.', evidence: { source: 'crawl' }, confidence: 0.9,
  recommendation: 'Review the page title.',
});
assert.equal((await repository.getScanFindings(scanId)).length, 1);
const completed = await repository.completeScan(scanId);
assert.equal(completed.status, 'completed');
assert.equal(completed.pagesScanned, 2);
assert.equal(completed.errorCount, 1);
assert.ok(calls.every(({ init }) => init.redirect === 'error'));
assert.ok(calls.every(({ init }) => init.headers.get('apikey') === connection.anonKey));
assert.ok(calls.every(({ init }) => init.headers.get('authorization') === `Bearer ${connection.accessToken}`));
assert.ok(calls.every(({ init }) => !String(init.headers.get('authorization')).includes('service_role')));
await repository.deleteScan(scanId);
assert.equal(state.scan, null);
await assert.rejects(repository.createScan({ projectId: 'not-a-uuid', crawlerVersion: 'x', pageLimit: 1, pagesDiscovered: 0 }), (error) => error.code === 'invalid_input');
await assert.rejects(repository.createScan({ projectId, crawlerVersion: 'x', pageLimit: 101, pagesDiscovered: 0 }), (error) => error.code === 'invalid_input');
await assert.rejects(repository.savePages([]), (error) => error.code === 'invalid_input');
await assert.rejects(repository.saveFinding({
  scanId, category: 'test', type: 'test', severity: 'info', title: 'test', description: 'test',
  evidence: {}, confidence: Number.NaN, recommendation: 'test',
}), (error) => error.code === 'invalid_input');

const oversizedRepository = new repositoryModule.SupabaseScanRepository(connection, async () => new Response('x'.repeat(1_000_001)));
await assert.rejects(oversizedRepository.getProject(projectId), (error) => error.code === 'invalid_response');
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
globalThis.clearTimeout = () => {};
try {
  const timeoutRepository = new repositoryModule.SupabaseScanRepository(connection, (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  await assert.rejects(timeoutRepository.getProject(projectId), (error) => error.code === 'timeout');
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}

assert.deepEqual(contracts.PROVIDER_KINDS, ['crawl', 'search-console', 'analytics', 'keyword-research', 'serp', 'backlinks', 'ai', 'business', 'manual']);
assert.equal(contracts.PROVIDER_KINDS.includes('search-console'), true);

console.log('Foundation tests passed: environment validation, bounded isolate rate limiting, structured trace logs, RLS-aware repository requests, persistence bounds, and provider-neutral contracts.');
