import { mountTopbar, getSession, openAuth, sb, savePending, loadPending, clearPending } from './auth.js';
import { startAds } from './ads.js';
import { eiffelModel } from './eiffel.js';
import { createViewer } from './viewer.js';

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
}
$('file').onchange = e => choose(e.target.files[0]);
const drop = $('drop');
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => choose(e.dataTransfer.files[0]));
addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])][0]; if (f) choose(f); });

$('buildBtn').onclick = async () => {
  if (!photo) return;
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

// ---------------------------------------------------------------- generation
const STAGES = ['Uploading your photo', 'Designing the model with Gemini', 'Saving your build'];
async function generate(session, ph) {
  const ov = document.createElement('div');
  ov.className = 'progress';
  ov.innerHTML = `<div class="box"><img src="${ph.url}" alt=""><h2 style="margin:18px 0 0;letter-spacing:-.02em">Building your model…</h2>
    <p style="color:var(--ink2);margin:6px 0 0">This usually takes 20 to 60 seconds.</p><ol>${STAGES.map(s => `<li>${s}</li>`).join('')}</ol><div class="err" hidden></div></div>`;
  document.body.appendChild(ov);
  const lis = ov.querySelectorAll('li');
  const stage = i => lis.forEach((li, k) => { li.className = k < i ? 'done' : k === i ? 'on' : ''; });
  try {
    stage(0);
    const client = await sb();
    const path = `${session.user.id}/${crypto.randomUUID()}.jpg`;
    const up = await client.storage.from('uploads').upload(path, ph.blob, { contentType: 'image/jpeg' });
    if (up.error) throw new Error('Upload failed: ' + up.error.message);
    stage(1);
    const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(ph.blob); });
    const tick = setTimeout(() => stage(2), 45000);
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ image: b64, mimeType: 'image/jpeg', imagePath: path }),
    });
    clearTimeout(tick);
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `The design service failed (${res.status}).`);
    stage(3);
    await clearPending();
    location.href = `/build.html?id=${encodeURIComponent(out.id)}`;
  } catch (err) {
    const e = ov.querySelector('.err');
    e.hidden = false;
    e.innerHTML = `${String(err.message || err).replace(/</g, '&lt;')}<br><br><button class="btn" onclick="this.closest('.progress').remove()">Close</button>`;
    lis.forEach(li => li.classList.remove('on'));
  }
}
