import { authenticateAdmin, type AdminEnv } from '../_shared/admin-auth';

interface AdminMiddlewareContext {
  request: Request;
  env: AdminEnv;
  next: () => Promise<Response>;
}

export async function onRequest(context: AdminMiddlewareContext): Promise<Response> {
  const auth = await authenticateAdmin(context.request, context.env);
  if (!auth.ok) {
    return new Response(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Admin access required</title></head><body><main><h1>Admin access required</h1><p>Sign in with the configured Cloudflare Access account. If access is not configured yet, follow the admin setup in the project README.</p></main></body></html>',
      {
        status: auth.response.status,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, max-age=0',
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        },
      },
    );
  }
  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, max-age=0');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
