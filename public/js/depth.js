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
