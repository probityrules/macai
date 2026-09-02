import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { MacaiDatabase } from "../../src/persistence/Database.js";

/**
 * Shared test fixtures for macai unit/integration tests.
 * Prefer these helpers over mocking MacaiDatabase / WorktreeManager constructors.
 */

export interface TempGitRepo {
  tmpDir: string;
  repoPath: string;
}

export function createTempGitRepo(prefix = "macai-test-"): TempGitRepo {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const repoPath = path.join(tmpDir, "repo");
  fs.mkdirSync(repoPath);
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoPath });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoPath });
  fs.writeFileSync(path.join(repoPath, "README.md"), "# Test\n");
  execFileSync("git", ["add", "."], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoPath });
  return { tmpDir, repoPath };
}

export function removeTempGitRepo(repo: TempGitRepo): void {
  fs.rmSync(repo.tmpDir, { recursive: true, force: true });
}

/** Open a real MacaiDatabase under .macai/ in the temp repo (no vitest mocks). */
export function openTempDatabase(repoPath: string): MacaiDatabase {
  const macaiDir = path.join(repoPath, ".macai");
  fs.mkdirSync(macaiDir, { recursive: true });
  return new MacaiDatabase(path.join(macaiDir, "database.sqlite"));
}

export function seedMinimalRun(
  db: MacaiDatabase,
  repoPath: string,
  runId = "testrun01",
): { projectId: number; runId: string; taskId: string } {
  const projectId = db.getOrCreateProject(repoPath);
  db.createRun({
    id: runId,
    projectId,
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    maxRuntimeHours: 1,
  });
  const taskId = "taskabcd12345678";
  db.createTask({
    id: taskId,
    runId,
    title: "Sample task",
    description: "Sample description",
    mode: "coding",
    priority: 10,
  });
  return { projectId, runId, taskId };
}
