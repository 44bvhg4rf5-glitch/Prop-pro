import https from 'https';
import { sendJson, guardOrigin } from '../lib/helpers.js';

// Owner research from FREE public records only:
//   • Companies House (officers/directors at the property's registered office)
//   • PlanIt (UK planning applications — applicant is often the owner/agent)
// No contact-detail harvesting. Names are for postal personalisation; always
// verify before use and screen against MPS + the do-not-mail list.

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const houseNo = (s) => ((s || '').match(/\d+[a-z]?/i) || [''])[0].toLowerCase();

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
function tcName(n) {
  if (!n) return '';
  let parts = n.split(',').map((s) => s.trim());
  const ordered = parts.length === 2 ? parts[1] + ' ' + parts[0] : n;
  return ordered.toLowerCase().replace(/\b[\w'-]+\b/g, (w) => w.charAt(0).toUpperCase() + w.slice(1)).trim();
}

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const address = (u.searchParams.get('address') || '').trim();
  const postcode = (u.searchParams.get('postcode') || '').trim().toUpperCase();
  const line1 = (u.searchParams.get('line1') || address.split(',')[0] || '').trim();
  if (!postcode && !address) { sendJson(res, 400, { error: 'address or postcode is required' }); return; }

  const wantNum = houseNo(line1);
  const result = {
    address, postcode, owners: [], planning: [], sources: [],
    links: {
      landRegistry: 'https://search-property-information.service.gov.uk/',
      companiesHouse: 'https://find-and-update.company-information.service.gov.uk/search?q=' + encodeURIComponent(address || postcode),
      planning: 'https://www.planit.org.uk/find/applics?search=' + encodeURIComponent(((line1 ? line1 + ' ' : '') + postcode).trim()),
      openRegister: 'https://www.192.com/atoz/people/?search=' + encodeURIComponent(postcode),
    },
  };

  // 1. Companies House — directors at a company registered to this address.
  const CH = process.env.CH_API_KEY || '';
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
          officers.forEach((o) => result.owners.push({ name: tcName(o.name), role: (o.officer_role || 'officer').replace(/-/g, ' '), source: 'Companies House', detail: c.company_name }));
        } else {
          result.owners.push({ name: c.company_name, role: 'company', source: 'Companies House', detail: 'registered at this address' });
        }
      }
      result.sources.push('Companies House');
    } catch { /* ignore */ }
  }

  // 2. PlanIt — planning applications at/near the address (keyless).
  try {
    const q = encodeURIComponent(((line1 ? line1 + ' ' : '') + postcode).trim());
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
      result.planning.push({
        ref: r.name || r.reference || r.uid || '',
        address: r.address || '',
        description: r.description || '',
        applicant: applicant || 'See planning record',
        date: (r.start_date || of.date_received || r.decided_date || '').slice(0, 10),
        url: r.link || r.url || (r.name ? 'https://www.planit.org.uk/planapplic/' + encodeURIComponent(r.name) : ''),
      });
      if (applicant && !result.owners.some((o) => norm(o.name) === norm(applicant))) {
        result.owners.push({ name: applicant, role: 'planning applicant', source: 'Planning', detail: r.description ? String(r.description).slice(0, 60) : '' });
      }
    });
    result.sources.push('PlanIt');
  } catch { /* ignore */ }

  result.note = result.owners.length
    ? 'Names from public records — verify before posting. Postal use only; screen against MPS and your do-not-mail list.'
    : 'No owner found in free records. Use the public-record links to look it up, or a Land Registry title (~£3) for the registered owner.';
  sendJson(res, 200, result);
}
