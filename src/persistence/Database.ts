import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type {
  AgentPhase,
  CheckpointState,
  RepoCommands,
  RunStatus,
  TaskMode,
  TaskStatus,
} from "../config/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadSchema(): string {
  const candidates = [
    path.join(__dirname, "schema.sql"),
    path.join(__dirname, "..", "..", "src", "persistence", "schema.sql"),
    path.join(process.cwd(), "src", "persistence", "schema.sql"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf8");
    }
  }
  throw new Error("schema.sql not found");
}

export interface RunRecord {
  id: string;
  project_id: number;
  status: RunStatus;
  started_at: string | null;
  ended_at: string | null;
  max_runtime_hours: number | null;
  stop_until: string | null;
  model: string;
  ollama_url: string;
  tasks_attempted: number;
  tasks_completed: number;
  tasks_failed: number;
  tasks_investigated: number;
  baseline_passed: number | null;
  baseline_failed: number | null;
  result_passed: number | null;
  result_failed: number | null;
  commits_created: number;
  runtime_ms: number | null;
}

export interface TaskRecord {
  id: string;
  run_id: string;
  title: string;
  description: string;
  mode: TaskMode;
  priority: number;
  status: TaskStatus;
  worktree_path: string | null;
  branch: string | null;
  base_commit: string | null;
  head_commit: string | null;
  failure_reason: string | null;
  attempts: number;
  started_at: string | null;
  ended_at: string | null;
}

export class MacaiDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(loadSchema());
  }

  close(): void {
    this.db.close();
  }

  getOrCreateProject(repoPath: string, commands?: RepoCommands): number {
    const normalized = path.resolve(repoPath);
    const existing = this.db
      .prepare("SELECT id FROM projects WHERE repo_path = ?")
      .get(normalized) as { id: number } | undefined;

    if (existing) {
      if (commands) {
        this.db
          .prepare("UPDATE projects SET detected_commands = ? WHERE id = ?")
          .run(JSON.stringify(commands), existing.id);
      }
      return existing.id;
    }

    const result = this.db
      .prepare(
        "INSERT INTO projects (repo_path, detected_commands) VALUES (?, ?)",
      )
      .run(normalized, commands ? JSON.stringify(commands) : null);
    return Number(result.lastInsertRowid);
  }

  createRun(data: {
    id: string;
    projectId: number;
    model: string;
    ollamaUrl: string;
    maxRuntimeHours?: number;
    stopUntil?: string;
    status?: RunStatus;
  }): void {
    const status = data.status ?? "queued";
    this.db
      .prepare(
        `INSERT INTO runs (id, project_id, status, started_at, model, ollama_url, max_runtime_hours, stop_until)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.id,
        data.projectId,
        status,
        status === "running" ? new Date().toISOString() : null,
        data.model,
        data.ollamaUrl,
        data.maxRuntimeHours ?? null,
        data.stopUntil ?? null,
      );
  }

  tryClaimRun(runId: string, projectId: number): boolean {
    const active = this.getRunningRun(projectId);
    if (active && active.id !== runId) {
      return false;
    }

    const result = this.db
      .prepare(
        `UPDATE runs SET status = 'running', started_at = COALESCE(started_at, datetime('now'))
         WHERE id = ? AND project_id = ? AND status = 'queued'`,
      )
      .run(runId, projectId);

    return result.changes > 0;
  }

  getNextQueuedRun(projectId: number): RunRecord | undefined {
    return this.db
      .prepare(
        `SELECT * FROM runs WHERE project_id = ? AND status = 'queued'
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(projectId) as RunRecord | undefined;
  }

  getQueuedRuns(projectId: number): RunRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM runs WHERE project_id = ? AND status = 'queued' ORDER BY created_at ASC`,
      )
      .all(projectId) as RunRecord[];
  }

  getQueuedRunPosition(runId: string, projectId: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as position FROM runs
         WHERE project_id = ? AND status = 'queued' AND created_at <= (
           SELECT created_at FROM runs WHERE id = ?
         )`,
      )
      .get(projectId, runId) as { position: number };
    return row.position;
  }

  finalizeInterruptedRuns(projectId: number): void {
    this.db
      .prepare(
        `UPDATE runs SET status = 'interrupted', ended_at = datetime('now')
         WHERE project_id = ? AND status = 'running'`,
      )
      .run(projectId);
  }

  getActiveRun(projectId: number): RunRecord | undefined {
    return this.getRunningRun(projectId) ?? this.getNextQueuedRun(projectId);
  }

  updateRun(id: string, updates: Partial<RunRecord>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (key === "id") continue;
      fields.push(`${key} = ?`);
      values.push(value);
    }

    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE runs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  finishRun(id: string, status: RunStatus, runtimeMs: number): void {
    this.db
      .prepare(
        `UPDATE runs SET status = ?, ended_at = datetime('now'), runtime_ms = ? WHERE id = ?`,
      )
      .run(status, runtimeMs, id);
  }

  getRun(id: string): RunRecord | undefined {
    return this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as
      | RunRecord
      | undefined;
  }

  getLatestRun(projectId: number): RunRecord | undefined {
    return this.db
      .prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(projectId) as RunRecord | undefined;
  }

  getRunningRun(projectId: number): RunRecord | undefined {
    return this.db
      .prepare("SELECT * FROM runs WHERE project_id = ? AND status = 'running' LIMIT 1")
      .get(projectId) as RunRecord | undefined;
  }

  createTask(data: {
    id: string;
    runId: string;
    title: string;
    description: string;
    mode: TaskMode;
    priority: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, run_id, title, description, mode, priority, status)
         VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
      )
      .run(data.id, data.runId, data.title, data.description, data.mode, data.priority);
  }

  updateTask(id: string, updates: Partial<TaskRecord>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (key === "id") continue;
      fields.push(`${key} = ?`);
      values.push(value);
    }

    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  getTask(id: string): TaskRecord | undefined {
    return this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | TaskRecord
      | undefined;
  }

  getTasksByRun(runId: string): TaskRecord[] {
    return this.db
      .prepare("SELECT * FROM tasks WHERE run_id = ? ORDER BY priority DESC, created_at ASC")
      .all(runId) as TaskRecord[];
  }

  getQueuedTasks(runId: string): TaskRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM tasks WHERE run_id = ? AND status = 'queued' ORDER BY priority DESC, created_at ASC",
      )
      .all(runId) as TaskRecord[];
  }

  getIncompleteTasks(): TaskRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM tasks WHERE status IN ('starting', 'planning', 'working', 'testing', 'reviewing')`,
      )
      .all() as TaskRecord[];
  }

  recordIteration(data: {
    taskId: string;
    phase: AgentPhase;
    iterationNum: number;
    promptSummary?: string;
    responseSummary?: string;
    promptTokens?: number;
    completionTokens?: number;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO iterations (task_id, phase, iteration_num, prompt_summary, response_summary, prompt_tokens, completion_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.taskId,
        data.phase,
        data.iterationNum,
        data.promptSummary ?? null,
        data.responseSummary ?? null,
        data.promptTokens ?? null,
        data.completionTokens ?? null,
      );
    return Number(result.lastInsertRowid);
  }

  recordToolCall(data: {
    taskId: string;
    iterationId?: number;
    toolName: string;
    argsJson?: string;
    resultPreview?: string;
    resultPath?: string;
    durationMs?: number;
    success?: boolean;
  }): void {
    this.db
      .prepare(
        `INSERT INTO tool_calls (task_id, iteration_id, tool_name, args_json, result_preview, result_path, duration_ms, success)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.taskId,
        data.iterationId ?? null,
        data.toolName,
        data.argsJson ?? null,
        data.resultPreview ?? null,
        data.resultPath ?? null,
        data.durationMs ?? null,
        data.success === false ? 0 : 1,
      );
  }

  recordCommand(data: {
    taskId: string;
    command: string;
    exitCode: number;
    stdoutPath?: string;
    stderrPath?: string;
    durationMs?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO commands (task_id, command, exit_code, stdout_path, stderr_path, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.taskId,
        data.command,
        data.exitCode,
        data.stdoutPath ?? null,
        data.stderrPath ?? null,
        data.durationMs ?? null,
      );
  }

  recordTestResult(data: {
    taskId: string;
    kind: "baseline" | "result";
    passed: number;
    failed: number;
    skipped: number;
    total: number;
    exitCode: number;
    outputPath: string;
    command: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO test_results (task_id, kind, passed, failed, skipped, total, exit_code, output_path, command)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.taskId,
        data.kind,
        data.passed,
        data.failed,
        data.skipped,
        data.total,
        data.exitCode,
        data.outputPath,
        data.command,
      );
  }

  recordCommit(taskId: string, sha: string, message: string): void {
    this.db
      .prepare("INSERT INTO commits (task_id, sha, message) VALUES (?, ?, ?)")
      .run(taskId, sha, message);
  }

  saveCheckpoint(taskId: string, label: string, state: CheckpointState): void {
    this.db
      .prepare("INSERT INTO checkpoints (task_id, label, state_json) VALUES (?, ?, ?)")
      .run(taskId, label, JSON.stringify(state));
  }

  getLatestCheckpoint(taskId: string): { label: string; state: CheckpointState } | undefined {
    const row = this.db
      .prepare(
        "SELECT label, state_json FROM checkpoints WHERE task_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(taskId) as { label: string; state_json: string } | undefined;

    if (!row) return undefined;
    return { label: row.label, state: JSON.parse(row.state_json) as CheckpointState };
  }

  recordObservation(data: {
    taskId?: string;
    runId?: string;
    kind: string;
    confidence: "high" | "medium" | "low";
    location?: string;
    message: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO observations (task_id, run_id, kind, confidence, location, message)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.taskId ?? null,
        data.runId ?? null,
        data.kind,
        data.confidence,
        data.location ?? null,
        data.message,
      );
  }

  getCommitsForRun(runId: string): Array<{ task_id: string; sha: string; message: string }> {
    return this.db
      .prepare(
        `SELECT c.task_id, c.sha, c.message FROM commits c
         JOIN tasks t ON t.id = c.task_id WHERE t.run_id = ?`,
      )
      .all(runId) as Array<{ task_id: string; sha: string; message: string }>;
  }

  getObservationsForRun(runId: string): Array<{
    kind: string;
    confidence: string;
    location: string | null;
    message: string;
  }> {
    return this.db
      .prepare("SELECT kind, confidence, location, message FROM observations WHERE run_id = ?")
      .all(runId) as Array<{
      kind: string;
      confidence: string;
      location: string | null;
      message: string;
    }>;
  }

  getToolCallsForTask(taskId: string): Array<{
    tool_name: string;
    result_preview: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT tool_name, result_preview FROM tool_calls
         WHERE task_id = ? ORDER BY id ASC`,
      )
      .all(taskId) as Array<{ tool_name: string; result_preview: string | null }>;
  }
}
