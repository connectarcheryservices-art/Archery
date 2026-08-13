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
    // NB: /api/razorpay-webhook is deliberately NOT routed here. It is its own
    // function using the Web Standard signature, because it must read the RAW
    // body to verify Razorpay's HMAC — see api/razorpay-webhook.js.
    if (r0 === 'razorpay' && n === 2 && (seg[1] === 'verify' || seg[1] === 'config' || seg[1] === 'reconcile')) return H('razorpay-' + seg[1])(req, res);
    if (r0 === 'admin' && n === 2 && seg[1] === 'login') return H('admin-login')(req, res);
    // In-house mail: /api/mail/settings, /api/mail/test
    if (r0 === 'mail' && n === 2) { q.action = seg[1]; return H('mail')(req, res); }
    if (r0 === 'memberships' && n === 1) return H('memberships')(req, res);
    if (r0 === 'analytics' && n === 1) return H('analytics')(req, res);
    if (r0 === 'audit-log' && n === 1) return H('audit-log')(req, res);
    if (r0 === 'coach' && n === 1) return H('coach')(req, res);
    if (r0 === 'users' && n === 2) { q.action = seg[1]; return H('users-action')(req, res); }
    // Parent/guardian consent for a minor's tournament registration:
    // /api/registrations/parent-consent-info, /api/registrations/verify-parent-consent.
    // Must come BEFORE the generic CRUD fallback below, or `n===2` would
    // route "parent-consent-info" through resource-id.js as if it were a
    // registration id.
    if (r0 === 'registrations' && n === 2 && (seg[1] === 'parent-consent-info' || seg[1] === 'verify-parent-consent')) {
      q.action = seg[1]; return H('registration-consent')(req, res);
    }
    // Scoring domain: /api/scoring/<action> (categories/events/matches/end/etc.)
    if (r0 === 'scoring' && n === 2) { q.action = seg[1]; return H('scoring')(req, res); }
    // Member capability: /api/members/<action> (become-athlete/coach-link/etc.)
    if (r0 === 'members' && n === 2) { q.action = seg[1]; return H('members')(req, res); }
    // Site-wide search: /api/search?q=<term>
    if (r0 === 'search' && n === 1) return H('search')(req, res);
    // Selection: /api/selection/<action> (generate/list/get/override/finalize)
    if (r0 === 'selection' && n === 2) { q.action = seg[1]; return H('selection')(req, res); }
    // Federation hierarchy: /api/federation/<action> (create/tree/assign-officer/officers)
    if (r0 === 'federation' && n === 2) { q.action = seg[1]; return H('federation')(req, res); }
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
    // Club roster: /api/club-members[?clubId=N], /api/club-members/<id>.
    // Explicit route because the hyphenated name won't resolve via generic CRUD.
    // NB: `clubs` (no hyphen) has NO block here on purpose — it uses generic CRUD.
    if (r0 === 'club-members') {
      if (n === 2) q.id = seg[1];
      return H('club-members')(req, res);
    }
    // Club sessions + attendance: /api/club-sessions[?clubId=N],
    // /api/club-sessions/<id>, /api/club-sessions/<id>/attendance (PUT).
    if (r0 === 'club-sessions') {
      if (n >= 2) q.id = seg[1];
      if (n === 3) q.action = seg[2];
      return H('club-sessions')(req, res);
    }
    // Club analytics: /api/club-analytics?clubId=N (read-only).
    if (r0 === 'club-analytics' && n === 1) return H('club-analytics')(req, res);
    // Federation member sync: /api/federation-roster?federationId=N (read-only).
    if (r0 === 'federation-roster' && n === 1) return H('federation-roster')(req, res);
    // Federation communications board: /api/federation-board[?federationId=N], /api/federation-board/<id>.
    if (r0 === 'federation-board') {
      if (n === 2) q.id = seg[1];
      return H('federation-board')(req, res);
    }
    // Consumer Protection Rules 2020 grievances: /api/grievances, /api/grievances/<id>.
    if (r0 === 'grievances') {
      if (n === 2) q.id = seg[1];
      return H('grievances')(req, res);
    }
    // Verified-purchase product reviews: /api/reviews?productId=N.
    if (r0 === 'reviews' && n === 1) return H('reviews')(req, res);
    // Seller accounts (admin): /api/sellers, /api/sellers/<id>
    if (r0 === 'sellers') {
      if (n === 2) q.id = seg[1];
      return H('sellers')(req, res);
    }
    if (r0 === 'orders') {
      if (n === 1) return H('orders')(req, res);
      if (n === 2) { q.id = seg[1]; return H('orders-id')(req, res); }
      if (n === 3 && seg[2] === 'invoice') { q.id = seg[1]; return H('order-invoice')(req, res); }
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
