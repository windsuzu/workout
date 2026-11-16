// AudioContext can be suspended by mobile browsers even after initial activation.
export class RestAlarm {
  constructor({ createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(), vibrate = pattern => globalThis.navigator?.vibrate?.(pattern) } = {}) {
    this.createContext = createContext; this.vibrate = vibrate; this.context = null;
  }
  async resume() {
    if (!this.context) return false;
    let timeout;
    try {
      if (this.context.state !== 'running') await Promise.race([this.context.resume(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Audio unavailable')), 2000); })]);
      return this.context.state === 'running';
    } catch { return false; } finally { clearTimeout(timeout); }
  }
  arm() {
    try {
      if (!this.context || this.context.state === 'closed') this.context = this.createContext();
      const ready = this.resume();
      // Render a silent sample during the gesture to activate the mobile audio output.
      const source = this.context.createBufferSource(); source.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
      source.connect(this.context.destination); source.onended = () => source.disconnect(); source.start();
      return ready;
    } catch { return Promise.resolve(false); }
  }
  async ring() {
    try { this.vibrate([180, 100, 180, 100, 260]); } catch {}
    if (!await this.resume()) return false;
    try {
      for (let i = 0; i < 3; i++) {
        const oscillator = this.context.createOscillator(), gain = this.context.createGain(), at = this.context.currentTime + i * .4;
        oscillator.type = 'triangle'; oscillator.frequency.value = i === 2 ? 1100 : 880;
        oscillator.connect(gain); gain.connect(this.context.destination);
        gain.gain.setValueAtTime(.001, at); gain.gain.exponentialRampToValueAtTime(.35, at + .015); gain.gain.exponentialRampToValueAtTime(.001, at + .3);
        oscillator.start(at); oscillator.stop(at + .32);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      }
      return true;
    } catch { return false; }
  }
}
