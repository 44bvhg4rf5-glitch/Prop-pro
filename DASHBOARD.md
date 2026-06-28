# Command Dashboard

A mobile-first personal command center for iPad/iPhone, built into PropMail Pro.
Open it at **`/dashboard`** (e.g. `https://your-app.vercel.app/dashboard`) and
tap Share → **Add to Home Screen** in Safari to run it full-screen like a native app.

## What it does

| Tab | What you get |
|---|---|
| **☀️ Today** | An AI-written **morning brief** ("Top 3 today", your open tasks, what your agents shipped) + a durable **task list**. |
| **💬 Chat** | Chat with **Claude or Gemini** (toggle, or "Auto"), in three modes: **Chat**, **Co-work** (planning/chief-of-staff), and **Code** (pair programmer). |
| **🤖 Agents** | A live **GitHub activity feed** (commits, PRs, issues across your repos) — this is "what my Claude Code agents did" — plus an **Updates log** agents can post to directly. |
| **⚙️ Setup** | Shows which connections are live and how to wire the rest. |

Everything is same-origin: the browser talks only to `/api/dashboard` and
`/api/ai`; keys stay server-side (handled by the existing `lib/llm.js` layer).

## Environment variables

All optional — the dashboard loads and degrades gracefully without each one.

| Var | Powers | Notes |
|---|---|---|
| `GEMINI_API_KEY` *or* `ANTHROPIC_API_KEY` | Chat + morning brief | Either works; set both and Gemini/Claude back each other up. Free Gemini key: https://aistudio.google.com |
| `GITHUB_TOKEN` | Agent activity feed | Fine-grained or classic PAT with read access to the repos you watch. |
| `GITHUB_REPOS` | Which repos to show | Comma-separated `owner/repo,owner/repo2`. If unset, the token owner's 6 most-recently-pushed repos are used. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Durable tasks & updates | Without these, tasks/updates live in memory only (fine for self-hosted `node server.js`; **won't persist on serverless** — add a free Upstash/Vercel KV). |
| `RESEND_API_KEY` + `DASHBOARD_EMAIL` | 9am email brief | Optional. Emails the brief daily via the cron below. `DASHBOARD_EMAIL` is where it's sent. |

## The morning brief

- Generated from your open tasks + recent GitHub activity + open issues.
- **Cached once per day** so opening the app is instant; tap **↻ Regenerate** to refresh.
- Delivered **in-app** by default. For a **9am email** too, set `RESEND_API_KEY` +
  `DASHBOARD_EMAIL` — a Vercel cron (`/api/dashboard?cron=1`, configured in
  `vercel.json` at `0 7 * * *` UTC ≈ 8am UK) regenerates and emails it even if
  the app is closed.

## Letting your Claude Code agents "report in"

Beyond the GitHub feed, any agent can push a status line to the **Updates log**
with a single HTTP call — paste this into an agent's instructions:

```bash
curl -X POST "https://your-app.vercel.app/api/dashboard?action=updates" \
  -H "Content-Type: application/json" \
  -d '{"source":"my-agent","text":"Finished the auth refactor ✅"}'
```

It then appears under **Agents → Updates Log** on your phone.

## API reference (`/api/dashboard`)

| Action | Method | Purpose |
|---|---|---|
| `?action=status` | GET | What's configured (AI/GitHub/store/email). |
| `?action=summary` | GET | Morning brief (`&refresh=1` to regenerate). |
| `?action=feed` | GET | GitHub activity across watched repos. |
| `?action=tasks` | GET / POST | List, or `{op:add|toggle|delete|clearDone, ...}`. |
| `?action=updates` | GET / POST | Read the agent log, or `{source, text}` to append. |
| `?cron=1` | GET | Regenerate + email the brief (used by Vercel Cron). |

## Files

- `public/dashboard.html` — the whole UI (self-contained, no build step).
- `public/dashboard.webmanifest`, `public/dashboard-icon.svg` — installable PWA.
- `api/dashboard.js` — the endpoint (summary/feed/tasks/updates/cron).
- `lib/github.js` — GitHub REST helper.
- `lib/llm.js` — gained a per-request `provider` override for the Claude/Gemini toggle.
