import { inferPageContentEvidence, type PageSearchEvidence } from '../_shared/search-intelligence';
import { logStructured, newTraceId, requestTrace, type RequestTrace } from '../_shared/observability';
import { scanLimiter } from '../_shared/scan-limiter';
import { ScanRepositoryError, SupabaseScanRepository, type CrawlPageRecord, type ScanRepository } from '../_shared/scan-repository';
import { supabaseConfig, type RuntimeEnv } from '../_shared/runtime-env';
import { assertSafeObject, hasScript, InputValidationError } from '../_shared/input-guard';

type ScanEnv = RuntimeEnv;

interface ScanContext {
  request: Request;
  env: ScanEnv;
}

interface PublicUrl {
  url: URL;
  removedQuery: boolean;
}

interface FetchTextResult {
  response: Response;
  text: string;
  finalUrl: URL;
}

interface ScannedPage {
  url: string;
  finalUrl?: string;
  status: number | null;
  contentType: string;
  ok: boolean;
  error?: string;
  isHttps?: boolean;
  title?: string;
  description?: string;
  h1Count?: number;
  canonical?: string | null;
  canonicalSameSite?: boolean | null;
  hasViewport?: boolean;
  htmlLang?: string | null;
  noindex?: boolean;
  imageCount?: number;
  imagesMissingAlt?: number;
  jsonLdBlockCount?: number;
  invalidJsonLdCount?: number;
  searchEvidence?: PageSearchEvidence;
}

const MAX_PAGES_PER_SCAN = 100;
const MAX_PAGES_PER_BATCH = 10;
const MAX_SITEMAPS = 6;
const MAX_URLS_FROM_SITEMAPS = 5_000;
const MAX_HTML_BYTES = 350_000;
const MAX_SITEMAP_BYTES = 1_000_000;
const MAX_REQUEST_BYTES = 18_000;
const PAGE_FETCH_TIMEOUT_MS = 5_000;
const DISCOVERY_FETCH_TIMEOUT_MS = 3_000;
const DISCOVERY_TIME_BUDGET_MS = 15_000;
const GOOGLE_FETCH_TIMEOUT_MS = 20_000;
const SCANNER_VERSION = 'fatorati-scan-v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ScanError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ScanError';
  }
}

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      ...extraHeaders,
    },
  });
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253 || host.includes(':') || !host.includes('.')) return false;
  if (/^(?:\d+|0x[\da-f]+)$/i.test(host) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host.endsWith('.test') || host.endsWith('.invalid') || host.endsWith('.example') || host.endsWith('.onion')) return false;

  const forbiddenSuffixes = [
    'intranet', 'lan', 'corp', 'home', 'home.arpa', 'arpa', 'priv',
    'nip.io', 'sslip.io', 'xip.io', 'localtest.me', 'localhost.direct', 'lvh.me', 'vcap.me',
    'myip.io', 'fip.io', 'traefik.me', 'customer-ip.com', 'localh.st', '127-0-0-1.org.uk',
  ];
  if (forbiddenSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return false;
  if (host === 'metadata.google.internal' || host === 'metadata.google' || host === 'instance-data' || host === 'metadata.tce.internal' || host === 'metadata.packet.net' || host === 'metadata') return false;

  if (/(?:^|[.-])(?:127|169[.-]254|10|192[.-]168|172[.-](?:1[6-9]|2\d|3[01])|0[.-]0[.-]0[.-]0)[.-]/.test(host)) {
    return false;
  }

  const labels = host.split('.');
  if (labels.length < 2) return false;
  if (!labels.every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) {
    return false;
  }
  if (labels.some((label) => /^0x/i.test(label) || /^0\d+$/.test(label))) return false;
  if (labels.every((label) => /^\d+$/.test(label))) return false;

  const tld = labels[labels.length - 1];
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(tld)) return false;

  return true;
}

function parsePublicUrl(value: unknown): PublicUrl {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2_048) {
    throw new ScanError('invalid_url', 'Enter a public website URL, such as https://example.com.');
  }
  const input = value.trim();
  if (/[\x00-\x1f\x7f]/.test(input)) {
    throw new ScanError('invalid_url', 'The URL contains invalid control characters.');
  }
  if (hasScript(input)) {
    throw new ScanError('invalid_url', 'URLs cannot contain script tags or dangerous HTML.');
  }
  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ScanError('invalid_url', 'That URL is not valid. Enter a public website address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ScanError('invalid_url', 'Only public HTTP and HTTPS websites can be scanned.');
  }
  if (url.username || url.password) {
    throw new ScanError('invalid_url', 'Remove any username or password from the URL before scanning.');
  }
  if (!hasSafePort(url)) {
    throw new ScanError('invalid_url', 'Custom ports are not supported. Use the public website address.');
  }
  if (!isPublicHostname(url.hostname)) {
    throw new ScanError('invalid_url', 'The scanner only accepts public domain names, not local or private network addresses.');
  }
  const removedQuery = Boolean(url.search || url.hash);
  url.search = '';
  url.hash = '';
  return { url, removedQuery };
}

function sameSiteHost(hostname: string, rootHostname: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return normalize(hostname) === normalize(rootHostname);
}

function repositoryFromRequest(context: ScanContext): ScanRepository | null {
  const config = supabaseConfig(context.env ?? {});
  if (!config.enabled) return null;
  const authorization = context.request.headers.get('Authorization') || '';
  const token = authorization.match(/^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i)?.[1];
  if (!token || token.length > 8_192) return null;
  try {
    return new SupabaseScanRepository({ url: config.url, anonKey: config.anonKey, accessToken: token });
  } catch {
    return null;
  }
}

function projectHostname(domain: string): string | null {
  try {
    return parsePublicUrl(domain).url.hostname;
  } catch {
    return null;
  }
}

function persistedPage(scanId: string, page: ScannedPage): CrawlPageRecord {
  const normalizedUrl = new URL(page.url).toString();
  let canonicalUrl: string | null = null;
  if (page.canonical) {
    try {
      const canonical = new URL(page.canonical, page.finalUrl || page.url);
      if ((canonical.protocol === 'http:' || canonical.protocol === 'https:') && !canonical.username && !canonical.password) {
        canonical.search = '';
        canonical.hash = '';
        const value = canonical.toString();
        if (value.length <= 2_048) canonicalUrl = value;
      }
    } catch {
      canonicalUrl = null;
    }
  }
  return {
    scanId,
    url: page.url,
    normalizedUrl,
    canonicalUrl,
    statusCode: page.status,
    contentType: page.contentType.slice(0, 255) || null,
    title: page.title?.slice(0, 300) ?? null,
    headings: page.searchEvidence?.headingEvidence.slice(0, 18).map(({ level, text }) => ({ level, text: text.slice(0, 180) })) ?? [],
    indexability: null,
    crawledAt: new Date().toISOString(),
  };
}

function logPersistenceFailure(trace: RequestTrace, error: unknown): void {
  logStructured('warn', 'scan.persistence.skipped', trace, {
    reason: error instanceof ScanRepositoryError ? error.code : 'repository-error',
    ...(error instanceof ScanRepositoryError && error.status ? { statusCode: error.status } : {}),
  });
}

async function persistPreparedScan(
  context: ScanContext,
  input: Record<string, unknown>,
  trace: RequestTrace,
  siteUrl: URL,
  discoveredCount: number,
  pageLimit: number,
): Promise<boolean> {
  const repository = repositoryFromRequest(context);
  const projectId = input.projectId;
  if (!repository || typeof projectId !== 'string' || !UUID_PATTERN.test(projectId) || !trace.scanId) return false;
  try {
    const project = await repository.getProject(projectId);
    const ownerDomain = project ? projectHostname(project.domain) : null;
    if (!project || !ownerDomain || !sameSiteHost(ownerDomain, siteUrl.hostname)) {
      logStructured('warn', 'scan.persistence.skipped', trace, { reason: 'project-scope-mismatch' });
      return false;
    }
    await repository.createScan({
      id: trace.scanId,
      projectId: project.id,
      crawlerVersion: SCANNER_VERSION,
      pageLimit: Math.max(1, Math.min(MAX_PAGES_PER_SCAN, pageLimit)),
      pagesDiscovered: Math.max(0, Math.min(10_000, discoveredCount)),
    });
    logStructured('info', 'scan.persistence.started', trace, { pageLimit });
    return true;
  } catch (error) {
    logPersistenceFailure(trace, error);
    return false;
  }
}

async function persistScannedBatch(
  context: ScanContext,
  trace: RequestTrace,
  siteHostname: string,
  pages: ScannedPage[],
  finalBatch: boolean,
): Promise<boolean> {
  const repository = repositoryFromRequest(context);
  if (!repository || !trace.scanId) return false;
  try {
    const scan = await repository.getScan(trace.scanId);
    if (!scan) return false;
    const project = await repository.getProject(scan.projectId);
    const ownerDomain = project ? projectHostname(project.domain) : null;
    if (!ownerDomain || !sameSiteHost(ownerDomain, siteHostname)) {
      logStructured('warn', 'scan.persistence.skipped', trace, { reason: 'project-scope-mismatch' });
      return false;
    }
    await repository.savePages(pages.map((page) => persistedPage(trace.scanId!, page)));
    if (finalBatch) {
      await repository.completeScan(trace.scanId);
      logStructured('info', 'scan.persistence.completed', trace, { pageCount: pages.length });
    } else {
      logStructured('info', 'scan.persistence.batch_saved', trace, { pageCount: pages.length });
    }
    return true;
  } catch (error) {
    logPersistenceFailure(trace, error);
    return false;
  }
}

function hasSafePort(url: URL): boolean {
  return !url.port || (url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80');
}

async function readLimitedBody(response: Response | Request, maximumBytes: number, tooLargeMessage = 'The public page is too large for this free scan.'): Promise<string> {
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > maximumBytes) {
    await response.body?.cancel();
    throw new ScanError('body_too_large', tooLargeMessage);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new ScanError('body_too_large', tooLargeMessage);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(bytes);
}

async function fetchPublicText(
  input: URL,
  rootHostname: string,
  accept: string,
  maximumBytes: number,
  timeoutMs: number,
): Promise<FetchTextResult> {
  let current = new URL(input);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    if (current.username || current.password || !hasSafePort(current) || !isPublicHostname(current.hostname) || !sameSiteHost(current.hostname, rootHostname)) {
      throw new ScanError('unsafe_redirect', 'The site redirected outside its public domain, so the scan stopped safely.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: accept,
          'User-Agent': 'FatoratiSiteAudit/1.0 (+https://fatorati.me/)',
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirectCount === 3) {
          throw new ScanError('redirect_limit', 'The page could not be reached after several redirects.');
        }
        let redirected: URL;
        try {
          redirected = new URL(location, current);
        } catch {
          throw new ScanError('unsafe_redirect', 'The site returned an invalid redirect.');
        }
        if (redirected.protocol !== 'http:' && redirected.protocol !== 'https:') {
          throw new ScanError('unsafe_redirect', 'The site redirected to an unsupported URL scheme.');
        }
        if (redirected.username || redirected.password || !hasSafePort(redirected) || !isPublicHostname(redirected.hostname) || !sameSiteHost(redirected.hostname, rootHostname)) {
          throw new ScanError('unsafe_redirect', 'The site redirected outside its public domain, so the scan stopped safely.');
        }
        redirected.search = '';
        redirected.hash = '';
        current = redirected;
        continue;
      }
      const text = await readLimitedBody(response, maximumBytes);
      return { response, text, finalUrl: current };
    } catch (error) {
      if (error instanceof ScanError) throw error;
      if (controller.signal.aborted) throw new ScanError('timeout', 'The site took too long to respond.');
      throw new ScanError('network', 'The site could not be reached by the audit service.');
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new ScanError('redirect_limit', 'The page could not be reached after several redirects.');
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized === 'amp') return '&';
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos') return "'";
    if (normalized === 'nbsp') return ' ';
    const codePoint = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return whole;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return whole;
    }
  });
}

function plainText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function attribute(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? null : decodeEntities(value.trim());
}

function metaValue(html: string, name: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if ((attribute(tag, 'name') ?? '').toLowerCase() === name.toLowerCase()) {
      return attribute(tag, 'content');
    }
  }
  return null;
}

function linkValue(html: string, rel: string): string | null {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const relValue = (attribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    if (relValue.includes(rel.toLowerCase())) return attribute(tag, 'href');
  }
  return null;
}

function inspectJsonLd(html: string): { blockCount: number; invalidCount: number } {
  let blockCount = 0;
  let invalidCount = 0;
  for (const match of html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)) {
    const tagEnd = match[0].indexOf('>');
    const openingTag = match[0].slice(0, tagEnd + 1);
    const type = (attribute(openingTag, 'type') ?? '').split(';', 1)[0].trim().toLowerCase();
    if (type !== 'application/ld+json') continue;
    blockCount += 1;
    const closingTagStart = match[0].lastIndexOf('</script');
    const jsonText = match[0].slice(tagEnd + 1, closingTagStart).trim();
    try {
      JSON.parse(jsonText);
    } catch {
      invalidCount += 1;
    }
  }
  return { blockCount, invalidCount };
}

function extractHeadingEvidence(html: string): Array<{ level: number; text: string }> {
  const headings: Array<{ level: number; text: string }> = [];
  const visibleMarkup = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  for (const match of visibleMarkup.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const headingHtml = match[2].replace(/<(?:script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg)\s*>/gi, ' ');
    const text = plainText(headingHtml).replace(/\s+/g, ' ').trim().slice(0, 180);
    if (!text) continue;
    headings.push({ level: Number(match[1]), text });
    if (headings.length >= 18) break;
  }
  return headings;
}

function parseHtmlPage(url: string, finalUrl: URL, status: number, contentType: string, headers: Headers, html: string, rootHostname: string): ScannedPage {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = titleMatch ? plainText(titleMatch[1]).slice(0, 300) : '';
  const description = (metaValue(html, 'description') ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const h1Count = [...html.matchAll(/<h1\b[^>]*>/gi)].length;
  const canonical = linkValue(html, 'canonical');
  let canonicalSameSite: boolean | null = null;
  if (canonical) {
    try {
      canonicalSameSite = sameSiteHost(new URL(canonical, finalUrl).hostname, rootHostname);
    } catch {
      canonicalSameSite = false;
    }
  }
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? '';
  const htmlLang = attribute(htmlTag, 'lang');
  const noindexHeaders = headers.get('x-robots-tag') ?? '';
  const noindexMeta = `${metaValue(html, 'robots') ?? ''} ${metaValue(html, 'googlebot') ?? ''}`;
  const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const imagesMissingAlt = imageTags.filter((tag) => attribute(tag, 'alt') === null).length;
  const htmlContent = /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType.trim());
  const jsonLd = htmlContent ? inspectJsonLd(html) : { blockCount: 0, invalidCount: 0 };
  const headings = htmlContent ? extractHeadingEvidence(html) : [];
  const searchEvidence = htmlContent && status >= 200 && status < 300
    ? inferPageContentEvidence({ url, title, description, htmlLang: htmlLang?.slice(0, 40) || null, headings })
    : undefined;
  return {
    url,
    finalUrl: finalUrl.toString(),
    status,
    contentType,
    ok: status >= 200 && status < 300 && htmlContent,
    ...(!htmlContent ? { error: 'This URL did not return an HTML page.' } : {}),
    isHttps: finalUrl.protocol === 'https:',
    title,
    description,
    h1Count,
    canonical,
    canonicalSameSite,
    hasViewport: metaValue(html, 'viewport') !== null,
    htmlLang: htmlLang?.slice(0, 40) || null,
    noindex: /\bnoindex\b/i.test(`${noindexHeaders} ${noindexMeta}`),
    imageCount: imageTags.length,
    imagesMissingAlt,
    jsonLdBlockCount: jsonLd.blockCount,
    invalidJsonLdCount: jsonLd.invalidCount,
    ...(searchEvidence ? { searchEvidence } : {}),
  };
}

async function scanPage(input: string, rootHostname: string): Promise<ScannedPage> {
  const parsed = parsePublicUrl(input);
  if (!sameSiteHost(parsed.url.hostname, rootHostname)) {
    throw new ScanError('off_site_url', 'A requested page was outside the submitted website and was skipped.');
  }
  try {
    const result = await fetchPublicText(parsed.url, rootHostname, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', MAX_HTML_BYTES, PAGE_FETCH_TIMEOUT_MS);
    return parseHtmlPage(
      parsed.url.toString(),
      result.finalUrl,
      result.response.status,
      result.response.headers.get('content-type') ?? '',
      result.response.headers,
      result.text,
      rootHostname,
    );
  } catch (error) {
    const safeMessage = error instanceof ScanError && error.code === 'timeout'
      ? 'The page timed out before it could be checked.'
      : error instanceof ScanError && error.code === 'body_too_large'
        ? 'The page exceeded the size limit for this scan.'
        : error instanceof ScanError && error.code === 'unsafe_redirect'
          ? 'The page redirected outside the submitted public domain.'
          : 'The page could not be fetched; it may block automated checks or be temporarily unavailable.';
    return {
      url: parsed.url.toString(),
      status: null,
      contentType: '',
      ok: false,
      error: safeMessage,
    };
  }
}

function decodeXml(value: string): string {
  return decodeEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
}

function robotsRules(text: string): { sitemaps: string[]; disallow: string[] } {
  const sitemaps: string[] = [];
  const disallow: string[] = [];
  let activeForAll = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#', 1)[0].trim();
    if (!line) continue;
    const agent = line.match(/^user-agent\s*:\s*(.+)$/i);
    if (agent) {
      activeForAll = agent[1].trim() === '*';
      continue;
    }
    const sitemap = line.match(/^sitemap\s*:\s*(\S+)/i);
    if (sitemap) {
      if (sitemaps.length < 50) sitemaps.push(sitemap[1]);
      continue;
    }
    const blocked = line.match(/^disallow\s*:\s*(.*)$/i);
    if (activeForAll && blocked?.[1].trim()) {
      if (disallow.length < 500) disallow.push(blocked[1].trim());
    }
  }
  return { sitemaps, disallow };
}

function isDisallowed(pathname: string, rules: string[]): boolean {
  return rules.some((rule) => {
    const simpleRule = rule.split('*', 1)[0];
    return simpleRule.length > 0 && pathname.startsWith(simpleRule);
  });
}

function sitemapLocs(text: string): string[] {
  const locs: string[] = [];
  for (const match of text.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)) {
    locs.push(decodeXml(match[1]));
    if (locs.length >= MAX_URLS_FROM_SITEMAPS) break;
  }
  return locs;
}

function isPageLikeUrl(url: URL): boolean {
  return !/\.(?:7z|avif|css|csv|docx?|gif|gz|ico|jpe?g|js|json|m4a|mp[34]|pdf|png|pptx?|rss|svg|tar|webp|xlsx?|xml|zip)$/i.test(url.pathname);
}

async function discoverSite(start: URL): Promise<{
  pageUrls: string[];
  sitemapFound: boolean;
  discoveredCount: number;
  truncated: boolean;
  sitemapEntryLimitHit: boolean;
  sitemapFileLimitHit: boolean;
  discoveryBudgetHit: boolean;
  robotsDisallowedCount: number;
  note: string;
}> {
  const discoveryStartedAt = Date.now();
  const rootHostname = start.hostname;
  const origin = start.origin;
  let robotsText = '';
  try {
    const robotsUrl = new URL('/robots.txt', origin);
    const robotsResponse = await fetchPublicText(robotsUrl, rootHostname, 'text/plain,*/*;q=0.1', 120_000, DISCOVERY_FETCH_TIMEOUT_MS);
    if (robotsResponse.response.ok) robotsText = robotsResponse.text;
  } catch {
    robotsText = '';
  }
  const rules = robotsRules(robotsText);
  const candidates = [...rules.sitemaps, new URL('/sitemap.xml', origin).toString()];
  const queue: URL[] = [];
  const seenSitemaps = new Set<string>();
  for (const candidate of candidates) {
    try {
      const parsed = parsePublicUrl(candidate).url;
      if (!sameSiteHost(parsed.hostname, rootHostname)) continue;
      const key = parsed.toString();
      if (!seenSitemaps.has(key)) {
        seenSitemaps.add(key);
        queue.push(parsed);
      }
    } catch {
      // Ignore invalid or off-site sitemap declarations.
    }
  }

  const pageSet = new Set<string>();
  let sitemapFound = false;
  let robotsDisallowedCount = 0;
  let sitemapIndex = 0;
  let totalSeenLocs = 0;
  let sitemapFileLimitHit = false;
  let discoveryBudgetHit = false;
  while (queue.length > 0 && sitemapIndex < MAX_SITEMAPS && totalSeenLocs < MAX_URLS_FROM_SITEMAPS) {
    if (Date.now() - discoveryStartedAt >= DISCOVERY_TIME_BUDGET_MS) {
      discoveryBudgetHit = true;
      break;
    }
    const sitemapUrl = queue.shift()!;
    sitemapIndex += 1;
    let result: FetchTextResult;
    try {
      result = await fetchPublicText(sitemapUrl, rootHostname, 'application/xml,text/xml,text/plain;q=0.9,*/*;q=0.1', MAX_SITEMAP_BYTES, DISCOVERY_FETCH_TIMEOUT_MS);
    } catch {
      continue;
    }
    if (!result.response.ok || !/<(?:urlset|sitemapindex)\b/i.test(result.text)) continue;
    sitemapFound = true;
    const locs = sitemapLocs(result.text);
    totalSeenLocs += locs.length;
    const isIndex = /<sitemapindex\b/i.test(result.text);
    for (const rawLoc of locs) {
      if (isIndex) {
        if (queue.length + sitemapIndex >= MAX_SITEMAPS) {
          sitemapFileLimitHit = true;
          continue;
        }
        try {
          const child = parsePublicUrl(rawLoc).url;
          if (!sameSiteHost(child.hostname, rootHostname)) continue;
          const childKey = child.toString();
          if (!seenSitemaps.has(childKey)) {
            seenSitemaps.add(childKey);
            queue.push(child);
          }
        } catch {
          // Ignore malformed sitemap URLs.
        }
        continue;
      }
      try {
        const pageUrl = parsePublicUrl(rawLoc).url;
        if (!sameSiteHost(pageUrl.hostname, rootHostname) || !isPageLikeUrl(pageUrl)) continue;
        if (isDisallowed(pageUrl.pathname, rules.disallow)) {
          robotsDisallowedCount += 1;
          continue;
        }
        pageSet.add(pageUrl.toString());
      } catch {
        // Ignore invalid, private-network, or off-site URLs.
      }
    }
  }

  if (pageSet.size === 0) pageSet.add(start.toString());
  const startUrl = start.toString();
  const ordered = [startUrl, ...[...pageSet].filter((url) => url !== startUrl)];
  const discoveredCount = ordered.length;
  const sitemapEntryLimitHit = totalSeenLocs >= MAX_URLS_FROM_SITEMAPS;
  if (queue.length > 0) sitemapFileLimitHit = true;
  const truncated = discoveredCount > MAX_PAGES_PER_SCAN || sitemapEntryLimitHit || sitemapFileLimitHit || discoveryBudgetHit;
  const pageUrls = ordered.slice(0, MAX_PAGES_PER_SCAN);
  const note = sitemapFound
    ? truncated
      ? `Sitemap found. The free scan checks up to ${MAX_PAGES_PER_SCAN} public pages per run.`
      : `Sitemap found. ${pageUrls.length} public page${pageUrls.length === 1 ? '' : 's'} queued for checks.`
    : 'No readable XML sitemap was found, so only the URL you entered will be checked.';
  return { pageUrls, sitemapFound, discoveredCount, truncated, sitemapEntryLimitHit, sitemapFileLimitHit, discoveryBudgetHit, robotsDisallowedCount, note };
}

function cleanAuditText(value: unknown, maximum = 280): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

async function runPageSpeed(url: URL, env: ScanEnv): Promise<{
  source: string;
  strategy: string;
  scores: { id: string; label: string; score: number }[];
  metrics: { id: string; label: string; value: string }[];
  issues: { id: string; category: string; title: string; displayValue: string; guidance: string }[];
  error?: string;
}> {
  const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  endpoint.searchParams.set('url', url.toString());
  endpoint.searchParams.set('strategy', 'mobile');
  for (const category of ['performance', 'accessibility', 'best-practices', 'seo']) {
    endpoint.searchParams.append('category', category);
  }
  const key = env.GOOGLE_PAGESPEED_API_KEY?.trim();
  if (key) endpoint.searchParams.set('key', key);
  const base = {
    source: 'Google PageSpeed Insights',
    strategy: 'Mobile Lighthouse run on the submitted URL only',
    scores: [] as { id: string; label: string; score: number }[],
    metrics: [] as { id: string; label: string; value: string }[],
    issues: [] as { id: string; category: string; title: string; displayValue: string; guidance: string }[],
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.toString(), {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { ...base, error: response.status === 429
        ? 'Google PageSpeed Insights is temporarily at its free request limit.'
        : 'Google PageSpeed Insights is temporarily unavailable. The site checks can still be reviewed.' };
    }
    const text = await readLimitedBody(response, 2_000_000);
    const payload = JSON.parse(text) as Record<string, any>;
    const lighthouse = payload.lighthouseResult as Record<string, any> | undefined;
    const categories = lighthouse?.categories as Record<string, any> | undefined;
    const labels: Record<string, string> = {
      performance: 'Performance',
      accessibility: 'Accessibility',
      'best-practices': 'Best practices',
      seo: 'SEO',
    };
    for (const [id, label] of Object.entries(labels)) {
      const rawScore = categories?.[id]?.score;
      if (typeof rawScore === 'number' && Number.isFinite(rawScore)) {
        base.scores.push({ id, label, score: Math.round(rawScore * 100) });
      }
    }
    const metricDefinitions = [
      { id: 'largest-contentful-paint', label: 'Largest Contentful Paint' },
      { id: 'cumulative-layout-shift', label: 'Cumulative Layout Shift' },
      { id: 'total-blocking-time', label: 'Total Blocking Time' },
    ];
    for (const metric of metricDefinitions) {
      const value = lighthouse?.audits?.[metric.id]?.displayValue;
      if (typeof value === 'string' && value.trim()) base.metrics.push({ ...metric, value: value.slice(0, 80) });
    }
    const audits = lighthouse?.audits as Record<string, any> | undefined;
    const seenIssues = new Set<string>();
    for (const categoryId of ['seo', 'performance', 'accessibility', 'best-practices']) {
      const category = categories?.[categoryId];
      const refs = Array.isArray(category?.auditRefs) ? category.auditRefs : [];
      for (const ref of refs) {
        if (typeof ref?.id !== 'string' || Number(ref.weight ?? 0) <= 0) continue;
        const audit = audits?.[ref.id];
        if (!audit || typeof audit.score !== 'number' || audit.score >= 0.9) continue;
        if (['manual', 'informative', 'notApplicable'].includes(audit.scoreDisplayMode)) continue;
        if (seenIssues.has(ref.id)) continue;
        seenIssues.add(ref.id);
        base.issues.push({
          id: ref.id.slice(0, 100),
          category: labels[categoryId],
          title: cleanAuditText(audit.title, 160) || 'Lighthouse audit needs attention',
          displayValue: cleanAuditText(audit.displayValue, 100),
          guidance: cleanAuditText(audit.description, 340),
        });
      }
    }
    base.issues = base.issues.slice(0, 12);
    return base;
  } catch (error) {
    return {
      ...base,
      error: controller.signal.aborted
        ? 'Google PageSpeed Insights took too long to respond. The site checks can still be reviewed.'
        : error instanceof SyntaxError
          ? 'Google PageSpeed Insights returned an unreadable response. The site checks can still be reviewed.'
          : 'Google PageSpeed Insights could not be reached. The site checks can still be reviewed.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function errorFrom(error: unknown, trace: RequestTrace): Response {
  if (error instanceof ScanError) {
    logStructured('warn', 'scan.request.rejected', trace, { reason: error.code });
    return json({ error: error.message }, 400);
  }
  logStructured('error', 'scan.request.failed', trace, { reason: 'unexpected-error' });
  return json({ error: 'The audit could not be prepared. Please try again later.' }, 500);
}

function withTrace(response: Response, trace: RequestTrace): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Request-ID', trace.requestId);
  if (trace.scanId) headers.set('X-Scan-ID', trace.scanId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleScanRequest(context: ScanContext, trace: RequestTrace): Promise<Response> {
  const requestOrigin = new URL(context.request.url).origin;
  const originHeader = context.request.headers.get('Origin');
  if (originHeader && originHeader !== requestOrigin) {
    return json({ error: 'Cross-origin audit requests are not accepted.' }, 403);
  }
  const secFetchSite = context.request.headers.get('Sec-Fetch-Site');
  if (secFetchSite === 'cross-site') {
    return json({ error: 'Cross-origin audit requests are not accepted.' }, 403);
  }
  if (!context.request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return json({ error: 'Send audit requests as application/json.' }, 415);
  }
  const declaredLength = Number(context.request.headers.get('content-length') || 0);
  if (declaredLength > MAX_REQUEST_BYTES) return json({ error: 'The audit request is too large.' }, 413);
  let raw = '';
  try {
    raw = await readLimitedBody(context.request, MAX_REQUEST_BYTES, 'The audit request is too large.');
  } catch (error) {
    if (error instanceof ScanError && error.code === 'body_too_large') return json({ error: error.message }, 413);
    return json({ error: 'The audit request could not be read.' }, 400);
  }
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    input = assertSafeObject(parsed, 10, 'The audit request');
  } catch (error) {
    if (error instanceof InputValidationError) return json({ error: error.message }, 400);
    return json({ error: 'The audit request must contain valid JSON.' }, 400);
  }
  if (input.permission !== true) return json({ error: 'Confirm that you own the website or have permission to audit its public pages.' }, 400);

  if (typeof input.action !== 'string' || !['prepare', 'scan-pages'].includes(input.action)) {
    return json({ error: 'Unknown audit action.' }, 400);
  }

  if (input.action === 'prepare') {
    trace.scanId = newTraceId();
    if (input.projectId !== undefined) {
      if (typeof input.projectId !== 'string' || !UUID_PATTERN.test(input.projectId)) {
        return errorFrom(new ScanError('invalid_input', 'The project identifier is not valid.'), trace);
      }
    }
  } else if (input.action === 'scan-pages') {
    if (input.scanId !== undefined && (typeof input.scanId !== 'string' || !UUID_PATTERN.test(input.scanId))) {
      return errorFrom(new ScanError('invalid_scan_id', 'The scan identifier is not valid.'), trace);
    }
    const headerScanId = context.request.headers.get('X-Scan-ID');
    if (headerScanId && !UUID_PATTERN.test(headerScanId)) {
      return errorFrom(new ScanError('invalid_scan_id', 'The scan identifier is not valid.'), trace);
    }
    trace.scanId = typeof input.scanId === 'string' ? input.scanId : headerScanId || newTraceId();
  }

  const ip = context.request.headers.get('CF-Connecting-IP') || 'local-development';
  if (input.action === 'prepare') {
    if (!scanLimiter.allow('prepare', { ip })) {
      const retryAfter = scanLimiter.retryAfterSeconds('prepare');
      logStructured('warn', 'scan.rate_limited', trace, { action: 'prepare', retryAfterSeconds: retryAfter });
      return json({ error: 'You have started the maximum number of free scans for now. Please try again in a few minutes.' }, 429, { 'Retry-After': String(retryAfter) });
    }
    logStructured('info', 'scan.prepare.started', trace);
    try {
      const parsed = parsePublicUrl(input.url);
      const [discovery, pageSpeed] = await Promise.all([
        discoverSite(parsed.url),
        runPageSpeed(parsed.url, context.env ?? {}),
      ]);
      const persisted = await persistPreparedScan(context, input, trace, parsed.url, discovery.discoveredCount, discovery.pageUrls.length);
      logStructured('info', 'scan.prepare.completed', trace, {
        discoveredCount: discovery.discoveredCount,
        pageCount: discovery.pageUrls.length,
        persisted,
      });
      return json({
        scanId: trace.scanId,
        persisted,
        siteUrl: parsed.url.origin,
        submittedUrl: parsed.url.toString(),
        queryRemoved: parsed.removedQuery,
        pageUrls: discovery.pageUrls,
        discoveredCount: discovery.discoveredCount,
        truncated: discovery.truncated,
        pageLimitReached: discovery.discoveredCount > MAX_PAGES_PER_SCAN,
        sitemapEntryLimitHit: discovery.sitemapEntryLimitHit,
        sitemapFileLimitHit: discovery.sitemapFileLimitHit,
        discoveryBudgetHit: discovery.discoveryBudgetHit,
        sitemapFound: discovery.sitemapFound,
        robotsDisallowedCount: discovery.robotsDisallowedCount,
        note: discovery.note,
        pageSpeed,
        limits: { maximumPages: MAX_PAGES_PER_SCAN, pagesPerBatch: MAX_PAGES_PER_BATCH, maximumSitemaps: MAX_SITEMAPS, maximumSitemapEntries: MAX_URLS_FROM_SITEMAPS },
      });
    } catch (error) {
      return errorFrom(error, trace);
    }
  }

  if (input.action === 'scan-pages') {
    if (!scanLimiter.allow('batches', { ip })) {
      const retryAfter = scanLimiter.retryAfterSeconds('batches');
      logStructured('warn', 'scan.rate_limited', trace, { action: 'scan-pages', retryAfterSeconds: retryAfter });
      return json({ error: 'The free scan reached its request limit. Wait a few minutes and try again.' }, 429, { 'Retry-After': String(retryAfter) });
    }
    try {
      if (input.finalBatch !== undefined && typeof input.finalBatch !== 'boolean') {
        throw new ScanError('invalid_batch', 'The scan batch completion flag is not valid.');
      }
      const site = parsePublicUrl(input.siteUrl);
      if (!Array.isArray(input.pages) || input.pages.length < 1 || input.pages.length > MAX_PAGES_PER_BATCH) {
        throw new ScanError('invalid_batch', `Send between 1 and ${MAX_PAGES_PER_BATCH} same-site URLs per scan batch.`);
      }
      for (const page of input.pages) {
        if (typeof page !== 'string' || page.length > 2_048 || hasScript(page)) {
          throw new ScanError('invalid_url', 'Page URLs cannot contain scripts or exceed 2,048 characters.');
        }
      }
      const urls = [...new Set(input.pages.map((page) => {
        const parsed = parsePublicUrl(page);
        if (!sameSiteHost(parsed.url.hostname, site.url.hostname)) {
          throw new ScanError('off_site_url', 'Only pages on the submitted website can be scanned.');
        }
        return parsed.url.toString();
      }))];
      const results: ScannedPage[] = [];
      for (let index = 0; index < urls.length; index += 4) {
        const group = urls.slice(index, index + 4);
        results.push(...await Promise.all(group.map((url) => scanPage(url, site.url.hostname))));
      }
      const persisted = await persistScannedBatch(context, trace, site.url.hostname, results, input.finalBatch === true);
      logStructured('info', 'scan.batch.completed', trace, { pageCount: results.length, persisted });
      return json({ scanId: trace.scanId, persisted, pages: results });
    } catch (error) {
      return errorFrom(error, trace);
    }
  }

  return json({ error: 'Unknown audit action.' }, 400);
}

export async function onRequest(context: ScanContext): Promise<Response> {
  if (context.request.method.toUpperCase() !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use POST.' }), {
      status: 405,
      headers: {
        Allow: 'POST',
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }
  return onRequestPost(context);
}

export async function onRequestPost(context: ScanContext): Promise<Response> {
  const trace = requestTrace(context.env ?? {}, newTraceId());
  try {
    return withTrace(await handleScanRequest(context, trace), trace);
  } catch {
    logStructured('error', 'scan.request.failed', trace, { reason: 'unexpected-error' });
    return withTrace(json({ error: 'The audit could not be prepared. Please try again later.' }, 500), trace);
  }
}
