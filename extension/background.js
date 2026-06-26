// PropMail Pinpoint — background service worker.
//
// Does the actual address resolution, off the page, using the user's own free
// EPC API key. This is a faithful port of the PropMail Pro server logic
// (api/epc.js + lib/helpers.js):
//
//   map pin (lat/lon)  ──reverse-geocode──▶  nearby postcodes   ("pinpoint magnet")
//   nearby postcodes   ──EPC register────▶  candidate addresses on the street
//   candidates         ──type + floor area─▶ ranked best match
//
// Rightmove deliberately offsets its map pins, so we pull SEVERAL nearby
// postcodes and keep the one whose street actually matches the listing.

const EPC_BASE = 'https://api.get-energy-performance-data.communities.gov.uk';
const SQFT_PER_M2 = 10.7639;
const FULL_POSTCODE = /^[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}$/;
const FLAT_TYPE = /flat|apartment|maisonette|studio/i;

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function streetOf(s) {
  const seg = (s || '').split(',')[0];
  return norm(seg).replace(/^\d+[a-z]?\s+/, '').replace(/^(flat|apartment|apt|unit|plot)\s+\w+\s+/, '');
}

function looksLikeFlat(line1) {
  const l = (line1 || '').trim();
  return /\b(flat|apartment|apt|unit|maisonette|studio|room)\b/i.test(l) || /^\d+[a-z]\b/i.test(l);
}

async function getApiKey() {
  const { epcApiKey } = await chrome.storage.local.get('epcApiKey');
  return (epcApiKey || '').trim();
}

// Reverse-geocode a lat/lon to nearby real postcodes (free, no key).
async function reverseGeocode(lat, lon) {
  if (lat == null || lon == null || Number.isNaN(+lat) || Number.isNaN(+lon)) return [];
  try {
    const r = await fetch(`https://api.postcodes.io/postcodes?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}&limit=20&radius=2000`);
    const j = await r.json();
    return ((j && j.result) || []).map((x) => x.postcode).filter(Boolean);
  } catch { return []; }
}

async function epcFetch(path, token) {
  const r = await fetch(EPC_BASE + path, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
  let json = null;
  try { json = await r.json(); } catch { /* leave null */ }
  return { status: r.status, json };
}

// Core resolver — returns { candidates, pcList, sizeMatched, ... } or { error }.
async function resolve(listing) {
  const token = await getApiKey();
  if (!token) {
    return { error: 'No EPC API key set. Click the extension icon → Options to add your free key from get-energy-performance-data.communities.gov.uk' };
  }

  const area = (listing.area || '').toUpperCase();
  const street = listing.displayAddress || '';
  const wantStreet = streetOf(street);
  const inArea = (pc) => !area || (pc || '').toUpperCase().startsWith(area);

  let pcList = [];
  if (FULL_POSTCODE.test(listing.postcode || '')) pcList.push(listing.postcode.replace(/\s+/, ' '));
  pcList.push(...await reverseGeocode(listing.lat, listing.lon));
  pcList = [...new Set(pcList)].filter(inArea).slice(0, 14);

  if (!pcList.length) {
    return { total: 0, candidates: [], pcList: [], note: 'Could not resolve a postcode from the map pin for this listing.' };
  }

  const onStreet = (r) => wantStreet && norm([r.addressLine1, r.addressLine2, r.addressLine3].filter(Boolean).join(' ')).includes(wantStreet);

  try {
    // Use the nearest postcode that actually contains the listing's street.
    let rows = [];
    for (const pc of pcList) {
      const path = `/api/domestic/search?postcode=${encodeURIComponent(pc).replace(/%20/g, '+')}&page_size=500`;
      const { status, json } = await epcFetch(path, token);
      if (status === 401 || status === 403) return { error: 'EPC register rejected the key (HTTP ' + status + '). Check your API key in Options.' };
      const data = (status === 200 && json && Array.isArray(json.data)) ? json.data : [];
      if (!wantStreet) { rows = data; break; }
      if (data.some(onStreet)) { rows = data; break; }
      if (!rows.length) rows = data; // remember something to fall back on
    }

    // Build + de-duplicate (newest certificate per address).
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
        cert: r.certificateNumber || '',
        _hay: norm(full),
      };
      const ex = byAddr.get(c._hay);
      if (!ex || (c.certDate || '') > (ex.certDate || '')) byAddr.set(c._hay, c);
    }
    let cands = [...byAddr.values()].filter((c) => inArea(c.postcode));

    // Keep only addresses on the listing's street, when we know it.
    let streetConfirmed = false;
    if (wantStreet) {
      const hits = cands.filter((c) => c._hay.includes(wantStreet));
      if (hits.length) { cands = hits; streetConfirmed = true; }
    }

    // Narrow by property kind (flat vs house) when unambiguous.
    if (listing.type) {
      const rmIsFlat = FLAT_TYPE.test(listing.type);
      const typed = cands.filter((c) => looksLikeFlat(c.line1) === rmIsFlat);
      if (typed.length) cands = typed;
    }

    // Floor-area match: pull each candidate's EPC floor area and rank by closeness.
    let sizeMatched = false;
    const listingSqft = listing.sizeSqft || 0;
    if (listingSqft > 0 && cands.length > 1) {
      await Promise.all(cands.slice(0, 30).map(async (c) => {
        if (!c.cert) return;
        try {
          const d = await epcFetch(`/api/certificate?certificate_number=${encodeURIComponent(c.cert)}`, token);
          const bodyData = (d.json && d.json.data) ? d.json.data : d.json;
          const m2 = parseFloat(bodyData && bodyData.total_floor_area);
          if (!Number.isNaN(m2) && m2 > 0) {
            c.sizeSqft = Math.round(m2 * SQFT_PER_M2);
            c.sizeDiff = Math.abs(c.sizeSqft - listingSqft);
          }
        } catch { /* no size for this one */ }
      }));
      sizeMatched = cands.some((c) => c.sizeDiff != null);
      cands.sort((a, b) => {
        const ad = a.sizeDiff == null ? Infinity : a.sizeDiff;
        const bd = b.sizeDiff == null ? Infinity : b.sizeDiff;
        if (ad !== bd) return ad - bd;
        return (b.certDate || '').localeCompare(a.certDate || '');
      });
    } else {
      cands.sort((a, b) => (b.certDate || '').localeCompare(a.certDate || ''));
    }

    cands.forEach((c) => { delete c._hay; delete c.cert; });

    if (!cands.length) {
      return { total: 0, candidates: [], pcList, note: wantStreet ? "Couldn't confirm the exact street from the map pin." : 'No EPC records found for the nearby postcodes.' };
    }

    return {
      postcode: cands[0] ? cands[0].postcode : pcList[0],
      street: streetConfirmed ? (street || null) : null,
      listingSqft: listingSqft || null,
      sizeMatched,
      total: cands.length,
      candidates: cands.slice(0, 40),
      pcList,
    };
  } catch (e) {
    return { error: 'EPC lookup failed: ' + e.message };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg) return;
  if (msg.type === 'resolve') {
    resolve(msg.listing || {}).then(reply).catch((e) => reply({ error: String(e && e.message || e) }));
    return true; // async
  }
  if (msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    return false;
  }
});
