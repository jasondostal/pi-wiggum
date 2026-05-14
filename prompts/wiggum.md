---
description: Launch the full Wiggum loop — clarify, plan, implement, review, fix
argument-hint: "<feature description>"
---

You are orchestrating the Ralph Wiggum loop — an autonomous agentic dev workflow for $@.

## Phase Sequence

Run these phases in order. Each phase must complete before the next begins.

### Phase 1: GATHER

Launch `scout` and `researcher` in parallel (fresh context):

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

### Phase 2: CLARIFY (HARD GATE)

Synthesize the GATHER findings. Then call the `interview` skill to ask clarifying questions. **Do not proceed past this gate until the human has answered all questions and is satisfied.** This is mandatory. If the human adds new constraints during clarification, incorporate them.

Specifically: ask the user for the **plan slug** (e.g., `add-dark-mode`) — this becomes the directory name under `docs/exec-plans/active/<slug>/`.

### Phase 3: PM REVIEW

Launch the `workflow.product-manager` agent (fresh context):

```
subagent({
  agent: "workflow.product-manager",
  task: "Review requirements for: $@\n\nClarified requirements (from Phase 2):\n<insert clarification answers>\n\nSlug: <slug>\n\nOutput: docs/exec-plans/active/<slug>/pm-review.md\n\nRead ARCHITECTURE.md and docs/design-docs/core-beliefs.md for project constraints. Scout relevant code areas to ground your review in reality."
})
```

Read the resulting `docs/exec-plans/active/<slug>/pm-review.md`. If the PM recommends CLARIFY, go back to Phase 2 with the open questions. If RETHINK, surface concerns to human and stop. If GO, proceed.

### Phase 4: SPEC

Launch the `workflow.spec-writer` agent (fresh context):

```
subagent({
  agent: "workflow.spec-writer",
  task: "Write implementation plan for: $@\n\nSlug: <slug>\n\nRead docs/exec-plans/active/<slug>/pm-review.md for approved requirements.\nRead ARCHITECTURE.md and design-docs/ for architecture constraints.\nOutput: docs/exec-plans/active/<slug>/plan.md"
})
```

Read the resulting plan. Present a brief summary to the human. If the human approves, proceed. If not, loop on feedback.

### Phase 5: IMPLEMENT

Launch the `worker` agent (forked context):

```
subagent({
  agent: "worker",
  task: "Implement the approved plan.\n\nPlan: docs/exec-plans/active/<slug>/plan.md\n\nSlug: <slug>\n\nCreate docs/exec-plans/active/<slug>/PROGRESS.md before starting.\n\nRules:\n- NEVER ask 'should I continue?' — the answer is always yes\n- Write PROGRESS.md with STATUS: IN_PROGRESS and current checkpoint\n- Update PROGRESS.md after each logical unit of work\n- Set STATUS: COMPLETE when done\n- If blocked on product/architecture decision, write STATUS: BLOCKED: NEEDS_DECISION with the question\n- If token-exhausted: write STATUS: IN_PROGRESS, update checkpoint, stop"
})
```

The stop-guard extension will auto-resume if the worker stops prematurely. Let it run until COMPLETE or BLOCKED.

### Phase 6: REVIEW

Launch 3× `reviewer` agents in parallel (fresh context):

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

If (a) is non-empty, launch worker for fixes:

```
subagent({
  agent: "worker",
  task: "Apply reviewer fixes for: $@\n\nSlug: <slug>\nPlan: docs/exec-plans/active/<slug>/plan.md\n\nApply only the following fixes (category (a)):\n<insert fixes>\n\nDo NOT apply optional improvements (b) or expand scope beyond the approved plan."
})
```

If fixes were applied, verify and proceed to Phase 8. If fixes were non-trivial, loop back to Phase 6 for re-review.

### Phase 8: FINALIZE

1. If this is a git repo, open a PR via `gh pr create`
2. Move the plan directory: `mv docs/exec-plans/active/<slug> docs/exec-plans/completed/<slug>`
3. Write `docs/exec-plans/completed/<slug>/summary.md` with:
   - What was built
   - Key decisions made
   - What was deferred
   - Link to PR

## Phase Gate Contract

- NEVER skip Phase 2 (clarify). This is a hard gate.
- If PM review surfaces new questions, go back to Phase 2.
- If review finds issues requiring human judgment, pause and ask via intercom.
- After Phase 8, report: what shipped, what was deferred, PR link if applicable.

## Stop-Guard Awareness

The stop-guard extension auto-resumes workers that stop with IN_PROGRESS. This is normal — let it happen. Only intervene if a plan escalates to human (3+ retries at same checkpoint).
