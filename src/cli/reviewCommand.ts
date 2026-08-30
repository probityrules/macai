import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { getMacaiDir, getTaskDir } from "../config/Config.js";
import { WorktreeManager } from "../git/WorktreeManager.js";
import { MacaiDatabase } from "../persistence/Database.js";

export async function runReviewCommand(taskId: string, repoPath: string) {
  console.log(`Running macai review for task: ${taskId}`);
  console.log("");

  const macaiDir = getMacaiDir(repoPath);
  if (!fs.existsSync(macaiDir)) {
    console.log("No macai directory found.");
    return;
  }

  // Get the task directory
  const taskDir = getTaskDir(macaiDir, taskId);
  if (!fs.existsSync(taskDir)) {
    console.log(`Task directory not found: ${taskDir}`);
    return;
  }

  // Check if this is a coding task (has worktree) or investigation task
  const dbPath = path.join(macaiDir, "database.sqlite");
  if (!fs.existsSync(dbPath)) {
    console.log("No database found.");
    return;
  }

  const db = new MacaiDatabase(dbPath);
  const projectId = db.getOrCreateProject(repoPath);
  const run = db.getLatestRun(projectId);
  
  if (!run) {
    console.log("No runs found.");
    db.close();
    return;
  }

  // Get task info from database
  const task = db.getTaskById(taskId);
  if (!task) {
    console.log(`Task not found: ${taskId}`);
    db.close();
    return;
  }

  // Print basic task information
  console.log("Task Information:");
  console.log("=================");
  console.log(`Status:     ${task.status}`);
  console.log(`Mode:       ${task.mode}`);
  console.log(`Title:      ${task.title}`);
  console.log(`Branch:     ${task.branch ?? "N/A"}`);
  console.log(`Worktree:   ${task.worktree_path ?? "N/A"}`);
  console.log("");

  // If it's a coding task, show git information
  if (task.mode === "coding" && task.branch) {
    const worktreePath = task.worktree_path;
    
    if (worktreePath && fs.existsSync(worktreePath)) {
      console.log("Worktree Information:");
      console.log("=====================");
      console.log(`Path:       ${worktreePath}`);
      
      // Get git log -1
      try {
        const wt = new WorktreeManager(worktreePath);
        const currentBranch = wt.getCurrentBranch();
        console.log(`Branch:     ${currentBranch}`);
        
        // Show git log -1
        const logOutput = wt.git(["log", "-1", "--oneline"]);
        console.log("Last commit:");
        console.log(logOutput.trim());
        
        // Show diffstat vs main if branch exists
        try {
          const hasMainBranch = wt.git(["branch", "--list", "main"]).trim() !== "";
          if (hasMainBranch) {
            const diffStat = wt.git(["diff", "--stat", "main"]);
            console.log("Diff vs main:");
            console.log(diffStat.trim());
          } else {
            console.log("No main branch found for diff comparison");
          }
        } catch (err) {
          console.log("Could not get diff vs main:", err instanceof Error ? err.message : String(err));
        }
      } catch (err) {
        console.log("Could not get git information:", err instanceof Error ? err.message : String(err));
      }
    } else {
      console.log("Worktree path does not exist:", worktreePath);
    }
  }

  // Show investigation report if exists
  const investigationReportPath = path.join(taskDir, "investigation-report.md");
  if (fs.existsSync(investigationReportPath)) {
    console.log("\nInvestigation Report:");
    console.log("=====================");
    const reportContent = fs.readFileSync(investigationReportPath, "utf8");
    console.log(reportContent);
  } else {
    console.log("\nNo investigation report found for this task.");
  }

  db.close();
}

export function reviewCommand(): Command {
  return new Command()
    .command("review <task-id>")
    .description("Review a specific task by ID")
    .option("--repo <path>", "Path to the git repository", process.cwd())
    .action(async (taskId: string, opts) => {
      try {
        await runReviewCommand(taskId, opts.repo);
      } catch (err) {
        console.error("Error:", err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}