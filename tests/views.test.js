import test from 'node:test';
import assert from 'node:assert/strict';
import { calendar, peekNavigation, restNavigation } from '../src/client/views.js';
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
  current.exercises[1].name = '<img src=x onerror="alert(1)">';
  const html = peekNavigation({ current, index: 0 });
  assert.match(html, /data-action="previous" disabled/); assert.match(html, /peek-weight">30 /);
  assert.ok(!html.includes('<img')); assert.match(html, /&lt;img/);
  assert.match(peekNavigation({ current, index: 5 }), /data-action="next" disabled/);
});

test('return controls show other running or paused rests, excluding the current exercise', () => {
  const current = newSession(seedPlan(seed), 'A'); current.exercises[0].timer = { phase: 'paused', remaining: 45, deadline: null };
  assert.match(restNavigation({ current, index: 1 }), /data-rest-index="0"/);
  assert.match(restNavigation({ current, index: 1 }), /Paused[\s\S]*0:45/);
  assert.ok(!restNavigation({ current, index: 0 }).includes('data-rest-index'));
  current.exercises[0].timer.phase = 'ready';
  assert.ok(!restNavigation({ current, index: 1 }).includes('data-rest-index'));
});
