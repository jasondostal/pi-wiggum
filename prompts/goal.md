---
description: Set and pursue a goal — an external LLM judge evaluates progress until it's met
argument-hint: "<goal>"
---

You are pursuing this goal: $@

This is a **goal loop**. There is no planning phase and no subagents — you are the
worker. An external evaluator (a different model) judges your work after each stop
and re-fires you with a directive until the goal is met.

## Start

1. **Write `.wiggum/goal.md`** if it does not already exist. Put two things in it:
   - the goal, stated plainly, and
   - **acceptance criteria** — concrete, checkable conditions for "done".

   This file is the rubric the evaluator judges you against. The loop is only as
   sharp as the criteria you write, so make them specific and testable.

2. **Then work toward the goal directly**, using your tools. Don't ask the human
   what to do next — pursue the goal.

## The loop

Each time you stop, the evaluator reads `.wiggum/goal.md` and your actual changes
(`git diff` + new files) and returns a verdict. You'll see it at the top of your
next message:

- **CONTINUE / REDIRECT** → a `NEXT DIRECTIVE` is included. Do exactly that, then
  keep going. REDIRECT means you were caught drifting or repeating — read it carefully.
- **DONE** → the evaluator archives `.wiggum/goal.md`; the loop ends. Your work is
  in the tree — commit or open a PR if you want.
- **BLOCKED** → the evaluator writes `.wiggum/.escalate` for the human; the loop stops.

If you hit a hard blocker the goal's scope does not cover, write the reason to
`.wiggum/.escalate` and stop. Otherwise: keep working. The evaluator decides when
you're done — not a self-reported "complete".
