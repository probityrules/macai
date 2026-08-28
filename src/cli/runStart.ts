import type { AppConfig, JobStartOptions, TaskDefinition } from "../config/types.js";
import { loadConfig, mergeConfig } from "../config/Config.js";
import { JobManager } from "../queue/JobManager.js";

export interface StartCommandOptions {
  repo: string;
  tasks?: string;
  config?: string;
  model?: string;
  ollamaUrl?: string;
  hours?: number;
  until?: string;
  baseBranch?: string;
  taskDefinitions?: TaskDefinition[];
}

export async function runMacaiStart(opts: StartCommandOptions): Promise<void> {
  const baseConfig = loadConfig(opts.config);
  const appConfig = mergeConfig(baseConfig, {
    model: opts.model,
    ollamaUrl: opts.ollamaUrl,
  });

  await JobManager.recoverIncomplete(opts.repo);

  const manager = new JobManager({
    repo: opts.repo,
    tasks: opts.tasks,
    appConfig,
    hours: opts.hours,
    until: opts.until,
    baseBranch: opts.baseBranch,
    model: opts.model,
    ollamaUrl: opts.ollamaUrl,
    taskDefinitions: opts.taskDefinitions,
  } satisfies JobStartOptions);

  await manager.run();
}

export function resolveAppConfig(opts: {
  config?: string;
  model?: string;
  ollamaUrl?: string;
}): AppConfig {
  return mergeConfig(loadConfig(opts.config), {
    model: opts.model,
    ollamaUrl: opts.ollamaUrl,
  });
}
