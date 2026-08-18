/**
 * A tiny headless-browser driver over the Chrome DevTools Protocol.
 *
 * Exists because jsdom has no layout engine: overflow, wrapping and anything
 * else geometric is invisible to the main test suite. Uses Node's built-in
 * `fetch` and `WebSocket`, so it adds no dependencies.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BROWSER_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** @returns {string|null} path to a Chromium-based browser, or null if none */
export function findBrowser() {
  return BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForEndpoint(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      /* not listening yet */
    }
    await sleep(150);
  }
  throw new Error(`Browser DevTools endpoint did not start within ${timeoutMs}ms`);
}

/** Minimal CDP message pump. */
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } else if (message.method) {
        for (const handler of this.listeners.get(message.method) ?? []) handler(message.params);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(payload));
    });
  }

  once(method) {
    return new Promise((resolve) => {
      if (!this.listeners.has(method)) this.listeners.set(method, []);
      this.listeners.get(method).push(resolve);
    });
  }
}

/**
 * Launch a headless browser and return a handle for evaluating expressions.
 *
 * @param {object} [options]
 * @param {number} [options.width]  note: Chromium clamps windows to ~492px wide
 * @param {number} [options.height]
 * @param {number} [options.port]
 * @param {number} [options.timeoutMs]
 */
export async function launchBrowser(options = {}) {
  const binary = findBrowser();
  if (!binary) throw new Error('No Chromium-based browser found');

  const width = options.width ?? 1400;
  const height = options.height ?? 1000;
  const port = options.port ?? 9200 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'osrs-browser-'));

  const process_ = spawn(binary, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const version = await waitForEndpoint(port, options.timeoutMs ?? 25_000);
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
  });

  const cdp = new Cdp(socket);

  return {
    /**
     * Navigate to `url`, then evaluate expressions against the loaded page.
     *
     * @param {string} url
     * @param {object} [pageOptions]
     * @param {number} [pageOptions.settleMs]
     * @param {number} [pageOptions.viewportWidth] emulate a viewport narrower
     *   than Chromium's ~492px window floor, which is the only way to test real
     *   phone widths
     * @param {number} [pageOptions.viewportHeight]
     * @param {boolean} [pageOptions.mobile]
     */
    async open(url, pageOptions = {}) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);

      if (pageOptions.viewportWidth) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: pageOptions.viewportWidth,
          height: pageOptions.viewportHeight ?? 900,
          deviceScaleFactor: 1,
          mobile: Boolean(pageOptions.mobile),
        }, sessionId);
      }

      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url }, sessionId);
      await loaded;
      // Give ES modules time to boot and the first render to settle.
      await sleep(pageOptions.settleMs ?? 1200);

      return {
        /**
         * @param {string} expression a JS expression; must be JSON-serialisable
         * @returns {Promise<unknown>}
         */
        async evaluate(expression) {
          const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
            expression: `JSON.stringify((() => (${expression}))())`,
            returnByValue: true,
            awaitPromise: true,
          }, sessionId);

          if (exceptionDetails) {
            throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
          }
          return result.value === undefined ? undefined : JSON.parse(result.value);
        },
        /** @returns {Promise<string>} base64 PNG of the full page */
        async screenshot() {
          const { data } = await cdp.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
          }, sessionId);
          return data;
        },
        close: () => cdp.send('Target.closeTarget', { targetId }),
      };
    },

    close() {
      try {
        socket.close();
      } catch {
        /* already gone */
      }
      process_.kill();
      // Windows keeps a handle on the profile for a moment after the process
      // dies, so a synchronous delete here races and throws EBUSY. The
      // directory is under the OS temp dir; leaving it is harmless.
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        /* the OS will reap it */
      }
    },
  };
}

/**
 * Start the project's static server on an ephemeral port.
 * @returns {Promise<{ origin: string, close: () => void }>}
 */
export async function startServer({ port = 4100 + Math.floor(Math.random() * 800) } = {}) {
  const serverPath = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), 'serve.js');
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });

  const origin = `http://localhost:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/index.html`);
      if (response.ok) return { origin, close: () => child.kill() };
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }

  child.kill();
  throw new Error('Static server did not start');
}
