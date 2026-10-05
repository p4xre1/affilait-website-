import type { AdminEnv } from '../../_shared/admin-auth';
import { ContentApiError, listArticles, saveArticle } from '../../_shared/github-content';
import { assertSafeObject, hasScript, InputValidationError } from '../../_shared/input-guard';

interface ContentApiContext {
  request: Request;
  env: AdminEnv;
}

function json(data: unknown, status = 200): Response {
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
    },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof ContentApiError) return json({ error: error.message }, error.status);
  if (error instanceof InputValidationError) return json({ error: error.message }, 400);
  console.error('Unexpected editorial content API error:', error instanceof Error ? error.name : 'unknown');
  return json({ error: 'The editorial service could not complete the request. Try again later.' }, 500);
}

export async function onRequest(context: ContentApiContext): Promise<Response> {
  const method = context.request.method.toUpperCase();
  if (method === 'GET') return onRequestGet(context);
  if (method === 'POST') return onRequestPost(context);
  return new Response(JSON.stringify({ error: 'Method not allowed. Use GET or POST.' }), {
    status: 405,
    headers: {
      Allow: 'GET, POST',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export async function onRequestGet(context: ContentApiContext): Promise<Response> {
  try {
    return json({ articles: await listArticles(context.env) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost(context: ContentApiContext): Promise<Response> {
  if (!context.request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return json({ error: 'Send article updates as application/json.' }, 415);
  }
  const declaredLength = Number(context.request.headers.get('content-length') || 0);
  if (declaredLength > 525_000) return json({ error: 'Article source is too large. Maximum size is 250 KB.' }, 413);

  try {
    const raw = await context.request.text();
    if (new TextEncoder().encode(raw).byteLength > 525_000) {
      return json({ error: 'Article source is too large. Maximum size is 250 KB.' }, 413);
    }
    const input = assertSafeObject(JSON.parse(raw), 5, 'The article update');
    const slug = input.slug;
    const content = input.content;
    const expectedSha = input.expectedSha;

    if (typeof slug !== 'string' || typeof content !== 'string') {
      return json({ error: 'Both slug and Markdown content are required.' }, 400);
    }
    if (slug.length < 2 || slug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || hasScript(slug)) {
      return json({ error: 'Slug must contain 2–80 lowercase alphanumeric characters separated by single hyphens.' }, 400);
    }
    if (expectedSha !== undefined && (typeof expectedSha !== 'string' || !/^[0-9a-f]{40,64}$/i.test(expectedSha))) {
      return json({ error: 'The article revision is invalid. Refresh the dashboard and try again.' }, 400);
    }
    const saved = await saveArticle(context.env, {
      slug,
      content,
      expectedSha: expectedSha as string | undefined,
    });
    return json({ article: saved }, 201);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'The request body must contain valid JSON.' }, 400);
    return errorResponse(error);
  }
}
