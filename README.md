# Brixel

**Any photo, built in bricks.** Upload a photo of anything. Brixel designs a brick model of it and gives you step-by-step building instructions: a 3D view of every step, top-down layer plans, and a parts list you can export to BrickLink.

- **Frontend:** static HTML and ES modules with no build step (three.js and supabase-js from a CDN), in `public/`
- **Backend:** Cloudflare Pages Functions in `functions/api/`
- **Auth, database and storage:** Supabase
- **AI:** Google Gemini (vision plus structured JSON output)
- **Revenue:** Google AdSense slots (optional)

## How it works

1. The browser shrinks the photo to 1024 px or less and uploads it to the user's private folder in Supabase Storage.
2. `POST /api/generate` checks the user's Supabase session and sends the photo to Gemini with a JSON schema. Gemini replies with the subject described as **primitives**: boxes, cylinders, spheres, domes, roofs, and subtractions, measured in studs and plates and coloured from a fixed brick palette. The function validates the result and saves it to `builds`.
3. The build page rebuilds the model in the browser from that saved spec (`public/js/voxelize.js` → `engine.js`):
   - it voxelizes the primitives onto a baseplate grid and hollows out the inside
   - it adds clear support columns under anything that would float
   - it packs every layer into standard plates, staggering seams against the layer below
   - it checks stud connectivity and adds tie plates where needed
   - it splits the result into steps
4. `handbook.js` and `viewer.js` render the instructions.

The **Eiffel Tower showcase** (`/build.html?demo=eiffel`) is a hand-tuned 1:400 generator (`public/js/eiffel.js`) built from the real tower's dimensions. It runs on the same engine.

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
| `GEMINI_API_KEY` | yes | Store it as a **Secret** |
| `SUPABASE_URL` | yes | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | yes | The anon *public* key, which is safe to expose |
| `GEMINI_MODEL` | no | Defaults to `gemini-2.5-flash` |
| `BUILDS_PER_HOUR` | no | Per-user abuse guard, default `60`. Builds are otherwise unlimited. |
| `GOOGLE_AUTH` | no | `true` shows "Continue with Google" |
| `ADSENSE_CLIENT` | no | `ca-pub-…` |
| `ADSENSE_SLOTS` | no | JSON, e.g. `{"landing":"123","panel":"456","wide":"789","list":"012"}` |

4. Redeploy. Every push to `main` deploys automatically.

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
