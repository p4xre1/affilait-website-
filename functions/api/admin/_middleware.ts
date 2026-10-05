import { authenticateAdmin, type AdminEnv } from '../../_shared/admin-auth';

interface AdminApiContext {
  request: Request;
  env: AdminEnv;
  next: () => Promise<Response>;
}

export async function onRequest(context: AdminApiContext): Promise<Response> {
  const auth = await authenticateAdmin(context.request, context.env);
  if (!auth.ok) return auth.response;

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
