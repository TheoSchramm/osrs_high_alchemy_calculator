/**
 * Toast notifications.
 *
 * These replace the v1 `confirm()` dialogs: a destructive action happens
 * immediately and offers an Undo, which is both faster to use and testable
 * (jsdom has no `confirm`).
 */

const DEFAULT_TIMEOUT_MS = 6000;

/**
 * @param {HTMLElement} container the `.toast-stack` element
 * @param {{ timeoutMs?: number, timers?: { setTimeout: Function, clearTimeout: Function } }} [options]
 */
export function createToaster(container, options = {}) {
  const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timers = options.timers ?? globalThis;
  const active = new Set();

  function dismiss(toast, handle) {
    if (handle) timers.clearTimeout(handle);
    toast.remove();
    active.delete(toast);
  }

  /**
   * @param {string} message
   * @param {object} [config]
   * @param {'info'|'success'|'error'} [config.tone]
   * @param {string} [config.actionLabel] renders a button when provided
   * @param {() => void} [config.onAction]
   * @param {number} [config.timeoutMs] 0 keeps the toast until it is acted on
   * @returns {{ dismiss: () => void, element: HTMLElement }}
   */
  function show(message, config = {}) {
    const doc = container.ownerDocument;
    const toast = doc.createElement('div');
    toast.className = `toast toast--${config.tone ?? 'info'}`;

    const text = doc.createElement('span');
    text.className = 'toast__message';
    text.textContent = message;
    toast.append(text);

    let handle = null;

    if (config.actionLabel) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'toast__action';
      button.textContent = config.actionLabel;
      button.addEventListener('click', () => {
        dismiss(toast, handle);
        config.onAction?.();
      });
      toast.append(button);
    }

    container.append(toast);
    active.add(toast);

    const timeoutMs = config.timeoutMs ?? defaultTimeout;
    if (timeoutMs > 0) {
      handle = timers.setTimeout(() => dismiss(toast, null), timeoutMs);
    }

    return { element: toast, dismiss: () => dismiss(toast, handle) };
  }

  return {
    show,
    info: (message, config) => show(message, { ...config, tone: 'info' }),
    success: (message, config) => show(message, { ...config, tone: 'success' }),
    error: (message, config) => show(message, { ...config, tone: 'error' }),
    /** Remove every visible toast. */
    clear() {
      for (const toast of [...active]) dismiss(toast, null);
    },
    get count() {
      return active.size;
    },
  };
}
