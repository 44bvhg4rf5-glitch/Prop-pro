# ⚡ ViralForge — Autonomous TikTok Content Agency

A team of role-based AI agents that turns a single seed (a niche) into a full
week of ready-to-film TikTok content + a marketing plan. Built for a creator
with **zero budget and under 5 hours a week**: the agents do the thinking, you
film the batch and post on the calendar.

## The agents (a pipeline, not a chatbot)

Each agent has one job and is fed the output of the agents before it — like a
real marketing team passing work down the line.

| # | Agent | Job |
|---|-------|-----|
| 1 | 🔭 **Trend Scout** | Researches live trending products, sounds & formats (uses web search when the key supports it) |
| 2 | 🧠 **Strategist** | Picks the positioning, hero product, audience & 3 content pillars |
| 3 | ✍️ **Scriptwriter** | Writes 5 shot-by-shot, phone-filmable scripts |
| 4 | 🪝 **Hook Specialist** | 3 A/B hook variations per script (the line that decides virality) |
| 5 | 🏷️ **Caption & Hashtag** | Caption, 8-tag hashtag set & pinned comment per post |
| 6 | 📅 **Scheduler** | A 7-day calendar with one batch-film session + best post times |
| 7 | 📊 **Optimizer** | Scores each video 1–10, gives A/B tests & a "when it pops" playbook |

Plus one on-demand agent that sits **outside** the weekly pipeline:

| — | 🔁 **Remix Specialist** | Feed it a video that popped; it spins 10 fresh variations that keep the winning core and change one lever each. Riding a winner is the highest-ROI move on TikTok. |

## Run it

### In the browser (live dashboard)
```bash
GEMINI_API_KEY=...  node server.js     # or GROQ_API_KEY / ANTHROPIC_API_KEY
# open http://localhost:3000/agency.html
```
Type a niche, hit **Run the agency**, and watch each agent fill in its card.
**Copy full plan** exports the whole drop as JSON.

### Headless / on autopilot (cron-able)
```bash
GEMINI_API_KEY=...  node scripts/agency.js "problem-solving kitchen gadgets"
# writes agency-output.json + prints the scripts and calendar
```
Cron this weekly for a fresh content drop with no hands on keyboard. Every run
also auto-archives a dated copy to `agency-runs/` (override with
`AGENCY_ARCHIVE_DIR`), so you build a history of every niche and angle you've
tried.

### Remix a winner
In the dashboard, scroll to **🔁 Remix a winner**, paste the winning video's
title + hook, and get 10 variations. Or hit the API directly:
```bash
curl -X POST localhost:3000/api/agency -H 'Content-Type: application/json' \
  -d '{"remix":{"niche":"kitchen gadgets","winner_title":"...","winner_hook":"..."}}'
```

## 📦 Production Kit — from script to "make the video"

Once a run finishes, hit **Build Production Kits** (or it's written automatically
by the CLI). For each script you get a paste-ready package:

- **Voiceover block** → paste straight into ElevenLabs or CapCut text-to-speech
- **Shot list** → what to film or generate, in order
- **On-screen text** → CapCut caption overlays
- **Hook options** → A/B test the first frame
- **Caption + hashtags + pinned comment** → the post itself
- **Production checklist** → the steps to ship it

It's a pure transform (no AI call, no cost) — so it works even with no key. The
dashboard gives per-script **Copy for TTS** / **Copy caption** buttons and a
**Download all (.md)** button; the CLI writes
`agency-runs/<date>-<niche>-PRODUCTION-KIT.md`.

### Recommended free tool stack
| Job | Tool (free-first) |
|-----|-------------------|
| Edit + captions | **CapCut** (free) |
| Voiceover | **CapCut TTS** / **ElevenLabs** (free tier) |
| Slideshow / images | **Canva** (free) |
| AI avatar UGC ads | **Creatify / Arcads / HeyGen** (freemium) |
| AI b-roll / scenes | **Veo / Kling / Pika** (freemium) |

> Reality check: for dropshipping, **real footage of the product converts best**.
> Use AI for voiceover, editing, captions, b-roll and hooks — keep the demo real,
> and label AI-generated media as TikTok requires.

## Cost

**£0 extra.** ViralForge reuses the app's provider-agnostic LLM layer
(`lib/llm.js`), so whatever free key you already have (Gemini or Groq free
tiers, etc.) powers all 7 agents. No new dependencies, no build step.

## How it's wired

```
lib/agency.js     # agent roster + orchestrator (runStep / runAgency)
api/agency.js     # HTTP endpoint: GET roster · POST one step · POST all
public/agency.html# standalone live dashboard
scripts/agency.js # headless CLI runner
```

## Honest note on "automatic"

The agents automate the **thinking** — research, scripts, hooks, captions,
scheduling, analysis. You still **film and post** (TikTok rewards a real human
on camera or a real product demo). The realistic path: run ViralForge weekly,
batch-film in one session, post daily, then let the Optimizer tell you what to
double down on once a video takes off.
