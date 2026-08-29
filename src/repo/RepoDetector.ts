import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { AppConfig, DetectedRepo, RepoCommands, TestResult } from "../config/types.js";

export class RepoDetector {
  detect(repoPath: string, configOverrides?: RepoCommands): DetectedRepo {
    const root = path.resolve(repoPath);
    let language = "unknown";
    let commands: RepoCommands = {};

    if (fs.existsSync(path.join(root, "package.json"))) {
      language = "node";
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      commands = {
        install: fs.existsSync(path.join(root, "pnpm-lock.yaml"))
          ? "pnpm install"
          : fs.existsSync(path.join(root, "yarn.lock"))
            ? "yarn install"
            : "npm install",
        test: pkg.scripts?.test ? "npm test" : undefined,
        lint: pkg.scripts?.lint ? "npm run lint" : undefined,
        build: pkg.scripts?.build ? "npm run build" : undefined,
      };
    } else if (fs.existsSync(path.join(root, "Cargo.toml"))) {
      language = "rust";
      commands = { test: "cargo test", build: "cargo build", lint: "cargo clippy" };
    } else if (fs.existsSync(path.join(root, "pyproject.toml")) || fs.existsSync(path.join(root, "requirements.txt"))) {
      language = "python";
      commands = {
        test: fs.existsSync(path.join(root, "pytest.ini")) || fs.existsSync(path.join(root, "tests"))
          ? "python -m pytest"
          : undefined,
        lint: "python -m ruff check .",
        build: undefined,
      };
    } else if (fs.existsSync(path.join(root, "go.mod"))) {
      language = "go";
      commands = { test: "go test ./...", build: "go build ./...", lint: "go vet ./..." };
    } else if (fs.existsSync(path.join(root, "Makefile"))) {
      language = "make";
      commands = { test: "make test", build: "make build", lint: "make lint" };
    }

    if (configOverrides) {
      commands = { ...commands, ...configOverrides };
    }

    return { language, commands };
  }
}

export function parseTestOutput(output: string): { passed: number; failed: number; skipped: number } {
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  const patterns = [
    /(\d+)\s+passed/i,
    /(\d+)\s+failed/i,
    /(\d+)\s+skipped/i,
    /Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/i,
    /(\d+)\s+passing/i,
    /(\d+)\s+failing/i,
  ];

  const jestMatch = output.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/i);
  if (jestMatch) {
    failed = parseInt(jestMatch[1], 10);
    passed = parseInt(jestMatch[2], 10);
    return { passed, failed, skipped };
  }

  const mochaMatch = output.match(/(\d+)\s+passing[\s\S]*?(\d+)\s+failing/i);
  if (mochaMatch) {
    passed = parseInt(mochaMatch[1], 10);
    failed = parseInt(mochaMatch[2], 10);
    return { passed, failed, skipped };
  }

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      const val = parseInt(match[1], 10);
      if (pattern.source.includes("passed") || pattern.source.includes("passing")) passed = val;
      if (pattern.source.includes("failed") || pattern.source.includes("failing")) failed = val;
      if (pattern.source.includes("skipped")) skipped = val;
    }
  }

  if (passed === 0 && failed === 0) {
    const okMatches = output.match(/\bok\b/gi);
    const failMatches = output.match(/\bfail(?:ed|ures?)?\b/gi);
    if (okMatches) passed = okMatches.length;
    if (failMatches) failed = failMatches.length;
  }

  return { passed, failed, skipped };
}

export async function runTestCommand(
  command: string,
  cwd: string,
  outputPath: string,
  timeoutMs: number,
): Promise<TestResult> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const start = Date.now();
  let exitCode = 0;
  let combined = "";

  try {
    const result = await execa(command, {
      cwd,
      shell: true,
      timeout: timeoutMs,
      reject: false,
      all: true,
      env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
    });
    exitCode = result.exitCode ?? 1;
    combined = result.all ?? [result.stdout, result.stderr].filter(Boolean).join("\n");
  } catch (err) {
    exitCode = 1;
    combined = err instanceof Error ? err.message : String(err);
  }

  fs.writeFileSync(outputPath, combined, "utf8");
  const counts = parseTestOutput(combined);

  return {
    counts: {
      ...counts,
      total: counts.passed + counts.failed + counts.skipped,
    },
    exitCode,
    outputPath,
    command,
  };
}

export function getTestCommand(config: AppConfig, detected: DetectedRepo): string | undefined {
  return config.repo.test ?? detected.commands.test;
}

export function getInstallCommand(config: AppConfig, detected: DetectedRepo): string | undefined {
  return config.repo.install ?? detected.commands.install;
}

export async function ensureWorktreeDependencies(
  worktreePath: string,
  installCommand: string | undefined,
  timeoutMs: number,
  onLog?: (line: string) => void,
): Promise<void> {
  if (!installCommand) return;

  const marker = path.join(worktreePath, "node_modules");
  // Node projects: skip only if a likely-complete install exists
  if (fs.existsSync(path.join(worktreePath, "package.json"))) {
    const vitestOk = fs.existsSync(path.join(marker, "vitest", "dist", "cli.js"));
    const hasModules = fs.existsSync(marker);
    if (hasModules && vitestOk) return;
  }

  onLog?.(`Installing dependencies in worktree: ${installCommand}`);
  const result = await execa(installCommand, {
    cwd: worktreePath,
    shell: true,
    timeout: timeoutMs,
    reject: false,
    all: true,
    env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
  });

  if ((result.exitCode ?? 1) !== 0) {
    const output = result.all ?? result.stderr ?? "install failed";
    throw new Error(`Worktree install failed (${result.exitCode}): ${output.slice(0, 2000)}`);
  }
  onLog?.("Worktree dependencies ready");
}
