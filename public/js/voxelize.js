// AI shape spec -> brick model.
// The spec is a list of primitives measured in studs (x/z, horizontal) and plates
// (y, vertical; 1 stud of width = 2.5 plates of height). They are sampled into a
// voxel grid, hollowed, given clear supports where needed, then packed into parts.
import { COLORS, baseplateFor, PHOTO_COLORS, nearestColor, srgbToLab, hexToLab, labDist, cleanupColors } from './palette.js';
import { decodeRelief } from './relief.js';
import { pack, buildSteps } from './engine.js';

export const LIMITS = { maxFootprint: 46, maxHeight: 180, maxPrimitives: 220 };
export const SHAPES = ['box', 'cylinder', 'sphere', 'dome', 'roof'];

const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

export function sanitizeSpec(raw) {
  const meta = {
    title: String(raw?.title || 'Untitled build').slice(0, 60),
    subject: String(raw?.subject || '').slice(0, 80),
    description: String(raw?.description || '').slice(0, 400),
  };
  if (raw?.kind === 'relief') {
    const { w, h, front, back, color } = raw, n = w * h, ok = v => typeof v === 'string' && v.length === n && /^[0-9A-Za-z.]*$/.test(v);
    if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 48 && h <= LIMITS.maxHeight && ok(front) && ok(back) && ok(color)))
      throw new Error('This build’s data is damaged.');
    return { ...meta, kind: 'relief', w, h, front, back, color, primitives: [] };
  }
  const prims = (Array.isArray(raw?.primitives) ? raw.primitives : []).slice(0, LIMITS.maxPrimitives).map((p, k) => ({
    name: String(p.name || `part ${k + 1}`).slice(0, 40),
    shape: SHAPES.includes(p.shape) ? p.shape : 'box',
    op: ['subtract', 'paint'].includes(p.op) ? p.op : 'add',
    color: COLORS[p.color] ? p.color : 'LBG',
    x: num(p.x, 0, -60, 60), z: num(p.z, 0, -60, 60), y: num(p.y, 0, -20, 300),
    w: num(p.w, 2, 0.5, 80), d: num(p.d, 2, 0.5, 80), h: num(p.h, 3, 0.5, 400),
    taper: num(p.taper, 1, 0, 1),
    axis: ['x', 'y', 'z'].includes(p.axis) ? p.axis : 'y',
  }));
  const box = Array.isArray(raw?.subjectBox) && raw.subjectBox.length === 4 && raw.subjectBox.every(v => Number.isFinite(+v))
    ? raw.subjectBox.map(v => Math.min(1000, Math.max(0, +v))) : null;
  const outline = (Array.isArray(raw?.outline) ? raw.outline : []).slice(0, 200)
    .map(p => [num(p?.x, NaN, 0, 1000), num(p?.y, NaN, 0, 1000)]).filter(p => p.every(Number.isFinite));
  const f = raw?.front;
  const front = f && [f.i0, f.z0, f.w, f.h].every(v => Number.isInteger(v) && v >= 0 && v <= 400) && typeof f.data === 'string'
    && f.data.length === f.w * f.h && /^[0-9A-Za-z.]*$/.test(f.data) ? { i0: f.i0, z0: f.z0, w: f.w, h: f.h, data: f.data } : null;
  return {
    subjectBox: box && box[2] > box[0] && box[3] > box[1] ? box : null,
    outline: outline.length >= 6 ? outline : null,
    front,
    ...meta,
    primitives: prims,
  };
}

// is the point (dx studs, dy plates from bottom, dz studs) inside primitive p?
function inside(p, dx, dy, dz) {
  const hw = p.w / 2, hd = p.d / 2;
  if (p.shape === 'sphere' || p.shape === 'dome') {
    const cy = p.shape === 'sphere' ? p.h / 2 : 0, ry = p.shape === 'sphere' ? p.h / 2 : p.h;
    if (dy < 0 || dy > p.h) return false;
    return (dx / hw) ** 2 + ((dy - cy) / ry) ** 2 + (dz / hd) ** 2 <= 1;
  }
  if (dy < 0 || dy > p.h) return false;
  if (p.shape === 'roof') { // ridge runs along z
    if (Math.abs(dz) > hd) return false;
    return Math.abs(dx) <= hw * (1 - dy / p.h);
  }
  if (p.shape === 'cylinder' && p.axis !== 'y') {
    // lying cylinder: length along x (w) or z (d); cross-section uses the other two
    const r1 = p.axis === 'x' ? hd : hw, along = p.axis === 'x' ? dx : dz, len = p.axis === 'x' ? hw : hd, side = p.axis === 'x' ? dz : dx;
    if (Math.abs(along) > len) return false;
    return (side / r1) ** 2 + ((dy - p.h / 2) / (p.h / 2)) ** 2 <= 1;
  }
  const s = 1 - (1 - p.taper) * (dy / p.h);       // taper: 1 = straight, 0 = point
  if (p.shape === 'cylinder') return (dx / (hw * s)) ** 2 + (dz / (hd * s)) ** 2 <= 1;
  return Math.abs(dx) <= hw * s && Math.abs(dz) <= hd * s;
}

// opts.photo: { data, width, height } RGBA pixels of the original photo; when given (and the spec has a
// subjectBox), front-facing studs are recoloured from it and the result is returned as `front`.
export function voxelize(spec, opts = {}) {
  let grid, owner = null, P = null, W, H, base, s = 1, front = null;
  if (spec.kind === 'relief') ({ grid, W, H, base } = reliefGrid(spec));
  else ({ grid, owner, P, W, H, base, s, front } = primitiveGrid(spec, opts));
  return finish(spec, grid, owner, P, W, H, base, s, front);
}

// relief: each photo cell becomes a column through the model, from -back to +front studs
function reliefGrid(spec) {
  const r = decodeRelief(spec);
  let fMax = 0, bMax = 0;
  for (let k = 0; k < r.w * r.h; k++) { fMax = Math.max(fMax, r.front(k)); bMax = Math.max(bMax, r.back(k)); }
  const base = baseplateFor(Math.max(r.w, fMax + bMax) + 2), W = base.size, H = r.h;
  const i0 = Math.floor((W - r.w) / 2), jc = Math.floor((W - (fMax + bMax)) / 2) + bMax;   // centred both ways
  const grid = Array.from({ length: H }, () => new Array(W * W).fill(null));
  const seat = Math.max(3, Math.round(H * 0.15));
  for (let x = 0; x < r.w; x++) {
    let low = -1; for (let z = 0; z < H && low < 0; z++) if (r.color(z * r.w + x) && r.front(z * r.w + x) >= 0) low = z;
    for (let z = 0; z < H; z++) {
      // a small gap under the subject (e.g. a cropped-off base) is filled so the model sits on the ground
      const src = low > 0 && low <= seat && z < low ? low : z;
      const k = src * r.w + x, col = r.color(k), f = r.front(k), b = r.back(k);
      if (!col || f < 0) continue;
      for (let j = jc - b; j < jc + f; j++) if (j >= 0 && j < W) grid[z][(i0 + x) * W + j] = col;
    }
  }
  return { grid, W, H, base };
}

function primitiveGrid(spec, opts) {
  const prims = spec.primitives;
  if (!prims.length) throw new Error('The design came back empty.');
  // fit: centre on the axis, sit on the ground, scale down if too big
  const adds = prims.filter(p => p.op === 'add');
  let minY = Infinity, maxY = -Infinity, ext = 0;
  for (const p of adds) {
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + p.h);
    ext = Math.max(ext, Math.abs(p.x) + p.w / 2, Math.abs(p.z) + p.d / 2);
  }
  const s = Math.min(1, LIMITS.maxFootprint / (2 * ext), LIMITS.maxHeight / (maxY - minY));
  const P = prims.map(p => ({ ...p, x: p.x * s, z: p.z * s, y: (p.y - minY) * s, w: p.w * s, d: p.d * s, h: p.h * s }));
  const H = Math.max(1, Math.ceil((maxY - minY) * s));
  const base = baseplateFor(Math.ceil(2 * ext * s) + 2), W = base.size;
  const mid = (W - 1) / 2;

  const grid = Array.from({ length: H }, () => new Array(W * W).fill(null));
  const owner = Array.from({ length: H }, () => new Int16Array(W * W).fill(-1));
  P.forEach((p, k) => {
    const i0 = Math.max(0, Math.floor(mid + p.x - p.w / 2)), i1 = Math.min(W - 1, Math.ceil(mid + p.x + p.w / 2));
    const j0 = Math.max(0, Math.floor(mid + p.z - p.d / 2)), j1 = Math.min(W - 1, Math.ceil(mid + p.z + p.d / 2));
    const z0 = Math.max(0, Math.floor(p.y)), z1 = Math.min(H - 1, Math.ceil(p.y + p.h));
    for (let z = z0; z <= z1; z++) for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      if (!inside(p, i - mid - p.x, z + 0.5 - p.y, j - mid - p.z)) continue;
      const c = i * W + j;
      if (p.op === 'subtract') { grid[z][c] = null; owner[z][c] = -1; }
      else if (p.op === 'paint') { if (grid[z][c]) grid[z][c] = p.color; }   // recolour only, never adds
      else { grid[z][c] = p.color; owner[z][c] = k; }
    }
  });

  // photo projection: recolour the camera-facing surface from the photo's own pixels
  let front = spec.front || null;
  if (!front && opts.photo && spec.subjectBox) front = projectPhoto(grid, W, H, spec, opts.photo);
  if (front) applyFront(grid, W, H, front);
  return { grid, owner, P, W, H, base, s, front };
}

function finish(spec, grid, owner, P, W, H, base, s, front) {
  // hollow out the inside (keeps walls >= 2 studs thick and floors/roofs >= 1 plate)
  const filled = (z, i, j) => z >= 0 && z < H && i >= 0 && j >= 0 && i < W && j < W && grid[z][i * W + j] !== null;
  const remove = [];
  for (let z = 1; z < H - 1; z++) for (let i = 2; i < W - 2; i++) for (let j = 2; j < W - 2; j++) {
    if (!filled(z, i, j)) continue;
    let solid = true;
    for (let dz = -1; dz <= 1 && solid; dz++) for (let di = -2; di <= 2 && solid; di++) for (let dj = -2; dj <= 2 && solid; dj++) if (!filled(z + dz, i + di, j + dj)) solid = false;
    if (solid) remove.push(z * W * W + i * W + j);
  }
  for (const r of remove) { const z = Math.floor(r / (W * W)), c = r % (W * W); grid[z][c] = null; }

  // anything not resting on the ground gets a clear support column
  const supports = addSupports(grid, W, H);

  const slopes = addSlopes(grid, W, H);
  const { pieces, floating, bridges } = pack(grid, W, slopes, { bricks: true, tiles: true });
  const sections = autoSections(pieces, owner, P, W, H);
  return {
    title: spec.title, subtitle: spec.subject, description: spec.description,
    W, H, baseplate: { ...base, color: 'GREEN' }, pieces, floating, bridges, supports, scale: s, front,
    sections, steps: buildSteps(pieces, sections, W),
  };
}

const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function frontmost(grid, W, i, z) {
  for (let j = W - 1; j >= 0; j--) if (grid[z][i * W + j]) return j;
  return -1;
}

function projectPhoto(grid, W, H, spec, photo) {
  let i0 = W, i1 = -1, z0 = H, z1 = -1;
  for (let z = 0; z < H; z++) for (let i = 0; i < W; i++) if (frontmost(grid, W, i, z) >= 0) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  if (i1 < 0) return null;
  const w = i1 - i0 + 1, h = z1 - z0 + 1, { data, width: PW, height: PH } = photo;
  const [ymin, xmin, ymax, xmax] = spec.subjectBox.map((v, k) => v / 1000 * (k % 2 ? PW : PH));
  const bw = xmax - xmin, bh = ymax - ymin;
  const px = (x, y) => { const o = (Math.min(PH - 1, Math.max(0, y | 0)) * PW + Math.min(PW - 1, Math.max(0, x | 0))) * 4; return [data[o], data[o + 1], data[o + 2]]; };
  // background reference: colours around the edge of the photo
  const bg = [];
  for (let t = 0; t < 1; t += 1 / 40) for (const [x, y] of [[t * PW, 2], [t * PW, PH - 3], [2, t * PH], [PW - 3, t * PH]]) bg.push(srgbToLab(...px(x, y)));
  const poly = spec.outline ? spec.outline.map(([x, y]) => [x / 1000 * PW, y / 1000 * PH]) : null;
  const inPoly = (x, y) => { let c = false; for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const [xa, ya] = poly[a], [xb, yb] = poly[b]; if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) c = !c; } return c; };
  const idx = new Int8Array(w * h).fill(-1);
  for (let z = z0; z <= z1; z++) for (let i = i0; i <= i1; i++) {
    const j = frontmost(grid, W, i, z); if (j < 0) continue;
    const cx = xmin + (i - i0 + 0.5) / w * bw, cy = ymax - (z - z0 + 0.5) / h * bh;   // photo y runs downward
    if (poly && !inPoly(cx, cy)) continue;
    // average a 3x3 patch across the cell's footprint in the photo
    let r = 0, g = 0, b = 0;
    for (const dx of [-0.33, 0, 0.33]) for (const dy of [-0.33, 0, 0.33]) { const c = px(cx + dx * bw / w, cy + dy * bh / h); r += c[0]; g += c[1]; b += c[2]; }
    r /= 9; g /= 9; b /= 9;
    const lab = srgbToLab(r, g, b), own = hexToLab(COLORS[grid[z][i * W + j]].hex);
    if (bg.some(q => labDist(q, lab) < 9) && labDist(lab, own) > 20) continue;   // looks like background: keep the AI colour
    idx[(z - z0) * w + (i - i0)] = nearestColor(r, g, b);
  }
  cleanupColors(idx, w, h);
  return { i0, z0, w, h, data: Array.from(idx, v => (v < 0 ? '.' : ALPHA[v])).join('') };
}

function applyFront(grid, W, H, f) {
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const ch = f.data[y * f.w + x]; if (ch === '.') continue;
    const col = PHOTO_COLORS[ALPHA.indexOf(ch)], z = f.z0 + y, i = f.i0 + x;
    if (!col || z >= H || i >= W) continue;
    const j = frontmost(grid, W, i, z); if (j < 0) continue;
    grid[z][i * W + j] = col;
    if (j > 0 && grid[z][i * W + j - 1]) grid[z][i * W + j - 1] = col;   // two deep, so it survives hollowing and slopes
  }
}

function addSupports(grid, W, H) {
  let added = 0;
  for (let round = 0; round < 400; round++) {
    const seen = new Uint8Array(H * W * W), stack = [];
    for (let c = 0; c < W * W; c++) if (grid[0][c]) { seen[c] = 1; stack.push(c); }
    const flood = () => {
      while (stack.length) {
        const v = stack.pop(), z = Math.floor(v / (W * W)), c = v % (W * W), i = Math.floor(c / W), j = c % W;
        for (const [dz, di, dj] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const zz = z + dz, ii = i + di, jj = j + dj;
          if (zz < 0 || zz >= H || ii < 0 || jj < 0 || ii >= W || jj >= W) continue;
          const n = zz * W * W + ii * W + jj, v = grid[zz][ii * W + jj];
          // studs connect vertically; side by side only holds if one plate can span both (same colour)
          if (!seen[n] && v && (dz !== 0 || v === grid[z][i * W + j])) { seen[n] = 1; stack.push(n); }
        }
      }
    };
    flood();
    // lowest unsupported voxel, closest to the middle
    let best = null;
    for (let z = 0; z < H && !best; z++) {
      let cand = null, cd = Infinity;
      for (let c = 0; c < W * W; c++) if (grid[z][c] && !seen[z * W * W + c]) {
        const i = Math.floor(c / W), j = c % W, d = Math.abs(i - W / 2) + Math.abs(j - W / 2);
        if (d < cd) { cd = d; cand = c; }
      }
      if (cand !== null) best = { z, c: cand };
    }
    if (!best) break;
    for (let z = best.z - 1; z >= 0 && !grid[z][best.c]; z--) { grid[z][best.c] = 'TCLEAR'; added++; }
  }
  return added;
}

// 45° slopes where the surface steps down one stud per brick height (roofs, heads, curves).
// A = top cell of a full brick-height column, B = the empty neighbour it steps down to.
function addSlopes(grid, W, H) {
  const out = [], DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const at = (z, i, j) => (z < 0 || z >= H || i < 0 || j < 0 || i >= W || j >= W) ? null : grid[z][i * W + j];
  for (let z = 3; z + 2 < H; z += 3) {
    const used = new Set(), band = [];
    for (let i = 0; i < W; i++) for (let j = 0; j < W; j++) {
      const col = at(z, i, j);
      if (!col || at(z + 1, i, j) !== col || at(z + 2, i, j) !== col || at(z + 3, i, j) || COLORS[col].trans) continue;
      for (let r = 0; r < 4; r++) {
        const [di, dj] = DIRS[r], bi = i + di, bj = j + dj;
        if (bi < 0 || bj < 0 || bi >= W || bj >= W) continue;
        if (at(z, bi, bj) || at(z + 1, bi, bj) || at(z + 2, bi, bj) || at(z + 3, bi, bj) || !at(z - 1, bi, bj)) continue;
        // only where the surface keeps rising behind A, so slopes follow real inclines
        if (at(z + 2, i - di, j - dj) !== col && !at(z + 3, i - di, j - dj)) continue;
        const ka = `${i},${j}`, kb = `${bi},${bj}`;
        if (used.has(ka) || used.has(kb)) continue;
        used.add(ka); used.add(kb);
        band.push({ col, r, a: [i, j], b: [bi, bj] });
        break;
      }
    }
    // pair side-by-side 2x1 slopes into 2x2 slopes
    const key = s => `${s.a[0]},${s.a[1]},${s.r}`, byKey = new Map(band.map(s => [key(s), s])), taken = new Set();
    for (const s of band) {
      if (taken.has(s)) continue;
      const [di, dj] = DIRS[s.r], pi = dj !== 0 ? 1 : 0, pj = di !== 0 ? 1 : 0;   // perpendicular step
      const t = byKey.get(`${s.a[0] + pi},${s.a[1] + pj},${s.r}`);
      taken.add(s);
      const cells = [s.a, s.b], high = [s.a];
      let part = 'S2x1';
      if (t && !taken.has(t) && t.col === s.col) { taken.add(t); cells.push(t.a, t.b); high.push(t.a); part = 'S2x2'; }
      for (const dz of [0, 1, 2]) for (const [ci, cj] of cells) grid[z + dz][ci * W + cj] = null;
      const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
      out.push({ part, color: s.col, z, cells, high, rot: s.r,
        x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
    }
  }
  return out;
}

function autoSections(pieces, owner, P, W, H) {
  const top = pieces.reduce((m, p) => Math.max(m, p.z), 0);
  const bands = Math.max(1, Math.min(10, Math.round((top + 1) / 14)));
  const size = Math.ceil((top + 1) / bands);
  const out = [];
  if (!owner) {   // reliefs have no named parts: name the bands by height
    const names = bands === 1 ? ['The whole model'] : Array.from({ length: bands }, (_, b) => b === 0 ? 'Base' : b === bands - 1 ? 'Top' : `Section ${b + 1}`);
    for (let b = 0; b < bands; b++) { const from = b * size, to = Math.min(top, (b + 1) * size - 1); if (from <= to) out.push({ name: names[b], from, to }); }
    return out;
  }
  for (let b = 0; b < bands; b++) {
    const from = b * size, to = Math.min(top, (b + 1) * size - 1);
    if (from > to) break;
    const votes = new Map();
    for (let z = from; z <= to; z++) for (let c = 0; c < W * W; c++) { const k = owner[z]?.[c]; if (k >= 0) votes.set(k, (votes.get(k) || 0) + 1); }
    let bestK = -1, bestV = 0; for (const [k, v] of votes) if (v > bestV) { bestV = v; bestK = k; }
    const name = bestK >= 0 ? cap(P[bestK].name) : 'Supports';
    const prev = out[out.length - 1];
    if (prev && prev.name === name) prev.to = to; else out.push({ name, from, to });
  }
  return out;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
