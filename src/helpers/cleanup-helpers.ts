import fs from "node:fs";
import path from "node:path";
import { getMacaiDir } from "../config/Config.js";
import { WorktreeManager } from "../git/WorktreeManager.js";

/**
 * Select orphaned worktrees that are under macai/* but don't have corresponding task directories
 */
export function selectOrphanedWorktrees(repoPath: string): string[] {
  const macaiDir = getMacaiDir(repoPath);
  if (!fs.existsSync(macaiDir)) {
    return [];
  }

  // Get all existing worktrees
  const worktreeManager = new WorktreeManager(repoPath);
  const allWorktrees = worktreeManager.listWorktrees();
  
  // Find macai worktrees (those under macai/*)
  const macaiWorktrees = allWorktrees.filter(worktree => 
    worktree.includes("macai/") && !worktree.includes(".git/worktrees")
  );
  
  // Get all task directories
  const tasksDir = path.join(macaiDir, "tasks");
  if (!fs.existsSync(tasksDir)) {
    return macaiWorktrees;
  }

  const taskDirs = fs.readdirSync(tasksDir)
    .filter(dir => fs.statSync(path.join(tasksDir, dir)).isDirectory())
    .map(dir => path.join(tasksDir, dir));

  // Check for orphaned worktrees (worktree exists but no corresponding task)
  const orphanedWorktrees: string[] = [];
  for (const worktreePath of macaiWorktrees) {
    const branchName = path.basename(worktreePath);
    const taskId = branchName.replace("macai/", "");
    
    const hasTaskDir = taskDirs.some(taskDir => 
      path.basename(taskDir) === taskId
    );
    
    if (!hasTaskDir) {
      orphanedWorktrees.push(worktreePath);
    }
  }

  return orphanedWorktrees;
}

/**
 * Select orphaned task directories that lack a non-empty investigation-report.md
 */
export function selectOrphanedTasks(repoPath: string): string[] {
  const macaiDir = getMacaiDir(repoPath);
  if (!fs.existsSync(macaiDir)) {
    return [];
  }

  // Get all task directories
  const tasksDir = path.join(macaiDir, "tasks");
  if (!fs.existsSync(tasksDir)) {
    return [];
  }

  const taskDirs = fs.readdirSync(tasksDir)
    .filter(dir => fs.statSync(path.join(tasksDir, dir)).isDirectory())
    .map(dir => path.join(tasksDir, dir));

  // Check for orphaned tasks (task dir exists but no corresponding worktree)
  const orphanedTasks: string[] = [];
  for (const taskDir of taskDirs) {
    const taskId = path.basename(taskDir);
    
    // Check if investigation-report.md exists and is non-empty
    const reportPath = path.join(taskDir, "investigation-report.md");
    let hasValidReport = false;
    
    if (fs.existsSync(reportPath)) {
      const content = fs.readFileSync(reportPath, "utf8");
      hasValidReport = content.trim().length > 0;
    }
    
    // If no valid report, this task should be pruned
    if (!hasValidReport) {
      orphanedTasks.push(taskDir);
    }
  }

  return orphanedTasks;
}