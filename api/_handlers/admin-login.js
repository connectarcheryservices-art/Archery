// /api/admin/login — exchange ADMIN_PASSWORD for a derived admin token.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { adminToken } = require('../_lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, { ok: false }, 405);
  const b = readBody(req);
  if (process.env.ADMIN_PASSWORD && b.password === process.env.ADMIN_PASSWORD) {
    return json(res, { ok: true, token: adminToken() });
  }
  return json(res, { ok: false, error: 'Wrong password' }, 401);
};
