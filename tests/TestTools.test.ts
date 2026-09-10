import { describe, it, expect, vi } from "vitest";
import { createTestTools } from "../src/tools/TestTools.js";
import { createTestAppConfig } from "./helpers/tempMacaiRepo.js";

describe("createTestTools", () => {
  it("should execute test commands with correct parameters", async () => {
    const calls: Array<{ command: string; cwd: string }> = [];
    const mockRunShell = vi.fn(async (command, cwd) => {
      calls.push({ command, cwd });
      return JSON.stringify({ exitCode: 0, output: "ok" });
    });

    const config = createTestAppConfig();
    const ctx = { worktreePath: "/tmp/test-worktree", logDir: "/tmp/test-logs" };
    const tools = new Map(
      createTestTools(config, ctx as any, mockRunShell).map(t => [t.name, t])
    );

    await tools.get("run_tests")!.execute({});
    await tools.get("run_linter")!.execute({});
    await tools.get("run_build")!.execute({});

    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual(
      expect.objectContaining({ command: "npm test", cwd: "/tmp/test-worktree" })
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({ command: "npm run lint", cwd: "/tmp/test-worktree" })
    );
    expect(calls[2]).toEqual(
      expect.objectContaining({ command: "npm run build", cwd: "/tmp/test-worktree" })
    );
  });
});