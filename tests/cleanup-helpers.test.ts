import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isMacaiWorktreePath,
  taskIdFromMacaiWorktree,
  hasNonEmptyReport,
  selectOrphanedWorktrees,
  selectTasksWithoutReport,
  previewReport,
} from "../src/helpers/cleanup-helpers.js";
import { formatTaskReview } from "../src/cli/reviewCommand.js";

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

  it("selects task dirs without non-empty reports", () => {
    const withReport = path.join(tmp, ".macai", "tasks", "has-report");
    const emptyReport = path.join(tmp, ".macai", "tasks", "empty-report");
    fs.mkdirSync(withReport, { recursive: true });
    fs.mkdirSync(emptyReport, { recursive: true });
    fs.writeFileSync(path.join(withReport, "investigation-report.md"), "# findings\n");
    fs.writeFileSync(path.join(emptyReport, "investigation-report.md"), "   ");

    expect(hasNonEmptyReport(withReport)).toBe(true);
    expect(hasNonEmptyReport(emptyReport)).toBe(false);
    expect(selectTasksWithoutReport(tmp)).toEqual([emptyReport]);
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
