import fs from "node:fs";
import path from "node:path";
import { getMacaiDbPath, getTaskDir } from "../config/Config.js";
import { gitExecFile } from "../git/gitBinary.js";
import { WorktreeManager } from "../git/WorktreeManager.js";
import {
  selectOrphanedWorktrees,
  selectTasksWithoutReport,
} from "../helpers/cleanup-helpers.js";

export async function runCleanupCommand(
  repoPath: string,
  options: { dryRun?: boolean; pruneTasks?: boolean } = {},
): Promise<void> {
  const dryRun = options.dryRun ?? false;
  const pruneTasks = options.pruneTasks ?? true;

  console.log(`macai cleanup — ${repoPath}`);
  if (dryRun) console.log("DRY RUN — no changes will be made\n");

  const worktreeManager = new WorktreeManager(repoPath);
  const allWorktrees = worktreeManager.listWorktrees();
  const orphanedWorktrees = selectOrphanedWorktrees(repoPath, allWorktrees);
  const tasksToPrune = pruneTasks ? selectTasksWithoutReport(repoPath) : [];

  console.log(`Orphaned worktrees (${orphanedWorktrees.length}):`);
  for (const wt of orphanedWorktrees) console.log(`  ${wt}`);
  if (orphanedWorktrees.length === 0) console.log("  (none)");

  console.log(`\nTask dirs without report (${tasksToPrune.length}):`);
  for (const dir of tasksToPrune) console.log(`  ${dir}`);
  if (tasksToPrune.length === 0) console.log("  (none)");

  if (dryRun) return;

  for (const worktreePath of orphanedWorktrees) {
    try {
      worktreeManager.removeWorktreeAt(worktreePath, true);
      const taskId = path.basename(path.dirname(worktreePath));
      try {
        gitExecFile(["branch", "-D", `macai/${taskId}`], { cwd: repoPath });
      } catch {
        // branch may already be gone
      }
      console.log(`Removed worktree ${worktreePath}`);
    } catch (err) {
      console.error(`Failed to remove worktree ${worktreePath}:`, err);
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
