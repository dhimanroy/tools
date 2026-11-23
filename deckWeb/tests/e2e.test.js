/*
 * End-to-end tests in a real (headless) browser.
 * Run:  node --test tests/e2e.test.js      (or: npm run test:e2e)
 * Needs Playwright with Chromium:  npm install   then   npx playwright install chromium
 *
 * Each test opens index.html from disk (file://), loads the fixture deck through
 * the file input, and drives the UI the way a user would.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { ROOT, deckText } = require('./helpers');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }

const URL = 'file://' + path.join(ROOT, 'index.html');
const TEXT = deckText();
const skip = chromium ? false : 'playwright is not installed (npm install && npx playwright install chromium)';

let browser;
test.before(async () => { if (chromium) browser = await chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

/** Fresh page with the deck loaded. Collects page errors into page.errors. */
async function open(text, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1500, height: 950 }, acceptDownloads: true }, opts || {}));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(URL);
  await page.setInputFiles('#file', { name: 'deck3d.inp', mimeType: 'text/plain', buffer: Buffer.from(text || TEXT) });
  await page.waitForSelector('#app:not([hidden])');
  return page;
}
async function done(page) { assert.deepEqual(page.errors, [], 'no errors in the page'); await page.context().close(); }
const deck = (page) => page.evaluate(() => (window.deckWeb || window.deckweb).text());
const line = async (page, key) => (await deck(page)).split('\n').find((l) => l.trim().startsWith(key + ' ')).replace(/\s+/g, ' ').trim();
const sel = (page) => page.evaluate(() => (window.deckWeb || window.deckweb).state.sel);
const row = (id) => '.row[data-id="' + id.toLowerCase() + '"]';
const goto = (page, block) => page.click('.nav-i[data-b="' + block + '"]');

test('load: deck round-trips unchanged and the download is identical', { skip }, async () => {
  const page = await open();
  assert.equal(await deck(page), TEXT);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);
  assert.equal(dl.suggestedFilename(), 'deck3d.inp');
  assert.equal(fs.readFileSync(await dl.path(), 'utf8'), TEXT);
  await done(page);
});

test('edit: number field changes only its value; invalid input is refused', { skip }, async () => {
  const page = await open();
  await goto(page, 'RunParam');
  await page.locator(row('RunParam%nstep') + ' input').fill('400000');
  assert.equal(await line(page, 'RunParam%nstep'), 'RunParam%nstep = 400000,');
  const changed = (await deck(page)).split('\n').filter((l, i) => l !== TEXT.split('\n')[i]);
  assert.equal(changed.length, 1);
  await goto(page, 'FourierSave');
  await page.click(row('FourierSave%istatus') + ' .sw');
  const f = page.locator(row('FourierSave%freq') + ' input');
  await f.fill('5.0.d3'); await f.press('Tab');
  assert.equal(await line(page, 'FourierSave%freq'), 'FourierSave%freq = 50.d3, ! base radial frequency in Hz');
  await done(page);
});

test('enum: changing iConvSchm switches WENO/Hybrid blocks on and off', { skip }, async () => {
  const page = await open();
  const off = (b) => page.locator('.nav-i[data-b="' + b + '"]').evaluate((n) => n.classList.contains('off'));
  assert.equal(await off('WENOParam'), false);
  assert.equal(await off('HybridParam'), true);
  await page.selectOption(row('RunParam%iConvSchm') + ' select', '2');
  await page.waitForTimeout(250);
  assert.equal(await off('WENOParam'), true);
  assert.equal(await off('HybridParam'), false);
  assert.equal(await page.locator('option', { hasText: 'Other value' }).count(), 0, 'no free-text option in dropdowns');
  await done(page);
});

test('dormancy: switching a module on reveals its parameters', { skip }, async () => {
  const page = await open();
  await goto(page, 'BCParam');
  const before = await page.locator('.row').count();
  await page.selectOption(row('BCParam%inletsponge') + ' select', '1');
  await page.waitForTimeout(250);
  assert.ok((await page.locator('.row').count()) > before + 10);
  await done(page);
});

test('arrays: count parameter resizes its arrays; values come back; one undo step', { skip }, async () => {
  const page = await open();
  await goto(page, 'TemporalParam');
  const ncfl = page.locator(row('TemporalParam%ncfl') + ' input');
  await ncfl.fill('3');
  assert.equal(await page.locator(row('TemporalParam%cfl_conv') + ' input').count(), 3);
  await page.locator(row('TemporalParam%cfl_conv') + ' input').nth(2).fill('0.5');
  await ncfl.fill('1'); await ncfl.fill('3');
  assert.equal(await line(page, 'TemporalParam%cfl_conv'), 'TemporalParam%cfl_conv = 0.3, 0.3, 0.5,');
  assert.equal(await page.locator('[data-act="add"], [data-act="rm"]').count(), 0, 'no manual add/remove buttons');
  // comma paste is refused
  const c = page.locator(row('TemporalParam%cfl_vis') + ' input').first();
  await c.fill('1, 2'); await c.press('Tab');
  assert.equal(await line(page, 'TemporalParam%cfl_vis'), 'TemporalParam%cfl_vis = 0.3, 0.3, 0.3,');
  await done(page);
});

test('syntax: ",," is shown, fixed with one click, and undo/redo work', { skip }, async () => {
  const broken = TEXT.replace('filter_zone_ibeg                  = 1, 1110,', 'filter_zone_ibeg                  = 1,, 1110,');
  const page = await open(broken);
  assert.equal(await sel(page), '__checks', 'opens on the Summary when there are syntax errors');
  assert.equal(await deck(page), broken, 'not silently fixed');
  await page.click('[data-act="fix"]');
  assert.match(await line(page, 'FilterParam%filter_zone_ibeg'), /= 1, 1110,$/);
  await page.locator('#editor h2').click();
  await page.keyboard.press('Control+z');
  assert.equal(await deck(page), broken);
  await page.keyboard.press('Control+Shift+z');
  assert.match(await line(page, 'FilterParam%filter_zone_ibeg'), /= 1, 1110,$/);
  await done(page);
});

test('summary: one screen, run type badge, bullets jump to parameters', { skip }, async () => {
  const page = await open();
  await goto(page, '__checks');
  const [h, c] = await page.locator('#editor').evaluate((e) => [e.scrollHeight, e.clientHeight]);
  assert.ok(h <= c, 'summary fits without scrolling at 1500x950');
  assert.equal(await page.locator('.run-type').innerText(), 'TDNS');
  assert.equal(await page.locator('#preview').isVisible(), false, 'preview steps aside on the Summary');
  await page.click('.kp li[data-key="bcparam%itopbc"]');
  assert.equal(await sel(page), 'BCParam');
  // LES on -> badge "LES"; LES + RANS -> invalid + error
  await goto(page, 'LESParam'); await page.click(row('LESParam%iuse') + ' .sw');
  await goto(page, '__checks');
  assert.equal(await page.locator('.run-type').innerText(), 'LES');
  await goto(page, 'RANSParam'); await page.click(row('RANSParam%iuse') + ' .sw');
  await goto(page, '__checks');
  assert.equal(await page.locator('.run-type').innerText(), 'LES + RANS');
  // checks re-run shortly after an edit (debounced), so wait for the message
  await page.locator('ul.issues li', { hasText: 'LES and RANS both on' }).waitFor({ timeout: 3000 });
  await done(page);
});

test('summary: grid size applies on Enter, not on every keystroke', { skip }, async () => {
  const page = await open();
  await goto(page, '__checks');
  const im = page.locator('input[data-grid="imax"]');
  await im.click();
  await page.keyboard.type('1700', { delay: 40 });
  assert.equal(await im.inputValue(), '1700');
  assert.deepEqual(await page.evaluate(() => window.deckweb.state.grid), {});
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.deckweb.state.grid), { imax: 1700 });
  assert.equal(await page.locator('ul.issues li', { hasText: 'exceeds grid size imax = 1700' }).count(), 1);
  await done(page);
});

test('navigation: section pager and Alt+arrows', { skip }, async () => {
  const page = await open();
  await goto(page, 'RunParam');
  await page.click('.pg-btn.next');
  assert.equal(await sel(page), 'FlowParam');
  await page.locator('#editor h2').click();
  await page.keyboard.press('Alt+ArrowDown');
  assert.equal(await sel(page), 'RANSParam');
  await page.keyboard.press('Alt+ArrowUp');
  assert.equal(await sel(page), 'FlowParam');
  await done(page);
});

test('draft: edits survive a reload via "Resume"', { skip }, async () => {
  const page = await open();
  await goto(page, 'RunParam');
  await page.locator(row('RunParam%nstep') + ' input').fill('123456');
  await page.waitForTimeout(700); // autosave is debounced
  await page.reload();
  await page.click('#btn-resume');
  assert.equal(await line(page, 'RunParam%nstep'), 'RunParam%nstep = 123456,');
  await done(page);
});
