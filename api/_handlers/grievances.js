// /api/grievances — Consumer Protection (E-Commerce) Rules 2020, Rule 4(4)(b):
// a published grievance mechanism with acknowledgement within 48 hours of
// receipt and resolution within one month.
//   POST                     public — file a grievance (no account needed)
//   GET   (admin)            list, newest first
//   PUT   /:id (admin)       { status: 'acknowledged'|'resolved'|'rejected', resolutionNotes? }
//
// This endpoint does not CLAIM compliance by existing — it makes the real
// timestamps checkable. `slaBreached` on each row is computed from real
// filed_at/acknowledged_at/resolved_at values, never asserted.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin, can } = require('../_lib/auth');
const { q } = require('../_lib/db');
const { writeAudit } = require('../_lib/audit');

const ACK_WINDOW_MS = 48 * 60 * 60 * 1000;
const RESOLVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function withSla(row) {
  const filedAt = new Date(row.filedAt).getTime();
  const ackAt = row.acknowledgedAt ? new Date(row.acknowledgedAt).getTime() : null;
  const resolvedAt = row.resolvedAt ? new Date(row.resolvedAt).getTime() : null;
  const now = Date.now();
  const ackOverdue = !ackAt && (now - filedAt) > ACK_WINDOW_MS;
  const ackBreached = ackAt ? (ackAt - filedAt) > ACK_WINDOW_MS : ackOverdue;
  const resolveOverdue = !resolvedAt && row.status !== 'rejected' && (now - filedAt) > RESOLVE_WINDOW_MS;
  const resolveBreached = resolvedAt ? (resolvedAt - filedAt) > RESOLVE_WINDOW_MS : resolveOverdue;
  return { ...row, ackBreached, resolveBreached };
}
const rowToObj = row => { const o = {}; for (const [k, v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v; return o; };

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const id = req.query.id;

  try {
    if (req.method === 'POST') {
      const b = readBody(req);
      const name = String(b.name || '').trim().slice(0, 160);
      const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
      const subject = String(b.subject || '').trim().slice(0, 200);
      const description = String(b.description || '').trim().slice(0, 4000);
      if (!name) return json(res, { error: 'Your name is required.' }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, { error: 'A valid email is required.' }, 400);
      if (!subject) return json(res, { error: 'A subject is required.' }, 400);
      if (!description) return json(res, { error: 'A description is required.' }, 400);
      const phone = b.phone ? String(b.phone).trim().slice(0, 20) : null;
      const orderNo = b.orderNo ? String(b.orderNo).trim().slice(0, 40) : null;

      const r = await q(
        `insert into grievances (name, email, phone, order_no, subject, description)
         values ($1,$2,$3,$4,$5,$6) returning id, filed_at`,
        [name, email, phone, orderNo, subject, description]);

      // Best-effort acknowledgement email — real receipt confirmation, not a
      // claim of resolution. Never blocks or fails the filing itself if
      // SMTP isn't configured (same posture as order-confirmation mail).
      try {
        const { sendMail, branded } = require('../_lib/mailer');
        await sendMail({
          to: email, subject: `We've received your complaint — Ref #${r.rows[0].id}`,
          html: branded({
            heading: 'Complaint received',
            preheader: `Reference #${r.rows[0].id}`,
            body: `Thank you, ${name.split(' ')[0]}. We've received your complaint (Ref #${r.rows[0].id}: "${subject}") and will acknowledge it within 48 hours and work to resolve it within one month, per the Consumer Protection (E-Commerce) Rules 2020.`,
          }),
        }).catch(() => {});
      } catch (e) { /* mail is best-effort */ }

      return json(res, { ok: true, id: r.rows[0].id, referenceId: r.rows[0].id, filedAt: r.rows[0].filed_at });
    }

    const actor = await checkAdmin(req);
    if (!actor) return json(res, { error: 'Unauthorised' }, 401);
    if (!can(actor, 'approvals')) return json(res, { error: 'Forbidden' }, 403);

    if (req.method === 'GET') {
      const rows = (await q('select * from grievances order by filed_at desc')).rows.map(rowToObj).map(withSla);
      return json(res, rows);
    }

    if (id && req.method === 'PUT') {
      const b = readBody(req);
      const status = ['acknowledged', 'resolved', 'rejected'].includes(b.status) ? b.status : null;
      if (!status) return json(res, { error: 'status must be acknowledged, resolved, or rejected.' }, 400);
      const existing = (await q('select * from grievances where id=$1', [parseInt(id, 10)])).rows[0];
      if (!existing) return json(res, { error: 'Not found' }, 404);

      const sets = ['status=$1'], vals = [status];
      if (status === 'acknowledged' && !existing.acknowledged_at) { sets.push(`acknowledged_at=now()`); }
      if ((status === 'resolved' || status === 'rejected') && !existing.resolved_at) { sets.push(`resolved_at=now()`); }
      if (b.resolutionNotes !== undefined) { sets.push(`resolution_notes=$${vals.push(String(b.resolutionNotes).slice(0, 2000))}`); }
      sets.push(`handled_by=$${vals.push(actor.name || actor.role)}`);
      vals.push(parseInt(id, 10));
      await q(`update grievances set ${sets.join(',')} where id=$${vals.length}`, vals);
      await writeAudit({ req, actor, action: 'update', resourceType: 'grievances', resourceId: parseInt(id, 10),
        before: { status: existing.status }, after: { status } });
      return json(res, { ok: true });
    }

    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('grievances:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
