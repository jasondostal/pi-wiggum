# AGENTS.md — pi-wiggum

This file is a **map**, not an encyclopedia. It tells agents where to look.

## Where to Find Things

| What | Where |
|------|-------|
| Architecture & loop design | `ARCHITECTURE.md` |
| Core principles | `docs/design-docs/core-beliefs.md` |
| Active work plans | `docs/exec-plans/active/<slug>/` |
| Completed work | `docs/exec-plans/completed/<slug>/` |
| Product specs | `docs/product-specs/` |
| Technical debt | `docs/exec-plans/tech-debt-tracker.md` |
| Reference docs (LLM-friendly) | `docs/references/` |
| Auto-generated artifacts | `docs/generated/` |

## How This Repo Works

This is a **pi-native agentic workflow repository**. All code, documentation, and tooling is produced by pi agents under human direction. The human has one substantive gate (the TPM conversation); agents execute everything after autonomously.

The core workflow is the **Wiggum loop** (v0.2.0+): TPM conversation → plan handoff → autonomous execution → PR. See `ARCHITECTURE.md` for full details.

### Key Rules for Agents

1. Read `ARCHITECTURE.md` before starting any implementation work.
2. Each plan dir under `docs/exec-plans/active/<slug>/` contains:
   - `plan.md` — the approved plan (its existence triggers execution mode)
   - `PROGRESS.md` — worker progress log with STATUS tag
   - `.escalate` (when present) — hard block; human intervention required
3. Workers write `PROGRESS.md` with `STATUS: IN_PROGRESS` while working and `STATUS: COMPLETE` when done. Use `BLOCKED: NEEDS_DECISION` only for true hard blocks the plan does not cover.
4. **Never ask "should I continue?"** — the answer is always yes. The stop-guard will re-fire you on every stop.
5. **Plan mode is sacred.** While a slug exists without `plan.md`, code edits and execution-flavored subagents are hard-blocked by the plan-mode-guard extension. Don't try to work around it.
6. Use `gh` CLI for PR management. It is installed and authenticated.
