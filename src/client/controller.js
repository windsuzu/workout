import { AppError, applyPlanChanges, clone, completeSet, completedSets, findExercise, finishSession, historyEvent, localDate, newestFirst, newSession, seedPlan, sessionEvent, undoSet, validatePreference } from '../domain/model.js';
import { openStorage } from './storage.js';

export class Controller extends EventTarget {
  constructor({ fetcher = fetch, storage } = {}) {
    super(); this.fetcher = (...args) => fetcher(...args); this.storage = storage; this.day = 'A'; this.view = 'workout'; this.month = localDate().slice(0, 7);
    this.selectedDate = localDate(); this.user = null; this.authorized = false; this.calendar = null; this.configured = false;
    this.notice = ''; this.error = ''; this.busy = false; this.online = navigator.onLine; this.persistChain = Promise.resolve(); this.sequence = 0;
  }
  changed(type = 'change') { this.dispatchEvent(new Event(type)); }
  async api(path, options = {}) {
    let response;
    try { response = await this.fetcher(`/api${path}`, { credentials: 'same-origin', signal: AbortSignal.timeout(30000), ...options, headers: { ...(this.user && path !== '/me' ? { 'X-Form-Account': this.user.id } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); }
    catch { throw new AppError('You are offline or the server is unavailable. Changes stay on this device.', 0, 'offline'); }
    let data; try { data = await response.json(); } catch { throw new AppError('The server returned an unexpected response. Please retry.', 503); }
    if (!response.ok) throw new AppError(data.error || 'Could not complete the request.', response.status, data.code, data.details);
    return data;
  }
  async start() {
    this.storage ||= await openStorage();
    const previous = await this.storage.get('last-account');
    let me;
    try { me = await this.api('/me', { signal: AbortSignal.timeout(4000) }); this.online = true; }
    catch { this.online = false; this.error = 'Offline copy loaded. Reconnect to sync.'; this.connectivityError = this.error; me = { user: previous?.user || null, configured: false }; }
    this.user = me.user; this.authorized = !!me.user && !('configured' in me && me.configured === false); this.configured = !!me.configured; this.calendar = me.calendar || previous?.calendar || null;
    const key = this.user?.id || 'guest'; this.accountKey = `account:${key}`;
    if (this.storage.claim && !await this.storage.claim(this.accountKey)) throw new AppError('This account is already open in another tab. Close that tab, then reload here to load its latest saved workout.', 409, 'tab_locked');
    let cached = await this.storage.get(this.accountKey);
    let defaults;
    try { const response = await this.fetcher('/workouts.json'); if (!response.ok) throw new Error(); defaults = seedPlan(await response.json()); }
    catch { defaults = cached?.plan; if (!defaults) throw new AppError('Open the app online once so its workout routines can be saved for offline use.', 0); }
    this.data = cached || { plan: defaults, cloudPlan: defaults, sessions: {}, active: {}, indices: {}, planOps: [], outbox: {}, history: [] };
    this.day = this.data.day || 'A'; this.ensureActive();
    await this.storage.set('last-account', { user: this.user, calendar: this.calendar });
    if (!this.storage.persistent) this.error = 'Device storage is unavailable. Keep this tab open and connect Google to avoid losing unsynced work.';
    this.changed();
    if (this.authorized) {
      try { await this.pull(); await this.refreshHistory(); } catch (error) { this.handleError(error); }
      void this.flush();
    }
  }
  ensureActive() {
    const id = this.data.active[this.day], old = this.data.sessions[id];
    if (!old || (old.status === 'completed' && localDate(old.endedAt) !== localDate()) || (!completedSets(old) && !old.customized && !this.data.outbox[old.id])) {
      const session = newSession(this.data.plan, this.day, old?.status === 'draft' ? old.id : undefined); this.data.sessions[session.id] = session; this.data.active[this.day] = session.id;
    }
    return this.current;
  }
  get current() { return this.data.sessions[this.data.active[this.day]]; }
  get index() { return Math.min(this.data.indices[this.current.id] || 0, this.current.exercises.length - 1); }
  get exercise() { return this.current.exercises[this.index]; }
  get pendingCount() { return this.data.planOps.length + Object.keys(this.data.outbox).length; }
  get syncLabel() {
    if (!this.storage?.persistent) return 'Device storage unavailable';
    if (this.accountChanged) return 'Account changed · reload to continue';
    if (this.localSaving) return 'Saving on this device…';
    if (!this.online) return this.pendingCount ? 'Offline · saved on this device' : 'Offline · available on this device';
    if (this.conflict) return 'Review changes from another device';
    if (this.syncing) return 'Syncing…';
    if (!this.authorized) return 'Saved on this device · sign in to sync';
    if (!this.calendar && this.pendingCount) return 'Saved locally · choose a workout calendar';
    if (this.pendingCount) return 'Saved locally · sync pending';
    return 'Up to date';
  }
  persist() {
    this.data.day = this.day; const snapshot = clone(this.data);
    const saveNumber = (this.saveNumber || 0) + 1; this.saveNumber = saveNumber; this.localSaving = true;
    this.persistChain = this.persistChain.catch(() => {}).then(() => this.storage.set(this.accountKey, snapshot));
    this.persistChain.then(() => { if (this.saveNumber === saveNumber) { this.localSaving = false; this.changed('status'); } }).catch(() => {});
    this.persistChain.catch(() => { if (this.saveNumber === saveNumber) this.localSaving = false; this.error = 'This device could not save your latest changes. Keep the app open and try syncing.'; this.changed('status'); });
  }
  queueSession(session = this.current) {
    if (this.syncing) this.resyncRequested = true;
    this.data.outbox[session.id] = { operationId: crypto.randomUUID(), session: clone(session), sequence: ++this.sequence };
    this.persist(); this.scheduleSync();
  }
  scheduleSync() { clearTimeout(this.syncTimer); this.syncTimer = setTimeout(() => void this.flush(), 650); }
  setDay(day) { this.day = day; this.ensureActive(); this.notice = ''; this.persist(); this.changed(); }
  setIndex(index) { this.data.indices[this.current.id] = Math.max(0, Math.min(index, this.current.exercises.length - 1)); this.notice = ''; this.persist(); this.changed(); }
  newWorkout(day = this.day) {
    this.day = day; const session = newSession(this.data.plan, day); this.data.sessions[session.id] = session; this.data.active[day] = session.id;
    this.view = 'workout'; this.notice = ''; this.persist(); this.changed();
  }
  resume(id) { const session = this.data.sessions[id]; if (!session) return; this.day = session.day; this.data.active[session.day] = id; this.view = 'workout'; this.persist(); this.changed(); }
  editSet(index, field, value) {
    const e = this.exercise; validatePreference(field === 'weight' ? 'weight' : 'reps', value);
    this.current.customized = true;
    e.drafts[index][field] = value;
    if (e.logs[index]) e.logs[index][field] = value;
    this.notice = e.logs[index] ? `Set ${index + 1} corrected.` : `Set ${index + 1} ready.`;
    this.queueSession(); this.changed('status');
  }
  complete(index, values) {
    completeSet(this.current, this.exercise.id, index, values); this.notice = `Set ${index + 1} recorded. Rest started.`; this.queueSession(); this.changed();
  }
  undo(index) { undoSet(this.current, this.exercise.id, index); this.notice = `Set ${index + 1} undone. Its values are kept for retrying.`; this.queueSession(); this.changed(); }
  toggleRest() {
    const e = this.exercise;
    if (e.timer.phase === 'running') { e.timer.remaining = Math.max(0, Math.ceil((e.timer.deadline - Date.now()) / 1000)); e.timer.phase = 'paused'; e.timer.deadline = null; }
    else if (e.timer.phase === 'paused' && e.timer.remaining > 0) { e.timer.phase = 'running'; e.timer.deadline = Date.now() + e.timer.remaining * 1000; }
    if (!e.timer.remaining) e.timer = { phase: 'ready', remaining: 0, deadline: null };
    this.persist(); this.changed();
  }
  updateExercise(values, scope = 'both') {
    const e = this.exercise, allowed = ['weight', 'reps', 'sets', 'rest', 'angle', 'setup', 'media'];
    for (const [field, value] of Object.entries(values)) { if (!allowed.includes(field)) throw new AppError('Unknown setting.'); validatePreference(field, value); }
    if (scope !== 'future' && values.sets !== undefined && values.sets < e.logs.reduce((last, log, i) => log ? i + 1 : last, 0)) throw new AppError('Completed sets cannot be removed by changing the target. Undo them first, or change next time only.');
    if (scope !== 'today') {
      const changes = Object.entries(values).filter(([field, value]) => JSON.stringify(findExercise(this.data.plan, e.id)[field]) !== JSON.stringify(value)).map(([field, value]) => ({ exerciseId: e.id, field, value, expected: clone(findExercise(this.data.plan, e.id)[field]) }));
      if (changes.length) { this.data.plan = applyPlanChanges(this.data.plan, changes); this.data.planOps.push({ operationId: crypto.randomUUID(), changes }); }
    }
    if (scope !== 'future') {
      Object.assign(e, values); this.current.customized = true;
      e.logs = Array.from({ length: e.sets }, (_, i) => e.logs[i] || null);
      e.drafts = Array.from({ length: e.sets }, (_, i) => e.logs[i] ? { weight: e.logs[i].weight, reps: e.logs[i].reps } : { weight: values.weight ?? e.drafts[i]?.weight ?? e.weight, reps: values.reps ?? e.drafts[i]?.reps ?? e.reps });
      if (!['running', 'paused'].includes(e.timer.phase)) e.timer = { phase: 'idle', remaining: e.rest, deadline: null };
      this.queueSession();
    } else { this.persist(); this.scheduleSync(); }
    this.notice = scope === 'today' ? 'Changed for this workout only.' : scope === 'future' ? 'Defaults saved for your next workout.' : 'Saved for this workout and next time.';
    this.changed();
  }
  finish() { finishSession(this.current, this.current.status === 'completed' ? Date.parse(this.current.endedAt) : Date.now()); this.queueSession(); this.view = 'review'; this.notice = ''; this.changed(); void this.flush(); }
  async pull() {
    const cloud = await this.api('/state');
    if (cloud.plan.version >= this.data.cloudPlan.version) this.data.cloudPlan = cloud.plan;
    this.rebuildPlan();
    for (const session of cloud.drafts) {
      const local = this.data.sessions[session.id];
      if (!this.data.outbox[session.id] && (!local || session.revision > local.revision)) this.data.sessions[session.id] = session;
      const active = this.data.sessions[this.data.active[session.day]];
      if (!active || (!completedSets(active) && !active.customized && !this.data.outbox[active.id])) this.data.active[session.day] = session.id;
    }
    const active = this.current;
    if (!completedSets(active) && !active.customized && !this.data.outbox[active.id]) this.data.sessions[active.id] = newSession(this.data.plan, active.day, active.id);
    this.persist(); this.changed();
  }
  rebuildPlan() { this.data.plan = clone(this.data.cloudPlan); for (const operation of this.data.planOps) this.data.plan = applyPlanChanges(this.data.plan, operation.changes); }
  async flush() {
    if (!this.data || this.syncing || !this.online || !this.authorized || this.conflict || this.accountChanged) return;
    this.syncing = true; this.changed('status');
    try {
      await this.persistChain;
      while (this.data.planOps.length) {
        const operation = clone(this.data.planOps[0]);
        const response = await this.api('/plan', { method: 'PATCH', body: JSON.stringify(operation) });
        this.data.planOps = this.data.planOps.filter(item => item.operationId !== operation.operationId);
        if (response.plan.version >= this.data.cloudPlan.version) this.data.cloudPlan = response.plan;
        this.rebuildPlan(); this.persist();
      }
      for (const id of Object.keys(this.data.outbox)) {
        const queued = this.data.outbox[id]; if (!queued) continue;
        const sent = clone(queued); sent.session.revision = this.data.sessions[id].revision;
        const response = await this.api(`/sessions/${id}`, { method: 'PUT', body: JSON.stringify(sent) });
        const local = this.data.sessions[id]; local.revision = response.session.revision;
        local.sync = response.session.sync; local.eventId = response.session.eventId; local.eventUrl = response.session.eventUrl;
        if (this.data.outbox[id]?.operationId === sent.operationId) {
          if (response.syncError) { this.error = response.syncError.message; this.syncErrorCode = response.syncError.code; if (response.syncError.code === 'reconnect_required') this.authorized = false; this.persist(); break; }
          delete this.data.outbox[id];
          if (response.session.status === 'completed') {
            this.historyEpoch = (this.historyEpoch || 0) + 1;
            const row = { ...historyEvent({ ...sessionEvent(response.session), id: response.session.eventId || id, htmlLink: response.session.eventUrl }, response.session.calendarId || 'local'), sync: response.session.sync };
            this.data.history = this.data.history.filter(event => event.sessionId !== id); this.data.history.push(row);
          }
        }
        this.persist();
      }
      if (!this.pendingCount) { this.error = ''; this.syncErrorCode = null; }
    } catch (error) {
      if (error.code === 'plan_conflict') this.conflict = { type: 'plan', plan: error.details.plan };
      else if (error.code === 'session_conflict') this.conflict = { type: 'session', session: error.details.session };
      this.handleError(error);
    } finally {
      this.syncing = false; this.changed('status');
      if (this.pendingCount && this.authorized && !this.conflict && !['calendar_setup_required', 'reconnect_required'].includes(this.syncErrorCode)) {
        clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => void this.flush(), this.resyncRequested ? 0 : 30000);
      }
      this.resyncRequested = false;
    }
  }
  handleError(error) { this.error = error.message; if (error.status === 401 || error.code === 'account_changed') this.authorized = false; if (error.code === 'account_changed') this.accountChanged = true; if (error.code === 'offline') { this.online = false; this.connectivityError = error.message; } this.changed('status'); }
  async refreshHistory() {
    if (!this.authorized || !this.online) return;
    let to = localDate(new Date(Date.now() + 86400000)), start = localDate(new Date(Date.now() - 365 * 86400000));
    if (this.month < start.slice(0, 7)) {
      start = `${this.month}-01`;
      const [year, month] = this.month.split('-').map(Number); to = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    }
    const epoch = this.historyEpoch || 0;
    const result = await this.api(`/history?from=${start}&to=${to}`);
    if (epoch !== (this.historyEpoch || 0)) return;
    const rows = new Map(this.data.history.filter(e => e.date < start || e.date >= to).map(e => [`${e.calendarId}:${e.id}`, e]));
    for (const event of result.events) rows.set(`${event.calendarId}:${event.id}`, event);
    this.data.history = [...rows.values()]; this.calendar = result.calendar;
    this.persist(); this.changed();
  }
  history() {
    const rows = new Map(this.data.history.map(e => [e.sessionId || `${e.calendarId}:${e.id}`, e]));
    for (const session of Object.values(this.data.sessions)) if (session.status === 'completed') {
      if (this.data.outbox[session.id] || !rows.has(session.id)) rows.set(session.id, { ...historyEvent({ ...sessionEvent(session), id: session.id, htmlLink: session.eventUrl }, 'local'), sync: this.data.outbox[session.id] ? 'pending' : session.sync || 'local' });
    }
    return [...rows.values()].sort(newestFirst);
  }
  async setupCalendar(calendarId) {
    const response = await this.api(calendarId ? '/calendar/select' : '/calendar/setup', { method: 'POST', body: JSON.stringify(calendarId ? { calendarId } : {}) });
    this.calendar = { id: response.calendar.id, name: response.calendar.summary };
    this.error = ''; this.syncErrorCode = null; await this.storage.set('last-account', { user: this.user, calendar: this.calendar }); this.changed(); await this.flush(); await this.refreshHistory();
  }
  async reconnect() {
    if (this.accountChanged) return;
    this.online = true;
    try {
      const me = await this.api('/me');
      if ((me.user?.id || null) !== (this.user?.id || null)) throw new AppError('Your Google account changed. Reload the app to continue; pending work stays on this device.', 409, 'account_changed');
      if (this.error === this.connectivityError) { this.error = ''; this.connectivityError = null; }
      this.authorized = !!me.user; this.configured = me.configured;
      if (me.user) { await this.pull(); await this.flush(); await this.refreshHistory(); }
    }
    catch (error) { this.handleError(error); }
    this.changed('status');
  }
  async importLocalWorkouts() {
    if (!this.authorized) throw new AppError('Sign in before importing local workouts.', 401);
    const guest = await this.storage.get('account:guest');
    if (!guest || this.data.importedGuest || guest.importedUsers?.includes(this.user.id)) return;
    const changes = [];
    for (const day of ['A', 'B', 'C']) for (const exercise of guest.plan.days[day].exercises) {
      const target = findExercise(this.data.plan, exercise.id);
      for (const field of ['weight', 'reps', 'sets', 'rest', 'angle', 'setup', 'media']) if (JSON.stringify(target[field]) !== JSON.stringify(exercise[field])) changes.push({ exerciseId: exercise.id, field, expected: clone(target[field]), value: clone(exercise[field]) });
    }
    for (let i = 0; i < changes.length; i += 40) {
      const part = changes.slice(i, i + 40); this.data.plan = applyPlanChanges(this.data.plan, part); this.data.planOps.push({ operationId: crypto.randomUUID(), changes: part });
    }
    for (const original of Object.values(guest.sessions).filter(s => completedSets(s))) {
      if (this.data.sessions[original.id]) continue;
      const session = clone(original); session.revision = 0; delete session.eventId; delete session.eventUrl; session.sync = 'local';
      this.data.sessions[session.id] = session; if (session.status === 'draft') this.data.active[session.day] = session.id; this.queueSession(session);
    }
    for (const day of ['A', 'B', 'C']) {
      const active = this.data.sessions[this.data.active[day]];
      if (active && !completedSets(active) && !active.customized && !this.data.outbox[active.id]) this.data.sessions[active.id] = newSession(this.data.plan, day, active.id);
    }
    this.data.importedGuest = true;
    this.notice = 'Local workouts added to your account’s sync queue.'; this.persist(); this.changed(); await this.flush();
  }
  resolveConflict(choice) {
    if (this.conflict?.type === 'plan') {
      this.data.cloudPlan = this.conflict.plan;
      if (choice === 'cloud') this.data.planOps = [];
      else {
        const plan = clone(this.data.cloudPlan);
        for (const op of this.data.planOps) { op.operationId = crypto.randomUUID(); for (const change of op.changes) { change.expected = clone(findExercise(plan, change.exerciseId)[change.field]); findExercise(plan, change.exerciseId)[change.field] = change.value; } }
      }
      this.rebuildPlan();
    } else if (this.conflict?.type === 'session') {
      const server = this.conflict.session, local = this.data.sessions[server.id];
      delete this.data.outbox[server.id]; this.data.sessions[server.id] = server;
      if (choice === 'local') { const copy = clone(local); copy.id = crypto.randomUUID(); copy.revision = 0; this.data.sessions[copy.id] = copy; this.data.active[copy.day] = copy.id; this.queueSession(copy); }
    }
    this.conflict = null; this.error = ''; this.persist(); this.changed(); void this.flush();
  }
}
