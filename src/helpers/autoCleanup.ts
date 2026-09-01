import fs from "node:fs";
import path from "node:path";
import { getMacaiDbPath, getMacaiDir } from "../config/Config.js";
import { WorktreeManager } from "../git/WorktreeManager.js";
import { MacaiDatabase } from "../persistence/Database.js";
import {
  type PruneTaskOptions,
  selectOrphanedWorktrees,
  selectPrunableBaselineLogs,
  selectPrunableTaskDirs,
  selectStaleWorktreeDirs,
} from "./cleanup-helpers.js";

export interface CleanupSummary {
  orphanedWorktrees: string[];
  staleWorktreeDirs: string[];
  prunableTaskDirs: string[];
  prunableBaselineLogs: string[];
}

export function loadTaskStatusMap(repoPath: string): Map<string, string> | undefined {
  const dbPath = getMacaiDbPath(repoPath);
  if (!fs.existsSync(dbPath)) return undefined;

  const db = new MacaiDatabase(dbPath);
  try {
    const projectId = db.getOrCreateProject(repoPath);
    const runs = db.getRecentTasksForProject(projectId, 500);
    const map = new Map<string, string>();
    for (const task of runs) map.set(task.id, task.status);
    return map;
  } finally {
    db.close();
  }
}

export function loadActiveRunIds(repoPath: string): Set<string> {
  const dbPath = getMacaiDbPath(repoPath);
  if (!fs.existsSync(dbPath)) return new Set();

  const db = new MacaiDatabase(dbPath);
  try {
    const projectId = db.getOrCreateProject(repoPath);
    const running = db.getRunningRun(projectId);
    return running ? new Set([running.id]) : new Set();
  } finally {
    db.close();
  }
}

export function collectCleanupSummary(
  repoPath: string,
  options: PruneTaskOptions = {},
): CleanupSummary {
  const keepRunIds = options.keepRunIds ?? loadActiveRunIds(repoPath);
  const registered = new WorktreeManager(repoPath).listWorktrees();
  return {
    orphanedWorktrees: selectOrphanedWorktrees(repoPath, registered),
    staleWorktreeDirs: selectStaleWorktreeDirs(repoPath, registered),
    prunableTaskDirs: selectPrunableTaskDirs(repoPath, options),
    prunableBaselineLogs: selectPrunableBaselineLogs(repoPath, {
      olderThanDays: options.olderThanDays,
      keepRunIds,
      nowMs: options.nowMs,
    }),
  };
}

export function removeBaselineLogs(filePaths: string[]): void {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore per-file removal errors
    }
  }
}

export function removeRunBaselineLog(repoPath: string, runId: string): void {
  const filePath = path.join(getMacaiDir(repoPath), `baseline-${runId}.log`);
  removeBaselineLogs([filePath]);
}

/**
 * Formats a dry-run summary for orphaned worktrees
 */
export function formatOrphanedWorktreesSummary(worktreePaths: string[]): string {
  if (worktreePaths.length === 0) {
    return "No orphaned worktrees found.";
  }

  const lines = [`Found ${worktreePaths.length} orphaned worktree(s):`];
  for (const worktreePath of worktreePaths) {
    lines.push(`  - ${worktreePath}`);
  }
  return lines.join("\n");
}

/**
 * Formats a dry-run summary for stale worktree directories
 */
export function formatStaleWorktreeDirsSummary(staleDirs: string[]): string {
  if (staleDirs.length === 0) {
    return "No stale worktree directories found.";
  }

  const lines = [`Found ${staleDirs.length} stale worktree directory(ies):`];
  for (const dir of staleDirs) {
    lines.push(`  - ${dir}`);
  }
  return lines.join("\n");
}

/**
 * Formats a dry-run summary for prunable task directories
 */
export function formatPrunableTaskDirsSummary(taskDirs: string[]): string {
  if (taskDirs.length === 0) {
    return "No prunable task directories found.";
  }

  const lines = [`Found ${taskDirs.length} prunable task directory(ies):`];
  for (const dir of taskDirs) {
    const taskName = path.basename(dir);
    lines.push(`  - ${taskName} (${dir})`);
  }
  return lines.join("\n");
}

/**
 * Formats a dry-run summary for run-level baseline logs
 */
export function formatPrunableBaselineLogsSummary(logPaths: string[]): string {
  if (logPaths.length === 0) {
    return "No run baseline logs to remove.";
  }

  const lines = [`Found ${logPaths.length} run baseline log(s):`];
  for (const logPath of logPaths) {
    lines.push(`  - ${logPath}`);
  }
  return lines.join("\n");
}

/**
 * Formats a complete cleanup dry-run summary report
 */
export function formatCleanupSummaryReport(summary: CleanupSummary): string {
  const lines: string[] = ["## Cleanup Suggestions", ""];

  lines.push("### Orphaned Worktrees");
  lines.push(formatOrphanedWorktreesSummary(summary.orphanedWorktrees));
  lines.push("");

  lines.push("### Stale Worktree Directories");
  lines.push(formatStaleWorktreeDirsSummary(summary.staleWorktreeDirs));
  lines.push("");

  lines.push("### Prunable Task Directories");
  lines.push(formatPrunableTaskDirsSummary(summary.prunableTaskDirs));
  lines.push("");

  lines.push("### Run Baseline Logs");
  lines.push(formatPrunableBaselineLogsSummary(summary.prunableBaselineLogs));
  lines.push("");

  return lines.join("\n");
}
