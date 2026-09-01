import fs from "node:fs";
import path from "node:path";
import { getMacaiDir } from "../config/Config.js";

export const TERMINAL_TASK_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "blocked",
  "timed_out",
  "skipped",
]);

export interface TaskDirInfo {
  taskId: string;
  dir: string;
  hasReport: boolean;
  hasWorktreeDir: boolean;
  mtimeMs: number;
}

export function isMacaiWorktreePath(worktreePath: string): boolean {
  const normalized = worktreePath.replace(/\\/g, "/");
  return /\/\.macai\/tasks\/[^/]+\/worktree$/.test(normalized);
}

export function taskIdFromMacaiWorktree(worktreePath: string): string | null {
  const normalized = worktreePath.replace(/\\/g, "/");
  const match = normalized.match(/\/\.macai\/tasks\/([^/]+)\/worktree$/);
  return match?.[1] ?? null;
}

export function taskIdFromTaskDir(taskDir: string): string {
  return path.basename(taskDir);
}

export function hasNonEmptyReport(taskDir: string): boolean {
  const reportPath = path.join(taskDir, "investigation-report.md");
  if (!fs.existsSync(reportPath)) return false;
  return fs.readFileSync(reportPath, "utf8").trim().length > 0;
}

export function listTaskDirs(repoPath: string): TaskDirInfo[] {
  const tasksDir = path.join(getMacaiDir(repoPath), "tasks");
  if (!fs.existsSync(tasksDir)) return [];

  return fs
    .readdirSync(tasksDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = path.join(tasksDir, e.name);
      const wt = path.join(dir, "worktree");
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(dir).mtimeMs;
        const runLog = path.join(dir, "run.log");
        if (fs.existsSync(runLog)) {
          mtimeMs = Math.max(mtimeMs, fs.statSync(runLog).mtimeMs);
        }
      } catch {
        // ignore
      }
      return {
        taskId: e.name,
        dir,
        hasReport: hasNonEmptyReport(dir),
        hasWorktreeDir: fs.existsSync(wt),
        mtimeMs,
      };
    });
}

/** Worktrees under .macai/tasks/{id}/worktree with no matching task directory. */
export function selectOrphanedWorktrees(repoPath: string, worktreePaths: string[]): string[] {
  const taskIds = new Set(listTaskDirs(repoPath).map((t) => t.taskId));

  return worktreePaths.filter((worktreePath) => {
    if (!isMacaiWorktreePath(worktreePath)) return false;
    const taskId = taskIdFromMacaiWorktree(worktreePath);
    return taskId !== null && !taskIds.has(taskId);
  });
}

/** Worktree dirs on disk that git no longer registers. */
export function selectStaleWorktreeDirs(repoPath: string, registeredWorktrees: string[]): string[] {
  const registered = new Set(registeredWorktrees.map((p) => path.resolve(p)));
  const stale: string[] = [];

  for (const info of listTaskDirs(repoPath)) {
    if (!info.hasWorktreeDir) continue;
    const wt = path.join(info.dir, "worktree");
    if (!registered.has(path.resolve(wt))) stale.push(wt);
  }

  return stale;
}

export interface PruneTaskOptions {
  forceReports?: boolean;
  olderThanDays?: number;
  /** task id → status from MacaiDatabase */
  taskStatusById?: Map<string, string>;
  /** run IDs whose baseline-{id}.log should be kept (e.g. active run) */
  keepRunIds?: Set<string>;
  nowMs?: number;
}

export function selectPrunableTaskDirs(repoPath: string, options: PruneTaskOptions = {}): string[] {
  const { forceReports = false, olderThanDays, taskStatusById, nowMs = Date.now() } = options;
  const minAgeMs = olderThanDays !== undefined ? olderThanDays * 86_400_000 : 0;

  return listTaskDirs(repoPath)
    .filter((info) => {
      if (info.hasReport && !forceReports) return false;
      if (info.hasWorktreeDir) return false;

      if (taskStatusById) {
        const status = taskStatusById.get(info.taskId);
        if (status && !TERMINAL_TASK_STATUSES.has(status)) return false;
        if (!status && info.hasReport) return false;
      } else if (info.hasReport && !forceReports) {
        return false;
      }

      if (olderThanDays !== undefined && nowMs - info.mtimeMs < minAgeMs) return false;
      return true;
    })
    .map((info) => info.dir);
}

/** @deprecated use selectPrunableTaskDirs */
export function selectTasksWithoutReport(repoPath: string): string[] {
  return selectPrunableTaskDirs(repoPath);
}

export function runIdFromBaselineLog(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const match = normalized.match(/\/baseline-([a-f0-9]+)\.log$/i);
  return match?.[1] ?? null;
}

/** Run-level baseline logs under .macai/baseline-{runId}.log */
export function listRunBaselineLogs(repoPath: string): string[] {
  const macaiDir = getMacaiDir(repoPath);
  if (!fs.existsSync(macaiDir)) return [];

  return fs
    .readdirSync(macaiDir, { withFileTypes: true })
    .filter((e) => e.isFile() && /^baseline-[a-f0-9]+\.log$/i.test(e.name))
    .map((e) => path.join(macaiDir, e.name));
}

export function selectPrunableBaselineLogs(
  repoPath: string,
  options: Pick<PruneTaskOptions, "olderThanDays" | "keepRunIds" | "nowMs"> = {},
): string[] {
  const { olderThanDays, keepRunIds, nowMs = Date.now() } = options;
  const minAgeMs = olderThanDays !== undefined ? olderThanDays * 86_400_000 : 0;

  return listRunBaselineLogs(repoPath).filter((filePath) => {
    const runId = runIdFromBaselineLog(filePath);
    if (runId && keepRunIds?.has(runId)) return false;

    if (olderThanDays !== undefined) {
      try {
        if (nowMs - fs.statSync(filePath).mtimeMs < minAgeMs) return false;
      } catch {
        return false;
      }
    }

    return true;
  });
}

export function previewReport(reportPath: string, maxLines = 12): string {
  if (!fs.existsSync(reportPath)) return "(missing)";
  const lines = fs.readFileSync(reportPath, "utf8").split("\n");
  const head = lines.slice(0, maxLines).join("\n");
  return lines.length > maxLines ? `${head}\n… (${lines.length - maxLines} more lines)` : head;
}
