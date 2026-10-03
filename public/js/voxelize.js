// AI shape spec -> brick model.
// The spec is a list of primitives measured in studs (x/z, horizontal) and plates
// (y, vertical; 1 stud of width = 2.5 plates of height). They are sampled into a
// voxel grid, hollowed, given clear supports where needed, then packed into parts.
import { COLORS, baseplateFor } from './palette.js';
import { pack, buildSteps } from './engine.js';

export const LIMITS = { maxFootprint: 46, maxHeight: 180, maxPrimitives: 120 };
export const SHAPES = ['box', 'cylinder', 'sphere', 'dome', 'roof'];

const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

export function sanitizeSpec(raw) {
  const prims = (Array.isArray(raw?.primitives) ? raw.primitives : []).slice(0, LIMITS.maxPrimitives).map((p, k) => ({
    name: String(p.name || `part ${k + 1}`).slice(0, 40),
    shape: SHAPES.includes(p.shape) ? p.shape : 'box',
    op: p.op === 'subtract' ? 'subtract' : 'add',
    color: COLORS[p.color] ? p.color : 'LBG',
    x: num(p.x, 0, -60, 60), z: num(p.z, 0, -60, 60), y: num(p.y, 0, -20, 300),
    w: num(p.w, 2, 0.5, 80), d: num(p.d, 2, 0.5, 80), h: num(p.h, 3, 0.5, 400),
    taper: num(p.taper, 1, 0, 1),
    axis: ['x', 'y', 'z'].includes(p.axis) ? p.axis : 'y',
  }));
  return {
    title: String(raw?.title || 'Untitled build').slice(0, 60),
    subject: String(raw?.subject || '').slice(0, 80),
    description: String(raw?.description || '').slice(0, 400),
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

export function voxelize(spec) {
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
      else { grid[z][c] = p.color; owner[z][c] = k; }
    }
  });

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

  const { pieces, floating, bridges } = pack(grid, W);
  const sections = autoSections(pieces, owner, P, W, H);
  return {
    title: spec.title, subtitle: spec.subject, description: spec.description,
    W, H, baseplate: { ...base, color: 'GREEN' }, pieces, floating, bridges, supports, scale: s,
    sections, steps: buildSteps(pieces, sections, W),
  };
}

function addSupports(grid, W, H) {
  let added = 0;
  for (let round = 0; round < 50; round++) {
    const seen = new Uint8Array(H * W * W), stack = [];
    for (let c = 0; c < W * W; c++) if (grid[0][c]) { seen[c] = 1; stack.push(c); }
    const flood = () => {
      while (stack.length) {
        const v = stack.pop(), z = Math.floor(v / (W * W)), c = v % (W * W), i = Math.floor(c / W), j = c % W;
        for (const [dz, di, dj] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const zz = z + dz, ii = i + di, jj = j + dj;
          if (zz < 0 || zz >= H || ii < 0 || jj < 0 || ii >= W || jj >= W) continue;
          const n = zz * W * W + ii * W + jj;
          if (!seen[n] && grid[zz][ii * W + jj]) { seen[n] = 1; stack.push(n); }
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

function autoSections(pieces, owner, P, W, H) {
  const top = pieces.reduce((m, p) => Math.max(m, p.z), 0);
  const bands = Math.max(1, Math.min(10, Math.round((top + 1) / 14)));
  const size = Math.ceil((top + 1) / bands);
  const out = [];
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
