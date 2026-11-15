import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { startServer } from '../scripts/dev-server.mjs';

const f = fixture();
const server = await startServer({ api: f.api, port: 0 });
const origin = `http://127.0.0.1:${server.address().port}`; f.env.APP_URL = origin;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, timezoneId: 'Asia/Taipei' });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.soundCount = 0;
  window.AudioContext = class {
    currentTime = 0; destination = {};
    resume() { return Promise.resolve(); }
    createOscillator() { return { frequency: { value: 0 }, connect() {}, start() { window.soundCount++; }, stop() {} }; }
    createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
  };
});
const phone = page.locator('#workout-focus .phone');
async function waitFor(predicate, message) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(message);
}
async function settings() { await phone.getByRole('button', { name: 'Account and settings', exact: true }).click(); }
async function closeDialog() { await phone.locator('.dialog button[data-action=close-dialog]').click(); }
async function changeSettings(values) {
  await phone.locator('[data-action=exercise-settings]').first().click();
  for (const [field, value] of Object.entries(values)) await phone.locator(`.dialog [name=${field}]`).fill(String(value));
  await phone.getByRole('button', { name: 'Save exercise settings', exact: true }).click();
  await phone.locator('.dialog').waitFor({ state: 'hidden' });
}

try {
  await page.goto(origin); await phone.locator('.exercise-card').waitFor();
  assert.equal(await phone.locator('.day-tabs [data-day]').count(), 3);
  assert.equal(await phone.getByRole('button', { name: /^Start rest$/ }).count(), 0);
  assert.match(await phone.locator('[data-action=complete]').textContent(), /Complete set 1 & rest/);
  await changeSettings({ angle: 30, sets: 3, reps: 10, rest: 5, weight: 25 });
  assert.match(await phone.locator('.exercise-note').textContent(), /30°/);
  assert.equal(await phone.locator('.set-row:not(.set-columns)').count(), 3);
  await phone.locator('.set-input[data-set="0"][data-field=weight]').fill('20');
  await phone.locator('.set-input[data-set="0"][data-field=reps]').fill('8');
  await phone.locator('[data-action=complete]').click();
  assert.equal(await phone.locator('.set-row.logged').count(), 1);
  assert.match(await phone.locator('[data-action=complete]').textContent(), /Pause rest/);
  await phone.locator('[data-action=complete]').click();
  assert.match(await phone.locator('[data-action=complete]').textContent(), /Resume rest/);
  assert.equal(await phone.locator('.set-row.logged').count(), 1);
  await phone.locator('[data-action=complete]').click();
  await waitFor(async () => (await phone.locator('[data-action=complete]').textContent()).includes('Complete set 2'), 'Rest did not complete.');
  assert.equal(await page.evaluate(() => window.soundCount), 3);
  await phone.locator('.set-input[data-set="1"][data-field=reps]').fill('9');
  await phone.locator('[data-action=complete]').click();
  await phone.locator('[data-undo="0"]').click();
  assert.equal(await phone.locator('.set-row.logged').count(), 1);
  assert.match(await phone.locator('[data-action=complete]').textContent(), /Complete set 1/);
  await waitFor(async () => !(await phone.locator('.sync-status').textContent()).includes('Saving'), 'Local save did not finish.');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await waitFor(() => page.evaluate(() => !!navigator.serviceWorker.controller), 'Service worker did not take control.');
  await context.setOffline(true); await page.reload(); await phone.locator('.exercise-card').waitFor();
  assert.match(await phone.locator('.sync-status').textContent(), /Offline/);
  assert.equal(await phone.locator('.set-row.logged').count(), 1);
  assert.equal(await phone.locator('[data-undo="1"]').count(), 1);
  assert.match(await phone.locator('.exercise-note').textContent(), /30°/);
  assert.equal(await phone.locator('.set-input[data-set="1"][data-field=reps]').inputValue(), '9');
  await phone.locator('[data-action=finish]').click();
  assert.match(await phone.locator('.record-summary').textContent(), /Set 2/);
  assert.doesNotMatch(await phone.locator('.record-summary').textContent(), /Set 1/);
  await context.setOffline(false);
  await waitFor(async () => !(await phone.locator('.sync-status').textContent()).includes('Offline'), 'Reconnect did not update status.');
  await context.route(`${origin}/api/auth/google`, async route => {
    const response = await route.fetch({ maxRedirects: 0 });
    const url = new URL(response.headers().location);
    assert.equal(url.hostname, 'accounts.google.com');
    await route.fulfill({ response, headers: { ...response.headers(), location: `${origin}/api/auth/callback?state=${url.searchParams.get('state')}&code=u1` } });
  });
  await settings(); await phone.getByRole('link', { name: 'Sign in with Google', exact: true }).click();
  await page.waitForURL(origin + '/'); await phone.locator('.exercise-card').waitFor();
  await settings(); await phone.getByRole('button', { name: /Bring 1 local workouts/ }).click();
  await waitFor(() => Promise.resolve(f.store.rows.get('users/u1')?.data.plan.days.A.exercises[0].angle === 30), 'Defaults were not uploaded.');
  await phone.getByRole('button', { name: 'Create Workouts calendar', exact: true }).click();
  await waitFor(() => Promise.resolve(f.events.get('u1/cal-u1')?.size === 1), 'Finished workout did not sync into the dedicated calendar.');
  const saved = [...f.events.get('u1/cal-u1').values()][0];
  assert.match(saved.description, /Set 2: 25 kg × 9 reps/); assert.match(saved.description, /bench 30°/);
  assert.equal(saved.extendedProperties.private.formVersion, '1');
  await closeDialog();
  // A second browser obtains defaults and history from the account, not this device's cache.
  const other = await browser.newContext({ viewport: { width: 390, height: 1000 }, timezoneId: 'Asia/Taipei' });
  const sessionCookie = await f.login('u1'); await other.addCookies([{ name: 'form_session', value: sessionCookie.split('=')[1], url: origin, httpOnly: true, sameSite: 'Lax' }]);
  const second = await other.newPage(); second.on('pageerror', error => errors.push(error.message));
  await second.goto(origin); await second.locator('.exercise-card').waitFor();
  await waitFor(async () => (await second.locator('.exercise-note').textContent()).includes('30°'), 'Second device did not get saved angle.');
  assert.equal(await second.locator('.set-row:not(.set-columns)').count(), 3);
  await second.locator('[data-view=calendar]').click();
  await waitFor(async () => (await second.locator('.month-count strong').textContent()) === '1', 'Real history did not load.');
  const calendarContrast = await second.locator('.heat-day.trained').evaluate(source => {
    const phone = source.closest('.phone'), originalDay = phone.dataset.day, probe = source.cloneNode(true);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    const luminance = color => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const linear = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
      return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
    };
    const results = []; source.parentElement.append(probe);
    try {
      for (const day of ['A', 'B', 'C']) for (const multiple of [false, true]) for (const selected of [false, true]) {
        phone.dataset.day = day; probe.classList.toggle('multiple', multiple); probe.classList.toggle('chosen', selected); probe.setAttribute('aria-pressed', String(selected));
        const style = getComputedStyle(probe), text = luminance(style.color), background = luminance(style.backgroundColor);
        results.push({ day, multiple, selected, ratio: (Math.max(text, background) + .05) / (Math.min(text, background) + .05) });
      }
    } finally { probe.remove(); phone.dataset.day = originalDay; }
    return results;
  });
  for (const result of calendarContrast) assert.ok(result.ratio >= 4.5, `Calendar date contrast: ${JSON.stringify(result)}`);
  await second.locator('.heat-day.trained').click(); await second.locator('.history-entry summary').click();
  assert.match(await second.locator('.history-entry').textContent(), /25 kg × 9/);
  await second.getByRole('button', { name: 'Edit this workout →', exact: true }).click();
  await second.locator('[data-action=exercise-settings]').first().click();
  await second.locator('.dialog input[name=angle]').fill('45');
  await second.locator('.dialog input[name=rest]').fill('60');
  await second.getByRole('button', { name: 'Save exercise settings', exact: true }).click();
  await waitFor(() => Promise.resolve(f.store.rows.get('users/u1').data.plan.days.A.exercises[0].angle === 45), 'Updated bench angle did not reach cloud storage.');
  assert.match([...f.events.get('u1/cal-u1').values()][0].description, /bench 30°/);
  await second.locator('[data-action=exercise-settings]').first().click();
  assert.equal(await second.locator('.dialog input[name=rest]').inputValue(), '60');
  await second.locator('.dialog input[name=weight]').fill('27.5');
  await second.getByRole('button', { name: 'Save exercise settings', exact: true }).click();
  await waitFor(() => Promise.resolve(f.store.rows.get('users/u1').data.plan.days.A.exercises[0].weight === 27.5), 'Repeated future edits did not save.');
  assert.equal(f.store.rows.get('users/u1').data.plan.days.A.exercises[0].rest, 60);
  await second.locator('[data-action=exercise-settings]').first().click();
  await second.locator('.dialog input[name=weight]').fill('39');
  const backgroundPull = second.waitForResponse(response => response.url().endsWith('/api/state'));
  await second.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await backgroundPull;
  await second.getByRole('button', { name: 'Save exercise settings', exact: true }).click();
  await second.locator('.dialog').waitFor({ state: 'hidden' });
  await waitFor(() => Promise.resolve(f.store.rows.get('users/u1').data.plan.days.A.exercises[0].weight === 39), 'Background refresh discarded unsaved exercise settings.');
  assert.equal(f.store.rows.get('users/u1').data.plan.days.A.exercises[0].angle, 45);
  await second.getByRole('button', { name: 'Start a new workout for this day →', exact: true }).click();
  await second.locator('[data-action=exercise-settings]').first().click();
  await second.locator('.dialog input[name=rest]').fill('90'); await second.locator('.dialog select[name=scope]').selectOption('today');
  await second.getByRole('button', { name: 'Save exercise settings', exact: true }).click();
  await second.locator('[data-action=exercise-settings]').first().click();
  await second.locator('.dialog input[name=angle]').fill('55'); await second.locator('.dialog select[name=scope]').selectOption('future');
  await second.getByRole('button', { name: 'Save exercise settings', exact: true }).click();
  await waitFor(() => Promise.resolve(f.store.rows.get('users/u1').data.plan.days.A.exercises[0].angle === 55), 'Future-only change did not save.');
  assert.equal(f.store.rows.get('users/u1').data.plan.days.A.exercises[0].rest, 60);
  // Stable card sizes across all real routines and responsive viewports.
  for (const width of [320, 390, 736]) {
    await second.setViewportSize({ width, height: 1000 }); const heights = [];
    for (const day of ['A', 'B', 'C']) {
      await second.locator(`.day-tabs [data-day=${day}]`).click();
      while (await second.locator('[data-action=previous]').isEnabled()) await second.locator('[data-action=previous]').click();
      for (let index = 0; index < 6; index++) { heights.push(await second.locator('.exercise-card').evaluate(el => el.getBoundingClientRect().height)); if (index < 5) await second.locator('[data-action=next]').click(); }
    }
    assert.ok(Math.max(...heights) - Math.min(...heights) < 1, `Cards resized at ${width}: ${Math.min(...heights)}–${Math.max(...heights)}`);
    const box = await second.locator('.phone').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth })); assert.ok(box.scroll <= box.width + 1);
  }
  await second.screenshot({ path: 'test-results/focus-app.png', fullPage: true });
  await waitFor(async () => (await second.locator('.sync-status').textContent()).includes('Up to date'), 'Draft sync did not finish.');
  const blocked = await other.newPage(); await blocked.goto(origin);
  await blocked.getByText(/already open in another tab/).waitFor();
  await second.close(); await blocked.reload(); await blocked.locator('.exercise-card').waitFor();
  await blocked.locator('.day-tabs [data-day=A]').click();
  while (await blocked.locator('[data-action=previous]').isEnabled()) await blocked.locator('[data-action=previous]').click();
  assert.match(await blocked.locator('.exercise-note').textContent(), /45°/);
  await blocked.getByRole('button', { name: 'Calendar', exact: true }).click();
  assert.equal(await blocked.locator('.month-count strong').textContent(), '1');
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: persistent angles/sets/rest, combined set action, sound, sparse undo, offline reload, Google login, local-data import, direct calendar sync, cross-device defaults/history, historical snapshots, and stable cards across 18 exercises.');
  await other.close();
} catch (error) {
  console.error('Visible app at failure:', await page.locator('body').innerText());
  console.error('Browser errors:', errors);
  await page.screenshot({ path: 'test-results/failure.png', fullPage: true });
  throw error;
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
