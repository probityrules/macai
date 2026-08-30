import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { getMacaiDir, getTaskDir } from "../config/Config.js";
import { WorktreeManager } from "../git/WorktreeManager.js";
import { detachWorktreeNodeModules } from "../repo/RepoDetector.js";

export async function runCleanupCommand(repoPath: string, dryRun: boolean = false) {
  console.log(`Running macai cleanup in repository: ${repoPath}`);
  if (dryRun) {
    console.log("DRY RUN MODE - No changes will be made");
    console.log("");
  }

  const macaiDir = getMacaiDir(repoPath);
  if (!fs.existsSync(macaiDir)) {
    console.log("No macai directory found. Nothing to clean up.");
    return;
  }

  // Get all existing worktrees
  const worktreeManager = new WorktreeManager(repoPath);
  const allWorktrees = worktreeManager.listWorktrees();
  
  // Find macai worktrees (those under macai/*)
  const macaiWorktrees = allWorktrees.filter(worktree => 
    worktree.includes("macai/") && !worktree.includes(".git/worktrees")
  );
  
  console.log(`Found ${macaiWorktrees.length} potential macai worktrees`);
  
  // Get all task directories
  const tasksDir = path.join(macaiDir, "tasks");
  if (!fs.existsSync(tasksDir)) {
    console.log("No tasks directory found.");
    return;
  }

  const taskDirs = fs.readdirSync(tasksDir)
    .filter(dir => fs.statSync(path.join(tasksDir, dir)).isDirectory())
    .map(dir => path.join(tasksDir, dir));

  console.log(`Found ${taskDirs.length} task directories`);

  // Identify orphaned worktrees and tasks
  const orphanedWorktrees: string[] = [];
  const orphanedTasks: string[] = [];

  // Check for orphaned worktrees (worktree exists but no corresponding task)
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

  // Check for orphaned tasks (task dir exists but no corresponding worktree)
  for (const taskDir of taskDirs) {
    const taskId = path.basename(taskDir);
    const branchName = `macai/${taskId}`;
    
    const hasWorktree = allWorktrees.some(worktree => 
      worktree.includes(branchName)
    );
    
    if (!hasWorktree) {
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
  }

  console.log("\nOrphaned worktrees to clean:");
  for (const worktree of orphanedWorktrees) {
    console.log(`  ${worktree}`);
  }

  console.log("\nOrphaned tasks to prune:");
  for (const taskDir of orphanedTasks) {
    console.log(`  ${taskDir}`);
  }

  // Perform cleanup if not in dry run mode
  if (!dryRun) {
    // Clean up orphaned worktrees first
    for (const worktreePath of orphanedWorktrees) {
      try {
        console.log(`\nRemoving worktree: ${worktreePath}`);
        
        // Detach any linked node_modules before removing worktree
        detachWorktreeNodeModules(worktreePath);
        
        // Remove the worktree using git
        const args = ["worktree", "remove", worktreePath];
        worktreeManager.git(args);
        console.log(`✓ Removed worktree: ${worktreePath}`);
      } catch (error) {
        console.error(`✗ Failed to remove worktree ${worktreePath}:`, error instanceof Error ? error.message : String(error));
      }
    }

    // Clean up orphaned task directories
    for (const taskDir of orphanedTasks) {
      try {
        console.log(`\nRemoving task directory: ${taskDir}`);
        fs.rmSync(taskDir, { recursive: true, force: true });
        console.log(`✓ Removed task directory: ${taskDir}`);
      } catch (error) {
        console.error(`✗ Failed to remove task directory ${taskDir}:`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  console.log("\nCleanup completed.");
}

export function cleanupCommand(): Command {
  return new Command()
    .command("cleanup")
    .description("Remove orphaned macai/* worktrees/branches and prune task directories without valid investigation-report.md")
    .option("--repo <path>", "Path to the git repository", process.cwd())
    .option("--dry-run", "Show what would be cleaned up without actually doing it")
    .action(async (opts) => {
      try {
        await runCleanupCommand(opts.repo, opts.dryRun);
      } catch (err) {
        console.error("Error:", err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}