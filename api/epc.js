import { EPC_BASE, fetchJson, reverseGeocode, FULL_POSTCODE, sendJson } from '../lib/helpers.js';

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// The road name from a Rightmove address ("12 Hindes Road, Harrow, HA1" → "hindes road").
function streetOf(s) {
  const seg = (s || '').split(',')[0];
  return norm(seg).replace(/^\d+[a-z]?\s+/, '').replace(/^(flat|apartment|apt|unit|plot)\s+\w+\s+/, '');
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

  // Postcodes to search: a full one from the listing (if any), plus the
  // nearest postcodes to the map pin (Rightmove offsets the pin, so we cast a
  // small net and then keep only addresses on the listing's actual street).
  let pcList = [];
  if (FULL_POSTCODE.test(postcodeIn)) pcList.push(postcodeIn.replace(/\s+/, ' '));
  if (!Number.isNaN(lat) && !Number.isNaN(lon)) pcList.push(...await reverseGeocode(lat, lon));
  pcList = [...new Set(pcList)].slice(0, 8);

  if (!pcList.length) {
    sendJson(res, 200, { total: 0, candidates: [], note: 'Could not resolve a postcode for this listing — open it on Rightmove to read the area.' });
    return;
  }

  try {
    // Gather addresses across the candidate postcodes.
    let rows = [];
    for (const pc of pcList) {
      const url = `${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(pc).replace(/%20/g, '+')}&page_size=500`;
      const { status, json } = await fetchJson(url, EPC_API_KEY);
      if (status === 401 || status === 403) { sendJson(res, 502, { error: 'EPC register rejected the key (HTTP ' + status + '). Check EPC_API_KEY.' }); return; }
      if (status === 200 && json && Array.isArray(json.data)) rows.push(...json.data);
    }

    // Build + de-duplicate (keep newest certificate per address).
    const byAddr = new Map();
    for (const r of rows) {
      const lines = [r.addressLine1, r.addressLine2, r.addressLine3, r.addressLine4].filter(Boolean);
      const full = [...lines, r.postTown, r.postcode].filter(Boolean).join(', ');
      const c = {
        fullAddress: full,
        line1: r.addressLine1 || '',
        postcode: (r.postcode || '').replace(/\+/g, ' '),
        uprn: r.uprn || '',
        band: r.currentEnergyEfficiencyBand || '',
        certDate: r.registrationDate || '',
        _hay: norm(full),
      };
      const ex = byAddr.get(c._hay);
      if (!ex || (c.certDate || '') > (ex.certDate || '')) byAddr.set(c._hay, c);
    }
    let cands = [...byAddr.values()];

    // Keep only addresses on the listing's street. If we can't confirm the
    // street, return nothing rather than addresses from the wrong road.
    if (wantStreet) {
      const hits = cands.filter((c) => c._hay.includes(wantStreet));
      if (!hits.length) {
        sendJson(res, 200, { total: 0, candidates: [], note: "Couldn't confirm the exact street from the map pin. Open the listing on Rightmove to read the road." });
        return;
      }
      cands = hits;
    }

    // Narrow by property type (flat vs whole house) when that's unambiguous.
    if (rmType) {
      const rmIsFlat = FLAT_TYPE.test(rmType);
      const typed = cands.filter((c) => looksLikeFlat(c.line1) === rmIsFlat);
      if (typed.length) cands = typed;
    }

    // Newest certificate first.
    cands.sort((a, b) => (b.certDate || '').localeCompare(a.certDate || ''));
    cands.forEach((c) => delete c._hay);

    sendJson(res, 200, {
      postcode: cands[0] ? cands[0].postcode : pcList[0],
      street: street || null,
      matchedStreet: Boolean(wantStreet),
      total: cands.length,
      candidates: cands.slice(0, 40),
    });
  } catch (e) {
    sendJson(res, 502, { error: 'EPC lookup failed: ' + e.message });
  }
}
