// Single serverless function for the whole /api/* surface.
// (Vercel Hobby allows max 12 functions; this keeps us at 1 with identical URLs.)
// Dispatches to api/_handlers/* and fills req.query the way the split files expected.
const H = (n) => require('../_handlers/' + n);

module.exports = (req, res) => {
  const u = String(req.url || '').split('?')[0];
  const seg = u.replace(/^\/?api\/?/, '').split('/').filter(Boolean);
  const q = req.query || (req.query = {});
  const n = seg.length;
  const r0 = seg[0];

  try {
    if (r0 === 'checkout' && n === 2 && (seg[1] === 'quote' || seg[1] === 'create' || seg[1] === 'fee')) return H('checkout-' + seg[1])(req, res);
    if (r0 === 'razorpay' && n === 2 && (seg[1] === 'verify' || seg[1] === 'config')) return H('razorpay-' + seg[1])(req, res);
    if (r0 === 'admin' && n === 2 && seg[1] === 'login') return H('admin-login')(req, res);
    if (r0 === 'analytics' && n === 1) return H('analytics')(req, res);
    if (r0 === 'coach' && n === 1) return H('coach')(req, res);
    if (r0 === 'users' && n === 2) { q.action = seg[1]; return H('users-action')(req, res); }
    // Logged-in user's own account: /api/me/profile, /api/me/dashboard, /api/me/products[/<id>]
    if (r0 === 'me' && n >= 2) { q.sub = seg[1]; if (n === 3) q.pid = seg[2]; return H('my-profile')(req, res); }
    // Staff (employees): /api/staff, /api/staff/<id>, /api/staff/me/<action>
    if (r0 === 'staff') {
      if (n === 1) return H('staff')(req, res);
      q.id = seg[1];
      if (n === 3) q.action = seg[2];
      return H('staff')(req, res);
    }
    // Federation officers: /api/federation-members, /api/federation-members/<id>
    if (r0 === 'federation-members') {
      if (n === 2) q.id = seg[1];
      return H('federation-members')(req, res);
    }
    // Seller accounts (admin): /api/sellers, /api/sellers/<id>
    if (r0 === 'sellers') {
      if (n === 2) q.id = seg[1];
      return H('sellers')(req, res);
    }
    if (r0 === 'orders') {
      if (n === 1) return H('orders')(req, res);
      if (n === 2) { q.id = seg[1]; return H('orders-id')(req, res); }
    }
    if (r0 === 'posts' || r0 === 'chat') {
      if (n === 1) return H(r0)(req, res);
      q.id = seg[1];
      if (n === 2) return H(r0 + '-id')(req, res);
      q.action = seg[2];
      if (n === 3) return H(r0 + '-id-action')(req, res);
    }
    // Generic CRUD resources (products, tournaments, athletes, jobs, knowledge,
    // news, profiles, registrations, reports, applications, settings, stats).
    if (n === 1) { q.resource = r0; return H('resource')(req, res); }
    if (n === 2) { q.resource = r0; q.id = seg[1]; return H('resource-id')(req, res); }
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Server error' }));
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
};
