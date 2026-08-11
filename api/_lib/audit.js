// api/_lib/audit.js — the ONE shared audit-row writer (CLAUDE.md §1.5).
//
// "Every mutation writes an audit row — actor, action, target, before/after,
// timestamp, IP. No exceptions." Call this from a handler AFTER the real
// mutation has already succeeded, passing only the fields that actually
// changed — never a full row dump. A staff row's password hash, a seller's
// GST number, or any other sensitive column must never be copied into
// `before`/`after` just because it happened to be on the row.
//
// Audit writes are best-effort: a logging failure must never turn a
// successful mutation into a user-facing error, so this never throws.
'use strict';
const { q } = require('./db');
const { clientIp } = require('./ratelimit');

/**
 * @param {object} p
 * @param {object} p.req        - the request (used only for IP; never stored raw)
 * @param {object} p.actor      - checkAdmin(req)'s return value: {role, name, username?, sid?}
 * @param {'create'|'update'|'delete'|'status_change'} p.action
 * @param {string} p.resourceType - e.g. 'staff', 'sellers', 'orders', 'settings'
 * @param {string|number|null} p.resourceId
 * @param {object|null} p.before - changed fields only, pre-mutation
 * @param {object|null} p.after  - changed fields only, post-mutation
 */
async function writeAudit({ req, actor, action, resourceType, resourceId, before = null, after = null }) {
  try {
    await q(
      `insert into audit_log (actor_role, actor_id, actor_name, action, resource_type, resource_id, before, after, ip)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        actor?.role || null,
        actor ? String(actor.sid ?? 'owner') : null,
        actor?.name || null,
        action,
        resourceType,
        resourceId != null ? String(resourceId) : null,
        before != null ? JSON.stringify(before) : null,
        after != null ? JSON.stringify(after) : null,
        req ? clientIp(req) : null,
      ]
    );
  } catch (e) {
    // Never let an audit-log failure surface as a mutation failure — but
    // never fail silently either; this is exactly the kind of gap that goes
    // unnoticed for years otherwise.
    console.error('audit log write failed:', e?.message, { resourceType, resourceId, action });
  }
}

module.exports = { writeAudit };
