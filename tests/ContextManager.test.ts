import { describe, it, beforeEach, afterEach } from 'vitest';
import { ContextManager } from '../src/agent/ContextManager.js';
import { createTempGitRepo, openTempDatabase, seedMinimalRun, removeTempGitRepo } from './helpers/tempMacaiRepo.js';
import type { MacaiDatabase } from '../src/persistence/Database.js';

describe('ContextManager', () => {
  let repo: ReturnType<typeof createTempGitRepo>;
  let db: MacaiDatabase;
  let taskId: string;
  let contextManager: ContextManager;

  beforeEach(() => {
    repo = createTempGitRepo();
    db = openTempDatabase(repo.repoPath);
    const { taskId: seededTaskId } = seedMinimalRun(db, repo.repoPath);
    taskId = seededTaskId;
    contextManager = new ContextManager(taskId, db);
  });

  afterEach(() => {
    db.close();
    removeTempGitRepo(repo);
  });

  describe('saveCheckpoint and loadFromCheckpoint', () => {
    it('should persist data and restore it correctly', () => {
      // Add some data to the context
      contextManager.addFileExamined('/path/to/file1.js');
      contextManager.addFileChanged('/path/to/file2.js');
      contextManager.addDecision('Test decision');
      contextManager.incrementIteration();
      contextManager.setPhase('code');
      contextManager.setPlan('Test plan');

      // Save checkpoint
      contextManager.saveCheckpoint('Test checkpoint');

      // Load from checkpoint
      const loadedContext = ContextManager.loadFromCheckpoint(taskId, db);
      
      expect(loadedContext).toBeDefined();
      if (loadedContext) {
        const state = loadedContext.getState();
        expect(state.filesExamined).toEqual(['/path/to/file1.js']);
        expect(state.filesChanged).toEqual(['/path/to/file2.js']);
        expect(state.decisions).toEqual(['Test decision']);
        expect(state.iteration).toBe(1);
        expect(state.phase).toBe('code');
        expect(state.plan).toBe('Test plan');
      }
    });
  });

  describe('addFileExamined and addFileChanged deduplication', () => {
    it('should not duplicate file paths in filesExamined', () => {
      contextManager.addFileExamined('/path/to/file.js');
      contextManager.addFileExamined('/path/to/file.js');
      contextManager.addFileExamined('/path/to/another.js');

      const state = contextManager.getState();
      expect(state.filesExamined).toEqual(['/path/to/file.js', '/path/to/another.js']);
    });

    it('should not duplicate file paths in filesChanged', () => {
      contextManager.addFileChanged('/path/to/file.js');
      contextManager.addFileChanged('/path/to/file.js');
      contextManager.addFileChanged('/path/to/another.js');

      const state = contextManager.getState();
      expect(state.filesChanged).toEqual(['/path/to/file.js', '/path/to/another.js']);
    });
  });

  describe('incrementIteration and getIteration', () => {
    it('should increment and retrieve iteration correctly', () => {
      expect(contextManager.getIteration()).toBe(0);
      
      contextManager.incrementIteration();
      expect(contextManager.getIteration()).toBe(1);
      
      contextManager.incrementIteration();
      contextManager.incrementIteration();
      expect(contextManager.getIteration()).toBe(3);
    });
  });

  describe('setPriorHandoff and getPriorHandoff', () => {
    it('should set and retrieve prior handoff correctly', () => {
      expect(contextManager.getPriorHandoff()).toBeUndefined();
      
      contextManager.setPriorHandoff('Test handoff summary');
      expect(contextManager.getPriorHandoff()).toBe('Test handoff summary');
      
      contextManager.setPriorHandoff('Another handoff');
      expect(contextManager.getPriorHandoff()).toBe('Another handoff');
    });
  });
});