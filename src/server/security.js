import { AppError } from '../domain/model.js';

const encoder = new TextEncoder();
const toBase64 = value => Buffer.from(value).toString('base64url');
const fromBase64 = value => new Uint8Array(Buffer.from(value, 'base64url'));
export const randomToken = () => toBase64(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async value => toBase64(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
export const hexDigest = async value => Buffer.from(await crypto.subtle.digest('SHA-256', encoder.encode(value))).toString('hex');

async function key(secret, purpose, algorithm) {
  if (typeof secret !== 'string' || secret.length < 32) throw new AppError('Server authentication is not configured.', 503, 'setup_required');
  const raw = await crypto.subtle.digest('SHA-256', encoder.encode(`${purpose}:${secret}`));
  return crypto.subtle.importKey('raw', raw, algorithm, false, algorithm === 'AES-GCM' ? ['encrypt', 'decrypt'] : ['sign', 'verify']);
}

export async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret, 'google-token', 'AES-GCM'), encoder.encode(JSON.stringify(value)));
  return `${toBase64(iv)}.${toBase64(ciphertext)}`;
}

export async function open(value, secret) {
  try {
    const [iv, ciphertext] = value.split('.');
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await key(secret, 'google-token', 'AES-GCM'), fromBase64(ciphertext));
    return JSON.parse(new TextDecoder().decode(clear));
  } catch { throw new AppError('Please reconnect your Google account.', 401, 'reconnect_required'); }
}

export async function signed(value, secret) {
  const body = toBase64(encoder.encode(JSON.stringify(value)));
  const signature = await crypto.subtle.sign('HMAC', await key(secret, 'oauth-state', { name: 'HMAC', hash: 'SHA-256' }), encoder.encode(body));
  return `${body}.${toBase64(signature)}`;
}

export async function verified(value, secret) {
  try {
    const [body, signature] = value.split('.');
    if (!await crypto.subtle.verify('HMAC', await key(secret, 'oauth-state', { name: 'HMAC', hash: 'SHA-256' }), fromBase64(signature), encoder.encode(body))) return null;
    return JSON.parse(new TextDecoder().decode(fromBase64(body)));
  } catch { return null; }
}

export function cookies(request) {
  return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(pair => pair.trim().split(/=(.*)/s)).filter(pair => pair[0]));
}

export function cookie(name, value, origin, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(origin).protocol === 'https:' ? '; Secure' : ''}`;
}

export function requireOrigin(request, origin) {
  if (request.headers.get('origin') !== new URL(origin).origin) throw new AppError('This request did not come from the app.', 403, 'invalid_origin');
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError('Send JSON data.', 415);
}
