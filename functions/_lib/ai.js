// Picks the AI provider(s). AI_PROVIDERS sets the order (e.g. "groq,gemini"); by default any
// provider with a key is used, Groq first. A busy or failing provider falls through to the next.
import { designWithGemini } from './gemini.js';
import { designWithGroq } from './groq.js';

const PROVIDERS = { groq: { key: 'GROQ_API_KEY', run: designWithGroq }, gemini: { key: 'GEMINI_API_KEY', run: designWithGemini } };

export const providerOrder = env => (env.AI_PROVIDERS || 'groq,gemini').split(',').map(p => p.trim()).filter(p => PROVIDERS[p] && env[PROVIDERS[p].key]);

export async function designModel(env, parts, refining) {
  const errors = [];
  for (const name of providerOrder(env)) {
    const r = await PROVIDERS[name].run(env, parts, refining);
    if (r.spec) return r;
    errors.push(r.error);
  }
  return { error: errors.join(' | ') || 'no AI provider configured' };
}
