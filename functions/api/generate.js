// POST /api/generate
//   { image, mimeType, imagePath?, save? }                 -> first design from the photo
//   { image, mimeType, previous, views: [b64...], save? }  -> refine a design against renders of it
// Verifies the Supabase session, asks Gemini to design the model as primitives, validates
// the result, and (when save is true and the user is signed in) saves it to their builds.
import { sanitizeSpec } from '../../public/js/voxelize.js';
import { designModel, providerOrder } from '../_lib/ai.js';
import { skipAuth } from './config.js';

const json = (body, status = 200) => Response.json(body, { status });
export async function onRequestPost({ request, env }) {
  const testMode = skipAuth(env, request);
  if (!providerOrder(env).length || (!testMode && (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY))) return json({ error: 'The server is missing its configuration.' }, 500);
  if (testMode) return design(request, env, null);

  // 1. who is this?
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer \S+$/.test(auth)) return json({ error: 'Please sign in first.' }, 401);
  const sbHeaders = { apikey: env.SUPABASE_ANON_KEY, authorization: auth };
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: sbHeaders });
  if (!who.ok) return json({ error: 'Your session has expired. Please sign in again.' }, 401);
  const user = await who.json();

  // 2. builds are unlimited; this only stops runaway scripts from burning the API key
  const perHour = Number(env.BUILDS_PER_HOUR || 60);
  const since = new Date(Date.now() - 3600e3).toISOString();
  const recent = await fetch(`${env.SUPABASE_URL}/rest/v1/builds?select=id&user_id=eq.${user.id}&created_at=gte.${since}`,
    { headers: { ...sbHeaders, prefer: 'count=exact', range: '0-0' } });
  const count = Number((recent.headers.get('content-range') || '').split('/')[1] || 0);
  if (count >= perHour) return json({ error: `You've made ${count} builds in the last hour. Take a breather and try again in a few minutes.` }, 429);
  return design(request, env, { user, sbHeaders });
}

// local test mode passes ctx = null: no account, nothing saved, the spec is returned directly
async function design(request, env, ctx) {
  const user = ctx?.user;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const { image, mimeType = 'image/jpeg', imagePath = null, previous = null, views = null, save = true } = body || {};
  if (typeof image !== 'string' || image.length < 100) return json({ error: 'No image received.' }, 400);
  if (image.length > 8_000_000) return json({ error: 'That image is too large.' }, 413);
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(mimeType)) return json({ error: 'Unsupported image type.' }, 415);
  if (ctx && imagePath && !String(imagePath).startsWith(user.id + '/')) return json({ error: 'Bad image path.' }, 400);
  const refining = previous && Array.isArray(views) && views.length;
  if (refining && (views.length > 4 || views.some(v => typeof v !== 'string' || v.length > 3_000_000))) return json({ error: 'Bad renders.' }, 400);

  const parts = refining ? [
    { text: 'ORIGINAL PHOTO:' }, { inlineData: { mimeType, data: image } },
    { text: 'RENDERS OF YOUR CURRENT BRICK MODEL: front view (camera at positive z, same viewpoint as the photo), right side view (camera at positive x), and a 3/4 view from the front left:' },
    ...views.map(v => ({ inlineData: { mimeType: 'image/jpeg', data: v } })),
    { text: `YOUR CURRENT DESIGN:\n${JSON.stringify({ subjectBox: previous.subjectBox, outline: previous.outline, title: previous.title, subject: previous.subject, description: previous.description, primitives: previous.primitives })}\n\n` +
      'Compare the renders with the photo the way a demanding art director would. In analysis.fixes, list every ' +
      'difference: wrong proportions or silhouette, misplaced or missing parts, wrong colours, missing details, ' +
      'parts that look squashed or stretched (remember 1 stud = 2.5 plates), and orientation mistakes. Then return the ' +
      'COMPLETE improved design (all primitives, not just the changes), with every fix applied and more detail where ' +
      'the model is plain. The renders already show the photo-projected front colours, so judge shape and silhouette ' +
      'above all: the front view must line up with the photo. Keep what is already right.' },
  ] : [
    { inlineData: { mimeType, data: image } },
    { text: 'Design a detailed, recognisable brick model of the main subject of this photo.' },
  ];

  // a previous design with no renders = just save it (the browser couldn't render views)
  const saveOnly = previous && !refining;
  let spec = null, used = '', lastErr = '';
  if (!saveOnly) ({ spec, model: used, error: lastErr } = await designModel(env, parts, refining));
  if (!spec && !saveOnly) {
    console.error(lastErr);
    if (!refining) return json({ error: 'The AI couldn’t design a model from that photo. It may be busy; try again in a moment.' }, 502);
  }

  if (!spec) { spec = sanitizeSpec(previous); used = 'first draft'; }   // refinement failed: keep the draft
  if (!ctx || !save) return json({ spec, model: used, refined: !!refining && used !== 'first draft' });

  // save (row-level security makes sure it lands in this user's account)
  const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/builds`, {
    method: 'POST',
    headers: { ...ctx.sbHeaders, 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify({ user_id: user.id, title: spec.title, subject: spec.subject, description: spec.description, spec, image_path: imagePath, model: used }),
  });
  if (!ins.ok) { console.error('insert failed', ins.status, await ins.text()); return json({ error: 'Your build couldn’t be saved. Please try again.' }, 500); }
  const [row] = await ins.json();
  return json({ id: row.id, spec });
}
