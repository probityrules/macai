import fs from "node:fs";
import path from "node:path";
import { getTaskDir } from "../config/Config.js";
import type { WorktreeInfo, CreateWorktreeOptions } from "../config/types.js";
import { detachWorktreeNodeModules } from "../repo/RepoDetector.js";
import { gitExecFile } from "./gitBinary.js";

export class WorktreeManager {
  constructor(private repoPath: string) {
    this.repoPath = path.resolve(repoPath);
    if (!fs.existsSync(path.join(this.repoPath, ".git"))) {
      throw new Error(`Not a git repository: ${this.repoPath}`);
    }
  }

  private git(args: string[], cwd = this.repoPath): string {
    return gitExecFile(args, { cwd });
  }

  getCurrentBranch(): string {
    try {
      return this.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    } catch {
      return "main";
    }
  }

  getHeadCommit(): string {
    return this.git(["rev-parse", "HEAD"]);
  }

  isWorkingTreeClean(): boolean {
    const status = this.git(["status", "--porcelain"]);
    return status.length === 0;
  }

  createWorktree(taskId: string, baseBranchOrOpts?: string | CreateWorktreeOptions): WorktreeInfo {
    const opts: CreateWorktreeOptions =
      typeof baseBranchOrOpts === "string"
        ? { baseRef: baseBranchOrOpts }
        : (baseBranchOrOpts ?? {});

    const branch = `macai/${taskId}`;
    const worktreePath = path.join(getTaskDir(this.repoPath, taskId), "worktree");
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    const branchBase = opts.baseRef ?? this.getCurrentBranch();
    let baseCommit: string;
    try {
      baseCommit = this.git(["rev-parse", branchBase]);
    } catch {
      baseCommit = this.getHeadCommit();
    }

    if (fs.existsSync(worktreePath)) {
      return { worktreePath, branch, baseCommit };
    }

    try {
      this.git(["branch", branch, branchBase]);
    } catch {
      // branch may already exist — try to reset if we need a fresh tip from base
      try {
        this.git(["branch", "-f", branch, branchBase]);
      } catch {
        // ignore
      }
    }

    this.git(["worktree", "add", worktreePath, branch]);

    return { worktreePath, branch, baseCommit };
  }

  getWorktreeStatus(worktreePath: string): {
    clean: boolean;
    branch: string;
    head: string;
    modified: string[];
  } {
    const status = this.git(["status", "--porcelain"], worktreePath);
    const modified = status
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim());

    return {
      clean: status.length === 0,
      branch: this.git(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath),
      head: this.git(["rev-parse", "HEAD"], worktreePath),
      modified,
    };
  }

  removeWorktree(taskId: string, force = false): void {
    const worktreePath = path.join(getTaskDir(this.repoPath, taskId), "worktree");
    this.removeWorktreeAt(worktreePath, force);
  }

  removeWorktreeAt(worktreePath: string, force = false): void {
    if (!fs.existsSync(worktreePath)) return;

    // Critical: linked node_modules must be detached before recursive delete.
    detachWorktreeNodeModules(worktreePath);

    const args = ["worktree", "remove", worktreePath];
    if (force) args.push("--force");
    try {
      this.git(args);
    } catch {
      // worktree may already be removed
    }
    try {
      this.git(["worktree", "prune"]);
    } catch {
      // ignore prune failures
    }
  }

  listWorktrees(): string[] {
    const output = this.git(["worktree", "list", "--porcelain"]);
    const paths: string[] = [];
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        paths.push(line.slice("worktree ".length));
      }
    }
    return paths;
  }
}
