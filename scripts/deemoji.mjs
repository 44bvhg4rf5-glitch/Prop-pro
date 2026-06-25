// One-off-ish build tool: replace emojis with professional masked-SVG icons.
// Markup injected is quote-free (<i class=ic-NAME></i>) so it is safe inside any
// JS string (single/double/backtick) and valid HTML. Icons are coloured via CSS
// mask + currentColor, so they adapt to whatever context they sit in.
import fs from 'fs';

// ── Icon path library (Lucide-style, viewBox 0 0 24 24) ──
const PATHS = {
  home: `<path d="M3 9.5 12 3l9 6.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>`,
  building: `<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 6h.01M15 6h.01M9 10h.01M15 10h.01M9 14h.01M15 14h.01M10 22v-4h4v4"/>`,
  printer: `<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>`,
  chart: `<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/>`,
  trend: `<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>`,
  clipboard: `<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>`,
  file: `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>`,
  pencil: `<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>`,
  eye: `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>`,
  gear: `<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>`,
  wrench: `<path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L3 18l3 3 6.5-6.5a4 4 0 0 0 5.2-5.2l-2.4 2.4-2.6-.6-.6-2.6Z"/>`,
  mail: `<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 5L2 7"/>`,
  send: `<path d="M14.5 21.7 21.9 3.1 3.3 10.5l7.6 3 3.6 8.2z"/><path d="m21.9 3.1-11 11"/>`,
  bot: `<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>`,
  target: `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>`,
  zap: `<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>`,
  rocket: `<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>`,
  message: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
  check: `<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>`,
  x: `<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>`,
  alert: `<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>`,
  pound: `<path d="M18 7c0-2.2-1.8-4-4-4S10 4.8 10 7v3H6v3h4v3c0 1.7-1 3-2 3h12"/><path d="M8 19h10"/>`,
  gem: `<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M11 3 8 9l4 12 4-12-3-6M2 9h20"/>`,
  refresh: `<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>`,
  brain: `<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>`,
  ban: `<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>`,
  phone: `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>`,
  calendar: `<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>`,
  clock: `<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`,
  hourglass: `<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>`,
  key: `<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6M15.5 7.5 19 11"/>`,
  unlock: `<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>`,
  lock: `<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
  play: `<polygon points="6 3 20 12 6 21 6 3"/>`,
  pause: `<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>`,
  stop: `<rect x="5" y="5" width="14" height="14" rx="2"/>`,
  route: `<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>`,
  bulb: `<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6M10 22h4"/>`,
  monitor: `<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>`,
  trophy: `<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>`,
  crown: `<path d="M11.6 3.5a.6.6 0 0 1 .8 0l2.7 2.4 3.4-2a.6.6 0 0 1 .9.6l-1 6.5H4.6l-1-6.5a.6.6 0 0 1 .9-.6l3.4 2z"/><path d="M5 17h14"/>`,
  gift: `<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M4 12v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>`,
  arrowupright: `<path d="M7 7h10v10"/><path d="M7 17 17 7"/>`,
  leaf: `<path d="M11 20A7 7 0 0 1 4 13c0-6 8-9 16-9 0 8-3 16-9 16a7 7 0 0 1-7-7c0-2 1-4 3-5"/>`,
  swords: `<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M9.5 17.5 21 6V3h-3L6.5 14.5"/>`,
  star: `<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>`,
  film: `<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9M12.4 3.4l3.1 4M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>`,
  palette: `<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.2a2 2 0 0 1 2-2h2.3A4.2 4.2 0 0 0 22 11c0-5-4.5-9-10-9z"/>`,
  download: `<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>`,
  upload: `<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>`,
  cloud: `<path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6-1.5A4 4 0 0 0 6.5 19z"/>`,
  save: `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>`,
  folder: `<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.6-.8l-.9-1.2A2 2 0 0 0 8 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>`,
  box: `<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>`,
  handshake: `<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a2 2 0 0 0-2.8 0l-1.6 1.6a1 1 0 1 1-3-3l2.6-2.6a4 4 0 0 1 5.7 0L21 8"/><path d="M3 8 8 3l4 4-3 3a1 1 0 0 1-3-3"/>`,
  cap: `<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5"/>`,
  flask: `<path d="M9 3h6M10 3v6.5L4.5 19A2 2 0 0 0 6 22h12a2 2 0 0 0 1.5-3.5L14 9.5V3"/><path d="M7 15h10"/>`,
  flame: `<path d="M12 2c2 4 6 5 6 10a6 6 0 0 1-12 0c0-2 1-3 2-4 .5 1 1.5 1.5 2 1.5C9 7 11 5 12 2z"/>`,
  bed: `<path d="M2 18v-6a2 2 0 0 1 2-2h14a4 4 0 0 1 4 4v4M2 8v10M22 18v-2M2 14h20"/><circle cx="7" cy="10" r="1.5"/>`,
  link: `<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>`,
  pin: `<path d="M12 22s8-6 8-12a8 8 0 1 0-16 0c0 6 8 12 8 12z"/><circle cx="12" cy="10" r="3"/>`,
  phonemob: `<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>`,
  user: `<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`,
  info: `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>`,
  radio: `<circle cx="12" cy="12" r="2"/><path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4"/>`,
  trash: `<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>`,
  sparkles: `<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8zM5 3l.6 1.6L7 5l-1.4.4L5 7l-.6-1.6L3 5l1.4-.4z"/>`,
  book: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>`,
  mailbox: `<path d="M22 17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3.5C2 9.9 4.9 7 8.5 7H14a4 4 0 0 1 4 4v6"/><path d="M6 11h.01M15 7v10"/>`,
  party: `<path d="M5.8 11.3 2 22l10.7-3.8M4 3h.01M22 8h.01M15 2h.01M22 20h.01"/><path d="M11 13a9 9 0 0 1 9-9M6 16a6 6 0 0 1 6-6"/>`,
  pin2: `<path d="M12 17v5M9 10.8 12 2l3 8.8a2 2 0 0 1-1.2 2.5l-1.8.6-1.8-.6A2 2 0 0 1 9 10.8z"/>`,
  hand: `<path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>`,
};

// Solid coloured status dots keep their meaning (red = bad, etc.).
const DOTS = { '🔴': '#ef4444', '🟢': '#22c55e', '🟠': '#f59e0b', '🔵': '#3b82f6', '🟣': '#a855f7' };

// ── Emoji → icon name map ──
const MAP = {
  '🏠': 'home', '🏘': 'home', '🏢': 'building', '🏟': 'building', '🏗': 'building',
  '🖨': 'printer', '📟': 'printer',
  '📊': 'chart', '📈': 'trend',
  '📋': 'clipboard', '📇': 'clipboard', '📄': 'file', '📝': 'file', '📕': 'book', '📘': 'book',
  '✍': 'pencil', '✏': 'pencil',
  '🔍': 'search', '🔎': 'search', '👁': 'eye',
  '⚙': 'gear', '🔧': 'wrench',
  '✉': 'mail', '📭': 'mail', '📬': 'mailbox', '📮': 'send',
  '🤖': 'bot', '🎯': 'target',
  '⚡': 'zap', '🚀': 'rocket', '💬': 'message',
  '✅': 'check', '☑': 'check', '❌': 'x', '⚠': 'alert', '🚨': 'alert',
  '💰': 'pound', '💷': 'pound', '💎': 'gem',
  '🔄': 'refresh', '🧠': 'brain', '🚫': 'ban', '📞': 'phone',
  '📅': 'calendar', '🗓': 'calendar', '⏰': 'clock', '⏱': 'clock', '⏳': 'hourglass',
  '🔑': 'key', '🔓': 'unlock', '🔐': 'lock',
  '▶': 'play', '⏸': 'pause', '⏹': 'stop',
  '🛣': 'route', '💡': 'bulb', '💻': 'monitor', '🏆': 'trophy', '👑': 'crown',
  '🆓': 'gift', '↗': 'arrowupright', '🌱': 'leaf', '🥊': 'swords', '⭐': 'star',
  '🎬': 'film', '🎨': 'palette', '⬇': 'download', '📤': 'upload', '☁': 'cloud',
  '💾': 'save', '🗂': 'folder', '📦': 'box', '🤝': 'handshake', '🎓': 'cap',
  '🧪': 'flask', '🔥': 'flame', '🛏': 'bed', '🔗': 'link', '📍': 'pin2',
  '📱': 'phonemob', '👤': 'user', 'ℹ': 'info', '📡': 'radio', '🗑': 'trash',
  '🎉': 'party', '✨': 'sparkles', '✋': 'hand',
};

function svgDataUri(inner) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${inner}</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function buildCss() {
  let css = '\n/* ===== Professional icon system (auto-generated by scripts/deemoji.mjs) ===== */\n';
  css += `i[class^="ic-"]{display:inline-block;width:1em;height:1em;vertical-align:-0.14em;background-color:currentColor;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain;-webkit-mask-image:var(--m);mask-image:var(--m);flex-shrink:0}\n`;
  css += `i[class^="dot-"]{display:inline-block;width:.6em;height:.6em;border-radius:50%;vertical-align:.05em;flex-shrink:0}\n`;
  for (const [name, inner] of Object.entries(PATHS)) {
    css += `.ic-${name}{--m:url("${svgDataUri(inner)}")}\n`;
  }
  for (const [, color] of Object.entries(DOTS)) {
    const key = color.replace('#', '');
    css += `.dot-${key}{background:${color}}\n`;
  }
  return css;
}

// Replace emojis in text. `inTagAware` skips emojis sitting inside an HTML tag
// (i.e. attribute values) for .html files; JS strings are always replaced.
function transform(text, inTagAware) {
  let out = '';
  let inTag = false;
  for (const ch of text) {
    if (inTagAware) {
      if (ch === '<') inTag = true;
      else if (ch === '>') inTag = false;
    }
    if (DOTS[ch] && !(inTagAware && inTag)) { out += `<i class=dot-${DOTS[ch].replace('#', '')}></i>`; continue; }
    if (MAP[ch] && !(inTagAware && inTag)) { out += `<i class=ic-${MAP[ch]}></i>`; continue; }
    out += ch;
  }
  return out;
}

// ── Run ──
const target = process.argv[2];
if (target === 'css') { process.stdout.write(buildCss()); process.exit(0); }

const files = [
  { path: 'public/index.html', tagAware: true },
  { path: 'public/app.js', tagAware: false },
];
const onlyFile = process.argv[2];
let report = [];
for (const f of files) {
  if (onlyFile && !f.path.includes(onlyFile)) continue;
  const before = fs.readFileSync(f.path, 'utf8');
  const after = transform(before, f.tagAware);
  const left = (after.match(/\p{Extended_Pictographic}/gu) || []).length;
  fs.writeFileSync(f.path, after);
  report.push(`${f.path}: emoji remaining after = ${left}`);
}
console.log(report.join('\n'));
console.log('Run `node scripts/deemoji.mjs css` to get the CSS to append to styles.css.');
