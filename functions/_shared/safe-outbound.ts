/**
 * Centralized Safe Outbound Request Layer (SafeOutboundRequest)
 * Enforces Zero-Trust boundary controls on all outbound requests initiated by the scanner:
 * - Scheme, port, and credential validation
 * - Strict IPv4 normalization (dotted decimal, octal, hex, dword)
 * - Strict IPv6 normalization (loopback, link-local, ULA, multicast, IPv4-mapped)
 * - Complete RFC CIDR blocklist (private, loopback, link-local, CGNAT, test nets, multicast, reserved)
 * - Dynamic DNS and DNS rebinding provider blocklist
 * - Cloud provider metadata service blocklist
 * - Manual redirect interception with per-hop re-validation and crawl scope enforcement
 * - Streaming response reading with configurable byte and time bounds
 */

export class SafeOutboundError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SafeOutboundError';
  }
}

export interface OutboundTarget {
  url: URL;
  rawUrl: string;
  normalizedHostname: string;
}

export interface SafeFetchOptions {
  rootHostname: string;
  accept?: string;
  maximumBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  crawlScope?: 'same-site' | 'same-origin';
  userAgent?: string;
  fetcher?: typeof fetch;
}

export interface SafeFetchResult {
  response: Response;
  text: string;
  finalUrl: URL;
  redirectCount: number;
}

const FORBIDDEN_TLDS_AND_SUFFIXES = new Set([
  'localhost',
  'local',
  'internal',
  'intranet',
  'lan',
  'corp',
  'home',
  'home.arpa',
  'arpa',
  'priv',
  'test',
  'invalid',
  'onion',
]);

const DYNAMIC_DNS_AND_REBINDING_SUFFIXES = [
  'nip.io',
  'sslip.io',
  'xip.io',
  'localtest.me',
  'localhost.direct',
  'lvh.me',
  'vcap.me',
  'myip.io',
  'fip.io',
  'traefik.me',
  'customer-ip.com',
  'localh.st',
  '127-0-0-1.org.uk',
];

const CLOUD_METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.google',
  'instance-data',
  'metadata.tce.internal',
  'metadata.packet.net',
  'metadata',
]);

// Reserved IPv4 CIDR blocks: [baseIpAsDword, maskBits, label]
const BLOCKED_IPV4_CIDRS: Array<[number, number, string]> = [
  [0, 8, '0.0.0.0/8 (This network)'],
  [167772160, 8, '10.0.0.0/8 (Private network)'],
  [1681915904, 10, '100.64.0.0/10 (Carrier-Grade NAT)'],
  [2130706432, 8, '127.0.0.0/8 (Loopback)'],
  [2851995648, 16, '169.254.0.0/16 (Link-Local / Cloud Metadata)'],
  [2886729728, 12, '172.16.0.0/12 (Private network)'],
  [3221225472, 24, '192.0.0.0/24 (IETF Protocol Assignments)'],
  [3221225984, 24, '192.0.2.0/24 (TEST-NET-1)'],
  [3232235520, 16, '192.168.0.0/16 (Private network)'],
  [3323068416, 15, '198.18.0.0/15 (Benchmarking)'],
  [3325256704, 24, '198.51.100.0/24 (TEST-NET-2)'],
  [3405803776, 24, '203.0.113.0/24 (TEST-NET-3)'],
  [3758096384, 4, '224.0.0.0/4 (Multicast)'],
  [4026531840, 4, '240.0.0.0/4 (Reserved)'],
  [4294967295, 32, '255.255.255.255/32 (Limited Broadcast)'],
];

/** Parse any IPv4 representation (dotted-decimal, octal, hex, dword) to a 32-bit unsigned integer. */
export function parseIpv4ToNumber(host: string): number | null {
  const clean = host.trim().toLowerCase();
  const parts = clean.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    if (!part) return null;
    let num: number;
    if (/^0x[0-9a-f]+$/i.test(part)) {
      num = Number.parseInt(part, 16);
    } else if (/^0[0-7]+$/.test(part)) {
      num = Number.parseInt(part, 8);
    } else if (/^\d+$/.test(part)) {
      num = Number.parseInt(part, 10);
    } else {
      return null;
    }
    if (!Number.isFinite(num) || num < 0 || num > 0xffffffff) return null;
    numbers.push(num);
  }

  if (numbers.length === 4) {
    if (numbers.some((n) => n > 255)) return null;
    return (numbers[0] * 16777216) + (numbers[1] * 65536) + (numbers[2] * 256) + numbers[3];
  }
  if (numbers.length === 3) {
    if (numbers[0] > 255 || numbers[1] > 255 || numbers[2] > 65535) return null;
    return (numbers[0] * 16777216) + (numbers[1] * 65536) + numbers[2];
  }
  if (numbers.length === 2) {
    if (numbers[0] > 255 || numbers[1] > 16777215) return null;
    return (numbers[0] * 16777216) + numbers[1];
  }
  if (numbers.length === 1) {
    return numbers[0];
  }
  return null;
}

/** Check if a 32-bit IPv4 integer falls inside a blocked CIDR range. */
export function isBlockedIpv4(ip: number): boolean {
  for (const [base, maskBits] of BLOCKED_IPV4_CIDRS) {
    const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
    if (((ip >>> 0) & mask) === ((base >>> 0) & mask)) return true;
  }
  return false;
}

/** Classify and block forbidden IPv6 addresses (loopback, link-local, ULA, multicast, mapped). */
export function isBlockedIpv6(host: string): boolean {
  const clean = host.toLowerCase().replace(/^\[|\]$/g, '').trim();
  if (clean === '::1' || clean === '0:0:0:0:0:0:0:1' || clean === '::' || clean === '0:0:0:0:0:0:0:0') return true;
  if (/^fe[89ab][0-9a-f]:/i.test(clean) || clean.startsWith('fe80:')) return true; // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/i.test(clean)) return true; // unique local fc00::/7
  if (clean.startsWith('ff') && clean.includes(':')) return true; // multicast ff00::/8

  // Check IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
  const mappedMatch = clean.match(/^::ffff:([0-9a-f.:]+)$/i);
  if (mappedMatch) {
    const embedded = mappedMatch[1];
    if (embedded.includes('.')) {
      const parsed = parseIpv4ToNumber(embedded);
      if (parsed !== null && isBlockedIpv4(parsed)) return true;
    } else {
      const hexParts = embedded.split(':');
      if (hexParts.length === 2) {
        const high = Number.parseInt(hexParts[0], 16);
        const low = Number.parseInt(hexParts[1], 16);
        if (Number.isFinite(high) && Number.isFinite(low)) {
          const num = (high * 65536) + low;
          if (isBlockedIpv4(num)) return true;
        }
      }
    }
    return true; // Default reject mapped addresses for safety
  }
  return false;
}

/** Determine whether a hostname is a safe, public domain name. */
export function isSafePublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '').trim();
  if (!host || host.length > 253) return false;

  // Direct IPv6 check (bracketed or bare IPv6)
  if (host.includes(':')) {
    return false; // Direct IPv6 connections to IP addresses are disallowed for the public scanner
  }

  // IPv4 number representation check
  const parsedIp = parseIpv4ToNumber(host);
  if (parsedIp !== null) {
    return false; // All direct numeric IP connections are disallowed for the public scanner
  }

  if (host === 'localhost') return false;
  if (CLOUD_METADATA_HOSTS.has(host)) return false;

  // Suffix checks
  for (const suffix of FORBIDDEN_TLDS_AND_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return false;
  }
  for (const suffix of DYNAMIC_DNS_AND_REBINDING_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return false;
  }

  // Embedded private IP check in DNS labels (e.g. 127.0.0.1.attacker.com or 127-0-0-1.example.org)
  if (/(?:^|[.-])(?:127|169[.-]254|10|192[.-]168|172[.-](?:1[6-9]|2\d|3[01])|0[.-]0[.-]0[.-]0)[.-]/.test(host)) {
    return false;
  }

  const labels = host.split('.');
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (!label || label.length > 63) return false;
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) return false;
    if (/^0x/i.test(label) || /^0\d+$/.test(label)) return false; // Hex/octal labels forbidden
  }

  // TLD must be >= 2 alphabetic characters or punycode (xn--)
  const tld = labels[labels.length - 1];
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(tld)) return false;

  return true;
}

/** Verify crawl scope boundary between two hostnames. */
export function isSameScopeHost(hostname: string, rootHostname: string, scope: 'same-site' | 'same-origin' = 'same-site'): boolean {
  const normA = hostname.toLowerCase().replace(/\.$/, '');
  const normB = rootHostname.toLowerCase().replace(/\.$/, '');
  if (scope === 'same-origin') return normA === normB;
  const siteA = normA.replace(/^www\./, '');
  const siteB = normB.replace(/^www\./, '');
  return siteA === siteB;
}

/** Centralized SafeOutboundRequest class */
export class SafeOutboundRequest {
  /** Validate and canonicalize a target URL. */
  static validateUrl(input: unknown): OutboundTarget {
    if (typeof input !== 'string' || input.trim().length === 0 || input.length > 2_048) {
      throw new SafeOutboundError('invalid_url', 'Enter a public website URL, such as https://example.com.');
    }
    const clean = input.trim();
    if (/[\x00-\x1f\x7f]/.test(clean)) {
      throw new SafeOutboundError('invalid_url', 'The URL contains invalid control characters.');
    }
    if (/<\s*script\b|<\s*\/\s*script\s*>|\bjavascript\s*:|\bvbscript\s*:|\bdata\s*:\s*text\/html/i.test(clean)) {
      throw new SafeOutboundError('invalid_url', 'The URL contains forbidden script patterns or HTML tags.');
    }

    const candidate = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new SafeOutboundError('invalid_url', 'That URL is not valid. Enter a public website address.');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new SafeOutboundError('invalid_url', 'Only public HTTP and HTTPS websites can be scanned.');
    }
    if (url.username || url.password) {
      throw new SafeOutboundError('invalid_url', 'Remove any username or password from the URL before scanning.');
    }
    if (url.port && url.port !== '80' && url.port !== '443') {
      throw new SafeOutboundError('invalid_url', 'Custom ports are not supported. Use the public website address.');
    }

    const hostname = url.hostname;
    if (!isSafePublicHostname(hostname)) {
      throw new SafeOutboundError('invalid_url', 'The scanner only accepts public domain names, not local or private network addresses.');
    }

    url.search = '';
    url.hash = '';

    return {
      url,
      rawUrl: url.toString(),
      normalizedHostname: url.hostname.toLowerCase().replace(/\.$/, ''),
    };
  }

  /** Read a response body safely with hard byte limits to prevent decompression bombs and memory exhaustion. */
  static async readBoundedBody(response: Response, maximumBytes: number, tooLargeMessage = 'The public page is too large for this free scan.'): Promise<string> {
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > maximumBytes) {
      await response.body?.cancel();
      throw new SafeOutboundError('body_too_large', tooLargeMessage);
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
          throw new SafeOutboundError('body_too_large', tooLargeMessage);
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

  /**
   * Execute an outbound fetch with complete SSRF, redirect interception,
   * scope boundary, byte cap, and timeout enforcement.
   */
  static async fetch(
    targetUrl: URL,
    options: SafeFetchOptions,
  ): Promise<SafeFetchResult> {
    const fetcher = options.fetcher || globalThis.fetch;
    const maxRedirects = options.maxRedirects ?? 3;
    const maximumBytes = options.maximumBytes ?? 350_000;
    const timeoutMs = options.timeoutMs ?? 5_000;
    const crawlScope = options.crawlScope ?? 'same-site';
    const userAgent = options.userAgent || 'FatoratiSiteAudit/1.0 (+https://fatorati.me/)';
    const accept = options.accept || 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1';

    let current = new URL(targetUrl.toString());

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      // Validate current URL before connection
      const validated = SafeOutboundRequest.validateUrl(current.toString());
      if (!isSameScopeHost(validated.normalizedHostname, options.rootHostname, crawlScope)) {
        throw new SafeOutboundError('unsafe_redirect', 'The site redirected outside its public domain, so the scan stopped safely.');
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);

      try {
        const response = await fetcher(current.toString(), {
          method: 'GET',
          redirect: 'manual', // Never let underlying client follow redirects automatically
          signal: controller.signal,
          headers: {
            Accept: accept,
            'User-Agent': userAgent,
          },
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || redirectCount === maxRedirects) {
            throw new SafeOutboundError('redirect_limit', 'The page could not be reached after several redirects.');
          }

          let redirected: URL;
          try {
            redirected = new URL(location, current);
          } catch {
            throw new SafeOutboundError('unsafe_redirect', 'The site returned an invalid redirect.');
          }

          // Fully validate the redirected URL through the outbound security layer
          const redirectedValidated = SafeOutboundRequest.validateUrl(redirected.toString());
          if (!isSameScopeHost(redirectedValidated.normalizedHostname, options.rootHostname, crawlScope)) {
            throw new SafeOutboundError('unsafe_redirect', 'The site redirected outside its public domain, so the scan stopped safely.');
          }

          current = redirectedValidated.url;
          continue;
        }

        const text = await SafeOutboundRequest.readBoundedBody(response, maximumBytes);
        return {
          response,
          text,
          finalUrl: current,
          redirectCount,
        };
      } catch (error) {
        if (error instanceof SafeOutboundError) throw error;
        if (controller.signal.aborted) throw new SafeOutboundError('timeout', 'The site took too long to respond.');
        throw new SafeOutboundError('network', 'The site could not be reached by the audit service.');
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new SafeOutboundError('redirect_limit', 'The page could not be reached after several redirects.');
  }
}
