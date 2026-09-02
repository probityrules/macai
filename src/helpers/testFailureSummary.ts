/**
 * Compress noisy test-runner output so the agent sees real failures.
 * Vitest runs often bury FAIL sections under git CRLF warnings; slicing the
 * head of the log hides the errors entirely.
 */
export function summarizeTestFailureOutput(output: string, maxChars = 4000): string {
  const trimmed = output.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return "(no test output)";

  const withoutCrLfNoise = trimmed
    .split("\n")
    .filter(
      (line) =>
        !/^warning: LF will be replaced by CRLF/i.test(line) &&
        !/^The file will have its original line endings/i.test(line),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const source = withoutCrLfNoise || trimmed;

  const failIdx = source.search(/Failed Tests|Failed Suites|FAIL\s+\S|⎯+.*Failed/i);
  if (failIdx >= 0) {
    const fromFail = source.slice(failIdx);
    if (fromFail.length <= maxChars) return fromFail;
    return `${fromFail.slice(0, maxChars)}\n\n[... failure output truncated ...]`;
  }

  if (source.length <= maxChars) return source;
  return `${source.slice(-maxChars)}\n\n[... showing last ${maxChars} chars of output ...]`;
}

/** Extra fix hints derived from common failure patterns in this repo. */
export function buildTestFixHints(output: string): string[] {
  const hints: string[] = [];

  if (/Cannot find module ['"].*helpers\//i.test(output)) {
    hints.push(
      "Do not invent tests/helpers/* modules. Import createTempGitRepo, openTempDatabase, removeTempGitRepo, seedRun, seedMinimalRun from tests/helpers/tempMacaiRepo.ts only.",
    );
  }
  if (/Cannot find module ['"].*RunLock/i.test(output) || /from ['"].*\/src\/RunLock/i.test(output)) {
    hints.push("RunLock is at src/queue/RunLock.ts — import from '../src/queue/RunLock.js'.");
  }
  if (/Cannot find module ['"].*TaskQueue/i.test(output)) {
    hints.push("TaskQueue is at src/queue/TaskQueue.ts — constructor is new TaskQueue(db, runId), not (repoPath, runId).");
  }
  if (/NOT NULL constraint failed: tasks\.run_id/i.test(output) || /FOREIGN KEY constraint failed/i.test(output)) {
    hints.push("Create a run first with seedRun(db, repo.repoPath, runId) before TaskQueue.enqueueAll.");
  }
  if (/cleanup is not a function/i.test(output)) {
    hints.push("Use removeTempGitRepo(repo) or repo.cleanup() from tempMacaiRepo — do not invent other cleanup APIs.");
  }
  if (/expected false to be true|expected true to be false/i.test(output) && /tryAcquire/i.test(output)) {
    hints.push("RunLock.tryAcquire returns false while any live PID holds the lock file — even the same runId cannot re-acquire.");
  }
  if (/AgentController/i.test(output)) {
    hints.push(
      "Use createTestAppConfig() from tests/helpers/tempMacaiRepo.ts for AppConfig (nested ollama/limits/shell/paths). Ensure logDir exists (fs.mkdirSync). seedMinimalRun then db.updateTask(..., { mode: 'investigation' }). Provide several createMockOllama chatResponses.",
    );
  }
  if (/JobManager\.createJobManager is not a function/i.test(output) || /createJobManager/i.test(output)) {
    hints.push(
      "createJobManager is a named export, not a static method: import { JobManager, createJobManager } from '../src/queue/JobManager.js' then call createJobManager(options). Prefer testing createJobManager construction and JobManager.recoverIncomplete without vi.spyOn(require(...)) — ESM has no require. For recoverIncomplete, seed incomplete investigation/read-only tasks or tasks without worktree_path so no WorktreeManager mocks are needed.",
    );
  }
  if (/Cannot find module .*WorktreeManager|vi\.spyOn\(require/i.test(output)) {
    hints.push(
      "Do not use require() or constructor spies under ESM/vitest. Prefer lightweight recoverIncomplete cases that need no WorktreeManager mock.",
    );
  }
