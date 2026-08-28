import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { execa } from "execa";
import type { AppConfig, ShellCommandKind } from "../config/types.js";
import { ShellGuard, truncateOutput } from "../security/ShellGuard.js";
import { SecretScanner } from "../security/SecretScanner.js";
import type { ToolContext, ToolDefinition } from "./types.js";
import { createFileTools } from "./FileTools.js";
import { createGitTools } from "./GitTools.js";
import { createTestTools } from "./TestTools.js";

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private shellGuard: ShellGuard;
  private secretScanner: SecretScanner;

  constructor(
    private config: AppConfig,
    private ctx: ToolContext,
    private onCommand?: (data: {
      command: string;
      exitCode: number;
      stdoutPath?: string;
      stderrPath?: string;
      durationMs: number;
    }) => void,
  ) {
    this.shellGuard = new ShellGuard(config);
    this.secretScanner = new SecretScanner();
    this.registerAll();
  }

  private registerAll(): void {
    for (const tool of createFileTools(this.config, this.ctx, this.shellGuard)) {
      this.tools.set(tool.name, tool);
    }
    for (const tool of createGitTools(this.ctx, this.secretScanner)) {
      this.tools.set(tool.name, tool);
    }
    this.tools.set("run_command", this.createRunCommandTool());
    for (const tool of createTestTools(this.config, this.ctx, (cmd, cwd, out) =>
      this.runShell(cmd, cwd, out, "validation"),
    )) {
      this.tools.set(tool.name, tool);
    }
  }

  getTools(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  getOllamaTools(): Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return this.getTools().map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
    try {
      return await tool.execute(args);
    } catch (err) {
      return JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private createRunCommandTool(): ToolDefinition {
    return {
      name: "run_command",
      description: "Run a shell command in the task worktree. Subject to allowlist restrictions.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
        },
        required: ["command"],
      },
      execute: async (args) => {
        const command = String(args.command ?? "");
        const outputPath = path.join(this.ctx.logDir, `cmd-${Date.now()}.log`);
        return this.runShell(command, this.ctx.worktreePath, outputPath);
      },
    };
  }

  private async runShell(
    command: string,
    cwd: string,
    outputPath: string,
    kind: ShellCommandKind = "exploratory",
  ): Promise<string> {
    this.shellGuard.validateCommand(command, cwd);

    const signature = command.slice(0, 100);
    if (this.shellGuard.hasExceededRetries(signature, kind)) {
      const limit =
        kind === "validation"
          ? this.config.limits.maxRetriesPerValidationCommand
          : this.config.limits.maxRetriesPerCommand;
      return JSON.stringify({
        error: `Max retries exceeded for this ${kind} command (limit: ${limit})`,
      });
    }

    const start = Date.now();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const result = await execa(command, {
      cwd,
      shell: true,
      timeout: this.config.limits.commandTimeoutMs,
      reject: false,
      all: true,
    });

    const durationMs = Date.now() - start;
    const raw = result.all ?? [result.stdout, result.stderr].filter(Boolean).join("\n");
    const { text, truncated } = truncateOutput(raw, this.config.limits.maxOutputBytes);
    fs.writeFileSync(outputPath, raw, "utf8");

    this.onCommand?.({
      command,
      exitCode: result.exitCode ?? 1,
      stdoutPath: outputPath,
      durationMs,
    });

    return JSON.stringify({
      exitCode: result.exitCode ?? 1,
      output: text,
      truncated,
      outputPath: truncated ? outputPath : undefined,
    });
  }
}

export function resolveWorktreePath(worktreeRoot: string, filePath: string): string {
  const resolved = path.resolve(worktreeRoot, filePath);
  const normalizedRoot = path.resolve(worktreeRoot);
  if (!resolved.startsWith(normalizedRoot)) {
    throw new Error("Path escapes worktree");
  }
  return resolved;
}

export function gitExec(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
