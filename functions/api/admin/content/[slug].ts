import type { AdminEnv } from '../../../_shared/admin-auth';
import { ContentApiError, getArticle } from '../../../_shared/github-content';

interface ArticleApiContext {
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
    },
  });
}

export async function onRequestGet(context: ArticleApiContext): Promise<Response> {
  try {
    return json({ article: await getArticle(context.env, context.params.slug ?? '') });
  } catch (error) {
    if (error instanceof ContentApiError) return json({ error: error.message }, error.status);
    console.error('Unexpected editorial article API error:', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'The editorial service could not complete the request. Try again later.' }, 500);
  }
}
