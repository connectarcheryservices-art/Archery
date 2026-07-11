// In-house, provider-agnostic mail sender for Archery.Services.
// The app IS the mail system — it relays through whatever SMTP server the admin
// connects in Mail Settings (stored in the `settings` row). No Gmail/Microsoft/
// GoDaddy/third-party HTTP API lock-in: any host that speaks SMTP works.
// Sending works on Vercel serverless (outbound 465/587 to the relay).
'use strict';
const nodemailer = require('nodemailer');
const { getSettings } = require('./settings');

// Reads SMTP config from the settings row, falling back to env vars.
async function mailConfig() {
  let s = {};
  try { s = await getSettings(); } catch (e) {}
  return {
    host: s.mailSmtpHost || process.env.MAIL_SMTP_HOST || '',
    port: Number(s.mailSmtpPort || process.env.MAIL_SMTP_PORT || 587),
    user: s.mailSmtpUser || process.env.MAIL_SMTP_USER || '',
    pass: s.mailSmtpPass || process.env.MAIL_SMTP_PASS || '',
    secure: (s.mailSmtpSecure ?? (process.env.MAIL_SMTP_SECURE === 'true')),
    allowSelfSigned: !!s.mailSmtpInsecure,
    fromName: s.mailFromName || process.env.MAIL_FROM_NAME || 'Archery.Services',
    fromAddress: s.mailFromAddress || process.env.MAIL_FROM_ADDRESS || s.mailSmtpUser || '',
  };
}

function makeTransport(c) {
  // 465 → implicit TLS (secure); 587 → STARTTLS (not secure). Auto-corrected.
  const port = c.port || 587;
  const secure = port === 465 ? true : port === 587 ? false : !!c.secure;
  return nodemailer.createTransport({
    host: c.host, port, secure,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    tls: { rejectUnauthorized: !c.allowSelfSigned },
    connectionTimeout: 12000, greetingTimeout: 10000, socketTimeout: 20000,
  });
}

// Verify an SMTP config can connect + auth (used by the "Send test" button).
async function verifySmtp(c) {
  if (!c.host) return { ok: false, error: 'Enter your SMTP host (e.g. mail.yourdomain.com).' };
  try {
    await makeTransport(c).verify();
    const port = c.port || 587;
    return { ok: true, detail: `Connected to ${c.host}:${port} (${port === 465 ? 'implicit TLS' : 'STARTTLS'})` };
  } catch (e) {
    const m = String(e && e.message || 'connection failed');
    let hint;
    const low = m.toLowerCase();
    if (low.includes('wrong version') || low.includes('ssl routines') || low.includes('tlsv1')) hint = 'TLS mismatch — use port 587 with TLS/SSL OFF, or 465 with it ON.';
    else if (low.includes('etimedout') || low.includes('econnrefused')) hint = 'No response on that port — try 587 or 465.';
    else if (low.includes('auth') || low.includes('535') || low.includes('invalid login')) hint = 'Auth failed — use the full email as username (and an app password if 2FA is on).';
    else if (low.includes('enotfound') || low.includes('getaddrinfo')) hint = 'Hostname not found — check the SMTP host spelling.';
    else if (low.includes('self') && low.includes('sign')) hint = 'Certificate is self-signed — enable "Allow self-signed" if you trust this server.';
    return { ok: false, error: m, hint };
  }
}

// Send an email. Returns {ok, noTransport?} — callers fall back gracefully when
// no SMTP is configured yet (e.g. show the reset link on screen instead).
async function sendMail({ to, subject, html, text, replyTo, config }) {
  const c = config || await mailConfig();
  if (!c.host) return { ok: false, noTransport: true, error: 'No mail server connected yet.' };
  const from = c.fromAddress ? `${c.fromName} <${c.fromAddress}>` : c.fromName;
  try {
    const info = await makeTransport(c).sendMail({
      from, to, subject, html,
      text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      replyTo: replyTo || c.fromAddress || undefined,
    });
    return { ok: true, id: info.messageId };
  } catch (e) {
    console.error('sendMail:', e && e.message);
    return { ok: false, error: String(e && e.message || 'send failed') };
  }
}

// Branded HTML wrapper matching the site (gold on dark).
function branded({ heading, body, cta, ctaUrl, preheader }) {
  return `<!doctype html><html><body style="margin:0;background:#101116;font-family:Arial,Helvetica,sans-serif;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#101116;padding:32px 0;"><tr><td align="center">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#17181D;border:1px solid rgba(255,255,255,.1);border-radius:14px;overflow:hidden;">
    <tr><td style="background:#131316;padding:22px 28px;border-bottom:1px solid rgba(201,162,39,.3);">
      <span style="font-family:Arial;font-weight:bold;font-size:19px;letter-spacing:1px;color:#ffffff;text-transform:uppercase;">ARCHERY<span style="color:#C9A227;">.</span>SERVICES</span>
    </td></tr>
    <tr><td style="padding:30px 28px;color:#F5F6F8;">
      <h1 style="margin:0 0 14px;font-size:22px;color:#ffffff;">${heading}</h1>
      <div style="font-size:15px;line-height:1.7;color:#B9BEC9;">${body}</div>
      ${cta && ctaUrl ? `<div style="margin:26px 0 6px;"><a href="${ctaUrl}" style="display:inline-block;background:#C9A227;color:#131316;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:6px;font-size:14px;">${cta}</a></div>` : ''}
    </td></tr>
    <tr><td style="padding:18px 28px;background:#0D0E11;color:#7E8290;font-size:12px;border-top:1px solid rgba(255,255,255,.06);">
      Archery.Services · India's complete archery platform<br>You received this because you have an account with us.
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

module.exports = { sendMail, verifySmtp, mailConfig, branded };
