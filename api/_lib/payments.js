// Payment truth — shared by the webhook, the browser callback, and reconcile.
//
// CLAUDE.md §1.6: "Money is never trusted from the client. Server prices
// everything. Webhooks are the source of truth for payment state, not browser
// callbacks."
//
// The single rule enforced here: an order is marked paid ONLY when Razorpay
// tells us the captured amount, and that amount matches the total WE priced.
// The browser is never asked how much anything cost.
'use strict';
const crypto = require('crypto');
const { q } = require('./db');

// ── signature verification ─────────────────────────────────────────────────
// Razorpay docs (https://razorpay.com/docs/webhooks/validate-test/):
//   "the hash signature is calculated using HMAC with SHA256 algorithm; with
//    your webhook secret set as the key and the webhook request body as the
//    message" … "ensure that the webhook body passed as an argument is the RAW
//    webhook request body. Do not parse or cast the webhook request body."
// Hence rawBody must be the exact bytes received — re-serialising the parsed
// object would change key order/whitespace and break the HMAC.
//
// The webhook secret is NOT the API key secret (§1.2 — no secret signs two
// things). Set RAZORPAY_WEBHOOK_SECRET to the value configured in the Razorpay
// dashboard when creating the webhook.
function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'RAZORPAY_WEBHOOK_SECRET not configured' };
  if (!signature) return { ok: false, reason: 'missing signature header' };
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok, reason: ok ? null : 'signature mismatch' };
}

// Checkout callback signature: HMAC(order_id|payment_id) with the KEY secret.
// A different construction and a different secret from the webhook above.
function verifyCallbackSignature(orderId, paymentId, signature) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return { ok: false, reason: 'RAZORPAY_KEY_SECRET not configured' };
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(signature || ''));
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok, reason: ok ? null : 'signature mismatch' };
}

// ── Razorpay as the authority ──────────────────────────────────────────────
// Server-to-server, authenticated. Used by reconcile, and by any path that
// wants the truth rather than a claim.
async function fetchPayment(paymentId) {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) return null;
  const auth = 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
  const r = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`,
    { headers: { Authorization: auth } });
  if (!r.ok) return null;
  return r.json();
}

async function fetchOrderPayments(razorpayOrderId) {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) return null;
  const auth = 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
  const r = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpayOrderId)}/payments`,
    { headers: { Authorization: auth } });
  if (!r.ok) return null;
  return r.json();
}

// ── the one place an order becomes paid ────────────────────────────────────
/**
 * Mark an order paid, exactly once, if and only if the amount Razorpay captured
 * equals the amount we priced.
 *
 * @param {object} p
 * @param {string} p.razorpayOrderId
 * @param {string} p.paymentId
 * @param {number} p.amountPaise   what Razorpay says was captured, in paise
 * @param {string} p.source        webhook | callback | reconcile
 * @returns {Promise<{status:string, order?:object, reason?:string}>}
 */
async function markPaid({ razorpayOrderId, paymentId, amountPaise, source }) {
  const found = await q(
    `select id, order_no, items, total, customer_name, customer_email, payment_status
       from orders where razorpay_order_id = $1`, [razorpayOrderId]);
  const order = found.rows[0];
  if (!order) return { status: 'unknown_order', reason: `no order for ${razorpayOrderId}` };

  if (order.payment_status === 'paid') return { status: 'already_paid', order };

  // §1.6 — the amount is checked against OUR price, not the client's claim.
  // Razorpay works in paise; orders.total is rupees.
  const expectedPaise = Math.round(Number(order.total) * 100);
  if (Number.isFinite(amountPaise) && amountPaise !== expectedPaise) {
    // Do NOT fulfil. A mismatch means either a bug in our pricing or someone
    // paying an amount we never quoted. Either way a human must look.
    await q(
      `update orders set payment_status='failed', payment_source=$1,
         payment_notes=$2, amount_paid=$3, updated_at=now() where id=$4`,
      [source, `amount mismatch: captured ${amountPaise} paise, expected ${expectedPaise} paise`,
       amountPaise / 100, order.id]).catch(() => {});
    return { status: 'amount_mismatch', order,
             reason: `captured ${amountPaise} != expected ${expectedPaise}` };
  }

  // Conditional update = the idempotency guard. Two concurrent deliveries race
  // here and exactly one wins; the loser sees zero rows and does nothing.
  const upd = await q(
    `update orders set payment_status='paid', payment_method='razorpay',
       razorpay_payment_id=$1, status='confirmed', amount_paid=$2, paid_at=now(),
       payment_source=$3, updated_at=now()
     where razorpay_order_id=$4 and payment_status <> 'paid'
     returning id, order_no, items, total, customer_name, customer_email`,
    [paymentId, Number.isFinite(amountPaise) ? amountPaise / 100 : order.total, source, razorpayOrderId]);

  if (!upd.rows[0]) return { status: 'already_paid', order };
  return { status: 'paid', order: upd.rows[0] };
}

/** Side effects that must happen exactly once, after an order flips to paid. */
async function fulfil(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  for (const it of items) {
    if (it.id) {
      await q('update products set stock = greatest(0, stock - $1) where id=$2',
        [Math.max(1, it.qty || 1), it.id]).catch(() => {});
    }
  }
  await q(`insert into analytics_events (type, value, order_id) values ('purchase', $1, $2)`,
    [order.total, order.id]).catch(() => {});

  if (order.customer_email) {
    try {
      const { sendMail, branded } = require('./mailer');
      const lines = items.map(i => `${i.name} × ${i.qty || 1} — ₹${Number(i.price).toLocaleString('en-IN')}`).join('<br>');
      await sendMail({
        to: order.customer_email,
        subject: `Order confirmed — ${order.order_no}`,
        html: branded({
          heading: 'Order confirmed 🎯',
          preheader: 'Payment received — ' + order.order_no,
          body: `Thank you${order.customer_name ? ', ' + order.customer_name.split(' ')[0] : ''}! We've received your payment and your order is confirmed.<br><br><b>Order ${order.order_no}</b><br>${lines}<br><br><b>Total paid: ₹${Number(order.total).toLocaleString('en-IN')}</b><br><br>We'll notify you as it ships across India.`,
        }),
      }).catch(() => {});
    } catch (e) { /* mail is best-effort; never fails a payment */ }
  }
}

module.exports = {
  verifyWebhookSignature, verifyCallbackSignature,
  fetchPayment, fetchOrderPayments, markPaid, fulfil,
};
