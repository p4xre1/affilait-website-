import type { AdminEnv } from '../../../_shared/admin-auth';
import { ContentApiError, getArticle } from '../../../_shared/github-content';
import { hasScript } from '../../../_shared/input-guard';

interface ArticleApiContext {
  request: Request;
  env: AdminEnv;
  params: Record<string, string>;
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

export async function onRequest(context: ArticleApiContext): Promise<Response> {
  if (context.request.method.toUpperCase() !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use GET.' }), {
      status: 405,
      headers: {
        Allow: 'GET',
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }
  return onRequestGet(context);
}

export async function onRequestGet(context: ArticleApiContext): Promise<Response> {
  const slug = context.params.slug ?? '';
  if (slug.length < 2 || slug.length > 80 || hasScript(slug)) {
    return json({ error: 'Invalid article slug.' }, 400);
  }
  try {
    return json({ article: await getArticle(context.env, slug) });
  } catch (error) {
    if (error instanceof ContentApiError) return json({ error: error.message }, error.status);
    console.error('Unexpected editorial article API error:', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'The editorial service could not complete the request. Try again later.' }, 500);
  }
}
