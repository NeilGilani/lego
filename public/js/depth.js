// Depth Anything V2 Small (Apache-2.0), run in the visitor's browser with transformers.js.
// The model (~27 MB, 8-bit) downloads once and is cached by the browser; no server or API key involved.
const TF = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
const MODEL = 'onnx-community/depth-anything-v2-small';

let estP = null;
const listeners = new Set();
export function loadDepth(onProgress) {
  if (onProgress) listeners.add(onProgress);
  estP ||= (async () => {
    const { pipeline } = await import(TF);
    const files = new Map();
    const progress_callback = e => {
      if (e.status === 'progress' && e.total) files.set(e.file, [e.loaded, e.total]);
      let l = 0, t = 0; for (const [a, b] of files.values()) { l += a; t += b; }
      if (t) listeners.forEach(f => f(l / t, t));
    };
    return pipeline('depth-estimation', MODEL, { dtype: 'q8', device: 'wasm', progress_callback });
  })();
  estP.catch(() => { estP = null; });
  return estP;
}

// -> { w, h, data } with 0..255, higher = closer
export async function estimateDepth(blob, onProgress) {
  const est = await loadDepth(onProgress);
  listeners.clear();
  const { RawImage } = await import(TF);
  const out = await est(await RawImage.fromBlob(blob));
  return { w: out.depth.width, h: out.depth.height, data: out.depth.data };
}

// ORMBG (Apache-2.0, ~44 MB 8-bit): finds the main subject whatever its distance, so foreground clutter
// (trees, people, tables) doesn't get built. Also downloads once and is cached.
const SEG_MODEL = 'onnx-community/ormbg-ONNX';
let segP = null;
const segListeners = new Set();
export function loadSegmenter(onProgress) {
  if (onProgress) segListeners.add(onProgress);
  segP ||= (async () => {
    const { pipeline } = await import(TF);
    const files = new Map();
    const progress_callback = e => {
      if (e.status === 'progress' && e.total) files.set(e.file, [e.loaded, e.total]);
      let l = 0, t = 0; for (const [a, b] of files.values()) { l += a; t += b; }
      if (t) segListeners.forEach(f => f(l / t, t));
    };
    return pipeline('background-removal', SEG_MODEL, { dtype: 'q8', device: 'wasm', progress_callback });
  })();
  segP.catch(() => { segP = null; });
  return segP;
}

// -> { w, h, data } subject confidence 0..255, or null if the model couldn't run (the depth cut-out is used instead)
export async function estimateMask(blob, onProgress) {
  try {
    const seg = await loadSegmenter(onProgress);
    segListeners.clear();
    const { RawImage } = await import(TF);
    let o = await seg(await RawImage.fromBlob(blob));
    if (Array.isArray(o)) o = o[0];
    const alpha = new Uint8Array(o.width * o.height);
    for (let k = 0; k < alpha.length; k++) alpha[k] = o.data[k * o.channels + o.channels - 1];
    return { w: o.width, h: o.height, data: alpha };
  } catch (e) { console.warn('segmentation unavailable:', e); globalThis.__segError = String(e?.message || e); return null; }
}
