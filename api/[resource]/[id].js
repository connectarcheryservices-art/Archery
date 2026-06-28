// /api/<resource>/<id>  — get (GET) / update (PUT) / delete (DELETE) one row.
'use strict';
const { cors, json } = require('../_lib/respond');
const { TABLES, itemOps } = require('../_lib/crud');
const { INBOX, inboxItem } = require('../_lib/inbox');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const { resource, id } = req.query;
  const numId = parseInt(id, 10);
  if (!Number.isFinite(numId)) return json(res, { error: 'Bad id' }, 400);
  if (!TABLES[resource] && !INBOX[resource]) return json(res, { error: 'Unknown resource' }, 404);
  try {
    if (INBOX[resource]) return await inboxItem(resource, numId, req, res);
    return await itemOps(resource, numId, req, res);
  } catch (e) {
    console.error('api/[resource]/[id] error:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
