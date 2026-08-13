// /api/checkout/quote — live price breakdown for the cart (no order created).
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { computeQuote } = require('../_lib/pricing');
const { loadPricingConfig } = require('../_lib/settings');
const { q } = require('../_lib/db');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);
  const b = readBody(req);
  const config = await loadPricingConfig();
  let delivery = b.delivery === 'sameday' ? 'sameday' : 'standard';
  if (delivery === 'sameday' && config.sameDayEnabled === false) delivery = 'standard';

  // Preview-only HSN/rate enrichment: best-effort lookup so the previewed
  // split reflects real per-product rates when we have ids, but a bad/
  // missing id must never fail the whole preview — items just keep
  // computeQuote's own defaults (see api/_lib/pricing.js normaliseItems).
  const items = Array.isArray(b.items) ? b.items : [];
  const ids = items.map(i => parseInt(i.id, 10)).filter(Boolean);
  if (ids.length) {
    try {
      const r = await q('select id, hsn_code, gst_rate from products where id = any($1)', [ids]);
      const map = new Map(r.rows.map(row => [Number(row.id), row]));
      for (const it of items) {
        const row = map.get(parseInt(it.id, 10));
        if (row) {
          if (row.hsn_code != null) it.hsnCode = row.hsn_code;
          if (row.gst_rate != null) it.gstRate = Number(row.gst_rate);
        }
      }
    } catch (e) {
      // DB lookup failed — fall back to computeQuote's own defaults rather
      // than failing a preview-only endpoint.
      console.error('checkout/quote HSN lookup error:', e?.message);
    }
  }

  const quote = computeQuote(items, {
    delivery, config,
    buyerState: b.state || null,
    platformState: config.platformRegisteredState || null,
  });
  return json(res, { ok: true, quote, sameDayEnabled: config.sameDayEnabled });
};
