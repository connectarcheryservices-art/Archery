// Quick assertions for the pricing engine. Run: node api/_lib/pricing.test.js
'use strict';
const { computeQuote } = require('./pricing');

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (got === want) { pass++; console.log(`  ok   ${label} = ${got}`); }
  else { fail++; console.log(`  FAIL ${label}: got ${got}, want ${want}`); }
}

console.log('1) goods 500, standard (below free threshold 999)');
let q = computeQuote([{ id:1, name:'Arrow set', price:250, qty:2 }], { delivery:'standard' });
eq('goods', q.goods, 500); eq('delivery', q.deliveryFee, 49);
eq('tax(10%)', q.tax, 50); eq('platformFee(5%)', q.platformFee, 25);
eq('total', q.total, 624); eq('totalPaise', q.totalPaise, 62400);

console.log('2) goods 1200, standard (>= threshold -> free delivery)');
q = computeQuote([{ id:2, name:'Riser', price:1200, qty:1 }], { delivery:'standard' });
eq('delivery(free)', q.deliveryFee, 0); eq('tax', q.tax, 120);
eq('platformFee', q.platformFee, 60); eq('total', q.total, 1380);

console.log('3) goods 500, same-day delivery');
q = computeQuote([{ id:1, name:'Arrow set', price:500, qty:1 }], { delivery:'sameday' });
eq('delivery(sameday)', q.deliveryFee, 149); eq('total', q.total, 724);

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
