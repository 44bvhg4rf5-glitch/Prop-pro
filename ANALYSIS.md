# PropMail Pro — Product & Engineering Analysis

_Analyst review of the PropMail Pro codebase (Harrow/HA estate-agent lead-gen app)._
_Scope: all 15 panels plus a deep-dive on the Address Finder (`api/addresses.js`)._

> **Context up front.** This app does cold-outreach direct mail to homeowners
> using addresses derived from Royal Mail PAF (via OS Places), the EPC register,
> Land Registry, and live portal scrapes. Several "improvements" below are not
> optional polish — they are **legal/compliance prerequisites** (UK GDPR, PECR,
> Royal Mail PAF licensing, portal Terms of Service, EPC register reuse terms).
> Those are flagged **[COMPLIANCE]**.

---

## Architecture overview (what's actually here)

- **No build step, no framework.** `public/app.js` is ~5,300 lines / ~300 KB of
  vanilla JS; `index.html` is ~1,340 lines with 16 `<div class="panel">`
  sections. Logic and state are global.
- **Two runtimes, one handler set.** `server.js` (local Node HTTP server) and
  Vercel serverless both import the same `api/*.js` handlers, so behaviour is
  consistent across hosts. Good decision.
- **State lives in the browser.** Cycles, contacts, schedule, templates and the
  print queue are in `localStorage` (per-device, not synced). `BACKEND-SCHEDULER.md`
  already scopes the move to a server-side DB + cron; nothing is built yet.
- **External data sources:** OS Places (`api/addresses.js`), EPC register
  (`api/epc.js`, `api/epc-monitor.js`, EPC fallback in addresses), Land Registry
  PPI (`api/landregistry.js`), Rightmove + OnTheMarket scrape (`lib/sources.js`,
  `api/listings.js`, `api/rightmove.js`), postcodes.io (reverse-geocode &
  validation), Anthropic (`api/anthropic.js`), PrintNode (`api/printnode.js`),
  Redis/Upstash blocklist (`lib/blocklist.js`, `api/suppress.js`).
- **Two copies of the app exist:** `public/` (served) and a monolithic
  `propmail-pro.html` (~380 KB, standalone). This is a duplication/drift risk —
  see cross-cutting issues.

---

## Cross-cutting issues (apply to most panels)

These recur everywhere; the per-panel sections won't repeat them.

1. **[COMPLIANCE] Cold direct mail to homeowners is regulated.** Addresses from
   PAF/EPC/Land Registry are personal data once tied to "the owner of X". There
   is no lawful-basis record, no privacy notice, no MPS (Mailing Preference
   Service) screening, and the only suppression is the in-app Do-Not-Mail list.
   The EPC open-data licence and OS Places licence both restrict marketing reuse;
   Land Registry PPD has its own attribution/usage terms. **This needs a legal
   review before scale**, not a feature ticket.
2. **No tests, no types, no lint.** 300 KB of untyped global JS with no test
   suite. Any refactor is high-risk.
3. **No auth, no rate limiting, no abuse controls** on any `/api/*` route. The
   serverless functions will happily page OS Places / EPC / Land Registry on
   behalf of anonymous callers, burning the free-tier quota (and £ on paid tiers).
4. **Scraper fragility.** `lib/sources.js` parses Rightmove/OTM `__NEXT_DATA__`
   by recursively guessing the listings array shape. A portal markup change
   silently returns `[]`. Also **[COMPLIANCE]** — both portals' ToS prohibit
   scraping; using a browser UA to fetch server-side is deliberate evasion.
5. **Per-device data.** Losing a browser profile loses all CRM/schedule data.
   No export/backup beyond what the UI offers.
6. **Inconsistent HTTP layer.** Three different hand-rolled `getJson`/`fetchJson`
   helpers across files, each with different timeout/redirect/error handling
   (e.g. `landregistry.js` sets a 12s timeout; `addresses.js` `getJson` sets
   none). Consolidate into one helper with timeout + retry + a shared cache.
7. **Two source-of-truth files** (`public/app.js` vs `propmail-pro.html`) will
   drift. Pick one; generate the standalone build from `public/` if it's needed.

---

## Panel-by-panel review

### 1. HA Districts (`ha`) — live property finder
**What it does.** One-click search of a HA district across Rightmove + OnTheMarket
(`/api/listings`), merging duplicates and surfacing for-sale/to-rent listings.

**Improvements (prioritised).**
1. Replace scraping with official feeds where possible (portal partner feeds, or
   pivot the funnel to EPC-monitor + Land Registry, which are licensed open data).
2. Add server-side caching (listings change slowly within a day) to cut fetches
   and reduce ban risk.
3. Surface the `sources` count and a "stale data" indicator when a portal returns 0.
4. Pull more pages with backoff rather than the current fixed `pages` cap (5).

**Downsides / risks.**
- **[COMPLIANCE]** Scraping violates Rightmove/OTM ToS; IP bans and legal letters
  are realistic at volume.
- Brittle parser (`find`/`findOtm` shape-guessing) — silent empty results on markup change.
- No caching → repeated identical searches re-hit the portals.
- `mergeListings` dedup key is `street|geo(3dp)` — 3-decimal lat/lon (~110 m) can
  merge two genuinely different nearby listings.

### 2. Pre-Market Radar (`premarket`) — EPC-based pre-market detection
**What it does.** `/api/epc-monitor` lists EPCs lodged in the last N days across HA
councils — an "about to come to market" early signal with full addresses.

**Improvements.**
1. **Council→district mapping is leaky.** It queries 5 whole boroughs (Harrow,
   Brent, Hillingdon, Barnet, Ealing) then filters to HA outcodes server-side.
   The precise `DISTRICT_COUNCILS` map already in `landregistry.js` should be
   reused to avoid pulling Ealing entirely (no HA outcode is mapped to Ealing).
2. `page_size=5000` per council with no pagination — silently truncates busy
   boroughs. Page it like `osPaged`.
3. De-dup/rank by *new construction vs re-sale* and by EPC lodging reason (sale
   EPCs are the real signal; a remortgage/MEES EPC is noise).
4. Cache per (council, date-window) — the same window is requested repeatedly.

**Downsides / risks.**
- An EPC lodge is a **weak** pre-market signal: EPCs are lodged for lettings,
  remortgages, renovations and compliance, not only imminent sales → false positives.
- **[COMPLIANCE]** Targeting a named address because "they just lodged an EPC" is
  exactly the profiling the EPC reuse terms and UK GDPR scrutinise.
- 5,000-row truncation gives a false sense of completeness.

### 3. Sold Board (`sold`) — Land Registry sold data
**What it does.** `/api/landregistry` lists recently-registered HA sales (PPI
linked-data API), filtered to the requested districts and councils.

**Improvements.**
1. `_pageSize=500` with no pagination → a 180-day window across Harrow can exceed
   500 and silently drop the oldest. Add paging via `_page`.
2. PPD registration **lags completion by weeks/months**; show the registration-vs-
   transaction lag and label data "registered up to ~X weeks behind".
3. Join sold data to the EPC/PAF address to get a verified postal address (PPD
   gives PAON/street but not always a clean postcode).
4. Cache by (council, date-window); this is immutable historical data — ideal for
   long TTL.

**Downsides / risks.**
- 500-row truncation is a real accuracy gap for popular districts.
- `transactionId || full` dedup key: if `transactionId` is missing, the address
  string becomes the key → two flats sharing a PAON/street but no postcode could collapse.
- Time lag means "recently sold" is really "recently *registered*."

### 4. Campaigns (`campaigns`) — CRM-lite contact tracker
**What it does.** Browser-stored contact/cycle tracker for who's been written to.

**Improvements.**
1. Move to the server-side DB scoped in `BACKEND-SCHEDULER.md` (Phase A) — this is
   the single biggest reliability win for the whole app.
2. Add CSV import/export and a dedup-on-import step.
3. Link each contact to a UPRN so suppression and cycle-tracking survive address-string variation.

**Downsides / risks.**
- `localStorage`-only: per-device, no backup, ~5–10 MB ceiling.
- No concept of consent/lawful-basis per contact **[COMPLIANCE]**.

### 5. Schedule (`schedule`) — letter scheduling
**What it does.** Schedules cycle letters; "auto-print" only fires while the tab is open.

**Improvements.**
1. Implement Phase B of `BACKEND-SCHEDULER.md` (Vercel Cron at 09:00 → render PDF →
   deliver). Until then "scheduling" is aspirational.
2. Add idempotency: a "produced today" log keyed by (contact, cycle, date) so a
   reopened tab can't double-send.

**Downsides / risks.**
- Cannot run when the browser is closed (documented limitation).
- Browsers can't print silently → still needs a manual tap or PrintNode/mail-house.

### 6. Print Queue (`queue`)
**What it does.** Holds letters with real addresses + listing links, ready to print.

**Improvements.**
1. Re-run suppression at print time against the live blocklist (don't trust the
   list captured when the address was added).
2. De-dup the queue by UPRN, and warn on "already written within N days" using Campaigns.
3. Server-side PDF (the `lib/pdf.js` + PrintNode path) rather than browser print
   for consistent letterhead.

**Downsides / risks.**
- Queue is `localStorage` → lost with the profile.
- Manual-print bottleneck; no batch postage workflow.

### 7. Auto Flow (`auto`)
**What it does.** A 4-step "find → resolve address → draft → queue" pipeline.

**Improvements.** Make each step idempotent and resumable; show per-step source
provenance; add a spend cap (AI + future mail-house). Add a dry-run mode.

**Downsides / risks.** Chains together the most fragile parts (scrape → EPC fuzzy
match → AI) so failures compound; no transactional state.

### 8. Live Bot (`bot`)
**What it does.** "Continuous 24/7 monitoring" — but only while the tab is open.

**Improvements.** This belongs on the server cron, not a foreground tab. Until
then, label it honestly ("monitors while this tab is open"). Add jitter/backoff to
reduce portal-ban risk.

**Downsides / risks.** A tab polling portals on a loop is the fastest way to get
**IP-banned** and is the highest **[COMPLIANCE]** exposure (sustained scraping).

### 9. AI Intel (`intel`) — owner research
**What it does.** Researches the likely owner via public UK sources, through the
Anthropic proxy.

**Improvements.**
1. **[COMPLIANCE] — treat as the highest-risk feature.** Compiling a profile of a
   named individual at an address (to then cold-mail them) is high-risk processing
   under UK GDPR; needs a DPIA, lawful basis, and a clear retention policy. Strongly
   consider removing or gating it.
2. If kept: cite sources, never persist scraped PII, and add a confidence score.
3. Cache AI calls keyed by address to control cost.

**Downsides / risks.** Hallucinated owner details → wrong-name letters (reputational
+ legal). Direct cost per call. The AI output is unverified.

### 10. Success Letters (`success`) — the Address Finder
**What it does.** Lists **every** address at a postcode / sector / district / street
(single or batch) via OS Places (Royal Mail PAF), with an EPC-register fallback and
a synthetic-sample last resort. Core logic in `api/addresses.js`. **See deep-dive below.**

**Improvements (summary; detail in deep-dive).** UPRN-based dedup; OS `find` vs
`postcode` endpoint choice; raise/justify caps; classification-code filtering;
multi-source merge (OS + EPC + Land Registry); new-build handling; postcode
validation + typo tolerance; caching; rate/cost guards.

**Downsides / risks.**
- **Synthetic-fallback addresses are dangerous.** When no key is set,
  `generatePAFAddresses` invents plausible-but-fake addresses (see deep-dive risk).
  Real letters could be posted to addresses that **do not exist** or to the wrong household.
- District cap (3,000) and postcode cap (500) silently truncate.
- EPC fallback only returns homes that *have* a certificate → systematically misses
  new-builds and never-sold/never-let homes.

### 11. Do-Not-Mail (`blocked`) — suppression list
**What it does.** Redis/Upstash-backed suppression list (`lib/blocklist.js`).
Server strips suppressed addresses from every result path; the client mirrors the
matcher for defence-in-depth.

**Improvements.**
1. **Make suppression authoritative at the point of *print/send*, not just at
   fetch.** Today an address fetched before a block is added can still sit in the
   queue. Re-screen on print.
2. Persist UPRN on every suppression entry and prefer UPRN matching (string
   matching is fuzzy and can both over- and under-block).
3. Add MPS / national suppression import **[COMPLIANCE]**.
4. The whole list is one JSON blob under one key (`propmail:blocklist`) read+written
   on every change — fine at hundreds, but a concurrency race (read-modify-write)
   can drop entries under parallel writes. Use a Redis set/hash or a transaction.
5. Bulk-import entries store only `fullAddress` (no postcode/house/UPRN split), so
   they only match on exact normalised string — weaker than typed entries.

**Downsides / risks.**
- Read-modify-write race on the single blob.
- String-based matching: `isSuppressed` token logic can mis-block "12" vs "12A" or
  miss "Flat 1" variants. Erring toward over-blocking is the safer default (and the
  code comments say so), but it's still fuzzy.
- If Redis is unconfigured, suppression silently degrades to client-only.

### 12. Investor Board (`investor`)
**What it does.** Static revenue KPIs / scenarios (no live data).

**Improvements.** Drive KPIs from real Campaigns/Schedule data once server-side;
clearly label projections as illustrative.

**Downsides / risks.** Hard-coded numbers can mislead if shown to actual investors.

### 13. AI Advisor (`advisor`)
**What it does.** AI "campaign health" analysis via the Anthropic proxy.

**Improvements.** Feed it real metrics (response/conversion) rather than vibes;
cache; cap spend. Make recommendations actionable (link to the relevant panel).

**Downsides / risks.** Generic LLM advice; per-call cost; unverified claims.

### 14. Director's Vision (`director`)
**What it does.** Static list of strategic ideas.

**Improvements.** Low priority. Could become a roadmap board tied to issues.

**Downsides / risks.** None technical; just static content to maintain.

### 15. Templates (`templates`) & Printers (`printers`)
**What it does.** Letter-template editor (localStorage) and PrintNode-backed
network-printer management (`api/printnode.js`).

**Improvements.**
1. Server-side template storage + versioning; mail-merge field validation (so a
   `{{owner_name}}` never renders blank on a real letter).
2. Printers: surface PrintNode `state` and offline warnings; let users store the
   key server-side (currently accepted via `x-printnode-key` header from the client).
3. Move PDF generation server-side (`lib/pdf.js`) for consistent output.

**Downsides / risks.**
- PrintNode key handling: passing it from the browser per-request is workable but
  means the key lives client-side; prefer server env (`PRINTNODE_API_KEY`).
- Template merge fields aren't validated → blank/`undefined` in posted letters.

---

# DEEP-DIVE: The Address Finder (`api/addresses.js`)
### "How can we be even more accurate, and produce more results?"

This is the heart of the product: turn a postcode/street/district into the
**complete, correct** list of postal addresses to write to. Below is a concrete,
code-referenced plan, ordered roughly by impact.

### 0. Current behaviour (baseline)
- Three modes: `?suggest=` (autocomplete), `?postcode=` (postcode/sector/district),
  `?street=` (free-text street).
- Source order: **OS Places DPA** first; **EPC register** fallback; **synthetic
  sample** as a last resort (the synthetic generator lives in `public/app.js`,
  `generatePAFAddresses`, not in `addresses.js`).
- `osPaged(kind, value, OS, maxAddr)` pages the OS endpoint 100 at a time, 8
  requests in parallel, capped at `maxAddr`.
- Caps: **3,000** district, **500** full postcode, **600** street, **10** suggest.
- Dedup is by **lowercased `fullAddress`** in `cleanAddresses`; commercial dropped
  by classification prefix.

### 1. UPRN-based dedup (accuracy + de-dup correctness) — **do this first**
`cleanAddresses` dedups on `a.fullAddress.toLowerCase()` even though every DPA
record already carries a **UPRN** (`mapDpa` captures `d.UPRN`). UPRN is the
canonical unique-property identifier — string dedup is strictly worse:
- Two records for the same property with a slightly different `ADDRESS` string
  (PAF vs a historic variant) **survive as duplicates**.
- Conversely, two genuinely different properties with an identical short address
  could collapse.

**Fix:** dedup by UPRN first, fall back to normalised `fullAddress` only when UPRN
is absent. Carry the UPRN through to the result objects (the front-end already
maps results but **drops `uprn`** — see `app.js` ~line 4489, the mapped object has
no `uprn` field). Persisting UPRN end-to-end also makes **suppression**
(`isSuppressed` prefers UPRN) and **Campaigns** dedup far more reliable.

### 2. `find` vs `postcode` endpoint — use the right tool per mode
- `postcode` endpoint is correct for postcode/sector/district (it's the
  authoritative "all addresses at this postcode" query).
- `find` (free-text) is used for street search and suggest. The street filter then
  re-checks `THOROUGHFARE_NAME`/`DEPENDENT_THOROUGHFARE_NAME` against the typed
  street (`streetSearch`, lines 102–109). Good, but `find` ranks by relevance and
  caps at the paged total — a long street can exceed the **600** cap silently.
- **Improvement:** for street mode, once you know the matching **postcodes** (the
  function already computes `postcodes`), do a second pass of `postcode` queries
  for each to guarantee completeness, then merge by UPRN. `find` for discovery,
  `postcode` for completeness.

### 3. Pagination & result caps (more results) — raise deliberately, page fully
Current caps (`cap = isFull ? 500 : 3000`, street `600`) are arbitrary and
**silently truncate** (the district note says "showing the first N" but a sector
search is the only suggested workaround). Concrete changes:
- A full postcode rarely exceeds ~100 addresses, so **500 is fine** there; the
  risk is the **district** path. Rather than a hard 3,000, page the full `total`
  but **chunk by sector** server-side and return grouped results, so nothing is
  dropped and the client can lazy-load.
- Increase `CONC` cautiously (currently 8) only alongside rate-limit accounting
  (see §10) — more concurrency = faster quota burn.
- Make the cap a query param with a sane max, and **always** return
  `totalAvailable` (already returned for postcode; add it to street so the UI can
  say "showing 600 of 812").

### 4. Classification-code filtering (residential vs flats vs commercial)
`mapDpa` reduces `CLASSIFICATION_CODE` to R/C/Other by first letter, and
`cleanAddresses` drops `Commercial`. This is coarse:
- OS classification is granular: `RD` (dwellings), `RH` (HMOs), `RI`
  (institutional residential), `CR` (retail), etc. First-letter bucketing means
  `RI`/`RH` are treated identically to a normal home, and **`Other`/unclassified**
  (`X`, `U`, `M`/military, `Z`) are currently **kept** (only `Commercial` is
  dropped), so car parks, land parcels and objects-without-postal-address can leak
  in.
- **Improvement:** filter on the full classification code: keep `RD`/`RH` (and
  decide on `RG` garages = drop), drop `C*`, `L*` (land), `M*`, `Z*`, `P*` (PO
  boxes/parking), `U*` (unclassified) unless they have a `BUILDING_NUMBER`. Expose
  a "flats only / houses only" toggle (the EPC `looksLikeFlat` heuristic in
  `epc.js` shows the intent already exists; promote it here using PAF
  `SUB_BUILDING_NAME` presence as the flat signal).

### 5. Combining OS Places + EPC + Land Registry (coverage + verification)
Today the sources are **fallback-only** (OS *or* EPC). Merge them instead:
- **OS Places** = the complete current postal list (the spine).
- **EPC** = adds energy band, floor area, last-cert date → useful for *targeting*
  and for the `epc.js` size-match logic; also a sanity cross-check that the UPRN is
  a real dwelling.
- **Land Registry PPD** (`landregistry.js`) = last sold price/date/type →
  "owner-occupier likely / recently bought / long-term hold" segmentation, a far
  better targeting signal than "lodged an EPC."
- **Merge strategy:** OS UPRN is the join key. EPC and PPD don't always carry UPRN,
  so fall back to a normalised (postcode + PAON/house) match. Return a per-address
  `sources: ['os','epc','ppd']` provenance array so the UI can show confidence.

### 6. New-builds / not-yet-on-PAF (the hardest accuracy gap)
PAF lags new construction by weeks–months, and EPC only covers homes with a
certificate, so **brand-new estates are invisible to both**. Options:
- Use the **Land Registry "new build" flag** (`t.newBuild` is already parsed in
  `landregistry.js`) to detect recently-registered new builds and surface their
  addresses even before PAF catches up.
- Pull **OS AddressBase Premium** (not the free Places tier) which includes
  provisional/alternate addresses and UPRN lifecycle states — but that's a paid,
  licensed upgrade **[COMPLIANCE]**.
- For pre-completion plots, accept that "Plot 14" letters are low-value and skip them.

### 7. Postcode validation (postcodes.io) before spending an OS call
`addresses.js` validates the postcode shape only with a regex
(`/\d[A-Z]{2}$/` to decide full-vs-outcode). A malformed-but-shaped postcode still
triggers a full OS page run. **Improvement:** call **postcodes.io**
`/postcodes/{pc}/validate` (free, no key — already used for reverse-geocode in
`helpers.js`) before hitting OS, and use its `/outcodes` and autocomplete for the
suggest path to avoid spending OS quota on typos. Cache postcodes.io responses.

### 8. Fuzzy / typo tolerance
- **Postcodes:** postcodes.io `/postcodes/{q}/autocomplete` corrects partials and
  near-misses cheaply.
- **Streets:** the current `streetSearch` requires an **exact normalised**
  `THOROUGHFARE_NAME` equality (`thoro === streetName`). "Kenton Rd" vs "Kenton
  Road", or a one-char typo, returns nothing. Add: (a) abbreviation expansion
  (Rd→Road, St→Street, Ave→Avenue) before `norm`, and (b) a fallback to
  `includes`/Levenshtein-distance-≤1 match when exact fails, surfacing results as
  "did you mean…". The `find` endpoint already tolerates some of this; lean on it
  for discovery, then verify.

### 9. Multi-source merge mechanics (one clean list)
Return a single deduped list with provenance, sorted house-number order (the
existing `localeCompare(..., {numeric:true})` is correct for "2, 2A, 10"). Concretely:
1. OS Places `postcode` query → spine (UPRN-keyed).
2. Enrich with EPC by UPRN, else (postcode+house).
3. Enrich with PPD by (postcode+PAON).
4. Drop suppressed (already done via `notBlocked`), drop non-residential by full
   classification code (§4).
5. Emit `{ uprn, line1, fullAddress, postcode, type, classCode, sources, epcBand?,
   lastSold? }`.

### 10. Rate & cost limits of the OS free tier
The OS Places **free plan has a monthly transaction cap** (each `maxresults=100`
page is a transaction). The district path can fire **up to 30 paged requests for a
single search** (3,000 / 100), 8 in parallel, with **no per-user limit, no
caching, and no auth** on `/api/addresses`. A handful of district searches — or one
abusive caller — can exhaust the month's quota in minutes. **Mitigations:**
- **Cache aggressively** (§11) so repeat searches cost zero transactions.
- Add a server-side token-bucket / daily quota guard and return a friendly "quota
  reached, try a narrower postcode" instead of silent failure.
- Prefer the `postcode` endpoint over wide `find` paging.
- Track transactions used and expose them at `/api/config`.

### 11. Caching (the single biggest cost + latency win)
There is **no caching anywhere** in the address path — identical searches re-page
OS every time, and the suggest endpoint fires **per keystroke** straight to OS
(`addresses.js` lines 129–141). Concretely:
- **Postcode/street results:** cache in Redis (already a dependency via
  `lib/blocklist.js`) keyed by normalised query, TTL ~24–72 h. PAF changes slowly;
  staleness is acceptable and far cheaper than a transaction per search.
- **Suggest:** debounce client-side (already 3-char gate, add ~250 ms debounce) and
  cache prefixes server-side; consider postcodes.io for postcode-shaped input so OS
  is only hit for street text.
- **EPC / PPD:** long TTL (historical/slow-moving).
- Add stale-while-revalidate so the user gets an instant cached answer while a
  background refresh updates it.

### 12. Other concrete correctness fixes spotted in the code
- **`app.js` drops `uprn`** when mapping `/api/addresses` results (~line 4489) — so
  the strongest dedup/suppression key never reaches Campaigns/queue. Carry it through.
- **`area` parsing** (`(a.fullAddress||'').split(',').slice(-2,-1)[0]`) is brittle
  for addresses with a different comma count; prefer the PAF `POST_TOWN` (available
  in the DPA record but discarded by `mapDpa`).
- **`tcAddr` title-casing** upper-cases any token containing a digit — correct for
  "75A" and postcodes, but it will also upper-case things like "1st" → "1ST".
  Acceptable, but worth a note.
- **Synthetic fallback is a liability** — `generatePAFAddresses` fabricates
  addresses when no key is set, labelled only as "sample". For a tool that prints
  and posts physical mail, an invented address is a real-world error. Gate sending
  behind `isLive === true`, or remove the synthetic path entirely.

### Priority order for the Address Finder
1. UPRN end-to-end (dedup, carry-through, suppression). **(correctness)**
2. Caching + per-user quota guard. **(cost / availability)**
3. Multi-source merge OS+EPC+PPD with provenance. **(results + confidence)**
4. Full classification-code filtering + flats/houses toggle. **(accuracy)**
5. Street typo tolerance + abbreviation expansion + `postcode`-pass completeness. **(results)**
6. New-build handling via PPD `newBuild`. **(coverage gap)**
7. Remove/guard the synthetic fallback. **(real-world safety)**
