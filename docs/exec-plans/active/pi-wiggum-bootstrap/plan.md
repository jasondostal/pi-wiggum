# Plan: pi-wiggum Bootstrap

## Goal

Build a Ralph Wiggum loop on pi — an autonomous agentic software development workflow where agents clarify, plan, implement, review, fix, and loop until done, with humans kept informed via markdown artifacts in the repository.

## Status

STATUS: READY — awaiting implementation

## Architecture

### The Wiggum Loop

```
/wiggum "build X feature"
  │
  ├─ Phase 1: GATHER CONTEXT
  │   └─ scout + researcher (parallel, fresh context)
  │       scout → codebase map, patterns, relevant files
  │       researcher → external evidence, best practices
  │
  ├─ Phase 2: CLARIFY (HARD GATE — human answers required)
  │   └─ interview agent via intercom
  │       Asks clarifying questions. Blocks until human answers all questions.
  │       Loops if new questions emerge from answers.
  │       Does NOT proceed past this gate until human is satisfied.
  │
  ├─ Phase 3: PM REVIEW
  │   └─ workflow.product-manager (custom agent)
  │       Reads requirements + scout context + product-specs/
  │       Output: docs/exec-plans/active/<slug>/pm-review.md
  │       Identifies gaps, edge cases, missing requirements
  │       Produces: clarified requirements, gap analysis, acceptance criteria, open questions
  │
  ├─ Phase 4: SPEC WRITING
  │   └─ workflow.spec-writer (custom agent)
  │       Reads pm-review.md + ARCHITECTURE.md + design-docs/
  │       Output: docs/exec-plans/active/<slug>/plan.md
  │       Produces: files to touch, order of work, validation steps, rollback plan
  │
  ├─ Phase 5: IMPLEMENT (watchdog enforced)
  │   └─ worker (builtin, forked context)
  │       Reads plan.md, implements, writes PROGRESS.md
  │       Never asks "should I continue?" — the answer is always yes
  │       If blocked on product/arch decision → escalates via intercom
  │       If token-exhausted mid-work → writes STATUS: IN_PROGRESS and stops
  │
  │       → Stop-Guard Extension monitors agent_end:
  │           If PROGRESS.md says IN_PROGRESS and no decision escalation:
  │             → Auto re-fires worker with "Continue from PROGRESS.md"
  │             → Retry counter (max 3) — if stuck at same checkpoint, escalate to human
  │
  ├─ Phase 6: REVIEW
  │   └─ 3× reviewer (parallel, fresh context)
  │       Angle 1: Correctness and regressions
  │       Angle 2: Test coverage and validation quality
  │       Angle 3: Simplicity, maintainability, architecture compliance
  │       Review-only — no edits. Report file:line findings.
  │
  ├─ Phase 7: FIX
  │   └─ worker (forked context)
  │       Parent synthesizes review findings into:
  │         (a) Fixes worth doing now
  │         (b) Optional improvements
  │         (c) Feedback to ignore/defer
  │       Worker applies only (a). Preserves approved scope.
  │       Escalates unapproved product/architecture decisions.
  │
  │       If fixes were non-trivial → loop back to Phase 6
  │
  └─ Phase 8: FINALIZE
      └─ Opens PR via gh CLI
      └─ Moves plan to docs/exec-plans/completed/
      └─ Writes final summary to completed/<slug>/summary.md
```

### Continuous Work Enforcement — Three Layers

**Layer 1: Prompt Design**

Worker system prompt includes hard rules:
- NEVER ask "should I continue?" — the answer is always yes
- Work until COMPLETE or BLOCKED on a human-only decision
- If token-exhausted: write PROGRESS.md with STATUS: IN_PROGRESS, stop. Orchestrator resumes you.
- Only escalate for product/architecture/scope decisions not already approved in the plan.

**Layer 2: Stop-Guard Extension**

A pi extension (`~/.pi/agent/extensions/stop-guard.ts`) hooks `agent_end`:
- Reads active PROGRESS.md
- If STATUS: COMPLETE → nothing
- If BLOCKED: NEEDS_DECISION → surface to human via intercom
- If IN_PROGRESS with no escalation → auto-inject follow-up: "Continue from PROGRESS.md. Do not ask to continue."
- Retry counter via `pi.appendEntry()`: if same checkpoint fires 3+ times without advancing → escalate to human instead

**Layer 3: Cron Safety Net**

```bash
# Every 15 minutes, check for stalled IN_PROGRESS plans
*/15 * * * * cd /path/to/repo && pi -p "Check docs/exec-plans/active/ for any plan with STATUS: IN_PROGRESS in PROGRESS.md. If found, resume implementation from where it left off." --session wiggum-orchestrator
```

This catches crash/OOM/laptop-close scenarios where the extension process is dead.

### Repo Knowledge Structure

```
AGENTS.md                          # ~100 lines, table of contents, map only
ARCHITECTURE.md                    # Domain map, layer rules, the Wiggum loop
docs/
├── design-docs/
│   ├── index.md
│   └── core-beliefs.md            # Agent-first principles
├── exec-plans/
│   ├── active/                    # Current work (one dir per feature)
│   │   └── <slug>/
│   │       ├── pm-review.md
│   │       ├── plan.md
│   │       └── PROGRESS.md
│   ├── completed/
│   │   └── <slug>/
│   │       ├── pm-review.md
│   │       ├── plan.md
│   │       ├── PROGRESS.md
│   │       └── summary.md
│   └── tech-debt-tracker.md
├── product-specs/
│   └── index.md
├── references/                    # LLM-friendly reference docs
└── generated/                     # Auto-generated artifacts (db schemas, etc.)
```

### Deliverables — What Needs to Be Built

#### 1. Custom Agents

| Agent | Package | Role |
|-------|---------|------|
| `workflow.product-manager` | workflow | Reviews requirements, identifies gaps, produces acceptance criteria |
| `workflow.spec-writer` | workflow | Transforms PM-approved reqs into concrete implementation plans |

Both live in `.pi/agents/` (project-local) or `~/.pi/agent/agents/` (global).

#### 2. Prompt Template

`/wiggum` — `.pi/prompts/wiggum.md`

Launches the full loop. Takes a feature description as argument (`$@`). Contains the orchestration instructions for the parent agent: the phase sequence, which agents to launch, output paths, validation rules.

#### 3. Stop-Guard Extension

`~/.pi/agent/extensions/stop-guard.ts`

Hooks `agent_end`, checks PROGRESS.md, re-fires worker on premature stop. Retry counter. Escalation path.

#### 4. Cron Setup

Two cron jobs:
- **Doc gardener**: scans for stale docs, flags issues, opens fix PRs (the first real Wiggum deliverable)
- **Orchestrator safety net**: resumes stalled IN_PROGRESS plans

#### 5. `/wiggum` Bootstrapping

The first Wiggum run builds the doc-gardening agent — a worker that scans `docs/` for drift, compares against actual code behavior, opens fix PRs. This is the meta move: the loop builds its own maintenance tool.

### Dependencies

- `pi-subagents` package (installed) — chain, parallel, intercom, worktree isolation
- `pi-intercom` package (verify installed) — agent-to-agent and agent-to-human communication
- `gh` CLI (installed, authed) — PR management
- Cron access — for background scheduling
- DeepSeek V4 Pro or equivalent capable model

### Open Questions (for Phase 2 Clarify)

- Should the stop-guard extension be global (`~/.pi/agent/extensions/`) or project-local (`.pi/extensions/`)?
- Should agents be global or project-local? Leaning project-local for workflow agents, global for stop-guard.
- Cron scheduling: how aggressive? 15min seems right for safety net, 6hr for doc gardening.
- PR automation: auto-merge on reviewer approval, or always wait for human merge?

### First Deliverable

The Wiggum loop builds its own doc-gardening tool as the first real run. This proves the loop works end-to-end while producing something useful immediately.

The doc-gardening agent:
- Scans `docs/` for staleness (last-modified vs code changes)
- Compares documented behavior against actual code
- Flags drift in `docs/tech-debt-tracker.md`
- Optionally opens fix PRs for clear cases
