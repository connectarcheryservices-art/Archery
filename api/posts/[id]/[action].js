// /api/posts/<id>/reply  and  /api/posts/<id>/like — public forum interactions.
'use strict';
const { cors, json, readBody } = require('../../_lib/respond');
const { q } = require('../../_lib/db');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);
  const id = parseInt(req.query.id, 10);
  const action = req.query.action;
  if (!Number.isFinite(id)) return json(res, { error: 'Bad id' }, 400);
  try {
    if (action === 'like') {
      await q('update posts set likes = likes + 1 where id=$1', [id]);
      return json(res, { ok: true });
    }
    if (action === 'reply') {
      const b = readBody(req);
      const text = String(b.text||'').trim().slice(0, 4000);
      const author = String(b.author||'Guest').trim().slice(0, 80) || 'Guest';
      if (!text) return json(res, { ok: false, error: 'Reply cannot be empty.' }, 400);
      const cur = (await q('select replies from posts where id=$1', [id])).rows[0];
      if (!cur) return json(res, { error: 'Not found' }, 404);
      const replies = Array.isArray(cur.replies) ? cur.replies : [];
      replies.push({ author, text, ts: Date.now() });
      await q('update posts set replies=$1 where id=$2', [JSON.stringify(replies), id]);
      return json(res, { ok: true });
    }
    return json(res, { error: 'Unknown action' }, 404);
  } catch (e) { console.error('posts action:', e?.message); return json(res, { error: 'Server error' }, 500); }
};
