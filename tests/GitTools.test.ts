import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SecretScanner } from "../src/security/SecretScanner.js";
import { createGitTools } from "../src/tools/GitTools.js";
import type { ToolContext } from "../src/tools/types.js";

describe("GitTools", () => {
  let tmpDir: string;
  let repoPath: string;
  let ctx: ToolContext;
  let tools: Map<string, { execute: (args: Record<string, unknown>) => Promise<string> }>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macai-gittools-"));
    repoPath = path.join(tmpDir, "repo");
    fs.mkdirSync(repoPath);
    execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoPath });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoPath });
    fs.writeFileSync(path.join(repoPath, "README.md"), "# Test\n");
    execFileSync("git", ["add", "."], { cwd: repoPath });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoPath });

    ctx = {
      worktreePath: repoPath,
      taskId: "gittask",
      readOnly: false,
      logDir: path.join(repoPath, ".macai", "tasks", "gittask"),
    };
    tools = new Map(createGitTools(ctx, new SecretScanner()).map((tool) => [tool.name, tool]));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("git_status reports branch and clean state", async () => {
    const result = JSON.parse(await tools.get("git_status")!.execute({}));
    expect(result.branch).toBe("main");
    expect(result.status).toBe("clean");
  });

  it("git_log returns recent commits", async () => {
    const result = JSON.parse(await tools.get("git_log")!.execute({ count: 5 }));
    expect(result.log).toContain("init");
  });

  it("git_commit stages and commits changes", async () => {
    fs.writeFileSync(path.join(repoPath, "feature.txt"), "new\n");
    const result = JSON.parse(
      await tools.get("git_commit")!.execute({ message: "add feature" }),
    );
    expect(result.success).toBe(true);
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("blocks git_commit in read-only mode", async () => {
    ctx.readOnly = true;
    const readOnlyTools = new Map(
      createGitTools(ctx, new SecretScanner()).map((tool) => [tool.name, tool]),
    );
    fs.writeFileSync(path.join(repoPath, "blocked.txt"), "x\n");
    const result = JSON.parse(
      await readOnlyTools.get("git_commit")!.execute({ message: "nope" }),
    );
    expect(result.error).toMatch(/read-only/i);
  });

  it("blocks commit when diff contains high-confidence secrets", async () => {
    fs.writeFileSync(
      path.join(repoPath, "README.md"),
      "# Test\napi_key=abcdefghijklmnopqrstuvwxyz12345\n",
    );
    const result = JSON.parse(
      await tools.get("git_commit")!.execute({ message: "add secrets" }),
    );
    expect(result.error).toMatch(/secrets detected/i);
    expect(result.findings?.length).toBeGreaterThan(0);
  });
});
