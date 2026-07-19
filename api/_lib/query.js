// Server-side search, filter and sort for list endpoints.
// Builds a safe parameterised SQL query from the request's query-string so the
// database does the work (full-text search, price filters, ordering, paging)
// instead of shipping every row to the browser. Falls back gracefully — an
// unknown table or column simply yields the base list.
'use strict';

// Columns each searchable resource is allowed to sort by (whitelist → no injection).
const SORTABLE = {
  products:   { price_asc:'price asc', price_desc:'price desc', newest:'id desc',
                discount:'(coalesce(was,price)-price) desc', name:'name asc', relevance:null, trending:null },
  knowledge:  { newest:'id desc', title:'title asc', relevance:null },
  tournaments:{ soonest:'date asc nulls last', prize:'prize desc', newest:'id desc' },
  athletes:   { rank:'pb desc nulls last', name:'name asc' },
  jobs:       { newest:'id desc', title:'title asc' },
  news:       { newest:'date desc nulls last' },
  // Team is a curated, hand-ordered list — sort_order first, then id.
  team:       { order:'sort_order asc, id asc', name:'name asc' },
};

// A resource supports free-text search if it has a `search` tsvector column.
const FULLTEXT = new Set(['products', 'knowledge']);
// Plain ILIKE fallback columns when there is no tsvector (or FTS errors).
const ILIKE_COLS = {
  products: ['name','brand','category','description'],
  knowledge: ['title','category','excerpt'],
  tournaments: ['name','location'],
  athletes: ['name','state','discipline'],
  jobs: ['title','org','location'],
  news: ['title','category','excerpt'],
};

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Build the WHERE/ORDER/LIMIT tail + params for a public list request.
// Returns { where, order, limit, params, wantsTrending }.
function buildListQuery(table, query, { admin } = {}) {
  const p = [];
  const where = [];
  if (!admin) where.push('active is not false');

  const q = (query.q || query.search || '').trim();
  const useFts = q && FULLTEXT.has(table);
  if (q && useFts) {
    p.push(q);
    where.push(`search @@ plainto_tsquery('english', $${p.length})`);
  } else if (q && ILIKE_COLS[table]) {
    p.push('%' + q.replace(/[%_]/g, '\\$&') + '%');
    const idx = p.length;
    where.push('(' + ILIKE_COLS[table].map(c => `${c} ilike $${idx}`).join(' or ') + ')');
  }

  if (query.category) { p.push(query.category); where.push(`category = $${p.length}`); }
  if (query.brand)    { p.push(query.brand);    where.push(`brand = $${p.length}`); }
  if (query.discipline){ p.push(query.discipline); where.push(`discipline = $${p.length}`); }
  if (query.status)   { p.push(query.status);   where.push(`status = $${p.length}`); }

  const min = num(query.min ?? query.minPrice);
  const max = num(query.max ?? query.maxPrice);
  if (min != null) { p.push(min); where.push(`price >= $${p.length}`); }
  if (max != null) { p.push(max); where.push(`price <= $${p.length}`); }
  if (query.inStock === '1' || query.inStock === 'true') where.push('stock > 0');

  // Sort
  let order = 'id desc';
  let wantsTrending = false;
  const sortMap = SORTABLE[table] || {};
  const sortKey = query.sort;
  if (sortKey === 'relevance' && useFts) {
    p.push(q);
    order = `ts_rank(search, plainto_tsquery('english', $${p.length})) desc, id desc`;
  } else if (sortKey === 'trending' && table === 'products') {
    wantsTrending = true;            // handled by a join in the caller
  } else if (sortMap[sortKey]) {
    order = sortMap[sortKey];
  } else if (useFts && q) {
    // default to relevance when searching
    p.push(q);
    order = `ts_rank(search, plainto_tsquery('english', $${p.length})) desc, id desc`;
  }

  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 200));
  const offset = Math.max(0, parseInt(query.offset, 10) || 0);

  return {
    whereSql: where.length ? 'where ' + where.join(' and ') : '',
    order, limit, offset, params: p, wantsTrending,
    hasFilters: !!(q || query.category || query.brand || query.discipline ||
                   min != null || max != null || query.inStock || sortKey),
  };
}

// In-memory equivalent for the seed fallback (no DB) so search/sort still work offline.
function applyToSeed(table, rows, query) {
  let out = rows.slice();
  const q = (query.q || query.search || '').trim().toLowerCase();
  if (q) {
    const cols = ILIKE_COLS[table] || ['name', 'title'];
    out = out.filter(r => cols.some(c => String(r[c] || r[c.replace(/_([a-z])/g,(_,x)=>x.toUpperCase())] || '').toLowerCase().includes(q)));
  }
  if (query.category) out = out.filter(r => r.category === query.category);
  if (query.brand)    out = out.filter(r => r.brand === query.brand);
  if (query.discipline) out = out.filter(r => r.discipline === query.discipline);
  const min = num(query.min ?? query.minPrice), max = num(query.max ?? query.maxPrice);
  if (min != null) out = out.filter(r => Number(r.price) >= min);
  if (max != null) out = out.filter(r => Number(r.price) <= max);
  if (query.inStock === '1' || query.inStock === 'true') out = out.filter(r => Number(r.stock) > 0);
  const s = query.sort;
  if (s === 'price_asc')  out.sort((a,b)=>a.price-b.price);
  else if (s === 'price_desc') out.sort((a,b)=>b.price-a.price);
  else if (s === 'discount') out.sort((a,b)=>((b.was||b.price)-b.price)-((a.was||a.price)-a.price));
  else if (s === 'name' || s === 'title') out.sort((a,b)=>String(a.name||a.title).localeCompare(String(b.name||b.title)));
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 200));
  return out.slice(0, limit);
}

module.exports = { buildListQuery, applyToSeed, SORTABLE };
