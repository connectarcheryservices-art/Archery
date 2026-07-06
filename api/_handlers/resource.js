// /api/<resource>  — list (GET) + create (POST) for content tables,
// plus the single-row settings/stats config.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { TABLES, listOrCreate } = require('../_lib/crud');
const { INBOX, inboxList, inboxCreate } = require('../_lib/inbox');
const { checkAdmin } = require('../_lib/auth');
const { q } = require('../_lib/db');
const { SETTINGS: SEED_SETTINGS, STATS: SEED_STATS } = require('../_lib/seed');

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

    if (resource === 'settings' || resource === 'stats') {
      const SEED = resource === 'settings' ? SEED_SETTINGS : SEED_STATS;
      if (req.method === 'GET') {
        try {
          const r = await q(`select data from ${resource} where id=1`);
          const data = r.rows[0] && r.rows[0].data;
          // Merge seed under stored data so the homepage stat band + pricing
          // config always have sensible values even before an admin edits them.
          return json(res, { ...SEED, ...(data || {}) });
        } catch (e) {
          return json(res, SEED);   // DB not connected yet
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
