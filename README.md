# pi-wiggum

A **goal plugin for pi** — modeled on Claude Code's `goal` feature.

State a goal. Pursue it directly. An external LLM evaluator (a different model
than you) judges your work against the goal after each stop and re-fires you
with a directive until it's met. No planning phase, no subagents — just a goal
and an independent judge driving the loop to done.

## How it works

```
/goal "add a single-level wildcard to the broker"
```

1. You write `.wiggum/goal.md` — the goal and its **acceptance criteria**.
2. You work toward it with your normal tools.
3. Each time you stop, the evaluator reads `.wiggum/goal.md` and your actual
   `git diff` + new files and returns a verdict:
   - **CONTINUE / REDIRECT** → you're re-fired with a specific `NEXT DIRECTIVE`.
   - **DONE** → the goal is archived; the loop ends. Your work is in the tree.
   - **BLOCKED** → `.wiggum/.escalate` is written for you; the loop stops.

The evaluator decides done by checking the criteria against the code — you can't
end the loop with an optimistic "complete". The loop is only as sharp as the
acceptance criteria you write, so make them concrete and checkable.

## Install

```bash
pi install npm:pi-wiggum
# or
pi install git:github.com/jasondostal/pi-wiggum
```

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `WIGGUM_JUDGE_MODEL` | `xiaomi/mimo-v2.5-pro` | The evaluator model (any pi model id). **Should differ from the model pursuing the goal** so the judge stays independent. |
| `WIGGUM_PI_BIN` | `pi` | The pi binary the loop shells out to for evaluation. |
| `WIGGUM_JUDGE_PROMPT` | (auto) | Override path to the evaluator prompt. |

## Design

See [ARCHITECTURE.md](ARCHITECTURE.md). The loop lives in
`extensions/goal-guard.ts`; the evaluator's rubric and verdict schema are in
`prompts/judge.md`.
