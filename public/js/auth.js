// Supabase client, sign-in modal, and the shared top bar.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SITE_NAME = 'Brixel';

let cfgP = null, client = null;
export function getConfig() {
  cfgP ||= fetch('/api/config').then(r => { if (!r.ok) throw new Error('config'); return r.json(); })
    .catch(() => ({ supabaseUrl: '', supabaseAnonKey: '', googleAuth: false, adsenseClient: '', adSlots: {} }));
  return cfgP;
}
export async function sb() {
  if (client) return client;
  const c = await getConfig();
  if (!c.supabaseUrl || !c.supabaseAnonKey) throw new Error('Sign-in isn’t configured yet: set SUPABASE_URL and SUPABASE_ANON_KEY.');
  client = createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  return client;
}
export async function getSession() {
  try { const { data } = await (await sb()).auth.getSession(); return data.session; } catch { return null; }
}

// ---------------------------------------------------------------- top bar
export async function mountTopbar(el) {
  el.innerHTML = `
    <a class="logo" href="/"><span class="logo-mark"><i></i><i></i><i></i><i></i></span>${SITE_NAME}</a>
    <nav class="topnav">
      <a href="/build.html?demo=eiffel" class="hide-sm">Showcase</a>
      <a href="/builds.html" data-auth="in" hidden>My builds</a>
      <button data-auth="out" class="solid" data-signin>Sign in</button>
      <button data-auth="in" data-signout hidden>Sign out</button>
    </nav>`;
  const s = await getSession();
  el.querySelectorAll('[data-auth]').forEach(n => { n.hidden = (n.dataset.auth === 'in') !== !!s; });
  el.querySelector('[data-signin]').onclick = async () => { if (await openAuth()) location.reload(); };
  el.querySelector('[data-signout]').onclick = async () => { await (await sb()).auth.signOut(); location.href = '/'; };
}

// ---------------------------------------------------------------- auth modal
// Resolves with a session, or null if the user closes it / must confirm by email.
export function openAuth({ title, reason } = {}) {
  return new Promise(async resolve => {
    const cfg = await getConfig();
    let mode = 'signup';
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const render = (msg = '', kind = 'err') => {
      bg.innerHTML = `
        <form class="modal" novalidate>
          <button type="button" class="x" aria-label="Close">×</button>
          <h3>${title || (mode === 'signup' ? 'Create your free account' : 'Welcome back')}</h3>
          <p>${reason || 'Builds are free and unlimited. An account keeps them saved so you can come back to them.'}</p>
          ${cfg.googleAuth ? `<button type="button" class="btn" data-google>Continue with Google</button><div class="or">or with email</div>` : ''}
          <label for="em">Email</label><input id="em" type="email" autocomplete="email" required>
          <label for="pw">Password</label><input id="pw" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="6" required>
          <button class="btn primary" type="submit">${mode === 'signup' ? 'Create account' : 'Sign in'}</button>
          ${msg ? `<div class="${kind}">${msg}</div>` : ''}
          <div class="switch">${mode === 'signup' ? 'Already have an account? <button type="button" data-switch>Sign in</button>' : 'New here? <button type="button" data-switch>Create an account</button>'}</div>
        </form>`;
      bg.querySelector('.x').onclick = () => close(null);
      bg.querySelector('[data-switch]').onclick = () => { mode = mode === 'signup' ? 'signin' : 'signup'; render(); };
      bg.querySelector('[data-google]')?.addEventListener('click', async () => {
        await (await sb()).auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/?resume=1' } });
      });
      bg.querySelector('form').onsubmit = submit;
      setTimeout(() => bg.querySelector('#em')?.focus(), 30);
    };
    const close = v => { bg.remove(); resolve(v); };
    async function submit(e) {
      e.preventDefault();
      const email = bg.querySelector('#em').value.trim(), password = bg.querySelector('#pw').value;
      if (!email || password.length < 6) return render('Enter an email and a password of at least 6 characters.');
      try {
        const auth = (await sb()).auth;
        if (mode === 'signup') {
          const { data, error } = await auth.signUp({ email, password, options: { emailRedirectTo: location.origin + '/?resume=1' } });
          if (error) throw error;
          if (data.session) return close(data.session);
          render(`Check <b>${email.replace(/</g, '&lt;')}</b> for a confirmation link. Your photo is saved here, and the build starts when you come back.`, 'ok');
        } else {
          const { data, error } = await auth.signInWithPassword({ email, password });
          if (error) throw error;
          close(data.session);
        }
      } catch (err) { render(err.message || 'Something went wrong.'); }
    }
    bg.addEventListener('mousedown', e => { if (e.target === bg) close(null); });
    render();
    document.body.appendChild(bg);
  });
}

// ---------------------------------------------------------------- pending photo (survives redirects)
const DB = 'brixel', STORE = 'pending';
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = async (mode, fn) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const out = fn(t.objectStore(STORE)); t.oncomplete = () => res(out.result); t.onerror = () => rej(t.error); }); };
export const savePending = blob => tx('readwrite', s => s.put(blob, 'photo')).catch(() => {});
export const loadPending = () => tx('readonly', s => s.get('photo')).catch(() => null);
export const clearPending = () => tx('readwrite', s => s.delete('photo')).catch(() => {});
