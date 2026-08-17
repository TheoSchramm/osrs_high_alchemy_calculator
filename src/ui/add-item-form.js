/**
 * The "add an item" form, with type-ahead search over the item mapping.
 *
 * The search function is injected, so this view works against the live API in
 * the browser and against a stub in tests.
 */

import { qs, on, debounce, setHidden } from './dom.js';
import { formatNumber } from '../core/format.js';

export class AddItemForm {
  /**
   * @param {object} config
   * @param {HTMLFormElement} config.form
   * @param {HTMLInputElement} config.nameInput
   * @param {HTMLInputElement} config.buyInput
   * @param {HTMLInputElement} config.alchInput
   * @param {HTMLInputElement} config.quantityInput
   * @param {HTMLElement} config.suggestionList
   * @param {(query: string) => Promise<import('../data/prices-api.js').MappingEntry[]>} config.search
   * @param {(draft: {name: string, buyPrice: string, alchPrice: string, quantity: string, entry: object|null}) => void} config.onSubmit
   * @param {number} [config.debounceMs]
   * @param {number} [config.minQueryLength]
   */
  constructor(config) {
    this.form = config.form;
    this.nameInput = config.nameInput;
    this.buyInput = config.buyInput;
    this.alchInput = config.alchInput;
    this.quantityInput = config.quantityInput;
    this.suggestionList = config.suggestionList;
    this.search = config.search;
    this.onSubmit = config.onSubmit ?? (() => {});
    this.minQueryLength = config.minQueryLength ?? 2;

    /** @type {import('../data/prices-api.js').MappingEntry[]} */
    this.suggestions = [];
    this.activeIndex = -1;
    /** The entry chosen from the dropdown, if any. */
    this.selectedEntry = null;
    /** Guards against a slow request overwriting a newer one. */
    this.requestToken = 0;
    this.teardown = [];

    this.runSearch = debounce((query) => this._search(query), config.debounceMs ?? 180);
    this._bind();
  }

  _bind() {
    this.teardown.push(on(this.form, 'submit', (event) => {
      event.preventDefault();
      this.submit();
    }));

    this.teardown.push(on(this.nameInput, 'input', () => {
      // Typing invalidates a previous dropdown choice.
      this.selectedEntry = null;
      const query = this.nameInput.value.trim();

      if (query.length < this.minQueryLength) {
        this.runSearch.cancel();
        this.closeSuggestions();
        return;
      }
      this.runSearch(query);
    }));

    this.teardown.push(on(this.nameInput, 'keydown', (event) => this._onKeydown(event)));

    this.teardown.push(on(this.suggestionList, 'mousedown', (event) => {
      // mousedown, not click: the input's blur would close the list first.
      const option = event.target.closest('[data-index]');
      if (!option) return;
      event.preventDefault();
      this.choose(Number(option.dataset.index));
    }));

    this.teardown.push(on(this.nameInput, 'blur', () => {
      // Let a mousedown on an option land before the list disappears.
      setTimeout(() => this.closeSuggestions(), 0);
    }));
  }

  _onKeydown(event) {
    const isOpen = !this.suggestionList.hidden && this.suggestions.length > 0;

    switch (event.key) {
      case 'ArrowDown':
        if (!isOpen) return;
        event.preventDefault();
        this._setActive((this.activeIndex + 1) % this.suggestions.length);
        break;
      case 'ArrowUp':
        if (!isOpen) return;
        event.preventDefault();
        // From nothing selected (-1) or from the top, wrap to the last option.
        this._setActive(this.activeIndex <= 0 ? this.suggestions.length - 1 : this.activeIndex - 1);
        break;
      case 'Enter':
        if (isOpen && this.activeIndex >= 0) {
          event.preventDefault();
          this.choose(this.activeIndex);
        }
        break;
      case 'Escape':
        if (isOpen) {
          event.preventDefault();
          this.closeSuggestions();
        }
        break;
      default:
        break;
    }
  }

  async _search(query) {
    const token = ++this.requestToken;
    let results = [];

    try {
      results = await this.search(query);
    } catch {
      // A failed lookup should never block manual entry.
      results = [];
    }

    if (token !== this.requestToken) return; // a newer query already won
    this.suggestions = results ?? [];
    this._renderSuggestions();
  }

  _renderSuggestions() {
    const doc = this.suggestionList.ownerDocument;
    this.suggestionList.replaceChildren();
    this.activeIndex = -1;

    if (this.suggestions.length === 0) {
      this.closeSuggestions();
      return;
    }

    this.suggestions.forEach((entry, index) => {
      const li = doc.createElement('li');
      li.className = 'suggestion';
      li.id = `suggestion-${index}`;
      li.dataset.index = String(index);
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');

      const icon = doc.createElement('img');
      icon.className = 'suggestion__icon';
      // Only set src when there is one: an empty src re-requests the page.
      if (entry.icon) icon.src = entry.icon;
      icon.alt = '';
      icon.loading = 'lazy';

      const name = doc.createElement('span');
      name.className = 'suggestion__name';
      name.textContent = entry.name;

      const meta = doc.createElement('span');
      meta.className = 'suggestion__meta';
      meta.textContent = entry.highAlch > 0
        ? `alch ${formatNumber(entry.highAlch)}`
        : 'not alchable';

      li.append(icon, name, meta);
      this.suggestionList.append(li);
    });

    setHidden(this.suggestionList, false);
    this.nameInput.setAttribute('aria-expanded', 'true');
  }

  _setActive(index) {
    this.activeIndex = index;
    [...this.suggestionList.children].forEach((option, i) => {
      const isActive = i === index;
      option.classList.toggle('is-active', isActive);
      option.setAttribute('aria-selected', String(isActive));
    });
    this.nameInput.setAttribute(
      'aria-activedescendant',
      index >= 0 ? `suggestion-${index}` : '',
    );
  }

  /** Accept suggestion `index`, filling the form from it. */
  choose(index) {
    const entry = this.suggestions[index];
    if (!entry) return;

    this.selectedEntry = entry;
    this.nameInput.value = entry.name;
    if (entry.highAlch > 0) this.alchInput.value = String(entry.highAlch);
    this.closeSuggestions();
    this.nameInput.focus();
  }

  closeSuggestions() {
    setHidden(this.suggestionList, true);
    this.suggestions = [];
    this.activeIndex = -1;
    this.nameInput.setAttribute('aria-expanded', 'false');
    this.nameInput.removeAttribute('aria-activedescendant');
  }

  /** Hand the current draft to `onSubmit` and reset the form. */
  submit() {
    const name = this.nameInput.value.trim();
    if (!name) {
      this.nameInput.focus();
      return;
    }

    this.onSubmit({
      name,
      buyPrice: this.buyInput.value.trim(),
      alchPrice: this.alchInput.value.trim(),
      quantity: this.quantityInput.value.trim(),
      entry: this.selectedEntry,
    });

    this.reset();
  }

  reset() {
    this.nameInput.value = '';
    this.buyInput.value = '';
    this.alchInput.value = '';
    this.quantityInput.value = '1';
    this.selectedEntry = null;
    this.closeSuggestions();
    this.nameInput.focus();
  }

  destroy() {
    this.runSearch.cancel();
    for (const off of this.teardown) off();
    this.teardown = [];
  }
}

/**
 * Build an {@link AddItemForm} from a document root, resolving the elements by id.
 * @param {Document|HTMLElement} root
 */
export function createAddItemForm(root, config) {
  return new AddItemForm({
    form: qs(root, '#addForm'),
    nameInput: qs(root, '#itemName'),
    buyInput: qs(root, '#buyPrice'),
    alchInput: qs(root, '#alchPrice'),
    quantityInput: qs(root, '#quantity'),
    suggestionList: qs(root, '#itemSuggestions'),
    ...config,
  });
}
