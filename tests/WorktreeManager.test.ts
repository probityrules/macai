import { describe, it, beforeEach, afterEach } from 'vitest';
import fs from "node:fs";
import path from "node:path";
import { WorktreeManager } from '../src/git/WorktreeManager';
import {
  createTempGitRepo,
  removeTempGitRepo,
} from './helpers/tempMacaiRepo';

describe('WorktreeManager', () => {
  let repo: { tmpDir: string; repoPath: string; cleanup(): void };

  beforeEach(() => {
    repo = createTempGitRepo();
  });

  afterEach(() => {
    if (repo) repo.cleanup();
  });

  it('should create and remove a worktree', () => {
    const manager = new WorktreeManager(repo.repoPath);
    const taskId = 'test-task';
    const info = manager.createWorktree(taskId, 'main');
    expect(fs.existsSync(info.worktreePath)).toBe(true);

    manager.removeWorktree(taskId);
    expect(fs.existsSync(info.worktreePath)).toBe(false);
  });

  it('should detect clean vs dirty worktrees', () => {
    const manager = new WorktreeManager(repo.repoPath);

    // Clean state (after initial commit)
    expect(manager.isWorkingTreeClean()).toBe(true);
    expect(manager.getCurrentBranch()).toBe('main');

    // Dirty state after modification
    fs.writeFileSync(path.join(repo.repoPath, 'test.txt'), 'dirty content');
    expect(manager.isWorkingTreeClean()).toBe(false);
  });

  it('should throw on getWorktreeStatus for invalid path', () => {
    const manager = new WorktreeManager(repo.repoPath);
    expect(() => {
      manager.getWorktreeStatus('/nonexistent/path');
    }).toThrow(/ENOENT/);
  });
});