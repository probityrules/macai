import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig, JobStartOptions, StartOptions, TaskDefinition } from "../config/types.js";
import {
  ensureMacaiDir,
  ensureTaskDir,
  getMacaiDbPath,
  loadConfig,
  loadTasksFile,
  mergeConfig,
} from "../config/Config.js";
import { MacaiDatabase } from "../persistence/Database.js";
import { OllamaClient } from "../ollama/OllamaClient.js";
import { WorktreeManager } from "../git/WorktreeManager.js";
import { RepoDetector, runTestCommand, getTestCommand } from "../repo/RepoDetector.js";
import { AgentController } from "../agent/AgentController.js";
import { TaskQueue } from "./TaskQueue.js";
import { Scheduler } from "./Scheduler.js";
import { ReportGenerator } from "../reporting/ReportGenerator.js";

export interface JobManagerOptions extends JobStartOptions {}

export class JobManager {
  private db!: MacaiDatabase;
  private repoPath: string;
  private runId: string;
  private scheduler: Scheduler;
  private config: AppConfig;

  constructor(private options: JobManagerOptions) {
    this.repoPath = path.resolve(options.repo);
    this.runId = randomUUID().slice(0, 8);
    this.scheduler = new Scheduler({ hours: options.hours, until: options.until });
    this.config = options.appConfig;
  }

  async run(): Promise<void> {
    ensureMacaiDir(this.repoPath);
    this.db = new MacaiDatabase(getMacaiDbPath(this.repoPath));

    const detector = new RepoDetector();
    const detected = detector.detect(this.repoPath, this.config.repo);
    this.config.repo = { ...detected.commands, ...this.config.repo };

    const projectId = this.db.getOrCreateProject(this.repoPath, detected.commands);
    const existingRun = this.db.getRunningRun(projectId);
    if (existingRun) {
      console.log(`Resuming or conflicting run detected: ${existingRun.id}`);
    }

    const ollama = new OllamaClient(this.config.ollama);
    const health = await ollama.healthCheck();
    if (!health.ok) {
      throw new Error(`Ollama health check failed: ${health.error}`);
    }

    this.db.createRun({
      id: this.runId,
      projectId,
      model: this.config.ollama.model,
      ollamaUrl: this.config.ollama.baseUrl,
      maxRuntimeHours: this.options.hours,
      stopUntil: this.options.until,
    });

    const taskDefs =
      this.options.taskDefinitions ??
      (this.options.tasks ? loadTasksFile(this.options.tasks) : []);

    if (taskDefs.length === 0) {
      throw new Error("No tasks provided");
    }

    const queue = new TaskQueue(this.db, this.runId);
    queue.enqueueAll(taskDefs);

    const worktreeManager = new WorktreeManager(this.repoPath);
    const baseBranch = this.options.baseBranch ?? worktreeManager.getCurrentBranch();

    let baselinePassed: number | null = null;
    let baselineFailed: number | null = null;
    const testCmd = getTestCommand(this.config, detected);
    if (testCmd) {
      const baselinePath = path.join(ensureMacaiDir(this.repoPath), "baseline-tests.log");
      const baseline = await runTestCommand(
        testCmd,
        this.repoPath,
        baselinePath,
        this.config.limits.commandTimeoutMs,
      );
      baselinePassed = baseline.counts.passed;
      baselineFailed = baseline.counts.failed;
      this.db.updateRun(this.runId, {
        baseline_passed: baselinePassed,
        baseline_failed: baselineFailed,
      } as never);
    }

    let tasksAttempted = 0;
    let tasksCompleted = 0;
    let tasksFailed = 0;
    let tasksInvestigated = 0;
    let commitsCreated = 0;
    let resultPassed = baselinePassed;
    let resultFailed = baselineFailed;

    console.log(`\nmacai run ${this.runId} started`);
    console.log(`Repository: ${this.repoPath}`);
    console.log(`Model: ${this.config.ollama.model}`);
    console.log(`Tasks: ${taskDefs.length}\n`);

    while (!this.scheduler.shouldStop()) {
      const task = queue.getNext();
      if (!task) break;

      tasksAttempted++;
      const taskDir = ensureTaskDir(this.repoPath, task.id);
      const logPath = path.join(taskDir, "run.log");
      const logStream = fs.createWriteStream(logPath, { flags: "a" });

      const log = (line: string): void => {
        const msg = `[${new Date().toISOString()}] ${line}\n`;
        logStream.write(msg);
        console.log(line);
      };

      log(`--- Task ${task.id}: ${task.title} ---`);

      const worktree = worktreeManager.createWorktree(task.id, baseBranch);
      this.db.updateTask(task.id, {
        worktree_path: worktree.worktreePath,
        branch: worktree.branch,
        base_commit: worktree.baseCommit,
        status: "starting",
      });

      let baseline;
      if (testCmd) {
        const baselinePath = path.join(taskDir, "baseline.log");
        baseline = await runTestCommand(
          testCmd,
          worktree.worktreePath,
          baselinePath,
          this.config.limits.commandTimeoutMs,
        );
        this.db.recordTestResult({
          taskId: task.id,
          kind: "baseline",
          passed: baseline.counts.passed,
          failed: baseline.counts.failed,
          skipped: baseline.counts.skipped,
          total: baseline.counts.total,
          exitCode: baseline.exitCode,
          outputPath: baseline.outputPath,
          command: baseline.command,
        });
      }

      const controller = new AgentController({
        config: this.config,
        ollama,
        db: this.db,
        task,
        worktreePath: worktree.worktreePath,
        logDir: taskDir,
        baseline,
        onLog: log,
        shouldStop: () => this.scheduler.shouldStop(),
      });

      const result = await controller.run();

      if (result.success) {
        tasksCompleted++;
        if (task.mode === "investigation") tasksInvestigated++;
        if (result.commitSha) {
          commitsCreated++;
          this.db.updateTask(task.id, { head_commit: result.commitSha });
        }
        log(`Completed: ${task.title}`);
      } else {
        tasksFailed++;
        log(`Failed: ${task.title} — ${result.failureReason}`);
      }

      logStream.end();

      if (testCmd && result.success) {
        const resultPath = path.join(taskDir, "result.log");
        const testResult = await runTestCommand(
          testCmd,
          worktree.worktreePath,
          resultPath,
          this.config.limits.commandTimeoutMs,
        );
        resultPassed = testResult.counts.passed;
        resultFailed = testResult.counts.failed;
      }

      this.db.updateRun(this.runId, {
        tasks_attempted: tasksAttempted,
        tasks_completed: tasksCompleted,
        tasks_failed: tasksFailed,
        tasks_investigated: tasksInvestigated,
        commits_created: commitsCreated,
        result_passed: resultPassed ?? undefined,
        result_failed: resultFailed ?? undefined,
      } as never);

      if (this.scheduler.shouldStop()) break;
    }

    const runtimeMs = this.scheduler.getRuntimeMs();
    const status = this.scheduler.isCancelled() ? "cancelled" : "completed";
    this.db.finishRun(this.runId, status, runtimeMs);

    const reporter = new ReportGenerator(this.db, this.repoPath);
    const reportPath = reporter.generateRunReport(this.runId);
    console.log(`\nRun finished. Report: ${reportPath}`);
    console.log(`Runtime: ${formatDuration(runtimeMs)}`);

    this.db.close();
  }

  static async recoverIncomplete(repoPath: string): Promise<void> {
    const dbPath = getMacaiDbPath(repoPath);
    if (!fs.existsSync(dbPath)) return;

    const db = new MacaiDatabase(dbPath);
    const incomplete = db.getIncompleteTasks();
    const worktreeManager = new WorktreeManager(repoPath);

    for (const task of incomplete) {
      if (!task.worktree_path) {
        db.updateTask(task.id, { status: "blocked", failure_reason: "No worktree found" });
        continue;
      }
      const status = worktreeManager.getWorktreeStatus(task.worktree_path);
      if (!status.clean) {
        db.recordObservation({
          taskId: task.id,
          kind: "recovery",
          confidence: "medium",
          message: `Interrupted task with dirty worktree: ${status.modified.join(", ")}`,
        });
      }
      db.updateTask(task.id, {
        status: "blocked",
        failure_reason: "Interrupted — inspect worktree before resuming",
      });
    }

    db.close();
  }
}

export function createJobManager(options: StartOptions): JobManager {
  const baseConfig = loadConfig(options.config);
  const appConfig = mergeConfig(baseConfig, {
    model: options.model,
    ollamaUrl: options.ollamaUrl,
  });

  return new JobManager({
    ...options,
    appConfig,
  });
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
