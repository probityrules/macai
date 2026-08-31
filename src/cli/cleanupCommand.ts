import fs from "node:fs";
import path from "node:path";
import { getMacaiDbPath } from "../config/Config.js";
import { gitExecFile } from "../git/gitBinary.js";
import { WorktreeManager } from "../git/WorktreeManager.js";
import {
  selectOrphanedWorktrees,
  selectPrunableTaskDirs,
  selectStaleWorktreeDirs,
  taskIdFromMacaiWorktree,
} from "../helpers/cleanup-helpers.js";
import { MacaiDatabase } from "../persistence/Database.js";
import { detachWorktreeNodeModules } from "../repo/RepoDetector.js";

export interface CleanupOptions {
  dryRun?: boolean;
  pruneTasks?: boolean;
  forceReports?: boolean;
  olderThanDays?: number;
}

function loadTaskStatusMap(repoPath: string): Map<string, string> | undefined {
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

export async function runCleanupCommand(repoPath: string, options: CleanupOptions = {}): Promise<void> {
  const dryRun = options.dryRun ?? false;
  const pruneTasks = options.pruneTasks ?? true;

  console.log(`macai cleanup — ${repoPath}`);
  if (dryRun) console.log("DRY RUN — no changes will be made\n");
  if (options.forceReports) console.log("Force mode — task dirs with reports may be removed\n");
  if (options.olderThanDays !== undefined) {
    console.log(`Age filter — only dirs older than ${options.olderThanDays} day(s)\n`);
  }

  const worktreeManager = new WorktreeManager(repoPath);
  const registered = worktreeManager.listWorktrees();
  const orphanedWorktrees = selectOrphanedWorktrees(repoPath, registered);
  const staleWorktreeDirs = selectStaleWorktreeDirs(repoPath, registered);
  const taskStatusById = loadTaskStatusMap(repoPath);
  const tasksToPrune = pruneTasks
    ? selectPrunableTaskDirs(repoPath, {
        forceReports: options.forceReports,
        olderThanDays: options.olderThanDays,
        taskStatusById,
      })
    : [];

  console.log(`Orphaned git worktrees (${orphanedWorktrees.length}):`);
  for (const wt of orphanedWorktrees) console.log(`  ${wt}`);
  if (orphanedWorktrees.length === 0) console.log("  (none)");

  console.log(`\nStale worktree dirs on disk (${staleWorktreeDirs.length}):`);
  for (const wt of staleWorktreeDirs) console.log(`  ${wt}`);
  if (staleWorktreeDirs.length === 0) console.log("  (none)");

  console.log(`\nTask dirs to prune (${tasksToPrune.length}):`);
  for (const dir of tasksToPrune) console.log(`  ${dir}`);
  if (tasksToPrune.length === 0) console.log("  (none)");

  if (dryRun) return;

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
}
