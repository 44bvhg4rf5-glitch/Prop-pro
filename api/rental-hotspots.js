import { sendJson, guardOrigin } from '../lib/helpers.js';
import { rightmoveListings, onTheMarketListings } from '../lib/sources.js';
import { landlordsForStreet } from '../lib/landlords.js';

export const config = { maxDuration: 60 };

// Rental Hotspots: scan LIVE to-let listings across HA, group by street, and
// rank streets by how many rentals are on the market right now — the freshest
// signal of where landlords are active. Traffic light: green = 1, amber = 2,
// red = 3+ (hottest). Returns per-street counts + a map centroid + licensed-
// landlord count, so the map/list can be drawn and streets targeted in one tap.

const HA = ['HA0', 'HA1', 'HA2', 'HA3', 'HA4', 'HA5', 'HA6', 'HA7', 'HA8', 'HA9'];
const ROADS = 'road|street|avenue|close|drive|court|gardens|lane|way|terrace|place|crescent|grove|hill|park|mews|walk|row|rise|vale|green|square|parade|broadway|gate|chase|field|view|dene|croft|hatch|ridgeway|approach|circus|embankment|esplanade';
const TOWNS = /^(harrow|wembley|pinner|stanmore|edgware|northwood|ruislip|middlesex|london|north harrow|south harrow|west harrow|kenton|wealdstone|sudbury|greenford|kingsbury|belmont|hatch end|rayners lane|harrow on the hill|sudbury hill|preston hill|sudbury court|north wembley|wembley park)$/;
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ,]/g, ' ').replace(/ +/g, ' ').trim();
const tc = (s) => (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));

// Pull the road name out of a listing's display address.
function streetOf(displayAddress) {
  const parts = norm(displayAddress).split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const roadRe = new RegExp('\\b(' + ROADS + ')\\b');
  // The last comma-part that names a road (skip towns) is the street.
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (TOWNS.test(p)) continue;
    if (roadRe.test(p)) return p.replace(/^(flat|apartment|apt|unit|room|studio)\s+[\w-]+\s*/, '').replace(/^\d+[a-z]?\s+/, '').replace(/\b[a-z]{1,2}\d[a-z\d]?( \d[a-z]{2})?\b/g, '').trim();
  }
  // Fallback: the part before the town.
  const nonTown = parts.filter((p) => !TOWNS.test(p) && !/^[a-z]{1,2}\d/.test(p));
  return (nonTown[nonTown.length - 1] || '').replace(/^\d+[a-z]?\s+/, '').trim();
}
const districtOf = (p) => (p.haCode || (p.postcode || '').split(' ')[0] || '').toUpperCase();

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const wanted = (u.searchParams.get('districts') || '').toUpperCase().split(',').map((s) => s.trim()).filter((s) => /^HA\d$/.test(s));
  const districts = wanted.length ? wanted : HA;
  const pages = Math.min(parseInt(u.searchParams.get('pages') || '2', 10) || 2, 3);

  // Live to-let listings across the chosen districts (Rightmove + OnTheMarket).
  const opts = { channel: 'rent', pages };
  const lists = await Promise.all(districts.flatMap((d) => [
    rightmoveListings(d, opts).catch(() => []),
    onTheMarketListings(d, { channel: 'rent', pages: Math.min(pages, 2) }).catch(() => []),
  ]));
  const listings = lists.flat().filter((p) => p && p.displayAddress);

  // Group by street + district.
  const byStreet = new Map();
  for (const p of listings) {
    const street = streetOf(p.displayAddress);
    if (!street || street.length < 3) continue;
    const district = districtOf(p);
    const key = street + '|' + district;
    let g = byStreet.get(key);
    if (!g) { g = { street: tc(street), district, count: 0, lats: [], lons: [], listings: [], rents: [] }; byStreet.set(key, g); }
    // de-dupe the same listing id across portals
    if (g.listings.some((x) => x.id === p.propertyId)) continue;
    g.count++;
    if (p.lat && p.lon) { g.lats.push(p.lat); g.lons.push(p.lon); }
    if (p.price) g.rents.push(p.price);
    if (g.listings.length < 8) g.listings.push({ id: p.propertyId, address: p.displayAddress, price: p.price || 0, url: p.url, source: p.source });
  }

  const hotspots = [...byStreet.values()].map((g) => {
    const lat = g.lats.length ? g.lats.reduce((a, b) => a + b, 0) / g.lats.length : null;
    const lon = g.lons.length ? g.lons.reduce((a, b) => a + b, 0) / g.lons.length : null;
    const licensed = landlordsForStreet(g.street, g.district).length;
    const tier = g.count >= 3 ? 'red' : g.count === 2 ? 'amber' : 'green';
    const rentAvg = g.rents.length ? Math.round(g.rents.reduce((a, b) => a + b, 0) / g.rents.length) : 0;
    return { street: g.street, district: g.district, onMarket: g.count, licensedLandlords: licensed, tier, lat, lon, rentAvg, listings: g.listings };
  }).sort((a, b) => b.onMarket - a.onMarket || b.licensedLandlords - a.licensedLandlords);

  sendJson(res, 200, {
    scanned: listings.length, districts,
    counts: { red: hotspots.filter((h) => h.tier === 'red').length, amber: hotspots.filter((h) => h.tier === 'amber').length, green: hotspots.filter((h) => h.tier === 'green').length },
    hotspots: hotspots.slice(0, 400),
  });
}
