// Photo -> brick relief sculpture, with no cloud AI.
// Input: the photo's pixels and a depth map (from Depth Anything, run in the browser; see depth.js).
// Output: a compact "relief" spec that voxelize.js turns into bricks. Pure functions, so it also runs in Node.
import { nearestColor, PHOTO_COLORS, cleanupColors } from './palette.js';

const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
// bricks read darker than a lit photo, so brighten midtones a little before matching colours
const lift = v => 255 * (v / 255) ** 0.92;

// map: { w, h, data } with 0..255, higher = more "subject" (closer depth, or segmentation confidence).
// Returns a foreground mask (Uint8Array, w*h). keepFrac keeps extra blobs at least this fraction of the largest.
export function segment(map, { maxT = 255, keepFrac = 0 } = {}) {
  const { w, h, data } = map, n = w * h;
  // Otsu threshold on the depth histogram: the subject is the near cluster
  const hist = new Float64Array(256); for (let k = 0; k < n; k++) hist[data[k]]++;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let wB = 0, sB = 0, best = 0, T = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; T = t; }
  }
  T = Math.min(T, maxT);
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
  const biggest = Math.max(...sizes), keepIds = new Set(sizes.map((sz, i) => (sz === biggest || (keepFrac && sz >= biggest * keepFrac)) && i ? i : -1));
  for (let k = 0; k < n; k++) mask[k] = keepIds.has(lab[k]) ? 1 : 0;
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
// opts.alpha: subject-segmentation confidence { w, h, data 0..255 } (ORMBG). When it finds a sensible subject it
// decides what to build; depth then only shapes it. Without it, the nearest blob in the depth map is used.
export function buildRelief(photo, depth, opts = {}) {
  const dw = depth.w, dh = depth.h, PW = photo.width, PH = photo.height;
  let mask = null;
  if (opts.alpha) {
    const a = opts.alpha, rs = new Uint8Array(dw * dh);
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) rs[y * dw + x] = a.data[Math.min(a.h - 1, (y / dh * a.h) | 0) * a.w + Math.min(a.w - 1, (x / dw * a.w) | 0)];
    // use depth to settle uncertain pixels: ones at the subject's own distance join it (plinths, bases);
    // ones much nearer than the subject are foreground clutter (trees, people, railings)
    const sure = []; for (let k = 0; k < rs.length; k += 3) if (rs[k] >= 170) sure.push(depth.data[k]);
    if (sure.length > 50) {
      sure.sort((x, y) => x - y);
      const med = sure[sure.length >> 1], mad = sure.map(v => Math.abs(v - med)).sort((x, y) => x - y)[sure.length >> 1];
      const tol = Math.max(10, 3 * mad);
      for (let k = 0; k < rs.length; k++) {
        const dd = depth.data[k] - med;
        if (rs[k] >= 35 && Math.abs(dd) <= tol) rs[k] = Math.max(rs[k], 200);
        else if (rs[k] < 170 && dd > tol * 1.5) rs[k] = Math.min(rs[k], 20);
      }
    }
    // soft masks: cap the threshold so faint-but-real parts survive; keep sizeable separate parts
    const m = segment({ w: dw, h: dh, data: rs }, { maxT: 110, keepFrac: 0.04 });
    let cov = 0; for (const v of m) cov += v; cov /= m.length;
    if (cov > 0.01 && cov < 0.95) mask = m;
  }
  mask ||= segment(depth);
  let bx0 = dw, bx1 = -1, by0 = dh, by1 = -1;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) if (mask[y * dw + x]) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  if (bx1 < 0) throw new Error('Couldn’t find a subject in that photo.');
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  // size: 1 stud wide = 2.5 plates tall
  let Wm = Math.round(opts.width || 36), H = Math.round(bh / bw * Wm * 2.5);
  if (H > 170) { Wm = Math.max(10, Math.floor(170 / (bh / bw * 2.5))); H = Math.round(bh / bw * Wm * 2.5); }
  H = Math.max(6, H);

  const cells = Wm * H, filled = new Uint8Array(cells), dep = new Float32Array(cells), idx = new Int8Array(cells).fill(-1);
  const R0 = new Float32Array(cells), G0 = new Float32Array(cells), B0 = new Float32Array(cells);
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
    filled[k] = 1; dep[k] = ds / cov; R0[k] = r / cov; G0[k] = g / cov; B0[k] = b / cov;
  }
  // even out broad lighting (shadowed sides, gradients) while keeping local detail, so a white wall in
  // shade still reads as white: gain each cell toward the subject's average brightness
  const Y = new Float32Array(cells); let mean = 0, nF = 0;
  for (let k = 0; k < cells; k++) if (filled[k]) { Y[k] = 0.299 * R0[k] + 0.587 * G0[k] + 0.114 * B0[k]; mean += Y[k]; nF++; }
  mean /= Math.max(1, nF);
  const rad = Math.max(3, Math.round(Wm / 6)), radZ = Math.round(rad * 2.5);
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < Wm; cx++) {
    const k = cy * Wm + cx; if (!filled[k]) continue;
    let sy = 0, n2 = 0;
    for (let yy = Math.max(0, cy - radZ); yy <= Math.min(H - 1, cy + radZ); yy += 2) for (let xx = Math.max(0, cx - rad); xx <= Math.min(Wm - 1, cx + rad); xx++) {
      const q = yy * Wm + xx; if (filled[q]) { sy += Y[q]; n2++; }
    }
    const broad = sy / n2, gain = Math.min(1.4, Math.max(0.8, (0.55 * mean + 0.45 * broad) / Math.max(8, broad)));
    idx[k] = nearestColor(lift(R0[k] * gain), lift(G0[k] * gain), lift(B0[k] * gain));
  }
  cleanupColors(idx, Wm, H, 8);

  // depth -> 0..1 inside the subject (robust percentiles)
  const vals = []; for (let k = 0; k < cells; k++) if (filled[k]) vals.push(dep[k]);
  if (!vals.length) throw new Error('The subject is too small in that photo.');
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.05)], hi = Math.max(lo + 1, vals[Math.floor(vals.length * 0.98)]);
  // how much real depth the subject has: near objects (pets, products) vary a lot; distant buildings barely do,
  // and for those the front should stay flat-ish instead of bulging
  const relief3d = Math.min(1, Math.max(0, (hi - lo - 8) / 40));

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
    const cap = 1 + dist[k] * 1.6;   // narrow parts (poles, legs, minarets) stay roughly round, not slabs
    const f = Math.max(1, Math.round(Math.min(cap, Dmax * (0.12 + (0.25 + 0.33 * relief3d) * dn + (0.08 + 0.22 * relief3d) * pillow + 0.2 * (1 - relief3d)))));
    const bk = Math.max(1, Math.round(Math.min(cap, Dmax * 0.5 * (0.35 + 0.65 * pillow))));
    front += ALPHA[Math.min(61, f)]; back += ALPHA[Math.min(61, bk)]; color += idx[k] >= 0 ? ALPHA[idx[k]] : '.';
  }
  return { kind: 'relief', w: Wm, h: H, front, back, color };
}

// relief spec -> per-cell columns, for voxelize.js
export function decodeRelief(r) {
  const val = c => (c === '.' ? -1 : ALPHA.indexOf(c));
  return { w: r.w, h: r.h, front: k => val(r.front[k]), back: k => val(r.back[k]), color: k => (r.color[k] === '.' ? null : PHOTO_COLORS[val(r.color[k])]) };
}
