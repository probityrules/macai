import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { collectCleanupSummary, formatCleanupSummaryReport, formatOrphanedWorktreesSummary, removeBaselineLogs } from "../src/helpers/autoCleanup.js";
import { createTempGitRepo } from "./helpers/tempMacaiRepo.ts";

describe("cleanup-helpers", () => {
  let tmpDir: string;
  let repoPath: string;

  beforeEach(() => {
    const tempRepo = createTempGitRepo("macai-cleanup-helpers-");
    tmpDir = tempRepo.tmpDir;
    repoPath = tempRepo.repoPath;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("collects cleanup summary with dryRun option", () => {
    const summary = collectCleanupSummary(repoPath);
    expect(summary.orphanedWorktrees).toEqual([]);
    expect(summary.staleWorktreeDirs).toEqual([]);
    expect(summary.prunableTaskDirs).toEqual([]);
    expect(summary.prunableBaselineLogs).toEqual([]);
  });

  it("formats orphaned worktree summary correctly", () => {
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

  it("removes baseline logs correctly", () => {
    const macaiDir = path.join(repoPath, ".macai");
    fs.mkdirSync(macaiDir, { recursive: true });
    const logPath = path.join(macaiDir, "baseline-deadbeef.log");
    fs.writeFileSync(logPath, "output\n");

    removeBaselineLogs([logPath]);
    expect(fs.existsSync(logPath)).toBe(false);
  });
});