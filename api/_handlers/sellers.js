// /api/sellers  and  /api/sellers/<id> — admin manages seller applications/accounts.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { q } = require('../_lib/db');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const actor = checkAdmin(req);
  if (!actor) return json(res, { error: 'Unauthorised' }, 401);
  const id = req.query.id;
  try {
    if (req.method === 'GET') {
      const rows = (await q(`select id, name, email, business_name, gst_number, payout_upi, seller_status, created_at
                             from users where seller_status is not null order by
                             case when seller_status='pending' then 0 else 1 end, id desc`)).rows;
      return json(res, rows.map(r => ({ id: r.id, name: r.name, email: r.email, businessName: r.business_name, gst: r.gst_number, payoutUpi: r.payout_upi, status: r.seller_status, createdAt: r.created_at })));
    }
    if (id && req.method === 'PUT') {
      const b = readBody(req);
      const status = ['approved', 'rejected', 'pending'].includes(b.status) ? b.status : null;
      if (!status) return json(res, { error: 'Invalid status.' }, 400);
      await q('update users set seller_status=$1 where id=$2', [status, parseInt(id)]);
      return json(res, { ok: true });
    }
    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('sellers:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
