export type AppEnvironment = 'development' | 'staging' | 'production' | 'unknown';

export interface RuntimeEnv {
  APP_ENV?: string;
  GOOGLE_PAGESPEED_API_KEY?: string;
  SCAN_PERSISTENCE_ENABLED?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  CF_PAGES_BRANCH?: string;
}

export type SupabaseConfigResult =
  | { enabled: false; reason: 'feature-disabled' | 'configuration-missing' | 'configuration-invalid' }
  | { enabled: true; url: string; anonKey: string };

export function appEnvironment(env: RuntimeEnv): AppEnvironment {
  const value = env.APP_ENV?.trim().toLowerCase();
  return value === 'development' || value === 'staging' || value === 'production' ? value : 'unknown';
}

/**
 * The current repository adapter uses the caller's Supabase Auth JWT and the
 * public anon key so database RLS stays active. A service-role key is neither
 * needed nor accepted by this foundation.
 */
export function supabaseConfig(env: RuntimeEnv): SupabaseConfigResult {
  if (env.SCAN_PERSISTENCE_ENABLED?.trim().toLowerCase() !== 'true') {
    return { enabled: false, reason: 'feature-disabled' };
  }

  const rawUrl = env.SUPABASE_URL?.trim();
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!rawUrl || !anonKey) return { enabled: false, reason: 'configuration-missing' };

  try {
    const url = new URL(rawUrl);
    const isLocalDev = appEnvironment(env) === 'development'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(isLocalDev && url.protocol === 'http:'))
      || url.username
      || url.password
      || url.search
      || url.hash
      || (url.pathname !== '/' && url.pathname !== '')) {
      return { enabled: false, reason: 'configuration-invalid' };
    }
    return { enabled: true, url: url.origin, anonKey };
  } catch {
    return { enabled: false, reason: 'configuration-invalid' };
  }
}
