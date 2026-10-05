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
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Admin access required</title><body><main><h1>Admin access required</h1><p>Sign in with the configured Cloudflare Access account. If access is not configured yet, follow the admin setup in the project README.</p></main></body></html>',
      {
        status: auth.response.status,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, max-age=0',
          'X-Robots-Tag': 'noindex, nofollow',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  }
  return context.next();
}
