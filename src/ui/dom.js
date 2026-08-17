/**
 * Thin DOM helpers.
 *
 * Deliberately tiny: enough to keep the views readable without becoming a
 * framework. `qs` throws on a miss so a typo in a selector fails at start-up
 * instead of silently rendering nothing.
 */

/**
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {HTMLElement}
 */
export function qs(root, selector) {
  const node = root?.querySelector(selector);
  if (!node) throw new Error(`Element not found: ${selector}`);
  return node;
}

/** Like {@link qs} but returns null instead of throwing. */
export function qsOptional(root, selector) {
  return root?.querySelector(selector) ?? null;
}

/** @returns {HTMLElement[]} */
export function qsa(root, selector) {
  return [...(root?.querySelectorAll(selector) ?? [])];
}

/**
 * Add a listener and return a function that removes it.
 * @returns {() => void}
 */
export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/** Set text only when it differs, so caret position in editable cells survives. */
export function setText(node, text) {
  const value = String(text ?? '');
  if (node && node.textContent !== value) node.textContent = value;
}

/** Toggle `hidden`, the attribute the stylesheet keys off. */
export function setHidden(node, hidden) {
  if (!node) return;
  node.hidden = Boolean(hidden);
}

/**
 * Replace the value-colour class on a node with the one matching `value`.
 * Positive renders green, negative red, zero muted.
 */
export function setValueTone(node, value) {
  if (!node) return;
  node.classList.remove('value-profit', 'value-loss', 'value-muted');
  if (value > 0) node.classList.add('value-profit');
  else if (value < 0) node.classList.add('value-loss');
  else node.classList.add('value-muted');
}

/** Instantiate the single row inside a `<template>`. */
export function cloneTemplate(template, selector) {
  const fragment = template.content.cloneNode(true);
  const node = selector ? fragment.querySelector(selector) : fragment.firstElementChild;
  if (!node) throw new Error(`Template produced no ${selector ?? 'element'}`);
  return node;
}

/**
 * Trailing-edge debounce.
 *
 * @param {(...args: unknown[]) => void} fn
 * @param {number} waitMs 0 runs on the next tick, which keeps tests fast
 * @param {{ setTimeout?: Function, clearTimeout?: Function }} [timers]
 */
export function debounce(fn, waitMs, timers = globalThis) {
  let handle = null;
  const schedule = timers.setTimeout.bind(timers);
  const cancel = timers.clearTimeout.bind(timers);

  const wrapped = (...args) => {
    if (handle !== null) cancel(handle);
    handle = schedule(() => {
      handle = null;
      fn(...args);
    }, waitMs);
  };

  wrapped.cancel = () => {
    if (handle !== null) cancel(handle);
    handle = null;
  };

  return wrapped;
}
