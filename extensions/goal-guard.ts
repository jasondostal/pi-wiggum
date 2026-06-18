import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * goal-guard — a "goal" loop for pi (v0.4.0)
 *
 * Modeled on Claude Code's `goal` feature, stripped to its essence:
 *
 *   1. You set a goal (`.wiggum/goal.md` — the statement + acceptance criteria).
 *   2. You pursue it directly. You are the worker; there is no planning phase
 *      and no worker/reviewer subagents.
 *   3. Each time you stop, an EXTERNAL LLM evaluator (a different model) judges
 *      your actual changes against the goal and re-fires you with a directive:
 *
 *        DONE      → archive the goal, stop (goal achieved)
 *        CONTINUE  → re-fire with the evaluator's next_directive (steering)
 *        REDIRECT  → re-fire with a corrective directive (drift caught)
 *        BLOCKED   → write .wiggum/.escalate and stop for the human
 *
 * The evaluator is the only other model in the loop (default mimo 2.5 pro
 * direct), invoked as a pinned `pi -p` subprocess. Two dumb backstops always
 * guarantee termination: a hard iteration cap, and a mechanical mtime fallback
 * if the judge call fails. No active goal file ⇒ this extension is a no-op.
 */

const STATE_TYPE = "wiggum-goal-guard";
const GOAL_DIR = ".wiggum";
const GOAL_FILE = ".wiggum/goal.md";
const ESCALATE_FILE = ".wiggum/.escalate";

const MAX_STAGNATION = 3;     // mechanical fallback threshold
const ITER_CAP = 30;          // hard circuit-breaker
const DIFF_BUDGET = 20000;    // cap evidence size sent to the judge

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

interface GuardState {
  iterations: number;
  lastMtime: number;
  stagnations: number;
}

function defaultState(): GuardState {
  return { iterations: 0, lastMtime: 0, stagnations: 0 };
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
    for (const entry of entries) {
      if (entry.type === "custom" && entry.customType === STATE_TYPE) {
        const data = entry.data as GuardState | undefined;
        if (data) state = { ...defaultState(), ...data };
      }
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    if (!(await fileExists(pi, GOAL_FILE))) return;     // no active goal → no-op
    if (await fileExists(pi, ESCALATE_FILE)) return;    // already escalated

    state.iterations++;

    // Backstop 1: hard iteration cap.
    if (state.iterations > ITER_CAP) {
      await escalate(pi, ctx, state,
        `Hard iteration cap (${ITER_CAP}) reached. Loop stopped for human review.`);
      return;
    }

    // Ask the evaluator. On failure, fall back to the mechanical heuristic.
    const verdict = await runJudge(pi);
    if (!verdict) {
      await mechanicalFallback(pi, ctx, state);
      return;
    }

    switch (verdict.state) {
      case "BLOCKED":
        await escalate(pi, ctx, state,
          `Evaluator: BLOCKED. ${verdict.blocker || verdict.rationale}`);
        return;

      case "DONE":
        await archiveGoal(pi);
        pi.appendEntry(STATE_TYPE, state);
        ctx.ui.notify(`[goal] achieved — ${verdict.rationale}`, "info");
        return;

      case "REDIRECT":
      case "CONTINUE":
      default:
        state.stagnations = 0;
        pi.appendEntry(STATE_TYPE, state);
        ctx.ui.notify(`[goal] ${verdict.state} (iteration ${state.iterations}/${ITER_CAP})`, "info");
        pi.sendUserMessage(continueMessage(verdict));
        return;
    }
  });
}

// ── Evaluator invocation ─────────────────────────────────────────────────────

async function runJudge(pi: ExtensionAPI): Promise<Verdict | null> {
  const prompt = await buildJudgePrompt(pi);
  if (!prompt) return null;

  const res = await pi.exec(
    piBin(),
    ["-p", "-nt", "--model", judgeModel(), prompt],
    { timeout: JUDGE_TIMEOUT }
  );
  if (res.code !== 0 || !res.stdout.trim()) return null;
  return parseVerdict(res.stdout);
}

async function buildJudgePrompt(pi: ExtensionAPI): Promise<string | null> {
  const instructions = await loadJudgeInstructions(pi);
  if (!instructions) return null;

  const goal = (await readFile(pi, GOAL_FILE)) ?? "(goal.md missing)";
  const status = await execText(pi, "git", ["status", "--short"]);
  const diff = await collectChanges(pi, DIFF_BUDGET);
  const commits = await execText(pi, "git", ["log", "--oneline", "-10"]);

  return [
    instructions,
    "\n\n===== GOAL (the contract / rubric) =====\n", goal,
    "\n\n===== GIT STATUS =====\n", status || "(clean)",
    "\n\n===== GIT DIFF + NEW FILES (ground truth) =====\n", diff || "(no changes yet)",
    "\n\n===== RECENT COMMITS =====\n", commits || "(none)",
    "\n\nNow output your verdict as a single JSON object and nothing else.",
  ].join("");
}

/**
 * Locate prompts/judge.md robustly, regardless of how pi-wiggum was installed.
 * Order: env override → next to this extension → cwd → installed as a dependency.
 */
async function loadJudgeInstructions(pi: ExtensionAPI): Promise<string | null> {
  const candidates: string[] = [];
  const envPath = process.env.WIGGUM_JUDGE_PROMPT?.trim();
  if (envPath) candidates.push(envPath);
  try {
    candidates.push(new URL("../prompts/judge.md", import.meta.url).pathname);
  } catch {
    /* import.meta.url unavailable under some loaders — fall through */
  }
  candidates.push("prompts/judge.md");
  candidates.push("node_modules/pi-wiggum/prompts/judge.md");

  for (const path of candidates) {
    const text = await readFile(pi, path);
    if (text) return text;
  }
  return null;
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

// ── Re-fire / fallback ───────────────────────────────────────────────────────

function continueMessage(v: Verdict): string {
  const ev = v.evidence.length ? `\nEvidence:\n- ${v.evidence.join("\n- ")}` : "";
  const directive = v.next_directive || "Continue toward the goal.";
  return (
    `Continue pursuing your goal (see ${GOAL_FILE}).\n\n` +
    `EVALUATOR VERDICT: ${v.state}\n${v.rationale}${ev}\n\n` +
    `NEXT DIRECTIVE: ${directive}\n\n` +
    `Address the directive above, then keep working toward the goal. Do NOT ask the ` +
    `human what to do. If genuinely blocked on something outside the goal's scope, write ` +
    `the reason to ${ESCALATE_FILE} and stop.`
  );
}

async function mechanicalFallback(pi: ExtensionAPI, ctx: AgentEndCtx, state: GuardState): Promise<void> {
  const currentMtime = await newestMtime(pi, ".");
  if (currentMtime > state.lastMtime) {
    state.lastMtime = currentMtime;
    state.stagnations = 0;
  } else {
    state.stagnations++;
  }

  if (state.stagnations >= MAX_STAGNATION) {
    await escalate(pi, ctx, state,
      `Judge unavailable and no progress after ${MAX_STAGNATION} resume attempts (mechanical fallback).`);
    return;
  }

  pi.appendEntry(STATE_TYPE, state);
  ctx.ui.notify(`[goal] judge unavailable, mechanical resume (stagnation ${state.stagnations}/${MAX_STAGNATION})`, "info");
  pi.sendUserMessage(
    `Continue pursuing your goal (see ${GOAL_FILE}).\n\n` +
    `(Evaluator unavailable this cycle — proceeding on mechanical continuity.) ` +
    `Keep working toward the goal's acceptance criteria. Do NOT ask the human what to do. ` +
    `If genuinely blocked, write the reason to ${ESCALATE_FILE} and stop.`
  );
}

// ── Shared helpers ───────────────────────────────────────────────────────────

interface AgentEndCtx {
  hasUI: boolean;
  ui: { notify: (msg: string, level: string) => void };
  sessionManager: { getEntries: () => Array<{ type: string; customType?: string; data?: unknown }> };
}

async function archiveGoal(pi: ExtensionAPI): Promise<void> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  // Positional args ($1/$2) — never interpolated into the script body.
  await pi.exec("sh",
    ["-c", 'mkdir -p "$1/completed" && mv "$1/goal.md" "$1/completed/goal-$2.md"', "sh", GOAL_DIR, ts],
    { timeout: 3000 });
}

async function escalate(
  pi: ExtensionAPI, ctx: AgentEndCtx, state: GuardState, reason: string
): Promise<void> {
  // Pass reason + path as positional args — the reason is model-controlled and
  // must stay data, not code.
  await pi.exec("sh",
    ["-c", 'mkdir -p "$(dirname "$2")"; printf "%s\\n" "$1" > "$2"', "sh", reason, ESCALATE_FILE],
    { timeout: 3000 });
  pi.appendEntry(STATE_TYPE, state);
  ctx.ui.notify(`[goal] escalated: ${reason}`, "error");
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

/**
 * Ground-truth changes for the judge: tracked diff vs HEAD PLUS the contents of
 * untracked new files. `git diff HEAD` alone misses brand-new files, which is
 * exactly what fresh work produces. Read-only: no staging, no index mutation.
 */
async function collectChanges(pi: ExtensionAPI, budget: number): Promise<string> {
  const tracked = await execText(pi, "git", ["diff", "HEAD"]);
  const untracked = await execText(pi, "git", ["ls-files", "--others", "--exclude-standard"]);

  let out = tracked;
  if (untracked) {
    out += "\n\n# Untracked new files (full contents):\n";
    for (const f of untracked.split("\n").filter(Boolean)) {
      if (out.length >= budget) break;
      const content = (await readFile(pi, f)) ?? "(unreadable)";
      out += `\n--- new file: ${f} ---\n${content}\n`;
    }
  }
  return truncate(out, budget);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… [diff truncated at ${max} chars] …`;
}

async function newestMtime(pi: ExtensionAPI, dir: string): Promise<number> {
  const res = await pi.exec("sh",
    ["-c", `find "$1" -type f -not -path '*/.git/*' -printf '%T@\\n' 2>/dev/null | sort -rn | head -1`, "sh", dir],
    { timeout: 4000 });
  if (res.code !== 0 || !res.stdout.trim()) return 0;
  return parseFloat(res.stdout.trim()) || 0;
}
