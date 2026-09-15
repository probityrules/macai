import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { abortAdopt, acceptAdopt, adoptTask, returnAdopt } from "../src/git/AdoptSession.js";
import { readAdoptState } from "../src/git/adoptState.js";
import { WorktreeManager } from "../src/git/WorktreeManager.js";
import { createTempGitRepo, removeTempGitRepo, type TempGitRepo } from "./helpers/tempMacaiRepo.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("AdoptSession", () => {
  let repo: TempGitRepo;
  const taskId = "abcd1234ef567890";

  beforeEach(() => {
    repo = createTempGitRepo("macai-adopt-");
  });

  afterEach(() => {
    removeTempGitRepo(repo);
  });

  function seedAgentBranch(content: string): string {
    fs.writeFileSync(path.join(repo.repoPath, ".gitignore"), ".macai/\n");
    git(repo.repoPath, ["add", ".gitignore"]);
    git(repo.repoPath, ["commit", "-m", "ignore macai dir"]);

    const wt = new WorktreeManager(repo.repoPath);
    const info = wt.createWorktree(taskId, "main");
    fs.writeFileSync(path.join(info.worktreePath, "agent.txt"), content);
    git(info.worktreePath, ["add", "agent.txt"]);
    git(info.worktreePath, ["commit", "-m", "agent change"]);
    return info.worktreePath;
  }

  it("adopt materializes branch changes as working-tree diffs", () => {
    seedAgentBranch("from-agent\n");

    const result = adoptTask(repo.repoPath, taskId);
    expect(result.conflicts).toBe(false);
    expect(readAdoptState(repo.repoPath)?.taskId).toBe(taskId);
    expect(fs.readFileSync(path.join(repo.repoPath, "agent.txt"), "utf8").replace(/\r\n/g, "\n")).toBe(
      "from-agent\n",
    );
    expect(git(repo.repoPath, ["status", "--porcelain"])).toMatch(/agent\.txt/);
    expect(git(repo.repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
  });

  it("adopt --abort restores a clean tree and clears state", () => {
    seedAgentBranch("from-agent\n");
    adoptTask(repo.repoPath, taskId);

    const aborted = abortAdopt(repo.repoPath);
    expect(aborted.state.taskId).toBe(taskId);
    expect(readAdoptState(repo.repoPath)).toBeNull();
    expect(fs.existsSync(path.join(repo.repoPath, "agent.txt"))).toBe(false);
    expect(git(repo.repoPath, ["status", "--porcelain"])).toBe("");
  });

  it("return without edits restores main and leaves branch tip unchanged", () => {
    const worktreePath = seedAgentBranch("from-agent\n");
    const branchTipBefore = git(repo.repoPath, ["rev-parse", `macai/${taskId}`]);

    adoptTask(repo.repoPath, taskId);
    const result = returnAdopt(repo.repoPath);

    expect(result.wroteBranchCommit).toBe(false);
    expect(readAdoptState(repo.repoPath)).toBeNull();
    expect(fs.existsSync(path.join(repo.repoPath, "agent.txt"))).toBe(false);
    expect(git(repo.repoPath, ["status", "--porcelain"])).toBe("");
    expect(git(repo.repoPath, ["rev-parse", `macai/${taskId}`])).toBe(branchTipBefore);
    expect(fs.readFileSync(path.join(worktreePath, "agent.txt"), "utf8")).toBe("from-agent\n");
  });

  it("return with local edits commits them onto the agent branch", () => {
    const worktreePath = seedAgentBranch("from-agent\n");
    adoptTask(repo.repoPath, taskId);

    fs.writeFileSync(path.join(repo.repoPath, "agent.txt"), "edited-on-main\n");
    const result = returnAdopt(repo.repoPath);

    expect(result.wroteBranchCommit).toBe(true);
    expect(readAdoptState(repo.repoPath)).toBeNull();
    expect(fs.existsSync(path.join(repo.repoPath, "agent.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(worktreePath, "agent.txt"), "utf8").replace(/\r\n/g, "\n")).toBe(
      "edited-on-main\n",
    );
    expect(git(worktreePath, ["log", "-1", "--pretty=%s"])).toMatch(/return adopt edits/);
  });

  it("accept commits adopted changes onto the current branch", () => {
    const worktreePath = seedAgentBranch("from-agent\n");
    const mainBefore = git(repo.repoPath, ["rev-parse", "HEAD"]);

    adoptTask(repo.repoPath, taskId);
    const result = acceptAdopt(repo.repoPath);

    expect(readAdoptState(repo.repoPath)).toBeNull();
    expect(git(repo.repoPath, ["status", "--porcelain"])).toBe("");
    expect(git(repo.repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    expect(result.commit).not.toBe(mainBefore);
    expect(git(repo.repoPath, ["log", "-1", "--pretty=%s"])).toMatch(
      new RegExp(`accept ${taskId} from macai/${taskId}`),
    );
    expect(fs.readFileSync(path.join(repo.repoPath, "agent.txt"), "utf8").replace(/\r\n/g, "\n")).toBe(
      "from-agent\n",
    );
    expect(fs.existsSync(worktreePath)).toBe(false);
    expect(fs.existsSync(path.join(repo.repoPath, ".macai", "tasks", taskId))).toBe(false);
    expect(() => git(repo.repoPath, ["rev-parse", "--verify", `macai/${taskId}`])).toThrow();
    expect(result.message).toMatch(/removed worktree/i);
    expect(result.message).toMatch(/deleted/i);
  });

  it("accept includes local edits and honors -m", () => {
    seedAgentBranch("from-agent\n");
    adoptTask(repo.repoPath, taskId);
    fs.writeFileSync(path.join(repo.repoPath, "agent.txt"), "tweaked\n");

    acceptAdopt(repo.repoPath, { message: "land toolregistry tests" });

    expect(git(repo.repoPath, ["log", "-1", "--pretty=%s"])).toBe("land toolregistry tests");
    expect(fs.readFileSync(path.join(repo.repoPath, "agent.txt"), "utf8").replace(/\r\n/g, "\n")).toBe(
      "tweaked\n",
    );
    expect(readAdoptState(repo.repoPath)).toBeNull();
    expect(fs.existsSync(path.join(repo.repoPath, ".macai", "tasks", taskId))).toBe(false);
    expect(() => git(repo.repoPath, ["rev-parse", "--verify", `macai/${taskId}`])).toThrow();
  });

  it("refuses accept with no adopt session", () => {
    expect(() => acceptAdopt(repo.repoPath)).toThrow(/no adopt session/i);
  });

  it("refuses adopt when working tree is dirty", () => {
    seedAgentBranch("from-agent\n");
    fs.writeFileSync(path.join(repo.repoPath, "dirty.txt"), "x");
    expect(() => adoptTask(repo.repoPath, taskId)).toThrow(/dirty/i);
  });

  it("refuses a second adopt while one is active", () => {
    seedAgentBranch("from-agent\n");
    adoptTask(repo.repoPath, taskId);
    expect(() => adoptTask(repo.repoPath, taskId)).toThrow(/adopted/i);
    abortAdopt(repo.repoPath);
  });
});
