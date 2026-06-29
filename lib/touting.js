// Listing-lifecycle touting engine.
//
// A search is a photograph; this adds MEMORY. We snapshot the live Rightmove /
// OnTheMarket index once a day and DIFF today against the stored snapshot. Every
// meaningful change is a touting trigger:
//   • fall-through  — was Sold STC / Under Offer, now back to Available (hottest)
//   • withdrawn     — vanished without ever being Sold (vendor pulled it)
//   • reduced       — asking price dropped (frustrated vendor)
//   • long-DOM      — still Available well beyond the typical sale window
//   • new           — just appeared with a rival (fresh instruction to contest)
// This reproduces the core of paid tools (Spectre etc.) from data we already pull.

const AGREED = /sold stc|under offer|reserved|sale agreed/i;
const isAgreed = (s) => AGREED.test(s || '');
const isAvail = (s) => !s || /available|for sale/i.test(s);

// Signal metadata: base score + human label. Higher score = hotter lead.
export const SIGNALS = {
  fallthrough: { score: 100, label: 'Sale fell through' },
  withdrawn: { score: 80, label: 'Withdrawn (not sold)' },
  reduced: { score: 65, label: 'Price reduced' },
  longdom: { score: 45, label: 'Long on market' },
  new: { score: 30, label: 'New with a rival' },
};

function daysBetween(aISO, bISO) {
  const a = Date.parse(aISO), b = Date.parse(bISO);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round(Math.abs(a - b) / 86400000);
}

// Compact snapshot record kept per property between scans.
function recOf(p, prev, nowISO) {
  return {
    id: String(p.propertyId),
    liveStatus: p.liveStatus || 'Available',
    price: Number(p.price) || 0,
    firstSeen: prev ? prev.firstSeen : nowISO,
    lastSeen: nowISO,
    misses: 0,
    addr: p.displayAddress || p.address || '',
    postcode: p.postcode || '',
    agent: p.agent || '',
    url: p.url || '',
    source: p.source || '',
    district: p.haCode || '',
    firstListed: p.firstListed || (prev && prev.firstListed) || '',
    beds: p.beds || 0,
    propType: p.type || '',
    lat: p.lat != null ? p.lat : (prev ? prev.lat : null),
    lon: p.lon != null ? p.lon : (prev ? prev.lon : null),
  };
}

function mkEvent(signal, rec, nowISO, extra = {}) {
  return {
    signal,
    score: SIGNALS[signal] ? SIGNALS[signal].score : 0,
    label: SIGNALS[signal] ? SIGNALS[signal].label : signal,
    at: nowISO,
    id: rec.id,
    addr: rec.addr,
    postcode: rec.postcode,
    agent: rec.agent,
    url: rec.url,
    source: rec.source,
    district: rec.district,
    price: rec.price,
    beds: rec.beds,
    propType: rec.propType,
    lat: rec.lat,
    lon: rec.lon,
    firstListed: rec.firstListed,
    ...extra,
  };
}

// Diff today's listings against the stored snapshot. Returns the new snapshot and
// the touting events detected. `firstRun` (empty prior snapshot) suppresses the
// "new"/"withdrawn" floods so day one just seeds the baseline.
export function classify(prevSnap, today, nowISO) {
  const prev = prevSnap || {};
  const firstRun = !Object.keys(prev).length;
  const snapshot = {};
  const events = [];
  const seen = new Set();

  for (const p of today) {
    const id = String(p.propertyId || '');
    if (!id) continue;
    seen.add(id);
    const was = prev[id];
    const rec = recOf(p, was, nowISO);
    if (!was) {
      if (!firstRun) events.push(mkEvent('new', rec, nowISO));
    } else {
      if (isAgreed(was.liveStatus) && isAvail(rec.liveStatus)) events.push(mkEvent('fallthrough', rec, nowISO));
      if (was.price && rec.price && rec.price < was.price * 0.98) {
        const drop = was.price - rec.price;
        events.push(mkEvent('reduced', rec, nowISO, { prevPrice: was.price, dropPct: Math.round((drop / was.price) * 100) }));
      }
    }
    snapshot[id] = rec;
  }

  // Listings that disappeared since the last scan.
  for (const id in prev) {
    if (seen.has(id)) continue;
    const was = prev[id];
    const misses = (was.misses || 0) + 1;
    // A genuine withdrawal must be Available (not Sold) and absent for 2+ scans
    // (so a single failed fetch can't invent a lead). Sold-then-gone = completed.
    if (!firstRun && misses === 2 && !isAgreed(was.liveStatus)) events.push(mkEvent('withdrawn', was, nowISO));
    if (misses < 4) snapshot[id] = { ...was, misses };   // keep briefly to absorb a quick relist / fetch gap
  }

  return { snapshot, events };
}

// Standing "long on market" leads, computed from the snapshot on read (not a
// transition). Uses the real listing date when we have it, else when we first
// saw it. Returns hottest-first.
export function longDomLeads(snapshot, nowISO, weeks = 12) {
  const cut = weeks * 7;
  const out = [];
  for (const id in snapshot) {
    const r = snapshot[id];
    if (r.misses) continue;                    // only currently-live listings
    if (isAgreed(r.liveStatus)) continue;
    const anchor = r.firstListed || r.firstSeen;
    const dom = daysBetween(anchor, nowISO);
    if (dom != null && dom >= cut) out.push({ ...mkEvent('longdom', r, nowISO, { dom }), score: SIGNALS.longdom.score + Math.min(40, Math.floor((dom - cut) / 14) * 5) });
  }
  return out.sort((a, b) => b.score - a.score);
}
