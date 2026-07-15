// /api/<resource>  — list (GET) + create (POST) for content tables,
// plus the single-row settings/stats config.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { TABLES, listOrCreate } = require('../_lib/crud');
const { INBOX, inboxList, inboxCreate } = require('../_lib/inbox');
const { checkAdmin } = require('../_lib/auth');
const { q } = require('../_lib/db');
const { SETTINGS: SEED_SETTINGS } = require('../_lib/seed');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const resource = req.query.resource;

  try {
    // Public submissions (registrations / welfare reports / federation applications)
    if (INBOX[resource]) {
      if (req.method === 'GET')  return await inboxList(resource, req, res);
      if (req.method === 'POST') return await inboxCreate(resource, req, res);
      return json(res, { error: 'Method not allowed' }, 405);
    }

    // /api/stats — PUBLIC counts. Every number here is a COUNT(*) over a real
    // table. Nothing is seeded, defaulted or invented (CLAUDE.md §1.1).
    // A figure with no table behind it (e.g. "active clubs", "countries") is not
    // returned at all — the page must render nothing rather than a guess.
    // If the DB is unreachable we return {} and the page shows nothing. We do
    // NOT fall back to fiction.
    if (resource === 'stats') {
      if (req.method !== 'GET') {
        if (!checkAdmin(req)) return json(res, { error: 'Unauthorised' }, 401);
        return json(res, { error: 'stats are computed from live data and cannot be set' }, 400);
      }
      try {
        const r = await q(`select
          (select count(*)::int from athletes    where active is not false) athletes,
          (select count(*)::int from tournaments where active is not false) tournaments,
          (select count(*)::int from products    where active is not false) products,
          (select count(*)::int from users)                                 members,
          (select count(*)::int from profiles    where active is not false) profiles`);
        return json(res, r.rows[0]);
      } catch (e) {
        console.error('stats:', e?.message);
        return json(res, {});
      }
    }

    if (resource === 'settings') {
      const SEED = SEED_SETTINGS;
      if (req.method === 'GET') {
        try {
          const r = await q(`select data from ${resource} where id=1`);
          const data = r.rows[0] && r.rows[0].data;
          // Settings are configuration (tax rate, delivery fee), not facts about
          // the world — defaulting them is legitimate and must stay in sync with
          // api/_lib/pricing.js DEFAULTS.
          return json(res, { ...SEED, ...(data || {}) });
        } catch (e) {
          return json(res, SEED);
        }
      }
      if (!checkAdmin(req)) return json(res, { error: 'Unauthorised' }, 401);
      const cur = (await q(`select data from ${resource} where id=1`)).rows[0]?.data || {};
      const merged = { ...cur, ...readBody(req) };
      await q(`insert into ${resource} (id,data) values (1,$1) on conflict (id) do update set data=$1`, [JSON.stringify(merged)]);
      return json(res, { ok: true, [resource]: merged });
    }

    if (TABLES[resource]) return await listOrCreate(resource, req, res);
    return json(res, { error: 'Unknown resource' }, 404);
  } catch (e) {
    console.error('api/[resource] error:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
