// Generic table CRUD shared by /api/[resource] and /api/[resource]/[id].
// Public can read active rows; only an admin token can write. Column allow-lists
// prevent a client from setting arbitrary columns.
'use strict';
const { q } = require('./db');
const { checkAdmin } = require('./auth');
const { json, readBody } = require('./respond');
const { buildListQuery } = require('./query');

const TABLES = {
  products:    ['name','brand','description','price','was','category','stock','img_url','active'],
  tournaments: ['name','date','location','prize','slots','registered','status','active'],
  athletes:    ['name','state','discipline','rank','pb','img_url','active'],
  jobs:        ['title','org','location','type','salary','active'],
  knowledge:   ['title','category','level','read_time','excerpt','body','published','active'],
  news:        ['title','category','date','excerpt','img_url','active'],
  profiles:    ['handle','name','headline','location','discipline','bio','pb','rank','events','years','links','achievements','experience','certifications','img_url','verified','active'],
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
    const admin = checkAdmin(req);
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
      // An empty table returns an empty list. It does NOT return seed rows.
      // Serving invented rows to real users as real is prohibited by CLAUDE.md
      // §1.1 ("no seeded demo rows served to real users as real") — an empty
      // shop is a design problem, not a data problem. The pages render honest
      // empty states.
      return json(res, r.rows.map(rowToObj));
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
    if (!checkAdmin(req)) return json(res, { error: 'Unauthorised' }, 401);
    const cols = pick(table, readBody(req));
    if (!Object.keys(cols).length) return json(res, { error: 'No valid fields' }, 400);
    const keys = Object.keys(cols), vals = Object.values(cols);
    const ph = keys.map((_, i) => `$${i + 1}`).join(',');
    const r = await q(`insert into ${table} (${keys.join(',')}) values (${ph}) returning id`, vals);
    return json(res, { ok: true, id: r.rows[0].id });
  }
  return json(res, { error: 'Method not allowed' }, 405);
}

async function itemOps(table, id, req, res) {
  if (req.method === 'GET') {
    const r = await q(`select * from ${table} where id=$1`, [id]);
    return r.rows[0] ? json(res, rowToObj(r.rows[0])) : json(res, { error: 'Not found' }, 404);
  }
  if (!checkAdmin(req)) return json(res, { error: 'Unauthorised' }, 401);
  if (req.method === 'PUT') {
    const cols = pick(table, readBody(req));
    if (!Object.keys(cols).length) return json(res, { error: 'No valid fields' }, 400);
    const keys = Object.keys(cols), vals = Object.values(cols);
    const set = keys.map((c, i) => `${c}=$${i + 1}`).join(',');
    await q(`update ${table} set ${set} where id=$${keys.length + 1}`, [...vals, id]);
    return json(res, { ok: true });
  }
  if (req.method === 'DELETE') {
    await q(`delete from ${table} where id=$1`, [id]);
    return json(res, { ok: true });
  }
  return json(res, { error: 'Method not allowed' }, 405);
}

module.exports = { TABLES, listOrCreate, itemOps, rowToObj };
