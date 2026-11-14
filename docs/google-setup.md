# Google sign-in and Netlify setup

The app can record workouts locally without Google configuration. Account sync requires your own Google OAuth client and server configuration on the existing Netlify site. Never put these secret values in source code or client-side environment variables.

## 1. Create the Google OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/), select or create a project, and enable **Google Calendar API**.
2. In **Google Auth Platform**, configure the app branding and audience. For a personal app in Testing mode, add your Google account as a test user.
3. Add the requested scopes under Data Access:
   - `openid`, `email`, `profile`
   - `https://www.googleapis.com/auth/calendar.app.created`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
4. Create an OAuth client of type **Web application**. Add this exact authorized redirect URI, replacing the origin with your Netlify/custom domain:

   ```text
   https://your-site.netlify.app/api/auth/callback
   ```

   For local development, also add `http://localhost:3000/api/auth/callback` (or create a separate development client).
5. Copy the client ID and secret into Netlify's environment variable settings. Do not paste the secret into a chat, commit it, or put it in `workouts.json`.

The app uses a server-side authorization-code flow with PKCE. The Calendar scopes let it create an app calendar, save/correct workouts, read your workout history, and move selected old workout events. No calendar is created and no old event is moved merely by signing in.

## 2. Configure Netlify

Use Node.js 22 or newer. The repository's `netlify.toml` provides the build and Functions settings. Ensure the Netlify site supports Functions and Netlify Blobs, then add these server environment variables in **Project configuration → Environment variables**, with Functions runtime access:

| Variable | Value |
| --- | --- |
| `APP_URL` | The exact public origin, e.g. `https://your-site.netlify.app`, with no path or trailing slash |
| `GOOGLE_CLIENT_ID` | Google Web application client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `AUTH_SECRET` | A private random secret, at least 32 characters |

Generate `AUTH_SECRET` locally, for example with `openssl rand -hex 32`. Keep it stable: it encrypts stored Google tokens and signs OAuth state. Changing it requires users to reconnect Google. Do not prefix secrets with a frontend build-variable prefix.

Configure these values for the **production** deploy context. Deploy previews can exercise local tracking without Google credentials. To test real Google sync before production, use a separate Netlify staging site, OAuth client, and stable staging origin. Named Blobs stores are site-wide, so a separate site keeps staging account data independent.

Deploy the implementation branch through a preview or merge it when ready; an unmerged pull request does not change the production site. The backend uses Netlify's automatic Blobs credentials, so no separate database password is needed.

## 3. First connected use

1. Sign in with Google from Account & sync.
2. If you recorded local workouts first, choose **Bring local workouts into this account** to transfer them and their exercise defaults explicitly.
3. Choose **Create Workouts calendar**, or select an existing non-primary calendar that you own.
4. Complete a set and finish the workout in the app. Wait for **Saved to your Google Calendar**. No Google Calendar page needs to open.
5. On another device, sign into the same account to load exercise defaults, unfinished workouts, and Calendar history.
6. To move old workouts, preview a date range, select the entries, then choose **Move selected workouts**. Unselected events remain in the main calendar. Events with guests or recurring instances are excluded.

## Local Google development

Copy `.env.example` to `.env.local`, fill it with development values, and use the same localhost origin in `APP_URL`, the browser, and the Google redirect URI. `npm run dev` stores development data in ignored `.local-data/`; production uses Netlify Blobs. The dev server binds to the local machine and is not a production server.

## Troubleshooting

- **Google sign-in is not configured:** check all four variables, their deploy context, and Functions access, then redeploy.
- **redirect_uri_mismatch:** the Google redirect must exactly match `APP_URL` plus `/api/auth/callback`, including protocol and port. Use the configured domain to open the app.
- **Access blocked:** add the account as an OAuth test user and confirm the Calendar API and scopes are enabled. Broader public use may require Google verification.
- **Reconnect Google:** consent may have been revoked or a refresh token expired. Google apps in external Testing mode commonly issue Calendar refresh tokens that expire after seven days; reconnect or configure the appropriate production publishing/verification status.
- **Sync pending:** keep the app open and reconnect/retry. Completed records are saved before Calendar is contacted. Choose the workout calendar if setup is still pending.
- **Already open in another tab:** close the other tab for this account, then reload. Each browser profile permits one writer per account so offline progress cannot be overwritten by a stale tab.
- **Account changed:** another tab changed the Google session. Reload to enter that account; pending work stays in its original account's device cache.
- **Offline timer sound:** sound starts after the first interaction. Mobile browsers can suspend sound and timers when the device is locked or the app is backgrounded; elapsed rest is recalculated on return, but background alarms are not guaranteed.
