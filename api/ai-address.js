import https from 'https';
import { readBody, sendJson, guardOrigin } from '../lib/helpers.js';
import { runLLM, llmConfigured, extractJson, provider } from '../lib/llm.js';
import { rightmoveProperty } from '../lib/sources.js';

export const config = { maxDuration: 45 };

// AI address cross-checker. The deterministic engine (api/resolve) pins the house
// from the registers + the map pin. This endpoint asks an AI to find the full
// address a DIFFERENT way — from the listing's own description plus Land Registry
// sold-price records — and then cross-references the two. When both independently
// agree on the same house number, that's a genuine double-confirmation. When they
// disagree, we surface it for a human rather than guessing.

const leadNum = (s) => ((String(s || '').trim().match(/(\d+[a-z]?)/i) || [])[1] || '').toLowerCase();

// Real sold addresses on an exact postcode, straight from HM Land Registry — an
// independent, authoritative list of house numbers that actually exist.
function landRegistryByPostcode(postcode) {
  return new Promise((resolve) => {
    const pc = String(postcode || '').toUpperCase().trim();
    if (!/^[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}$/.test(pc)) { resolve([]); return; }
    const url = `https://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${encodeURIComponent(pc)}&_pageSize=80&_sort=-transactionDate`;
    const r = https.get(url, { headers: { 'User-Agent': 'PropMailPro/1.0', Accept: 'application/json' } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => {
        try {
          const items = (JSON.parse(b).result || {}).items || [];
          const seen = new Map();
          for (const t of items) {
            const a = t.propertyAddress || {};
            const full = [a.paon, a.street].filter(Boolean).join(' ').trim();
            if (!full) continue;
            const k = full.toLowerCase();
            if (!seen.has(k)) seen.set(k, { paon: a.paon || '', street: a.street || '', postcode: (a.postcode || '').toUpperCase(), lastSold: t.transactionDate ? String(t.transactionDate).slice(0, 10) : '' });
          }
          resolve([...seen.values()]);
        } catch { resolve([]); }
      });
    });
    r.on('error', () => resolve([]));
    r.setTimeout(12000, () => { r.destroy(); resolve([]); });
  });
}

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return; }
  if (!llmConfigured()) { sendJson(res, 503, { error: 'No AI key configured — add a provider key in project settings.' }); return; }

  let raw;
  if (req.body && typeof req.body === 'object') raw = JSON.stringify(req.body);
  else if (typeof req.body === 'string') raw = req.body;
  else raw = await readBody(req);
  let p = {}; try { p = JSON.parse(raw); } catch { /* ignore */ }

  const url = (p.url || '').trim();
  const street = (p.street || '').trim();
  const type = (p.type || '').trim();
  const beds = p.beds || 0;
  const size = p.size || 0;
  const candIn = Array.isArray(p.candidates) ? p.candidates.slice(0, 14) : [];
  const engineTop = candIn[0] || null;            // engine's best-ranked candidate
  const engineConfidence = (p.engineConfidence || 'low');

  // Independent evidence the engine doesn't use: the listing's own words + the pin.
  let listing = null;
  if (url) listing = await rightmoveProperty(url).catch(() => null);
  const postcode = (listing && listing.postcode) || (p.postcode || '').trim();
  const sold = await landRegistryByPostcode(postcode);

  // Assemble the candidate set the AI is allowed to choose from: register matches
  // ∪ real sold addresses. The AI must pick from these (or say "unsure") — it may
  // not invent a number, which is what keeps it honest.
  const registerList = candIn.map((c) => ({ address: c.fullAddress, sqft: c.sizeSqft || null, metresFromPin: c.distM != null ? c.distM : null }));
  const soldList = sold.map((s) => `${s.paon} ${s.street}${s.lastSold ? ' (last sold ' + s.lastSold + ')' : ''}`);

  const sys = 'You are a UK property address verifier for an estate agency. Your job is to identify the EXACT full postal address (with house/flat number) of a specific Rightmove listing, working ONLY from the evidence given. You never invent a house number. If the evidence does not point clearly to one address, you say so and give your best estimate with low confidence. You reply with ONLY a JSON object, no prose.';

  const prompt = `LISTING (house number hidden by the agent):
- Displayed as: ${street || '(unknown)'}
- Postcode: ${postcode || '(unknown)'}
- Type: ${type || '?'} · Beds: ${beds || '?'} · Floor area: ${size ? size + ' sq ft' : '?'}
${listing && listing.description ? '- Description: "' + listing.description + '"' : ''}
${listing && listing.keyFeatures && listing.keyFeatures.length ? '- Key features: ' + listing.keyFeatures.join('; ') : ''}

CANDIDATE ADDRESSES from the energy-certificate register + map pin (floor area and distance from the listing's map pin shown):
${registerList.length ? registerList.map((c, i) => `${i + 1}. ${c.address}${c.sqft ? ' — ' + c.sqft + ' sq ft' : ''}${c.metresFromPin != null ? ' — ' + c.metresFromPin + ' m from pin' : ''}`).join('\n') : '(none)'}

REAL ADDRESSES on this postcode from HM Land Registry sold-price records:
${soldList.length ? soldList.join('\n') : '(none found)'}

TASK: Decide which single full address this listing most likely is. Cross-check the floor area, the distance from the map pin, the property type/beds, and any clue in the description (corner plot, private drive, a number mentioned, position on the street). Prefer an address that appears in BOTH the register list AND the Land Registry list. Do NOT output a house number that is not supported by the evidence above.

Reply with ONLY this JSON:
{"fullAddress":"<best full address incl. postcode, or empty string if truly unsure>","houseNumber":"<just the number, e.g. 92>","confidence":"high|medium|low","reasoning":"<one or two sentences citing the specific evidence>","inRegister":true|false,"inLandRegistry":true|false}`;

  const searchCapable = ['anthropic', 'gemini'].includes(provider());
  const r = await runLLM({ system: sys, user: prompt, maxTokens: 700, search: searchCapable, timeoutMs: 40000 });
  if (r.error) { sendJson(res, 502, { error: 'AI lookup failed: ' + r.error }); return; }

  const ai = extractJson(r.text) || {};
  const aiNum = leadNum(ai.houseNumber || ai.fullAddress || '');
  const engineNum = engineTop ? leadNum(engineTop.line1 || engineTop.fullAddress || '') : '';

  // Cross-reference the two independent methods.
  let verdict, headline, agreed = false;
  if (aiNum && engineNum && aiNum === engineNum) { verdict = 'double_confirmed'; headline = 'Double-confirmed'; agreed = true; }
  else if (aiNum && engineNum) { verdict = 'conflict'; headline = 'Two methods disagree — check the listing'; }
  else if (aiNum && !engineNum) { verdict = 'ai_only'; headline = 'AI found an address the register missed'; }
  else { verdict = 'unresolved'; headline = 'Not enough evidence — read the number on the listing'; }

  // Combined confidence: agreement on two independent methods is the strongest.
  let combinedConfidence = 'low';
  if (agreed && (ai.confidence === 'high' || engineConfidence === 'high')) combinedConfidence = 'high';
  else if (agreed) combinedConfidence = 'medium';
  else if (verdict === 'ai_only' && ai.confidence === 'high' && ai.inLandRegistry) combinedConfidence = 'medium';

  sendJson(res, 200, {
    verdict, headline, agreed, combinedConfidence,
    ai: {
      fullAddress: ai.fullAddress || '', houseNumber: ai.houseNumber || '',
      confidence: ai.confidence || 'low', reasoning: ai.reasoning || '',
      inRegister: !!ai.inRegister, inLandRegistry: !!ai.inLandRegistry,
    },
    engine: engineTop ? { fullAddress: engineTop.fullAddress, confidence: engineConfidence } : null,
    evidence: {
      usedDescription: !!(listing && listing.description),
      landRegistryCount: sold.length,
      searchEnabled: searchCapable,
      provider: provider(),
    },
  });
}
