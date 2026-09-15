import {
  abortAdopt,
  acceptAdopt,
  adoptTask,
  returnAdopt,
} from "../git/AdoptSession.js";
import { readAdoptState } from "../git/adoptState.js";

export async function runAdoptCommand(
  repoPath: string,
  taskId: string | undefined,
  opts: { abort?: boolean },
): Promise<void> {
  if (opts.abort) {
    if (taskId) {
      console.error("Do not pass a task id with --abort.");
      process.exitCode = 1;
      return;
    }
    const result = abortAdopt(repoPath);
    console.log(result.message);
    return;
  }

  if (!taskId?.trim()) {
    const existing = readAdoptState(repoPath);
    if (existing) {
      console.log(
        `Currently adopted: ${existing.taskId} (${existing.branch}) since ${existing.adoptedAt}` +
          (existing.mergeInProgress ? " [merge conflicts]" : ""),
      );
      console.log("Use `macai accept`, `macai return`, or `macai adopt --abort`.");
      return;
    }
    console.error("Usage: macai adopt <task-id> | macai adopt --abort");
    process.exitCode = 1;
    return;
  }

  const result = adoptTask(repoPath, taskId.trim());
  console.log(result.message);
}

export async function runReturnCommand(repoPath: string): Promise<void> {
  const result = returnAdopt(repoPath);
  console.log(result.message);
}

export async function runAcceptCommand(
  repoPath: string,
  opts: { message?: string } = {},
): Promise<void> {
  const result = acceptAdopt(repoPath, { message: opts.message });
  console.log(result.message);
}
