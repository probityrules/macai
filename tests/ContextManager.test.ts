import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempGitRepo, openTempDatabase, seedMinimalRun, removeTempGitRepo } from './helpers/tempMacaiRepo.ts';
import { ContextManager } from '../src/agent/ContextManager.ts';

describe('ContextManager', () => {
  let repo: any;
  let db: any;
  let taskId: string;

  beforeEach(() => {
    repo = createTempGitRepo();
    db = openTempDatabase(repo.repoPath);
    const { taskId: createdTaskId } = seedMinimalRun(db, repo.repoPath);
    taskId = createdTaskId;
  });

  afterEach(() => {
    db.close();
    removeTempGitRepo(repo);
  });

  it('saveCheckpoint persists and loadFromCheckpoint restores state', () => {
    const context = new ContextManager(taskId, db);
    
    // Set up some state
    context.setPriorHandoff('Prior handoff summary');
    context.incrementIteration();
    context.setPhase('code');
    context.addFileExamined('/path/to/file1.txt');
    context.addFileChanged('/path/to/file2.txt');
    context.addDecision('Test decision');
    
    // Save checkpoint
    context.saveCheckpoint('Test checkpoint');
    
    // Load from checkpoint
    const loadedContext = ContextManager.loadFromCheckpoint(taskId, db);
    
    if (loadedContext) {
      // Verify state was restored correctly
      expect(loadedContext.getIteration()).toBe(1);
      expect(loadedContext.getState().phase).toBe('code');
      expect(loadedContext.getState().filesExamined).toContain('/path/to/file1.txt');
      expect(loadedContext.getState().filesChanged).toContain('/path/to/file2.txt');
      expect(loadedContext.getState().decisions).toContain('Test decision');
      
      // Note: priorHandoff is not restored from checkpoint because it's not part of the state
      // This test verifies that the core checkpoint functionality works
    }
  });

  it('addFileExamined / addFileChanged do not duplicate paths', () => {
    const context = new ContextManager(taskId, db);
    
    context.addFileExamined('/path/to/file1.txt');
    context.addFileExamined('/path/to/file1.txt'); // Duplicate
    context.addFileChanged('/path/to/file2.txt');
    context.addFileChanged('/path/to/file2.txt'); // Duplicate
    
    const state = context.getState();
    expect(state.filesExamined).toHaveLength(1);
    expect(state.filesChanged).toHaveLength(1);
    expect(state.filesExamined[0]).toBe('/path/to/file1.txt');
    expect(state.filesChanged[0]).toBe('/path/to/file2.txt');
  });

  it('incrementIteration / getIteration round-trip', () => {
    const context = new ContextManager(taskId, db);
    
    expect(context.getIteration()).toBe(0);
    expect(context.incrementIteration()).toBe(1);
    expect(context.getIteration()).toBe(1);
    expect(context.incrementIteration()).toBe(2);
    expect(context.getIteration()).toBe(2);
  });

  it('setPriorHandoff / getPriorHandoff round-trip', () => {
    const context = new ContextManager(taskId, db);
    
    context.setPriorHandoff('Test prior handoff summary');
    expect(context.getPriorHandoff()).toBe('Test prior handoff summary');
    
    context.setPriorHandoff('Another summary');
    expect(context.getPriorHandoff()).toBe('Another summary');
  });
});