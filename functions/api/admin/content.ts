import type { AdminEnv } from '../../_shared/admin-auth';
import { ContentApiError, listArticles, saveArticle } from '../../_shared/github-content';

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
    },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof ContentApiError) return json({ error: error.message }, error.status);
  console.error('Unexpected editorial content API error:', error instanceof Error ? error.name : 'unknown');
  return json({ error: 'The editorial service could not complete the request. Try again later.' }, 500);
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
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return json({ error: 'The request body must be a JSON object.' }, 400);
    }
    const data = input as Record<string, unknown>;
    if (typeof data.slug !== 'string' || typeof data.content !== 'string') {
      return json({ error: 'Both slug and Markdown content are required.' }, 400);
    }
    if (data.expectedSha !== undefined && (typeof data.expectedSha !== 'string' || data.expectedSha.length > 80)) {
      return json({ error: 'The article revision is invalid. Refresh the dashboard and try again.' }, 400);
    }
    const saved = await saveArticle(context.env, {
      slug: data.slug,
      content: data.content,
      expectedSha: data.expectedSha as string | undefined,
    });
    return json({ article: saved }, 201);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'The request body must contain valid JSON.' }, 400);
    return errorResponse(error);
  }
}
