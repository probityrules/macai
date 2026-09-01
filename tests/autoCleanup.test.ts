import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  collectCleanupSummary,
  formatCleanupSummaryReport,
  formatOrphanedWorktreesSummary,
  removeBaselineLogs,
} from "../src/helpers/autoCleanup.js";

describe("autoCleanup", () => {
  let tmpDir: string;
  let repoPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macai-autocleanup-"));
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

  it("returns empty arrays on a clean repo", () => {
    const summary = collectCleanupSummary(repoPath);
    expect(summary.orphanedWorktrees).toEqual([]);
    expect(summary.staleWorktreeDirs).toEqual([]);
    expect(summary.prunableTaskDirs).toEqual([]);
    expect(summary.prunableBaselineLogs).toEqual([]);
  });

  it("detects stale worktree dir when disk exists but git does not register it", () => {
    const taskId = "staletask12345678";
    const worktreePath = path.join(repoPath, ".macai", "tasks", taskId, "worktree");
    fs.mkdirSync(worktreePath, { recursive: true });
    fs.writeFileSync(path.join(worktreePath, "marker.txt"), "stale\n");

    const summary = collectCleanupSummary(repoPath);
    expect(summary.staleWorktreeDirs).toContain(worktreePath);
  });

  it("excludes task dirs with investigation reports unless forceReports", () => {
    const taskDir = path.join(repoPath, ".macai", "tasks", "inv1234567890ab");
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, "investigation-report.md"), "# findings\n");

    expect(collectCleanupSummary(repoPath).prunableTaskDirs).not.toContain(taskDir);
    expect(
      collectCleanupSummary(repoPath, { forceReports: true }).prunableTaskDirs,
    ).toContain(taskDir);
  });

  it("formats orphaned worktree summary", () => {
    const wt = path.join(repoPath, ".macai", "tasks", "abc", "worktree");
    const text = formatOrphanedWorktreesSummary([wt]);
    expect(text).toContain("Found 1 orphaned worktree");
    expect(text).toContain(wt);
    expect(formatOrphanedWorktreesSummary([])).toContain("No orphaned worktrees");
  });

  it("formats full cleanup report from summary", () => {
    const report = formatCleanupSummaryReport({
      orphanedWorktrees: [],
      staleWorktreeDirs: [path.join(repoPath, ".macai", "tasks", "x", "worktree")],
      prunableTaskDirs: [],
      prunableBaselineLogs: [path.join(repoPath, ".macai", "baseline-abc.log")],
    });
    expect(report).toContain("## Cleanup Suggestions");
    expect(report).toContain("### Stale Worktree Directories");
    expect(report).toContain("Found 1 stale worktree");
    expect(report).toContain("### Run Baseline Logs");
    expect(report).toContain("baseline-abc.log");
  });

  it("removeBaselineLogs deletes listed files", () => {
    const macaiDir = path.join(repoPath, ".macai");
    fs.mkdirSync(macaiDir, { recursive: true });
    const logPath = path.join(macaiDir, "baseline-deadbeef.log");
    fs.writeFileSync(logPath, "output\n");

    removeBaselineLogs([logPath]);
    expect(fs.existsSync(logPath)).toBe(false);
  });
});
