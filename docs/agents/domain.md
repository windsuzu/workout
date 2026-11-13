# Domain docs

## Layout

This is a single-context repository:

- `GLOSSARY.md` at the repo root defines shared domain terms.
- `docs/adr/` stores architecture decision records.

## Before exploring

Read the glossary and any ADRs relevant to the area being changed.
If these files do not exist, proceed silently. Do not suggest creating them up front.
The domain-modeling skill creates them when terms or decisions are resolved.

## Vocabulary and decisions

Use the glossary's terms consistently in code, tickets, and explanations.
If a concept is missing, reconsider invented terminology or note the gap for domain modeling.
If a proposed change conflicts with an ADR, explicitly identify the ADR and explain why it should be revisited.
