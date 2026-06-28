import https from 'https';

// Lightweight GitHub REST helper — powers the dashboard's "agent updates" feed.
// Your Claude Code (web) agents do their work as commits / pull requests, so the
// live record of "what my agents did" is simply your repos' recent activity.
//
// Switches on when GITHUB_TOKEN is set (a fine-grained or classic PAT with read
// access to the repos you care about). Repos to watch come from GITHUB_REPOS
// ("owner/repo,owner/repo2"); if that's empty we list the token owner's most
// recently-pushed repos automatically.
export function githubConfigured() { return !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN); }
function token() { return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''; }

export function watchedRepos() {
  return (process.env.GITHUB_REPOS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function ghGet(path) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token(),
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'PropMail-Pro-Dashboard',
      },
    }, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch { /* leave null */ }
        resolve({ status: r.statusCode, json: j });
      });
    });
    req.on('error', () => resolve({ status: 0, json: null }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, json: null }); });
    req.end();
  });
}

// Resolve the list of repos to show: explicit GITHUB_REPOS, else the owner's
// 6 most recently pushed repos.
async function resolveRepos() {
  const explicit = watchedRepos();
  if (explicit.length) return explicit;
  const r = await ghGet('/user/repos?sort=pushed&per_page=6&affiliation=owner');
  if (Array.isArray(r.json)) return r.json.map((x) => x.full_name).filter(Boolean);
  return [];
}

const timeAgo = (iso) => iso || '';

// One flat, time-sorted activity feed across all watched repos: recent commits,
// open PRs and recently-updated issues. Each item is small and UI-ready.
export async function activityFeed({ limit = 40 } = {}) {
  if (!githubConfigured()) return { configured: false, items: [], repos: [] };
  const repos = await resolveRepos();
  if (!repos.length) return { configured: true, items: [], repos: [], note: 'No repos resolved. Set GITHUB_REPOS or grant the token repo access.' };

  const items = [];
  await Promise.all(repos.map(async (full) => {
    const [owner, repo] = full.split('/');
    if (!owner || !repo) return;
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

    const [commits, prs, issues] = await Promise.all([
      ghGet(`${base}/commits?per_page=8`),
      ghGet(`${base}/pulls?state=open&sort=updated&direction=desc&per_page=8`),
      ghGet(`${base}/issues?state=open&sort=updated&direction=desc&per_page=8`),
    ]);

    if (Array.isArray(commits.json)) {
      for (const c of commits.json) {
        const msg = (c.commit && c.commit.message) || '';
        items.push({
          type: 'commit',
          repo: full,
          title: msg.split('\n')[0].slice(0, 120),
          author: (c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name) || '',
          ts: c.commit && c.commit.author && c.commit.author.date,
          url: c.html_url,
        });
      }
    }
    if (Array.isArray(prs.json)) {
      for (const p of prs.json) {
        items.push({
          type: 'pr',
          repo: full,
          title: `#${p.number} ${p.title}`,
          author: p.user && p.user.login,
          ts: p.updated_at,
          url: p.html_url,
          draft: p.draft,
        });
      }
    }
    if (Array.isArray(issues.json)) {
      for (const i of issues.json) {
        if (i.pull_request) continue; // the issues endpoint also returns PRs
        items.push({
          type: 'issue',
          repo: full,
          title: `#${i.number} ${i.title}`,
          author: i.user && i.user.login,
          ts: i.updated_at,
          url: i.html_url,
        });
      }
    }
  }));

  items.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0));
  return { configured: true, repos, items: items.slice(0, limit).map((x) => ({ ...x, when: timeAgo(x.ts) })) };
}

// Open issues across watched repos, shaped as candidate to-dos for the morning
// brief (so "tasks I need to do" can be grounded in real, assigned work).
export async function openIssuesAsTasks({ limit = 25 } = {}) {
  if (!githubConfigured()) return [];
  const repos = await resolveRepos();
  const out = [];
  await Promise.all(repos.map(async (full) => {
    const [owner, repo] = full.split('/');
    if (!owner || !repo) return;
    const r = await ghGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=open&sort=updated&per_page=10`);
    if (Array.isArray(r.json)) {
      for (const i of r.json) {
        if (i.pull_request) continue;
        out.push({ repo: full, number: i.number, title: i.title, url: i.html_url, updated: i.updated_at, labels: (i.labels || []).map((l) => l.name) });
      }
    }
  }));
  out.sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));
  return out.slice(0, limit);
}
