// /api/posts — community forum list (public: active only; admin: all) + create (public).
'use strict';
const { cors, json, readBody } = require('./_lib/respond');
const { checkAdmin } = require('./_lib/auth');
const { q } = require('./_lib/db');

const rowToObj = row => { const o = {}; for (const [k,v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_,c) => c.toUpperCase())] = v; return o; };

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (req.method === 'GET') {
      const sql = checkAdmin(req)
        ? 'select * from posts order by pinned desc, id desc'
        : 'select * from posts where active is not false order by pinned desc, id desc';
      const r = await q(sql);
      return json(res, r.rows.map(rowToObj));
    }
    if (req.method === 'POST') {
      const b = readBody(req);
      const title = String(b.title||'').trim().slice(0, 200);
      const body  = String(b.body||'').trim().slice(0, 8000);
      const author = String(b.author||'Guest').trim().slice(0, 80) || 'Guest';
      const category = String(b.category||'General').trim().slice(0, 40) || 'General';
      if (!title || !body) return json(res, { ok: false, error: 'Title and message are both required.' }, 400);
      const r = await q(
        `insert into posts (author,category,title,body,replies,likes,pinned,active,created_at)
         values ($1,$2,$3,$4,'[]',0,false,true,$5) returning id`,
        [author, category, title, body, Date.now()]
      );
      return json(res, { ok: true, id: r.rows[0].id });
    }
    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) { console.error('posts:', e?.message); return json(res, { error: 'Server error' }, 500); }
};
