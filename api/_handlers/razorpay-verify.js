// /api/razorpay/verify — the browser's post-checkout callback.
//
// This is NO LONGER the source of truth for payment state (§1.6, THREAT_MODEL
// T6). /api/razorpay-webhook is. This endpoint exists so the customer sees
// "confirmed" immediately instead of waiting on webhook delivery; if it never
// runs — tab closed, network dropped, redirect failed — the webhook still marks
// the order paid, and reconcile catches anything the webhook missed. Payment
// state no longer depends on the customer's browser completing a round trip.
//
// It is safe for this to run as well as the webhook: both funnel into
// markPaid(), whose conditional UPDATE lets exactly one of them win.
//
// Fixed here (T6):
//   * A bad signature used to write `payment_status='failed'` to the order named
//     in the request. That is an UNAUTHENTICATED state mutation: anyone who
//     learned a razorpay_order_id could POST garbage and mark that order failed.
//     A bad signature now means "this caller proved nothing" and writes nothing.
//   * The captured amount is confirmed with Razorpay and checked against the
//     price WE set, in markPaid() — never taken from the browser.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { verifyCallbackSignature, fetchPayment, markPaid, fulfil } = require('../_lib/payments');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, { ok: false }, 405);
  try {
    const b = readBody(req);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = b;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return json(res, { ok: false, error: 'Missing payment fields' }, 400);

    const sig = verifyCallbackSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!sig.ok) {
      // Write nothing. An unsigned caller cannot change an order's state.
      console.error('razorpay/verify: bad signature for', razorpay_order_id);
      return json(res, { ok: false, error: 'Payment verification failed' }, 400);
    }

    // The signature proves this order/payment pair came from Razorpay, but not
    // how much was actually captured. Ask Razorpay directly rather than trust a
    // number from the browser (§1.6). If that call fails we do not guess — the
    // webhook is authoritative and will settle it.
    const payment = await fetchPayment(razorpay_payment_id).catch(() => null);
    if (!payment) {
      return json(res, { ok: true, pending: true,
        message: 'Payment received — confirming. Your order will update shortly.' });
    }
    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      return json(res, { ok: false, error: 'Payment not captured' }, 400);
    }

    const r = await markPaid({
      razorpayOrderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      amountPaise: Number(payment.amount),
      source: 'callback',
    });

    if (r.status === 'paid') { await fulfil(r.order); return json(res, { ok: true, orderNo: r.order.order_no }); }
    if (r.status === 'already_paid') return json(res, { ok: true, orderNo: r.order?.order_no });
    if (r.status === 'amount_mismatch') {
      console.error('razorpay/verify amount mismatch:', r.reason);
      return json(res, { ok: false, error: 'Payment amount mismatch — our team has been alerted.' }, 400);
    }
    return json(res, { ok: false, error: 'Order not found' }, 404);
  } catch (e) {
    console.error('razorpay/verify error:', e?.message);
    return json(res, { ok: false, error: 'Verification error' }, 500);
  }
};
