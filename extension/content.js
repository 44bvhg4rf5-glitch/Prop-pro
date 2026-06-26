// PropMail Pinpoint — content script.
//
// Runs on a Rightmove property page, reads the listing details that the page
// embeds as `window.PAGE_MODEL = { data: "<flatted json>" }`, injects a small
// "Find full address" panel, and asks the background worker to resolve the
// exact address from the public EPC register.
//
// The parsing mirrors the server-side api/property.js so the extension behaves
// identically to the PropMail Pro web app — nothing here is invented, it's all
// read straight from the public listing.

(() => {
  'use strict';
  if (window.__propmailPinpointLoaded) return;
  window.__propmailPinpointLoaded = true;

  // ── Read PAGE_MODEL out of the page ────────────────────────────────────────
  // Content scripts run in an isolated world and can't see page variables, but
  // the assignment lives in the DOM as <script> text, so we parse that text.

  // Balanced-brace JSON parse of the object literal that follows `marker`.
  function jsonAfter(text, marker) {
    const i = text.indexOf(marker);
    if (i < 0) return null;
    const s = text.indexOf('{', i);
    if (s < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let j = s; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { if (--depth === 0) { try { return JSON.parse(text.slice(s, j + 1)); } catch { return null; } } }
    }
    return null;
  }

  // Resolve a flatted index reference into its real value (depth-capped, cycle-safe).
  function makeDeref(arr) {
    return function deref(idx, d, path) {
      if (typeof idx !== 'number' || idx < 0 || idx >= arr.length) return null;
      if (d > 12 || path.has(idx)) return null;
      const node = arr[idx];
      if (node === null || typeof node !== 'object') return node;
      const p = new Set(path); p.add(idx);
      if (Array.isArray(node)) return node.map((x) => deref(x, d + 1, p));
      const out = {};
      for (const k in node) out[k] = deref(node[k], d + 1, p);
      return out;
    };
  }

  const priceNum = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;

  function readPageModelText() {
    for (const sc of document.querySelectorAll('script')) {
      const t = sc.textContent || '';
      if (t.includes('PAGE_MODEL')) return t;
    }
    return '';
  }

  // Parse the listing into the fields the EPC resolver needs.
  function extractListing() {
    const text = readPageModelText();
    const model = text ? (jsonAfter(text, 'PAGE_MODEL =') || jsonAfter(text, 'window.PAGE_MODEL')) : null;

    let pd = null;
    try {
      if (model && typeof model.data === 'string') {
        const arr = JSON.parse(model.data);
        const root = Array.isArray(arr) ? arr[0] : null;
        if (root && typeof root.propertyData === 'number') pd = makeDeref(arr)(root.propertyData, 0, new Set());
      } else if (model && model.propertyData) {
        pd = model.propertyData; // legacy (non-flattened) shape
      }
    } catch { /* fall through */ }

    if (!pd || !pd.address) return null;

    const addr = pd.address || {};
    const loc = pd.location || {};
    const postcode = [addr.outcode, addr.incode].filter(Boolean).join(' ').toUpperCase();

    let sizeSqft = null;
    if (Array.isArray(pd.sizings)) {
      const sf = pd.sizings.find((s) => s && /sqft|sq\.?\s*ft/i.test((s.unit || s.displayUnit || '')));
      const sm = pd.sizings.find((s) => s && /sqm|sq\.?\s*m/i.test((s.unit || s.displayUnit || '')));
      if (sf && (sf.maximumSize || sf.minimumSize)) sizeSqft = Math.round(sf.maximumSize || sf.minimumSize);
      else if (sm && (sm.maximumSize || sm.minimumSize)) sizeSqft = Math.round((sm.maximumSize || sm.minimumSize) * 10.7639);
    }

    const price = (pd.prices && pd.prices.primaryPrice) || pd.price || '';

    return {
      propertyId: String(pd.id || (location.href.match(/(\d{5,})/) || [])[1] || ''),
      displayAddress: addr.displayAddress || '',
      postcode,
      outcode: (addr.outcode || '').toUpperCase(),
      area: (addr.outcode || '').toUpperCase().replace(/[0-9].*$/, ''),
      lat: loc.latitude != null ? loc.latitude : null,
      lon: loc.longitude != null ? loc.longitude : null,
      type: pd.propertySubType || pd.propertyType || 'Property',
      beds: pd.bedrooms || 0,
      price: typeof price === 'number' ? price : priceNum(price),
      priceLabel: typeof price === 'string' ? price : price ? '£' + Number(price).toLocaleString() : '',
      sizeSqft,
      url: location.href,
    };
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let panel, body, listing;

  function buildPanel() {
    panel = el('div', 'ppp-panel');
    const head = el('div', 'ppp-head');
    head.appendChild(el('div', 'ppp-logo', '🧲 <b>Pinpoint</b> <span>full address</span>'));
    const close = el('button', 'ppp-x', '×');
    close.title = 'Hide';
    close.onclick = () => panel.classList.add('ppp-min');
    head.appendChild(close);
    panel.appendChild(head);

    body = el('div', 'ppp-body');
    panel.appendChild(body);
    document.body.appendChild(panel);

    // Clicking a minimised panel re-opens it.
    panel.addEventListener('click', (e) => {
      if (panel.classList.contains('ppp-min') && e.target === panel) panel.classList.remove('ppp-min');
    });
  }

  function renderIntro() {
    body.innerHTML = '';
    if (!listing) {
      body.appendChild(el('div', 'ppp-note', "Couldn't read this listing automatically. Open the full property page on Rightmove and try again."));
      return;
    }
    const meta = el('div', 'ppp-meta');
    meta.innerHTML = `
      <div class="ppp-addr">${esc(listing.displayAddress || 'This property')}</div>
      <div class="ppp-tags">
        <span>${esc(listing.type)}</span>
        ${listing.beds ? `<span>${esc(listing.beds)} bed</span>` : ''}
        ${listing.sizeSqft ? `<span>${esc(listing.sizeSqft.toLocaleString())} sq ft</span>` : ''}
        ${listing.postcode ? `<span>${esc(listing.postcode)}</span>` : ''}
        ${(listing.lat != null && listing.lon != null) ? `<span class="ppp-pin">📍 map pin</span>` : ''}
      </div>`;
    body.appendChild(meta);

    const btn = el('button', 'ppp-go', '🧲 Find full address');
    btn.onclick = runLookup;
    body.appendChild(btn);

    if (listing.lat == null || listing.lon == null) {
      body.appendChild(el('div', 'ppp-note', 'No map pin on this listing — matching will rely on the postcode area only.'));
    }
  }

  function runLookup() {
    body.innerHTML = '';
    body.appendChild(el('div', 'ppp-loading', '<span class="ppp-spin"></span> Reverse-geocoding the map pin and searching the EPC register…'));
    chrome.runtime.sendMessage({ type: 'resolve', listing }, (res) => {
      if (chrome.runtime.lastError) { renderError(chrome.runtime.lastError.message); return; }
      renderResult(res);
    });
  }

  function renderError(msg) {
    body.innerHTML = '';
    body.appendChild(el('div', 'ppp-err', esc(msg)));
    const retry = el('button', 'ppp-go ppp-secondary', '← Back');
    retry.onclick = renderIntro;
    body.appendChild(retry);
  }

  function renderResult(res) {
    body.innerHTML = '';
    if (!res || res.error) {
      renderError(res ? res.error : 'No response from the resolver.');
      if (res && /API key/i.test(res.error || '')) {
        const o = el('button', 'ppp-go ppp-secondary', '⚙ Add your EPC API key');
        o.onclick = () => chrome.runtime.sendMessage({ type: 'openOptions' });
        body.appendChild(o);
      }
      return;
    }

    if (!res.candidates || !res.candidates.length) {
      body.appendChild(el('div', 'ppp-note', esc(res.note || 'No EPC match found for this listing.')));
      if (res.pcList && res.pcList.length) {
        body.appendChild(el('div', 'ppp-sub', 'Nearest postcodes from the pin: ' + esc(res.pcList.slice(0, 6).join(', '))));
      }
      const back = el('button', 'ppp-go ppp-secondary', '← Back');
      back.onclick = renderIntro;
      body.appendChild(back);
      return;
    }

    const top = res.candidates[0];
    const confidence = res.sizeMatched ? 'High — floor area matched'
      : (res.street ? 'Good — street confirmed from pin' : 'Postcode-area match');

    const best = el('div', 'ppp-best');
    best.innerHTML = `
      <div class="ppp-best-label">Most likely full address</div>
      <div class="ppp-best-addr">${esc(top.fullAddress)}</div>
      <div class="ppp-best-meta">
        ${top.band ? `<span>EPC ${esc(top.band)}</span>` : ''}
        ${top.sizeSqft ? `<span>${esc(top.sizeSqft.toLocaleString())} sq ft</span>` : ''}
        ${top.certDate ? `<span>cert ${esc(top.certDate)}</span>` : ''}
      </div>
      <div class="ppp-conf">Confidence: ${esc(confidence)}</div>`;
    const copy = el('button', 'ppp-copy', 'Copy');
    copy.onclick = () => { navigator.clipboard.writeText(top.fullAddress); copy.textContent = 'Copied ✓'; setTimeout(() => copy.textContent = 'Copy', 1500); };
    best.appendChild(copy);
    body.appendChild(best);

    if (res.candidates.length > 1) {
      const more = el('details', 'ppp-more');
      const sum = el('summary', null, `Other addresses on this street / postcode (${res.candidates.length - 1})`);
      more.appendChild(sum);
      const list = el('div', 'ppp-list');
      res.candidates.slice(1).forEach((c) => {
        const row = el('div', 'ppp-row');
        row.innerHTML = `<span class="ppp-row-addr">${esc(c.fullAddress)}</span>` +
          `${c.sizeSqft ? `<span class="ppp-row-size">${esc(c.sizeSqft.toLocaleString())} sq ft</span>` : ''}` +
          `${c.band ? `<span class="ppp-row-band">EPC ${esc(c.band)}</span>` : ''}`;
        list.appendChild(row);
      });
      more.appendChild(list);
      body.appendChild(more);
    }

    const foot = el('div', 'ppp-sub', `Searched ${res.pcList ? res.pcList.length : 0} postcode(s) near the pin · ${res.total} EPC record(s) on the street`);
    body.appendChild(foot);

    const back = el('button', 'ppp-go ppp-secondary', '← Search again');
    back.onclick = renderIntro;
    body.appendChild(back);
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  function start() {
    listing = extractListing();
    buildPanel();
    renderIntro();
  }

  // Let the popup trigger a lookup on the active tab.
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg && msg.type === 'getListing') { reply({ listing }); return true; }
    if (msg && msg.type === 'triggerLookup') {
      panel && panel.classList.remove('ppp-min');
      if (listing) runLookup();
      reply({ ok: !!listing });
      return true;
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
