const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function manualSteps(platform) {
  if (platform === 'ios') return '<h3>On iPhone or iPad</h3><ol><li>Open this page in Safari and tap Share (the square with an up arrow).</li><li>Choose <strong>Add to Home Screen</strong>. You may need to scroll down.</li><li>Tap <strong>Add</strong>, then open FORM from your home screen.</li></ol>';
  if (platform === 'android') return '<h3>On Android</h3><ol><li>Open this page in Chrome.</li><li>Tap the <strong>⋮ menu</strong>, then <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Confirm, then open FORM from your home screen or app list.</li></ol>';
  return '<h3>On your computer</h3><ol><li>Look for an install icon in your browser’s address bar, or open its menu.</li><li>Choose <strong>Install FORM</strong> or <strong>Install app</strong>, then confirm.</li><li>Open FORM from your apps or desktop shortcut.</li></ol><p class="muted">If there is no install option, open this page in Chrome or Edge. You can also keep using FORM in this browser.</p>';
}

export function renderInstallDialog(install, { error = '', message = '', working = false, offlineReady = false, appUrl = '' } = {}) {
  let content;
  if (install.installed) {
    content = `<p role="status">${install.standalone ? 'You’re using FORM as an app.' : 'FORM is installed. Open it from your home screen or app list.'}</p>`;
  } else if (!install.supported) {
    content = '<p>Installation needs a secure connection. Open the HTTPS version of FORM, then try again.</p><p class="muted">You can keep using FORM in this browser.</p>';
  } else {
    content = '<p>Keep FORM one tap away. Add it to your home screen or apps.</p>';
    if (install.embedded) content += '<p><strong>Open FORM in your browser first.</strong> This browser inside another app may not offer installation. Use its menu to open this page in Safari on iPhone or iPad, or Chrome on Android.</p>';
    if (install.canPrompt) content += `<button type="button" class="primary block" data-action="install-confirm" ${working ? 'disabled' : ''}>Install FORM</button>`;
    content += `<section class="settings-section">${manualSteps(install.platform)}</section>`;
  }
  if (!install.installed) content += `<section class="settings-section"><h3>Opened from another app?</h3><p class="muted">If you cannot find the install option, copy this link and open it in Safari on iPhone or iPad, or Chrome on Android or your computer.</p>${appUrl ? `<code class="install-address">${escapeText(appUrl)}</code>` : ''}<button type="button" data-action="copy-app-link">Copy app link</button></section>`;
  return `<div class="modal-backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="heading-row"><h2 id="dialog-title" tabindex="-1">Install FORM</h2><button type="button" data-action="close-dialog" aria-label="Close">×</button></div>${content}${offlineReady ? '<p class="data-note">FORM is ready to open offline on this device.</p>' : ''}${message ? `<p class="muted" role="status">${escapeText(message)}</p>` : ''}${error ? `<p class="form-error" role="alert">${escapeText(error)}</p>` : ''}${working ? '<p class="muted" role="status">Follow the installation prompt. You can also use the steps above.</p>' : ''}</section></div>`;
}
