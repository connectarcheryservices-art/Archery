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
    const [paid, revenue, byStatus, events, cities, recent, series] = await Promise.all([
      q("select count(*)::int n from orders where payment_status='paid'"),
      q("select coalesce(sum(total),0) s from orders where payment_status='paid'"),
      q('select status, count(*)::int n from orders group by status'),
      q('select type, count(*)::int n from analytics_events group by type'),
      q("select city, count(*)::int n from orders where city is not null and city <> '' group by city order by n desc limit 8"),
      q('select id, order_no, customer_name, total, status, payment_status, city, created_at from orders order by id desc limit 10'),
      q(`select to_char(date_trunc('day', created_at),'Mon DD') d, coalesce(sum(total),0) v
         from orders where payment_status='paid' and created_at > now() - interval '14 days'
         group by 1, date_trunc('day', created_at) order by date_trunc('day', created_at)`),
    ]);
    return json(res, {
      paidOrders: paid.rows[0].n,
      revenue: Number(revenue.rows[0].s),
      byStatus: Object.fromEntries(byStatus.rows.map(r => [r.status, r.n])),
      events: Object.fromEntries(events.rows.map(r => [r.type, r.n])),
      topCities: cities.rows,
      recent: recent.rows,
      revenueSeries: series.rows,
    });
  } catch (e) {
    console.error('analytics:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
