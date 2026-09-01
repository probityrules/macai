import fs from "node:fs";
import { gitExecFile } from "../git/gitBinary.js";
import { WorktreeManager } from "../git/WorktreeManager.js";
import { taskIdFromMacaiWorktree } from "../helpers/cleanup-helpers.js";
import {
  collectCleanupSummary,
  loadTaskStatusMap,
  removeBaselineLogs,
} from "../helpers/autoCleanup.js";
import { detachWorktreeNodeModules } from "../repo/RepoDetector.js";

export interface CleanupOptions {
  dryRun?: boolean;
  pruneTasks?: boolean;
  forceReports?: boolean;
  olderThanDays?: number;
}

export async function runCleanupCommand(repoPath: string, options: CleanupOptions = {}): Promise<void> {
  const dryRun = options.dryRun ?? false;
  const pruneTasks = options.pruneTasks ?? true;

  console.log(`macai cleanup — ${repoPath}`);
  if (dryRun) console.log("DRY RUN — no changes will be made\n");
  if (options.forceReports) console.log("Force mode — task dirs with reports may be removed\n");
  if (options.olderThanDays !== undefined) {
    console.log(`Age filter — only dirs older than ${options.olderThanDays} day(s)\n`);
  }

  const taskStatusById = loadTaskStatusMap(repoPath);
  const summary = collectCleanupSummary(repoPath, {
    forceReports: options.forceReports,
    olderThanDays: options.olderThanDays,
    taskStatusById,
  });
  const orphanedWorktrees = summary.orphanedWorktrees;
  const staleWorktreeDirs = summary.staleWorktreeDirs;
  const tasksToPrune = pruneTasks ? summary.prunableTaskDirs : [];
  const baselineLogsToRemove = summary.prunableBaselineLogs;

  console.log(`Orphaned git worktrees (${orphanedWorktrees.length}):`);
  for (const wt of orphanedWorktrees) console.log(`  ${wt}`);
  if (orphanedWorktrees.length === 0) console.log("  (none)");

  console.log(`\nStale worktree dirs on disk (${staleWorktreeDirs.length}):`);
  for (const wt of staleWorktreeDirs) console.log(`  ${wt}`);
  if (staleWorktreeDirs.length === 0) console.log("  (none)");

  console.log(`\nTask dirs to prune (${tasksToPrune.length}):`);
  for (const dir of tasksToPrune) console.log(`  ${dir}`);
  if (tasksToPrune.length === 0) console.log("  (none)");

  console.log(`\nRun baseline logs to remove (${baselineLogsToRemove.length}):`);
  for (const logPath of baselineLogsToRemove) console.log(`  ${logPath}`);
  if (baselineLogsToRemove.length === 0) console.log("  (none)");

  if (dryRun) return;

  const worktreeManager = new WorktreeManager(repoPath);

  for (const worktreePath of orphanedWorktrees) {
    try {
      worktreeManager.removeWorktreeAt(worktreePath, true);
      const taskId = taskIdFromMacaiWorktree(worktreePath);
      if (taskId) {
        try {
          gitExecFile(["branch", "-D", `macai/${taskId}`], { cwd: repoPath });
        } catch {
          // branch may already be gone
        }
      }
      console.log(`Removed worktree ${worktreePath}`);
    } catch (err) {
      console.error(`Failed to remove worktree ${worktreePath}:`, err);
    }
  }

  for (const worktreePath of staleWorktreeDirs) {
    try {
      detachWorktreeNodeModules(worktreePath);
      fs.rmSync(worktreePath, { recursive: true, force: true });
      console.log(`Removed stale worktree dir ${worktreePath}`);
    } catch (err) {
      console.error(`Failed to remove stale dir ${worktreePath}:`, err);
    }
  }

  for (const taskDir of tasksToPrune) {
    try {
      fs.rmSync(taskDir, { recursive: true, force: true });
      console.log(`Removed task dir ${taskDir}`);
    } catch (err) {
      console.error(`Failed to remove task dir ${taskDir}:`, err);
    }
  }

  removeBaselineLogs(baselineLogsToRemove);
  for (const logPath of baselineLogsToRemove) {
    console.log(`Removed baseline log ${logPath}`);
  }
}
