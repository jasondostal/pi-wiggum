# Summary: pi-wiggum Bootstrap

## What Was Built

A Ralph Wiggum loop for pi — an autonomous agentic software development workflow. Agents clarify, plan, implement, review, fix, and iterate. Humans steer. The repository is the system of record.

### Deliverables

| Component | Description |
|-----------|-------------|
| `workflow.product-manager` | Custom agent — requirements review, gap analysis, acceptance criteria |
| `workflow.spec-writer` | Custom agent — transforms PM-approved reqs into concrete implementation plans |
| `wiggum.doc-gardener` | Custom agent — scans docs/ for drift/staleness on cron |
| `stop-guard` extension | Pi extension — hooks agent_end, auto-resumes IN_PROGRESS workers (max 3 retries, then escalate) |
| `/wiggum` prompt | 8-phase orchestration template — GATHER → CLARIFY → PM REVIEW → SPEC → IMPLEMENT → REVIEW → FIX → FINALIZE |
| Repo scaffold | docs/design-docs/, docs/exec-plans/, docs/product-specs/, docs/references/, docs/generated/ |
| Cron jobs | Doc gardener (6hr) + orchestrator safety net (15min) |

### Key Decisions Made

- **Agents and prompt are global** (`~/.pi/agent/`) — usable from any project, not coupled to pi-wiggum
- **Doc gardener is standalone cron**, not a Wiggum loop run — too simple to justify the full loop
- **Orchestrator is the interactive session** — resume via Pi's session history, no separate checkpoint file needed
- **Idempotent phases** — each phase checks for existing artifacts before running, safe to resume after interruption
- **No hardcoded model** — agents inherit from active session, user chooses their own LLM

### Review Fixes Applied (Kimi)

- Stop-guard state bug — reads last entry instead of first
- `find` flag order corrected
- Doc-gardener description aligned with hard rules
- `/wiggum` prompt uses real subagent tool syntax, not pseudocode
- Orchestrator resumability via idempotent artifact checks
- Logo 404 removed

### What Was Deferred

- Unit tests for stop-guard — non-critical, extension logic is straightforward
- Interactive-mode stop-guard testing — non-interactive mode verified, extension no-ops gracefully
- First dogfooding run on a real feature — this is the next step, not part of bootstrap

## PR

No PR — this was the foundational repo setup, committed directly to main.
