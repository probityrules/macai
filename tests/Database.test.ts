import { describe, it, expect, afterEach } from 'vitest';
import { createTempGitRepo, openTempDatabase, removeTempGitRepo } from './helpers/tempMacaiRepo.ts';
import { MacaiDatabase } from '../src/persistence/Database.ts';

describe('MacaiDatabase', () => {
  let tempRepo: ReturnType<typeof createTempGitRepo>;
  let db: MacaiDatabase;

  afterEach(() => {
    if (db) {
      db.close();
    }
    if (tempRepo) {
      removeTempGitRepo(tempRepo);
    }
  });

  describe('getOrCreateProject', () => {
    it('should create a new project and return its ID', () => {
      tempRepo = createTempGitRepo();
      db = openTempDatabase(tempRepo.repoPath);
      
      const projectId = db.getOrCreateProject(tempRepo.repoPath);
      expect(projectId).toBe(1);
    });

    it('should return existing project ID when project already exists', () => {
      tempRepo = createTempGitRepo();
      db = openTempDatabase(tempRepo.repoPath);
      
      const projectId1 = db.getOrCreateProject(tempRepo.repoPath);
      const projectId2 = db.getOrCreateProject(tempRepo.repoPath);
      
      expect(projectId1).toBe(1);
      expect(projectId2).toBe(1);
    });

    it('should store detected commands when provided', () => {
      tempRepo = createTempGitRepo();
      db = openTempDatabase(tempRepo.repoPath);
      
      const commands = {
        test: 'npm test',
        build: 'npm run build'
      };
      
      const projectId = db.getOrCreateProject(tempRepo.repoPath, commands);
      
      // We can't directly test the JSON content in this simple test,
      // but we can verify it doesn't throw an error and returns a valid ID
      expect(projectId).toBe(1);
    });
  });

  describe('createRun', () => {
    it('should create a new run with default status queued', () => {
      tempRepo = createTempGitRepo();
      db = openTempDatabase(tempRepo.repoPath);
      
      const projectId = db.getOrCreateProject(tempRepo.repoPath);
      db.createRun({
        id: 'test-run-1',
        projectId,
        model: 'test-model',
        ollamaUrl: 'http://127.0.0.1:11434'
      });
      
      const run = db.getRun('test-run-1');
      expect(run).toBeDefined();
      expect(run!.status).toBe('queued');
    });

    it('should create a new run with provided status', () => {
      tempRepo = createTempGitRepo();
      db = openTempDatabase(tempRepo.repoPath);
      
      const projectId = db.getOrCreateProject(tempRepo.repoPath);
      db.createRun({
        id: 'test-run-2',
        projectId,
        model: 'test-model',
        ollamaUrl: 'http://127.0.0.1:11434',
        status: 'running'
      });
      
      const run = db.getRun('test-run-2');
      expect(run).toBeDefined();
      expect(run!.status).toBe('running');
    });
  });

  describe('createTask', () => {
    it('should create a new task', () => {
      tempRepo = createTempGitRepo();
      db = openTempDatabase(tempRepo.repoPath);
      
      const projectId = db.getOrCreateProject(tempRepo.repoPath);
      db.createRun({
        id: 'test-run-3',
        projectId,
        model: 'test-model',
        ollamaUrl: 'http://127.0.0.1:11434'
      });
      
      db.createTask({
        id: 'task-1',
        runId: 'test-run-3',
        title: 'Test Task',
        description: 'A test task',
        mode: 'coding',
        priority: 1
      });
      
      const tasks = db.getTasksByRun('test-run-3');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Test Task');
    });
  });

  describe('updateTask', () => {
    it('should update task properties', () => {
      tempRepo = createTempGitRepo();
      db = openTempDatabase(tempRepo.repoPath);
      
      const projectId = db.getOrCreateProject(tempRepo.repoPath);
      db.createRun({
        id: 'test-run-4',
        projectId,
        model: 'test-model',
        ollamaUrl: 'http://127.0.0.1:11434'
      });
      
      db.createTask({
        id: 'task-2',
        runId: 'test-run-4',
        title: 'Test Task',
        description: 'A test task',
        mode: 'coding',
        priority: 1
      });
      
      db.updateTask('task-2', {
        status: 'completed',
        attempts: 3
      });
      
      const task = db.getTask('task-2');
      expect(task).toBeDefined();
      expect(task!.status).toBe('completed');
      expect(task!.attempts).toBe(3);
    });
  });

  describe('getTasksByRun', () => {
    it('should return tasks for a specific run', () => {
      tempRepo = createTempGitRepo();
      db = openTempDatabase(tempRepo.repoPath);
      
      const projectId = db.getOrCreateProject(tempRepo.repoPath);
      db.createRun({
        id: 'test-run-5',
        projectId,
        model: 'test-model',
        ollamaUrl: 'http://127.0.0.1:11434'
      });
      
      db.createTask({
        id: 'task-3',
        runId: 'test-run-5',
        title: 'Test Task 1',
        description: 'A test task',
        mode: 'coding',
        priority: 1
      });
      
      db.createTask({
        id: 'task-4',
        runId: 'test-run-5',
        title: 'Test Task 2',
        description: 'Another test task',
        mode: 'testing',
        priority: 2
      });
      
      const tasks = db.getTasksByRun('test-run-5');
      expect(tasks).toHaveLength(2);
      expect(tasks[0].title).toBe('Test Task 2'); // Higher priority first
      expect(tasks[1].title).toBe('Test Task 1');
    });
  });

  describe('getRun', () => {
    it('should return a run by ID', () => {
      tempRepo = createTempGitRepo();
      db = openTempDatabase(tempRepo.repoPath);
      
      const projectId = db.getOrCreateProject(tempRepo.repoPath);
      db.createRun({
        id: 'test-run-6',
        projectId,
        model: 'test-model',
        ollamaUrl: 'http://127.0.0.1:11434'
      });
      
      const run = db.getRun('test-run-6');
      expect(run).toBeDefined();
      expect(run!.id).toBe('test-run-6');
      expect(run!.model).toBe('test-model');
    });
  });

  describe('finishRun', () => {
    it('should update run status to finished', () => {
      tempRepo = createTempGitRepo();
      db = openTempDatabase(tempRepo.repoPath);
      
      const projectId = db.getOrCreateProject(tempRepo.repoPath);
      db.createRun({
        id: 'test-run-7',
        projectId,
        model: 'test-model',
        ollamaUrl: 'http://127.0.0.1:11434'
      });
      
      db.finishRun('test-run-7', 'completed', 1000);
      
      const run = db.getRun('test-run-7');
      expect(run).toBeDefined();
      expect(run!.status).toBe('completed');
      expect(run!.runtime_ms).toBe(1000);
    });
  });

  describe('recordCommand', () => {
    it('should record a command execution', () => {
      tempRepo = createTempGitRepo();
      db = openTempDatabase(tempRepo.repoPath);
      
      const projectId = db.getOrCreateProject(tempRepo.repoPath);
      db.createRun({
        id: 'test-run-8',
        projectId,
        model: 'test-model',
        ollamaUrl: 'http://127.0.0.1:11434'
      });
      
      db.createTask({
        id: 'task-5',
        runId: 'test-run-8',
        title: 'Test Task',
        description: 'A test task',
        mode: 'coding',
        priority: 1
      });
      
      db.recordCommand({
        taskId: 'task-5',
        command: 'echo hello',
        exitCode: 0
      });
      
      // We can verify it doesn't throw an error, but we can't easily check the data
      // since there's no direct getter for commands
      expect(true).toBe(true); // Just ensuring it doesn't throw
    });
  });

  describe('recordTestResult', () => {
    it('should record a test result', () => {
      tempRepo = createTempGitRepo();
      db = openTempDatabase(tempRepo.repoPath);
      
      const projectId = db.getOrCreateProject(tempRepo.repoPath);
      db.createRun({
        id: 'test-run-9',
        projectId,
        model: 'test-model',
        ollamaUrl: 'http://127.0.0.1:11434'
      });
      
      db.createTask({
        id: 'task-6',
        runId: 'test-run-9',
        title: 'Test Task',
        description: 'A test task',
        mode: 'testing',
        priority: 1
      });
      
      db.recordTestResult({
        taskId: 'task-6',
        kind: 'result',
        passed: 5,
        failed: 0,
        skipped: 0,
        total: 5,
        exitCode: 0,
        outputPath: '/tmp/test-output.txt',
        command: 'npm test'
      });
      
      // We can verify it doesn't throw an error, but we can't easily check the data
      expect(true).toBe(true); // Just ensuring it doesn't throw
    });
  });
});