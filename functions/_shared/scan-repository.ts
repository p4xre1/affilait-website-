export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type FindingSeverity = 'critical' | 'warning' | 'info' | 'high' | 'medium' | 'low';

export interface CreateScanInput {
  id?: string;
  projectId: string;
  crawlerVersion: string;
  pageLimit: number;
  pagesDiscovered: number;
}

export interface ScanProjectRecord {
  id: string;
  domain: string;
}

export interface ScanRecord {
  id: string;
  projectId: string;
  status: ScanStatus;
  startedAt: string | null;
  completedAt: string | null;
  crawlerVersion: string;
  pageLimit: number;
  pagesDiscovered: number;
  pagesScanned: number;
  errorCount: number;
  createdAt: string;
}

export interface CrawlPageRecord {
  scanId: string;
  url: string;
  normalizedUrl: string;
  canonicalUrl?: string | null;
  statusCode?: number | null;
  contentType?: string | null;
  title?: string | null;
  h1?: string | null;
  headings?: Array<{ level: number; text: string }>;
  depth?: number | null;
  wordCount?: number | null;
  indexability?: boolean | null;
  robots?: string | null;
  metaRobots?: string | null;
  contentHash?: string | null;
  discoveredAt?: string | null;
  crawledAt?: string | null;
}

export interface PersistedFinding {
  scanId: string;
  pageId?: string | null;
  category: string;
  type: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence: unknown;
  confidence?: number | null;
  recommendation: string;
}

export interface ScanUpdate {
  status?: ScanStatus;
  pagesDiscovered?: number;
  pagesScanned?: number;
  errorCount?: number;
  completedAt?: string | null;
}

/** Repository boundary keeps the scanner independent of Supabase/PostgREST. */
export interface ScanRepository {
  getProject(projectId: string): Promise<ScanProjectRecord | null>;
  createScan(input: CreateScanInput): Promise<ScanRecord>;
  updateScan(scanId: string, update: ScanUpdate): Promise<ScanRecord | null>;
  savePage(page: CrawlPageRecord): Promise<void>;
  savePages(pages: CrawlPageRecord[]): Promise<void>;
  saveFinding(finding: PersistedFinding): Promise<void>;
  completeScan(scanId: string): Promise<ScanRecord | null>;
  failScan(scanId: string): Promise<ScanRecord | null>;
  getScan(scanId: string): Promise<ScanRecord | null>;
  getScanPages(scanId: string): Promise<CrawlPageRecord[]>;
  getScanFindings(scanId: string): Promise<PersistedFinding[]>;
  deleteScan(scanId: string): Promise<void>;
}

export interface SupabaseUserConnection {
  url: string;
  anonKey: string;
  accessToken: string;
}

export class ScanRepositoryError extends Error {
  constructor(readonly code: 'invalid_input' | 'request_failed' | 'invalid_response' | 'timeout', readonly status?: number) {
    super(code === 'request_failed' ? 'The scan repository request failed.' : 'The scan repository could not complete the request.');
    this.name = 'ScanRepositoryError';
  }
}

interface DbProject {
  id: string;
  domain: string;
}

interface DbScan {
  id: string;
  project_id: string;
  status: ScanStatus;
  started_at: string | null;
  completed_at: string | null;
  crawler_version: string;
  page_limit: number;
  pages_discovered: number;
  pages_scanned: number;
  error_count: number;
  created_at: string;
}

interface DbPage {
  scan_id: string;
  url: string;
  normalized_url: string;
  canonical_url: string | null;
  status_code: number | null;
  content_type: string | null;
  title: string | null;
  h1: string | null;
  headings: Array<{ level: number; text: string }>;
  depth: number | null;
  word_count: number | null;
  indexability: boolean | null;
  robots: string | null;
  meta_robots: string | null;
  content_hash: string | null;
  discovered_at: string | null;
  crawled_at: string | null;
}

interface DbFinding {
  scan_id: string;
  page_id: string | null;
  category: string;
  type: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence: unknown;
  confidence: number | null;
  recommendation: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 4_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_PAGES_PER_SCAN = 100;
const MAX_FINDINGS_PER_SCAN = 500;

function requireUuid(value: string, _label: string): string {
  if (!UUID_PATTERN.test(value)) throw new ScanRepositoryError('invalid_input');
  return value;
}

function toScanRecord(row: DbScan): ScanRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    crawlerVersion: row.crawler_version,
    pageLimit: row.page_limit,
    pagesDiscovered: row.pages_discovered,
    pagesScanned: row.pages_scanned,
    errorCount: row.error_count,
    createdAt: row.created_at,
  };
}

function toPageRecord(row: DbPage): CrawlPageRecord {
  return {
    scanId: row.scan_id,
    url: row.url,
    normalizedUrl: row.normalized_url,
    canonicalUrl: row.canonical_url,
    statusCode: row.status_code,
    contentType: row.content_type,
    title: row.title,
    h1: row.h1,
    headings: row.headings,
    depth: row.depth,
    wordCount: row.word_count,
    indexability: row.indexability,
    robots: row.robots,
    metaRobots: row.meta_robots,
    contentHash: row.content_hash,
    discoveredAt: row.discovered_at,
    crawledAt: row.crawled_at,
  };
}

function toFindingRecord(row: DbFinding): PersistedFinding {
  return {
    scanId: row.scan_id,
    pageId: row.page_id,
    category: row.category,
    type: row.type,
    severity: row.severity,
    title: row.title,
    description: row.description,
    evidence: row.evidence,
    confidence: row.confidence,
    recommendation: row.recommendation,
  };
}

function requireRows<T>(data: unknown): T[] {
  if (!Array.isArray(data)) throw new ScanRepositoryError('invalid_response');
  return data as T[];
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
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
        throw new ScanRepositoryError('invalid_response');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ScanRepositoryError) throw error;
    throw new ScanRepositoryError('request_failed');
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ScanRepositoryError('invalid_response');
  }
}

export class SupabaseScanRepository implements ScanRepository {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly fetcher: typeof fetch;

  constructor(connection: SupabaseUserConnection, fetcher: typeof fetch = fetch) {
    let url: URL;
    try {
      url = new URL(connection.url);
    } catch {
      throw new ScanRepositoryError('invalid_input');
    }
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      || url.username
      || url.password
      || (url.pathname !== '/' && url.pathname !== '')
      || url.search
      || url.hash
      || /[\r\n]/.test(connection.anonKey)
      || !connection.anonKey.trim()
      || connection.anonKey.length > 4_096
      || /[\r\n]/.test(connection.accessToken)
      || !connection.accessToken.trim()
      || connection.accessToken.length > 8_192) {
      throw new ScanRepositoryError('invalid_input');
    }
    this.baseUrl = url.origin;
    this.anonKey = connection.anonKey;
    this.accessToken = connection.accessToken;
    this.fetcher = fetcher;
  }

  async getProject(projectId: string): Promise<ScanProjectRecord | null> {
    requireUuid(projectId, 'projectId');
    const rows = requireRows<DbProject>(await this.tableRequest('projects', {
      params: { id: `eq.${projectId}`, select: 'id,domain', limit: '1' },
    }));
    return rows[0] ? { id: rows[0].id, domain: rows[0].domain } : null;
  }

  async createScan(input: CreateScanInput): Promise<ScanRecord> {
    requireUuid(input.projectId, 'projectId');
    if (input.id !== undefined) requireUuid(input.id, 'scanId');
    if (!Number.isInteger(input.pageLimit) || input.pageLimit < 1 || input.pageLimit > MAX_PAGES_PER_SCAN
      || !Number.isInteger(input.pagesDiscovered) || input.pagesDiscovered < 0 || input.pagesDiscovered > 10_000
      || !input.crawlerVersion || input.crawlerVersion.length > 60) {
      throw new ScanRepositoryError('invalid_input');
    }
    const rows = requireRows<DbScan>(await this.tableRequest('scans', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        ...(input.id ? { id: input.id } : {}),
        project_id: input.projectId,
        status: 'running',
        started_at: new Date().toISOString(),
        crawler_version: input.crawlerVersion,
        page_limit: input.pageLimit,
        pages_discovered: input.pagesDiscovered,
        pages_scanned: 0,
        error_count: 0,
      }),
    }));
    if (!rows[0]) throw new ScanRepositoryError('invalid_response');
    return toScanRecord(rows[0]);
  }

  async updateScan(scanId: string, update: ScanUpdate): Promise<ScanRecord | null> {
    requireUuid(scanId, 'scanId');
    const body: Record<string, unknown> = {};
    if (update.status !== undefined) body.status = update.status;
    if (update.pagesDiscovered !== undefined) body.pages_discovered = update.pagesDiscovered;
    if (update.pagesScanned !== undefined) body.pages_scanned = update.pagesScanned;
    if (update.errorCount !== undefined) body.error_count = update.errorCount;
    if (update.completedAt !== undefined) body.completed_at = update.completedAt;
    if (!Object.keys(body).length) throw new ScanRepositoryError('invalid_input');
    const rows = requireRows<DbScan>(await this.tableRequest('scans', {
      method: 'PATCH',
      params: { id: `eq.${scanId}`, select: '*' },
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    }));
    return rows[0] ? toScanRecord(rows[0]) : null;
  }

  async savePage(page: CrawlPageRecord): Promise<void> {
    await this.savePages([page]);
  }

  async savePages(pages: CrawlPageRecord[]): Promise<void> {
    if (!Array.isArray(pages) || pages.length < 1 || pages.length > 10) throw new ScanRepositoryError('invalid_input');
    const records = pages.map((page) => {
      requireUuid(page.scanId, 'scanId');
      if (typeof page.url !== 'string' || page.url.length < 8 || page.url.length > 2_048
        || typeof page.normalizedUrl !== 'string' || page.normalizedUrl.length < 8 || page.normalizedUrl.length > 2_048) {
        throw new ScanRepositoryError('invalid_input');
      }
      if ((page.statusCode !== undefined && page.statusCode !== null && (!Number.isInteger(page.statusCode) || page.statusCode < 100 || page.statusCode > 599))
        || (page.depth !== undefined && page.depth !== null && (!Number.isInteger(page.depth) || page.depth < 0))
        || (page.wordCount !== undefined && page.wordCount !== null && (!Number.isInteger(page.wordCount) || page.wordCount < 0))) {
        throw new ScanRepositoryError('invalid_input');
      }
      const headings = page.headings ?? [];
      if (!Array.isArray(headings) || headings.length > 18 || headings.some((heading) => !Number.isInteger(heading.level) || heading.level < 1 || heading.level > 3 || typeof heading.text !== 'string' || heading.text.length > 180)) {
        throw new ScanRepositoryError('invalid_input');
      }
      return {
        scan_id: page.scanId,
        url: page.url,
        normalized_url: page.normalizedUrl,
        canonical_url: page.canonicalUrl ?? null,
        status_code: page.statusCode ?? null,
        content_type: page.contentType ?? null,
        title: page.title ?? null,
        h1: page.h1 ?? null,
        headings,
        depth: page.depth ?? null,
        word_count: page.wordCount ?? null,
        indexability: page.indexability ?? null,
        robots: page.robots ?? null,
        meta_robots: page.metaRobots ?? null,
        content_hash: page.contentHash ?? null,
        discovered_at: page.discoveredAt ?? null,
        crawled_at: page.crawledAt ?? new Date().toISOString(),
      };
    });
    if (new TextEncoder().encode(JSON.stringify(records)).byteLength > 200_000) throw new ScanRepositoryError('invalid_input');
    await this.tableRequest('crawl_pages', {
      method: 'POST',
      params: { on_conflict: 'scan_id,normalized_url' },
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(records),
    });
  }

  async saveFinding(finding: PersistedFinding): Promise<void> {
    requireUuid(finding.scanId, 'scanId');
    if (finding.pageId) requireUuid(finding.pageId, 'pageId');
    if (!finding.category || finding.category.length > 80 || !finding.type || finding.type.length > 100
      || !finding.title || finding.title.length > 300 || finding.description.length > 4_000
      || finding.recommendation.length > 2_000
      || (finding.confidence !== undefined && finding.confidence !== null && (!Number.isFinite(finding.confidence) || finding.confidence < 0 || finding.confidence > 1))) {
      throw new ScanRepositoryError('invalid_input');
    }
    const evidence = JSON.stringify(finding.evidence ?? {});
    if (new TextEncoder().encode(evidence).byteLength > 32_000) throw new ScanRepositoryError('invalid_input');
    await this.tableRequest('findings', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        scan_id: finding.scanId,
        page_id: finding.pageId ?? null,
        category: finding.category,
        type: finding.type,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        evidence: JSON.parse(evidence) as unknown,
        confidence: finding.confidence ?? null,
        recommendation: finding.recommendation,
      }),
    });
  }

  async completeScan(scanId: string): Promise<ScanRecord | null> {
    const pages = await this.getScanPages(scanId);
    const errorCount = pages.filter((page) => page.statusCode === null || page.statusCode === undefined || page.statusCode < 200 || page.statusCode >= 300).length;
    return this.updateScan(scanId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      pagesScanned: pages.length,
      errorCount,
    });
  }

  async failScan(scanId: string): Promise<ScanRecord | null> {
    const pages = await this.getScanPages(scanId);
    const errorCount = Math.max(1, pages.filter((page) => page.statusCode === null || page.statusCode === undefined || page.statusCode < 200 || page.statusCode >= 300).length);
    return this.updateScan(scanId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      pagesScanned: pages.length,
      errorCount,
    });
  }

  async getScan(scanId: string): Promise<ScanRecord | null> {
    requireUuid(scanId, 'scanId');
    const rows = requireRows<DbScan>(await this.tableRequest('scans', {
      params: { id: `eq.${scanId}`, select: '*', limit: '1' },
    }));
    return rows[0] ? toScanRecord(rows[0]) : null;
  }

  async getScanPages(scanId: string): Promise<CrawlPageRecord[]> {
    requireUuid(scanId, 'scanId');
    const rows = requireRows<DbPage>(await this.tableRequest('crawl_pages', {
      params: { scan_id: `eq.${scanId}`, select: '*', order: 'crawled_at.asc', limit: String(MAX_PAGES_PER_SCAN) },
    }));
    return rows.map(toPageRecord);
  }

  async getScanFindings(scanId: string): Promise<PersistedFinding[]> {
    requireUuid(scanId, 'scanId');
    const rows = requireRows<DbFinding>(await this.tableRequest('findings', {
      params: { scan_id: `eq.${scanId}`, select: '*', order: 'created_at.asc', limit: String(MAX_FINDINGS_PER_SCAN) },
    }));
    return rows.map(toFindingRecord);
  }

  async deleteScan(scanId: string): Promise<void> {
    requireUuid(scanId, 'scanId');
    await this.tableRequest('scans', {
      method: 'DELETE',
      params: { id: `eq.${scanId}` },
      headers: { Prefer: 'return=minimal' },
    });
  }

  private async tableRequest(table: string, options: {
    method?: string;
    params?: Record<string, string>;
    headers?: HeadersInit;
    body?: string;
  } = {}): Promise<unknown> {
    const url = new URL(`/rest/v1/${table}`, this.baseUrl);
    for (const [key, value] of Object.entries(options.params ?? {})) url.searchParams.set(key, value);
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    headers.set('apikey', this.anonKey);
    headers.set('Authorization', `Bearer ${this.accessToken}`);
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('repository timeout'), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetcher(url, {
        method: options.method ?? 'GET',
        redirect: 'error',
        headers,
        ...(options.body !== undefined ? { body: options.body } : {}),
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ScanRepositoryError('request_failed', response.status);
      }
      if (response.status === 204) return null;
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > MAX_RESPONSE_BYTES) throw new ScanRepositoryError('invalid_response');
      const text = await readBoundedText(response, MAX_RESPONSE_BYTES);
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ScanRepositoryError('invalid_response');
      }
    } catch (error) {
      if (error instanceof ScanRepositoryError) throw error;
      if (controller.signal.aborted) throw new ScanRepositoryError('timeout');
      throw new ScanRepositoryError('request_failed');
    } finally {
      clearTimeout(timeout);
    }
  }

  private readonly anonKey: string;
}
