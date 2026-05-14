import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * stop-guard — Wiggum loop safety net (Layer 2)
 *
 * Hooks agent_end. If any active plan's PROGRESS.md is IN_PROGRESS
 * (and not BLOCKED), auto-re-fires the worker. Retry counter with
 * max 3 attempts at same checkpoint before escalating to human.
 */

const MAX_RETRIES = 3;
const STOP_GUARD_TYPE = "wiggum-stop-guard";
const PROGRESS_GLOB = "docs/exec-plans/active/*/PROGRESS.md";

interface CheckpointState {
  slug: string;
  checkpoint: string | null;
  retries: number;
  escalated: boolean;
}

interface StopGuardState {
  plans: Record<string, CheckpointState>;
}

function defaultState(): StopGuardState {
  return { plans: {} };
}

export default function (pi: ExtensionAPI) {
  let state = defaultState();

  pi.on("session_start", async (_event, ctx) => {
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === STOP_GUARD_TYPE) {
        const data = entry.data as StopGuardState | undefined;
        if (data && data.plans) {
          state = data;
        }
      }
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    // Guard: skip in non-interactive sessions (pi -p mode) —
    // sendUserMessage can't deliver a follow-up turn
    if (!ctx.hasUI) return;

    // Find all PROGRESS.md files for active plans
    const findResult = await pi.exec("find", [
      "docs/exec-plans/active",
      "-name", "PROGRESS.md",
      "-maxdepth", "3",
    ], { timeout: 5000 });

    if (findResult.code !== 0 || !findResult.stdout.trim()) return;

    const paths = findResult.stdout.trim().split("\n").filter(Boolean);
    if (paths.length === 0) return;

    for (const path of paths) {
      const slug = path.replace(/^docs\/exec-plans\/active\//, "")
        .replace(/\/PROGRESS\.md$/, "");
      if (!slug || slug === path) continue;

      // Read PROGRESS.md content
      const catResult = await pi.exec("cat", [path], { timeout: 3000 });
      if (catResult.code !== 0) continue;
      const content = catResult.stdout;

      const status = extractStatus(content);
      if (!status) continue;

      // Initialize checkpoint state for this plan
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
        // Don't auto-resume blocked plans
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
            `[wiggum] ${slug} — stuck at same checkpoint ${MAX_RETRIES}+ times. Escalated to human.`,
            "error"
          );
          continue;
        }

        persistState(pi, state);

        ctx.ui.notify(
          `[wiggum] ${slug} IN_PROGRESS — auto-resuming (${cp.retries + 1}/${MAX_RETRIES})`,
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
        return; // Only re-fire one per agent_end
      }
    }
  });
}

// --- Status and checkpoint extraction ---

function extractStatus(content: string): string | null {
  // Match STATUS: <value> at line start
  const m = content.match(/^STATUS:\s*(.+)$/m);
  if (!m) return null;
  return m[1].trim();
}

function extractCheckpoint(content: string): string | null {
  // Match ## Checkpoint: <name> or **Checkpoint:** <name>
  const m = content.match(/(?:##\s*Checkpoint|Checkpoint):\s*(.+)$/m);
  if (!m) return null;
  return m[1].trim();
}

function persistState(pi: ExtensionAPI, state: StopGuardState): void {
  pi.appendEntry(STOP_GUARD_TYPE, state);
}
