# Per-set weight and reps

Pair ledger is the chosen design for issue #14 / PR #11. Both set rows stay visible with their own weight and reps. Last time compares each row with the matching set from the most recent workout that recorded this exercise. A missing slot stays “Not recorded”; it is never replaced with another set or an older workout's value. Different units are not directly compared. Exercise progress lists actual recorded pairs by workout and set, without treating unfinished drafts as results.

Completing a set in a live workout remembers that pair for the next workout. Editing an unfinished slot does not change its future target. Correcting a live recorded set updates its remembered pair only if a newer default has not superseded it. Undo restores only that set's preceding remembered pair under the same guard. Corrections to already saved workouts change the historical record, keeping future targets separate.

Existing single weight/reps preferences remain the fallback for slots without remembered pairs. No existing logs are rewritten. The settings dialog explicitly labels weight/reps changes as applying to all sets. Each future slot syncs with its own expected-value guard so edits to different slots can merge; stale same-slot or bulk edits require a conflict choice. A removed future slot cannot invalidate an existing workout's recorded sets. Choosing this device's defaults explicitly restores the required future slots.

The plan queue, session log and undo metadata persist together on the device before synchronization. Account isolation, explicit guest import, offline retries and Calendar idempotency remain in use. New workouts start from the remembered per-set pairs; a freshly signed-in device reads those same targets from the account.

The three throwaway variants are preserved outside master on `archive/per-set-slots-prototype` at commit `c12591cc949d047265902e495947215fafc3288c`. The user selected Pair ledger on 2026-11-18. Production contains the selected design and its validation, without the prototype server or switcher.
