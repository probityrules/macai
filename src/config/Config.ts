import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  AppConfigSchema,
  DEFAULT_OLLAMA_BASE_URL,
  type AppConfig,
  type TaskDefinition,
  type TasksFile,
} from "./types.js";

export { DEFAULT_OLLAMA_BASE_URL };

const DEFAULT_CONFIG: AppConfig = AppConfigSchema.parse({});

export function loadConfig(configPath?: string): AppConfig {
  if (!configPath) {
    return DEFAULT_CONFIG;
  }

  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  const raw = parseYaml(fs.readFileSync(resolved, "utf8"));
  return AppConfigSchema.parse(raw);
}

export function mergeConfig(
  base: AppConfig,
  overrides: Partial<{ model: string; ollamaUrl: string }>,
): AppConfig {
  return AppConfigSchema.parse({
    ...base,
    ollama: {
      ...base.ollama,
      ...(overrides.model ? { model: overrides.model } : {}),
      ...(overrides.ollamaUrl ? { baseUrl: overrides.ollamaUrl } : {}),
    },
  });
}

export function loadTasksFile(tasksPath: string): TaskDefinition[] {
  const resolved = path.resolve(tasksPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Tasks file not found: ${resolved}`);
  }

  const raw = parseYaml(fs.readFileSync(resolved, "utf8")) as TasksFile;
  if (!raw?.tasks || !Array.isArray(raw.tasks)) {
    throw new Error("Tasks file must contain a 'tasks' array");
  }

  for (const task of raw.tasks) {
    if (!task.title || !task.description) {
      throw new Error("Each task must have title and description");
    }
  }

  return raw.tasks;
}

export function getMacaiDir(repoPath: string): string {
  return path.join(path.resolve(repoPath), ".macai");
}

export function getMacaiDbPath(repoPath: string): string {
  return path.join(getMacaiDir(repoPath), "database.sqlite");
}

export function ensureMacaiDir(repoPath: string): string {
  const dir = getMacaiDir(repoPath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getTaskDir(repoPath: string, taskId: string): string {
  return path.join(getMacaiDir(repoPath), "tasks", taskId);
}

export function ensureTaskDir(repoPath: string, taskId: string): string {
  const dir = getTaskDir(repoPath, taskId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
