import { authenticateAdmin, type AdminEnv } from '../../_shared/admin-auth';

interface AdminApiContext {
  request: Request;
  env: AdminEnv;
  next: () => Promise<Response>;
}

export async function onRequest(context: AdminApiContext): Promise<Response> {
  const auth = await authenticateAdmin(context.request, context.env);
  if (!auth.ok) return auth.response;

  if (!['GET', 'HEAD', 'OPTIONS'].includes(context.request.method.toUpperCase())) {
    const origin = context.request.headers.get('Origin');
    const requestOrigin = new URL(context.request.url).origin;
    if (!origin || origin !== requestOrigin) {
      return new Response(JSON.stringify({ error: 'Request origin could not be verified.' }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
  }
  return context.next();
}
