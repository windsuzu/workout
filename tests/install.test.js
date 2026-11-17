import test from 'node:test';
import assert from 'node:assert/strict';
import { AppInstall } from '../src/client/install.js';
import { renderInstallDialog } from '../src/client/install-view.js';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36';
const desktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';

function setup({ userAgent = desktop, platform = 'MacIntel', maxTouchPoints = 0, standalone = false, origin = 'https://form.example', secure = true, display = false, onChange = () => {} } = {}) {
  const windowRef = new EventTarget(), media = new EventTarget();
  media.matches = display;
  Object.assign(windowRef, { location: new URL(origin), isSecureContext: secure, matchMedia: query => { assert.equal(query, '(display-mode: standalone)'); return media; } });
  windowRef.self = windowRef; windowRef.top = windowRef;
  const navigatorRef = { userAgent, platform, maxTouchPoints, standalone };
  const install = new AppInstall(onChange, { windowRef, navigatorRef });
  return { install, windowRef, navigatorRef, media };
}

function offer(windowRef, { outcome = 'accepted', prompt = () => Promise.resolve(), choice = Promise.resolve({ outcome }) } = {}) {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  event.prompt = prompt; event.userChoice = choice;
  windowRef.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  return event;
}

test('an install offer is retained and invokes the browser synchronously in the user gesture', async () => {
  const order = [], { install, windowRef } = setup({ onChange: () => order.push('change') });
  assert.equal(install.canPrompt, false);
  offer(windowRef, { prompt: () => { order.push('prompt'); return Promise.resolve(); } });
  assert.equal(install.canPrompt, true);
  order.length = 0;
  const result = install.prompt();
  assert.deepEqual(order, ['prompt', 'change']);
  assert.equal(install.canPrompt, false);
  assert.equal(await result, 'accepted');
  assert.equal(install.installed, false);
  assert.equal(install.standalone, false);
  assert.equal(await install.prompt(), 'unavailable');
});

test('dismissal consumes the offer without claiming installation and a later offer is usable', async () => {
  const { install, windowRef } = setup();
  offer(windowRef, { outcome: 'dismissed' });
  assert.equal(await install.prompt(), 'dismissed');
  assert.equal(install.canPrompt, false); assert.equal(install.installed, false);
  offer(windowRef);
  assert.equal(install.canPrompt, true);
  assert.equal(await install.prompt(), 'accepted');
});

test('missing and failed prompts produce safe outcomes without throwing browser errors', async () => {
  const { install, windowRef } = setup();
  assert.equal(await install.prompt(), 'unavailable');
  offer(windowRef, { prompt: () => { throw new Error('private browser details'); } });
  assert.equal(await install.prompt(), 'failed');
  offer(windowRef, { prompt: () => Promise.reject(new Error('blocked')) });
  assert.equal(await install.prompt(), 'failed');
  offer(windowRef, { choice: Promise.reject(new Error('choice failed')) });
  assert.equal(await install.prompt(), 'failed');
  offer(windowRef, { outcome: 'unexpected' });
  assert.equal(await install.prompt(), 'failed');
  assert.equal(install.installed, false); assert.equal(install.canPrompt, false);
});

test('appinstalled marks installation without claiming that the browser tab is standalone', () => {
  let changes = 0;
  const { install, windowRef } = setup({ onChange: () => changes++ });
  offer(windowRef);
  windowRef.dispatchEvent(new Event('appinstalled'));
  assert.equal(install.installed, true); assert.equal(install.standalone, false);
  assert.equal(install.canPrompt, false); assert.equal(changes, 2);
});

test('standalone display changes notify the UI and invalidate an old install offer', () => {
  let changes = 0;
  const { install, windowRef, media } = setup({ onChange: () => changes++ });
  offer(windowRef);
  media.matches = true; media.dispatchEvent(new Event('change'));
  assert.equal(install.installed, true); assert.equal(install.standalone, true);
  assert.equal(install.canPrompt, false);
  media.matches = false; media.dispatchEvent(new Event('change'));
  assert.equal(install.installed, false); assert.equal(install.canPrompt, false);
  assert.equal(changes, 3);
});

test('iOS standalone flag and desktop standalone display are recognized on startup', () => {
  const ios = setup({ userAgent: iphone, standalone: true }).install;
  assert.equal(ios.installed, true); assert.equal(ios.standalone, true);
  assert.equal(setup({ display: true }).install.installed, true);
});

test('platform detection includes iPadOS desktop mode without mistaking a Mac for an iPad', () => {
  assert.equal(setup({ userAgent: iphone }).install.platform, 'ios');
  assert.equal(setup({ userAgent: desktop, platform: 'MacIntel', maxTouchPoints: 5 }).install.platform, 'ios');
  assert.equal(setup({ userAgent: android, platform: 'Linux armv8l' }).install.platform, 'android');
  assert.equal(setup({ userAgent: desktop }).install.platform, 'desktop');
});

test('common in-app browsers, webviews, and frames use external-browser guidance', () => {
  const inAppAgents = [iphone + ' Instagram 355.0', android + ' [FBAN/FB4A;FBAV/490.0]', android.replace('Android 15;', 'Android 15; wv;'), iphone.replace(' Version/18.0', '').replace(' Safari/604.1', '')];
  for (const userAgent of inAppAgents) {
    const { install, windowRef } = setup({ userAgent });
    offer(windowRef);
    assert.equal(install.embedded, true, userAgent); assert.equal(install.canPrompt, false);
  }
  assert.equal(setup({ userAgent: iphone }).install.embedded, false);
  assert.equal(setup({ userAgent: android }).install.embedded, false);
  const frame = setup(); frame.windowRef.top = {};
  assert.equal(frame.install.embedded, true);
});

test('installation requires a secure origin and allows local development origins', async () => {
  for (const origin of ['https://form.example', 'http://localhost:3000', 'http://preview.localhost', 'http://127.0.0.1:3000', 'http://[::1]:3000']) assert.equal(setup({ origin }).install.supported, true, origin);
  for (const options of [{ origin: 'http://form.example' }, { origin: 'file:///form.html' }, { secure: false }]) {
    const { install, windowRef } = setup(options);
    offer(windowRef);
    assert.equal(install.supported, false); assert.equal(install.canPrompt, false);
    assert.equal(await install.prompt(), 'unavailable');
  }
});

test('destroy removes browser and display listeners', () => {
  let changes = 0;
  const { install, windowRef, media } = setup({ onChange: () => changes++ });
  install.destroy();
  const event = new Event('beforeinstallprompt', { cancelable: true });
  windowRef.dispatchEvent(event); windowRef.dispatchEvent(new Event('appinstalled'));
  media.matches = true; media.dispatchEvent(new Event('change'));
  assert.equal(changes, 0); assert.equal(event.defaultPrevented, false);
});

test('manual installation shows platform steps and an external-browser fallback without a native button', () => {
  for (const [userAgent, expected] of [[iphone, /Share[\s\S]*Add to Home Screen[\s\S]*Tap <strong>Add/], [android, /Chrome[\s\S]*⋮ menu[\s\S]*Install app/], [desktop, /address bar[\s\S]*Chrome or Edge/]]) {
    const html = renderInstallDialog(setup({ userAgent }).install);
    assert.match(html, expected);
    assert.match(html, /aria-labelledby="dialog-title"/);
    assert.match(html, /data-action="close-dialog"/);
    assert.match(html, /data-action="copy-app-link"/);
    assert.doesNotMatch(html, /data-action="install-confirm"/);
    assert.doesNotMatch(html, /ready to open offline/);
  }
});

test('native install is prominent only when available and manual steps remain while working', async () => {
  const { install, windowRef } = setup({ userAgent: android });
  offer(windowRef);
  const html = renderInstallDialog(install, { working: true });
  assert.match(html, /class="primary block" data-action="install-confirm" disabled/);
  assert.match(html, /⋮ menu/);
  assert.match(html, /Follow the installation prompt/);
  assert.equal(await install.prompt(), 'accepted');
  const after = renderInstallDialog(install, { message: 'Finish adding FORM, then open it from your home screen.' });
  assert.doesNotMatch(after, /FORM is installed/);
  assert.doesNotMatch(after, /data-action="install-confirm"/);
});

test('embedded and insecure contexts explain a path forward without a native button', () => {
  const embedded = setup({ userAgent: iphone + ' Instagram' }); offer(embedded.windowRef);
  const html = renderInstallDialog(embedded.install);
  assert.match(html, /Open FORM in your browser first/); assert.match(html, /Copy app link/);
  assert.doesNotMatch(html, /data-action="install-confirm"/);
  const unsupported = setup({ origin: 'http://form.example' }); offer(unsupported.windowRef);
  assert.match(renderInstallDialog(unsupported.install), /secure connection[\s\S]*HTTPS/);
  assert.doesNotMatch(renderInstallDialog(unsupported.install), /data-action="install-confirm"/);
});

test('installed copy distinguishes the browser tab from the standalone app', () => {
  const { install, windowRef } = setup();
  windowRef.dispatchEvent(new Event('appinstalled'));
  const browser = renderInstallDialog(install);
  assert.match(browser, /FORM is installed. Open it from/);
  assert.doesNotMatch(browser, /using FORM as an app/);
  assert.doesNotMatch(browser, /data-action="install-confirm"|data-action="copy-app-link"/);
  assert.match(renderInstallDialog(setup({ display: true }).install), /using FORM as an app/);
});

test('dialog escapes status and error text and only reports offline readiness when confirmed', () => {
  const { install } = setup();
  const html = renderInstallDialog(install, { error: '<img src=x onerror="alert(1)">', message: '<script>alert(1)</script>', offlineReady: true });
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /role="alert">&lt;img/);
  assert.match(html, /role="status">&lt;script/);
  assert.match(html, /ready to open offline/);
});
