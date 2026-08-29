import type { AppConfig } from "../config/types.js";
import type { OllamaClient } from "../ollama/OllamaClient.js";
import fs from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { parseGeneratedRunPlan, type GeneratedRunPlan } from "./runPlanSchema.js";
import { buildRepoAssessment } from "./RepoAssessment.js";

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

const PLANNER_SYSTEM = `You are a software task planner for macai, an autonomous coding agent.

Given a developer's natural-language goal and repository assessment, produce a run plan as JSON only.

Rules:
- Break work into 1-5 concrete, verifiable tasks ordered by priority (higher priority first). Prefer fewer tasks.
- Start at the first missing deliverable. If an investigation report already exists (or the prompt names one), do NOT add a redundant investigation task — cite that path in documentation/coding task descriptions.
- Prefer mode "coding", "testing", "documentation", or "refactoring" when files may change. Use "investigation" or "review" only when existing evidence is insufficient.
- When reusing prior artifacts, task descriptions MUST name concrete input paths (e.g. .macai/tasks/<id>/investigation-report.md).
- Each task needs a short title and a detailed description with acceptance criteria.
- Prefer small validated tasks over one vague mega-task.
- Infer reasonable hours (1-8) for an unattended run; use overnight (~8h) for broad queues.
- Use until (HH:MM) only if the prompt mentions a stop time.
- Use baseBranch only if the prompt names a branch; otherwise omit it.

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
}`;

export class PromptRunPlanner {
  constructor(
    private ollama: OllamaClient,
    private config: AppConfig,
  ) {}

  async plan(options: PromptRunPlannerOptions): Promise<GeneratedRunPlan> {
    const repoContext = buildRepoAssessment(options.repoPath, this.config, options.prompt);
    const response = await this.ollama.chat([
      { role: "system", content: PLANNER_SYSTEM },
      {
        role: "user",
        content: [
          `Repository assessment:\n${repoContext}`,
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
}
