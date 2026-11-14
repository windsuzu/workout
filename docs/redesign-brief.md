# Workout app redesign brief

Status: implemented on the Focus redesign branch. This records the agreed design;
see [architecture](architecture/implementation.md) and [deployment setup](google-setup.md).

## Agreed direction

- Revamp the workout list and timer app with a modern interface and easier weight editing.
- Use the Focus design as the selected direction. Keep exercise, set logging, and rest controls together.
- Combine the current exercise and its rest timer in the same view. Each exercise owns an editable rest default, and logging a set starts that exercise's countdown.
- Keep the rest dropdown and the combined set/rest action. Remove the +15-second, skip, and sound-toggle controls; play the rest-completion sound automatically after browser audio activation.
- Combine set completion and starting rest into one action. During rest, that same button pauses or resumes; there is no separate start-only action.
- Allow actual weight and reps to be entered for each set and corrected after completion. Undo removes the chosen set and resets that exercise's rest, without changing future targets.
- Show last-session comparisons and exercise progress. Prototype comparison weights must be labeled as examples because legacy calendar records contain no weights.
- Recommend the next A/B/C workout from actual completed calendar history; preserve unfinished progress when returning. Offline and pending-sync states may be simulated in the preview and must be labeled accordingly.
- Provide Day A/B/C tabs for the existing routines, preserving each day's progress, weights, and rest settings when switching.
- Changing a weight updates today's workout and the default for next time.
- Offer a “Today only” option that leaves the future default unchanged.
- Keep the actual weights used in completed workouts, even when future defaults change.
- Save bench angle and setup notes with exercise defaults and snapshot them for each completed set.
- Sync saved workout plans and default weights across phone and computer.
- Use a dedicated Google Calendar for workout history, accessible across devices.
- Finish and save inside the app through the Calendar API after Google sign-in, without opening the Google Calendar website. Show pending, successful, and failed sync states; retry without duplicate events.
- Show a monthly training heatmap, monthly and loaded-history session totals, weekly activity, and Day A/B/C balance. Exclude prototype tests; do not infer duration from historical all-day events.
- Offer a preview of likely workout events in the main calendar. Move only events the user selects.

## Original app

- The app loads its plan from `workouts.json`.
- Weights are displayed but cannot be edited in the app.
- Workout progress is stored in the browser.
- Calendar sharing opens a prefilled event for manual saving. It does not read events back or include weights.

## Implemented first version

- A mobile-first workout screen with large exercise controls and a visible rest timer.
- Edit the actual weight/reps directly on each set; tap the main weight or Edit to change exercise defaults.
- Connect Google, then create or select the dedicated workout calendar.
- Save completed sessions as calendar events with actual weights, reps, sets, and notes.
- Read those events to show history in the app; corrections update the associated event.
- Sync when the app opens and after edits, with an explicit sync status and retry action.

## Storage and hosting decisions

- Keep Netlify hosting. Netlify Functions handle Google sign-in and Calendar calls; Netlify Blobs persists plans and sessions per account. IndexedDB keeps the offline cache and queue.
- Read Calendar dates and recognized structured set data back into the app. Existing free-text events are shown without inventing missing weights or duration. In-app corrections regenerate the app-managed event description.
- OAuth configuration and a real-account smoke check remain deployment steps. Automated tests use an isolated Google provider.
- Optional exercise photos or GIFs can be attached per exercise and shown on demand. Assets and sources have not been selected.

## Deployment step

Configure the Google Web OAuth client and the four Netlify environment variables, then verify sign-in and a saved session on the configured site before promoting the redesign to production.
