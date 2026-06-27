// Stateless admin auth for serverless. The admin panel logs in with ADMIN_PASSWORD
// and receives a derived token (HMAC of the password); every admin write re-derives
// and compares it. The raw password is never stored or re-sent.
'use strict';
const crypto = require('crypto');

function adminToken() {
  const pw = process.env.ADMIN_PASSWORD || '';
  return crypto.createHmac('sha256', pw || 'no-admin-password-set')
    .update('archery-admin-v1').digest('hex');
}

function checkAdmin(req) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const h = req.headers['authorization'] || '';
  const t = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!t) return false;
  const a = Buffer.from(t), b = Buffer.from(adminToken());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { adminToken, checkAdmin };
