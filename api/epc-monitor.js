import { EPC_BASE, fetchJson, sendJson, guardOrigin } from '../lib/helpers.js';
import { classifyCerts } from '../lib/epcWatch.js';

export const config = { maxDuration: 60 };

// London boroughs covering the HA postcode area.
const COUNCILS = ['Harrow', 'Brent', 'Hillingdon', 'Barnet', 'Ealing'];
const ALL_HA = ['HA0', 'HA1', 'HA2', 'HA3', 'HA4', 'HA5', 'HA6', 'HA7', 'HA8', 'HA9'];

const ymd = (d) => d.toISOString().slice(0, 10);
const outcodeOf = (pc) => (String(pc).toUpperCase().match(/^[A-Z]{1,2}\d[\dA-Z]?/) || [])[0] || '';

// New-EPC monitor: EPCs lodged recently across the HA area are an early
// "about to come to market" signal — with full addresses.
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const EPC_API_KEY = process.env.EPC_API_KEY || '';
  if (!EPC_API_KEY) {
    sendJson(res, 503, { error: 'No EPC_API_KEY configured. Set it in the environment.' });
    return;
  }

  const u = new URL(req.url, 'http://localhost');
  const days = Math.min(parseInt(u.searchParams.get('days') || '14', 10) || 14, 90);
  const districts = (u.searchParams.get('districts') || ALL_HA.join(','))
    .toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);
  const distSet = new Set(districts);
  const councils = (u.searchParams.get('councils') || COUNCILS.join(','))
    .split(',').map((s) => s.trim()).filter(Boolean);

  // The EPC register rejects a range that includes today, so end at yesterday.
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  try {
    const perCouncil = {};
    const rows = [];
    for (const c of councils) {
      const url = `${EPC_BASE}/api/domestic/search?council%5B%5D=${encodeURIComponent(c)}&date_start=${ymd(start)}&date_end=${ymd(end)}&page_size=5000`;
      const { status, json } = await fetchJson(url, EPC_API_KEY);
      if (status === 401 || status === 403) { sendJson(res, 502, { error: 'EPC register rejected the key (HTTP ' + status + ').' }); return; }
      const data = (status === 200 && json && Array.isArray(json.data)) ? json.data : [];
      perCouncil[c] = data.length;
      rows.push(...data);
    }

    // Keep HA postcodes in the requested districts, newest per address.
    const byKey = new Map();
    for (const r of rows) {
      const pc = (r.postcode || '').replace(/\+/g, ' ').toUpperCase();
      const oc = outcodeOf(pc);
      if (!distSet.has(oc)) continue;
      const lines = [r.addressLine1, r.addressLine2, r.addressLine3, r.addressLine4].filter(Boolean);
      const full = [...lines, r.postTown, pc].filter(Boolean).join(', ');
      const key = r.uprn || full.toLowerCase();
      const item = {
        fullAddress: full, postcode: pc, district: oc,
        band: r.currentEnergyEfficiencyBand || '', lodged: r.registrationDate || '', uprn: r.uprn || '',
        cert: r.certificateNumber || '',
      };
      const ex = byKey.get(key);
      if (!ex || (item.lodged || '') > (ex.lodged || '')) byKey.set(key, item);
    }
    const list = [...byKey.values()].sort((a, b) => (b.lodged || '').localeCompare(a.lodged || ''));

    // WHY was each EPC lodged? The certificate's transaction type separates
    // "about to sell" from "about to let" — the pre-market trigger. Certs are
    // KV-cached, so repeated (and daily cron) runs converge on full coverage.
    const out = list.slice(0, 500);
    let classifyMeta = null;
    if (u.searchParams.get('classify') !== '0') {
      classifyMeta = await classifyCerts(out, EPC_API_KEY, { deadlineMs: 38000 });
    }
    const summary = { sale: 0, rental: 0, other: 0, unknown: 0, pending: 0 };
    out.forEach((p) => { summary[p.kind === 'pending' ? 'pending' : (p.kind || 'unknown')] = (summary[p.kind === 'pending' ? 'pending' : (p.kind || 'unknown')] || 0) + 1; });

    sendJson(res, 200, {
      days, from: ymd(start), to: ymd(end), districts,
      councils: perCouncil, total: list.length, summary, classifyMeta, properties: out,
    });
  } catch (e) {
    sendJson(res, 502, { error: 'EPC monitor failed: ' + e.message });
  }
}
