// End-to-end quality test: photo -> draft -> projected renders -> refined design.
// Usage: node scripts/e2e.mjs <photo.jpg> <name>   (needs `npm run dev` running with SKIP_AUTH=true)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { sanitizeSpec, voxelize } from '../public/js/voxelize.js';

const [photoPath, name] = process.argv.slice(2);
const BASE = 'http://localhost:8788', OUT = 'public/_t', CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(OUT, { recursive: true });
const tmp = `${OUT}/${name}`;

// decode the photo via a BMP conversion (macOS sips)
execFileSync('sips', ['-s', 'format', 'bmp', photoPath, '--out', `${tmp}.bmp`], { stdio: 'ignore' });
const bmp = fs.readFileSync(`${tmp}.bmp`);
const off = bmp.readUInt32LE(10), PW = bmp.readInt32LE(18), hRaw = bmp.readInt32LE(22), bpp = bmp.readUInt16LE(28) / 8;
const PH = Math.abs(hRaw), row = Math.ceil(PW * bpp / 4) * 4, data = new Uint8ClampedArray(PW * PH * 4);
for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
  const o = off + (hRaw > 0 ? PH - 1 - y : y) * row + x * bpp, d = (y * PW + x) * 4;
  data[d] = bmp[o + 2]; data[d + 1] = bmp[o + 1]; data[d + 2] = bmp[o]; data[d + 3] = 255;
}
fs.unlinkSync(`${tmp}.bmp`);
const photo = { data, width: PW, height: PH };
const image = fs.readFileSync(photoPath).toString('base64');

const call = async payload => {
  const t = Date.now();
  const r = await fetch(`${BASE}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image, mimeType: 'image/jpeg', ...payload }) });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  console.log(`  ${payload.previous ? 'refine' : 'draft'}: ${((Date.now() - t) / 1000).toFixed(0)}s via ${j.model}`);
  return j;
};
const project = (spec, file) => {
  const m = voxelize(sanitizeSpec(spec), { photo });
  if (m.front) spec.front = m.front;
  fs.writeFileSync(`${OUT}/${file}.json`, JSON.stringify(spec));
  const ops = spec.primitives.reduce((a, p) => ({ ...a, [p.op]: (a[p.op] || 0) + 1 }), {});
  console.log(`  ${file}: "${spec.title}" ${spec.primitives.length} shapes ${JSON.stringify(ops)}, ${m.pieces.length + 1} parts, front=${!!m.front}`);
  return m;
};
const shot = (file, t, p, out, size = 640) => {
  execFileSync(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--window-size=${size},${size}`, '--virtual-time-budget=8000',
    `--screenshot=${out}`, `${BASE}/_t/view.html?f=${file}&t=${t}&p=${p}`], { stdio: 'ignore' });
};

const draft = await call({ save: false });
project(draft.spec, `${name}-draft`);
const views = [[0, 0.12], [Math.PI / 2, 0.12], [-Math.PI / 4, 0.45]].map(([t, p], k) => {
  shot(`${name}-draft`, t, p, `${tmp}-v${k}.png`);
  execFileSync('sips', ['-s', 'format', 'jpeg', `${tmp}-v${k}.png`, '--out', `${tmp}-v${k}.jpg`], { stdio: 'ignore' });
  return fs.readFileSync(`${tmp}-v${k}.jpg`).toString('base64');
});
const fin = await call({ previous: draft.spec, views, save: false });
delete fin.spec.front;
project(fin.spec, `${name}-final`);
shot(`${name}-final`, 0, 0.12, `${tmp}-final-front.png`);
shot(`${name}-final`, -Math.PI / 4, 0.3, `${tmp}-final-34.png`);
console.log('done');
