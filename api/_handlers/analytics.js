// /api/analytics — admin dashboard metrics. GET aggregates; POST logs a public event.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { q } = require('../_lib/db');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Public: lightweight event logging (pageviews etc.)
  if (req.method === 'POST') {
    const b = readBody(req);
    const type = String(b.type || '').slice(0, 40);
    if (!type) return json(res, { ok: false }, 400);
    try {
      await q(
        `insert into analytics_events (type, path, value, geo_lat, geo_lng, ua, referrer)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [type, (b.path || '').slice(0, 300), b.value ?? null,
         b.geo?.lat ?? null, b.geo?.lng ?? null,
         (req.headers['user-agent'] || '').slice(0, 300), (b.referrer || '').slice(0, 300)]
      );
    } catch (e) { /* analytics is best-effort */ }
    return json(res, { ok: true });
  }

  // Admin: aggregated dashboard
  if (!checkAdmin(req)) return json(res, { error: 'Unauthorised' }, 401);
  try {
    const [paid, revenue, byStatus, events, cities, recent, series, counts, activity, sources, fills, topPages] = await Promise.all([
      q("select count(*)::int n from orders where payment_status='paid'"),
      q("select coalesce(sum(total),0) s from orders where payment_status='paid'"),
      q('select status, count(*)::int n from orders group by status'),
      q('select type, count(*)::int n from analytics_events group by type'),
      q("select city, count(*)::int n from orders where city is not null and city <> '' group by city order by n desc limit 8"),
      q('select id, order_no, customer_name, total, status, payment_status, city, created_at from orders order by id desc limit 10'),
      q(`select to_char(date_trunc('day', created_at),'Mon DD') d, coalesce(sum(total),0) v
         from orders where payment_status='paid' and created_at > now() - interval '14 days'
         group by 1, date_trunc('day', created_at) order by date_trunc('day', created_at)`),
      // Real catalogue / community counts for the dashboard tiles.
      q(`select
           (select count(*)::int from products    where active is not false) products,
           (select count(*)::int from tournaments  where active is not false) tournaments,
           (select count(*)::int from athletes     where active is not false) athletes,
           (select count(*)::int from jobs         where active is not false) jobs,
           (select count(*)::int from knowledge    where active is not false) knowledge,
           (select count(*)::int from posts        where active is not false) posts,
           (select count(*)::int from users)                                  users,
           (select count(*)::int from registrations)                          registrations,
           (select count(*)::int from applications)                           applications,
           (select count(*)::int from analytics_events where type='pageview') pageviews,
           (select count(*)::int from analytics_events where type='pageview' and created_at > now() - interval '30 days') pageviews30,
           (select count(*)::int from orders)                                 orders_total`),
      // Real recent-activity feed: a union of the latest events across tables.
      q(`(select 'signup' k, name label, '' sub, created_at ts from users order by id desc limit 6)
          union all (select 'order', coalesce(customer_name,'Someone'), 'placed order '||order_no, extract(epoch from created_at)*1000 from orders order by id desc limit 6)
          union all (select 'registration', trim(coalesce(first_name,'')||' '||coalesce(last_name,'')), 'registered for '||coalesce(tournament_name,'a tournament'), created_at from registrations order by id desc limit 6)
          union all (select 'application', coalesce(org_name,'A federation'), 'applied for federation access', created_at from applications order by id desc limit 6)
          union all (select 'post', coalesce(author,'A member'), 'posted: '||coalesce(title,''), created_at from posts order by id desc limit 6)
          order by ts desc nulls last limit 14`),
      // Traffic sources from referrer strings.
      q(`select case
             when referrer is null or referrer='' then 'Direct'
             when referrer ilike '%google%' or referrer ilike '%bing%' then 'Search'
             when referrer ilike '%facebook%' or referrer ilike '%instagram%' or referrer ilike '%t.co%' or referrer ilike '%twitter%' or referrer ilike '%linkedin%' or referrer ilike '%whatsapp%' then 'Social'
             else 'Referral' end source, count(*)::int n
           from analytics_events where type='pageview' group by 1 order by n desc`),
      // Tournament fill rates.
      q(`select name, registered, slots from tournaments where active is not false and slots>0 order by date nulls last limit 6`),
      // Top pages by pageview.
      q(`select coalesce(nullif(path,''),'/') path, count(*)::int n from analytics_events where type='pageview' group by 1 order by n desc limit 6`),
    ]);
    const c = counts.rows[0];
    return json(res, {
      paidOrders: paid.rows[0].n,
      revenue: Number(revenue.rows[0].s),
      byStatus: Object.fromEntries(byStatus.rows.map(r => [r.status, r.n])),
      events: Object.fromEntries(events.rows.map(r => [r.type, r.n])),
      topCities: cities.rows,
      recent: recent.rows,
      revenueSeries: series.rows,
      counts: c,
      activity: activity.rows.map(r => ({ k: r.k, label: (r.label || '').trim() || 'Someone', sub: r.sub, ts: Number(r.ts) || null })),
      sources: sources.rows,
      fillRates: fills.rows.map(r => ({ name: r.name, registered: r.registered, slots: r.slots, pct: r.slots > 0 ? Math.round(r.registered / r.slots * 100) : 0 })),
      topPages: topPages.rows,
    });
  } catch (e) {
    console.error('analytics:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
