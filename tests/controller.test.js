import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import seed from '../workouts.json' with { type: 'json' };
import { Controller } from '../src/client/controller.js';
import { fixture } from './helpers.js';

Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });

async function client(t) {
  const f = fixture(), rows = new Map(); let cookie = await f.login(), afterRequest;
  const storage = { persistent: true, get: async key => structuredClone(rows.get(key)), set: async (key, value) => { rows.set(key, structuredClone(value)); } };
  const c = new Controller({ storage, fetcher: async (path, options = {}) => {
    if (path === '/workouts.json') return Response.json(seed);
    const response = await f.api(new Request(f.env.APP_URL + path, { ...options, headers: { ...options.headers, Origin: f.env.APP_URL, Cookie: cookie } }));
    if (afterRequest) await afterRequest(path);
    return response;
  } });
  c.scheduleSync = () => {};
  t.after(() => { clearTimeout(c.syncTimer); clearTimeout(c.retryTimer); });
  await c.start(); while (c.syncing) await delay(1);
  return { c, f, rows, setCookie: value => { cookie = value; }, afterRequest: value => { afterRequest = value; } };
}

test('changing Google accounts cannot pull or upload the previous account cache', async t => {
  const { c, f, setCookie, rows } = await client(t);
  c.online = false; c.complete(0, { weight: 31, reps: 8 }); await c.persistChain;
  const id = c.current.id; setCookie(await f.login('u2'));
  await c.reconnect(); await c.flush(); await c.persistChain;
  assert.equal(c.accountChanged, true); assert.equal(c.authorized, false);
  assert.equal(c.accountKey, 'account:u1'); assert.equal(c.user.id, 'u1');
  assert.equal(c.data.outbox[id].session.exercises[0].logs[0].weight, 31);
  assert.equal(rows.get('account:u1').sessions[id].exercises[0].logs[0].weight, 31);
  assert.equal(f.store.rows.has(`sessions/u2/${id}`), false);
});

test('the expected-account guard blocks a cookie switch in the middle of an outbox flush', async t => {
  const { c, f, setCookie, afterRequest } = await client(t), secondCookie = await f.login('u2');
  c.online = false; c.complete(0, { weight: 20, reps: 8 });
  const first = c.current.id; c.setDay('B'); c.complete(0, { weight: 24, reps: 8 }); const second = c.current.id;
  afterRequest(path => { if (path === `/api/sessions/${first}`) setCookie(secondCookie); });
  c.online = true; await c.flush();
  assert.equal(c.accountChanged, true);
  assert.equal(f.store.rows.has(`sessions/u1/${first}`), true);
  assert.equal(f.store.rows.has(`sessions/u2/${second}`), false);
  assert.ok(c.data.outbox[second]);
});

test('a synced correction immediately updates cached history, including when going offline', async t => {
  const { c, f } = await client(t); await c.setupCalendar();
  c.online = false; c.complete(0, { weight: 20, reps: 8 }); c.finish();
  c.online = true; await c.flush(); await c.refreshHistory();
  assert.equal(c.history()[0].exercises[0].logs[0].weight, 20);
  c.editSet(0, 'weight', 25); await c.flush(); c.online = false;
  assert.equal(c.pendingCount, 0);
  assert.equal(c.history()[0].exercises[0].logs[0].weight, 25);
  assert.match([...f.events.get('u1/cal-u1').values()][0].description, /25 kg/);
});

test('pausing expired rest normalizes it to ready and keeps the combined action usable', async t => {
  const { c } = await client(t); c.online = false;
  c.complete(0, { weight: 20, reps: 8 }); c.exercise.timer.deadline = Date.now() - 1;
  c.toggleRest(); assert.equal(c.exercise.timer.phase, 'ready'); assert.equal(c.exercise.timer.remaining, 0);
  c.complete(1, { weight: 20, reps: 8 }); assert.ok(c.exercise.logs[1]);
});
