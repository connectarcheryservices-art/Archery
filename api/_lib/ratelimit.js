// DB-backed rate limiting (THREAT_MODEL T5).
//
// Serverless instances share no memory, so an in-process counter is useless: an
// attacker simply gets a fresh instance. Postgres is the only shared state we
// have, so the counter lives there (login_attempts, migration 007).
//
// Design notes:
//   • Two independent buckets: per-IP and per-identity. Per-IP alone lets an
//     attacker with a botnet spread guesses; per-identity alone lets one IP
//     spray many usernames. Both must pass.
//   • Only FAILURES count toward the limit; a successful login resets nothing but
//     also doesn't accumulate.
//   • Fail CLOSED on a limiter error for auth endpoints: if we cannot count, we
//     do not allow unlimited guessing.
'use strict';
const crypto = require('crypto');
const { q } = require('./db');

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/**
 * Check whether `key` has exceeded `max` failures in the last `windowMin` minutes.
 * @returns {Promise<{limited:boolean, retryAfter:number, fails:number}>}
 */
async function check(key, { max = 8, windowMin = 15 } = {}) {
  const r = await q(
    `select count(*)::int n, max(created_at) last
       from login_attempts
      where key = $1 and ok = false and created_at > now() - ($2 || ' minutes')::interval`,
    [key, String(windowMin)]
  );
  const n = r.rows[0].n;
  if (n < max) return { limited: false, retryAfter: 0, fails: n };
  const last = r.rows[0].last ? new Date(r.rows[0].last).getTime() : Date.now();
  const retryAfter = Math.max(1, Math.ceil((last + windowMin * 60000 - Date.now()) / 1000));
  return { limited: true, retryAfter, fails: n };
}

/** Record an attempt. Never throws — logging must not break login. */
async function record(key, { ok = false, identity = null, req = null } = {}) {
  try {
    await q(
      `insert into login_attempts (key, identity, ok, ip, ua) values ($1,$2,$3,$4,$5)`,
      [key, identity, !!ok, req ? clientIp(req) : null,
       req ? String(req.headers['user-agent'] || '').slice(0, 200) : null]
    );
    // Opportunistic cleanup so the table can't grow forever (~1 in 50 writes).
    if (crypto.randomInt(50) === 0) {
      await q(`delete from login_attempts where created_at < now() - interval '30 days'`).catch(() => {});
    }
  } catch (e) { console.error('ratelimit.record:', e?.message); }
}

/**
 * Guard an auth endpoint. Checks per-IP and per-identity buckets.
 * Returns null when allowed, or {limited, retryAfter} when blocked.
 */
async function guard(req, identity, opts = {}) {
  const ip = clientIp(req);
  try {
    const [byIp, byId] = await Promise.all([
      check('ip:' + ip, { max: opts.ipMax ?? 20, windowMin: opts.windowMin ?? 15 }),
      identity ? check('id:' + identity, { max: opts.idMax ?? 8, windowMin: opts.windowMin ?? 15 })
               : Promise.resolve({ limited: false, retryAfter: 0 }),
    ]);
    if (byIp.limited) return byIp;
    if (byId.limited) return byId;
    return null;
  } catch (e) {
    // Fail closed: unable to count => refuse rather than allow unlimited guesses.
    console.error('ratelimit.guard:', e?.message);
    return { limited: true, retryAfter: 60, error: true };
  }
}

module.exports = { guard, record, check, clientIp };
