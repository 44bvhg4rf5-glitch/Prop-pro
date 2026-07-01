import { rightmoveListings, onTheMarketListings, mergeListings } from './sources.js';

// ── Rental Intelligence (the Spectre-equivalent, + our off-market edge) ──────
// Spectre's core lettings value is a live picture of the rental market: every
// tenanted / to-let property, WHICH agent holds it, the rent, and its status —
// so you can tout the landlord (especially at renewal) and switch them off a
// rival. We build the same from the portals (Rightmove incl. Let Agreed + OTM),
// then rank by competitor agent, street and status.
//
// Our edge over Spectre: the EPC-tenure engine knows rentals that were NEVER
// advertised (self-managed, no agent) — invisible to any portal-only tool.

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const streetOf = (addr) => norm(String(addr || '').split(',')[0].replace(/^\s*(flat|apartment|apt|unit|room)\s+[\w-]+,?\s*/i, '').replace(/^\d+[a-z]?\s*/i, ''));
const isLetAgreed = (l) => /let agreed|under offer/i.test(l.liveStatus || '');

function agentKey(a) { return norm(a).replace(/\b(estate agents?|lettings?|property|properties|sales|and|&|the|ltd|limited|llp)\b/g, '').replace(/\s+/g, ' ').trim() || norm(a); }

export async function rentalIntelForArea(district, { pages = 3 } = {}) {
  const [rm, otm] = await Promise.all([
    rightmoveListings(district, { channel: 'rent', pages, includeSSTC: true }).catch(() => []),
    onTheMarketListings(district, { channel: 'rent', pages }).catch(() => []),
  ]);
  const all = mergeListings([rm, otm]).filter((l) => /rent|let/i.test(l.status));

  // de-dupe across portals by address+rent
  const byAddr = new Map();
  for (const l of all) {
    const k = norm(l.displayAddress || l.address) + '|' + (l.price || '');
    if (!byAddr.has(k)) byAddr.set(k, l);
  }
  const listings = [...byAddr.values()];

  const agents = new Map();
  const streets = new Map();
  const rents = [];
  let available = 0, letAgreed = 0, reduced = 0;

  for (const l of listings) {
    const let_ = isLetAgreed(l);
    if (let_) letAgreed++; else available++;
    if (l.reduced) reduced++;
    if (l.price) rents.push(l.price);

    const ak = agentKey(l.agent || 'Unknown / private');
    const ag = agents.get(ak) || { agent: l.agent || 'Unknown / private', total: 0, letAgreed: 0, reduced: 0, samples: [] };
    ag.total++; if (let_) ag.letAgreed++; if (l.reduced) ag.reduced++;
    if (ag.samples.length < 6) ag.samples.push({ address: l.displayAddress || l.address, rent: l.price, status: let_ ? 'Let Agreed' : 'Available', reduced: !!l.reduced, url: l.url || '' });
    agents.set(ak, ag);

    const sk = streetOf(l.displayAddress || l.address);
    if (sk) { const st = streets.get(sk) || { street: sk.replace(/\b[a-z]/g, (c) => c.toUpperCase()), count: 0 }; st.count++; streets.set(sk, st); }
  }

  rents.sort((a, b) => a - b);
  const rentMedian = rents.length ? rents[Math.floor(rents.length / 2)] : 0;

  const byAgent = [...agents.values()].sort((a, b) => b.total - a.total);
  const byStreet = [...streets.values()].sort((a, b) => b.count - a.count);

  // Touting leads, hottest first: reduced (keen landlord) then let-agreed (renewal ~12mo).
  const reducedLeads = listings.filter((l) => l.reduced).map(shape);
  const letAgreedLeads = listings.filter(isLetAgreed).map(shape);

  return {
    district,
    counts: { total: listings.length, available, letAgreed, reduced, agents: byAgent.length },
    rentMedian,
    byAgent,
    byStreet: byStreet.slice(0, 40),
    leads: { reduced: reducedLeads, letAgreed: letAgreedLeads.slice(0, 60) },
  };
}

function shape(l) {
  return { address: l.displayAddress || l.address, postcode: l.postcode || '', rent: l.price || 0, rentLabel: l.priceLabel || '', beds: l.beds || 0, type: l.type || '', agent: l.agent || '', reduced: !!l.reduced, url: l.url || '', lat: l.lat ?? null, lon: l.lon ?? null, sizeSqft: l.sizeSqft || 0, source: l.source || '' };
}
