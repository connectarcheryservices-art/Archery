// /api/<resource>/<id>  — get (GET) / update (PUT) / delete (DELETE) one row.
'use strict';
const { cors, json } = require('../_lib/respond');
const { TABLES, itemOps } = require('../_lib/crud');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const { resource, id } = req.query;
  const numId = parseInt(id, 10);
  if (!TABLES[resource]) return json(res, { error: 'Unknown resource' }, 404);
  if (!Number.isFinite(numId)) return json(res, { error: 'Bad id' }, 400);
  try {
    return await itemOps(resource, numId, req, res);
  } catch (e) {
    console.error('api/[resource]/[id] error:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
