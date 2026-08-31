import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isMacaiWorktreePath,
  taskIdFromMacaiWorktree,
  hasNonEmptyReport,
  selectOrphanedWorktrees,
  selectPrunableTaskDirs,
  selectStaleWorktreeDirs,
  previewReport,
} from "../src/helpers/cleanup-helpers.js";
import { formatTaskReview } from "../src/cli/reviewCommand.js";
import { checkCoveragePackages } from "../src/helpers/doctor-checks.js";

describe("cleanup-helpers", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "macai-cleanup-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("detects macai worktree paths", () => {
    expect(isMacaiWorktreePath(path.join(tmp, ".macai", "tasks", "abc123", "worktree"))).toBe(true);
    expect(isMacaiWorktreePath(path.join(tmp, ".git", "worktrees", "foo"))).toBe(false);
  });

  it("extracts task id from worktree path", () => {
    const wt = path.join(tmp, ".macai", "tasks", "abc123", "worktree");
    expect(taskIdFromMacaiWorktree(wt)).toBe("abc123");
    expect(taskIdFromMacaiWorktree("/tmp/worktree")).toBeNull();
  });

  it("selects orphaned worktrees missing task dirs", () => {
    const tasksDir = path.join(tmp, ".macai", "tasks", "abc123");
    fs.mkdirSync(tasksDir, { recursive: true });
    const worktrees = [
      path.join(tmp, ".macai", "tasks", "abc123", "worktree"),
      path.join(tmp, ".macai", "tasks", "missing", "worktree"),
    ];
    const orphaned = selectOrphanedWorktrees(tmp, worktrees);
    expect(orphaned).toEqual([path.join(tmp, ".macai", "tasks", "missing", "worktree")]);
  });

  it("selects stale worktree dirs not registered in git", () => {
    const taskDir = path.join(tmp, ".macai", "tasks", "abc123");
    const wt = path.join(taskDir, "worktree");
    fs.mkdirSync(wt, { recursive: true });
    const stale = selectStaleWorktreeDirs(tmp, []);
    expect(stale).toEqual([wt]);
  });

  it("keeps task dirs with reports unless force", () => {
    const withReport = path.join(tmp, ".macai", "tasks", "has-report");
    const empty = path.join(tmp, ".macai", "tasks", "empty");
    fs.mkdirSync(withReport, { recursive: true });
    fs.mkdirSync(empty, { recursive: true });
    fs.writeFileSync(path.join(withReport, "investigation-report.md"), "# findings\n");

    expect(hasNonEmptyReport(withReport)).toBe(true);
    expect(selectPrunableTaskDirs(tmp)).toEqual([empty]);
    expect(selectPrunableTaskDirs(tmp, { forceReports: true }).sort()).toEqual(
      [withReport, empty].sort(),
    );
  });

  it("prunes terminal-status coding tasks via db map", () => {
    const done = path.join(tmp, ".macai", "tasks", "done123");
    const active = path.join(tmp, ".macai", "tasks", "active456");
    fs.mkdirSync(done, { recursive: true });
    fs.mkdirSync(active, { recursive: true });

    const status = new Map([
      ["done123", "completed"],
      ["active456", "working"],
    ]);
    expect(selectPrunableTaskDirs(tmp, { taskStatusById: status })).toEqual([done]);
  });

  it("previewReport truncates long files", () => {
    const file = path.join(tmp, "report.md");
    fs.writeFileSync(file, ["line1", "line2", "line3"].join("\n"));
    expect(previewReport(file, 2)).toContain("line1");
    expect(previewReport(file, 2)).toContain("more lines");
  });
});

describe("formatTaskReview", () => {
  it("includes core fields", () => {
    const out = formatTaskReview(
      {
        id: "abc",
        status: "completed",
        mode: "coding",
        title: "Test task",
        branch: "macai/abc",
        worktree_path: "/tmp/wt",
      },
      "report preview",
      { lastCommit: "deadbeef task", diffStat: "1 file changed" },
    );
    expect(out).toContain("abc");
    expect(out).toContain("completed");
    expect(out).toContain("report preview");
    expect(out).toContain("deadbeef");
  });
});

describe("doctor-checks", () => {
  it("checkCoveragePackages passes when deps installed", () => {
    const result = checkCoveragePackages(process.cwd());
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
