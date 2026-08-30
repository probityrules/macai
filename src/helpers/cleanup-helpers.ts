import fs from "node:fs";
import path from "node:path";
import { getMacaiDir } from "../config/Config.js";

export function isMacaiWorktreePath(worktreePath: string): boolean {
  const normalized = worktreePath.replace(/\\/g, "/");
  return /\/\.macai\/tasks\/[^/]+\/worktree$/.test(normalized);
}

export function taskIdFromMacaiWorktree(worktreePath: string): string | null {
  const normalized = worktreePath.replace(/\\/g, "/");
  const match = normalized.match(/\/\.macai\/tasks\/([^/]+)\/worktree$/);
  return match?.[1] ?? null;
}

export function hasNonEmptyReport(taskDir: string): boolean {
  const reportPath = path.join(taskDir, "investigation-report.md");
  if (!fs.existsSync(reportPath)) return false;
  return fs.readFileSync(reportPath, "utf8").trim().length > 0;
}

/** Worktrees under .macai/tasks/{id}/worktree with no matching task directory. */
export function selectOrphanedWorktrees(repoPath: string, worktreePaths: string[]): string[] {
  const tasksDir = path.join(getMacaiDir(repoPath), "tasks");
  const taskIds = fs.existsSync(tasksDir)
    ? fs
        .readdirSync(tasksDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [];

  return worktreePaths.filter((worktreePath) => {
    if (!isMacaiWorktreePath(worktreePath)) return false;
    const taskId = taskIdFromMacaiWorktree(worktreePath);
    return taskId !== null && !taskIds.includes(taskId);
  });
}

/**
 * Task dirs lacking a non-empty investigation-report.md (optional prune targets).
 */
export function selectTasksWithoutReport(repoPath: string): string[] {
  const tasksDir = path.join(getMacaiDir(repoPath), "tasks");
  if (!fs.existsSync(tasksDir)) return [];

  return fs
    .readdirSync(tasksDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(tasksDir, e.name))
    .filter((taskDir) => {
      if (fs.existsSync(path.join(taskDir, "worktree"))) return false;
      return !hasNonEmptyReport(taskDir);
    });
}

export function previewReport(reportPath: string, maxLines = 12): string {
  if (!fs.existsSync(reportPath)) return "(missing)";
  const lines = fs.readFileSync(reportPath, "utf8").split("\n");
  const head = lines.slice(0, maxLines).join("\n");
  return lines.length > maxLines ? `${head}\n… (${lines.length - maxLines} more lines)` : head;
}
