# AGENTS.md — pi-wiggum

This file is a **map**, not an encyclopedia.

## What this is

pi-wiggum is a **goal plugin for pi**, modeled on Claude Code's `goal` feature.
You set a goal; you pursue it directly; an external LLM evaluator (a different
model) judges your work after each stop and re-fires you with a directive until
the goal is met. No planning phase, no subagents.

## Where to find things

| What | Where |
|------|-------|
| Architecture & loop design | `ARCHITECTURE.md` |
| The goal loop (extension) | `extensions/goal-guard.ts` |
| The evaluator prompt (rubric + verdict schema) | `prompts/judge.md` |
| The `/goal` command | `prompts/goal.md` |
| Core principles | `docs/design-docs/core-beliefs.md` |
| History (v0.1–0.3 bootstrap) | `docs/exec-plans/completed/` |

## How the loop works

1. `/goal "<goal>"` → you write `.wiggum/goal.md` (goal + **acceptance criteria**).
2. You work toward it directly with your tools. Never ask "should I continue?".
3. On each stop, `goal-guard` runs the evaluator (`prompts/judge.md`) against
   `.wiggum/goal.md` + your actual `git diff` + new files, and acts on the verdict:
   - **CONTINUE / REDIRECT** → re-fires you with a `NEXT DIRECTIVE`.
   - **DONE** → archives the goal to `.wiggum/completed/`; loop ends.
   - **BLOCKED** → writes `.wiggum/.escalate`; loop stops for the human.
4. Backstops: a hard iteration cap, and a mechanical mtime fallback if the
   evaluator is unavailable. These only guarantee termination.

The evaluator decides done — not a self-reported "complete". Write sharp,
checkable acceptance criteria; the loop is only as good as the goal.
