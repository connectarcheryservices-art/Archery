// GET /api/memberships — the public membership plan table.
//
// Read-only and server-authoritative: the pricing page renders whatever this
// returns, so a price can never be edited in the browser (§1.6). Amounts live in
// _lib/memberships.js and nowhere else.
'use strict';
const { cors, json } = require('../_lib/respond');
const { PLANS, CURRENCY } = require('../_lib/memberships');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);

  const plans = Object.entries(PLANS).map(([key, p]) => ({
    key, label: p.label, price: p.price, currency: CURRENCY, period: p.period,
    from: !!p.from, recommended: !!p.recommended, ageNote: p.ageNote || null,
    for: p.for, benefits: p.benefits,
  }));

  return json(res, {
    currency: CURRENCY,
    // Stated in the payload, not just the page, so any client that consumes this
    // carries the disclaimer with it. We are not a governing body.
    notice: 'Archery.Services is an independent platform, not a national federation. '
          + 'Membership provides access to this platform and does not include insurance, '
          + 'national team selection, sanctioned-competition eligibility or official national rankings.',
    plans,
  });
};
