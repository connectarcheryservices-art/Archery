// Shared logic for the public "inbox" collections: registrations, welfare reports,
// federation applications. Anyone may POST one; only an admin can list/update/delete.
'use strict';
const { q } = require('./db');
const { json, readBody } = require('./respond');
const { checkAdmin } = require('./auth');
const { writeAudit } = require('./audit');
const { getSettings } = require('./settings');

const INBOX = {
  registrations: {
    table: 'registrations',
    fields: ['tournamentId','tournamentName','firstName','lastName','dob','gender','fedNumber','country','discipline','level','club'],
    required: r => (String(r.firstName||'').trim() || String(r.lastName||'').trim()) ? null : 'Your name is required.',
    defaultStatus: 'pending',
    statuses: ['pending', 'approved', 'rejected'],
  },
  reports: {
    table: 'reports',
    fields: ['type','name','email','description','urgency'],
    required: r => String(r.description||'').trim() ? null : 'A description of the concern is required.',
    defaultStatus: 'open',
    // 'reviewed' (binary: looked at it or not) wasn't a real case-management
    // state for something at safeguarding's stakes — 'investigating' /
    // 'resolved' at least distinguish "someone owns this" from "this is
    // actually closed." This is still an internal record, not a legal or
    // investigative determination — it does not replace or automate the
    // real mandatory-reporting obligations a reviewing human has.
    statuses: ['open', 'investigating', 'resolved'],
  },
  applications: {
    table: 'applications',
    fields: ['orgName','orgType','contactName','email','phone'],
    required: r => String(r.orgName||'').trim() ? null : 'Organisation name is required.',
    defaultStatus: 'pending',
    statuses: ['pending', 'approved', 'rejected'],
  },
};

const toSnake = o => { const out = {}; for (const [k,v] of Object.entries(o)) out[k.replace(/([A-Z])/g, c => '_'+c.toLowerCase())] = v; return out; };
const rowToObj = row => { const o = {}; for (const [k,v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_,c) => c.toUpperCase())] = v; return o; };

async function inboxList(resource, req, res) {
  if (!(await checkAdmin(req))) return json(res, { error: 'Unauthorised' }, 401);
  const r = await q(`select * from ${INBOX[resource].table} order by id desc`);
  return json(res, r.rows.map(rowToObj));
}

async function inboxCreate(resource, req, res) {
  const cfg = INBOX[resource];
  if (resource === 'registrations') {
    const settings = await getSettings();
    if (settings.registrationOpen === false) {
      return json(res, { ok: false, error: 'Registration is currently closed.' }, 403);
    }
  }
  const data = readBody(req);
  const rec = {};
  for (const f of cfg.fields) { let v = data[f]; if (v == null) v = ''; if (typeof v === 'string') v = v.slice(0, 4000); rec[f] = v; }
  if (resource === 'registrations') {
    const tid = parseInt(data.tournamentId) || null;
    if (tid != null) {
      // A registration pointing at a tournament that doesn't exist is not a
      // real registration — reject it rather than silently store a dangling
      // reference. (The one place this ID gets used later, approval's
      // registered-count bump, would otherwise fail to find the row and
      // silently update 0 rows — invisible data corruption, not an error.)
      const exists = (await q('select 1 from tournaments where id=$1', [tid])).rows[0];
      if (!exists) return json(res, { ok: false, error: 'This tournament no longer exists.' }, 400);
    }
    rec.tournamentId = tid;
  }
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
  const actor = await checkAdmin(req);
  if (!actor) return json(res, { error: 'Unauthorised' }, 401);
  const cfg = INBOX[resource];
  if (req.method === 'GET') {
    const r = await q(`select * from ${cfg.table} where id=$1`, [id]);
    return r.rows[0] ? json(res, rowToObj(r.rows[0])) : json(res, { error: 'Not found' }, 404);
  }
  if (req.method === 'PUT') {
    const data = readBody(req);
    // reports gets two extra, staff-only fields beyond status — who owns
    // this report and a private resolution note. Scoped to this one
    // resource deliberately; registrations/applications keep the plain
    // status-only PUT unchanged.
    if (resource === 'reports' && (data.assignedTo !== undefined || data.resolutionNote !== undefined)) {
      const before = (await q(`select assigned_to, resolution_note from reports where id=$1`, [id])).rows[0];
      if (!before) return json(res, { error: 'Not found' }, 404);
      const assignedTo = data.assignedTo !== undefined ? String(data.assignedTo).slice(0, 200) : before.assigned_to;
      const resolutionNote = data.resolutionNote !== undefined ? String(data.resolutionNote).slice(0, 4000) : before.resolution_note;
      await q(`update reports set assigned_to=$1, resolution_note=$2 where id=$3`, [assignedTo || null, resolutionNote || null, id]);
      await writeAudit({ req, actor, action: 'update', resourceType: resource, resourceId: id,
        before: { assignedTo: before.assigned_to, resolutionNote: before.resolution_note }, after: { assignedTo, resolutionNote } });
      if (!data.status) return json(res, { ok: true });
    }
    const status = String(data.status||'').slice(0, 40);
    if (!status) return json(res, { error: 'Nothing to update' }, 400);
    if (!cfg.statuses.includes(status)) return json(res, { error: `Invalid status. Must be one of: ${cfg.statuses.join(', ')}` }, 400);
    const before = (await q(`select status from ${cfg.table} where id=$1`, [id])).rows[0];
    if (!before) return json(res, { error: 'Not found' }, 404);
    if (resource === 'registrations' && status === 'approved') {
      const cur = (await q('select status, tournament_id from registrations where id=$1', [id])).rows[0];
      if (cur && cur.status !== 'approved' && cur.tournament_id)
        await q('update tournaments set registered = greatest(0, registered + 1) where id=$1', [cur.tournament_id]);
    }
    await q(`update ${cfg.table} set status=$1 where id=$2`, [status, id]);
    await writeAudit({ req, actor, action: 'status_change', resourceType: resource, resourceId: id,
      before: { status: before.status }, after: { status } });
    return json(res, { ok: true });
  }
  if (req.method === 'DELETE') {
    const before = (await q(`select * from ${cfg.table} where id=$1`, [id])).rows[0];
    await q(`delete from ${cfg.table} where id=$1`, [id]);
    await writeAudit({ req, actor, action: 'delete', resourceType: resource, resourceId: id,
      before: before ? rowToObj(before) : null });
    return json(res, { ok: true });
  }
  return json(res, { error: 'Method not allowed' }, 405);
}

module.exports = { INBOX, inboxList, inboxCreate, inboxItem };
