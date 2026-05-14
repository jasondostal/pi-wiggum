# Core Beliefs

The principles that guide how we build software in this repository.

## Agent-First Development

Agents are first-class participants in the development process — not just code generators, but collaborators in clarification, planning, review, and iteration. The Wiggum loop formalizes this: humans steer, agents execute.

## MVP Scope, Not MVP Architecture

When building a new feature, use the real architecture with minimal scope. Don't build parallel infrastructure to merge later. If a service-layer pattern exists, new features wire into it. If it doesn't exist yet, building it IS part of the feature.

## Incremental and Reversible

Never big-bang a migration. Build the safety net first, migrate second. Every step independently reversible. Old things become read-only archives, not graveyards.

## Repository as System of Record

The repository itself is the source of truth — not tickets, not docs, not Slack threads. Plans, progress, decisions, and artifacts all live in the repo. A newcomer (human or agent) should be able to clone and understand the state of all active work.

## Clarity Over Speed

Phase 2 (CLARIFY) is a hard gate for a reason. An hour spent clarifying saves a day spent reimplementing. The loop enforces this — agents must not proceed past clarification until the human is satisfied.

## Review Is Not Optional

Every implementation gets 3× adversarial review from fresh-context agents. No exceptions. Review-only, no silent edits. The human is the final arbiter of what feedback to apply.

## Progress Is Visible

Every active plan has a PROGRESS.md with a STATUS tag. IN_PROGRESS, COMPLETE, or BLOCKED. The stop-guard extension monitors these and auto-resumes stalled work. No one should wonder "what's happening with X?"
