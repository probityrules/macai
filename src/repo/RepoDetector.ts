import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

  const passMatch = output.match(/(\d+)\s+passed/i);
  const failMatch = output.match(/(\d+)\s+failed/i);
  const skipMatch = output.match(/(\d+)\s+skipped/i);
  if (passMatch) passed = parseInt(passMatch[1], 10);
  if (failMatch) failed = parseInt(failMatch[1], 10);
  if (skipMatch) skipped = parseInt(skipMatch[1], 10);

  const vitestFiles = output.match(/Test Files\s+(\d+)\s+passed/i);
  if (vitestFiles && passed === 0) {
    passed = parseInt(vitestFiles[1], 10);
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

export function nodeModulesHealthy(root: string): boolean {
  // Vitest is the usual failure mode in this project; also accept a generic package manager layout.
  if (fs.existsSync(path.join(root, "node_modules", "vitest", "dist", "cli.js"))) {
    return true;
  }
  if (fs.existsSync(path.join(root, "node_modules", ".bin"))) {
    // Non-vitest projects: treat presence of .bin as good enough
    return !fs.existsSync(path.join(root, "node_modules", "vitest"));
  }
  return false;
}

function filesIdentical(a: string, b: string): boolean {
  try {
    if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

function linkNodeModules(mainModules: string, worktreeModules: string, onLog?: (line: string) => void): boolean {
  try {
    if (fs.existsSync(worktreeModules)) {
      fs.rmSync(worktreeModules, { recursive: true, force: true });
    }
    const type = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(mainModules, worktreeModules, type);
    onLog?.(`Linked node_modules from ${mainModules}`);
    return nodeModulesHealthy(path.dirname(worktreeModules));
  } catch (err) {
    onLog?.(
      `Failed to link node_modules: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Ensure a worktree can run package scripts. Prefers linking the main repo's
 * node_modules when package manifests match (fast + reliable on Windows nested
 * worktrees). Falls back to installCommand and verifies afterward.
 */
export async function ensureWorktreeDependencies(
  worktreePath: string,
  installCommand: string | undefined,
  timeoutMs: number,
  onLog?: (line: string) => void,
  mainRepoPath?: string,
): Promise<void> {
  const pkgPath = path.join(worktreePath, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  if (nodeModulesHealthy(worktreePath)) return;

  const mainRoot = mainRepoPath ? path.resolve(mainRepoPath) : undefined;
  const mainModules = mainRoot ? path.join(mainRoot, "node_modules") : undefined;

  if (
    mainRoot &&
    mainModules &&
    nodeModulesHealthy(mainRoot) &&
    filesIdentical(path.join(mainRoot, "package.json"), pkgPath) &&
    filesIdentical(
      path.join(mainRoot, "package-lock.json"),
      path.join(worktreePath, "package-lock.json"),
    )
  ) {
    if (linkNodeModules(mainModules, path.join(worktreePath, "node_modules"), onLog)) {
      return;
    }
  }

  if (!installCommand) {
    throw new Error(
      `Worktree at ${worktreePath} has no usable node_modules and no install command configured`,
    );
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
    // Last resort: link main modules even if manifests differ slightly
    if (mainRoot && mainModules && nodeModulesHealthy(mainRoot)) {
      onLog?.("Install failed — falling back to main node_modules link");
      if (linkNodeModules(mainModules, path.join(worktreePath, "node_modules"), onLog)) {
        return;
      }
    }
    throw new Error(`Worktree install failed (${result.exitCode}): ${output.slice(0, 2000)}`);
  }

  if (!nodeModulesHealthy(worktreePath)) {
    if (mainRoot && mainModules && nodeModulesHealthy(mainRoot)) {
      onLog?.("Install finished but deps look incomplete — linking main node_modules");
      if (linkNodeModules(mainModules, path.join(worktreePath, "node_modules"), onLog)) {
        return;
      }
    }
    throw new Error(
      `Worktree install completed but node_modules is not usable (missing vitest/cli). ` +
        `Tried: ${installCommand}`,
    );
  }

  onLog?.("Worktree dependencies ready");
}

/** Remove a linked/junctioned node_modules without deleting the link target. */
export function detachWorktreeNodeModules(worktreePath: string): void {
  const nm = path.join(worktreePath, "node_modules");
  try {
    if (!fs.lstatSync(nm, { throwIfNoEntry: false })) return;
  } catch {
    return;
  }
  try {
    const st = fs.lstatSync(nm);
    if (st.isSymbolicLink()) {
      fs.unlinkSync(nm);
      return;
    }
  } catch {
    // continue
  }
  try {
    if (process.platform === "win32") {
      execFileSync("cmd", ["/c", "rmdir", nm], { stdio: "ignore" });
    } else {
      fs.rmdirSync(nm);
    }
  } catch {
    try {
      fs.rmdirSync(nm);
    } catch {
      // ignore
    }
  }
}
