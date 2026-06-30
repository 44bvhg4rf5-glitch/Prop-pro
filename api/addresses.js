import https from 'https';
import { EPC_BASE, fetchJson, sendJson, guardOrigin } from '../lib/helpers.js';
import { getBlocklist, buildMatcher, isSuppressed } from '../lib/blocklist.js';
import { freeAddressesForPostcode, freeAddressesForArea, freeAddressesForStreet } from '../lib/freeAddresses.js';
import { streetIntel } from '../lib/streetIntel.js';

export const config = { maxDuration: 60 }; // area / street scans hit several postcodes

function getJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { Accept: 'application/json' } }, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: r.statusCode, json: j }); });
    }).on('error', () => resolve({ status: 502, json: null }));
  });
}

// Title-case an UPPER-CASE PAF address for letters: capitalise each word, but
// keep any token containing a digit fully upper (house numbers like 75A and
// postcode parts like HA2 / 8AB stay correct).
function tcAddr(s) {
  return (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) =>
    /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
}

// Normalise a street/town for loose comparison.
function norm(s) { return (s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }

// Classify a PAF record into a property kind for the search filter.
function classifyKind(d) {
  const cls = (d.CLASSIFICATION_CODE || '').toUpperCase();
  if (cls.startsWith('C')) return 'commercial';
  if (!cls.startsWith('R')) return 'other';
  const flatish = /^RD0?6|^RD0?7/.test(cls) || !!d.SUB_BUILDING_NAME || /\b(FLAT|APARTMENT|MAISONETTE)\b/i.test(d.ADDRESS || '');
  return flatish ? 'flat' : 'house';
}

// Map an OS Places DPA record to our address shape.
function mapDpa(d, fallbackPc) {
  const cls = (d.CLASSIFICATION_CODE || '').toUpperCase();
  const line1 = tcAddr([d.SUB_BUILDING_NAME, d.BUILDING_NAME, d.BUILDING_NUMBER, d.THOROUGHFARE_NAME].filter(Boolean).join(' ').trim());
  return {
    line1,
    fullAddress: tcAddr(d.ADDRESS || ''),
    postcode: d.POSTCODE || fallbackPc || '',
    uprn: d.UPRN ? String(d.UPRN) : '',
    type: cls.startsWith('R') ? 'Residential' : cls.startsWith('C') ? 'Commercial' : 'Other',
    kind: classifyKind(d),
  };
}

// De-duplicate by full address, sort house-number order. (Type filtering is a
// separate step so the user's dropdown choice governs what's kept.)
function cleanAddresses(list) {
  const seen = new Map();
  list.filter((a) => a.fullAddress).forEach((a) => {
    const k = a.fullAddress.toLowerCase();
    if (!seen.has(k)) seen.set(k, a);
  });
  return [...seen.values()].sort((a, b) => a.fullAddress.localeCompare(b.fullAddress, undefined, { numeric: true }));
}

// Apply the user's "what to produce" dropdown choice.
//   homes (default) = houses + flats   ·   houses   ·   flats   ·   all (+ commercial)
function filterByType(list, types) {
  if (types === 'all') return list;
  if (types === 'houses') return list.filter((a) => a.kind === 'house');
  if (types === 'flats') return list.filter((a) => a.kind === 'flat');
  return list.filter((a) => a.kind === 'house' || a.kind === 'flat');
}

// Pull a UK postcode / outcode token out of free text, returning the cleaned
// street and the prefix (e.g. "Kenton Road HA3" → {street:'Kenton Road', prefix:'HA3'}).
function splitStreetPostcode(input) {
  const re = /\b[A-Z]{1,2}\d[A-Z\d]?(?:\s*\d[A-Z]{2})?\b/gi;
  let m, last = null;
  while ((m = re.exec(input)) !== null) last = m;
  if (!last) return { prefix: '', street: input.trim() };
  const token = last[0];
  const prefix = token.toUpperCase().replace(/\s+/g, '');
  const street = (input.slice(0, last.index) + input.slice(last.index + token.length))
    .replace(/\s+/g, ' ').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/[,\s]+$/, '').trim();
  return { prefix, street };
}

// Page an OS Places endpoint ('postcode' or 'find') in parallel, capped.
// Returns { status, results:[DPA…], total }.
async function osPaged(kind, value, OS, maxAddr) {
  const param = kind === 'find' ? 'query' : 'postcode';
  const pageUrl = (offset) => `https://api.os.uk/search/places/v1/${kind}?${param}=${encodeURIComponent(value)}`
    + `&dataset=DPA&maxresults=100&offset=${offset}&key=${encodeURIComponent(OS)}`;
  const first = await getJson(pageUrl(0));
  if (first.status !== 200 || !first.json || !Array.isArray(first.json.results)) {
    return { status: first.status, results: [], total: 0 };
  }
  const results = first.json.results.map((r) => r.DPA).filter(Boolean);
  const total = (first.json.header && first.json.header.totalresults) || results.length;
  const want = Math.min(total, maxAddr);
  const offsets = [];
  for (let o = 100; o < want; o += 100) offsets.push(o);
  const CONC = 8;
  for (let i = 0; i < offsets.length; i += CONC) {
    const rs = await Promise.all(offsets.slice(i, i + CONC).map((o) => getJson(pageUrl(o))));
    rs.forEach((r) => {
      if (r.status === 200 && r.json && Array.isArray(r.json.results)) results.push(...r.json.results.map((x) => x.DPA).filter(Boolean));
    });
  }
  return { status: 200, results, total };
}

// Street search: every address on a named street, across all its postcodes,
// via the OS Places free-text "find" endpoint (paged). OS key required.
// An optional postcode/outcode in the query (e.g. "Kenton Road HA3") narrows
// results to that district.
async function streetSearch(res, rawStreet, OS, notBlocked = () => true, types = 'homes') {
  if (!OS) {
    sendJson(res, 200, { street: rawStreet, total: 0, addresses: [], error: 'Street search needs an OS Places key (the EPC register can only look up by postcode).' });
    return;
  }
  const { prefix, street } = splitStreetPostcode(rawStreet);
  const parts = street.split(',').map((s) => s.trim()).filter(Boolean);
  const streetName = norm(parts[0]);
  const town = norm(parts.slice(1).join(' '));
  const { results } = await osPaged('find', rawStreet, OS, 600);
  const wanted = results.filter((d) => {
    const thoro = norm(d.THOROUGHFARE_NAME);
    const depThoro = norm(d.DEPENDENT_THOROUGHFARE_NAME);
    const onStreet = streetName && (thoro === streetName || depThoro === streetName);
    const inTown = !town || norm(d.POST_TOWN).includes(town) || norm(d.ADDRESS).includes(town);
    const inPrefix = !prefix || (d.POSTCODE || '').toUpperCase().replace(/\s+/g, '').startsWith(prefix);
    return onStreet && inTown && inPrefix;
  }).map((d) => mapDpa(d));
  const addresses = filterByType(cleanAddresses(wanted).filter(notBlocked), types);
  const postcodes = [...new Set(addresses.map((a) => a.postcode).filter(Boolean))];
  sendJson(res, 200, {
    street: rawStreet, source: 'Royal Mail / OS Places', total: addresses.length, addresses, postcodes,
    note: addresses.length ? `${addresses.length} homes across ${postcodes.length} postcode(s)${prefix ? ' in ' + prefix : ''}.`
      : `No matching addresses — check the street name${prefix ? ' / district ' + prefix : ''} and include the town (e.g. "Kenton Road, Harrow, HA3").`,
  });
}

// All addresses at a postcode (or street). Uses the OS Places API (Royal Mail
// PAF) when an OS_PLACES_KEY is configured; otherwise falls back to the EPC
// register for postcode lookups.
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const OS_KEY = process.env.OS_PLACES_KEY || '';

  // Temp diagnostic: does the EPC domestic search expose a tenure field?
  if (u.searchParams.get('epcfields')) {
    const k = process.env.EPC_API_KEY || '';
    if (!k) { sendJson(res, 200, { epcKey: false }); return; }
    const url = `${EPC_BASE}/api/domestic/search?postcode=HA1+4HZ&page_size=3`;
    const { status, json } = await fetchJson(url, k);
    const row = (json && json.data && json.data[0]) || {};
    sendJson(res, 200, { status, keys: Object.keys(row), tenure: row.tenure, sampleTenures: (json && json.data || []).map((r) => r.tenure) });
    return;
  }

  // Autocomplete suggestions — handled first (fires per keystroke, so no
  // blocklist/Redis lookup here; keep it fast and light).
  const suggest = u.searchParams.get('suggest');
  if (suggest !== null) {
    const text = (suggest || '').trim();
    let suggestions = [];
    if (OS_KEY && text.length >= 3) {
      const url = `https://api.os.uk/search/places/v1/find?query=${encodeURIComponent(text)}&dataset=DPA&maxresults=10&key=${encodeURIComponent(OS_KEY)}`;
      const { status, json } = await getJson(url);
      if (status === 200 && json && Array.isArray(json.results)) {
        suggestions = json.results.map((r) => r.DPA).filter(Boolean).map((d) => mapDpa(d)).filter((a) => a.fullAddress).slice(0, 10);
      }
    }
    sendJson(res, 200, { suggestions });
    return;
  }

  // What to produce — the search dropdown choice.
  const allowedTypes = ['homes', 'houses', 'flats', 'all'];
  let types = (u.searchParams.get('types') || 'homes').toLowerCase();
  if (!allowedTypes.includes(types)) types = 'homes';

  // Load the do-not-mail list once; blocked addresses are stripped from every
  // result path so a suppressed property can never surface.
  const block = await getBlocklist();
  const matcher = buildMatcher(block.entries);
  const notBlocked = (a) => !isSuppressed(a, matcher);

  // Street mode takes precedence when a ?street= is supplied.
  const street = (u.searchParams.get('street') || '').trim();
  if (street) {
    // Free Council Tax street search (complete + powers the snapshot). OS Places
    // is only a last resort if this yields nothing.
    const { prefix, street: cleaned } = splitStreetPostcode(street);
    const parts = cleaned.split(',').map((s) => s.trim()).filter(Boolean);
    const roadName = parts[0] || cleaned;
    const areaToken = prefix || parts.slice(1).join(', ') || 'Harrow';
    const r = await freeAddressesForStreet(roadName, areaToken, { epcKey: process.env.EPC_API_KEY || '' }).catch(() => ({ addresses: [], postcodes: [] }));
    const addresses = filterByType(cleanAddresses(r.addresses).filter(notBlocked), types);
    if (addresses.length) {
      let intel = null;
      try { intel = await streetIntel({ streetName: roadName, postcodes: r.postcodes || [], homes: addresses.length, outcode: prefix, epcKey: process.env.EPC_API_KEY || '' }); } catch { /* best-effort */ }
      sendJson(res, 200, {
        street, source: 'Council Tax register', total: addresses.length, addresses, postcodes: r.postcodes || [], intel,
        note: `${addresses.length} homes across ${(r.postcodes || []).length} postcode(s)${prefix ? ' in ' + prefix : ''}, from the free Council Tax register.`,
      });
      return;
    }
    // Last resort: OS Places, if a key is set.
    if (OS_KEY) { await streetSearch(res, street, OS_KEY, notBlocked, types); return; }
    sendJson(res, 200, { street, source: 'Council Tax register', total: 0, addresses: [], postcodes: [], note: `No matching addresses — include the town or a postcode (e.g. "${roadName}, Harrow" or "${roadName} HA1").` });
    return;
  }

  const postcode = (u.searchParams.get('postcode') || '').trim().toUpperCase();
  if (!postcode) { sendJson(res, 400, { error: 'postcode or street is required' }); return; }

  const OS = OS_KEY;
  const debug = !!process.env.DEBUG_KEY && u.searchParams.get('debug') === process.env.DEBUG_KEY;
  const isFull = /\d[A-Z]{2}$/.test(postcode.replace(/\s+/g, ''));
  const epcKey = process.env.EPC_API_KEY || '';

  // 1. FREE complete path (PRIMARY): Council Tax (∪ EPC) — every dwelling, and
  //    it powers the Street snapshot. Used first regardless of any OS key, since
  //    it's complete + free; OS/EPC are fallbacks only if this comes up empty.
  try {
    if (isFull) {
      const list = await freeAddressesForPostcode(postcode, { epcKey });
      const addresses = filterByType(cleanAddresses(list).filter(notBlocked), types);
      if (addresses.length) {
        let intel = null;
        try { intel = await streetIntel({ streetName: '', postcodes: [postcode], homes: addresses.length, epcKey }); } catch { /* best-effort */ }
        sendJson(res, 200, { postcode, source: 'Council Tax register' + (epcKey ? ' + EPC' : ''), total: addresses.length, addresses, intel });
        return;
      }
    } else {
      const r = await freeAddressesForArea(postcode, { epcKey, maxPostcodes: 30 });
      const addresses = filterByType(cleanAddresses(r.addresses).filter(notBlocked), types);
      if (addresses.length) {
        sendJson(res, 200, {
          postcode, source: 'Council Tax register', total: addresses.length, addresses, totalAvailable: r.postcodesAvailable,
          note: `Scanned ${r.postcodesScanned} of ~${r.postcodesAvailable} postcodes near ${postcode} (free Council Tax register). Search a full postcode or a street name for a complete list.`,
        });
        return;
      }
    }
  } catch { /* fall through to OS / EPC */ }

  // 2. OS Places (Royal Mail PAF) — only if the free path came up empty.
  const cap = isFull ? 500 : 3000;
  let osDiag = { osKeyPresent: !!OS, osStatus: null, osError: null };
  if (OS) {
    try {
      const { status, results, total } = await osPaged('postcode', postcode, OS, cap);
      osDiag.osStatus = status;
      if (status === 200 && results.length) {
        const addresses = filterByType(cleanAddresses(results.map((d) => mapDpa(d, postcode))).filter(notBlocked), types);
        sendJson(res, 200, {
          postcode, source: 'Royal Mail / OS Places', total: addresses.length, addresses, totalAvailable: total,
          note: total > cap ? `District ${postcode} has ${total} addresses; showing the first ${addresses.length}. Search a sector for specific areas.` : undefined,
        });
        return;
      }
      osDiag.osError = 'unexpected response';
    } catch (e) { osDiag.osError = e.message; }
  }
  if (debug) { sendJson(res, 200, { postcode, debug: osDiag, hasEpcKey: !!epcKey }); return; }

  // 3. EPC register fallback (works with the existing key).
  const KEY = process.env.EPC_API_KEY || '';
  if (KEY) {
    try {
      const url = `${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(postcode).replace(/%20/g, '+')}&page_size=500`;
      const { status, json } = await fetchJson(url, KEY);
      // The EPC register returns 200 with a data array when there are records,
      // and 404 (or 200 with no data) for a postcode with no certificates.
      // Both are valid "we looked, here's what's registered" answers.
      const data = (status === 200 && json && Array.isArray(json.data)) ? json.data : [];
      const seen = new Map();
      data.forEach((r) => {
        const lines = [r.addressLine1, r.addressLine2, r.addressLine3, r.addressLine4].filter(Boolean);
        const pc = (r.postcode || '').replace(/\+/g, ' ');
        const full = [...lines, r.postTown, pc].filter(Boolean).join(', ');
        const key = full.toLowerCase();
        if (full && !seen.has(key)) seen.set(key, { line1: r.addressLine1 || lines[0] || '', fullAddress: full, postcode: pc, uprn: r.uprn ? String(r.uprn) : '', type: 'Residential', kind: /\b(flat|apartment|maisonette)\b/i.test(full) ? 'flat' : 'house' });
      });
      const addresses = filterByType([...seen.values()].sort((a, b) => a.fullAddress.localeCompare(b.fullAddress, undefined, { numeric: true })).filter(notBlocked), types);
      sendJson(res, 200, {
        postcode, source: 'EPC register', total: addresses.length, addresses,
        note: addresses.length
          ? 'Homes with an Energy Certificate. Add a free OS Places key for the complete Royal Mail list.'
          : 'No registered Energy Certificates at this postcode (common for town-centre / commercial postcodes). Add a free OS Places key for the complete Royal Mail list.',
      });
      return;
    } catch { /* fall through to the no-source response */ }
  }

  sendJson(res, 200, { postcode, total: 0, addresses: [], error: 'No address source available. Set EPC_API_KEY or OS_PLACES_KEY.' });
}
