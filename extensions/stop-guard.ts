import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * stop-guard — Wiggum loop continuity, evaluator-driven (v0.3.0)
 *
 * Hooks agent_end. In execution mode it asks an EXTERNAL LLM evaluator to
 * judge the work against the plan's acceptance criteria, then acts on the
 * verdict — the same shape as Claude Code's "goal" feature:
 *
 *   DONE      → re-fire the orchestrator to FINALIZE only (PR, move to completed/)
 *   CONTINUE  → re-fire with the evaluator's next_directive injected (steering)
 *   REDIRECT  → re-fire with a corrective directive (drift / spinning detected)
 *   BLOCKED   → write .escalate with the evaluator's reason and stop
 *
 * The evaluator is a different model than the worker (default: mimo 2.5 pro
 * direct — cheap, independent eyes). It runs as a pinned `pi -p` subprocess so
 * the judge model is fixed regardless of what the loop itself is running.
 *
 * Safety: this is the SMART layer. Underneath it are two DUMB backstops that
 * always guarantee termination:
 *   1. ITER_CAP — a hard per-slug iteration ceiling. Smart judge wedged or not,
 *      the loop cannot run forever.
 *   2. Mechanical fallback — if the judge call fails or returns garbage, we fall
 *      back to the old mtime-stagnation heuristic rather than blindly looping.
 *
 * Plan mode (any active slug without plan.md) suspends all auto-resumption —
 * the TPM conversation is sacred. The instant plan.md is written, we take over.
 */

const STATE_TYPE = "wiggum-stop-guard";
const MAX_STAGNATION = 3;          // mechanical fallback threshold
const ITER_CAP = 30;               // hard circuit-breaker per slug
const MAX_DONE_NUDGES = 2;         // judge says DONE but loop won't finalize
const DIFF_BUDGET = 20000;         // cap evidence size sent to the judge

const DEFAULT_JUDGE_MODEL = "xiaomi/mimo-v2.5-pro";
const DEFAULT_PI_BIN = "pi";
const JUDGE_TIMEOUT = 150000;

type VerdictState = "DONE" | "CONTINUE" | "REDIRECT" | "BLOCKED";

interface Verdict {
  state: VerdictState;
  rationale: string;
  evidence: string[];
  next_directive: string;
  blocker: string;
}

interface ResumeRecord {
  slug: string;
  lastMtime: number;
  stagnations: number;
  iterations: number;
  doneNudges: number;
}

interface StopGuardState {
  resumes: Record<string, ResumeRecord>;
}

function defaultState(): StopGuardState {
  return { resumes: {} };
}

function judgeModel(): string {
  return process.env.WIGGUM_JUDGE_MODEL?.trim() || DEFAULT_JUDGE_MODEL;
}

function piBin(): string {
  return process.env.WIGGUM_PI_BIN?.trim() || DEFAULT_PI_BIN;
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

    // Plan-mode detection — any active slug without plan.md means the human is
    // mid-TPM-conversation. Do not auto-resume anything.
    for (const dir of dirs) {
      if (!(await fileExists(pi, `${dir}/plan.md`))) return;
    }

    // Execution mode — advance the first slug that isn't hard-blocked.
    for (const dir of dirs) {
      const slug = dir.replace(/^docs\/exec-plans\/active\//, "");
      if (!slug || slug.includes("/")) continue;
      if (await fileExists(pi, `${dir}/.escalate`)) continue;

      const rec = ensureRecord(state, slug, await newestMtime(pi, dir));
      rec.iterations++;

      // Backstop 1: hard iteration cap.
      if (rec.iterations > ITER_CAP) {
        await escalate(pi, ctx, dir, slug, state,
          `Hard iteration cap (${ITER_CAP}) reached. Loop stopped for human review.`);
        return;
      }

      // Ask the evaluator. On failure, fall back to the mechanical heuristic.
      const verdict = await runJudge(pi, dir);
      if (!verdict) {
        await mechanicalFallback(pi, ctx, dir, slug, state, rec);
        return;
      }

      switch (verdict.state) {
        case "BLOCKED":
          await escalate(pi, ctx, dir, slug, state,
            `Evaluator: BLOCKED. ${verdict.blocker || verdict.rationale}`);
          return;

        case "DONE": {
          rec.doneNudges++;
          if (rec.doneNudges > MAX_DONE_NUDGES) {
            await escalate(pi, ctx, dir, slug, state,
              `Evaluator reports DONE but the loop did not finalize after ` +
              `${MAX_DONE_NUDGES} nudges. Finalize (PR + move to completed/) or escalate manually.`);
            return;
          }
          persist(pi, state, ctx,
            `[wiggum] ${slug} — evaluator: DONE, directing FINALIZE (nudge ${rec.doneNudges}/${MAX_DONE_NUDGES})`,
            "info");
          pi.sendUserMessage(finalizeMessage(slug, verdict));
          return;
        }

        case "REDIRECT":
        case "CONTINUE":
        default: {
          rec.doneNudges = 0;
          persist(pi, state, ctx,
            `[wiggum] ${slug} — evaluator: ${verdict.state} (iter ${rec.iterations}/${ITER_CAP})`,
            "info");
          pi.sendUserMessage(continueMessage(slug, verdict));
          return;
        }
      }
    }
  });
}

// ── Evaluator invocation ────────────────────────────────────────────────────

async function runJudge(pi: ExtensionAPI, dir: string): Promise<Verdict | null> {
  const prompt = await buildJudgePrompt(pi, dir);
  if (!prompt) return null;

  const res = await pi.exec(
    piBin(),
    ["-p", "-nt", "--model", judgeModel(), prompt],
    { timeout: JUDGE_TIMEOUT }
  );
  if (res.code !== 0 || !res.stdout.trim()) return null;
  return parseVerdict(res.stdout);
}

async function buildJudgePrompt(pi: ExtensionAPI, dir: string): Promise<string | null> {
  const instructions =
    (await readFile(pi, "prompts/judge.md")) ??
    (await readFile(pi, "node_modules/pi-wiggum/prompts/judge.md"));
  if (!instructions) return null;

  const plan = (await readFile(pi, `${dir}/plan.md`)) ?? "(plan.md missing)";
  const progress = (await readFile(pi, `${dir}/PROGRESS.md`)) ?? "(no PROGRESS.md yet)";
  const status = await execText(pi, "git", ["status", "--short"]);
  const diff = truncate(await execText(pi, "git", ["diff", "HEAD"]), DIFF_BUDGET);
  const commits = await execText(pi, "git", ["log", "--oneline", "-10"]);

  return [
    instructions,
    "\n\n===== PLAN (the contract / rubric) =====\n", plan,
    "\n\n===== PROGRESS (worker self-report — verify, don't trust) =====\n", progress,
    "\n\n===== GIT STATUS =====\n", status || "(clean)",
    "\n\n===== GIT DIFF vs HEAD (ground truth) =====\n", diff || "(no uncommitted changes)",
    "\n\n===== RECENT COMMITS =====\n", commits || "(none)",
    "\n\nNow output your verdict as a single JSON object and nothing else.",
  ].join("");
}

/** Tolerant verdict extraction: fenced ```json first, else last balanced {…}. */
function parseVerdict(raw: string): Verdict | null {
  let candidate: string | null = null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidate = fenced[1];

  if (!candidate) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) candidate = raw.slice(start, end + 1);
  }
  if (!candidate) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return null;
  }

  const state = String(obj.state || "").toUpperCase();
  if (!["DONE", "CONTINUE", "REDIRECT", "BLOCKED"].includes(state)) return null;

  return {
    state: state as VerdictState,
    rationale: typeof obj.rationale === "string" ? obj.rationale : "",
    evidence: Array.isArray(obj.evidence) ? obj.evidence.map(String) : [],
    next_directive: typeof obj.next_directive === "string" ? obj.next_directive : "",
    blocker: typeof obj.blocker === "string" ? obj.blocker : "",
  };
}

// ── Re-fire messages ─────────────────────────────────────────────────────────

function continueMessage(slug: string, v: Verdict): string {
  const ev = v.evidence.length ? `\nEvidence:\n- ${v.evidence.join("\n- ")}` : "";
  const directive = v.next_directive || "Continue executing the plan.";
  return (
    `Continue executing the Wiggum loop for slug: ${slug}\n\n` +
    `Plan: docs/exec-plans/active/${slug}/plan.md\n\n` +
    `EVALUATOR VERDICT: ${v.state}\n${v.rationale}${ev}\n\n` +
    `NEXT DIRECTIVE: ${directive}\n\n` +
    `Per prompts/wiggum.md execution mode: address the directive above, then continue ` +
    `(implement → review → fix → finalize). Do NOT ask "what next?" — the plan is approved. ` +
    `If genuinely blocked on something the plan does not cover, write the reason to ` +
    `docs/exec-plans/active/${slug}/.escalate and stop.`
  );
}

function finalizeMessage(slug: string, v: Verdict): string {
  return (
    `Continue the Wiggum loop for slug: ${slug}\n\n` +
    `EVALUATOR VERDICT: DONE — acceptance criteria met.\n${v.rationale}\n\n` +
    `Proceed DIRECTLY to Phase D FINALIZE for docs/exec-plans/active/${slug}/plan.md:\n` +
    `  1. Open a PR via gh pr create (if this is a git repo with a remote).\n` +
    `  2. Move the slug: mv docs/exec-plans/active/${slug} docs/exec-plans/completed/${slug}\n` +
    `  3. Write docs/exec-plans/completed/${slug}/summary.md.\n` +
    `Do NOT implement further. Do NOT re-review. Just finalize.`
  );
}

// ── Mechanical fallback (judge unavailable) ──────────────────────────────────

async function mechanicalFallback(
  pi: ExtensionAPI, ctx: AgentEndCtx, dir: string, slug: string,
  state: StopGuardState, rec: ResumeRecord
): Promise<void> {
  // Honor a worker-declared block even without the judge.
  const progress = await readFile(pi, `${dir}/PROGRESS.md`);
  if (progress) {
    const m = progress.match(/^STATUS:\s*(.+)$/m);
    if (m && m[1].trim().startsWith("BLOCKED:")) {
      persist(pi, state, ctx, `[wiggum] ${slug} — worker BLOCKED (judge unavailable)`, "error");
      return;
    }
  }

  const currentMtime = await newestMtime(pi, dir);
  if (currentMtime > rec.lastMtime) {
    rec.lastMtime = currentMtime;
    rec.stagnations = 0;
  } else {
    rec.stagnations++;
  }

  if (rec.stagnations >= MAX_STAGNATION) {
    await escalate(pi, ctx, dir, slug, state,
      `Judge unavailable and no progress after ${MAX_STAGNATION} resume attempts (mechanical fallback).`);
    return;
  }

  persist(pi, state, ctx,
    `[wiggum] ${slug} — judge unavailable, mechanical resume (stagnation ${rec.stagnations}/${MAX_STAGNATION})`,
    "info");
  pi.sendUserMessage(
    `Continue executing the Wiggum loop for slug: ${slug}\n\n` +
    `Plan: docs/exec-plans/active/${slug}/plan.md\n\n` +
    `(Evaluator unavailable this cycle — proceeding on mechanical continuity.) ` +
    `Per prompts/wiggum.md execution mode: proceed with the next phase. Do NOT ask "what next?" ` +
    `If genuinely blocked, write the reason to docs/exec-plans/active/${slug}/.escalate and stop.`
  );
}

// ── Shared helpers ───────────────────────────────────────────────────────────

interface AgentEndCtx {
  hasUI: boolean;
  ui: { notify: (msg: string, level: string) => void };
  sessionManager: { getEntries: () => Array<{ type: string; customType?: string; data?: unknown }> };
}

function ensureRecord(state: StopGuardState, slug: string, mtime: number): ResumeRecord {
  let rec = state.resumes[slug];
  if (!rec) {
    rec = { slug, lastMtime: mtime, stagnations: 0, iterations: 0, doneNudges: 0 };
    state.resumes[slug] = rec;
  }
  return rec;
}

function persist(
  pi: ExtensionAPI, state: StopGuardState, ctx: AgentEndCtx, msg: string, level: string
): void {
  pi.appendEntry(STATE_TYPE, state);
  ctx.ui.notify(msg, level);
}

async function escalate(
  pi: ExtensionAPI, ctx: AgentEndCtx, dir: string, slug: string,
  state: StopGuardState, reason: string
): Promise<void> {
  // Pass reason + path as positional args ($1/$2), never interpolated into the
  // script body — the reason is model-controlled and must stay data, not code.
  await pi.exec("sh",
    ["-c", 'printf "%s\\n" "$1" > "$2"', "sh", reason, `${dir}/.escalate`],
    { timeout: 3000 });
  pi.appendEntry(STATE_TYPE, state);
  ctx.ui.notify(`[wiggum] ${slug} — escalated: ${reason}`, "error");
}

async function listActiveSlugDirs(pi: ExtensionAPI): Promise<string[]> {
  const res = await pi.exec("find",
    ["docs/exec-plans/active", "-mindepth", "1", "-maxdepth", "1", "-type", "d"],
    { timeout: 5000 });
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

async function execText(pi: ExtensionAPI, cmd: string, args: string[]): Promise<string> {
  const res = await pi.exec(cmd, args, { timeout: 8000 });
  return res.code === 0 ? res.stdout.trim() : "";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… [diff truncated at ${max} chars] …`;
}

async function newestMtime(pi: ExtensionAPI, dir: string): Promise<number> {
  const res = await pi.exec("sh",
    ["-c", `find "${dir}" -type f -printf '%T@\\n' 2>/dev/null | sort -rn | head -1`],
    { timeout: 3000 });
  if (res.code !== 0 || !res.stdout.trim()) return 0;
  return parseFloat(res.stdout.trim()) || 0;
}
