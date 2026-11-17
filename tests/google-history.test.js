import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleCalendar } from '../src/server/google.js';
import { completeSet, finishSession, newSession, seedPlan, sessionEvent } from '../src/domain/model.js';
import seed from '../workouts.json' with { type: 'json' };

test('large histories load retained records concurrently with bounded storage fan-out', async () => {
  const sessions = new Map(), events = [];
  for (let i = 0; i < 25; i++) {
    const session = newSession(seedPlan(seed), 'A', `workout-${i}`);
    const now = Date.UTC(2026, 0, i + 1);
    completeSet(session, 'a-0', 0, { weight: 20 + i, reps: 8 }, now);
    finishSession(session, now + 1000);
    session.calendarId = 'cal-u1'; session.eventId = `event-${i}`;
    sessions.set(`sessions/u1/${session.id}`, session);
    const event = { ...sessionEvent(session), id: session.eventId };
    event.extendedProperties.private.formOwner = 'u1'; events.push(event);
  }
  let active = 0, peak = 0, reads = 0;
  const google = new GoogleCalendar({ get: async key => {
    active++; reads++; peak = Math.max(peak, active);
    try { await new Promise(resolve => setTimeout(resolve, 1)); return sessions.get(key); }
    finally { active--; }
  } }, {});
  google.events = async (user, calendarId) => calendarId === 'primary' ? [] : events;
  const history = await google.history({ id: 'u1', calendarId: 'cal-u1' }, '2026-01-01', '2027-01-01');
  assert.equal(reads, 25); assert.ok(peak > 1 && peak <= 8, `Expected bounded concurrency, got ${peak}`);
  assert.equal(history.length, 25);
  assert.deepEqual(history.map(row => row.exercises[0].logs[0].weight), Array.from({ length: 25 }, (_, i) => 44 - i));
  assert.equal(active, 0);
});
