// /api/razorpay/verify — verify the payment signature, then finalise the order:
// mark paid + confirmed, decrement stock, log the purchase. Verification is the
// security gate (HMAC of order_id|payment_id with the key secret).
'use strict';
const crypto = require('crypto');
const { cors, json, readBody } = require('../_lib/respond');
const { q } = require('../_lib/db');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, { ok: false }, 405);
  try {
    const b = readBody(req);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = b;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return json(res, { ok: false, error: 'Missing payment fields' }, 400);
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) return json(res, { ok: false, error: 'Razorpay not configured' }, 500);

    const expected = crypto.createHmac('sha256', secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    const a = Buffer.from(expected), s = Buffer.from(String(razorpay_signature));
    const valid = a.length === s.length && crypto.timingSafeEqual(a, s);

    if (!valid) {
      await q("update orders set payment_status='failed', updated_at=now() where razorpay_order_id=$1", [razorpay_order_id]).catch(() => {});
      return json(res, { ok: false, error: 'Payment verification failed' }, 400);
    }

    // Finalise once (payment_status guard makes re-calls no-ops).
    const upd = await q(
      `update orders set payment_status='paid', payment_method='razorpay',
         razorpay_payment_id=$1, status='confirmed', updated_at=now()
       where razorpay_order_id=$2 and payment_status <> 'paid'
       returning id, order_no, items, total, customer_name, customer_email`,
      [razorpay_payment_id, razorpay_order_id]
    );

    if (upd.rows[0]) {
      const o = upd.rows[0];
      const items = Array.isArray(o.items) ? o.items : [];
      for (const it of items) {
        if (it.id) await q('update products set stock = greatest(0, stock - $1) where id=$2', [Math.max(1, it.qty || 1), it.id]).catch(() => {});
      }
      await q(`insert into analytics_events (type, value, order_id) values ('purchase', $1, $2)`, [o.total, o.id]).catch(() => {});
      // Order confirmation email (best-effort — silent if no mail server connected).
      if (o.customer_email) {
        try {
          const { sendMail, branded } = require('../_lib/mailer');
          const lines = items.map(i => `${i.name} × ${i.qty || 1} — ₹${Number(i.price).toLocaleString('en-IN')}`).join('<br>');
          sendMail({ to: o.customer_email, subject: `Order confirmed — ${o.order_no}`,
            html: branded({ heading: 'Order confirmed 🎯', preheader: 'Payment received — ' + o.order_no,
              body: `Thank you${o.customer_name ? ', ' + o.customer_name.split(' ')[0] : ''}! We've received your payment and your order is confirmed.<br><br><b>Order ${o.order_no}</b><br>${lines}<br><br><b>Total paid: ₹${Number(o.total).toLocaleString('en-IN')}</b><br><br>We'll notify you as it ships across India.` }) }).catch(() => {});
        } catch (e) {}
      }
      return json(res, { ok: true, orderNo: o.order_no });
    }
    return json(res, { ok: true }); // already finalised
  } catch (e) {
    console.error('razorpay/verify error:', e?.message);
    return json(res, { ok: false, error: 'Verification error' }, 500);
  }
};
