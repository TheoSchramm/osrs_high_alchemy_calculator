/**
 * Browser entry point.
 *
 * The only module that touches globals (`document`, `localStorage`, `fetch`).
 * Everything it builds takes its dependencies as arguments, which is what makes
 * the rest of the app testable in Node.
 */

import { AppStore } from './state/store.js';
import { PricesApi } from './data/prices-api.js';
import { resolveStorage, createJsonCache, MAPPING_CACHE_KEY } from './data/storage.js';
import { createApp } from './ui/app.js';

/** How long a cached item mapping stays fresh. It changes on game updates. */
const MAPPING_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * ES modules and `fetch` are both blocked on `file://`, so warn instead of
 * failing silently with a blank page.
 */
function warnAboutFileProtocol(doc) {
  if (doc.location?.protocol !== 'file:') return false;
  const notice = doc.getElementById('protocolWarning');
  if (notice) notice.hidden = false;
  return true;
}

export function bootstrap(doc = document) {
  warnAboutFileProtocol(doc);

  const storage = resolveStorage();
  const store = new AppStore({ storage });
  const api = new PricesApi({
    cache: createJsonCache(storage, { ttlMs: MAPPING_TTL_MS }),
    cacheKey: MAPPING_CACHE_KEY,
  });

  const app = createApp({ root: doc, store, api });

  // Warm the mapping cache so the first keystroke in the search box is instant.
  api.getMapping().catch(() => {
    app.toaster.error('Could not load the item list — you can still enter prices by hand.');
  });

  return app;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bootstrap(document), { once: true });
  } else {
    bootstrap(document);
  }
}
