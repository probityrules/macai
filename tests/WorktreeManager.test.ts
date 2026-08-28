import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WorktreeManager } from "../src/git/WorktreeManager.js";

describe("WorktreeManager", () => {
  let tmpDir: string;
  let repoPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macai-test-"));
    repoPath = path.join(tmpDir, "repo");
    fs.mkdirSync(repoPath);
    execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoPath });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoPath });
    fs.writeFileSync(path.join(repoPath, "README.md"), "# Test\n");
    execFileSync("git", ["add", "."], { cwd: repoPath });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoPath });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates isolated worktree and branch", () => {
    const macaiDir = path.join(repoPath, ".macai", "tasks", "task-001");
    fs.mkdirSync(macaiDir, { recursive: true });

    const manager = new WorktreeManager(repoPath);
    const info = manager.createWorktree("task-001");

    expect(fs.existsSync(info.worktreePath)).toBe(true);
    expect(info.branch).toBe("macai/task-001");

    const status = manager.getWorktreeStatus(info.worktreePath);
    expect(status.clean).toBe(true);
    expect(status.branch).toBe("macai/task-001");
  });
});
