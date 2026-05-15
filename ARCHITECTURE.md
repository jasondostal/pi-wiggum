# ARCHITECTURE.md — pi-wiggum

## What This Is

pi-wiggum is a pi-native agentic software development workflow. It implements a Ralph Wiggum loop — a self-correcting agent pipeline where the orchestrator clarifies with the human, then plans, implements, reviews, fixes, and iterates until completion. Humans steer at named gates. Agents execute everything else. The repository is the system of record.

The loop is **clarify-first**: every `/wiggum` invocation starts with a hard gate where the orchestrator asks 1–3 questions and confirms a plan slug before any subagent runs. No work begins on assumptions.

## The Wiggum Loop (v2 — clarify-first)

```
/wiggum "build X feature"
  │
  ├─ 0. CLARIFY    → orchestrator asks 1–3 questions + slug (HARD GATE — human required)
  │                 ├─ Step 0a: detect existing active plans → resume vs new
  │                 ├─ Step 0b: clarifying questions
  │                 ├─ Step 0c: always ask for slug
  │                 └─ Step 0d: decide if GATHER is needed
  │
  ├─ 1. GATHER     → scout + researcher (parallel, fresh context) — CONDITIONAL
  ├─ 2. SYNTHESIZE → context-share to human, then auto-proceed (info-only, no gate)
  ├─ 3. PM REVIEW  → workflow.product-manager → pm-review.md
  │                 (CLARIFY recommendation archives stale review and routes to Phase 0)
  ├─ 4. SPEC       → workflow.spec-writer → plan.md (plan-approval gate)
  ├─ 5. IMPLEMENT  → worker → PROGRESS.md (stop-guard enforced)
  ├─ 6. REVIEW     → 3× reviewer (parallel, fresh context)
  ├─ 7. FIX        → worker (review synthesis) → loop to 6 if non-trivial
  └─ 8. FINALIZE   → PR via gh, move to completed/, write summary
```

**Human gates:** Phase 0 (clarify), Phase 4 (plan approval), and any escalation via stop-guard (3 retries at same checkpoint) or worker BLOCKED status. Phase 2 SYNTHESIZE is info-only and auto-proceeds.

## Workflow Agents

| Agent | Type | Role |
|-------|------|------|
| `scout` | Builtin | Fast codebase recon |
| `researcher` | Builtin | External evidence gathering |
| `workflow.product-manager` | Custom | Requirements review, gap analysis |
| `workflow.spec-writer` | Custom | Implementation plan authoring |
| `worker` | Builtin | Implementation (single writer) |
| `reviewer` | Builtin | Code review (3 angles, fresh context) |

> **Note:** The `interview` builtin agent is available in `pi-subagents` but is NOT used by the default Wiggum loop. Phase 0 clarification is done by the orchestrator directly. The agent remains available for custom workflows.

## Continuous Work Enforcement

Three-layer defense against agents stopping mid-work, applied at both worker and orchestrator scope:

1. **Prompt design**
   - Worker is prohibited from asking "should I continue?"
   - Orchestrator is prohibited from asking "what next?" between phases — explicit autonomous-orchestrator rule at the top of `prompts/wiggum.md`.
2. **Stop-guard extension** — hooks `agent_end`, two layers:
   - **Worker layer:** reads `PROGRESS.md`, auto-re-fires on `STATUS: IN_PROGRESS` (max 3 retries at same checkpoint, then escalate).
   - **Orchestrator layer:** reads `LOOP.md`, auto-re-fires the orchestrator on `STATUS: ACTIVE` (max 3 retries at same phase, then escalate). `AWAITING_HUMAN` / `BLOCKED` / `COMPLETE` are no-ops. Worker resume takes priority when both would fire.
3. **Cron safety net** — 15min cron checks for stalled IN_PROGRESS plans, resumes via `pi -p --session`

## Loop State Files

| File | Scope | Writer | Read by |
|------|-------|--------|---------|
| `docs/exec-plans/active/<slug>/LOOP.md` | Orchestrator-level phase state | Orchestrator (every turn boundary) | Stop-guard orchestrator layer |
| `docs/exec-plans/active/<slug>/PROGRESS.md` | Worker-level implementation state | Worker (Phase 5) | Stop-guard worker layer |

Both files use a `STATUS:` header so the stop-guard parses them uniformly. See `prompts/wiggum.md` for the LOOP.md schema and update-checklist table.

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
