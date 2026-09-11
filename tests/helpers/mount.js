/**
 * Mounts the real index.html in jsdom and boots the app against a stubbed API.
 *
 * Using the shipped markup (rather than a hand-written fixture) is what makes
 * these regression tests meaningful: if a selector, id or template changes, the
 * tests notice.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { AppStore } from '../../src/state/store.js';
import { PricesApi } from '../../src/data/prices-api.js';
import { createMemoryStorage } from '../../src/data/storage.js';
import { createApp } from '../../src/ui/app.js';
import { createFakeFetch } from './fake-api.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX_HTML = fs.readFileSync(path.join(PROJECT_ROOT, 'index.html'), 'utf8');

/**
 * @param {object} [options]
 * @param {Storage} [options.storage]      pre-seed to test migrations
 * @param {typeof fetch} [options.fetch]
 * @param {object} [options.initialState]
 * @returns {{dom: JSDOM, document: Document, window: Window, store: AppStore, api: PricesApi, app: object, cleanup: () => void}}
 */
export function mountApp(options = {}) {
  const dom = new JSDOM(INDEX_HTML, { url: 'http://localhost:4173/' });
  const { document, window } = dom.window;

  const storage = options.storage ?? createMemoryStorage();
  const store = options.store ?? new AppStore({ storage, initialState: options.initialState });
  const fetchImpl = options.fetch ?? createFakeFetch();
  const api = options.api ?? new PricesApi({ fetch: fetchImpl });

  const app = createApp({
    root: document,
    store,
    api,
    // No debounce and no auto-dismiss: tests drive time explicitly.
    searchDebounceMs: 0,
    toastTimeoutMs: 0,
    now: options.now,
    timers: options.timers,
    isVisible: options.isVisible,
  });

  return {
    dom,
    document,
    window,
    storage,
    store,
    api,
    fetchImpl,
    app,
    cleanup() {
      app.destroy();
      window.close();
    },
  };
}

/* ------------------------------------------------------------------ query */

/** Visible rows, in render order. */
export function rows(document) {
  return [...document.querySelectorAll('#itemsBody tr')];
}

/** Text of every cell in a row, keyed by its `data-column`. */
export function rowCells(tr) {
  const cells = {};
  for (const td of tr.querySelectorAll('td[data-column]')) {
    cells[td.dataset.column] = td.textContent.trim().replace(/\s+/g, ' ');
  }
  return cells;
}

export function text(document, selector) {
  return document.querySelector(selector)?.textContent.trim() ?? null;
}

export function toastMessages(document) {
  return [...document.querySelectorAll('.toast__message')].map((node) => node.textContent);
}

/* ---------------------------------------------------------------- actions */

export function click(node) {
  node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent('click', {
    bubbles: true,
    cancelable: true,
  }));
}

/** Type into an `<input>` and fire the `input` event listeners rely on. */
export function type(input, value) {
  input.value = value;
  input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }));
}

/** Tick or clear a checkbox and fire the `change` listeners rely on. */
export function toggle(checkbox, checked = !checkbox.checked) {
  checkbox.checked = checked;
  checkbox.dispatchEvent(new checkbox.ownerDocument.defaultView.Event('change', { bubbles: true }));
}

export function change(select, value) {
  select.value = value;
  select.dispatchEvent(new select.ownerDocument.defaultView.Event('change', { bubbles: true }));
}

export function submitForm(form) {
  form.dispatchEvent(new form.ownerDocument.defaultView.Event('submit', {
    bubbles: true,
    cancelable: true,
  }));
}

/** Edit a contenteditable cell the way a user would: type, then move away. */
export function editCell(cell, value) {
  cell.textContent = value;
  cell.dispatchEvent(new cell.ownerDocument.defaultView.FocusEvent('focusout', { bubbles: true }));
}

export function keydown(node, key) {
  const event = new node.ownerDocument.defaultView.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  node.dispatchEvent(event);
  return event;
}

/** Let queued microtasks and zero-delay timers run. */
export function flush(times = 3) {
  return new Promise((resolve) => {
    let remaining = times;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  });
}
