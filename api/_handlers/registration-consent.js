// /api/registrations/parent-consent-info  and  /api/registrations/verify-parent-consent
//
// The parent/guardian's own action, from their own inbox — never something
// the child, the submitter, or staff can trigger on the parent's behalf.
// Public (the parent has no account here), gated entirely by possession of
// the single-use emailed token. Mirrors api/_handlers/users-action.js's
// parent-consent-info/verify-parent-consent pair exactly (migration 027),
// keyed to `registrations` instead of `users` — see migration 037.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { q } = require('../_lib/db');
const { writeAudit } = require('../_lib/audit');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const action = req.query.action;

  try {
    if (action === 'parent-consent-info' && req.method === 'GET') {
      const token = String(req.query.token || '');
      if (!token) return json(res, { ok: false, error: 'Missing consent token.' }, 400);
      const row = (await q(
        `select first_name, last_name, tournament_name, parent_consent_status
           from registrations where parent_consent_token=$1`, [token])).rows[0];
      if (!row) return json(res, { ok: false, error: 'This consent link is invalid or has already been used.' }, 404);
      // Only what's needed to make an informed decision — never anything
      // beyond the identity already disclosed in the consent email itself.
      return json(res, {
        ok: true,
        childName: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'An archer',
        tournamentName: row.tournament_name || 'a tournament',
        status: row.parent_consent_status,
      });
    }

    if (action === 'verify-parent-consent' && req.method === 'POST') {
      const b = readBody(req);
      const token = String(b.token || '');
      if (!token) return json(res, { ok: false, error: 'Missing consent token.' }, 400);
      const row = (await q(
        `select id, first_name, last_name, parent_consent_status
           from registrations where parent_consent_token=$1`, [token])).rows[0];
      if (!row) return json(res, { ok: false, error: 'This consent link is invalid or has already been used.' }, 404);
      if (row.parent_consent_status !== 'pending') {
        return json(res, { ok: false, error: 'This request has already been responded to.', status: row.parent_consent_status }, 409);
      }
      const grant = b.decision !== 'deny';
      const newConsentStatus = grant ? 'granted' : 'denied';
      // A grant moves the registration into the normal staff review queue
      // ('pending', same starting point every adult registration already
      // gets); a denial rejects it outright — DPDP s.9(3) means "no
      // consent" is not a state this platform can keep processing from,
      // there is no partial/limited-use fallback to fall back to.
      const newStatus = grant ? 'pending' : 'rejected';
      const childName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'the archer';
      await q(
        `update registrations
            set parent_consent_status=$1, parent_consent_responded_at=now(), status=$2
          where id=$3`,
        [newConsentStatus, newStatus, row.id]
      );
      await writeAudit({
        req, actor: { role: 'parent-guardian', sid: null, name: 'Parent/guardian of ' + childName },
        action: 'update', resourceType: 'registrations', resourceId: row.id,
        after: { parentConsentStatus: newConsentStatus, status: newStatus },
      });
      return json(res, { ok: true, status: newConsentStatus, childName });
    }

    return json(res, { ok: false, error: 'Not found' }, 404);
  } catch (e) {
    console.error('registration-consent:', e?.message);
    return json(res, { ok: false, error: 'Server error' }, 500);
  }
};
