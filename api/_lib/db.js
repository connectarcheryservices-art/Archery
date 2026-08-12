// Postgres pool for Supabase. Server-side only — never import in the browser.
//
// TLS (THREAT_MODEL T8): this previously used `rejectUnauthorized: false`, which
// disables certificate verification entirely and makes the connection — carrying
// every order, password hash and PII row — trivially MITM-able.
//
// It could not simply be flipped to `true`: Supabase's pooler presents a chain
// signed by their own root ("Supabase Root 2021 CA"), which is not in Node's
// public CA bundle, so verification fails against it. The correct fix is to PIN
// that root, which is what we do here. Verified empirically:
//   • pinned CA + rejectUnauthorized:true -> connects
//   • a tampered CA                        -> rejected
// so verification is genuinely enforced, not decorative.
//
// The cert is Supabase's published root (api/_certs/supabase-prod-ca-2021.crt),
// valid to 2031-04-26. When Supabase rotates it, replace the file.
'use strict';
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const CA_PATH = path.join(__dirname, '..', '_certs', 'supabase-prod-ca-2021.crt');

let caCache;
function supabaseCa() {
  if (caCache !== undefined) return caCache;
  try { caCache = fs.readFileSync(CA_PATH, 'utf8'); }
  catch (e) { caCache = null; console.error('db: CA cert missing at', CA_PATH, '-', e.message); }
  return caCache;
}

// Only pin for Supabase hosts. A self-hosted/local Postgres (dev, CI) may present
// a different chain or no TLS at all, and must not be forced onto Supabase's root.
function sslFor(cs) {
  const isSupabase = /supabase\.(co|com|net)/i.test(cs);
  if (!isSupabase) {
    // Local/CI Postgres. If it speaks TLS we still verify against the system store.
    return /sslmode=disable/i.test(cs) ? false : { rejectUnauthorized: true };
  }
  const ca = supabaseCa();
  if (!ca) {
    // Fail loudly rather than silently downgrading to an unverified connection.
    throw new Error('Supabase CA certificate not found — refusing to connect without TLS verification (see api/_lib/db.js).');
  }
  return { rejectUnauthorized: true, ca };
}

let pool;
function getPool() {
  if (pool) return pool;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL is not set');
  pool = new Pool({
    connectionString: cs,
    ssl: sslFor(cs),
    max: 1,                  // one socket per serverless instance; the pooler handles concurrency
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
  });
  // node-postgres's own docs: an idle pooled client can be dropped by the
  // server (network blip, pooler restart, idle timeout) at any time, and
  // that surfaces as an 'error' event on the Pool. With no listener, Node's
  // default behaviour for an unhandled EventEmitter 'error' is to throw —
  // which on a Pool means CRASHING THE WHOLE PROCESS over one idle
  // connection being closed, not just failing whatever request happens to
  // reuse it next. Observed directly during local testing (an idle-client
  // ECONNRESET took down the entire dev server). A no-op handler here is
  // the documented fix: the next q() call gets a fresh connection instead.
  pool.on('error', (err) => { console.error('db: idle pool connection error (recovering):', err?.message); });
  return pool;
}

async function q(text, params = []) {
  const client = await getPool().connect();
  try { return await client.query(text, params); }
  finally { client.release(); }
}

// Runs fn(client) inside a single BEGIN/COMMIT — use for any multi-statement
// mutation where a failure partway through must leave NOTHING committed,
// rather than a partial row set with no audit trail of what happened
// (caught by adversarial audit review, 2026-08-12: api/_handlers/selection.js
// 'generate' inserted a selections row then looped inserting
// selection_entries as separate autocommit statements — a dropped
// connection or constraint violation mid-loop left a real, permanent,
// completely unaudited partial selection behind). fn must run its queries
// against the CLIENT it's given, not the pool's q(), so every statement
// shares the same transaction.
async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { getPool, q, withTransaction };
