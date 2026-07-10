// /api/federation-members  — assign federation officers (president/secretary/
// treasurer/executive) to an approved federation application. Admin-only.
// GET ?applicationId=N lists officers for that application.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { q } = require('../_lib/db');

const OFFICES = ['president', 'secretary', 'treasurer', 'executive_member'];

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const actor = checkAdmin(req);
  if (!actor) return json(res, { error: 'Unauthorised' }, 401);
  const id = req.query.id;
  try {
    if (req.method === 'GET') {
      const appId = req.query.applicationId || req.query.app;
      const rows = appId
        ? (await q(`select fm.id, fm.office, fm.user_id, u.name, u.email, fm.added_at
                    from federation_members fm join users u on u.id=fm.user_id
                    where fm.application_id=$1 order by fm.id`, [parseInt(appId)])).rows
        : (await q(`select fm.id, fm.office, fm.application_id, fm.user_id, u.name, u.email, a.org_name
                    from federation_members fm join users u on u.id=fm.user_id
                    join applications a on a.id=fm.application_id order by fm.id desc`)).rows;
      return json(res, rows);
    }
    if (req.method === 'POST') {
      const b = readBody(req);
      const office = OFFICES.includes(b.office) ? b.office : 'executive_member';
      const appId = parseInt(b.applicationId);
      if (!appId) return json(res, { error: 'A federation application is required.' }, 400);
      // Find the user by email (they must have registered an account first).
      const email = String(b.email || '').trim().toLowerCase();
      const user = (await q('select id,name from users where email=$1', [email])).rows[0];
      if (!user) return json(res, { error: 'No user account with that email — ask them to register first.' }, 404);
      await q(`insert into federation_members (application_id, user_id, office) values ($1,$2,$3)
               on conflict (application_id, user_id) do update set office=$3`, [appId, user.id, office]);
      return json(res, { ok: true, name: user.name });
    }
    if (id && req.method === 'DELETE') {
      await q('delete from federation_members where id=$1', [parseInt(id)]);
      return json(res, { ok: true });
    }
    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('federation-members:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
