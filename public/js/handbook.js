// The instruction handbook UI (steps, plans, parts list) around a viewer.
import { COLORS, PARTS } from './palette.js';
import { tally } from './engine.js';
import { createViewer } from './viewer.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = n => n.toLocaleString('en-US');

// ---------------------------------------------------------------- part icons
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const mix = f > 1 ? (v => v + (255 - v) * (f - 1)) : (v => v * f);
  [r, g, b] = [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(mix(v)))));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
export function partSVG(partKey, colorKey) {
  const def = partKey === 'BASEPLATE' ? { w: 6, d: 6, h: 0.375, shape: 'box' } : PARTS[partKey];
  const col = COLORS[colorKey], hex = col.hex;
  const w = def.w, d = def.d, h = def.h * 0.4;
  const C = Math.cos(Math.PI / 6), S = 0.5;
  const P = (x, y, z) => [(x - y) * C, (x + y) * S - z];
  const top = shade(hex, 1.25), left = shade(hex, 0.85), right = shade(hex, 0.62), stroke = shade(hex, 0.35);
  const out = [], pts = [];
  const stud = (x, y, z) => {
    const r = 0.3, [x0, y0] = P(x, y, z), [x1, y1] = P(x, y, z + 0.17), rx = r * C * Math.SQRT2, ry = r * S * Math.SQRT2;
    return `<path d="M${x0 - rx},${y0} A${rx},${ry} 0 0 0 ${x0 + rx},${y0} L${x1 + rx},${y1} A${rx},${ry} 0 0 1 ${x1 - rx},${y1} Z" fill="${left}" stroke="${stroke}" stroke-width=".03"/><ellipse cx="${x1}" cy="${y1}" rx="${rx}" ry="${ry}" fill="${top}" stroke="${stroke}" stroke-width=".03"/>`;
  };
  if (def.shape === 'round') {
    const r = w / 2, ell = z => { const [x0, y0] = P(r, r, z); return { x0, y0, rx: r * C * Math.SQRT2, ry: r * S * Math.SQRT2 }; };
    const b = ell(0), t = ell(h);
    out.push(`<path d="M${b.x0 - b.rx},${b.y0} A${b.rx},${b.ry} 0 0 0 ${b.x0 + b.rx},${b.y0} L${t.x0 + t.rx},${t.y0} A${t.rx},${t.ry} 0 0 1 ${t.x0 - t.rx},${t.y0} Z" fill="${left}" stroke="${stroke}" stroke-width=".04"/>`,
      `<ellipse cx="${t.x0}" cy="${t.y0}" rx="${t.rx}" ry="${t.ry}" fill="${top}" stroke="${stroke}" stroke-width=".04"/>`);
    pts.push([b.x0 - b.rx, b.y0 + b.ry], [b.x0 + b.rx, t.y0 - t.ry - 0.3]);
    for (const [a, c] of (w === 2 ? [[0.5, 0.5], [1.5, 0.5], [0.5, 1.5], [1.5, 1.5]] : [[0.5, 0.5]])) out.push(stud(a, c, h));
  } else {
    const A = P(0, 0, h), B = P(w, 0, h), Cc = P(w, d, h), D = P(0, d, h), B0 = P(w, 0, 0), C0 = P(w, d, 0), D0 = P(0, d, 0);
    const poly = (arr, fill) => `<polygon points="${arr.map(q => q.join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width=".04" stroke-linejoin="round"/>`;
    out.push(poly([D, Cc, C0, D0], left), poly([B, Cc, C0, B0], right), poly([A, B, Cc, D], top));
    pts.push(A, B0, C0, D0, P(0, 0, h + 0.3), P(w, d, h + 0.3));
    if (def.shape === 'jumper') out.push(stud(1, 1, h));
    else for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push(stud(i + 0.5, j + 0.5, h));
  }
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  const x0 = Math.min(...xs) - 0.15, y0 = Math.min(...ys) - 0.15;
  return `<svg viewBox="${x0} ${y0} ${Math.max(...xs) + 0.15 - x0} ${Math.max(...ys) + 0.15 - y0}" opacity="${col.trans ? 0.7 : 1}" aria-hidden="true">${out.join('')}</svg>`;
}
const partLabel = k => { const d = PARTS[k]; return d.shape === 'box' ? `${d.w}×${d.d}` : d.name.replace(/^(Plate|Brick), /, '').replace('Plate 2 x 2 with 1 Center Stud', 'Jumper 2×2'); };

// ---------------------------------------------------------------- handbook
export function mountHandbook(root, model, opts = {}) {
  const { pieces, steps, sections, W } = model;
  const totalParts = pieces.length + 1;
  const byLayer = new Map();
  pieces.forEach((p, k) => { if (!byLayer.has(p.z)) byLayer.set(p.z, []); byLayer.get(p.z).push(k); });
  const plateM = model.plateM, heightOf = z => plateM ? `${(z * plateM).toFixed(1)} m` : `${(z * 3.2 / 10).toFixed(1)} cm`;

  root.innerHTML = `
  <div class="hb">
    <div class="hb-tabs" role="tablist">
      <button class="on" data-tab="build">Build</button><button data-tab="parts">Parts (${fmt(totalParts)})</button><button data-tab="about">About</button>
    </div>
    <section class="hb-view on" data-view="build">
      <aside class="toc"></aside>
      <div class="stage">
        <div class="stage-host"></div>
        <div class="stage-tools">
          <button class="chip on" data-act="follow">Follow</button>
          <button class="chip" data-act="spin">Orbit</button>
          <button class="chip" data-act="overview">Whole model</button>
        </div>
        <div class="stepnum"></div>
        <div class="navbar">
          <button class="ghost" data-act="prev" aria-label="Previous step">‹</button>
          <button data-act="next" aria-label="Next step">›</button>
          <input type="range" min="0" max="${steps.length - 1}" value="0" aria-label="Step">
          <div class="count mono"></div>
        </div>
      </div>
      <aside class="panel"></aside>
    </section>
    <section class="hb-view doc" data-view="parts"><div class="doc-inner parts-doc"></div></section>
    <section class="hb-view doc" data-view="about"><div class="doc-inner about-doc"></div></section>
  </div>`;
  const $ = s => root.querySelector(s);
  let cur = 0;
  const viewer = createViewer($('.stage-host'), model, { current: () => cur });

  // table of contents
  { let html = '', last = -2;
    steps.forEach((s, i) => {
      if (s.section !== last) { last = s.section; html += `<div class="sec"><i>${s.section + 1}</i>${s.section < 0 ? 'Getting started' : esc(sections[s.section].name)}</div>`; }
      const lay = s.layers.length ? `L${s.layers[0] + 1}${s.layers.length > 1 ? '–' + (s.layers[s.layers.length - 1] + 1) : ''}${s.quadrant ? ' · Q' + s.quadrant : ''}` : 'base';
      html += `<div class="st" data-i="${i}">Step ${i + 1}<span>${lay}</span></div>`;
    });
    $('.toc').innerHTML = html;
    $('.toc').addEventListener('click', e => { const el = e.target.closest('.st'); if (el) go(+el.dataset.i); }); }

  function drawPlan(canvas, z) {
    const curSet = new Set(steps[cur].pieces), here = byLayer.get(z) || [], below = byLayer.get(z - 1) || [];
    let lo = W, hi = -1;
    for (const k of [...here, ...below]) for (const [i, j] of (pieces[k].cells.length ? pieces[k].cells : [[pieces[k].x, pieces[k].y]])) { lo = Math.min(lo, i, j); hi = Math.max(hi, i, j); }
    if (hi < 0) { lo = W / 2 - 2; hi = W / 2 + 1; }
    lo = Math.max(0, Math.floor(lo) - 1); hi = Math.min(W - 1, Math.ceil(hi) + 1);
    const span = hi - lo + 1, cssW = canvas.clientWidth || 340, pad = 22, cs = Math.min(26, (cssW - pad - 6) / span);
    const Wc = pad + span * cs + 6, dpr = Math.min(devicePixelRatio, 2);
    canvas.width = Wc * dpr; canvas.height = Wc * dpr; canvas.style.height = Wc + 'px';
    const g = canvas.getContext('2d'); g.scale(dpr, dpr);
    const X = i => pad + (i - lo) * cs;
    g.strokeStyle = '#E3E9F0'; g.lineWidth = 1;
    for (let i = lo; i <= hi + 1; i++) { g.beginPath(); g.moveTo(X(i), pad); g.lineTo(X(i), pad + span * cs); g.stroke(); g.beginPath(); g.moveTo(pad, X(i)); g.lineTo(pad + span * cs, X(i)); g.stroke(); }
    g.fillStyle = '#8A96A6'; g.font = '600 9px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = lo; i <= hi; i++) if ((i + 1) % 2 === 0 || span < 14) { g.fillText(String(i + 1), X(i) + cs / 2, pad / 2); g.fillText(String(i + 1), pad / 2, X(i) + cs / 2); }
    g.fillStyle = 'rgba(70,130,210,.16)';
    for (const k of below) for (const [i, j] of pieces[k].cells) g.fillRect(X(i) + 1, X(j) + 1, cs - 2, cs - 2);
    const draw = (k, active) => {
      const p = pieces[k], c = COLORS[p.color];
      g.globalAlpha = active ? 1 : 0.38;
      if (!p.cells.length || PARTS[p.part].shape === 'round') {
        g.fillStyle = c.hex; g.beginPath(); g.arc(X(p.x) + cs / 2, X(p.y) + cs / 2, PARTS[p.part].w * cs / 2 - 1.5, 0, Math.PI * 2); g.fill();
        if (active) { g.strokeStyle = '#111'; g.lineWidth = 1.6; g.stroke(); }
      } else {
        const is = p.cells.map(q => q[0]), js = p.cells.map(q => q[1]);
        const x0 = X(Math.min(...is)), y0 = X(Math.min(...js)), w = (Math.max(...is) - Math.min(...is) + 1) * cs, h = (Math.max(...js) - Math.min(...js) + 1) * cs;
        g.fillStyle = c.hex; g.fillRect(x0 + 1, y0 + 1, w - 2, h - 2);
        if (active) { g.strokeStyle = '#111'; g.lineWidth = 1.6; g.strokeRect(x0 + 1.5, y0 + 1.5, w - 3, h - 3); }
        if (cs >= 9) { g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; for (const [i, j] of p.cells) { g.beginPath(); g.arc(X(i) + cs / 2, X(j) + cs / 2, cs * 0.28, 0, Math.PI * 2); g.stroke(); } }
      }
      g.globalAlpha = 1;
    };
    for (const k of here) if (!curSet.has(k)) draw(k, false);
    for (const k of here) if (curSet.has(k)) draw(k, true);
    const axis = X((W - 1) / 2) + cs / 2;
    g.strokeStyle = 'rgba(200,16,46,.5)'; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(axis, pad); g.lineTo(axis, pad + span * cs); g.stroke();
    g.beginPath(); g.moveTo(pad, axis); g.lineTo(pad + span * cs, axis); g.stroke(); g.setLineDash([]);
  }

  function renderPanel() {
    const s = steps[cur], panel = $('.panel'), bp = model.baseplate;
    if (s.baseplate) {
      panel.innerHTML = `
        <div class="sec-title">Getting started</div>
        <h2>Lay the baseplate</h2>
        <p class="blurb">Put a <b>${bp.size} × ${bp.size} ${COLORS[bp.color].name} baseplate</b> (${bp.id}) on a flat, level surface. The model is built up from it one plate at a time.</p>
        <div class="callout"><div class="part">${partSVG('BASEPLATE', bp.color)}<b>1×</b><span>${bp.size}×${bp.size}<br>${bp.id} · ${COLORS[bp.color].name}</span></div></div>
        <div class="tip"><b>Reading the plans.</b> Each step shows a top-down plan of the layer you're building. The numbers on the edges are stud positions on the baseplate. New parts have a <b>black outline</b>, blue squares show the layer underneath, and the red dashed lines mark the centre of the model.</div>
        <div class="tip"><b>Q1–Q4 steps</b> split a big layer into quarters. Turn the model a quarter turn each time; the 3D view does this for you.</div>
        ${opts.slot ? opts.slot('panel') : ''}`;
      return;
    }
    const sec = sections[s.section], z0 = s.layers[0], z1 = s.layers[s.layers.length - 1];
    const first = steps[cur - 1] && steps[cur - 1].section !== s.section;
    const t = tally(pieces, s.pieces), zl = [...new Set(s.pieces.map(k => pieces[k].z))].sort((a, b) => a - b);
    const note = model.note ? model.note(z0, z1) : '';
    panel.innerHTML = `
      <div class="sec-title">Section ${s.section + 1} · ${esc(sec.name)}</div>
      <h2>Step ${cur + 1}${s.quadrant ? ` <small>quarter ${s.quadrant}</small>` : ''}</h2>
      <div class="meta"><span class="tag">Layer <b>${z0 + 1}${z1 > z0 ? '–' + (z1 + 1) : ''}</b></span><span class="tag">${plateM ? 'Real height' : 'Height'} <b>${heightOf(z0)}</b></span><span class="tag"><b>${s.pieces.length}</b> parts</span></div>
      ${first && sec.blurb ? `<p class="blurb">${esc(sec.blurb)}</p>` : ''}
      ${note ? `<div class="tip">${note}</div>` : ''}
      <div class="callout">${t.map(x => `<div class="part">${partSVG(x.part, x.color)}<b>${x.n}×</b><span>${partLabel(x.part)}<br>${COLORS[x.color].name}</span></div>`).join('')}</div>
      <div class="plans">${zl.map(z => `<h4><span>Layer ${z + 1}</span><span class="mono">${heightOf(z)}</span></h4><canvas data-z="${z}"></canvas>`).join('')}
        <div class="legend"><span><i style="background:#111"></i>new this step</span><span><i style="background:rgba(70,130,210,.3)"></i>layer below</span><span><i style="background:#999;opacity:.5"></i>placed earlier</span></div>
      </div>
      ${opts.slot && cur % 6 === 0 ? opts.slot('panel') : ''}`;
    panel.querySelectorAll('canvas').forEach(cv => drawPlan(cv, +cv.dataset.z));
  }

  function go(i) {
    cur = Math.max(0, Math.min(steps.length - 1, i));
    viewer.show(cur);
    $('input[type=range]').value = cur;
    $('.count').textContent = `${cur + 1} / ${steps.length}`;
    const s = steps[cur];
    $('.stepnum').innerHTML = `${cur + 1}<small>${s.section < 0 ? 'Start' : esc(sections[s.section].name)}</small>`;
    root.querySelectorAll('.toc .st').forEach(el => el.classList.toggle('on', +el.dataset.i === cur));
    const on = root.querySelector('.toc .st.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    renderPanel();
    viewer.frame(cur);
    opts.onStep?.(cur);
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act],[data-tab]'); if (!b) return;
    if (b.dataset.tab) {
      root.querySelectorAll('.hb-tabs button').forEach(x => x.classList.toggle('on', x === b));
      root.querySelectorAll('.hb-view').forEach(v => v.classList.toggle('on', v.dataset.view === b.dataset.tab));
      return;
    }
    const a = b.dataset.act;
    if (a === 'prev') go(cur - 1);
    if (a === 'next') go(cur + 1);
    if (a === 'follow') { const v = !b.classList.contains('on'); b.classList.toggle('on', v); viewer.setFollow(v); }
    if (a === 'spin') { const v = !b.classList.contains('on'); b.classList.toggle('on', v); viewer.setSpin(v); }
    if (a === 'overview') { root.querySelector('[data-act=follow]').classList.remove('on'); viewer.setFollow(false); viewer.show(steps.length - 1, true); viewer.overview(); }
  });
  $('input[type=range]').addEventListener('input', e => go(+e.target.value));
  addEventListener('keydown', e => {
    if (!root.querySelector('[data-view=build].on') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(cur + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1); }
  });

  // parts tab
  { const all = tally(pieces), bp = model.baseplate;
    const rows = [{ id: bp.id, color: COLORS[bp.color].bl, n: 1, name: bp.name, cname: COLORS[bp.color].name },
      ...all.map(x => ({ id: PARTS[x.part].id, color: COLORS[x.color].bl, n: x.n, name: PARTS[x.part].name, cname: COLORS[x.color].name }))];
    $('.parts-doc').innerHTML = `
      <div class="kicker">Bill of materials</div>
      <h2>${fmt(totalParts)} parts · ${rows.length} lots</h2>
      <p>All of them are current, standard parts. Part numbers are design IDs and colours are BrickLink names and IDs. Upload the XML file to BrickLink as a wanted list to buy everything in one go.</p>
      <div class="row-actions"><button class="btn primary" data-dl="xml">BrickLink wanted list (.xml)</button><button class="btn" data-dl="csv">CSV</button></div>
      ${opts.slot ? opts.slot('wide') : ''}
      <div class="bom-grid">${[{ part: 'BASEPLATE', color: bp.color, n: 1, label: bp.name, id: bp.id }, ...all.map(x => ({ ...x, label: PARTS[x.part].name, id: PARTS[x.part].id }))]
        .map(x => `<div class="bom-item">${partSVG(x.part, x.color)}<div><b>${fmt(x.n)}×</b><span>${x.label}</span><span class="mono">${x.id} · ${COLORS[x.color].name}</span></div></div>`).join('')}</div>`;
    const slug = (model.title || 'build').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    $('.parts-doc').addEventListener('click', e => {
      const t = e.target.closest('[data-dl]')?.dataset.dl; if (!t) return;
      const text = t === 'xml'
        ? `<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>\n${rows.map(r => `  <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${r.id}</ITEMID><COLOR>${r.color}</COLOR><MINQTY>${r.n}</MINQTY></ITEM>`).join('\n')}\n</INVENTORY>\n`
        : 'Part,Description,Color,BrickLink Color ID,Quantity\n' + rows.map(r => `${r.id},"${r.name}",${r.cname},${r.color},${r.n}`).join('\n') + '\n';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: t === 'xml' ? 'application/xml' : 'text/csv' }));
      a.download = `${slug}-${t === 'xml' ? 'bricklink.xml' : 'parts.csv'}`; a.click();
    }); }

  // about tab
  $('.about-doc').innerHTML = opts.about || `
    <div class="kicker">About this build</div><h2>${esc(model.title)}</h2>
    <p>${esc(model.description || '')}</p>
    <div class="facts">
      <div class="fact"><b>${fmt(totalParts)}</b><span>parts</span></div>
      <div class="fact"><b>${steps.length}</b><span>steps in ${sections.length} sections</span></div>
      <div class="fact"><b>${(model.H * 0.32).toFixed(1)} cm</b><span>tall on a ${model.baseplate.size}×${model.baseplate.size} baseplate</span></div>
      <div class="fact"><b>0</b><span>floating parts: every part connects to the base through studs${model.supports ? ` (${model.supports} clear support plates added)` : ''}</span></div>
    </div>`;

  go(opts.start || 0);
  viewer.frame(cur, true);
  return { go, viewer, get step() { return cur; } };
}
