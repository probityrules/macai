import type { AppConfig } from "../config/types.js";
import type { ToolContext, ToolDefinition } from "./types.js";

export function createTestTools(
  config: AppConfig,
  ctx: ToolContext,
  runShell: (command: string, cwd: string, outputPath: string) => Promise<string>,
): ToolDefinition[] {
  return [
    {
      name: "run_tests",
      description: "Run the project test suite.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const command = config.repo.test ?? "npm test";
        const outputPath = `${ctx.logDir}/tests-${Date.now()}.log`;
        return runShell(command, ctx.worktreePath, outputPath);
      },
    },
    {
      name: "run_linter",
      description: "Run the project linter.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const command = config.repo.lint ?? "npm run lint";
        const outputPath = `${ctx.logDir}/lint-${Date.now()}.log`;
        return runShell(command, ctx.worktreePath, outputPath);
      },
    },
    {
      name: "run_build",
      description: "Run the project build.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const command = config.repo.build ?? "npm run build";
        const outputPath = `${ctx.logDir}/build-${Date.now()}.log`;
        return runShell(command, ctx.worktreePath, outputPath);
      },
    },
  ];
}
