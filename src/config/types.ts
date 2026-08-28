import { z } from "zod";

export const TaskModeSchema = z.enum([
  "coding",
  "testing",
  "review",
  "documentation",
  "refactoring",
  "investigation",
]);

export type TaskMode = z.infer<typeof TaskModeSchema>;

export const TaskStatusSchema = z.enum([
  "queued",
  "starting",
  "planning",
  "working",
  "testing",
  "reviewing",
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "timed_out",
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const RunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "cancelled",
  "timed_out",
  "failed",
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export const AgentPhaseSchema = z.enum([
  "understand",
  "plan",
  "work",
  "test",
  "review",
  "commit",
]);

export type AgentPhase = z.infer<typeof AgentPhaseSchema>;

export const OllamaConfigSchema = z.object({
  baseUrl: z.string().url().default("http://10.0.0.29:11434"),
  model: z.string().default("qwen3-coder:latest"),
});

export type ShellCommandKind = "exploratory" | "validation";

export const LimitsConfigSchema = z.object({
  maxRuntimeHours: z.number().positive().default(8),
  maxIterations: z.number().int().positive().default(200),
  maxRetriesPerCommand: z.number().int().positive().default(3),
  maxRetriesPerValidationCommand: z.number().int().positive().default(20),
  maxFilesChanged: z.number().int().positive().default(50),
  maxDiffLines: z.number().int().positive().default(2000),
  maxConcurrentTasks: z.number().int().positive().default(1),
  commandTimeoutMs: z.number().int().positive().default(300_000),
  maxOutputBytes: z.number().int().positive().default(100_000),
});

export const ShellConfigSchema = z.object({
  allowedCommands: z
    .array(z.string())
    .default(["npm", "npx", "node", "git", "pnpm", "yarn", "python", "cargo", "go"]),
  deniedPatterns: z
    .array(z.string())
    .default(["rm -rf", "curl.*\\|", "ssh", "scp"]),
});

export const PathsConfigSchema = z.object({
  forbidden: z.array(z.string()).default([".ssh", ".env", "credentials"]),
});

export const RepoCommandsSchema = z.object({
  install: z.string().optional(),
  test: z.string().optional(),
  lint: z.string().optional(),
  build: z.string().optional(),
});

export const AppConfigSchema = z.object({
  provider: z.literal("ollama").default("ollama"),
  ollama: OllamaConfigSchema.default({
    baseUrl: "http://10.0.0.29:11434",
    model: "qwen3-coder:latest",
  }),
  limits: LimitsConfigSchema.default({
    maxRuntimeHours: 8,
    maxIterations: 200,
    maxRetriesPerCommand: 3,
    maxRetriesPerValidationCommand: 20,
    maxFilesChanged: 50,
    maxDiffLines: 2000,
    maxConcurrentTasks: 1,
    commandTimeoutMs: 300_000,
    maxOutputBytes: 100_000,
  }),
  shell: ShellConfigSchema.default({
    allowedCommands: ["npm", "npx", "node", "git", "pnpm", "yarn", "python", "cargo", "go"],
    deniedPatterns: ["rm -rf", "curl.*\\|", "ssh", "scp"],
  }),
  paths: PathsConfigSchema.default({
    forbidden: [".ssh", ".env", "credentials"],
  }),
  repo: RepoCommandsSchema.default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type LimitsConfig = z.infer<typeof LimitsConfigSchema>;
export type ShellConfig = z.infer<typeof ShellConfigSchema>;
export type RepoCommands = z.infer<typeof RepoCommandsSchema>;

export interface TaskDefinition {
  title: string;
  description: string;
  mode?: TaskMode;
  priority?: number;
}

export interface TasksFile {
  tasks: TaskDefinition[];
}

export interface StartOptions {
  repo: string;
  tasks?: string;
  config?: string;
  model?: string;
  ollamaUrl?: string;
  hours?: number;
  until?: string;
  baseBranch?: string;
}

export interface JobStartOptions extends StartOptions {
  appConfig: AppConfig;
  taskDefinitions?: TaskDefinition[];
}

export interface DetectedRepo {
  language: string;
  commands: RepoCommands;
}

export interface TestCounts {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface TestResult {
  counts: TestCounts;
  exitCode: number;
  outputPath: string;
  command: string;
}

export interface WorktreeInfo {
  worktreePath: string;
  branch: string;
  baseCommit: string;
}

export interface CheckpointState {
  phase: AgentPhase;
  plan?: string;
  filesExamined: string[];
  filesChanged: string[];
  decisions: string[];
  hypothesis?: string;
  remainingWork?: string;
  iteration: number;
}
