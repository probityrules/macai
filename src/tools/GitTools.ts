import type { SecretScanner } from "../security/SecretScanner.js";
import type { ToolContext, ToolDefinition } from "./types.js";
import { gitExec } from "./ToolRegistry.js";

export function createGitTools(ctx: ToolContext, secretScanner: SecretScanner): ToolDefinition[] {
  const readOnly = ctx.readOnly;

  return [
    {
      name: "git_status",
      description: "Show git status in the worktree.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const status = gitExec(["status", "--porcelain"], ctx.worktreePath);
        const branch = gitExec(["rev-parse", "--abbrev-ref", "HEAD"], ctx.worktreePath);
        return JSON.stringify({ branch, status: status || "clean" });
      },
    },
    {
      name: "git_diff",
      description: "Show git diff. Use staged=true for staged changes.",
      parameters: {
        type: "object",
        properties: {
          staged: { type: "boolean", description: "Show staged diff" },
        },
      },
      execute: async (args) => {
        const staged = Boolean(args.staged);
        const diffArgs = staged ? ["diff", "--cached"] : ["diff"];
        const diff = gitExec(diffArgs, ctx.worktreePath);
        const stat = gitExec(["diff", "--stat", ...(staged ? ["--cached"] : [])], ctx.worktreePath);
        return JSON.stringify({ diff: diff.slice(0, 50_000), stat });
      },
    },
    {
      name: "git_log",
      description: "Show recent git log.",
      parameters: {
        type: "object",
        properties: {
          count: { type: "number", description: "Number of commits (default 10)" },
        },
      },
      execute: async (args) => {
        const count = String(args.count ?? 10);
        const log = gitExec(
          ["log", `--oneline`, `-n`, count],
          ctx.worktreePath,
        );
        return JSON.stringify({ log });
      },
    },
    {
      name: "git_commit",
      description: "Stage all changes and create a commit.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Commit message" },
        },
        required: ["message"],
      },
      execute: async (args) => {
        if (readOnly) {
          return JSON.stringify({ error: "Commits disabled in read-only mode" });
        }
        const message = String(args.message);
        const diff = gitExec(["diff"], ctx.worktreePath);
        const stagedDiff = gitExec(["diff", "--cached"], ctx.worktreePath);
        const fullDiff = diff + stagedDiff;

        if (secretScanner.hasHighConfidenceSecrets(fullDiff)) {
          return JSON.stringify({
            error: "Commit blocked: potential secrets detected in diff",
            findings: secretScanner.scanDiff(fullDiff),
          });
        }

        gitExec(["add", "-A"], ctx.worktreePath);
        const status = gitExec(["status", "--porcelain"], ctx.worktreePath);
        if (!status) {
          return JSON.stringify({ error: "Nothing to commit" });
        }

        gitExec(["commit", "-m", message], ctx.worktreePath);
        const sha = gitExec(["rev-parse", "HEAD"], ctx.worktreePath);
        return JSON.stringify({ success: true, sha, message });
      },
    },
  ];
}
