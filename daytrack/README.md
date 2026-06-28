# DayTrack

A private personal daily tracker for your iPhone (or any phone/computer).
Track your **work productivity**, a **health score** (sleep, water, exercise, mood),
and **food & calories** — with a 7‑day trends view.

- 🔒 **Private** — all your data is stored only on your own device. Nothing is uploaded anywhere.
- 📱 **Installs like a real app** — add it to your iPhone Home Screen; it runs full‑screen, even offline.
- 💸 **Free** — no Apple Developer account, no App Store, no accounts, no subscriptions.
- 🧩 **No dependencies** — plain HTML/CSS/JS plus a tiny built‑in Node server.

## Run it on your home network

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
