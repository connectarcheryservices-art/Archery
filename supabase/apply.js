// One-shot schema applier. Runs schema.sql then every migration in order against
// DATABASE_URL, then prints a verification report (table + index + row counts).
//   Usage:  DATABASE_URL="postgresql://...:5432/postgres" node supabase/apply.js
// Use the DIRECT connection (port 5432) or the Session pooler for DDL — the
// Transaction pooler (6543) also works for this one-off but is meant for the app.
'use strict';
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
// TLS: verify against Supabase's pinned root rather than disabling verification
// (THREAT_MODEL T8). This script carries the DB password.
const CA = (() => {
  try { return fs.readFileSync(path.join(__dirname, '..', 'api', '_certs', 'supabase-prod-ca-2021.crt'), 'utf8'); }
  catch (e) { try { return fs.readFileSync(path.join(__dirname, 'api', '_certs', 'supabase-prod-ca-2021.crt'), 'utf8'); } catch (e2) { return null; } }
})();
if (!CA) { console.error('Supabase CA cert not found — refusing to connect unverified.'); process.exit(1); }

async function runFile(client, file) {
  const sql = fs.readFileSync(file, 'utf8');
  process.stdout.write(`\n▶ ${path.basename(file)} … `);
  await client.query(sql);            // whole file as one simple query (handles $$ blocks)
  console.log('done');
}

(async () => {
  const cs = process.env.DATABASE_URL;
  if (!cs) { console.error('DATABASE_URL not set'); process.exit(1); }
  const client = new Client({ connectionString: cs, ssl: { rejectUnauthorized: true, ca: CA }, connectionTimeoutMillis: 15000 });
  await client.connect();
  console.log('Connected to Supabase.');

  const base = __dirname;
  await runFile(client, path.join(base, 'schema.sql'));
  const migDir = path.join(base, 'migrations');
  if (fs.existsSync(migDir)) {
    for (const f of fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
      await runFile(client, path.join(migDir, f));
    }
  }

  console.log('\n── Verification ──');
  const tables = await client.query(
    `select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from %I', table_name), false, true, '')))[1]::text::int n
     from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name`);
  for (const r of tables.rows) console.log(`  ${r.table_name.padEnd(20)} ${r.n} rows`);
  const idx = await client.query(`select count(*)::int n from pg_indexes where schemaname='public'`);
  const fts = await client.query(`select count(*)::int n from information_schema.columns where table_schema='public' and column_name='search'`);
  const cons = await client.query(`select count(*)::int n from pg_constraint where contype='c'`);
  console.log(`\n  ${tables.rows.length} tables · ${idx.rows[0].n} indexes · ${fts.rows[0].n} full-text columns · ${cons.rows[0].n} check constraints`);
  console.log('\n✅ Schema + migrations applied successfully.');
  await client.end();
  process.exit(0);
})().catch(e => { console.error('\n❌ ' + e.message); process.exit(1); });
