import { chromium } from 'playwright';
import { mkdtemp, cp, readFile, writeFile, symlink, unlink, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { startServer } from '../scripts/dev-server.mjs';

const temporary = await mkdtemp('/tmp/form-pwa-'), legacy = temporary + '/legacy', current = temporary + '/current', broken = temporary + '/broken', live = temporary + '/live';
await cp('dist', current, { recursive: true }); await cp('dist', legacy, { recursive: true });
const html = await readFile(current + '/index.html', 'utf8');
// Keep activation pending long enough to assert that user editing is blocked safely.
const currentWorker = await readFile(current + '/sw.js', 'utf8');
await writeFile(current + '/sw.js', currentWorker.replace('event.waitUntil(self.skipWaiting());', 'event.waitUntil(new Promise(resolve => setTimeout(resolve, 800)).then(() => self.skipWaiting()));'));
const js = html.match(/src="(\/assets\/[^\"]+\.js)"/)[1], css = html.match(/href="(\/assets\/[^\"]+\.css)"/)[1];
await writeFile(legacy + '/assets/app.js', 'window.legacyAssetLoaded = true;\n' + await readFile(current + js, 'utf8'));
await cp(current + css, legacy + '/assets/app.css');
await writeFile(legacy + '/index.html', html.replace(js, '/assets/app.js').replace(css, '/assets/app.css').replace(/\/manifest.webmanifest\?v=[a-f0-9]+/, '/manifest.webmanifest'));
const legacyWorker = `const CACHE='form-legacy-test';const ASSETS=['/','/index.html','/assets/app.js','/assets/app.css','/workouts.json','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||u.pathname.startsWith('/api/')||e.request.method!=='GET')return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html')));return;}if(ASSETS.includes(u.pathname))e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)));});`;
await writeFile(legacy + '/sw.js', legacyWorker); await symlink(legacy, live);
const f = fixture(), server = await startServer({ api: f.api, directory: live, port: 0 });
const origin = `http://127.0.0.1:${server.address().port}`; f.env.APP_URL = origin;
let failNavigation = false, stallNavigation = false;
const handler = server.listeners('request')[0]; server.removeAllListeners('request');
server.on('request', (request, response) => {
  if (request.url === '/' && failNavigation) { response.writeHead(503); response.end('Unavailable'); return; }
  if (request.url === '/' && stallNavigation) return;
  void handler(request, response);
});
const context = await chromium.launchPersistentContext(temporary + '/profile', { headless: true, executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = context.pages()[0]; const errors = []; page.on('pageerror', error => errors.push(error.message));
async function until(predicate, message) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    try { if (await predicate()) return; }
    catch (error) { if (!error.message.includes('Execution context was destroyed')) throw error; }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(message);
}
try {
  await page.goto(origin); await page.locator('.exercise-card').waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await until(() => page.evaluate(() => !!navigator.serviceWorker.controller), 'Legacy worker did not control the page.');
  assert.equal(await page.evaluate(() => window.legacyAssetLoaded), true);
  await page.getByLabel('Set 1 weight in kg', { exact: true }).fill('21');
  await page.locator('[data-action=complete]').click();
  await until(async () => !(await page.locator('.sync-status').textContent()).includes('Saving'), 'Initial set did not save.');
  await context.setOffline(true); await page.reload(); await page.locator('.exercise-card').waitFor();
  assert.equal(await page.locator('.set-row.logged').count(), 1);
  await context.setOffline(false); await unlink(live); await symlink(current, live);
  await page.reload(); await page.locator('.exercise-card').waitFor();
  assert.equal(await page.evaluate(() => window.legacyAssetLoaded), undefined, 'Legacy cached app.js must not override versioned assets.');
  await page.locator('[data-action=apply-update]').waitFor();
  await page.evaluate(() => { window.beforeUpdate = true; });
  await page.getByLabel('Set 2 weight in kg', { exact: true }).fill('23');
  await page.locator('[data-action=apply-update]').click();
  await until(() => page.locator('.phone').evaluate(el => el.inert), 'Update did not protect editable controls.');
  assert.equal(await page.getByLabel('Set 2 weight in kg', { exact: true }).evaluate(el => { el.focus(); return document.activeElement === el; }), false);
  await until(() => page.evaluate(() => !window.beforeUpdate), 'Explicit update did not reload.');
  await page.locator('.exercise-card').waitFor();
  assert.equal(await page.locator('.set-row.logged').count(), 1);
  assert.equal(await page.getByLabel('Set 1 weight in kg', { exact: true }).inputValue(), '21');
  assert.equal(await page.getByLabel('Set 2 weight in kg', { exact: true }).inputValue(), '23');
  const cdp = await context.newCDPSession(page);
  assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, []);
  assert.equal(await page.locator('.phone').evaluate(el => el.getBoundingClientRect().width), 390);
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('heading', { name: 'Install FORM', exact: true }).waitFor();
  assert.equal(await page.locator('.dialog h2').evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.getByRole('button', { name: 'Copy app link', exact: true }).evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Close', exact: true }).evaluate(el => document.activeElement === el), true);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  failNavigation = true; await page.reload(); await page.locator('.exercise-card').waitFor(); failNavigation = false;
  stallNavigation = true; await page.reload(); await page.locator('.exercise-card').waitFor(); stallNavigation = false;
  assert.equal(await page.getByLabel('Set 2 weight in kg', { exact: true }).inputValue(), '23');
  await context.setOffline(true); await page.reload(); await page.locator('.exercise-card').waitFor();
  assert.equal(await page.locator('.set-row.logged').count(), 1);
  assert.equal(await page.evaluate(async () => (await caches.keys()).length), 2);
  assert.equal(await page.evaluate(async () => { for (const name of await caches.keys()) if ((await (await caches.open(name)).keys()).some(request => new URL(request.url).pathname.startsWith('/api/'))) return true; return false; }), false);
  await context.setOffline(false);
  await cp(current, broken, { recursive: true });
  const worker = await readFile(broken + '/sw.js', 'utf8');
  await writeFile(broken + '/sw.js', worker.replace(/form-[a-f0-9]+/, 'form-broken-test').replace('const ASSETS = [', 'const ASSETS = ["/missing-required-icon.png",'));
  await unlink(live); await symlink(broken, live);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await new Promise(async (resolve, reject) => {
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker.addEventListener('statechange', () => { if (worker.state === 'redundant') resolve(); });
      }, { once: true });
      try { await registration.update(); } catch (error) { reject(error); }
    });
  });
  assert.equal(await page.evaluate(() => caches.has('form-broken-test')), false);
  await context.setOffline(true); await page.reload(); await page.locator('.exercise-card').waitFor();
  assert.equal(await page.getByLabel('Set 2 weight in kg', { exact: true }).inputValue(), '23');
  assert.deepEqual(errors, []);
  console.log('PWA checks passed: legacy cache upgrade, explicit update preserving unsynced sets/drafts, native installability, mobile layout/focus, offline reload, 503/stalled navigation fallback, failed precache recovery, and API exclusion.');
} finally { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true }); }
