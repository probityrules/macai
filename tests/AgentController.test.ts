import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTempGitRepo, openTempDatabase, seedMinimalRun, removeTempGitRepo, createTestAppConfig } from './helpers/tempMacaiRepo.ts';
import { createMockOllama } from './helpers/mockOllama.ts';
import { AgentController, AgentRunContext } from '../src/agent/AgentController.ts';
import type { MacaiDatabase } from '../src/persistence/Database.js';

describe('AgentController investigation mode', () => {
  let repo: ReturnType<typeof createTempGitRepo>;
  let db: MacaiDatabase;
  let cleanup: () => void;

  afterEach(() => {
    db?.close();
    cleanup?.();
  });

  it('should complete investigation mode successfully', async () => {
    // Setup temp repo and database
    repo = createTempGitRepo();
    cleanup = () => removeTempGitRepo(repo);
    db = openTempDatabase(repo.repoPath);
    
    // Create a run and task
    const { taskId } = seedMinimalRun(db, repo.repoPath);
    
    // Update task to investigation mode
    db.updateTask(taskId, { mode: 'investigation' });
    
    // Create mock Ollama with several responses to advance phases
    const ollama = createMockOllama({
      chatResponses: [
        "Understood the repository structure.",
        "I'll examine the files and summarize what I find.",
        "Found 3 main modules: agent, config, and persistence.",
        "The agent module contains AgentController.ts which handles task execution.",
        "The config module manages application configuration.",
        "The persistence module handles database operations.",
        "Investigation complete. Key findings: agent module needs unit tests added.",
        "Summary of investigation findings: 1) Missing unit tests for AgentController, 2) Need to add test coverage for planning phase.",
        "All investigation tasks completed successfully."
      ]
    });
    
    // Create log directory
    const logDir = path.join(repo.repoPath, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    
    // Setup context with complete config
    const config = createTestAppConfig({
      model: "test-model",
      ollamaUrl: "http://127.0.0.1:11434",
      repo: {
        test: "npm test"
      }
    });
    
    const ctx: AgentRunContext = {
      config,
      ollama,
      db,
      task: db.getTask(taskId)!,
      worktreePath: repo.repoPath,
      logDir,
      onLog: (line) => console.log(`[LOG] ${line}`)
    };
    
    // Run the agent controller
    const controller = new AgentController(ctx);
    const result = await controller.run();
    
    // Expect success
    expect(result.success).toBe(true);
  });

  it('should handle cancellation properly', async () => {
    // Setup temp repo and database
    repo = createTempGitRepo();
    cleanup = () => removeTempGitRepo(repo);
    db = openTempDatabase(repo.repoPath);
    
    // Create a run and task
    const { taskId } = seedMinimalRun(db, repo.repoPath);
    
    // Update task to investigation mode
    db.updateTask(taskId, { mode: 'investigation' });
    
    // Create mock Ollama with minimal responses
    const ollama = createMockOllama({
      chatResponses: [
        "Understood the repository structure.",
        "I'll examine the files and summarize what I find."
      ]
    });
    
    // Create log directory
    const logDir = path.join(repo.repoPath, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    
    // Setup context with complete config and shouldStop function that returns true
    const config = createTestAppConfig({
      model: "test-model",
      ollamaUrl: "http://127.0.0.1:11434",
      repo: {
        test: "npm test"
      }
    });
    
    const ctx: AgentRunContext = {
      config,
      ollama,
      db,
      task: db.getTask(taskId)!,
      worktreePath: repo.repoPath,
      logDir,
      onLog: (line) => console.log(`[LOG] ${line}`),
      shouldStop: () => true
    };
    
    // Run the agent controller
    const controller = new AgentController(ctx);
    const result = await controller.run();
    
    // Expect cancellation
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('Cancelled');
  });

  it('should handle max iterations exceeded properly', async () => {
    // Setup temp repo and database
    repo = createTempGitRepo();
    cleanup = () => removeTempGitRepo(repo);
    db = openTempDatabase(repo.repoPath);
    
    // Create a run and task
    const { taskId } = seedMinimalRun(db, repo.repoPath);
    
    // Update task to investigation mode
    db.updateTask(taskId, { mode: 'investigation' });
    
    // Create mock Ollama with minimal responses
    const ollama = createMockOllama({
      chatResponses: [
        "Understood the repository structure.",
        "I'll examine the files and summarize what I find."
      ]
    });
    
    // Create log directory
    const logDir = path.join(repo.repoPath, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    
    // Setup context with config that has maxIterations = 0 - this will be validated by the schema
    // We need to set it to a valid value but make sure it triggers the condition immediately
    const config = createTestAppConfig({
      model: "test-model",
      ollamaUrl: "http://127.0.0.1:11434",
      limits: {
        maxIterations: 1 // Set to 1 so that iteration 0 >= 0 will trigger the condition
      },
      repo: {
        test: "npm test"
      }
    });
    
    const ctx: AgentRunContext = {
      config,
      ollama,
      db,
      task: db.getTask(taskId)!,
      worktreePath: repo.repoPath,
      logDir,
      onLog: (line) => console.log(`[LOG] ${line}`)
    };
    
    // Run the agent controller
    const controller = new AgentController(ctx);
    const result = await controller.run();
    
    // Expect max iterations exceeded - but we need to make sure that the condition is met
    // The issue is that we can't set maxIterations to 0 because of schema validation
    // But we can set it to 1 and make sure the iteration count triggers it immediately
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('Max iterations exceeded');
  });
});