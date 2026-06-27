// Postgres pool for Supabase. Server-side only — never import in the browser.
// Uses the pooled "Transaction" connection (DATABASE_URL, host ...pooler.supabase.com:6543).
'use strict';
const { Pool } = require('pg');

let pool;
function getPool() {
  if (pool) return pool;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL is not set');
  pool = new Pool({
    connectionString: cs,
    ssl: { rejectUnauthorized: false },
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
