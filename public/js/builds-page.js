import { mountTopbar, getSession, openAuth, sb } from './auth.js';
import { startAds } from './ads.js';

const list = document.getElementById('list');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
mountTopbar(document.getElementById('topbar'));
startAds();

(async () => {
  let session = await getSession();
  if (!session) session = await openAuth({ title: 'Sign in to see your builds' });
  if (!session) { list.innerHTML = `<div class="empty">Sign in to see your builds.</div>`; return; }
  const client = await sb();
  const { data, error } = await client.from('builds').select('id,title,subject,image_path,created_at,is_public')
    .eq('user_id', session.user.id).order('created_at', { ascending: false });
  if (error) { list.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  if (!data.length) { list.innerHTML = `<div class="empty">No builds yet. <a href="/">Upload a photo →</a></div>`; return; }
  const paths = data.map(b => b.image_path).filter(Boolean);
  const urls = {};
  if (paths.length) {
    const { data: signed } = await client.storage.from('uploads').createSignedUrls(paths, 3600);
    (signed || []).forEach(s => { if (s.signedUrl) urls[s.path] = s.signedUrl; });
  }
  list.innerHTML = data.map(b => `
    <a class="bcard" href="/build.html?id=${b.id}">
      ${urls[b.image_path] ? `<img src="${esc(urls[b.image_path])}" alt="" loading="lazy">` : '<div class="ph"></div>'}
      <div class="body"><div><b>${esc(b.title)}</b><span>${new Date(b.created_at).toLocaleDateString()}${b.is_public ? ' · public' : ''}</span></div>
      <button data-del="${b.id}" data-path="${esc(b.image_path || '')}" aria-label="Delete ${esc(b.title)}">Delete</button></div>
    </a>`).join('');
  list.addEventListener('click', async e => {
    const btn = e.target.closest('[data-del]'); if (!btn) return;
    e.preventDefault();
    if (!confirm('Delete this build? This can’t be undone.')) return;
    const { error } = await client.from('builds').delete().eq('id', btn.dataset.del);
    if (error) return alert(error.message);
    if (btn.dataset.path) await client.storage.from('uploads').remove([btn.dataset.path]);
    btn.closest('.bcard').remove();
  });
})();
