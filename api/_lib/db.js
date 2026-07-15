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
  return pool;
}

async function q(text, params = []) {
  const client = await getPool().connect();
  try { return await client.query(text, params); }
  finally { client.release(); }
}

module.exports = { getPool, q };
