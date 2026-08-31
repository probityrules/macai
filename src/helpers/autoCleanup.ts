import fs from "node:fs";
import path from "node:path";
import { getMacaiDir } from "../config/Config.js";
import {
  listTaskDirs,
  selectOrphanedWorktrees,
  selectPrunableTaskDirs,
  selectStaleWorktreeDirs,
} from "./cleanup-helpers.js";

export interface CleanupSummary {
  orphanedWorktrees: string[];
  staleWorktreeDirs: string[];
  prunableTaskDirs: string[];
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
 * Generates a comprehensive cleanup dry-run summary
 */
export function generateCleanupSummary(repoPath: string): CleanupSummary {
  // Get all registered worktrees from the repository
  const macaiDir = getMacaiDir(repoPath);
  const worktreePaths: string[] = [];
  
  // Find all worktree paths in .macai/tasks/*/worktree
  try {
    const tasksDir = path.join(macaiDir, "tasks");
    if (fs.existsSync(tasksDir)) {
      const taskDirs = fs.readdirSync(tasksDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => path.join(tasksDir, dirent.name));
      
      for (const taskDir of taskDirs) {
        const worktreePath = path.join(taskDir, "worktree");
        if (fs.existsSync(worktreePath)) {
          worktreePaths.push(worktreePath);
        }
      }
    }
  } catch (error) {
    // Ignore errors when reading worktrees
  }

  // Get registered worktrees from git
  const registeredWorktrees: string[] = [];
  try {
    const wtManager = new (await import("../git/WorktreeManager.js")).WorktreeManager(repoPath);
    const worktrees = wtManager.listWorktrees();
    for (const wt of worktrees) {
      if (wt.path) {
        registeredWorktrees.push(wt.path);
      }
    }
  } catch (error) {
    // Ignore errors when getting registered worktrees
  }

  // Find orphaned worktrees (worktree dirs with no matching task directory)
  const orphanedWorktrees = selectOrphanedWorktrees(repoPath, worktreePaths);

  // Find stale worktree directories (dirs on disk that git no longer registers)
  const staleWorktreeDirs = selectStaleWorktreeDirs(repoPath, registeredWorktrees);

  // Find prunable task directories
  const prunableTaskDirs = selectPrunableTaskDirs(repoPath);

  return {
    orphanedWorktrees,
    staleWorktreeDirs,
    prunableTaskDirs,
  };
}

/**
 * Formats a complete cleanup dry-run summary report
 */
export function formatCleanupSummaryReport(repoPath: string): string {
  const summary = generateCleanupSummary(repoPath);
  
  const lines: string[] = [
    "## Cleanup Suggestions",
    "",
  ];

  lines.push("### Orphaned Worktrees");
  lines.push(formatOrphanedWorktreesSummary(summary.orphanedWorktrees));
  lines.push("");

  lines.push("### Stale Worktree Directories");
  lines.push(formatStaleWorktreeDirsSummary(summary.staleWorktreeDirs));
  lines.push("");

  lines.push("### Prunable Task Directories");
  lines.push(formatPrunableTaskDirsSummary(summary.prunableTaskDirs));
  lines.push("");

  return lines.join("\n");
}