# FORM workout tracker

A mobile workout list, set log, and rest timer. The existing A/B/C routines in `workouts.json` seed each account's plan.

- Record actual weight and reps for each set. Pair ledger remembers each completed set’s pair independently for next time and compares matching sets from last time. **Complete set & rest** records the set and starts its timer; the same button pauses or resumes rest.
- Edit weight, reps, set count, rest, bench angle, setup notes, and an optional exercise image/GIF. Apply changes today, next time, or both. Recorded sets keep their original values.
- Resume unfinished workouts, correct completed sets, and undo an individual set.
- Save inside the app and sync directly to a dedicated Google Calendar. Retries update the same event.
- See a monthly heatmap, weekly activity, A/B/C balance, recorded training time, and comparisons using actual saved weights.
- Keep working offline after the first visit. An on-device queue retries when the app reconnects.
- Preview old `訓練 A/B/C - …` events in the main calendar and move only selected personal workouts.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. Local tracking works immediately. For Google sign-in, copy `.env.example` to `.env.local` and follow [Google and Netlify setup](docs/google-setup.md). Restart the dev server after code or configuration changes.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The browser suite uses a local fake Google provider, never your real calendar. It checks offline reload, set logging and sound, account login, direct sync, cross-device settings/history, historical angle snapshots, and card heights for all 18 exercises at three widths. It uses `/usr/bin/chromium` when available; `CHROMIUM_PATH` can override it. Screenshots go into ignored `test-results/`.

## Deploy on Netlify

Keep the existing Netlify site connected to this repository. `netlify.toml` sets the build command to `npm run build`, publish directory to `dist`, and Functions directory to `netlify/functions`. Google sync also requires four server environment variables and an OAuth client: see the [setup instructions](docs/google-setup.md).

Netlify Functions authenticate the Google account and save private account data to Netlify Blobs. IndexedDB stores an offline copy on each device. Google Calendar stores completed workout events. Google refresh/access tokens are encrypted on the server and never sent to the browser. Static-only hosting cannot run the sync backend.

## Workout seed

Edit `workouts.json` to change the initial routine. Keep exercise ordering stable: existing exercises derive their identity from day and position, unless an explicit `id` is supplied. Seed changes apply to new accounts; existing accounts keep their saved preferences. Use the in-app settings to update an existing account's defaults.

The build publishes only `days` from the JSON. It does not publish private account data or Google credentials.

## Project layout

```text
src/client/             Focus UI, IndexedDB cache, sync queue
src/domain/model.js     Shared workout and calendar-event model
src/server/             OAuth, persistence, Google Calendar API
netlify/functions/      Netlify API entry point
public/                 Offline app shell and install manifest
scripts/                Build and local development server
tests/                  Domain, API, and browser checks
docs/                   Setup, architecture, and agreed design
```

See [per-set memory and comparisons](docs/per-set-memory.md) for completion, undo and conflict behavior.

See [architecture and sync behavior](docs/architecture/implementation.md) for storage, conflicts, and calendar limitations.

## Phone setup

Open Account & sync → **Test timer sound** and check your phone's media volume. The alarm resumes suspended audio before playing and vibrates on supported devices. Keep the app visible with the screen unlocked for reliable alerts; a home-screen install does not guarantee alarms while the OS suspends the app.

Use the visible **Install** button in the header, or **Add to Home Screen** in settings. Android Chrome can show its native installation prompt when eligible; otherwise use Chrome's menu. On iPhone/iPad, open the app in Safari and choose Share → Add to Home Screen → Add. FORM opens as a standalone home-screen web app.

See [phone installation and safe updates](docs/pwa.md) for platform instructions, offline status, and the Save & update flow.
