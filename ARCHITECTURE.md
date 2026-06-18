# ARCHITECTURE.md — pi-wiggum

## What this is

pi-wiggum is a **goal plugin for pi**, modeled on Claude Code's `goal` feature.
You state a goal and pursue it directly; an external LLM evaluator judges your
work against that goal after each stop and re-fires you with a directive until
it's met.

It started as a heavier "Ralph Wiggum" loop with a planning phase (a TPM
conversation, a plan/execution split, worker/reviewer subagents). That was
overbuilt. v0.4.0 strips it to the one idea that carried its weight: **an
independent judge driving the loop toward a goal.**

## The loop

```
/goal "feature"
  │
  ├─ SET GOAL ──────────────────────────────────────────────
  │  Write .wiggum/goal.md: the goal + acceptance criteria.
  │  (This file is the rubric the evaluator judges against.)
  │
  └─ PURSUE  (you are the worker — no planning, no subagents) ─
     Work toward the goal with your tools.

     On every stop, goal-guard calls an EXTERNAL LLM EVALUATOR
     (a different model than you) that judges .wiggum/goal.md
     against your actual git diff + new files, and returns:
        DONE      → archive goal to .wiggum/completed/, stop
        CONTINUE  → re-fire with the evaluator's next directive
        REDIRECT  → re-fire with a corrective directive (drift caught)
        BLOCKED   → write .wiggum/.escalate, stop for the human
```

**The evaluator decides done — not a self-reported "complete".** It verifies
acceptance criteria against the code, so the loop can't be ended by an
optimistic claim.

## Components

| File | Role |
|------|------|
| `extensions/goal-guard.ts` | Hooks `agent_end`. If `.wiggum/goal.md` exists, gathers evidence (goal + `git diff` + untracked file contents), runs the evaluator via a pinned `pi -p` subprocess, and acts on the verdict. No active goal ⇒ no-op. |
| `prompts/judge.md` | The evaluator: rubric-driven instructions + a strict JSON verdict schema `{ state, rationale, evidence[], next_directive, blocker }`. |
| `prompts/goal.md` | The `/goal` command — writes `.wiggum/goal.md` and starts the loop. |

### The evaluator

An **independent LLM judge**, deliberately a *different* model than the one
pursuing the goal (so it brings fresh, skeptical eyes and won't rubber-stamp
its own work).

- **Model:** `WIGGUM_JUDGE_MODEL` (default `xiaomi/mimo-v2.5-pro` — cheap, direct,
  off OpenRouter). The pursuing model should differ from this.
- **Binary:** `WIGGUM_PI_BIN` (default `pi`), invoked as `pi -p -nt --model <judge>`.
- **Prompt path:** `WIGGUM_JUDGE_PROMPT` overrides; otherwise resolved next to the
  extension, then cwd, then `node_modules/pi-wiggum`.
- **Evidence:** `git diff HEAD` **plus the full contents of untracked new files**
  (fresh work is usually new files, which a plain diff misses).

## Loop state (`.wiggum/`)

| File | Meaning |
|------|---------|
| `.wiggum/goal.md` | The active goal + acceptance criteria. Its existence = the loop is on. |
| `.wiggum/.escalate` | Hard block — human intervention required. Stops the loop. |
| `.wiggum/completed/goal-<ts>.md` | Archived goals (written on a DONE verdict). |

There is no other state file. Presence of `.wiggum/goal.md` is the entire state
machine: exists = pursuing; archived/absent = idle.

## Safety backstops

The evaluator is the smart layer. Underneath it, two dumb mechanisms guarantee
the loop always terminates:

1. **`ITER_CAP`** — a hard ceiling on iterations per goal. Wedged judge or not,
   the loop cannot run forever.
2. **Mechanical fallback** — if the evaluator call fails or returns garbage, the
   guard falls back to mtime-stagnation: resume while files change, escalate
   after repeated no-progress stops.

## Dependencies

- pi-coding-agent — the host. No subagents framework required (the pursuing
  agent is the worker; the evaluator is a plain `pi -p` subprocess).
- `gh` CLI — optional, only if you want the loop's output turned into a PR (you
  do that yourself; the loop leaves its work in the tree).
