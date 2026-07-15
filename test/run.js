// Test runner. `npm test` — must be green to merge (CLAUDE.md §1.10).
//
// Each *.test.js runs in its OWN process: the auth tests stub the db module in
// the require cache, and that must not leak into another suite.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = [
  ...fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).map(f => path.join(__dirname, f)),
  // Suites that still live next to their source.
  path.join(__dirname, '..', 'api', '_lib', 'pricing.test.js'),
].filter(fs.existsSync);

let failed = 0;
for (const f of files) {
  const name = path.relative(path.join(__dirname, '..'), f);
  console.log('\n══ ' + name + ' ' + '═'.repeat(Math.max(0, 60 - name.length)));
  try {
    execFileSync(process.execPath, [f], { stdio: 'inherit' });
  } catch (e) {
    failed++;
    console.log('\n✗ ' + name + ' FAILED');
  }
}

console.log('\n' + '─'.repeat(64));
if (failed) { console.log(`${failed} of ${files.length} suite(s) FAILED — do not merge.`); process.exit(1); }
console.log(`${files.length} suite(s) passed.`);
