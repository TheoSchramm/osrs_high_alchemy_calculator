/** The four summary cards under the table. */

import { setText, setValueTone } from './dom.js';
import { formatNumber, formatSigned, formatDuration, formatPercent } from '../core/format.js';
import { selectTotals } from '../state/selectors.js';
import { CASTS_PER_HOUR } from '../core/alchemy.js';

export class StatsView {
  /**
   * @param {object} elements each is optional so the view degrades gracefully
   * @param {HTMLElement} [elements.totalProfit]
   * @param {HTMLElement} [elements.totalProfitNote]
   * @param {HTMLElement} [elements.totalXp]
   * @param {HTMLElement} [elements.totalTime]
   * @param {HTMLElement} [elements.totalCost]
   * @param {HTMLElement} [elements.castRate]
   * @param {HTMLElement} [elements.totalSplit]
   */
  constructor(elements) {
    this.elements = elements ?? {};
  }

  /** @param {import('../state/store.js').AppState} state */
  render(state) {
    const totals = selectTotals(state);
    const {
      totalProfit, totalProfitNote, totalXp, totalTime, totalCost, castRate, totalSplit,
    } = this.elements;

    if (totalProfit) {
      setText(totalProfit, `${formatSigned(totals.profit)} gp`);
      setValueTone(totalProfit, totals.profit);
    }

    if (totalProfitNote) {
      setText(
        totalProfitNote,
        totals.totalCost > 0
          ? `${formatPercent(totals.roi)} return\n${formatSigned(Math.round(totals.profitPerCast))} gp per cast`
          : 'Nothing spent yet',
      );
    }

    if (totalXp) setText(totalXp, `${formatNumber(totals.xp)} xp`);
    if (totalTime) setText(totalTime, formatDuration(totals.hours));
    if (totalCost) setText(totalCost, `${formatNumber(totals.totalCost)} gp`);

    // The rate the estimate is made from. Written from the constant rather than
    // left as prose in the markup, so the two cannot drift apart.
    if (castRate) setText(castRate, `${formatNumber(CASTS_PER_HOUR)} casts an hour`);

    // What the money went on. Nature runes are a real share of the cost when
    // the items are cheap, and nothing else on the page totals them.
    if (totalSplit) {
      setText(
        totalSplit,
        totals.totalCost > 0
          ? `${formatNumber(totals.costItems)} on items\n${formatNumber(totals.costRunes)} on runes`
          : 'Items and nature runes',
      );
    }
  }
}
