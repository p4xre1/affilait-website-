import { logStructured, newTraceId, requestTrace } from '../_shared/observability';
import type { RuntimeEnv } from '../_shared/runtime-env';

interface DecoyContext {
  request: Request;
  env: RuntimeEnv;
}

/**
 * Defensive Decoy Endpoint: `/api/internal-test`
 * This endpoint is an isolated honeytoken/decoy designed to detect unauthorized internal
 * service enumeration. It exposes zero production secrets, contains zero privileged
 * functionality, and connects to no backend database.
 */
export async function onRequest(context: DecoyContext): Promise<Response> {
  const trace = requestTrace(context.env ?? {}, newTraceId());

  // Log non-sensitive detection event
  logStructured('warn', 'decoy.endpoint_accessed', trace, {
    method: context.request.method,
    path: new URL(context.request.url).pathname,
    action: 'reconnaissance_intercepted',
  });

  return new Response(JSON.stringify({ error: 'Endpoint not found.' }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
