---
description: Launch the full Wiggum loop — clarify, plan, implement, review, fix
argument-hint: "<feature description>"
---

You are orchestrating the Ralph Wiggum loop — an autonomous agentic dev workflow for $@.

## Phase Sequence

Run these phases in order. Each phase must complete before the next begins.

**Before starting each phase, check for existing artifacts from that phase.** If a phase's expected output already exists and is valid, skip that phase and proceed. This makes the loop idempotent — safe to resume after session interruption.

### Phase 0: CLARIFY (HARD GATE)

**Purpose:** Ground the human's request BEFORE any agents run. The orchestrator (you) does a quick back-and-forth to understand what the human actually wants.

**Rules:**
- Ask 1–3 targeted questions. Do NOT launch scout, researcher, or any other agent yet.
- If the human already has a complete plan or spec written, ask for the **plan slug** (e.g., `add-dark-mode`) and confirm which phase to start from.
- If the request is vague, ask what outcome they want, what constraints exist, and what "done" looks like.
- Do NOT proceed past this gate until the human has answered and is satisfied.

**Conditional GATHER decision:** After clarification, decide if GATHER is needed:
- If the human provided a complete spec/plan → skip Phase 1, jump to Phase 3 (PM REVIEW) or Phase 4 (SPEC).
- If the human needs codebase exploration or external research to proceed → run Phase 1.
- If you're unsure → ask the human: "Do you want me to scout the codebase and research this, or do you have enough context to plan directly?"

### Phase 1: GATHER (CONDITIONAL)

**Skip check:** If `docs/exec-plans/active/<slug>/` already exists with a `pm-review.md` or `plan.md`, the user has likely already started this feature. Ask if they want to resume or start fresh. If resume, jump to the appropriate phase based on which artifacts exist.

**Skip check:** If Phase 0 revealed the human already has full context (complete spec, no research needed), skip to Phase 3.

If not skipping, launch `scout` and `researcher` in parallel (fresh context). Use the `subagent` tool in PARALLEL mode:

```
subagent({
  tasks: [
    {
      agent: "scout",
      task: "Explore the codebase for context on: $@\n\nMap relevant files, patterns, existing tests, and integration points. Output a concise context brief with file paths."
    },
    {
      agent: "researcher",
      task: "Research best practices, relevant docs, and prior art for: $@\n\nFocus on concrete evidence — official docs, spec behavior, known patterns. Provide source links and confidence levels."
    }
  ],
  concurrency: 2,
  context: "fresh"
})
```

### Phase 2: SYNTHESIZE (POST-GATHER)

**Skip check:** If Phase 1 was skipped (human had full context), skip to Phase 3.

Synthesize the GATHER findings into a concise context brief. Present to the human:
- What the scout found (relevant files, patterns, integration points)
- What the researcher found (best practices, prior art, source links)
- Any gaps or contradictions between the two

This is a lightweight synthesis — do NOT write a full plan. The PM and spec-writer handle that.

### Phase 3: PM REVIEW

**Skip check:** If `docs/exec-plans/active/<slug>/pm-review.md` exists and contains a clear Recommendation (GO, CLARIFY, or RETHINK), read it and act on that recommendation. Do NOT re-run the PM agent.

If skipping: read the file, present the recommendation to the user. If GO, proceed to Phase 4. If CLARIFY, go back to Phase 0. If RETHINK, surface concerns and stop.

If not skipping, launch the `workflow.product-manager` agent (fresh context). Use the `subagent` tool in SINGLE mode:

```
subagent({
  agent: "workflow.product-manager",
  task: "Review requirements for: $@\n\nClarified requirements (from Phase 0):\n<insert clarification answers>\n\nSlug: <slug>\n\nOutput: docs/exec-plans/active/<slug>/pm-review.md\n\nRead ARCHITECTURE.md and docs/design-docs/core-beliefs.md for project constraints. Scout relevant code areas to ground your review in reality."
})
```

### Phase 4: SPEC

**Skip check:** If `docs/exec-plans/active/<slug>/plan.md` exists and the user has already approved it (visible in conversation history), proceed to Phase 5.

If skipping: present a brief summary of the plan to confirm, then proceed to Phase 5.

If not skipping, launch the `workflow.spec-writer` agent (fresh context). Use the `subagent` tool in SINGLE mode:

```
subagent({
  agent: "workflow.spec-writer",
  task: "Write implementation plan for: $@\n\nSlug: <slug>\n\nRead docs/exec-plans/active/<slug>/pm-review.md for approved requirements.\nRead ARCHITECTURE.md and design-docs/ for architecture constraints.\nOutput: docs/exec-plans/active/<slug>/plan.md"
})
```

Read the resulting plan. Present a brief summary to the human. If the human approves, proceed. If not, loop on feedback.

### Phase 5: IMPLEMENT

**Skip check:** If `docs/exec-plans/active/<slug>/PROGRESS.md` exists, the stop-guard extension handles worker resumption. Let it run. Do NOT launch a new worker unless the file is missing or says `STATUS: COMPLETE`.

If skipping: Check PROGRESS.md status. If COMPLETE, proceed to Phase 6. If IN_PROGRESS, the stop-guard will resume the worker automatically — wait for it. If BLOCKED, surface the block to the user.

If not skipping, launch the `worker` agent (forked context). Use the `subagent` tool in SINGLE mode:

```
subagent({
  agent: "worker",
  task: "Implement the approved plan.\n\nPlan: docs/exec-plans/active/<slug>/plan.md\n\nSlug: <slug>\n\nCreate docs/exec-plans/active/<slug>/PROGRESS.md before starting.\n\nRules:\n- NEVER ask 'should I continue?' — the answer is always yes\n- Write PROGRESS.md with STATUS: IN_PROGRESS and current checkpoint\n- Update PROGRESS.md after each logical unit of work\n- Set STATUS: COMPLETE when done\n- If blocked on product/architecture decision, write STATUS: BLOCKED: NEEDS_DECISION with the question\n- If token-exhausted: write STATUS: IN_PROGRESS, update checkpoint, stop"
})
```

The stop-guard extension will auto-resume if the worker stops prematurely. Let it run until COMPLETE or BLOCKED.

### Phase 6: REVIEW

**Skip check:** If you have already synthesized review findings and the user has approved/disapproved the fix list (visible in conversation history), proceed based on that decision.

If skipping: If fixes were approved and applied, proceed to Phase 7 or loop back to Phase 6 for re-review. If no fixes needed, proceed to Phase 8.

If not skipping, launch 3× `reviewer` agents in parallel (fresh context). Use the `subagent` tool in PARALLEL mode:

```
subagent({
  tasks: [
    {
      agent: "reviewer",
      task: "Review ALL changes from the implementation of: $@\n\nAngle: Correctness and regressions.\nInspect changed files directly via git diff or file reads.\nReport each finding with file:line and severity. Review only — no edits.",
      output: false
    },
    {
      agent: "reviewer",
      task: "Review ALL changes from the implementation of: $@\n\nAngle: Test coverage and validation quality.\nInspect changed files directly. Are tests adequate? Are edge cases covered? Is validation sufficient?\nReport each finding with file:line and severity. Review only — no edits.",
      output: false
    },
    {
      agent: "reviewer",
      task: "Review ALL changes from the implementation of: $@\n\nAngle: Simplicity, maintainability, and architecture compliance.\nInspect changed files directly. Is this the simplest solution? Does it follow project patterns?\nReport each finding with file:line and severity. Review only — no edits.",
      output: false
    }
  ],
  concurrency: 3,
  context: "fresh"
})
```

### Phase 7: SYNTHESIZE & FIX

Read all review findings. Categorize into:
- **(a) Fixes worth doing now** — bugs, regressions, test gaps, architecture violations
- **(b) Optional improvements** — style, naming, minor refactors
- **(c) Feedback to ignore/defer** — out of scope, stylistic disagreement

If (a) is non-empty and you have not already launched a fix worker for this review round, launch worker for fixes. Use the `subagent` tool in SINGLE mode:

```
subagent({
  agent: "worker",
  task: "Apply reviewer fixes for: $@\n\nSlug: <slug>\nPlan: docs/exec-plans/active/<slug>/plan.md\n\nApply only the following fixes (category (a)):\n<insert fixes>\n\nDo NOT apply optional improvements (b) or expand scope beyond the approved plan."
})
```

If fixes were applied and this is the first fix round, loop back to Phase 6 for re-review. If this is the second or later fix round, proceed to Phase 8 to avoid infinite loops.

### Phase 8: FINALIZE

**Skip check:** If `docs/exec-plans/completed/<slug>/summary.md` exists, the feature is already finalized. Report completion to the user and stop.

If not skipping:

1. If this is a git repo, open a PR via `gh pr create`
2. Move the plan directory: `mv docs/exec-plans/active/<slug> docs/exec-plans/completed/<slug>`
3. Write `docs/exec-plans/completed/<slug>/summary.md` with:
   - What was built
   - Key decisions made
   - What was deferred
   - Link to PR

## Phase Gate Contract

- NEVER skip Phase 0 (clarify). This is a hard gate.
- If PM review surfaces new questions, go back to Phase 0.
- If review finds issues requiring human judgment, pause and ask via intercom.
- After Phase 8, report: what shipped, what was deferred, PR link if applicable.

## Stop-Guard Awareness

The stop-guard extension auto-resumes workers that stop with IN_PROGRESS. This is normal — let it happen. Only intervene if a plan escalates to human (3+ retries at same checkpoint).
