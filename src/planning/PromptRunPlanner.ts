import fs from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { AppConfig } from "../config/types.js";
import type { OllamaClient } from "../ollama/OllamaClient.js";
import { RepoDetector } from "../repo/RepoDetector.js";
import { WorktreeManager } from "../git/WorktreeManager.js";
import { parseGeneratedRunPlan, type GeneratedRunPlan } from "./runPlanSchema.js";

export interface PromptRunPlannerOptions {
  repoPath: string;
  prompt: string;
  defaultHours?: number;
  defaultUntil?: string;
  defaultBaseBranch?: string;
}

export interface GeneratedRunArtifacts {
  plan: GeneratedRunPlan;
  tasksYaml: string;
  tasksPath: string;
  planPath: string;
  promptPath: string;
  outputDir: string;
}

export class PromptRunPlanner {
  constructor(
    private ollama: OllamaClient,
    private config: AppConfig,
  ) {}

  async plan(options: PromptRunPlannerOptions): Promise<GeneratedRunPlan> {
    const repoContext = this.buildRepoContext(options.repoPath);
    const response = await this.ollama.chat([
      {
        role: "system",
        content: `You are a software task planner for macai, an autonomous coding agent.

Given a developer's natural-language goal, produce a run plan as JSON only.

Rules:
- Break work into 1-8 concrete, verifiable tasks ordered by priority (higher priority first)
- Each task needs a short title and a detailed description with acceptance criteria
- Use mode "investigation" or "review" for read-only analysis tasks
- Use mode "coding", "testing", "documentation", or "refactoring" when files may change
- Prefer small validated tasks over one vague mega-task
- Infer reasonable hours (1-8) for an unattended run; use overnight (~8h) for broad queues
- Use until (HH:MM) only if the prompt mentions a stop time
- Use baseBranch only if the prompt names a branch; otherwise omit it

Respond with JSON only, no markdown prose, matching this schema:
{
  "summary": "one-line summary",
  "hours": 8,
  "until": "07:00",
  "baseBranch": "main",
  "tasks": [
    {
      "title": "Short task title",
      "description": "Detailed instructions and verification steps",
      "mode": "coding",
      "priority": 10
    }
  ]
}`,
      },
      {
        role: "user",
        content: [
          `Repository context:\n${repoContext}`,
          `Default runtime hint: ${options.defaultHours ?? 8} hours`,
          options.defaultUntil ? `Suggested stop time: ${options.defaultUntil}` : "",
          options.defaultBaseBranch ? `Suggested base branch: ${options.defaultBaseBranch}` : "",
          `\nDeveloper prompt:\n${options.prompt}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ]);

    const plan = parseGeneratedRunPlan(response.message.content);
    return this.applyDefaults(plan, options);
  }

  writeArtifacts(
    repoPath: string,
    prompt: string,
    plan: GeneratedRunPlan,
    outputDir?: string,
  ): GeneratedRunArtifacts {
    const dir =
      outputDir ??
      path.join(
        repoPath,
        ".macai",
        "generated",
        new Date().toISOString().replace(/[:.]/g, "-"),
      );

    fs.mkdirSync(dir, { recursive: true });

    const tasksYaml = stringifyYaml({ tasks: plan.tasks });
    const tasksPath = path.join(dir, "tasks.yaml");
    const planPath = path.join(dir, "run-plan.json");
    const promptPath = path.join(dir, "prompt.txt");

    fs.writeFileSync(tasksPath, tasksYaml, "utf8");
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), "utf8");
    fs.writeFileSync(promptPath, prompt, "utf8");

    return {
      plan,
      tasksYaml,
      tasksPath,
      planPath,
      promptPath,
      outputDir: dir,
    };
  }

  private applyDefaults(
    plan: GeneratedRunPlan,
    options: PromptRunPlannerOptions,
  ): GeneratedRunPlan {
    return {
      ...plan,
      hours: options.defaultHours ?? plan.hours ?? 8,
      until: options.defaultUntil ?? plan.until,
      baseBranch: options.defaultBaseBranch ?? plan.baseBranch,
    };
  }

  private buildRepoContext(repoPath: string): string {
    const root = path.resolve(repoPath);
    const detector = new RepoDetector();
    const detected = detector.detect(root, this.config.repo);

    let branch = "unknown";
    try {
      branch = new WorktreeManager(root).getCurrentBranch();
    } catch {
      // not a git repo — planner will still run; start will fail later
    }

    const entries = this.listTopLevel(root);
    return [
      `Path: ${root}`,
      `Branch: ${branch}`,
      `Language: ${detected.language}`,
      `Test command: ${detected.commands.test ?? "unknown"}`,
      `Top-level entries: ${entries.join(", ") || "none"}`,
    ].join("\n");
  }

  private listTopLevel(root: string, max = 30): string[] {
    try {
      return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.name !== ".git" && e.name !== "node_modules" && e.name !== ".macai")
        .slice(0, max)
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    } catch {
      return [];
    }
  }
}
