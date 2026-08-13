// /api/federation-board — a federation's communications board.
//   GET  ?federationId=N          list messages posted to that federation
//   POST {federationId, title, body}    post a new message
//   DELETE /:id                   remove a message
//
// Closes the "communications board" feature named (and never built) by
// checkout-fee.js's district tier copy.
//
// Posting: staff, or a federation officer with jurisdiction over
// federationId (ancestor-inclusive — same rule as every other federation
// write in this codebase). Reading: staff, a jurisdiction-holding officer,
// OR a club admin/coach of ANY club under this federation node — the
// actual intended audience of a federation-wide announcement.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { authedUserChecked } = require('../_lib/userauth');
const { q } = require('../_lib/db');
const { writeAudit } = require('../_lib/audit');
const { isFederationOfficerOrAncestor, clubIdsUnderFederation } = require('../_lib/federation-lib');
const { isClubAdmin, isCoachOfClub } = require('../_lib/member-capability');

async function requireOfficer(req, federationId) {
  const staff = await checkAdmin(req);
  if (staff) return staff;
  const member = await authedUserChecked(req);
  if (member && await isFederationOfficerOrAncestor(member.id, federationId)) {
    return { role: 'member:federation-officer', sid: member.id, name: member.name };
  }
  return null;
}

// Broader than requireOfficer: also lets a club admin/coach of ANY club
// under this federation read what was posted to them.
async function requireReader(req, federationId) {
  const officer = await requireOfficer(req, federationId);
  if (officer) return officer;
  const member = await authedUserChecked(req);
  if (!member) return null;
  const clubIds = await clubIdsUnderFederation(federationId);
  for (const clubId of clubIds) {
    if (await isClubAdmin(member.id, clubId) || await isCoachOfClub(member.id, clubId)) {
      return { role: 'member:club-recipient', sid: member.id, name: member.name };
    }
  }
  return null;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const id = req.query.id;

  try {
    if (req.method === 'GET') {
      const federationId = parseInt(req.query.federationId, 10);
      if (!federationId) return json(res, { error: 'A federationId is required.' }, 400);
      const federation = (await q('select id from federations where id=$1', [federationId])).rows[0];
      if (!federation) return json(res, { error: 'Not found' }, 404);
      if (!(await requireReader(req, federationId))) return json(res, { error: 'Unauthorised' }, 401);
      const rows = (await q(
        `select id, federation_id, title, body, posted_by, created_at
           from federation_messages where federation_id=$1 order by created_at desc`, [federationId])).rows;
      return json(res, rows.map(r => ({
        id: r.id, federationId: r.federation_id, title: r.title, body: r.body,
        postedBy: r.posted_by, createdAt: r.created_at,
      })));
    }

    if (req.method === 'POST') {
      const b = readBody(req);
      const federationId = parseInt(b.federationId, 10);
      const title = String(b.title || '').trim().slice(0, 200);
      const body = String(b.body || '').trim().slice(0, 4000);
      if (!federationId) return json(res, { error: 'A federationId is required.' }, 400);
      if (!title) return json(res, { error: 'A title is required.' }, 400);
      if (!body) return json(res, { error: 'A message body is required.' }, 400);

      const federation = (await q('select id from federations where id=$1', [federationId])).rows[0];
      if (!federation) return json(res, { error: 'That federation does not exist.' }, 404);

      const actor = await requireOfficer(req, federationId);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);

      const r = await q(
        `insert into federation_messages (federation_id, title, body, posted_by, posted_by_user)
         values ($1,$2,$3,$4,$5) returning id, created_at`,
        [federationId, title, body, actor.name || actor.role, actor.sid || null]);
      await writeAudit({ req, actor, action: 'create', resourceType: 'federation_messages', resourceId: r.rows[0].id,
        after: { federationId, title } });
      return json(res, { ok: true, id: r.rows[0].id, createdAt: r.rows[0].created_at });
    }

    if (id && req.method === 'DELETE') {
      const existing = (await q('select id, federation_id, title from federation_messages where id=$1', [parseInt(id, 10)])).rows[0];
      if (!existing) return json(res, { error: 'Not found' }, 404);
      const actor = await requireOfficer(req, existing.federation_id);
      if (!actor) return json(res, { error: 'Not found' }, 404); // same 404-not-401 pattern as club-members.js — no existence oracle
      await q('delete from federation_messages where id=$1', [parseInt(id, 10)]);
      await writeAudit({ req, actor, action: 'delete', resourceType: 'federation_messages', resourceId: parseInt(id, 10),
        before: { title: existing.title } });
      return json(res, { ok: true });
    }

    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('federation-board:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
