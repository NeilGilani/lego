// Eiffel Tower — procedural 1:400 brick model.
// 1 stud = 8 mm = 3.2 m real, 1 plate = 3.2 mm = 1.28 m real.
// Every layer is generated from the tower's real profile, then packed into
// standard plates with a seam-staggering bond, then checked for connectivity.

export const SCALE = 400;
export const STUD_M = 3.2;
export const PLATE_M = 1.28;
export const N = 40;          // model footprint (studs)
export const BASE = 48;       // baseplate size (studs)
export const OFF = 4;         // model offset on baseplate
export const LAYERS = 258;    // 258 plates = 330.2 m

import { pack, buildSteps } from './engine.js';

// ---- Real-world profile (metres from tower axis) ----
// Outer edge of the structure vs height; interpolated in log space (the
// tower's edge is close to exponential in its lower two thirds).
const OUTER = [[0, 62.5], [20, 49.5], [40, 40.5], [57.6, 35.0], [86, 25.5],
  [115.7, 17.5], [150, 13.3], [180, 10.5], [230, 7.3], [276, 5.0], [300, 2.6]];
// Inner edge of each pillar; the four pillars merge just above the 2nd floor.
const INNER = [[0, 37.5], [30, 28.5], [57.6, 21.0], [86, 11.0], [115.7, 3.5], [125, -1], [400, -50]];

function interp(pts, h, log = false) {
  if (h <= pts[0][0]) return pts[0][1];
  for (let k = 1; k < pts.length; k++) {
    if (h <= pts[k][0]) {
      const [h0, v0] = pts[k - 1], [h1, v1] = pts[k], t = (h - h0) / (h1 - h0);
      return log ? Math.exp(Math.log(v0) + (Math.log(v1) - Math.log(v0)) * t) : v0 + (v1 - v0) * t;
    }
  }
  return pts[pts.length - 1][1];
}
export const outerM = h => interp(OUTER, h, true);
export const innerM = h => interp(INNER, h);

// Landmark layers (bottom layer index z covers heights z*1.28 .. (z+1)*1.28 m)
export const L = {
  FLOOR1_DECK: 44,   // top surface 57.6 m  (real 57.64 m)
  FLOOR2_DECK: 89,   // top surface 115.2 m (real 115.73 m)
  FLOOR3_DECK: 215,  // top surface 276.5 m (real 276.13 m)
  TOP: 233,          // top surface 300.0 m (original 1889 structure: 300 m)
};

const c = i => i - (N - 1) / 2;   // cell centre, studs from axis
const a = i => Math.abs(c(i));
const mod = (x, m) => ((x % m) + m) % m;

function zoneColor(z) {
  if (z <= L.FLOOR1_DECK) return 'DKBROWN';
  if (z <= L.FLOOR2_DECK) return 'RBROWN';
  return 'MNOUGAT';
}

export function buildModel() {
  const grid = Array.from({ length: LAYERS }, () => new Array(N * N).fill(null));
  const special = []; // fixed parts: {part, color, z, x, y (centre, studs), cells}
  const put = (z, i, j, col) => { if (i >= 0 && j >= 0 && i < N && j < N) grid[z][i * N + j] = col; };
  const get = (z, i, j) => (i < 0 || j < 0 || i >= N || j >= N) ? null : grid[z][i * N + j];
    const addSpecial = (part, color, z, cells, x, y) => {
    special.push({ part, color, z, cells, x, y });
  };

  // ---------- main lattice structure: pillars + trunk ----------
  const regionFn = z => {
    const h = (z + 0.5) * PLATE_M;
    const out = outerM(h) / STUD_M, inn = innerM(h) / STUD_M;
    return { out, inn, has: (i, j) => {
      if (i < 0 || j < 0 || i >= N || j >= N) return false;
      const ax = a(i), ay = a(j);
      return ax <= out && ay <= out && ax >= inn && ay >= inn;
    } };
  };
  const keepIn = z => {
    const R = regionFn(z), keep = new Set();
    const width = R.inn > 0 ? R.out - R.inn : 2 * R.out;
    const s = Math.floor(z / 3);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (!R.has(i, j)) continue;
      let shell = false;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (!R.has(i + di, j + dj)) shell = true;
      if (!shell) continue;
      const exX = !R.has(i - 1, j) || !R.has(i + 1, j);
      const exY = !R.has(i, j - 1) || !R.has(i, j + 1);
      const corner = exX && exY;
      const u = Math.floor(exX ? a(j) : a(i));
      const band = mod(u + s, 8) < 2 || mod(u - s, 8) < 2;
      if (width < 4.6 || z <= 1 || z % 12 === 0 || corner || (!exX && !exY) || band) keep.add(i * N + j);
    }
    return keep;
  };
  const TRUNK_END = 211;
  let next = keepIn(1);
  for (let z = 1; z <= TRUNK_END; z++) {
    const cur = next; next = keepIn(z + 1);
    const col = zoneColor(z);
    for (const k of cur) put(z, Math.floor(k / N), k % N, col);
    if (z < TRUNK_END) for (const k of next) put(z, Math.floor(k / N), k % N, col);
    // where a face steps one stud inward (or a pillar's inner face steps toward
    // the axis), lay a 2-stud tie ring so the new face sits on solid plates
    if (z < TRUNK_END) {
      const A = regionFn(z), B = regionFn(z + 1);
      const ext = (R, f) => { let v = f === Math.max ? -1 : 99;
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (R.has(i, j)) v = f(v, f(a(i), a(j))); return v; };
      const oA = ext(A, Math.max), oB = ext(B, Math.max);
      const iA = A.inn > 0 ? ext(A, Math.min) : 0, iB = B.inn > 0 ? ext(B, Math.min) : 0;
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const mx = Math.max(a(i), a(j)), mn = Math.min(a(i), a(j));
        if (oB < oA && A.has(i, j) && mx >= oB) put(z, i, j, col);
        if (iB < iA && (A.has(i, j) || B.has(i, j)) && mn <= iA && mn >= iB) put(z, i, j, col);
      }
    }
  }
  // z = 0: solid masonry footings under the four pillars
  { const R = regionFn(0); for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (R.has(i, j)) put(0, i, j, 'LBG'); }

  const aOut = z => { const o = outerM((z + 0.5) * PLATE_M) / STUD_M; return Math.floor(o - 0.5) + 0.5; };

  // ---------- the four decorative arches (below the 1st floor) ----------
  {
    const h0 = 8, ae = innerM(h0), be = 43 - h0, t = 1.09;
    for (let z = 0; z <= 38; z++) {
      const h = (z + 0.5) * PLATE_M; if (h < h0) continue;
      const row = aOut(z), innS = innerM(h) / STUD_M;
      for (let i = 0; i < N; i++) {
        const ax = a(i); if (ax >= innS) continue;
        const r = Math.hypot(ax * STUD_M / ae, (h - h0) / be);
        let on = r >= 1 && r <= t;
        if (!on && r > t && h > 30) on = z % 4 === 2 || Math.floor(ax) % 3 === 1; // spandrel lacework
        if (!on) continue;
        for (const sgn of [-1, 1]) {
          const j = Math.round(sgn * row + (N - 1) / 2);
          put(z, i, j, 'DKBROWN'); put(z, j, i, 'DKBROWN');
        }
      }
    }
  }

  // ---------- 1st floor: frieze girder belt + deck + railing ----------
  {
    for (let z = 39; z <= 43; z++) {
      const ro = Math.max(10.5, aOut(z));
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const m = Math.max(a(i), a(j)), u = Math.floor(Math.min(a(i), a(j)));
        if (m === ro && (z === 39 || z === 43 || u % 2 === 0)) put(z, i, j, 'DKBROWN');       // outer frieze
        if (m === 7.5 && z >= 42) put(z, i, j, 'DKBROWN');                                    // inner girder
        if (z === 43 && m > 7.5 && m < ro) put(z, i, j, 'DKBROWN');                           // floor beams
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const m = Math.max(a(i), a(j));
      if (m >= 7.5 && m <= 10.5) put(L.FLOOR1_DECK, i, j, 'DKBROWN');
    }
    railing(L.FLOOR1_DECK + 1, 10.5, 'RBROWN');
  }

  // ---------- 2nd floor ----------
  {
    for (let z = 86; z <= 88; z++) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const m = Math.max(a(i), a(j)), u = Math.floor(Math.min(a(i), a(j)));
      if (m === 5.5 && (z !== 87 || u % 2 === 0)) put(z, i, j, 'RBROWN');
      if (z === 88 && m >= 2.5 && m < 5.5) put(z, i, j, 'RBROWN');
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const m = Math.max(a(i), a(j));
      if (m >= 2.5 && m <= 5.5) put(L.FLOOR2_DECK, i, j, 'RBROWN');
    }
    railing(L.FLOOR2_DECK + 1, 5.5, 'MNOUGAT');
  }

  // ---------- 3rd floor: deck, glazed gallery, upper terrace ----------
  const sq = (z, lo, hi, col) => { for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const m = Math.max(a(i), a(j)); if (m >= lo && m <= hi) put(z, i, j, col); } };
  sq(212, 0, 2.5, 'MNOUGAT');
  sq(213, 2.5, 2.5, 'MNOUGAT'); sq(214, 2.5, 2.5, 'MNOUGAT'); sq(214, 0, 0.5, 'MNOUGAT');
  sq(L.FLOOR3_DECK, 0, 2.5, 'MNOUGAT');
  for (let z = 216; z <= 219; z++) {
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const ax = a(i), ay = a(j), m = Math.max(ax, ay);
      if (m === 2.5) put(z, i, j, (ax === 2.5 && ay === 2.5) ? 'MNOUGAT' : 'TCLEAR');
      if (m === 0.5) put(z, i, j, 'MNOUGAT'); // stair / lift core
    }
  }
  sq(220, 0, 2.5, 'MNOUGAT');
  railing(221, 2.5, 'MNOUGAT');
  // summit: Eiffel's apartment / campanile / beacon
  for (let z = 221; z <= 226; z++) sq(z, 1.5, 1.5, 'MNOUGAT');
  sq(227, 0, 1.5, 'MNOUGAT');
  for (let z = 228; z <= 231; z++) sq(z, 0, 0.5, 'MNOUGAT');
  sq(232, 0, 0.5, 'TYELLOW');   // lighthouse beacon
  sq(233, 0, 0.5, 'MNOUGAT');

  // ---------- antennas: 300 m -> 330 m ----------
  const ctr = [[19, 19], [19, 20], [20, 19], [20, 20]], mid = (N - 1) / 2;
  addSpecial('RBRICK2', 'LBG', 234, ctr, mid, mid);
  addSpecial('JUMPER2', 'LBG', 237, ctr, mid, mid);
  const mast = ['LBG', 'LBG', 'WHITE', 'RED', 'WHITE', 'RED'];
  mast.forEach((col, k) => addSpecial('RBRICK1', col, 238 + 3 * k, [], mid, mid));
  addSpecial('ROUND1', 'WHITE', 256, [], mid, mid);
  addSpecial('ROUND1', 'TRED', 257, [], mid, mid);   // aviation warning light

  function railing(z, m0, col) {
    // posts (round 1x1 plates, two high) every other stud, then a top rail
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const m = Math.max(a(i), a(j)), u = Math.floor(Math.min(a(i), a(j)));
      if (m !== m0) continue;
      if (u % 2 === 0 || Math.min(a(i), a(j)) === m0) {
        for (const dz of [0, 1]) if (!get(z + dz, i, j)) addSpecial('ROUND1', col, z + dz, [[i, j]], i, j);
      }
      put(z + 2, i, j, col);
    }
  }

  // move the 40x40 model onto the 48x48 baseplate grid and pack it
  const big = grid.map(layer => {
    const g = new Array(BASE * BASE).fill(null);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) g[(i + OFF) * BASE + j + OFF] = layer[i * N + j];
    return g;
  });
  const shifted = special.map(s => ({ ...s, cells: s.cells.map(([i, j]) => [i + OFF, j + OFF]), x: s.x + OFF, y: s.y + OFF }));
  return pack(big, BASE, shifted);
}

// ---------- instruction steps ----------
export const SECTIONS = [
  { name: 'Foundations',              from: 0,   to: 0,   blurb: 'The four masonry piers. The real pillars stand on concrete and limestone foundations sunk up to 15 m below the Champ de Mars.' },
  { name: 'The four pillars',         from: 1,   to: 14,  blurb: 'Each pillar is a hollow lattice box made of four main girders. They lean inward along Eiffel\'s wind-load curve.' },
  { name: 'Rising legs & arch springs', from: 15, to: 28, blurb: 'The legs continue to converge. The decorative arches spring from the inner faces of the pillars.' },
  { name: 'The great arches',         from: 29,  to: 38,  blurb: 'Sauvestre\'s four arches were added for looks, not strength. Their crowns sit just below the first-floor girders.' },
  { name: 'First floor (57 m)',       from: 39,  to: 47,  blurb: 'The frieze belt (which carries the 72 engraved names of French scientists), the ring-shaped deck with its central void, and the parapet.' },
  { name: 'Upper legs',               from: 48,  to: 85,  blurb: 'Above the first floor the pillars keep tapering and lean closer together as they head for the second floor.' },
  { name: 'Second floor (115 m)',     from: 86,  to: 92,  blurb: 'The 41 m square platform overhangs the legs. The colour changes here to follow the real three-tone paint scheme.' },
  { name: 'Lower trunk',              from: 93,  to: 150, blurb: 'The pillars merge into one square shaft. Horizontal belts every 12 plates stand in for the real tower\'s bracing frames.' },
  { name: 'Upper trunk',              from: 151, to: 211, blurb: 'The shaft narrows toward the summit. Watch the X-bracing pattern step inward with every brick height.' },
  { name: 'Third floor (276 m)',      from: 212, to: 222, blurb: 'The enclosed glazed gallery, its roof terrace and railing.' },
  { name: 'Summit & antennas (330 m)', from: 223, to: 257, blurb: 'Gustave Eiffel\'s apartment and the campanile, the lighthouse beacon, and the broadcast antennas that took the tower to 330 m in 2022.' },
];

export function eiffelModel() {
  const { pieces, floating, bridges } = buildModel();
  const sections = SECTIONS;
  return {
    title: 'Eiffel Tower', subtitle: '1:400 scale · Champ de Mars, Paris',
    W: BASE, H: LAYERS, baseplate: { size: 48, id: '4186', name: 'Baseplate 48 x 48', color: 'GREEN' },
    pieces, floating, bridges, sections, steps: buildSteps(pieces, sections, BASE),
    note: landmarkNote, plateM: PLATE_M, studM: STUD_M,
  };
}

function landmarkNote(z0, z1) {
  const has = z => z >= z0 && z <= z1;
  if (has(0)) return '<b>Masonry piers.</b> The real pillars stand on stone blocks. Light Bluish Gray marks them here. Each pillar footprint is 8 × 8 studs, which is 25.6 m (real: about 25 m).';
  if (has(39)) return '<b>The frieze belt.</b> The 72 names of French scientists and engineers are engraved on this girder, 18 per side. At this scale it is the alternating post pattern on the outer ring.';
  if (has(L.FLOOR1_DECK)) return '<b>First floor deck: 57.6 m</b> (real 57.64 m). A 22 × 22 stud ring = 70.4 m square (real 70.69 m), with the open central void.';
  if (has(L.FLOOR1_DECK + 1)) return '<b>Parapet.</b> Round 1×1 plates stacked two high make the railing posts, then a plate ring caps them. The colour steps up to Reddish Brown here.';
  if (has(L.FLOOR2_DECK)) return '<b>Second floor deck: 115.2 m</b> (real 115.73 m). 12 × 12 studs = 38.4 m square (real 40.96 m). The 4 × 4 opening in the middle is the lift shaft.';
  if (has(98)) return '<b>The pillars become one shaft.</b> Around 125 m the four legs fully merge into the single square trunk.';
  if (has(L.FLOOR3_DECK)) return '<b>Third floor deck: 276.5 m</b> (real 276.13 m). The glazed gallery uses Trans-Clear plates between Medium Nougat corner posts.';
  if (has(232)) return '<b>Lighthouse beacon.</b> A Trans-Yellow plate represents the rotating beacon at the very top of the original 300 m structure.';
  if (has(256)) return '<b>330 m.</b> The Trans-Red round plate is the aviation warning light on the tip of the antenna. The final height is 258 plates = 82.6 cm = 330.2 m to scale.';
  if (has(234)) return '<b>Antennas.</b> The broadcast masts added since 1957 (most recently a DAB+ antenna in 2022) bring the tower from 300 m to 330 m. The model mast is centred on a jumper plate.';
  return '';
}
