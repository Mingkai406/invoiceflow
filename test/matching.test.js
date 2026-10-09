const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cents, money, match } = require('../srv/lib/matching');
const order = { items: [{ ID: 'a', description: 'Sensor', quantity: 100, unitPrice: '0.10' }] };
const line = (quantity = 10, unitPrice = '0.10') => [{ orderItemID: 'a', quantity, unitPrice }];

test('decimal money stays exact, including a one-cent difference', () => {
  assert.equal(money(cents('0.10') * 3n), '0.30');
  assert.equal(match(order, line(3), [{ item_ID: 'a', quantity: 100 }]).total, '0.30');
  assert.equal(
    match(order, line(3, '0.11'), [{ item_ID: 'a', quantity: 100 }]).findings[0].code,
    'PRICE_MISMATCH',
  );
});
test('reject unsupported money inputs instead of rounding', () => {
  for (const value of ['-1', '1.001', '1e3', 'NaN', '', null]) assert.throws(() => cents(value));
});
test('partial receipt reports the actual available quantity', () => {
  const f = match(order, line(100), [{ item_ID: 'a', quantity: 80 }]).findings[0];
  assert.equal(f.code, 'QUANTITY_MISMATCH');
  assert.equal(f.remaining, 80);
});
test('missing receipt is different from a price mismatch', () => {
  assert.equal(match(order, line(), []).findings[0].code, 'MISSING_RECEIPT');
});
test('multiple receipts aggregate, capped by ordered quantity', () => {
  assert.equal(
    match(order, line(100), [
      { item_ID: 'a', quantity: 40 },
      { item_ID: 'a', quantity: 60 },
    ]).findings.length,
    0,
  );
  assert.equal(
    match(order, line(101), [{ item_ID: 'a', quantity: 110 }]).findings[0].remaining,
    100,
  );
});
test('approved invoices reduce remaining receipt quantity', () => {
  assert.equal(
    match(order, line(30), [{ item_ID: 'a', quantity: 100 }], [{ orderItem_ID: 'a', quantity: 80 }])
      .findings[0].remaining,
    20,
  );
});
test('items from another order cannot be matched', () => {
  assert.throws(() => match(order, [{ orderItemID: 'unknown', quantity: 1, unitPrice: '1' }], []));
});
