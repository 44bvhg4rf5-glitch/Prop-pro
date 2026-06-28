import https from 'https';

// Transactional email via Resend (https://resend.com) — a single HTTPS POST,
// free tier, no SMTP. Switches on when RESEND_API_KEY is set. EMAIL_FROM should
// be a verified sender (e.g. "PropMail Pro <noreply@youragency.co.uk>").
export function emailConfigured() { return !!process.env.RESEND_API_KEY; }
function emailFrom() { return process.env.EMAIL_FROM || 'PropMail Pro <onboarding@resend.dev>'; }

export function sendEmail({ to, subject, html, text }) {
  return new Promise((resolve) => {
    const key = process.env.RESEND_API_KEY || '';
    if (!key) { resolve({ sent: false, reason: 'not_configured' }); return; }
    const data = JSON.stringify({ from: emailFrom(), to: Array.isArray(to) ? to : [to], subject, html, text });
    const req = https.request({
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve({ sent: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode, body: b })); });
    req.on('error', (e) => resolve({ sent: false, reason: e.message }));
    req.write(data); req.end();
  });
}
