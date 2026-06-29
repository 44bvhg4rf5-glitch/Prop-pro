import https from 'https';

// Shared owner-finder core (used by api/owner.js and api/owner-batch.js).
// FREE public records only:
//   • Companies House — officers/directors of a company registered at the address
//     (and a block's freeholder / RTM / management company by building name)
//   • PlanIt — planning applications whose applicant is often the owner
// Names are for POSTAL personalisation only — verify before use, screen against
// MPS + the do-not-mail list. No contact-detail harvesting.

export const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export const houseNo = (s) => ((s || '').match(/\d+[a-z]?/i) || [''])[0].toLowerCase();

function getJson(url, headers = {}) {
  return new Promise((resolve) => {
    https.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'PropMailPro/1.0', ...headers } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: r.statusCode, json: j }); });
    }).on('error', () => resolve({ status: 502, json: null }));
  });
}
function chGet(path, key) {
  return getJson('https://api.company-information.service.gov.uk' + path, {
    Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64'),
  });
}
// "SMITH, John David" → "John David Smith"
export function tcName(n) {
  if (!n) return '';
  const parts = n.split(',').map((s) => s.trim());
  const ordered = parts.length === 2 ? parts[1] + ' ' + parts[0] : n;
  return ordered.toLowerCase().replace(/\b[\w'-]+\b/g, (w) => w.charAt(0).toUpperCase() + w.slice(1)).trim();
}

const _cache = new Map();   // warm-instance cache keyed by houseNo|postcode

// Look up likely owner(s) for one address. Returns { owners, planning, sources }.
export async function findOwner(line1In, postcodeIn, opts = {}) {
  const line1 = (line1In || '').trim();
  const postcode = (postcodeIn || '').trim().toUpperCase();
  const CH = opts.ch != null ? opts.ch : (process.env.CH_API_KEY || '');
  const wantNum = houseNo(line1);
  const ck = wantNum + '|' + norm(postcode);
  if (_cache.has(ck)) return _cache.get(ck);

  const owners = [], planning = [], sources = [];

  // 1. Companies House — directors at a company registered to this address.
  if (CH && postcode) {
    try {
      const s = await chGet('/advanced-search/companies?location=' + encodeURIComponent(postcode) + '&size=50', CH);
      const items = (s.json && s.json.items) || [];
      const matches = items.filter((c) => {
        const a = norm(Object.values(c.registered_office_address || {}).join(' '));
        return a.includes(norm(postcode)) && (!wantNum || new RegExp('(^|\\D)' + wantNum + '(\\D|$)').test(a));
      }).slice(0, 6);
      for (const c of matches) {
        const off = await chGet('/company/' + c.company_number + '/officers?items_per_page=20', CH);
        const officers = (((off.json && off.json.items) || []).filter((o) => !o.resigned_on)).slice(0, 6);
        if (officers.length) {
          officers.forEach((o) => owners.push({ name: tcName(o.name), role: (o.officer_role || 'officer').replace(/-/g, ' '), source: 'Companies House', detail: c.company_name }));
        } else {
          owners.push({ name: c.company_name, role: 'company', source: 'Companies House', detail: 'registered at this address' });
        }
      }
      // Block freeholder / RTM / management company, named after the building.
      const bname = line1.replace(/^\s*(flat|apartment|apt|unit|room)\s+[\w-]+,?\s*/i, '').replace(/^\d+[a-z]?\s+/, '').trim();
      if (bname && bname.length > 3 && /[a-z]/i.test(bname)) {
        const ns = await chGet('/search/companies?q=' + encodeURIComponent(bname) + '&items_per_page=20', CH);
        ((ns.json && ns.json.items) || [])
          .filter((c) => norm(c.title).includes(norm(bname)) && /(management|freehold|rtm|resident|estate|propert|lessee|maintenance)/i.test(c.title) && c.company_status !== 'dissolved')
          .slice(0, 4)
          .forEach((c) => { if (!owners.some((o) => norm(o.detail || '') === norm(c.title))) owners.push({ name: c.title, role: 'freeholder / management company', source: 'Companies House', detail: c.title }); });
      }
      sources.push('Companies House');
    } catch { /* ignore */ }
  }

  // 2. PlanIt — planning applications at/near the address (keyless). PlanIt's
  // keyword search misses on a full "number street postcode" string, so query by
  // POSTCODE (falling back to the street) and tie records to the exact property
  // with the postcode + house-number filter below.
  try {
    const q = encodeURIComponent((postcode || line1).trim());
    const pj = await getJson('https://www.planit.org.uk/api/applics/json?search=' + q + '&pg_sz=40&limit=40');
    const recs = (pj.json && (pj.json.records || pj.json.applics)) || [];
    const pcN = norm(postcode);
    recs.filter((r) => {
      const recPc = norm(r.postcode || '');
      const a = norm(r.address || '');
      if (recPc && pcN && recPc === pcN) return true;
      return a.includes(pcN) && (!wantNum || new RegExp('(^|\\D)' + wantNum + '(\\D|$)').test(a));
    }).slice(0, 8).forEach((r) => {
      const of = r.other_fields || {};
      const realApplicant = (v) => v && !/see source/i.test(v) ? tcName(v) : '';
      const applicant = realApplicant(of.applicant_name) || realApplicant(of.applicant);
      planning.push({
        ref: r.name || r.reference || r.uid || '',
        address: r.address || '',
        description: r.description || '',
        applicant: applicant || 'See planning record',
        date: (r.start_date || of.date_received || r.decided_date || '').slice(0, 10),
        url: r.link || r.url || (r.name ? 'https://www.planit.org.uk/planapplic/' + encodeURIComponent(r.name) : ''),
      });
      if (applicant && !owners.some((o) => norm(o.name) === norm(applicant))) {
        owners.push({ name: applicant, role: 'planning applicant', source: 'Planning', detail: r.description ? String(r.description).slice(0, 60) : '' });
      }
    });
    sources.push('PlanIt');
  } catch { /* ignore */ }

  const out = { owners, planning, sources };
  if (_cache.size > 3000) _cache.clear();
  _cache.set(ck, out);
  return out;
}
