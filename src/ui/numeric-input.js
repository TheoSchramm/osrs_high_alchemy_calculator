/**
 * Keep amount fields to characters that can actually form an amount.
 *
 * Typing is blocked at `beforeinput` rather than by rewriting the value after
 * the fact: rewriting fights the caret, and the caret in a contenteditable
 * cell is worse still. Refusing the keystroke leaves the caret exactly where
 * the user put it.
 *
 * "Numbers only" here means numbers as this app writes them, which includes the
 * shorthand the interface itself advertises: `10k`, `1.5m`, `1,234`. Blocking
 * `k` would contradict the hint under the add form. Everything else is refused.
 */

/** Digits, the two separators, and the k/m/b multipliers. */
const ALLOWED_CHARACTERS = /^[0-9.,kmbKMB]*$/;

/** @returns {boolean} whether every character could belong to an amount */
export function isAmountText(text) {
  return ALLOWED_CHARACTERS.test(String(text ?? ''));
}

/** The text an input event is trying to insert, from typing or from a paste. */
function insertedText(event) {
  if (typeof event.data === 'string') return event.data;
  const transfer = event.dataTransfer;
  return transfer ? transfer.getData('text') : '';
}

/**
 * Refuse anything that is not part of an amount.
 * Deletions and cursor movement are untouched: only insertions are checked.
 */
function onBeforeInput(event) {
  if (!event.inputType?.startsWith('insert')) return;

  const text = insertedText(event);
  // An empty payload means something we cannot inspect, such as a composition
  // still in progress. Let it through rather than blocking the keyboard.
  if (!text || isAmountText(text)) return;

  event.preventDefault();
}

/**
 * Restrict one element.
 * @param {HTMLElement} element
 * @returns {() => void} removes the listener
 */
export function restrictToAmount(element) {
  element.addEventListener('beforeinput', onBeforeInput);
  return () => element.removeEventListener('beforeinput', onBeforeInput);
}

/**
 * Restrict every amount cell inside a container, however rows come and go.
 *
 * @param {HTMLElement} container
 * @param {string[]} fields the `data-field` values to guard
 * @returns {() => void} removes the listener
 */
export function restrictAmountCells(container, fields) {
  const handler = (event) => {
    const cell = event.target.closest?.('[data-field]');
    if (cell && fields.includes(cell.dataset.field)) onBeforeInput(event);
  };

  container.addEventListener('beforeinput', handler);
  return () => container.removeEventListener('beforeinput', handler);
}
