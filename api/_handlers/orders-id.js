// /api/orders/<id> — admin: get one / update status / delete.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { q } = require('../_lib/db');
const { rowToObj } = require('../_lib/crud');

const STATUSES = ['new', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkAdmin(req)) return json(res, { error: 'Unauthorised' }, 401);
  const id = parseInt(req.query.id, 10);
  if (!Number.isFinite(id)) return json(res, { error: 'Bad id' }, 400);
  try {
    if (req.method === 'GET') {
      const r = await q('select * from orders where id=$1', [id]);
      return r.rows[0] ? json(res, rowToObj(r.rows[0])) : json(res, { error: 'Not found' }, 404);
    }
    if (req.method === 'PUT') {
      const b = readBody(req);
      const status = String(b.status || '').toLowerCase();
      if (!STATUSES.includes(status)) return json(res, { error: 'Invalid status' }, 400);
      await q('update orders set status=$1, updated_at=now() where id=$2', [status, id]);
      return json(res, { ok: true });
    }
    if (req.method === 'DELETE') {
      await q('delete from orders where id=$1', [id]);
      return json(res, { ok: true });
    }
    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('order op:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
