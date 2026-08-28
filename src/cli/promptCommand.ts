import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { PromptRunPlanner } from "../planning/PromptRunPlanner.js";
import { OllamaClient } from "../ollama/OllamaClient.js";
import { runMacaiStart, resolveAppConfig } from "./runStart.js";

export interface PromptCommandOptions {
  repo: string;
  prompt?: string;
  promptFile?: string;
  config?: string;
  model?: string;
  ollamaUrl?: string;
  hours?: number;
  until?: string;
  baseBranch?: string;
  dryRun?: boolean;
  outputDir?: string;
}

export async function readPromptText(opts: PromptCommandOptions): Promise<string> {
  if (opts.promptFile) {
    const resolved = opts.promptFile;
    if (!fs.existsSync(resolved)) {
      throw new Error(`Prompt file not found: ${resolved}`);
    }
    return fs.readFileSync(resolved, "utf8").trim();
  }

  if (opts.prompt?.trim()) {
    return opts.prompt.trim();
  }

  if (!input.isTTY) {
    return fs.readFileSync(0, "utf8").trim();
  }

  throw new Error("Provide a prompt via argument, --prompt, --prompt-file, or stdin");
}

export async function runPromptCommand(opts: PromptCommandOptions): Promise<void> {
  let prompt = await readPromptText(opts);
  if (!prompt) {
    if (input.isTTY) {
      const rl = readline.createInterface({ input, output });
      prompt = (await rl.question("Describe what macai should work on: ")).trim();
      rl.close();
    }
    if (!prompt) {
      throw new Error("Prompt cannot be empty");
    }
  }

  const appConfig = resolveAppConfig(opts);
  const ollama = new OllamaClient(appConfig.ollama);
  const health = await ollama.healthCheck();
  if (!health.ok) {
    throw new Error(`Ollama health check failed: ${health.error}`);
  }

  const planner = new PromptRunPlanner(ollama, appConfig);
  console.log("\nPlanning run from prompt...\n");

  const plan = await planner.plan({
    repoPath: opts.repo,
    prompt,
    defaultHours: opts.hours,
    defaultUntil: opts.until,
    defaultBaseBranch: opts.baseBranch,
  });

  const artifacts = planner.writeArtifacts(opts.repo, prompt, plan, opts.outputDir);

  console.log("Generated run plan");
  console.log("──────────────────");
  if (plan.summary) console.log(`Summary: ${plan.summary}`);
  console.log(`Tasks: ${plan.tasks.length}`);
  console.log(`Hours: ${plan.hours ?? opts.hours ?? 8}`);
  if (plan.until) console.log(`Until: ${plan.until}`);
  if (plan.baseBranch) console.log(`Base branch: ${plan.baseBranch}`);
  console.log(`Tasks file: ${artifacts.tasksPath}`);
  console.log(`Plan file:  ${artifacts.planPath}`);
  console.log("");

  for (const [i, task] of plan.tasks.entries()) {
    console.log(`${i + 1}. [${task.mode}] ${task.title} (priority ${task.priority})`);
  }
  console.log("");

  if (opts.dryRun) {
    console.log("Dry run — generated files only, not starting.");
    console.log(artifacts.tasksYaml);
    return;
  }

  console.log("Starting run...\n");
  await runMacaiStart({
    repo: opts.repo,
    tasks: artifacts.tasksPath,
    config: opts.config,
    model: opts.model,
    ollamaUrl: opts.ollamaUrl,
    hours: plan.hours ?? opts.hours,
    until: plan.until ?? opts.until,
    baseBranch: plan.baseBranch ?? opts.baseBranch,
    taskDefinitions: plan.tasks,
  });
}
