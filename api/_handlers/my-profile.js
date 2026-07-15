// /api/me/profile  — the logged-in customer's OWN profile (real, not demo).
// GET returns their profile (creating a blank one if missing); PUT updates it.
// Also /api/me/dashboard — a summary of the user's real account state.
'use strict';
const crypto = require('crypto');
const { cors, json, readBody } = require('../_lib/respond');
const { q } = require('../_lib/db');

const { authedUser } = require('../_lib/userauth');
const rowToObj = row => { const o = {}; for (const [k, v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v; return o; };
async function uniqueHandle(name) {
  const base = String(name || 'archer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'archer';
  for (let i = 0; i < 50; i++) { const c = i === 0 ? base : `${base}-${i}`; if (!(await q('select 1 from profiles where handle=$1', [c])).rows[0]) return c; }
  return base + '-' + crypto.randomBytes(3).toString('hex');
}
// Fields a user may edit on their own profile (NOT verified — that's admin-only).
const EDITABLE = ['name', 'headline', 'location', 'discipline', 'bio', 'pb', 'rank', 'events', 'years', 'img_url', 'handle'];

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const u = authedUser(req);
  if (!u) return json(res, { ok: false, error: 'Please sign in.' }, 401);
  const sub = req.query.sub; // 'profile' | 'dashboard'
  try {
    if (sub === 'dashboard' && req.method === 'GET') {
      const [prof, urow, regs, orders, fed] = await Promise.all([
        q('select handle,name,verified from profiles where user_id=$1 limit 1', [u.id]),
        q('select account_type, seller_status, business_name, totp_enabled from users where id=$1', [u.id]),
        q('select count(*)::int n from registrations where lower(first_name||\' \'||last_name) = lower($1)', [u.name]).catch(() => ({ rows: [{ n: 0 }] })),
        q('select count(*)::int n from orders where lower(customer_email)=lower($1)', [u.email]).catch(() => ({ rows: [{ n: 0 }] })),
        q(`select fm.office, a.org_name, a.id application_id from federation_members fm join applications a on a.id=fm.application_id where fm.user_id=$1`, [u.id]),
      ]);
      const ur = urow.rows[0] || {};
      return json(res, {
        ok: true,
        user: { id: u.id, name: u.name, email: u.email },
        profile: prof.rows[0] || null,
        accountType: ur.account_type || 'customer',
        sellerStatus: ur.seller_status || null,
        businessName: ur.business_name || null,
        twoFactor: !!ur.totp_enabled,
        registrations: regs.rows[0].n,
        orders: orders.rows[0].n,
        federationRoles: fed.rows,
      });
    }

    // ── SELLER: manage OWN products (approved sellers only) ──
    if (sub === 'products') {
      const urow = (await q('select account_type, seller_status from users where id=$1', [u.id])).rows[0] || {};
      if (urow.seller_status !== 'approved') return json(res, { ok: false, error: 'Your seller account is not approved yet.' }, 403);
      const pid = req.query.pid;
      const COLS = ['name', 'brand', 'description', 'price', 'was', 'category', 'stock', 'img_url', 'active'];
      const toSnake = k => k.replace(/([A-Z])/g, c => '_' + c.toLowerCase());
      if (req.method === 'GET') {
        const r = await q('select * from products where seller_id=$1 order by id desc', [u.id]);
        return json(res, r.rows.map(rowToObj));
      }
      if (req.method === 'POST') {
        const b = readBody(req);
        if (!String(b.name || '').trim() || !(Number(b.price) >= 0)) return json(res, { ok: false, error: 'Name and a valid price are required.' }, 400);
        const cols = ['seller_id'], vals = [u.id];
        for (const camel of ['name', 'brand', 'description', 'price', 'was', 'category', 'stock', 'imgUrl', 'active']) {
          if (b[camel] === undefined) continue; const c = toSnake(camel); if (!COLS.includes(c)) continue;
          cols.push(c); vals.push(b[camel]);
        }
        const ph = cols.map((_, i) => `$${i + 1}`).join(',');
        const r = await q(`insert into products (${cols.join(',')}) values (${ph}) returning id`, vals);
        return json(res, { ok: true, id: r.rows[0].id });
      }
      if (pid && (req.method === 'PUT' || req.method === 'DELETE')) {
        // Ownership check — a seller can only touch their own rows.
        const own = (await q('select 1 from products where id=$1 and seller_id=$2', [parseInt(pid), u.id])).rows[0];
        if (!own) return json(res, { ok: false, error: 'Not your product.' }, 403);
        if (req.method === 'DELETE') { await q('delete from products where id=$1', [parseInt(pid)]); return json(res, { ok: true }); }
        const b = readBody(req); const sets = [], vals = [];
        for (const camel of ['name', 'brand', 'description', 'price', 'was', 'category', 'stock', 'imgUrl', 'active']) {
          if (b[camel] === undefined) continue; const c = toSnake(camel); if (!COLS.includes(c)) continue;
          sets.push(`${c}=$${vals.push(b[camel])}`);
        }
        if (!sets.length) return json(res, { ok: false, error: 'Nothing to update.' }, 400);
        vals.push(parseInt(pid));
        await q(`update products set ${sets.join(',')} where id=$${vals.length}`, vals);
        return json(res, { ok: true });
      }
      return json(res, { ok: false, error: 'Method not allowed' }, 405);
    }

    // ── OWN PROFILE ──
    if (req.method === 'GET') {
      let row = (await q('select * from profiles where user_id=$1 limit 1', [u.id])).rows[0];
      if (!row) {
        const handle = await uniqueHandle(u.name);
        await q('insert into profiles (handle,name,user_id,active) values ($1,$2,$3,true)', [handle, u.name, u.id]);
        row = (await q('select * from profiles where user_id=$1 limit 1', [u.id])).rows[0];
      }
      return json(res, { ok: true, profile: rowToObj(row) });
    }
    if (req.method === 'PUT') {
      const b = readBody(req);
      const toSnake = k => k.replace(/([A-Z])/g, c => '_' + c.toLowerCase());
      const sets = [], vals = [];
      for (const camel of ['name', 'headline', 'location', 'discipline', 'bio', 'pb', 'rank', 'events', 'years', 'imgUrl', 'handle']) {
        if (b[camel] === undefined) continue;
        const col = toSnake(camel);
        if (!EDITABLE.includes(col)) continue;
        let val = b[camel];
        if (col === 'handle') {
          val = String(val).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
          if (!val) continue;
          const clash = (await q('select 1 from profiles where handle=$1 and user_id<>$2', [val, u.id])).rows[0];
          if (clash) return json(res, { ok: false, error: 'That profile link is already taken — choose another.' }, 409);
        }
        sets.push(`${col}=$${vals.push(val)}`);
      }
      if (!sets.length) return json(res, { ok: false, error: 'Nothing to update.' }, 400);
      // Ensure a row exists, then update it (scoped to this user).
      const exists = (await q('select id from profiles where user_id=$1 limit 1', [u.id])).rows[0];
      if (!exists) { const handle = await uniqueHandle(u.name); await q('insert into profiles (handle,name,user_id,active) values ($1,$2,$3,true)', [handle, u.name, u.id]); }
      vals.push(u.id);
      await q(`update profiles set ${sets.join(',')} where user_id=$${vals.length}`, vals);
      const row = (await q('select * from profiles where user_id=$1 limit 1', [u.id])).rows[0];
      return json(res, { ok: true, profile: rowToObj(row) });
    }
    return json(res, { ok: false, error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('my-profile:', e?.message);
    return json(res, { ok: false, error: 'Server error' }, 500);
  }
};
