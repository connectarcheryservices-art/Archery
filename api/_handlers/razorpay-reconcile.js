// POST /api/razorpay/reconcile — find orders where the money moved but our
// database never noticed, and settle them against Razorpay's record.
//
// Why this exists (THREAT_MODEL T6): until now the ONLY thing that could mark an
// order paid was the customer's browser calling /api/razorpay/verify. Any
// customer who paid and then closed the tab left an order stuck at 'pending'
// with real money captured against it. Nobody was told, and there was no way to
// find them. This is the recovery path for that backlog, and the safety net for
// anything the webhook fails to deliver.
//
// Razorpay is the authority: for each candidate we ASK Razorpay what happened
// rather than infer. Owner/manager only, and it never invents a payment — an
// order with no captured payment at Razorpay is left exactly as it is.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin, can } = require('../_lib/auth');
const { fetchOrderPayments, markPaid, fulfil } = require('../_lib/payments');
const { q } = require('../_lib/db');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const actor = checkAdmin(req);
  if (!actor) return json(res, { error: 'Unauthorised' }, 401);
  if (!can(actor, 'orders')) return json(res, { error: 'Not permitted' }, 403);

  const b = req.method === 'POST' ? readBody(req) : {};
  const dryRun = req.method === 'GET' || b.dryRun === true;

  try {
    // Candidates: still pending, checkout reached Razorpay, older than 5 minutes
    // (younger ones may simply still be in flight — do not race the webhook).
    const cand = await q(
      `select id, order_no, total, razorpay_order_id, created_at
         from orders
        where payment_status = 'pending'
          and razorpay_order_id is not null
          and created_at < now() - interval '5 minutes'
        order by created_at asc
        limit 100`);

    const results = [];
    for (const o of cand.rows) {
      const pays = await fetchOrderPayments(o.razorpay_order_id).catch(() => null);
      if (!pays || !Array.isArray(pays.items)) {
        results.push({ orderNo: o.order_no, action: 'razorpay_unreachable' });
        continue;
      }
      const captured = pays.items.find(p => p.status === 'captured');
      if (!captured) {
        // No money moved. Leave it alone — do NOT invent a payment, and do not
        // mark it failed either: the customer may still be mid-payment.
        results.push({ orderNo: o.order_no, action: 'no_payment', attempts: pays.items.length });
        continue;
      }

      if (dryRun) {
        results.push({ orderNo: o.order_no, action: 'would_mark_paid',
                       paymentId: captured.id, amount: captured.amount / 100 });
        continue;
      }

      const r = await markPaid({
        razorpayOrderId: o.razorpay_order_id,
        paymentId: captured.id,
        amountPaise: Number(captured.amount),
        source: 'reconcile',
      });
      if (r.status === 'paid') {
        await fulfil(r.order);
        results.push({ orderNo: o.order_no, action: 'marked_paid', amount: captured.amount / 100 });
      } else {
        results.push({ orderNo: o.order_no, action: r.status, reason: r.reason });
      }
    }

    return json(res, {
      ok: true,
      dryRun,
      scanned: cand.rows.length,
      recovered: results.filter(r => r.action === 'marked_paid').length,
      wouldRecover: results.filter(r => r.action === 'would_mark_paid').length,
      results,
    });
  } catch (e) {
    console.error('razorpay/reconcile:', e?.message);
    return json(res, { ok: false, error: 'Reconcile failed' }, 500);
  }
};
