import { createIcons, Activity, Dumbbell, CalendarDays, ChartNoAxesCombined, Pencil, CloudCheck, CloudUpload, WifiOff, Settings2 } from 'lucide';
import { actualSet, clock, completedSets, nextSet, resting } from '../domain/model.js';
import { Controller } from './controller.js';
import * as views from './views.js';
import { RestAlarm } from './alarm.js';
import { AppInstall } from './install.js';
import { renderInstallDialog } from './install-view.js';
import { PwaUpdates } from './pwa-updates.js';

const root = document.getElementById('workout-focus'), phone = root.querySelector('.phone');
const updateAnnouncement = document.createElement('span');
updateAnnouncement.className = 'sr-only'; updateAnnouncement.setAttribute('role', 'status'); root.append(updateAnnouncement);
const c = new Controller();
const ui = { dialog: null, error: '', busy: false, pendingRender: false, calendars: null };
let ticker, wakeLock, backdropPointer, backdropRelease;
const restAlarm = new RestAlarm();
const install = new AppInstall(() => { ui.installed = install.installed; render(); });
ui.installed = install.installed;
const updates = new PwaUpdates(() => render());
void updates.start();
function activateAudio() { void restAlarm.arm(); }
async function alarm() {
  const notice = c.notice;
  if (!await restAlarm.ring() && c.notice === notice) {
    c.notice = 'Rest finished. Sound could not play—open settings to test it.';
    render();
  }
}
function initializeIcons() { createIcons({ icons: { Activity, Dumbbell, CalendarDays, ChartNoAxesCombined, Pencil, CloudCheck, CloudUpload, WifiOff, Settings2 }, attrs: { width: 16, height: 16 } }); }
function isTyping() { return root.contains(document.activeElement) && document.activeElement.matches('input,textarea,select'); }
function render(force = false) {
  if (!c.data) return;
  if (!force && (isTyping() || (ui.dialog && root.querySelector('.dialog form')))) { ui.pendingRender = true; return; }
  const restoreInstallFocus = ui.dialog === 'install' && root.querySelector('.dialog')?.contains(document.activeElement);
  const openDetails = ['progress-detail', 'remembered-targets'].filter(name => root.querySelector(`details.${name}`)?.open);
  ui.pendingRender = false;
  phone.dataset.day = c.day;
  const body = { workout: views.workout, calendar: views.calendar, insights: views.insights, review: views.review }[c.view] || views.workout;
  const dialog = ui.dialog === 'exercise' ? views.exerciseDialog(c, ui) : ui.dialog === 'account' ? views.accountDialog(c, { ...ui, offlineReady: updates.offlineReady, offlineError: updates.error }) : ui.dialog === 'import' ? views.importDialog(c, ui) : ui.dialog === 'install' ? renderInstallDialog(install, { error: ui.installError || updates.error, message: ui.installMessage, working: ui.busy, offlineReady: updates.offlineReady, appUrl: location.origin + '/' }) : '';
  const updateBanner = updates.available ? `<div class="update-banner"><span>${views.esc(ui.updating ? 'Saving your workout and updating…' : ui.updateError || 'A new version is ready.')}</span><button data-action="apply-update" ${ui.updating ? 'disabled' : ''}>Save & update</button></div>` : '';
  phone.innerHTML = views.header(c, { installed: install.installed }) + `<div id="global-status">${views.status(c)}</div>` + updateBanner + body(c) + views.nav(c) + dialog;
  initializeIcons();
  for (const name of openDetails) { const detail = root.querySelector(`details.${name}`); if (detail) detail.open = true; }
  if (restoreInstallFocus) root.querySelector('.dialog h2')?.focus();
}
function updateStatus() {
  const status = root.querySelector('#global-status'); if (status) status.innerHTML = views.status(c);
  if (c.view === 'review' && !ui.dialog && !isTyping()) render();
  initializeIcons();
}
function showError(error) { c.notice = error.message || 'Could not complete this action.'; if (ui.dialog) ui.error = c.notice; render(true); }
function closeDialog() {
  const trigger = ui.dialog === 'exercise' ? '[data-action=exercise-settings]' : ui.dialog === 'install' ? '.install-entry' : '[aria-label="Account and settings"]';
  ui.dialogEpoch = (ui.dialogEpoch || 0) + 1; ui.dialog = null; ui.error = ''; render(true);
  (root.querySelector(trigger) || root.querySelector('[aria-label="Account and settings"]'))?.focus();
}
async function task(action) {
  if (ui.busy) return;
  ui.busy = true; ui.error = ''; render();
  try { await action(); } catch (error) { ui.error = error.message; c.notice = error.message; }
  finally { ui.busy = false; render(true); }
}

c.addEventListener('change', () => render()); c.addEventListener('status', updateStatus);
root.addEventListener('pointerdown', event => { activateAudio(); backdropPointer = event.target.matches('.modal-backdrop') ? event.target : null; backdropRelease = null; }); root.addEventListener('keydown', activateAudio);
root.addEventListener('pointerup', event => { backdropRelease = event.target.matches('.modal-backdrop') ? event.target : null; });
root.addEventListener('focusout', () => queueMicrotask(() => { if (ui.pendingRender && !isTyping()) render(); }));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && ui.dialog) { event.preventDefault(); closeDialog(); }
  if (event.key === 'Tab' && ui.dialog) {
    const items = [...root.querySelectorAll('.dialog button:not(:disabled),.dialog input,.dialog select,.dialog textarea,.dialog a[href]:not(.disabled-link)')].filter(item => item.getClientRects().length);
    if (items.length && !items.includes(document.activeElement)) { event.preventDefault(); (event.shiftKey ? items.at(-1) : items[0]).focus(); }
    else if (items.length && event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
    else if (items.length && !event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
  }
});

document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !c.data || c.view !== 'workout' || ui.dialog || ui.busy || ui.updating || phone.inert) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || (target !== document.body && target !== document.documentElement && !root.contains(target))) return;
  if (target.isContentEditable || target.closest('input,textarea,select,[role=textbox],[role=combobox],[role=slider],[role=spinbutton],[role=tablist],[role=radiogroup]')) return;
  const action = { Enter: 'complete', ArrowLeft: 'previous', ArrowRight: 'next' }[event.key];
  if (!action) return;
  // Let Enter activate links, disclosures and other buttons in the usual way.
  const control = target.closest('button,a[href],summary,[role=button]');
  if (event.key === 'Enter' && control && !control.matches('[data-action=complete]')) return;
  event.preventDefault();
  if (!event.repeat) root.querySelector(`button[data-action=${action}]:not(:disabled)`)?.click();
});

root.addEventListener('click', async event => {
  if (event.target.matches('.modal-backdrop') && backdropPointer === event.target && backdropRelease === event.target) { backdropPointer = null; closeDialog(); return; }
  const button = event.target.closest('button'); if (!button || button.disabled || !c.data) return;
  try {
    if (button.dataset.day) return c.setDay(button.dataset.day);
    if (button.dataset.view) { c.view = button.dataset.view; c.notice = ''; render(); if (c.authorized && c.view !== 'workout') void c.refreshHistory().catch(error => c.handleError(error)); return; }
    if (button.dataset.month) { const [year, month] = c.month.split('-').map(Number), date = new Date(Date.UTC(year, month - 1 + Number(button.dataset.month), 1)); c.month = date.toISOString().slice(0, 7); c.selectedDate = c.month + '-01'; render(); if (c.authorized) void c.refreshHistory().catch(error => c.handleError(error)); return; }
    if (button.dataset.date) { c.selectedDate = button.dataset.date; return render(); }
    if (button.dataset.undo !== undefined) return c.undo(Number(button.dataset.undo));
    if (button.dataset.resume) { ui.dialog = null; return c.resume(button.dataset.resume); }
    if (button.dataset.resolve) { c.resolveConflict(button.dataset.resolve); return render(); }
    if (button.dataset.editSession) {
      return task(async () => { if (!c.data.sessions[button.dataset.editSession]) { const result = await c.api(`/sessions/${button.dataset.editSession}`); c.data.sessions[result.session.id] = result.session; } c.resume(button.dataset.editSession); });
    }
    switch (button.dataset.action) {
      case 'previous':
      case 'next': {
        c.setIndex(c.index + (button.dataset.action === 'next' ? 1 : -1));
        const preferred = root.querySelector(`[data-action=${button.dataset.action}]`);
        (preferred?.disabled ? root.querySelector('.peek-nav button:not(:disabled)') : preferred)?.focus({ preventScroll: true });
        return;
      }
      case 'return-rest': {
        const index = Number(button.dataset.restIndex);
        if (Number.isInteger(index) && c.current.exercises[index] && resting(c.current.exercises[index])) { c.setIndex(index); root.querySelector('[data-action=complete]')?.focus({ preventScroll: true }); }
        return;
      }
      case 'complete': {
        activateAudio();
        if (resting(c.exercise)) return c.toggleRest();
        const index = nextSet(c.exercise); if (index < 0) return;
        const inputs = [...root.querySelectorAll(`.set-input[data-set="${index}"]`)];
        for (const input of inputs) if (!input.reportValidity()) return;
        const values = Object.fromEntries(inputs.map(input => [input.dataset.field, Number(input.value)]));
        c.complete(index, actualSet(values.weight, values.reps));
        if (navigator.wakeLock && !wakeLock) void navigator.wakeLock.request('screen').then(lock => { wakeLock = lock; lock.addEventListener('release', () => { wakeLock = null; }); }).catch(() => {});
        return;
      }
      case 'finish': {
        for (const input of root.querySelectorAll('.set-row.logged input')) if (!input.reportValidity()) return;
        c.finish(); if (wakeLock) void wakeLock.release(); return;
      }
      case 'new-workout': return c.newWorkout();
      case 'exercise-settings': ui.dialog = 'exercise'; ui.error = ''; render(true); root.querySelector('input[name=weight]')?.focus(); return;
      case 'close-dialog': closeDialog(); return;
      case 'account': {
        ui.dialog = 'account'; ui.error = ''; render();
        const guest = await c.storage.get('account:guest');
        ui.guestImport = c.authorized && !c.data.importedGuest && !guest?.importedUsers?.includes(c.user.id) ? Object.values(guest?.sessions || {}).filter(s => completedSets(s)).length : 0;
        return render();
      }
      case 'test-sound': {
        const ready = restAlarm.arm();
        return task(async () => { await ready; ui.soundMessage = await restAlarm.ring() ? 'Test tone played. If you did not hear it, check your phone’s media volume.' : 'Audio was blocked. Tap Test timer sound again and check media volume.'; });
      }
      case 'install-app': ui.dialog = 'install'; ui.installError = ''; ui.installMessage = ''; render(true); root.querySelector('.dialog h2')?.focus(); return;
      case 'install-confirm': return task(async () => {
        const outcome = await install.prompt();
        ui.installMessage = outcome === 'accepted' ? 'Follow the browser prompt to finish installation.' : outcome === 'dismissed' ? 'Installation was cancelled. You can use the browser steps below whenever you are ready.' : 'Use the browser steps below to add FORM to your home screen.';
        ui.installError = outcome === 'failed' ? 'The browser could not open its install prompt. Try the steps below.' : '';
      });
      case 'copy-app-link': return task(async () => {
        try { await navigator.clipboard.writeText(location.origin + '/'); ui.installMessage = 'App link copied. Paste it into Safari or Chrome.'; }
        catch { ui.installError = 'Copy the address shown below and open it in Safari or Chrome.'; }
      });
      case 'apply-update': return task(async () => {
        if (ui.dialog) throw new Error('Close the dialog before updating so unfinished edits are kept.');
        if (!c.storage.persistent) throw new Error('Device storage is unavailable. Keep this tab open and sync your workout before updating.');
        let reloading = false; ui.updating = true; ui.updateError = ''; render(true);
        updateAnnouncement.textContent = 'Saving your workout and updating.'; phone.inert = true;
        try {
          c.persist(); await c.persistChain;
          if (await updates.apply()) { c.persist(); await c.persistChain; reloading = true; location.reload(); }
        } catch (error) { ui.updateError = error.message; updateAnnouncement.textContent = error.message; throw error; }
        finally { if (!reloading) { ui.updating = false; phone.inert = false; } }
      });
      case 'retry-offline': return task(async () => { await updates.start(); });
      case 'retry': return task(async () => { await c.reconnect(); });
      case 'reload': location.reload(); return;
      case 'refresh-history': return task(async () => { await c.refreshHistory(); });
      case 'setup-calendar': return task(async () => { await c.setupCalendar(); });
      case 'load-calendars': return task(async () => { ui.calendars = (await c.api('/calendars')).calendars; });
      case 'sign-out': return task(async () => { await c.persistChain; await c.api('/logout', { method: 'POST', body: '{}' }); await c.storage.set('last-account', null); location.assign('/'); });
      case 'import-local': return task(async () => { await c.importLocalWorkouts(); ui.guestImport = 0; });
      case 'import-preview': return task(async () => {
        const originalDialog = ui.dialog;
        const dialogEpoch = ui.dialogEpoch || 0;
        const today = new Date(), from = new Date(today); from.setMonth(from.getMonth() - 6);
        ui.importFrom = from.toISOString().slice(0, 10); ui.importTo = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        ui.importEvents = (await c.api(`/import/preview?from=${ui.importFrom}&to=${ui.importTo}`)).events; if (ui.dialog === originalDialog && (ui.dialogEpoch || 0) === dialogEpoch) ui.dialog = 'import';
      });
      case 'move-selected': {
        const eventIds = [...root.querySelectorAll('[data-import-id]:checked')].map(input => input.dataset.importId);
        if (!eventIds.length || eventIds.length > 30) throw new Error('Select between one and thirty workouts.');
        return task(async () => {
          const result = await c.api('/import', { method: 'POST', body: JSON.stringify({ eventIds }) });
          ui.importEvents = ui.importEvents.filter(e => !result.moved.includes(e.id));
          ui.error = `${result.moved.length} workout${result.moved.length === 1 ? '' : 's'} moved.${result.failed.length ? ` ${result.failed.length} could not be moved: ${result.failed[0].error}` : ''}`;
          await c.refreshHistory();
        });
      }
    }
  } catch (error) { showError(error); }
});

root.addEventListener('change', event => {
  const input = event.target;
  try {
    if (input.matches('.set-input')) {
      if (!input.reportValidity()) return;
      c.editSet(Number(input.dataset.set), input.dataset.field, Number(input.value));
      for (const row of root.querySelectorAll('[data-set-comparison]')) row.outerHTML = views.setComparison(c, Number(row.dataset.setComparison));
      const last = root.querySelector('.last-session');
      const openDetails = ['progress-detail', 'remembered-targets'].filter(name => last?.querySelector(`details.${name}`)?.open);
      if (last) { last.outerHTML = views.comparison(c); for (const name of openDetails) { const detail = root.querySelector(`details.${name}`); if (detail) detail.open = true; } }
      const feedback = root.querySelector('.feedback'); if (feedback) feedback.textContent = c.notice;
    } else if (input.matches('[data-rest]')) c.updateExercise({ rest: Number(input.value) }, c.current.status === 'completed' ? 'future' : 'both');
    else if (input.matches('[data-workout-notes]')) { c.current.notes = input.value; c.queueSession(); }
  } catch (error) { showError(error); }
});

root.addEventListener('submit', event => {
  event.preventDefault(); const form = event.target; if (!form.reportValidity()) return;
  const fields = Object.fromEntries(new FormData(form));
  if (form.dataset.form === 'exercise') {
    try {
      const parse = (field, value) => ['weight', 'reps', 'sets', 'rest'].includes(field) ? Number(value) : field === 'angle' ? value === '' ? null : Number(value) : field === 'media' ? value || null : value;
      const changes = Object.fromEntries(['weight', 'reps', 'sets', 'rest', 'angle', 'setup', 'media'].filter(field => JSON.stringify(parse(field, fields[field])) !== JSON.stringify(parse(field, form.elements.namedItem(field).defaultValue))).map(field => [field, parse(field, fields[field])]));
      if (Object.keys(changes).length) c.updateExercise(changes, fields.scope);
      ui.dialog = null; ui.error = ''; render(true);
    }
    catch (error) { ui.error = error.message; const target = root.querySelector('.form-error'); if (target) target.textContent = ui.error; }
  } else if (form.dataset.form === 'calendar') void task(async () => { await c.setupCalendar(fields.calendarId); });
  else if (form.dataset.form === 'import-range') void task(async () => { ui.importFrom = fields.from; ui.importTo = fields.to; ui.importEvents = (await c.api(`/import/preview?from=${fields.from}&to=${fields.to}`)).events; });
});

window.addEventListener('online', () => void c.reconnect()); window.addEventListener('offline', () => { c.online = false; c.changed('status'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (c.authorized) void c.reconnect(); if (navigator.onLine) void updates.check(); } });

try {
  await c.start(); render();
  ticker = setInterval(() => {
    let ended = false;
    for (const session of Object.values(c.data.sessions)) for (const e of session.exercises) {
      if (e.timer.phase !== 'running') continue;
      e.timer.remaining = Math.max(0, Math.ceil((e.timer.deadline - Date.now()) / 1000));
      if (!e.timer.remaining) { e.timer.phase = 'ready'; e.timer.deadline = null; ended = true; c.notice = `Day ${session.day} · ${e.name}: rest finished.`; alarm(); }
    }
    const e = c.exercise, panel = root.querySelector('.exercise-rest');
    if (panel) { panel.querySelector('.countdown').textContent = clock(e.timer.remaining); panel.querySelector('.rest-track>div').style.width = `${Math.min(100, e.timer.remaining / e.rest * 100)}%`; const button = root.querySelector('[data-action=complete]'); button.textContent = views.actionLabel(e); button.disabled = !resting(e) && nextSet(e) < 0; panel.querySelector('[data-rest-label]').textContent = e.timer.phase === 'running' ? 'Resting' : e.timer.phase === 'paused' ? 'Paused' : e.timer.phase === 'ready' ? 'Ready' : 'Rest after each set'; }
    const restNavigation = root.querySelector('[data-rest-navigation]');
    if (restNavigation) {
      for (const button of restNavigation.querySelectorAll('[data-rest-index]')) {
        const other = c.current.exercises[Number(button.dataset.restIndex)];
        button.hidden = !other || !resting(other); button.disabled = button.hidden;
        if (!button.hidden) { button.querySelector('[data-rest-countdown]').textContent = clock(other.timer.remaining); button.querySelector('[data-rest-phase]').textContent = other.timer.phase === 'paused' ? 'Paused' : 'Resting'; }
      }
      restNavigation.hidden = ![...restNavigation.querySelectorAll('button')].some(button => !button.hidden);
    }
    if (ended) { c.persist(); if (!isTyping() && !ui.dialog) render(); }
  }, 200);
} catch (error) { phone.innerHTML = `<main class="app-body"><h1>FORM</h1><p>${views.esc(error.message)}</p><a href="/">Try again</a></main>`; }
