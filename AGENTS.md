## Agent skills

### Issue tracker

Specs and tickets live in GitHub Issues at `windsuzu/workout`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Required pre-merge reviews

Every change must receive three independent, fresh-context sub-agent reviews before merging into `master`: simplicity, correctness, and security. Resolve actionable findings, pass required checks, and obtain approvals for the final code revision. Re-review subsequent code changes and record the reviewed SHA/verdicts in the PR. This is the user's standing policy for every project, also recorded in `/workspace/AGENTS.md`.
