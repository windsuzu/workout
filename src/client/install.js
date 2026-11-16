export class AppInstall {
  constructor(onChange) {
    this.pending = null; this.didInstall = false;
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); this.pending = event; onChange(); });
    window.addEventListener('appinstalled', () => { this.pending = null; this.didInstall = true; onChange(); });
  }
  get installed() { return this.didInstall || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
  async prompt() {
    if (!this.pending) return false;
    const event = this.pending; this.pending = null;
    await event.prompt(); await event.userChoice; return true;
  }
}
