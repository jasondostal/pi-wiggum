import type { ExtensionAPI, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";

/**
 * plan-mode-guard — hard enforcement of TPM mode restrictions
 *
 * Hooks tool_call. When any active slug exists without plan.md, we are
 * in PLAN MODE. During plan mode the TPM (the orchestrator) is restricted
 * to read-only operations + the researcher and scout subagents. The only
 * mutation it may perform is creating files under docs/exec-plans/.
 *
 * Anything else — code edits, mutating bash, worker/PM/spec-writer
 * subagents — gets blocked here with a clear reason that the LLM sees in
 * its tool-result stream. Prompt + hook is the two-layer defense pattern.
 *
 * Once plan.md exists for every active slug, plan mode is off and this
 * guard becomes a no-op. Execution mode allows everything.
 */

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const ALLOWED_PLAN_MODE_AGENTS = new Set(["researcher", "scout"]);
const PLAN_DIR_PREFIX = "docs/exec-plans/";

// Conservative read-only bash pattern. Matches the entire command.
// If the command does not match, it is blocked in plan mode.
const READ_ONLY_BASH = /^\s*(ls|cat|head|tail|wc|file|stat|pwd|echo|date|true|false|which|type|git\s+(log|diff|status|show|blame|branch|remote|tag|rev-parse))\b[^;&|<>`$()]*$/;

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | void> => {
    if (!ctx.hasUI) return;
    if (!(await inPlanMode(pi))) return;

    const tool = event.toolName;
    const input = (event.input ?? {}) as Record<string, unknown>;

    if (READ_ONLY_TOOLS.has(tool)) return;

    if (tool === "write" || tool === "edit") {
      const target = pickPath(input);
      if (target && isInsidePlanDir(target)) return;
      return block(
        `Plan mode: ${tool} is blocked outside ${PLAN_DIR_PREFIX}. ` +
        `You are in TPM conversation; only the plan itself may be written. ` +
        `Continue the conversation or, when the human says go, write the plan to docs/exec-plans/active/<slug>/plan.md.`
      );
    }

    if (tool === "bash") {
      const cmd = typeof input.command === "string" ? input.command : "";
      if (READ_ONLY_BASH.test(cmd)) return;
      return block(
        `Plan mode: bash command blocked. Only simple read-only commands ` +
        `(ls, cat, head, tail, git log/diff/status/show, etc.) are permitted ` +
        `during TPM conversation. Use the Read/Grep/Glob tools for repo ` +
        `inspection. Blocked command: ${cmd.slice(0, 200)}`
      );
    }

    // Subagent dispatch (pi-subagents). Accept both single and parallel shapes.
    if (tool === "subagent" || tool === "subagents" || tool.endsWith("subagent")) {
      const single = typeof input.agent === "string" ? input.agent : null;
      const tasks = Array.isArray(input.tasks)
        ? (input.tasks as Array<Record<string, unknown>>)
        : null;

      if (single) {
        if (ALLOWED_PLAN_MODE_AGENTS.has(single)) return;
        return block(
          `Plan mode: subagent '${single}' is not allowed. Only researcher ` +
          `and scout may be invoked during TPM conversation. The plan ` +
          `has not been approved yet — execution agents are blocked.`
        );
      }
      if (tasks) {
        const offenders = tasks
          .map((t) => (typeof t.agent === "string" ? t.agent : "<unknown>"))
          .filter((a) => !ALLOWED_PLAN_MODE_AGENTS.has(a));
        if (offenders.length === 0) return;
        return block(
          `Plan mode: parallel subagent batch contains disallowed agents: ` +
          `${offenders.join(", ")}. Only researcher and scout are permitted.`
        );
      }
      return block(
        `Plan mode: subagent invocation shape not recognized. Only researcher and scout are permitted.`
      );
    }

    // Unrecognized custom tools — allow by default. Add to the blocklist if
    // they turn out to mutate state during plan mode.
    return;
  });
}

async function inPlanMode(pi: ExtensionAPI): Promise<boolean> {
  const res = await pi.exec("find", [
    "docs/exec-plans/active",
    "-mindepth", "1",
    "-maxdepth", "1",
    "-type", "d",
  ], { timeout: 3000 });
  if (res.code !== 0 || !res.stdout.trim()) return false;
  const dirs = res.stdout.trim().split("\n").filter(Boolean);
  for (const dir of dirs) {
    const check = await pi.exec("test", ["-f", `${dir}/plan.md`], { timeout: 1500 });
    if (check.code !== 0) return true;
  }
  return false;
}

function pickPath(input: Record<string, unknown>): string | undefined {
  if (typeof input.path === "string") return input.path;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.filepath === "string") return input.filepath;
  return undefined;
}

function isInsidePlanDir(path: string): boolean {
  const normalized = path.replace(/^\.\//, "");
  return normalized.startsWith(PLAN_DIR_PREFIX);
}

function block(reason: string): ToolCallEventResult {
  return { block: true, reason };
}
