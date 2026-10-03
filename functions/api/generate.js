// POST /api/generate  { image: base64, mimeType, imagePath }
// Verifies the Supabase session, asks Gemini to design the model as primitives,
// validates the result, and saves it to the user's builds.
import { sanitizeSpec, SHAPES, LIMITS } from '../../public/js/voxelize.js';
import { COLORS } from '../../public/js/palette.js';

const json = (body, status = 200) => Response.json(body, { status });

const COLOR_GUIDE = Object.entries(COLORS).map(([k, c]) => `${k} (${c.name})`).join(', ');

const PROMPT = `You are a master brick-model designer. Look at the photo, identify its main subject, and design a
buildable brick model of it as a list of 3D primitives. A program voxelizes your primitives into 1x1 studs and
plates and packs them into real parts, so you only describe shapes, sizes and colours.

UNITS (important):
- x and z are horizontal, in STUDS (1 stud = 8 mm). The model's centre line is x=0, z=0. x = left/right as seen
  in the photo, z = depth (front is negative z).
- y is vertical, in PLATES (1 plate = 3.2 mm). y=0 is the ground. A primitive's y is its BOTTOM.
- 1 stud of width equals 2.5 plates of height. A cube 4 studs wide is w=4, d=4, h=10. A ball 10 studs across is
  shape "sphere", w=10, d=10, h=25.
- Keep the whole model within ${LIMITS.maxFootprint - 6} studs across and ${LIMITS.maxHeight - 20} plates tall. Small objects
  (a mug, a shoe) should be about 12-20 studs across. Big subjects (buildings, vehicles, animals) can be 24-40 studs.

SHAPES:
- "box": w (x size), d (z size), h. Optional taper (0..1): top size as a fraction of the bottom (1 = straight,
  0 = pyramid). Use it for frustums.
- "cylinder": upright by default (axis "y"). w and d are the diameters and h is the height. taper 0 gives a cone.
  axis "x" or "z" lays it on its side, running along w or d, with h as its vertical diameter (wheels, logs, barrels).
- "sphere": an ellipsoid filling its w x d x h box (heads, bodies, round shapes).
- "dome": the top half of an ellipsoid, flat side down at y, rising h (roofs, domes, backs).
- "roof": a triangular prism with its ridge running along z, full width w at the bottom and a point at the top
  (gable roofs, wedges, ears).
- op "subtract" carves space out of earlier primitives (windows, doorways, arches, the inside of a mug). Later
  primitives overwrite earlier ones, so add details after the bodies they sit on.

COLOURS: use only these keys: ${COLOR_GUIDE}. Match the subject's real colours as closely as you can.

RULES:
- Every primitive must touch or overlap another one, and the model must rest on the ground at y=0. Floating
  parts get ugly support columns.
- Capture the overall silhouette and proportions first, then add recognisable details: eyes, windows, wheels,
  stripes, logos as colour blocks. Use 12-80 primitives.
- Overlap pieces by 1-2 studs or plates so they join solidly.
- Don't add a base or ground plate; a baseplate is supplied.
- Give each primitive a short, human name (for example "head", "left wheel", "roof"). The names become section
  titles in the instructions.
- title: a short name for the model (for example "Golden Retriever"). subject: what the photo shows, in a few
  words. description: one or two friendly sentences about the model and its key features.
If the photo has no clear subject, model the most prominent object in it.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    subject: { type: 'STRING' },
    description: { type: 'STRING' },
    primitives: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          shape: { type: 'STRING', enum: SHAPES },
          op: { type: 'STRING', enum: ['add', 'subtract'] },
          color: { type: 'STRING', enum: Object.keys(COLORS) },
          x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, z: { type: 'NUMBER' },
          w: { type: 'NUMBER' }, d: { type: 'NUMBER' }, h: { type: 'NUMBER' },
          taper: { type: 'NUMBER' },
          axis: { type: 'STRING', enum: ['x', 'y', 'z'] },
        },
        required: ['name', 'shape', 'op', 'color', 'x', 'y', 'z', 'w', 'd', 'h'],
      },
    },
  },
  required: ['title', 'subject', 'description', 'primitives'],
};

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: 'The server is missing its configuration.' }, 500);

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

  // 3. the photo
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const { image, mimeType = 'image/jpeg', imagePath = null } = body || {};
  if (typeof image !== 'string' || image.length < 100) return json({ error: 'No image received.' }, 400);
  if (image.length > 8_000_000) return json({ error: 'That image is too large.' }, 413);
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(mimeType)) return json({ error: 'Unsupported image type.' }, 415);
  if (imagePath && !String(imagePath).startsWith(user.id + '/')) return json({ error: 'Bad image path.' }, 400);

  // 4. design it
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  let spec = null, lastErr = '';
  for (let attempt = 0; attempt < 2 && !spec; attempt++) {
    const r = await fetch(`${env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com'}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: image } }, { text: 'Design the brick model for this photo.' }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.4 },
      }),
    });
    if (!r.ok) { lastErr = `Gemini error ${r.status}: ${(await r.text()).slice(0, 300)}`; if (r.status === 429 || r.status >= 500) continue; break; }
    const out = await r.json();
    const text = out?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    try {
      const s = sanitizeSpec(JSON.parse(text));
      if (s.primitives.some(p => p.op === 'add')) spec = s; else lastErr = 'The design came back empty.';
    } catch { lastErr = 'The design couldn’t be read.'; }
  }
  if (!spec) { console.error(lastErr); return json({ error: 'The AI couldn’t design a model from that photo. Try another photo, or try again.' }, 502); }

  // 5. save (row-level security makes sure it lands in this user's account)
  const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/builds`, {
    method: 'POST',
    headers: { ...sbHeaders, 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify({ user_id: user.id, title: spec.title, subject: spec.subject, description: spec.description, spec, image_path: imagePath, model }),
  });
  if (!ins.ok) { console.error('insert failed', ins.status, await ins.text()); return json({ error: 'Your build couldn’t be saved. Please try again.' }, 500); }
  const [row] = await ins.json();
  return json({ id: row.id });
}
