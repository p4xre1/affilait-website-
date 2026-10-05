import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface AdminEnv {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ADMIN_EMAILS?: string;
  GITHUB_TOKEN?: string;
  GITHUB_OWNER?: string;
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
}

export type AdminAuthResult =
  | { ok: true; email: string }
  | { ok: false; response: Response };

let cachedIssuer = '';
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function jsonResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
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

export async function authenticateAdmin(request: Request, env: AdminEnv): Promise<AdminAuthResult> {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const audiences = env.CF_ACCESS_AUD?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  const allowedEmails = env.ADMIN_EMAILS?.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [];

  if (!teamDomain || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z0-9.-]+$/i.test(teamDomain) || audiences.length === 0 || allowedEmails.length === 0) {
    return { ok: false, response: jsonResponse('Admin authentication is not configured. Contact the site administrator.', 503) };
  }

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) {
    return { ok: false, response: jsonResponse('Sign in through Cloudflare Access to continue.', 401) };
  }

  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    return { ok: false, response: jsonResponse('Your Cloudflare Access session token is malformed. Sign in again.', 401) };
  }

  const issuer = `https://${teamDomain}`;
  if (!cachedJwks || cachedIssuer !== issuer) {
    cachedIssuer = issuer;
    cachedJwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  }

  try {
    const { payload } = await jwtVerify(token, cachedJwks, {
      issuer,
      audience: audiences,
      algorithms: ['RS256', 'ES256'],
    });
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase().trim() : '';
    if (!email || !allowedEmails.includes(email)) {
      return { ok: false, response: jsonResponse('This account is not allowed to use the editorial dashboard.', 403) };
    }
    return { ok: true, email };
  } catch {
    return { ok: false, response: jsonResponse('Your Cloudflare Access session is missing or expired. Sign in again.', 401) };
  }
}
