import { AppError, historyEvent, isLegacyWorkout, isTestEvent, sessionEvent } from '../domain/model.js';
import { hexDigest, open, seal } from './security.js';

const API = 'https://www.googleapis.com/calendar/v3';
const MARKER = 'FORM_WORKOUT_CALENDAR_V1';

export class GoogleCalendar {
  constructor(repo, env, fetcher = fetch) { this.repo = repo; this.env = env; this.fetcher = fetcher; }
  async accessToken(user) {
    const token = await open(user.credentials, this.env.AUTH_SECRET);
    if (token.expiresAt > Date.now() + 60000) return token.accessToken;
    let response;
    try { response = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ client_id: this.env.GOOGLE_CLIENT_ID, client_secret: this.env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: token.refreshToken }) }); }
    catch { throw new AppError('Google is temporarily unavailable. Please retry.', 503, 'google_unavailable'); }
    if (!response.ok) throw new AppError('Reconnect Google to continue syncing.', 401, 'reconnect_required');
    const next = await response.json();
    const encrypted = await seal({ accessToken: next.access_token, refreshToken: next.refresh_token || token.refreshToken, expiresAt: Date.now() + next.expires_in * 1000 }, this.env.AUTH_SECRET);
    await this.repo.update(`users/${user.id}`, u => { if (!u) throw new AppError('Sign in again.', 401); u.credentials = encrypted; return u; });
    return next.access_token;
  }
  async request(user, path, { method = 'GET', body, query, headers = {}, allow404 = false, allow409 = false } = {}) {
    const url = new URL(API + path);
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    let response;
    try { response = await this.fetcher(url.href, { method, signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${await this.accessToken(user)}`, ...headers,
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError('Google Calendar is temporarily unavailable. Please retry.', 503, 'google_unavailable'); }
    if (response.status === 404 && allow404) return null;
    if (response.status === 409 && allow409) return { conflict: true };
    if (response.status === 401 || response.status === 403) throw new AppError('Reconnect Google and grant calendar access.', 401, 'reconnect_required');
    if (response.status === 412) throw new AppError('This calendar event changed. Refresh and retry.', 409, 'calendar_conflict');
    if (!response.ok) throw new AppError('Google Calendar could not complete the request. Your local record is preserved.', 503, 'google_unavailable');
    return response.status === 204 ? {} : response.json();
  }
  async calendars(user) {
    const calendars = []; let pageToken;
    do {
      const page = await this.request(user, '/users/me/calendarList', { query: { maxResults: 250, pageToken } });
      calendars.push(...(page.items || [])); pageToken = page.nextPageToken;
    } while (pageToken && calendars.length < 1000);
    return calendars;
  }
  async setup(user) {
    if (user.calendarId) return { id: user.calendarId, summary: user.calendarName || 'Workouts' };
    const token = crypto.randomUUID(), key = `calendar-lock/${user.id}`, now = Date.now();
    const lock = await this.repo.update(key, value => value?.expiresAt > now ? undefined : { token, expiresAt: now + 60000 });
    if (lock.token !== token) throw new AppError('Your calendar is being set up. Please retry shortly.', 409, 'calendar_setup_pending');
    try {
      // Find an earlier successful creation if its response or local save was interrupted.
      const calendars = await this.calendars(user);
      const existing = calendars.find(c => c.accessRole === 'owner' && c.description?.includes(`${MARKER}:${user.id}`));
      const calendar = existing || await this.request(user, '/calendars', { method: 'POST', body: { summary: 'Workouts', timeZone: 'Asia/Taipei', description: `Workout history managed by FORM. ${MARKER}:${user.id}` } });
      await this.repo.update(`users/${user.id}`, u => { u.calendarId = calendar.id; u.calendarName = calendar.summary; return u; });
      return calendar;
    } finally { await this.repo.update(key, value => value?.token === token ? { token, expiresAt: 0 } : undefined); }
  }
  async events(user, calendarId, from, to, query) {
    const events = []; let pageToken;
    do {
      const page = await this.request(user, `/calendars/${encodeURIComponent(calendarId)}/events`, { query: {
        timeMin: `${from}T00:00:00+08:00`, timeMax: `${to}T00:00:00+08:00`, timeZone: 'Asia/Taipei', singleEvents: true,
        maxResults: 250, orderBy: 'startTime', pageToken, q: query,
      } });
      events.push(...(page.items || [])); pageToken = page.nextPageToken;
    } while (pageToken && events.length < 2000);
    if (pageToken) throw new AppError('Choose a shorter calendar date range.', 400, 'range_too_large');
    return events.filter(e => e.status !== 'cancelled' && !isTestEvent(e));
  }
  async history(user, from, to) {
    const sourceIds = [...new Set(['primary', user.calendarId].filter(Boolean))];
    const rows = [];
    for (const id of sourceIds) {
      const events = await this.events(user, id, from, to, id === 'primary' ? '訓練' : undefined);
      for (const e of events) if (e.extendedProperties?.private?.formSessionId || isLegacyWorkout(e)) rows.push(historyEvent(e, id));
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }
  async sync(user, session) {
    const calendarId = session.calendarId || user.calendarId;
    if (!calendarId) throw new AppError('Choose or create your Workouts calendar to sync.', 409, 'calendar_setup_required');
    const eventId = await hexDigest(`${user.id}:${session.id}`);
    const path = `/calendars/${encodeURIComponent(calendarId)}/events`;
    const body = sessionEvent(session); body.extendedProperties.private.formOwner = user.id;
    let existing = await this.request(user, `${path}/${eventId}`, { allow404: true });
    if (!existing) {
      const created = await this.request(user, path, { method: 'POST', body: { ...body, id: eventId }, query: { sendUpdates: 'none' }, allow409: true });
      if (!created.conflict) return created;
      existing = await this.request(user, `${path}/${eventId}`);
    }
    if (existing.extendedProperties?.private?.formSessionId !== session.id || existing.extendedProperties?.private?.formOwner !== user.id) throw new AppError('This event does not belong to this workout.', 409, 'calendar_conflict');
    return this.request(user, `${path}/${eventId}`, { method: 'PATCH', body, headers: existing.etag ? { 'If-Match': existing.etag } : {}, query: { sendUpdates: 'none' } });
  }
  async importPreview(user, from, to) {
    return (await this.events(user, 'primary', from, to, '訓練')).filter(e => isLegacyWorkout(e) && e.organizer?.self && !e.recurringEventId && !(e.attendees || []).some(a => !a.self)).map(e => historyEvent(e, 'primary'));
  }
  async move(user, eventIds) {
    if (!user.calendarId || user.calendarId === 'primary') throw new AppError('Set up a dedicated workout calendar first.', 409, 'calendar_setup_required');
    const moved = [], failed = [];
    for (const id of eventIds) {
      try {
        const path = `/calendars/primary/events/${encodeURIComponent(id)}`;
        const event = await this.request(user, path, { allow404: true });
        if (!event) {
          const target = await this.request(user, `/calendars/${encodeURIComponent(user.calendarId)}/events/${encodeURIComponent(id)}`, { allow404: true });
          if (target && isLegacyWorkout(target)) { moved.push(id); continue; }
          throw new AppError('This event is no longer on your main calendar.');
        }
        if (!isLegacyWorkout(event) || !event.organizer?.self || event.recurringEventId || (event.attendees || []).some(a => !a.self)) throw new AppError('This event is not an eligible personal workout.');
        await this.request(user, `${path}/move`, { method: 'POST', query: { destination: user.calendarId, sendUpdates: 'none' } }); moved.push(id);
      } catch (error) { failed.push({ id, error: error instanceof AppError ? error.message : 'Could not move this event.' }); }
    }
    return { moved, failed };
  }
}
