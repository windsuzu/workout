import test from 'node:test';
import assert from 'node:assert/strict';
import { calendar } from '../src/client/views.js';

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
