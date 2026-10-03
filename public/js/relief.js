// Photo -> brick relief sculpture, with no cloud AI.
// Input: the photo's pixels and a depth map (from Depth Anything, run in the browser; see depth.js).
// Output: a compact "relief" spec that voxelize.js turns into bricks. Pure functions, so it also runs in Node.
import { nearestColor, PHOTO_COLORS, cleanupColors } from './palette.js';

const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// depth: { w, h, data } with 0..255, higher = closer. Returns a foreground mask (Uint8Array, w*h).
export function segment(depth) {
  const { w, h, data } = depth, n = w * h;
  // Otsu threshold on the depth histogram: the subject is the near cluster
  const hist = new Float64Array(256); for (let k = 0; k < n; k++) hist[data[k]]++;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let wB = 0, sB = 0, best = 0, T = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; T = t; }
  }
  let mask = new Uint8Array(n); for (let k = 0; k < n; k++) mask[k] = data[k] > T ? 1 : 0;
  // keep the largest connected blob
  const lab = new Int32Array(n), sizes = [0]; let id = 0;
  for (let s = 0; s < n; s++) {
    if (!mask[s] || lab[s]) continue;
    id++; let size = 0; const st = [s]; lab[s] = id;
    while (st.length) {
      const p = st.pop(); size++; const x = p % w, y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
        if (q >= 0 && mask[q] && !lab[q]) { lab[q] = id; st.push(q); }
    }
    sizes.push(size);
  }
  const keep = sizes.indexOf(Math.max(...sizes));
  for (let k = 0; k < n; k++) mask[k] = lab[k] === keep ? 1 : 0;
  // fill holes: anything not reachable from the border through background is subject
  const seen = new Uint8Array(n), st = [];
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const p = y * w + x; if (!mask[p] && !seen[p]) { seen[p] = 1; st.push(p); } }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const p = y * w + x; if (!mask[p] && !seen[p]) { seen[p] = 1; st.push(p); } }
  while (st.length) {
    const p = st.pop(), x = p % w, y = (p - x) / w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
      if (q >= 0 && !mask[q] && !seen[q]) { seen[q] = 1; st.push(q); }
  }
  for (let k = 0; k < n; k++) if (!mask[k] && !seen[k]) mask[k] = 1;
  return mask;
}

// photo: { data (RGBA), width, height }; depth as above (any resolution).
// opts.width: model width in studs (default 36); opts.relief: depth strength (default 1).
export function buildRelief(photo, depth, opts = {}) {
  const mask = segment(depth);
  const dw = depth.w, dh = depth.h, PW = photo.width, PH = photo.height;
  let bx0 = dw, bx1 = -1, by0 = dh, by1 = -1;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) if (mask[y * dw + x]) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  if (bx1 < 0) throw new Error('Couldn’t find a subject in that photo.');
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  // size: 1 stud wide = 2.5 plates tall
  let Wm = Math.round(opts.width || 36), H = Math.round(bh / bw * Wm * 2.5);
  if (H > 170) { Wm = Math.max(10, Math.floor(170 / (bh / bw * 2.5))); H = Math.round(bh / bw * Wm * 2.5); }
  H = Math.max(6, H);

  const cells = Wm * H, filled = new Uint8Array(cells), dep = new Float32Array(cells), idx = new Int8Array(cells).fill(-1);
  const S = 4; // 4x4 samples per cell
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < Wm; cx++) {
    let cov = 0, ds = 0, r = 0, g = 0, b = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const fx = bx0 + (cx + (sx + 0.5) / S) / Wm * bw, fy = by1 + 1 - (cy + (sy + 0.5) / S) / H * bh;   // photo y runs down
      const dx = Math.min(dw - 1, fx | 0), dy = Math.min(dh - 1, Math.max(0, fy | 0)), m = dy * dw + dx;
      if (!mask[m]) continue;
      cov++; ds += depth.data[m];
      const px = Math.min(PW - 1, (fx / dw * PW) | 0), py = Math.min(PH - 1, Math.max(0, (fy / dh * PH) | 0)), o = (py * PW + px) * 4;
      r += photo.data[o]; g += photo.data[o + 1]; b += photo.data[o + 2];
    }
    const k = cy * Wm + cx;
    if (cov < S * S * 0.45) continue;
    filled[k] = 1; dep[k] = ds / cov; idx[k] = nearestColor(r / cov, g / cov, b / cov);
  }
  cleanupColors(idx, Wm, H);

  // depth -> 0..1 inside the subject (robust percentiles)
  const vals = []; for (let k = 0; k < cells; k++) if (filled[k]) vals.push(dep[k]);
  if (!vals.length) throw new Error('The subject is too small in that photo.');
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.05)], hi = vals[Math.floor(vals.length * 0.98)] || lo + 1;

  // distance to the silhouette edge, in studs (a plate is 0.4 studs tall)
  const dist = new Float32Array(cells).fill(1e9);
  for (let k = 0; k < cells; k++) if (!filled[k]) dist[k] = 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= Wm || y >= H) ? 0 : dist[y * Wm + x];
  const steps = [[-1, 0, 1], [0, -1, 0.4], [-1, -1, 1.08], [1, -1, 1.08]];
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < Wm; xx++) {
      const x = fwd ? xx : Wm - 1 - xx, y = fwd ? yy : H - 1 - yy, k = y * Wm + x;
      if (!filled[k]) continue;
      let d = dist[k];
      for (const [ax, ay, c] of steps) { const sx2 = fwd ? ax : -ax, sy2 = fwd ? ay : -ay; d = Math.min(d, at(x + sx2, y + sy2) + c); }
      dist[k] = d;
    }
  }

  const strength = opts.relief ?? 1;
  const Dmax = Math.min(60, Math.max(3, Math.round(Wm * 0.34 * strength))), R = Math.max(2, Wm * 0.22);
  let front = '', back = '', color = '';
  for (let k = 0; k < cells; k++) {
    if (!filled[k]) { front += '.'; back += '.'; color += '.'; continue; }
    const dn = Math.min(1, Math.max(0, (dep[k] - lo) / (hi - lo))), pillow = Math.sqrt(Math.min(1, dist[k] / R));
    const f = Math.max(1, Math.round(Dmax * (0.12 + 0.58 * dn + 0.30 * pillow)));
    const bk = Math.max(1, Math.round(Dmax * 0.5 * (0.35 + 0.65 * pillow)));
    front += ALPHA[Math.min(61, f)]; back += ALPHA[Math.min(61, bk)]; color += idx[k] >= 0 ? ALPHA[idx[k]] : '.';
  }
  return { kind: 'relief', w: Wm, h: H, front, back, color };
}

// relief spec -> per-cell columns, for voxelize.js
export function decodeRelief(r) {
  const val = c => (c === '.' ? -1 : ALPHA.indexOf(c));
  return { w: r.w, h: r.h, front: k => val(r.front[k]), back: k => val(r.back[k]), color: k => (r.color[k] === '.' ? null : PHOTO_COLORS[val(r.color[k])]) };
}
