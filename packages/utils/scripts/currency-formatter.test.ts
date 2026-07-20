import assert from 'node:assert/strict';
import test from 'node:test';

import { getCurrencyFormatter } from '../src/functions/currency.js';

const format = (currency: string | undefined) => getCurrencyFormatter(currency).format(10);

test('preserves supported ISO currency codes', () => {
  assert.equal(format('USD'), '$10.00');
  assert.match(format('NGN'), /₦\s?10\.00/);
  assert.equal(format('EUR'), '€10.00');
  assert.equal(format('GBP'), '£10.00');
});

test('normalizes currency codes and defaults invalid input to USD', () => {
  assert.equal(format('eur'), '€10.00');
  assert.equal(format(undefined), '$10.00');
  assert.equal(format(''), '$10.00');
  assert.equal(format('not-a-currency'), '$10.00');
});
