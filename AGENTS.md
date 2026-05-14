# AGENTS.md — pi-wiggum

This file is a **map**, not an encyclopedia. It tells agents where to look.

## Where to Find Things

| What | Where |
|------|-------|
| Architecture & loop design | `ARCHITECTURE.md` |
| Core principles | `docs/design-docs/core-beliefs.md` |
| Active work plans | `docs/exec-plans/active/` |
| Completed work | `docs/exec-plans/completed/` |
| Product specs | `docs/product-specs/` |
| Technical debt | `docs/exec-plans/tech-debt-tracker.md` |
| Reference docs (LLM-friendly) | `docs/references/` |
| Auto-generated artifacts | `docs/generated/` |

## How This Repo Works

This is a **pi-native agentic workflow repository**. All code, documentation, and tooling is produced by pi agents under human direction. Humans steer — agents execute.

The core workflow is the **Wiggum loop**: clarify → plan → implement → review → fix → loop. See `ARCHITECTURE.md` for full details.

### Key Rules for Agents

1. Read `ARCHITECTURE.md` before starting any implementation work.
2. All plans live in `docs/exec-plans/active/<slug>/`. Each plan directory contains:
   - `pm-review.md` — PM review (requirements, gaps, acceptance criteria)
   - `plan.md` — Implementation plan
   - `PROGRESS.md` — Worker progress log with STATUS tag
3. Workers write `PROGRESS.md` with `STATUS: IN_PROGRESS` while working and `STATUS: COMPLETE` when done. Use `BLOCKED: NEEDS_DECISION` when requiring human input.
4. Never ask "should I continue?" — the answer is always yes.
5. Use `gh` CLI for PR management. It is installed and authenticated.
6. Respect the stop-guard extension — it will re-fire you if you stop prematurely.
