// Quick assertions for the pricing engine. Run: node api/_lib/pricing.test.js
'use strict';
const { computeQuote } = require('./pricing');

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (got === want) { pass++; console.log(`  ok   ${label} = ${got}`); }
  else { fail++; console.log(`  FAIL ${label}: got ${got}, want ${want}`); }
}

console.log('1) goods 50 CHF, standard (below free threshold 99)');
let q = computeQuote([{ id:1, name:'Arrow set', price:25, qty:2 }], { delivery:'standard' });
eq('goods', q.goods, 50); eq('delivery', q.deliveryFee, 5);
eq('tax(10%)', q.tax, 5); eq('platformFee(5%)', q.platformFee, 2.5);
eq('total', q.total, 62.5); eq('totalMinor', q.totalPaise, 6250);

console.log('2) goods 120 CHF, standard (>= threshold -> free delivery)');
q = computeQuote([{ id:2, name:'Riser', price:120, qty:1 }], { delivery:'standard' });
eq('delivery(free)', q.deliveryFee, 0); eq('tax', q.tax, 12);
eq('platformFee', q.platformFee, 6); eq('total', q.total, 138);

console.log('3) goods 50 CHF, express delivery');
q = computeQuote([{ id:1, name:'Arrow set', price:50, qty:1 }], { delivery:'sameday' });
eq('delivery(express)', q.deliveryFee, 15); eq('total', q.total, 72.5);

console.log('4) empty cart -> all zero');
q = computeQuote([], { delivery:'standard' });
eq('goods', q.goods, 0); eq('delivery', q.deliveryFee, 0); eq('total', q.total, 0);

console.log('5) admin override: tax 18%, platform 3%, sameday 199');
q = computeQuote([{ name:'Bow', price:1000, qty:1 }], { delivery:'sameday',
  config:{ taxRate:0.18, platformFeeRate:0.03, deliverySameDay:199 } });
eq('tax(18%)', q.tax, 180); eq('platformFee(3%)', q.platformFee, 30);
eq('delivery', q.deliveryFee, 199); eq('total', q.total, 1409);

console.log(`\n${fail === 0 ? 'ALL PASS' : 'SOME FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
