# DayTrack — standalone build (host under your own account)

This is a flattened, self-contained copy of DayTrack for hosting under a
**separate account** from the prop-pro project. Everything is bundled into a
handful of top-level files (no subfolders), so it's easy to upload from an iPad.

```
index.html            ← the whole app (HTML + CSS + JavaScript inlined)
manifest.webmanifest  ← app name / icons / colours
sw.js                 ← makes it installable + work offline
icon-180.png          ← Home Screen icon (iPhone/iPad)
icon-192.png
icon-512.png
```

There is **no server and no build step** — it's pure static files. Your data is
stored only on each device; nothing is ever uploaded.

## Host it free under a new GitHub account (recommended, iPad-only)

1. Create a free account at **github.com** (any email — keep it separate from the
   prop-pro account if you like).
2. Tap **+** (top right) → **New repository**. Name it e.g. `daytrack`,
   set it to **Public**, and create it.
3. On the new repo, tap **Add file → Upload files**. Select **all 6 files** in
   this folder (the `index.html`, `manifest.webmanifest`, `sw.js` and the three
   `icon-*.png`) and **Commit changes**.
4. Go to **Settings → Pages**. Under **Source** choose **Deploy from a branch**,
   pick branch **main** and folder **/ (root)**, then **Save**.
5. Wait ~1 minute. Your private app is now live at:
   ```
   https://<your-new-username>.github.io/daytrack/
   ```
6. Open that link in **Safari**, tap **Share → Add to Home Screen → Add**.

That's it — a permanent app under your own account, no computer, nothing running.

## Or use any other free host

Because it's just static files, the same 6 files work as-is on:
- **Netlify** (drag the folder onto app.netlify.com/drop, or connect a repo)
- **Cloudflare Pages**
- **Vercel** (new project → upload / connect a repo)

## Privacy

The web address is public (someone with the exact link could open a *blank* copy),
but **your logged data never leaves your device**, so no one else can see it.
Each device keeps its own data — use **Settings → Export/Import backup** to move
entries between your iPhone and iPad.
