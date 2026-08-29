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
    const taskId = "a1b2c3d4e5f67890";
    const macaiDir = path.join(repoPath, ".macai", "tasks", taskId);
    fs.mkdirSync(macaiDir, { recursive: true });

    const manager = new WorktreeManager(repoPath);
    const info = manager.createWorktree(taskId);

    expect(fs.existsSync(info.worktreePath)).toBe(true);
    expect(info.branch).toBe(`macai/${taskId}`);

    const status = manager.getWorktreeStatus(info.worktreePath);
    expect(status.clean).toBe(true);
    expect(status.branch).toBe(`macai/${taskId}`);
  });

  it("creates worktree from an explicit base ref (commit)", () => {
    fs.writeFileSync(path.join(repoPath, "extra.txt"), "v1\n");
    execFileSync("git", ["add", "."], { cwd: repoPath });
    execFileSync("git", ["commit", "-m", "second"], { cwd: repoPath });
    const tip = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoPath,
      encoding: "utf8",
    }).trim();
    const parent = execFileSync("git", ["rev-parse", "HEAD~1"], {
      cwd: repoPath,
      encoding: "utf8",
    }).trim();

    const taskId = "b2c3d4e5f6789012";
    fs.mkdirSync(path.join(repoPath, ".macai", "tasks", taskId), { recursive: true });

    const manager = new WorktreeManager(repoPath);
    const info = manager.createWorktree(taskId, { baseRef: parent });

    expect(info.baseCommit).toBe(parent);
    expect(info.baseCommit).not.toBe(tip);
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: info.worktreePath,
      encoding: "utf8",
    }).trim();
    expect(head).toBe(parent);
  });
});
