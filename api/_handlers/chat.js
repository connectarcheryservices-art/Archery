// /api/chat — visitor sends a message (creates/append thread); admin lists threads.
'use strict';
const crypto = require('crypto');
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { q } = require('../_lib/db');

const rowToObj = row => { const o = {}; for (const [k,v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_,c) => c.toUpperCase())] = v; return o; };

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const now = Date.now();
  try {
    if (req.method === 'GET') {
      if (!(await checkAdmin(req))) return json(res, { error: 'Unauthorised' }, 401);
      const r = await q('select * from chats order by updated_at desc nulls last, id desc');
      return json(res, r.rows.map(row => { const o = rowToObj(row); delete o.accessToken; return o; }));
    }
    if (req.method === 'POST') {
      const b = readBody(req);
      const text = String(b.text||'').slice(0, 2000);
      const id = b.id ? parseInt(b.id) : null;
      if (id) {
        // THREAT_MODEL.md finding, 2026-08-13 (T12 audit): id alone used to be
        // enough to append to ANY visitor's thread. Now the caller must prove
        // it owns this thread by presenting the token minted at creation, or
        // be staff. Reject with the same 404 used for "doesn't exist" so a
        // wrong token can't be distinguished from a nonexistent id (no
        // enumeration signal either way).
        const isStaff = await checkAdmin(req);
        const cur = (await q('select messages, access_token from chats where id=$1', [id])).rows[0];
        if (!cur) return json(res, { ok: false, error: 'Not found' }, 404);
        const token = String(b.token || '');
        if (!isStaff && (!cur.access_token || cur.access_token !== token)) {
          return json(res, { ok: false, error: 'Not found' }, 404);
        }
        const msgs = Array.isArray(cur.messages) ? cur.messages : [];
        if (text) msgs.push({ from: 'user', text, ts: now });
        await q('update chats set messages=$1, unread=true, updated_at=$2 where id=$3', [JSON.stringify(msgs), now, id]);
        return json(res, { ok: true, id });
      }
      const welcome = [{ from: 'admin', text: 'Welcome to Archery.Services. How can our team help you today?', ts: now }];
      if (text) welcome.push({ from: 'user', text, ts: now });
      const accessToken = crypto.randomBytes(24).toString('base64url');
      const r = await q(
        `insert into chats (name,email,status,unread,updated_at,messages,access_token) values ($1,$2,'open',true,$3,$4,$5) returning id`,
        [String(b.name||'Guest').slice(0,80), String(b.email||'').slice(0,160), now, JSON.stringify(welcome), accessToken]
      );
      return json(res, { ok: true, id: r.rows[0].id, token: accessToken });
    }
    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) { console.error('chat:', e?.message); return json(res, { error: 'Server error' }, 500); }
};
