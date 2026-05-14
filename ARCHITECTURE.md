# ARCHITECTURE.md — pi-wiggum

## What This Is

pi-wiggum is a pi-native agentic software development workflow. It implements a Ralph Wiggum loop — a self-correcting agent pipeline where agents clarify, plan, implement, review, fix, and iterate until completion. Humans steer. Agents execute. The repository is the system of record.

## The Wiggum Loop

```
/wiggum "build X feature"
  │
  ├─ 1. GATHER     → scout + researcher (parallel, fresh context)
  ├─ 2. CLARIFY    → interview agent via intercom (HARD GATE — human required)
  ├─ 3. PM REVIEW  → workflow.product-manager → pm-review.md
  ├─ 4. SPEC       → workflow.spec-writer → plan.md
  ├─ 5. IMPLEMENT  → worker → PROGRESS.md (stop-guard enforced)
  ├─ 6. REVIEW     → 3× reviewer (parallel, fresh context)
  ├─ 7. FIX        → worker (review synthesis) → loop to 6 if non-trivial
  └─ 8. FINALIZE   → PR via gh, move to completed/, write summary
```

## Workflow Agents

| Agent | Type | Role |
|-------|------|------|
| `scout` | Builtin | Fast codebase recon |
| `researcher` | Builtin | External evidence gathering |
| `interview` | Builtin | Clarifying questions via intercom |
| `workflow.product-manager` | Custom | Requirements review, gap analysis |
| `workflow.spec-writer` | Custom | Implementation plan authoring |
| `worker` | Builtin | Implementation (single writer) |
| `reviewer` | Builtin | Code review (3 angles, fresh context) |

## Continuous Work Enforcement

Three-layer defense against agents stopping mid-work:

1. **Prompt design** — worker prohibited from asking "should I continue?"
2. **Stop-guard extension** — hooks `agent_end`, reads PROGRESS.md, auto-re-fires on IN_PROGRESS (max 3 retries at same checkpoint, then escalate)
3. **Cron safety net** — 15min cron checks for stalled IN_PROGRESS plans, resumes via `pi -p --session`

## Repository Knowledge Structure

```
AGENTS.md                          # Map (this file's companion)
ARCHITECTURE.md                    # This file
docs/
├── design-docs/
│   ├── index.md
│   └── core-beliefs.md
├── exec-plans/
│   ├── active/                    # Current work
│   ├── completed/                 # Done work
│   └── tech-debt-tracker.md
├── product-specs/
├── references/
└── generated/
```

## Dependencies

- pi-subagents — agent orchestration (chains, parallel, intercom, worktrees)
- pi-intercom — agent-to-agent and agent-to-human communication
- gh CLI — PR management (installed, authenticated)
- Cron — background scheduling
