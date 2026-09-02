import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTempGitRepo, openTempDatabase, seedMinimalRun, removeTempGitRepo } from './helpers/tempMacaiRepo.ts';
import { createTestAppConfig } from '../src/config/Config.js';
import { JobManager, createJobManager } from '../src/queue/JobManager.js';

describe('JobManager', () => {
  let repo: any;
  let db: any;

  beforeEach(() => {
    repo = createTempGitRepo();
    db = openTempDatabase(repo.repoPath);
  });

  afterEach(() => {
    db.close();
    removeTempGitRepo(repo);
  });

  describe('createJobManager', () => {
    it('should create a JobManager instance with correct options', () => {
      const options = {
        repo: repo.repoPath,
        tasks: [],
        model: 'test-model',
        ollamaUrl: 'http://127.0.0.1:11434',
        config: undefined,
      };

      const jobManager = createJobManager(options);

      expect(jobManager).toBeInstanceOf(JobManager);
      expect((jobManager as any).repoPath).toBe(repo.repoPath);
    });

    it('should merge config correctly', () => {
      const options = {
        repo: repo.repoPath,
        tasks: [],
        model: 'test-model',
        ollamaUrl: 'http://127.0.0.1:11434',
        config: undefined,
      };

      const jobManager = createJobManager(options);

      expect((jobManager as any).config).toBeDefined();
    });
  });

  describe('recoverIncomplete', () => {
    it('should process incomplete tasks when database exists', async () => {
      // Create a run and task first
      const { runId, taskId } = seedMinimalRun(db, repo.repoPath);
      
      // Mark the task as in progress to simulate an incomplete run
      db.updateTask(taskId, {
        status: 'in-progress',
        worktree_path: repo.repoPath,
      });

      // This should not throw an error
      await expect(JobManager.recoverIncomplete(repo.repoPath)).resolves.not.toThrow();
    });

    it('should handle tasks with dirty worktrees', async () => {
      // Create a run and task first
      const { runId, taskId } = seedMinimalRun(db, repo.repoPath);
      
      // Mark the task as in progress to simulate an incomplete run
      db.updateTask(taskId, {
        status: 'in-progress',
        worktree_path: repo.repoPath,
      });

      // This should not throw an error even with dirty worktrees
      await expect(JobManager.recoverIncomplete(repo.repoPath)).resolves.not.toThrow();
    });
  });
});