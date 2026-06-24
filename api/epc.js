import { EPC_BASE, fetchJson, reverseGeocode, FULL_POSTCODE, sendJson } from '../lib/helpers.js';

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// The road name from a Rightmove address ("12 Hindes Road, Harrow, HA1" → "hindes road").
function streetOf(s) {
  const seg = (s || '').split(',')[0];
  return norm(seg).replace(/^\d+[a-z]?\s+/, '');
}

const FLAT_TYPE = /flat|apartment|maisonette|studio/i;
// Does an EPC address line look like a flat (vs a whole house)?
function looksLikeFlat(line1) {
  const l = (line1 || '').trim();
  return /\b(flat|apartment|apt|unit|maisonette|studio|room)\b/i.test(l) || /^\d+[a-z]\b/i.test(l);
}

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
  const postcodeIn = (u.searchParams.get('postcode') || '').trim().toUpperCase();
  const street = (u.searchParams.get('street') || '').trim();
  const rmType = (u.searchParams.get('type') || '').trim();
  const lat = parseFloat(u.searchParams.get('lat'));
  const lon = parseFloat(u.searchParams.get('lon'));
  const wantStreet = streetOf(street);

  // Resolve which postcode(s) to search: a full one if we have it, otherwise
  // the nearest postcodes to the listing's map pin.
  let postcodes = [];
  if (FULL_POSTCODE.test(postcodeIn)) postcodes = [postcodeIn.replace(/\s+/, ' ')];
  else if (!Number.isNaN(lat) && !Number.isNaN(lon)) postcodes = await reverseGeocode(lat, lon);

  if (!postcodes.length) {
    sendJson(res, 200, { postcode: null, total: 0, candidates: [], note: 'Could not resolve a full postcode for this listing — open it on Rightmove to read the area.' });
    return;
  }

  try {
    // Search postcodes until we find ones on the listing's street.
    let rows = [];
    let usedPostcode = postcodes[0];
    for (const pc of postcodes.slice(0, 6)) {
      const url = `${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(pc).replace(/%20/g, '+')}&page_size=500`;
      const { status, json } = await fetchJson(url, EPC_API_KEY);
      if (status === 401 || status === 403) { sendJson(res, 502, { error: 'EPC register rejected the key (HTTP ' + status + '). Check EPC_API_KEY.' }); return; }
      if (status !== 200) continue;
      const data = (json && json.data) || [];
      if (wantStreet && data.some((r) => norm([r.addressLine1, r.addressLine2, r.addressLine3].filter(Boolean).join(' ')).includes(wantStreet))) {
        rows = data; usedPostcode = pc; break; // this postcode has the right street — use it alone
      }
      if (!rows.length) { rows = data; usedPostcode = pc; }
      if (FULL_POSTCODE.test(postcodeIn)) break;
    }

    // Build candidates.
    let cands = rows.map((r) => {
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

    // De-duplicate repeat certificates for the same address (keep the newest).
    const byAddr = new Map();
    for (const c of cands) {
      const ex = byAddr.get(c._hay);
      if (!ex || (c.certDate || '') > (ex.certDate || '')) byAddr.set(c._hay, c);
    }
    cands = [...byAddr.values()];

    // Keep only addresses on the listing's street (if we know it).
    if (wantStreet) {
      const hits = cands.filter((c) => c._hay.includes(wantStreet));
      if (hits.length) cands = hits;
    }

    // Rank: matching property type (flat vs house) first, then newest cert.
    const rmIsFlat = FLAT_TYPE.test(rmType);
    cands.forEach((c) => { c._typeMatch = rmType ? (looksLikeFlat(c.line1) === rmIsFlat ? 1 : 0) : 0; });
    cands.sort((a, b) => (b._typeMatch - a._typeMatch) || (b.certDate || '').localeCompare(a.certDate || ''));

    cands.forEach((c) => { delete c._hay; delete c._typeMatch; });
    sendJson(res, 200, {
      postcode: usedPostcode,
      street: street || null,
      matchedStreet: Boolean(wantStreet),
      total: cands.length,
      candidates: cands.slice(0, 40),
    });
  } catch (e) {
    sendJson(res, 502, { error: 'EPC lookup failed: ' + e.message });
  }
}
