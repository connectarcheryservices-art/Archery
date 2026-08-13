// /api/returns — return/refund request tracking (refund-policy.html's
// promised process, now with a real system behind it instead of email-only).
//   POST {orderNo, reason, details}      file a return request
//   GET  ?orderNo=N                      check status of that order's request(s)
//   GET  (admin)                         list all requests
//   PUT  /:id (admin)                    { status, refundAmount?, notes? }
//
// Access for the non-admin paths mirrors order-invoice.js exactly: orders
// are guest-checkout, so order_no (high-entropy, already trusted as a
// bearer credential for the invoice link) is the real credential here too
// — not a new trust model. Same anti-enumeration posture: a caller who
// doesn't hold the real order_no gets the same 403 whether the order
// exists or not.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin, can } = require('../_lib/auth');
const { q } = require('../_lib/db');
const { writeAudit } = require('../_lib/audit');

const rowToObj = row => { const o = {}; for (const [k, v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v; return o; };

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const id = req.query.id;

  try {
    if (req.method === 'POST') {
      const b = readBody(req);
      const orderNo = String(b.orderNo || '').trim();
      const reason = String(b.reason || '').trim().slice(0, 200);
      const details = b.details ? String(b.details).trim().slice(0, 2000) : null;
      if (!orderNo) return json(res, { error: 'An order number is required.' }, 400);
      if (!reason) return json(res, { error: 'A reason is required.' }, 400);

      const order = (await q('select id, payment_status, total from orders where order_no=$1', [orderNo])).rows[0];
      if (!order || order.payment_status !== 'paid') return json(res, { error: 'Unauthorised' }, 403);

      const r = await q(
        `insert into return_requests (order_id, reason, details) values ($1,$2,$3) returning id, requested_at`,
        [order.id, reason, details]);
      await writeAudit({ req, actor: { role: 'customer', sid: orderNo, name: 'Customer (order ' + orderNo + ')' }, action: 'create',
        resourceType: 'return_requests', resourceId: r.rows[0].id, after: { orderNo, reason } });
      return json(res, { ok: true, id: r.rows[0].id, requestedAt: r.rows[0].requested_at });
    }

    if (req.method === 'GET' && req.query.orderNo) {
      const orderNo = String(req.query.orderNo).trim();
      const order = (await q('select id from orders where order_no=$1', [orderNo])).rows[0];
      if (!order) return json(res, { error: 'Unauthorised' }, 403);
      const rows = (await q('select * from return_requests where order_id=$1 order by requested_at desc', [order.id])).rows;
      return json(res, rows.map(rowToObj));
    }

    const actor = await checkAdmin(req);
    if (!actor) return json(res, { error: 'Unauthorised' }, 401);
    if (!can(actor, 'orders')) return json(res, { error: 'Forbidden' }, 403);

    if (req.method === 'GET') {
      const rows = (await q(
        `select rr.*, o.order_no, o.customer_name, o.customer_email, o.total as order_total
           from return_requests rr join orders o on o.id = rr.order_id
          order by rr.requested_at desc`)).rows;
      return json(res, rows.map(rowToObj));
    }

    if (id && req.method === 'PUT') {
      const b = readBody(req);
      const status = ['approved', 'rejected', 'received', 'refunded'].includes(b.status) ? b.status : null;
      if (!status) return json(res, { error: 'status must be approved, rejected, received, or refunded.' }, 400);
      const existing = (await q('select * from return_requests where id=$1', [parseInt(id, 10)])).rows[0];
      if (!existing) return json(res, { error: 'Not found' }, 404);

      const sets = ['status=$1', 'decided_at=now()'], vals = [status];
      sets.push(`decided_by=$${vals.push(actor.name || actor.role)}`);
      if (b.refundAmount !== undefined) { const n = Number(b.refundAmount); if (Number.isFinite(n) && n >= 0) sets.push(`refund_amount=$${vals.push(n)}`); }
      if (b.notes !== undefined) { sets.push(`notes=$${vals.push(String(b.notes).slice(0, 2000))}`); }
      vals.push(parseInt(id, 10));
      await q(`update return_requests set ${sets.join(',')} where id=$${vals.length}`, vals);
      await writeAudit({ req, actor, action: 'update', resourceType: 'return_requests', resourceId: parseInt(id, 10),
        before: { status: existing.status }, after: { status } });
      return json(res, { ok: true });
    }

    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('returns:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
