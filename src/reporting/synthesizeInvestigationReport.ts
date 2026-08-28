import fs from "node:fs";
import path from "node:path";
import { getTaskDir } from "../config/Config.js";
import { InvestigationReporter } from "../agent/InvestigationReporter.js";
import type { MacaiDatabase } from "../persistence/Database.js";
import type { OllamaClient } from "../ollama/OllamaClient.js";
import type { CheckpointState } from "../config/types.js";

const EMPTY_CHECKPOINT: CheckpointState = {
  phase: "work",
  filesExamined: [],
  filesChanged: [],
  decisions: [],
  iteration: 0,
};

export async function synthesizeInvestigationReport(
  db: MacaiDatabase,
  ollama: OllamaClient,
  repoPath: string,
  taskId: string,
): Promise<string> {
  const task = db.getTask(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (task.mode !== "investigation" && task.mode !== "review") {
    throw new Error(`Task ${taskId} is mode "${task.mode}", not investigation/review`);
  }

  const checkpoint = db.getLatestCheckpoint(taskId);
  const state = checkpoint?.state ?? EMPTY_CHECKPOINT;
  const toolCalls = db.getToolCallsForTask(taskId);

  const reporter = new InvestigationReporter(ollama);
  const report = await reporter.generate({
    task,
    state,
    toolCalls,
  });

  const reportPath = path.join(getTaskDir(repoPath, taskId), "investigation-report.md");
  fs.writeFileSync(reportPath, report, "utf8");

  db.recordObservation({
    taskId,
    kind: "investigation_report",
    confidence: "high",
    message: report.slice(0, 1000),
  });

  return reportPath;
}
