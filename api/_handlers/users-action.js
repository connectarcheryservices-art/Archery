// /api/users/<action> — customer accounts: register/login/me + real profile
// creation + TOTP 2FA + password reset. Sessions are stateless signed tokens
// (payload + HMAC) so they work across serverless instances with no store.
'use strict';
const crypto = require('crypto');
const { cors, json, readBody } = require('../_lib/respond');
const { q } = require('../_lib/db');
const { hashPassword, verifyPassword } = require('../_lib/auth');
const { generateSecret, verifyTotp, otpauthUri, generateBackupCodes, consumeBackupCode } = require('../_lib/totp');
const { guard, record } = require('../_lib/ratelimit');
const { writeAudit } = require('../_lib/audit');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const { sign, authedUserChecked, revokeSessions } = require('../_lib/userauth');
const { isMinor, validateDob } = require('../_lib/age');

// A reset/welcome link must point back at a real, known Archery.Services
// origin — never at whatever `origin` a caller puts in the request body.
// Otherwise a crafted `{email, origin:'https://evil.example'}` POST turns a
// real, valid, single-use token into a link handed to attacker infrastructure
// (classic password-reset-link poisoning).
const ALLOWED_ORIGINS = [/^https:\/\/(www\.)?archery\.services$/, /^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
function safeOrigin(origin) {
  const o = String(origin || '');
  return ALLOWED_ORIGINS.some(re => re.test(o)) ? o : 'https://archery.services';
}
// A unique, URL-safe handle for the public profile (archery.services/<handle>).
async function uniqueHandle(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'archer';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    const exists = (await q('select 1 from profiles where handle=$1', [candidate])).rows[0];
    if (!exists) return candidate;
  }
  return base + '-' + crypto.randomBytes(3).toString('hex');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const action = req.query.action;
  try {
    if (action === 'register' && req.method === 'POST') {
      const b = readBody(req);
      const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
      // Registration is a free write anyone can trigger — throttle it per-IP
      // like every other auth endpoint (THREAT_MODEL T5 pattern), even though
      // there's no "identity" to key on yet.
      const blocked = await guard(req, null, { ipMax: 10, windowMin: 15 });
      if (blocked) {
        res.setHeader('Retry-After', String(blocked.retryAfter));
        return json(res, { ok: false, error: `Too many attempts. Try again in ${Math.ceil(blocked.retryAfter / 60)} minute(s).` }, 429);
      }
      const name = String(b.name || '').trim().slice(0, 80);
      const password = String(b.password || '');
      if (!name || !email || !password) return json(res, { ok: false, error: 'Name, email and password are required.' }, 400);
      if (!EMAIL_RE.test(email)) return json(res, { ok: false, error: 'Please enter a valid email address.' }, 400);
      if (password.length < 8) return json(res, { ok: false, error: 'Password must be at least 8 characters.' }, 400);
      // Age assurance at account creation (CLAUDE.md §1.8) — every new
      // signup states a real date of birth; there is no "skip" option.
      const dobCheck = validateDob(b.dateOfBirth);
      if (!dobCheck.valid) return json(res, { ok: false, error: dobCheck.error }, 400);
      const minor = isMinor(dobCheck.date);
      let parentEmail = null;
      if (minor) {
        parentEmail = String(b.parentEmail || '').trim().toLowerCase().slice(0, 160);
        if (!parentEmail || !EMAIL_RE.test(parentEmail)) return json(res, { ok: false, error: "A parent or guardian's email is required for an under-18 account." }, 400);
        if (parentEmail === email) return json(res, { ok: false, error: "The parent/guardian email must be different from the account's own email." }, 400);
      }
      const exists = (await q('select id from users where email=$1', [email])).rows[0];
      if (exists) { await record('ip:' + require('../_lib/ratelimit').clientIp(req), { ok: false, req }); return json(res, { ok: false, error: 'An account with this email already exists.' }, 409); }
      const consentToken = minor ? crypto.randomBytes(24).toString('base64url') : null;
      const r = await q(
        `insert into users (name,email,pass,created_at,date_of_birth,parent_email,parent_consent_status,parent_consent_token,parent_consent_sent_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [name, email, hashPassword(password), Date.now(), dobCheck.date, parentEmail,
         minor ? 'pending' : 'not_required', consentToken, minor ? new Date() : null]);
      const userId = r.rows[0].id;
      // Every registered user gets a real, editable, shareable profile — no more demo data.
      const handle = await uniqueHandle(name);
      await q(`insert into profiles (handle,name,user_id,active) values ($1,$2,$3,true)`, [handle, name, userId]);
      const site = safeOrigin(b.origin);
      // Welcome email (best-effort — silent if no mail server connected yet).
      try {
        const { sendMail, branded } = require('../_lib/mailer');
        sendMail({ to: email, subject: 'Welcome to Archery.Services 🏹',
          html: branded({ heading: 'Welcome, ' + name.split(' ')[0] + '!',
            preheader: 'Your archery account is ready',
            body: (minor
              ? 'Your account is created. Because you\'re under 18, a parent or guardian needs to confirm before you can do things like connect with a coach or enter a tournament — we\'ve emailed them.'
              : 'Your account is ready. Build your athlete profile, enter tournaments, shop equipment, and connect with the archery community across India.')
              + '<br><br>Your public profile: <b>archery.services/' + handle + '</b>',
            cta: 'Go to my profile', ctaUrl: site + '/profile' }) }).catch(() => {});
      } catch (e) {}
      // Verifiable parental consent, requested from the PARENT's inbox, never
      // the child's — "verifiable" means the parent takes an action on their
      // own email, not a checkbox the child ticks on the parent's behalf.
      if (minor) {
        try {
          const { sendMail, branded } = require('../_lib/mailer');
          const link = site + '/parental-consent.html?token=' + consentToken;
          await sendMail({ to: parentEmail, subject: `${name} wants to join Archery.Services — your consent is needed`,
            html: branded({ heading: 'Parental consent requested',
              preheader: 'A parent/guardian confirmation is required',
              body: `${name} (${email}) has created an account on Archery.Services and listed you as their parent or guardian. Because they are under 18, Indian law (the DPDP Act) requires your verifiable consent before we process their data beyond a bare account — things like connecting with a coach, entering a tournament, or having a public profile all wait for your decision. We never show them personalised ads or track their activity for marketing, with or without your consent — that protection is not optional and does not depend on what you choose below.<br><br>If this isn't a real request, or you don't recognise this account, choose "I do not consent" and nothing further will happen.`,
              cta: 'Review and respond', ctaUrl: link }) });
        } catch (e) { console.error('users/register: parent consent email failed:', e?.message); }
      }
      await record('ip:' + require('../_lib/ratelimit').clientIp(req), { ok: true, req });
      const user = { id: userId, name, email, isMinor: !!minor, parentConsentStatus: minor ? 'pending' : 'not_required' };
      return json(res, { ok: true, token: sign(user), user });
    }

    // ── PARENTAL CONSENT: the parent/guardian's own action, from their own
    // inbox — never something the child (or anyone else) can trigger on the
    // parent's behalf. Public (the parent has no account here), gated
    // entirely by possession of the single-use emailed token. ──
    if (action === 'parent-consent-info' && req.method === 'GET') {
      const token = String(req.query.token || '');
      if (!token) return json(res, { ok: false, error: 'Missing consent token.' }, 400);
      const row = (await q(`select name, email, parent_consent_status from users where parent_consent_token=$1`, [token])).rows[0];
      if (!row) return json(res, { ok: false, error: 'This consent link is invalid or has already been used.' }, 404);
      // Only what's needed to make an informed decision — never the
      // password hash or anything beyond the identity already disclosed
      // in the consent email itself.
      return json(res, { ok: true, childName: row.name, childEmail: row.email, status: row.parent_consent_status });
    }
    if (action === 'verify-parent-consent' && req.method === 'POST') {
      const b = readBody(req);
      const token = String(b.token || '');
      if (!token) return json(res, { ok: false, error: 'Missing consent token.' }, 400);
      const row = (await q(`select id, name, parent_email, parent_consent_status from users where parent_consent_token=$1`, [token])).rows[0];
      if (!row) return json(res, { ok: false, error: 'This consent link is invalid or has already been used.' }, 404);
      if (row.parent_consent_status !== 'pending') return json(res, { ok: false, error: 'This request has already been responded to.', status: row.parent_consent_status }, 409);
      const grant = b.decision !== 'deny';
      const newStatus = grant ? 'granted' : 'denied';
      await q(`update users set parent_consent_status=$1, parent_consent_responded_at=now() where id=$2`, [newStatus, row.id]);
      await writeAudit({ req, actor: { role: 'parent-guardian', sid: null, name: 'Parent/guardian of ' + row.name }, action: 'update', resourceType: 'users', resourceId: row.id, after: { parentConsentStatus: newStatus } });
      try {
        const { sendMail, branded } = require('../_lib/mailer');
        const child = (await q('select email from users where id=$1', [row.id])).rows[0];
        if (child) sendMail({ to: child.email, subject: 'Your parental consent status has been updated',
          html: branded({ heading: grant ? 'Consent granted' : 'Consent not granted',
            body: grant ? 'Your parent/guardian has confirmed consent. Your account now has full access.' : 'Your parent/guardian did not grant consent. Some features will remain unavailable until they do.' }) }).catch(() => {});
      } catch (e) {}
      return json(res, { ok: true, status: newStatus, childName: row.name });
    }

    if (action === 'login' && req.method === 'POST') {
      const b = readBody(req);
      const email = String(b.email || '').trim().toLowerCase();
      const password = String(b.password || '');
      if (!email || !password) return json(res, { ok: false, error: 'Email and password are required.' }, 400);
      const blocked = await guard(req, 'user:' + email, { idMax: 8, ipMax: 20, windowMin: 15 });
      if (blocked) {
        res.setHeader('Retry-After', String(blocked.retryAfter));
        return json(res, { ok: false, error: `Too many sign-in attempts. Try again in ${Math.ceil(blocked.retryAfter / 60)} minute(s).` }, 429);
      }
      const fail = async (msg, extra = {}) => {
        await record('id:user:' + email, { ok: false, identity: email, req });
        await record('ip:' + require('../_lib/ratelimit').clientIp(req), { ok: false, identity: email, req });
        return json(res, { ok: false, error: msg, ...extra }, 401);
      };
      const row = (await q('select * from users where email=$1', [email])).rows[0];
      if (!row || !verifyPassword(password, row.pass)) return fail('Incorrect email or password.');
      if (row.totp_enabled) {
        const code = String(b.totp || '').trim();
        if (!code) return json(res, { ok: false, needsTotp: true, error: 'Enter your 6-digit authenticator code.' });
        const validTotp = verifyTotp(row.totp_secret, code);
        let validBackup = false, newBackupCodes = null;
        if (!validTotp) {
          const remaining = consumeBackupCode(row.backup_codes || [], code);
          if (remaining) { validBackup = true; newBackupCodes = remaining; }
        }
        if (!validTotp && !validBackup) { await record('id:user:' + email, { ok: false, identity: email, req }); return json(res, { ok: false, needsTotp: true, error: 'Incorrect code. Please try again.' }, 401); }
        if (newBackupCodes) await q('update users set backup_codes=$1 where id=$2', [JSON.stringify(newBackupCodes), row.id]);
      }
      await record('id:user:' + email, { ok: true, identity: email, req });
      // isMinor is recomputed fresh from date_of_birth on every login, same
      // as the 'me' action — never trusted from a stale claim.
      const user = { id: row.id, name: row.name, email: row.email, isMinor: isMinor(row.date_of_birth) === true, parentConsentStatus: row.parent_consent_status || 'not_required' };
      return json(res, { ok: true, token: sign(user), user, accountType: row.account_type || 'customer', sellerStatus: row.seller_status });
    }

    if (action === 'logout' && req.method === 'POST') {
      // Server-side revocation, not just clearing the client's localStorage —
      // every session must be revocable (CLAUDE.md §1.3). Bumping the user's
      // watermark invalidates every token issued before this instant, on any
      // device — there is no per-device session tracking, so "log out" here
      // means "log out everywhere," which is the honest, simple, correct
      // behaviour a stateless-token design can actually deliver.
      const u = await authedUserChecked(req);
      if (u) await revokeSessions(u.id);
      return json(res, { ok: true });
    }

    if (action === 'me' && req.method === 'GET') {
      const u = await authedUserChecked(req);
      if (!u) return json(res, { ok: false }, 401);
      const row = (await q('select id,name,email,account_type,seller_status,date_of_birth,parent_consent_status from users where id=$1', [u.id])).rows[0];
      if (!row) return json(res, { ok: false }, 401);
      const prof = (await q('select handle from profiles where user_id=$1 limit 1', [u.id])).rows[0];
      // isMinor is computed FRESH from date_of_birth on every call, never
      // cached in the token (CLAUDE.md §1.4: roles/status read from the DB
      // on every request) — someone's age changes, silently trusting a
      // stale claim would eventually mis-protect a now-adult, or worse,
      // stop protecting someone who is still a minor.
      const minor = isMinor(row.date_of_birth);
      return json(res, { ok: true,
        user: { id: row.id, name: row.name, email: row.email, isMinor: !!minor, parentConsentStatus: row.parent_consent_status },
        accountType: row.account_type, sellerStatus: row.seller_status, handle: prof && prof.handle });
    }

    // ── 2FA (TOTP authenticator app) for customer accounts ──
    if (action === '2fa-setup' && req.method === 'POST') {
      const u = await authedUserChecked(req); if (!u) return json(res, { ok: false }, 401);
      const s = generateSecret();
      await q('update users set totp_secret=$1, totp_enabled=false where id=$2', [s, u.id]);
      return json(res, { ok: true, secret: s, otpauth: otpauthUri(s, { account: u.email }) });
    }
    if (action === '2fa-enable' && req.method === 'POST') {
      const u = await authedUserChecked(req); if (!u) return json(res, { ok: false }, 401);
      const b = readBody(req);
      const row = (await q('select totp_secret from users where id=$1', [u.id])).rows[0];
      if (!row || !row.totp_secret) return json(res, { ok: false, error: 'Start 2FA setup first.' }, 400);
      if (!verifyTotp(row.totp_secret, b.code)) return json(res, { ok: false, error: 'Incorrect code — check your authenticator app and try again.' }, 400);
      const { plain, hashed } = generateBackupCodes();
      await q('update users set totp_enabled=true, backup_codes=$1 where id=$2', [JSON.stringify(hashed), u.id]);
      await writeAudit({ req, actor: { role: 'customer', sid: u.id, name: u.name }, action: 'update', resourceType: 'users', resourceId: u.id, before: { twoFactor: false }, after: { twoFactor: true } });
      return json(res, { ok: true, backupCodes: plain });
    }
    if (action === '2fa-disable' && req.method === 'POST') {
      const u = await authedUserChecked(req); if (!u) return json(res, { ok: false }, 401);
      const b = readBody(req);
      const row = (await q('select pass from users where id=$1', [u.id])).rows[0];
      if (!row || !verifyPassword(String(b.password || ''), row.pass)) return json(res, { ok: false, error: 'Incorrect password.' }, 401);
      await q('update users set totp_enabled=false, totp_secret=null, backup_codes=$1 where id=$2', ['[]', u.id]);
      await writeAudit({ req, actor: { role: 'customer', sid: u.id, name: u.name }, action: 'update', resourceType: 'users', resourceId: u.id, before: { twoFactor: true }, after: { twoFactor: false } });
      return json(res, { ok: true });
    }

    // ── Forgot / reset password ──
    // Generates a one-time reset token (stored as its hash, 30 min expiry). Actually
    // emailing it requires an email provider (RESEND_API_KEY) — without one, this
    // still works end-to-end for the admin to hand the link to the user manually.
    if (action === 'forgot' && req.method === 'POST') {
      const b = readBody(req);
      const email = String(b.email || '').trim().toLowerCase();
      // Anyone can call this with any email — rate-limit per-IP so it can't be
      // used to flood mail sends or hammer the DB (THREAT_MODEL T5 pattern).
      const blocked = await guard(req, null, { ipMax: 10, windowMin: 15 });
      if (blocked) {
        res.setHeader('Retry-After', String(blocked.retryAfter));
        return json(res, { ok: false, error: `Too many attempts. Try again in ${Math.ceil(blocked.retryAfter / 60)} minute(s).` }, 429);
      }
      const row = (await q('select id from users where email=$1', [email])).rows[0];
      // Always return ok (don't leak whether an email is registered).
      if (row) {
        const raw = crypto.randomBytes(24).toString('base64url');
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        await q('update users set reset_hash=$1, reset_expires=$2 where id=$3', [hash, Date.now() + 30 * 60 * 1000, row.id]);
        const link = safeOrigin(b.origin) + '/reset-password.html?token=' + raw + '&email=' + encodeURIComponent(email);
        // In-house SMTP (Mail Settings). No third-party API.
        const { sendMail, branded } = require('../_lib/mailer');
        const sent = await sendMail({
          to: email, subject: 'Reset your Archery.Services password',
          html: branded({
            heading: 'Reset your password',
            preheader: 'Reset link inside — valid 30 minutes',
            body: 'We received a request to reset your password. Click the button below to choose a new one. This link expires in 30 minutes. If you didn’t request this, you can ignore this email.',
            cta: 'Reset password', ctaUrl: link,
          }),
        });
        if (sent.ok) return json(res, { ok: true, message: 'If that email is registered, a reset link has been sent. Check your inbox.' });
        // No mail server connected yet. Previously this returned the raw reset
        // link (and its live, valid, unexpired token) directly in the response
        // — to WHOEVER called this endpoint, not just the account owner, since
        // the endpoint requires no proof of inbox ownership. That is a full
        // account-takeover primitive from nothing but a known email address
        // (CLAUDE.md §1.2/§1.3). Fail honestly instead: nothing was sent, and
        // the token stays server-side only.
        console.error('users/forgot: mail server not configured — no reset link could be delivered for', email);
        return json(res, { ok: false, error: 'Password reset email could not be sent — mail delivery is not yet configured on this site. Please contact support@archery.services.' }, 503);
      }
      return json(res, { ok: true, message: 'If that email is registered, a reset link has been sent.' });
    }
    if (action === 'reset' && req.method === 'POST') {
      const b = readBody(req);
      const email = String(b.email || '').trim().toLowerCase();
      const token = String(b.token || '');
      const password = String(b.password || '');
      if (password.length < 8) return json(res, { ok: false, error: 'Password must be at least 8 characters.' }, 400);
      const row = (await q('select id, reset_hash, reset_expires from users where email=$1', [email])).rows[0];
      if (!row || !row.reset_hash || !row.reset_expires || row.reset_expires < Date.now())
        return json(res, { ok: false, error: 'This reset link is invalid or has expired.' }, 400);
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const a = Buffer.from(hash), c = Buffer.from(row.reset_hash);
      if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return json(res, { ok: false, error: 'This reset link is invalid or has expired.' }, 400);
      await q('update users set pass=$1, reset_hash=null, reset_expires=null where id=$2', [hashPassword(password), row.id]);
      // A password change must invalidate every previously-issued token —
      // otherwise a token stolen before the reset (e.g. via a compromised
      // inbox, or the exact devLink leak this endpoint used to have) keeps
      // working right through it, defeating the point of resetting.
      await revokeSessions(row.id);
      await writeAudit({ req, actor: { role: 'customer', sid: row.id }, action: 'update', resourceType: 'users', resourceId: row.id, after: { passwordChanged: true } });
      return json(res, { ok: true });
    }

    // ── Seller application ──
    if (action === 'apply-seller' && req.method === 'POST') {
      const u = await authedUserChecked(req); if (!u) return json(res, { ok: false }, 401);
      const b = readBody(req);
      if (!String(b.businessName || '').trim()) return json(res, { ok: false, error: 'Business name is required.' }, 400);
      await q(`update users set account_type='seller', seller_status='pending', business_name=$1, gst_number=$2, payout_upi=$3 where id=$4`,
        [String(b.businessName).trim(), b.gst || null, b.payoutUpi || null, u.id]);
      await writeAudit({ req, actor: { role: 'customer', sid: u.id, name: u.name }, action: 'update', resourceType: 'users', resourceId: u.id,
        after: { accountType: 'seller', sellerStatus: 'pending', businessName: String(b.businessName).trim() } });
      return json(res, { ok: true, message: 'Application received — you will be notified once approved.' });
    }

    return json(res, { ok: false, error: 'Not found' }, 404);
  } catch (e) {
    console.error('users:', e?.message);
    return json(res, { ok: false, error: 'Server error' }, 500);
  }
};
