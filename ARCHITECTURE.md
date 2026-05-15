# ARCHITECTURE.md — pi-wiggum

## What This Is

pi-wiggum is a pi-native agentic software development workflow. The human has one substantive conversation upfront with a Technical Product Manager (the lead orchestrator LLM); the loop then executes autonomously to a finished PR. The repository is the system of record.

The design principle is **front-load humans, then walk away**. The TPM conversation is the only human gate. After plan handoff, the loop has no checkpoints — the orchestrator is forbidden from asking "what next?" and the stop-guard re-fires it on every stop until completion.

## The Wiggum Loop (v0.2.0 — plan/execution split)

```
/wiggum "feature"
  │
  ├─ PLAN MODE  (human engaged) ─────────────────────────────────
  │  TPM has open conversation with human.
  │  Allowed: Read tools, scout + researcher subagents,
  │           read-only bash, conversation.
  │  Blocked: code edits, mutating bash, all other subagents
  │           (enforced by plan-mode-guard extension).
  │  Conversation ends when human signals approval, TPM presents
  │  final plan, human confirms once more, TPM writes plan.md.
  │
  ├─ TRANSITION  (plan.md written) ──────────────────────────────
  │  Plan mode ends. Execution mode begins. Human walks away.
  │
  └─ EXECUTION MODE  (autonomous, no gates) ─────────────────────
     A. IMPLEMENT  — worker subagent, PROGRESS.md tracked
     B. REVIEW     — 3× reviewer subagents in parallel (fresh ctx)
     C. FIX        — worker applies category-(a) findings, loop to B once
     D. FINALIZE   — gh pr create, move to completed/, summary.md
```

**The only legitimate stops in execution mode:**

- `docs/exec-plans/active/<slug>/.escalate` — orchestrator or worker wrote a hard-block reason
- `PROGRESS.md` `STATUS: BLOCKED:` — worker hit something the plan does not cover
- Loop complete (moved to `completed/`)

Every other stop gets re-fired by the stop-guard.

## Extensions

| Extension | Role |
|-----------|------|
| `extensions/stop-guard.ts` | Re-fires orchestrator and worker on stop. Plan mode suspends orchestrator re-firing entirely — TPM conversation is sacred. Worker layer (PROGRESS.md) is independent. Auto-escalates after 3 consecutive resumes with no mtime advance in the plan dir. |
| `extensions/plan-mode-guard.ts` | Hooks `tool_call`. During plan mode (any active slug without plan.md), blocks code edits outside `docs/exec-plans/`, blocks mutating bash, blocks all subagents except researcher/scout. Returns to no-op once every active slug has plan.md. |

## Loop State Files

| File | Scope | Writer | Read by |
|------|-------|--------|---------|
| `docs/exec-plans/active/<slug>/plan.md` | The contract. Plan exists ⇒ execution mode is on. | TPM (at handoff) | Worker, reviewers, stop-guard, plan-mode-guard |
| `docs/exec-plans/active/<slug>/PROGRESS.md` | Worker implementation state | Worker | Stop-guard worker layer |
| `docs/exec-plans/active/<slug>/.escalate` | Hard block — human intervention required | Worker, orchestrator, or stop-guard (auto-stagnation) | Stop-guard |
| `docs/exec-plans/completed/<slug>/summary.md` | Final loop output | Orchestrator (Phase D) | Humans |

There is **no orchestrator-level state file** (no LOOP.md). The plan dir itself is the state machine: dir exists + no plan.md = plan mode; plan.md exists = execution mode; dir moved to `completed/` = done.

## Workflow Agents

| Agent | Type | Used by loop | Role |
|-------|------|--------------|------|
| `scout` | Builtin | Plan mode | Fast codebase recon, returns summary |
| `researcher` | Builtin | Plan mode | External evidence (docs, prior art) |
| `worker` | Builtin | Execution Phase A & C | Implementation (single writer) |
| `reviewer` | Builtin | Execution Phase B | Code review (3 angles, fresh context) |
| `workflow.product-manager` | Custom | Not used (legacy from v0.1.x) | Available for manual invocation |
| `workflow.spec-writer` | Custom | Not used (legacy from v0.1.x) | Available for manual invocation |
| `wiggum.doc-gardener` | Custom | Not used (independent) | Documentation upkeep |

## Repository Knowledge Structure

```
AGENTS.md                          # Map
ARCHITECTURE.md                    # This file
docs/
├── design-docs/
├── exec-plans/
│   ├── active/<slug>/             # In flight (plan or execution)
│   ├── completed/<slug>/          # Done
│   └── tech-debt-tracker.md
├── product-specs/
├── references/
└── generated/
```

## Dependencies

- pi-subagents — agent orchestration (chains, parallel, intercom, worktrees)
- pi-intercom — agent-to-agent and agent-to-human communication
- gh CLI — PR management (installed, authenticated)

## Migration notes (from v0.1.x)

- `LOOP.md` is gone. The orchestrator no longer tracks its own state in a file.
- Phase 0 clarify gate is replaced by open TPM conversation (no turn cap).
- Phase 3 PM review and Phase 4 spec are folded into TPM mode (the TPM is the PM and writes the plan itself).
- Phase 4 plan-approval gate is folded into TPM mode (approval is intrinsic to ending the conversation).
- Plan-mode tool restrictions are hard-enforced by the plan-mode-guard extension, not just by prompt.
- Execution mode (Phases A–D, formerly 5–8) has no human gates and no STATUS field — the stop-guard fires on every stop unless `.escalate` or `PROGRESS BLOCKED` is set.
