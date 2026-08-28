import fs from "node:fs";
import path from "node:path";
import { getMacaiDir } from "../config/Config.js";
import type { MacaiDatabase } from "../persistence/Database.js";

export class ReportGenerator {
  constructor(
    private db: MacaiDatabase,
    private repoPath: string,
  ) {}

  generateRunReport(runId: string): string {
    const run = this.db.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    const tasks = this.db.getTasksByRun(runId);
    const commits = this.db.getCommitsForRun(runId);
    const observations = this.db.getObservationsForRun(runId);

    const lines: string[] = [
      "# macai Run Report",
      "",
      `Date: ${new Date().toISOString().slice(0, 10)}`,
      `Run ID: ${runId}`,
      "",
      "## Summary",
      "",
      `- Tasks attempted: ${run.tasks_attempted}`,
      `- Tasks completed: ${run.tasks_completed}`,
      `- Tasks failed: ${run.tasks_failed}`,
      `- Tasks investigated: ${run.tasks_investigated}`,
      `- Commits created: ${run.commits_created}`,
      "",
    ];

    if (run.baseline_passed !== null) {
      lines.push(
        `- Tests before run: ${run.baseline_passed} passing${run.baseline_failed ? `, ${run.baseline_failed} failing` : ""}`,
      );
    }
    if (run.result_passed !== null) {
      lines.push(
        `- Tests after run: ${run.result_passed} passing${run.result_failed ? `, ${run.result_failed} failing` : ""}`,
      );
    }

    lines.push(
      `- Runtime: ${formatDuration(run.runtime_ms ?? 0)}`,
      `- Model: ${run.model}`,
      `- Status: ${run.status}`,
      "",
    );

    const completed = tasks.filter((t) => t.status === "completed");
    if (completed.length > 0) {
      lines.push("## Completed Tasks", "");
      for (const task of completed) {
        lines.push(`### ${task.id} — ${task.title}`, "");
        lines.push(`Status: ${task.status}`, "");
        if (task.head_commit) {
          lines.push(`Commit: ${task.head_commit.slice(0, 8)}`, "");
        }
        if (task.branch) {
          lines.push(`Branch: ${task.branch}`, "");
        }
        lines.push("");
      }
    }

    const failed = tasks.filter((t) =>
      ["failed", "blocked", "timed_out", "cancelled"].includes(t.status),
    );
    if (failed.length > 0) {
      lines.push("## Failed / Blocked Tasks", "");
      for (const task of failed) {
        lines.push(`### ${task.id} — ${task.title}`, "");
        lines.push(`Status: ${task.status}`, "");
        if (task.failure_reason) {
          lines.push(`Reason: ${task.failure_reason}`, "");
        }
        lines.push(`Attempts: ${task.attempts}`, "", "");
      }
    }

    if (observations.length > 0) {
      lines.push("## Observations", "");
      for (const obs of observations) {
        const loc = obs.location ? ` (${obs.location})` : "";
        lines.push(`### ${obs.kind}${loc}`, "");
        lines.push(`Confidence: ${obs.confidence}`, "", obs.message, "", "");
      }
    }

    if (commits.length > 0) {
      lines.push("## Commits", "");
      for (const c of commits) {
        lines.push(`- \`${c.sha.slice(0, 8)}\` ${c.task_id}: ${c.message.split("\n")[0]}`);
      }
      lines.push("");
    }

    lines.push("## Suggested Manual Follow-up", "");
    if (failed.length > 0) {
      lines.push(`1. Review failed tasks: ${failed.map((t) => t.id).join(", ")}`);
    }
    lines.push("2. Inspect branches `macai/task-*` and merge selectively");
    lines.push("3. Verify test results in `.macai/tasks/*/run.log`");
    lines.push("");

    const report = lines.join("\n");
    const reportDir = getMacaiDir(this.repoPath);
    fs.mkdirSync(reportDir, { recursive: true });

    const aggregatePath = path.join(reportDir, "macai-report.md");
    fs.writeFileSync(aggregatePath, report, "utf8");

    for (const task of tasks) {
      const taskReport = this.generateTaskReport(task);
      const taskDir = path.join(reportDir, "tasks", task.id);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, "report.md"), taskReport, "utf8");
    }

    return aggregatePath;
  }

  private generateTaskReport(task: {
    id: string;
    title: string;
    status: string;
    mode: string;
    branch: string | null;
    head_commit: string | null;
    failure_reason: string | null;
  }): string {
    const taskDir = path.join(getMacaiDir(this.repoPath), "tasks", task.id);
    const investigationPath = path.join(taskDir, "investigation-report.md");
    const hasInvestigationReport =
      (task.mode === "investigation" || task.mode === "review") &&
      fs.existsSync(investigationPath) &&
      fs.readFileSync(investigationPath, "utf8").trim().length > 0;

    return [
      `# Task Report: ${task.title}`,
      "",
      `- ID: ${task.id}`,
      `- Status: ${task.status}`,
      `- Mode: ${task.mode}`,
      task.branch ? `- Branch: ${task.branch}` : "",
      task.head_commit ? `- Commit: ${task.head_commit}` : "",
      task.failure_reason ? `- Failure: ${task.failure_reason}` : "",
      hasInvestigationReport ? `- Investigation report: ${investigationPath}` : "",
      "",
    ]
      .filter(Boolean)
      .join("\n");
  }
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
