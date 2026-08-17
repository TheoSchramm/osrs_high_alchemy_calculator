/**
 * High Alchemy maths.
 *
 * Pure functions over plain data. Every number shown in the UI is derived here,
 * so a new column or stat only ever needs a new field on these return values.
 */

/** Experience granted per High Level Alchemy cast. */
export const XP_PER_CAST = 65;

/** Practical ceiling on casts per hour (one cast every 3 game ticks). */
export const CASTS_PER_HOUR = 1200;

/** Grand Exchange item id for a Nature rune. */
export const NATURE_RUNE_ITEM_ID = 561;

/** Fallback nature rune price used before the user or the API supplies one. */
export const DEFAULT_RUNE_PRICE = 200;

function num(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * @typedef {object} AlchItem
 * @property {string} id            stable local row id
 * @property {number|null} itemId   OSRS item id, when the item is known to the API
 * @property {string} name
 * @property {number} buyPrice      gp paid per item
 * @property {number} alchPrice     gp returned by one High Alchemy cast
 * @property {number} quantity      number of items / casts
 * @property {string|null} icon
 * @property {number|null} updatedAt epoch ms of the last price refresh
 */

/**
 * @typedef {object} AlchTotals
 * @property {number} costItems
 * @property {number} costRunes
 * @property {number} totalCost
 * @property {number} revenue
 * @property {number} profit
 * @property {number} profitPerCast
 * @property {number} roi           profit / totalCost, 0 when nothing is spent
 * @property {number} casts
 * @property {number} xp
 * @property {number} hours
 */

/**
 * Derive every figure for a single row.
 *
 * @param {Partial<AlchItem>} item
 * @param {{ runePrice?: number }} [context]
 * @returns {AlchTotals}
 */
export function computeItem(item, context = {}) {
  const runePrice = num(context.runePrice);
  const quantity = num(item?.quantity);
  const buyPrice = num(item?.buyPrice);
  const alchPrice = num(item?.alchPrice);

  const costItems = buyPrice * quantity;
  const costRunes = runePrice * quantity;
  const totalCost = costItems + costRunes;
  const revenue = alchPrice * quantity;
  const profit = revenue - totalCost;
  const profitPerCast = alchPrice - buyPrice - runePrice;

  return {
    costItems,
    costRunes,
    totalCost,
    revenue,
    profit,
    profitPerCast,
    roi: totalCost > 0 ? profit / totalCost : 0,
    casts: quantity,
    xp: quantity * XP_PER_CAST,
    hours: castsToHours(quantity),
  };
}

/**
 * Sum the derived figures across a list of rows.
 *
 * @param {Partial<AlchItem>[]} items
 * @param {{ runePrice?: number }} [context]
 * @returns {AlchTotals}
 */
export function computeTotals(items, context = {}) {
  const totals = {
    costItems: 0,
    costRunes: 0,
    totalCost: 0,
    revenue: 0,
    profit: 0,
    casts: 0,
    xp: 0,
  };

  for (const item of items ?? []) {
    const row = computeItem(item, context);
    totals.costItems += row.costItems;
    totals.costRunes += row.costRunes;
    totals.totalCost += row.totalCost;
    totals.revenue += row.revenue;
    totals.profit += row.profit;
    totals.casts += row.casts;
    totals.xp += row.xp;
  }

  return {
    ...totals,
    profitPerCast: totals.casts > 0 ? totals.profit / totals.casts : 0,
    roi: totals.totalCost > 0 ? totals.profit / totals.totalCost : 0,
    hours: castsToHours(totals.casts),
  };
}

/** Hours of clicking needed for a number of casts. */
export function castsToHours(casts) {
  const count = num(casts);
  return count > 0 ? count / CASTS_PER_HOUR : 0;
}

/**
 * Highest buy price at which an item still turns a profit.
 * Handy for "what should I bid?" and for future alerting features.
 */
export function breakEvenBuyPrice(alchPrice, runePrice) {
  return num(alchPrice) - num(runePrice);
}
