export class AppInstall {
  constructor(onChange = () => {}, { windowRef = globalThis.window, navigatorRef = globalThis.navigator } = {}) {
    this.windowRef = windowRef; this.navigatorRef = navigatorRef;
    this.pending = null; this.didInstall = false;
    this.displayMode = windowRef?.matchMedia?.('(display-mode: standalone)');
    this.beforePrompt = event => { event.preventDefault(); this.pending = event; onChange(); };
    this.afterInstall = () => { this.pending = null; this.didInstall = true; onChange(); };
    this.displayChange = () => { if (this.standalone) this.pending = null; onChange(); };
    this.onChange = onChange;
    // Construct before starting the app so browser install events are retained while it loads.
    windowRef?.addEventListener('beforeinstallprompt', this.beforePrompt);
    windowRef?.addEventListener('appinstalled', this.afterInstall);
    if (this.displayMode?.addEventListener) this.displayMode.addEventListener('change', this.displayChange);
    else this.displayMode?.addListener?.(this.displayChange);
  }
  get standalone() { return this.displayMode?.matches === true || this.navigatorRef?.standalone === true; }
  get installed() { return this.didInstall || this.standalone; }
  get supported() {
    const { protocol, hostname = '' } = this.windowRef?.location || {};
    const local = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
    return this.windowRef?.isSecureContext !== false && (protocol === 'https:' || (protocol === 'http:' && local));
  }
  get platform() {
    const ua = this.navigatorRef?.userAgent || '', platform = this.navigatorRef?.platform || '';
    if (/iPad|iPhone|iPod/i.test(ua) || (/Mac/i.test(platform || ua) && this.navigatorRef?.maxTouchPoints > 1)) return 'ios';
    return /Android/i.test(ua) ? 'android' : 'desktop';
  }
  get embedded() {
    const ua = this.navigatorRef?.userAgent || '';
    const inApp = /FBAN|FBAV|FB_IAB|Instagram|\bLine\/|MicroMessenger|TikTok|BytedanceWebview|Snapchat|Twitter|LinkedInApp|Pinterest|GSA\//i.test(ua);
    const webview = /;\s*wv\b/i.test(ua) || (this.platform === 'ios' && /AppleWebKit/i.test(ua) && !/Safari|CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua));
    return inApp || webview || Boolean(this.windowRef?.self && this.windowRef?.top && this.windowRef.self !== this.windowRef.top);
  }
  get canPrompt() { return Boolean(this.pending) && this.supported && !this.installed && !this.embedded; }
  async prompt() {
    if (!this.canPrompt) return 'unavailable';
    const event = this.pending; this.pending = null;
    try {
      // Keep this call in the click's user gesture, before any await or rendering callback.
      const prompted = event.prompt();
      this.onChange();
      await prompted;
      const choice = await event.userChoice;
      return choice?.outcome === 'accepted' ? 'accepted' : choice?.outcome === 'dismissed' ? 'dismissed' : 'failed';
    } catch {
      this.onChange();
      return 'failed';
    }
  }
  destroy() {
    this.windowRef?.removeEventListener('beforeinstallprompt', this.beforePrompt);
    this.windowRef?.removeEventListener('appinstalled', this.afterInstall);
    if (this.displayMode?.removeEventListener) this.displayMode.removeEventListener('change', this.displayChange);
    else this.displayMode?.removeListener?.(this.displayChange);
  }
}
