// /api/checkout/create — authoritative order creation + Razorpay order.
// Re-prices the cart from current DB product prices (anti-tamper), inserts a
// pending order with the shipping address + geolocation, then opens a Razorpay order.
'use strict';
const crypto = require('crypto');
const { cors, json, readBody } = require('../_lib/respond');
const { computeQuote } = require('../_lib/pricing');
const { loadPricingConfig } = require('../_lib/settings');
const { q } = require('../_lib/db');

function orderNo() {
  return 'ARC-' + Date.now().toString(36).toUpperCase() + '-' +
    crypto.randomBytes(3).toString('hex').toUpperCase();
}

async function createRazorpayOrder(amountPaise, receipt) {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) return { ok: false, error: 'Razorpay keys not configured' };
  const auth = 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, payment_capture: 1 }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: data?.error?.description || 'Razorpay order failed' };
  return { ok: true, order: data };
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);
  try {
    const b = readBody(req);
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) return json(res, { ok: false, error: 'Your cart is empty.' }, 400);
    const cust = b.customer || {};
    if (!cust.name || !cust.phone) return json(res, { ok: false, error: 'Name and phone are required.' }, 400);
    if (!cust.address1 || !cust.pincode) return json(res, { ok: false, error: 'A delivery address and pincode are required.' }, 400);

    // Re-price from the DB so the client can't forge prices.
    const ids = items.map(i => parseInt(i.id)).filter(Boolean);
    let priced = [];
    if (ids.length) {
      const r = await q('select id, name, price from products where id = any($1) and active is not false', [ids]);
      const map = new Map(r.rows.map(row => [Number(row.id), row]));
      priced = items.map(i => {
        const p = map.get(parseInt(i.id));
        return p ? { id: Number(p.id), name: p.name, price: Number(p.price), qty: Math.max(1, parseInt(i.qty) || 1) } : null;
      }).filter(Boolean);
    }
    if (!priced.length) return json(res, { ok: false, error: 'Cart items are no longer available.' }, 400);

    const config = await loadPricingConfig();
    let delivery = b.delivery === 'sameday' ? 'sameday' : 'standard';
    if (delivery === 'sameday' && config.sameDayEnabled === false) delivery = 'standard';
    const quote = computeQuote(priced, { delivery, config });

    const no = orderNo();
    const geo = b.geo || {};
    const ins = await q(
      `insert into orders (order_no, customer_name, customer_email, customer_phone,
         address_line1, address_line2, city, state, pincode, country,
         geo_lat, geo_lng, geo_accuracy, delivery_type, items,
         goods, delivery_fee, tax, platform_fee, total, currency, payment_status, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'pending','new')
       returning id`,
      [no, cust.name, cust.email || null, cust.phone,
       cust.address1, cust.address2 || null, cust.city || null, cust.state || null, cust.pincode, cust.country || 'India',
       geo.lat ?? null, geo.lng ?? null, geo.accuracy ?? null, delivery,
       JSON.stringify(quote.items), quote.goods, quote.deliveryFee, quote.tax, quote.platformFee, quote.total, quote.currency]
    );
    const orderId = ins.rows[0].id;

    const rp = await createRazorpayOrder(quote.totalPaise, no);
    if (!rp.ok) return json(res, { ok: false, error: rp.error, orderId }, 502);
    await q('update orders set razorpay_order_id=$1, updated_at=now() where id=$2', [rp.order.id, orderId]);

    await q(`insert into analytics_events (type, value, order_id) values ('begin_checkout', $1, $2)`, [quote.total, orderId]).catch(() => {});

    return json(res, {
      ok: true, orderId, orderNo: no, quote,
      razorpay: {
        keyId: process.env.PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID,
        orderId: rp.order.id, amount: quote.totalPaise, currency: 'INR',
      },
    });
  } catch (e) {
    console.error('checkout/create error:', e?.message);
    return json(res, { ok: false, error: 'Could not start checkout.' }, 500);
  }
};
