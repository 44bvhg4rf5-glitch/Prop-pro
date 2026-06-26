# PropMail Pro — Security & Anti-Cloning

This documents how the app is protected, what's realistic, and what to configure.

## 1. What protects the site from outside breaches

**Secrets never reach the browser.** All API keys (OS Places, EPC, Anthropic,
PrintNode, Redis) live only in server-side environment variables. The browser
calls our own `/api/*` endpoints, which inject the keys server-side. Nothing
sensitive is in the HTML/JS a visitor can read.

**HTTP security headers** (set in `vercel.json`, verified live):
- `Content-Security-Policy` — restricts what the page can load/connect to, which
  neutralises most injected-script / XSS exfiltration attacks.
- `X-Frame-Options: DENY` + `frame-ancestors 'none'` — blocks clickjacking
  (nobody can embed the app in an iframe).
- `Strict-Transport-Security` — forces HTTPS.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `X-Robots-Tag: noindex` — standard hardening + keeps the app out of search engines.

**API hardening:**
- `Cache-Control: no-store` on every API response (no sensitive data cached).
- Body-size cap on POSTs (prevents memory-exhaustion).
- Input validation on the address / suppression endpoints.
- Diagnostic/debug endpoints are gated behind a secret `DEBUG_KEY` env var — they
  no longer leak infrastructure details to the public.

## 2. Anti-cloning — what's realistic

**Honest truth:** you cannot make a public website's *appearance* impossible to
copy. Any browser must download the HTML/CSS to render it, so a determined person
can always screenshot or re-skin the look. Anyone claiming otherwise is wrong.

**What we CAN do — and have done — is protect the valuable part:** the working
engine, not the paint.

- **The real IP is server-side.** The address-finding logic, OS Places/EPC/Land
  Registry integration, deduplication, classification, and the do-not-mail engine
  all run on the server behind your keys. A copycat gets a pretty but *dead* shell
  — it does nothing without rebuilding all of that and paying for their own keys.
- **Backend origin lock (the important one).** `/api/addresses`, `/api/suppress`
  and `/api/anthropic` now reject requests coming from any other website. So even
  if someone clones your front-end and points it at your backend, your server
  returns **403 Forbidden** — they can't free-ride on your OS Places / AI credits
  or read your blocked list. (Verified: a request claiming to be from another
  domain is blocked; your own site works normally.)
- **No search indexing** (`noindex` + `robots.txt`) — reduces the app's
  discoverability and scraping surface.
- **Proprietary** — the code is private (not open source); this is a closed
  commercial product.

### Optional further step (not done — has a cost)
Minifying/obfuscating `app.js` makes the client code much harder to read and
reuse. It's deliberately *not* enabled because it would add a build step and make
future edits slower. Say the word if you want it and accept that trade-off.

## 3. Environment variables (set in Vercel → Settings → Environment Variables)

| Var | Purpose | Required? |
|-----|---------|-----------|
| `OS_PLACES_KEY` | Royal Mail / OS Places address finder | Recommended |
| `EPC_API_KEY` | EPC fallback + full-address lookup | Recommended |
| `ANTHROPIC_API_KEY` | AI features | Optional |
| `PRINTNODE_API_KEY` | Silent printing | Optional |
| `REDIS_URL` (or `KV_REST_API_URL`+`KV_REST_API_TOKEN`) | Durable do-not-mail list | Recommended |
| `CH_API_KEY` | Free Companies House API key — powers "Find owner" auto-lookup of directors at company-owned addresses. Register at developer.company-information.service.gov.uk. Planning (PlanIt) needs no key. | Optional |
| `ALLOWED_ORIGINS` | Extra domains allowed to use the API (comma-separated). Set this if you move to a **custom domain** so the origin lock keeps working. | Only on custom domain |
| `DEBUG_KEY` | Unlocks diagnostic endpoints (`?debug=<key>`). Leave unset in normal use. | No |

> If you add a custom domain later, set `ALLOWED_ORIGINS=yourdomain.com` so the
> API still accepts your own site. `*.vercel.app` and `localhost` are always allowed.
