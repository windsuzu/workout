import test from 'node:test';
import assert from 'node:assert/strict';
import seed from '../workouts.json' with { type: 'json' };
import { applyPlanChanges, completeSet, finishSession, historyEvent, newestFirst, newSession, seedPlan, sessionEvent, setTarget, undoSet, validateSession } from '../src/domain/model.js';

test('legacy defaults migrate to independent set targets without changing previous workout snapshots', () => {
  const legacy = seedPlan(seed), before = newSession(legacy, 'A', 'before-memory');
  const original = { weight: legacy.days.A.exercises[0].weight, reps: legacy.days.A.exercises[0].reps };
  assert.deepEqual(before.exercises[0].drafts, [original, original]);
  const next = applyPlanChanges(legacy, [
    { exerciseId: 'a-0', field: 'setTarget', setIndex: 0, value: { weight: 22.5, reps: 12 } },
    { exerciseId: 'a-0', field: 'setTarget', setIndex: 1, value: { weight: 25, reps: 8 } },
  ]);
  const after = newSession(next, 'A', 'after-memory');
  assert.deepEqual(after.exercises[0].drafts, [{ weight: 22.5, reps: 12 }, { weight: 25, reps: 8 }]);
  after.exercises[0].drafts[0].weight = 30;
  assert.deepEqual(setTarget(next.days.A.exercises[0], 0), { weight: 22.5, reps: 12 });
  assert.deepEqual(before.exercises[0].drafts, [original, original]);
  assert.equal(legacy.days.A.exercises[0].setTargets, undefined);
});

test('independent set target edits merge but stale edits to the same slot conflict', () => {
  const plan = seedPlan(seed), expected = setTarget(plan.days.A.exercises[0], 0);
  const first = { exerciseId: 'a-0', field: 'setTarget', setIndex: 0, expected, value: { weight: 27.5, reps: 10 } };
  const second = { ...first, setIndex: 1, value: { weight: 30, reps: 6 } };
  const merged = applyPlanChanges(applyPlanChanges(plan, [first], { checkExpected: true }), [second], { checkExpected: true });
  assert.deepEqual(merged.days.A.exercises[0].setTargets, [first.value, second.value]);
  assert.throws(() => applyPlanChanges(merged, [{ ...first, value: { weight: 32.5, reps: 8 } }], { checkExpected: true }), /another device/);
  assert.deepEqual(applyPlanChanges(merged, [first], { checkExpected: true }).days.A.exercises[0].setTargets, merged.days.A.exercises[0].setTargets);
  const shorter = applyPlanChanges(merged, [{ exerciseId: 'a-0', field: 'sets', value: 1 }]);
  assert.throws(() => applyPlanChanges(shorter, [second], { checkExpected: true }), error => error.code === 'plan_conflict');
});

test('all-set defaults and changed set counts keep per-slot coordinates and safe fallbacks', () => {
  let plan = applyPlanChanges(seedPlan(seed), [
    { exerciseId: 'a-0', field: 'setTarget', setIndex: 0, value: { weight: 20, reps: 12 } },
    { exerciseId: 'a-0', field: 'setTarget', setIndex: 1, value: { weight: 25, reps: 8 } },
  ]);
  plan = applyPlanChanges(plan, [{ exerciseId: 'a-0', field: 'weight', value: 30 }]);
  assert.deepEqual(newSession(plan, 'A').exercises[0].drafts, [{ weight: 30, reps: 12 }, { weight: 30, reps: 8 }]);
  plan = applyPlanChanges(plan, [{ exerciseId: 'a-0', field: 'reps', value: 10 }, { exerciseId: 'a-0', field: 'sets', value: 1 }]);
  assert.deepEqual(plan.days.A.exercises[0].setTargets, [{ weight: 30, reps: 10 }]);
  plan = applyPlanChanges(plan, [{ exerciseId: 'a-0', field: 'sets', value: 3 }]);
  assert.deepEqual(newSession(plan, 'A').exercises[0].drafts, Array.from({ length: 3 }, () => ({ weight: 30, reps: 10 })));
});

test('guarded all-set edits detect concurrent slot changes and compose with projected expectations', () => {
  const plan = seedPlan(seed), exercise = plan.days.A.exercises[0];
  const initialTargets = Array.from({ length: exercise.sets }, (_, i) => setTarget(exercise, i));
  const bulkWeight = { exerciseId: 'a-0', field: 'weight', value: 30, expected: exercise.weight, expectedTargets: initialTargets };
  const changedSlot = applyPlanChanges(plan, [{ exerciseId: 'a-0', field: 'setTarget', setIndex: 1, value: { weight: 25, reps: 8 } }]);
  assert.throws(() => applyPlanChanges(changedSlot, [bulkWeight], { checkExpected: true }), error => error.code === 'plan_conflict');
  const afterWeight = applyPlanChanges(plan, [bulkWeight], { checkExpected: true });
  const projectedTargets = Array.from({ length: exercise.sets }, (_, i) => setTarget(afterWeight.days.A.exercises[0], i));
  const bulkReps = { exerciseId: 'a-0', field: 'reps', value: 10, expected: exercise.reps, expectedTargets: projectedTargets };
  const updated = applyPlanChanges(plan, [bulkWeight, bulkReps], { checkExpected: true });
  assert.deepEqual(newSession(updated, 'A').exercises[0].drafts, [{ weight: 30, reps: 10 }, { weight: 30, reps: 10 }]);
  for (const expectedTargets of [null, [], [initialTargets[0]], [{ weight: -1, reps: 8 }, initialTargets[1]]]) {
    assert.throws(() => applyPlanChanges(plan, [{ ...bulkWeight, expectedTargets }], { checkExpected: true }));
  }
  // Existing callers that have no target-array guard keep the old bulk behavior.
  const legacy = { ...bulkWeight }; delete legacy.expectedTargets;
  assert.deepEqual(newSession(applyPlanChanges(changedSlot, [legacy], { checkExpected: true }), 'A').exercises[0].drafts, [{ weight: 30, reps: exercise.reps }, { weight: 30, reps: 8 }]);
});

test('a valid changed set count produces a bulk-plan conflict while malformed expectations remain invalid', () => {
  const plan = seedPlan(seed), e = plan.days.A.exercises[0];
  const expectedTargets = Array.from({ length: e.sets }, (_, i) => setTarget(e, i));
  const change = { exerciseId: 'a-0', field: 'weight', value: 30, expected: e.weight, expectedTargets };
  for (const sets of [1, 3]) {
    const cloud = applyPlanChanges(plan, [{ exerciseId: e.id, field: 'sets', value: sets }]);
    assert.throws(() => applyPlanChanges(cloud, [change], { checkExpected: true }), error => error.status === 409 && error.code === 'plan_conflict' && error.details.plan.days.A.exercises[0].sets === sets);
    assert.throws(() => applyPlanChanges(cloud, [change]), error => error.status === 400);
    assert.equal(cloud.days.A.exercises[0].weight, e.weight);
  }
  for (const invalid of [null, [], Array(21).fill(expectedTargets[0]), [{ weight: -1, reps: 12 }]]) {
    assert.throws(() => applyPlanChanges(plan, [{ ...change, expectedTargets: invalid }], { checkExpected: true }), error => error.status === 400);
  }
});

test('invalid set target indexes, values and dynamic property names are rejected without changing the plan', () => {
  const plan = seedPlan(seed), original = structuredClone(plan);
  const change = { exerciseId: 'a-0', field: 'setTarget', setIndex: 0, value: { weight: 20, reps: 12 } };
  for (const setIndex of [-1, 2, 0.5, '0', '__proto__', undefined]) assert.throws(() => applyPlanChanges(plan, [{ ...change, setIndex }]));
  for (const value of [null, { weight: -1, reps: 12 }, { weight: 1001, reps: 12 }, { weight: 20, reps: 1.5 }, { weight: '20', reps: 12 }]) assert.throws(() => applyPlanChanges(plan, [{ ...change, value }]));
  assert.throws(() => applyPlanChanges(plan, [{ ...change, field: '__proto__' }]));
  assert.throws(() => applyPlanChanges(plan, [{ ...change, expected: null }], { checkExpected: true }));
  assert.deepEqual(plan, original);
});

test('normalizing a session retains validated target memory for later undo while accepting old logs', () => {
  const plan = applyPlanChanges(seedPlan(seed), [{ exerciseId: 'a-0', field: 'setTarget', setIndex: 1, value: { weight: 25, reps: 8 } }]);
  const session = newSession(plan, 'A', 'undo-memory');
  completeSet(session, 'a-0', 0, { weight: 30, reps: 10 });
  const log = session.exercises[0].logs[0];
  log.previousTarget = { weight: 22.5, reps: 12 }; log.rememberedTarget = { weight: 30, reps: 10 };
  const normalized = validateSession(session);
  assert.deepEqual(normalized.exercises[0].logs[0].previousTarget, { weight: 22.5, reps: 12 });
  assert.deepEqual(normalized.exercises[0].logs[0].rememberedTarget, { weight: 30, reps: 10 });
  assert.deepEqual(normalized.exercises[0].setTargets, plan.days.A.exercises[0].setTargets);
  assert.doesNotMatch(sessionEvent(normalized).description, /previousTarget|rememberedTarget/);
  log.previousTarget = { weight: -1, reps: 12 };
  assert.throws(() => validateSession(session));
  delete log.previousTarget; delete log.rememberedTarget;
  assert.equal(Object.hasOwn(validateSession(session).exercises[0].logs[0], 'previousTarget'), false);
});

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

test('Calendar descriptions contain readable sets and notes while retained records supply offline history', () => {
  const session = newSession(seedPlan(seed), 'A', 'readable-workout');
  completeSet(session, 'a-0', 0, { weight: 20, reps: 12 });
  completeSet(session, 'a-0', 1, { weight: 22.5, reps: 8 });
  session.notes = 'Felt strong today.'; finishSession(session);
  const event = sessionEvent(session);
  assert.match(event.description, /Set 1: 20 kg × 12 reps/);
  assert.match(event.description, /Set 2: 22.5 kg × 8 reps/);
  assert.match(event.description, /bench 0°/);
  assert.match(event.description, /Notes:\nFelt strong today\./);
  assert.doesNotMatch(event.description, /FORM_WORKOUT|END_FORM_WORKOUT|"exercises"|"logs"/);
  assert.deepEqual(event.extendedProperties.private, { formVersion: '2', formSessionId: session.id });
  const history = historyEvent(event, 'local', session);
  assert.equal(history.exercises.length, 1);
  assert.deepEqual(history.exercises[0].logs.map(log => [log.weight, log.reps, log.angle]), [[20, 12, 0], [22.5, 8, 0]]);
});

test('legacy JSON descriptions still recover set slots when a retained record is unavailable', () => {
  const detail = { day: 'B', exercises: [{ id: 'b-0', name: 'Shoulder press', unit: 'kg', logs: [null, { weight: 15, reps: 9, angle: 75 }] }] };
  const history = historyEvent({ summary: '訓練 B - Strength', start: { date: '2026-10-20' }, end: { date: '2026-10-21' }, description: `Old workout\nFORM_WORKOUT_V1\n${JSON.stringify(detail)}\nEND_FORM_WORKOUT` }, 'primary');
  assert.equal(history.day, 'B');
  assert.deepEqual(history.exercises[0].logs, [null, { weight: 15, reps: 9, angle: 75, setNumber: 2 }]);
});
