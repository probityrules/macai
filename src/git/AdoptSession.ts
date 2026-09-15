import fs from "node:fs";
import path from "node:path";
import { getMacaiDbPath, getTaskDir } from "../config/Config.js";
import { MacaiDatabase } from "../persistence/Database.js";
import { detachWorktreeNodeModules } from "../repo/RepoDetector.js";
import { gitExecFile } from "./gitBinary.js";
import { WorktreeManager } from "./WorktreeManager.js";
import {
  assertNoAdoptState,
  clearAdoptState,
  readAdoptState,
  writeAdoptState,
  type AdoptState,
} from "./adoptState.js";

export interface AdoptResult {
  state: AdoptState;
  conflicts: boolean;
  message: string;
}

export interface ReturnResult {
  state: AdoptState;
  wroteBranchCommit: boolean;
  message: string;
}

export interface AbortResult {
  state: AdoptState;
  message: string;
}

export interface AcceptResult {
  state: AdoptState;
  commit: string;
  message: string;
}

export interface AcceptOptions {
  /** Commit message override. */
  message?: string;
}

function git(repoPath: string, args: string[], cwd = repoPath): string {
  return gitExecFile(args, { cwd });
}

function gitAllowFail(repoPath: string, args: string[], cwd = repoPath): { ok: boolean; out: string } {
  try {
    return { ok: true, out: git(repoPath, args, cwd) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, out: msg };
  }
}

function hasUnmergedPaths(repoPath: string): boolean {
  const out = gitAllowFail(repoPath, ["ls-files", "-u"]).out;
  return out.trim().length > 0;
}

function isMerging(repoPath: string): boolean {
  const gitDir = git(repoPath, ["rev-parse", "--git-dir"]);
  const mergeHead = path.join(repoPath, gitDir, "MERGE_HEAD");
  return fs.existsSync(mergeHead);
}

function resolveTaskBranch(
  repoPath: string,
  taskId: string,
): { branch: string; worktreePath: string | null } {
  const branch = `macai/${taskId}`;
  const branchCheck = gitAllowFail(repoPath, ["rev-parse", "--verify", branch]);
  if (!branchCheck.ok) {
    throw new Error(`No git branch ${branch} for task ${taskId}`);
  }

  let worktreePath: string | null = path.join(getTaskDir(repoPath, taskId), "worktree");
  if (!fs.existsSync(worktreePath)) {
    worktreePath = null;
  }

  const dbPath = getMacaiDbPath(repoPath);
  if (fs.existsSync(dbPath)) {
    const db = new MacaiDatabase(dbPath);
    try {
      const task = db.getTask(taskId);
      if (task?.branch) {
        const verify = gitAllowFail(repoPath, ["rev-parse", "--verify", task.branch]);
        if (verify.ok) {
          const wt =
            task.worktree_path && fs.existsSync(task.worktree_path) ? task.worktree_path : worktreePath;
          return { branch: task.branch, worktreePath: wt };
        }
      }
    } finally {
      db.close();
    }
  }

  return { branch, worktreePath };
}

/**
 * Bring a macai task branch into the primary worktree as normal diffs (no branch switch).
 */
export function adoptTask(repoPath: string, taskId: string): AdoptResult {
  const resolved = path.resolve(repoPath);
  assertNoAdoptState(resolved, "adopt");

  const wt = new WorktreeManager(resolved);
  if (!wt.isWorkingTreeClean()) {
    throw new Error("Working tree is dirty. Commit, stash, or discard changes before adopt.");
  }
  if (isMerging(resolved)) {
    throw new Error("A merge is already in progress. Finish or abort it before adopt.");
  }

  const currentBranch = wt.getCurrentBranch();
  const { branch, worktreePath } = resolveTaskBranch(resolved, taskId);
  if (currentBranch === branch) {
    throw new Error(`Already on ${branch}; adopt is only for reviewing agent work from another branch.`);
  }

  const preAdoptHead = wt.getHeadCommit();
  const merge = gitAllowFail(resolved, ["merge", "--no-commit", "--no-ff", branch]);
  const conflicts = hasUnmergedPaths(resolved) || (!merge.ok && isMerging(resolved));

  if (!merge.ok && !conflicts && /Already up to date/i.test(merge.out)) {
    throw new Error(`Nothing to adopt: ${branch} is already contained in HEAD.`);
  }

  if (!merge.ok && !conflicts && !isMerging(resolved)) {
    throw new Error(`Adopt merge failed: ${merge.out}`);
  }

  if (!conflicts) {
    // Unstage so changes show as ordinary working-tree diffs.
    gitAllowFail(resolved, ["reset", "HEAD"]);
  }

  const state: AdoptState = {
    taskId,
    branch,
    worktreePath,
    preAdoptHead,
    preAdoptBranch: currentBranch,
    adoptedAt: new Date().toISOString(),
    mergeInProgress: conflicts,
  };
  writeAdoptState(resolved, state);

  if (conflicts) {
    return {
      state,
      conflicts: true,
      message:
        `Adopted ${branch} with merge conflicts. Resolve them, then \`macai accept\`, \`macai return\`, or \`macai adopt --abort\`.`,
    };
  }

  return {
    state,
    conflicts: false,
    message:
      `Adopted ${branch} into the working tree as local diffs (still on ${currentBranch}). ` +
      `Review, then \`macai accept\` (land here), \`macai return\` (write back), or \`macai adopt --abort\`.`,
  };
}

/**
 * Write any local edits back onto the agent branch, then restore the primary worktree.
 */
export function returnAdopt(repoPath: string): ReturnResult {
  const resolved = path.resolve(repoPath);
  const state = readAdoptState(resolved);
  if (!state) {
    throw new Error("Nothing to return: no adopt session (missing .macai/adopted.json).");
  }

  const head = git(resolved, ["rev-parse", "HEAD"]);
  if (head !== state.preAdoptHead) {
    throw new Error(
      `HEAD moved while adopted (was ${state.preAdoptHead.slice(0, 8)}, now ${head.slice(0, 8)}). ` +
        `Reset to the pre-adopt commit or finish manually, then \`macai adopt --abort\`.`,
    );
  }

  if (state.mergeInProgress || hasUnmergedPaths(resolved)) {
    throw new Error(
      "Merge conflicts still unresolved. Finish resolving or run `macai adopt --abort`.",
    );
  }

  // Snapshot full tree of current worktree (agent tip + any local edits).
  git(resolved, ["add", "-A"]);
  const stash = gitAllowFail(resolved, ["stash", "create", "macai-return"]).out.trim();

  // Restore primary worktree first so we never leave main dirty if branch update fails later.
  git(resolved, ["reset", "--hard", state.preAdoptHead]);
  gitAllowFail(resolved, ["clean", "-fd"]);

  let wroteBranchCommit = false;
  if (stash) {
    const branchTip = git(resolved, ["rev-parse", state.branch]);
    const stashTree = git(resolved, ["rev-parse", `${stash}^{tree}`]);
    const branchTree = git(resolved, ["rev-parse", `${branchTip}^{tree}`]);

    if (stashTree !== branchTree) {
      const newCommit = git(resolved, [
        "commit-tree",
        stashTree,
        "-p",
        branchTip,
        "-m",
        `macai: return adopt edits for ${state.taskId}`,
      ]);
      git(resolved, ["update-ref", `refs/heads/${state.branch}`, newCommit]);
      wroteBranchCommit = true;
    }

    const wtPath =
      state.worktreePath && fs.existsSync(state.worktreePath) ? state.worktreePath : null;
    if (wtPath) {
      git(resolved, ["reset", "--hard", state.branch], wtPath);
    }
  }

  clearAdoptState(resolved);

  return {
    state,
    wroteBranchCommit,
    message: wroteBranchCommit
      ? `Returned edits onto ${state.branch} and restored the working tree.`
      : `Restored the working tree; ${state.branch} unchanged (no extra edits).`,
  };
}

/**
 * Land adopted working-tree changes as a commit on the current branch and clear the session.
 * Removes the task worktree, deletes the agent branch, and prunes `.macai/tasks/<id>/`.
 */
export function acceptAdopt(repoPath: string, options: AcceptOptions = {}): AcceptResult {
  const resolved = path.resolve(repoPath);
  const state = readAdoptState(resolved);
  if (!state) {
    throw new Error("Nothing to accept: no adopt session (missing .macai/adopted.json).");
  }

  const head = git(resolved, ["rev-parse", "HEAD"]);
  if (head !== state.preAdoptHead) {
    throw new Error(
      `HEAD moved while adopted (was ${state.preAdoptHead.slice(0, 8)}, now ${head.slice(0, 8)}). ` +
        `Reset to the pre-adopt commit, or clear state with \`macai adopt --abort\` after finishing manually.`,
    );
  }

  if (hasUnmergedPaths(resolved)) {
    throw new Error(
      "Merge conflicts still unresolved. Finish resolving, then `macai accept`, or run `macai adopt --abort`.",
    );
  }

  const merging = isMerging(resolved) || state.mergeInProgress;
  git(resolved, ["add", "-A"]);

  const porcelain = gitAllowFail(resolved, ["status", "--porcelain"]).out.trim();
  if (!porcelain && !merging) {
    throw new Error("Nothing to accept: working tree has no changes to commit.");
  }

  const commitMessage =
    options.message?.trim() ||
    `macai: accept ${state.taskId} from ${state.branch}`;

  const committed = gitAllowFail(resolved, ["commit", "-m", commitMessage]);
  if (!committed.ok) {
    throw new Error(`Accept commit failed: ${committed.out}`);
  }

  const commit = git(resolved, ["rev-parse", "HEAD"]);
  clearAdoptState(resolved);

  const cleanupNotes = cleanupAcceptedTask(resolved, state);

  return {
    state,
    commit,
    message: `Accepted ${state.branch} onto ${state.preAdoptBranch} as ${commit.slice(0, 8)}. ${cleanupNotes}`,
  };
}

/** Remove worktree, branch, and task dir after a successful accept. Best-effort; never throws. */
function cleanupAcceptedTask(repoPath: string, state: AdoptState): string {
  const parts: string[] = [];
  const taskDir = getTaskDir(repoPath, state.taskId);
  const wtCandidates = [
    state.worktreePath,
    path.join(taskDir, "worktree"),
  ].filter((p): p is string => Boolean(p));

  try {
    const wtMgr = new WorktreeManager(repoPath);
    let removedWt = false;
    for (const wtPath of wtCandidates) {
      if (!fs.existsSync(wtPath)) continue;
      try {
        wtMgr.removeWorktreeAt(wtPath, true);
      } catch {
        detachWorktreeNodeModules(wtPath);
        fs.rmSync(wtPath, { recursive: true, force: true });
      }
      removedWt = true;
      break;
    }
    if (removedWt) parts.push("removed worktree");
  } catch (err) {
    parts.push(`worktree cleanup failed (${err instanceof Error ? err.message : String(err)})`);
  }

  const branchDelete = gitAllowFail(repoPath, ["branch", "-D", state.branch]);
  if (branchDelete.ok) {
    parts.push(`deleted ${state.branch}`);
  } else if (!/not found|doesn't exist|unknown revision/i.test(branchDelete.out)) {
    // Also try macai/<taskId> if state.branch differed
    const fallback = gitAllowFail(repoPath, ["branch", "-D", `macai/${state.taskId}`]);
    if (fallback.ok) parts.push(`deleted macai/${state.taskId}`);
    else parts.push(`branch delete skipped`);
  }

  try {
    if (fs.existsSync(taskDir)) {
      fs.rmSync(taskDir, { recursive: true, force: true });
      parts.push("pruned task dir");
    }
  } catch (err) {
    parts.push(`task dir cleanup failed (${err instanceof Error ? err.message : String(err)})`);
  }

  return parts.length > 0 ? parts.join("; ") + "." : "Nothing left to clean up.";
}

/** Discard adopted working-tree changes; leave the agent branch/worktree untouched. */
export function abortAdopt(repoPath: string): AbortResult {
  const resolved = path.resolve(repoPath);
  const state = readAdoptState(resolved);
  if (!state) {
    throw new Error("Nothing to abort: no adopt session (missing .macai/adopted.json).");
  }

  if (isMerging(resolved) || state.mergeInProgress) {
    const aborted = gitAllowFail(resolved, ["merge", "--abort"]);
    if (!aborted.ok) {
      git(resolved, ["reset", "--hard", state.preAdoptHead]);
      gitAllowFail(resolved, ["clean", "-fd"]);
    }
  } else {
    git(resolved, ["reset", "--hard", state.preAdoptHead]);
    gitAllowFail(resolved, ["clean", "-fd"]);
  }

  clearAdoptState(resolved);

  return {
    state,
    message: `Aborted adopt of ${state.branch}; working tree restored to ${state.preAdoptBranch} @ ${state.preAdoptHead.slice(0, 8)}.`,
  };
}
