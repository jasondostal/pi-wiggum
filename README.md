# pi-wiggum

A Ralph Wiggum loop for pi — autonomous agentic software development workflow.

Agents clarify, plan, implement, review, fix, and iterate. Humans steer. The repository is the system of record.

The loop is **evaluator-driven** (v0.3.0): when the worker stops, an independent LLM judge — a different model than the worker, modeled on Claude Code's `goal` feature — evaluates the actual diff against the plan's acceptance criteria and decides whether to continue (with a specific directive), redirect, finalize, or escalate. The worker can no longer end the loop by claiming `STATUS: COMPLETE`; completion is verified against the code.

## Status

**Evaluator-driven control (v0.3.0).** The stop-guard's old mechanical judgment (self-reported `STATUS:` string-match + mtime-stagnation) is replaced by an external LLM evaluator (`prompts/judge.md`, default model `xiaomi/mimo-v2.5-pro`). See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design and [docs/exec-plans/completed/pi-wiggum-bootstrap/summary.md](docs/exec-plans/completed/pi-wiggum-bootstrap/summary.md) for the original bootstrap.

### Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `WIGGUM_JUDGE_MODEL` | `xiaomi/mimo-v2.5-pro` | The evaluator model (any pi model id). Should differ from the worker model. |
| `WIGGUM_PI_BIN` | `pi` | The pi binary the stop-guard shells out to for evaluation. |

## Quick Start

1. Install: `pi install npm:pi-wiggum`
2. Install deps: `pi install npm:pi-subagents`, `pi install npm:pi-intercom`
3. Authenticate: `gh auth login`
4. Run: `/wiggum "build dark mode"` (or whatever feature)

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full loop design.
See [AGENTS.md](AGENTS.md) for the repository map.

## Install

```bash
pi install npm:pi-wiggum
```

Or from git:

```bash
pi install git:github.com/jasondostal/pi-wiggum
```

### Dependencies

- [pi-coding-agent](https://github.com/badlogic/pi-coding-agent)
- pi-subagents — `pi install npm:pi-subagents`
- pi-intercom — `pi install npm:pi-intercom`
- `gh` CLI — `gh auth login`

### Cron Jobs (optional but recommended)

The Wiggum loop can use two cron jobs for background maintenance. The doc-gardener and safety net are idle without them — they won't error, they just won't run.

```bash
# Doc gardener — scans docs/ for staleness and drift every 6 hours
0 */6 * * * cd /path/to/your-repo && pi -p "Run doc-gardening maintenance: scan docs/ for staleness and drift, update tech-debt-tracker.md, fix clear issues." --session wiggum-gardener

# Orchestrator safety net — resumes stalled IN_PROGRESS plans every 15 minutes
*/15 * * * * cd /path/to/your-repo && pi -p "Check docs/exec-plans/active/ for any plan with STATUS: IN_PROGRESS in PROGRESS.md. If found, resume implementation from where it left off. Do NOT ask 'should I continue?'" --session wiggum-orchestrator
```

Install with `crontab -e` or use systemd timers. Replace `/path/to/your-repo` with the actual repo path.
