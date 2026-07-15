// Minimal test helpers — no framework, no dependency. Node only.
//
// Handlers are serverless functions of (req, res). These fakes let a test drive
// the REAL handler and assert on the real response, stubbing only Postgres.
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = p => path.join(ROOT, p);

/**
 * Replace api/_lib/db.js in the require cache with a fake `q`.
 * Call BEFORE requiring any handler. Returns a restore function.
 */
function stubDb(q) {
  const p = require.resolve(R('api/_lib/db.js'));
  const prev = require.cache[p];
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { q, pool: null } };
  return () => { if (prev) require.cache[p] = prev; else delete require.cache[p]; };
}

/** Invoke a serverless handler and resolve with {status, body}. */
function call(handler, { method = 'POST', body = {}, query = {}, token = null, ip = '1.2.3.4', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method, body, query,
      headers: Object.assign({}, headers, token ? { authorization: 'Bearer ' + token } : {}),
      socket: { remoteAddress: ip },
    };
    const res = {
      _s: 200, statusCode: 200, _headers: {},
      setHeader(k, v) { this._headers[String(k).toLowerCase()] = v; return this; },
      status(c) { this._s = c; return this; },
      json(o) { resolve({ status: this._s, body: o, headers: this._headers }); return this; },
      end() { resolve({ status: this._s, body: null, headers: this._headers }); return this; },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

// ── assertions ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function check(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; failures.push(msg); console.log('  ✗ ' + msg); }
  return !!cond;
}
function section(name) { console.log('\n' + name); }
function report() {
  console.log('\n' + (failed === 0
    ? `${passed} passed`
    : `${passed} passed, ${failed} FAILED:\n` + failures.map(f => '  - ' + f).join('\n')));
  return failed;
}
function reset() { passed = 0; failed = 0; failures.length = 0; }
function counts() { return { passed, failed }; }

module.exports = { R, ROOT, stubDb, call, check, section, report, reset, counts };
