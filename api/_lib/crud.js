// Generic table CRUD shared by /api/[resource] and /api/[resource]/[id].
// Public can read active rows; only an admin token with the 'content'
// capability can write. Column allow-lists prevent a client from setting
// arbitrary columns.
'use strict';
const { q } = require('./db');
const { checkAdmin, can } = require('./auth');
const { json, readBody } = require('./respond');
const { buildListQuery } = require('./query');
const { writeAudit } = require('./audit');
const { isMinor } = require('./age');

// A minor's profile never shows up in the public directory or by direct
// id/handle lookup, consent or not (CLAUDE.md §1.8) — public discoverability
// is itself exposure, and it's not something a staff token overrides either
// (unlike active/inactive, which is a staff-workflow visibility axis).
// Only engages for the 'profiles' table; every other resource is unaffected.
async function filterUnconsentedMinorProfiles(rows) {
  if (!rows.length) return rows;
  const userIds = rows.map(r => r.user_id).filter(Boolean);
  if (!userIds.length) return rows;
  const users = (await q('select id, date_of_birth, parent_consent_status from users where id = any($1::bigint[])', [userIds])).rows;
  const blocked = new Set(users.filter(u => isMinor(u.date_of_birth) === true && u.parent_consent_status !== 'granted').map(u => String(u.id)));
  return rows.filter(r => !r.user_id || !blocked.has(String(r.user_id)));
}

const TABLES = {
  products:    ['name','brand','description','price','was','category','stock','img_url','active','hsn_code','gst_rate'],
  tournaments: ['name','date','location','prize','slots','registered','status','active'],
  athletes:    ['name','state','discipline','rank','pb','img_url','active'],
  jobs:        ['title','org','location','type','salary','description','active'],
  knowledge:   ['title','category','level','read_time','excerpt','body','published','active'],
  news:        ['title','category','date','excerpt','img_url','active'],
  profiles:    ['handle','name','headline','location','discipline','bio','pb','rank','events','years','links','achievements','experience','certifications','img_url','verified','active'],
  // Public "who runs this platform" list (migration 010). NOT `staff` — that
  // holds admin login credentials and is never public.
  team:        ['name','role','bio','img_url','link','sort_order','active'],
  // Clubs directory (migration 013). `application_id` is intentionally NOT here —
  // provenance is set only by a controlled path, never a client, so a POST can't
  // forge a link to someone else's registration application. Members live in the
  // separate club_members table via /api/club-members (admin-only, never public).
  clubs:       ['name','city','region','country','discipline','about','email','phone','website','img_url','active'],
};

const toSnake = o => { const out = {}; for (const [k, v] of Object.entries(o)) out[k.replace(/([A-Z])/g, c => '_' + c.toLowerCase())] = v; return out; };
const rowToObj = row => { const o = {}; for (const [k, v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v; return o; };
function pick(table, data) {
  const allowed = TABLES[table] || [];
  const snake = toSnake(data);
  const out = {};
  for (const c of allowed) if (snake[c] !== undefined) {
    const v = snake[c];
    out[c] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : v; // JSONB columns
  }
  return out;
}

async function listOrCreate(table, req, res) {
  if (req.method === 'GET') {
    const admin = await checkAdmin(req);
    const query = req.query || {};
    const qy = buildListQuery(table, query, { admin });
    try {
      let sql, params;
      if (qy.wantsTrending) {
        // Real trending: order products by product-view count over the last 14 days
        // (analytics_events, type='product_view', value = product id), then by rating.
        sql = `select p.* from products p
               left join (
                 select value::bigint pid, count(*)::int v
                 from analytics_events
                 where type='product_view' and created_at > now() - interval '14 days'
                 group by value::bigint
               ) t on t.pid = p.id
               ${qy.whereSql}
               order by coalesce(t.v,0) desc, p.id desc
               limit ${qy.limit} offset ${qy.offset}`;
        params = qy.params;
      } else {
        sql = `select * from ${table} ${qy.whereSql} order by ${qy.order} limit ${qy.limit} offset ${qy.offset}`;
        params = qy.params;
      }
      const r = await q(sql, params);
      const rows = table === 'profiles' ? await filterUnconsentedMinorProfiles(r.rows) : r.rows;
      // An empty table returns an empty list. It does NOT return seed rows.
      // Serving invented rows to real users as real is prohibited by CLAUDE.md
      // §1.1 ("no seeded demo rows served to real users as real") — an empty
      // shop is a design problem, not a data problem. The pages render honest
      // empty states.
      return json(res, rows.map(rowToObj));
    } catch (e) {
      // DB unavailable: fail loudly. Previously this served seed rows, i.e. a
      // database outage silently turned into fabricated inventory with real
      // prices and a working Add-to-Cart. 503 lets the page say "we can't reach
      // our catalogue right now" instead of lying.
      console.error(`crud ${table}:`, e?.message);
      return json(res, { error: 'Catalogue temporarily unavailable', unavailable: true }, 503);
    }
  }
  if (req.method === 'POST') {
    const actor = await checkAdmin(req);
    if (!actor) return json(res, { error: 'Unauthorised' }, 401);
    if (!can(actor, 'content')) return json(res, { error: 'Your role does not have access to content editing.' }, 403);
    const cols = pick(table, readBody(req));
    if (!Object.keys(cols).length) return json(res, { error: 'No valid fields' }, 400);
    const keys = Object.keys(cols), vals = Object.values(cols);
    const ph = keys.map((_, i) => `$${i + 1}`).join(',');
    const r = await q(`insert into ${table} (${keys.join(',')}) values (${ph}) returning id`, vals);
    await writeAudit({ req, actor, action: 'create', resourceType: table, resourceId: r.rows[0].id, after: cols });
    return json(res, { ok: true, id: r.rows[0].id });
  }
  return json(res, { error: 'Method not allowed' }, 405);
}

async function itemOps(table, id, req, res) {
  if (req.method === 'GET') {
    const admin = await checkAdmin(req);
    const r = await q(`select * from ${table} where id=$1`, [id]);
    const row = r.rows[0];
    if (!row) return json(res, { error: 'Not found' }, 404);
    // Same visibility rule as the list endpoint (query.js): a non-admin must
    // not be able to fetch an inactive/unpublished row just by guessing its
    // id — the toggle has to actually hide the row, not just hide it from
    // the list view.
    if (!admin && row.active === false) return json(res, { error: 'Not found' }, 404);
    if (!admin && table === 'knowledge' && row.published === false) return json(res, { error: 'Not found' }, 404);
    if (table === 'profiles' && !(await filterUnconsentedMinorProfiles([row])).length) return json(res, { error: 'Not found' }, 404);
    return json(res, rowToObj(row));
  }
  const actor = await checkAdmin(req);
  if (!actor) return json(res, { error: 'Unauthorised' }, 401);
  if (!can(actor, 'content')) return json(res, { error: 'Your role does not have access to content editing.' }, 403);
  if (req.method === 'PUT') {
    const cols = pick(table, readBody(req));
    if (!Object.keys(cols).length) return json(res, { error: 'No valid fields' }, 400);
    const keys = Object.keys(cols), vals = Object.values(cols);
    const before = (await q(`select ${keys.join(',')} from ${table} where id=$1`, [id])).rows[0] || null;
    const set = keys.map((c, i) => `${c}=$${i + 1}`).join(',');
    await q(`update ${table} set ${set} where id=$${keys.length + 1}`, [...vals, id]);
    await writeAudit({ req, actor, action: 'update', resourceType: table, resourceId: id, before, after: cols });
    return json(res, { ok: true });
  }
  if (req.method === 'DELETE') {
    const before = (await q(`select * from ${table} where id=$1`, [id])).rows[0] || null;
    await q(`delete from ${table} where id=$1`, [id]);
    await writeAudit({ req, actor, action: 'delete', resourceType: table, resourceId: id, before });
    return json(res, { ok: true });
  }
  return json(res, { error: 'Method not allowed' }, 405);
}

module.exports = { TABLES, listOrCreate, itemOps, rowToObj };
