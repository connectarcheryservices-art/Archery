// /api/checkout/quote — live price breakdown for the cart (no order created).
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { computeQuote } = require('../_lib/pricing');
const { loadPricingConfig } = require('../_lib/settings');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);
  const b = readBody(req);
  const config = await loadPricingConfig();
  let delivery = b.delivery === 'sameday' ? 'sameday' : 'standard';
  if (delivery === 'sameday' && config.sameDayEnabled === false) delivery = 'standard';
  const quote = computeQuote(b.items || [], { delivery, config });
  return json(res, { ok: true, quote, sameDayEnabled: config.sameDayEnabled });
};
