import { mountTopbar, getSession, openAuth, sb, savePending, loadPending, clearPending, getConfig } from './auth.js';
import { startAds } from './ads.js';
import { eiffelModel } from './eiffel.js';
import { createViewer } from './viewer.js';
import { estimateDepth, loadDepth, estimateMask, loadSegmenter } from './depth.js';
import { buildRelief } from './relief.js';
import { sanitizeSpec, voxelize } from './voxelize.js';

const $ = id => document.getElementById(id);
mountTopbar($('topbar'));
startAds();

// showcase: the finished Eiffel Tower, slowly turning
{
  const model = eiffelModel();
  const v = createViewer($('showcase'), model, { showcase: true });
  v.show(model.steps.length - 1, true);
  v.overview();
}

// ---------------------------------------------------------------- photo picking
let photo = null; // { blob, url }
async function prepare(file) {
  // downscale to <= 1024 px JPEG: plenty for Gemini, small to upload
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const s = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
  return { blob, url: URL.createObjectURL(blob) };
}
async function choose(file) {
  if (!file || !file.type.startsWith('image/') && !/\.hei[cf]$/i.test(file.name)) return alert('Please choose an image file.');
  try { photo = await prepare(file); }
  catch { return alert('That image couldn’t be read in this browser. Try a JPG or PNG.'); }
  $('previewImg').src = photo.url;
  $('dropIdle').hidden = true; $('dropReady').hidden = false;
  $('buildBtn').disabled = false;
  $('buildBtn').focus();
  loadDepth().catch(() => {}); loadSegmenter().catch(() => {});   // start the one-time model downloads early
}
$('file').onchange = e => choose(e.target.files[0]);
const drop = $('drop');
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => choose(e.dataTransfer.files[0]));
addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])][0]; if (f) choose(f); });

$('buildBtn').onclick = async () => {
  if (!photo) return;
  if ((await getConfig()).skipAuth) return generate(null, photo);   // local test mode (localhost only)
  let session = await getSession();
  if (!session) {
    await savePending(photo.blob);
    session = await openAuth({ title: 'One quick step', reason: 'Make a free account to build your model. Builds are unlimited, and your account keeps them saved.' });
    if (!session) return;
  }
  generate(session, photo);
};

// resume after email confirmation / OAuth redirect
(async () => {
  const blob = await loadPending();
  if (!blob) return;
  const session = await getSession();
  if (!session) {
    if (new URLSearchParams(location.search).has('resume')) { photo = { blob, url: URL.createObjectURL(blob) }; $('previewImg').src = photo.url; $('dropIdle').hidden = true; $('dropReady').hidden = false; $('buildBtn').disabled = false; }
    return;
  }
  generate(session, { blob, url: URL.createObjectURL(blob) });
})();

// ---------------------------------------------------------------- generation (all in the browser)
const STAGES = ['Uploading your photo', 'Loading the vision models', 'Finding the subject and its 3D shape', 'Building it in bricks', 'Saving your build'];
async function generate(session, ph) {
  const ov = document.createElement('div');
  ov.className = 'progress';
  ov.innerHTML = `<div class="box"><img src="${ph.url}" alt=""><h2 style="margin:18px 0 0;letter-spacing:-.02em">Building your model…</h2>
    <p style="color:var(--ink2);margin:6px 0 0">Everything runs on your device: free, private, and no waiting in line.</p><ol>${STAGES.map(s => `<li>${s}</li>`).join('')}</ol><div class="err" hidden></div></div>`;
  document.body.appendChild(ov);
  const lis = ov.querySelectorAll('li');
  const stage = (i, note) => lis.forEach((li, k) => { li.className = k < i ? 'done' : k === i ? 'on' : ''; li.textContent = STAGES[k] + (k === i && note ? ` · ${note}` : ''); });
  try {
    stage(0);
    let path = null, client = null;
    if (session) {
      client = await sb();
      path = `${session.user.id}/${crypto.randomUUID()}.jpg`;
      const up = await client.storage.from('uploads').upload(path, ph.blob, { contentType: 'image/jpeg' });
      if (up.error) throw new Error('Upload failed: ' + up.error.message);
    }
    const naming = nameIt(ph.blob);   // optional, runs alongside
    stage(1);
    // both models download in parallel (first visit only, ~70 MB total), then run on this device
    const prog = {}; const report = key => (f, total) => { prog[key] = [f * total, total]; const l = Object.values(prog).reduce((a, [x]) => a + x, 0), t = Object.values(prog).reduce((a, [, y]) => a + y, 0); stage(1, `${Math.round(l / t * 100)}% of ${(t / 1e6).toFixed(0)} MB (first time only)`); };
    await Promise.all([loadDepth(report('d')), loadSegmenter(report('s')).catch(() => null)]);
    stage(2);
    // one after the other: two WebAssembly sessions at once is unreliable on some devices
    const depth = await estimateDepth(ph.blob);
    const alpha = await estimateMask(ph.blob);
    const photo = await pixels(ph.blob);
    stage(3);
    await new Promise(r => setTimeout(r, 30));
    const spec = buildRelief(photo, depth, { width: SIZES[$('size').value] || 36, alpha });
    voxelize(sanitizeSpec(spec));                      // make sure it builds before saving
    Object.assign(spec, await naming);
    stage(4);
    await clearPending();
    if (session) {
      const { data, error } = await client.from('builds').insert({ title: spec.title, subject: spec.subject, description: spec.description, spec, image_path: path, model: 'depth-anything-v2-small' }).select('id').single();
      if (error) throw new Error('Saving failed: ' + error.message);
      location.href = `/build.html?id=${encodeURIComponent(data.id)}`;
      return;
    }
    // local test mode: keep the build in this browser only
    const key = 'local-' + Date.now().toString(36), rec = { spec, photo: await small(ph.blob) };
    try { localStorage.setItem('brixel-' + key, JSON.stringify(rec)); } catch { delete rec.photo; localStorage.setItem('brixel-' + key, JSON.stringify(rec)); }
    location.href = `/build.html?local=${key}`;
  } catch (err) {
    console.error(err);
    const e = ov.querySelector('.err');
    e.hidden = false;
    e.innerHTML = `${String(err.message || err).replace(/</g, '&lt;')}<br><br><button class="btn" onclick="this.closest('.progress').remove()">Close</button>`;
    lis.forEach(li => li.classList.remove('on'));
  }
}
const SIZES = { small: 24, medium: 36, large: 46 };

// a short name for the build from a free, tiny AI call; falls back to "My build"
async function nameIt(blob) {
  const fallback = { title: 'My build', subject: '', description: '' };
  try {
    const img = await createImageBitmap(blob), s = Math.min(1, 384 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const image = c.toDataURL('image/jpeg', 0.8).split(',')[1];
    const r = await fetch('/api/name', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image }), signal: AbortSignal.timeout(12000) });
    return r.ok ? { ...fallback, ...(await r.json()) } : fallback;
  } catch { return fallback; }
}

async function pixels(blob) {
  const img = await createImageBitmap(blob), c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

// small thumbnail data URL for locally-kept test builds
async function small(blob) {
  const img = await createImageBitmap(blob), s = Math.min(1, 360 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

