// Public, non-secret settings for the browser. Secrets (GEMINI_API_KEY) never leave the server.
export function onRequestGet({ env }) {
  let adSlots = {};
  try { adSlots = JSON.parse(env.ADSENSE_SLOTS || '{}'); } catch {}
  return Response.json({
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
    googleAuth: env.GOOGLE_AUTH === 'true',
    adsenseClient: env.ADSENSE_CLIENT || '',
    adSlots,
  }, { headers: { 'cache-control': 'public, max-age=300' } });
}
