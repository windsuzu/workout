import test from 'node:test';
import assert from 'node:assert/strict';
import { PwaUpdates } from '../src/client/pwa-updates.js';

function setup() {
  const worker = new EventTarget(), registration = new EventTarget();
  worker.controller = {}; worker.ready = Promise.resolve(registration); worker.register = async () => registration;
  registration.update = async () => {}; registration.waiting = null;
  return { worker, registration };
}

test('offline registration failures are visible instead of swallowed', async () => {
  const { worker } = setup(); worker.register = async () => { throw new Error('offline'); };
  const updates = new PwaUpdates(() => {}, { worker }); await updates.start();
  assert.equal(updates.offlineReady, false); assert.match(updates.error, /could not finish/);
});

test('waiting updates activate only when explicitly requested', async () => {
  const { worker, registration } = setup(); const messages = [];
  registration.waiting = { postMessage(message) { messages.push(message); worker.dispatchEvent(new Event('controllerchange')); } };
  const updates = new PwaUpdates(() => {}, { worker }); await updates.start();
  assert.equal(updates.available, true); assert.equal(messages.length, 0);
  assert.equal(await updates.apply(), true); assert.deepEqual(messages, [{ type: 'SKIP_WAITING' }]);
});

test('another tab activating an update offers reload without automatically reloading', async () => {
  const { worker } = setup(); const updates = new PwaUpdates(() => {}, { worker }); await updates.start();
  assert.equal(updates.available, false); worker.dispatchEvent(new Event('controllerchange'));
  assert.equal(updates.available, true); assert.equal(await updates.apply(), true);
});

test('first worker claim is not presented as an application update', async () => {
  const { worker } = setup(); worker.controller = null;
  const updates = new PwaUpdates(() => {}, { worker }); await updates.start(); worker.controller = {}; worker.dispatchEvent(new Event('controllerchange'));
  assert.equal(updates.available, false);
});
