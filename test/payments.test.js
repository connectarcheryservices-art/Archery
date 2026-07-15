// Payment tests — CLAUDE.md §1.10 ("tests before merge on money, auth, and
// scoring") and §1.6 ("money is never trusted from the client; webhooks are the
// source of truth").
//
// Drives the REAL webhook handler and the REAL markPaid(). Postgres and the
// Razorpay HTTP API are stubbed; the signature maths, the amount check, and the
// idempotency logic are the genuine article.
'use strict';
const crypto = require('crypto');
const { R, stubDb, check, section, report } = require('./helpers');

process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret-not-the-key-secret';
process.env.RAZORPAY_KEY_SECRET = 'key-secret-different-thing';
process.env.RAZORPAY_KEY_ID = 'rzp_test_fake';

// ── fake tables ────────────────────────────────────────────────────────────
const DB = { orders: [], webhook_events: [], products: [], analytics: [] };
const reset = () => {
  DB.orders = [{ id: 1, order_no: 'ARC-1', items: [{ id: 7, name: 'Bow', qty: 2, price: 500 }],
                 total: '1000.00', customer_name: 'A', customer_email: null,
                 payment_status: 'pending', razorpay_order_id: 'order_ABC' }];
  DB.webhook_events = [];
  DB.products = [{ id: 7, stock: 10 }];
  DB.analytics = [];
};
reset();

stubDb(async (sql, params = []) => {
  const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();

  if (s.startsWith('select id, order_no, items, total') && s.includes('razorpay_order_id = $1')) {
    return { rows: DB.orders.filter(o => o.razorpay_order_id === params[0]) };
  }
  if (s.startsWith('insert into webhook_events')) {
    if (DB.webhook_events.some(w => w.event_id === params[0])) {
      const e = new Error('duplicate key value violates unique constraint'); e.code = '23505'; throw e;
    }
    DB.webhook_events.push({ event_id: params[0], event: params[1], processed: false });
    return { rows: [] };
  }
  if (s.startsWith('update webhook_events set processed=true')) {
    const w = DB.webhook_events.find(w => w.event_id === params[0]); if (w) w.processed = true;
    return { rows: [] };
  }
  if (s.startsWith('update webhook_events set error')) {
    const w = DB.webhook_events.find(w => w.event_id === params[1]); if (w) w.error = params[0];
    return { rows: [] };
  }
  if (s.startsWith('delete from webhook_events')) {
    DB.webhook_events = DB.webhook_events.filter(w => !(w.event_id === params[0] && !w.processed));
    return { rows: [] };
  }
  if (s.startsWith("update orders set payment_status='paid'")) {
    const o = DB.orders.find(o => o.razorpay_order_id === params[3] && o.payment_status !== 'paid');
    if (!o) return { rows: [] };
    o.payment_status = 'paid'; o.razorpay_payment_id = params[0]; o.amount_paid = params[1];
    o.payment_source = params[2]; o.status = 'confirmed';
    return { rows: [o] };
  }
  if (s.startsWith("update orders set payment_status='failed', payment_source=$1")) {
    const o = DB.orders.find(o => o.id === params[3]);
    if (o) { o.payment_status = 'failed'; o.payment_notes = params[1]; }
    return { rows: [] };
  }
  if (s.startsWith("update orders set payment_status='failed', payment_source='webhook'")) {
    const o = DB.orders.find(o => o.razorpay_order_id === params[1] && o.payment_status === 'pending');
    if (o) { o.payment_status = 'failed'; o.payment_notes = params[0]; }
    return { rows: [] };
  }
  if (s.startsWith('update products set stock')) {
    const p = DB.products.find(p => p.id === params[1]);
    if (p) p.stock = Math.max(0, p.stock - params[0]);
    return { rows: [] };
  }
  if (s.startsWith('insert into analytics_events')) { DB.analytics.push({ value: params[0] }); return { rows: [] }; }
  return { rows: [] };
});

const wh = require(R('api/razorpay-webhook.js'));
const { verifyWebhookSignature, markPaid } = require(R('api/_lib/payments.js'));

// ── build a signed webhook request ─────────────────────────────────────────
function signed(body, { eventId = 'evt_1', secret = process.env.RAZORPAY_WEBHOOK_SECRET, tamper = false } = {}) {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  return new Request('https://archery.services/api/razorpay-webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': tamper ? sig.replace(/.$/, c => (c === 'a' ? 'b' : 'a')) : sig,
      'x-razorpay-event-id': eventId,
    },
    body: raw,
  });
}
const captured = (amount = 100000, orderId = 'order_ABC') => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_1', order_id: orderId, amount, status: 'captured' } } },
});

(async () => {
  // ─────────────────────────────────────────────────────────────────────────
  section('§1.2 — the webhook secret is not the key secret');
  {
    const raw = JSON.stringify(captured());
    const withKeySecret = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(raw).digest('hex');
    check(verifyWebhookSignature(raw, withKeySecret).ok === false,
      'a signature made with the API key secret is REJECTED — the webhook secret is a separate secret');
  }

  section('signature verification');
  reset();
  let r = await wh.fetch(signed(captured(), { tamper: true }));
  check(r.status === 400, 'a tampered signature is rejected with 400');
  check(DB.orders[0].payment_status === 'pending', 'a rejected webhook changes NOTHING in the database');
  check(DB.webhook_events.length === 0, 'a rejected webhook is not even recorded as an event');

  reset();
  r = await wh.fetch(new Request('https://x/api/razorpay-webhook', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(captured()) }));
  check(r.status === 400, 'a webhook with NO signature header is rejected');
  check(DB.orders[0].payment_status === 'pending', 'unsigned webhook changes nothing');

  section('the happy path');
  reset();
  r = await wh.fetch(signed(captured()));
  check(r.status === 200, 'a correctly signed payment.captured returns 200');
  check(DB.orders[0].payment_status === 'paid', 'the order is marked paid');
  check(DB.orders[0].status === 'confirmed', 'the order is confirmed');
  check(DB.orders[0].payment_source === 'webhook', 'recorded as settled by the webhook, not the browser');
  check(DB.products[0].stock === 8, `stock decremented once: 10 -> ${DB.products[0].stock}`);
  check(DB.analytics.length === 1, 'exactly one purchase event recorded');

  section('idempotency — Razorpay WILL deliver twice');
  r = await wh.fetch(signed(captured(), { eventId: 'evt_1' }));
  check(r.status === 200, 'a duplicate delivery still returns 200 (so Razorpay stops retrying)');
  check((await r.json()).duplicate === true, 'it is reported as a duplicate');
  check(DB.products[0].stock === 8, `stock NOT decremented twice (still ${DB.products[0].stock})`);
  check(DB.analytics.length === 1, 'purchase NOT double-counted');

  section('a different event id for the same order is still safe');
  r = await wh.fetch(signed(captured(), { eventId: 'evt_2' }));
  check(DB.products[0].stock === 8, 'stock still 8 — markPaid() guards on payment_status, not just the event id');
  check(DB.analytics.length === 1, 'still one purchase event');

  section('§1.6 — the amount is checked against OUR price, not the client claim');
  reset();
  r = await wh.fetch(signed(captured(1), { eventId: 'evt_underpay' }));   // ₹0.01 for a ₹1000 order
  check(DB.orders[0].payment_status !== 'paid', 'an order paid ₹0.01 against a ₹1000 total is NOT fulfilled');
  check(DB.orders[0].payment_status === 'failed', 'it is flagged failed for a human to look at');
  check(/mismatch/i.test(DB.orders[0].payment_notes || ''), `the mismatch is recorded: "${DB.orders[0].payment_notes}"`);
  check(DB.products[0].stock === 10, 'no stock was released for an underpayment');

  reset();
  await markPaid({ razorpayOrderId: 'order_ABC', paymentId: 'p', amountPaise: 100000, source: 'test' });
  check(DB.orders[0].payment_status === 'paid', 'the exact expected amount (100000 paise = ₹1000) IS accepted');

  section('unknown orders');
  reset();
  r = await wh.fetch(signed(captured(100000, 'order_DOES_NOT_EXIST'), { eventId: 'evt_unknown' }));
  check(r.status === 200, 'an event for an unknown order is acknowledged, not retried forever');
  check(DB.orders[0].payment_status === 'pending', 'and it does not touch any other order');

  section('payment.failed');
  reset();
  r = await wh.fetch(signed({ event: 'payment.failed',
    payload: { payment: { entity: { id: 'pay_x', order_id: 'order_ABC', error_description: 'card declined' } } } },
    { eventId: 'evt_fail' }));
  check(DB.orders[0].payment_status === 'failed', 'a failed payment marks the order failed');
  check(DB.orders[0].payment_notes === 'card declined', 'the reason is recorded');

  section('a late failure cannot un-pay a paid order');
  reset();
  await wh.fetch(signed(captured(), { eventId: 'evt_ok' }));
  check(DB.orders[0].payment_status === 'paid', 'order is paid');
  await wh.fetch(signed({ event: 'payment.failed',
    payload: { payment: { entity: { id: 'pay_old', order_id: 'order_ABC', error_description: 'earlier attempt' } } } },
    { eventId: 'evt_late_fail' }));
  check(DB.orders[0].payment_status === 'paid', 'a late payment.failed for an earlier attempt leaves it PAID');

  section('unhandled events are acked, not processed');
  reset();
  r = await wh.fetch(signed({ event: 'refund.created', payload: {} }, { eventId: 'evt_refund' }));
  check(r.status === 200 && (await r.json()).ignored === 'refund.created', 'unknown event acknowledged and ignored');
  check(DB.orders[0].payment_status === 'pending', 'and changes nothing');

  process.exit(report() === 0 ? 0 : 1);
})();
