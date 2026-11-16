import test from 'node:test';
import assert from 'node:assert/strict';
import { RestAlarm } from '../src/client/alarm.js';

test('a mobile-suspended audio context is resumed before the alarm is scheduled', async () => {
  let resumes = 0, silentSamples = 0; const tones = [], vibrations = [];
  const context = {
    state: 'suspended', sampleRate: 44100, currentTime: 10, destination: {},
    async resume() { resumes++; this.state = 'running'; },
    createBuffer: () => ({}), createBufferSource: () => ({ connect() {}, start() { silentSamples++; } }),
    createOscillator() { const tone = { frequency: { value: 0 }, connect() {}, disconnect() {}, start(at) { assert.equal(context.state, 'running'); this.at = at; }, stop() {} }; tones.push(tone); return tone; },
    createGain: () => ({ connect() {}, disconnect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
  };
  const alarm = new RestAlarm({ createContext: () => context, vibrate: pattern => vibrations.push(pattern) });
  assert.equal(await alarm.arm(), true); context.state = 'suspended';
  assert.equal(await alarm.ring(), true); assert.equal(resumes, 2); assert.equal(silentSamples, 1);
  assert.deepEqual(tones.map(tone => tone.frequency.value), [880, 880, 1100]); assert.equal(vibrations.length, 1);
});

test('blocked audio is reported without crashing and vibration remains available', async () => {
  let vibration = false;
  const context = { state: 'suspended', async resume() { throw new Error('blocked'); }, createBuffer() { return {}; }, createBufferSource: () => ({ connect() {}, start() {} }) };
  const alarm = new RestAlarm({ createContext: () => context, vibrate: () => { vibration = true; } });
  assert.equal(await alarm.arm(), false); assert.equal(await alarm.ring(), false); assert.equal(vibration, true);
});
