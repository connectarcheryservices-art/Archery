// /api/orders — admin: list all orders (newest first).
'use strict';
const { cors, json } = require('./_lib/respond');
const { checkAdmin } = require('./_lib/auth');
const { q } = require('./_lib/db');
const { rowToObj } = require('./_lib/crud');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkAdmin(req)) return json(res, { error: 'Unauthorised' }, 401);
  if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);
  try {
    const r = await q('select * from orders order by id desc limit 500');
    return json(res, r.rows.map(rowToObj));
  } catch (e) {
    console.error('orders list:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
