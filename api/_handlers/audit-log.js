// GET /api/audit-log — read the audit trail (migration 016). Owner/manager only:
// before/after diffs can carry customer PII and other sensitive state, so this
// is gated at the same tier as `settings`/`manage_staff`, not just "logged in".
// Query params: resourceType, resourceId, action, before (id cursor, returns
// rows with id < before), limit (default 50, max 200).
'use strict';
const { cors, json } = require('../_lib/respond');
const { checkAdmin, can } = require('../_lib/auth');
const { q } = require('../_lib/db');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);
  const actor = checkAdmin(req);
  if (!actor) return json(res, { error: 'Unauthorised' }, 401);
  if (!can(actor, 'settings')) return json(res, { error: 'Only the owner or a manager can view the audit log.' }, 403);

  try {
    const { resourceType, resourceId, action } = req.query || {};
    const limit = Math.max(1, Math.min(200, parseInt(req.query?.limit, 10) || 50));
    const before = parseInt(req.query?.before, 10);

    const where = [];
    const vals = [];
    if (resourceType) where.push(`resource_type = $${vals.push(String(resourceType).slice(0, 60))}`);
    if (resourceId)   where.push(`resource_id = $${vals.push(String(resourceId).slice(0, 60))}`);
    if (action)       where.push(`action = $${vals.push(String(action).slice(0, 40))}`);
    if (Number.isFinite(before)) where.push(`id < $${vals.push(before)}`);
    const clause = where.length ? `where ${where.join(' and ')}` : '';

    const r = await q(
      `select id, actor_role, actor_id, actor_name, action, resource_type, resource_id, before, after, ip, created_at
         from audit_log ${clause}
        order by id desc
        limit $${vals.push(limit)}`,
      vals
    );
    return json(res, { ok: true, rows: r.rows, nextBefore: r.rows.length === limit ? r.rows[r.rows.length - 1].id : null });
  } catch (e) {
    console.error('audit-log:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
