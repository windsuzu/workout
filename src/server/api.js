import seed from '../../workouts.json' with { type: 'json' };
import { AppError, applyPlanChanges, seedPlan, validateSession } from '../domain/model.js';
import { Repository } from './repository.js';
import { GoogleCalendar } from './google.js';
import { cookie, cookies, open, randomToken, requireOrigin, seal, sha256, signed, verified } from './security.js';

const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.app.created', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const redirect = (location, values = []) => { const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' }); values.forEach(value => headers.append('Set-Cookie', value)); return new Response(null, { status: 302, headers }); };
const configured = env => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.AUTH_SECRET?.length >= 32 && env.APP_URL);

function range(url) {
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if (![from, to].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && Number.isFinite(Date.parse(d))) || from >= to || Date.parse(to) - Date.parse(from) > 370 * 86400000) throw new AppError('Choose a date range of up to one year.');
  return [from, to];
}

async function body(request) {
  if (Number(request.headers.get('content-length')) > 300000) throw new AppError('This request is too large.', 413);
  const raw = await request.text(); if (raw.length > 300000) throw new AppError('This request is too large.', 413);
  try { return JSON.parse(raw); } catch { throw new AppError('Invalid JSON.'); }
}

export function createAPI({ store, env, fetcher = fetch }) {
  const repo = new Repository(store), google = new GoogleCalendar(repo, env, fetcher);
  async function syncSession(user, sessionKey) {
    const key = `sync-lock/${user.id}/${sessionKey.split('/').at(-1)}`, token = randomToken();
    const lock = await repo.update(key, value => value?.expiresAt > Date.now() ? undefined : { token, expiresAt: Date.now() + 120000 });
    if (lock.token !== token) throw new AppError('This workout is syncing. Your changes are saved; retry shortly.', 409, 'sync_in_progress');
    try {
      // One writer per workout; if a correction arrives during a Google write, send the newer revision before releasing the lock.
      for (let attempt = 0; attempt < 3; attempt++) {
        let saved = await repo.get(sessionKey);
        if (saved.sync === 'synced') return saved;
        const lease = await repo.update(key, value => value?.token === token ? { token, expiresAt: Date.now() + 120000 } : undefined);
        if (lease.token !== token) throw new AppError('Another save is syncing this workout. Please retry.', 409, 'sync_in_progress');
        const account = await repo.get(`users/${user.id}`);
        if (!saved.calendarId && account.calendarId) saved = await repo.update(sessionKey, value => value.calendarId ? undefined : { ...value, calendarId: account.calendarId });
        const event = await google.sync(account, saved);
        const latest = await repo.update(sessionKey, value => value.revision === saved.revision
          ? { ...value, sync: 'synced', eventId: event.id, eventUrl: event.htmlLink || null, calendarId: saved.calendarId || account.calendarId }
          : undefined);
        if (latest.sync === 'synced') return latest;
      }
      throw new AppError('Your latest changes are saved and waiting to sync. Please retry.', 409, 'sync_in_progress');
    } finally { await repo.update(key, value => value?.token === token ? { token, expiresAt: 0 } : undefined); }
  }
  async function authenticate(request, requireAccount = false) {
    const token = cookies(request).form_session;
    if (!token || token.length > 100) throw new AppError('Sign in to sync your workouts.', 401, 'sign_in_required');
    const session = await repo.get(`auth/${await sha256(token)}`);
    if (!session || session.expiresAt < Date.now()) throw new AppError('Sign in again to sync your workouts.', 401, 'sign_in_required');
    const user = await repo.get(`users/${session.userId}`);
    if (!user) throw new AppError('Sign in again.', 401, 'sign_in_required');
    if (requireAccount && request.headers.get('X-Form-Account') !== user.id) throw new AppError('Your Google account changed. Reload the app to continue; pending work stays on this device.', 409, 'account_changed');
    return user;
  }
  return async function handle(request) {
    const url = new URL(request.url), path = url.pathname.replace(/^\/\.netlify\/functions\/api/, '/api');
    try {
      let origin = url.origin;
      if (env.APP_URL) {
        try { origin = new URL(env.APP_URL).origin; }
        catch { throw new AppError('The application URL is not configured correctly.', 503, 'setup_required'); }
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') requireOrigin(request, origin);
      if (path === '/api/me' && request.method === 'GET') {
        try { const u = await authenticate(request); return json({ configured: configured(env), user: { id: u.id, email: u.email, name: u.name }, calendar: u.calendarId ? { id: u.calendarId, name: u.calendarName } : null }); }
        catch (error) { if (error.status === 401) return json({ user: null, configured: configured(env) }); throw error; }
      }
      if (path === '/api/auth/google' && request.method === 'GET') {
        if (!configured(env)) throw new AppError('Google sign-in needs to be configured for this deployment.', 503, 'setup_required');
        const state = randomToken(), verifier = randomToken(), challenge = await sha256(verifier);
        const consent = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        for (const [k, v] of Object.entries({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${origin}/api/auth/callback`, response_type: 'code', scope: SCOPES.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' })) consent.searchParams.set(k, v);
        return redirect(consent.href, [cookie('form_oauth', await signed({ state, verifier, expiresAt: Date.now() + 600000 }, env.AUTH_SECRET), origin, 600)]);
      }
      if (path === '/api/auth/callback' && request.method === 'GET') {
        const state = await verified(cookies(request).form_oauth || '', env.AUTH_SECRET);
        if (!state || state.expiresAt < Date.now() || state.state !== url.searchParams.get('state') || !url.searchParams.get('code')) throw new AppError('Google sign-in expired or was cancelled. Start sign-in again.', 400, 'oauth_failed');
        const response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(15000), body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: `${origin}/api/auth/callback`, code_verifier: state.verifier }) });
        if (!response.ok) throw new AppError('Google sign-in could not be completed. Please retry.', 400, 'oauth_failed');
        const token = await response.json();
        const profileResponse = await fetcher('https://openidconnect.googleapis.com/v1/userinfo', { signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token.access_token}` } });
        if (!profileResponse.ok) throw new AppError('Google identity could not be verified.', 401);
        const profile = await profileResponse.json();
        if (!/^[a-zA-Z0-9-]{1,100}$/.test(profile.sub || '') || profile.email_verified !== true) throw new AppError('A verified Google account is required.', 401);
        const old = await repo.get(`users/${profile.sub}`);
        const previous = old?.credentials ? await open(old.credentials, env.AUTH_SECRET).catch(() => null) : null;
        if (!token.refresh_token && !previous?.refreshToken) throw new AppError('Reconnect Google and allow offline access.', 401, 'reconnect_required');
        const credentials = await seal({ accessToken: token.access_token, refreshToken: token.refresh_token || previous.refreshToken, expiresAt: Date.now() + token.expires_in * 1000 }, env.AUTH_SECRET);
        await repo.update(`users/${profile.sub}`, user => ({ ...(user || { plan: seedPlan(seed), applied: [], calendarId: null }), id: profile.sub, email: profile.email, name: profile.name || profile.email, credentials }));
        const sessionToken = randomToken();
        await repo.put(`auth/${await sha256(sessionToken)}`, { userId: profile.sub, expiresAt: Date.now() + 30 * 86400000 });
        return redirect(origin + '/', [cookie('form_session', sessionToken, origin, 30 * 86400), cookie('form_oauth', '', origin, 0)]);
      }
      if (path === '/api/logout' && request.method === 'POST') {
        await authenticate(request, true);
        const token = cookies(request).form_session; if (token) await repo.remove(`auth/${await sha256(token)}`);
        return json({ ok: true }, 200, { 'Set-Cookie': cookie('form_session', '', origin, 0) });
      }
      const user = await authenticate(request, true);
      if (path === '/api/state' && request.method === 'GET') {
        const drafts = [];
        for (const draft of await repo.list(`drafts/${user.id}/`)) {
          const canonical = await repo.get(`sessions/${user.id}/${draft.id}`);
          if (canonical?.status === 'draft') drafts.push(canonical);
          else await repo.remove(`drafts/${user.id}/${draft.id}`);
        }
        return json({ plan: user.plan, drafts });
      }
      if (path === '/api/plan' && request.method === 'PATCH') {
        const data = await body(request);
        if (!/^[a-zA-Z0-9-]{1,100}$/.test(data.operationId || '')) throw new AppError('Missing operation identifier.');
        const updated = await repo.update(`users/${user.id}`, value => {
          if (value.applied.includes(data.operationId)) return undefined;
          value.plan = applyPlanChanges(value.plan, data.changes, { checkExpected: true });
          value.applied = [...value.applied.slice(-99), data.operationId]; return value;
        });
        return json({ plan: updated.plan });
      }
      const sessionMatch = path.match(/^\/api\/sessions\/([a-zA-Z0-9-]{1,100})$/);
      if (sessionMatch && request.method === 'PUT') {
        const data = await body(request), input = validateSession(data.session);
        if (input.id !== sessionMatch[1] || !/^[a-zA-Z0-9-]{1,100}$/.test(data.operationId || '')) throw new AppError('Invalid session or operation identifier.');
        const key = `sessions/${user.id}/${input.id}`;
        let saved = await repo.update(key, old => {
          if (old?.lastMutation === data.operationId) return undefined;
          if (old && old.revision !== input.revision) throw new AppError('This workout changed on another device. Keep your copy or reload it.', 409, 'session_conflict', { session: old });
          if (old?.status === 'completed' && input.status === 'draft') throw new AppError('This workout is already finished on another device.', 409, 'session_conflict', { session: old });
          return { ...input, ...(old?.calendarId ? { calendarId: old.calendarId, eventId: old.eventId, eventUrl: old.eventUrl } : {}), revision: (old?.revision || 0) + 1, savedAt: new Date().toISOString(), lastMutation: data.operationId, sync: input.status === 'completed' ? 'pending' : 'draft' };
        });
        if (saved.status === 'draft') { await repo.put(`drafts/${user.id}/${saved.id}`, saved); return json({ session: saved }); }
        await repo.remove(`drafts/${user.id}/${saved.id}`);
        if (saved.sync !== 'synced') {
          try {
            saved = await syncSession(user, key);
          } catch (error) {
            if (!(error instanceof AppError)) throw error;
            return json({ session: saved, syncError: { message: error.message, code: error.code } }, 202);
          }
        }
        if (saved.lastMutation !== data.operationId) throw new AppError('This workout changed on another device while syncing. Review the latest version.', 409, 'session_conflict', { session: saved });
        return json({ session: saved });
      }
      if (sessionMatch && request.method === 'GET') {
        const session = await repo.get(`sessions/${user.id}/${sessionMatch[1]}`);
        if (!session) throw new AppError('Workout not found.', 404); return json({ session });
      }
      if (path === '/api/history' && request.method === 'GET') return json({ events: await google.history(user, ...range(url)), calendar: user.calendarId ? { id: user.calendarId, name: user.calendarName } : null });
      if (path === '/api/calendars' && request.method === 'GET') return json({ calendars: (await google.calendars(user)).filter(c => c.accessRole === 'owner' && !c.primary).map(c => ({ id: c.id, name: c.summary })) });
      if (path === '/api/calendar/setup' && request.method === 'POST') return json({ calendar: await google.setup(user) });
      if (path === '/api/calendar/select' && request.method === 'POST') {
        const data = await body(request), calendars = await google.calendars(user);
        const target = calendars.find(c => c.id === data.calendarId && c.accessRole === 'owner' && !c.primary);
        if (!target) throw new AppError('Choose a dedicated calendar that you own.');
        await repo.update(`users/${user.id}`, u => ({ ...u, calendarId: target.id, calendarName: target.summary }));
        return json({ calendar: { id: target.id, summary: target.summary } });
      }
      if (path === '/api/import/preview' && request.method === 'GET') return json({ events: await google.importPreview(user, ...range(url)) });
      if (path === '/api/import' && request.method === 'POST') {
        const data = await body(request);
        if (!Array.isArray(data.eventIds) || !data.eventIds.length || data.eventIds.length > 30 || data.eventIds.some(id => typeof id !== 'string' || id.length > 1024)) throw new AppError('Select between one and thirty workout events.');
        return json(await google.move(user, [...new Set(data.eventIds)]));
      }
      throw new AppError('API route not found.', 404);
    } catch (error) {
      if (error instanceof AppError) return json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, error.status);
      return json({ error: 'The server could not complete this request. Please retry.', code: 'server_error' }, 500);
    }
  };
}
