# Progress: pi-wiggum Bootstrap

STATUS: IN_PROGRESS

## Checkpoint: Infrastructure built

### Completed
- [x] `workflow.product-manager` agent (`~/.pi/agent/agents/workflow.product-manager.md`) — global scope
- [x] `workflow.spec-writer` agent (`~/.pi/agent/agents/workflow.spec-writer.md`) — global scope
- [x] `stop-guard` extension (`~/.pi/agent/extensions/stop-guard.ts`) — hooks agent_end, auto-resumes IN_PROGRESS workers
- [x] `/wiggum` prompt template (`~/.pi/agent/prompts/wiggum.md`) — full 8-phase orchestration
- [x] Repo scaffold (`docs/design-docs/`, `docs/exec-plans/`, `docs/product-specs/`, etc.)
- [x] `docs/design-docs/core-beliefs.md` — agent-first principles
- [x] Agent discovery verified — subagent listing shows both workflow agents

### Remaining
- [ ] Stop-guard interactive-mode testing (non-interactive mode verified — gracefully no-ops)
- [ ] First Wiggum loop run on a real feature — the dogfooding test

### Completed (this session)
- [x] `docs/design-docs/index.md` and `docs/product-specs/index.md` index files
- [x] `wiggum.doc-gardener` agent (`~/.pi/agent/agents/wiggum.doc-gardener.md`) — scans docs/ for drift/staleness
- [x] Cron setup: doc gardener (every 6hr) and orchestrator safety net (every 15min) — crontab installed
- [x] `docs/exec-plans/tech-debt-tracker.md` created

### Architecture Decision
Agents and prompt are global (`~/.pi/agent/`) — usable from any project. The loop is project-agnostic infrastructure, not coupled to pi-wiggum.
Doc gardener is a standalone subagent called via `pi -p --session wiggum-gardener` on cron — not a Wiggum loop run. The first Wiggum run will be a real feature with actual code changes.
