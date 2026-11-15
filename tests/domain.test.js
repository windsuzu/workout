import test from 'node:test';
import assert from 'node:assert/strict';
import seed from '../workouts.json' with { type: 'json' };
import { applyPlanChanges, completeSet, finishSession, newestFirst, newSession, seedPlan, sessionEvent, undoSet, validateSession } from '../src/domain/model.js';

test('weights, reps and bench angle are snapshots; future defaults cannot rewrite a completed set', () => {
  const plan = seedPlan(seed), session = newSession(plan, 'A', 'test-workout');
  assert.equal(plan.days.A.exercises[0].angle, 0);
  completeSet(session, 'a-0', 0, { weight: 20, reps: 10 });
  const next = applyPlanChanges(plan, [{ exerciseId: 'a-0', field: 'weight', value: 25 }, { exerciseId: 'a-0', field: 'angle', value: 30 }, { exerciseId: 'a-0', field: 'rest', value: 120 }, { exerciseId: 'a-0', field: 'sets', value: 3 }]);
  assert.equal(next.days.A.exercises[0].angle, 30);
  assert.equal(next.days.A.exercises[0].sets, 3);
  assert.equal(session.exercises[0].angle, 0);
  assert.equal(session.exercises[0].logs[0].weight, 20);
  assert.equal(session.exercises[0].logs[0].reps, 10);
  assert.equal(session.exercises[0].logs[0].angle, 0);
  session.exercises[0].logs[0].angle = null;
  session.exercises[0].angle = 45;
  assert.equal(validateSession(session).exercises[0].logs[0].angle, null);
});

test('undoing an earlier set preserves later set numbers and actual values', () => {
  const session = newSession(seedPlan(seed), 'A', 'test-workout');
  completeSet(session, 'a-0', 0, { weight: 20, reps: 10 }); completeSet(session, 'a-0', 1, { weight: 22.5, reps: 8 });
  undoSet(session, 'a-0', 0); finishSession(session, Date.now() + 1000);
  const normalized = validateSession(session);
  assert.equal(normalized.exercises[0].logs[0], null);
  assert.equal(normalized.exercises[0].logs[1].setNumber, 2);
  assert.match(sessionEvent(normalized).description, /Set 2: 22.5 kg × 8 reps/);
  assert.doesNotMatch(sessionEvent(normalized).description, /Set 1:/);
});

test('untrusted set values, media protocols, and destructive stale plan edits are rejected', () => {
  const plan = seedPlan(seed);
  assert.throws(() => applyPlanChanges(plan, [{ exerciseId: 'a-0', field: 'media', value: 'javascript:alert(1)' }]));
  assert.throws(() => applyPlanChanges(plan, [{ exerciseId: 'a-0', field: 'angle', value: 180 }]));
  assert.throws(() => applyPlanChanges(plan, [{ exerciseId: 'a-0', field: 'rest', value: 120, expected: 60 }], { checkExpected: true }), /another device/);
  const session = newSession(plan, 'A', 'test-workout');
  assert.throws(() => completeSet(session, 'a-0', 0, { weight: -1, reps: 12 }));
  assert.throws(() => completeSet(session, 'a-0', 0, { weight: 20, reps: 2.5 }));
});

test('undo cannot invalidate a completed workout by removing its final set', () => {
  const session = newSession(seedPlan(seed), 'A', 'saved-partial'); completeSet(session, 'a-0', 0, { weight: 20, reps: 8 }); finishSession(session);
  assert.throws(() => undoSet(session, 'a-0', 0), /at least one set/);
  assert.ok(validateSession(session).exercises[0].logs[0]);
  completeSet(session, 'a-0', 1, { weight: 22, reps: 8 }); undoSet(session, 'a-0', 0);
  assert.ok(validateSession(session).exercises[0].logs[1]);
});

test('same-day workouts use actual chronology instead of insertion order', () => {
  const morning = { id: 'a', date: '2026-11-14', start: '2026-11-14T08:00:00+08:00' };
  const evening = { id: 'b', date: '2026-11-14', start: '2026-11-14T18:00:00+08:00' };
  const old = { id: 'c', date: '2026-11-13' };
  assert.deepEqual([morning, old, evening].sort(newestFirst).map(row => row.id), ['b', 'a', 'c']);
});

test('Google Calendar event colors consistently identify workout days', () => {
  const plan = seedPlan(seed);
  for (const [day, color] of Object.entries({ A: '7', B: '3', C: '5' })) {
    const session = newSession(plan, day); completeSet(session, session.exercises[0].id, 0, { weight: 20, reps: 8 }); finishSession(session);
    assert.equal(sessionEvent(session).colorId, color);
  }
});
