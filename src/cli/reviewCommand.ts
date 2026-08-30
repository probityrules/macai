import fs from "node:fs";
import path from "node:path";
import { getMacaiDbPath, getTaskDir } from "../config/Config.js";
import { gitExecFile } from "../git/gitBinary.js";
import { previewReport } from "../helpers/cleanup-helpers.js";
import { MacaiDatabase } from "../persistence/Database.js";

export function formatTaskReview(
  task: {
    id: string;
    status: string;
    mode: string;
    title: string;
    branch: string | null;
    worktree_path: string | null;
  },
  reportPreview: string,
  gitSummary?: { lastCommit?: string; diffStat?: string },
): string {
  const lines = [
    `Task: ${task.id}`,
    `Status: ${task.status}`,
    `Mode: ${task.mode}`,
    `Title: ${task.title}`,
    `Branch: ${task.branch ?? "N/A"}`,
    `Worktree: ${task.worktree_path ?? "N/A"}`,
    "",
    "Investigation report preview:",
    reportPreview,
  ];
  if (gitSummary?.lastCommit) {
    lines.push("", "Last commit:", gitSummary.lastCommit);
  }
  if (gitSummary?.diffStat) {
    lines.push("", "Diff vs main:", gitSummary.diffStat);
  }
  return lines.join("\n");
}

export async function runReviewCommand(taskId: string, repoPath: string): Promise<void> {
  const dbPath = getMacaiDbPath(repoPath);
  if (!fs.existsSync(dbPath)) {
    console.log("No macai database found.");
    return;
  }

  const db = new MacaiDatabase(dbPath);
  const task = db.getTask(taskId);
  if (!task) {
    console.log(`Task not found: ${taskId}`);
    db.close();
    return;
  }

  const reportPath = path.join(getTaskDir(repoPath, taskId), "investigation-report.md");
  const reportPreview = previewReport(reportPath);

  let gitSummary: { lastCommit?: string; diffStat?: string } | undefined;
  if (task.branch) {
    try {
      gitSummary = {
        lastCommit: gitExecFile(["log", "-1", "--oneline", task.branch], { cwd: repoPath }),
        diffStat: gitExecFile(["diff", "--stat", "main...HEAD"], {
          cwd: task.worktree_path && fs.existsSync(task.worktree_path) ? task.worktree_path : repoPath,
        }),
      };
    } catch {
      // git info optional
    }
  }

  console.log(formatTaskReview(task, reportPreview, gitSummary));
  db.close();
}
