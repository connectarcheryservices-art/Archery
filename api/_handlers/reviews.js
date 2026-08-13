// /api/reviews — product reviews, gated to VERIFIED PURCHASES only.
//   GET  ?productId=N              public — real reviews + aggregate rating
//   GET  ?productId=N&eligibility=1&<auth>  is the logged-in caller allowed to review this?
//   POST {productId, rating, title?, body?}  requires login + a real paid order
//
// "Verified purchase" is computed here, at write time, from a real DB
// query — never trusted from the client, never inferred from a client-sent
// order number alone (that would let anyone claim any order).
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { q } = require('../_lib/db');
const { authedUserChecked } = require('../_lib/userauth');

const rowToObj = row => { const o = {}; for (const [k, v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v; return o; };

// The real order that qualifies this user to review this product: a PAID
// order whose customer_email matches their account email (case-insensitive
// — orders are guest-checkout, no user_id link) and whose items JSONB
// actually contains this product.
async function findVerifyingOrder(email, productId) {
  const r = await q(
    `select id from orders
      where lower(customer_email) = lower($1) and payment_status = 'paid'
        and exists (select 1 from jsonb_array_elements(items) elem where (elem->>'id')::bigint = $2)
      order by id desc limit 1`,
    [email, productId]);
  return r.rows[0] || null;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const productId = parseInt(req.query.productId, 10);
      if (!productId) return json(res, { error: 'A productId is required.' }, 400);

      if (req.query.eligibility) {
        const member = await authedUserChecked(req);
        if (!member) return json(res, { eligible: false, reason: 'sign_in_required' });
        const already = (await q('select id from reviews where product_id=$1 and user_id=$2', [productId, member.id])).rows[0];
        if (already) return json(res, { eligible: false, reason: 'already_reviewed' });
        const order = await findVerifyingOrder(member.email, productId);
        return json(res, order ? { eligible: true } : { eligible: false, reason: 'no_verified_purchase' });
      }

      const rows = (await q(
        `select r.id, r.rating, r.title, r.body, r.created_at, u.name as reviewer_name
           from reviews r join users u on u.id = r.user_id
          where r.product_id = $1 order by r.created_at desc`, [productId])).rows;
      const count = rows.length;
      const average = count ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : null;
      return json(res, { productId, count, average, reviews: rows.map(rowToObj) });
    }

    if (req.method === 'POST') {
      const member = await authedUserChecked(req);
      if (!member) return json(res, { error: 'Sign in to write a review.' }, 401);
      const b = readBody(req);
      const productId = parseInt(b.productId, 10);
      const rating = parseInt(b.rating, 10);
      if (!productId) return json(res, { error: 'A productId is required.' }, 400);
      if (!(rating >= 1 && rating <= 5)) return json(res, { error: 'Rating must be 1-5.' }, 400);
      const title = b.title ? String(b.title).trim().slice(0, 160) : null;
      const body = b.body ? String(b.body).trim().slice(0, 3000) : null;

      const product = (await q('select id from products where id=$1', [productId])).rows[0];
      if (!product) return json(res, { error: 'Not found' }, 404);

      const order = await findVerifyingOrder(member.email, productId);
      if (!order) return json(res, { error: 'You can only review products from a completed order.' }, 403);

      try {
        const r = await q(
          `insert into reviews (product_id, user_id, order_id, rating, title, body)
           values ($1,$2,$3,$4,$5,$6) returning id, created_at`,
          [productId, member.id, order.id, rating, title, body]);
        return json(res, { ok: true, id: r.rows[0].id, createdAt: r.rows[0].created_at });
      } catch (e) {
        if (e.code === '23505') return json(res, { error: 'You have already reviewed this product.' }, 409);
        throw e;
      }
    }

    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('reviews:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
