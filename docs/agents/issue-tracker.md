# Issue tracker: GitHub

Issues and specs live in GitHub Issues at `windsuzu/workout`.
Use the `gh` CLI from this repository, explicitly targeting `--repo windsuzu/workout` when outside it.
Verify `gh repo view --json nameWithOwner` before creating issues; never create this project's tickets in `mattpocock/skills`.

## Conventions

- Create: `gh issue create --repo windsuzu/workout --title "..." --body-file <file>`. Use a UTF-8 file with actual newlines for multiline bodies.
- Read: `gh issue view <number> --repo windsuzu/workout --json number,title,body,labels,comments`.
- List: `gh issue list --repo windsuzu/workout --state open --json number,title,body,labels`, adding label filters as needed.
- Comment: `gh issue comment <number> --repo windsuzu/workout --body-file <file>`.
- Apply or remove labels: `gh issue edit <number> --repo windsuzu/workout --add-label "..."` / `--remove-label "..."`.
- Close: post an explanation first, then `gh issue close <number> --repo windsuzu/workout`. Comment separately on already-closed issues.
- Sub-issues: use GitHub's native parent/sub-issue relationships where available. Otherwise, put `Part of #<parent>` in the child body and a task list in the parent.
- Blocking: use GitHub's native issue dependencies where available. Otherwise, put `Blocked by: #<number>` at the top of the child body. A ticket is unblocked when all blockers are closed.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill operations

- "Publish to the issue tracker": create a GitHub issue.
- "Fetch the relevant ticket": read the GitHub issue and comments.

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, containing Notes, Decisions-so-far, and Fog.
- Children: issues linked as sub-issues, labelled `wayfinder:<type>` (`research`, `prototype`, `grilling`, or `task`). Use the parent/task-list fallback above if necessary.
- Frontier: open children with no open blockers and no assignee; choose the first in map order.
- Claim: assign the ticket to the driving developer (`gh issue edit <number> --repo windsuzu/workout --add-assignee @me` for the authenticated developer).
- Resolve: post the answer, close the ticket, then append a summary and link to the map's Decisions-so-far.
