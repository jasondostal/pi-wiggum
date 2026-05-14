# pi-wiggum

A Ralph Wiggum loop for pi — autonomous agentic software development workflow.

Agents clarify, plan, implement, review, fix, and iterate. Humans steer. The repository is the system of record.

## Status

**Bootstrap complete.** The Wiggum loop infrastructure is built, reviewed, and ready for dogfooding. Custom agents (PM, spec-writer, doc-gardener), stop-guard extension, and `/wiggum` prompt template are installed. Cron jobs configured. See [docs/exec-plans/completed/pi-wiggum-bootstrap/summary.md](docs/exec-plans/completed/pi-wiggum-bootstrap/summary.md) for full bootstrap summary.

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
