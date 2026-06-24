import { EPC_BASE, fetchJson, sendJson } from '../lib/helpers.js';

// London boroughs covering the HA postcode area.
const COUNCILS = ['Harrow', 'Brent', 'Hillingdon', 'Barnet', 'Ealing'];
const ALL_HA = ['HA0', 'HA1', 'HA2', 'HA3', 'HA4', 'HA5', 'HA6', 'HA7', 'HA8', 'HA9'];

const ymd = (d) => d.toISOString().slice(0, 10);
const outcodeOf = (pc) => (String(pc).toUpperCase().match(/^[A-Z]{1,2}\d[\dA-Z]?/) || [])[0] || '';

// New-EPC monitor: EPCs lodged recently across the HA area are an early
// "about to come to market" signal — with full addresses.
export default async function handler(req, res) {
  const EPC_API_KEY = process.env.EPC_API_KEY || '';
  if (!EPC_API_KEY) {
    sendJson(res, 503, { error: 'No EPC_API_KEY configured. Set it in the environment.' });
    return;
  }

  const u = new URL(req.url, 'http://localhost');

  // Diagnostics: discover the real council value + whether date filtering works.
  if (u.searchParams.get('debug')) {
    const pc = (u.searchParams.get('pc') || 'HA1 1BA').toUpperCase();
    const s1 = await fetchJson(`${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(pc).replace(/%20/g, '+')}&page_size=50`, EPC_API_KEY);
    const rows1 = (s1.json && s1.json.data) || [];
    const councilsSeen = [...new Set(rows1.map((r) => r.council).filter(Boolean))];
    const sampleRow = rows1[0] || null;
    const council = u.searchParams.get('council') || councilsSeen[0] || 'Harrow';
    const e = new Date(); const st = new Date(); st.setDate(st.getDate() - 30);
    const base = `council%5B%5D=${encodeURIComponent(council)}`;
    const variants = {
      docExampleDates: `date_start=2021-07-10&date_end=2021-08-10`,
      myRange: `date_start=${ymd(st)}&date_end=${ymd(e)}`,
      fromTo: `from=${ymd(st)}&to=${ymd(e)}`,
      startOnly: `date_start=${ymd(st)}`,
      slashFmt: `date_start=${ymd(st).replace(/-/g, '/')}&date_end=${ymd(e).replace(/-/g, '/')}`,
    };
    const out = {};
    for (const [k, v] of Object.entries(variants)) {
      const r = await fetchJson(`${EPC_BASE}/api/domestic/search?${base}&${v}&page_size=2`, EPC_API_KEY);
      out[k] = { status: r.status, total: (r.json && r.json.pagination && r.json.pagination.totalRecords), err: r.status !== 200 ? (r.body || '').slice(0, 120) : undefined, firstDate: r.json && r.json.data && r.json.data[0] && r.json.data[0].registrationDate };
    }
    sendJson(res, 200, { council, sampleCouncil: sampleRow && sampleRow.council, dateVariants: out });
    return;
  }

  const days = Math.min(parseInt(u.searchParams.get('days') || '14', 10) || 14, 90);
  const districts = (u.searchParams.get('districts') || ALL_HA.join(','))
    .toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);
  const distSet = new Set(districts);
  const councils = (u.searchParams.get('councils') || COUNCILS.join(','))
    .split(',').map((s) => s.trim()).filter(Boolean);

  const end = new Date();
  const start = new Date();
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
      };
      const ex = byKey.get(key);
      if (!ex || (item.lodged || '') > (ex.lodged || '')) byKey.set(key, item);
    }
    const list = [...byKey.values()].sort((a, b) => (b.lodged || '').localeCompare(a.lodged || ''));

    sendJson(res, 200, {
      days, from: ymd(start), to: ymd(end), districts,
      councils: perCouncil, total: list.length, properties: list.slice(0, 500),
    });
  } catch (e) {
    sendJson(res, 502, { error: 'EPC monitor failed: ' + e.message });
  }
}
