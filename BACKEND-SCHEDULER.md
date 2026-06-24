# Backend Scheduler — Scope / Spec

**Goal:** produce (and physically print) each property's due cycle letters
automatically at ~9am, **even when the app and the user's browser are closed.**

The current app is browser-only: cycles, contacts and the schedule live in the
browser's `localStorage`, and the "auto-print" only runs while the app is open
(and still needs one tap, because browsers can't print silently). To make it
truly unattended we need a small backend. This document scopes that.

---

## 1. Why a backend is required

Three hard limits of a website:
1. A web page **cannot run when it's closed** → we need a server that's always
   on to do the daily 9am job.
2. A browser **cannot print silently** and **can't reach a physical printer** on
   its own → unattended printing needs *something* on the user's side (a local
   print client) or a print/mail service.
3. Browser storage is **per-device** → to run server-side, the data must move to
   a shared **database**.

So three new components: **a database**, **a scheduled job**, and **a print/
deliver step**.

---

## 2. Architecture

```
 Browser app  ─(save cycles/contacts)─►  API  ─►  Database (cycles, contacts, schedule)
                                                     ▲
                          Daily 9am Cron ────────────┘
                                  │  (find letters due today)
                                  ▼
                          Render letters → PDF
                                  │
                 ┌────────────────┼─────────────────┐
                 ▼                ▼                  ▼
        Email a PDF digest   PrintNode API     Mail-house API
        (user prints)        (auto-print on    (they print + post
                              user's printer)    for you)
```

### Components
| Component | Recommended | Notes |
|---|---|---|
| Hosting | **Vercel** (already used) | Cron Jobs available; 1×/day is enough |
| Database | **Vercel Postgres** or **Supabase** (free tier) | stores cycles, contacts, schedule, refs |
| Auth | **Supabase Auth** or a single shared key | so it's *your* data, multi-device |
| Scheduled job | **Vercel Cron** (`0 9 * * *`) | runs the "due today" query daily |
| PDF generation | `pdf-lib` / `@react-pdf` server-side | one multi-page PDF of all due letters |
| Email | **Resend** (free tier) | the "due today" digest with the PDF |
| Physical print (unattended) | **PrintNode** | a tiny client runs on an always-on PC by the printer; API pushes jobs to it |
| Or fully hands-off post | **Stannp / CFH / Docmail** API | they print AND post the letters for ~50–70p each |

---

## 3. The print path — pick one (this is the key decision)

1. **Email digest (cheapest, semi-auto).** Cron emails you one PDF of all due
   letters at 9am; you print at the office. ~£0/month. No printer integration.
2. **PrintNode (true unattended print).** Install PrintNode's free client on a
   PC that's on at 9am next to your printer; the cron pushes the PDF and it
   prints itself. ~£a few/month for PrintNode + needs an always-on PC.
3. **Mail house API (fully hands-off, incl. posting).** Services like
   **Stannp**/**Docmail** take the address + letter via API and **print and
   post** first-class for ~50–70p/letter. No printer, no PC, no stuffing
   envelopes — this is the "set and forget" option, just a per-letter cost.

My recommendation: **option 3 (Stannp/Docmail)** for genuine automation, with
**option 1** as a free fallback. Option 2 only if you specifically want to use
your own printer/letterhead unattended.

---

## 4. Work involved (phased)

- **Phase A — move data server-side (~2–3 days).** Database schema (cycles,
  contacts, schedule, refs); API to sync; migrate the browser's localStorage up
  on first sign-in. Add a light sign-in.
- **Phase B — the daily job (~1–2 days).** Vercel Cron at 9am → query letters
  due today per cycle → render to PDF → store + mark as produced.
- **Phase C — delivery (~1–3 days depending on path).** Wire the chosen print
  path (email / PrintNode / mail-house). Add a "what went out today" log to the
  Schedule tab (with references), so you can see exactly what was produced.
- **Phase D — controls (~1 day).** Pause/resume, "skip today", per-cycle on/off,
  spend cap for the mail-house option.

**Rough total: ~1.5–2 weeks** of build, plus your sign-ups.

---

## 5. What you'd need to provide / decide

1. **Print path** (1, 2 or 3 above) — drives cost and effort.
2. **Budget** — free (email) vs ~per-letter (mail house) vs small monthly (PrintNode + your own paper/postage).
3. **Sign-ups** for the chosen services (Supabase, Resend, and Stannp/Docmail or PrintNode).
4. Whether you want **multi-user** (team) or just you.

---

## 6. Cost sketch

| Path | Setup | Running |
|---|---|---|
| Email digest | £0 | £0 (you print/post) |
| PrintNode + own printer | £0 | ~£a few/mo + paper/postage + a PC left on |
| Mail house (Stannp/Docmail) | £0 | ~50–70p per letter, all-in (print + 1st-class post) |

Database (Supabase/Vercel) and email (Resend) sit comfortably in free tiers at
this volume.

---

## 7. Recommendation

Start with **Phase A + B + email digest** (cheap, proves the daily engine), then
switch the delivery to **a mail house** for true hands-off print+post. Tell me
the print path and I'll build it phase by phase.
