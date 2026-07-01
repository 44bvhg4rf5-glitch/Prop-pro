// Build lib/data/ccod-ha.js from the HM Land Registry CCOD CSV.
//
// One-time free grab:
//   1. Sign up (free) at https://use-land-property-data.service.gov.uk/
//   2. Download the latest "CCOD" (UK companies that own property) CSV.
//   3. node scripts/build-ccod-ha.mjs <path-to-CCOD_FULL_YYYY_MM.csv>
//
// Filters to HA postcodes and writes company landlord + correspondence address.
import fs from 'fs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/build-ccod-ha.mjs <CCOD csv>'); process.exit(1); }

// Minimal CSV line parser (handles quoted commas).
function parseLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}

const text = fs.readFileSync(file, 'utf8');
const lines = text.split(/\r?\n/).filter(Boolean);
const header = parseLine(lines[0]).map((h) => h.trim());
const col = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
const iAddr = col('Property Address'), iPc = col('Postcode'), iName = col('Proprietor Name (1)');
const iCorr = col('Proprietor (1) Address (1)'), iCro = col('Company Registration No. (1)'), iTen = col('Tenure');
if (iAddr < 0 || iPc < 0 || iName < 0) { console.error('Unexpected CCOD columns:', header.slice(0, 10)); process.exit(1); }

const rows = [];
for (let i = 1; i < lines.length; i++) {
  const f = parseLine(lines[i]);
  const pc = (f[iPc] || '').trim().toUpperCase();
  if (!/^HA\d/.test(pc.replace(/\s+/g, ''))) continue;
  const company = (f[iName] || '').trim(); if (!company) continue;
  rows.push({ a: (f[iAddr] || '').trim(), p: pc, company, corr: (f[iCorr] || '').trim(), cro: (f[iCro] || '').trim(), tenure: (f[iTen] || '').trim()[0] || '' });
}
const body = 'export const CCOD_HA = ' + JSON.stringify(rows) + ';\n';
fs.writeFileSync('lib/data/ccod-ha.js', 'export const CCOD_HA = ' + JSON.stringify(rows, null, 0) + ';\n');
console.log(`Wrote lib/data/ccod-ha.js — ${rows.length} HA company-owned properties.`);
