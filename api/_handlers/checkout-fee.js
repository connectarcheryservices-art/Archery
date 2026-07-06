// /api/checkout/fee — paid federation/brand registration by level.
// Creates the application (admin inbox) + a 'registration' order priced from
// the SERVER fee schedule, then opens a Razorpay order for that amount.
// On successful /api/razorpay/verify the order flips to paid and the admin
// approves the application to activate access at that level.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { FEES } = require('../_lib/fees');
const { q } = require('../_lib/db');

function orderNo() {
  return 'ARC-FED-' + Date.now().toString(36).toUpperCase() + '-' +
    Math.floor(Math.random() * 1e4).toString(36).toUpperCase();
}

async function createRazorpayOrder(amountPaise, receipt) {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) return { ok: false, notConfigured: true };
  const auth = 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, payment_capture: 1 }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: data?.error?.description || 'Payment gateway error' };
  return { ok: true, order: data };
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, { ok: false, error: 'Method not allowed' }, 405);
  try {
    const b = readBody(req);
    const tier = FEES[String(b.level || '').toLowerCase()];
    if (!tier) return json(res, { ok: false, error: 'Please choose a registration level.' }, 400);
    if (!String(b.orgName || '').trim()) return json(res, { ok: false, error: 'Organisation name is required.' }, 400);
    if (!String(b.email || '').trim()) return json(res, { ok: false, error: 'An official email is required.' }, 400);

    const level = String(b.level).toLowerCase();
    const no = orderNo();

    // 1. Application into the admin inbox (org_type carries the level label).
    const app = await q(
      `insert into applications (org_name, org_type, contact_name, email, phone, status, created_at)
       values ($1,$2,$3,$4,$5,'awaiting-payment',$6) returning id`,
      [String(b.orgName).trim(), tier.label, b.contactName || null, String(b.email).trim(), b.phone || null, Date.now()]
    );
    const applicationId = app.rows[0].id;

    // 2. Registration order priced from the server-side schedule.
    const item = { name: `${tier.label} — annual registration (${String(b.orgName).trim()})`, price: tier.fee, qty: 1, applicationId, level };
    const ins = await q(
      `insert into orders (order_no, customer_name, customer_email, customer_phone,
         address_line1, pincode, country, delivery_type, items,
         goods, delivery_fee, tax, platform_fee, total, currency, payment_status, status)
       values ($1,$2,$3,$4,$5,$6,'India','registration',$7,$8,0,0,0,$8,'INR','pending','new')
       returning id`,
      [no, b.contactName || String(b.orgName).trim(), String(b.email).trim(), b.phone || null,
       String(b.orgName).trim(), '000000', JSON.stringify([item]), tier.fee]
    );
    const orderId = ins.rows[0].id;

    // 3. Razorpay order for the exact fee.
    const rp = await createRazorpayOrder(tier.fee * 100, no);
    if (rp.notConfigured) {
      // Payments not yet enabled: keep the application, mark payment offline.
      await q("update orders set payment_method='offline' where id=$1", [orderId]).catch(() => {});
      return json(res, { ok: true, offline: true, applicationId, orderNo: no, fee: tier.fee, level, label: tier.label,
        message: 'Application received. A secure payment link for the registration fee will be sent to your official email.' });
    }
    if (!rp.ok) return json(res, { ok: false, error: rp.error, applicationId }, 502);
    await q('update orders set razorpay_order_id=$1, updated_at=now() where id=$2', [rp.order.id, orderId]);
    await q(`insert into analytics_events (type, value, order_id) values ('begin_registration', $1, $2)`, [tier.fee, orderId]).catch(() => {});

    return json(res, {
      ok: true, applicationId, orderId, orderNo: no, fee: tier.fee, level, label: tier.label,
      razorpay: {
        keyId: process.env.PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID,
        orderId: rp.order.id, amount: tier.fee * 100, currency: 'INR',
      },
    });
  } catch (e) {
    console.error('checkout/fee error:', e?.message);
    return json(res, { ok: false, error: 'Registration is temporarily unavailable — please try again shortly or email federation support.' }, 500);
  }
};
