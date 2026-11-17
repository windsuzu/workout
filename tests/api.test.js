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
  assert.doesNotMatch([...f.events.get('u1/cal-u1').values()][0].description, /FORM_WORKOUT_V1|"logs"/);
  const history = await (await f.request('/api/history?from=2026-01-01&to=2027-01-01', { cookie })).json();
  assert.equal(history.events[0].exercises[0].logs[0].weight, 25);
  assert.equal((await save('stale-other-device', session)).status, 409);
  const other = await f.login('u2'); assert.equal((await f.request('/api/sessions/completed-workout', { cookie: other })).status, 404);
});

test('large workouts retain every set in history without putting JSON in Calendar properties', async () => {
  const f = fixture(), cookie = await f.login(); await f.request('/api/calendar/setup', { cookie, method: 'POST', data: {} });
  const { plan } = await (await f.request('/api/state', { cookie })).json();
  for (const exercise of plan.days.A.exercises) exercise.sets = 20;
  const session = newSession(plan, 'A', 'large-workout');
  for (const exercise of session.exercises) for (let i = 0; i < exercise.sets; i++) completeSet(session, exercise.id, i, { weight: i % 2 ? 22.5 : 20, reps: i % 2 ? 8 : 12 });
  finishSession(session, Date.now() + 1000);
  const response = await f.request('/api/sessions/large-workout', { cookie, method: 'PUT', data: { operationId: 'large-save', session } });
  assert.equal(response.status, 200);
  const event = [...f.events.get('u1/cal-u1').values()][0];
  assert.ok(JSON.stringify(session.exercises).length > 1024);
  assert.ok(Object.values(event.extendedProperties.private).every(value => value.length < 1024));
  assert.doesNotMatch(event.description, /FORM_WORKOUT|"logs"|"exercises"/);
  const history = await (await f.request('/api/history?from=2026-01-01&to=2027-01-01', { cookie })).json();
  assert.equal(history.events[0].exercises.length, session.exercises.length);
  for (const exercise of history.events[0].exercises) {
    assert.equal(exercise.logs.length, 20);
    assert.deepEqual(exercise.logs.map(log => [log.weight, log.reps]), Array.from({ length: 20 }, (_, i) => i % 2 ? [22.5, 8] : [20, 12]));
  }
});

test('editable Calendar metadata cannot attach other accounts or mismatched retained workout records', async () => {
  const f = fixture(), cookie = await f.login(); await f.request('/api/calendar/setup', { cookie, method: 'POST', data: {} });
  const { plan } = await (await f.request('/api/state', { cookie })).json();
  const save = async (ownerCookie, id, weight) => {
    const session = newSession(plan, 'A', id); completeSet(session, 'a-0', 0, { weight, reps: 8 }); finishSession(session, Date.now() + 1000);
    const response = await f.request(`/api/sessions/${id}`, { cookie: ownerCookie, method: 'PUT', data: { operationId: `save-${id}`, session } });
    assert.equal(response.status, 200);
  };
  await save(cookie, 'owned-workout', 25);
  const other = await f.login('u2'); await f.request('/api/calendar/setup', { cookie: other, method: 'POST', data: {} });
  await save(other, 'other-workout', 77);
  const ownEvents = f.events.get('u1/cal-u1'), event = [...ownEvents.values()][0];
  // A Calendar write can succeed before its event ID acknowledgement is saved.
  // The deterministic ID still proves the event binding in that retry window.
  const retained = f.store.rows.get('sessions/u1/owned-workout').data;
  delete retained.eventId; retained.sync = 'pending';
  ownEvents.set('same-user-copy', { ...event, id: 'same-user-copy' });
  ownEvents.set('other-user-reference', { ...event, id: 'other-user-reference', extendedProperties: { private: { formOwner: 'u1', formSessionId: 'other-workout' } } });
  ownEvents.set('wrong-owner', { ...event, id: 'wrong-owner', extendedProperties: { private: { formOwner: 'u2', formSessionId: 'owned-workout' } } });
  ownEvents.set('invalid-id', { ...event, id: 'invalid-id', extendedProperties: { private: { formOwner: 'u1', formSessionId: '../u2/other-workout' } } });
  f.events.set('u1/primary', new Map([[event.id, event]]));
  const reads = [], get = f.store.getWithMetadata.bind(f.store);
  f.store.getWithMetadata = async (...args) => { reads.push(args[0]); return get(...args); };
  const response = await f.request('/api/history?from=2026-01-01&to=2027-01-01', { cookie });
  assert.equal(response.status, 200);
  const rows = (await response.json()).events;
  const owned = rows.find(row => row.calendarId === 'cal-u1' && row.id === event.id);
  assert.equal(owned.exercises[0].logs[0].weight, 25);
  for (const row of rows.filter(row => row !== owned)) {
    assert.equal(row.exercises, null); assert.equal(row.sessionId, null);
  }
  assert.ok(reads.filter(key => key.startsWith('sessions/')).every(key => /^sessions\/u1\/[a-zA-Z0-9-]+$/.test(key)));
  assert.equal(reads.includes('sessions/u2/other-workout'), false);
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
  const workout = { id: 'old-a', etag: 'original-event', summary: '訓練 A - Strength', description: 'Original notes and reps', organizer: { self: true }, start: { date: '2026-10-20' }, end: { date: '2026-10-21' }, reminders: { useDefault: true } };
  const unselected = { ...workout, id: 'old-b' }, unrelated = { ...workout, id: 'meeting', summary: 'Dentist' };
  f.events.set('u1/primary', new Map([['old-a', workout], ['old-b', unselected], ['meeting', unrelated]]));
  const preview = await (await f.request('/api/import/preview?from=2026-10-01&to=2026-11-01', { cookie })).json(); assert.equal(preview.events.length, 2);
  const move = await (await f.request('/api/import', { cookie, method: 'POST', data: { eventIds: ['old-a'] } })).json(); assert.deepEqual(move.moved, ['old-a']);
  assert.deepEqual(f.events.get('u1/cal-u1').get('old-a'), workout);
  assert.ok(f.events.get('u1/primary').has('old-b') && f.events.get('u1/primary').has('meeting'));
});

test('protected requests reject missing or changed account identity, including logout', async () => {
  const f = fixture(), cookie = await f.login('u2');
  for (const account of ['', 'u1']) {
    const read = await f.request('/api/state', { cookie, account }); assert.equal(read.status, 409); assert.equal((await read.json()).code, 'account_changed');
    const write = await f.request('/api/plan', { cookie, account, method: 'PATCH', data: { operationId: 'wrong-account', changes: [{ exerciseId: 'a-0', field: 'weight', value: 77 }] } }); assert.equal(write.status, 409);
    assert.equal((await f.request('/api/logout', { cookie, account, method: 'POST', data: {} })).status, 409);
  }
  assert.equal((await (await f.request('/api/me', { cookie })).json()).user.id, 'u2');
  assert.notEqual(f.store.rows.get('users/u2').data.plan.days.A.exercises[0].weight, 77);
});

test('migration rejects recurring masters, instances, and events converted after preview', async () => {
  const f = fixture(), cookie = await f.login(); await f.request('/api/calendar/setup', { cookie, method: 'POST', data: {} });
  const base = { summary: '訓練 A - Strength', organizer: { self: true }, start: { date: '2026-10-20' }, end: { date: '2026-10-21' } };
  const master = { ...base, id: 'master', recurrence: ['RRULE:FREQ=WEEKLY;COUNT=52'] }, instance = { ...base, id: 'instance', recurringEventId: 'master' }, changed = { ...base, id: 'changed' };
  f.events.set('u1/primary', new Map([master, instance, changed].map(event => [event.id, event])));
  const preview = await (await f.request('/api/import/preview?from=2026-10-01&to=2026-11-01', { cookie })).json(); assert.deepEqual(preview.events.map(event => event.id), ['changed']);
  changed.recurrence = ['RRULE:FREQ=DAILY'];
  const result = await (await f.request('/api/import', { cookie, method: 'POST', data: { eventIds: ['master', 'instance', 'changed'] } })).json();
  assert.equal(result.moved.length, 0); assert.equal(result.failed.length, 3);
  assert.equal(f.calls.some(call => new URL(call.url).pathname.endsWith('/move')), false);
  assert.equal(f.events.get('u1/primary').size, 3);
});

test('migration refuses a source event changed between its eligibility read and move', async () => {
  const f = fixture(), cookie = await f.login(); await f.request('/api/calendar/setup', { cookie, method: 'POST', data: {} });
  const event = { id: 'changed-during-move', etag: 'v1', summary: '訓練 A - Strength', organizer: { self: true }, start: { date: '2026-10-20' }, end: { date: '2026-10-21' } };
  f.events.set('u1/primary', new Map([[event.id, event]]));
  f.setGoogleHook(url => { if (url.pathname.endsWith('/move')) { event.recurrence = ['RRULE:FREQ=DAILY']; event.etag = 'v2'; } });
  const result = await (await f.request('/api/import', { cookie, method: 'POST', data: { eventIds: [event.id] } })).json();
  assert.equal(result.moved.length, 0); assert.equal(result.failed.length, 1); assert.ok(f.events.get('u1/primary').has(event.id));
});

test('malformed external structured history does not break the history endpoint', async () => {
  const f = fixture(), cookie = await f.login();
  f.events.set('u1/primary', new Map([['bad-detail', { id: 'bad-detail', summary: '訓練 A - Strength', start: { date: '2026-10-20' }, end: { date: '2026-10-21' }, description: 'FORM_WORKOUT_V1\n{"exercises":[null,{},false]}\nEND_FORM_WORKOUT' }]]));
  const response = await f.request('/api/history?from=2026-10-01&to=2026-11-01', { cookie });
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).events[0].exercises, []);
});
