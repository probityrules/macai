#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import {
  getMacaiDbPath,
  getMacaiDir,
  loadConfig,
  mergeConfig,
} from "./config/Config.js";
import { MacaiDatabase } from "./persistence/Database.js";
import { OllamaClient } from "./ollama/OllamaClient.js";
import { WorktreeManager } from "./git/WorktreeManager.js";
import { ReportGenerator } from "./reporting/ReportGenerator.js";
import { runMacaiStart } from "./cli/runStart.js";
import { runPromptCommand } from "./cli/promptCommand.js";

const program = new Command();

program
  .name("macai")
  .description("macai — local autonomous coding agent")
  .version("0.1.0");

program
  .command("start")
  .description("Start an autonomous coding run")
  .requiredOption("--repo <path>", "Path to the git repository")
  .option("--tasks <file>", "YAML file with task definitions")
  .option("--config <file>", "Config file path")
  .option("--model <name>", "Ollama model name", "qwen3-coder:latest")
  .option("--ollama-url <url>", "Ollama base URL", "http://10.0.0.29:11434")
  .option("--hours <n>", "Maximum runtime in hours", "8")
  .option("--until <time>", "Stop at wall-clock time (HH:MM)")
  .option("--base-branch <name>", "Base branch for worktrees")
  .action(async (opts) => {
    try {
      await runMacaiStart({
        repo: opts.repo,
        tasks: opts.tasks,
        config: opts.config,
        model: opts.model,
        ollamaUrl: opts.ollamaUrl,
        hours: parseFloat(opts.hours),
        until: opts.until,
        baseBranch: opts.baseBranch,
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
  .requiredOption("--repo <path>", "Path to the git repository")
  .option("-p, --prompt <text>", "Prompt text (alternative to argument)")
  .option("--prompt-file <file>", "Read prompt from a file")
  .option("--config <file>", "Config file path")
  .option("--model <name>", "Ollama model name", "qwen3-coder:latest")
  .option("--ollama-url <url>", "Ollama base URL", "http://10.0.0.29:11434")
  .option("--hours <n>", "Default runtime hint in hours", "8")
  .option("--until <time>", "Stop at wall-clock time (HH:MM)")
  .option("--base-branch <name>", "Base branch for worktrees")
  .option("--dry-run", "Generate tasks.yaml and run plan without starting")
  .option("--output-dir <path>", "Directory for generated plan files")
  .action(async (text, opts) => {
    try {
      await runPromptCommand({
        repo: opts.repo,
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
      });
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show current or last run status")
  .requiredOption("--repo <path>", "Path to the git repository")
  .action((opts) => {
    const dbPath = getMacaiDbPath(opts.repo);
    if (!fs.existsSync(dbPath)) {
      console.log("No macai runs found.");
      return;
    }

    const db = new MacaiDatabase(dbPath);
    const projectId = db.getOrCreateProject(opts.repo);
    const run = db.getRunningRun(projectId) ?? db.getLatestRun(projectId);

    if (!run) {
      console.log("No runs found.");
      db.close();
      return;
    }

    console.log("\nmacai Run Status");
    console.log("────────────────────");
    console.log(`Run ID:     ${run.id}`);
    console.log(`Status:     ${run.status}`);
    console.log(`Model:      ${run.model}`);
    console.log(`Attempted:  ${run.tasks_attempted}`);
    console.log(`Completed:  ${run.tasks_completed}`);
    console.log(`Failed:     ${run.tasks_failed}`);
    console.log(`Commits:    ${run.commits_created}`);
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
  .requiredOption("--repo <path>", "Path to the git repository")
  .action((opts) => {
    const dbPath = getMacaiDbPath(opts.repo);
    if (!fs.existsSync(dbPath)) {
      console.log("No tasks found.");
      return;
    }

    const db = new MacaiDatabase(dbPath);
    const projectId = db.getOrCreateProject(opts.repo);
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
  .requiredOption("--repo <path>", "Path to the git repository")
  .option("--run <id>", "Run ID (defaults to latest)")
  .action((opts) => {
    const dbPath = getMacaiDbPath(opts.repo);
    if (!fs.existsSync(dbPath)) {
      console.log("No report available.");
      return;
    }

    const db = new MacaiDatabase(dbPath);
    const projectId = db.getOrCreateProject(opts.repo);
    const runId = opts.run ?? db.getLatestRun(projectId)?.id;
    if (!runId) {
      console.log("No runs found.");
      db.close();
      return;
    }

    const reporter = new ReportGenerator(db, opts.repo);
    const reportPath = reporter.generateRunReport(runId);
    console.log(fs.readFileSync(reportPath, "utf8"));
    db.close();
  });

program
  .command("doctor")
  .description("Check Ollama, git, and model availability")
  .option("--repo <path>", "Path to verify git repository")
  .option("--ollama-url <url>", "Ollama base URL", "http://10.0.0.29:11434")
  .option("--model <name>", "Model to check", "qwen3-coder:latest")
  .action(async (opts) => {
    console.log("\nmacai Doctor");
    console.log("────────────────");

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

    if (opts.repo) {
      try {
        const wt = new WorktreeManager(opts.repo);
        const branch = wt.getCurrentBranch();
        const clean = wt.isWorkingTreeClean();
        console.log(`✓ Git repository: ${path.resolve(opts.repo)}`);
        console.log(`  Branch: ${branch}, ${clean ? "clean" : "dirty"}`);
      } catch (err) {
        console.log(`✗ Git: ${err instanceof Error ? err.message : err}`);
      }
    }

    const macaiDir = opts.repo ? getMacaiDir(opts.repo) : null;
    if (macaiDir && fs.existsSync(macaiDir)) {
      console.log(`✓ macai data dir exists: ${macaiDir}`);
    }

    console.log("");
  });

program.parse();
