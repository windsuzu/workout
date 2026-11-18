import test from 'node:test';
import assert from 'node:assert/strict';
import { calendar, comparison, exerciseDialog, peekNavigation, restNavigation, setComparison, setLedger, workout } from '../src/client/views.js';
import seed from '../workouts.json' with { type: 'json' };
import { newSession, seedPlan } from '../src/domain/model.js';

test('calendar colors reflect logged days and preserve every day on mixed dates', () => {
  const history = ['A', 'B', 'C'].map((day, i) => ({ id: day, day, date: `2026-10-${20 + i}`, title: `訓練 ${day} - Workout`, description: '' }));
  history.push({ ...history[0], id: 'mixed', date: '2026-10-21' });
  const context = { history: () => history, month: '2026-10', selectedDate: '2026-10-21', authorized: false };
  const html = calendar(context);
  assert.match(html, /data-date="2026-10-20" data-workout-day="A"/);
  assert.match(html, /data-date="2026-10-22" data-workout-day="C"/);
  assert.match(html, /2026-10-21, 2 workouts, Day A and B/);
  assert.match(html, /heat-marks[^>]*><i data-workout-day="A"><\/i><i data-workout-day="B">/);
  for (const day of ['A', 'B']) assert.match(html, new RegExp(`history-entry" data-workout-day="${day}"`));
});

test('Peek shows the upcoming set weight and safely labels exercise boundaries', () => {
  const current = newSession(seedPlan(seed), 'A');
  current.exercises[1].drafts[0].weight = 30;
  current.exercises[1].angle = 0;
  current.exercises[1].name = '<img src=x onerror="alert(1)">';
  const html = peekNavigation({ current, index: 0 });
  assert.match(html, /data-action="previous"[^>]* disabled/); assert.match(html, /peek-weight">30 /);
  assert.match(html, /Angle 0°/); assert.match(html, /aria-keyshortcuts="ArrowRight"/);
  assert.ok(!html.includes('<img')); assert.match(html, /&lt;img/);
  assert.match(peekNavigation({ current, index: 5 }), /data-action="next"[^>]* disabled/);
  current.exercises[0].angle = 30;
  assert.match(peekNavigation({ current, index: 1 }), /Previous exercise:[^\"]*Angle 30°/);
  current.exercises[0].angle = null;
  assert.match(peekNavigation({ current, index: 1 }), /Angle not set/);
});

test('return controls show other running or paused rests, excluding the current exercise', () => {
  const current = newSession(seedPlan(seed), 'A'); current.exercises[0].timer = { phase: 'paused', remaining: 45, deadline: null };
  assert.match(restNavigation({ current, index: 1 }), /data-rest-index="0"/);
  assert.match(restNavigation({ current, index: 1 }), /Paused[\s\S]*0:45/);
  assert.ok(!restNavigation({ current, index: 0 }).includes('data-rest-index'));
  current.exercises[0].timer.phase = 'ready';
  assert.ok(!restNavigation({ current, index: 1 }).includes('data-rest-index'));
});

function ledgerContext(history = []) {
  const plan = seedPlan(seed), current = newSession(plan, 'A', 'today');
  return { current, exercise: current.exercises[0], day: 'A', index: 0, history: () => history, data: { plan, active: { A: current.id }, sessions: { [current.id]: current } } };
}
function previous(c, logs, overrides = {}) {
  return { sessionId: 'previous', day: 'A', date: '2026-11-14', start: '2026-11-14T12:00:00+08:00', exercises: [{ id: c.exercise.id, name: c.exercise.name, unit: 'kg', logs }], ...overrides };
}

test('Pair ledger compares each weight/reps pair with the same numbered set', () => {
  const c = ledgerContext();
  c.exercise.drafts = [{ weight: 26, reps: 9 }, { weight: 35, reps: 6 }];
  c.history = () => [previous(c, [{ setNumber: 1, weight: 20, reps: 12 }, { setNumber: 2, weight: 35, reps: 6 }])];
  assert.match(setComparison(c, 0), /20 kg × 12[\s\S]*Planned · \+6 kg · −3 reps/);
  assert.match(setComparison(c, 1), /35 kg × 6[\s\S]*same weight · same reps/);
  c.exercise.logs[0] = { weight: 26, reps: 9, setNumber: 1 };
  assert.match(setLedger(c), /set-row logged/);
  assert.match(setComparison(c, 0), /Recorded/);
});

test('latest partial history keeps missing sets honest and respects explicit sparse set numbers', () => {
  const c = ledgerContext();
  const old = previous(c, [{ weight: 99, reps: 10, setNumber: 1 }], { date: '2026-11-12', start: '2026-11-12T12:00:00+08:00' });
  const latest = previous(c, [{ weight: 27, reps: 8, setNumber: 2 }]);
  c.history = () => [old, latest];
  assert.match(setComparison(c, 0), /Not recorded[\s\S]*No matching set/);
  assert.doesNotMatch(setComparison(c, 0), /99 kg|27 kg/);
  assert.match(setComparison(c, 1), /27 kg × 8/);
  c.history = () => [previous(c, [], { exercises: null }), latest, old];
  assert.match(setComparison(c, 0), /Not recorded/);
});

test('a workout that skipped the entire exercise does not hide its last recorded session', () => {
  const c = ledgerContext();
  const recorded = previous(c, [{ weight: 22.5, reps: 12, setNumber: 1 }]);
  const skipped = previous(c, [], { date: '2026-11-16', start: '2026-11-16T12:00:00+08:00', exercises: [{ id: 'a-1', unit: 'kg', logs: [{ weight: 24, reps: 12 }] }] });
  c.history = () => [skipped, recorded];
  assert.match(setComparison(c, 0), /Nov 14 · 22\.5 kg × 12/);
  assert.doesNotMatch(setComparison(c, 0), /Nov 16|24 kg/);
});

test('unit changes show prior values without subtracting incomparable weights, and escape text', () => {
  const c = ledgerContext();
  c.history = () => [previous(c, [{ weight: 45, reps: 8 }], { exercises: [{ id: c.exercise.id, unit: '<lb>', logs: [{ weight: 45, reps: 8 }] }] })];
  const html = setComparison(c, 0);
  assert.match(html, /45 &lt;lb&gt; × 8/);
  assert.match(html, /Different units · no direct comparison/);
  assert.ok(!html.includes('<lb>'));
});

test('progress retains chronological per-set records and current rows never invent unfinished sets', () => {
  const c = ledgerContext();
  c.exercise.logs[0] = { weight: 31, reps: 10, setNumber: 1 };
  c.history = () => [previous(c, [null, { weight: 25, reps: 8, setNumber: 2 }]), previous(c, [{ weight: 20, reps: 12, setNumber: 1 }], { start: '2026-11-12T12:00:00+08:00', date: '2026-11-12' })];
  const html = comparison(c), table = html.match(/<table[\s\S]*?<\/table>/)[0];
  assert.ok(table.indexOf('20 kg × 12') < table.indexOf('25 kg × 8'));
  assert.match(table, /Set 1[\s\S]*Set 2/);
  assert.match(table, /This workout<\/th><td>31 kg × 10<\/td><td>Not recorded<\/td>/);
  assert.doesNotMatch(table, /Best completed|best-set|22\.5 kg/);
});

test('remembered pairs use the future plan slots, and the workout has no misleading single weight', () => {
  const c = ledgerContext(), future = c.data.plan.days.A.exercises[0];
  future.sets = 3; future.setTargets = [{ weight: 22.5, reps: 12 }, { weight: 25, reps: 8 }, { weight: 30, reps: 6 }];
  const html = workout(c);
  assert.match(html, /22\.5 kg × 12[\s\S]*25 kg × 8[\s\S]*30 kg × 6/);
  assert.match(html, /Remembered for next time/);
  assert.doesNotMatch(html, /weight-value|Plan: 2 sets ×|keyboard-hint|complete \/ pause \/ resume/);
  assert.match(html, /aria-keyshortcuts="Enter Space"/);
  const dialog = exerciseDialog(c, {});
  assert.match(dialog, /Weight for all sets/); assert.match(dialog, /Reps for all sets/);
});
