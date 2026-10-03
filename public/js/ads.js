// Google AdSense slots. Configure ADSENSE_CLIENT (ca-pub-…) and the slot IDs as
// Cloudflare env vars; until then, slots render as dashed placeholders on localhost
// and as nothing in production.
import { getConfig } from './auth.js';

export const adSlot = kind => `<div class="ad ad-${kind}" data-ad="${kind}"></div>`;

let loaded = false;
export async function startAds() {
  const cfg = await getConfig();
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const fill = el => {
    if (el.dataset.filled) return; el.dataset.filled = '1';
    const slot = cfg.adSlots?.[el.dataset.ad];
    if (cfg.adsenseClient && slot) {
      if (!loaded) {
        loaded = true;
        const s = document.createElement('script');
        s.async = true; s.crossOrigin = 'anonymous';
        s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(cfg.adsenseClient)}`;
        document.head.appendChild(s);
      }
      el.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${cfg.adsenseClient}" data-ad-slot="${slot}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } else if (local) {
      el.classList.add('placeholder'); el.textContent = `Ad slot · ${el.dataset.ad}`;
    }
  };
  document.querySelectorAll('[data-ad]').forEach(fill);
  new MutationObserver(() => document.querySelectorAll('[data-ad]:not([data-filled])').forEach(fill))
    .observe(document.body, { childList: true, subtree: true });
}
