/** The four summary cards under the table. */

import { setText, setValueTone } from './dom.js';
import { formatNumber, formatSigned, formatDuration, formatPercent } from '../core/format.js';
import { selectTotals } from '../state/selectors.js';

export class StatsView {
  /**
   * @param {object} elements each is optional so the view degrades gracefully
   * @param {HTMLElement} [elements.totalProfit]
   * @param {HTMLElement} [elements.totalProfitNote]
   * @param {HTMLElement} [elements.totalXp]
   * @param {HTMLElement} [elements.totalTime]
   * @param {HTMLElement} [elements.totalCost]
   * @param {HTMLElement} [elements.totalCasts]
   */
  constructor(elements) {
    this.elements = elements ?? {};
  }

  /** @param {import('../state/store.js').AppState} state */
  render(state) {
    const totals = selectTotals(state);
    const { totalProfit, totalProfitNote, totalXp, totalTime, totalCost, totalCasts } = this.elements;

    if (totalProfit) {
      setText(totalProfit, `${formatSigned(totals.profit)} gp`);
      setValueTone(totalProfit, totals.profit);
    }

    if (totalProfitNote) {
      setText(
        totalProfitNote,
        totals.totalCost > 0
          ? `${formatPercent(totals.roi)} return · ${formatSigned(Math.round(totals.profitPerCast))} gp per cast`
          : 'Nothing spent yet',
      );
    }

    if (totalXp) setText(totalXp, `${formatNumber(totals.xp)} xp`);
    if (totalTime) setText(totalTime, formatDuration(totals.hours));
    if (totalCost) setText(totalCost, `${formatNumber(totals.totalCost)} gp`);
    if (totalCasts) setText(totalCasts, `${formatNumber(totals.casts)} casts`);
  }
}
