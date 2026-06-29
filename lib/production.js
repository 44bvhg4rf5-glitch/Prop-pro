// Production Kit — turns the agency's script/hook/caption output into
// copy-paste-ready packages for the actual video tools (CapCut, ElevenLabs,
// Canva…). This is a pure, deterministic transform: no LLM call, no cost, instant.
//
// Each kit bundles everything you paste into one video in one place:
//   • a single voiceover block  -> ElevenLabs / CapCut text-to-speech
//   • a numbered shot list      -> what to film or generate, in order
//   • on-screen text lines      -> CapCut caption overlays
//   • hook options              -> A/B test the first frame
//   • caption + hashtags + pin  -> the TikTok post itself

// Loosely match a script title to a hook/caption entry's `for_script` field.
function matchByTitle(arr, title) {
  if (!Array.isArray(arr) || !title) return null;
  const key = (title || '').toLowerCase().trim();
  let hit = arr.find((x) => (x.for_script || '').toLowerCase().trim() === key);
  if (hit) return hit;
  // Fall back to a contains match (titles sometimes drift slightly between agents).
  hit = arr.find((x) => {
    const f = (x.for_script || '').toLowerCase().trim();
    return f && (f.includes(key) || key.includes(f));
  });
  return hit || null;
}

// Build one kit per script from the accumulated agency output (`out`).
export function buildProductionKits(out) {
  const o = out || {};
  const scripts = (o.scriptwriter && o.scriptwriter.scripts) || [];
  const hooks = (o.hooks && o.hooks.hooks) || [];
  const posts = (o.captions && o.captions.posts) || [];

  return scripts.map((s) => {
    const h = matchByTitle(hooks, s.title);
    const p = matchByTitle(posts, s.title);
    const shots = Array.isArray(s.shots) ? s.shots : [];
    const voiceoverLines = shots.map((sh) => (sh.voiceover_or_text || '').trim()).filter(Boolean);
    const hashtags = (p && Array.isArray(p.hashtags) ? p.hashtags : []).map((t) => '#' + String(t).replace(/^#/, ''));

    return {
      title: s.title || 'Untitled',
      pillar: s.pillar || '',
      duration_seconds: s.duration_seconds || null,
      primary_hook: s.hook_line || '',
      hook_options: (h && Array.isArray(h.options) ? h.options : []),
      // Ready to paste straight into a TTS tool — hook first, then the body.
      voiceover_block: [s.hook_line, ...voiceoverLines].filter(Boolean).join('\n'),
      shot_list: shots.map((sh, i) => ({ n: i + 1, visual: sh.visual || '', say: sh.voiceover_or_text || '' })),
      on_screen_text: Array.isArray(s.on_screen_text) ? s.on_screen_text.filter(Boolean) : [],
      cta: s.cta || '',
      caption: (p && p.caption) || '',
      hashtags,
      pinned_comment: (p && p.comment_pin) || '',
      checklist: [
        'Film/generate each shot below in order',
        'Paste the voiceover block into ElevenLabs or CapCut TTS',
        'Add the on-screen text as caption overlays in CapCut',
        'Auto-caption the whole video in CapCut',
        'Post with the caption + hashtags, then pin the comment',
        'Label as AI-generated if you used AI avatars/video',
      ],
    };
  });
}

// Render one kit as a clean, paste-friendly Markdown block.
export function kitToMarkdown(kit, index) {
  const L = [];
  L.push(`## ${index != null ? index + '. ' : ''}${kit.title}`);
  const meta = [kit.pillar && `Pillar: ${kit.pillar}`, kit.duration_seconds && `${kit.duration_seconds}s`].filter(Boolean).join(' · ');
  if (meta) L.push(`_${meta}_`);
  L.push('');
  L.push(`**Hook (primary):** ${kit.primary_hook}`);
  if (kit.hook_options.length) L.push(`**A/B hooks:** ${kit.hook_options.map((h) => `“${h}”`).join('  ·  ')}`);
  L.push('');
  L.push('### 🗣️ Voiceover block — paste into ElevenLabs / CapCut TTS');
  L.push('```');
  L.push(kit.voiceover_block || '(no voiceover)');
  L.push('```');
  L.push('');
  L.push('### 🎬 Shot list');
  kit.shot_list.forEach((sh) => L.push(`${sh.n}. **${sh.visual}**${sh.say ? ` — say: “${sh.say}”` : ''}`));
  if (kit.on_screen_text.length) {
    L.push('');
    L.push('### 🔤 On-screen text overlays');
    kit.on_screen_text.forEach((t) => L.push(`- ${t}`));
  }
  L.push('');
  L.push('### 📲 The post');
  L.push(`**Caption:** ${kit.caption}`);
  if (kit.hashtags.length) L.push(`**Hashtags:** ${kit.hashtags.join(' ')}`);
  if (kit.pinned_comment) L.push(`**Pin this comment:** ${kit.pinned_comment}`);
  if (kit.cta) L.push(`**CTA:** ${kit.cta}`);
  L.push('');
  L.push('### ✅ Production checklist');
  kit.checklist.forEach((c) => L.push(`- [ ] ${c}`));
  L.push('');
  return L.join('\n');
}

// Render the whole batch as one Markdown document.
export function kitsToMarkdown(kits, title) {
  const head = `# 📦 ${title || 'ViralForge Production Kit'}\n\n${kits.length} videos, ready to film and post.\n`;
  return head + '\n' + kits.map((k, i) => kitToMarkdown(k, i + 1)).join('\n---\n\n');
}
