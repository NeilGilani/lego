// Brick engine: voxel layers -> standard plates (seam-staggered), stud-connectivity
// repair, and instruction steps. Shared by the Eiffel showcase and AI builds.
import { PARTS, PLATE_SIZES } from './palette.js';

// grid: Array(H) of Array(W*W) colour keys (null = empty), indexed i*W + j
// specials: [{ part, color, z, cells: [[i,j]...], x, y }] fixed parts; parts with no
//           cells are centred off-grid and stack on the special before them.
export function pack(grid, W, specials = []) {
  const H = grid.length;
  const pieces = [];
  const idGrid = Array.from({ length: H }, () => new Int32Array(W * W).fill(-1));
  for (const s of specials) {
    const p = PARTS[s.part];
    for (let dz = 0; dz < p.h; dz++) for (const [i, j] of s.cells) if (s.z + dz < H) grid[s.z + dz][i * W + j] = null;
  }

  for (let z = 0; z < H; z++) {
    const g = grid[z], ids = idGrid[z], below = z > 0 ? idGrid[z - 1] : null;
    const preferX = z % 2 === 0;
    for (let i = 0; i < W; i++) for (let j = 0; j < W; j++) {
      const col = g[i * W + j]; if (!col || ids[i * W + j] >= 0) continue;
      let best = null;
      for (const [s1, s2] of PLATE_SIZES) for (const [w, d] of (s1 === s2 ? [[s1, s2]] : [[s1, s2], [s2, s1]])) {
        if (i + w > W || j + d > W) continue;
        let ok = true;
        for (let di = 0; di < w && ok; di++) for (let dj = 0; dj < d && ok; dj++) {
          const k = (i + di) * W + j + dj; if (g[k] !== col || ids[k] >= 0) ok = false;
        }
        if (!ok) continue;
        // penalise seams that line up with the layer below, reward bridging pieces
        let seams = 0; const sup = new Set();
        if (below) {
          for (let di = 0; di < w; di++) for (let dj = 0; dj < d; dj++) { const b = below[(i + di) * W + j + dj]; if (b >= 0) sup.add(b); }
          const edge = (p, q) => { const A = below[p], B = below[q]; return A >= 0 && B >= 0 && A !== B; };
          for (let dj = 0; dj < d; dj++) {
            if (i > 0) seams += edge((i - 1) * W + j + dj, i * W + j + dj);
            if (i + w < W) seams += edge((i + w - 1) * W + j + dj, (i + w) * W + j + dj);
          }
          for (let di = 0; di < w; di++) {
            if (j > 0) seams += edge((i + di) * W + j - 1, (i + di) * W + j);
            if (j + d < W) seams += edge((i + di) * W + j + d - 1, (i + di) * W + j + d);
          }
        }
        const orient = (preferX ? w >= d : d >= w) ? 0.5 : 0;
        const score = w * d * 10 - seams * 12 + sup.size * 6 + orient;
        if (!best || score > best.score) best = { w, d, score };
      }
      const cells = [];
      for (let di = 0; di < best.w; di++) for (let dj = 0; dj < best.d; dj++) { cells.push([i + di, j + dj]); ids[(i + di) * W + j + dj] = pieces.length; }
      pieces.push({ part: 'P' + Math.min(best.w, best.d) + 'x' + Math.max(best.w, best.d), color: col, z, cells,
        x: i + (best.w - 1) / 2, y: j + (best.d - 1) / 2, w: best.w, d: best.d });
    }
  }
  const chain = [];
  for (const s of specials) {
    const p = PARTS[s.part];
    for (let dz = 0; dz < p.h; dz++) for (const [i, j] of s.cells) if (s.z + dz < H) idGrid[s.z + dz][i * W + j] = pieces.length;
    if (!s.cells.length) chain.push(pieces.length);
    pieces.push({ part: s.part, color: s.color, z: s.z, cells: s.cells, x: s.x, y: s.y, w: p.w, d: p.d, special: true });
  }
  // off-grid stacks connect to the special placed just before them
  const chainLinks = chain.map(k => [k, k - 1]);

  const groundAll = () => {
    const adj = pieces.map(() => new Set());
    for (let z = 1; z < H; z++) for (let k = 0; k < W * W; k++) {
      const A = idGrid[z][k], B = idGrid[z - 1][k];
      if (A >= 0 && B >= 0 && A !== B) { adj[A].add(B); adj[B].add(A); }
    }
    for (const [A, B] of chainLinks) { adj[A].add(B); adj[B].add(A); }
    const grounded = new Uint8Array(pieces.length), queue = [];
    pieces.forEach((p, k) => { if (p.z === 0) { grounded[k] = 1; queue.push(k); } });
    while (queue.length) { const k = queue.pop(); for (const n of adj[k]) if (!grounded[n]) { grounded[n] = 1; queue.push(n); } }
    return grounded;
  };

  // repair: tie each loose cluster to a grounded neighbour with a 1x2 bridge plate
  let grounded = groundAll(), bridges = 0;
  for (let pass = 0; pass < 2000; pass++) {
    let fixed = false;
    outer: for (let k = 0; k < pieces.length; k++) {
      if (grounded[k] || pieces[k].cells.length === 0) continue;
      const p = pieces[k];
      for (const [i, j] of p.cells) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= W) continue;
        const g = idGrid[p.z][ni * W + nj]; if (g < 0 || !grounded[g]) continue;
        for (const bz of [p.z + 1, p.z - 1]) {
          if (bz < 1 || bz >= H) continue;
          if (idGrid[bz][i * W + j] >= 0 || idGrid[bz][ni * W + nj] >= 0) continue;
          const cells = [[i, j], [ni, nj]].sort((A, B) => A[0] - B[0] || A[1] - B[1]);
          const idx = pieces.length;
          for (const [ci, cj] of cells) idGrid[bz][ci * W + cj] = idx;
          pieces.push({ part: 'P1x2', color: p.color, z: bz, cells, x: (cells[0][0] + cells[1][0]) / 2,
            y: (cells[0][1] + cells[1][1]) / 2, w: 1 + Math.abs(di), d: 1 + Math.abs(dj), bridge: true });
          bridges++; fixed = true; break outer;
        }
      }
    }
    if (!fixed) break;
    grounded = groundAll();
  }
  const floating = pieces.filter((p, k) => !grounded[k]);
  const kept = pieces.filter((p, k) => grounded[k]).sort((A, B) => A.z - B.z);
  return { pieces: kept, floating, bridges };
}

// sections: [{ name, from, to, blurb? }] covering the layers in order
export function buildSteps(pieces, sections, W, opts = {}) {
  const MAXP = opts.maxParts || 34, MAXL = opts.maxLayers || 3;
  const byZ = new Map();
  pieces.forEach((p, k) => { if (!byZ.has(p.z)) byZ.set(p.z, []); byZ.get(p.z).push(k); });
  const steps = [{ section: -1, layers: [], pieces: [], baseplate: true }];
  const mid = (W - 1) / 2;
  sections.forEach((sec, si) => {
    let z = sec.from;
    while (z <= sec.to) {
      const layer = byZ.get(z) || [];
      if (layer.length > MAXP) {
        // split a big layer into its four quadrants (turn the model as you go)
        const quads = [[], [], [], []];
        for (const k of layer) { const p = pieces[k]; quads[(p.x < mid ? 0 : 2) + (p.y < mid ? 0 : 1)].push(k); }
        let q = 0;
        for (const qi of [0, 2, 3, 1]) {
          if (!quads[qi].length) continue;
          // very dense quadrants get split again so no step is overwhelming
          const chunk = Math.ceil(quads[qi].length / Math.ceil(quads[qi].length / (MAXP * 1.6)));
          for (let c = 0; c < quads[qi].length; c += chunk) steps.push({ section: si, layers: [z], pieces: quads[qi].slice(c, c + chunk), quadrant: ++q });
        }
        z++; continue;
      }
      const group = [...layer], layers = [z];
      let zz = z + 1;
      while (zz <= sec.to && layers.length < MAXL) {
        const nx = byZ.get(zz) || [];
        if (nx.length > MAXP || group.length + nx.length > MAXP) break;
        group.push(...nx); layers.push(zz); zz++;
      }
      if (group.length) steps.push({ section: si, layers, pieces: group });
      z = zz;
    }
  });
  return steps;
}

export function tally(pieces, list = pieces.map((p, k) => k)) {
  const m = new Map();
  for (const k of list) { const p = pieces[k]; const key = p.part + '|' + p.color; m.set(key, (m.get(key) || 0) + 1); }
  return [...m].map(([key, n]) => { const [part, color] = key.split('|'); return { part, color, n }; }).sort((a, b) => {
    const da = PARTS[a.part], db = PARTS[b.part];
    return (da.shape === 'box' ? 0 : 1) - (db.shape === 'box' ? 0 : 1) || da.w * da.d - db.w * db.d || da.d - db.d || a.color.localeCompare(b.color);
  });
}
