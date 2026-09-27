// Renders art.html to YouTube channel PNGs with the Playwright Chromium we
// already use for e2e tests. Usage: node assets/channel/render.mjs [--guides]
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const guides = process.argv.includes('--guides');
const url = pathToFileURL(path.join(dir, 'art.html')).href + (guides ? '?guides' : '');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2560, height: 2300 } });
await page.goto(url);
await page.evaluate(() => document.fonts.ready);

const suffix = guides ? '-guides' : '';
await page.locator('#banner').screenshot({ path: path.join(dir, `banner${suffix}.png`) });
await page.locator('#profile').screenshot({ path: path.join(dir, `profile${suffix}.png`) });
await browser.close();
console.log(JSON.stringify({ ok: true, dir, guides }));
