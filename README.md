# pi-wiggum

A **goal plugin for pi** — modeled on Claude Code's `goal` feature.

You give pi a goal. The agent pursues it directly, and an external LLM evaluator
(a different model than the one doing the work) judges the agent's progress
against that goal after each stop, re-firing it with a directive until the goal
is met. No planning phase, no subagents — just a goal and an independent judge
driving the loop to done.

## How it works

You start a goal with the `/goal` command:

```
/goal "add a single-level wildcard to the broker"
```

1. The agent writes `.wiggum/goal.md` — the goal and its **acceptance criteria**.
2. It works toward the goal with its normal tools.
3. Each time it stops, the evaluator reads `.wiggum/goal.md` and the actual
   `git diff` + new files, and returns a verdict:
   - **CONTINUE / REDIRECT** → the agent is re-fired with a specific next directive.
   - **DONE** → the goal is archived to `.wiggum/completed/`; the loop ends. The
     work is left in the tree to commit or open a PR.
   - **BLOCKED** → `.wiggum/.escalate` is written; the loop stops for you.

The evaluator decides when the goal is done by checking the criteria against the
code — the agent can't end the loop with an optimistic "complete". The loop is
only as sharp as the acceptance criteria in the goal, so they should be concrete
and checkable.

To stop a run early, delete `.wiggum/goal.md`.

## Install

```bash
pi install npm:pi-wiggum
# or
pi install git:github.com/jasondostal/pi-wiggum
```

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `WIGGUM_JUDGE_MODEL` | `xiaomi/mimo-v2.5-pro` | The evaluator model (any pi model id). Should differ from the model pursuing the goal, so the judge stays independent. |
| `WIGGUM_PI_BIN` | `pi` | The pi binary the loop shells out to for evaluation. |
| `WIGGUM_JUDGE_PROMPT` | (auto) | Override path to the evaluator prompt. |

## Design

See [ARCHITECTURE.md](ARCHITECTURE.md). The loop lives in
`extensions/goal-guard.ts`; the evaluator's rubric and verdict schema are in
`prompts/judge.md`.
