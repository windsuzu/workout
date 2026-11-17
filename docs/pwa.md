# Installing and updating FORM

The **Install** button is visible in the app header before signing in. It opens instructions for the current phone or browser.

- **Android:** use **Install FORM** when Chrome offers its native prompt. Otherwise open Chrome's menu and choose Install app or Add to Home screen.
- **iPhone/iPad:** open the address in Safari, tap Share, choose Add to Home Screen, then Add. iOS uses this browser flow instead of the Android install prompt.
- **Inside another app:** use Copy app link and paste it into Safari or Chrome. An embedded browser may not permit home-screen installation.
- **Desktop:** Chrome or Edge can install from their address-bar icon or menu.

An accepted prompt is not reported as a completed installation until the browser confirms it. An installed standalone window hides the main Install button. Browser and OS support still determine which native installation controls are available; manual steps remain available when no prompt event fires.

Open the installed app and sign in with the same Google account to load synced workouts. Offline saves remain specific to the browser/device that recorded them until synchronized.

## Offline and updates

Settings shows whether offline preparation succeeded. The service worker precaches the public app shell, routine seed, manifest and icons. API responses and Google authentication routes are never cached. Navigation falls back to the complete cached shell on disconnection, HTTP 5xx, or a four-second network stall.

An update waits rather than replacing an open workout automatically. **Save & update** writes the current workout and pending sync queue to device storage before activating the waiting worker and reloading. It refuses to reload while a dialog is open or persistent storage is unavailable. Changes typed into a set field are committed when clicking the update button blurs that field. No account data or IndexedDB stores are cleared during updates.

JavaScript and CSS use content-versioned filenames, so an older service worker cannot serve stale fixed-path assets with new HTML. Manifest links are versioned too, and the hosting configuration supplies the manifest content type explicitly. Each worker retains its coherent offline HTML snapshot; activation keeps the current and previous cache versions. A failed precache leaves the last working version available.

## Validation and limits

`npm run test:browser` includes real-worker upgrade tests: a legacy fixed-path cache, unsynced set/draft preservation across explicit update, offline launch, HTTP 503 and stalled navigation recovery, failed precache, cache privacy boundaries, and Chromium's persistent-profile installability audit. Unit tests cover Android/iOS/iPadOS/embedded-browser instructions and prompt outcomes.

The installed layout accounts for phone safe areas and removes preview-style margins. Automated desktop/browser checks cannot complete the iOS Share sheet or verify every physical phone. Home-screen installation does not turn browser rest alarms into guaranteed locked-screen/background alarms.
