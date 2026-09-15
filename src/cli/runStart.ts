import type { AppConfig, JobStartOptions, TaskDefinition } from "../config/types.js";
import { loadConfig, mergeConfig } from "../config/Config.js";
import { assertNoAdoptState } from "../git/adoptState.js";
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
  stopOnFailure?: boolean;
  taskDefinitions?: TaskDefinition[];
}

export async function runMacaiStart(opts: StartCommandOptions): Promise<void> {
  const baseConfig = loadConfig(opts.config, opts.repo);
  const appConfig = mergeConfig(baseConfig, {
    model: opts.model,
    ollamaUrl: opts.ollamaUrl,
  });

  assertNoAdoptState(opts.repo, "start a run");

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
    stopOnFailure: opts.stopOnFailure,
    taskDefinitions: opts.taskDefinitions,
  } satisfies JobStartOptions);

  await manager.run();
}

export function resolveAppConfig(opts: {
  config?: string;
  model?: string;
  ollamaUrl?: string;
  repo?: string;
}): AppConfig {
  return mergeConfig(loadConfig(opts.config, opts.repo), {
    model: opts.model,
    ollamaUrl: opts.ollamaUrl,
  });
}
