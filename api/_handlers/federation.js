// /api/federation/<action> — the federation hierarchy tree (migration 026).
// STRUCTURAL/organisational infrastructure only. This is unrelated to
// checkout-fee.js's paid district/state/national tiers, which remain
// switched off (FOR_SALE is deliberately empty there) — nothing here
// grants, implies, or depends on paid access, and nothing here should be
// read as reactivating billing for any tier.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { authedUserChecked } = require('../_lib/userauth');
const { q } = require('../_lib/db');
const { writeAudit } = require('../_lib/audit');

const rowToObj = row => { const o = {}; for (const [k, v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v; return o; };
async function requireStaff(req) {
  const actor = await checkAdmin(req);
  if (!actor || (actor.role !== 'owner' && actor.role !== 'manager')) return null;
  return actor;
}
const CHILD_TIER = { national: 'state', state: 'district' };

// Does userId hold one of `offices` (or ANY office, if offices is null) at
// federationId itself, or at any ANCESTOR of it? A national officer has
// jurisdiction over every state/district beneath them; a state officer
// over their districts; a district officer only over their own node.
async function hasJurisdiction(userId, federationId, offices = null) {
  if (!userId || !federationId) return false;
  let currentId = federationId;
  const seen = new Set();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const row = (await q('select office from federation_members where user_id=$1 and federation_id=$2', [userId, currentId])).rows[0];
    if (row && (!offices || offices.includes(row.office))) return true;
    const parent = (await q('select parent_id from federations where id=$1', [currentId])).rows[0];
    currentId = parent ? parent.parent_id : null;
  }
  return false;
}
// Any office at all — sufficient to create a CHILD node (administrative,
// not a governance decision) but NOT sufficient to appoint officers (see
// assign-officer below, which requires president rank specifically —
// caught by adversarial audit review, 2026-08-12: any office, including
// the lowest, was previously enough to self-promote to president).
const isFederationOfficerOrAncestor = (userId, federationId) => hasJurisdiction(userId, federationId, null);
const isPresidentOrAncestor = (userId, federationId) => hasJurisdiction(userId, federationId, ['president']);

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const action = req.query.action;
  try {
    // ── CREATE: staff, OR an officer of the PARENT node, can create a
    // child one tier down. National has no parent; state's parent must be
    // national; district's parent must be state. ──
    if (action === 'create' && req.method === 'POST') {
      const b = readBody(req);
      const tier = b.tier;
      const parentId = b.parentId ? parseInt(b.parentId, 10) : null;
      const name = String(b.name || '').trim().slice(0, 200);
      const region = String(b.region || '').trim().slice(0, 120) || null;
      if (!['district', 'state', 'national'].includes(tier)) return json(res, { error: 'tier must be district, state, or national' }, 400);
      if (!name) return json(res, { error: 'name is required' }, 400);
      if (tier === 'national' && parentId) return json(res, { error: 'A national federation has no parent.' }, 400);
      if (tier !== 'national' && !parentId) return json(res, { error: tier + ' federation requires a parentId' }, 400);

      let parent = null;
      if (parentId) {
        parent = (await q('select id, tier from federations where id=$1', [parentId])).rows[0];
        if (!parent) return json(res, { error: 'Unknown parent federation' }, 404);
        if (CHILD_TIER[parent.tier] !== tier) return json(res, { error: `A ${tier} federation's parent must be ${Object.keys(CHILD_TIER).find(k => CHILD_TIER[k] === tier)}, not ${parent.tier}.` }, 400);
      }

      const staff = await requireStaff(req);
      let actor = staff;
      if (!actor) {
        const member = await authedUserChecked(req);
        if (member && parentId && await isFederationOfficerOrAncestor(member.id, parentId)) {
          actor = { role: 'member:federation-officer', sid: member.id, name: member.name };
        }
      }
      if (!actor) return json(res, { error: 'Unauthorised — staff, or an officer of the parent federation, can create this.' }, 401);

      const r = await q(
        `insert into federations (name, tier, parent_id, region, application_id) values ($1,$2,$3,$4,$5) returning id`,
        [name, tier, parentId, region, b.applicationId || null]);
      await writeAudit({ req, actor, action: 'create', resourceType: 'federations', resourceId: r.rows[0].id, after: { name, tier, parentId, region } });
      return json(res, { ok: true, id: r.rows[0].id });
    }

    // ── TREE: the full hierarchy, or scoped to a subtree (public read). ──
    if (action === 'tree' && req.method === 'GET') {
      // Not parseInt'd: federations.id is a bigint, which the pg driver
      // returns as a string — byId's keys (and f.parentId) are that same
      // string, so this must stay a string too or Map.get() never matches
      // (caught by federation-test.js before this shipped).
      const rootId = req.query.rootId || null;
      const rows = (await q('select * from federations where active=true order by tier, name')).rows.map(rowToObj);
      const byId = new Map(rows.map(f => [f.id, { ...f, children: [] }]));
      const roots = [];
      for (const f of byId.values()) {
        if (f.parentId && byId.has(f.parentId)) byId.get(f.parentId).children.push(f);
        else roots.push(f);
      }
      if (rootId) {
        const scoped = byId.get(rootId);
        return json(res, { ok: true, tree: scoped ? [scoped] : [] });
      }
      return json(res, { ok: true, tree: roots });
    }

    // ── ASSIGN-OFFICER: staff, or the CURRENT PRESIDENT of this federation
    // (or an ancestor's), can appoint/reassign an officer here — appointing
    // officers is a governance decision, not something any office-holder
    // should be able to do to themself. (Any lesser office was previously
    // sufficient, letting a member self-promote to president — caught by
    // adversarial audit review, 2026-08-12.) ──
    if (action === 'assign-officer' && req.method === 'POST') {
      const b = readBody(req);
      const federationId = parseInt(b.federationId, 10);
      // Unlike an official (who must already be a certified, approved
      // official — see approved-officials), any registered user can become
      // a federation officer, so there's no bounded list to pick from in
      // the UI — resolve by email so staff don't need to know a raw id.
      let userId = parseInt(b.userId, 10) || null;
      if (!userId && b.email) {
        const u = (await q('select id from users where email=$1', [String(b.email).trim().toLowerCase()])).rows[0];
        if (!u) return json(res, { error: 'No registered user with that email.' }, 404);
        userId = u.id;
      }
      const office = b.office;
      if (!federationId || !userId) return json(res, { error: 'federationId and userId (or email) are required' }, 400);
      // anti_doping_officer added for docs/PLAN.md's anti-doping item — a
      // federation designating a REAL contact, reusing this already-built,
      // already-secured appointment system rather than a new one. Governed
      // by the same isPresidentOrAncestor rule as every other office below
      // — appointing an officer is a governance decision.
      if (!['president', 'secretary', 'treasurer', 'executive_member', 'anti_doping_officer'].includes(office)) return json(res, { error: 'Invalid office' }, 400);
      const fed = (await q('select id from federations where id=$1', [federationId])).rows[0];
      if (!fed) return json(res, { error: 'Unknown federation' }, 404);

      const staff = await requireStaff(req);
      let actor = staff;
      if (!actor) {
        const member = await authedUserChecked(req);
        if (member && await isPresidentOrAncestor(member.id, federationId)) {
          actor = { role: 'member:federation-officer', sid: member.id, name: member.name };
        }
      }
      if (!actor) return json(res, { error: 'Unauthorised — staff, or the president of this federation (or an ancestor), can assign officers.' }, 401);

      // Fetch the prior state so the audit row is accurate — a genuine
      // no-op (same office already held) writes nothing; a reassignment is
      // logged as 'update' with the real before-state, not as a fabricated
      // second 'create' (caught by adversarial audit review, 2026-08-12).
      const existing = (await q('select id, office from federation_members where federation_id=$1 and user_id=$2', [federationId, userId])).rows[0];
      if (existing && existing.office === office) return json(res, { ok: true, id: existing.id, unchanged: true });

      const r = await q(
        `insert into federation_members (federation_id, user_id, office) values ($1,$2,$3)
         on conflict (federation_id, user_id) where federation_id is not null
           do update set office=excluded.office
         returning id`,
        [federationId, userId, office]);
      await writeAudit({ req, actor, action: existing ? 'update' : 'create', resourceType: 'federation_members', resourceId: r.rows[0].id,
        before: existing ? { office: existing.office } : null, after: { federationId, userId, office } });
      return json(res, { ok: true, id: r.rows[0].id });
    }

    // ── OFFICERS: public read of who holds office where. ──
    if (action === 'officers' && req.method === 'GET') {
      const federationId = parseInt(req.query.federationId, 10);
      if (!federationId) return json(res, { error: 'federationId is required' }, 400);
      const rows = (await q(
        `select fm.office, u.name from federation_members fm join users u on u.id = fm.user_id where fm.federation_id=$1 order by fm.office`,
        [federationId])).rows;
      return json(res, rows);
    }

    return json(res, { error: 'Not found' }, 404);
  } catch (e) {
    console.error('federation:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
