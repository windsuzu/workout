export class PwaUpdates {
  constructor(onChange, { worker = globalThis.navigator?.serviceWorker } = {}) {
    this.worker = worker; this.onChange = onChange; this.registration = null;
    this.offlineReady = false; this.waiting = null; this.error = ''; this.lastCheck = 0;
    this.reloadReady = false; this.hadController = Boolean(worker?.controller);
    worker?.addEventListener('controllerchange', () => {
      if (this.hadController) this.reloadReady = true;
      this.hadController = Boolean(worker.controller); this.waiting = this.registration?.waiting || null; this.onChange();
    });
  }
  get available() { return Boolean(this.waiting || this.reloadReady); }
  async start() {
    if (!this.worker) { this.error = 'Offline mode is unavailable in this browser.'; this.onChange(); return; }
    this.error = '';
    try {
      const registration = await this.worker.register('/sw.js', { updateViaCache: 'none' });
      this.registration = registration;
      const refresh = () => { this.waiting = registration.waiting; this.onChange(); };
      const observe = () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed') refresh();
          if (installing.state === 'redundant' && !registration.waiting) { this.error = 'The offline update could not finish. Retry when connected.'; this.onChange(); }
        });
      };
      registration.addEventListener('updatefound', observe); observe(); refresh();
      void this.worker.ready.then(() => { this.offlineReady = true; this.onChange(); });
    } catch { this.error = 'Offline setup could not finish. Check your connection and retry.'; this.onChange(); }
  }
  async check() {
    if (!this.registration || Date.now() - this.lastCheck < 60000) return;
    this.lastCheck = Date.now();
    try { await this.registration.update(); } catch { /* Keep the complete offline version when disconnected. */ }
  }
  async apply() {
    if (this.reloadReady) return true;
    const waiting = this.registration?.waiting;
    if (!waiting) return false;
    return new Promise((resolve, reject) => {
      const changed = () => { cleanup(); this.waiting = null; resolve(true); };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('The update is not ready yet. Please try again.')); }, 15000);
      const cleanup = () => { clearTimeout(timeout); this.worker.removeEventListener('controllerchange', changed); };
      this.worker.addEventListener('controllerchange', changed);
      try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (error) { cleanup(); reject(error); }
    });
  }
}
