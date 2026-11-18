import assert from 'node:assert/strict';

export async function verifySetMemory(browser, origin, fixture) {
  const cookie = await fixture.login('set-memory');
  await fixture.request('/api/calendar/setup', { cookie, method: 'POST', data: {} });
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 } });
  const signIn = ctx => ctx.addCookies([{ name: 'form_session', value: cookie.split('=')[1], url: origin, httpOnly: true, sameSite: 'Lax' }]);
  const until = async predicate => { const end = Date.now() + 12000; while (!await predicate()) { if (Date.now() > end) throw new Error('Set memory did not finish syncing.'); await new Promise(resolve => setTimeout(resolve, 50)); } };
  let other;
  try {
    await signIn(context);
    const page = await context.newPage(); await page.goto(origin);
    await page.locator('.exercise-card').waitFor();
    const input = (i, field) => page.locator(`.set-input[data-set="${i}"][data-field=${field}]`);
    await page.locator('.remembered-targets summary').click();
    await page.locator('[data-rest]').selectOption('5');
    await input(0, 'weight').fill('20'); await input(0, 'reps').fill('12');
    await page.locator('[data-action=complete]').click();
    assert.ok(await page.locator('.remembered-targets').evaluate(el => el.open));
    assert.match(await page.locator('.remembered-pairs').textContent(), /20 kg × 12/);
    await input(1, 'weight').fill('25'); await input(1, 'reps').fill('8');
    await page.locator('.exercise-heading').click();
    assert.doesNotMatch(await page.locator('.remembered-pairs').textContent(), /25 kg × 8/);
    await until(async () => /Complete set 2/.test(await page.locator('[data-action=complete]').textContent()));
    await page.locator('[data-action=complete]').click();
    assert.match(await page.locator('.remembered-pairs').textContent(), /25 kg × 8/);
    await until(() => Promise.resolve(fixture.store.rows.get('users/set-memory')?.data.plan.days.A.exercises[0].setTargets?.[1]?.weight === 25));
    await page.locator('[data-action=finish]').click();
    await until(async () => /Saved to your Google Calendar/.test(await page.locator('.save-status').textContent()));
    const event = [...fixture.events.get('set-memory/cal-set-memory').values()][0];
    assert.match(event.description, /Set 1: 20 kg × 12 reps/); assert.match(event.description, /Set 2: 25 kg × 8 reps/);
    assert.doesNotMatch(event.description, /FORM_WORKOUT_V1/);
    await page.locator('[data-action=new-workout]').click();
    assert.equal(await input(0, 'weight').inputValue(), '20'); assert.equal(await input(1, 'weight').inputValue(), '25');
    assert.equal(await input(0, 'reps').inputValue(), '12'); assert.equal(await input(1, 'reps').inputValue(), '8');
    assert.match(await page.locator('[data-set-comparison="0"]').textContent(), /20 kg × 12/);
    assert.match(await page.locator('[data-set-comparison="1"]').textContent(), /25 kg × 8/);
    await page.locator('.progress-detail summary').click();
    assert.equal(await page.locator('.set-progress-table tbody tr').count(), 1);
    await input(1, 'weight').fill('44'); await page.locator('.exercise-heading').click();
    assert.doesNotMatch(await page.locator('.set-progress-table').textContent(), /44 kg/);
    await until(async () => !/Saving/.test(await page.locator('.sync-status').textContent()));
    await context.setOffline(true); await page.reload(); await page.locator('.exercise-card').waitFor();
    assert.equal(await input(1, 'weight').inputValue(), '44');
    await page.locator('.remembered-targets summary').click();
    assert.match(await page.locator('.remembered-pairs').textContent(), /25 kg × 8/);
    other = await browser.newContext({ viewport: { width: 390, height: 1000 } }); await signIn(other);
    const second = await other.newPage(); await second.goto(origin); await second.locator('.exercise-card').waitFor();
    await until(async () => (await second.locator('.set-input[data-set="1"][data-field=weight]').inputValue()) === '25');
    assert.equal(await second.locator('.set-input[data-set="0"][data-field=weight]').inputValue(), '20');
    assert.equal(await second.locator('.set-input[data-set="1"][data-field=reps]').inputValue(), '8');
    await second.screenshot({ path: 'test-results/pair-ledger-real.png', fullPage: true });
    console.log('Pair ledger verified: independent pairs, completed-only memory, calendar sync, matching comparisons, offline reload and a fresh device.');
  } finally { await other?.close(); await context.close(); }
}
