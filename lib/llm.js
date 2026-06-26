import https from 'https';

// Minimal server-side Claude caller (same keys/model as the /api/ai proxy).
export function llmConfigured() { return !!(process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY); }

export function callClaude(payload, timeoutMs = 55000) {
  return new Promise((resolve) => {
    const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY || '';
    const VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';
    const MODEL = process.env.AI_MODEL || 'claude-sonnet-4-6';
    if (!API_KEY) { resolve({ error: 'no_key' }); return; }
    const body = JSON.stringify({ model: MODEL, ...payload });
    const req = https.request('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': VERSION, 'content-length': Buffer.byteLength(body) },
    }, (up) => { let b = ''; up.on('data', (c) => (b += c)); up.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: up.statusCode, json: j }); }); });
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.write(body); req.end();
  });
}

// Pull the concatenated text out of a messages response.
export function textOf(json) {
  if (!json || !Array.isArray(json.content)) return '';
  return json.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}
// Best-effort parse of the first JSON object in a string.
export function extractJson(text) {
  if (!text) return null;
  const fences = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fences && fences[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const m = c.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* try next */ } }
  }
  return null;
}
