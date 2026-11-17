# Per-set targets: throwaway prototype

Question: which Focus layout makes two individually remembered weight/reps pairs, last-session comparison and exercise progress easiest to use?

Three structural variants share the same FORM Focus context: Pair ledger (both editable rows and inline previous values), Focus set (one large active pair with two set selectors), Compare grid (last time beside today for each set). Keep Graphite, A/B/C accents, Peek exercise navigation with setup angle, and the integrated complete/rest action.

The confirmed scope is two sets × (weight + reps), not four sets. Completing a set remembers only that set's weight/reps for the next workout. Merely editing an unfinished set does not change future defaults. Each logged set captures a snapshot; Undo restores that set's preceding remembered pair, without changing the other set. Last time and progress compare matching set numbers, and history shows recorded values only. A next-workout preview demonstrates carryover without writing any real user data.

Status: prototype only, awaiting the user's layout choice. No production model or layout changes are authorized by this prototype. This draft must not merge to master. Preserve the prototype branch as the primary source, record the chosen design on its paired implementation issue, then rewrite the chosen behavior with production validation and the three required independent reviews.

## Open the draft

Run `npm run prototype:sets`, then open `http://localhost:3001/?variant=ledger`. Change `variant` to `focus` or `compare`, or use the floating switcher. All three designs live on the existing root Focus route in a local-only stub. The normal build ignores prototype files; `NODE_ENV=production` refuses the prototype server. No real account, Calendar, network API, browser storage or service worker is used. State lives in memory; the conversation preview may retain scratch selections through its host.

Try different values in both sets; complete one; open “Remembered for next time”; finish and preview the next workout. Only the completed pair should carry over. Undo affects only its matching pair. Pending decision: pick Pair ledger, Focus set or Compare grid, or request a combination.
