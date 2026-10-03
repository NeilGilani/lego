// POST /api/name { image: small base64 JPEG } -> { title, subject, description }
// Optional nicety: a few dozen output tokens, so it fits free tiers. Never fails the build.
import { providerOrder } from '../_lib/ai.js';

const PROMPT = 'Name this photo\'s main subject for a brick-model instruction book. Reply with JSON only: ' +
  '{"title": "2-4 word model name", "subject": "what it is, a few words", "description": "one friendly sentence about the model"}';
const fallback = { title: 'My build', subject: '', description: '' };

export async function onRequestPost({ request, env }) {
  let image;
  try { ({ image } = await request.json()); } catch { return Response.json(fallback); }
  if (typeof image !== 'string' || image.length > 400_000) return Response.json(fallback);
  for (const p of providerOrder(env)) {
    try {
      const text = p === 'groq' ? await groq(env, image) : await gemini(env, image);
      const j = JSON.parse(text);
      return Response.json({ title: String(j.title || fallback.title).slice(0, 60), subject: String(j.subject || '').slice(0, 80), description: String(j.description || '').slice(0, 300) });
    } catch (e) { console.warn('name via', p, 'failed:', e.message); }
  }
  return Response.json(fallback);
}

async function groq(env, image) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: (env.GROQ_MODELS || 'qwen/qwen3.8-27b').split(',')[0].trim(), response_format: { type: 'json_object' }, max_completion_tokens: 200, temperature: 0.2,
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } }] }] }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).choices[0].message.content;
}

async function gemini(env, image) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_NAME_MODEL || 'gemini-flash-lite-latest'}:generateContent`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: image } }, { text: PROMPT }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 300, temperature: 0.2 } }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).candidates[0].content.parts.map(p => p.text || '').join('');
}
