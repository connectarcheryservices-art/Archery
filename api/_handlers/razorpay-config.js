// /api/razorpay/config — the publishable Razorpay key id for the browser checkout.
'use strict';
const { cors, json } = require('../_lib/respond');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  return json(res, { keyId: process.env.PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || '' });
};
