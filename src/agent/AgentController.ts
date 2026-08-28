import fs from "node:fs";
import path from "node:path";
import type { AppConfig, AgentPhase, TaskMode } from "../config/types.js";
import type { MacaiDatabase, TaskRecord } from "../persistence/Database.js";
import type { OllamaClient, OllamaMessage } from "../ollama/OllamaClient.js";
import type { TestResult } from "../config/types.js";
import { ToolRegistry, gitExec } from "../tools/ToolRegistry.js";
import { ContextManager } from "./ContextManager.js";
import { isReadOnlyMode, nextPhase, statusForPhase } from "./AgentState.js";
import { getSystemPrompt, shouldSkipPlanning } from "./prompts/system.js";
import { Planner } from "./Planner.js";
import { Reviewer } from "./Reviewer.js";
import { InvestigationReporter } from "./InvestigationReporter.js";

export interface AgentRunContext {
  config: AppConfig;
  ollama: OllamaClient;
  db: MacaiDatabase;
  task: TaskRecord;
  worktreePath: string;
  logDir: string;
  baseline?: TestResult;
  onLog?: (line: string) => void;
  shouldStop?: () => boolean;
}

export interface AgentRunResult {
  success: boolean;
  headCommit?: string;
  commitSha?: string;
  failureReason?: string;
  filesChanged: string[];
  investigationReport?: string;
}

export class AgentController {
  private planner: Planner;
  private reviewer: Reviewer;
  private investigationReporter: InvestigationReporter;

  constructor(private ctx: AgentRunContext) {
    this.planner = new Planner(ctx.ollama);
    this.reviewer = new Reviewer(ctx.ollama);
    this.investigationReporter = new InvestigationReporter(ctx.ollama);
  }

  async run(): Promise<AgentRunResult> {
    const { task, worktreePath, logDir, config, db } = this.ctx;
    const readOnly = isReadOnlyMode(task.mode);

    let contextManager =
      ContextManager.loadFromCheckpoint(task.id, db) ??
      new ContextManager(task.id, db);

    const toolRegistry = new ToolRegistry(
      config,
      { worktreePath, taskId: task.id, readOnly, logDir },
      (cmd) => db.recordCommand({ taskId: task.id, ...cmd }),
    );

    db.updateTask(task.id, {
      status: "starting",
      started_at: new Date().toISOString(),
      attempts: task.attempts + 1,
    });

    this.log(`Starting task: ${task.title} (${task.mode})`);

    let phase: AgentPhase = contextManager.getState().phase ?? "understand";
    let messages: OllamaMessage[] = [];
    let filesChanged: string[] = [];
    let commitSha: string | undefined;

    try {
      while (phase !== "commit" || readOnly) {
        if (this.ctx.shouldStop?.()) {
          db.updateTask(task.id, { status: "cancelled" });
          return { success: false, failureReason: "Cancelled", filesChanged };
        }

        if (contextManager.getIteration() >= config.limits.maxIterations) {
          db.updateTask(task.id, {
            status: "timed_out",
            failure_reason: "Max iterations exceeded",
          });
          return { success: false, failureReason: "Max iterations exceeded", filesChanged };
        }

        contextManager.setPhase(phase);
        db.updateTask(task.id, { status: statusForPhase(phase) });

        if (phase === "understand") {
          await this.runPhaseUnderstand(contextManager, toolRegistry, messages, task);
          phase = shouldSkipPlanning(task.description) ? "work" : "plan";
          continue;
        }

        if (phase === "plan") {
          const plan = await this.planner.createPlan(
            task.description,
            contextManager.buildCompactContext(task),
          );
          contextManager.setPlan(plan);
          db.recordObservation({
            taskId: task.id,
            kind: "plan",
            confidence: "high",
            message: plan.slice(0, 500),
          });
          this.log(`Plan created (${plan.length} chars)`);
          phase = "work";
          continue;
        }

        if (phase === "work") {
          const workResult = await this.runToolLoop(
            contextManager,
            toolRegistry,
            task,
            task.mode === "investigation" ? "investigate" : phase,
            messages,
            task.mode === "investigation" ? 10 : 15,
          );
          messages = workResult.messages;
          filesChanged = workResult.filesChanged;

          if (readOnly && (task.mode === "investigation" || task.mode === "review")) {
            const report = await this.writeInvestigationReport(
              task,
              contextManager,
              workResult.lastResponse,
            );
            db.updateTask(task.id, {
              status: "completed",
              ended_at: new Date().toISOString(),
            });
            return {
              success: true,
              filesChanged: [],
              investigationReport: report,
            };
          }

          phase = filesChanged.length > 0 || !readOnly ? "test" : "review";
          continue;
        }

        if (phase === "test") {
          const testResult = await this.runValidation(contextManager, toolRegistry);
          if (testResult.passed) {
            phase = "review";
          } else {
            phase = "work";
            messages.push({
              role: "user",
              content: `Tests failed. Analyze and fix.\n${testResult.output.slice(0, 4000)}`,
            });
          }
          continue;
        }

        if (phase === "review") {
          if (readOnly) {
            const report = await this.writeInvestigationReport(task, contextManager);
            db.updateTask(task.id, {
              status: "completed",
              ended_at: new Date().toISOString(),
            });
            return {
              success: true,
              filesChanged: [],
              investigationReport: report,
            };
          }

          const diff = gitExec(["diff", "--stat"], worktreePath);
          const review = await this.reviewer.review(task.title, diff);
          if (review.approved) {
            phase = "commit";
          } else {
            messages.push({
              role: "user",
              content: `Review rejected:\n${review.feedback}\n\nFix issues and try again.`,
            });
            phase = "work";
          }
          continue;
        }

        break;
      }

      if (!readOnly && phase === "commit") {
        const commitMessage = `macai: ${task.title}\n\nTask: ${task.id}\nAgent: ${this.ctx.ollama.getModel()}`;
        const result = await toolRegistry.execute("git_commit", { message: commitMessage });
        const parsed = JSON.parse(result) as { sha?: string; error?: string };
        if (parsed.error) {
          db.updateTask(task.id, {
            status: "failed",
            failure_reason: parsed.error,
            ended_at: new Date().toISOString(),
          });
          return { success: false, failureReason: parsed.error, filesChanged };
        }
        commitSha = parsed.sha;
        if (commitSha) {
          db.recordCommit(task.id, commitSha, commitMessage);
        }
      }

      const head = gitExec(["rev-parse", "HEAD"], worktreePath);
      db.updateTask(task.id, {
        status: "completed",
        head_commit: head,
        ended_at: new Date().toISOString(),
      });

      return { success: true, headCommit: head, commitSha, filesChanged };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log(`Task failed: ${reason}`);
      db.updateTask(task.id, {
        status: "failed",
        failure_reason: reason,
        ended_at: new Date().toISOString(),
      });
      return { success: false, failureReason: reason, filesChanged };
    }
  }

  private async runPhaseUnderstand(
    contextManager: ContextManager,
    toolRegistry: ToolRegistry,
    messages: OllamaMessage[],
    task: TaskRecord,
  ): Promise<void> {
    messages.length = 0;
    messages.push({
      role: "system",
      content: getSystemPrompt(task.mode as TaskMode, "understand"),
    });
    messages.push({
      role: "user",
      content: `${contextManager.buildCompactContext(task)}\n\nExplore the repository. List key files, tests, and conventions.`,
    });

    await this.runToolLoop(contextManager, toolRegistry, task, "understand", messages, 5);
  }

  private async runToolLoop(
    contextManager: ContextManager,
    toolRegistry: ToolRegistry,
    task: TaskRecord,
    phase: AgentPhase | "investigate",
    messages: OllamaMessage[],
    maxIterations = 15,
  ): Promise<{ messages: OllamaMessage[]; filesChanged: string[]; lastResponse: string }> {
    const filesChanged: string[] = [];
    let lastResponse = "";
    const tools = toolRegistry.getOllamaTools();

    if (messages.length === 0 || messages[0].role !== "system") {
      messages.unshift({
        role: "system",
        content: getSystemPrompt(task.mode as TaskMode, phase),
      });
    }

    const recordPhase: AgentPhase = phase === "investigate" ? "work" : phase;

    for (let i = 0; i < maxIterations; i++) {
      contextManager.incrementIteration();

      if (contextManager.shouldCompact(messages.length)) {
        messages.splice(
          0,
          messages.length,
          ...contextManager.compactMessages(messages, task),
        );
      }

      const iterationId = this.ctx.db.recordIteration({
        taskId: task.id,
        phase: recordPhase,
        iterationNum: contextManager.getIteration(),
        promptSummary: messages.at(-1)?.content.slice(0, 200),
      });

      const response = await this.ctx.ollama.chat(messages, tools);
      lastResponse = response.message.content;
      messages.push({ role: "assistant", content: lastResponse });

      this.ctx.db.recordIteration({
        taskId: task.id,
        phase: recordPhase,
        iterationNum: contextManager.getIteration(),
        responseSummary: lastResponse.slice(0, 300),
        promptTokens: response.prompt_eval_count,
        completionTokens: response.eval_count,
      });

      const toolCalls = response.message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        break;
      }

      for (const call of toolCalls) {
        const toolName = call.function.name;
        const args = call.function.arguments;
        const start = Date.now();
        const result = await toolRegistry.execute(toolName, args);
        const durationMs = Date.now() - start;

        this.ctx.db.recordToolCall({
          taskId: task.id,
          iterationId,
          toolName,
          argsJson: JSON.stringify(args),
          resultPreview: result.slice(0, 500),
          durationMs,
        });

        if (["write_file", "edit_file"].includes(toolName) && args.path) {
          const p = String(args.path);
          filesChanged.push(p);
          contextManager.addFileChanged(p);
        }
        if (["read_file", "list_directory", "search_files"].includes(toolName) && args.path) {
          contextManager.addFileExamined(String(args.path));
        }

        messages.push({
          role: "tool",
          content: result,
          tool_name: toolName,
        });
      }

      if (filesChanged.length > this.ctx.config.limits.maxFilesChanged) {
        throw new Error(`Max files changed limit (${this.ctx.config.limits.maxFilesChanged}) exceeded`);
      }
    }

    return { messages, filesChanged, lastResponse };
  }

  private async runValidation(
    contextManager: ContextManager,
    toolRegistry: ToolRegistry,
  ): Promise<{ passed: boolean; output: string }> {
    const testCmd = this.ctx.config.repo.test;
    if (!testCmd) {
      return { passed: true, output: "No test command configured" };
    }

    const result = await toolRegistry.execute("run_tests", {});
    const parsed = JSON.parse(result) as { exitCode?: number; output?: string };

    const output = parsed.output ?? result;
    const exitCode = parsed.exitCode ?? 1;

    this.ctx.db.recordTestResult({
      taskId: this.ctx.task.id,
      kind: "result",
      passed: this.ctx.baseline?.counts.passed ?? 0,
      failed: exitCode === 0 ? 0 : 1,
      skipped: 0,
      total: 1,
      exitCode,
      outputPath: path.join(this.ctx.logDir, "validation.log"),
      command: testCmd,
    });

    fs.writeFileSync(path.join(this.ctx.logDir, "validation.log"), output, "utf8");

    if (this.ctx.baseline && exitCode !== 0) {
      contextManager.addDecision(
        `Baseline failures: ${this.ctx.baseline.counts.failed}. Current exit code: ${exitCode}`,
      );
    }

    return { passed: exitCode === 0, output };
  }

  private async writeInvestigationReport(
    task: TaskRecord,
    contextManager: ContextManager,
    workSummary?: string,
  ): Promise<string> {
    const toolCalls = this.ctx.db.getToolCallsForTask(task.id);
    const report = await this.investigationReporter.generate({
      task,
      state: contextManager.getState(),
      toolCalls,
      workSummary,
    });

    const reportPath = path.join(this.ctx.logDir, "investigation-report.md");
    fs.writeFileSync(reportPath, report, "utf8");

    this.ctx.db.recordObservation({
      taskId: task.id,
      kind: "investigation_report",
      confidence: "high",
      message: report.slice(0, 1000),
    });

    this.log(`Investigation report written (${report.length} chars)`);
    return report;
  }

  private log(line: string): void {
    this.ctx.onLog?.(line);
  }
}
