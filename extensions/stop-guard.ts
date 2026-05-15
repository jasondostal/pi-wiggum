import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * stop-guard — Wiggum loop continuity (execution mode only)
 *
 * Hooks agent_end. The contract is binary:
 *
 *   - If any active slug exists without plan.md → PLAN MODE for that slug.
 *     We do NOT auto-resume anything. The human owns the conversation.
 *   - Otherwise → EXECUTION MODE. For each active slug, re-fire the
 *     orchestrator unless a hard block is set:
 *       * docs/exec-plans/active/<slug>/.escalate  (manual or auto)
 *       * docs/exec-plans/active/<slug>/PROGRESS.md STATUS: BLOCKED:
 *
 * Stagnation detection: if we re-fire and the newest mtime in the plan dir
 * hasn't advanced after MAX_STAGNATION consecutive resumes, write .escalate
 * automatically and stop. Self-healing for genuine infinite loops.
 */

const MAX_STAGNATION = 3;
const STATE_TYPE = "wiggum-stop-guard";

interface ResumeRecord {
  slug: string;
  lastMtime: number;
  stagnations: number;
}

interface StopGuardState {
  resumes: Record<string, ResumeRecord>;
}

function defaultState(): StopGuardState {
  return { resumes: {} };
}

export default function (pi: ExtensionAPI) {
  let state = defaultState();

  pi.on("session_start", async (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    let latest: StopGuardState | undefined;
    for (const entry of entries) {
      if (entry.type === "custom" && entry.customType === STATE_TYPE) {
        const data = entry.data as StopGuardState | undefined;
        if (data?.resumes) latest = data;
      }
    }
    if (latest) state = { resumes: latest.resumes };
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    const dirs = await listActiveSlugDirs(pi);
    if (dirs.length === 0) return;

    // Phase 1: plan-mode detection — if any active slug has no plan.md,
    // the human is in TPM conversation. Do not auto-resume anything.
    for (const dir of dirs) {
      if (!(await fileExists(pi, `${dir}/plan.md`))) return;
    }

    // Phase 2: execution-mode continuation
    for (const dir of dirs) {
      const slug = dir.replace(/^docs\/exec-plans\/active\//, "");
      if (!slug || slug.includes("/")) continue;

      if (await fileExists(pi, `${dir}/.escalate`)) continue;

      const progress = await readFile(pi, `${dir}/PROGRESS.md`);
      if (progress) {
        const m = progress.match(/^STATUS:\s*(.+)$/m);
        if (m && m[1].trim().startsWith("BLOCKED:")) continue;
      }

      const currentMtime = await newestMtime(pi, dir);

      let rec = state.resumes[slug];
      if (!rec) {
        rec = { slug, lastMtime: currentMtime, stagnations: 0 };
        state.resumes[slug] = rec;
      } else if (currentMtime > rec.lastMtime) {
        rec.lastMtime = currentMtime;
        rec.stagnations = 0;
      } else {
        rec.stagnations++;
      }

      if (rec.stagnations >= MAX_STAGNATION) {
        await pi.exec("sh", [
          "-c",
          `printf '%s\\n' "Auto-escalated by stop-guard: no progress after ${MAX_STAGNATION} resume attempts." "Latest mtime: ${rec.lastMtime}" > "${dir}/.escalate"`,
        ], { timeout: 3000 });
        ctx.ui.notify(
          `[wiggum] ${slug} — auto-escalated after ${MAX_STAGNATION} stalled resumes`,
          "error"
        );
        pi.appendEntry(STATE_TYPE, state);
        continue;
      }

      pi.appendEntry(STATE_TYPE, state);
      ctx.ui.notify(
        `[wiggum] ${slug} — auto-resuming execution (stagnation ${rec.stagnations}/${MAX_STAGNATION})`,
        "info"
      );

      pi.sendUserMessage(
        `Continue executing the Wiggum loop for slug: ${slug}\n\n` +
        `Plan: docs/exec-plans/active/${slug}/plan.md\n\n` +
        `Per prompts/wiggum.md execution mode: proceed with the next phase ` +
        `(implement → review → fix → finalize). Do NOT ask "what next?" — ` +
        `the plan is approved; just execute. If genuinely blocked on something ` +
        `the plan does not cover, write a hard-block reason to ` +
        `docs/exec-plans/active/${slug}/.escalate and stop.`
      );
      return;
    }
  });
}

async function listActiveSlugDirs(pi: ExtensionAPI): Promise<string[]> {
  const res = await pi.exec("find", [
    "docs/exec-plans/active",
    "-mindepth", "1",
    "-maxdepth", "1",
    "-type", "d",
  ], { timeout: 5000 });
  if (res.code !== 0 || !res.stdout.trim()) return [];
  return res.stdout.trim().split("\n").filter(Boolean);
}

async function fileExists(pi: ExtensionAPI, path: string): Promise<boolean> {
  const res = await pi.exec("test", ["-f", path], { timeout: 2000 });
  return res.code === 0;
}

async function readFile(pi: ExtensionAPI, path: string): Promise<string | null> {
  const res = await pi.exec("cat", [path], { timeout: 3000 });
  if (res.code !== 0) return null;
  return res.stdout;
}

async function newestMtime(pi: ExtensionAPI, dir: string): Promise<number> {
  const res = await pi.exec("sh", [
    "-c",
    `find "${dir}" -type f -printf '%T@\\n' 2>/dev/null | sort -rn | head -1`,
  ], { timeout: 3000 });
  if (res.code !== 0 || !res.stdout.trim()) return 0;
  return parseFloat(res.stdout.trim()) || 0;
}
