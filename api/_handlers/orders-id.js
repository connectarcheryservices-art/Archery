// /api/orders/<id> — admin: get one / update status / delete.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin, can } = require('../_lib/auth');
const { q } = require('../_lib/db');
const { rowToObj } = require('../_lib/crud');
const { writeAudit } = require('../_lib/audit');

const STATUSES = ['new', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const actor = await checkAdmin(req);
  if (!actor) return json(res, { error: 'Unauthorised' }, 401);
  if (!can(actor, 'orders')) return json(res, { error: 'Your role does not have access to orders.' }, 403);
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
      const before = (await q('select status from orders where id=$1', [id])).rows[0];
      if (!before) return json(res, { error: 'Not found' }, 404);
      await q('update orders set status=$1, updated_at=now() where id=$2', [status, id]);
      await writeAudit({ req, actor, action: 'status_change', resourceType: 'orders', resourceId: id,
        before: { status: before.status }, after: { status } });
      return json(res, { ok: true });
    }
    if (req.method === 'DELETE') {
      const row = (await q('select order_no, payment_status, razorpay_payment_id, total, currency from orders where id=$1', [id])).rows[0];
      if (!row) return json(res, { error: 'Not found' }, 404);
      // A paid order is the sole record of a captured payment (payment facts
      // live only as columns on this row — migration 008). Deleting it would
      // destroy that record with no way to reconcile it against Razorpay
      // later. Cancel via the status endpoint instead; a hard delete here is
      // only ever safe for an order that was never actually paid.
      if (row.payment_status === 'paid' || row.razorpay_payment_id) {
        return json(res, { error: `Order ${row.order_no} has a captured payment (${row.currency} ${row.total}) — it cannot be deleted, only cancelled via status.` }, 409);
      }
      await q('delete from orders where id=$1', [id]);
      await writeAudit({ req, actor, action: 'delete', resourceType: 'orders', resourceId: id,
        before: { orderNo: row.order_no, paymentStatus: row.payment_status, total: row.total, currency: row.currency } });
      return json(res, { ok: true });
    }
    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('order op:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
