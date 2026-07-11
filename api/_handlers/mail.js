// /api/mail/settings (GET/POST) and /api/mail/test (POST) — the admin Mail
// Settings panel. Connect any SMTP server; the app sends through it. Owner/
// manager only for writes. The password is stored but never returned to the UI.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin, can } = require('../_lib/auth');
const { verifySmtp, sendMail, mailConfig, branded } = require('../_lib/mailer');
const { q } = require('../_lib/db');

async function saveSettings(patch) {
  const cur = (await q(`select data from settings where id=1`)).rows[0]?.data || {};
  const merged = { ...cur, ...patch };
  await q(`insert into settings (id,data) values (1,$1) on conflict (id) do update set data=$1`, [JSON.stringify(merged)]);
  return merged;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const actor = checkAdmin(req);
  if (!actor) return json(res, { error: 'Unauthorised' }, 401);
  const action = req.query.action;

  try {
    if (action === 'settings' && req.method === 'GET') {
      const c = await mailConfig();
      return json(res, {
        host: c.host, port: c.port, user: c.user, secure: !!c.secure, insecure: !!c.allowSelfSigned,
        fromName: c.fromName, fromAddress: c.fromAddress,
        hasPassword: !!c.pass, configured: !!c.host,
      });
    }
    if (!can(actor, 'settings')) return json(res, { error: 'Only the owner or a manager can change mail settings.' }, 403);

    if (action === 'settings' && req.method === 'POST') {
      const b = readBody(req);
      const patch = {
        mailSmtpHost: String(b.host || '').trim(),
        mailSmtpPort: Number(b.port) || 587,
        mailSmtpUser: String(b.user || '').trim(),
        mailSmtpSecure: !!b.secure,
        mailSmtpInsecure: !!b.insecure,
        mailFromName: String(b.fromName || 'Archery.Services').trim(),
        mailFromAddress: String(b.fromAddress || b.user || '').trim(),
      };
      if (b.password) patch.mailSmtpPass = String(b.password);   // only overwrite when a new one is supplied
      await saveSettings(patch);
      return json(res, { ok: true });
    }

    if (action === 'test' && req.method === 'POST') {
      const b = readBody(req);
      const c = await mailConfig();
      // Allow testing unsaved values from the form (password may be blank → use stored).
      if (b.host) { c.host = b.host; c.port = Number(b.port) || c.port; c.user = b.user || c.user; c.secure = !!b.secure; c.allowSelfSigned = !!b.insecure; if (b.password) c.pass = b.password; if (b.fromAddress) c.fromAddress = b.fromAddress; if (b.fromName) c.fromName = b.fromName; }
      const v = await verifySmtp(c);
      if (!v.ok) return json(res, { ok: false, stage: 'connect', error: v.error, hint: v.hint });
      const to = b.to || c.fromAddress || c.user;
      const send = await sendMail({
        to, config: c, subject: 'Archery.Services — mail is working ✓',
        html: branded({ heading: 'Your mail server is connected', body: 'This is a test message from your Archery.Services admin panel. Outgoing email is now working — password resets, order confirmations and notifications will be delivered from here.', preheader: 'SMTP test successful' }),
      });
      if (!send.ok) return json(res, { ok: false, stage: 'send', error: send.error });
      return json(res, { ok: true, detail: v.detail, sentTo: to });
    }

    return json(res, { error: 'Not found' }, 404);
  } catch (e) {
    console.error('mail:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
