/**
 * Periodic price polling.
 *
 * Timers, the clock and the page-visibility source are all injected, so this
 * can be driven deterministically in tests without waiting on real time.
 *
 * The rules it enforces, in one place:
 *  - never overlap requests; a slow poll delays the next one rather than
 *    stacking on top of it
 *  - never poll when nothing in the list is known to the Grand Exchange
 *  - never poll while the tab is hidden, and catch up on the way back
 *  - a failure does not stop the schedule, it just reports and tries again
 */

import { selectRefreshableIds } from './selectors.js';

export class AutoRefresher {
  /**
   * @param {object} config
   * @param {import('./store.js').AppStore} config.store
   * @param {import('../data/prices-api.js').PricesApi} config.api
   * @param {{ setTimeout: Function, clearTimeout: Function }} [config.timers]
   * @param {() => number} [config.now]
   * @param {() => boolean} [config.isVisible] false pauses polling
   * @param {(event: {type: string, count?: number, error?: Error}) => void} [config.onEvent]
   */
  constructor(config) {
    this.store = config.store;
    this.api = config.api;
    this.timers = config.timers ?? globalThis;
    this.now = config.now ?? (() => Date.now());
    this.isVisible = config.isVisible ?? (() => true);
    this.onEvent = config.onEvent ?? (() => {});

    this.handle = null;
    this.inFlight = false;
    /** Epoch ms of the last completed poll, successful or not. */
    this.lastPollAt = 0;
    /** Set when a poll was skipped because the tab was hidden. */
    this.missedWhileHidden = false;
  }

  /** @returns {number} the configured interval, 0 when auto-refresh is off */
  get intervalMs() {
    const value = Number(this.store.getState().autoRefreshMs);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  /** Begin (or restart) the schedule. Safe to call repeatedly. */
  start() {
    this.stop();
    if (this.intervalMs === 0) return;
    this._schedule(this.intervalMs);
  }

  stop() {
    if (this.handle !== null) {
      this.timers.clearTimeout(this.handle);
      this.handle = null;
    }
  }

  /**
   * Call when the interval setting changes, so the new value takes effect
   * without waiting out the old one.
   */
  reschedule() {
    this.start();
  }

  /**
   * Call when the page becomes visible again. Polls straight away if the tab
   * was hidden across a due tick, so a returning user does not stare at prices
   * that stopped updating.
   */
  handleVisibilityChange() {
    if (!this.isVisible() || this.intervalMs === 0) return;

    const overdue = this.now() - this.lastPollAt >= this.intervalMs;
    if (this.missedWhileHidden || overdue) {
      this.missedWhileHidden = false;
      void this.poll();
    }
    this.start();
  }

  _schedule(delayMs) {
    this.handle = this.timers.setTimeout(() => {
      this.handle = null;
      void this._tick();
    }, delayMs);
  }

  async _tick() {
    await this.poll();
    // Re-read the interval: it may have changed while the request was open.
    if (this.intervalMs > 0) this._schedule(this.intervalMs);
  }

  /**
   * Run one refresh now, regardless of the schedule.
   * @returns {Promise<number|null>} items updated, or null if it did not run
   */
  async poll() {
    if (this.inFlight) return null;

    if (!this.isVisible()) {
      this.missedWhileHidden = true;
      return null;
    }

    const state = this.store.getState();
    const ids = selectRefreshableIds(state);
    if (ids.length === 0) return null;

    this.inFlight = true;
    this.onEvent({ type: 'start' });

    try {
      const snapshots = await this.api.getSnapshots(ids, { priceBasis: state.priceBasis });

      let updated = 0;
      // Re-read items: the list may have changed while the request was open.
      for (const item of this.store.getState().items) {
        const snapshot = item.itemId ? snapshots.get(item.itemId) : null;
        if (!snapshot) continue;
        // No force: a timer the user did not trigger must leave their edits alone.
        this.store.applySnapshot(item.id, snapshot);
        updated += 1;
      }

      this.lastPollAt = this.now();
      this.onEvent({ type: 'success', count: updated });
      return updated;
    } catch (error) {
      this.lastPollAt = this.now();
      this.onEvent({ type: 'error', error });
      return null;
    } finally {
      this.inFlight = false;
    }
  }
}
