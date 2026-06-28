// /api/posts/<id> — read one (public) / pin+hide (admin) / delete (admin).
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { q } = require('../_lib/db');

const rowToObj = row => { const o = {}; for (const [k,v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_,c) => c.toUpperCase())] = v; return o; };

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const id = parseInt(req.query.id, 10);
  if (!Number.isFinite(id)) return json(res, { error: 'Bad id' }, 400);
  try {
    if (req.method === 'GET') {
      const r = await q('select * from posts where id=$1', [id]);
      return r.rows[0] ? json(res, rowToObj(r.rows[0])) : json(res, { error: 'Not found' }, 404);
    }
    if (!checkAdmin(req)) return json(res, { error: 'Unauthorised' }, 401);
    if (req.method === 'PUT') {
      const b = readBody(req);
      const sets = [], vals = [];
      if (b.pinned !== undefined) { vals.push(!!b.pinned); sets.push(`pinned=$${vals.length}`); }
      if (b.active !== undefined) { vals.push(!!b.active); sets.push(`active=$${vals.length}`); }
      if (sets.length) { vals.push(id); await q(`update posts set ${sets.join(',')} where id=$${vals.length}`, vals); }
      return json(res, { ok: true });
    }
    if (req.method === 'DELETE') { await q('delete from posts where id=$1', [id]); return json(res, { ok: true }); }
    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) { console.error('posts/[id]:', e?.message); return json(res, { error: 'Server error' }, 500); }
};
