// Seller product ownership scoping — /api/me/products (api/_handlers/my-profile.js).
// CLAUDE.md §1.4 (capability, not "is logged in") + THREAT_MODEL.md T12
// ("a seller over their own listings" — the resource-scoping example T12
// itself names). Drives the REAL handler; only Postgres is stubbed.
//
// Written 2026-08-13 after re-verifying T12's status directly against the
// code: THREAT_MODEL.md claimed "sellers.js is still admin-only, no
// owner-scoped capability exists for it at all" — false. This file (and
// its real DB counterpart, run manually against the local dev stack) is
// what proved that, and now guards against it regressing silently.
'use strict';
const { R, stubDb, call, check, section, report } = require('./helpers');

process.env.SESSION_SECRET = 'seller-scope-test-session-secret';
process.env.USER_TOKEN_SECRET = 'seller-scope-test-user-token-secret';

// ── in-memory stand-in ───────────────────────────────────────────────────
const DB = { users: [], products: [] };
let nextProductId = 1;
const reset = () => { DB.users = []; DB.products = []; nextProductId = 1; };
reset();

stubDb(async (sql, params = []) => {
  const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();

  // authedUserChecked()'s own revocation check.
  if (s.startsWith('select token_valid_after from users where id=$1')) {
    const u = DB.users.find(u => u.id === params[0]);
    return { rows: u ? [{ token_valid_after: null }] : [] };
  }
  if (s.startsWith('select account_type, seller_status from users where id=$1')) {
    const u = DB.users.find(u => u.id === params[0]);
    return { rows: u ? [{ account_type: u.account_type, seller_status: u.seller_status }] : [] };
  }
  if (s.startsWith('select * from products where seller_id=$1')) {
    return { rows: DB.products.filter(p => p.seller_id === params[0]) };
  }
  if (s.startsWith('insert into products')) {
    const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map(c => c.trim());
    const row = { id: nextProductId++ };
    cols.forEach((c, i) => row[c] = params[i]);
    DB.products.push(row);
    return { rows: [{ id: row.id }] };
  }
  if (s.startsWith('select 1 from products where id=$1 and seller_id=$2')) {
    const found = DB.products.find(p => p.id === params[0] && p.seller_id === params[1]);
    return { rows: found ? [{ '?column?': 1 }] : [] };
  }
  if (s.startsWith('select name, price, active from products where id=$1')) {
    const p = DB.products.find(p => p.id === params[0]);
    return { rows: p ? [{ name: p.name, price: p.price, active: p.active }] : [] };
  }
  if (s.startsWith('select id from products where id=$1')) {
    const p = DB.products.find(p => p.id === params[0]);
    return { rows: p ? [{ id: p.id }] : [] };
  }
  if (s.startsWith('delete from products where id=$1')) {
    DB.products = DB.products.filter(p => p.id !== params[0]);
    return { rows: [] };
  }
  if (s.startsWith('update products set')) {
    const p = DB.products.find(p => p.id === params[params.length - 1]);
    if (p) {
      const setCols = sql.match(/set (.+?) where/i)[1].split(',').map(c => c.split('=')[0].trim());
      setCols.forEach((c, i) => p[c] = params[i]);
    }
    return { rows: [] };
  }
  return { rows: [] };
});

const meProducts = require(R('api/_handlers/my-profile.js'));
const { sign } = require(R('api/_lib/userauth.js'));

(async () => {
  section('a pending (not yet approved) seller cannot create products');
  reset();
  DB.users.push({ id: 1, account_type: 'seller', seller_status: 'pending' });
  const pendingToken = sign({ id: 1, name: 'Pending Seller', email: 'pending@x.com' });
  let r = await call(meProducts, { method: 'POST', query: { sub: 'products' }, token: pendingToken, body: { name: 'x', price: 50 } });
  check(r.status === 403, 'pending seller create -> 403, got ' + r.status);
  check(DB.products.length === 0, 'no product was actually created');

  section('two approved sellers, each managing their own products');
  reset();
  DB.users.push({ id: 1, account_type: 'seller', seller_status: 'approved' });
  DB.users.push({ id: 2, account_type: 'seller', seller_status: 'approved' });
  const TOKEN1 = sign({ id: 1, name: 'Seller One', email: 'seller1@x.com' });
  const TOKEN2 = sign({ id: 2, name: 'Seller Two', email: 'seller2@x.com' });

  r = await call(meProducts, { method: 'POST', query: { sub: 'products' }, token: TOKEN1, body: { name: 'Seller One Bow', price: 100 } });
  check(r.status === 200 && r.body.ok, 'seller 1 creates a product: ' + JSON.stringify(r.body));
  const productId = r.body.id;
  check(DB.products[0].seller_id === 1, 'the product is stamped with the REAL authenticated seller_id (1), not client-suppliable');

  section('a client cannot spoof seller_id on creation');
  r = await call(meProducts, { method: 'POST', query: { sub: 'products' }, token: TOKEN2, body: { name: 'Spoof attempt', price: 1, sellerId: 1 } });
  check(r.status === 200 && r.body.ok, 'seller 2 creates their own product');
  check(DB.products.find(p => p.id === r.body.id).seller_id === 2, 'even though seller 2 tried to claim sellerId:1 in the body, the row is stamped with their OWN real id (2)');

  section('each seller sees only their own products');
  const list1 = await call(meProducts, { method: 'GET', query: { sub: 'products' }, token: TOKEN1 });
  check(list1.body.length === 1 && list1.body[0].id === productId, 'seller 1\'s list shows only their own product');
  const list2 = await call(meProducts, { method: 'GET', query: { sub: 'products' }, token: TOKEN2 });
  check(list2.body.length === 1 && list2.body[0].id !== productId, 'seller 2\'s list shows only THEIR own product, not seller 1\'s');

  section('CRITICAL: a seller cannot edit or delete another seller\'s product');
  r = await call(meProducts, { method: 'PUT', query: { sub: 'products', pid: productId }, token: TOKEN2, body: { price: 1 } });
  check(r.status === 403, 'seller 2 editing seller 1\'s product -> 403, got ' + r.status);
  check(DB.products.find(p => p.id === productId).price === 100, 'price genuinely unchanged after the rejected cross-seller edit');

  r = await call(meProducts, { method: 'DELETE', query: { sub: 'products', pid: productId }, token: TOKEN2 });
  check(r.status === 403, 'seller 2 deleting seller 1\'s product -> 403, got ' + r.status);
  check(!!DB.products.find(p => p.id === productId), 'product genuinely still exists after the rejected cross-seller delete');

  section('a seller CAN edit and delete their own product');
  r = await call(meProducts, { method: 'PUT', query: { sub: 'products', pid: productId }, token: TOKEN1, body: { price: 120 } });
  check(r.status === 200 && r.body.ok, 'seller 1 edits their own product');
  check(DB.products.find(p => p.id === productId).price === 120, 'the price actually changed');
  r = await call(meProducts, { method: 'DELETE', query: { sub: 'products', pid: productId }, token: TOKEN1 });
  check(r.status === 200 && r.body.ok, 'seller 1 deletes their own product');
  check(!DB.products.find(p => p.id === productId), 'the product is actually gone');

  section('no auth at all is rejected');
  r = await call(meProducts, { method: 'POST', query: { sub: 'products' }, body: { name: 'x', price: 1 } });
  check(r.status === 401, 'no token -> 401');
  check(DB.products.length === 1, 'nothing was created (still just seller 2\'s earlier product)');

  section('a nonexistent product id is rejected the same way as cross-seller (no enumeration signal)');
  r = await call(meProducts, { method: 'PUT', query: { sub: 'products', pid: 999999 }, token: TOKEN1, body: { price: 1 } });
  check(r.status === 403, 'nonexistent product id -> 403 (not a distinguishable 404), got ' + r.status);

  process.exit(report() === 0 ? 0 : 1);
})();
