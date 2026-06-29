#!/usr/bin/env node
// Headless runner for the ViralForge agency — run the whole agent pipeline from
// the command line and write the content drop to a JSON file. Cron this for a
// fresh week of TikTok content on autopilot.
//
//   ANTHROPIC_API_KEY=... node scripts/agency.js "kitchen gadgets" [product] [goal]
//   GEMINI_API_KEY=...    node scripts/agency.js "fitness accessories"
//
// Output: agency-output.json (and a readable summary to stdout).

import fs from 'fs';
import path from 'path';
import { runAgency } from '../lib/agency.js';
import { buildProductionKits, kitsToMarkdown } from '../lib/production.js';
import { llmConfigured } from '../lib/llm.js';

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'run'; }

const niche = process.argv[2] || 'problem-solving kitchen gadgets';
const product = process.argv[3] || '';
const goal = process.argv[4] || 'Drive TikTok Shop sales with zero ad spend';

if (!llmConfigured()) {
  console.error('\n  No AI key configured. Set one (free tiers work):');
  console.error('    GEMINI_API_KEY=...  or  GROQ_API_KEY=...  or  ANTHROPIC_API_KEY=...\n');
  process.exit(1);
}

console.log(`\n  ⚡ ViralForge — briefing the agency`);
console.log(`     Niche: ${niche}${product ? `  ·  Product: ${product}` : ''}`);
console.log(`     Goal:  ${goal}\n`);

const result = await runAgency({ niche, product, goal }, (step) => {
  const mark = step.ok ? '✓' : '✗';
  const extra = step.ok ? (step.searched ? ' (searched live web)' : '') : `  — ${step.error}`;
  console.log(`     ${mark} ${step.emoji || ''} ${step.name}${extra}`);
});

// Always write the latest run to a stable path…
const outPath = 'agency-output.json';
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

// …and archive a dated copy so weekly cron runs build a history you can look
// back on (which niches/angles you tried, and when).
const archiveDir = process.env.AGENCY_ARCHIVE_DIR || 'agency-runs';
const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-'); // YYYY-MM-DD-HH-MM
const archivePath = path.join(archiveDir, `${stamp}-${slug(niche)}.json`);
fs.mkdirSync(archiveDir, { recursive: true });
fs.writeFileSync(archivePath, JSON.stringify({ ...result, ranAt: new Date().toISOString() }, null, 2));
// Build the paste-ready Production Kit (voiceover blocks, shot lists, posts) and
// write it as Markdown — this is the file you actually work from to make videos.
const kits = buildProductionKits(result.out);
const kitPath = path.join(archiveDir, `${stamp}-${slug(niche)}-PRODUCTION-KIT.md`);
fs.writeFileSync(kitPath, kitsToMarkdown(kits, `ViralForge — ${niche}`));

console.log(`\n  ✅ Content drop written to ${outPath}`);
console.log(`  🗂  Archived this run to ${archivePath}`);
console.log(`  📦 Production Kit (make-the-videos guide) → ${kitPath}`);

// Quick human-readable peek at the scripts so you can act without opening JSON.
const scripts = (result.out.scriptwriter && result.out.scriptwriter.scripts) || [];
if (scripts.length) {
  console.log(`\n  📋 ${scripts.length} videos ready to film:\n`);
  scripts.forEach((s, i) => console.log(`     ${i + 1}. ${s.title}\n        Hook: ${s.hook_line}`));
}
const cal = (result.out.scheduler && result.out.scheduler.calendar) || [];
if (cal.length) {
  console.log(`\n  📅 Posting calendar:\n`);
  cal.forEach((c) => console.log(`     ${c.day} ${c.time} — ${c.script_title}`));
}
console.log('');
