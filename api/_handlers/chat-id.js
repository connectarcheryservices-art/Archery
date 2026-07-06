// /api/chat/<id> — read a thread (public, for the visitor widget) / mark read / delete (admin).
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
      const r = await q('select * from chats where id=$1', [id]);
      return r.rows[0] ? json(res, rowToObj(r.rows[0])) : json(res, { error: 'Not found' }, 404);
    }
    if (!checkAdmin(req)) return json(res, { error: 'Unauthorised' }, 401);
    if (req.method === 'PUT') { await q('update chats set unread=false where id=$1', [id]); return json(res, { ok: true }); }
    if (req.method === 'DELETE') { await q('delete from chats where id=$1', [id]); return json(res, { ok: true }); }
    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) { console.error('chat/[id]:', e?.message); return json(res, { error: 'Server error' }, 500); }
};
