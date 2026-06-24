# PropMail Pro — Estate Agent Intelligence Platform

An AI-powered estate-agent intelligence platform for the Harrow (HA) postcode
area. It finds live property listings, extracts real addresses, researches
owners via public UK sources, and generates instruction letters.

## Two ways to run it

**1. Single HTML file (no server)** — open `propmail-pro.html` directly in a
browser, or host it on any static host (GitHub Pages, Netlify, S3…). The whole
app (HTML + CSS + JS) is in that one file. Click the **🔑 API Key** button
(bottom-right) and paste your Anthropic key (`sk-ant-…`) to enable the AI
features. The key is stored only in your browser's `localStorage` and sent
directly to `api.anthropic.com` — it never touches any other server.

**2. Node server (key stays server-side)** — see below. Use this if you don't
want the API key living in the browser.

## Running locally

No dependencies and no build step — just Node.js (v18+).

```bash
# Without AI features (UI only):
node server.js

# With AI features enabled:
ANTHROPIC_API_KEY=sk-ant-... node server.js
```

Then open <http://localhost:3000>.

Use `PORT=8080 node server.js` to change the port.

## How the AI features work

The browser never sees your API key. The frontend posts to a local
`/api/anthropic` endpoint, and `server.js` proxies that request to the
Anthropic Messages API, injecting `ANTHROPIC_API_KEY` from the environment
server-side. If no key is set, the UI still loads and the AI-backed panels
return a friendly "AI disabled" message instead of failing silently.

You can check the current status at <http://localhost:3000/api/config>.

## Project structure

```
propmail-pro/
├── server.js        # Static file server + secure Anthropic proxy
├── package.json
├── CLAUDE.md
└── public/
    ├── index.html   # App shell
    ├── styles.css   # All styling
    └── app.js       # All application logic
```

## Features (11 panels)

1. **HA District Search** — live property finder
2. **Print Queue** — letter queue with real addresses and listing links
3. **Auto Flow** — 4-step automated pipeline
4. **Live Bot** — continuous monitoring
5. **AI Intel** — owner research via public UK sources
6. **Success Letters** — postcode address lookup
7. **Templates** — letter template editor
8. **Printers** — network printer management
9. **Investor Board** — revenue KPIs and scenarios
10. **AI Advisor** — campaign health analysis
11. **Director Vision** — strategic ideas
