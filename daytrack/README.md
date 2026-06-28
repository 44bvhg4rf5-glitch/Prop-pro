# DayTrack

A private personal daily tracker for your iPhone (or any phone/computer).
Track your **work productivity**, a **health score** (sleep, water, exercise, mood),
and **food & calories** — with a 7‑day trends view.

- 🔒 **Private** — all your data is stored only on your own device. Nothing is uploaded anywhere.
- 📱 **Installs like a real app** — add it to your iPhone Home Screen; it runs full‑screen, even offline.
- 💸 **Free** — no Apple Developer account, no App Store, no accounts, no subscriptions.
- 🧩 **No dependencies** — plain HTML/CSS/JS plus a tiny built‑in Node server.

## No computer? Host it free from your iPad (recommended)

If you only have an iPhone/iPad, you don't need to run anything. Host the app
once on **GitHub Pages** (free), then install it from Safari. Everything below
is done in your iPad's browser.

1. Go to your repository on github.com → **Settings** → **Pages**.
2. Under **Build and deployment** → **Source**, choose **Deploy from a branch**.
3. Set **Branch** to `claude/private-iphone-app-zbnn0n` and folder to **/ (root)**, then **Save**.
4. Wait ~1 minute. Your app will be live at:
   ```
   https://44bvhg4rf5-glitch.github.io/Prop-pro/daytrack/
   ```
5. Open that address in **Safari** on your iPhone/iPad, then **Add to Home Screen** (see below).

Now it's a permanent web app — no computer, nothing to keep running. It also
works offline once installed, and your logged data stays on each device.

> Privacy note: the web address is public (anyone who has the exact link could
> open a blank copy of the app), but your data is **not** — it never leaves your
> device, so nobody else sees what you log. If you'd rather the link itself be
> private too, that needs a login system; ask and it can be added.

## Run it on your home network (alternative — needs a computer)

1. On your computer (same Wi‑Fi as your phone), start the server:
   ```bash
   cd daytrack
   node server.js
   ```
2. It prints two addresses, e.g.:
   ```
   On this computer:   http://localhost:4173
   On your iPhone:     http://192.168.1.24:4173   (same Wi-Fi)
   ```
3. On your **iPhone**, open the second address in **Safari**.

## Install on the Home Screen (iPhone)

1. In Safari, tap the **Share** button (the square with an arrow).
2. Tap **Add to Home Screen**.
3. Tap **Add**. DayTrack now has its own icon and opens full‑screen like a native app.

> Keep `node server.js` running on your computer whenever you want to open the app
> while it's connected to your network. Your logged data stays on the phone regardless.

## Backups

Settings → **Export backup** saves a JSON file of everything. **Import backup** restores it
(handy when moving to a new phone). Data otherwise lives in the browser's local storage on the device.

## Files

```
daytrack/
├── server.js               # tiny zero-dependency static server (for your LAN)
├── index.html              # app shell
├── styles.css              # styling
├── app.js                  # all the app logic + local storage
├── manifest.webmanifest    # PWA metadata (name, icons, colours)
├── sw.js                   # service worker (installable + offline)
├── icons/                  # generated app icons (PNG)
└── scripts/gen-icons.mjs   # regenerate the icons: npm run icons
```

## Regenerate icons

```bash
npm run icons   # writes icons/icon-180.png, 192, 512
```
