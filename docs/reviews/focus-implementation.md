# Focus implementation review

The initial implementation received three independent reviews, each starting without inherited conversation context. The reviewers inspected the full change against the previous app and focused on simplicity, correctness, and security. All three requested changes. They separately approved restoring the prior app while review proceeded; rollback PR #2 restored that baseline without deleting stored workout data.

## Findings and remedies

| Finding | Remedy | Regression coverage |
| --- | --- | --- |
| Account cookie switches could upload an old tab's queue into the new account. | Require the expected account on protected API routes; stop sync on identity changes. | Controller and API tests cover reconnect and a switch during an active flush. |
| Stale offline tabs could overwrite each other's IndexedDB snapshots. | Hold a Web Lock for the account while its document is open; a second writer must reload after the first closes. | Browser test checks blocked second tab and safe handoff with saved state. |
| Repeated future-only settings edits reset unchanged defaults. | Load future defaults for completed workouts and submit only fields actually changed. | Browser test covers successive future edits and today/future divergence. |
| Successful corrections exposed stale Calendar history in the cache. | Replace the matching cached row on sync acknowledgement. | Controller test verifies corrected history after going offline. |
| Undo of a completed workout's final set created an invalid queue entry. | Reject the final undo before modifying the saved workout. | Domain test keeps a valid completed record. |
| Same-date sessions were ordered by insertion rather than time. | Share descending timestamp ordering between server and client history. | Chronology test distinguishes morning and evening workouts. |
| Pausing just after rest expiry could leave a zero-second paused timer stuck. | Normalize elapsed rest to ready. | Controller test completes the next set after this boundary. |
| Migration could move a recurring series converted after preview. | Reject masters with recurrence as well as recurring instances at preview and move time. | API test verifies neither series nor instances reach Google's move endpoint. |

The revised implementation must pass the automated checks and independent re-review before it is merged. Live Google authentication remains a final account-owner check after deployment; automated tests use an isolated provider and never mutate the real calendar.
