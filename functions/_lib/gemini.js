// Gemini prompt, response schema, and the call with retries + model fallback.
import { SHAPES, LIMITS, sanitizeSpec } from '../../public/js/voxelize.js';
import { COLORS } from '../../public/js/palette.js';

const COLOR_GUIDE = Object.entries(COLORS).map(([k, c]) => `${k} (${c.name}${c.trans ? ', transparent' : ''})`).join(', ');

export const RULES = `You design brick models that a program turns into real parts. You describe 3D primitives; the program
voxelizes them into a 1-stud x 1-plate grid, then builds them from bricks, plates, 45° slopes, tiles and round
tiles. Stepped 45° surfaces automatically become slopes, so roofs, snouts, shoulders and tapers look smooth.

UNITS (critical):
- x and z are horizontal, in STUDS (1 stud = 8 mm). The model's centre line is x=0, z=0.
  +x = to the RIGHT as seen in the photo. z = depth; the side facing the camera in the photo is POSITIVE z.
- y is vertical, in PLATES (1 plate = 3.2 mm). y=0 is the ground. A primitive's y is its BOTTOM.
- 1 stud of width = 2.5 plates of height. A cube 4 studs wide is w=4, d=4, h=10. A ball 10 studs across is
  sphere w=10, d=10, h=25. Get this right or everything looks squashed or stretched.
- Bigger models hold more detail. Use most of the ${LIMITS.maxFootprint - 4}-stud footprint and up to ${LIMITS.maxHeight - 10} plates of height:
  about 24-30 studs across for small objects, 32-42 for animals, vehicles and buildings.

SHAPES:
- "box": w (x size), d (z size), h. taper 0..1 shrinks the top (1 = straight, 0 = pyramid).
- "cylinder": upright (axis "y"); w and d are diameters; taper 0 gives a cone. axis "x" or "z" lays it on its
  side along w or d, with h as its vertical diameter (wheels, logs, tubes, limbs).
- "sphere": an ellipsoid filling w x d x h (heads, bodies, rounded masses).
- "dome": the top half of an ellipsoid, flat side down at y (roofs, domes, backs, caps).
- "roof": a triangular prism, ridge along z, width w at the base, point at the top (gables, ears, wedges, fins).

OPS:
- "add" fills space. Later primitives overwrite earlier ones.
- "subtract" carves space out: windows, doors, arches, mouths, the inside of a cup, gaps between legs.
- "paint" only recolours blocks that already exist inside its volume and never adds material. Use it for
  surface details: eyes, pupils, noses, stripes, spots, logos, lettering blocks, window frames, headlights,
  trim, seams, panel lines. Make paint volumes 1-2 studs deep and push them slightly into the surface so they
  catch the outer layer. Paint is how you get fine detail at 1-stud resolution.

COLOURS: use only these keys: ${COLOR_GUIDE}.

FRAMING — model exactly what the photo shows:
- If the photo is a close-up of a head or face, build a bust (head plus a little neck or shoulders) standing on
  the ground, not the whole creature. If it shows the full object, build the full object. Don't invent parts
  that are out of frame.
- The FRONT of the model (+z) must match the photo's viewpoint. Seen from +z, its silhouette should match the
  subject's silhouette in the photo: same outline, same proportions, same placement of features.
- subjectBox: the tight box around exactly the part of the subject you modelled, as [ymin, xmin, ymax, xmax]
  normalised to 0-1000 in the photo. outline: 12-60 points {x, y} (0-1000) tracing that subject's silhouette
  clockwise. After building, the program paints the model's front with the photo's real colours by matching
  your front silhouette to this box, so the front-view shape and proportions must line up with it.

HOW TO GET IT RIGHT:
1. In "analysis", measure the photo first: the overall bounding box ratio (width : depth : height), the 3-8
   major masses with their sizes as fractions of the whole, and every distinctive detail a person would use to
   recognise the subject (at least 8 for a detailed subject), each with its colour.
2. Block in the major masses with true proportions. Overlap neighbouring masses by 1-2 units so they join.
3. Carve with subtract (leg gaps, windows, openings).
4. Add raised details (ears, mirrors, handles, chimneys, tails, bumpers).
5. Paint the surface details last.
Use 40-180 primitives; more for detailed subjects. Prefer many accurate small primitives to a few crude ones.
Everything must connect, and the model must rest on y=0. Don't model a base or ground; a baseplate is supplied.
Give each primitive a short human name ("left ear", "windshield"); the names become instruction section titles.
title: a short model name. subject: what the photo shows. description: 1-2 friendly sentences about the model.`;

export const SCHEMA = {
  type: 'OBJECT',
  propertyOrdering: ['analysis', 'subjectBox', 'outline', 'title', 'subject', 'description', 'primitives'],
  properties: {
    analysis: {
      type: 'OBJECT',
      propertyOrdering: ['proportions', 'masses', 'details', 'fixes'],
      properties: {
        proportions: { type: 'STRING' },
        masses: { type: 'ARRAY', items: { type: 'STRING' } },
        details: { type: 'ARRAY', items: { type: 'STRING' } },
        fixes: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['proportions', 'masses', 'details'],
    },
    subjectBox: { type: 'ARRAY', items: { type: 'NUMBER' } },
    outline: { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } }, required: ['x', 'y'] } },
    title: { type: 'STRING' },
    subject: { type: 'STRING' },
    description: { type: 'STRING' },
    primitives: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        propertyOrdering: ['name', 'shape', 'op', 'color', 'x', 'y', 'z', 'w', 'd', 'h', 'taper', 'axis'],
        properties: {
          name: { type: 'STRING' },
          shape: { type: 'STRING', enum: SHAPES },
          op: { type: 'STRING', enum: ['add', 'subtract', 'paint'] },
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
  required: ['analysis', 'subjectBox', 'outline', 'title', 'subject', 'description', 'primitives'],
};


// parts: Gemini content parts. Returns { spec, model } or { error }.
export async function designWithGemini(env, parts, refining) {
  let lastErr = '';
  // busy or over-quota models fall through to the next one in the chain
  const fallbacks = (env.GEMINI_FALLBACK_MODELS || 'gemini-3.5-flash,gemini-flash-latest,gemini-3-flash-preview').split(',').map(m => m.trim()).filter(Boolean);
  const models = [...new Set([env.GEMINI_MODEL || 'gemini-3.8-flash', ...fallbacks])];
  for (const model of models) {
    let thinking = true;
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try {
        r = await fetch(`${env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com'}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(Number(env.GEMINI_TIMEOUT_MS || 150000)),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: RULES }] },
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: refining ? 0.3 : 0.5,
            maxOutputTokens: 65536, ...(thinking ? { thinkingConfig: { thinkingLevel: 'high' } } : {}) },
        }),
      });
      } catch (e) {   // timeout or dropped connection: move on to the next model
        lastErr = `${model}: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`;
        console.warn(lastErr);
        break;
      }
      if (!r.ok) {
        const t = await r.text();
        lastErr = `${model} HTTP ${r.status}: ${t.slice(0, 200)}`;
        console.warn(lastErr);
        if (r.status === 400 && /thinking/i.test(t) && thinking) { thinking = false; continue; }
        if (r.status === 429 && /quota/i.test(t)) break;   // quota won't recover in seconds: next model
        if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 2500 * (attempt + 1))); continue; }
        break;   // e.g. model unavailable: try the fallback
      }
      const out = await r.json();
      const cand = out?.candidates?.[0];
      const text = cand?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('') || '';
      try {
        const s = sanitizeSpec(JSON.parse(text));
        if (s.primitives.some(p => p.op === 'add')) return { spec: s, model };
        lastErr = `${model}: empty design`;
      } catch { lastErr = `${model}: unparseable design (finish ${cand?.finishReason}, ${text.length} chars)`; }
      console.warn(lastErr);
    }
  }
  return { error: lastErr };
}
