export class AppError extends Error {
  constructor(message, status = 400, code = 'invalid_request', details) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}

export const clone = value => structuredClone(value);
export const DAY_KEYS = ['A', 'B', 'C'];
export const REST_OPTIONS = [5, 30, 45, 60, 90, 120, 150, 180, 240, 300];
export const localDate = (value = new Date(), timeZone = 'Asia/Taipei') => new Date(value).toLocaleDateString('en-CA', { timeZone });
export const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`;
export const formatWeight = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
export const newestFirst = (a, b) => (Date.parse(b.start || b.date) || 0) - (Date.parse(a.start || a.date) || 0) || String(b.id || '').localeCompare(String(a.id || ''));

function number(value, label, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new AppError(`${label} must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}.`);
  }
  return value;
}

function text(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError(`${label} is invalid.`);
  return value.trim();
}

export function mediaURL(value) {
  if (!value) return null;
  try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password) return url.href; } catch {}
  throw new AppError('An exercise picture or GIF must use an HTTPS URL.');
}

export function seedPlan(data) {
  return { version: 0, days: Object.fromEntries(DAY_KEYS.map(day => [day, {
    focus: data.days[day].focus,
    exercises: data.days[day].exercises.map((raw, i) => {
      const angleText = raw.angleTag || (/^-?\d+°/.test(raw.badge || '') ? raw.badge : '');
      const angle = angleText ? Number.parseFloat(angleText) : null;
      return { id: raw.id || `${day.toLowerCase()}-${i}`, name: raw.name, unit: raw.unit || 'kg',
        weight: raw.weight, reps: raw.reps, sets: raw.sets,
        rest: raw.restTime.split(':').reduce((minutes, seconds) => minutes * 60 + Number(seconds), 0),
        angle, setup: (raw.badge || '').replace(/^-?\d+°\s*/, ''), media: null };
    }),
  }])) };
}

export function findExercise(plan, id) {
  for (const day of DAY_KEYS) { const exercise = plan.days[day].exercises.find(e => e.id === id); if (exercise) return exercise; }
  throw new AppError('Exercise not found.', 404);
}

export function validatePreference(field, value) {
  if (field === 'weight') return number(value, 'Weight', 0, 1000);
  if (field === 'reps') return number(value, 'Reps', 1, 300, true);
  if (field === 'sets') return number(value, 'Sets', 1, 20, true);
  if (field === 'rest') return number(value, 'Rest time', 1, 3600, true);
  if (field === 'angle') return value === null ? null : number(value, 'Bench angle', -30, 90);
  if (field === 'media') return mediaURL(value);
  if (field === 'setup') return typeof value === 'string' && value.length <= 160 ? value : text(value, 'Setup notes');
  throw new AppError('This exercise setting cannot be changed.');
}

export function applyPlanChanges(plan, changes, { checkExpected = false } = {}) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 50) throw new AppError('Provide one to fifty exercise changes.');
  const next = clone(plan);
  for (const change of changes) {
    const e = findExercise(next, change.exerciseId);
    if (checkExpected && JSON.stringify(e[change.field]) !== JSON.stringify(change.expected) && JSON.stringify(e[change.field]) !== JSON.stringify(change.value)) {
      throw new AppError('These settings changed on another device.', 409, 'plan_conflict', { plan });
    }
    e[change.field] = validatePreference(change.field, change.value);
  }
  next.version = (plan.version || 0) + 1;
  return next;
}

export function newSession(plan, day, id = crypto.randomUUID()) {
  if (!DAY_KEYS.includes(day)) throw new AppError('Choose Day A, B, or C.');
  return { id, day, focus: plan.days[day].focus, revision: 0, status: 'draft', startedAt: null, endedAt: null, notes: '',
    exercises: plan.days[day].exercises.map(e => ({ ...clone(e), logs: Array(e.sets).fill(null),
      drafts: Array.from({ length: e.sets }, () => ({ weight: e.weight, reps: e.reps })),
      timer: { phase: 'idle', remaining: e.rest, deadline: null } })) };
}

export const completedSets = session => session.exercises.reduce((total, e) => total + e.logs.filter(Boolean).length, 0);
export const plannedSets = session => session.exercises.reduce((total, e) => total + e.sets, 0);
export const nextSet = exercise => exercise.logs.findIndex(log => !log);
export const resting = exercise => exercise.timer.phase === 'running' || exercise.timer.phase === 'paused';

export function actualSet(weight, reps) {
  return { weight: number(weight, 'Set weight', 0, 1000), reps: number(reps, 'Set reps', 1, 300, true) };
}

export function completeSet(session, exerciseId, setIndex, values, now = Date.now()) {
  const e = session.exercises.find(item => item.id === exerciseId);
  if (!e || !Number.isInteger(setIndex) || setIndex < 0 || setIndex >= e.sets) throw new AppError('Set not found.');
  if (e.logs[setIndex]) throw new AppError('This set is already completed.');
  session.startedAt ||= new Date(now).toISOString();
  e.logs[setIndex] = { ...actualSet(values.weight, values.reps), setNumber: setIndex + 1, restSeconds: e.rest, angle: e.angle, setup: e.setup };
  e.drafts[setIndex] = actualSet(values.weight, values.reps);
  e.timer = completedSets(session) < plannedSets(session)
    ? { phase: 'running', remaining: e.rest, deadline: now + e.rest * 1000 }
    : { phase: 'ready', remaining: 0, deadline: null };
  return session;
}

export function undoSet(session, exerciseId, setIndex) {
  const e = session.exercises.find(item => item.id === exerciseId);
  if (!e?.logs[setIndex]) return session;
  if (session.status === 'completed' && completedSets(session) === 1) throw new AppError('A saved workout must keep at least one set. Correct this set instead of undoing it.');
  e.drafts[setIndex] = actualSet(e.logs[setIndex].weight, e.logs[setIndex].reps);
  e.logs[setIndex] = null; e.timer = { phase: 'idle', remaining: e.rest, deadline: null };
  if (!completedSets(session) && session.status === 'draft') session.startedAt = null;
  return session;
}

export function finishSession(session, now = Date.now()) {
  if (!completedSets(session)) throw new AppError('Complete at least one set before saving.');
  session.status = 'completed'; session.endedAt = new Date(Math.max(now, Date.parse(session.startedAt) + 1000)).toISOString();
  session.exercises.forEach(e => { e.timer = { phase: 'idle', remaining: e.rest, deadline: null }; });
  return session;
}

export function validateSession(input) {
  if (!input || !/^[a-zA-Z0-9-]{1,100}$/.test(input.id || '') || !DAY_KEYS.includes(input.day)) throw new AppError('Invalid workout identifier or day.');
  if (!['draft', 'completed'].includes(input.status) || !Array.isArray(input.exercises) || !input.exercises.length || input.exercises.length > 50) throw new AppError('Invalid workout.');
  const session = { id: input.id, day: input.day, focus: text(input.focus, 'Workout focus'), status: input.status,
    customized: !!input.customized,
    revision: Number.isInteger(input.revision) && input.revision >= 0 ? input.revision : 0,
    startedAt: input.startedAt || null, endedAt: input.endedAt || null,
    notes: typeof input.notes === 'string' ? input.notes.slice(0, 4000) : '', exercises: [] };
  const ids = new Set();
  for (const item of input.exercises) {
    const id = text(item.id, 'Exercise identifier'); if (ids.has(id)) throw new AppError('Duplicate exercise identifier.'); ids.add(id);
    const sets = validatePreference('sets', item.sets);
    if (!Array.isArray(item.logs) || item.logs.length !== sets) throw new AppError('Each planned set needs a corresponding log slot.');
    const e = { id, name: text(item.name, 'Exercise name'), unit: text(item.unit, 'Unit', 10),
      weight: validatePreference('weight', item.weight), reps: validatePreference('reps', item.reps), sets,
      rest: validatePreference('rest', item.rest), angle: validatePreference('angle', item.angle ?? null),
      setup: validatePreference('setup', item.setup || ''), media: mediaURL(item.media),
      logs: item.logs.map((log, i) => log ? { ...actualSet(log.weight, log.reps), setNumber: i + 1, restSeconds: validatePreference('rest', log.restSeconds ?? item.rest), angle: validatePreference('angle', Object.hasOwn(log, 'angle') ? log.angle : item.angle ?? null), setup: validatePreference('setup', log.setup ?? item.setup ?? '') } : null),
      drafts: Array.from({ length: sets }, (_, i) => actualSet(item.drafts?.[i]?.weight ?? item.weight, item.drafts?.[i]?.reps ?? item.reps)),
      timer: { phase: 'idle', remaining: item.rest, deadline: null } };
    session.exercises.push(e);
  }
  const start = Date.parse(session.startedAt), end = Date.parse(session.endedAt);
  if (completedSets(session) && (!Number.isFinite(start) || start > Date.now() + 300000)) throw new AppError('The workout start time is invalid.');
  if (session.status === 'completed' && (!completedSets(session) || !Number.isFinite(end) || end <= start || end > Date.now() + 300000)) throw new AppError('The workout finish time is invalid.');
  return session;
}

export const nextDay = day => ({ A: 'B', B: 'C', C: 'A' })[day] || 'A';
export function isLegacyWorkout(event) { return /^訓練 [ABC]\s*[-–]/.test(event.summary || '') && event.status !== 'cancelled'; }
export function isTestEvent(event) { return /prototype\s+test/i.test(event.summary || '') || /^TEST DATA/i.test(event.description || ''); }

export function sessionEvent(session, timeZone = 'Asia/Taipei') {
  const lines = [`Day ${session.day} — ${session.focus}`, `${completedSets(session)} / ${plannedSets(session)} sets completed`, ''];
  for (const e of session.exercises.filter(item => item.logs.some(Boolean))) {
    lines.push(e.name + (e.angle === null ? '' : ` · bench ${e.angle}°`));
    e.logs.forEach((log, i) => { if (log) lines.push(`Set ${i + 1}: ${log.weight} ${e.unit} × ${log.reps} reps · rest ${log.restSeconds}s${log.angle === null || log.angle === undefined ? '' : ` · bench ${log.angle}°`}`); });
    lines.push('');
  }
  if (session.notes) lines.push('Notes:', session.notes, '');
  const summary = { id: session.id, day: session.day, exercises: session.exercises.filter(e => e.logs.some(Boolean)).map(e => ({ id: e.id, name: e.name, unit: e.unit, angle: e.angle, logs: e.logs })) };
  lines.push('FORM_WORKOUT_V1', JSON.stringify(summary), 'END_FORM_WORKOUT');
  return { summary: `訓練 ${session.day} - ${session.focus}`, description: lines.join('\n'),
    colorId: { A: '7', B: '3', C: '5' }[session.day],
    start: { dateTime: session.startedAt, timeZone }, end: { dateTime: session.endedAt, timeZone },
    transparency: 'transparent', visibility: 'private', reminders: { useDefault: false },
    extendedProperties: { private: { formVersion: '1', formSessionId: session.id } } };
}

export function historyEvent(event, calendarId) {
  let detail = null;
  try { const match = (event.description || '').match(/FORM_WORKOUT_V1\s*([\s\S]*?)\s*END_FORM_WORKOUT/); if (match) detail = JSON.parse(match[1]); } catch {}
  const day = (DAY_KEYS.includes(detail?.day) ? detail.day : null) || (event.summary || '').match(/訓練 ([ABC])/)?.[1] || null;
  const allDay = !!event.start?.date;
  return { id: event.id, calendarId, title: event.summary || 'Workout', day,
    date: allDay ? event.start.date : localDate(event.start?.dateTime),
    start: event.start?.dateTime || event.start?.date, end: event.end?.dateTime || event.end?.date,
    durationSeconds: allDay || !Number.isFinite(Date.parse(event.end?.dateTime) - Date.parse(event.start?.dateTime)) ? null : Math.max(0, Math.round((Date.parse(event.end?.dateTime) - Date.parse(event.start?.dateTime)) / 1000)),
    description: event.description || '', exercises: Array.isArray(detail?.exercises) ? detail.exercises.slice(0, 50).filter(e => e && typeof e.name === 'string' && Array.isArray(e.logs)).map(e => ({ id: typeof e.id === 'string' ? e.id : null, name: e.name.slice(0, 160), unit: typeof e.unit === 'string' ? e.unit.slice(0, 10) : 'kg', angle: Number.isFinite(e.angle) ? e.angle : null, logs: e.logs.slice(0, 20).map((log, i) => log && Number.isFinite(log.weight) && log.weight >= 0 && log.weight <= 1000 && Number.isInteger(log.reps) && log.reps >= 1 && log.reps <= 300 ? { weight: log.weight, reps: log.reps, angle: Number.isFinite(log.angle) ? log.angle : null, setNumber: i + 1 } : null) })) : null,
    sessionId: event.extendedProperties?.private?.formSessionId || null, url: event.htmlLink || null, etag: event.etag || null };
}
