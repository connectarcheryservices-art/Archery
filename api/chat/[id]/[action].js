// /api/chat/<id>/reply — admin replies to a visitor thread.
'use strict';
const { cors, json, readBody } = require('../../_lib/respond');
const { checkAdmin } = require('../../_lib/auth');
const { q } = require('../../_lib/db');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);
  if (req.query.action !== 'reply') return json(res, { error: 'Unknown action' }, 404);
  if (!checkAdmin(req)) return json(res, { error: 'Unauthorised' }, 401);
  const id = parseInt(req.query.id, 10);
  if (!Number.isFinite(id)) return json(res, { error: 'Bad id' }, 400);
  try {
    const text = String(readBody(req).text || '').slice(0, 2000);
    if (!text) return json(res, { ok: false, error: 'Empty reply' }, 400);
    const cur = (await q('select messages from chats where id=$1', [id])).rows[0];
    if (!cur) return json(res, { error: 'Not found' }, 404);
    const msgs = Array.isArray(cur.messages) ? cur.messages : [];
    msgs.push({ from: 'admin', text, ts: Date.now() });
    await q('update chats set messages=$1, unread=false, updated_at=$2 where id=$3', [JSON.stringify(msgs), Date.now(), id]);
    return json(res, { ok: true });
  } catch (e) { console.error('chat reply:', e?.message); return json(res, { error: 'Server error' }, 500); }
};
