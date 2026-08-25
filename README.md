# TokDrop — TikTok downloader for Cloudflare Workers/Pages

Paste a TikTok link → get the video (and the audio). No third-party API, no
API key, no paid service: the retrieval runs on **your own Cloudflare
deployment**.

Works on **Cloudflare Workers (static assets)** and on **Cloudflare Pages** —
same code, same files, you just pick the hosting model in the dashboard.

## 0. Quick start (no tools installed)

1. Unzip the download.
2. Open **`public/deploy.html`** in your browser.
3. Set your background image, music, logo, title and accent colour.
4. Paste a GitHub token + repository name → **Create repo & push**.
5. Connect the repo to Cloudflare (Workers: deploy command `npx wrangler deploy`,
   Pages: build output directory `public`).

Everything below is the same thing explained in detail.

## 1. How it works (the whole architecture)

```
Browser (public/ static assets)
  app.js  ──POST /api/resolve──▶  worker.js  (Cloudflare Worker entry point)
                                       └─▶ functions/api/resolve.js
                                       │
                                       ├─ follow vm.tiktok.com redirect
                                       ├─ tiktok.com/oembed        (public metadata)
                                       ├─ tiktok.com/@user/video/N (page JSON: qualities + music)
                                       └─ TikTok mobile feed       (fallback)
                                       │
  <a download="/api/media?...">◀────── JSON: title, author, duration, qualities, audio
                                       │
  /api/media?u=...&f=...  ──▶ worker.js ──▶ functions/api/media.js
                                       └─ fetches the CDN file WITH the
                                          Referer: https://www.tiktok.com/ header
                                          and streams it back as an attachment
```

**Why the proxy?** TikTok's CDN answers `403` to browser requests that do not
carry a `Referer: https://www.tiktok.com/` header, so a plain link to the CDN
file cannot work. The Worker adds that header for you.

**Workers vs Pages:** `wrangler.toml` points at `worker.js` and serves
`public/` as static assets (Workers). If you deploy as Pages instead,
Cloudflare reads the `functions/` folder and creates the same two routes —
`worker.js` is simply ignored.

## 2. Every file and what it does

| File | What it does | Do you edit it? |
| --- | --- | --- |
| `public/deploy.html` | **One-page builder**: visual config editor + "Create repo & push" button that talks to the GitHub API straight from your browser. Open it after unzipping - no server, no Node, no git needed. | it is a tool, not the site |
| `public/config.js` | **All customisation**: site title, logo, accent colour, background image/opacity/blur/position/overlay, background music | ✅ yes, this one |
| `public/index.html` | The page structure (input, button, preview, download list) | rarely |
| `public/styles.css` | The whole design (dark + light theme, mobile first) | optional |
| `public/app.js` | Loading states, calls `/api/resolve`, renders preview + buttons, music + theme buttons | no |
| `public/robots.txt` | Keeps the site out of search engines | optional |
| `worker.js` | Cloudflare **Workers** entry point: routes `/api/resolve` and `/api/media` to the shared handlers | no |
| `functions/api/resolve.js` | Server-side TikTok retrieval, returns JSON metadata + download variants (used by Workers *and* Pages) | only if TikTok changes its markup |
| `functions/api/media.js` | Streams the media file with the right headers | no |
| `wrangler.toml` | Cloudflare Workers config: `worker.js` + static assets from `public/` | optional (project name) |
| `package.json` | `npm run dev` / `npm run deploy` helpers (no dependencies) | no |

## 3. Customise it (one file: `public/config.js`)

```js
window.SITE_CONFIG = {
  siteTitle: "My Downloader",          // site name
  tagline: "Paste a TikTok link.",
  logoUrl: "https://example.com/logo.png",
  accentColor: "#22d3ee",              // any CSS colour
  background: {
    imageUrl: "https://example.com/bg.jpg", // "" = built-in gradient
    opacity: 0.9,                       // 0 – 1
    blur: 4,                            // px
    position: "center",                 // CSS background-position
    overlayDarkness: 0.55               // 0 – 0.95
  },
  music: { enabled: true, url: "https://example.com/song.mp3", volume: 0.35, loop: true }
};
```

## 4. Run it locally

```bash
npm run dev          # Cloudflare Workers  ->  http://localhost:8787
npm run dev:pages    # Cloudflare Pages   ->  http://localhost:8788
```

Both commands serve `public/` and expose `/api/resolve` + `/api/media`.
No `npm install` needed — the project has no dependencies.

## 5. Put it on GitHub

**Option A — the built-in button (easiest).** Open `public/deploy.html` from the
unzipped download (double-click it). It has the full config editor and a
**Create repo & push** button that talks to the GitHub REST API directly from
your browser. Paste a token, pick a repository name, done.

**Option B — with the GitHub API by hand (no git installed).** Generate a token at
<https://github.com/settings/tokens>:

* Classic token: tick **repo** (and **workflow** if you add Actions later).
* Fine-grained token: give it *Administration: write* (to create the repo) and
  *Contents: write* (to push files).

Then:

```bash
curl -X POST https://api.github.com/user/repos \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d '{"name":"tokdrop","private":true,"description":"TikTok downloader on Cloudflare Pages"}'
```

The easiest path is Option A above: `public/deploy.html` does all of this for
you (it also handles GitHub's "Git Repository is empty." quirk by creating the
initial commit for you).

**Option C — plain git:**

```bash
git init -b main
git add .
git commit -m "TikTok downloader for Cloudflare Pages"
git remote add origin https://github.com/YOUR_NAME/tokdrop.git
git push -u origin main
```

## 6. Connect the repo to Cloudflare

Both hosting models work with these exact files. Pick one:

### Option A — Cloudflare Workers (static assets, recommended)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Workers** tab →
   **Import a repository** (or "Create Worker" → connect Git).
2. Authorise GitHub and select the repository + the `main` branch.
3. Build settings:

   | Setting | Value |
   | --- | --- |
   | Root directory | / (leave empty) |
   | Build command | *(leave empty — there is nothing to build and no dependency to install)* |
   | Deploy command | `npx wrangler deploy` |

4. **Save and Deploy**. Live on `https://<name>.<your-subdomain>.workers.dev`.

`wrangler.toml` already declares `main = "worker.js"` and
`assets.directory = "./public"`, so Cloudflare serves the site as static assets
and sends `/api/resolve` + `/api/media` to `worker.js`.

### Option B — Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** tab →
   **Connect to Git**.
2. Authorise GitHub and select the repository.
3. Build settings:

   | Setting | Value |
   | --- | --- |
   | Project name | anything you like |
   | Production branch | `main` |
   | Framework preset | **None** |
   | Build command | *(leave empty)* |
   | Build output directory | `public` |
   | Root directory | *(leave empty — the repo root, so `functions/` is found)* |

4. **Save and Deploy**. Cloudflare uploads `public/` and turns
   `functions/api/*.js` into the same `/api/*` endpoints automatically.

Either way: every future `git push` to `main` redeploys by itself, and a
custom domain can be attached from the project's **Settings → Domains** page.

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Git Repository is empty." while pushing | Normal for a brand-new repo: `deploy.html` (and the control panel) create the initial commit for you automatically. If you push by hand, first add a file on github.com (Add file → Create new file). |
| `/api/resolve` returns 404 | Workers: check that `wrangler.toml` has `main = "worker.js"` and `[assets] directory = "./public"`. Pages: the `functions/` folder must be in the repo root and the build output directory must be `public`. |
| "TikTok refused this request" | TikTok blocks some Cloudflare/datacenter IPs and rotates its markup. Retry later; the code already tries three different first-party methods. |
| "media server refused the download (HTTP 403)" | Signed CDN links expire fast: resolve the link again and download immediately. |
| Private / deleted / region-locked video | Not downloadable — the site shows a clear error instead of pretending it worked. |
| Music does not start | Browsers block autoplay; click the ♫ button in the header. Check that `music.url` is a direct audio link. |

## 8. Legal

Download only content you own or are allowed to use. Respect TikTok's Terms of
Service and creators' copyright; do not use this to redistribute other people's
work. This project only reads **public** data from TikTok's own endpoints and
contains no third-party or paid API.
