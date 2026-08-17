import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeItem,
  computeTotals,
  castsToHours,
  breakEvenBuyPrice,
  XP_PER_CAST,
  CASTS_PER_HOUR,
} from '../src/core/alchemy.js';

const RUNE = 200;

/** Adamant platebody: the canonical worked example from the original app. */
const platebody = {
  id: 'a',
  name: 'Adamant platebody',
  buyPrice: 4000,
  alchPrice: 9600,
  quantity: 100,
};

test('computeItem: profit matches the original formula', () => {
  const derived = computeItem(platebody, { runePrice: RUNE });

  assert.equal(derived.costItems, 400_000);
  assert.equal(derived.costRunes, 20_000);
  assert.equal(derived.totalCost, 420_000);
  assert.equal(derived.revenue, 960_000);
  // (9600 - 4000 - 200) * 100
  assert.equal(derived.profit, 540_000);
  assert.equal(derived.profitPerCast, 5400);
});

test('computeItem: xp and time derive from quantity', () => {
  const derived = computeItem(platebody, { runePrice: RUNE });
  assert.equal(derived.casts, 100);
  assert.equal(derived.xp, 100 * XP_PER_CAST);
  assert.equal(derived.hours, 100 / CASTS_PER_HOUR);
});

test('computeItem: losing item reports a negative profit', () => {
  const derived = computeItem(
    { buyPrice: 10_000, alchPrice: 9600, quantity: 10 },
    { runePrice: RUNE },
  );
  assert.equal(derived.profit, -6000);
  assert.equal(derived.profitPerCast, -600);
  assert.ok(derived.roi < 0);
});

test('computeItem: zero quantity is safe and ROI does not divide by zero', () => {
  const derived = computeItem({ buyPrice: 100, alchPrice: 200, quantity: 0 }, { runePrice: RUNE });
  assert.equal(derived.profit, 0);
  assert.equal(derived.roi, 0);
  assert.equal(derived.hours, 0);
  // Per-cast margin is still meaningful with no quantity entered yet.
  assert.equal(derived.profitPerCast, -100);
});

test('computeItem: missing and non-numeric fields degrade to zero', () => {
  const derived = computeItem({}, {});
  assert.deepEqual(
    { profit: derived.profit, revenue: derived.revenue, totalCost: derived.totalCost },
    { profit: 0, revenue: 0, totalCost: 0 },
  );

  const junk = computeItem({ buyPrice: 'abc', alchPrice: null, quantity: undefined }, {});
  assert.ok(Number.isFinite(junk.profit));
  assert.equal(junk.profit, 0);
});

test('computeItem: ROI is profit over total spend', () => {
  const derived = computeItem(platebody, { runePrice: RUNE });
  assert.equal(derived.roi, 540_000 / 420_000);
});

test('computeTotals: sums every row', () => {
  const items = [
    platebody,
    { id: 'b', name: 'Yew longbow', buyPrice: 300, alchPrice: 768, quantity: 50 },
  ];
  const totals = computeTotals(items, { runePrice: RUNE });

  assert.equal(totals.casts, 150);
  assert.equal(totals.xp, 150 * XP_PER_CAST);
  assert.equal(totals.costItems, 400_000 + 15_000);
  assert.equal(totals.costRunes, 150 * RUNE);
  assert.equal(totals.revenue, 960_000 + 38_400);
  assert.equal(totals.profit, 540_000 + (768 - 300 - 200) * 50);
});

test('computeTotals: empty and invalid inputs are neutral', () => {
  for (const input of [[], null, undefined]) {
    const totals = computeTotals(input, { runePrice: RUNE });
    assert.equal(totals.profit, 0);
    assert.equal(totals.casts, 0);
    assert.equal(totals.hours, 0);
    assert.equal(totals.roi, 0);
    assert.equal(totals.profitPerCast, 0);
  }
});

test('computeTotals: weighted per-cast profit', () => {
  const items = [
    { buyPrice: 0, alchPrice: 1200, quantity: 100 }, // +1000/cast
    { buyPrice: 0, alchPrice: 400, quantity: 100 }, //  +200/cast
  ];
  const totals = computeTotals(items, { runePrice: RUNE });
  assert.equal(totals.profitPerCast, 600);
});

test('castsToHours', () => {
  assert.equal(castsToHours(1200), 1);
  assert.equal(castsToHours(600), 0.5);
  assert.equal(castsToHours(0), 0);
  assert.equal(castsToHours(-5), 0);
});

test('breakEvenBuyPrice', () => {
  assert.equal(breakEvenBuyPrice(9600, 200), 9400);
  assert.equal(breakEvenBuyPrice(0, 0), 0);
});
