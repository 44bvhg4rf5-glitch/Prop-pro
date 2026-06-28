// ViralForge — Autonomous TikTok content & marketing agency.
//
// A pipeline of role-based AI agents. Each agent has a distinct job and is fed
// the accumulated output of the agents before it, so the system behaves like a
// small marketing team: a researcher hands findings to a strategist, who briefs
// a scriptwriter, and so on. The whole drop — a week of ready-to-film TikToks —
// is produced from a single seed (niche + optional product + goal).
//
// Runs on the same provider-agnostic LLM layer as the rest of the app, so it
// costs nothing extra: whatever free key is configured (Gemini, Groq…) powers it.

import { runLLM, extractJson } from './llm.js';

// Each agent: id, display name, emoji, one-line role, whether it needs live web
// search, a token budget, and build(ctx) -> { system, user }. `ctx` carries the
// seed plus every prior agent's parsed output under ctx.out[<id>].
export const AGENTS = [
  {
    id: 'scout',
    name: 'Trend Scout',
    emoji: '🔭',
    role: 'Researches live trending products, sounds and video formats in the niche.',
    search: true,
    maxTokens: 1400,
    build: (ctx) => ({
      system:
        'You are a TikTok trend researcher. You find what is working RIGHT NOW for short-form video in a given niche: ' +
        'trending product types, content formats, hooks, sounds and angles. Be concrete and current. ' +
        'Prefer cheap, lightweight, "wow-factor" impulse products that demo well on camera. ' +
        'Return STRICT JSON only, no prose, matching: ' +
        '{"trends":[{"name":"","why":"","format":""}],"products":[{"name":"","price_gbp":"","wow_factor":"","demo_idea":""}],"sounds":[""],"angles":[""]}',
      user:
        `Niche: ${ctx.niche}\n` +
        (ctx.product ? `Specific product in mind: ${ctx.product}\n` : '') +
        `Goal: ${ctx.goal}\n\n` +
        'Find 3-4 current TikTok trends, 3-4 product ideas that could pop in this niche, a few trending sound types, and 3-4 winning angles. JSON only.',
    }),
  },
  {
    id: 'strategist',
    name: 'Strategist',
    emoji: '🧠',
    role: 'Sets the positioning, target audience and content pillars.',
    search: false,
    maxTokens: 1200,
    build: (ctx) => ({
      system:
        'You are a head of social strategy. You turn raw trend research into a sharp, repeatable content strategy for a faceless/low-effort TikTok account that drives sales. ' +
        'Pick ONE clear positioning so the account is not generic. Return STRICT JSON only matching: ' +
        '{"brand_angle":"","target_viewer":"","hero_product":"","content_pillars":[{"name":"","purpose":""}],"big_idea":""}',
      user:
        `Niche: ${ctx.niche}\nGoal: ${ctx.goal}\n\n` +
        `Trend research from the Scout:\n${JSON.stringify(ctx.out.scout || {}, null, 2)}\n\n` +
        'Choose a single hero product and a focused positioning. Define 3 content pillars we can post forever. JSON only.',
    }),
  },
  {
    id: 'scriptwriter',
    name: 'Scriptwriter',
    emoji: '✍️',
    role: 'Writes full shot-by-shot video scripts.',
    search: false,
    maxTokens: 2200,
    build: (ctx) => ({
      system:
        'You are a short-form video scriptwriter who has written hundreds of viral TikToks. ' +
        'You write tight, filmable scripts: a scroll-stopping first line, fast value/story, and a soft CTA. ' +
        'Each script must be shootable on a phone in under 10 minutes with no team. Return STRICT JSON only matching: ' +
        '{"scripts":[{"title":"","pillar":"","duration_seconds":0,"hook_line":"","shots":[{"visual":"","voiceover_or_text":""}],"cta":"","on_screen_text":[""]}]}',
      user:
        `Strategy:\n${JSON.stringify(ctx.out.strategist || {}, null, 2)}\n\n` +
        `Trend research:\n${JSON.stringify(ctx.out.scout || {}, null, 2)}\n\n` +
        'Write 5 distinct video scripts across the content pillars. Vary the formats (demo, problem/solution, story, list, before/after). JSON only.',
    }),
  },
  {
    id: 'hooks',
    name: 'Hook Specialist',
    emoji: '🪝',
    role: 'Generates punchy hook variations — the line that decides virality.',
    search: false,
    maxTokens: 1200,
    build: (ctx) => ({
      system:
        'You are a hook specialist. The first 1-2 seconds decide whether a TikTok lives or dies. ' +
        'You write hooks that trigger curiosity, tension or self-interest, in under 12 words, with zero fluff. ' +
        'Return STRICT JSON only matching: {"hooks":[{"for_script":"","options":["","",""]}],"universal_hooks":[""]}',
      user:
        `Scripts:\n${JSON.stringify(ctx.out.scriptwriter || {}, null, 2)}\n\n` +
        'For each script give 3 alternative hooks to A/B test, plus 5 universal hooks for the niche. JSON only.',
    }),
  },
  {
    id: 'captions',
    name: 'Caption & Hashtag',
    emoji: '🏷️',
    role: 'Writes captions and optimised hashtag sets.',
    search: false,
    maxTokens: 1200,
    build: (ctx) => ({
      system:
        'You write TikTok captions and hashtag strategy. Captions add context or curiosity and prompt a comment. ' +
        'Hashtags mix one broad, a few mid-size and a couple of niche tags — never spammy. ' +
        'Return STRICT JSON only matching: {"posts":[{"for_script":"","caption":"","hashtags":["",""],"comment_pin":""}]}',
      user:
        `Scripts:\n${JSON.stringify(ctx.out.scriptwriter || {}, null, 2)}\n\n` +
        'Write a caption, an 8-tag hashtag set, and a pinned-comment idea for each script. JSON only.',
    }),
  },
  {
    id: 'scheduler',
    name: 'Scheduler',
    emoji: '📅',
    role: 'Builds a 7-day posting calendar with best times.',
    search: false,
    maxTokens: 1100,
    build: (ctx) => ({
      system:
        'You are a posting-cadence planner for a creator with very limited time (under 5 hours a week). ' +
        'You map scripts onto a realistic 7-day calendar, batching filming into one session. ' +
        'Use generally strong TikTok windows (early morning, lunch, evening). Return STRICT JSON only matching: ' +
        '{"film_day":"","batch_plan":"","calendar":[{"day":"","time":"","script_title":"","why_this_slot":""}]}',
      user:
        `Scripts:\n${JSON.stringify(ctx.out.scriptwriter || {}, null, 2)}\n\n` +
        'Lay out a 7-day plan: one batch-filming session, then daily posts. Keep total effort under 5 hours/week. JSON only.',
    }),
  },
  {
    id: 'optimizer',
    name: 'Optimizer',
    emoji: '📊',
    role: 'Scores each piece and recommends what to double down on.',
    search: false,
    maxTokens: 1300,
    build: (ctx) => ({
      system:
        'You are a growth analyst. You predict which pieces are most likely to perform and tell the creator exactly what to test and what to do once a video pops. ' +
        'Be honest about weak ideas. Return STRICT JSON only matching: ' +
        '{"scores":[{"script_title":"","viral_score":0,"reason":""}],"ab_tests":[""],"if_it_pops":[""],"weekly_focus":""}',
      user:
        `Scripts:\n${JSON.stringify(ctx.out.scriptwriter || {}, null, 2)}\n` +
        `Hooks:\n${JSON.stringify(ctx.out.hooks || {}, null, 2)}\n\n` +
        'Score each script 1-10 for viral potential, give A/B tests, a "when a video pops" playbook, and the single focus for the week. JSON only.',
    }),
  },
];

// The Remix Specialist sits outside the weekly pipeline. You invoke it on demand
// once a video pops: it takes the winning hook/format and spins fresh variations
// so you milk a proven idea instead of starting from a blank page. Riding a
// winner is the single highest-ROI move on TikTok.
export const REMIXER = {
  id: 'remixer',
  name: 'Remix Specialist',
  emoji: '🔁',
  role: 'Takes a video that popped and spins 10 fresh variations to milk it.',
  search: false,
  maxTokens: 2000,
  build: (seed) => ({
    system:
      'You are a TikTok growth specialist who milks winning videos. When one video pops, you do NOT move on — you spin ' +
      '10 variations that keep the proven core (the hook mechanic, the format, the product) while changing one lever each ' +
      '(new angle, new first frame, new audience, new objection, new format). Each variation must feel fresh, not a copy. ' +
      'Return STRICT JSON only matching: ' +
      '{"why_it_worked":"","variations":[{"angle":"","new_hook":"","format":"","lever_changed":"","script_beats":["",""]}],"keep_doing":"","stop_doing":"","double_down":""}',
    user:
      `Niche: ${seed.niche || 'n/a'}\n` +
      `Winning video title: ${seed.winner_title || 'n/a'}\n` +
      `Its hook: ${seed.winner_hook || 'n/a'}\n` +
      (seed.why_it_worked ? `Creator's guess on why it worked: ${seed.why_it_worked}\n` : '') +
      (seed.stats ? `Performance: ${seed.stats}\n` : '') +
      '\nFirst, diagnose why it likely worked. Then write 10 distinct variations, each changing ONE lever while keeping the winning core. JSON only.',
  }),
};

// Run the Remix Specialist on a winning video. seed: { niche, winner_title,
// winner_hook, why_it_worked?, stats? }.
export async function runRemix(seed) {
  const { system, user } = REMIXER.build(seed || {});
  const r = await runLLM({ system, messages: [{ role: 'user', content: user }], maxTokens: REMIXER.maxTokens });
  if (r.error) return { id: REMIXER.id, name: REMIXER.name, emoji: REMIXER.emoji, ok: false, error: r.error };
  const data = extractJson(r.text);
  return { id: REMIXER.id, name: REMIXER.name, emoji: REMIXER.emoji, role: REMIXER.role, ok: true, provider: r.provider || null, data: data || null, text: r.text };
}

export function agentList() {
  return AGENTS.map(({ id, name, emoji, role, search }) => ({ id, name, emoji, role, search }));
}

// Run a single agent step. `ctx` must carry the seed (niche/product/goal) and
// any prior outputs under ctx.out. Returns { id, name, ok, data, text, raw }.
export async function runStep(agentId, ctx) {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) return { id: agentId, ok: false, error: 'unknown_agent' };
  const { system, user } = agent.build(ctx);
  const r = await runLLM({
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: agent.maxTokens,
    search: !!agent.search,
  });
  if (r.error) return { id: agent.id, name: agent.name, emoji: agent.emoji, ok: false, error: r.error };
  const data = extractJson(r.text);
  return {
    id: agent.id,
    name: agent.name,
    emoji: agent.emoji,
    role: agent.role,
    ok: true,
    provider: r.provider || null,
    searched: !!r.searched,
    data: data || null,
    text: r.text,
  };
}

// Run the whole agency end-to-end. onStep(result) is called after each agent so
// callers can stream progress. Returns { seed, out, steps }.
export async function runAgency(seed, onStep) {
  const ctx = { niche: seed.niche, product: seed.product || '', goal: seed.goal || 'Drive TikTok Shop sales with zero ad spend', out: {} };
  const steps = [];
  for (const agent of AGENTS) {
    const result = await runStep(agent.id, ctx);
    if (result.ok) ctx.out[agent.id] = result.data || { _text: result.text };
    steps.push(result);
    if (typeof onStep === 'function') await onStep(result, ctx);
  }
  return { seed: { ...ctx, out: undefined }, out: ctx.out, steps };
}
