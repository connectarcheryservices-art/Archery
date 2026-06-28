// Shared logic for the public "inbox" collections: registrations, welfare reports,
// federation applications. Anyone may POST one; only an admin can list/update/delete.
'use strict';
const { q } = require('./db');
const { json, readBody } = require('./respond');
const { checkAdmin } = require('./auth');

const INBOX = {
  registrations: {
    table: 'registrations',
    fields: ['tournamentId','tournamentName','firstName','lastName','dob','gender','fedNumber','country','discipline','level','club'],
    required: r => (String(r.firstName||'').trim() || String(r.lastName||'').trim()) ? null : 'Your name is required.',
    defaultStatus: 'pending',
  },
  reports: {
    table: 'reports',
    fields: ['type','name','email','description','urgency'],
    required: r => String(r.description||'').trim() ? null : 'A description of the concern is required.',
    defaultStatus: 'open',
  },
  applications: {
    table: 'applications',
    fields: ['orgName','orgType','contactName','email','phone'],
    required: r => String(r.orgName||'').trim() ? null : 'Organisation name is required.',
    defaultStatus: 'pending',
  },
};

const toSnake = o => { const out = {}; for (const [k,v] of Object.entries(o)) out[k.replace(/([A-Z])/g, c => '_'+c.toLowerCase())] = v; return out; };
const rowToObj = row => { const o = {}; for (const [k,v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_,c) => c.toUpperCase())] = v; return o; };

async function inboxList(resource, req, res) {
  if (!checkAdmin(req)) return json(res, { error: 'Unauthorised' }, 401);
  const r = await q(`select * from ${INBOX[resource].table} order by id desc`);
  return json(res, r.rows.map(rowToObj));
}

async function inboxCreate(resource, req, res) {
  const cfg = INBOX[resource];
  const data = readBody(req);
  const rec = {};
  for (const f of cfg.fields) { let v = data[f]; if (v == null) v = ''; if (typeof v === 'string') v = v.slice(0, 4000); rec[f] = v; }
  if (resource === 'registrations') rec.tournamentId = parseInt(data.tournamentId) || null;
  const err = cfg.required ? cfg.required(rec) : null;
  if (err) return json(res, { ok: false, error: err }, 400);
  rec.status = cfg.defaultStatus;
  rec.createdAt = Date.now();
  const snake = toSnake(rec), keys = Object.keys(snake), vals = Object.values(snake);
  const ph = keys.map((_, i) => `$${i+1}`).join(',');
  const r = await q(`insert into ${cfg.table} (${keys.join(',')}) values (${ph}) returning id`, vals);
  return json(res, { ok: true, id: r.rows[0].id });
}

async function inboxItem(resource, id, req, res) {
  if (!checkAdmin(req)) return json(res, { error: 'Unauthorised' }, 401);
  const cfg = INBOX[resource];
  if (req.method === 'GET') {
    const r = await q(`select * from ${cfg.table} where id=$1`, [id]);
    return r.rows[0] ? json(res, rowToObj(r.rows[0])) : json(res, { error: 'Not found' }, 404);
  }
  if (req.method === 'PUT') {
    const data = readBody(req);
    const status = String(data.status||'').slice(0, 40);
    if (!status) return json(res, { error: 'Nothing to update' }, 400);
    if (resource === 'registrations' && status === 'approved') {
      const cur = (await q('select status, tournament_id from registrations where id=$1', [id])).rows[0];
      if (cur && cur.status !== 'approved' && cur.tournament_id)
        await q('update tournaments set registered = greatest(0, registered + 1) where id=$1', [cur.tournament_id]);
    }
    await q(`update ${cfg.table} set status=$1 where id=$2`, [status, id]);
    return json(res, { ok: true });
  }
  if (req.method === 'DELETE') {
    await q(`delete from ${cfg.table} where id=$1`, [id]);
    return json(res, { ok: true });
  }
  return json(res, { error: 'Method not allowed' }, 405);
}

module.exports = { INBOX, inboxList, inboxCreate, inboxItem };
