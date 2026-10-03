// Brick colours (BrickLink names + colour IDs) and the parts the engine can use.

export const COLORS = {
  WHITE:    { name: 'White',               bl: 1,   hex: '#F4F4F4' },
  BLACK:    { name: 'Black',               bl: 11,  hex: '#1B2A34' },
  LBG:      { name: 'Light Bluish Gray',   bl: 86,  hex: '#A0A5A9' },
  DBG:      { name: 'Dark Bluish Gray',    bl: 85,  hex: '#6C6E68' },
  RED:      { name: 'Red',                 bl: 5,   hex: '#C91A09' },
  DKRED:    { name: 'Dark Red',            bl: 59,  hex: '#720E0F' },
  ORANGE:   { name: 'Orange',              bl: 4,   hex: '#FE8A18' },
  DKORANGE: { name: 'Dark Orange',         bl: 68,  hex: '#A95500' },
  LTORANGE: { name: 'Bright Light Orange', bl: 110, hex: '#F8BB3D' },
  YELLOW:   { name: 'Yellow',              bl: 3,   hex: '#F2CD37' },
  LTYELLOW: { name: 'Bright Light Yellow', bl: 103, hex: '#FFF03A' },
  LIME:     { name: 'Lime',                bl: 34,  hex: '#BBE90B' },
  GREEN:    { name: 'Green',               bl: 6,   hex: '#237841' },
  DKGREEN:  { name: 'Dark Green',          bl: 80,  hex: '#184632' },
  OLIVE:    { name: 'Olive Green',         bl: 155, hex: '#9B9A5A' },
  SANDGRN:  { name: 'Sand Green',          bl: 48,  hex: '#A0BCAC' },
  BLUE:     { name: 'Blue',                bl: 7,   hex: '#0055BF' },
  DKBLUE:   { name: 'Dark Blue',           bl: 63,  hex: '#0A3463' },
  MAZURE:   { name: 'Medium Azure',        bl: 156, hex: '#36AEBF' },
  DKAZURE:  { name: 'Dark Azure',          bl: 153, hex: '#078BC9' },
  LAVENDER: { name: 'Medium Lavender',     bl: 157, hex: '#AC78BA' },
  MAGENTA:  { name: 'Magenta',             bl: 71,  hex: '#923978' },
  PINK:     { name: 'Bright Pink',         bl: 104, hex: '#E4ADC8' },
  DKPINK:   { name: 'Dark Pink',           bl: 47,  hex: '#C870A0' },
  CORAL:    { name: 'Coral',               bl: 220, hex: '#FF698F' },
  TAN:      { name: 'Tan',                 bl: 2,   hex: '#E4CD9E' },
  DKTAN:    { name: 'Dark Tan',            bl: 69,  hex: '#958A73' },
  LTNOUGAT: { name: 'Light Nougat',        bl: 90,  hex: '#F6D7B3' },
  NOUGAT:   { name: 'Nougat',              bl: 28,  hex: '#D09168' },
  MNOUGAT:  { name: 'Medium Nougat',       bl: 150, hex: '#AA7D55' },
  RBROWN:   { name: 'Reddish Brown',       bl: 88,  hex: '#582A12' },
  DKBROWN:  { name: 'Dark Brown',          bl: 120, hex: '#352100' },
  GOLD:     { name: 'Pearl Gold',          bl: 115, hex: '#AA7F2E' },
  SILVER:   { name: 'Flat Silver',         bl: 95,  hex: '#898788' },
  TCLEAR:   { name: 'Trans-Clear',         bl: 12,  hex: '#DDEEF5', trans: true },
  TLTBLUE:  { name: 'Trans-Light Blue',    bl: 15,  hex: '#AEEFEC', trans: true },
  TRED:     { name: 'Trans-Red',           bl: 17,  hex: '#E02A1A', trans: true },
  TYELLOW:  { name: 'Trans-Yellow',        bl: 19,  hex: '#F5CD2F', trans: true },
};

const PLATE_IDS = {
  '1x1': '3024', '1x2': '3023', '1x3': '3623', '1x4': '3710', '1x6': '3666',
  '1x8': '3460', '1x10': '4477', '1x12': '60479', '2x2': '3022', '2x3': '3021',
  '2x4': '3020', '2x6': '3795', '2x8': '3034',
};
export const PARTS = {
  ROUND1:  { id: '4073',  name: 'Plate, Round 1 x 1',             w: 1, d: 1, h: 1, shape: 'round' },
  RBRICK1: { id: '3062b', name: 'Brick, Round 1 x 1',             w: 1, d: 1, h: 3, shape: 'round' },
  RBRICK2: { id: '3941',  name: 'Brick, Round 2 x 2',             w: 2, d: 2, h: 3, shape: 'round' },
  JUMPER2: { id: '87580', name: 'Plate 2 x 2 with 1 Center Stud', w: 2, d: 2, h: 1, shape: 'jumper' },
};
for (const [k, id] of Object.entries(PLATE_IDS)) {
  const [a, b] = k.split('x').map(Number);
  PARTS['P' + k] = { id, name: `Plate ${a} x ${b}`, w: a, d: b, h: 1, shape: 'box' };
}
export const PLATE_SIZES = Object.keys(PLATE_IDS).map(k => k.split('x').map(Number));

// bricks (3 plates tall)
const BRICK_IDS = {
  '1x1': '3005', '1x2': '3004', '1x3': '3622', '1x4': '3010', '1x6': '3009', '1x8': '3008',
  '2x2': '3003', '2x3': '3002', '2x4': '3001', '2x6': '2456',
};
for (const [k, id] of Object.entries(BRICK_IDS)) {
  const [a, b] = k.split('x').map(Number);
  PARTS['B' + k] = { id, name: `Brick ${a} x ${b}`, w: a, d: b, h: 3, shape: 'box' };
}
export const BRICK_SIZES = Object.keys(BRICK_IDS).map(k => k.split('x').map(Number));

// tiles (smooth, no studs) for exposed tops
const TILE_IDS = {
  '1x1': '3070b', '1x2': '3069b', '1x3': '63864', '1x4': '2431', '1x6': '6636', '1x8': '4162',
  '2x2': '3068b', '2x4': '87079',
};
for (const [k, id] of Object.entries(TILE_IDS)) {
  const [a, b] = k.split('x').map(Number);
  PARTS['T' + k] = { id, name: `Tile ${a} x ${b}`, w: a, d: b, h: 1, shape: 'box', studs: false };
}
export const tileFor = plateKey => (PARTS['T' + plateKey.slice(1)] ? 'T' + plateKey.slice(1) : null);
PARTS.RTILE1 = { id: '98138', name: 'Tile, Round 1 x 1', w: 1, d: 1, h: 1, shape: 'round', studs: false };

// 45° slopes: w = run (downhill direction), d = width. Stud row on the high side only.
PARTS.S2x1 = { id: '3040', name: 'Slope 45 2 x 1', w: 2, d: 1, h: 3, shape: 'slope' };
PARTS.S2x2 = { id: '3039', name: 'Slope 45 2 x 2', w: 2, d: 2, h: 3, shape: 'slope' };

export const BASEPLATES = [
  { size: 16, id: '3867', name: 'Baseplate 16 x 16' },
  { size: 32, id: '3811', name: 'Baseplate 32 x 32' },
  { size: 48, id: '4186', name: 'Baseplate 48 x 48' },
];
export const baseplateFor = n => BASEPLATES.find(b => b.size >= n) || BASEPLATES[2];

// ---------------------------------------------------------------- photo colour matching
const srgbToLab = (r, g, b) => {
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), Y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), Z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
};
export const hexToLab = hex => { const n = parseInt(hex.slice(1), 16); return srgbToLab(n >> 16, (n >> 8) & 255, n & 255); };
export const labDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// opaque, non-metallic colours a photo can be matched to; index order is stored in saved builds
export const PHOTO_COLORS = Object.keys(COLORS).filter(k => !COLORS[k].trans && k !== 'GOLD' && k !== 'SILVER');
const PHOTO_LAB = PHOTO_COLORS.map(k => hexToLab(COLORS[k].hex));
export function nearestColor(r, g, b) {
  const lab = srgbToLab(r, g, b);
  let best = 0, bd = Infinity;
  PHOTO_LAB.forEach((p, i) => { const d = labDist(lab, p); if (d < bd) { bd = d; best = i; } });
  return best;
}
export { srgbToLab };

// idx: Int8Array of PHOTO_COLORS indices (-1 = none) on a w x h grid. Keeps only the main colours
// (like a real builder would), remaps stray shades to the nearest kept colour, then removes speckle.
export function cleanupColors(idx, w, h, maxColors = 10) {
  const counts = new Map(); let total = 0;
  for (const v of idx) if (v >= 0) { counts.set(v, (counts.get(v) || 0) + 1); total++; }
  const keep = [...counts].filter(([, n]) => n >= total * 0.015).sort((a, b) => b[1] - a[1]).slice(0, maxColors).map(([k]) => k);
  if (keep.length) for (let k = 0; k < idx.length; k++) if (idx[k] >= 0 && !keep.includes(idx[k])) {
    const L = PHOTO_LAB[idx[k]]; idx[k] = keep.reduce((b, c) => labDist(PHOTO_LAB[c], L) < labDist(PHOTO_LAB[b], L) ? c : b, keep[0]);
  }
  smooth(idx, w, h); smooth(idx, w, h);
}

function smooth(idx, w, h) {
  const out = new Int8Array(idx);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (idx[y * w + x] < 0) continue;
    const votes = new Map();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
      const v = idx[yy * w + xx]; if (v >= 0) votes.set(v, (votes.get(v) || 0) + (dx || dy ? 1 : 1.5));
    }
    let best = idx[y * w + x], bv = 0; for (const [k, v] of votes) if (v > bv) { bv = v; best = k; }
    out[y * w + x] = best;
  }
  idx.set(out);
}

