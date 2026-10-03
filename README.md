# Brixel

**Any photo, built in bricks.** Upload a photo of anything. Brixel designs a brick model of it and gives you step-by-step building instructions: a 3D view of every step, top-down layer plans, and a parts list you can export to BrickLink.

- **Frontend:** static HTML and ES modules with no build step (three.js and supabase-js from a CDN), in `public/`
- **Backend:** Cloudflare Pages Functions in `functions/api/`
- **Auth, database and storage:** Supabase
- **AI:** Groq and/or Google Gemini (vision models, JSON output), with automatic fallback between them
- **Revenue:** Google AdSense slots (optional)

## How it works

Building a model costs nothing and has no limits: the AI runs in the visitor's browser.

1. The browser shrinks the photo to 1024 px or less. Signed-in users' photos go to their private folder in Supabase Storage.
2. **Depth:** [Depth Anything V2 Small](https://huggingface.co/onnx-community/depth-anything-v2-small) (Apache-2.0) runs in the browser through transformers.js and WebAssembly (`public/js/depth.js`). The roughly 27 MB model downloads once and is cached.
3. **Relief** (`public/js/relief.js`):
   - it cuts out the subject using the depth map (Otsu threshold, largest blob, hole fill)
   - it samples the subject onto a stud × plate grid
   - it shapes each column's front from depth and rounds the edges using distance-to-edge, so the back is a smooth shell and the model stands on its own
   - colours come from the photo's pixels, matched to real brick colours (at most 10, with speckle smoothing)
4. **Bricks** (`public/js/voxelize.js` → `engine.js`):
   - it hollows out the interior and adds clear supports under overhangs
   - it builds from bricks, 45° slopes, plates, and tiles on exposed tops
   - it staggers seams, checks stud connectivity, and splits the build into steps
5. Only the compact relief data (about 10 KB) is saved, in the `builds` table. Every build page rebuilds the model from it.
6. **Optional naming:** `POST /api/name` sends a 384 px thumbnail to Groq or Gemini for a title and a one-line description. That's a few dozen tokens, well inside free tiers. If it fails, the build is called "My build".

`/api/generate` (Gemini or Groq designing the model as 3D shapes, with a render-and-refine second pass) is still in the code, but the site no longer uses it. It needs a paid AI tier to be reliable.

The **Eiffel Tower showcase** (`/build.html?demo=eiffel`) is a hand-tuned 1:400 generator (`public/js/eiffel.js`) built from the real tower's dimensions, running on the same engine.

## Setup

### 1. Supabase
1. Create a project at supabase.com.
2. In **SQL Editor**, run `supabase/schema.sql`. It creates the `builds` table with row-level security and a private `uploads` storage bucket.
3. In **Authentication → URL Configuration**, set **Site URL** to your production URL and add it (plus `http://localhost:8788`) to the redirect URLs.
4. Optional: enable **Google** under Authentication → Providers, then set `GOOGLE_AUTH=true`.
5. Copy the **Project URL** and the **anon public** key from Settings → API.

### 2. Gemini
Create an API key at https://aistudio.google.com/apikey.

### 3. Cloudflare Pages
1. Go to Workers & Pages → Create → Pages → **Connect to Git** and pick this repo.
2. Build settings: **Framework preset** None, **Build command** blank, **Build output directory** `public`.
3. In **Settings → Variables and Secrets**, add:

| Variable | Required | Notes |
|---|---|---|
| `GROQ_API_KEY` | optional (naming only) | Groq (console.groq.com/keys). Store it as a **Secret** |
| `GEMINI_API_KEY` | optional (naming only) | Google AI Studio. Store it as a **Secret** |
| `AI_PROVIDERS` | no | Provider order, default `groq,gemini`. Providers without a key are skipped |
| `GROQ_MODELS` | no | Groq vision model(s), comma list |
| `SUPABASE_URL` | yes | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | yes | The anon *public* key, which is safe to expose |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.8-flash` |
| `GEMINI_FALLBACK_MODELS` | no | Comma list tried when the main model is busy or over quota |
| `BUILDS_PER_HOUR` | no | Per-user abuse guard, default `60`. Builds are otherwise unlimited. |
| `ACCOUNTS` | no | `true` turns on Supabase accounts. Off by default: no sign-up, and builds are saved in the visitor's browser |
| `GOOGLE_AUTH` | no | `true` shows "Continue with Google" (accounts only) |
| `ADSENSE_CLIENT` | no | `ca-pub-…` |
| `ADSENSE_SLOTS` | no | JSON, e.g. `{"landing":"123","panel":"456","wide":"789","list":"012"}` |

4. Deploy with `npm run deploy` (direct upload; it leaves out local test files in `public/_t`).

### Ads
Ad slots: the landing page (`landing`), the step panel (`panel`, every 6th step), the parts list (`wide`) and My builds (`list`). There are no ads in the upload or sign-up flow.
- Until `ADSENSE_CLIENT` is set, slots show as dashed placeholders on localhost and render nothing in production.
- Once AdSense approves the site, add `public/ads.txt` containing `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in your keys
npm run dev                      # http://localhost:8788 (pages and functions)
npm test                         # engine sanity checks
```

## Legal
Brixel is an independent fan project. LEGO® is a trademark of the LEGO Group, which does not sponsor, authorise or endorse this site. Don't use "LEGO" in the site name or domain.
