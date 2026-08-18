#!/usr/bin/env node
/**
 * Evaluate a JavaScript expression inside a real headless browser.
 *
 *   node tools/inspect.js <url> "<expression>"
 *   WIDTH=500 node tools/inspect.js http://localhost:4173/ "innerWidth"
 *
 * Useful for the things jsdom cannot answer, above all layout. Chromium clamps
 * its window to roughly 492px wide, so narrower viewports report that instead.
 */

import { launchBrowser } from './browser.js';

const [url, expression] = process.argv.slice(2);

if (!url || !expression) {
  console.error('usage: node tools/inspect.js <url> "<expression>"');
  process.exit(2);
}

const browser = await launchBrowser({
  width: Number(process.env.WIDTH ?? 1400),
  height: Number(process.env.HEIGHT ?? 1000),
});

try {
  // VIEWPORT emulates a width below Chromium's window floor, for phone sizes.
  const page = await browser.open(url, {
    viewportWidth: process.env.VIEWPORT ? Number(process.env.VIEWPORT) : undefined,
    viewportHeight: Number(process.env.HEIGHT ?? 1000),
  });
  console.log(JSON.stringify(await page.evaluate(expression), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  browser.close();
}
