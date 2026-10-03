// Photo -> brick relief sculpture, with no cloud AI.
// Input: the photo's pixels and a depth map (from Depth Anything, run in the browser; see depth.js).
// Output: a compact "relief" spec that voxelize.js turns into bricks. Pure functions, so it also runs in Node.
import { nearestColor, PHOTO_COLORS, cleanupColors, srgbToLab, labDist } from './palette.js';

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

  const cells = Wm * H, filled = new Uint8Array(cells), dep = new Float32Array(cells);
  let idx;
  const R0 = new Float32Array(cells), G0 = new Float32Array(cells), B0 = new Float32Array(cells);
  const S = 4; // 4x4 samples per cell
  // background colours (sampled around the photo's border): edge pixels that look like these are halo
  // from the cut-out (sky around a minaret, say) and are left out of the cell's colour when possible
  const bgLab = [];
  for (let t = 0; t < 1; t += 1 / 48) for (const [x, y] of [[t * PW, 1], [t * PW, PH - 2], [1, t * PH], [PW - 2, t * PH]]) {
    const o = ((y | 0) * PW + (x | 0)) * 4; bgLab.push(srgbToLab(photo.data[o], photo.data[o + 1], photo.data[o + 2]));
  }
  const isBg = (r, g, b) => { const L = srgbToLab(r, g, b); return bgLab.some(q => labDist(q, L) < 11); };
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < Wm; cx++) {
    let cov = 0, ds = 0, r = 0, g = 0, b = 0, cr = 0, cg = 0, cb = 0, cn = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const fx = bx0 + (cx + (sx + 0.5) / S) / Wm * bw, fy = by1 + 1 - (cy + (sy + 0.5) / S) / H * bh;   // photo y runs down
      const dx = Math.min(dw - 1, fx | 0), dy = Math.min(dh - 1, Math.max(0, fy | 0)), m = dy * dw + dx;
      if (!mask[m]) continue;
      cov++; ds += depth.data[m];
      const px = Math.min(PW - 1, (fx / dw * PW) | 0), py = Math.min(PH - 1, Math.max(0, (fy / dh * PH) | 0)), o = (py * PW + px) * 4;
      const pr = photo.data[o], pg = photo.data[o + 1], pb = photo.data[o + 2];
      r += pr; g += pg; b += pb;
      if (!isBg(pr, pg, pb)) { cr += pr; cg += pg; cb += pb; cn++; }
    }
    const k = cy * Wm + cx;
    if (cov < S * S * 0.45) continue;
    filled[k] = 1; dep[k] = ds / cov;
    if (cn >= 2) { R0[k] = cr / cn; G0[k] = cg / cn; B0[k] = cb / cn; } else { R0[k] = r / cov; G0[k] = g / cov; B0[k] = b / cov; }
  }
  // ---- symmetry: most buildings, and many objects seen head-on, are mirror-symmetric. Parts the
  // cut-out lost on one side (e.g. a minaret hidden by trees) are restored from the other side,
  // and colours are averaged across both sides, which also cleans up noise.
  let sym = null;
  {
    let best = { iou: 0, axis: 0 };
    for (let a2 = Math.round(Wm * 0.5); a2 <= Math.round(Wm * 1.5); a2++) {   // axis = a2 / 2, in cells
      let inter = 0, uni = 0;
      for (let cy = 0; cy < H; cy++) for (let x = 0; x < Wm; x++) {
        const xm = a2 - 1 - x, f1 = filled[cy * Wm + x];
        if (xm < 0 || xm >= Wm) { uni += f1; continue; }   // mirror falls outside: a mismatch, not a free pass
        const f2 = filled[cy * Wm + xm];
        inter += f1 & f2; uni += f1 | f2;
      }
      const iou = uni ? inter / uni : 0;
      if (iou > best.iou) best = { iou, axis: a2 };
    }
    // shape alone isn't enough (a big blob overlaps its own mirror image), so the colours either side must match too
    let dE = 0, pairs = 0;
    if (best.iou >= 0.75) for (let cy = 0; cy < H; cy++) for (let x = 0; x < Wm; x++) {
      const xm = best.axis - 1 - x; if (xm <= x || xm >= Wm) continue;
      const k1 = cy * Wm + x, k2 = cy * Wm + xm; if (!filled[k1] || !filled[k2]) continue;
      // compare hue/saturation mostly: one side in shadow (lightness) is lighting, not asymmetry
      const L1 = srgbToLab(R0[k1], G0[k1], B0[k1]), L2 = srgbToLab(R0[k2], G0[k2], B0[k2]);
      dE += Math.hypot(0.35 * (L1[0] - L2[0]), L1[1] - L2[1], L1[2] - L2[2]); pairs++;
    }
    dE = pairs ? dE / pairs : 99;
    if (globalThis.__symDebug) console.log("  mirror IoU", best.iou.toFixed(3), "colour dE", dE.toFixed(1), "axis", best.axis / 2, "of", Wm);
    if (best.iou >= 0.75 && dE < 16) sym = best;
  }
  let F = filled, D = dep, Rr = R0, Gg = G0, Bb = B0;
  if (sym) {
    // rebuild the grid centred on the mirror axis, wide enough for both halves
    const ax = sym.axis / 2 - 0.5;   // axis in cell coordinates
    let reach = 0; for (let x = 0; x < Wm; x++) for (let cy = 0; cy < H; cy++) if (filled[cy * Wm + x]) reach = Math.max(reach, Math.abs(x - ax));
    const W2 = Math.min(48, Math.ceil(reach + 0.5) * 2 + (sym.axis % 2 ? 1 : 0));
    const off = ax - (W2 - 1) / 2, n2 = W2 * H;
    F = new Uint8Array(n2); D = new Float32Array(n2); Rr = new Float32Array(n2); Gg = new Float32Array(n2); Bb = new Float32Array(n2);
    for (let cy = 0; cy < H; cy++) for (let x = 0; x < W2; x++) {
      const src = [Math.round(x + off), Math.round(2 * ax - (x + off))].filter(v => v >= 0 && v < Wm && filled[cy * Wm + v]);
      if (!src.length) continue;
      const k = cy * W2 + x; F[k] = 1;
      for (const v of src) { const q = cy * Wm + v; D[k] += dep[q] / src.length; Rr[k] += R0[q] / src.length; Gg[k] += G0[q] / src.length; Bb[k] += B0[q] / src.length; }
    }
    Wm = W2;
  }
  const N2 = Wm * H;
  idx = new Int8Array(N2).fill(-1);

  // ---- parts cut off at the bottom (hidden behind something in the photo) reach down to the ground
  {
    const lab = new Int32Array(N2); let id = 0;
    for (let s0 = 0; s0 < N2; s0++) {
      if (!F[s0] || lab[s0]) continue;
      id++; const comp = [], st = [s0]; lab[s0] = id; let grounded = false;
      while (st.length) {
        const p = st.pop(); comp.push(p); const x = p % Wm, y = (p - x) / Wm; if (y === 0) grounded = true;
        for (const q of [x > 0 ? p - 1 : -1, x < Wm - 1 ? p + 1 : -1, y > 0 ? p - Wm : -1, y < H - 1 ? p + Wm : -1]) if (q >= 0 && F[q] && !lab[q]) { lab[q] = id; st.push(q); }
      }
      if (grounded || comp.length < 6) continue;
      const lowest = new Map();   // lowest cell of this part in each column
      for (const p of comp) { const x = p % Wm; if (!lowest.has(x) || p < lowest.get(x)) lowest.set(x, p); }
      for (const [x, p] of lowest) {
        for (let y = Math.floor(p / Wm) - 1; y >= 0 && !F[y * Wm + x]; y--) { const q = y * Wm + x; F[q] = 1; D[q] = D[p]; Rr[q] = Rr[p]; Gg[q] = Gg[p]; Bb[q] = Bb[p]; }
      }
    }
  }

  // ---- symmetric subjects are usually buildings: give them a solid base down to the ground
  if (sym) for (let x = 0; x < Wm; x++) {
    let low = -1; for (let y = 0; y < H && low < 0; y++) if (F[y * Wm + x]) low = y;
    if (low <= 0 || low > H * 0.3) continue;
    const p = low * Wm + x;
    for (let y = 0; y < low; y++) { const q = y * Wm + x; F[q] = 1; D[q] = D[p]; Rr[q] = Rr[p]; Gg[q] = Gg[p]; Bb[q] = Bb[p]; }
  }

  // ---- colours: even out broad lighting (shadowed sides, gradients) while keeping local detail, so a
  // white wall in shade still reads as white; then match to brick colours
  const Y = new Float32Array(N2); let mean = 0, nF = 0;
  for (let k = 0; k < N2; k++) if (F[k]) { Y[k] = 0.299 * Rr[k] + 0.587 * Gg[k] + 0.114 * Bb[k]; mean += Y[k]; nF++; }
  if (!nF) throw new Error('The subject is too small in that photo.');
  mean /= nF;
  const ys = []; for (let k = 0; k < N2; k++) if (F[k]) ys.push(Y[k]); ys.sort((a, b) => a - b);
  const bright = ys[Math.floor(ys.length * 0.75)];   // the subject's lit tone
  const rad = Math.max(3, Math.round(Wm / 6)), radZ = Math.round(rad * 2.5);
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < Wm; cx++) {
    const k = cy * Wm + cx; if (!F[k]) continue;
    let sy = 0, n2 = 0;
    for (let yy = Math.max(0, cy - radZ); yy <= Math.min(H - 1, cy + radZ); yy += 2) for (let xx = Math.max(0, cx - rad); xx <= Math.min(Wm - 1, cx + rad); xx++) {
      const q = yy * Wm + xx; if (F[q]) { sy += Y[q]; n2++; }
    }
    // only lift shadowed areas part-way toward the lit tone; never darken (that turned white marble grey)
    const broad = sy / n2, gain = Math.min(1.5, Math.max(1, (0.5 * bright + 0.5 * broad) / Math.max(8, broad)));
    idx[k] = nearestColor(lift(Rr[k] * gain), lift(Gg[k] * gain), lift(Bb[k] * gain));
  }
  cleanupColors(idx, Wm, H, sym ? 6 : 8);

  // ---- shape: each horizontal slice of the silhouette becomes a solid about as deep as it is wide.
  // Thin slices become slim towers, wide ones deep blocks, a dome's shrinking slices become a dome.
  // The depth map decides the profile: slices that bulge toward the camera are round, flat ones boxy.
  const vals = []; for (let k = 0; k < N2; k++) if (F[k]) vals.push(D[k]);
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.05)], hi = Math.max(lo + 1, vals[Math.floor(vals.length * 0.98)]);
  if (!sym) {
    const r = depthRelief(F, D, idx, Wm, H, lo, hi, opts);
    return { kind: 'relief', w: Wm, h: H, ...r, symmetric: false };
  }
  const depthCap = Math.max(1, Wm * 0.36 * (opts.relief ?? 1));
  const half = new Float32Array(N2);
  for (let cy = 0; cy < H; cy++) {
    let x = 0;
    while (x < Wm) {
      if (!F[cy * Wm + x]) { x++; continue; }
      const a0 = x; while (x < Wm && F[cy * Wm + x]) x++;
      const w = x - a0, mid = a0 + w / 2;
      // bulge test: is the middle third nearer than the outer thirds?
      let cs = 0, cn = 0, es = 0, en = 0;
      for (let xx = a0; xx < x; xx++) { const t = Math.abs(xx + 0.5 - mid) / (w / 2); if (t < 0.34) { cs += D[cy * Wm + xx]; cn++; } else { es += D[cy * Wm + xx]; en++; } }
      const bulge = cn && en ? (cs / cn - es / en) / (hi - lo) : 1;
      const n = w <= 3 || bulge > 0.06 ? 2 : 5;   // 2 = round, 5 = rounded box
      const hd = Math.min(w / 2, depthCap);
      for (let xx = a0; xx < x; xx++) {
        const t = Math.min(0.999, Math.abs(xx + 0.5 - mid) / (w / 2));
        half[cy * Wm + xx] = hd * Math.pow(1 - Math.pow(t, n), 1 / n);
      }
    }
  }
  // light vertical smoothing so slices don't step abruptly
  const sm = new Float32Array(half);
  for (let cy = 1; cy < H - 1; cy++) for (let cx = 0; cx < Wm; cx++) {
    const k = cy * Wm + cx; if (!F[k]) continue;
    const up = F[k + Wm] ? half[k + Wm] : half[k], dn2 = F[k - Wm] ? half[k - Wm] : half[k];
    sm[k] = 0.5 * half[k] + 0.25 * up + 0.25 * dn2;
  }
  let front = '', back = '', color = '';
  for (let k = 0; k < N2; k++) {
    if (!F[k]) { front += '.'; back += '.'; color += '.'; continue; }
    const v = ALPHA[Math.min(61, Math.max(1, Math.round(sm[k])))];
    front += v; back += v; color += idx[k] >= 0 ? ALPHA[idx[k]] : '.';
  }
  return { kind: 'relief', w: Wm, h: H, front, back, color, symmetric: !!sym };
}

// Asymmetric subjects (animals in profile, most objects): the front follows the depth map and the edges
// are rounded by distance to the silhouette; the back is a smoother shell so the model stands up.
function depthRelief(F, D, idx, Wm, H, lo, hi, opts) {
  const N2 = Wm * H;
  const relief3d = Math.min(1, Math.max(0, (hi - lo - 8) / 40));   // distant, flat subjects bulge less
  const dist = new Float32Array(N2).fill(1e9);
  for (let k = 0; k < N2; k++) if (!F[k]) dist[k] = 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= Wm || y >= H) ? 0 : dist[y * Wm + x];
  const steps = [[-1, 0, 1], [0, -1, 0.4], [-1, -1, 1.08], [1, -1, 1.08]];   // a plate is 0.4 studs tall
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < Wm; xx++) {
      const x = fwd ? xx : Wm - 1 - xx, y = fwd ? yy : H - 1 - yy, k = y * Wm + x;
      if (!F[k]) continue;
      let d = dist[k];
      for (const [ax, ay, c] of steps) d = Math.min(d, at(x + (fwd ? ax : -ax), y + (fwd ? ay : -ay)) + c);
      dist[k] = d;
    }
  }
  const Dmax = Math.min(60, Math.max(3, Math.round(Wm * 0.34 * (opts.relief ?? 1)))), R = Math.max(2, Wm * 0.22);
  let front = '', back = '', color = '';
  for (let k = 0; k < N2; k++) {
    if (!F[k]) { front += '.'; back += '.'; color += '.'; continue; }
    const dn = Math.min(1, Math.max(0, (D[k] - lo) / (hi - lo))), pillow = Math.sqrt(Math.min(1, dist[k] / R));
    const cap = 1 + dist[k] * 1.6;   // narrow parts (poles, legs, beaks) stay roughly round, not slabs
    const f = Math.max(1, Math.round(Math.min(cap, Dmax * (0.12 + (0.25 + 0.33 * relief3d) * dn + (0.08 + 0.22 * relief3d) * pillow + 0.2 * (1 - relief3d)))));
    const bk = Math.max(1, Math.round(Math.min(cap, Dmax * 0.5 * (0.35 + 0.65 * pillow))));
    front += ALPHA[Math.min(61, f)]; back += ALPHA[Math.min(61, bk)]; color += idx[k] >= 0 ? ALPHA[idx[k]] : '.';
  }
  return { front, back, color };
}

// relief spec -> per-cell columns, for voxelize.js
export function decodeRelief(r) {
  const val = c => (c === '.' ? -1 : ALPHA.indexOf(c));
  return { w: r.w, h: r.h, front: k => val(r.front[k]), back: k => val(r.back[k]), color: k => (r.color[k] === '.' ? null : PHOTO_COLORS[val(r.color[k])]) };
}
