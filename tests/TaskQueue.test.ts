import { describe, it, beforeEach, afterEach } from 'vitest';
import { createTempGitRepo, removeTempGitRepo } from './helpers/tempMacaiRepo';
import { openTempDatabase } from './helpers/tempMacaiRepo';
import { seedRun } from './helpers/tempMacaiRepo';
import { TaskQueue } from '../src/queue/TaskQueue';
import type { MacaiDatabase } from '../src/persistence/Database';

describe('TaskQueue', () => {
  let repo: any;
  let db: MacaiDatabase;
  let runId: string;

  beforeEach(async () => {
    repo = createTempGitRepo();
    db = openTempDatabase(repo.repoPath);
    runId = 'test-run-id';
    seedRun(db, repo.repoPath, runId);
  });

  afterEach(() => {
    db.close();
    removeTempGitRepo(repo);
  });

  it('should enqueue tasks and return task records', () => {
    const taskQueue = new TaskQueue(db, runId);
    
    const tasks = [
      { title: 'Task 1', description: 'Description 1' },
      { title: 'Task 2', description: 'Description 2' }
    ];
    
    const records = taskQueue.enqueueAll(tasks);
    
    expect(records).toHaveLength(2);
    expect(records[0].title).toBe('Task 1');
    expect(records[1].title).toBe('Task 2');
  });

  it('should get next task when tasks are queued', () => {
    const taskQueue = new TaskQueue(db, runId);
    
    const tasks = [
      { title: 'Task 1', description: 'Description 1' },
      { title: 'Task 2', description: 'Description 2' }
    ];
    
    taskQueue.enqueueAll(tasks);
    
    const nextTask = taskQueue.getNext();
    
    expect(nextTask).toBeDefined();
    expect(nextTask?.title).toBe('Task 1');
  });

  it('should return undefined when no tasks are queued', () => {
    const taskQueue = new TaskQueue(db, runId);
    
    const nextTask = taskQueue.getNext();
    
    expect(nextTask).toBeUndefined();
  });

  it('should not dequeue task when calling getNext()', () => {
    const taskQueue = new TaskQueue(db, runId);
    
    const tasks = [
      { title: 'Task 1', description: 'Description 1' }
    ];
    
    taskQueue.enqueueAll(tasks);
    
    // Call getNext multiple times
    const nextTask1 = taskQueue.getNext();
    const nextTask2 = taskQueue.getNext();
    
    expect(nextTask1).toBeDefined();
    expect(nextTask2).toBeDefined();
    expect(nextTask1?.title).toBe('Task 1');
    expect(nextTask2?.title).toBe('Task 1');
  });

  it('should get all tasks', () => {
    const taskQueue = new TaskQueue(db, runId);
    
    const tasks = [
      { title: 'Task 1', description: 'Description 1' },
      { title: 'Task 2', description: 'Description 2' }
    ];
    
    taskQueue.enqueueAll(tasks);
    
    const allTasks = taskQueue.getAll();
    
    expect(allTasks).toHaveLength(2);
    expect(allTasks[0].title).toBe('Task 1');
    expect(allTasks[1].title).toBe('Task 2');
  });

  it('should mark task as complete', () => {
    const taskQueue = new TaskQueue(db, runId);
    
    const tasks = [
      { title: 'Task 1', description: 'Description 1' }
    ];
    
    const records = taskQueue.enqueueAll(tasks);
    const taskId = records[0].id;
    
    taskQueue.markComplete(taskId);
    
    const updatedTask = db.getTask(taskId);
    expect(updatedTask?.status).toBe('completed');
  });

  it('should mark task as failed', () => {
    const taskQueue = new TaskQueue(db, runId);
    
    const tasks = [
      { title: 'Task 1', description: 'Description 1' }
    ];
    
    const records = taskQueue.enqueueAll(tasks);
    const taskId = records[0].id;
    
    taskQueue.markFailed(taskId, 'Test failure reason');
    
    const updatedTask = db.getTask(taskId);
    expect(updatedTask?.status).toBe('failed');
    expect(updatedTask?.failure_reason).toBe('Test failure reason');
  });
});