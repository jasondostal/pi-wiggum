# pi-wiggum

A Ralph Wiggum loop for pi — autonomous agentic software development workflow.

Agents clarify, plan, implement, review, fix, and iterate. Humans steer. The repository is the system of record.

## Status

**Bootstrapping.** This repo currently contains the plan to build the Wiggum loop itself. First deliverable: a doc-gardening agent that scans for stale documentation and opens fix PRs.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full loop design.
See [AGENTS.md](AGENTS.md) for the repository map.

## Dependencies

- [pi-coding-agent](https://github.com/badlogic/pi-coding-agent)
- pi-subagents (agent orchestration)
- pi-intercom (agent communication)
- `gh` CLI (PR management)
