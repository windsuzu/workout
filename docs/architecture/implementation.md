# FORM implementation

## Data ownership

`workouts.json` seeds the A/B/C plan. After Google sign-in, Netlify Blobs stores that account's defaults: weight, reps, set count, rest duration, bench angle, setup notes, and optional HTTPS image/GIF URL. Each recorded set snapshots its actual weight/reps, rest default, angle, and setup notes. Updating a default does not rewrite those snapshots.

Each browser keeps an IndexedDB cache and pending-operation queue. Guest data and each signed-in account have separate keys. Guest workouts are transferred only through the explicit import action. Account data remains cached on that browser after sign-out to support later offline use of that account; sign-out removes server authentication and starts the app in the separate guest space. Use a trusted browser for personal workout data. Clearing browser site data removes unsynced local work.

The server saves drafts and completed sessions before attempting Google synchronization. Google Calendar is the visible completed-workout history; Netlify Blobs also retains the structured record for later corrections. The offline service worker caches only the public app shell and routine seed, never API responses or Google credentials.

## Authentication

Google authorization-code login uses PKCE, signed expiring state, and a SameSite HttpOnly state cookie. The backend verifies the Google user profile and keeps refresh/access tokens encrypted with AES-GCM using a key derived from `AUTH_SECRET`. The browser gets an opaque HttpOnly session cookie; only its hash is stored server-side. Mutating API requests require the configured origin and JSON content type. All account paths derive from the authenticated Google subject, never a client-supplied user ID.

`AUTH_SECRET` must remain stable between deploys. Expired or revoked Google consent requires reconnecting. This implementation does not store Google tokens in localStorage or IndexedDB.

## Saving and conflicts

Local changes are written to IndexedDB before the queue sends them. Defaults use field-level expected-value checks, so independent changes can merge while conflicting changes require the user's choice. Sessions use revision checks. A conflict can reload the other device's version or preserve the local version as a separate workout.

Server writes use strong reads and Netlify Blobs conditional writes with etags. Unique operation IDs make save retries safe. A per-session synchronization lease serializes Calendar writes and sends a newer revision if an edit arrives during a write. A deterministic Google event ID derived from account and session prevents duplicate inserts. Corrections update the associated event using its etag; they do not create a second event. Pending work retries while the app is open and on reconnection; no background job runs while every device is closed.

If the user selects a different calendar later, new workouts go there and corrections retain the original calendar association. Existing events are not automatically moved by changing this setting.

## Calendar history

History combines the selected dedicated calendar with matching legacy workout events from the primary calendar. The app initially loads the past year plus any locally cached completed workouts, and loads older months when you navigate to them; counts are labeled **Loaded workouts**, not an all-time total. Prototype test events are excluded. Legacy all-day entries count as sessions but contribute no invented duration or per-set weights.

App events contain readable set summaries plus a versioned JSON block and private metadata. Calendar refresh reads dates, durations, and recognized structured set data. Arbitrary manual free-text edits are not interpreted as structured weight corrections. Use the app to correct weights/reps; the next sync regenerates its managed event description. A deleted Calendar event does not delete the retained on-device workout record. Migration uses Google's move operation on selected eligible personal events, preserving event content rather than rebuilding it.

## Boundaries

- Netlify Functions and Blobs are required for account sync; static hosting supports only the shell/local behavior.
- Routines are the existing A/B/C split. This version edits defaults, not the routine's exercise order or names.
- Rest countdown state is local to the current browser; recorded sets and exercise defaults sync across devices. A second device resumes the workout log with an idle timer.
- Exercise media is an optional external HTTPS URL. The app does not upload media or bundle third-party exercise assets.
- Rest elapsed time is based on a timestamp, but browser restrictions prevent a guaranteed alarm while a phone is locked.
- Tests replace Google with an isolated local provider. Live OAuth and Google behavior require deployment configuration and a final real-account smoke check.
