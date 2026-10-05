import { authenticateAdmin, type AdminEnv } from '../../_shared/admin-auth';

interface AdminApiContext {
  request: Request;
  env: AdminEnv;
  next: () => Promise<Response>;
}

interface AdminRateBucket {
  count: number;
  resetAt: number;
}

const adminBuckets = new Map<string, AdminRateBucket>();
const ADMIN_WINDOW_MS = 10 * 60 * 1000;
const ADMIN_MAX_REQUESTS = 120;

function checkAdminRateLimit(key: string, now = Date.now()): boolean {
  let bucket = adminBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    if (adminBuckets.size >= 1_000) {
      for (const [k, b] of adminBuckets) {
        if (now >= b.resetAt) adminBuckets.delete(k);
      }
    }
    bucket = { count: 1, resetAt: now + ADMIN_WINDOW_MS };
    adminBuckets.set(key, bucket);
    return true;
  }
  if (bucket.count >= ADMIN_MAX_REQUESTS) return false;
  bucket.count += 1;
  return true;
}

export async function onRequest(context: AdminApiContext): Promise<Response> {
  const auth = await authenticateAdmin(context.request, context.env);
  if (!auth.ok) return auth.response;

  const ip = context.request.headers.get('CF-Connecting-IP') || 'admin';
  const rateKey = `${auth.email}:${ip}`;
  if (!checkAdminRateLimit(rateKey)) {
    return new Response(JSON.stringify({ error: 'Admin request rate limit reached. Please wait a few minutes.' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'Referrer-Policy': 'no-referrer',
        'Retry-After': '600',
      },
    });
  }

  const method = context.request.method.toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const origin = context.request.headers.get('Origin');
    const requestOrigin = new URL(context.request.url).origin;
    const secFetchSite = context.request.headers.get('Sec-Fetch-Site');
    if (!origin || origin !== requestOrigin || secFetchSite === 'cross-site') {
      return new Response(JSON.stringify({ error: 'Request origin could not be verified.' }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
          'Referrer-Policy': 'no-referrer',
          'Cross-Origin-Resource-Policy': 'same-origin',
        },
      });
    }
  }
  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, max-age=0');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
