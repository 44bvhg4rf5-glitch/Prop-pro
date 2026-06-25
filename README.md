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

## Live property search (no API key needed)

The Node server exposes `/api/rightmove`, which fetches real current Rightmove
listings server-side (where the browser's cross-origin block doesn't apply) and
returns clean JSON — real street/area addresses, prices, and direct
`rightmove.co.uk/properties/...` links. The HA District Search uses this
automatically; **no Anthropic key is required** for live search.

```
GET /api/rightmove?district=HA1&channel=sale&minBeds=2&maxPrice=600000
```

Note: Rightmove publishes the street + area, not the exact house number, so
addresses are street-level. This requires the Node server (it cannot run on
GitHub Pages, which only serves static files). See **Deploying** below.

### Full-address (house number) lookup — EPC register

Each result has a **🔑 Find full address** button. It queries the public
GOV.UK EPC register (`/api/epc?postcode=HA1+1SL&street=Hindes+Road`) and returns
candidate full addresses — real house numbers — on that street/postcode to
verify against the listing. Set a free `EPC_API_KEY` (register with GOV.UK One
Login at <https://get-energy-performance-data.communities.gov.uk>). Without it,
the button explains how to enable the feature.

These are *candidates to verify*, not a guaranteed single match — the EPC pin
is the registered certificate address, so always confirm against the Rightmove
listing before posting.

### Success Letters — full postcode address finder

The **Success Letters** panel lists *every* address at a postcode (like the
Royal Mail address finder) so you can tick which ones to write to. It calls
`/api/addresses?postcode=HA1+1BB`, which uses two sources in order:

1. **Ordnance Survey Places API** (Royal Mail PAF) — the complete address
   list, residential and commercial. Set a free `OS_PLACES_KEY` (register at
   <https://osdatahub.os.uk>, free OS Places plan).
2. **EPC register** fallback (uses the existing `EPC_API_KEY`) — homes with an
   Energy Certificate. Works immediately if you already set `EPC_API_KEY`.

If neither key is set the panel falls back to representative sample addresses
for the postcode sector so the workflow is still usable offline.

## Deploying to a free host

`render.yaml` is included for one-click deploys on [Render](https://render.com):
create a **New → Blueprint**, point it at this repo, and Render runs
`node server.js` on a free web service. Add `ANTHROPIC_API_KEY` in the
dashboard only if you want the AI features too.

### Vercel (sign in with GitHub, no email needed)

`vercel.json` + the `api/` serverless functions let the app run on
[Vercel](https://vercel.com) with only a GitHub login:

1. Sign in to Vercel with **GitHub** and **Add New → Project**, import this repo.
2. Deploy (no build settings needed — `vercel.json` handles it).
3. In **Settings → Environment Variables**, optionally add `ANTHROPIC_API_KEY`
   (AI features), `EPC_API_KEY` (full-address lookup) and `OS_PLACES_KEY`
   (complete postcode address finder), then redeploy.

The static UI is served from `public/`; `/api/rightmove`, `/api/epc`,
`/api/anthropic`, and `/api/config` run as serverless functions.

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
