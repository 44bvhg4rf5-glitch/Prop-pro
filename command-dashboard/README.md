# Command Dashboard (standalone)

A mobile-first personal command center for iPad/iPhone — **completely separate
from PropMail Pro**. It has its own code, its own deploy, and its own database.
Nothing here reads, writes, or shares anything with the PropMail Pro app.

- **☀️ Today** — AI morning brief (cached daily) + a durable task list.
- **💬 Chat** — Claude **or** Gemini, in Chat / Co-work / Code modes.
- **🤖 Agents** — live GitHub activity feed + an updates log agents can POST to.
- **⚙️ Setup** — live connection checklist.

## Deploy as its own Vercel project (free, no card)

1. Vercel → **Add New… → Project** → import the `prop-pro` repo.
2. In **Configure Project**, set **Root Directory** to **`command-dashboard`**.
   This is what keeps it separate: Vercel only builds this folder, never the
   PropMail Pro app at the repo root.
3. **Deploy.** You get a brand-new URL, e.g. `command-dashboard-xxxx.vercel.app`.
4. **Settings → Environment Variables** — add (all optional, free tier):

   | Name | Value | Powers |
   |---|---|---|
   | `GEMINI_API_KEY` | aistudio.google.com/apikey | chat + brief |
   | `KV_REST_API_URL` | Upstash Redis REST URL | task sync across devices |
   | `KV_REST_API_TOKEN` | Upstash Redis REST token | task sync across devices |
   | `GITHUB_TOKEN` (+ `GITHUB_REPOS`) | a read-only PAT | agent activity feed |
   | `RESEND_API_KEY` (+ `DASHBOARD_EMAIL`) | resend.com | 9am email brief |

5. **Redeploy** to apply the keys, then open the URL in Safari →
   **Share → Add to Home Screen**.

> Use a **different** Upstash database from anything PropMail Pro uses, so the
> two never share data.

## Run locally

```bash
cd command-dashboard
npm install
GEMINI_API_KEY=... node server.js   # http://localhost:3000
```

## API (`/api/dashboard`)

`?action=status | summary | feed | tasks | updates` (GET/POST), plus
`?cron=1` for the daily email job. See the code for payload shapes.
