import { readBody, sendJson, guardOrigin } from '../lib/helpers.js';
import { llmConfigured } from '../lib/llm.js';
import { agentList, runStep, AGENTS } from '../lib/agency.js';

// ViralForge endpoint — the autonomous TikTok content agency.
//
//   GET  /api/agency                 -> { configured, agents:[...] }   (roster)
//   POST /api/agency { step, ctx }   -> runs ONE agent, returns its output
//   POST /api/agency { all, seed }   -> runs the whole pipeline at once
//
// The per-step mode lets the front-end drive the pipeline one agent at a time
// and render each card as it lands (and dodges serverless time limits). The
// `all` mode is for headless/CLI use where one long call is fine.
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;

  if (req.method === 'GET') {
    sendJson(res, 200, { configured: llmConfigured(), agents: agentList() });
    return;
  }
  if (req.method !== 'POST') { sendJson(res, 405, { error: { message: 'Method not allowed' } }); return; }
  if (!llmConfigured()) {
    sendJson(res, 503, { error: { type: 'configuration_error', message: 'No AI key configured. Add a free key (e.g. GEMINI_API_KEY or GROQ_API_KEY) in project settings.' } });
    return;
  }

  let raw;
  if (req.body && typeof req.body === 'object') raw = JSON.stringify(req.body);
  else if (typeof req.body === 'string') raw = req.body;
  else raw = await readBody(req);
  let payload = {};
  try { payload = JSON.parse(raw); } catch { /* ignore */ }

  const seed = payload.seed || {};
  if (!seed.niche || !String(seed.niche).trim()) {
    sendJson(res, 400, { error: { message: 'A niche is required to brief the agents.' } });
    return;
  }

  // Run the full pipeline in one shot (headless mode).
  if (payload.all) {
    const ctx = { niche: seed.niche, product: seed.product || '', goal: seed.goal || '', out: {} };
    const steps = [];
    for (const a of AGENTS) {
      const result = await runStep(a.id, ctx);
      if (result.ok) ctx.out[a.id] = result.data || { _text: result.text };
      steps.push(result);
    }
    sendJson(res, 200, { out: ctx.out, steps });
    return;
  }

  // Run one named step. The client passes the accumulated outputs back each time.
  const stepId = payload.step;
  if (!stepId) { sendJson(res, 400, { error: { message: 'Provide a step (agent id) or set all:true.' } }); return; }
  const ctx = { niche: seed.niche, product: seed.product || '', goal: seed.goal || '', out: payload.out || {} };
  const result = await runStep(stepId, ctx);
  sendJson(res, 200, result);
}
