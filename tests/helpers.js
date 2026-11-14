import { createAPI } from '../src/server/api.js';

export class MemoryStore {
  rows = new Map(); sequence = 0;
  async getWithMetadata(key) { const entry = this.rows.get(key); return entry ? structuredClone(entry) : null; }
  async setJSON(key, data, options = {}) {
    const old = this.rows.get(key);
    if ((options.onlyIfNew && old) || (options.onlyIfMatch && old?.etag !== options.onlyIfMatch)) return { modified: false };
    const etag = String(++this.sequence); this.rows.set(key, { data: structuredClone(data), etag }); return { modified: true, etag };
  }
  async delete(key) { this.rows.delete(key); }
  async *list({ prefix }) { yield { blobs: [...this.rows.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; }
}

export function fixture() {
  const store = new MemoryStore();
  const env = { APP_URL: 'https://form.example', AUTH_SECRET: 'test-only-secret-that-is-at-least-thirty-two-characters', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' };
  const events = new Map(), calendarRows = new Map(), calls = []; let failSync = false, googleHook;
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const fetcher = async (rawURL, options = {}) => {
    const url = new URL(rawURL), method = options.method || 'GET'; calls.push({ url: url.href, method, options });
    if (googleHook) await googleHook(url, options);
    if (url.hostname === 'oauth2.googleapis.com') {
      const values = new URLSearchParams(options.body); const user = values.get('code') || values.get('refresh_token')?.replace('refresh-', '') || 'u1';
      return response({ access_token: `access-${user}`, refresh_token: `refresh-${user}`, expires_in: 3600 });
    }
    const user = options.headers?.Authorization?.replace('Bearer access-', '') || 'u1';
    if (url.hostname === 'openidconnect.googleapis.com') return response({ sub: user, email: `${user}@example.com`, name: user, email_verified: true });
    const path = url.pathname.replace('/calendar/v3', '');
    if (path === '/users/me/calendarList') return response({ items: [{ id: 'primary', summary: 'Main', accessRole: 'owner', primary: true }, ...(calendarRows.get(user) || [])] });
    if (path === '/calendars' && method === 'POST') {
      const calendar = { ...JSON.parse(options.body), id: `cal-${user}`, accessRole: 'owner' };
      calendarRows.set(user, [calendar]); return response(calendar);
    }
    const match = path.match(/^\/calendars\/([^/]+)\/events(?:\/([^/]+))?(\/move)?$/);
    if (!match) throw new Error(`Unexpected Google request: ${method} ${path}`);
    const calendar = decodeURIComponent(match[1]), id = match[2] && decodeURIComponent(match[2]);
    const key = `${user}/${calendar}`; if (!events.has(key)) events.set(key, new Map()); const rows = events.get(key);
    if (method === 'GET' && !id) return response({ items: [...rows.values()] });
    if (method === 'GET') return rows.has(id) ? response(rows.get(id)) : response({}, 404);
    if (failSync && !match[3]) return response({ error: 'temporary failure' }, 503);
    if (match[3]) {
      const event = rows.get(id); if (!event) return response({}, 404);
      const destination = `${user}/${url.searchParams.get('destination')}`;
      if (!events.has(destination)) events.set(destination, new Map()); events.get(destination).set(id, event); rows.delete(id); return response(event);
    }
    const body = JSON.parse(options.body);
    if (method === 'POST' && rows.has(body.id)) return response({}, 409);
    const eventId = id || body.id, prior = rows.get(eventId);
    if (options.headers['If-Match'] && prior?.etag !== options.headers['If-Match']) return response({}, 412);
    const event = { ...prior, ...body, id: eventId, etag: `etag-${calls.length}`, htmlLink: `https://calendar.google.com/event/${eventId}` };
    rows.set(eventId, event); return response(event);
  };
  const api = createAPI({ store, env, fetcher });
  const request = (path, { cookie = '', method = 'GET', data, origin = env.APP_URL } = {}) => api(new Request(env.APP_URL + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) }));
  async function login(id = 'u1') {
    const start = await request('/api/auth/google'), consent = new URL(start.headers.get('location'));
    const stateCookie = start.headers.getSetCookie()[0].split(';')[0];
    const end = await request(`/api/auth/callback?state=${consent.searchParams.get('state')}&code=${id}`, { cookie: stateCookie });
    if (end.status !== 302) throw new Error(await end.text());
    return end.headers.getSetCookie().find(value => value.startsWith('form_session=')).split(';')[0];
  }
  return { api, store, env, calls, events, request, login, setSyncFailure: value => { failSync = value; }, setGoogleHook: value => { googleHook = value; } };
}
