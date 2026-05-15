import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * stop-guard — Wiggum loop safety net (Layer 2)
 *
 * Hooks agent_end. Two responsibilities:
 *
 *   1. Worker layer (PROGRESS.md, Phase 5 only): if a worker stops with
 *      STATUS: IN_PROGRESS, re-fire it. Tracks retries per (slug, checkpoint).
 *
 *   2. Orchestrator layer (LOOP.md, all phases): if the orchestrator ends a
 *      turn between phases with STATUS: ACTIVE, re-fire it. Tracks retries
 *      per (slug, phase). AWAITING_HUMAN / BLOCKED / COMPLETE are no-ops.
 *
 * Worker layer takes priority — if any plan's worker is mid-flight, that
 * gets resumed and we return. Orchestrator continuation only runs when no
 * worker needs resuming.
 *
 * Retry cap is MAX_RETRIES at the same (slug, checkpoint) or (slug, phase)
 * before escalating to human.
 */

const MAX_RETRIES = 3;
const STOP_GUARD_TYPE = "wiggum-stop-guard";

interface CheckpointState {
  slug: string;
  checkpoint: string | null;
  retries: number;
  escalated: boolean;
}

interface LoopPhaseState {
  slug: string;
  phase: string | null;
  retries: number;
  escalated: boolean;
}

interface StopGuardState {
  plans: Record<string, CheckpointState>;
  loops: Record<string, LoopPhaseState>;
}

function defaultState(): StopGuardState {
  return { plans: {}, loops: {} };
}

export default function (pi: ExtensionAPI) {
  let state = defaultState();

  pi.on("session_start", async (_event, ctx) => {
    // Read the LAST matching entry so we always use the freshest state
    const entries = ctx.sessionManager.getEntries();
    let latestState: StopGuardState | undefined;
    for (const entry of entries) {
      if (entry.type === "custom" && entry.customType === STOP_GUARD_TYPE) {
        const data = entry.data as StopGuardState | undefined;
        if (data && data.plans) {
          latestState = data;
        }
      }
    }
    if (latestState) {
      state = {
        plans: latestState.plans ?? {},
        loops: latestState.loops ?? {},
      };
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    // Guard: skip in non-interactive sessions (pi -p mode) —
    // sendUserMessage can't deliver a follow-up turn
    if (!ctx.hasUI) return;

    // Find all active plan directories
    const findResult = await pi.exec("find", [
      "-maxdepth", "3",
      "docs/exec-plans/active",
      "(", "-name", "PROGRESS.md", "-o", "-name", "LOOP.md", ")",
    ], { timeout: 5000 });

    if (findResult.code !== 0 || !findResult.stdout.trim()) return;

    const allPaths = findResult.stdout.trim().split("\n").filter(Boolean);
    const progressPaths = allPaths.filter((p) => p.endsWith("/PROGRESS.md"));
    const loopPaths = allPaths.filter((p) => p.endsWith("/LOOP.md"));

    // --- Layer 1: Worker continuation (PROGRESS.md) ---
    for (const path of progressPaths) {
      const slug = pathToSlug(path, "PROGRESS.md");
      if (!slug) continue;

      const content = await readFile(pi, path);
      if (content === null) continue;

      const status = extractStatus(content);
      if (!status) continue;

      if (!state.plans[slug]) {
        state.plans[slug] = { slug, checkpoint: null, retries: 0, escalated: false };
      }
      const cp = state.plans[slug];

      if (status === "COMPLETE") {
        cp.checkpoint = null;
        cp.retries = 0;
        cp.escalated = false;
        persistState(pi, state);
        continue;
      }

      if (status.startsWith("BLOCKED:")) {
        pi.appendEntry(STOP_GUARD_TYPE, state);
        continue;
      }

      if (status === "IN_PROGRESS" && !cp.escalated) {
        const currentCheckpoint = extractCheckpoint(content);
        const sameCheckpoint = currentCheckpoint !== null &&
          currentCheckpoint === cp.checkpoint;

        if (sameCheckpoint) {
          cp.retries++;
        } else {
          cp.retries = 0;
          cp.checkpoint = currentCheckpoint;
        }

        if (cp.retries >= MAX_RETRIES) {
          cp.escalated = true;
          persistState(pi, state);
          pi.appendEntry(STOP_GUARD_TYPE, state);
          ctx.ui.notify(
            `[wiggum] ${slug} — worker stuck at same checkpoint ${MAX_RETRIES}+ times. Escalated to human.`,
            "error"
          );
          continue;
        }

        persistState(pi, state);

        ctx.ui.notify(
          `[wiggum] ${slug} worker IN_PROGRESS — auto-resuming (${cp.retries + 1}/${MAX_RETRIES})`,
          "info"
        );

        pi.sendUserMessage(
          `Continue from PROGRESS.md:\n\n` +
          `Plan: ${slug}\n` +
          `Progress file: docs/exec-plans/active/${slug}/PROGRESS.md\n\n` +
          `Pick up where you left off and continue until STATUS: COMPLETE.\n` +
          `Do NOT ask "should I continue?" — the answer is always yes.\n` +
          `If blocked on a product or architecture decision not covered by the plan, ` +
          `write STATUS: BLOCKED: NEEDS_DECISION with the question.\n` +
          `Token exhaustion is handled — write IN_PROGRESS with current checkpoint and stop.`
        );
        return; // Worker resume takes priority — done for this turn
      }
    }

    // --- Layer 2: Orchestrator continuation (LOOP.md) ---
    for (const path of loopPaths) {
      const slug = pathToSlug(path, "LOOP.md");
      if (!slug) continue;

      const content = await readFile(pi, path);
      if (content === null) continue;

      const status = extractStatus(content);
      if (!status) continue;

      if (!state.loops[slug]) {
        state.loops[slug] = { slug, phase: null, retries: 0, escalated: false };
      }
      const lp = state.loops[slug];

      if (status === "COMPLETE" || status === "AWAITING_HUMAN") {
        // Reset retry tracking — these are valid stopping points
        lp.phase = null;
        lp.retries = 0;
        lp.escalated = false;
        persistState(pi, state);
        continue;
      }

      if (status.startsWith("BLOCKED:")) {
        pi.appendEntry(STOP_GUARD_TYPE, state);
        continue;
      }

      if (status === "ACTIVE" && !lp.escalated) {
        const currentPhase = extractPhase(content);
        const samePhase = currentPhase !== null && currentPhase === lp.phase;

        if (samePhase) {
          lp.retries++;
        } else {
          lp.retries = 0;
          lp.phase = currentPhase;
        }

        if (lp.retries >= MAX_RETRIES) {
          lp.escalated = true;
          persistState(pi, state);
          pi.appendEntry(STOP_GUARD_TYPE, state);
          ctx.ui.notify(
            `[wiggum] ${slug} — orchestrator stuck at same phase ${MAX_RETRIES}+ times. Escalated to human.`,
            "error"
          );
          continue;
        }

        persistState(pi, state);

        ctx.ui.notify(
          `[wiggum] ${slug} loop ACTIVE at ${currentPhase ?? "?"} — auto-resuming orchestrator (${lp.retries + 1}/${MAX_RETRIES})`,
          "info"
        );

        pi.sendUserMessage(
          `Continue the Wiggum loop:\n\n` +
          `Plan: ${slug}\n` +
          `Loop state: docs/exec-plans/active/${slug}/LOOP.md\n\n` +
          `Read LOOP.md, identify the current phase, and proceed with the next phase ` +
          `per prompts/wiggum.md. Do NOT ask "what next?" — the answer is in LOOP.md.\n` +
          `Update LOOP.md before ending your turn:\n` +
          `  - STATUS: ACTIVE + PHASE: <next> if continuing\n` +
          `  - STATUS: AWAITING_HUMAN if you hit a gate (Phase 0 / Phase 4)\n` +
          `  - STATUS: BLOCKED: <reason> if you need human input outside a gate\n` +
          `  - STATUS: COMPLETE only after Phase 8 finalize`
        );
        return; // One resume per agent_end
      }
    }
  });
}

// --- Helpers ---

async function readFile(pi: ExtensionAPI, path: string): Promise<string | null> {
  const res = await pi.exec("cat", [path], { timeout: 3000 });
  if (res.code !== 0) return null;
  return res.stdout;
}

function pathToSlug(path: string, filename: string): string | null {
  const slug = path
    .replace(/^docs\/exec-plans\/active\//, "")
    .replace(new RegExp(`/${filename}$`), "");
  if (!slug || slug === path) return null;
  return slug;
}

function extractStatus(content: string): string | null {
  const m = content.match(/^STATUS:\s*(.+)$/m);
  if (!m) return null;
  return m[1].trim();
}

function extractCheckpoint(content: string): string | null {
  const m = content.match(/(?:##\s*Checkpoint|Checkpoint):\s*(.+)$/m);
  if (!m) return null;
  return m[1].trim();
}

function extractPhase(content: string): string | null {
  const m = content.match(/^PHASE:\s*(.+)$/m);
  if (!m) return null;
  return m[1].trim();
}

function persistState(pi: ExtensionAPI, state: StopGuardState): void {
  pi.appendEntry(STOP_GUARD_TYPE, state);
}
