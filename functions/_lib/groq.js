// Groq (OpenAI-compatible) provider. Same input as the Gemini provider: Gemini-style content
// parts ({ text } / { inlineData }), converted to chat messages. Returns { spec, model } or { error }.
import { RULES } from './gemini.js';
import { sanitizeSpec } from '../../public/js/voxelize.js';

// Groq models don't all support full JSON-schema output, so the shape is spelled out in the prompt
// and JSON mode guarantees parseable output.
const FORMAT = `
OUTPUT: reply with ONE compact JSON object (no markdown, no comments, no extra whitespace) exactly like:
{"analysis":{"proportions":"...","masses":["..."],"details":["..."],"fixes":["..."]},
 "subjectBox":[ymin,xmin,ymax,xmax],"outline":[{"x":0,"y":0},...],
 "title":"...","subject":"...","description":"...",
 "primitives":[{"name":"head","shape":"sphere","op":"add","color":"RED","x":0,"y":0,"z":0,"w":10,"d":10,"h":25,"taper":1,"axis":"y"},...]}
shape is one of box|cylinder|sphere|dome|roof; op is add|subtract|paint; color must be one of the colour keys above.
Keep analysis short. Spend your output on primitives.`;

export async function designWithGroq(env, parts, refining) {
  const models = (env.GROQ_MODELS || env.GROQ_MODEL || 'qwen/qwen3.8-27b').split(',').map(m => m.trim()).filter(Boolean);
  const content = parts.map(p => p.inlineData
    ? { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }
    : { type: 'text', text: p.text });
  let lastErr = '';
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try {
        r = await fetch(`${env.GROQ_API_BASE || 'https://api.groq.com'}/openai/v1/chat/completions`, {
          method: 'POST',
          signal: AbortSignal.timeout(Number(env.GROQ_TIMEOUT_MS || 120000)),
          headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY}` },
          body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: RULES + FORMAT }, { role: 'user', content }],
            response_format: { type: 'json_object' },
            temperature: refining ? 0.3 : 0.5,
            max_completion_tokens: Number(env.GROQ_MAX_TOKENS || 16384),
          }),
        });
      } catch (e) {
        lastErr = `groq ${model}: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`;
        console.warn(lastErr); break;
      }
      if (!r.ok) {
        const t = await r.text();
        lastErr = `groq ${model} HTTP ${r.status}: ${t.slice(0, 200)}`;
        console.warn(lastErr);
        if (r.status === 429 || r.status >= 500) {
          // Groq says how long to wait; honour short waits, otherwise move on
          const wait = Number(r.headers.get('retry-after')) || 2;
          if (wait <= 8) { await new Promise(res => setTimeout(res, wait * 1000)); continue; }
        }
        break;
      }
      const out = await r.json();
      const choice = out.choices?.[0];
      try {
        const s = sanitizeSpec(JSON.parse(choice?.message?.content || ''));
        if (s.primitives.some(p => p.op === 'add')) return { spec: s, model: `groq:${model}` };
        lastErr = `groq ${model}: empty design`;
      } catch { lastErr = `groq ${model}: unparseable design (finish ${choice?.finish_reason})`; }
      console.warn(lastErr);
    }
  }
  return { error: lastErr };
}
