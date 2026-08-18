import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAmount,
  toNonNegativeInt,
  formatNumber,
  formatSigned,
  formatCompact,
  formatDuration,
  formatPercent,
} from '../src/core/format.js';

test('parseAmount: plain numbers', () => {
  assert.equal(parseAmount('0'), 0);
  assert.equal(parseAmount('250'), 250);
  assert.equal(parseAmount(1234), 1234);
  assert.equal(parseAmount(1234.6), 1235);
  assert.equal(parseAmount('  42  '), 42);
});

test('parseAmount: comma-grouped thousands', () => {
  assert.equal(parseAmount('1,234'), 1234);
  assert.equal(parseAmount('12,345,678'), 12345678);
});

test('parseAmount: dot-grouped thousands (EU style)', () => {
  assert.equal(parseAmount('1.234'), 1234);
  assert.equal(parseAmount('12.345.678'), 12345678);
});

test('parseAmount: separators group digits, they never mark a fraction', () => {
  // These are whole gp and the field renders them with commas, so a separator
  // can only be grouping. A fraction still works where it means something,
  // against a multiplier: see the k/m/b cases below.
  assert.equal(parseAmount('1.5'), 15);
  assert.equal(parseAmount('0.4'), 4);
});

test('parseAmount: editing a formatted value does not collapse it', () => {
  // Typing a digit into "9,500" gives "9,5100", which is not a clean grouping.
  // Guessing at the separator used to read the comma as a decimal point and
  // turn 95,100 gp into 10; deleting a digit did the same in reverse.
  assert.equal(parseAmount('9,500'), 9500, 'the value as the field renders it');
  assert.equal(parseAmount('9,5100'), 95_100, 'a digit typed in the middle');
  assert.equal(parseAmount('9,50'), 950, 'a digit deleted from the middle');
  assert.equal(parseAmount('9.5100'), 95_100, 'and the same with dot grouping');

  // Whatever the separators end up looking like mid-edit, the digits win.
  assert.equal(parseAmount('9,510,0'), 95_100);
});

test('parseAmount: k/m/b shorthand', () => {
  assert.equal(parseAmount('10k'), 10_000);
  assert.equal(parseAmount('1.5m'), 1_500_000);
  assert.equal(parseAmount('2B'), 2_000_000_000);
  assert.equal(parseAmount('1,5k'), 1500, 'comma reads as a decimal point before a suffix');
});

test('parseAmount: currency suffixes are ignored', () => {
  assert.equal(parseAmount('250gp'), 250);
  assert.equal(parseAmount('1,000 coins'), 1000);
});

test('parseAmount: signs', () => {
  assert.equal(parseAmount('-500'), -500);
  assert.equal(parseAmount('+500'), 500);
  assert.equal(parseAmount('-1.5k'), -1500);
});

test('parseAmount: garbage never produces NaN', () => {
  for (const input of ['', '   ', 'abc', null, undefined, {}, [], NaN, Infinity, '1..2.3']) {
    const result = parseAmount(input);
    assert.ok(Number.isFinite(result), `expected finite for ${String(input)}`);
  }
  assert.equal(parseAmount('abc'), 0);
  assert.equal(parseAmount(NaN), 0);
});

test('toNonNegativeInt clamps at zero', () => {
  assert.equal(toNonNegativeInt('-5'), 0);
  assert.equal(toNonNegativeInt('5'), 5);
  assert.equal(toNonNegativeInt('abc'), 0);
});

test('formatNumber', () => {
  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(-1234), '-1,234');
  assert.equal(formatNumber(NaN), '0');
  assert.equal(formatNumber(undefined), '0');
});

test('formatSigned', () => {
  assert.equal(formatSigned(1234), '+1,234');
  assert.equal(formatSigned(-1234), '-1,234');
  assert.equal(formatSigned(0), '0');
});

test('formatCompact', () => {
  assert.equal(formatCompact(999), '999');
  assert.equal(formatCompact(9999), '9,999');
  assert.equal(formatCompact(15_000), '15K');
  assert.equal(formatCompact(1_500_000), '1.5M');
  assert.equal(formatCompact(2_000_000_000), '2B');
  assert.equal(formatCompact(-1_500_000), '-1.5M');
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(-1), '0m');
  assert.equal(formatDuration(0.75), '45m');
  assert.equal(formatDuration(3.4), '3h 24m');
  assert.equal(formatDuration(1), '1h 0m');
});

test('formatPercent', () => {
  assert.equal(formatPercent(0.1234), '12.3%');
  assert.equal(formatPercent(0), '0.0%');
  assert.equal(formatPercent(NaN), '0%');
});
