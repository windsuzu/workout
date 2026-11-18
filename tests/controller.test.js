import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import seed from '../workouts.json' with { type: 'json' };
import { Controller } from '../src/client/controller.js';
import { fixture } from './helpers.js';
import { applyPlanChanges, setTarget } from '../src/domain/model.js';

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

async function anotherDevice(t, original, storage = null) {
  const rows = new Map();
  const c = new Controller({ fetcher: original.fetcher, storage: storage || { persistent: true, get: async key => structuredClone(rows.get(key)), set: async (key, value) => { rows.set(key, structuredClone(value)); } } });
  c.scheduleSync = () => {};
  t.after(() => { clearTimeout(c.syncTimer); clearTimeout(c.retryTimer); });
  await c.start(); while (c.syncing) await delay(1);
  return c;
}

test('completed sets remember independent pairs across reload and another device without carrying unfinished edits', async t => {
  const { c } = await client(t); c.online = false;
  const before = setTarget(c.data.plan.days.A.exercises[0], 1);
  c.editSet(1, 'weight', 44); c.editSet(1, 'reps', 6);
  assert.equal(c.data.planOps.length, 0);
  c.complete(0, { weight: 20, reps: 12 }); await c.persistChain;
  const reloaded = await anotherDevice(t, c, c.storage);
  assert.deepEqual(setTarget(reloaded.data.plan.days.A.exercises[0], 0), { weight: 20, reps: 12 });
  assert.deepEqual(setTarget(reloaded.data.plan.days.A.exercises[0], 1), before);
  reloaded.complete(1, { weight: 25, reps: 8 }); await reloaded.flush();
  const remote = await anotherDevice(t, c);
  remote.newWorkout();
  assert.deepEqual(remote.exercise.drafts, [{ weight: 20, reps: 12 }, { weight: 25, reps: 8 }]);
});

test('undo and live corrections restore only their matching target after a fresh-device resume', async t => {
  const { c } = await client(t), original = setTarget(c.data.plan.days.A.exercises[0], 0);
  c.complete(0, { weight: 20, reps: 12 }); c.complete(1, { weight: 25, reps: 8 }); await c.flush();
  const remote = await anotherDevice(t, c); remote.online = false;
  remote.editSet(0, 'reps', 10);
  assert.deepEqual(setTarget(remote.data.plan.days.A.exercises[0], 0), { weight: 20, reps: 10 });
  remote.undo(0);
  assert.deepEqual(setTarget(remote.data.plan.days.A.exercises[0], 0), original);
  assert.deepEqual(setTarget(remote.data.plan.days.A.exercises[0], 1), { weight: 25, reps: 8 });
  assert.equal(remote.exercise.logs[1].weight, 25);
});

test('undoing an older draft and editing saved history cannot overwrite newer remembered pairs', async t => {
  const { c } = await client(t); c.online = false;
  c.complete(0, { weight: 20, reps: 12 }); const older = c.current.id;
  c.newWorkout(); c.complete(0, { weight: 30, reps: 6 });
  c.resume(older); c.undo(0);
  assert.deepEqual(setTarget(c.data.plan.days.A.exercises[0], 0), { weight: 30, reps: 6 });
  c.complete(0, { weight: 22, reps: 10 }); c.finish();
  c.editSet(0, 'weight', 99);
  assert.deepEqual(setTarget(c.data.plan.days.A.exercises[0], 0), { weight: 22, reps: 10 });
  assert.equal(c.current.exercises[0].logs[0].weight, 99);
});

test('same-slot conflicts can keep either device while different slots merge', async t => {
  const { c } = await client(t), remote = await anotherDevice(t, c);
  c.online = false; remote.online = false;
  c.complete(0, { weight: 20, reps: 12 }); remote.complete(1, { weight: 25, reps: 8 });
  c.online = true; await c.flush(); remote.online = true; await remote.flush();
  assert.equal(remote.conflict, undefined);
  assert.deepEqual(remote.data.plan.days.A.exercises[0].setTargets, [{ weight: 20, reps: 12 }, { weight: 25, reps: 8 }]);
  const rival = await anotherDevice(t, c); rival.online = false; rival.newWorkout();
  c.newWorkout(); c.complete(0, { weight: 30, reps: 5 }); await c.flush();
  rival.complete(0, { weight: 35, reps: 4 }); rival.online = true; await rival.flush();
  assert.equal(rival.conflict.type, 'plan');
  rival.online = false; rival.resolveConflict('local'); rival.online = true; await rival.flush();
  assert.deepEqual(setTarget(rival.data.cloudPlan.days.A.exercises[0], 0), { weight: 35, reps: 4 });
  assert.deepEqual(setTarget(rival.data.cloudPlan.days.A.exercises[0], 1), { weight: 25, reps: 8 });
});

test('a remotely removed future slot preserves local work through either conflict choice', async t => {
  for (const choice of ['local', 'cloud']) {
    const { c } = await client(t); c.online = false; c.complete(1, { weight: 25, reps: 8 });
    c.data.cloudPlan = applyPlanChanges(c.data.cloudPlan, [{ exerciseId: 'a-0', field: 'sets', value: 1 }]);
    assert.throws(() => c.rebuildPlan(), /planned sets changed/);
    assert.equal(c.exercise.logs[1].weight, 25);
    c.resolveConflict(choice);
    assert.equal(c.data.plan.days.A.exercises[0].sets, choice === 'local' ? 2 : 1);
    if (choice === 'local') assert.deepEqual(setTarget(c.data.plan.days.A.exercises[0], 1), { weight: 25, reps: 8 });
    assert.equal(c.exercise.logs[1].weight, 25);
  }
});

test('importing local workouts keeps both set targets and their undo history', async t => {
  const { c, rows } = await client(t); c.online = false;
  c.complete(0, { weight: 20, reps: 12 }); c.complete(1, { weight: 25, reps: 8 });
  const guest = structuredClone(c.data); rows.set('account:guest', guest);
  c.data.plan = structuredClone(c.data.cloudPlan); c.data.planOps = []; c.data.outbox = {}; c.data.sessions = {}; c.data.active = {}; c.ensureActive();
  await c.importLocalWorkouts();
  assert.deepEqual(c.data.plan.days.A.exercises[0].setTargets, [{ weight: 20, reps: 12 }, { weight: 25, reps: 8 }]);
  assert.deepEqual(c.data.sessions[Object.keys(guest.sessions)[0]].exercises[0].logs[0].previousTarget, { weight: 22.5, reps: 12 });
});

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

test('a delayed state read cannot replace newer acknowledged defaults', async t => {
  const { c, afterRequest } = await client(t);
  let release, entered; const blocked = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  afterRequest(async path => { if (path === '/api/state') { entered(); await blocked; } });
  const pull = c.pull(); await started;
  c.updateExercise({ weight: 37.5 }, 'future'); await c.flush();
  release(); await pull; c.newWorkout();
  assert.equal(c.exercise.weight, 37.5); assert.equal(c.data.cloudPlan.version, 1);
});

test('a delayed history read cannot overwrite a newer correction acknowledgement', async t => {
  const { c, afterRequest } = await client(t); await c.setupCalendar();
  c.online = false; c.complete(0, { weight: 20, reps: 8 }); c.finish(); c.online = true; await c.flush();
  let release, entered; const blocked = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  afterRequest(async path => { if (path.startsWith('/api/history')) { entered(); await blocked; } });
  const refresh = c.refreshHistory(); await started;
  c.editSet(0, 'weight', 25); await c.flush(); release(); await refresh; c.online = false;
  assert.equal(c.history()[0].exercises[0].logs[0].weight, 25);
});

test('a delayed plan acknowledgement cannot replace a newer cloud plan', async t => {
  const { c, f, afterRequest } = await client(t);
  let release, entered; const blocked = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  afterRequest(async path => { if (path === '/api/plan') { entered(); await blocked; } });
  c.updateExercise({ weight: 25 }, 'future'); const flush = c.flush(); await started;
  const cookie = await f.login();
  await f.request('/api/plan', { cookie, method: 'PATCH', data: { operationId: 'other-device', changes: [{ exerciseId: 'a-0', field: 'rest', expected: 90, value: 150 }] } });
  await c.pull(); release(); await flush;
  assert.equal(c.data.cloudPlan.version, 2); assert.equal(c.data.plan.days.A.exercises[0].rest, 150); assert.equal(c.data.plan.days.A.exercises[0].weight, 25);
});

test('stalled startup falls back to the saved workout even when the device reports online', async t => {
  const { c, rows } = await client(t); c.online = false;
  c.complete(0, { weight: 32, reps: 8 }); await c.persistChain;
  const offline = new Controller({ storage: { persistent: true, get: async key => structuredClone(rows.get(key)), set: async (key, value) => rows.set(key, structuredClone(value)) }, fetcher: async (path, options) => {
    if (path === '/api/me') return new Promise((_, reject) => {
      // A real network request keeps Node alive; AbortSignal.timeout alone is unref'ed on Node 22.
      const request = setTimeout(() => reject(new Error('Network still stalled')), 10000);
      t.after(() => clearTimeout(request));
      options.signal.addEventListener('abort', () => { clearTimeout(request); reject(options.signal.reason); }, { once: true });
    });
    return Response.json(seed);
  } });
  offline.scheduleSync = () => {};
  const started = Date.now(); await offline.start(); assert.ok(Date.now() - started < 6500);
  assert.equal(offline.online, false); assert.equal(offline.current.exercises[0].logs[0].weight, 32);
  assert.match(offline.error, /Offline copy loaded/);
});

test('guest recovery clears connection errors while retaining unrelated save errors', async () => {
  let connected = false; const rows = new Map();
  const c = new Controller({ storage: { persistent: true, get: async key => rows.get(key), set: async (key, value) => rows.set(key, structuredClone(value)) }, fetcher: async path => {
    if (path === '/api/me') { if (!connected) throw new Error('offline'); return Response.json({ user: null, configured: true }); }
    return Response.json(seed);
  } });
  await c.start(); assert.match(c.error, /Offline copy loaded/);
  connected = true; await c.reconnect(); assert.equal(c.error, ''); assert.equal(c.online, true);
  c.error = 'Device could not save the latest changes.';
  await c.reconnect(); assert.equal(c.error, 'Device could not save the latest changes.');
});
