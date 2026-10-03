// Public, non-secret settings for the browser. Secrets (GEMINI_API_KEY) never leave the server.
// SKIP_AUTH only ever applies on localhost, so it can't disable sign-in in production.
export const skipAuth = (env, request) => env.SKIP_AUTH === 'true' && ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname);

export function onRequestGet({ env, request }) {
  let adSlots = {};
  try { adSlots = JSON.parse(env.ADSENSE_SLOTS || '{}'); } catch {}
  return Response.json({
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
    googleAuth: env.GOOGLE_AUTH === 'true',
    adsenseClient: env.ADSENSE_CLIENT || '',
    adSlots,
    skipAuth: skipAuth(env, request),
  }, { headers: { 'cache-control': 'no-cache' } });
}
