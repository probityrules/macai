#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import {
  getMacaiDbPath,
  getMacaiDir,
  loadConfig,
  mergeConfig,
  DEFAULT_OLLAMA_BASE_URL,
} from "./config/Config.js";
import { MacaiDatabase } from "./persistence/Database.js";
import { OllamaClient } from "./ollama/OllamaClient.js";
import { WorktreeManager } from "./git/WorktreeManager.js";
import { ReportGenerator } from "./reporting/ReportGenerator.js";
import { synthesizeInvestigationReport } from "./reporting/synthesizeInvestigationReport.js";
import { runMacaiStart } from "./cli/runStart.js";
import { runPromptCommand } from "./cli/promptCommand.js";
import { runCleanupCommand } from "./cli/cleanupCommand.js";
import { runReviewCommand } from "./cli/reviewCommand.js";
import { checkCoveragePackages } from "./helpers/doctor-checks.js";
import { resolveRepo } from "./cli/repoOption.js";

const DEFAULT_REPO = process.cwd();

const program = new Command();

program
  .name("macai")
  .description("macai — local autonomous coding agent")
  .version("0.1.1");

program
  .command("start")
  .description("Start an autonomous coding run")
  .option("--repo <path>", "Path to the git repository", DEFAULT_REPO)
  .option("--tasks <file>", "YAML file with task definitions")
  .option("--config <file>", "Config file path")
  .option("--model <name>", "Ollama model name", "qwen3-coder:latest")
  .option("--ollama-url <url>", "Ollama base URL", DEFAULT_OLLAMA_BASE_URL)
  .option("--hours <n>", "Maximum runtime in hours", "8")
  .option("--until <time>", "Stop at wall-clock time (HH:MM)")
  .option("--base-branch <name>", "Base branch for worktrees")
  .option("--continue-on-failure", "Keep running remaining tasks after a failure")
  .action(async (opts) => {
    try {
      await runMacaiStart({
        repo: resolveRepo(opts.repo),
        tasks: opts.tasks,
        config: opts.config,
        model: opts.model,
        ollamaUrl: opts.ollamaUrl,
        hours: parseFloat(opts.hours),
        until: opts.until,
        baseBranch: opts.baseBranch,
        stopOnFailure: !opts.continueOnFailure,
      });
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("prompt")
  .description("Plan and start a run from a natural-language prompt")
  .argument("[text]", "What macai should work on")
  .option("--repo <path>", "Path to the git repository", DEFAULT_REPO)
  .option("-p, --prompt <text>", "Prompt text (alternative to argument)")
  .option("--prompt-file <file>", "Read prompt from a file")
  .option("--config <file>", "Config file path")
  .option("--model <name>", "Ollama model name", "qwen3-coder:latest")
  .option("--ollama-url <url>", "Ollama base URL", DEFAULT_OLLAMA_BASE_URL)
  .option("--hours <n>", "Default runtime hint in hours", "8")
  .option("--until <time>", "Stop at wall-clock time (HH:MM)")
  .option("--base-branch <name>", "Base branch for worktrees")
  .option("--continue-on-failure", "Keep running remaining tasks after a failure")
  .option("--dry-run", "Generate tasks.yaml and run plan without starting")
  .option("--output-dir <path>", "Directory for generated plan files")
  .action(async (text, opts) => {
    try {
      await runPromptCommand({
        repo: resolveRepo(opts.repo),
        prompt: opts.prompt ?? text,
        promptFile: opts.promptFile,
        config: opts.config,
        model: opts.model,
        ollamaUrl: opts.ollamaUrl,
        hours: parseFloat(opts.hours),
        until: opts.until,
        baseBranch: opts.baseBranch,
        dryRun: opts.dryRun,
        outputDir: opts.outputDir,
        stopOnFailure: !opts.continueOnFailure,
      });
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show current or last run status")
  .option("--repo <path>", "Path to the git repository", DEFAULT_REPO)
  .action((opts) => {
    const repo = resolveRepo(opts.repo);
    const dbPath = getMacaiDbPath(repo);
    if (!fs.existsSync(dbPath)) {
      console.log("No macai runs found.");
      return;
    }

    const db = new MacaiDatabase(dbPath);
    const projectId = db.getOrCreateProject(repo);
    const running = db.getRunningRun(projectId);
    const run = running ?? db.getLatestRun(projectId);

    if (!run) {
      console.log("No runs found.");
      db.close();
      return;
    }

    const queued = db.getQueuedRuns(projectId);

    console.log("\nmacai Run Status");
    console.log("────────────────────");
    console.log(`Repository: ${repo}`);
    console.log(`Run ID:     ${run.id}`);
    console.log(`Status:     ${run.status}`);
    console.log(`Model:      ${run.model}`);
    console.log(`Attempted:  ${run.tasks_attempted}`);
    console.log(`Completed:  ${run.tasks_completed}`);
    console.log(`Failed:     ${run.tasks_failed}`);
    console.log(`Commits:    ${run.commits_created}`);
    if (queued.length > 0) {
      console.log(`Queued:     ${queued.length} run(s) waiting`);
    }
    if (run.runtime_ms) {
      console.log(`Runtime:    ${Math.floor(run.runtime_ms / 1000)}s`);
    }

    const tasks = db.getTasksByRun(run.id);
    if (tasks.length > 0) {
      console.log("\nTasks:");
      for (const t of tasks) {
        const icon =
          t.status === "completed" ? "✓" : t.status === "failed" ? "✗" : "○";
        console.log(`  ${icon} ${t.id}: ${t.title} [${t.status}]`);
      }
    }

    db.close();
  });

const tasksCmd = program.command("tasks").description("Manage tasks");

tasksCmd
  .command("list")
  .description("List tasks from the latest run")
  .option("--repo <path>", "Path to the git repository", DEFAULT_REPO)
  .action((opts) => {
    const repo = resolveRepo(opts.repo);
    const dbPath = getMacaiDbPath(repo);
    if (!fs.existsSync(dbPath)) {
      console.log("No tasks found.");
      return;
    }

    const db = new MacaiDatabase(dbPath);
    const projectId = db.getOrCreateProject(repo);
    const run = db.getLatestRun(projectId);
    if (!run) {
      console.log("No runs found.");
      db.close();
      return;
    }

    const tasks = db.getTasksByRun(run.id);
    for (const t of tasks) {
      console.log(`${t.id}\t[${t.status}]\t${t.mode}\t${t.title}`);
    }
    db.close();
  });

tasksCmd
  .command("synthesize-report")
  .description("Regenerate investigation/review report from stored tool evidence")
  .argument("<task-id>", "Task ID")
  .option("--repo <path>", "Path to the git repository", DEFAULT_REPO)
  .option("--ollama-url <url>", "Ollama base URL")
  .option("--model <name>", "Model to use")
  .action(async (taskId: string, opts) => {
    const repo = resolveRepo(opts.repo);
    const dbPath = getMacaiDbPath(repo);
    if (!fs.existsSync(dbPath)) {
      console.error("No macai database found.");
      process.exit(1);
    }

    const config = mergeConfig(loadConfig(), {
      model: opts.model,
      ollamaUrl: opts.ollamaUrl,
    });
    const db = new MacaiDatabase(dbPath);
    const ollama = new OllamaClient(config.ollama);

    try {
      const reportPath = await synthesizeInvestigationReport(db, ollama, repo, taskId);
      console.log(`Report written to ${reportPath}`);
      console.log("");
      console.log(fs.readFileSync(reportPath, "utf8"));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    } finally {
      db.close();
    }
  });

program
  .command("cleanup")
  .description("Remove orphaned macai worktrees/branches and prune empty task dirs")
  .option("--repo <path>", "Path to the git repository", DEFAULT_REPO)
  .option("--dry-run", "Show what would be removed without deleting")
  .option("--no-prune-tasks", "Skip pruning .macai/tasks dirs")
  .option("--force", "Allow removing task dirs that have investigation reports")
  .option("--older-than-days <n>", "Only prune task dirs older than N days", parseFloat)
  .action(async (opts) => {
    try {
      await runCleanupCommand(resolveRepo(opts.repo), {
        dryRun: opts.dryRun,
        pruneTasks: opts.pruneTasks !== false,
        forceReports: opts.force === true,
        olderThanDays: opts.olderThanDays,
      });
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("review")
  .description("Show task status, branch, worktree, and investigation report preview")
  .argument("<task-id>", "Task ID")
  .option("--repo <path>", "Path to the git repository", DEFAULT_REPO)
  .action(async (taskId: string, opts) => {
    try {
      await runReviewCommand(taskId, resolveRepo(opts.repo));
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("cancel")
  .description("Note: send SIGINT to a running macai process to cancel gracefully")
  .action(() => {
    console.log("To cancel a running macai session, press Ctrl+C in its terminal.");
    console.log("The agent will finish the current safe operation and shut down.");
  });

program
  .command("report")
  .description("Generate or print the run report")
  .option("--repo <path>", "Path to the git repository", DEFAULT_REPO)
  .option("--run <id>", "Run ID (defaults to latest)")
  .action((opts) => {
    const repo = resolveRepo(opts.repo);
    const dbPath = getMacaiDbPath(repo);
    if (!fs.existsSync(dbPath)) {
      console.log("No report available.");
      return;
    }

    const db = new MacaiDatabase(dbPath);
    const projectId = db.getOrCreateProject(repo);
    const runId = opts.run ?? db.getLatestRun(projectId)?.id;
    if (!runId) {
      console.log("No runs found.");
      db.close();
      return;
    }

    const reporter = new ReportGenerator(db, repo);
    const reportPath = reporter.generateRunReport(runId);
    console.log(fs.readFileSync(reportPath, "utf8"));
    db.close();
  });

program
  .command("doctor")
  .description("Check Ollama, git, and model availability")
  .option("--repo <path>", "Path to verify git repository", DEFAULT_REPO)
  .option("--ollama-url <url>", "Ollama base URL", DEFAULT_OLLAMA_BASE_URL)
  .option("--model <name>", "Model to check", "qwen3-coder:latest")
  .action(async (opts) => {
    console.log("\nmacai Doctor");
    console.log("────────────────");

    const repo = resolveRepo(opts.repo);

    const config = mergeConfig(loadConfig(), {
      model: opts.model,
      ollamaUrl: opts.ollamaUrl,
    });

    const ollama = new OllamaClient(config.ollama);
    const health = await ollama.healthCheck();
    if (health.ok) {
      console.log(`✓ Ollama reachable at ${config.ollama.baseUrl}`);
      console.log(`✓ Model '${config.ollama.model}' available`);
    } else {
      console.log(`✗ Ollama: ${health.error}`);
      if (health.models.length > 0) {
        console.log(`  Available models: ${health.models.join(", ")}`);
      }
    }

    try {
      const wt = new WorktreeManager(repo);
      const branch = wt.getCurrentBranch();
      const clean = wt.isWorkingTreeClean();
      console.log(`✓ Git repository: ${repo}`);
      console.log(`  Branch: ${branch}, ${clean ? "clean" : "dirty"}`);
    } catch (err) {
      console.log(`✗ Git: ${err instanceof Error ? err.message : err}`);
    }

    const macaiDir = getMacaiDir(repo);
    if (fs.existsSync(macaiDir)) {
      console.log(`✓ macai data dir exists: ${macaiDir}`);
    }

    const coverage = checkCoveragePackages(repo);
    if (coverage.ok) {
      console.log("✓ Coverage packages installed (vitest, @vitest/coverage-v8)");
    } else if (coverage.missing.length > 0) {
      console.log(`✗ Coverage packages missing: ${coverage.missing.join(", ")}`);
      console.log("  Run: npm install");
    }

    console.log("");
  });

program.parse();
