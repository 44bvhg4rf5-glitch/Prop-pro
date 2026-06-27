import https from 'https';

// Free web search for the AI. Lets a non-search LLM (e.g. Groq) get live results
// without paying for built-in grounding. Uses whichever free key is set:
//   TAVILY_API_KEY — Tavily, 1,000 searches/month free, no card (recommended)
//   BRAVE_API_KEY  — Brave Search API free tier (alternative)
// Returns { answer, results:[{title,url,content}] }; empty (no-op) when unset.
export function searchConfigured() {
  return !!(process.env.TAVILY_API_KEY || process.env.BRAVE_API_KEY);
}
export function searchProviderName() {
  if (process.env.TAVILY_API_KEY) return 'tavily';
  if (process.env.BRAVE_API_KEY) return 'brave';
  return '';
}

function tavily(query, maxResults, key) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ api_key: key, query, max_results: maxResults, search_depth: 'basic', include_answer: true });
    const req = https.request({
      hostname: 'api.tavily.com', path: '/search', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + key },
    }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => {
        try {
          const j = JSON.parse(b);
          resolve({ answer: j.answer || '', results: (j.results || []).map((x) => ({ title: x.title || '', url: x.url || '', content: String(x.content || '').slice(0, 500) })) });
        } catch { resolve({ answer: '', results: [] }); }
      });
    });
    req.on('error', () => resolve({ answer: '', results: [] }));
    req.setTimeout(13000, () => { req.destroy(); resolve({ answer: '', results: [] }); });
    req.write(body); req.end();
  });
}

function brave(query, maxResults, key) {
  return new Promise((resolve) => {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
    https.get(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': key } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => {
        try {
          const j = JSON.parse(b);
          const web = (j.web && j.web.results) || [];
          resolve({ answer: '', results: web.slice(0, maxResults).map((x) => ({ title: x.title || '', url: x.url || '', content: String(x.description || '').slice(0, 500) })) });
        } catch { resolve({ answer: '', results: [] }); }
      });
    }).on('error', () => resolve({ answer: '', results: [] }))
      .setTimeout(13000, function () { this.destroy(); resolve({ answer: '', results: [] }); });
  });
}

export async function webSearch(query, { maxResults = 5 } = {}) {
  if (!query || !query.trim()) return { answer: '', results: [] };
  const tav = process.env.TAVILY_API_KEY;
  if (tav) return tavily(query, maxResults, tav);
  const br = process.env.BRAVE_API_KEY;
  if (br) return brave(query, maxResults, br);
  return { answer: '', results: [] };
}
