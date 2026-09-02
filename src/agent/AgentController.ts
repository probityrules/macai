import fs from "node:fs";
import path from "node:path";
import type { AppConfig, AgentPhase, TaskMode } from "../config/types.js";
import type { MacaiDatabase, TaskRecord } from "../persistence/Database.js";
import type { OllamaClient, OllamaMessage } from "../ollama/OllamaClient.js";
import type { TestResult } from "../config/types.js";
import { ToolRegistry, gitExec } from "../tools/ToolRegistry.js";
import { resolveToolCalls } from "./parseToolCalls.js";
import { ContextManager } from "./ContextManager.js";
import {
  isReadOnlyMode,
  shouldRunValidation,
  statusForPhase,
} from "./AgentState.js";
import { getSystemPrompt, shouldSkipPlanning } from "./prompts/system.js";
import { Planner } from "./Planner.js";
import { Reviewer } from "./Reviewer.js";
import { InvestigationReporter } from "./InvestigationReporter.js";

export interface PriorTaskHandoff {
  summary: string;
}

export interface AgentRunContext {
  config: AppConfig;
  ollama: OllamaClient;
  db: MacaiDatabase;
  task: TaskRecord;
  worktreePath: string;
  logDir: string;
  baseline?: TestResult;
  priorHandoff?: PriorTaskHandoff;
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
  branch?: string | null;
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

    if (this.ctx.priorHandoff?.summary) {
      contextManager.setPriorHandoff(this.ctx.priorHandoff.summary);
    }

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
    let emptyWorkNudges = 0;
    let emptyCommitRetries = 0;
    let testFixCycles = 0;
    let reviewRejectCycles = 0;
    let testsPassed = false;
    const maxTestFixCycles = 8;
    const maxReviewRejectCycles = 3;

    try {
      while (true) {
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

        if (readOnly && phase === "commit") {
          break;
        }

        contextManager.setPhase(phase);
        db.updateTask(task.id, { status: statusForPhase(phase) });
        this.log(`Phase → ${phase}`);

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
            { forceMutatingTools: testFixCycles > 0 },
          );
          messages = workResult.messages;
          filesChanged = [...new Set([...filesChanged, ...workResult.filesChanged])];

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
              branch: task.branch,
            };
          }

          if (!readOnly && filesChanged.length === 0) {
            // Testing tasks may find a green suite with nothing to fix — validate first.
            if (task.mode === "testing" && emptyWorkNudges === 0) {
              emptyWorkNudges += 1;
              this.log("No edits yet in testing mode — running validation first");
              phase = "test";
              continue;
            }
            emptyWorkNudges += 1;
            if (emptyWorkNudges > 3) {
              db.updateTask(task.id, {
                status: "failed",
                failure_reason: "No file changes produced",
                ended_at: new Date().toISOString(),
              });
              return {
                success: false,
                failureReason: "No file changes produced",
                filesChanged,
              };
            }
            messages.push({
              role: "user",
              content:
                task.mode === "testing"
                  ? "Tests are failing or incomplete. Fix only the failures from this run using write_file/edit_file under tests/*.test.ts. Do not rewrite helpers or unrelated production files."
                  : "You finished the work phase without changing any files. " +
                    "Implement the task now using write_file or edit_file. Do not only read or search.",
            });
            this.log("No file changes yet — continuing work");
            continue;
          }

          // After a failed test cycle, require new edits before re-testing — but nudge
          // a few times first instead of failing immediately on a read-only work loop.
          if (
            testFixCycles > 0 &&
            workResult.filesChanged.length === 0 &&
            shouldRunValidation(task.mode)
          ) {
            emptyWorkNudges += 1;
            if (emptyWorkNudges > 4) {
              db.updateTask(task.id, {
                status: "failed",
                failure_reason: "Tests failing and no further file changes made",
                ended_at: new Date().toISOString(),
              });
              return {
                success: false,
                failureReason: "Tests failing and no further file changes made",
                filesChanged,
              };
            }
            messages.push({
              role: "user",
              content:
                "Tests are still failing and you made no file edits in that work pass. " +
                "Call write_file or edit_file now to fix the failing tests under tests/*.test.ts. " +
                "Do not only list/read. Prefer simple temp-dir tests over fragile class mocks.",
            });
            this.log("Tests still failing without edits — continuing work");
            continue;
          }

          // After repeated review rejects with real agent edits + green tests, commit anyway.
          if (
            reviewRejectCycles > 0 &&
            workResult.filesChanged.length === 0 &&
            filesChanged.length > 0 &&
            testsPassed
          ) {
            this.log("No new changes after review rejection — proceeding to commit");
            phase = "commit";
            continue;
          }

          if (shouldRunValidation(task.mode) && (filesChanged.length > 0 || !readOnly)) {
            phase = "test";
          } else {
            phase = "review";
          }
          continue;
        }

        if (phase === "test") {
          const testResult = await this.runValidation(contextManager, toolRegistry);
          this.log(testResult.passed ? "Tests passed" : "Tests failed — returning to work");
          if (testResult.passed) {
            testsPassed = true;
            testFixCycles = 0;
            if (task.mode === "testing" && filesChanged.length === 0) {
              this.log("Suite green with no fixes required — completing testing task");
              db.updateTask(task.id, {
                status: "completed",
                ended_at: new Date().toISOString(),
              });
              return {
                success: true,
                filesChanged: [],
                branch: task.branch,
              };
            }
            phase = "review";
            continue;
          }

          testsPassed = false;

          if (/Max retries exceeded/i.test(testResult.output)) {
            db.updateTask(task.id, {
              status: "failed",
              failure_reason: "Validation command retry budget exhausted",
              ended_at: new Date().toISOString(),
            });
            return {
              success: false,
              failureReason: "Validation command retry budget exhausted",
              filesChanged,
            };
          }

          testFixCycles += 1;
          if (testFixCycles > maxTestFixCycles) {
            this.log(`Giving up after ${maxTestFixCycles} test-fix cycles`);
            db.updateTask(task.id, {
              status: "failed",
              failure_reason: `Tests still failing after ${maxTestFixCycles} fix attempts`,
              ended_at: new Date().toISOString(),
            });
            return {
              success: false,
              failureReason: `Tests still failing after ${maxTestFixCycles} fix attempts`,
              filesChanged,
            };
          }

          toolRegistry.resetRetries("validation");
          phase = "work";
          messages.push({
            role: "user",
            content:
              `Tests failed (fix attempt ${testFixCycles}/${maxTestFixCycles}). Analyze and fix.\n` +
              `${testResult.output.slice(0, 4000)}\n\n` +
              "You MUST call write_file or edit_file with REAL file content to fix failures.\n" +
              "Rules:\n" +
              "- New unit tests belong under tests/*.test.ts (vitest include pattern). Do not put them under src/**/__tests__.\n" +
              "- write_file requires BOTH path and content (string). Omitting content is an error.\n" +
              "- If a test file shows 'No test suite found', rewrite it with a full describe/it suite.\n" +
              "- If you see 'is not a constructor', fix the mock: use class MockX {} or function MockX() { return {...} }, not an arrow factory.\n" +
              "- Prefer patterns from tests/ShellGuard.test.ts, tests/RepoDetector.test.ts, tests/cleanup-helpers.test.ts, tests/helpers/tempMacaiRepo.ts, and tests/helpers/mockOllama.ts.\n" +
              "- NEVER mock MacaiDatabase / WorktreeManager with arrow factories. Import the real class and use createTempGitRepo + openTempDatabase.\n" +
              "- For OllamaClient in agent/queue tests, use createMockOllama() from tests/helpers/mockOllama.ts. Do NOT edit tests/helpers/mockOllama.ts or tempMacaiRepo.ts (vitest, not jest).\n" +
              "- openTempDatabase(repo.repoPath) — pass .repoPath string, not the whole TempGitRepo object.\n" +
              "- For cleanup CLI behavior, test collectCleanupSummary / formatCleanupSummaryReport from autoCleanup.ts (no need to mock console).\n" +
              "- Do not rewrite unrelated sample/docs files or production Database.ts unless the task requires it.\n" +
              "- If the failure is environmental (missing deps), run the install command then re-test.",
          });
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
              branch: task.branch,
            };
          }

          const status = gitExec(["status", "--porcelain"], worktreePath);
          const diff =
            gitExec(["diff", "--stat"], worktreePath) +
            "\n" +
            gitExec(["diff", "--stat", "--cached"], worktreePath);
          const review = await this.reviewer.review(
            task.title,
            `Status:\n${status || "(clean)"}\n\nDiff stat:\n${diff.trim() || "(empty)"}`,
          );
          this.log(review.approved ? "Review approved" : "Review rejected — returning to work");
          if (review.approved) {
            phase = "commit";
            continue;
          }

          reviewRejectCycles += 1;
          const validationRequired = shouldRunValidation(task.mode);
          if (
            reviewRejectCycles > maxReviewRejectCycles &&
            filesChanged.length > 0 &&
            (testsPassed || !validationRequired)
          ) {
            this.log(
              validationRequired
                ? `Review rejected ${reviewRejectCycles} times but tests passed — proceeding to commit`
                : `Review rejected ${reviewRejectCycles} times — proceeding to commit (validation skipped for ${task.mode})`,
            );
            phase = "commit";
            continue;
          }

          if (reviewRejectCycles > maxReviewRejectCycles && filesChanged.length === 0) {
            db.updateTask(task.id, {
              status: "failed",
              failure_reason: "Review rejected and no agent file changes to commit",
              ended_at: new Date().toISOString(),
            });
            return {
              success: false,
              failureReason: "Review rejected and no agent file changes to commit",
              filesChanged,
            };
          }

          messages.push({
            role: "user",
            content: `Review rejected:\n${review.feedback}\n\nFix issues and try again. Use write_file/edit_file if no changes exist yet.`,
          });
          phase = "work";
          continue;
        }

        if (phase === "commit") {
          if (filesChanged.length === 0) {
            db.updateTask(task.id, {
              status: "failed",
              failure_reason: "Refusing commit with no agent file changes",
              ended_at: new Date().toISOString(),
            });
            return {
              success: false,
              failureReason: "Refusing commit with no agent file changes",
              filesChanged,
            };
          }

          const commitMessage = `macai: ${task.title}\n\nTask: ${task.id}\nAgent: ${this.ctx.ollama.getModel()}`;
          const result = await toolRegistry.execute("git_commit", { message: commitMessage });
          const parsed = JSON.parse(result) as { sha?: string; error?: string };

          if (parsed.error === "Nothing to commit") {
            emptyCommitRetries += 1;
            if (emptyCommitRetries > 2) {
              db.updateTask(task.id, {
                status: "failed",
                failure_reason: "Nothing to commit",
                ended_at: new Date().toISOString(),
              });
              return { success: false, failureReason: "Nothing to commit", filesChanged };
            }
            this.log("Nothing to commit — returning to work");
            messages.push({
              role: "user",
              content:
                "Commit failed: nothing to commit. The task is not done. " +
                "Make the required file changes with write_file or edit_file, then finish again.",
            });
            phase = "work";
            continue;
          }

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
            this.log(`Committed ${commitSha.slice(0, 8)}`);
          }
          break;
        }

        break;
      }

      const head = gitExec(["rev-parse", "HEAD"], worktreePath);
      db.updateTask(task.id, {
        status: "completed",
        head_commit: head,
        ended_at: new Date().toISOString(),
      });

      return {
        success: true,
        headCommit: head,
        commitSha,
        filesChanged,
        branch: task.branch,
      };
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
    messages.push({
      role: "user",
      content: [
        `Task: ${task.title}`,
        task.description,
        contextManager.getPriorHandoff()
          ? `\nPrior task handoff:\n${contextManager.getPriorHandoff()}`
          : "",
        "\nExplore the repository briefly, then summarize what you found.",
      ]
        .filter(Boolean)
        .join("\n"),
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
    opts?: { forceMutatingTools?: boolean },
  ): Promise<{ messages: OllamaMessage[]; filesChanged: string[]; lastResponse: string }> {
    const filesChanged: string[] = [];
    let lastResponse = "";
    let idleNudges = opts?.forceMutatingTools ? 1 : 0;
    const allTools = toolRegistry.getOllamaTools();
    let tools = allTools;
    const systemContent = getSystemPrompt(task.mode as TaskMode, phase);

    if (messages.length === 0 || messages[0].role !== "system") {
      messages.unshift({ role: "system", content: systemContent });
    } else {
      // Always refresh system rules for the current phase (e.g. understand → work).
      messages[0] = { role: "system", content: systemContent };
    }

    const recordPhase: AgentPhase = phase === "investigate" ? "work" : phase;
    const requiresMutatingTools = phase === "work";

    if (requiresMutatingTools) {
      messages.push({
        role: "user",
        content: [
          `Begin WORK for: ${task.title}`,
          task.description,
          "",
          "You MUST call tools in this phase. Use write_file and/or edit_file to implement the deliverables.",
          "write_file requires BOTH path and content string parameters — never omit content.",
          "Put new Vitest files under tests/*.test.ts only.",
          "Do not reply with text only. If something already exists, verify with list_directory/read_file, then create or update what is still missing.",
          "Ignore node_modules, coverage, and cache files — they are not task deliverables.",
          "Note: only root /sample-project/ is gitignored — files under templates/ are tracked.",
        ].join("\n"),
      });
    }

    for (let i = 0; i < maxIterations; i++) {
      contextManager.incrementIteration();
      const iter = contextManager.getIteration();

      if (contextManager.shouldCompact(messages.length)) {
        messages.splice(
          0,
          messages.length,
          ...contextManager.compactMessages(messages, task),
        );
        // Restore current-phase system prompt after compaction.
        if (messages[0]?.role === "system") {
          messages[0].content = systemContent;
        } else {
          messages.unshift({ role: "system", content: systemContent });
        }
      }

      // After idle nudges with no writes, only offer mutating tools so the model
      // cannot keep listing/reading forever.
      if (requiresMutatingTools && filesChanged.length === 0 && idleNudges >= 1) {
        tools = allTools.filter((t) =>
          ["write_file", "edit_file"].includes(t.function.name),
        );
      } else {
        tools = allTools;
      }

      const iterationId = this.ctx.db.recordIteration({
        taskId: task.id,
        phase: recordPhase,
        iterationNum: iter,
        promptSummary: messages.at(-1)?.content.slice(0, 200),
      });

      this.log(`iter ${iter} [${phase}]`);

      const response = await this.ctx.ollama.chat(messages, tools);
      lastResponse = response.message.content;
      messages.push({ role: "assistant", content: lastResponse });

      this.ctx.db.recordIteration({
        taskId: task.id,
        phase: recordPhase,
        iterationNum: iter,
        responseSummary: lastResponse.slice(0, 300),
        promptTokens: response.prompt_eval_count,
        completionTokens: response.eval_count,
      });

      // qwen3-coder often emits <function=...> XML in content instead of tool_calls.
      const toolCalls = resolveToolCalls(response.message);
      if (toolCalls.length === 0) {
        if (requiresMutatingTools && filesChanged.length === 0 && idleNudges < 3) {
          idleNudges += 1;
          this.log(`iter ${iter} [${phase}]: (no tools — nudging to write)`);
          messages.push({
            role: "user",
            content:
              "That response used no tools and changed no files. " +
              "Immediately call write_file or edit_file to create/update the required files for this task. " +
              "Text-only replies are not allowed in the work phase.",
          });
          continue;
        }
        this.log(`iter ${iter} [${phase}]: (no tools — phase complete)`);
        break;
      }

      for (const call of toolCalls) {
        const toolName = call.function.name;
        const args = call.function.arguments;
        const argHint = summarizeToolArgs(toolName, args);
        this.log(`iter ${iter} [${phase}]: ${toolName}${argHint}`);
        const start = Date.now();
        const result = await toolRegistry.execute(toolName, args);
        const durationMs = Date.now() - start;
        this.log(`  → ${toolName} ${durationMs}ms`);

        this.ctx.db.recordToolCall({
          taskId: task.id,
          iterationId,
          toolName,
          argsJson: JSON.stringify(args),
          resultPreview: result.slice(0, 500),
          durationMs,
        });

        if (["write_file", "edit_file"].includes(toolName) && args.path) {
          try {
            const parsed = JSON.parse(result) as { success?: boolean; error?: string };
            if (!parsed.error && parsed.success !== false) {
              const p = String(args.path);
              filesChanged.push(p);
              contextManager.addFileChanged(p);
            }
          } catch {
            // ignore parse errors
          }
        }
        if (toolName === "read_file" && args.path) {
          contextManager.addFileExamined(String(args.path));
        }

        messages.push({
          role: "tool",
          content: result.slice(0, this.ctx.config.limits.maxOutputBytes),
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

function summarizeToolArgs(toolName: string, args: Record<string, unknown>): string {
  const pathArg = args.path ?? args.file ?? args.command ?? args.pattern;
  if (pathArg === undefined) return "";
  const s = String(pathArg);
  return ` ${s.length > 80 ? `${s.slice(0, 77)}...` : s}`;
}

function hasWorkingTreeChanges(worktreePath: string): boolean {
  try {
    const status = gitExec(["status", "--porcelain"], worktreePath);
    return status.trim().length > 0;
  } catch {
    return false;
  }
}
