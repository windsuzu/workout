import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { completeSet, finishSession, newSession } from '../src/domain/model.js';

test('Google login uses PKCE and secure cookies; forged state and cross-origin writes are rejected', async () => {
  const f = fixture(), begin = await f.request('/api/auth/google');
  const url = new URL(begin.headers.get('location'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(begin.headers.get('set-cookie').includes('HttpOnly; SameSite=Lax'));
  assert.ok(begin.headers.get('set-cookie').includes('Secure'));
  const bad = await f.request('/api/auth/callback?state=forged&code=u1'); assert.equal(bad.status, 400);
  const cookie = await f.login();
  const me = await (await f.request('/api/me', { cookie })).json(); assert.equal(me.user.id, 'u1');
  const raw = JSON.stringify([...f.store.rows.values()]);
  assert.ok(!raw.includes('refresh-u1') && !raw.includes('access-u1'));
  const cross = await f.request('/api/plan', { cookie, method: 'PATCH', origin: 'https://attacker.example', data: {} }); assert.equal(cross.status, 403);
});

test('saved rest, set count and bench angle survive reload; concurrent independent edits merge', async () => {
  const f = fixture(), cookie = await f.login();
  const change = (operationId, changes) => f.request('/api/plan', { cookie, method: 'PATCH', data: { operationId, changes } });
  const replies = await Promise.all([
    change('angle-change', [{ exerciseId: 'a-0', field: 'angle', expected: 0, value: 30 }]),
    change('rest-change', [{ exerciseId: 'a-0', field: 'rest', expected: 90, value: 120 }, { exerciseId: 'a-0', field: 'sets', expected: 2, value: 3 }]),
  ]);
  assert.deepEqual(replies.map(r => r.status), [200, 200]);
  const state = await (await f.request('/api/state', { cookie })).json(), exercise = state.plan.days.A.exercises[0];
  assert.equal(exercise.rest, 120); assert.equal(exercise.angle, 30); assert.equal(exercise.sets, 3);
  assert.equal((await change('angle-change', [{ exerciseId: 'a-0', field: 'angle', expected: 0, value: 30 }])).status, 200);
  assert.equal((await change('stale-angle', [{ exerciseId: 'a-0', field: 'angle', expected: 0, value: 45 }])).status, 409);
  const other = await f.login('u2');
  assert.equal((await (await f.request('/api/state', { cookie: other })).json()).plan.days.A.exercises[0].angle, 0);
});

test('finishing creates one calendar event, retries do not duplicate it, and corrections update it', async () => {
  const f = fixture(), cookie = await f.login(); await f.request('/api/calendar/setup', { cookie, method: 'POST', data: {} });
  const { plan } = await (await f.request('/api/state', { cookie })).json();
  const session = newSession(plan, 'A', 'completed-workout'); completeSet(session, 'a-0', 0, { weight: 22.5, reps: 10 }); finishSession(session, Date.now() + 1000);
  const save = (operationId, session) => f.request(`/api/sessions/${session.id}`, { cookie, method: 'PUT', data: { operationId, session } });
  const first = await (await save('first-save', session)).json(); assert.equal(first.session.sync, 'synced');
  const replay = await (await save('first-save', session)).json(); assert.equal(replay.session.revision, 1);
  assert.equal(f.events.get('u1/cal-u1').size, 1);
  const corrected = first.session; corrected.exercises[0].logs[0].weight = 25;
  const update = await (await save('correction', corrected)).json(); assert.equal(update.session.sync, 'synced');
  assert.equal(f.events.get('u1/cal-u1').size, 1);
  assert.match([...f.events.get('u1/cal-u1').values()][0].description, /25 kg × 10 reps/);
  assert.equal((await save('stale-other-device', session)).status, 409);
  const other = await f.login('u2'); assert.equal((await f.request('/api/sessions/completed-workout', { cookie: other })).status, 404);
});

test('a failed Google write preserves the server record and can be retried safely', async () => {
  const f = fixture(), cookie = await f.login(); await f.request('/api/calendar/setup', { cookie, method: 'POST', data: {} });
  const { plan } = await (await f.request('/api/state', { cookie })).json(); const session = newSession(plan, 'A', 'offline-retry');
  completeSet(session, 'a-0', 0, { weight: 20, reps: 8 }); finishSession(session, Date.now() + 1000);
  f.setSyncFailure(true);
  const pending = await f.request('/api/sessions/offline-retry', { cookie, method: 'PUT', data: { operationId: 'retry-me', session } }); assert.equal(pending.status, 202);
  assert.equal((await (await f.request('/api/sessions/offline-retry', { cookie })).json()).session.exercises[0].logs[0].weight, 20);
  f.setSyncFailure(false);
  const saved = await (await f.request('/api/sessions/offline-retry', { cookie, method: 'PUT', data: { operationId: 'retry-me', session } })).json(); assert.equal(saved.session.sync, 'synced');
  assert.equal(f.events.get('u1/cal-u1').size, 1);
});

test('a correction arriving during Calendar sync wins without duplicates or a stale revision acknowledgement', async () => {
  const f = fixture(), cookie = await f.login(); await f.request('/api/calendar/setup', { cookie, method: 'POST', data: {} });
  const { plan } = await (await f.request('/api/state', { cookie })).json();
  const session = newSession(plan, 'A', 'concurrent-calendar'); completeSet(session, 'a-0', 0, { weight: 20, reps: 8 }); finishSession(session, Date.now() + 1000);
  let entered, release; const started = new Promise(resolve => { entered = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  f.setGoogleHook(async (url, options) => { if (options.method === 'POST' && url.pathname.endsWith('/events')) { entered(); await blocked; } });
  const save = (operationId, session) => f.request('/api/sessions/concurrent-calendar', { cookie, method: 'PUT', data: { operationId, session } });
  const initial = save('first', session); await started;
  const correction = (await (await f.request('/api/sessions/concurrent-calendar', { cookie })).json()).session;
  correction.exercises[0].logs[0].weight = 25;
  const second = await save('second', correction); assert.equal(second.status, 202);
  release(); const first = await initial; assert.equal(first.status, 409);
  const data = await first.json(); assert.equal(data.code, 'session_conflict'); assert.equal(data.details.session.revision, 2);
  const retry = await (await save('second', correction)).json(); assert.equal(retry.session.sync, 'synced');
  assert.equal(f.events.get('u1/cal-u1').size, 1);
  assert.match([...f.events.get('u1/cal-u1').values()][0].description, /Set 1: 25 kg × 8 reps/);
});

test('concurrent calendar setup creates one dedicated calendar', async () => {
  const f = fixture(), cookie = await f.login();
  const results = await Promise.all([1, 2].map(() => f.request('/api/calendar/setup', { cookie, method: 'POST', data: {} })));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(f.calls.filter(call => call.method === 'POST' && new URL(call.url).pathname === '/calendar/v3/calendars').length, 1);
  const retried = await (await f.request('/api/calendar/setup', { cookie, method: 'POST', data: {} })).json(); assert.equal(retried.calendar.id, 'cal-u1');
});

test('migration previews only personal workouts and moves exactly selected records unchanged', async () => {
  const f = fixture(), cookie = await f.login(); await f.request('/api/calendar/setup', { cookie, method: 'POST', data: {} });
  const workout = { id: 'old-a', summary: '訓練 A - Strength', description: 'Original notes and reps', organizer: { self: true }, start: { date: '2026-10-20' }, end: { date: '2026-10-21' }, reminders: { useDefault: true } };
  const unselected = { ...workout, id: 'old-b' }, unrelated = { ...workout, id: 'meeting', summary: 'Dentist' };
  f.events.set('u1/primary', new Map([['old-a', workout], ['old-b', unselected], ['meeting', unrelated]]));
  const preview = await (await f.request('/api/import/preview?from=2026-10-01&to=2026-11-01', { cookie })).json(); assert.equal(preview.events.length, 2);
  const move = await (await f.request('/api/import', { cookie, method: 'POST', data: { eventIds: ['old-a'] } })).json(); assert.deepEqual(move.moved, ['old-a']);
  assert.deepEqual(f.events.get('u1/cal-u1').get('old-a'), workout);
  assert.ok(f.events.get('u1/primary').has('old-b') && f.events.get('u1/primary').has('meeting'));
});
