// Quick assertions for the GST-aware pricing engine. Run: node api/_lib/pricing.test.js
'use strict';
const { computeQuote, round2 } = require('./pricing');
const { isValidGstin, stateFromGstin } = require('./gst');

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (got === want) { pass++; console.log(`  ok   ${label} = ${got}`); }
  else { fail++; console.log(`  FAIL ${label}: got ${got}, want ${want}`); }
}
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
}

console.log('1) single item, free delivery (>=999), no known states -> defaults intra-state');
let q = computeQuote([{ id: 1, name: 'Bow', price: 2000, qty: 1 }], { delivery: 'standard' });
eq('goods', q.goods, 2000); eq('deliveryFee(free)', q.deliveryFee, 0);
eq('goods GST 5%', q.tax - 18, 100); // isolate the goods-line GST from the platform-fee GST for this assertion
eq('platformFee(5%)', q.platformFee, 100);
eq('cgst', q.cgst, 59); eq('sgst', q.sgst, 59); eq('igst', q.igst, 0);
eq('tax total (goods 5% + platformFee GST 18%)', q.tax, 118);
eq('total', q.total, 2218); eq('totalPaise', q.totalPaise, 221800);

console.log('\n2) same cart, EXPLICIT inter-state (seller Karnataka, buyer Maharashtra, platform Karnataka)');
q = computeQuote(
  [{ id: 1, name: 'Bow', price: 2000, qty: 1, sellerState: 'Karnataka' }],
  { delivery: 'standard', buyerState: 'Maharashtra', config: { platformRegisteredState: 'Karnataka' } }
);
eq('cgst', q.cgst, 0); eq('sgst', q.sgst, 0); eq('igst', q.igst, 118);
eq('total is state-guess-invariant', q.total, 2218); // same bottom line as test 1 — the split never changes what's charged

console.log('\n3) mixed-seller cart: one intra-state line, one inter-state line, plus the platform fee line');
q = computeQuote(
  [
    { id: 1, name: 'A (intra)', price: 1000, qty: 1, sellerState: 'Karnataka' },
    { id: 2, name: 'B (inter)', price: 1000, qty: 1, sellerState: 'Maharashtra' },
  ],
  { delivery: 'standard', buyerState: 'Karnataka' } // no platformRegisteredState configured -> platform fee defaults intra
);
eq('goods', q.goods, 2000); eq('deliveryFee(free)', q.deliveryFee, 0);
eq('cgst (A intra 25 + platformFee 9)', q.cgst, 34);
eq('sgst (A intra 25 + platformFee 9)', q.sgst, 34);
eq('igst (B inter 50)', q.igst, 50);
eq('gstBreakdown groups (A intra, B inter, platform fee)', q.gstBreakdown.length, 3);
const grpA = q.gstBreakdown.find(g => g.intra && g.hsnCode === '9506');
const grpB = q.gstBreakdown.find(g => !g.intra && g.hsnCode === '9506');
const grpFee = q.gstBreakdown.find(g => g.hsnCode === '9985');
ok('breakdown A is HSN 9506 intra, cgst+sgst=50', !!grpA && grpA.cgst + grpA.sgst === 50);
ok('breakdown B is HSN 9506 inter, igst=50', !!grpB && grpB.igst === 50);
ok('breakdown platform fee is SAC 9985 at 18%', !!grpFee && grpFee.rate === 0.18);

console.log('\n4) delivery fee (composite supply) is allocated across lines proportionally, with no leakage');
q = computeQuote(
  [
    { id: 1, name: 'A', price: 300, qty: 1 },
    { id: 2, name: 'B', price: 200, qty: 1 },
  ],
  { delivery: 'standard', config: { freeDeliveryThreshold: 999 } } // force a paid delivery case
);
eq('goods', q.goods, 500); eq('deliveryFee', q.deliveryFee, 5);
const goodsTaxable = q.gstBreakdown.filter(g => g.hsnCode === '9506').reduce((s, g) => s + g.taxableValue, 0);
eq('sum of goods-line taxable value == goods + deliveryFee (delivery fully allocated)', goodsTaxable, 505);

console.log('\n5) same-day delivery + admin-overridden default rate/platform rate (platform-fee GST rate is NOT admin-configurable)');
q = computeQuote([{ name: 'Recurve', price: 1000, qty: 1 }], {
  delivery: 'sameday',
  config: { taxRate: 0.18, platformFeeRate: 0.03, deliverySameDay: 199 },
});
eq('deliveryFee(sameday)', q.deliveryFee, 199);
eq('platformFee(3%)', q.platformFee, 30);
eq('tax (goods 18% of 1199 + platformFee 18% of 30)', q.tax, 221.22);
eq('total', q.total, 1450.22);

console.log('\n6) empty cart -> all zero');
q = computeQuote([], { delivery: 'standard' });
eq('goods', q.goods, 0); eq('deliveryFee', q.deliveryFee, 0);
eq('tax', q.tax, 0); eq('platformFee', q.platformFee, 0); eq('total', q.total, 0);

console.log('\n7) GSTIN validation + state lookup (2-digit prefix = GST state code)');
ok('valid GSTIN accepted', isValidGstin('29ABCDE1234F1Z5'));
ok('valid GSTIN -> Karnataka (state code 29)', stateFromGstin('29ABCDE1234F1Z5') === 'Karnataka');
ok('valid GSTIN, lowercase -> Delhi (state code 07)', stateFromGstin('07abcde1234f1z5') === 'Delhi');
ok('garbage string rejected', !isValidGstin('not-a-gstin'));
ok('wrong length rejected', !isValidGstin('1234567890ABCDE'));
ok('unknown state code -> null (25 was retired in 2020)', stateFromGstin('25ABCDE1234F1Z5') === null);

console.log('\n8) delivery allocation reconciles EXACTLY with no leaked/unreconciled paisa, even when prices split unevenly');
console.log('   (regression cases from adversarial review, 2026-08-13)');
q = computeQuote(
  [{ name: 'A', price: 333.33, qty: 1 }, { name: 'B', price: 333.33, qty: 1 }, { name: 'C', price: 333.33, qty: 1 }],
  { delivery: 'standard', config: { freeDeliveryThreshold: 999999 } }
);
let sum89 = q.gstBreakdown.filter(g => g.hsnCode === '9506').reduce((s, g) => s + g.taxableValue, 0);
eq('3x333.33 cart: goods+deliveryFee', round2(q.goods + q.deliveryFee), 1004.99);
eq('3x333.33 cart: breakdown reconciles exactly (was 1048.98, short by a paisa)', round2(sum89), round2(q.goods + q.deliveryFee));

q = computeQuote(
  [37.13, 58.71, 91.03, 12.45, 66.66, 5.01, 123.45, 9.99].map((price, i) => ({ name: 'item' + i, price, qty: 1 })),
  { delivery: 'standard', config: { deliveryStandard: 173, freeDeliveryThreshold: 999999 } }
);
let sum8b = q.gstBreakdown.filter(g => g.hsnCode === '9506').reduce((s, g) => s + g.taxableValue, 0);
eq('8-item uneven cart: breakdown reconciles exactly (was 577.42, short by a paisa)', round2(sum8b), round2(q.goods + q.deliveryFee));

console.log(`\n${fail === 0 ? 'ALL PASS' : 'SOME FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
