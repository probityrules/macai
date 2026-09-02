import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempGitRepo, openTempDatabase, removeTempGitRepo, seedRun } from './helpers/tempMacaiRepo';
import { RunLock } from '../src/queue/RunLock';
import fs from 'fs';

describe('RunLock', () => {
  let repo: any;
  let db: any;
  let runLock: RunLock;

  beforeEach(() => {
    repo = createTempGitRepo();
    db = openTempDatabase(repo.repoPath);
    runLock = new RunLock(repo.repoPath);
  });

  afterEach(() => {
    db.close();
    removeTempGitRepo(repo);
  });

  it('should acquire lock for first run', () => {
    const result = runLock.tryAcquire('run-1');
    expect(result).toBe(true);
    
    // Verify the lock was actually created
    const activeRunId = runLock.getActiveRunId();
    expect(activeRunId).toBe('run-1');
  });

  it('should fail to acquire lock when already held', () => {
    // Acquire the lock first
    runLock.tryAcquire('run-1');
    
    // Try to acquire with different runId - should fail
    const result = runLock.tryAcquire('run-2');
    expect(result).toBe(false);
  });

  it('should release lock when called', () => {
    // Acquire the lock
    runLock.tryAcquire('run-1');
    
    // Release the lock
    runLock.release();
    
    // Verify the lock was released
    const activeRunId = runLock.getActiveRunId();
    expect(activeRunId).toBeNull();
  });

  it('should release stale locks when trying to acquire', () => {
    // First acquire a lock
    runLock.tryAcquire('run-1');
    
    // Manually create a fake stale lock file with a dead PID
    const lockData = {
      pid: 99999, // Non-existent PID
      runId: 'stale-run',
      startedAt: new Date().toISOString()
    };
    
    // Create the directory structure first
    const lockDir = require('path').dirname(runLock['lockPath']);
    fs.mkdirSync(lockDir, { recursive: true });
    
    // Write the lock file directly
    fs.writeFileSync(runLock['lockPath'], JSON.stringify(lockData));
    
    // Now try to acquire - should release the stale lock and succeed
    const result = runLock.tryAcquire('run-2');
    expect(result).toBe(true);
    
    // Verify that the new lock is active
    const activeRunId = runLock.getActiveRunId();
    expect(activeRunId).toBe('run-2');
  });

  it('should not release lock when same process tries to acquire again', () => {
    // Acquire the lock first
    const acquired1 = runLock.tryAcquire('run-1');
    expect(acquired1).toBe(true);
    
    // Try to acquire with same runId - should fail (same process cannot re-acquire)
    const acquired2 = runLock.tryAcquire('run-1');
    expect(acquired2).toBe(false);
  });
});