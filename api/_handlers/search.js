// /api/search?q=<term> — one real search across everything a viewer is
// actually authorised to see (CLAUDE.md §1.4: capability, not "is logged
// in"). Uses Postgres full-text search (to_tsvector/plainto_tsquery,
// ts_rank) — built into core Postgres, no extension dependency, so it works
// identically against local PGlite and production Supabase.
//
// Anonymous / any authenticated caller: public, active/published rows only
// — the same visibility rule crud.js already enforces for reads elsewhere.
// A staff token (owner/manager/editor/support) additionally searches
// inactive/unpublished rows across the same tables, so staff can actually
// find the draft they're looking for — same query, wider visibility, never
// the other way around.
'use strict';
const { cors, json } = require('../_lib/respond');
const { q } = require('../_lib/db');
const { checkAdmin } = require('../_lib/auth');

// One tsvector per source, built from the columns worth matching on. Every
// branch is parameterised with the SAME $1 (the query) and $2 (result
// limit per branch, kept small since these are UNIONed then re-limited).
function branch({ type, table, idCol = 'id', titleExpr, subtitleExpr, urlExpr, tsExpr, activeClause, from }) {
  // Each UNION ALL branch needs its own ORDER BY/LIMIT wrapped in parens —
  // otherwise Postgres parses the ORDER BY as applying to the whole UNION
  // and the next branch's SELECT is a syntax error.
  return `(
    select '${type}' as type, ${idCol}::text as id, ${titleExpr} as title, ${subtitleExpr} as subtitle,
           ${urlExpr} as url, ts_rank(${tsExpr}, plainto_tsquery('english', $1)) as rank
      from ${from || table}
     where ${tsExpr} @@ plainto_tsquery('english', $1) ${activeClause}
     order by rank desc limit 8
  )`;
}
// A minor's profile never appears in a public search result, consent or
// not (CLAUDE.md §1.8) — public discoverability is itself a form of
// exposure, and staff's wider search doesn't override it either (unlike
// the active/inactive visibility axis, this isn't a staff-workflow need).
const NOT_UNCONSENTED_MINOR = `and (u.date_of_birth is null or u.date_of_birth <= (current_date - interval '18 years') or u.parent_consent_status = 'granted')`;

function buildSearchSql(includeInactive) {
  const activeOnly = includeInactive ? '' : 'and active = true';
  const branches = [
    branch({ type: 'athlete', table: 'athletes',
      titleExpr: 'name', subtitleExpr: `trim(both ' ' from coalesce(state,'') || case when state is not null and state<>'' and discipline is not null and discipline<>'' then ' · ' else '' end || coalesce(discipline,''))`,
      urlExpr: `'athletes.html'`, tsExpr: `to_tsvector('english', coalesce(name,'') || ' ' || coalesce(state,'') || ' ' || coalesce(discipline,''))`,
      activeClause: activeOnly }),
    branch({ type: 'event', table: 'events',
      titleExpr: 'name', subtitleExpr: `coalesce(venue,'') || case when starts_on is not null then ' · ' || to_char(starts_on,'DD Mon YYYY') else '' end`,
      urlExpr: `'draw.html'`, tsExpr: `to_tsvector('english', coalesce(name,'') || ' ' || coalesce(venue,''))`,
      activeClause: '' }),
    branch({ type: 'club', table: 'clubs',
      titleExpr: 'name', subtitleExpr: `trim(both ' ' from coalesce(city,'') || case when city is not null and city<>'' and country is not null and country<>'' then ', ' else '' end || coalesce(country,''))`,
      urlExpr: `'discover.html'`, tsExpr: `to_tsvector('english', coalesce(name,'') || ' ' || coalesce(city,'') || ' ' || coalesce(country,'') || ' ' || coalesce(about,''))`,
      activeClause: activeOnly }),
    branch({ type: 'news', table: 'news',
      titleExpr: 'title', subtitleExpr: `coalesce(category,'')`,
      urlExpr: `'index.html'`, tsExpr: `to_tsvector('english', coalesce(title,'') || ' ' || coalesce(excerpt,''))`,
      activeClause: activeOnly }),
    branch({ type: 'knowledge', table: 'knowledge',
      titleExpr: 'title', subtitleExpr: `coalesce(category,'') || case when level is not null and level<>'' then ' · ' || level else '' end`,
      urlExpr: `'knowledge.html'`, tsExpr: `to_tsvector('english', coalesce(title,'') || ' ' || coalesce(excerpt,'') || ' ' || coalesce(body,''))`,
      activeClause: includeInactive ? '' : `and active = true and published = true` }),
    branch({ type: 'forum', table: 'posts',
      titleExpr: 'title', subtitleExpr: `coalesce(category,'') || ' · ' || coalesce(author,'')`,
      urlExpr: `'community.html'`, tsExpr: `to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))`,
      activeClause: activeOnly }),
    branch({ type: 'job', table: 'jobs',
      titleExpr: 'title', subtitleExpr: `coalesce(org,'') || case when location is not null and location<>'' then ' · ' || location else '' end`,
      urlExpr: `'jobs.html'`, tsExpr: `to_tsvector('english', coalesce(title,'') || ' ' || coalesce(org,'') || ' ' || coalesce(location,''))`,
      activeClause: activeOnly }),
    branch({ type: 'product', table: 'products',
      titleExpr: 'name', subtitleExpr: `coalesce(brand,'') || case when category is not null and category<>'' then ' · ' || category else '' end`,
      urlExpr: `'product.html?id=' || id`, tsExpr: `to_tsvector('english', coalesce(name,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(category,''))`,
      activeClause: activeOnly }),
    branch({ type: 'profile', table: 'profiles', idCol: 'profiles.id',
      from: 'profiles left join users u on u.id = profiles.user_id',
      titleExpr: 'profiles.name', subtitleExpr: `coalesce(profiles.headline,'')`,
      urlExpr: `'profile.html?h=' || handle`,
      tsExpr: `to_tsvector('english', coalesce(profiles.name,'') || ' ' || coalesce(profiles.headline,'') || ' ' || coalesce(profiles.bio,'') || ' ' || coalesce(profiles.discipline,''))`,
      activeClause: activeOnly.replace('active', 'profiles.active') + ` and handle is not null ${NOT_UNCONSENTED_MINOR}` }),
  ];
  return branches.join('\nunion all\n') + '\norder by rank desc limit 40';
}

const SQL_PUBLIC = buildSearchSql(false);
const SQL_STAFF = buildSearchSql(true);

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const term = String(req.query.q || '').trim().slice(0, 200);
    if (!term) return json(res, { ok: true, results: [] });
    const staff = await checkAdmin(req);
    const sql = staff ? SQL_STAFF : SQL_PUBLIC;
    const r = await q(sql, [term]);
    return json(res, { ok: true, results: r.rows, scope: staff ? 'staff' : 'public' });
  } catch (e) {
    console.error('search:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
