import { EPC_BASE, fetchJson, sendJson } from '../lib/helpers.js';

export default async function handler(req, res) {
  const EPC_API_KEY = process.env.EPC_API_KEY || '';
  if (!EPC_API_KEY) {
    sendJson(res, 503, {
      error: 'No EPC_API_KEY configured. Register free at ' +
        'https://get-energy-performance-data.communities.gov.uk and set EPC_API_KEY in the environment.',
    });
    return;
  }

  const u = new URL(req.url, 'http://localhost');
  const postcode = (u.searchParams.get('postcode') || '').trim().toUpperCase();
  const street = (u.searchParams.get('street') || '').trim().toLowerCase();
  if (!postcode) { sendJson(res, 400, { error: 'postcode is required' }); return; }

  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const streetName = norm(street.split(',')[0]);

  const epcUrl = `${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(postcode).replace(/%20/g, '+')}&page_size=500`;

  try {
    const { status, json, body } = await fetchJson(epcUrl, EPC_API_KEY);
    if (status === 401 || status === 403) { sendJson(res, 502, { error: 'EPC register rejected the key (HTTP ' + status + '). Check EPC_API_KEY.' }); return; }
    if (status !== 200) { sendJson(res, 502, { error: 'EPC register returned HTTP ' + status, detail: (body || '').slice(0, 200) }); return; }

    const rows = (json && json.data) || [];
    const candidates = rows.map((r) => {
      const lines = [r.addressLine1, r.addressLine2, r.addressLine3, r.addressLine4].filter(Boolean);
      const full = [...lines, r.postTown, r.postcode].filter(Boolean).join(', ');
      return {
        fullAddress: full,
        line1: r.addressLine1 || '',
        postcode: (r.postcode || '').replace(/\+/g, ' '),
        uprn: r.uprn || '',
        band: r.currentEnergyEfficiencyBand || '',
        certDate: r.registrationDate || '',
        _hay: norm(full),
      };
    });

    let ranked = candidates;
    if (streetName) {
      const hits = candidates.filter((c) => c._hay.includes(streetName));
      ranked = hits.length ? hits : candidates;
    }
    ranked.forEach((c) => delete c._hay);

    sendJson(res, 200, { postcode, street: street || null, total: ranked.length, candidates: ranked.slice(0, 60) });
  } catch (e) {
    sendJson(res, 502, { error: 'EPC lookup failed: ' + e.message });
  }
}
