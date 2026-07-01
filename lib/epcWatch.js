import { EPC_BASE, fetchJson } from './helpers.js';
import { getJSON, setJSON, storeConfigured } from './store.js';

// ── EPC Watch: classify WHY each new EPC was lodged ─────────────────────────
// Owners must lodge an EPC BEFORE marketing a sale or a let, and the
// certificate records the reason (transaction type). So a fresh lodgement
// classified "marketed sale" = a home about to hit the sales market; "rental"
// = about to be advertised to let — leads that exist before Rightmove, before
// any rival letter. This is the free version of Spectre's propensity trigger.

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const tc = (s) => (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));

// Transaction-type → meaning. Handles both the register's integer codes and
// label strings.
export function decodeTxType(t) {
  const s = String(t == null ? '' : t).toLowerCase().trim();
  if (s === '1' || /marketed sale/.test(s)) return { kind: 'sale', label: 'About to sell' };
  if (s === '2' || /non.?marketed sale/.test(s)) return { kind: 'other', label: 'Private sale' };
  if (s === '3' || /rental \(private\)|private rent|^rental$/.test(s)) return { kind: 'rental', label: 'About to let' };
  if (/rental \(social\)/.test(s)) return { kind: 'other', label: 'Social rental' };
  if (s === '8' || /new dwelling/.test(s)) return { kind: 'other', label: 'New build' };
  if (!s || s === '9' || /not recorded|none of the above|not sale or rental/.test(s)) return { kind: 'unknown', label: 'Not recorded' };
  return { kind: 'other', label: tc(s) };
}

// Certificate detail (tx type + tenure + size), KV-cached per cert — a cert
// never changes, so each is fetched from the register once ever.
const _mem = new Map();
async function certTx(cert, key) {
  if (_mem.has(cert)) return _mem.get(cert);
  const ck = 'epcwt:' + cert;
  if (storeConfigured()) { const c = await getJSON(ck, null); if (c) { _mem.set(cert, c); return { ...c, cached: true }; } }
  let out = null;
  for (const wait of [0, 700, 1800]) {
    if (wait) await sleep(wait);
    const { status, json } = await fetchJson(`${EPC_BASE}/api/certificate?certificate_number=${encodeURIComponent(cert)}`, key);
    if (status === 200) {
      const b = (json && json.data) ? json.data : json;
      if (b) out = { tx: b.transaction_type ?? b.TRANSACTION_TYPE ?? null, tenure: (b.tenure ?? b.TENURE ?? null), sqm: b.total_floor_area ? Math.round(+b.total_floor_area) || null : null };
      break;
    }
    if (status !== 429) break;
  }
  if (out) { _mem.set(cert, out); if (_mem.size > 5000) _mem.clear(); if (storeConfigured()) setJSON(ck, out).catch(() => {}); }
  return out;
}

// Classify a list of items ({cert}) in place. Cached certs resolve instantly;
// fresh ones are fetched sequentially (the register throttles bursts) until
// the deadline, so daily runs converge on a fully classified list.
export async function classifyCerts(items, key, { deadlineMs = 38000, gap = 90 } = {}) {
  const t0 = Date.now();
  let classified = 0, pending = 0;
  for (const it of items) {
    if (!it.cert) { it.kind = 'unknown'; continue; }
    if (Date.now() - t0 > deadlineMs) { it.kind = it.kind || 'pending'; pending++; continue; }
    const d = await certTx(it.cert, key);
    if (d) {
      const tx = decodeTxType(d.tx);
      it.txType = tx.label; it.kind = tx.kind;
      if (d.tenure != null) it.tenure = String(d.tenure);
      if (d.sqm) it.sqm = d.sqm;
      classified++;
      if (!d.cached && gap) await sleep(gap);
    } else { it.kind = 'unknown'; }
  }
  return { classified, pending };
}
