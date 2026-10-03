import { mountTopbar, getSession, openAuth, sb } from './auth.js';
import { startAds, adSlot } from './ads.js';
import { mountHandbook } from './handbook.js';
import { sanitizeSpec, voxelize } from './voxelize.js';
import { eiffelModel, outerM, L, LAYERS, PLATE_M, STUD_M, SCALE } from './eiffel.js';
import { PARTS } from './palette.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const params = new URLSearchParams(location.search);
mountTopbar($('topbar'));
startAds();

function header(title, sub, actions = '') {
  $('head').hidden = false; $('title').textContent = title; $('sub').textContent = sub; $('actions').innerHTML = actions;
  document.title = `${title} · Brixel`;
}
const fail = html => { $('root').innerHTML = `<div class="center-msg">${html}</div>`; };
const start = () => { const n = +location.hash.slice(1); return Number.isFinite(n) && n > 0 ? n - 1 : 0; };
const onStep = i => history.replaceState(null, '', '#' + (i + 1));

(async () => {
  if (params.get('demo') === 'eiffel') {
    const model = eiffelModel();
    header('Eiffel Tower', '1:400 scale showcase · 2,796 parts · built from the real tower’s dimensions', `<a class="btn yellow" href="/">Build your own →</a>`);
    mountHandbook($('root'), model, { about: eiffelAbout(model), slot: adSlot, start: start(), onStep });
    return;
  }
  const local = params.get('local');
  if (local) {
    let saved = null; try { saved = JSON.parse(localStorage.getItem('brixel-' + local)); } catch {}
    if (!saved) return fail('This test build isn’t saved in this browser. <a href="/">Make one →</a>');
    let hb = null, showing = 'spec';
    const mount = which => {
      let model;
      try { model = voxelize(sanitizeSpec(saved[which])); } catch (e) { return fail('This design couldn’t be turned into bricks: ' + esc(e.message)); }
      const label = which === 'draft' ? 'First draft' : saved.draft ? (saved.refined === false ? 'Draft (refinement failed)' : 'Refined') : 'Local test build';
      header(model.title, `${label} · ${(model.pieces.length + 1).toLocaleString()} parts · ${model.steps.length} steps${saved[which].kind === 'relief' ? '' : ` · ${saved[which].primitives.length} AI shapes`}`,
        `${saved.draft ? `<button class="btn" id="cmp">${which === 'draft' ? 'Show refined' : 'Show first draft'}</button>` : ''}<button class="btn" id="spec">Copy AI spec</button><a class="btn yellow" href="/">+ New build</a>`);
      const about = `<div class="kicker">Local test build · ${label}</div><h2>${esc(model.title)}</h2>
        <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start">${saved.photo ? `<img class="about-photo" src="${saved.photo}" alt="Your photo">` : ''}
        <div style="flex:1;min-width:260px"><p style="margin-top:0">${esc(model.description)}</p>
        <div class="facts"><div class="fact"><b>${(model.pieces.length + 1).toLocaleString()}</b><span>parts</span></div><div class="fact"><b>${model.steps.length}</b><span>steps</span></div>
        <div class="fact"><b>${(model.H * 0.32).toFixed(1)} cm</b><span>tall on a ${model.baseplate.size}×${model.baseplate.size} baseplate</span></div>
        ${saved[which].kind === 'relief' ? `<div class="fact"><b>${saved[which].w}×${saved[which].h}</b><span>studs × plates, sculpted from your photo's depth${model.supports ? ` · ${model.supports} support plates` : ''}</span></div>`
          : `<div class="fact"><b>${saved[which].primitives.length}</b><span>shapes from the AI${model.supports ? ` · ${model.supports} support plates` : ''}</span></div>`}</div></div></div>`;
      hb?.destroy();
      hb = mountHandbook($('root'), model, { about, slot: adSlot, start: start(), onStep });
      $('spec').onclick = async () => { await navigator.clipboard.writeText(JSON.stringify(saved[which], null, 2)); $('spec').textContent = 'Copied ✓'; };
      $('cmp')?.addEventListener('click', () => { showing = showing === 'spec' ? 'draft' : 'spec'; mount(showing); });
    };
    mount('spec');
    return;
  }
  const id = params.get('id');
  if (!id) return fail('No build selected. <a href="/">Make one →</a>');
  let session = await getSession();
  let client;
  try { client = await sb(); } catch (e) { return fail(esc(e.message)); }
  let { data: row, error } = await client.from('builds').select('*').eq('id', id).maybeSingle();
  if (!row && !session) {
    session = await openAuth({ title: 'Sign in to see this build', reason: 'This build is private to its owner.' });
    if (session) ({ data: row, error } = await client.from('builds').select('*').eq('id', id).maybeSingle());
  }
  if (error || !row) return fail('This build doesn’t exist or is private. <a href="/">Make your own →</a>');

  let model;
  try { model = voxelize(sanitizeSpec(row.spec)); }
  catch (e) { return fail('This design couldn’t be turned into bricks: ' + esc(e.message)); }
  const mine = session && session.user.id === row.user_id;
  header(model.title, `${model.subtitle ? model.subtitle + ' · ' : ''}${(model.pieces.length + 1).toLocaleString()} parts · ${model.steps.length} steps`,
    mine ? `<button class="btn" id="share">${row.is_public ? 'Public link on' : 'Share'}</button><a class="btn yellow" href="/">+ New build</a>` : `<a class="btn yellow" href="/">Build your own →</a>`);

  let photoUrl = '';
  if (mine && row.image_path) {
    const { data } = await client.storage.from('uploads').createSignedUrl(row.image_path, 3600);
    photoUrl = data?.signedUrl || '';
  }
  const about = `
    <div class="kicker">About this build</div><h2>${esc(model.title)}</h2>
    <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start">
      ${photoUrl ? `<img class="about-photo" src="${esc(photoUrl)}" alt="Your original photo">` : ''}
      <div style="flex:1;min-width:260px"><p style="margin-top:0">${esc(model.description)}</p>
      <div class="facts">
        <div class="fact"><b>${(model.pieces.length + 1).toLocaleString()}</b><span>parts</span></div>
        <div class="fact"><b>${model.steps.length}</b><span>steps in ${model.sections.length} sections</span></div>
        <div class="fact"><b>${(model.H * 0.32).toFixed(1)} cm</b><span>tall on a ${model.baseplate.size}×${model.baseplate.size} baseplate</span></div>
        <div class="fact"><b>0</b><span>floating parts${model.supports ? `. ${model.supports} clear support plates hold up overhangs` : ''}</span></div>
      </div></div>
    </div>
    <p style="margin-top:22px;font-size:13px">${row.spec?.kind === 'relief' ? 'Sculpted from your photo: a depth-sensing AI model running in your browser read its 3D shape, and the colours come from the photo itself.' : 'Designed by AI from your photo.'} Brixel's brick engine converted it to standard parts, and every part connects to the baseplate through studs.</p>`;
  mountHandbook($('root'), model, { about, slot: adSlot, start: start(), onStep });

  $('share')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const next = !row.is_public;
    const { error } = await client.from('builds').update({ is_public: next }).eq('id', id);
    if (error) return alert(error.message);
    row.is_public = next;
    btn.textContent = next ? 'Public link on' : 'Share';
    if (next) { try { await navigator.clipboard.writeText(location.origin + location.pathname + '?id=' + id); alert('Anyone with the link can now see this build. The link is copied to your clipboard.'); } catch { prompt('Anyone with this link can now see the build:', location.href); } }
  });
})();

// ---------------------------------------------------------------- Eiffel accuracy page
function eiffelAbout(model) {
  const st = v => v * STUD_M, pl = v => v * PLATE_M;
  const rows = [
    ['Height to antenna tip', 330, pl(LAYERS), `${LAYERS} plates`],
    ['Original structure (1889)', 300, pl(L.TOP + 1), `${L.TOP + 1} plates`],
    ['First floor', 57.64, pl(L.FLOOR1_DECK + 1), `${L.FLOOR1_DECK + 1} plates`],
    ['Second floor', 115.73, pl(L.FLOOR2_DECK + 1), `${L.FLOOR2_DECK + 1} plates`],
    ['Third floor', 276.13, pl(L.FLOOR3_DECK + 1), `${L.FLOOR3_DECK + 1} plates`],
    ['Base square (outer corners)', 124.9, st(40), '40 studs'],
    ['Pillar footprint', 25, st(8), '8 studs'],
    ['First-floor platform', 70.69, st(22), '22 studs'],
    ['Second-floor platform', 40.96, st(12), '12 studs'],
  ].map(([name, real, mdl, units]) => {
    const err = (mdl - real) / real * 100;
    return `<tr><td>${name}</td><td class="num">${real.toFixed(2)} m</td><td class="mono">${units}</td><td class="num">${(mdl / SCALE * 100).toFixed(1)} cm</td><td class="num">${mdl.toFixed(2)} m</td><td class="num ${Math.abs(err) <= 3 ? 'good' : 'warn'}">${err >= 0 ? '+' : ''}${err.toFixed(1)}%</td></tr>`;
  }).join('');
  return `
    <div class="kicker">Showcase · accuracy</div>
    <h2>How close is it?</h2>
    <p>This model was generated by code, not drawn by hand. For each of the 258 plate layers, the program samples the real tower's outer edge and each pillar's inner edge at that height. It builds a lattice shell from those, packs it into standard plates with staggered seams, and checks that every part connects to the base. At 1:400, one stud is 3.2 m and one plate is 1.28 m.</p>
    <div class="card"><table><thead><tr><th>Feature</th><th class="num">Real</th><th>Model</th><th class="num">Size</th><th class="num">At scale</th><th class="num">Error</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h3>Silhouette vs. reference profile</h3>
    <div class="card" style="max-width:520px">${elevationSVG(model)}</div>
    <h3>What it captures</h3>
    <p>• The near-exponential curve of the legs, which Koechlin and Nouguier derived from wind loads.<br>• Four hollow lattice pillars that merge into one shaft just above the second floor.<br>• Sauvestre's four decorative arches.<br>• All three platforms at the right heights: the open centre of the first floor, the lift opening on the second, and the glazed gallery on the third.<br>• The three-tone paint scheme, darkest at the base, in Dark Brown, Reddish Brown and Medium Nougat.<br>• The campanile, the beacon, and the 2022 antenna that brought the tower to 330 m.</p>
    <p style="font-size:12px">Real-tower figures come from the Société d'Exploitation de la Tour Eiffel. This is an independent model, unrelated to LEGO's own Eiffel Tower set.</p>`;
}
function elevationSVG(model) {
  const Wd = 460, Hd = 560, m = 34, sc = (Hd - 2 * m) / 335, mid = (model.W - 1) / 2;
  const X = x => Wd / 2 + x * sc, Y = h => Hd - m - h * sc;
  const maxA = new Float32Array(LAYERS);
  for (const p of model.pieces) {
    const ext = p.cells.length ? Math.max(...p.cells.map(([i]) => Math.abs(i - mid) + 0.5)) : 0.25;
    for (let dz = 0; dz < PARTS[p.part].h; dz++) maxA[p.z + dz] = Math.max(maxA[p.z + dz], ext);
  }
  let r = '', l = '';
  for (let z = 0; z < LAYERS; z++) r += `${z ? 'L' : 'M'}${X(maxA[z] * STUD_M)},${Y(z * PLATE_M)} L${X(maxA[z] * STUD_M)},${Y((z + 1) * PLATE_M)} `;
  for (let z = LAYERS - 1; z >= 0; z--) l += `L${X(-maxA[z] * STUD_M)},${Y((z + 1) * PLATE_M)} L${X(-maxA[z] * STUD_M)},${Y(z * PLATE_M)} `;
  let ref = '', refL = '';
  for (let h = 0; h <= 300; h += 2) { ref += `${h ? 'L' : 'M'}${X(outerM(h))},${Y(h)} `; refL += `${h ? 'L' : 'M'}${X(-outerM(h))},${Y(h)} `; }
  const marks = [[57.64, '1st floor 57.6 m'], [115.73, '2nd floor 115.7 m'], [276.13, '3rd floor 276.1 m'], [300, '300 m'], [330, '330 m']];
  return `<svg viewBox="0 0 ${Wd} ${Hd}" style="width:100%;height:auto" role="img" aria-label="Model silhouette against the reference profile">
    <path d="${r}${l}Z" fill="#582A12" fill-opacity=".22" stroke="#582A12"/>
    <path d="${ref}" fill="none" stroke="#D0222E" stroke-width="1.5" stroke-dasharray="4 3"/><path d="${refL}" fill="none" stroke="#D0222E" stroke-width="1.5" stroke-dasharray="4 3"/>
    ${marks.map(([h, t]) => `<line x1="${m}" x2="${Wd - m}" y1="${Y(h)}" y2="${Y(h)}" stroke="#B9C4D0" stroke-width=".8"/><text x="${Wd - m}" y="${Y(h) - 4}" text-anchor="end" font-size="10.5" fill="#5A6676" font-family="Inter">${t}</text>`).join('')}
    <line x1="${m}" x2="${Wd - m}" y1="${Y(0)}" y2="${Y(0)}" stroke="#17202B"/>
    <g font-size="11" font-family="Inter" fill="#17202B"><rect x="${m}" y="${m - 18}" width="12" height="8" fill="#582A12" fill-opacity=".35" stroke="#582A12"/><text x="${m + 18}" y="${m - 10}">model</text>
    <line x1="${m + 70}" x2="${m + 86}" y1="${m - 14}" y2="${m - 14}" stroke="#D0222E" stroke-width="1.5" stroke-dasharray="4 3"/><text x="${m + 92}" y="${m - 10}">reference outer edge</text></g></svg>`;
}
